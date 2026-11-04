import { describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armSpec, jobConfig } from "../runner/grid.ts";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";
import { itemCheck, OPUS, R3_ARMS, routePassed, SOL } from "../r3/screen.ts";
import { armCheck, capSizing, formulaMdd, gridOrder, gridOutcome, gridProjection, hookState, idsSha, keepRate, phaseHeadings, PIN, R3B, R3B4, recheckGate, recheckStopLine, recheckTasks, repoSkills, startRule, taskList, type GridTrial } from "../r3/r3b.ts";

const laneb = join(import.meta.dir, "..");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const opus = R3B4["r3b4-opus"]!, sol = R3B4["r3b4-sol"]!;
const tasks = (m = opus) => taskList(m.tasksFile, m.tasksSha256);
const proxyText = readFileSync(join(laneb, "config/proxy.json"), "utf8");
const words = { words: "test", by: "test" };

let seq = 0;
type T = { task: string; arm: "none" | "gstack"; model?: string; pass?: boolean; infra?: boolean; shown?: boolean; opened?: boolean; spent?: number; budget?: boolean };
// A pure GridTrial, as loadGridTrials returns it.
function gt(t: T): GridTrial {
  const told = t.arm === "gstack";
  return {
    task: t.task, arm: t.arm, model: t.model ?? OPUS, route: null, upstream_model: null, trial: t.task + "-" + seq++, outcome: t.infra ? "infra" : t.pass ? "pass" : "fail", reason: "", reward: t.infra ? null : t.pass ? 1 : 0,
    model_responded: !t.infra, exception: null, cap_stop: false, cost_usd: t.spent ?? 1, attempts: 1, requests: 1, refused: 0, budget_stop: !!t.budget, agent_timeout: false, wall_s: null,
    told_skill: told ? "investigate" : null, cmd_expanded: told, cmd_names: told ? ["investigate"] : [], skill_opens: [], body_loaded: told, investigate_opened: told, gate: { debug_report: told, phase: false },
    procedure_shown: told && (t.shown ?? true), exposed: told && (t.shown ?? true), phase_headings: 0,
    hooks: { files: 0, stop_hook_ran: false, held_back: false, outcome: null, route_hook_ran: false, routed: false, contract_events: {}, route_events: {} }, repo_skills: [], non_gstack_skill_calls: 0,
  };
}
// 70 tasks x 3 replicates x {none, told}; f gives each trial's fields from the task's index, the replicate and the arm.
function grid(f: (i: number, rep: number, arm: "none" | "gstack") => Partial<T>, m = opus): GridTrial[] {
  return tasks(m).flatMap((task, i) => [0, 1, 2].flatMap((rep) => (["none", "gstack"] as const).map((arm) => gt({ task, arm, model: m.id, ...f(i, rep, arm) }))));
}
const outcome = (g: GridTrial[], m = opus) => gridOutcome(g, m, { sims: 2 });

describe("R3b's items and caps", () => {
  test("r3b4-opus is $376 and r3b4-sol $393, each section 8's sum rounded up, on their own ledger ports, with recheck and three grid parts", () => {
    expect([opus.capUsd, sol.capUsd]).toEqual([376, 393]);
    expect(capSizing(opus).cap).toBe(376);
    expect(capSizing(sol).cap).toBe(393);
    expect(capSizing(opus).vm).toBeCloseTo(12.96, 2);
    expect([opus.ledgerPort, sol.ledgerPort]).toEqual(["9915", "9916"]);
    expect([opus.routePrefix, sol.routePrefix]).toEqual([null, "r3b4-sol-route/"]);
    for (const m of [opus, sol]) {
      expect(m.parts.map((p) => p.name)).toEqual(["recheck", "grid-1", "grid-2", "grid-3"]);
      expect(m.parts[0]!.arm).toBe(R3_ARMS.toldLine + ":gstack_hooks=copy");
      expect(m.parts[1]!.arm).toBe(R3_ARMS.none + "," + R3_ARMS.toldLine + ":gstack_hooks=copy");
      expect(m.armManifests).toBe("arms/manifests/r3b");
    }
    const job = jobConfig({ job_name: "j", tasks_dir: "/t", tasks: ["a"], models: [{ id: OPUS, harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 12 }], arms: opus.parts[1]!.arm.split(",").map((e) => ({ ...armSpec(e), tar: "/x", sha256: "y" })), attempts: 1, n_concurrent: 6, agent_dir: "/a", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2 });
    expect(job.agents.map((a) => [a.kwargs.arm, a.import_path, "gstack_hooks" in a.kwargs])).toEqual([["none", "laneb_agent:LanebAgent", false], ["gstack", "laneb_hooks:LanebHooksAgent", false]]);
    const cells = JSON.parse(readFileSync(join(laneb, "config", R3B.cells), "utf8"));
    for (const id of [OPUS, SOL]) expect(cells.models.find((c: any) => c.id === id).session_cap_usd).toBe(12);
  });

  test("an item binds only at its own cap", () => {
    for (const [m, cap] of [[opus, 376], [sol, 393]] as const) {
      const p = join(tmp("r3b-cap-"), m.item + ".jsonl");
      new Ledger(p, m.item).approve(cap, words);
      expect(() => itemCheck(p, m)).not.toThrow();
      const q = join(tmp("r3b-cap-"), m.item + ".jsonl");
      new Ledger(q, m.item).approve(cap - 1, words);
      expect(() => itemCheck(q, m)).toThrow("not amendment 5's $" + cap);
    }
  });

  test("Sol's route check runs on r3b4-sol: a pass recorded for r3a4-sol is refused, one for r3b4-sol with the parts' config passes", () => {
    const d = tmp("r3b-route-"), ledger = join(d, "r3b4-sol.jsonl"), cfg = join(d, "proxy.json");
    writeFileSync(cfg, proxyText);
    writeFileSync(ledger + ".route.json", JSON.stringify({ item: "r3a4-sol", model: SOL, verdict: "pass", reason: "ok", proxy_config_sha256: sha(proxyText) }));
    expect(() => routePassed(ledger, sol, [cfg])).toThrow("is for gpt-6.1-sol on r3a4-sol, not gpt-6.1-sol on r3b4-sol");
    writeFileSync(ledger + ".route.json", JSON.stringify({ item: "r3b4-sol", model: SOL, verdict: "pass", reason: "ok", proxy_config_sha256: sha(proxyText) }));
    expect(() => routePassed(ledger, sol, [cfg])).not.toThrow();
    expect(() => routePassed(ledger, opus, [cfg])).not.toThrow();
    const cli = (...a: string[]) => Bun.spawnSync([process.execPath, join(laneb, "r3/route-check.ts"), ...a], { env: { ...process.env, LEDGER: "" } }).stderr.toString();
    expect(cli("--item", "r3b4-sol")).toContain("set LEDGER to r3b4-sol's jsonl ledger");
    expect(cli("--item", "r3b4-opus")).toContain("has no route check");
  });
});

