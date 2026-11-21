import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { answer, MARKER as STUB_MARKER } from "../../../lanes/codex-hooks/c/stub.ts";
import { cellCommands, exposure, parseHookLog, pilotFlags, readContractLog } from "../../../lanes/codex-hooks/c/contract.ts";
import { MARKER } from "../../../lanes/codex-hooks/c/pins.ts";
import { blockIndexes, lastAssistant, parseRollout, readSessionRollouts } from "../../../lanes/codex-hooks/c/rollout.ts";
import { blindRows, sessionStates } from "../../../lanes/codex-hooks/c/states.ts";

// The fixtures are real Codex 0.170.0 sessions with gstack at the pin (./setup --host codex), run against the keyless stub
// (lanes/codex-hooks/c/stub.ts), their long texts trimmed (tests/codex-hooks/c/fixtures/README.md).
const FIX = join(import.meta.dir, "fixtures");
const host = (name: string) => join(FIX, name, "host");
const read = (name: string) => {
  const r = readSessionRollouts(host(name));
  return { r, e: exposure(r, readContractLog(host(name))), f: pilotFlags(r) };
};
const KEY = randomBytes(32);
const cell = (arm: string) => ({ model: "gpt-6.1-sol", arm, unit: "garrytan/gstack#1@abc", pass: 1 });

