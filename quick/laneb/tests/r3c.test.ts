import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armSpec, CLOSING_LINES, jobConfig } from "../runner/grid.ts";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";
import { itemCheck, OPUS } from "../r3/screen.ts";
import { R3C, calibrationPlan, f2pShare, goldFiles, type tiers } from "../r3/r3c-rules.ts";
import { cal1Split, calProjection, CLOSING, cliStream, d1Min, gridOrder, gridOutcome, gridProjection, gridSizes, ITEM, loadOracle, loadTrials, partCheck, partStop, passStatus, perTrialJob, planOf, preparePart, R3C_NONE, R3C_TOLD, readClosing, RUN, startRule, testRecord, trialF2p, type R3cTrial } from "../r3/r3c.ts";
import { loadRebenchPool, R3A4_POOL_FILE, R3A4_POOL_SHA256 } from "../runner/materialize.ts";

const laneb = join(import.meta.dir, "..");
const repo = join(laneb, "../..");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const fixtures = join(import.meta.dir, "fixtures/r3c");
const capture = () => readdirSync(fixtures).filter((f) => f.endsWith(".jsonl")).sort();
const lines = (f: string) => readFileSync(join(fixtures, f), "utf8").split("\n");

// Tiers shaped like the frozen candidates: 201 tasks, 438 cal-1 trials, 110 t4 tasks (a worst-case cal-2 of 440 trials).
const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => p + "__task-" + String(i).padStart(3, "0"));
const tr = { t1: ids("t1", 20), t2: ids("t2", 16), t3: ids("t3", 55), t4: ids("t4", 110), floor: [], out: [] } as unknown as ReturnType<typeof tiers>;

let seq = 0;
type T = { task: string; arm: "none" | "gstack"; pass?: boolean; infra?: boolean; spent?: number | null; closing?: string[] | null; closingError?: string | null; f2p?: number | null };
function rt(t: T): R3cTrial {
  const told = t.arm === "gstack";
  return {
    task: t.task, arm: t.arm, model: OPUS, route: null, upstream_model: null, trial: t.task + "-" + seq++, outcome: t.infra ? "infra" : t.pass ? "pass" : "fail", reason: "", reward: t.infra ? null : t.pass ? 1 : 0,
    model_responded: !t.infra, exception: null, cap_stop: false, cost_usd: t.spent === undefined ? 1 : t.spent, attempts: 1, requests: 1, refused: 0, budget_stop: false, agent_timeout: false, wall_s: null,
    told_skill: told ? "investigate" : null, cmd_expanded: told, cmd_names: told ? ["investigate"] : [], skill_opens: [], body_loaded: told, investigate_opened: told, gate: { debug_report: told, phase: false },
    procedure_shown: told, exposed: told, phase_headings: 0,
    hooks: { files: 0, stop_hook_ran: false, held_back: false, outcome: null, route_hook_ran: false, routed: false, contract_events: {}, route_events: {} }, repo_skills: [], non_gstack_skill_calls: 0,
    part: "grid-1", closing: t.closingError ? null : t.closing === undefined ? ["src/core.py"] : t.closing, closing_error: t.closingError ?? null, tests: null, f2p_share: t.f2p === undefined ? null : t.f2p,
  };
}
// 12 tasks x 3 replicates x {none, told}; f gives each trial's fields from the task's index, the replicate and the arm.
const tasks12 = ids("g", 12);
const grid = (f: (i: number, rep: number, arm: "none" | "gstack") => Partial<T>) => tasks12.flatMap((task, i) => [0, 1, 2].flatMap((rep) => (["none", "gstack"] as const).map((arm) => rt({ task, arm, ...f(i, rep, arm) }))));
const adm = { n: 12, R: 3, mdd: 10, mddSplit: 14, beta: { mdd: 11, nullSize: 0.04 } };
const gold = new Map(tasks12.map((t) => [t, ["src/core.py"]]));
const outcome = (g: R3cTrial[]) => gridOutcome(g, adm, { sims: 2, gold, dist: new Map() });