describe("R3b's frozen inputs", () => {
  test("the task lists are amendment 5's, by sha256 in draw order, and a changed list is refused", () => {
    expect(idsSha(tasks(opus))).toBe("c4dc57fba3c9652e453dd32b57711b9bd55cd51a27803c74ea308ed54c073471");
    expect(idsSha(tasks(sol))).toBe("c357947874938eb82365c2fe70360600252f2fb4ffa6a5cc76ba58dc74b016ac");
    expect(recheckTasks()).toHaveLength(10);
    expect(() => taskList(opus.tasksFile, sol.tasksSha256)).toThrow("is not the frozen");
  });

  test("each grid part runs the 140 task and arm pairs once, in the seed 20261106 shuffle, not Harbor's task-then-arm order", () => {
    const o = gridOrder(tasks());
    expect(o).toHaveLength(140);
    expect(new Set(o.map((p) => p.join("|"))).size).toBe(140);
    expect(gridOrder(tasks())).toEqual(o);
    const product = [...tasks()].sort().flatMap((t) => [[t, "none"], [t, "gstack"]]);
    expect(o).not.toEqual(product);
  });

  test("arm-check passes on the committed manifests and fails without either hook entry, at another pin, or with a changed none arm", () => {
    expect(armCheck()).toEqual([]);
    const variant = (f: (g: any) => void, none?: string) => {
      const d = tmp("r3b-man-");
      const g = JSON.parse(readFileSync(join(laneb, "arms/manifests/r3b/gstack.json"), "utf8"));
      f(g);
      writeFileSync(join(d, "gstack.json"), JSON.stringify(g));
      writeFileSync(join(d, "none.json"), none ?? readFileSync(join(laneb, "arms/manifests/r3/none.json"), "utf8"));
      return armCheck(d).join("; ");
    };
    expect(variant(() => {})).toBe("");
    expect(variant((g) => { g.settings.hooks = g.settings.hooks.filter((h: any) => !h.command.endsWith("/skill-contract-stop-hook")); })).toContain("no Stop hook running skill-contract-stop-hook");
    expect(variant((g) => { g.settings.hooks = g.settings.hooks.filter((h: any) => h.event !== "UserPromptSubmit"); })).toContain("no UserPromptSubmit hook running skill-route-hook");
    expect(variant((g) => { g.gstack_sha = "61e201ec08bcf59163ef2d3a69a26e334a536c04"; })).toContain("not the pin " + PIN);
    expect(variant(() => {}, "{}\n")).toContain("none.json is not arms/manifests/r3/none.json");
    const cli = Bun.spawnSync([process.execPath, join(laneb, "r3/r3b.ts"), "arm-check"]);
    expect(cli.exitCode).toBe(0);
    expect(cli.stdout.toString()).toStartWith("arm-check: pass gstack " + PIN);
  });
});

