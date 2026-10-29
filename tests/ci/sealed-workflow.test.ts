import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// sealed.yml is the CI backstop for gstack-pregate sealed (U19a). These checks keep it default-branch-owned, pinned, read-only,
// free of pull request code, and unable to pass without a clear verdict under the default branch's policy.
type Step = { uses?: string; run?: string; if?: unknown; "continue-on-error"?: unknown };
type Job = { if?: unknown; "continue-on-error"?: unknown; steps: Step[] };
const text = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "sealed.yml"), "utf8");
const body = text
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const job = (Bun.YAML.parse(text) as { jobs: { sealed: Job } }).jobs.sealed;
const SHA = /^[0-9a-f]{40}$/;
const SCAN = 'bun --no-env-file --config=/dev/null "$RUNNER_TEMP/gstack/bin/gstack-pregate" sealed --range "$BASE_SHA..$HEAD_SHA" --base "$POLICY_BRANCH"';
const step = (needle: string) => job.steps.findIndex((s) => (s.uses ?? s.run ?? "").includes(needle));
const bash = (script: string, cwd: string, env: Record<string, string> = {}) =>
  spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd, env: { PATH: process.env.PATH ?? "", ...env } });

describe("sealed.yml", () => {
  test("runs the default branch's copy on every pull request event that changes its commits or base, and on every push to main", () => {
    expect(body).toMatch(/^on:\n  pull_request_target:\n    types: \[opened, synchronize, reopened, edited\]\n  push:\n    branches: \[main\]\n\n/m);
    expect(body.match(/^\s+branches:/gm)).toHaveLength(1);
    expect(body).not.toMatch(/^\s+(branches-ignore|paths|paths-ignore|tags):/m);
    expect(body).not.toMatch(/^\s+pull_request:/m);
  });

  test("scans a push from its old head to its new one, and a pull request from its base to its head", () => {
    expect(body).toContain("ref: ${{ github.event.pull_request.head.sha || github.sha }}");
    expect(body).toContain("BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}");
    expect(body).toContain("HEAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}");
  });

  test("pins every action and the gstack fetch to a full commit sha", () => {
    const uses = [...body.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref.split("@")[1] ?? "").toMatch(SHA);
    const pin = body.match(/GSTACK_SHA:\s*([0-9a-f]+)\s*# gstack v\d+\.\d+\.\d+\.\d+/);
    expect(pin?.[1] ?? "").toMatch(SHA);
    expect(body).toContain('test "$(git -C "$RUNNER_TEMP/gstack" rev-parse HEAD)" = "$GSTACK_SHA"');
  });

  test("reads the pull request as data: head sha, full history, no persisted token, read-only, no secrets", () => {
    expect(body).toContain("ref: ${{ github.event.pull_request.head.sha || github.sha }}");
    expect(body).toContain("fetch-depth: 0");
    expect(body).toContain("persist-credentials: false");
    expect(body).toContain("allow-unsafe-pr-checkout: true");
    expect(body).toMatch(/^permissions:\n  contents: read\n/m);
    expect(body.match(/permissions:/g)?.length).toBe(1);
    expect(body).not.toMatch(/secrets\./);
  });

  test("deletes the checked-out files before Bun is installed or run, keeping only the git objects", () => {
    const wipe = step("find . -mindepth 1 -maxdepth 1");
    expect(wipe).toBe(step("actions/checkout@") + 1);
    expect(wipe).toBeLessThan(step("releases/download/bun-v"));
    const dir = mkdtempSync(join(tmpdir(), "sealed-wipe-"));
    expect(bash("git init -q . && git -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m base", dir).status).toBe(0);
    mkdirSync(join(dir, "nested"));
    for (const f of ["tsconfig.json", "package.json", "bunfig.toml", ".env", ".gitattributes", "nested/tsconfig.json"]) writeFileSync(join(dir, f), "{}");
    expect(bash(job.steps[wipe]!.run!, dir).status).toBe(0);
    expect(readdirSync(dir)).toEqual([".git"]);
    expect(bash("git rev-parse --show-toplevel", dir).status).toBe(0);
  });

  test("diffs every added line as text before the scan, whatever the pull request's .gitattributes say", () => {
    const attributes = body.indexOf("printf '* diff\\n' > \"$attributes\"");
    expect(attributes).toBeGreaterThan(-1);
    expect(body).toContain('attributes="$(git rev-parse --git-path info/attributes)"');
    expect(attributes).toBeLessThan(body.indexOf(SCAN));
  });

  test("passes only on a clear verdict under the default branch's policy", () => {
    expect([job.if, job["continue-on-error"], ...job.steps.flatMap((s) => [s.if, s["continue-on-error"]])].every((v) => v === undefined)).toBe(true);
    const scan = job.steps[step(SCAN)]!.run!;
    expect(scan).toContain(SCAN + ' | tee "$RUNNER_TEMP/sealed.txt"');
    expect(body).toContain("POLICY_BRANCH: ${{ github.event.repository.default_branch }}");
    expect(body).toMatch(/shell: bash\n\s+env:\n\s+BASE_SHA:/);
    const gate = (verdict: string) =>
      bash(scan.replace(SCAN, 'printf "%s\\n" "$VERDICT"'), tmpdir(), {
        RUNNER_TEMP: mkdtempSync(join(tmpdir(), "sealed-gate-")),
        POLICY_BRANCH: "main",
        VERDICT: "SEALED" + ": " + verdict,
      }).status;
    expect(gate("clear findings=0 commits=1 visibility=public waived=0 policy=origin/main + pushed 0123456789ab")).toBe(0);
    expect(gate("clear findings=0 commits=1 visibility=public waived=0 policy=origin/main")).toBe(0);
    expect(gate("no-policy findings=0 commits=1 visibility=public waived=0 policy=no sealed key on origin/main or HEAD")).not.toBe(0);
    expect(gate("clear findings=0 commits=1 visibility=public waived=0 policy=pushed 0123456789ab")).not.toBe(0);
    expect(gate("clear findings=0 commits=1 visibility=public waived=0 policy=origin/main-old")).not.toBe(0);
    expect(gate("refused findings=1 commits=1 visibility=public waived=0 policy=origin/main")).not.toBe(0);
    expect(gate("error findings=0 commits=0 visibility=public waived=0 policy=origin/main")).not.toBe(0);
  });

  test("runs only known commands, so nothing from the pull request executes", () => {
    const known = /^(git |test |mkdir -p |printf |attributes=|find \. |grep -Eq |curl -fsSL |unzip -q |bun --no-env-file --config=\/dev\/null "\$RUNNER_TEMP\/gstack\/bin\/gstack-pregate" )/;
    const lines = job.steps.flatMap((s) => (s.run ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(known);
  });
});
