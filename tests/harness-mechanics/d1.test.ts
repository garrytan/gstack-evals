// Copyright (c) 2026 Garry Tan. MIT License.
// D1 (pre-data harness amendment) and D7's history strip, keylessly and both ways: the lane file's RUN and PATH, prepare-run's TASK_SETUP,
// the hm profile, checks_trust on gstack-tar arms only, laneb_hooks.py's CHECKS_TRUST, the screen's resume cache and the
// d1-checks step's parsers. The live check is dry-run step d1-checks.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armSpec, jobConfig } from "../../quick/laneb/runner/grid.ts";
import { taskSetupLines } from "../../quick/laneb/runner/prepare-run.ts";
import { ARM_SPECS as L1_ARMS, L1_PROFILE } from "../../quick/laneb/l1/l1.ts";
import { ARMS, bundleLists, REPO, sha256, TASK_SETUP, taskSetup } from "../../lanes/harness-mechanics/pins.ts";
import { HM_PROFILE } from "../../lanes/harness-mechanics/plans.ts";
import { pool, screen, type Detect } from "../../lanes/harness-mechanics/screen.ts";
import { checksTrust, D1, D1_TASK, d1Order, editPick, loopResult, verifyLoop } from "../../lanes/harness-mechanics/d1.ts";
import { gitOut, leakyTree } from "./d7-fixture.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "hm-d1-"));
const kwargs = (spec: string) => {
  const { name, tar_name, ...options } = armSpec(spec);
  const b: any = { models: [{ id: "claude-opus-5-5", harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 5 }], arms: [{ name, tar: "/t/" + (tar_name ?? name) + ".tar", sha256: "x", ...options }], tasks_dir: "/k", tasks: ["t1"], attempts: 1, n_concurrent: 1, job_name: "j", agent_dir: "/a", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000 };
  return (jobConfig(b) as any).agents[0].kwargs;
};
const git = (dir: string, ...args: string[]) => Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
// A detached task tree with one commit and no remote, the way SWE-rebench ships /testbed.
const detachedTree = () => {
  const d = tmp(), w = join(d, "testbed");
  Bun.spawnSync(["git", "init", "-q", w]);
  writeFileSync(join(w, "a.py"), "x = 1\n");
  git(w, "add", "a.py");
  git(w, "-c", "user.name=hm", "-c", "user.email=hm@example.invalid", "commit", "-q", "-m", "base");
  git(w, "checkout", "-q", "--detach");
  return { d, w };
};
const runSetup = (w: string, origin: string) => Bun.spawnSync(["sh", "-c", taskSetup().run], { cwd: w, env: { ...process.env, HM_ORIGIN: origin }, stdout: "pipe", stderr: "pipe" });

describe("the lane file", () => {
  test("is at its pinned sha256 and holds one PATH line with both testbed envs first (D2), WORKDIR /testbed, then one RUN", () => {
    const s = taskSetup();
    expect(sha256(readFileSync(TASK_SETUP.file))).toBe(TASK_SETUP.sha256);
    expect(s.envDirs).toEqual(["/opt/miniconda3/envs/testbed/bin", "/opt/conda/envs/testbed/bin"]);
    expect(s.path).toBe("/opt/miniconda3/envs/testbed/bin:/opt/conda/envs/testbed/bin:$PATH");
    expect(s.text.split("\n").filter((l) => /^[A-Z]+ /.test(l)).map((l) => l.split(" ")[0])).toEqual(["ENV", "WORKDIR", "RUN"]);
    expect(s.text.split("\n").filter((l) => l.startsWith("WORKDIR "))).toEqual(["WORKDIR /testbed"]);
  });
  test("the RUN gives a detached tree an origin whose main and HEAD are the base commit, and leaves the tree clean", () => {
    const { d, w } = detachedTree(), origin = join(d, "origin.git");
    const r = runSetup(w, origin);
    expect([r.exitCode, r.stderr.toString()]).toEqual([0, ""]);
    const [main, head] = git(w, "rev-parse", "origin/main", "HEAD").stdout.toString().trim().split("\n");
    expect(main).toBe(head!);
    expect(git(w, "symbolic-ref", "refs/remotes/origin/HEAD").stdout.toString().trim()).toBe("refs/remotes/origin/main");
    expect(git(w, "status", "--porcelain").stdout.toString()).toBe("");
    expect(existsSync(join(w, "origin.git"))).toBe(false);
  });
  test("the RUN refuses a tree that has an origin remote already", () => {
    const { d, w } = detachedTree(), origin = join(d, "origin.git");
    git(w, "remote", "add", "origin", "/elsewhere.git");
    const r = runSetup(w, origin);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain("D1 origin refused");
    expect(existsSync(origin)).toBe(false);
  });
});