describe("report-only readers", () => {
  function hookDir(o: { contract?: string[]; route?: string[]; runs?: Record<string, unknown> }) {
    const d = tmp("r3b-hooks-"), h = join(d, "evaluator/gstack-hooks");
    if (o.contract || o.route) mkdirSync(join(h, "hooks"), { recursive: true });
    if (o.contract) writeFileSync(join(h, "hooks/skill-contract.log"), o.contract.map((e) => "2026-11-04T00:00:00Z session=s1 event=" + e + " skill=investigate").join("\n") + "\n");
    if (o.route) writeFileSync(join(h, "hooks/skill-route.log"), o.route.map((e) => "2026-11-04T00:00:00Z session=s1 event=" + e).join("\n") + "\n");
    if (o.runs) { mkdirSync(join(h, "skill-contracts"), { recursive: true }); writeFileSync(join(h, "skill-contracts/s1.json"), JSON.stringify({ version: 1, session_id: "s1", runs: o.runs })); }
    return d;
  }
  test("the hook state reads a held-back stop, a met stop and an arm with no gstack state", () => {
    const blocked = hookState(hookDir({ contract: ["not-final-turn", "blocked", "met_after_block"], route: ["routed"], runs: { "investigate@3": { skill: "investigate", outcome: "met_after_block", updated_at: "2026-11-04T00:01:00Z" } } }));
    expect(blocked).toMatchObject({ stop_hook_ran: true, held_back: true, outcome: "met_after_block", route_hook_ran: true, routed: true, contract_events: { blocked: 1, met_after_block: 1, "not-final-turn": 1 } });
    expect(hookState(hookDir({ contract: ["met"], route: ["no-route"], runs: { "investigate@3": { skill: "investigate", outcome: "met", updated_at: "x" } } }))).toMatchObject({ stop_hook_ran: true, held_back: false, outcome: "met", route_hook_ran: true, routed: false });
    expect(hookState(hookDir({}))).toMatchObject({ files: 0, stop_hook_ran: false, held_back: false, outcome: null, route_hook_ran: false });
  });

  test("the stricter indicator counts distinct Phase 1 to 5 headings, not phases named mid-line", () => {
    expect(phaseHeadings("## Phase 1: Symptom\n**Phase 2** root cause\nPhase 2 again\n> Phase 5\nPhase 6\n")).toBe(3);
    expect(phaseHeadings("I went through Phase 1 and Phase 2.\nDEBUG REPORT")).toBe(0);
  });

  test("task-repo skills are the init list less the two built-ins and gstack's skills; Skill calls to non-gstack skills are counted", () => {
    const lines = [JSON.stringify({ type: "SystemMessage", init: { skills: ["doctor", "plugin-authoring", "investigate", "code-review"] } }), JSON.stringify({ type: "AssistantMessage", content: [{ name: "Skill", input: { skill: "code-review" } }, { name: "Skill", input: { skill: "investigate" } }] })];
    expect(repoSkills(lines, new Set(["investigate"]))).toEqual({ repo_skills: ["code-review"], non_gstack_skill_calls: 1 });
    expect(repoSkills([JSON.stringify({ init: { skills: ["doctor", "plugin-authoring"] } })], new Set())).toEqual({ repo_skills: [], non_gstack_skill_calls: 0 });
  });
});

describe("the re-check gate", () => {
  const re = (exposed: number, infra = 0) => recheckTasks().map((task, i) => gt({ task, arm: "gstack", infra: i >= 10 - infra, shown: i < exposed }));
  test("7 of 10 exposed passes and 6 of 10 stops R3b with the frozen line", () => {
    expect(recheckGate(re(7))).toMatchObject({ exposed: 7, graded: 10, pass: true, incomplete: false });
    const g = recheckGate(re(6));
    expect(g.pass).toBe(false);
    expect(recheckStopLine(opus, g)).toBe("R3b did not run for Opus 5.5: told /investigate at 699a41cb showed the procedure in 6 of 10 re-check trials, under 7.");
  });
  test("two infra trials make it incomplete; one leaves the rule on the 9 graded", () => {
    expect(recheckGate(re(7, 2))).toMatchObject({ infra: 2, incomplete: true, pass: false });
    expect(recheckGate(re(7, 1))).toMatchObject({ infra: 1, graded: 9, exposed: 7, incomplete: false, pass: true });
  });
});

function record(m = opus, o: { none?: number; told?: number } = {}) {
  const p = join(tmp("r3b-rec-"), "record.json");
  writeFileSync(p, JSON.stringify({ item: m.from, outcome: "admitted", n: 70, r3b_tasks: tasks(m), pilot: { tasks: recheckTasks() }, measured_cost_per_trial_usd: { none: o.none ?? m.basis.screenNoneUsd, told: o.told ?? m.basis.pilotToldUsd } }));
  return p;
}