describe("the closing line", () => {
  test("grid.ts CLOSING_LINES, prompt_builder.py CLOSING_LINES and r3c-rules.ts R3C.closingLine are one text, byte for byte", () => {
    const py = Bun.spawnSync(["python3", "-c", "import json, prompt_builder as p; print(json.dumps(p.CLOSING_LINES))"], { env: { ...process.env, PYTHONPATH: join(laneb, "runner/agent") } });
    expect(py.exitCode).toBe(0);
    const fromPy = JSON.parse(py.stdout.toString());
    expect(Object.keys(fromPy)).toEqual([CLOSING]);
    expect(Object.keys(CLOSING_LINES)).toEqual([CLOSING]);
    expect(Buffer.from(fromPy[CLOSING]).equals(Buffer.from(CLOSING_LINES[CLOSING]))).toBe(true);
    expect(Buffer.from(R3C.closingLine).equals(Buffer.from(CLOSING_LINES[CLOSING]))).toBe(true);
  });

  test("every arm's prompt ends with the closing line after a blank line, after the told arm's procedure line", () => {
    const code = [
      "import json, prompt_builder as p",
      "w = 'Task:\\n{instruction}\\n'",
      "print(json.dumps([p.build_prompt(w, 'fix it', False, '', closing_line='r3c-root-cause-files'), p.build_prompt(w, 'fix it', True, 'investigate', procedure_line='investigate-phases', closing_line='r3c-root-cause-files'), p.build_prompt(w, 'fix it', False, '')]))",
    ].join("\n");
    const py = Bun.spawnSync(["python3", "-c", code], { env: { ...process.env, PYTHONPATH: join(laneb, "runner/agent") } });
    expect(py.exitCode).toBe(0);
    const [none, told, plain] = JSON.parse(py.stdout.toString());
    expect(none).toBe("Task:\nfix it\n\n" + R3C.closingLine + "\n");
    expect(told).toBe("/investigate Task:\nfix it\n\nWork through /investigate's phases in order, and finish with its DEBUG REPORT.\n\n" + R3C.closingLine + "\n");
    expect(plain).toBe("Task:\nfix it\n");
  });

  test("R3c's arms carry closing_line into the job's agent kwargs; an unknown closing line is refused", () => {
    expect(armSpec(R3C_NONE)).toEqual({ name: "none", system_prompt: "claude-code-preset", closing_line: CLOSING });
    expect(armSpec(R3C_TOLD)).toMatchObject({ name: "gstack", told: "investigate", procedure_line: "investigate-phases", gstack_hooks: "copy", closing_line: CLOSING });
    expect(() => armSpec("none:closing_line=other")).toThrow("E_USAGE");
    const job = jobConfig({ job_name: "j", tasks_dir: "/t", tasks: ["a"], models: [{ id: OPUS, max_budget_usd: 12 }], arms: [{ ...armSpec(R3C_NONE), tar: "/x/none.tar", sha256: "0".repeat(64) }], attempts: 1, n_concurrent: 1, agent_dir: "/a", runner_dir: "/r", base_url: "http://x:8787" } as any);
    expect(job.agents[0].kwargs.closing_line).toBe(CLOSING);
  });

  test("r3c-rules.ts is the post's r3c.ts.txt with only its import lines and PIN changed", () => {
    const post = readFileSync(join(repo, "wiki/plans/2026-11-05-geva-284-r3c-calibrated/r3c.ts.txt"), "utf8").split("\n");
    const ours = readFileSync(join(laneb, "r3/r3c-rules.ts"), "utf8").split("\n");
    expect(ours.length).toBe(post.length);
    const changed = ours.map((l, i) => (l === post[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toEqual([25, 26, 27, 28]);
    for (const i of changed) expect(ours[i]!).toMatch(/^(import \{ [\w, ]+ \} from "\.\.\/(analysis|runner)\/\w+\.ts";|const PIN = join\(import\.meta\.dir, "\.\.\/\.\.\/\.\."\);|)$/);
    for (const i of changed) expect(post[i]!).toMatch(/PIN/);
  });
});

describe("the closing block reader on a real capture", () => {
  test("the capture holds both arms' trials, made through Claude Code and the Agent SDK, with parent_tool_use_id on every assistant record", () => {
    for (const f of capture()) {
      const recs = lines(f).filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => r.type === "AssistantMessage");
      expect(recs.length).toBeGreaterThan(0);
      expect(recs.every((r) => "parent_tool_use_id" in r)).toBe(true);
      expect(recs.some((r) => r.parent_tool_use_id)).toBe(true);
    }
  });

  test("readClosing takes calc.py from the main thread's last block, never the thinking block's or the subagent's file", () => {
    expect(capture()).toEqual(["demo__met-gstack.jsonl", "demo__met-none.jsonl", "demo__nomain-gstack.jsonl", "demo__nomain-none.jsonl", "demo__unmet-gstack.jsonl", "demo__unmet-none.jsonl"]);
    for (const f of capture()) {
      const text = lines(f).join("\n");
      expect(text).toContain("wrong_thinking.py");
      expect(text).toContain("wrong_subagent.py");
      expect(readClosing(lines(f))).toEqual({ block: f.startsWith("demo__nomain") ? [] : ["calc.py"], error: null });
    }
  });

  test("in each arm, a block only in a thinking block or a subagent message is not read: an empty block, a miss, not an error", () => {
    for (const f of ["demo__nomain-none.jsonl", "demo__nomain-gstack.jsonl"]) expect(readClosing(lines(f))).toEqual({ block: [], error: null });
  });

  test("a log from before parent_tool_use_id was captured is E_TRANSCRIPT_UNREADABLE, never a miss", () => {
    for (const f of capture()) {
      const old = lines(f).map((l) => { if (!l.trim()) return l; const r = JSON.parse(l); delete r.parent_tool_use_id; return JSON.stringify(r); });
      const c = readClosing(old);
      expect(c.block).toBeNull();
      expect(c.error).toStartWith("E_TRANSCRIPT_UNREADABLE");
    }
  });

  test("an unparseable line is unreadable unless it is a torn last line; a log with no main-thread text is unreadable", () => {
    const f = lines(capture()[0]!).filter((l) => l.trim());
    expect(readClosing([...f, "{\"type\": \"Assist"]).block).toEqual(["calc.py"]);
    expect(readClosing([f[0]!, "not json", ...f.slice(1)]).error).toStartWith("E_TRANSCRIPT_UNREADABLE line 2");
    const sub = f.filter((l) => { const r = JSON.parse(l); return r.type !== "AssistantMessage" || r.parent_tool_use_id; });
    expect(readClosing(sub).error).toBe("E_TRANSCRIPT_UNREADABLE no main-thread assistant text block");
    expect(readClosing([]).error).toBe("E_TRANSCRIPT_UNREADABLE no main-thread assistant text block");
  });

  test("cliStream maps the SDK's logged blocks to the stream mainText reads", () => {
    const s = cliStream([JSON.stringify({ type: "AssistantMessage", parent_tool_use_id: null, content: [{ thinking: "x", signature: "s" }, { text: "hi" }, { id: "t", name: "Bash", input: {} }] }), JSON.stringify({ type: "UserMessage", content: "u" })]);
    expect(s).toEqual([{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "hi" }, { type: "tool_use", name: "Bash" }] } }]);
  });
});