describe("D7: the RUN strips history past the base before D1's origin", () => {
  for (const detached of [false, true]) test("on a tree with HEAD " + (detached ? "detached" : "on a branch") + ", every ref past the base, the reflogs, the pseudo refs and the .keep go, D1's fetch leaves FETCH_HEAD at the base, and gc leaves no commit past it", () => {
    const t = leakyTree({ detached }), origin = join(t.root, "opt", "hm-origin.git");
    const r = runSetup(t.w, origin);
    expect([r.exitCode, r.stderr.toString()]).toEqual([0, ""]);
    expect(gitOut(t.w, "for-each-ref", "--format=%(refname)").split("\n")).toEqual(["refs/heads/work", "refs/remotes/origin/HEAD", "refs/remotes/origin/main", "refs/tags/v0.1"]);
    expect(gitOut(t.w, "rev-parse", "HEAD", "origin/main")).toBe(t.base + "\n" + t.base);
    expect(git(t.w, "symbolic-ref", "-q", "HEAD").exitCode).toBe(detached ? 1 : 0);
    expect(git(t.w, "cat-file", "-e", t.future).exitCode).not.toBe(0);
    const commits = gitOut(t.w, "cat-file", "--batch-all-objects", "--batch-check=%(objecttype) %(objectname)").split("\n").filter((l) => l.startsWith("commit ")).map((l) => l.slice(7)).sort();
    expect(commits).toEqual([t.old, t.base].sort());
    expect(existsSync(join(t.w, ".git", "ORIG_HEAD"))).toBe(false);
    expect(readFileSync(join(t.w, ".git", "FETCH_HEAD"), "utf8").match(/[0-9a-f]{40}/g)).toEqual([t.base]);
    expect(readdirSync(join(t.w, ".git", "objects", "pack")).filter((f) => f.endsWith(".keep"))).toEqual([]);
    expect(gitOut(t.w, "reflog", "show", "HEAD")).toBe("");
    expect(gitOut(t.w, "status", "--porcelain")).toBe("");
    expect(gitOut(origin, "for-each-ref", "--format=%(refname) %(objectname)")).toBe("refs/heads/main " + t.base);
  });
  test("the RUN refuses a tree that borrows objects through an alternates file, before it strips or adds anything", () => {
    const t = leakyTree(), origin = join(t.root, "opt", "hm-origin.git");
    writeFileSync(join(t.w, ".git", "objects", "info", "alternates"), join(t.root, "elsewhere", "objects") + "\n");
    const r = runSetup(t.w, origin);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain("fatal: D7 history refused: the tree borrows objects through an alternates file");
    expect(existsSync(origin)).toBe(false);
    expect(gitOut(t.w, "rev-parse", "-q", "--verify", "refs/tags/v9^{commit}")).toBe(t.future);
  });
  test("the RUN refuses a tree holding a nested .git", () => {
    const t = leakyTree(), origin = join(t.root, "opt", "hm-origin.git");
    mkdirSync(join(t.w, "vendor", "pkg"), { recursive: true });
    Bun.spawnSync(["git", "init", "-q", join(t.w, "vendor", "pkg")]);
    const r = runSetup(t.w, origin);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain("fatal: D7 history refused: the tree holds a submodule or a nested .git");
    expect(existsSync(origin)).toBe(false);
  });
});