describe("the start rule and the projection checks", () => {
  test("the start rule binds at R3a4's measured costs and refuses a projection over the cap or another model's record", () => {
    expect(startRule(record(opus), opus, 376).line).toBe("start rule: projection $232.36 = 70 x 3 x ($0.3702 none + $0.7363 told), from r3a4-opus's record, fits r3b4-opus's $376 cap");
    expect(startRule(record(sol), sol, 393).ok).toBe(true);
    const over = startRule(record(opus, { told: 1.5 }), opus, 376);
    expect(over.ok).toBe(false);
    expect(over.line).toEndWith("passes r3b4-opus's $376 cap; r3b4-opus does not bind");
    expect(() => startRule(record(sol), opus, 376)).toThrow("not r3a4-opus's admitted record");
  });

  test("after the re-check the projection uses the screen's none cost and the re-check's told mean x 1.160; over the cap it stops before grid-1", () => {
    const re = recheckTasks().map((task) => gt({ task, arm: "gstack", spent: 1 }));
    const rows = [{ ts: "", item: "r3b4-opus", kind: "approval" as const, id: "approval", usd_micros: 376e6 }, { ts: "", item: "r3b4-opus", kind: "settle" as const, id: "r3b4-opus-recheck/s", usd_micros: toMicros(10) }];
    const p = gridProjection({ rows, m: opus, capUsd: 376, after: "recheck", next: "grid-1", done: 0, recheck: re, grid: [], gridVmUsd: 0 });
    const vm = 70 * (0.0306 * (0.460213 / 0.370227) + 0.0537 * 1.16) * 0.6;
    expect(p.record.told_usd).toBeCloseTo(1.16, 9);
    expect(p.record.projection_usd).toBeCloseTo(10 + 3 * (70 * 0.460213 + 70 * 1.16 + vm) + 79.2, 6);
    expect(p.over).toBe(true);
    expect(p.line).toContain("passes r3b4-opus's $376 cap; the run stops before grid-1 and the Captain decides a raise");
    const cheap = recheckTasks().map((task) => gt({ task, arm: "gstack", spent: 0.7 }));
    expect(gridProjection({ rows, m: opus, capUsd: 376, after: "recheck", next: "grid-1", done: 0, recheck: cheap, grid: [], gridVmUsd: 0 }).over).toBe(false);
  });

  test("from grid-1 on it uses the grid's own trial costs and VM; a trial with no metered cost counts at $12", () => {
    const g = grid((_i, _r, arm) => ({ spent: arm === "none" ? 0.5 : 0.9 })).filter((_t, k) => k % 6 < 2);
    expect(g).toHaveLength(140);
    g[0]!.cost_usd = null;
    const rows = [{ ts: "", item: "r3b4-opus", kind: "approval" as const, id: "approval", usd_micros: 376e6 }, { ts: "", item: "r3b4-opus", kind: "settle" as const, id: "x", usd_micros: toMicros(60) }];
    const p = gridProjection({ rows, m: opus, capUsd: 376, after: "grid-1", next: "grid-2", done: 1, recheck: [], grid: g, gridVmUsd: 5 });
    const none = g.filter((t) => t.arm === "none"), told = g.filter((t) => t.arm === "gstack");
    const mean = (ts: GridTrial[]) => ts.reduce((s, t) => s + (t.cost_usd ?? 12), 0) / ts.length;
    expect(p.record.projection_usd).toBeCloseTo(60 + 2 * (70 * mean(none) + 70 * mean(told) + 5) + 79.2, 6);
    expect(p.line).toContain("fits r3b4-opus's $376 cap; grid-2 starts");
  });
});

