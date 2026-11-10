// Family SM's session runner parts (the implicit state machines prereg, sections 4, 6, 9, 11 and 13): the seeded plan,
// end kinds and the one-retry rule, the exposure detectors and read audit, and real_agent's family SM mode (its turn
// text, the no-answer rule and the pre-session tree and home check), the last run in python3 with the SDK stubbed as
// tests/real-outcome/agent-units.test.ts does.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistry, REGISTRY_PATH } from "../../lanes/outcome-skills/arms/registry.ts";
import { smTurn } from "../../lanes/outcome-skills/statemachines/arms.ts";
import { auditByArm, readAudit } from "../../lanes/outcome-skills/statemachines/audit.ts";
import { qaExposure, textExposure } from "../../lanes/outcome-skills/statemachines/exposure.ts";
import { fixtureRow } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { runSession } from "../../lanes/outcome-skills/statemachines/run.ts";
import { endKind, nextStep, planPart, questionCounts, sessionEnd, type PlannedSession } from "../../lanes/outcome-skills/statemachines/session.ts";
import { toCandidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import { writeUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";

const py = (code: string, ...args: string[]) => {
  const r = spawnSync("python3", ["-c", code, join(import.meta.dir, "../real-outcome"), ...args], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8" });
  if (r.status !== 0) console.log(r.stdout + r.stderr);
  return r.stdout;
};

// Value: protects=sections 9 and 13's seeded order; fails_when=the order stops being a function of the seed and part, a follow-on precedes its tree's first stage, or a cell is missing; why_new=GEVA-436 P2; seam=session.ts planPart; no_claim=which units are in a part (P1 draw)
test("the plan is seeded, holds every cell once per unit and model, and puts follow-ons after their tree's first stage", () => {
  const a = planPart(["u1", "u2"], ["claude-opus-5-5", "particle-ai/particle-1"], 1512176772, 1);
  expect(planPart(["u1", "u2"], ["claude-opus-5-5", "particle-ai/particle-1"], 1512176772, 1)).toEqual(a);
  expect(planPart(["u1", "u2"], ["claude-opus-5-5", "particle-ai/particle-1"], 1512176772, 2).map((s) => s.cell)).not.toEqual(a.map((s) => s.cell));
  expect(a).toHaveLength(2 * 2 * (4 + 9));
  for (const unit of ["u1", "u2"])
    for (const model of ["claude-opus-5-5", "particle-ai/particle-1"]) {
      const mine = a.filter((s) => s.unit === unit && s.model === model);
      expect(mine.filter((s) => s.stage === "first").map((s) => s.cell).sort()).toEqual(["A0", "A1", "A2", "S2"]);
      expect(mine.filter((s) => s.stage === "followon").map((s) => s.cell).sort()).toEqual(["S0", "A1", "S2"].flatMap((t) => [1, 2, 3].map((r) => "F-" + t + "-" + r)).sort());
      const firstAt = (cell: string) => mine.find((s) => s.cell === cell)!.index;
      for (const f of mine.filter((s) => s.after)) expect(f.index).toBeGreaterThan(firstAt(f.after!));
    }
  expect(new Set(a.filter((s) => s.unit === "u1" && s.model === "claude-opus-5-5" && s.stage === "first").map((s) => s.arm))).toEqual(new Set(["sm:A0", "sm:A1", "sm:A2", "sm:S2"]));
  expect(planPart(["u1"], ["claude-opus-5-5"], 7, 1, ["qa"]).map((s) => [s.cell, s.arm])).toEqual([["A3", "qa:told"]]);
  expect(() => planPart(["u1"], ["m"], -1, 1)).toThrow(/E_SM_SEED/);
});

// Value: protects=section 6's end kinds and the one-retry rule; fails_when=a limit counts as a gap, an upstream end is scored, or a third try is allowed; why_new=GEVA-436 P2; seam=session.ts endKind, nextStep; no_claim=gap propagation across contrasts (P4)
test("end kinds map from real_agent's termination, and upstream or infra ends retry once, then gap", () => {
  expect(["completed", "bg_wait_expired", "wall_limit", "turn_ceiling", "error_result", "cli_exit", "error"].map((termination) => endKind({ termination }))).toEqual(["completed", "completed", "limit_wall", "limit_turns", "upstream", "infra", "infra"]);
  expect(endKind({ termination: "error_result", refusals: ["E_ALLOWANCE"] })).toBe("upstream");
  expect(endKind({ termination: "error_result", refusals: ["E_ALLOWANCE"], allowance_stop: true })).toBe("limit_allowance");
  expect(endKind({ termination: "error", upstream_status: 529 })).toBe("upstream");
  expect(endKind({ termination: "completed", harness: true })).toBe("infra");
  expect(nextStep(["completed"])).toEqual({ action: "score" });
  expect(nextStep(["limit_turns"])).toEqual({ action: "score" });
  expect(nextStep(["upstream"])).toEqual({ action: "retry" });
  expect(nextStep(["upstream", "upstream"])).toEqual({ action: "gap", code: "E_SM_UPSTREAM_GAP" });
  expect(nextStep(["upstream", "infra"])).toEqual({ action: "gap", code: "E_SM_INFRA_GAP" });
  expect(nextStep(["infra", "completed"])).toEqual({ action: "score" });
  expect(questionCounts({ t1: { questions: 3, ask_user_question: 2, prose_questions: 1 } })).toEqual({ ask_user_question: 2, prose: 1 });
});

const msg = (blocks: any[], parent: string | null = null) => ({ type: "AssistantMessage", parent_tool_use_id: parent, content: blocks });
// Value: protects=section 11's exposure gates and section 4's read audit; fails_when=text before the first tool call counts, a subagent's text counts, or a gstack or drive read goes uncounted; why_new=GEVA-436 P2; seam=exposure.ts, audit.ts; no_claim=that exposure means the procedure ran well
test("exposure reads the assistant's own text after its first tool call, /qa needs all three marks, and the read audit counts per arm", () => {
  const before = [msg([{ type: "text", text: "I will map each state machine." }]), msg([{ type: "tool_use", name: "Read", input: { file_path: "/testbed/a.js" } }]), msg([{ type: "text", text: "Fixed it." }])];
  expect(textExposure(before as any, "A1")).toBe(false);
  expect(textExposure([...before, msg([{ type: "text", text: "This is a state transition." }], "toolu_x")] as any, "A1")).toBe(false);
  expect(textExposure([...before, msg([{ type: "text", text: "The Transition table is explicit now." }])] as any, "A1")).toBe(true);
  expect(textExposure([...before, msg([{ type: "text", text: "I restructured the loader." }])] as any, "S2")).toBe(true);
  const I = "/root/.claude/skills/gstack";
  const qa = [msg([{ type: "tool_use", name: "Bash", input: { command: "~/.claude/skills/gstack/bin/gstack-skill-start qa" } }]), msg([{ type: "tool_use", name: "Read", input: { file_path: I + "/qa/SKILL.md" } }])];
  expect(qaExposure(qa as any).exposed).toBe(false);
  expect(qaExposure([...qa, msg([{ type: "tool_use", name: "Read", input: { file_path: I + "/qa/sections/fix-loop.md" } }])] as any)).toEqual({ skill_start: true, skill_md: true, section: true, exposed: true });
  const reads = readAudit([msg([{ type: "tool_use", name: "Bash", input: { command: "ls ~/.capy/drive" } }, { type: "tool_use", name: "Glob", input: { pattern: "~/.claude/skills/**" } }, { type: "tool_use", name: "Edit", input: { file_path: "gstack.txt" } }, { type: "tool_use", name: "Read", input: { file_path: "src/a.js" } }])] as any);
  expect([reads.inputs, reads.gstack, reads.drive]).toEqual([3, 1, 1]);
  expect(auditByArm([{ cell: "A0", audit: reads }, { cell: "A0", audit: readAudit([]) }])).toEqual({ A0: { sessions: 2, gstack: 1, drive: 1 } });
});

// Value: protects=real_agent's family SM turn equals the registry's; fails_when=python and TypeScript substitute the scope or trim the issue differently; why_new=GEVA-436 P2; seam=sm_user.py sm_turn, arms.ts smTurn; no_claim=SDK delivery (sm-claude.test.ts)
test("real_agent's family SM turn is smTurn's, for every arm but the unpinned qa:told", () => {
  const reg = loadRegistry();
  const cases = [{ arm: "sm:A0", scope: "src/a b" }, { arm: "sm:A1", scope: "$&lib" }, { arm: "sm:A2", scope: "x" }, { arm: "sm:S2", scope: "pkg/core" }, { arm: "sm:followon", statement: "Bug: crash.\u00a0\n\n" }];
  const out = py("import json, sys; sys.path.insert(0, sys.argv[1]); import unit_test as u; import sm_user; reg = json.load(open(sys.argv[2])); print(json.dumps([sm_user.sm_turn(reg['sm']['arms'][c['arm']], {'scope': c.get('scope')}, c.get('statement', ''), u.ra.js_trim_end) for c in json.loads(sys.argv[3])]))", REGISTRY_PATH, JSON.stringify(cases));
  expect(JSON.parse(out)).toEqual(cases.map((c) => smTurn(reg, c.arm, c)));
});

// Value: protects=section 6's no-answer rule and section 4's clean-by-construction check in real_agent; fails_when=a stripped file, a wrong commit count, a gstack or drive path in a no-gstack home, or A3's install at another sha passes; why_new=GEVA-436 P2; seam=real_agent.py _open_sm, sm_user.py NoAnswer; no_claim=a real container (P5's dry run)
test("real_agent's family SM mode answers nobody and refuses an unclean tree or home before any session opens", () => {
  const code = `
import json, sys, tempfile, types
sys.path.insert(0, sys.argv[1])
import unit_test as u
from pathlib import Path
import sm_user
ra = u.ra
n = sm_user.NoAnswer("No one is available to answer. Use your own judgment.", Path(tempfile.mkdtemp()) / "e.jsonl")
n.start("t1")
out = {"answers": n.answer([{"question": "Which?"}, {"question": "Why?"}]), "prose": [n.prose("Shall I go on?"), n.prose("Done. Fixed it.")], "counts": n.counts}
ra.egress.apply = lambda c, allow: {"event": "egress", "allow": allow}
def check(stdout, told, commits=1, sha="a" * 40):
    fake = types.SimpleNamespace(options=types.SimpleNamespace(probe_node=""), _exec=lambda c, s, stdin=None, timeout=0: types.SimpleNamespace(returncode=0, stdout=stdout.encode(), stderr=b""))
    task = {"repo_dir": "/testbed", "commits": commits, "base_commit": "b" * 40, "qa_sha": sha}
    try:
        ra.RealAgent._open_sm(fake, "c", "t", task, "http://10.0.0.2:9000", told, lambda e: None)
        return "ok"
    except ra.SandboxSetupError as e:
        return str(e).split(" ")[0]
clean = "COMMITS 1\\nHEAD " + "b" * 40 + "\\n"
out["checks"] = [check(clean, False), check(clean + "INSTR ./pkg/AGENTS.md\\n", False), check(clean, False, commits=2), check(clean + "HOME /root/.capy\\n", False), check(clean + "HOME /root/.claude/skills\\nGSTACK " + "a" * 40 + "\\n", True), check(clean + "GSTACK " + "c" * 40 + "\\n", True), check(clean, True)]
print(json.dumps(out))
`;
  const out = JSON.parse(py(code));
  const reply = "No one is available to answer. Use your own judgment.";
  expect(out.answers).toEqual({ "Which?": reply, "Why?": reply });
  expect(out.prose).toEqual([null, null]);
  expect(out.counts).toEqual({ t1: { questions: 3, ask_user_question: 2, prose_questions: 1 } });
  expect(out.checks).toEqual(["ok", "E_SM_STRIP", "E_SM_HISTORY", "E_SM_STRIP", "ok", "E_SM_STRIP", "E_SM_STRIP"]);
});

// Value: protects=section 6's end kind from real_agent's summary; fails_when=a count or a missing refusals is read as no refusals, or unknown_micros is dropped or written as 0; why_new=#290 review (red team CRITICAL); seam=session.ts sessionEnd; no_claim=the driver's close answer (sm-driver.test.ts)
test("sessionEnd reads the refusal codes and unknown_micros real_agent copied, refuses refusals that are not an array of codes, and leaves a harness failure as infra", () => {
  const proxy = { spent_micros: 5, requests: 3, ok_responses: 1, refused: 1, refusals: ["E_ALLOWANCE"], allowance_stops: 1, unknown_micros: 7, unknown_calls: 1 };
  expect(sessionEnd({ termination: "error_result", proxy }, false)).toEqual({ end: "limit_allowance", unknown_micros: 7 });
  expect(nextStep([sessionEnd({ termination: "error_result", proxy }, false).end])).toEqual({ action: "score" });
  expect(sessionEnd({ termination: "error_result", proxy: { ...proxy, allowance_stops: 0 } }, false)).toEqual({ end: "upstream", unknown_micros: 7 });
  expect(nextStep([sessionEnd({ termination: "error_result", proxy: { ...proxy, allowance_stops: 0 } }, false).end])).toEqual({ action: "retry" });
  expect(sessionEnd({ termination: "error_result", proxy: { ...proxy, refused: 0, refusals: [], allowance_stops: 0 } }, false)).toEqual({ end: "upstream", unknown_micros: 7 });
  expect(nextStep([sessionEnd({ termination: "error_result", proxy: { ...proxy, refusals: ["UPSTREAM"], allowance_stops: 0 } }, false).end])).toEqual({ action: "retry" });
  expect(() => sessionEnd({ termination: "error_result", proxy: { ...proxy, allowance_stops: undefined } }, false)).toThrow(/^E_SM_ARM /);
  expect(() => sessionEnd({ termination: "error_result", proxy: { ...proxy, allowance_stops: "1" } }, false)).toThrow(/^E_SM_ARM /);
  expect(() => sessionEnd({ termination: "error_result", proxy: { ...proxy, refusals: 1 } }, false)).toThrow(/^E_SM_ARM /);
  expect(() => sessionEnd({ termination: "error_result", proxy: { ...proxy, refusals: undefined } }, false)).toThrow(/^E_SM_ARM /);
  expect(() => sessionEnd({ termination: "error_result", proxy: { ...proxy, refusals: [402] } }, false)).toThrow(/^E_SM_ARM /);
  expect(() => sessionEnd({ termination: "completed", proxy: { ...proxy, unknown_micros: null } }, false)).toThrow(/^E_SM_ARM /);
  expect(sessionEnd(null, true)).toEqual({ end: "infra", unknown_micros: 0 });
  expect(sessionEnd({ termination: "completed", proxy: { refused: 1 } }, true)).toEqual({ end: "infra", unknown_micros: 0 });
});

// Value: protects=the record of a session whose close answer never came; fails_when=real_agent's all-null proxy block throws, so runSession writes no record for a session that spent and the infra retry never runs, or a block with only some fields set is read as a failed close; why_new=#290 pass two; seam=session.ts sessionEnd; no_claim=the spend of that session, which stays on its lease
test("a session whose close answer never came ends as infra, while a block with only some fields set is still refused", () => {
  const none = { spent_micros: null, requests: null, ok_responses: null, refused: null, refusals: null, allowance_stops: null, unknown_micros: null, unknown_calls: null };
  expect(sessionEnd({ termination: "completed", proxy: none }, false)).toEqual({ end: "infra", unknown_micros: 0 });
  expect(nextStep([sessionEnd({ termination: "error_result", proxy: none }, false).end])).toEqual({ action: "retry" });
  expect(sessionEnd({ termination: "completed", proxy: {} }, false)).toEqual({ end: "infra", unknown_micros: 0 });
  expect(() => sessionEnd({ termination: "completed", proxy: { ...none, spent_micros: 5 } }, false)).toThrow(/^E_SM_ARM /);
});

// Value: protects=section 6's limit for a real allowance stop whose proxy finalize failed: it is scored as is and never retried, so it can't spend a second time; fails_when=a close answer with finalized false and a known allowance_stops above 0 ends infra and gets a retry, or one whose count is unknown (null) or 0 is scored; why_new=#314 review note 8 (adversarial-native, Low); seam=session.ts sessionEnd; no_claim=the driver's close path, where allowance_stops is null whenever finalized is false, so that item halts instead (sm-predata.test.ts)
test("a known allowance stop ends limit_allowance even when finalize failed, and an unknown or zero count still ends infra", () => {
  const failed = { spent_micros: 5, requests: null, ok_responses: null, refused: null, refusals: null, allowance_stops: 1, unknown_micros: 7, unknown_calls: 1, finalized: false };
  expect(sessionEnd({ termination: "error_result", proxy: failed }, false)).toEqual({ end: "limit_allowance", unknown_micros: 7 });
  expect(nextStep([sessionEnd({ termination: "error_result", proxy: failed }, false).end])).toEqual({ action: "score" });
  for (const allowance_stops of [null, 0]) {
    expect(sessionEnd({ termination: "error_result", proxy: { ...failed, allowance_stops } }, false)).toEqual({ end: "infra", unknown_micros: 7 });
    expect(nextStep([sessionEnd({ termination: "error_result", proxy: { ...failed, allowance_stops } }, false).end])).toEqual({ action: "retry" });
  }
  expect(sessionEnd({ termination: "completed", proxy: failed }, true)).toEqual({ end: "infra", unknown_micros: 7 });
});

// Value: protects=A3's /qa pin on the path that runs; fails_when=qa:told builds its turn with no recorded pin, or with a task qa_sha that is not the pin; why_new=#290 review (red team); seam=sm_user.py sm_turn; no_claim=the install at that pin (real_agent _open_sm)
test("real_agent's qa:told turn refuses a null or missing /qa pin and a task qa_sha that is not the pin", () => {
  const code = `
import json, sys
sys.path.insert(0, sys.argv[1])
import unit_test as u
import sm_user
spec = json.load(open(sys.argv[2]))["sm"]["arms"]["qa:told"]
a = "a" * 40
def turn(pin, sha):
    try:
        return sm_user.sm_turn(spec, {"scope": "src", "qa_sha": sha}, "", u.ra.js_trim_end, pin)
    except ValueError:
        return "refused"
print(json.dumps([turn(None, a), turn({"sha": None}, a), turn({}, a), turn({"sha": a}, "b" * 40), turn({"sha": a}, a)]))
`;
  const spec = loadRegistry().sm!.arms["qa:told"]!;
  expect(JSON.parse(py(code, REGISTRY_PATH))).toEqual(["refused", "refused", "refused", "refused", spec.turns[0]!.text.replace("{scope}", "src")]);
});

// Value: protects=section 4's clean home for A3, which may hold only the /qa install (its skills dir and the ~/.gstack state its setup writes); fails_when=a drive, a home CLAUDE.md or a stray gstack checkout passes in a told arm; why_new=#290 review (security specialist); seam=real_agent.py _open_sm; no_claim=a real container (P5's dry run)
test("real_agent's family SM check refuses a drive, a home CLAUDE.md or a stray gstack in A3's home, and passes the /qa install's own paths", () => {
  const code = `
import json, sys, types
sys.path.insert(0, sys.argv[1])
import unit_test as u
ra = u.ra
ra.egress.apply = lambda c, allow: {"event": "egress", "allow": allow}
def check(stdout):
    fake = types.SimpleNamespace(options=types.SimpleNamespace(probe_node=""), _exec=lambda c, s, stdin=None, timeout=0: types.SimpleNamespace(returncode=0, stdout=stdout.encode(), stderr=b""))
    task = {"repo_dir": "/testbed", "commits": 1, "base_commit": "b" * 40, "qa_sha": "a" * 40}
    try:
        ra.RealAgent._open_sm(fake, "c", "t", task, "http://10.0.0.2:9000", True, lambda e: None)
        return "ok"
    except ra.SandboxSetupError as e:
        return str(e).split(" ")[0]
qa = "COMMITS 1\\nHEAD " + "b" * 40 + "\\nHOME /root/.claude/skills\\nHOME /root/.gstack\\nGSTACK " + "a" * 40 + "\\n"
print(json.dumps([check(qa), check(qa + "HOME /root/.capy\\n"), check(qa + "HOME /root/.claude/CLAUDE.md\\n"), check(qa + "HOME /root/.local/share/gstack\\n")]))
`;
  expect(JSON.parse(py(code))).toEqual(["ok", "E_SM_STRIP", "E_SM_STRIP", "E_SM_STRIP"]);
});

// Value: protects=A3's /qa pin in run.ts before any image is built; fails_when=A3 runs while registry.json sm.pins.qa.sha is null or another sha than --qa-sha; why_new=#290 review (red team); seam=run.ts runSession; no_claim=a pinned A3 run
test("runSession refuses A3 unless --qa-sha is registry.json's /qa pin, before any image is built", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "sm-run-")), "u");
  writeUnit(dir, { ...toCandidate("rust", fixtureRow()), image_digest: "sha256:" + "c".repeat(64) }, fixtureRow());
  const session: PlannedSession = { unit: "u", part: 1, index: 0, model: "claude-opus-5-5", cell: "A3", stage: "first", arm: "qa:told" };
  const qaSha = loadRegistry().sm!.pins.qa.sha === "a".repeat(40) ? "b".repeat(40) : "a".repeat(40);
  expect(() => runSession({ unitDir: dir, session, control: "http://127.0.0.1:1", proxy: "127.0.0.1:1", out: join(dir, "../out"), qaHome: dir, qaSha })).toThrow(/^E_SM_ARM .*\/qa pin/);
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  reg.sm.pins.qa = { ...reg.sm.pins.qa, sha: null, version: null, install: null };
  const registry = join(dir, "../unpinned.json");
  writeFileSync(registry, JSON.stringify(reg));
  expect(() => runSession({ unitDir: dir, session, control: "http://127.0.0.1:1", proxy: "127.0.0.1:1", out: join(dir, "../out"), qaHome: dir, qaSha: "a".repeat(40), registry })).toThrow(/^E_SM_ARM .*\/qa pin.* the pin is null/);
});
