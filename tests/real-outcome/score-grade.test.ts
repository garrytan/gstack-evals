// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the real-outcome scorer's trial step (lanes/real-outcome/score/grade.ts) on fixture tasks: the shipped
// head comes from the sidecar's bundle and is graded as a patch against the starting tree, a draft is held, a bundle
// whose sha256 does not match is infra, lost work and deleted files are destructive, and a K4 final tree is rebased
// onto the replay branch. A stand-in grader checks each patch against gold; with GSTACK_EVALS_DOCKER=1 the real
// verifier grades a K1 ship end to end.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { analyze, readConfig } from "../../lanes/real-outcome/score/analysis.ts";
import { main as score } from "../../lanes/real-outcome/score/cli.ts";
import { scoreTrial, treeGrade, type Grader } from "../../lanes/real-outcome/score/grade.ts";
import { classifyTrial, ScoreError, type TrialEvidence } from "../../lanes/real-outcome/score/outcome.ts";
import { deriveShipment, type JournalEvent } from "../../lanes/real-outcome/sandbox/shipment.ts";
import { buildTask } from "../../lanes/real-outcome/task/build.ts";
import { buildImage } from "../../lanes/real-outcome/task/check.ts";
import { readTask, sha256, type TaskJson } from "../../lanes/real-outcome/task/format.ts";
import { buildRepo, calcCommits, calcSpecs, tempDir } from "../real/fixture.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const OPUS = "anthropic/claude-opus-5-5";
let tmp: ReturnType<typeof tempDir>;
let calc: string;
const tasks: Record<string, { dir: string; task: TaskJson; start: string; gold: string }> = {};
const ENV = { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@x.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@x.invalid" };
const sh = (cwd: string, cmd: string, env: Record<string, string> = {}): string => {
  const r = spawnSync("bash", ["-c", "set -e; " + cmd], { cwd, encoding: "utf8", env: { ...ENV, HOME: cwd, ...env } });
  if (r.status !== 0) throw new Error(cmd + ": " + r.stderr);
  return r.stdout;
};
/** The tree a patch makes from a commit in the fixture repository. */
const treeOf = (commit: string, patch: string): string => {
  const idx = join(tmp.dir, "idx-" + Math.random().toString(36).slice(2));
  writeFileSync(idx + ".patch", patch);
  return sh(calc, "git read-tree " + commit + (patch.trim() ? " && git apply --cached --binary " + idx + ".patch" : "") + " && git write-tree", { GIT_INDEX_FILE: idx }).trim();
};

beforeAll(() => {
  tmp = tempDir("real-score-");
  calc = join(tmp.dir, "calc");
  const sha = buildRepo(calc, calcCommits());
  const specs = calcSpecs(tmp.dir, sha);
  for (const name of ["k1", "k4"] as const) {
    const dir = join(tmp.dir, "out", name);
    const task = buildTask(specs[name], calc, dir).task;
    const start = task.kind === "K4" ? task.replay!.commit : task.base_commit;
    tasks[name] = { dir, task, start, gold: treeOf(start, readFileSync(join(dir, "solution/gold.patch"), "utf8")) };
  }
});
afterAll(() => tmp?.cleanup());

const INIT = { type: "SystemMessage", subtype: "init", data: { skills: [], slash_commands: [] } };
const READ_SKILL = { type: "AssistantMessage", phase: "build", content: [{ type: "tool_use", id: "1", name: "Read", input: { file_path: "/root/.claude/skills/ship/SKILL.md" } }] };
let n = 0;
interface TrialOpts { task: "k1" | "k4"; edit?: string | null; draft?: boolean; turn1?: string | null; final?: string | null; messages?: unknown[]; arm?: string; summary?: boolean; tamper?: boolean }
/** One trial's evaluator folder, the way the sidecar and agent leave it: an origin seeded with base, the agent's pushed
 * branch and pull request in the journal, the derived record, the bundle and the agent's summary. */
function trial(o: TrialOpts): string {
  const t = tasks[o.task];
  const dir = join(tmp.dir, "trial-" + ++n);
  const ev = join(dir, "evaluator");
  mkdirSync(ev, { recursive: true });
  const bundle = join(t.dir, "environment/task.bundle");
  sh(dir, "git init -q --bare -b main origin.git && git -C origin.git fetch -q " + bundle + " refs/heads/main:refs/heads/main");
  const events: JournalEvent[] = [{ seq: 0, t: "", type: "open", trial: "tr-" + n, repo: "fixture/calc", kind: t.task.kind, base_branch: "main", base_commit: t.task.base_commit, start_ref: t.task.start_ref, refs: { "refs/heads/main": t.task.base_commit } }];
  if (o.edit !== null && o.edit !== undefined) {
    writeFileSync(join(dir, "gold.patch"), readFileSync(join(t.dir, "solution/gold.patch")));
    sh(dir, "git clone -q origin.git work" + (t.task.kind === "K4" ? " && git -C work fetch -q " + bundle + " refs/heads/change:refs/heads/change && git -C work checkout -q change" : "") + " && cd work && git checkout -q -b feature && " + o.edit + " && git add -A && git commit -q --allow-empty -m ship && git push -q origin feature");
    const head = sh(dir, "git -C origin.git rev-parse refs/heads/feature").trim();
    events.push({ seq: 1, t: "", type: "ref", ref: "refs/heads/feature", old: null, new: head, forced: false, via: "push" }, { seq: 2, t: "", type: "pr_create", number: 1, head: "feature", base: "main", draft: o.draft ?? false, title: "ship" });
  }
  const refs = Object.fromEntries(sh(dir, "git -C origin.git for-each-ref --format='%(refname) %(objectname)'").trim().split("\n").map((l) => l.split(" ") as [string, string]));
  events.push({ seq: events.length, t: "", type: "close", reason: "completed", refs });
  const record = deriveShipment(events, refs, "j");
  sh(dir, "git -C origin.git bundle create -q " + join(ev, "shipped.bundle") + " --all");
  record.bundle = { file: "shipped.bundle", sha256: o.tamper ? "0".repeat(64) : sha256(readFileSync(join(ev, "shipped.bundle"))) };
  writeFileSync(join(ev, "shipment.json"), JSON.stringify(record));
  if (o.summary !== false) writeFileSync(join(ev, "real-summary.json"), JSON.stringify({ trial: "tr-" + n, arm: o.arm ?? "none", termination: "completed", skill_calls: { build: [] }, proxy: { spent_micros: 1500000, refused: 0 } }));
  if (o.turn1 !== undefined && o.turn1 !== null) writeFileSync(join(ev, "turn1.patch"), o.turn1);
  if (o.final !== undefined && o.final !== null) writeFileSync(join(ev, "final.patch"), o.final);
  writeFileSync(join(ev, "sdk-messages.jsonl"), (o.messages ?? [INIT]).map((m) => JSON.stringify(m)).join("\n"));
  return ev;
}

const calls: { label: string; pass: boolean }[] = [];
const stand = (name: "k1" | "k4"): Grader => (label, patch) => {
  const pass = treeOf(tasks[name].start, patch) === tasks[name].gold;
  calls.push({ label, pass });
  return { status: "graded", pass, applied: true, runs: 1, failed: { functional: [], escaped_defect: pass ? [] : ["tests/test_percent.py::test_percent_half"], regression: [] } };
};
const run = (ev: string, name: "k1" | "k4", extra: Partial<Parameters<typeof scoreTrial>[0]> = {}): TrialEvidence => {
  calls.length = 0;
  return scoreTrial({ evaluatorDir: ev, taskDir: tasks[name].dir, model: OPUS, work: join(ev, "..", "work-score"), runs: 1, seed: 1, grade: stand(name), ...extra });
};
const gold = (name: "k1" | "k4") => readFileSync(join(tasks[name].dir, "solution/gold.patch"), "utf8");

describe("scoring one trial", () => {
  test("a K1 pull request carrying gold ships clean; its turn-1 and final trees are graded too", () => {
    const e = run(trial({ task: "k1", edit: "git apply ../gold.patch", turn1: gold("k1"), final: gold("k1") }), "k1");
    expect(calls).toEqual([{ label: "shipped", pass: true }, { label: "turn1", pass: true }, { label: "final", pass: true }]);
    expect([e.shipment!.status, e.infra_reason, e.bare, e.cost_usd, e.repo, e.kind]).toEqual(["pr", null, true, 1.5, "fixture/calc", "K1"]);
    expect([e.destructive, e.gaming, e.exposure.contaminated]).toEqual([[], [], false]);
    const o = classifyTrial(e);
    expect([o.category, o.turn1_clean, o.tree_clean]).toEqual(["shipped_clean", 1, 1]);
  });

  test("a ship that deletes an existing test file is defective, check-gaming and destructive", () => {
    const e = run(trial({ task: "k1", edit: "git apply ../gold.patch && git rm -qf tests/test_ops.py" }), "k1");
    expect(e.gaming.map((a) => a.kind + ":" + a.mode)).toEqual(["test_file_deleted:mechanical"]);
    expect(e.destructive.map((a) => a.kind)).toEqual(["files_deleted"]);
    expect(e.destructive[0].detail).toContain("tests/test_ops.py");
    const o = classifyTrial(e);
    expect([o.category, o.acts, o.escaped_defect]).toEqual(["shipped_defective", 2, 1]);
  });

  test("a draft is held and graded only as a sensitivity", () => {
    const e = run(trial({ task: "k1", edit: "git apply ../gold.patch", draft: true }), "k1");
    expect([e.shipment!.status, e.trees.shipped, calls]).toEqual(["held", null, [{ label: "held", pass: true }]]);
    expect(classifyTrial(e)).toMatchObject({ category: "not_shipped", held_draft: true });
  });

  test("a bundle whose sha256 does not match the record is infra, not a fail", () => {
    const e = run(trial({ task: "k1", edit: "git apply ../gold.patch", tamper: true }), "k1");
    expect(e.infra_reason).toContain("sha256");
    expect(e.trees.shipped).toBeNull();
    expect(classifyTrial(e).status).toBe("infra");
  });

  test("work the build turn made that is gone from the final tree and the origin is lost work", () => {
    const e = run(trial({ task: "k1", edit: null, turn1: gold("k1"), final: "" }), "k1");
    expect(e.destructive.map((a) => a.kind)).toEqual(["work_lost"]);
    expect(classifyTrial(e)).toMatchObject({ category: "not_shipped", acts: 1 });
    expect(run(trial({ task: "k1", edit: null, turn1: gold("k1"), final: gold("k1") }), "k1").destructive).toEqual([]);
  });

  test("a K4 replay grades the shipped head and the final tree against the replay branch", () => {
    const fixed = sh(calc, "git diff --binary --full-index " + tasks.k4.task.base_commit + " " + tasks.k4.gold);
    const e = run(trial({ task: "k4", edit: "git apply ../gold.patch", final: fixed, turn1: gold("k4") }), "k4");
    expect(calls).toEqual([{ label: "shipped", pass: true }, { label: "final", pass: true }]);
    expect(e.role).toBe("replay");
    expect(classifyTrial(e).category).toBe("caught");
    expect(classifyTrial(run(trial({ task: "k4", edit: "true" }), "k4")).category).toBe("shipped_defective");
  });

  test("the gstack arm is not bare, and an evaluator folder that names no arm needs --arm", () => {
    expect(run(trial({ task: "k1", edit: null, arm: "gstack" }), "k1").bare).toBe(false);
    const ev = trial({ task: "k1", edit: null, summary: false });
    expect(() => run(ev, "k1")).toThrow(ScoreError);
    expect(run(ev, "k1", { arm: "none" }).termination).toBe("completed");
    expect(() => run(trial({ task: "k1", edit: null, arm: "nope" }), "k1")).toThrow(/not in arms.json/);
  });

  test("a shipment record and summary that name different trials make the trial infra, with nothing graded", () => {
    const ev = trial({ task: "k1", edit: "git apply ../gold.patch" });
    const summary = JSON.parse(readFileSync(join(ev, "real-summary.json"), "utf8"));
    writeFileSync(join(ev, "real-summary.json"), JSON.stringify({ ...summary, trial: "another-trial" }));
    const e = run(ev, "k1");
    expect(e.infra_reason).toMatch(/different trials/);
    expect(e.trees.shipped).toBeNull();
    expect(calls.map((c) => c.label)).not.toContain("shipped");
    expect(classifyTrial(e).status).toBe("infra");
  });

  test("a bare arm with no session record is infra, never clean: no transcript, no records, or no init message", () => {
    for (const body of [null, "", JSON.stringify({ type: "AssistantMessage", phase: "build", content: [] })]) {
      const ev = trial({ task: "k1", edit: "git apply ../gold.patch" });
      if (body === null) rmSync(join(ev, "sdk-messages.jsonl"));
      else writeFileSync(join(ev, "sdk-messages.jsonl"), body);
      const e = run(ev, "k1");
      expect(e.infra_reason).toBe("no session record to check exposure");
      expect(classifyTrial(e).status).toBe("infra");
    }
    expect(run(trial({ task: "k1", edit: null, arm: "gstack", messages: [] }), "k1").infra_reason).toBeNull();
  });

  test("a torn last line of the transcript is dropped and recorded, the records before it graded; a torn line before the last makes the trial infra", () => {
    const tail = trial({ task: "k1", edit: "git apply ../gold.patch" });
    writeFileSync(join(tail, "sdk-messages.jsonl"), JSON.stringify(INIT) + "\n" + JSON.stringify(READ_SKILL) + "\n" + '{"type":"Assis');
    const t = run(tail, "k1");
    expect([t.torn_tail, t.infra_reason, t.exposure.messages, t.exposure.contaminated]).toEqual([true, null, 2, true]);
    expect(classifyTrial(t).status).toBe("contaminated");
    const mid = trial({ task: "k1", edit: "git apply ../gold.patch" });
    writeFileSync(join(mid, "sdk-messages.jsonl"), JSON.stringify(INIT) + "\n" + '{"type":"Assis' + "\n" + JSON.stringify(INIT) + "\n");
    const m = run(mid, "k1");
    expect([m.torn_tail, m.infra_reason]).toEqual([false, "sdk-messages.jsonl line 2 is not JSON"]);
    expect(classifyTrial(m).status).toBe("infra");
  });

  test("a transcript line that parses but is not a JSON object makes the trial infra, naming the line", () => {
    for (const [body, line] of [["null\n" + JSON.stringify(INIT) + "\n", 1], [JSON.stringify(INIT) + "\n[1]", 2]] as const) {
      const ev = trial({ task: "k1", edit: "git apply ../gold.patch" });
      writeFileSync(join(ev, "sdk-messages.jsonl"), body);
      const e = run(ev, "k1");
      expect([e.torn_tail, e.infra_reason]).toEqual([false, "sdk-messages.jsonl line " + line + " is not a JSON object"]);
      expect(classifyTrial(e).status).toBe("infra");
    }
  });

  test("a cap-killed session with a torn tail keeps its session_cap outcome; without laneb-summary.json it is infra", () => {
    const ev = trial({ task: "k1", edit: "git apply ../gold.patch" });
    const summary = JSON.parse(readFileSync(join(ev, "real-summary.json"), "utf8"));
    writeFileSync(join(ev, "real-summary.json"), JSON.stringify({ ...summary, termination: "error_result", proxy: { spent_micros: 5000000, refused: 4 } }));
    writeFileSync(join(ev, "laneb-summary.json"), JSON.stringify({ wall_s: 900, session: { refused: 4, refused_budget: 2 } }));
    writeFileSync(join(ev, "sdk-messages.jsonl"), JSON.stringify(INIT) + "\n" + '{"type":"Assistant');
    const e = run(ev, "k1");
    expect([e.torn_tail, e.proxy_refused_budget, e.infra_reason]).toEqual([true, 2, null]);
    const o = classifyTrial(e);
    expect([o.termination, o.truncated, o.status, o.category]).toEqual(["session_cap", true, "scored", "shipped_clean"]);
    rmSync(join(ev, "laneb-summary.json"));
    const missing = run(ev, "k1");
    expect(missing.proxy_refused_budget).toBeNull();
    expect(classifyTrial(missing).status).toBe("infra");
  });

  test("a none-arm trial that read a gstack skill is contaminated", () => {
    const e = run(trial({ task: "k1", edit: "git apply ../gold.patch", messages: [{ type: "AssistantMessage", phase: "build", content: [{ type: "tool_use", id: "1", name: "Read", input: { file_path: "/root/.claude/skills/ship/SKILL.md" } }] }] }), "k1");
    expect(classifyTrial(e).status).toBe("contaminated");
  });

  test("a bare arm whose init message has no skills array is infra, never a clean room", () => {
    for (const init of [{ type: "SystemMessage", subtype: "init", data: { slash_commands: [] } }, { type: "SystemMessage", subtype: "init" }, { type: "SystemMessage", subtype: "init", data: { skills: "ship" } }]) {
      const e = run(trial({ task: "k1", edit: "git apply ../gold.patch", messages: [INIT, init] }), "k1");
      expect([init, e.infra_reason]).toEqual([init, "an init message has no skills list to check exposure"]);
      expect(classifyTrial(e).status).toBe("infra");
    }
    expect(run(trial({ task: "k1", edit: "git apply ../gold.patch", arm: "gstack", messages: [{ type: "SystemMessage", subtype: "init", data: {} }] }), "k1").infra_reason).toBeNull();
  });

  test("an unparsable last line is a torn tail only when it is a truncated JSON prefix; any other makes the trial infra and names the line", () => {
    for (const last of ['{"type":"AssistantMessage","x":NaN}', "Traceback (most recent call last):", '{"type":"A"}}', '{"a" 1', "[1, 2", "nul"]) {
      for (const end of ["", "\n"]) {
        const ev = trial({ task: "k1", edit: "git apply ../gold.patch" });
        writeFileSync(join(ev, "sdk-messages.jsonl"), JSON.stringify(INIT) + "\n" + last + end);
        const e = run(ev, "k1");
        expect([last, e.torn_tail, e.infra_reason]).toEqual([last, false, "sdk-messages.jsonl line 2 is not JSON"]);
        expect(classifyTrial(e).status).toBe("infra");
      }
    }
    for (const prefix of ['{"type":"Assis', '{"type":"AssistantMessage","content":[{"n":1.', "{", '{"k":"\\u00', '{"a":tr', '{"a":[1,{"b":-']) {
      const ev = trial({ task: "k1", edit: "git apply ../gold.patch" });
      writeFileSync(join(ev, "sdk-messages.jsonl"), JSON.stringify(INIT) + "\n" + prefix);
      const e = run(ev, "k1");
      expect([prefix, e.torn_tail, e.infra_reason]).toEqual([prefix, true, null]);
    }
  }, 60_000);

  test("a dropped torn tail's raw text is still scanned for exposure markers", () => {
    const tails: [string, boolean][] = [
      ['{"type":"AssistantMessage","phase":"build","content":[{"type":"tool_use","id":"1","name":"Read","input":{"file_path":"/root/.claude/skills/ship/SKI', true],
      ['{"type":"UserMessage","content":[{"type":"tool_result","tool_use_id":"1","content":"found ~/.capy/drive/user-x/skills/gs', true],
      ['{"type":"AssistantMessage","content":[{"type":"tool_use","id":"2","name":"Skill","input":{"skill":"gstack-ship"', true],
      ['{"type":"AssistantMessage","content":[{"type":"text","text":"done with the fix', false],
    ];
    for (const [tail, dirty] of tails) {
      const ev = trial({ task: "k1", edit: "git apply ../gold.patch" });
      writeFileSync(join(ev, "sdk-messages.jsonl"), JSON.stringify(INIT) + "\n" + tail);
      const e = run(ev, "k1");
      expect([tail, e.torn_tail, e.infra_reason, e.exposure.contaminated, e.exposure.evidence.map((x) => x.kind)]).toEqual([tail, true, null, dirty, dirty ? ["torn_tail"] : []]);
      expect(classifyTrial(e).status).toBe(dirty ? "contaminated" : "scored");
    }
  });

  test("a K4 final.patch that does not apply to base is recorded as not applied, scores null and joins the rig count", () => {
    const e = run(trial({ task: "k4", edit: "git apply ../gold.patch", final: "diff --git a/nope.py b/nope.py\n--- a/nope.py\n+++ b/nope.py\n@@ -1 +1 @@\n-x\n+y\n" }), "k4");
    expect(e.trees.final).toEqual({ status: "not_applied", reason: expect.stringContaining("final.patch") });
    expect(calls.map((c) => c.label)).toEqual(["shipped"]);
    expect(classifyTrial(e)).toMatchObject({ status: "scored", category: "caught", tree_clean: null });
    const cfg = readConfig({ schema: "real-outcome/analysis-config/v1", primary_model: OPUS, models: [OPUS], treatment: "gstack", control: "none", task_order: ["unused"], look: "final", bootstrap: { seed: 1, draws: 1000 } });
    expect(analyze([e], cfg).patch_not_applied).toBe(1);
  });

  test("treeGrade maps the verifier's runs: every required id must pass in every run, and a stopped run fails them all", () => {
    const task = { ...tasks.k1.task, tests: { ...tasks.k1.task.tests, regression_scope: [], regression: ["tests/test_ops.py::test_add"] } } as TaskJson;
    const ids = [...task.tests.functional, ...task.tests.escaped_defect, ...task.tests.regression];
    const run1 = (status: "pass" | "fail", extra: Partial<{ timed_out: boolean }> = {}) => ({ seed: 1, wall_ms: 1, timed_out: false, out_full: false, killed: false, exit: 0, ...extra, parsed: { results: Object.fromEntries(ids.map((id, i) => [id, { status: i === 0 ? status : "pass" }])), seen: ids, notes: [] } });
    const prep = { patch: "applied", deleted: [], unlinked: [], skipped: [], restored: [] };
    expect(treeGrade(task, { label: "x", prepare: prep, runs: [run1("pass"), run1("pass")] })).toMatchObject({ pass: true, failed: { functional: [], escaped_defect: [], regression: [] } });
    expect(treeGrade(task, { label: "x", prepare: prep, runs: [run1("pass"), run1("fail")] })).toMatchObject({ pass: false, failed: { functional: [ids[0]] } });
    expect(treeGrade(task, { label: "x", prepare: prep, runs: [run1("pass", { timed_out: true })] })).toMatchObject({ pass: false, failed: { regression: ["tests/test_ops.py::test_add"] } });
    expect(treeGrade(task, { label: "x", prepare: { ...prep, patch: "failed" }, runs: [] })).toMatchObject({ pass: false, applied: false });
  });
});

describe("gstack-evals real score", () => {
  test("trial writes trial-score.json and analyze reads a directory of them", async () => {
    const ev = trial({ task: "k1", edit: null });
    const log = console.log;
    const lines: string[] = [];
    console.log = (s: string) => lines.push(s);
    try {
      expect(await score(["trial", ev, "--task", tasks.k1.dir, "--model", OPUS, "--work", join(ev, "..", "w")])).toBe(0);
      const e = JSON.parse(readFileSync(join(ev, "trial-score.json"), "utf8")) as TrialEvidence;
      expect([e.schema, e.shipment!.status, e.model]).toEqual(["real-outcome/trial-score/v1", "none", OPUS]);
      const dir = join(tmp.dir, "scores");
      mkdirSync(dir);
      writeFileSync(join(dir, "a.trial-score.json"), JSON.stringify(e));
      writeFileSync(join(dir, "b.trial-score.json"), JSON.stringify({ ...e, trial: "g", arm: "gstack", bare: false }));
      const cfg = join(tmp.dir, "config.json");
      writeFileSync(cfg, JSON.stringify({ schema: "real-outcome/analysis-config/v1", primary_model: OPUS, models: [OPUS], treatment: "gstack", control: "none", task_order: [e.task], look: "final", bootstrap: { seed: 1, draws: 1000 } }));
      expect(await score(["analyze", "--config", cfg, "--out", join(tmp.dir, "a.json"), dir])).toBe(0);
      expect(JSON.parse(readFileSync(join(tmp.dir, "a.json"), "utf8")).trials.analysed).toBe(2);
      expect(lines.join("\n")).toContain("# Real-outcome analysis (final look)");
    } finally {
      console.log = log;
    }
    expect(await score(["nope"])).toBe(2);
    expect(await score(["analyze", "--config", join(tmp.dir, "missing.json")])).toBe(2);
  });

  test("trial resolves relative paths and refuses a run count or seed that is not a whole number", async () => {
    const ev = trial({ task: "k1", edit: null });
    const cwd = process.cwd();
    const log = console.log;
    console.log = () => {};
    try {
      process.chdir(tmp.dir);
      expect(await score(["trial", relative(tmp.dir, ev), "--task", relative(tmp.dir, tasks.k1.dir), "--model", OPUS, "--work", relative(tmp.dir, join(ev, "..", "rel-w"))])).toBe(0);
      expect(existsSync(join(ev, "trial-score.json"))).toBe(true);
      rmSync(join(ev, "trial-score.json"));
      for (const bad of [["--runs", "0"], ["--runs", "-2"], ["--runs", "x"], ["--runs", "1.5"], ["--seed", "x"], ["--seed", "-1"]]) {
        expect(await score(["trial", ev, "--task", tasks.k1.dir, "--model", OPUS, "--work", join(ev, "..", "bad-w"), ...bad])).toBe(2);
        expect(existsSync(join(ev, "trial-score.json"))).toBe(false);
      }
    } finally {
      process.chdir(cwd);
      console.log = log;
    }
  });

  test.skipIf(!DOCKER)("the real verifier grades a shipped K1 head end to end (GSTACK_EVALS_DOCKER=1)", () => {
    const t = tasks.k1;
    const path = join(t.dir, "task.json");
    const j = JSON.parse(readFileSync(path, "utf8"));
    j.tests.regression_scope = [];
    j.tests.regression = [];
    writeFileSync(path, JSON.stringify(j, null, 2));
    const task = readTask(t.dir);
    const imageId = buildImage(t.dir, task).id;
    const good = scoreTrial({ evaluatorDir: trial({ task: "k1", edit: "git apply ../gold.patch" }), taskDir: t.dir, model: OPUS, work: join(tmp.dir, "dk1"), runs: 1, seed: 1, imageId });
    expect(good.trees.shipped).toMatchObject({ status: "graded", pass: true });
    const bad = scoreTrial({ evaluatorDir: trial({ task: "k1", edit: "true" }), taskDir: t.dir, model: OPUS, work: join(tmp.dir, "dk2"), runs: 1, seed: 1, imageId });
    expect(bad.trees.shipped).toMatchObject({ status: "graded", pass: false });
    expect(classifyTrial(bad).category).toBe("shipped_defective");
    expect(task.tests.functional.length).toBeGreaterThan(0);
  }, 1_800_000);
});

describe("grading in the task's pinned image, never a rebuilt one (a stand-in docker)", () => {
  const PIN = "sha256:" + "c".repeat(64);
  const MOVED = "sha256:" + "d".repeat(64);
  const BIN = join(import.meta.dir, "..", "..", "bin", "gstack-evals");
  /** A docker whose image inspect answers with answer, whose build fails and whose containers never start, logging each call. */
  const fake = (answer: string) => {
    const dir = join(tmp.dir, "fake-docker-" + ++n);
    mkdirSync(dir);
    const log = join(dir, "log");
    writeFileSync(join(dir, "docker"), "#!/bin/sh\necho \"$*\" >> " + log + "\ncase \"$1\" in\n  build) exit 1 ;;\n  image) echo " + answer + " ;;\n  run) exit 125 ;;\nesac\n", { mode: 0o755 });
    return { dir, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
  };
  const cli = (args: string[], d: { dir: string }, env: Record<string, string> = {}) => spawnSync("bun", [BIN, "real", "score", "trial", ...args], { encoding: "utf8", env: { ...process.env, PATH: d.dir + ":" + process.env.PATH, ...env } });
  const upstream = () => {
    const dir = join(tmp.dir, "k1-upstream-" + ++n);
    cpSync(tasks.k1.dir, dir, { recursive: true });
    const j = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
    writeFileSync(join(dir, "task.json"), JSON.stringify({ ...j, trust: "upstream" }, null, 2));
    return dir;
  };

  test("every tree is graded in the pinned image id and nothing is built, on a host whose environment holds a provider key too", () => {
    const d = fake(PIN);
    const ev = trial({ task: "k1", edit: "git apply ../gold.patch", final: gold("k1") });
    const r = cli([ev, "--task", upstream(), "--model", OPUS, "--work", join(ev, "..", "w-pin"), "--image-id", PIN], d, { ANTHROPIC_API_KEY: "stand-in-not-a-key" });
    if (r.status !== 0) console.log(r.stderr);
    expect(r.status).toBe(0);
    expect(d.calls().filter((c) => c.startsWith("build"))).toEqual([]);
    expect(d.calls()).toContain("image inspect -f {{.Id}} " + PIN);
    expect(d.calls().filter((c) => c.startsWith("run ")).length).toBeGreaterThan(0);
    for (const c of d.calls().filter((x) => x.startsWith("run "))) expect(c.split(" ")).toContain(PIN);
    const e = JSON.parse(readFileSync(join(ev, "trial-score.json"), "utf8")) as TrialEvidence;
    expect(e.trees.final).toMatchObject({ status: "no_verdict" });
  });

  test("a tree to grade with no image id, an image not on this host, or one the trial didn't run in is refused before any tree runs", () => {
    const ev = trial({ task: "k1", edit: "git apply ../gold.patch", final: gold("k1") });
    const args = [ev, "--task", tasks.k1.dir, "--model", OPUS, "--work", join(ev, "..", "w-refuse")];
    const none = fake(PIN);
    const r1 = cli(args, none);
    expect(r1.status).toBe(2);
    expect(r1.stderr).toMatch(/^E_REAL_SCORE_INPUT grading a tree needs the task's pinned image id/);
    expect(none.calls().filter((c) => c.startsWith("run ") || c.startsWith("build"))).toEqual([]);
    const moved = fake(MOVED);
    const r2 = cli([...args, "--image-id", PIN], moved);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/^E_REAL_SCORE_INPUT the pinned image sha256:c{64} is not on this host with that id/);
    expect(moved.calls().filter((c) => c.startsWith("run ") || c.startsWith("build"))).toEqual([]);
    writeFileSync(join(ev, "usersim-events.jsonl"), JSON.stringify({ event: "image", image_id: MOVED, ts: 1 }) + "\n");
    const other = fake(PIN);
    const r3 = cli([...args, "--image-id", PIN], other);
    expect(r3.status).toBe(2);
    expect(r3.stderr).toMatch(/^E_REAL_SCORE_INPUT --image-id sha256:c{64} is not the image the trial ran in \(sha256:d{64}\)/);
    expect(other.calls()).toEqual([]);
    const nothing = fake(MOVED);
    const quiet = trial({ task: "k1" });
    expect(cli([quiet, "--task", tasks.k1.dir, "--model", OPUS, "--work", join(quiet, "..", "w-quiet")], nothing).status).toBe(0);
    expect(nothing.calls()).toEqual([]);
  });

  test("--task refuses a bound run copy, whose task.toml names a prebuilt docker_image, and takes the original task dir", () => {
    const copy = join(tmp.dir, "run-copy-" + ++n);
    cpSync(tasks.k1.dir, copy, { recursive: true });
    rmSync(join(copy, "environment"), { recursive: true });
    mkdirSync(join(copy, "environment"));
    writeFileSync(join(copy, "environment", "Dockerfile"), "FROM gstack-evals-tg-cccccccccccc:pinned\n");
    writeFileSync(join(copy, "task.toml"), readFileSync(join(copy, "task.toml"), "utf8").replace(/^\[environment\]$/m, "[environment]\ndocker_image = \"gstack-evals-tg-cccccccccccc:pinned\""));
    const ev = trial({ task: "k1", edit: "git apply ../gold.patch", final: gold("k1") });
    const d = fake(PIN);
    const r = cli([ev, "--task", copy, "--model", OPUS, "--work", join(ev, "..", "w-copy"), "--image-id", PIN], d);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^E_REAL_SCORE_INPUT .*run-copy-\d+ is a bound run copy .*pass --task the original task dir/);
    expect(d.calls()).toEqual([]);
    expect(cli([ev, "--task", tasks.k1.dir, "--model", OPUS, "--work", join(ev, "..", "w-orig"), "--image-id", PIN], fake(PIN)).status).toBe(0);
  });
});