describe("the outcome on a complete grid", () => {
  const keep = (i: number, _r: number, arm: string) => ({ pass: i < 40 && arm === "gstack" });
  test("an interval above zero is KEEP, and no MDD is printed beside it", () => {
    const o = outcome(grid(keep));
    expect(o.verdict).toBe("KEEP");
    expect(o.exit).toBe(0);
    expect(o.lines.at(-1)).toStartWith("R3b outcome for Opus 5.5: KEEP. The told /investigate at 699a41cb with the procedure line beats none by +57.1 points");
    expect(o.lines.join("\n")).not.toContain("MDD");
    expect(o.lines.join("\n")).toContain("D1 sensitivity: 40 paired tasks solved by at least one graded grid trial in either arm");
  });

  test("the 90% exposure gate: 189 of 210 exposed passes, 188 is FIX-METHOD (exposure) whatever the contrast", () => {
    const shown = (n: number) => { let k = 0; return (i: number, r: number, arm: string) => ({ ...keep(i, r, arm), shown: arm === "gstack" ? k++ < n : undefined }); };
    expect(outcome(grid(shown(189))).verdict).toBe("KEEP");
    const o = outcome(grid(shown(188)));
    expect(o.verdict).toBe("FIX-METHOD (exposure)");
    expect(o.lines.at(-1)).toContain("visible in 188 of 210 graded told grid trials (89.5%), under 90%");
  });

  test("the truncation bound: told allowance stops 5.2 points above none's is FIX-METHOD (truncation), 4.8 points is not", () => {
    const stops = (n: number) => { let k = 0; return (i: number, r: number, arm: string) => ({ ...keep(i, r, arm), budget: arm === "gstack" && k++ < n }); };
    expect(outcome(grid(stops(10))).verdict).toBe("KEEP");
    const o = outcome(grid(stops(11)));
    expect(o.verdict).toBe("FIX-METHOD (truncation)");
    expect(o.lines.at(-1)).toContain("5.2% of told sessions ended at the $12 allowance against 0.0% of none sessions");
  });

  test("D1 as fixed: a primary at or below zero is CUT-CANDIDATE with 30 solved tasks and FIX-METHOD (task fit) with 29", () => {
    const worse = (n: number) => (i: number, r: number, arm: string) => ({ pass: i < n && (arm === "none" ? r < 2 : r < 1) });
    const cut = outcome(grid(worse(30)));
    expect(cut.verdict).toBe("CUT-CANDIDATE");
    expect(cut.exit).toBe(3);
    expect(cut.record.sensitivity.tasks).toBe(30);
    expect(cut.lines.at(-1)).toContain("on the 30-task D1 sensitivity set; control rate");
    const fit = outcome(grid(worse(29)));
    expect(fit.verdict).toBe("FIX-METHOD (task fit)");
    expect(fit.exit).toBe(5);
    expect(fit.lines.at(-1)).toContain("only 29 tasks were solved by any graded grid trial, fewer than 30");
    const even = outcome(grid((i, r) => ({ pass: i < 35 && r === 0 })));
    expect(even.record.primary.diff).toBe(0);
    expect(even.verdict).toBe("CUT-CANDIDATE");
  });

  test("the sensitivity set counts grid trials only, so a task solved only in the re-check stays out", () => {
    const g = grid((i, r, arm) => ({ pass: i < 31 && arm === "none" && r === 0 }));
    expect(outcome(g).record.sensitivity.tasks).toBe(31);
    const fewer = grid((i, r, arm) => ({ pass: i < 29 && arm === "none" && r === 0 }));
    expect(outcome(fewer).verdict).toBe("FIX-METHOD (task fit)");
  });

  test("a positive primary whose interval includes zero is FIX-METHOD (power), with #112's formula and the simulated MDDs beside it", () => {
    const o = outcome(grid((i, r, arm) => ({ pass: (i < 30 && r === 0) || (arm === "gstack" && i >= 30 && i < 33 && r === 0) })));
    expect(o.verdict).toBe("FIX-METHOD (power)");
    expect(o.exit).toBe(5);
    expect(o.record.mdd_points.formula).toBeCloseTo(formulaMdd(70), 9);
    expect(formulaMdd(70)).toBeCloseTo(10.93, 2);
    const text = o.lines.join("\n");
    expect(text).toContain("MDD (amendment 5 section 6): 12.5 points at 70 tasks; re-simulated at the grid's none rate");
    expect(text).toContain("the sensitivity set's 33 tasks (report only)");
    expect(text).toContain("MDD at the realized n of 70 paired tasks: #112's formula 10.9 points; r3b-power's model at screen none rate 0.645");
  });

  test("the report-only lines: overlap, repository interval, stricter indicator, Stop hook and task-repo skills, which decide nothing", () => {
    const g = grid(keep);
    for (const t of g.filter((x) => x.arm === "gstack").slice(0, 5)) { t.phase_headings = 5; t.hooks = { ...t.hooks, stop_hook_ran: true, held_back: true, outcome: "met_after_block" }; t.repo_skills = ["code-review"]; t.non_gstack_skill_calls = 2; }
    const o = gridOutcome(g, opus, { sims: 2, repoOf: new Map(tasks().map((t, i) => [t, "repo" + (i % 7)])) });
    expect(o.verdict).toBe("KEEP");
    const text = o.lines.join("\n");
    expect(text).toContain("cross-model overlap (report only): 62 of Opus 5.5's 71 admitted tasks are also unsolved by GPT-6.1 Sol (81 admitted), against about 28.8 if the two failed independently on the 200 screen tasks");
    expect(text).toContain("repository-clustered interval (report only):");
    expect(text).toContain("over 7 repositories");
    expect(text).toContain("stricter indicator (report only): told trials by distinct Phase 1-5 headings, 0 to 5: 205, 0, 0, 0, 0, 5");
    expect(text).toContain("Stop hook (report only): ran in 5 of 210 graded told grid trials and held a stop back in 5; outcomes met_after_block 5, none 205");
    expect(text).toContain("task-repo skills (report only): none 0 sessions with them in the init list and 0 Skill calls to non-gstack skills there; told 5 and 10");
  });

  test("the simulated power rises with the lift and the KEEP rule holds its size at no lift", () => {
    expect(keepRate({ m: 0.4, n: 70, d: 0, sims: 20, draw: "prior" })).toBeLessThan(0.2);
    expect(keepRate({ m: 0.4, n: 70, d: 0.3, sims: 20, draw: "prior" })).toBeGreaterThan(0.9);
  });
});