describe("per-test verifier output", () => {
  test("testRecord reads the parser's report.json from the trial's verifier/ directory, and a trial without one is null", () => {
    const d = tmp("r3c-trial-");
    expect(testRecord(d)).toBeNull();
    mkdirSync(join(d, "verifier"));
    writeFileSync(join(d, "verifier/report.json"), JSON.stringify({ fail_to_pass: { a: "PASSED", b: "XFAIL", c: "NOT_FOUND" }, pass_to_pass: { p: "PASSED" }, resolved: false }));
    const rec = testRecord(d);
    expect(rec).toEqual({ f2p: { a: "PASSED", b: "XFAIL", c: "NOT_FOUND" }, p2p: { p: "PASSED" } });
    expect(passStatus(rec)).toEqual({ p: "pass", a: "pass", b: "pass", c: "NOT_FOUND" });
    expect(trialF2p(rec, { f2p: ["a", "b", "c"], p2p: ["p"] })).toBeCloseTo(2 / 3);
    expect(trialF2p(rec, { f2p: ["a"], p2p: ["p", "q"] })).toBe(0);
    expect(trialF2p(null, { f2p: ["a"], p2p: [] })).toBe(0);
    expect(trialF2p(rec, { f2p: [], p2p: ["p"] })).toBeNull();
    expect(f2pShare({ a: "pass" }, ["a"], [])).toBe(1);
  });

  test("the oracle gate's patch is read where Harbor keeps the container's /logs/artifacts/, as the capture's oracle trials show", () => {
    const part = tmp("r3c-part-"), d = join(part, "pulled/jobs/r3c-opus-cal-1a-oracle/demo__met__abc");
    mkdirSync(join(d, "artifacts/logs/artifacts"), { recursive: true });
    mkdirSync(join(d, "verifier"), { recursive: true });
    mkdirSync(join(part, "tasks/demo__met/tests"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: "/run/tasks/demo__met" } }));
    writeFileSync(join(d, "artifacts/logs/artifacts/model.patch"), "diff --git a/calc.py b/calc.py\n--- a/calc.py\n+++ b/calc.py\ndiff --git a/tests/test_calc.py b/tests/test_calc.py\n");
    writeFileSync(join(d, "verifier/report.json"), JSON.stringify({ fail_to_pass: { f: "PASSED" }, pass_to_pass: { p: "PASSED" } }));
    writeFileSync(join(part, "tasks/demo__met/tests/config.json"), JSON.stringify({ FAIL_TO_PASS: ["f"], PASS_TO_PASS: ["p"] }));
    const o = loadOracle(part);
    expect(o).toHaveLength(1);
    expect(o[0]!.task).toBe("demo__met");
    expect(goldFiles(o[0]!.patch!)).toEqual(["calc.py"]);
    expect(o[0]!.f2p_share).toBe(1);
  });
});