describe("part C's rollout readouts over real Codex 0.170.0 rollouts (preregistration sections 5.3 and 5.6)", () => {
  // Value: protects=the root thread is init.json's thread, a sub-agent's rollout is a sub-agent thread with its parent, and each thread keeps its Codex version and its turns' model and effort; fails_when=a sub-agent's rollout is read as the root or a field is dropped; why_new=GEVA-562 part C; seam=readSessionRollouts, parseRollout; no_claim=rollouts of other Codex versions
  test("the root thread, a sub-agent's thread and their versions and turns", () => {
    const { r } = read("met");
    expect(r.problems).toEqual([]);
    expect(r.root?.id).toBe(r.thread_id!);
    expect(r.root?.cli_version).toBe("0.170.0");
    expect(r.root?.turns).toEqual([{ model: "gpt-6.1-sol", effort: "low" }]);
    expect(r.subs).toHaveLength(1);
    expect(r.subs[0]!.parent).toBe(r.root!.id);
    expect(lastAssistant(r.subs[0]!)).toBe("DONE");
    expect(parseRollout("not json\n", "x.jsonl").problems).toEqual(["x.jsonl:1 is not JSON", "x.jsonl has no session_meta record"]);
    expect(readSessionRollouts(join(FIX, "no-such")).problems).toEqual(["no init.json", "no rollout was copied"]);
  });

  // Value: protects=a contract block is read from the root rollout and the log alike: the log's blocked line names the missing items, both stops were evaluated, the rollout holds one Stop hook prompt, and the independent check finds neither the pass nor the report before it, so it is no false block; fails_when=the block is missed, the items are lost, or the second stop's miss line counts as a block; why_new=GEVA-562 part C (section 12's contract-block fixture); seam=exposure, parseHookLog, blockIndexes; no_claim=gstack's own decision
  test("a contract block", () => {
    const { e } = read("block");
    expect(e.log).toEqual({ present: true, stops: 2, evaluated: 2, events: { blocked: 1, miss: 1 }, blocked: 1, items: ["adversarial-pass", "review-report"], fail_open: 0, every_stop_evaluated: true });
    expect([e.rollout_blocks, e.pass, e.report, e.false_blocks, e.would_block]).toEqual([1, "never", false, 0, true]);
  });

  // Value: protects=a session that ran the adversarial pass (spawn_agent in the collaboration namespace with gstack's marker) and wrote the report before its first stop is a met session: one evaluated stop, no block, the pass before, and nothing the contract would have blocked; fails_when=the pass or the report is missed; why_new=GEVA-562 part C (section 12's met fixture); seam=exposure, spawns; no_claim=what the sub-agent found
  test("a met session", () => {
    const { e, f } = read("met");
    expect(e.log).toMatchObject({ stops: 1, evaluated: 1, events: { met: 1 }, blocked: 0, every_stop_evaluated: true });
    expect([e.rollout_blocks, e.pass, e.report, e.false_blocks, e.would_block]).toEqual([0, "before", true, 0, false]);
    expect(e.spawns).toEqual([{ line: expect.any(Number), via: "direct", namespace: "collaboration", marker: true, fork_turns: "none", model: null, reasoning_effort: null }]);
    expect(f).toEqual({ reads: [], unknown_namespace: 0, other_model: [], fork_not_none: 0, effort_override: 0 });
  });

  // Value: protects=a contract hook that fails open (its record folder made unwritable) reads as a fail-open stop the contract did not evaluate, with no block, so the pilot's "evaluated every stop and failed open in none" fails; fails_when=a state-error counts as an evaluation or is missed; why_new=GEVA-562 part C (section 12's fail-open fixture); seam=exposure, EVALUATED; no_claim=why gstack failed open
  test("a fail-open", () => {
    const { e } = read("failopen");
    expect(e.log).toEqual({ present: true, stops: 1, evaluated: 0, events: { "state-error": 1 }, blocked: 0, items: [], fail_open: 1, every_stop_evaluated: false });
    expect(parseHookLog(readContractLog(host("failopen"))!)[0]!.fields.why).toBe("cannot write record (EEXIST)");
  });

  // Value: protects=a block after a marker-bearing spawn_agent in a namespace gstack's reader does not know (multi_agent_v2) and the report is a false block, and the spawn is flagged as an unknown namespace (pre-run change 1, sections 6 and 7); fails_when=the independent check follows gstack's namespace rule, or the flag is missed; why_new=GEVA-562 part C (section 12's false-block fixture); seam=exposure, pilotFlags; no_claim=what Codex does with that namespace
  test("a false block", () => {
    const { e, f } = read("falseblock");
    expect(e.log).toMatchObject({ blocked: 1, items: ["adversarial-pass"] });
    expect([e.rollout_blocks, e.pass, e.report, e.false_blocks, e.would_block]).toEqual([1, "before", true, 1, false]);
    expect(e.spawns[0]).toMatchObject({ namespace: "multi_agent_v2", marker: true });
    expect(f.unknown_namespace).toBe(1);
  });

  // Value: protects=with skill_contracts off gstack writes no contract log, and the independent check still says the contract would have blocked at the first stop; with no gstack there is no log either; fails_when=c-off's would-have-blocked count needs the log; why_new=GEVA-562 part C (section 5.6's c-off readout); seam=exposure; no_claim=gstack's own item list
  test("c-off and c-none: no log, and the independent check's would-block", () => {
    for (const n of ["off", "none"]) {
      const { e } = read(n);
      expect(e.log.present).toBe(false);
      expect([e.log.stops, e.rollout_blocks, e.would_block]).toEqual([0, 0, true]);
    }
  });

  // Value: protects=the first-stop state is the last assistant message before the first contract block and the final state the last one: with a json block before the block both parse (one finding, then two), and with none before it the first-stop state is "missing", so the judge extracts it key-blind; fails_when=the states swap, the first-stop state reads the hook's prompt, or a missing block counts as no findings; why_new=GEVA-562 part C (section 12's first-stop fixtures); seam=sessionStates, lastAssistant; no_claim=the judge's extraction
  test("first-stop and final states, with and without a json block", () => {
    const withBlock = sessionStates(cell("c-on"), read("block").r, KEY);
    expect(withBlock.map((s) => [s.state, s.blocked, s.same_as_final, s.outcome, s.findings.length])).toEqual([["final", true, false, "findings", 2], ["first_stop", true, false, "findings", 1]]);
    const noBlock = sessionStates(cell("c-on"), read("nojson").r, KEY);
    expect(noBlock.map((s) => [s.state, s.outcome, s.findings.length])).toEqual([["final", "findings", 1], ["first_stop", "missing", 0]]);
    expect(noBlock[1]!.text).toContain("src/a.ts sets a to 2");
    expect(blockIndexes(read("nojson").r.root!)).toHaveLength(1);
  });

  // Value: protects=a contract-arm session the contract never blocked has a first-stop row equal to its final state, sharing its blind id so the judge reads it once; c-off and c-none get final states only; the blind copy hides arm, state, pass and model; fails_when=an unblocked session gets two packets, a no-gstack arm gets a first-stop state, or the blind copy leaks the cell; why_new=GEVA-562 part C (sections 5.3 and 5.5); seam=sessionStates, blindRows; no_claim=the judge's seeded order
  test("an unblocked session's first-stop state is its final state, and the blind copy hides the cell", () => {
    const met = sessionStates(cell("c-on"), read("met").r, KEY);
    expect(met.map((s) => [s.state, s.same_as_final])).toEqual([["final", false], ["first_stop", true]]);
    expect(met[0]!.blind_id).toBe(met[1]!.blind_id);
    expect(sessionStates(cell("c-off"), read("off").r, KEY).map((s) => s.state)).toEqual(["final"]);
    expect(sessionStates(cell("c-none"), read("none").r, KEY).map((s) => s.state)).toEqual(["final"]);
    const blind = blindRows([...met, ...sessionStates(cell("c-on"), read("block").r, KEY)]);
    expect(blind).toHaveLength(3);
    for (const b of blind) expect(Object.keys(b).sort()).toEqual(["blind_id", "findings", "outcome", "text", "unit"]);
    expect(sessionStates(cell("c-on"), read("met").r, randomBytes(32))[0]!.blind_id).not.toBe(met[0]!.blind_id);
  });

  // Value: protects=pre-run change 1's read-shape flags fire on a code-mode cell that reads the review SKILL.md with a sed range that quits early, inside bash -lc and through <, with exit null because a cell's nested calls report none; a direct shell call is flagged only when it exits non-zero with no text; fails_when=a shape is missed, or a direct read that printed text is flagged; why_new=GEVA-562 pre-run change 1, section 7; seam=pilotFlags, cellCommands; no_claim=whether the read loaded the skill
  test("SKILL.md read shapes in a code-mode cell and in direct calls", () => {
    const { f, e } = read("codemode");
    expect(f.reads.map((x) => [x.via, x.shape, x.exit, x.flagged])).toEqual([["code-mode", "sed-quit", null, true], ["code-mode", "shell-c", null, true], ["code-mode", "redirect", null, true]]);
    expect(e.log.items).toEqual(["adversarial-pass"]);
    expect(cellCommands("await tools.exec_command({ cmd: 'cat a' }); await tools.exec_command(\"ls\")")).toEqual(["cat a", "ls"]);
    const direct = (cmd: string, output: string) => {
      const lines = [
        { type: "session_meta", payload: { id: "t", source: "exec", cli_version: "0.170.0" } },
        { type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: JSON.stringify({ cmd }) } },
        { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output } },
        { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } },
      ];
      const t = parseRollout(lines.map((l) => JSON.stringify(l)).join("\n"), "x").thread!;
      return pilotFlags({ thread_id: "t", root: t, subs: [], problems: [] }).reads.map((x) => [x.shape, x.exit, x.text, x.flagged]);
    };
    expect(direct("bash -lc 'cat ~/.codex/skills/gstack-review/SKILL.md'", "Process exited with code 1\nOutput:\n")).toEqual([["shell-c", 1, false, true]]);
    expect(direct("bash -lc 'cat ~/.codex/skills/gstack-review/SKILL.md'", "Process exited with code 1\nOutput:\ncat: x: No such file or directory")).toEqual([["shell-c", 1, true, false]]);
    expect(direct("cat < ~/.codex/skills/gstack-review/SKILL.md", "Process exited with code 0\nOutput:\n---\nname: review")).toEqual([["redirect", 0, true, false]]);
    expect(direct("sed -n '1,200p;201q' ~/.codex/skills/gstack-review/SKILL.md", "Process exited with code 0\nOutput:\n---")).toEqual([["sed-quit", 0, true, true]]);
    expect(direct("grep -n description ~/.codex/skills/gstack-review/SKILL.md", "Process exited with code 0\nOutput:\ndescription: x")).toEqual([]);
  });

  // Value: protects=a sub-agent the model starts on another model and effort (spawn_agent's model and reasoning_effort overrides) is flagged from the spawn's arguments and from the sub-agent's own turns, and the session still reads as met; fails_when=the override is missed or blocks the contract readout; why_new=GEVA-562 pre-run change 1, section 10; seam=pilotFlags; no_claim=whether the override changed the review
  test("a sub-agent on another model", () => {
    const { e, f } = read("override");
    expect(e.log.events).toEqual({ met: 1 });
    expect(f.other_model.map((x) => [x.model, x.via])).toEqual([["gpt-6.2-sol", "spawn"], ["gpt-6.2-sol", "turn"]]);
    expect(f.effort_override).toBe(1);
    expect(read("override").r.subs[0]!.turns).toEqual([{ model: "gpt-6.2-sol", effort: "high" }]);
  });

  // Value: protects=the stub that made these fixtures answers each scenario from the request alone, and its marker is gstack's; fails_when=a scenario's reply changes, so a recaptured fixture means something else; why_new=GEVA-562 part C; seam=lanes/codex-hooks/c/stub.ts answer; no_claim=a real model's behaviour
  test("the stub's scenarios", () => {
    const req = (text: string, extra: object[] = []) => ({ input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }, ...extra] });
    expect(STUB_MARKER).toBe(MARKER);
    expect(answer(req("other work"))).toMatchObject({ type: "message", content: [{ text: "DONE" }] });
    expect(answer(req("[stub:met]"))).toMatchObject({ type: "function_call", name: "spawn_agent", namespace: "collaboration" });
    expect(answer(req("[stub:falseblock]"))).toMatchObject({ namespace: "multi_agent_v2" });
    expect(answer(req("[stub:codemode]"))).toMatchObject({ type: "custom_tool_call", name: "exec" });
    expect(JSON.parse((answer(req("[stub:override]")) as any).arguments)).toMatchObject({ model: "gpt-6.2-sol", reasoning_effort: "high" });
    expect((answer(req("[stub:block]")) as any).content[0].text).toContain("One finding.");
    expect((answer(req("[stub:block]", [{ type: "message", role: "user", content: [{ type: "input_text", text: '<hook_prompt hook_run_id="stop:2:x">' }] }])) as any).content[0].text).toContain("two findings");
  });
});