// A prepared, pulled R3b work dir. reTold gives each re-check trial's fields, gridTrial each grid trial's; a part in
// pulled gets results and launch-exit 0.
function work(m = opus, o: { reTold?: (i: number) => Partial<T>; gridTrial?: (i: number, part: number, arm: "none" | "gstack") => Partial<T>; pulled?: string[]; noOracle?: string } = {}) {
  const w = tmp("r3b-work-"), ledger = join(w, m.item + ".jsonl");
  new Ledger(ledger, m.item).approve(m.capUsd, words);
  const ids = tasks(m), order = JSON.stringify(gridOrder(ids));
  writeFileSync(join(w, "plan.json"), JSON.stringify({ item: m.item, tasks_sha256: m.tasksSha256, recheck_sha256: R3B.recheckSha256, order_sha256: sha(order) }));
  for (const [k, part] of m.parts.entries()) {
    const dir = join(w, part.name), want = k === 0 ? recheckTasks() : ids;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "proxy.json"), proxyText);
    writeFileSync(join(dir, "job.json"), JSON.stringify({ tasks: want.map((t) => ({ path: "/vm/run/tasks/" + t })) }));
    if (o.noOracle !== part.name) writeFileSync(join(dir, "oracle.json"), "{}");
    if (k > 0) writeFileSync(join(dir, "order.json"), order);
    if (!(o.pulled ?? m.parts.map((p) => p.name)).includes(part.name)) continue;
    mkdirSync(join(dir, "pulled/out"), { recursive: true });
    writeFileSync(join(dir, "pulled/out/proxy-sessions.jsonl"), "");
    const write = (t: T) => {
      const name = t.task.slice(0, 20) + "__" + seq++, d = join(dir, "pulled/jobs", part.job, name);
      mkdirSync(join(d, "evaluator"), { recursive: true });
      writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: "/vm/run/tasks/" + t.task }, agent: { name: "laneb-claude-code", kwargs: { arm: t.arm, upstream_model: m.id, ...(t.arm === "gstack" ? { told_skill: "investigate", procedure_line: "investigate-phases" } : {}) } } }));
      writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, verifier_result: t.infra ? null : { rewards: { reward: t.pass ? 1 : 0 } }, exception_info: null }));
      writeFileSync(join(d, "evaluator/sdk-messages.jsonl"), JSON.stringify({ type: "AssistantMessage", content: [{ text: t.arm === "gstack" && t.shown !== false ? "## Phase 1\nDEBUG REPORT" : "Fixed it." }] }) + "\n");
      appendFileSync(join(dir, "pulled/out/proxy-sessions.jsonl"), JSON.stringify({ id: "s" + seq, trial: name + "__env", model: m.id, spent_micros: toMicros(t.spent ?? 1), ok_responses: t.infra ? 0 : 3, requests: 4, refused: t.budget ? 1 : 0, refused_budget: t.budget ? 1 : 0, opened_at: "2026-11-04T00:00:00Z", closed_at: "2026-11-04T01:00:00Z", cmd_expanded: t.arm === "gstack", cmd_names: t.arm === "gstack" ? ["investigate"] : [] }) + "\n");
    };
    if (k === 0) recheckTasks().forEach((task, i) => write({ task, arm: "gstack", ...o.reTold?.(i) }));
    else ids.forEach((task, i) => (["none", "gstack"] as const).forEach((arm) => write({ task, arm, pass: i < 40 && arm === "gstack", ...o.gridTrial?.(i, k, arm) })));
    writeFileSync(join(w, part.name + ".launch-exit"), "0\n");
  }
  return { w, ledger };
}
const cli = (cmd: string, x: { w: string; ledger: string }, m = opus, env: Record<string, string> = {}) => {
  const r = Bun.spawnSync([process.execPath, join(laneb, "r3/r3b.ts"), cmd, x.w, "--item", m.item], { env: { ...process.env, LEDGER: x.ledger, R3B_MDD_SIMS: "2", ...env } });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString(), record: existsSync(join(x.w, "record.json")) ? JSON.parse(readFileSync(join(x.w, "record.json"), "utf8")) : null };
};

describe("analyze on a pulled work dir", () => {
  test("a complete run gives the grid's verdict; the re-check's trials count in no grid contrast", () => {
    const a = cli("analyze", work(opus, { reTold: () => ({ pass: true }) }));
    expect(a.code).toBe(0);
    expect(a.out).toContain("re-check: 10 of 10 graded told trials exposed (0 infra), 10 passed (report only); told cost per trial $1.00, nearest-rank p95 $1.00");
    expect(a.out).toContain("R3b outcome for Opus 5.5: KEEP.");
    expect(a.record.pass_rates.find((r: any) => r.arm === "gstack").trials).toBe(210);
    expect(a.record.recheck.exposed).toBe(10);
  });

  test("a re-check under 7 stops R3b with the frozen line, and two infra make it incomplete", () => {
    const s = cli("analyze", work(opus, { reTold: (i) => ({ shown: i < 6 }) }));
    expect(s.code).toBe(6);
    expect(s.out).toContain("R3b did not run for Opus 5.5: told /investigate at 699a41cb showed the procedure in 6 of 10 re-check trials, under 7.");
    expect(s.out).toContain("R3b outcome for Opus 5.5: FIX-METHOD (exposure)");
    expect(s.out).not.toContain("grid:");
    const i = cli("analyze", work(sol, { reTold: (k) => ({ infra: k < 2 }) }), sol);
    expect(i.code).toBe(4);
    expect(i.out).toContain("R3b outcome for GPT-6.1 Sol: none (incomplete: recheck: 2 of 10 trials are infra, two or more). FIX-METHOD (harness limits)");
  });

  test("the infra bound: 15 of a part's 140 is incomplete, 14 is not; 22 of the none cell's 210 is incomplete, 21 is not", () => {
    const part = (n: number) => cli("analyze", work(opus, { gridTrial: (i, k, arm) => ({ infra: k === 2 && arm === "none" && i < n }) }));
    expect(part(14).code).toBe(0);
    const p = part(15);
    expect(p.code).toBe(4);
    expect(p.out).toContain("incomplete: grid-2: 15 of 140 trials are infra, over 10%");
    const cell = (n: number) => cli("analyze", work(opus, { gridTrial: (i, k, arm) => ({ infra: arm === "none" && i < (k === 3 ? n - 14 : 7) }) }));
    expect(cell(21).code).toBe(0);
    const c = cell(22);
    expect(c.code).toBe(4);
    expect(c.out).toContain("incomplete: 22 of 210 none grid trials are infra, over 10%");
  });

  test("a part the projection stopped is incomplete for cost limits, and a part with a missing trial for harness limits", () => {
    const x = work(opus, { pulled: ["recheck", "grid-1"] });
    writeFileSync(join(x.w, "grid-2.projection-stop"), JSON.stringify({ line: "after grid-1: projection $400.00 passes r3b4-opus's $376 cap", approvals: 1 }));
    const a = cli("analyze", x);
    expect(a.code).toBe(4);
    expect(a.out).toContain("none (incomplete: grid-2 was not launched: after grid-1: projection $400.00 passes r3b4-opus's $376 cap). FIX-METHOD (cost limits)");
    const y = work(opus);
    const jobs = join(y.w, "grid-3/pulled/jobs/r3b4-opus-grid-3");
    const first = require("node:fs").readdirSync(jobs)[0];
    rmSync(join(jobs, first), { recursive: true });
    const b = cli("analyze", y);
    expect(b.code).toBe(4);
    expect(b.out).toMatch(/grid-3 (none|gstack): 1 of 70 planned tasks have no trial.*FIX-METHOD \(harness limits\)/);
  });
});

