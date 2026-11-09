import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../scripts/gate.ts";
import { ENFORCED_GSTACK_SHA } from "../../src/trial/review/skill-gates.ts";

// Workflow hygiene (U19), also run by the gate as its junit case: every workflow is pinned, read-only in every job and free of
// secrets, installs Bun only by the checksummed download in jobs whose time limit covers that step's worst case, fetches gstack
// at one commit, and ci.yml runs the gate's command cases, so CI and `bun run gate` check the same things. The sealed case is left
// out of ci.yml because sealed.yml runs it on every pull request and every push to main. No job may write: train-gate.yml,
// whose publish job posted a check, is removed until a train dispatches the base's workflow instead of the head's (GST-254).
type Step = { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown>; "timeout-minutes"?: unknown };
type Job = { permissions?: unknown; "timeout-minutes"?: unknown; steps: Step[] };
type Workflow = { on?: unknown; permissions?: unknown; jobs: Record<string, Job> };
const root = join(import.meta.dir, "..", "..");
const dir = join(root, ".github", "workflows");
const files = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const text = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
const workflows = Object.fromEntries(files.map((f) => [f, Bun.YAML.parse(text[f]!) as Workflow]));
const jobs = (f: string) => Object.entries(workflows[f]!.jobs);
const steps = (f: string) => jobs(f).flatMap(([, j]) => j.steps ?? []);
const READ = { contents: "read" };
const namesSecret = (t: string) => /secrets\.|\bsecrets:\s*inherit\b|\bgithub\.token\b/.test(t);

// The Install Bun step's longest run in seconds, when every download stalls until its --max-time: each try of the release
// loop and the waits between them, then curl's own tries at the npm package with its default backoff of 1, 2, 4 and so on
// seconds. It cannot see a Retry-After header, which curl waits out in full between its tries. A step this cannot bound, such
// as a curl with no --max-time, a retry flag it does not model or a third download, comes back as NaN, which no time limit
// passes.
function installWorstCase(run: string) {
  const curls = [...run.matchAll(/^ *curl (.*)$/gm)].map((m) => m[1]!);
  const loop = /^ *for delay in ((?:\d+ )+)end; do\n *curl (.*)$/m.exec(run);
  const npm = curls.find((c) => c.includes("https://registry.npmjs.org/"));
  if (curls.length !== 2 || !loop || !npm || npm === loop[2]) return NaN;
  const seconds = (curl: string) => {
    const retries = Number(/--retry (\d+)/.exec(curl)?.[1] ?? 0);
    return /--retry-/.test(curl) ? NaN : (retries + 1) * Number(/--max-time (\d+)/.exec(curl)?.[1]) + 2 ** retries - 1;
  };
  const waits = loop[1]!.trim().split(" ").map(Number);
  return (waits.length + 1) * seconds(loop[2]!) + waits.reduce((a, b) => a + b, 0) + seconds(npm);
}

// Jobs that install Bun with a time limit, their own or the step's, that is missing or does not pass that step's worst case.
const shortLimits = (w: Workflow) =>
  Object.entries(w.jobs).flatMap(([name, job]) =>
    job.steps
      .filter((s) => s.env?.BUN_SHA256)
      .flatMap((s) => {
        const worst = installWorstCase(s.run ?? "");
        const limits = [job["timeout-minutes"], s["timeout-minutes"] ?? Infinity];
        return limits.every((m) => typeof m === "number" && m * 60 > worst) ? [] : [name];
      }),
  );

