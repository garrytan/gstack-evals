import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// train-gate.yml (U19, GST-254): the test and bisect jobs install the head with lifecycle scripts off, check out the base's
// gate code only after that install, and fail when it changes during the cases. The publish job posts only from a run whose
// workflow file is the default branch's train-gate.yml. The fixtures run the workflow's own steps on scratch repositories.
type Step = { id?: string; uses?: string; run?: string; if?: string; shell?: string; env?: Record<string, string>; "continue-on-error"?: unknown };
type Job = { if?: unknown; "continue-on-error"?: unknown; steps: Step[] };
const text = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "train-gate.yml"), "utf8");
const jobs = (Bun.YAML.parse(text) as { jobs: Record<string, Job> }).jobs;
const at = (job: Job, needle: string) => job.steps.findIndex((s) => (s.uses ?? s.run ?? "").includes(needle));
const HOME = mkdtempSync(join(tmpdir(), "train-gate-home-"));
const BASE_GATE = "// the base's gate driver\n";
const HOSTILE = { name: "head", private: true, scripts: { postinstall: 'touch "$RUNNER_TEMP/postinstall-ran"; test ! -d "$RUNNER_TEMP/base" || echo hostile > "$RUNNER_TEMP/base/scripts/gate.ts"' } };

/** Runs one workflow step's script the way the runner does: bash -e, or bash -eo pipefail under shell: bash. */
const step = (s: Step, cwd: string, env: Record<string, string>) =>
  spawnSync("bash", ["--noprofile", "--norc", ...(s.shell === "bash" ? ["-eo", "pipefail"] : ["-e"]), "-c", s.run!], { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME, ...env } });

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

/** A train head whose package.json carries a postinstall hook that rewrites the base's gate driver if it can reach it. */
function hostileHead() {
  const dir = mkdtempSync(join(tmpdir(), "train-gate-"));
  const head = join(dir, "head");
  git(dir, "git init -q -b main head");
  const base = commit(head, { "scripts/gate.ts": BASE_GATE, "gate/manifest.json": "{}\n", "package.json": JSON.stringify({ name: "head", private: true }) }, "base");
  commit(head, { "package.json": JSON.stringify(HOSTILE) }, "hostile postinstall");
  const temp = join(dir, "runner");
  mkdirSync(temp);
  const output = join(dir, "github-output");
  writeFileSync(output, "");
  return { head, base, temp, env: { RUNNER_TEMP: temp, GITHUB_WORKSPACE: head, GITHUB_OUTPUT: output, BASE: base } };
}

describe("train-gate.yml test and bisect jobs", () => {
  for (const name of ["test", "bisect"]) {
    const job = jobs[name]!;
    const gate = at(job, "scripts/gate.ts");

    test(`${name}: installs with lifecycle scripts off, then checks out the base's gate code, so a postinstall hook cannot rewrite it`, () => {
      const h = hostileHead();
      const setup = job.steps.slice(0, gate).filter((s) => /\bbun install\b|git worktree add/.test(s.run ?? ""));
      expect(setup).toHaveLength(2);
      for (const s of setup) expect([s.run, step(s, h.head, h.env).status]).toEqual([s.run, 0]);
      expect(existsSync(join(h.temp, "postinstall-ran"))).toBe(false);
      expect(readFileSync(join(h.temp, "base", "scripts", "gate.ts"), "utf8")).toBe(BASE_GATE);
      expect(job.steps.filter((s) => /\bbun install\b/.test(s.run ?? "")).map((s) => s.run!.trim())).toEqual(["bun install --frozen-lockfile --ignore-scripts"]);
      expect(readFileSync(h.env.GITHUB_OUTPUT, "utf8")).toMatch(/^digest=[0-9a-f]{64}\n$/);
    });

    test(`${name}: fails when the base's gate code changes during the cases`, () => {
      const checkout = job.steps.findIndex((s) => s.id === "base");
      const verify = job.steps.findIndex((s) => s.id === "verify");
      expect(checkout).toBeGreaterThan(at(job, "bun install"));
      expect(checkout).toBeLessThan(gate);
      expect(verify).toBe(gate + 1);
      expect(job.steps[verify]).toMatchObject({ if: "${{ !cancelled() }}", shell: "bash", env: { DIGEST: "${{ steps.base.outputs.digest }}" } });
      const h = hostileHead();
      expect(step(job.steps[checkout]!, h.head, h.env).status).toBe(0);
      const digest = /^digest=([0-9a-f]{64})$/m.exec(readFileSync(h.env.GITHUB_OUTPUT, "utf8"))![1]!;
      const verified = () => step(job.steps[verify]!, h.head, { ...h.env, DIGEST: digest }).status;
      const driver = join(h.temp, "base", "scripts", "gate.ts");
      expect(verified()).toBe(0);
      writeFileSync(driver, "hostile\n");
      expect(verified()).not.toBe(0);
      writeFileSync(driver, BASE_GATE);
      expect(verified()).toBe(0);
      writeFileSync(join(h.temp, "base", "scripts", "extra.ts"), "\n");
      expect(verified()).not.toBe(0);
      rmSync(join(h.temp, "base", "scripts", "extra.ts"));
      expect(verified()).toBe(0);
      expect(step(job.steps[verify]!, h.head, { ...h.env, DIGEST: "" }).status).not.toBe(0);
    });
  }

  test("a record from a run whose base changed is never uploaded", () => {
    const upload = (name: string) => jobs[name]!.steps.find((s) => (s.uses ?? "").startsWith("actions/upload-artifact@"))!;
    expect(upload("test").if).toBe("${{ !cancelled() && steps.verify.outcome == 'success' }}");
    expect(upload("bisect").if).toBeUndefined();
  });
});