describe("run and resume", () => {
  const env = (extra: Record<string, string> = {}) => ({ VM_USD_PER_HOUR: "1", UBICLOUD_API_KEY: "test-not-a-key", UBI_RUNNER: "/bin/false", UBI_OWNER: "test", UBI_TTL_HOURS: "12", LEDGER_PORT: String(20000 + Math.floor(Math.random() * 20000)), ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "", R3A4_RECORD: record(opus), ...extra });
  const rowsOf = (x: { ledger: string }) => readRows(x.ledger).filter((r) => r.kind !== "approval");

  test("run refuses a part with no oracle.json before it binds, and a TTL under 12 hours", () => {
    const x = work(opus, { pulled: [], noOracle: "grid-2" });
    const r = cli("run", x, opus, env());
    expect(r.code).toBe(1);
    expect(r.err).toContain("grid-2 has no oracle.json, so its run-time oracle gate can't run");
    expect(existsSync(x.ledger + ".bound")).toBe(false);
    expect(rowsOf(x)).toEqual([]);
    const t = cli("run", work(opus, { pulled: [] }), opus, env({ UBI_TTL_HOURS: "6" }));
    expect(t.code).toBe(2);
    expect(t.err).toContain("set UBI_TTL_HOURS to 12 or more");
  });

  test("the start rule refuses the bind when the projection passes the cap, and binds and launches the re-check first when it fits", () => {
    const x = work(opus, { pulled: [] });
    const r = cli("run", x, opus, env({ R3A4_RECORD: record(opus, { told: 1.5 }) }));
    expect(r.code).toBe(5);
    expect(r.out).toContain("r3b4-opus does not bind");
    expect(existsSync(x.ledger + ".bound")).toBe(false);
    const ok = cli("run", x, opus, env());
    expect(ok.out).toContain("start rule: projection $232.36");
    expect(ok.out).toContain("recheck: launch exited");
    expect(existsSync(x.ledger + ".bound")).toBe(true);
    expect(rowsOf(x).map((row) => [row.id, row.kind])).toEqual([["r3b4-opus-recheck/vm", "reserve"], ["r3b4-opus-recheck/vm", "settle"]]);
    expect(existsSync(join(x.w, "grid-1.launch-exit"))).toBe(false);
    expect(cli("run", x, opus, env()).err).toContain("r3b4-opus is already bound to a run");
  });

  test("Sol's run is refused until its route check on r3b4-sol passed", () => {
    const x = work(sol, { pulled: [] });
    const r = cli("run", x, sol, env({ R3A4_RECORD: record(sol) }));
    expect(r.code).toBe(1);
    expect(r.err).toContain("GPT-6.1 Sol has not passed its route check on r3b4-sol");
    expect(existsSync(x.ledger + ".bound")).toBe(false);
  });

  // A bound run stopped by the projection after the re-check: $40 settled, so the projection passes $376.
  function stoppedAfterRecheck() {
    const x = work(opus, { pulled: ["recheck"] });
    const l = new Ledger(x.ledger, opus.item);
    l.reserve("r3b4-opus-recheck/s", toMicros(40));
    l.settle("r3b4-opus-recheck/s", toMicros(40));
    writeFileSync(x.ledger + ".bound", JSON.stringify({ item: opus.item, work: x.w, at: "2026-11-04T00:00:00Z" }) + "\n");
    writeFileSync(join(x.w, "grid-1.projection-stop"), JSON.stringify({ line: "after recheck: projection passes", approvals: 1 }) + "\n");
    return x;
  }
  const grid1 = (x: { ledger: string }) => readRows(x.ledger).filter((r) => r.id.startsWith("r3b4-opus-grid-1/"));

  test("resume refuses with no raise and with a raise the projection still passes, and launches nothing", () => {
    const x = stoppedAfterRecheck();
    const r = cli("resume", x, opus, env());
    expect(r.code).toBe(1);
    expect(r.err).toContain("no cap raise is recorded on");
    new Ledger(x.ledger, opus.item).raise(450, words);
    const s = cli("resume", x, opus, env());
    expect(s.code).toBe(1);
    expect(s.err).toContain("still passes r3b4-opus's raised $450 cap; grid-1 stays stopped");
    expect(grid1(x)).toEqual([]);
    expect(existsSync(join(x.w, "grid-1.projection-stop"))).toBe(true);
  });

  test("with a raise the projection fits, resume relaunches grid-1 on the same item and work dir, once", () => {
    const x = stoppedAfterRecheck();
    new Ledger(x.ledger, opus.item).raise(500, words);
    const r = cli("resume", x, opus, env());
    expect(r.out).toContain("fits r3b4-opus's $500 cap; grid-1 starts");
    expect(readFileSync(join(x.w, "grid-1.launch-exit"), "utf8").trim()).not.toBe("0");
    expect(grid1(x).map((row) => [row.id, row.kind])).toEqual([["r3b4-opus-grid-1/vm", "reserve"], ["r3b4-opus-grid-1/vm", "settle"]]);
    expect(JSON.parse(readFileSync(join(x.w, "cap-raise-grid-1.json"), "utf8")).raise).toMatchObject({ id: "raise-1", usd_micros: 500e6 });
    const again = cli("resume", x, opus, env());
    expect(again.code).toBe(1);
    expect(again.err).toContain("has no projection stop");
    const y = stoppedAfterRecheck();
    new Ledger(y.ledger, opus.item).raise(500, words);
    writeFileSync(y.ledger + ".bound", JSON.stringify({ item: opus.item, work: "/elsewhere" }) + "\n");
    expect(cli("resume", y, opus, env()).err).toContain("is bound to the run in /elsewhere");
  });

  test("a later projection stop needs its own raise: the raise before it doesn't count", () => {
    const x = work(opus, { pulled: ["recheck", "grid-1"] });
    const l = new Ledger(x.ledger, opus.item);
    l.raise(500, words);
    writeFileSync(x.ledger + ".bound", JSON.stringify({ item: opus.item, work: x.w }) + "\n");
    writeFileSync(join(x.w, "grid-2.projection-stop"), JSON.stringify({ line: "after grid-1: projection passes", approvals: 2 }) + "\n");
    const r = cli("resume", x, opus, env());
    expect(r.code).toBe(1);
    expect(r.err).toContain("since the projection stop before grid-2");
    l.raise(600, words);
    const s = cli("resume", x, opus, env());
    expect(s.out).toContain("after grid-1: projection");
    expect(s.out).toContain("fits r3b4-opus's $600 cap; grid-2 starts");
    expect(existsSync(join(x.w, "grid-2.launch-exit"))).toBe(true);
  });
});

