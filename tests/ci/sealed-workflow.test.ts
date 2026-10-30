import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// sealed.yml is the CI backstop for gstack-pregate sealed (U19a). These checks keep it default-branch-owned, pinned, read-only,
// free of pull request code, and unable to pass without a clear verdict under a base policy the head cannot choose (GST-254).
type Step = { uses?: string; run?: string; env?: Record<string, string>; if?: unknown; "continue-on-error"?: unknown };
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
    const known = /^(git |test |mkdir -p |printf |attributes=|policy=|find \. |grep -Eq |curl -fsSL |unzip -q |bun --no-env-file --config=\/dev\/null "\$RUNNER_TEMP\/gstack\/bin\/gstack-pregate" )/;
    const lines = job.steps.flatMap((s) => (s.run ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(known);
  });

  test("points origin/<default> at the base before the scan: the default branch's tip for a pull request, the pre-push commit for a push", () => {
    const pin = step('git update-ref "refs/remotes/origin/$POLICY_BRANCH"');
    expect(pin).toBeGreaterThan(step("find . -mindepth 1 -maxdepth 1"));
    expect(pin).toBeLessThan(step(SCAN));
    expect(job.steps[pin]!.env).toEqual({ EVENT: "${{ github.event_name }}", BEFORE: "${{ github.event.before }}", POLICY_BRANCH: "${{ github.event.repository.default_branch }}" });
  });
});

// The fixture runs: sealed.yml's own steps, minus the Bun and gstack downloads, after a checkout like actions/checkout's, with
// gstack's real checker. ci.yml and train-gate.yml fetch it at sealed.yml's pin into $RUNNER_TEMP/gstack; elsewhere a local
// install serves, and without one these tests skip.
const CHECKER = [process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, "gstack") : "", join(homedir(), ".local", "share", "gstack")].find(
  (d) => d && existsSync(join(d, "bin", "gstack-pregate")),
);
const LIVE = CHECKER !== undefined || process.env.GITHUB_ACTIONS === "true";
const STRICT = { paths: ["**/heldout*/**"], transcripts: [], answer_markers: [], seed_patterns: [], local_paths: false, visibility: "public" };
type Event = { name: "push" | "pull_request_target"; before: string; base: string; head: string };
const HOME = mkdtempSync(join(tmpdir(), "sealed-home-"));

const git = (cwd: string, script: string) => {
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" },
  });
  if (r.status !== 0) throw new Error(script + "\n" + r.stderr);
  return r.stdout.trim();
};

function commit(repo: string, files: Record<string, string>, message: string): string {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  return git(repo, `git add -A && git commit -qm "${message}" && git rev-parse HEAD`);
}