describe("the plan", () => {
  test("cal-1's 438 trials, in a seed 20261112 shuffle, cut into three parts of 146", () => {
    expect(calibrationPlan(tr).cal1Trials).toBe(438);
    const a = cal1Split(tr), b = cal1Split(tr);
    expect(a.slots).toEqual(b.slots);
    expect(a.parts.map((p) => [p.name, p.slots.length])).toEqual([["cal-1a", 146], ["cal-1b", 146], ["cal-1c", 146]]);
    expect(a.parts.flatMap((p) => p.slots)).toEqual(a.slots);
    const count = (t: string) => a.slots.filter((s) => s === t).length;
    expect([count(tr.t1[0]!), count(tr.t2[0]!), count(tr.t3[0]!), count(tr.t4[0]!)]).toEqual([3, 3, 4, 1]);
    const plain = calibrationPlan(tr).cal1.flatMap((x) => Array.from({ length: x.trials }, () => x.task));
    expect(a.slots).not.toEqual(plain);
    expect([...a.slots].sort()).toEqual([...plain].sort());
  });

  test("grid parts hold 4 replicates, the last the remainder, each in a seed 20261113 shuffle of its task, arm and replicate slots", () => {
    expect(gridSizes(10)).toEqual([4, 4, 2]);
    expect(gridSizes(8)).toEqual([4, 4]);
    expect(gridSizes(3)).toEqual([3]);
    const o = gridOrder(["b", "a"], 2);
    expect(o).toEqual(gridOrder(["a", "b"], 2));
    expect(o).toHaveLength(8);
    expect([...o].map((x) => x.join("/")).sort()).toEqual(["a/gstack", "a/gstack", "a/none", "a/none", "b/gstack", "b/gstack", "b/none", "b/none"]);
    const big = gridOrder(tasks12, 4);
    expect(big.slice(0, 4)).not.toEqual([[tasks12[0], "none"], [tasks12[0], "gstack"], [tasks12[0], "none"], [tasks12[0], "gstack"]]);
  });

  test("a one-replicate last grid part (R=5) keeps each task once in its job; only cal-1 parts list a task once per trial", () => {
    const w = tmp("r3c-r5-");
    writeFileSync(join(w, "grid.json"), JSON.stringify({ R: 5, list: ["b", "a"] }));
    const g2 = planOf(w, tr, "grid-2")!;
    expect([g2.attempts, g2.arms.length]).toEqual([1, 2]);
    expect(perTrialJob(g2)).toBe(false);
    expect(perTrialJob(planOf(w, tr, "grid-1")!)).toBe(false);
    expect(perTrialJob(planOf(w, tr, "cal-1a")!)).toBe(true);
  });
});

describe("a prepare that fails partway", () => {
  const poolTask = loadRebenchPool(join(import.meta.dir, "..", R3A4_POOL_FILE), R3A4_POOL_SHA256)[0]!.task_id;
  const failing = (ledgerRows: object[]) => {
    const w = tmp("r3c-prep-"), ledger = join(w, "r3c-opus.jsonl");
    writeFileSync(ledger, ledgerRows.map((r) => JSON.stringify(r) + "\n").join(""));
    const saved = { ARMS: process.env.ARMS, SWEREBENCH: process.env.SWEREBENCH, LEDGER: process.env.LEDGER };
    Object.assign(process.env, { ARMS: tmp("r3c-arms-"), SWEREBENCH: tmp("r3c-noexport-"), LEDGER: ledger });
    const p = { name: "cal-2", tasks: [poolTask], attempts: R3C.t4Second, arms: [R3C_NONE], order: null, counts: new Map() };
    let err = "";
    try { preparePart(w, p); } catch (e) { err = String(e); } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return { w, err };
  };
  const approval = { ts: "2026-11-05T00:00:00Z", item: RUN.item, kind: "approval", id: "approval", usd_micros: toMicros(RUN.capUsd) };

  test("with no ledger row for the part, the half-built part directory is removed, so planCheck can report it unlaunched", () => {
    const { w, err } = failing([approval]);
    expect(err).toContain("prepare-run for cal-2 exited");
    expect(existsSync(join(w, "cal-2"))).toBe(false);
  });

  test("with a ledger row for the part, the directory stays and the error is for the Captain", () => {
    const { w, err } = failing([approval, { ts: "2026-11-05T00:01:00Z", item: RUN.item, kind: "reserve", id: RUN.item + "-cal-2/vm", usd_micros: 1 }]);
    expect(existsSync(join(w, "cal-2"))).toBe(true);
    expect(err).toContain("Captain");
  });

  test("a part directory that existed before the call is never removed", () => {
    const w = tmp("r3c-prep-"), dir = join(w, "cal-2");
    mkdirSync(dir);
    writeFileSync(join(dir, "marker"), "");
    const saved = process.env.ARMS;
    process.env.ARMS = tmp("r3c-arms-");
    try { expect(() => preparePart(w, { name: "cal-2", tasks: [poolTask], attempts: R3C.t4Second, arms: [R3C_NONE], order: null, counts: new Map() })).toThrow(); } finally { if (saved === undefined) delete process.env.ARMS; else process.env.ARMS = saved; }
    expect(existsSync(join(dir, "marker"))).toBe(true);
  });
});