describe("prepare-run TASK_SETUP", () => {
  test("unset adds nothing, so every Dockerfile stays byte-identical", () => {
    expect(taskSetupLines({})).toBe("");
  });
  test("set at the right sha256 appends the file after the runtime copy", () => {
    expect(taskSetupLines({ TASK_SETUP: TASK_SETUP.file, TASK_SETUP_SHA256: TASK_SETUP.sha256 })).toBe("\n" + readFileSync(TASK_SETUP.file, "utf8"));
  });
  test("a wrong sha256, or one variable without the other, is refused", () => {
    expect(() => taskSetupLines({ TASK_SETUP: TASK_SETUP.file, TASK_SETUP_SHA256: "0".repeat(64) })).toThrow(/^E_USAGE TASK_SETUP .* has sha256/);
    expect(() => taskSetupLines({ TASK_SETUP: TASK_SETUP.file })).toThrow(/E_USAGE set TASK_SETUP and TASK_SETUP_SHA256 together/);
    expect(() => taskSetupLines({ TASK_SETUP_SHA256: TASK_SETUP.sha256 })).toThrow(/E_USAGE/);
  });
  test("the hm profile names the lane file and L1's profile names none", () => {
    expect(HM_PROFILE.taskSetup).toEqual(TASK_SETUP);
    expect(L1_PROFILE.taskSetup).toBeUndefined();
    expect(readFileSync(join(REPO, "quick/laneb/l1/l1.ts"), "utf8")).toContain("...(P.taskSetup ? { TASK_SETUP: P.taskSetup.file, TASK_SETUP_SHA256: P.taskSetup.sha256 } : {})");
  });
});

describe("checks_trust", () => {
  test("every arm whose tar holds gstack sets it, and none and plain-2 never do", () => {
    for (const a of Object.values(ARMS)) expect([a.spec, kwargs(a.spec).checks_trust]).toEqual([a.spec, a.tar === "none" ? undefined : true]);
    expect(Object.values(ARMS).filter((a) => a.tar === "none").length).toBe(2);
  });
  test("L1's arm specs set no checks_trust, and it takes only true", () => {
    for (const s of Object.values(L1_ARMS)) expect(Object.hasOwn(kwargs(s), "checks_trust")).toBe(false);
    expect(() => armSpec("none:checks_trust=false")).toThrow(/E_USAGE/);
  });
  test("laneb_hooks.py runs CHECKS_TRUST after the strip and the arm extract, only when the option is on", () => {
    const py = readFileSync(join(REPO, "quick/laneb/runner/agent/laneb_hooks.py"), "utf8");
    expect(checksTrust()).toBe("/root/.claude/skills/gstack/bin/gstack-checks trust");
    expect(py).toContain('    checks_trust: bool = Field(default=False,');
    const body = py.split("    def _inject_arm(self, container: str) -> dict:\n")[1]!.split("\n\n")[0]!;
    const at = (s: string) => body.indexOf(s);
    expect(at("self._strip_snapshot(container)")).toBeGreaterThan(-1);
    expect(at("self._strip_snapshot(container)")).toBeLessThan(at("super()._inject_arm(container)"));
    expect(at("super()._inject_arm(container)")).toBeLessThan(at("if self.options.checks_trust:"));
    expect(at("if self.options.checks_trust:")).toBeLessThan(at("self._checks_trust(container)"));
    expect(py).toMatch(/"docker", "exec", "-i", "-e", "HOME=\/root", \*workdir, container, "sh", "-c", CHECKS_TRUST\]/);
    expect(py).toContain('raise LanebInfraError(f"gstack-checks trust exited {res.returncode}');
  });
});

describe("screen resume cache", () => {
  const all = bundleLists();
  const l = { ...all, scored: all.scored.slice(0, 3), calibration: all.calibration.slice(0, 2), spare: all.spare.slice(0, 3) };
  const fake = (calls: string[]) => (t: string): Detect => { calls.push(t); return t === l.scored[1] ? { status: "none", detail: "CHECKS: none" } : { status: "check", detail: "CHECK test", env: true }; };
  test("a rerun with the same --out reuses every detect row and writes the same lists", () => {
    const out = tmp(), first: string[] = [], again: string[] = [];
    const a = screen(out, fake(first), l);
    const rows = readFileSync(join(out, "detect.jsonl"), "utf8").trim().split("\n").map((x) => JSON.parse(x));
    expect(rows.map((r) => r.task_id)).toEqual(first);
    expect(rows.every((r) => r.setup === TASK_SETUP.sha256)).toBe(true);
    expect(rows.find((r) => r.task_id === l.scored[0])!.env).toBe(true);
    const b = screen(out, fake(again), l);
    expect(again).toEqual([]);
    expect(b.sha256).toBe(a.sha256);
  });
  test("rows made under another task-setup sha256 are not reused", () => {
    const out = tmp(), first: string[] = [], again: string[] = [];
    screen(out, fake(first), l);
    const f = join(out, "detect.jsonl");
    writeFileSync(f, readFileSync(f, "utf8").replaceAll(TASK_SETUP.sha256, "0".repeat(64)));
    screen(out, fake(again), l);
    expect(again).toEqual(first);
  });
});