describe("train-gate.yml publish job", () => {
  const publish = jobs.publish!;
  const guard = publish.steps.findIndex((s) => (s.run ?? "").includes(".github/workflows/train-gate.yml"));

  test("refuses before it installs anything or posts, with nothing that lets the refusal pass", () => {
    expect(guard).toBe(1);
    expect(publish.steps[0]!.uses).toStartWith("actions/checkout@");
    expect(guard).toBeLessThan(at(publish, "check-runs"));
    expect([publish["continue-on-error"], publish.steps[guard]!.if, publish.steps[guard]!["continue-on-error"]]).toEqual([undefined, undefined, undefined]);
    expect(publish.steps[guard]!.env).toEqual({
      RUN_REF: "${{ github.ref }}",
      DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
      WORKFLOW_REF: "${{ github.workflow_ref }}",
      WORKFLOW_SHA: "${{ github.workflow_sha }}",
    });
  });

  test("posts only from the default branch or a train/ branch whose workflow file is byte-identical to the default branch's", () => {
    const dir = mkdtempSync(join(tmpdir(), "train-gate-publish-"));
    const src = join(dir, "src");
    git(dir, "git init -q --bare -b main remote.git && git init -q -b main src && git -C src remote add origin ../remote.git");
    const reviewed = "name: train-gate\n";
    const main = commit(src, { ".github/workflows/train-gate.yml": reviewed }, "main");
    const same = git(src, "git checkout -qb train/same && git commit -q --allow-empty -m slot && git rev-parse HEAD");
    git(src, `git checkout -q ${main} -b train/edited`);
    const edited = commit(src, { ".github/workflows/train-gate.yml": reviewed + "# edited\n" }, "edit the workflow");
    git(src, `git checkout -q ${main} -b train/gone`);
    const gone = git(src, "git rm -q .github/workflows/train-gate.yml && git commit -qm gone && git rev-parse HEAD");
    const feature = git(src, `git checkout -q ${main} -b feature && git commit -q --allow-empty -m feature && git rev-parse HEAD`);
    git(src, "git push -q origin --all");
    const work = join(dir, "work");
    git(dir, `git init -q work && git -C work remote add origin ../remote.git && git -C work fetch -q origin "+refs/heads/*:refs/remotes/origin/*" && git -C work checkout -q --detach ${main}`);
    const posts = (ref: string, sha: string, o: { file?: string; workflowSha?: string } = {}) =>
      step(publish.steps[guard]!, work, {
        RUN_REF: ref,
        DEFAULT_BRANCH: "main",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_SHA: sha,
        WORKFLOW_SHA: o.workflowSha ?? sha,
        WORKFLOW_REF: "o/r/.github/workflows/" + (o.file ?? "train-gate.yml") + "@" + ref,
      }).status === 0;
    expect(posts("refs/heads/main", main)).toBe(true);
    expect(posts("refs/heads/train/same", same)).toBe(true);
    expect(posts("refs/heads/train/edited", edited)).toBe(false);
    expect(posts("refs/heads/train/gone", gone)).toBe(false);
    expect(posts("refs/heads/feature", feature)).toBe(false);
    expect(posts("refs/heads/train/", same)).toBe(false);
    expect(posts("refs/tags/train/same", same)).toBe(false);
    expect(posts("refs/heads/train/same", same, { file: "copy.yml" })).toBe(false);
    expect(posts("refs/heads/train/same", same, { workflowSha: edited })).toBe(false);
    expect(posts("refs/heads/train/same", same, { workflowSha: "f".repeat(40) })).toBe(false);
  });
});