describe("one controller at a time", () => {
  const grid = (w: string) => Bun.spawnSync([process.execPath, join(laneb, "r3/r3c.ts"), "grid", w, "--item", RUN.item], { env: { ...process.env, LEDGER: join(w, "r3c-opus.jsonl") } });
  const refuses = (pid: number) => {
    const w = tmp("r3c-lock-"), lock = join(w, ".controller.lock");
    writeFileSync(lock, JSON.stringify({ pid, cmd: "grid" }) + "\n");
    const r = grid(w);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("rm " + lock);
    expect(readFileSync(lock, "utf8")).toBe(JSON.stringify({ pid, cmd: "grid" }) + "\n");
  };

  test("a lock held by a live controller refuses grid and stays", () => refuses(process.pid));

  test("a lock left by a dead controller refuses too and is never taken over", () => refuses(2147483646));

  test("a controller removes its own lock when it ends", () => {
    const w = tmp("r3c-lock-"), r = grid(w);
    expect(r.stderr.toString()).toContain("is not bound to a run");
    expect(existsSync(join(w, ".controller.lock"))).toBe(false);
  });
});

describe("a task config without its test lists", () => {
  const badTask = (part: string) => {
    mkdirSync(join(part, "tasks/demo__met/tests"), { recursive: true });
    writeFileSync(join(part, "tasks/demo__met/tests/config.json"), JSON.stringify({ FAIL_TO_PASS: "f" }));
  };

  test("partCheck refuses it before bind", () => {
    const w = tmp("r3c-cfg-"), dir = join(w, "cal-2");
    badTask(dir);
    writeFileSync(join(dir, "oracle.json"), "{}");
    expect(() => partCheck(w, { name: "cal-2", tasks: ["demo__met"], attempts: R3C.t4Second, arms: [R3C_NONE], order: null, counts: new Map() })).toThrow("has no FAIL_TO_PASS and PASS_TO_PASS lists");
  });

  test("the oracle's f2p share is null for it, not a throw", () => {
    const part = tmp("r3c-part-"), d = join(part, "pulled/jobs/r3c-opus-cal-1a-oracle/demo__met__abc");
    mkdirSync(join(d, "verifier"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: "/run/tasks/demo__met" } }));
    writeFileSync(join(d, "verifier/report.json"), JSON.stringify({ fail_to_pass: { f: "PASSED" }, pass_to_pass: {} }));
    badTask(part);
    const o = loadOracle(part);
    expect(o).toHaveLength(1);
    expect(o[0]!.f2p_share).toBeNull();
  });

  test("a trial's f2p share is null for it, not a throw", () => {
    const part = tmp("r3c-part-"), d = join(part, "pulled/jobs/r3c-opus-cal-2/demo__met__abc");
    mkdirSync(join(d, "verifier"), { recursive: true });
    writeFileSync(join(part, "proxy.json"), JSON.stringify({ models: {} }));
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: R3C_NONE } }, task: { path: "/run/tasks/demo__met" } }));
    writeFileSync(join(d, "verifier/report.json"), JSON.stringify({ fail_to_pass: { f: "PASSED" }, pass_to_pass: {} }));
    badTask(part);
    const t = loadTrials("cal-2", part);
    expect(t).toHaveLength(1);
    expect(t[0]!.f2p_share).toBeNull();
  });
});