describe("workflow hygiene", () => {
  test("reads the workflows the gate relies on", () => {
    expect(files).toEqual(expect.arrayContaining(["ci.yml", "sealed.yml"]));
  });

  test("pins every action to a full commit sha", () => {
    const uses = files.flatMap((f) => steps(f).flatMap((s) => (s.uses ? [f + ": " + s.uses] : [])));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  test("keeps every token read-only", () => {
    for (const f of files) {
      expect([f, workflows[f]!.permissions]).toEqual([f, READ]);
      for (const [name, job] of jobs(f)) expect([f + "/" + name, job.permissions ?? READ]).toEqual([f + "/" + name, READ]);
    }
  });

  test("keeps no credentials in any checkout and uses no cache or workflow_run", () => {
    for (const f of files) {
      for (const s of steps(f).filter((s) => s.uses?.startsWith("actions/checkout@"))) expect([f, s.with?.["persist-credentials"]]).toEqual([f, false]);
      expect([f, /actions\/cache@|\bcache:|workflow_run/.test(text[f]!)]).toEqual([f, false]);
    }
  });

  test("runs pull_request_target and allow-unsafe-pr-checkout only in sealed.yml", () => {
    for (const f of files.filter((f) => f !== "sealed.yml")) {
      const on = workflows[f]!.on;
      const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
      expect([f, triggers.includes("pull_request_target"), steps(f).some((s) => s.with?.["allow-unsafe-pr-checkout"] !== undefined)]).toEqual([f, false, false]);
    }
  });

  test("runs no merge train while a dispatch runs the head's workflow (GST-254)", () => {
    const policy = JSON.parse(readFileSync(join(root, ".gstack", "ship-policy.json"), "utf8")) as Record<string, unknown>;
    expect(policy.train).toBeUndefined();
  });

  test("names no secret", () => {
    for (const f of files) expect([f, namesSecret(text[f]!)]).toEqual([f, false]);
  });

  test("counts github.token as naming a secret", () => {
    expect(namesSecret("        env:\n          GH_TOKEN: ${{ github.token }}\n")).toBe(true);
  });

  test("counts secrets: inherit as naming a secret", () => {
    expect(namesSecret("    uses: ./.github/workflows/reusable.yml\n    secrets: inherit\n")).toBe(true);
  });

  test("installs Bun only by the checksummed download, at one version and digest", () => {
    const pins = new Set<string>();
    for (const f of files) {
      expect([f, text[f]!.includes("setup-bun")]).toEqual([f, false]);
      for (const [name, job] of jobs(f)) {
        const install = job.steps.findIndex((s) => s.env?.BUN_SHA256);
        const firstBun = job.steps.findIndex((s) => /(^|\s)bun\s/m.test(s.run ?? ""));
        if (firstBun >= 0) expect([f + "/" + name, install >= 0 && install < firstBun]).toEqual([f + "/" + name, true]);
      }
      for (const s of steps(f).filter((s) => s.env?.BUN_SHA256)) {
        pins.add(s.env!.BUN_VERSION + " " + s.env!.BUN_SHA256);
        expect(s.run).toContain('"https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip"');
        expect(s.run).toContain('printf \'%s  %s\\n\' "$BUN_SHA256" "$RUNNER_TEMP/bun.zip" | sha256sum -c --strict -');
        expect(s.run!.indexOf("sha256sum")).toBeLessThan(s.run!.indexOf("unzip"));
      }
    }
    expect([...pins]).toHaveLength(1);
    expect([...pins][0]).toMatch(/^\d+\.\d+\.\d+ [0-9a-f]{64}$/);
  });

  test("falls back only to the same version's npm package, checked before it is unpacked, by one step in every workflow", () => {
    const installs = files.flatMap((f) => steps(f).filter((s) => s.env?.BUN_SHA256));
    expect(new Set(installs.map((s) => JSON.stringify([s.env, s.run]))).size).toBe(1);
    const s = installs[0]!;
    const run = s.run!;
    expect(s.env!.BUN_NPM_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.match(/https:\/\/[^"\s]+/g)).toEqual([
      "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip",
      "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-$BUN_VERSION.tgz",
    ]);
    const check = run.indexOf('printf \'%s  %s\\n\' "$BUN_NPM_SHA256" "$RUNNER_TEMP/bun.tgz" | sha256sum -c --strict -');
    expect(check).toBeGreaterThan(run.indexOf("registry.npmjs.org/@oven/bun-linux-x64/"));
    expect(check).toBeLessThan(run.indexOf("tar -xzf"));
    const version = run.indexOf('test "$("$RUNNER_TEMP/bun-linux-x64/bun" --version)" = "$BUN_VERSION"');
    expect(version).toBeGreaterThan(run.indexOf("fi\n"));
    expect(version).toBeLessThan(run.indexOf('>> "$GITHUB_PATH"'));
    expect(run.match(/>> "\$GITHUB_PATH"/g)).toHaveLength(1);
  });

  test("reads the Install Bun step's worst case as four 30-second tries, three waits, then four 60-second tries and curl's backoff", () => {
    const run = steps("sealed.yml").find((s) => s.env?.BUN_SHA256)!.run!;
    expect(installWorstCase(run)).toBe(4 * 30 + (15 + 30 + 60) + 4 * 60 + (1 + 2 + 4));
  });

  test("cannot bound a step with a download that has no --max-time, a retry flag it does not model or a third download", () => {
    const run = steps("sealed.yml").find((s) => s.env?.BUN_SHA256)!.run!;
    const changed = [
      run.replace("--retry 3 --connect-timeout 10 --max-time 60 ", "--retry 3 --connect-timeout 10 "),
      run.replace("--retry 3 ", "--retry 3 --retry-delay 5 "),
      run + "curl -fsSL --max-time 30 -o x https://example.com/x\n",
    ];
    for (const c of changed) expect([c !== run, installWorstCase(c)]).toEqual([true, NaN]);
  });

  test("gives every job that installs Bun a time limit above that step's worst case", () => {
    const installing = files.flatMap((f) =>
      jobs(f).flatMap(([name, job]) => (job.steps.some((s) => s.env?.BUN_SHA256) ? [f + "/" + name] : [])),
    );
    expect(installing).toEqual(["ci.yml/checks", "rig.yml/tier", "sealed.yml/sealed"]);
    for (const f of files) expect([f, shortLimits(workflows[f]!)]).toEqual([f, []]);
  });

  test("fails a copy of sealed.yml with a 5-minute time limit and passes it with 10", () => {
    const copy = (minutes: number) =>
      Bun.YAML.parse(text["sealed.yml"]!.replace(/^    timeout-minutes: \d+$/m, "    timeout-minutes: " + minutes)) as Workflow;
    expect([copy(5).jobs.sealed!["timeout-minutes"], shortLimits(copy(5))]).toEqual([5, ["sealed"]]);
    expect([copy(10).jobs.sealed!["timeout-minutes"], shortLimits(copy(10))]).toEqual([10, []]);
  });

  test("fetches gstack at one pinned commit", () => {
    const pins = files.flatMap((f) => steps(f).flatMap((s) => (s.env?.GSTACK_SHA ? [f + " " + s.env.GSTACK_SHA] : [])));
    expect(pins.some((p) => p.startsWith("sealed.yml "))).toBe(true);
    expect(pins.some((p) => p.startsWith("ci.yml "))).toBe(true);
    const shas = new Set(pins.map((p) => p.split(" ")[1]));
    expect(shas.size).toBe(1);
    expect([...shas][0]).toMatch(/^[0-9a-f]{40}$/);
  });

  test("fetches the enforced CEO arm's gstack only for rig.yml's tier, at skill-gates.ts's pin, checks its tree, and hands it to the tier step", () => {
    const fetches = files.flatMap((f) => steps(f).flatMap((s, i) => (s.env?.ENFORCED_GSTACK_SHA ? [{ f, s, i }] : [])));
    expect(fetches.map((x) => x.f)).toEqual(["rig.yml"]);
    const { s, i } = fetches[0]!;
    expect([s.env!.ENFORCED_GSTACK_SHA, s.env!.ENFORCED_GSTACK_TREE]).toEqual([ENFORCED_GSTACK_SHA, "9340ccf599e3c6dbb550ca2cef5b24a5a36aefa3"]);
    expect(s.run).toContain('test "$(git -C "$RUNNER_TEMP/gstack-enforced" rev-parse HEAD)" = "$ENFORCED_GSTACK_SHA"');
    expect(s.run).toContain('test "$(git -C "$RUNNER_TEMP/gstack-enforced" rev-parse \'HEAD^{tree}\')" = "$ENFORCED_GSTACK_TREE"');
    expect(s.run).not.toMatch(/setup|install|\bbun\b|\.sh\b/);
    const tier = steps("rig.yml").findIndex((x) => (x.run ?? "").includes("rig tier"));
    expect(tier).toBeGreaterThan(i);
    expect(steps("rig.yml")[tier]!.env).toEqual({ OUTCOME_GSTACK_ENFORCED_PIN: "${{ runner.temp }}/gstack-enforced" });
  });

  test("runs the gate's command cases in ci.yml", () => {
    const m = parseManifest(readFileSync(join(root, "gate", "manifest.json"), "utf8"));
    if ("error" in m) throw new Error(m.error);
    const runs = steps("ci.yml").map((s) => (s.run ?? "").trim());
    const cases = m.stages.m0!.filter((c) => c.kind === "command" && c.id !== "sealed");
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect([c.id, runs.some((r) => r.startsWith(c.run))]).toEqual([c.id, true]);
  });
});