/** A remote whose main carries the strict policy, and a clone of it to build pull requests and pushes in. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "sealed-policy-"));
  const remote = join(dir, "remote.git");
  const src = join(dir, "src");
  git(dir, `git init -q --bare -b main remote.git && git init -q -b main src && git -C src remote add origin "${remote}"`);
  const main = commit(src, { ".gstack/pregate.json": JSON.stringify({ sealed: STRICT }), "a.txt": "a\n" }, "strict policy");
  git(src, "git push -q origin main");
  return { dir, remote, src, main };
}

function runSealed(f: ReturnType<typeof fixture>, event: Event): { status: number | null; out: string } {
  if (!CHECKER) throw new Error("gstack-pregate not found: ci.yml fetches it into $RUNNER_TEMP/gstack");
  const work = mkdtempSync(join(f.dir, "checkout-"));
  git(work, `git init -q . && git remote add origin "${f.remote}" && git fetch -q origin "+refs/heads/*:refs/remotes/origin/*" && git checkout -q --detach ${event.head}`);
  const temp = mkdtempSync(join(f.dir, "runner-"));
  symlinkSync(CHECKER, join(temp, "gstack"));
  const env: Record<string, string> = { RUNNER_TEMP: temp, HOME, EVENT: event.name, BEFORE: event.before, BASE_SHA: event.base, HEAD_SHA: event.head, POLICY_BRANCH: "main" };
  let out = "";
  for (const s of job.steps) {
    if (!s.run || s.run.includes("releases/download/") || s.env?.GSTACK_SHA) continue;
    for (const key of Object.keys(s.env ?? {})) expect(Object.keys(env)).toContain(key);
    const r = bash(s.run, work, env);
    out += r.stdout.toString();
    if (r.status !== 0) return { status: r.status, out };
  }
  return { status: 0, out };
}

describe("sealed.yml on a fixture repository", () => {
  test.skipIf(!LIVE)(
    "a pull request that loosens the policy and adds a file the old policy refuses fails, and so does the push that merges it",
    () => {
      const f = fixture();
      git(f.src, "git checkout -qb loosen");
      const loosened = commit(f.src, { ".gstack/pregate.json": JSON.stringify({ sealed: { ...STRICT, paths: [] } }) }, "loosen the policy");
      const head = commit(f.src, { "tasks/heldout/t1.json": "{}\n" }, "add a held-out task");
      git(f.src, "git push -q origin loosen");
      const pr = runSealed(f, { name: "pull_request_target", before: loosened, base: f.main, head });
      expect(pr.status).not.toBe(0);
      expect(pr.out).toMatch(/^SEALED[:] refused findings=1 .*policy=origin\/main( |$)/m);
      const merged = git(f.src, "git checkout -q main && git merge -q --squash loosen >/dev/null && git commit -qm squash && git rev-parse HEAD");
      git(f.src, "git push -q origin main");
      const push = runSealed(f, { name: "push", before: f.main, base: f.main, head: merged });
      expect(push.status).not.toBe(0);
      expect(push.out).toMatch(/^SEALED[:] refused findings=1 .*policy=origin\/main( |$)/m);
      for (const run of [pr, push]) expect(run.out).toContain("policy commit: " + f.main);
    },
    60_000,
  );

  test.skipIf(!LIVE)(
    "a push cannot waive its own finding: the waivers come from the commit before the push",
    () => {
      const f = fixture();
      const added = commit(f.src, { "tasks/heldout/t1.json": "{}\n" }, "add a held-out task");
      const waived = commit(f.src, { ".gstack/sealed-allow.tsv": ["sealed.path", "tasks/heldout/t1.json", added, "waived by its own push"].join("\t") + "\n" }, "waive it");
      git(f.src, "git push -q origin main");
      const push = runSealed(f, { name: "push", before: f.main, base: f.main, head: waived });
      expect(push.status).not.toBe(0);
      expect(push.out).toMatch(/^SEALED[:] refused findings=1 .* waived=0 .*policy=origin\/main( |$)/m);
    },
    60_000,
  );

  test.skipIf(!LIVE)(
    "passes a clean pull request and its push, and fails closed when the push names no commit before it",
    () => {
      const f = fixture();
      git(f.src, "git checkout -qb notes");
      const head = commit(f.src, { "notes.txt": "plain\n" }, "notes");
      git(f.src, "git push -q origin notes");
      const pr = runSealed(f, { name: "pull_request_target", before: "", base: f.main, head });
      expect(pr.status).toBe(0);
      expect(pr.out).toMatch(/^SEALED[:] clear findings=0 commits=1 .*policy=origin\/main( |$)/m);
      git(f.src, "git checkout -q main && git merge -q --ff-only notes && git push -q origin main");
      const push = runSealed(f, { name: "push", before: f.main, base: f.main, head });
      expect(push.status).toBe(0);
      expect(push.out).toMatch(/^SEALED[:] clear findings=0 commits=1 .*policy=origin\/main( |$)/m);
      for (const before of ["", "0".repeat(40)]) expect(runSealed(f, { name: "push", before, base: f.main, head }).status).not.toBe(0);
    },
    60_000,
  );
});