describe("the item, the parts and the infra rule", () => {
  test("r3c-opus binds only at amendment 6's $750 on its first approval row, on ledger port 9917", () => {
    const at = (cap: number) => { const p = join(tmp("r3c-item-"), "l.jsonl"); new Ledger(p, RUN.item).approve(cap, { words: "test", by: "test" }); return p; };
    expect(() => itemCheck(at(750), ITEM)).not.toThrow();
    expect(() => itemCheck(at(700), ITEM)).toThrow("r3c-opus's cap is $700, not amendment 6's $750");
    expect([ITEM.capUsd, ITEM.ledgerPort, ITEM.item]).toEqual([750, "9917", "r3c-opus"]);
  });

  test("cal-2 runs 4 attempts of each planned t4 task in Harbor's order; grid parts run the admitted list in their shuffled order", () => {
    const w = tmp("r3c-work-");
    expect(planOf(w, tr, "cal-2")).toBeNull();
    writeFileSync(join(w, "cal2.json"), JSON.stringify({ tasks: [tr.t4[3], tr.t4[7]] }));
    const c2 = planOf(w, tr, "cal-2")!;
    expect([c2.attempts, c2.arms, c2.order, c2.tasks]).toEqual([4, ["none"], null, [tr.t4[3], tr.t4[7]]]);
    expect([...c2.counts.values()]).toEqual([4, 4]);
    writeFileSync(join(w, "grid.json"), JSON.stringify({ R: 10, list: ["b", "a"] }));
    const g3 = planOf(w, tr, "grid-3")!;
    expect([g3.attempts, g3.arms, g3.tasks, g3.order]).toEqual([2, ["none", "gstack"], ["a", "b"], gridOrder(["a", "b"], 2)]);
    expect(planOf(w, tr, "grid-4")).toBeNull();
    const c1 = planOf(w, tr, "cal-1b")!;
    expect([c1.attempts, c1.order!.length, c1.arms]).toEqual([1, 146, ["none"]]);
  });

  test("D1's sensitivity set needs ceil(3n/7) tasks", () => {
    expect([d1Min(10), d1Min(12), d1Min(14), d1Min(40)]).toEqual([5, 6, 6, 18]);
  });

  // A pulled cal-1a: every planned trial, its launch exit and its harbor.log order line.
  function pulled() {
    const w = tmp("r3c-part-"), p = planOf(w, tr, "cal-1a")!;
    mkdirSync(join(w, "cal-1a/pulled/out"), { recursive: true });
    mkdirSync(join(w, "cal-1a/pulled/jobs"), { recursive: true });
    writeFileSync(join(w, "cal-1a.launch-exit"), "0\n");
    writeFileSync(join(w, "cal-1a/pulled/out/harbor.log"), "laneb order: applied 146 trials from order.json\n");
    return { w, p, trials: p.order!.map(([task]) => rt({ task, arm: "none" })) };
  }
  test("a part is complete with every planned trial and at most 10% infra; 15 of 146 is incomplete", () => {
    const x = pulled();
    expect(partStop(x.w, x.p, x.trials)).toBeNull();
    const infra = (n: number) => x.trials.map((t, k) => (k < n ? { ...t, outcome: "infra" as const } : t));
    expect(partStop(x.w, x.p, infra(14))).toBeNull();
    expect(partStop(x.w, x.p, infra(15))).toEqual({ reason: "cal-1a: 15 of 146 trials are infra, over 10%", cost: false });
  });
  test("a missing trial, a trial outside the plan, or no order line in harbor.log makes the part incomplete; a projection stop is a cost stop", () => {
    const x = pulled();
    expect(partStop(x.w, x.p, x.trials.slice(1))!.reason).toContain("have a trial count other than the plan's");
    expect(partStop(x.w, x.p, [...x.trials, rt({ task: "elsewhere", arm: "none" })])!.reason).toContain("1 trials outside the plan");
    writeFileSync(join(x.w, "cal-1a/pulled/out/harbor.log"), "no order\n");
    expect(partStop(x.w, x.p, x.trials)!.reason).toContain("no 'laneb order: applied 146 trials' line");
    writeFileSync(join(x.w, "cal-1a.projection-stop"), JSON.stringify({ line: "before cal-1a: projection passes", approvals: 1 }));
    expect(partStop(x.w, x.p, x.trials)).toEqual({ reason: "cal-1a was not launched: before cal-1a: projection passes", cost: true });
  });
});