describe("d1-checks parsers", () => {
  test("the loop command is the bash block under ## 2. Loop, and a SKILL.md without it is refused", () => {
    const d = tmp();
    Bun.spawnSync(["mkdir", "-p", join(d, "verify")]);
    writeFileSync(join(d, "verify/SKILL.md"), "## 1. Detect\n\n\x60\x60\x60bash\nC=x; \"$C\" detect\n\x60\x60\x60\n\n## 2. Loop: run, fix, run\n\n\x60\x60\x60bash\nC=\"$HOME/.claude/skills/gstack/bin/gstack-checks\"; \"$C\" run\n\x60\x60\x60\n");
    expect(verifyLoop(d)).toBe('C="$HOME/.claude/skills/gstack/bin/gstack-checks"; "$C" run');
    writeFileSync(join(d, "verify/SKILL.md"), "## 1. Detect\n\n\x60\x60\x60bash\nC=x; \"$C\" detect\n\x60\x60\x60\n");
    expect(() => verifyLoop(d)).toThrow(/E_HM_INPUT/);
    expect(verifyLoop(join(REPO, "lanes/harness-mechanics/vendor/gstack"))).toBe('C="$HOME/.claude/skills/gstack/bin/gstack-checks"; "$C" run');
  });
  test("a selected count above zero and a CHECK tests PASS or FAIL line count; a refusal, TOO_BROAD and ENV do not", () => {
    expect(loopResult("HM_SELECTED 42\nCHECK tests PASS 31.2s\n")).toEqual({ selected: 42, check: "PASS", checks: ["tests PASS"] });
    expect(loopResult("HM_SELECTED 1\nCHECK tests FAIL 3.0s\n")).toEqual({ selected: 1, check: "FAIL", checks: ["tests FAIL"] });
    expect(loopResult("HM_SELECTED 0\nCHECK tests PASS 1.0s\n")).toEqual({ selected: 0, check: "PASS", checks: ["tests PASS"] });
    expect(loopResult("gstack-checks: these commands are not trusted for /testbed; nothing was run (CHECKS_CONSENT_REQUIRED)\n")).toEqual({ selected: 0, check: null, checks: [] });
    expect(loopResult("HM_SELECTED 820\nCHECK lint ENV 0.0s  missing-binary: ruff\nCHECK typecheck ENV 0.0s  missing-binary: mypy\nCHECK tests TOO_BROAD 1.1s  pregate selected 820 test files\n")).toEqual({ selected: 820, check: null, checks: ["lint ENV", "typecheck ENV", "tests TOO_BROAD"] });
  });
  test("the edit is the first candidate selecting 1 to 300 files, and the first by name is reported when it selects more", () => {
    expect(editPick("HM_CANDIDATE a/x.py 820\nHM_CANDIDATE a/y.py 0\nHM_CANDIDATE a/z.py 42\n")).toEqual({ first: { file: "a/x.py", selected: 820 }, edit: { file: "a/z.py", selected: 42 } });
    expect(editPick("HM_CANDIDATE a/x.py 301\nHM_CANDIDATE a/y.py -1\n")).toEqual({ first: { file: "a/x.py", selected: 301 }, edit: null });
    expect(editPick("HM_CANDIDATE a/x.py 300\n").edit).toEqual({ file: "a/x.py", selected: 300 });
    expect(editPick("")).toEqual({ first: null, edit: null });
    expect(D1.maxSelected).toBe(300);
  });
  test("tasks are tried from the probe task, then calibration order, one per repository not tried yet", () => {
    const p = pool(), cal = bundleLists().calibration, order = d1Order(cal, (t) => p.get(t)?.repo);
    expect(order[0]).toBe(D1_TASK);
    expect(order[1]).toBe(cal.find((t) => p.get(t)!.repo !== p.get(D1_TASK)!.repo)!);
    expect(new Set(order.map((t) => p.get(t)!.repo)).size).toBe(order.length);
    expect(order.slice(1).map((t) => cal.indexOf(t))).toEqual([...order.slice(1).map((t) => cal.indexOf(t))].sort((a, b) => a - b));
    expect(order).not.toContain("tobymao__sqlglot-6610");
  });
});