describe("the trial order in Harbor", () => {
  // runner/agent/sitecustomize.py against a stub harbor.job_plan whose build_trial_configs is Harbor's task-then-agent product.
  function py(order: unknown, set = true) {
    const d = tmp("r3b-order-");
    mkdirSync(join(d, "harbor"), { recursive: true });
    writeFileSync(join(d, "harbor/__init__.py"), "");
    writeFileSync(join(d, "harbor/job_plan.py"), "from types import SimpleNamespace as N\nclass JobPlan:\n    @staticmethod\n    def build_trial_configs(config, task_configs, *, job_id):\n        return [N(task=N(path='/run/tasks/' + t), agent=N(kwargs={'arm': a})) for _ in range(config.n_attempts) for t in task_configs for a in config.arms]\n");
    const f = join(d, "order.json");
    writeFileSync(f, typeof order === "string" ? order : JSON.stringify(order));
    const code = "from types import SimpleNamespace as N\nfrom harbor.job_plan import JobPlan\nts = JobPlan.build_trial_configs(N(n_attempts=1, arms=['none', 'gstack']), ['a', 'b'], job_id=0)\nprint([t.task.path.split('/')[-1] + '/' + t.agent.kwargs['arm'] for t in ts])\n";
    const r = Bun.spawnSync(["python3", "-c", code], { env: { ...process.env, PYTHONPATH: d + ":" + join(laneb, "runner/agent"), ...(set ? { LANEB_TRIAL_ORDER: f } : { LANEB_TRIAL_ORDER: "" }) } });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }
  test("order.json reorders the job's trials; without it Harbor's order stands", () => {
    const r = py([["b", "gstack"], ["a", "none"], ["b", "none"], ["a", "gstack"]]);
    expect(r.out).toContain("['b/gstack', 'a/none', 'b/none', 'a/gstack']");
    expect(r.err).toContain("laneb order: applied 4 trials");
    expect(py([], false).out).toContain("['a/none', 'a/gstack', 'b/none', 'b/gstack']");
  });
  test("an order that misses, repeats or adds a trial fails the job, and an unreadable one exits 3", () => {
    for (const bad of [[["a", "none"], ["a", "gstack"], ["b", "none"]], [["a", "none"], ["a", "none"], ["b", "none"], ["b", "gstack"]], [["a", "none"], ["a", "gstack"], ["b", "none"], ["b", "gstack"], ["c", "none"]]]) {
      const r = py(bad);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("does not name each of the job's 4 trials once");
    }
    const u = py("not json");
    expect(u.code).toBe(3);
    expect(u.err).toContain("E_INTERNAL LANEB_TRIAL_ORDER could not be applied");
  });
});