describe("the start rule and the projections", () => {
  test("the start rule counts cal-1 and a worst-case cal-2 of 440 trials at R3b's none cost and VM hours, plus $79.20", () => {
    const s = startRule(tr, 750);
    expect(s.trials).toBe(878);
    expect(s.usd).toBeCloseTo(878 * (0.43 + 0.6 * 0.0306) + 79.2, 6);
    expect(s.ok).toBe(true);
    expect(s.line).toContain("fits r3c-opus's $750 cap");
    const no = startRule(tr, 750, 300);
    expect(no.ok).toBe(false);
    expect(no.line).toContain("r3c-opus does not bind");
  });

  const ledger = (settled: number, cap = 750) => {
    const p = join(tmp("r3c-ledger-"), "l.jsonl"), l = new Ledger(p, RUN.item);
    l.approve(cap, { words: "test", by: "test" });
    if (settled) { l.reserve("r3c-opus-cal-1a/s", toMicros(settled)); l.settle("r3c-opus-cal-1a/s", toMicros(settled)); }
    return readRows(p);
  };

  test("calibration: before cal-1a settles it prices at R3b's none cost; after, at the item's own graded trials, a graded trial with no metered cost at $12", () => {
    const first = calProjection({ rows: ledger(0), capUsd: 750, next: "cal-1b", remainingTrials: 732, cal2Known: false, done: [], doneVmUsd: 0 });
    expect(first.record.none_usd).toBe(0.43);
    expect(first.record.vm_trial_usd).toBeCloseTo(0.6 * 0.0306);
    expect(first.line).toContain("cal-2 at its worst case");
    const done = [rt({ task: "a", arm: "none", spent: 1 }), rt({ task: "b", arm: "none", spent: null }), rt({ task: "c", arm: "none", infra: true, spent: null })];
    const p = calProjection({ rows: ledger(50), capUsd: 750, next: "cal-1c", remainingTrials: 586, cal2Known: false, done, doneVmUsd: 6 });
    expect(p.record.none_usd).toBe(6.5);
    expect(p.record.vm_trial_usd).toBe(2);
    expect(p.record.projection_usd).toBeCloseTo(50 + 586 * 8.5 + 79.2);
    expect(p.over).toBe(true);
    expect(p.line).toContain("the run stops before cal-1c and the Captain decides a raise");
  });

  test("the grid: before grid-1 it prices none at admission's cost and told at that x 0.685/0.43; a cost it can't compute stops the run", () => {
    const g = gridProjection({ rows: ledger(400), capUsd: 750, next: "grid-1", n: 12, remainingReps: 10, admitNoneUsd: 0.5, done: [], doneVmUsd: 0 });
    expect(g.record.told_usd).toBeCloseTo(0.5 * 0.685 / 0.43);
    expect(g.record.vm_usd).toBeCloseTo(120 * 0.6 * (0.0306 + 0.0537));
    expect(g.over).toBe(false);
    for (const admitNoneUsd of [Number.NaN, null as unknown as number]) {
      const bad = gridProjection({ rows: ledger(0), capUsd: 750, next: "grid-1", n: 12, remainingReps: 10, admitNoneUsd, done: [], doneVmUsd: 0 });
      expect(bad.over).toBe(true);
      expect(bad.line).toContain("the run stops before grid-1");
    }
    const later = gridProjection({ rows: ledger(400), capUsd: 750, next: "grid-2", n: 12, remainingReps: 6, admitNoneUsd: 0.5, done: [rt({ task: "a", arm: "none", spent: 2 }), rt({ task: "a", arm: "gstack", spent: null })], doneVmUsd: 1 });
    expect([later.record.none_usd, later.record.told_usd, later.record.vm_usd]).toEqual([2, 12, 72]);
  });
});

describe("report-only lines on a complete grid", () => {
  const base = grid((i, rep, arm) => ({ pass: arm === "gstack" ? rep < 2 || i % 2 === 0 : rep === 0, f2p: arm === "gstack" ? 0.9 : 0.5 }));

  test("an unreadable transcript prints the error line instead of localization rates, and the verdict stands", () => {
    const ok = outcome(base);
    expect(ok.lines.some((l) => l.startsWith("localization (report only):"))).toBe(true);
    const bad = base.map((t, k) => (k === 3 ? { ...t, closing: null, closing_error: "E_TRANSCRIPT_UNREADABLE no main-thread assistant text block" } : t));
    const o = outcome(bad);
    expect(o.verdict).toBe(ok.verdict);
    expect(o.record.primary).toEqual(ok.record.primary);
    expect(o.lines.some((l) => l.startsWith("localization (report only):"))).toBe(false);
    expect(o.lines.find((l) => l.startsWith("E_TRANSCRIPT_UNREADABLE localization (report only): 1 graded grid trials"))).toContain("never a miss");
    expect((o.record.localization as any).error).toBe("E_TRANSCRIPT_UNREADABLE");
  });

  test("f2pShare and locRank move no verdict", () => {
    const ok = outcome(base);
    const flipped = outcome(base.map((t) => ({ ...t, f2p_share: t.arm === "gstack" ? 0 : 1, closing: t.arm === "gstack" ? [] : ["src/core.py"] })));
    expect(flipped.verdict).toBe(ok.verdict);
    expect(flipped.record.primary).toEqual(ok.record.primary);
    expect(flipped.lines.find((l) => l.startsWith("f2pShare (report only):"))).toContain("none 1.000, told 0.000");
    expect((ok.record.f2p_share as any).told.mean).toBeCloseTo(0.9);
  });
});

describe("the trial order in Harbor with repeated trials", () => {
  // sitecustomize.py against a stub harbor.job_plan, as in r3b.test.ts, with a task listed twice (a cal-1 part) or two attempts (a grid part).
  function py(order: unknown, tasks: string[], attempts: number) {
    const d = tmp("r3c-order-");
    mkdirSync(join(d, "harbor"), { recursive: true });
    writeFileSync(join(d, "harbor/__init__.py"), "");
    writeFileSync(join(d, "harbor/job_plan.py"), "from types import SimpleNamespace as N\nclass JobPlan:\n    @staticmethod\n    def build_trial_configs(config, task_configs, *, job_id):\n        return [N(task=N(path='/run/tasks/' + t), agent=N(kwargs={'arm': a}), i=i) for i, (_, t, a) in enumerate((k, t, a) for k in range(config.n_attempts) for t in task_configs for a in config.arms)]\n");
    const f = join(d, "order.json");
    writeFileSync(f, JSON.stringify(order));
    const code = "from types import SimpleNamespace as N\nfrom harbor.job_plan import JobPlan\nts = JobPlan.build_trial_configs(N(n_attempts=" + attempts + ", arms=['none', 'gstack']), " + JSON.stringify(tasks) + ", job_id=0)\nprint([t.task.path.split('/')[-1] + '/' + t.agent.kwargs['arm'] + '/' + str(t.i) for t in ts])\n";
    const r = Bun.spawnSync(["python3", "-c", code], { env: { ...process.env, PYTHONPATH: d + ":" + join(laneb, "runner/agent"), LANEB_TRIAL_ORDER: f } });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }
  test("a task listed twice, or two attempts, runs each trial once in the file's order", () => {
    const r = py([["a", "gstack"], ["a", "none"], ["b", "none"], ["a", "none"], ["b", "gstack"], ["a", "gstack"]], ["a", "b", "a"], 1);
    expect(r.code).toBe(0);
    expect(r.out).toContain("['a/gstack/1', 'a/none/0', 'b/none/2', 'a/none/4', 'b/gstack/3', 'a/gstack/5']");
    expect(r.err).toContain("laneb order: applied 6 trials");
    const g = py([["b", "none"], ["a", "none"], ["a", "gstack"], ["b", "gstack"], ["a", "none"], ["b", "none"], ["b", "gstack"], ["a", "gstack"]], ["a", "b"], 2);
    expect(g.code).toBe(0);
    expect(g.err).toContain("laneb order: applied 8 trials");
  });
  test("an order that names a repeated trial too few or too many times fails the job", () => {
    for (const bad of [[["a", "none"], ["a", "gstack"], ["b", "none"], ["b", "gstack"], ["a", "none"]], [["a", "none"], ["a", "gstack"], ["b", "none"], ["b", "gstack"], ["a", "none"], ["a", "none"], ["a", "gstack"]]]) {
      const r = py(bad, ["a", "b", "a"], 1);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("does not name each of the job's 6 trials once");
    }
  });
});

describe("R3c's arms under the real pinned Agent SDK", () => {
  // agent_r3_sdk_test.py drives each arm's job kwargs through LanebAgent.run under the real pinned Agent SDK, with only Harbor
  // and docker stubbed: the prompt the CLI receives ends with the closing line, after the told arm's procedure line.
  test("both R3c arms send their prompt with the closing line, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the preset", () => {
    const here = import.meta.dir;
    const pin = readFileSync(join(laneb, "runner/vm-bootstrap.sh"), "utf8").match(/^SDK_PIN=(\S+)$/m)![1];
    const venv = join(tmpdir(), "laneb-claude-agent-sdk-" + pin);
    const python = join(venv, "bin/python");
    if (!existsSync(python) || Bun.spawnSync([python, "-c", 'import claude_agent_sdk as s; assert s.__version__ == "' + pin + '"']).exitCode !== 0) {
      const install = Bun.spawnSync(["sh", "-c", 'python3 -m venv --clear "$1" && "$1/bin/pip" install -q "claude-agent-sdk==$2"', "sh", venv, pin]);
      if (install.exitCode !== 0) console.log(install.stdout.toString() + install.stderr.toString());
      expect(install.exitCode).toBe(0);
    }
    const job = jobConfig({ job_name: "r3c", tasks_dir: "/t", tasks: ["a"], models: [{ id: OPUS, max_budget_usd: 12 }], arms: [R3C_NONE, R3C_TOLD].map((a) => ({ ...armSpec(a), tar: "/x/" + armSpec(a).name + ".tar", sha256: "0".repeat(64) })), attempts: 1, n_concurrent: 1, agent_dir: "/a", runner_dir: "/r", base_url: "http://x:8787", repo_dir: "/testbed" } as any);
    expect(job.agents.map((a: any) => a.kwargs.closing_line)).toEqual([CLOSING, CLOSING]);
    const agents = join(tmp("r3c-agents-"), "agents.json");
    writeFileSync(agents, JSON.stringify(job.agents.map((a: any) => a.kwargs)));
    const r = Bun.spawnSync([python, join(here, "agent_r3_sdk_test.py")], { env: { ...process.env, PYTHONPATH: [join(laneb, "runner/agent"), here].join(":"), R3_AGENTS: agents } });
    const out = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    expect(out.match(/^pass arm /gm)).toHaveLength(2);
    expect(r.exitCode).toBe(0);
  }, 600_000);
});
