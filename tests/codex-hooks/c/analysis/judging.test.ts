// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../../../lanes/review-noloss/suite.ts";
import { analyze } from "../../../../lanes/codex-hooks/c/analysis/analysis.ts";
import { ROUTES, SEED } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { joinReplies, readExtraction } from "../../../../lanes/codex-hooks/c/analysis/join.ts";
import { addRulings, joinLabels, judgedStates, kappa, loadKey, readSets, writeAdjudicate, writeExtract, writeMatch, type CodeAt, type Counted, type Key } from "../../../../lanes/codex-hooks/c/analysis/judging.ts";
import { readStates, type StatesFile } from "../../../../lanes/codex-hooks/c/analysis/record.ts";
import { firstObject, readBatch, runExtract, runJudged, type Send } from "../../../../lanes/codex-hooks/c/analysis/run.ts";
import { scoreSessions } from "../../../../lanes/codex-hooks/c/analysis/score.ts";
import { at, cleanup, jsonl, loaded, maps, message, miss, NO_FINDINGS_MESSAGE, session, suite, tmp, unitOf, fakeAnswer, type Persona, type Spec } from "./helpers.ts";

afterAll(cleanup);

const A = unitOf(3593);
const B = unitOf(3524);
const C = unitOf(7884);
const units = [A, B, C];
const codeAt: CodeAt = (_u, path, line) => (path ? { code: { path, from: Math.max(1, (line ?? 1) - 1), to: (line ?? 1) + 1, text: "  code at the head" }, code_note: null } : { code: null, code_note: "no file" });
const setup = (specs: Spec[]) => {
  const text = jsonl(specs.flatMap(session));
  const states = readStates(text, suite, { passes: 1, units: units.map((u) => u.id) });
  return { text, states, base: (dir: string, stage: string, seed = SEED) => ({ suite, suiteSha256: loaded.sha256, states, statesSha256: sha256(text), maps, seed, out: join(dir, stage), key: join(dir, stage + "-key.json") }) };
};
const filesIn = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json")).map((f) => readFileSync(join(dir, f), "utf8"));

/** The scenario the end-to-end run judges: every path a state can take through the three batches. */
const SCENARIO: Spec[] = [
  { arm: "c-on", unit: A, first: [at(A, "B1")], final: [at(A, "B1"), at(A, "B2", "Informational")] },
  { arm: "c-on", unit: B, final: [miss(1, "Critical", "A real defect in the cache key")] },
  { arm: "c-on", unit: C, final: [] },
  { arm: "c-off", unit: A, final: { message: message([at(A, "B1")]) } },
  { arm: "c-off", unit: B, final: [at(B, "B1", "Critical", "Please refuse this one")] },
  { arm: "c-off", unit: C, final: [miss(2, "Critical", "Not a problem at all")] },
  { arm: "c-high", unit: A, final: [at(A, "B1"), at(A, "B2", "Critical", "A subtle off by one in the budget")] },
  { arm: "c-high", unit: B, final: { message: NO_FINDINGS_MESSAGE } },
  { arm: "c-none", unit: A, final: [at(A, "B2", "HIGH", "Retry once: the budget is wrong")] },
  { arm: "c-none", unit: B, outcome: "gap", code: "UPSTREAM" },
  { arm: "c-none", unit: C, final: [at(C, C.blockers[0]!.id, "BLOCKER", "The known case raised again")] },
];

describe("packets", () => {
  const { states, base, text } = setup(SCENARIO);
  const dir = tmp("chc-packets-");
  const extract = writeExtract(base(dir, "extract"));
  const counted: Counted = new Map([...extract.packets.map((p) => [p.state!, [] as never[]] as const)]);
  const m = writeMatch({ ...base(dir, "match"), counted, anchors: [] });

  test("extraction holds one packet per state with no json block, and only its message and unit", () => {
    expect(extract.packets.map((p) => p.state).sort()).toEqual(states.states.filter((s) => s.record.no_block).map((s) => s.id).sort());
    const p = JSON.parse(readFileSync(join(dir, "extract", extract.packets[0]!.file), "utf8"));
    expect(Object.keys(p).sort()).toEqual(["message", "stage", "suite", "unit", "version"]);
    expect(JSON.parse(readFileSync(join(dir, "extract", "batch.json"), "utf8")).extract_rule).toMatch(/word for word, or "unlabelled"/);
  });

  test("matching holds one packet per state with counted findings: a blocked session's two states are two packets", () => {
    const judged = states.states.filter((s) => !s.record.no_block && s.record.findings!.length);
    expect(m.key.packets.map((p) => p.state).sort()).toEqual(judged.map((s) => s.id).sort());
    expect(m.key.packets.filter((p) => p.state!.startsWith("s-c-on-gstack-3593")).length).toBe(2);
    expect(m.mechanical.sort()).toEqual(states.states.filter((s) => (s.record.no_block ? true : !s.record.findings!.length)).map((s) => s.id).sort());
  });

  test("nothing a judge reads names an arm, a state, a session or a severity", () => {
    const hidden = ["c-on", "c-off", "c-high", "c-none", "first_stop", "final", "s-c-", "#first", "\"arm\"", "\"pass\""];
    for (const t of filesIn(join(dir, "extract"))) for (const w of hidden) expect(t).not.toContain(w);
    for (const t of filesIn(join(dir, "match"))) for (const w of [...hidden, "HIGH", "BLOCKER", "Critical", "Informational", "\"severity\""]) expect(t).not.toContain(w);
    expect(readdirSync(join(dir, "match")).sort()).toEqual(["batch.json", "packets"]);
  });

  test("the key stays outside the batch and maps every finding back to its state", () => {
    expect(existsSync(join(dir, "match-key.json"))).toBe(true);
    expect(m.key.entries.every((e) => e.state && states.states.some((s) => s.id === e.state))).toBe(true);
    expect(m.key.states_sha256).toBe(sha256(text));
  });

  test("the order is seeded: the same seed gives the same batch, another seed another order", () => {
    const again = writeMatch({ ...base(tmp(), "match"), counted, anchors: [] });
    expect(again.key.batch).toBe(m.key.batch);
    expect(again.key.packets.map((p) => p.state)).toEqual(m.key.packets.map((p) => p.state));
    const other = writeMatch({ ...base(tmp(), "match", SEED + 7), counted, anchors: [] });
    expect(other.key.batch).not.toBe(m.key.batch);
    expect(other.key.packets.map((p) => p.state)).not.toEqual(m.key.packets.map((p) => p.state));
  });

  test("a severity word in a claim is masked", () => {
    const s = setup([{ arm: "c-on", unit: A, final: [at(A, "B1", "Critical", "Critical: the budget check fails")] }]);
    const d = tmp();
    const r = writeMatch({ ...s.base(d, "match"), counted: new Map(), anchors: [] });
    const p = JSON.parse(readFileSync(join(d, "match", r.key.packets[0]!.file), "utf8"));
    expect(p.findings[0].text).toBe("[severity]: the budget check fails");
  });

  test("refuses a finding that names an arm or a state word, and a message that does", () => {
    const leak = setup([{ arm: "c-on", unit: A, final: [at(A, "B1", "Critical", "As the c-on arm would say, this is wrong")] }]);
    expect(() => writeMatch({ ...leak.base(tmp(), "match"), counted: new Map(), anchors: [] })).toThrow(/^E_CH_C_BLIND the packets would leak/);
    const word = setup([{ arm: "c-off", unit: A, final: { message: "The hook_prompt said to keep going.\n" } }]);
    expect(() => writeExtract(word.base(tmp(), "extract"))).toThrow(/^E_CH_C_BLIND the extraction packets would leak/);
  });

  test("refuses a key inside the batch, an existing key and a batch directory that is not empty", () => {
    const d = tmp();
    expect(() => writeExtract({ ...base(d, "extract"), key: join(d, "extract", "key.json") })).toThrow(/inside --out/);
    writeExtract(base(d, "extract"));
    expect(() => writeExtract({ ...base(d, "extract"), out: join(d, "other") })).toThrow(/already exists/);
    expect(() => writeExtract({ ...base(d, "extract"), key: join(d, "k2.json") })).toThrow(/is not empty/);
  });

  test("refuses a matching batch before extraction has answered", () => {
    expect(() => writeMatch({ ...base(tmp(), "match"), counted: new Map(), anchors: [] })).toThrow(/run the extraction batch first/);
  });

  test("loadKey refuses an edited key, another stage and another suite", () => {
    const path = join(dir, "match-key.json");
    expect(loadKey(path, { id: suite.id, sha256: loaded.sha256 }, "match").batch).toBe(m.key.batch);
    expect(() => loadKey(path, { id: suite.id, sha256: loaded.sha256 }, "adjudicate")).toThrow(/^E_CH_C_BLIND .* is not a part C adjudicate key/);
    expect(() => loadKey(path, { id: suite.id, sha256: "0".repeat(64) }, "match")).toThrow(/was built on suite/);
    const k = JSON.parse(readFileSync(path, "utf8")) as Key;
    k.entries[0]!.state = k.entries[1]!.state === k.entries[0]!.state ? "another" : k.entries[1]!.state;
    const edited = join(tmp(), "key.json");
    writeFileSync(edited, JSON.stringify(k));
    expect(() => loadKey(edited, { id: suite.id, sha256: loaded.sha256 }, "match")).toThrow(/edited or swapped/);
  });

  test("readBatch refuses a packet changed since the batch was written", () => {
    const d = tmp();
    const k = writeExtract(base(d, "extract"));
    expect(readBatch(join(d, "extract"), k).texts.size).toBe(k.packets.length);
    writeFileSync(join(d, "extract", k.packets[0]!.file), "{}");
    expect(() => readBatch(join(d, "extract"), k)).toThrow(/^E_CH_C_BLIND .* has changed/);
  });
});

describe("an end-to-end judging run with a fake model", () => {
  const { states, base } = setup(SCENARIO);
  const dir = tmp("chc-e2e-");
  const route = ROUTES.A;
  const calls: Array<{ role: string; model: string; file: string; attempt: number }> = [];
  const personas: Record<string, Persona> = {
    primary: { refuse: (p, attempt) => (p.findings ?? []).some((f) => /refuse/i.test(f.text) || (/retry once/i.test(f.text) && attempt === 1)) },
    second: { blind: (blocker) => blocker === "B2" },
    third: { blind: (_b, f) => /subtle/.test(f.text) },
  };
  const send: Send = async (r) => {
    calls.push({ role: r.role, model: r.model, file: r.file, attempt: r.attempt });
    return fakeAnswer(r.prompt, r.attempt, personas[r.role]);
  };
  const byId = (s: StatesFile, arm: string, u: typeof A, st = "final") => s.states.find((x) => x.record.arm === arm && x.record.unit === u.id && x.record.state === st)!.id;
  let ran: Awaited<ReturnType<typeof run>>;
  const run = async () => {
    const ek = writeExtract(base(dir, "extract"));
    const er = await runExtract({ b: readBatch(join(dir, "extract"), ek), suite, model: route.primary, send });
    const counted = readExtraction(ek, er.replies.primary!, er.unjudged);
    const m = writeMatch({ ...base(dir, "match"), counted, anchors: [] });
    const mb = readBatch(join(dir, "match"), m.key);
    const mr = await runJudged({ b: mb, suite, brief: "the brief", states, counted, maps, mechanical: m.mechanical, route, send });
    const mj = joinReplies<Set<string>>({ key: m.key, suite, states, counted, maps, mechanical: m.mechanical, primary: mr.replies.primary!, second: mr.replies.second!, third: mr.replies.third ?? null, unjudged: mr.unjudged });
    const judged = judgedStates({ key: m.key, states, counted, mechanical: m.mechanical, gaps: m.gaps, labels: mj.labels, dropped: mj.sets.dropped, route: "A", extractBatch: ek.batch });
    const ak = writeAdjudicate({ ...base(dir, "adjudicate"), judged, codeAt })!;
    const ar = await runJudged({ b: readBatch(join(dir, "adjudicate"), ak), suite, brief: "the brief", states, counted, maps, mechanical: m.mechanical, route, send });
    const aj = joinReplies<"defect" | "not-defect" | "known-informational">({ key: ak, suite, states, counted, maps, mechanical: m.mechanical, primary: ar.replies.primary!, second: ar.replies.second!, third: ar.replies.third ?? null, unjudged: ar.unjudged });
    const full = addRulings(judged, ak, aj.labels);
    return { ek, er, counted, m, mr, mj, judged, ak, ar, aj, full };
  };

  test("extraction lists a message's findings key-blind, and a real no-block message lists none", async () => {
    ran = await run();
    expect(ran.er.requests).toBe(2);
    expect(ran.counted.get(byId(states, "c-off", A))!.map((f) => [f.file, f.line, f.severity])).toEqual([["lib/ship-budget.ts", 306, "Critical"]]);
    expect(ran.counted.get(byId(states, "c-high", B))).toEqual([]);
  });

  test("the primary reads every packet, retries a refused answer once and leaves a packet refused twice unjudged", () => {
    const primary = calls.filter((c) => c.role === "primary" && c.model === route.primary && ran.m.key.packets.some((p) => p.file === c.file));
    expect(primary.length).toBe(9 + 2);
    expect(ran.mr.unjudged.map((u) => [u.role, ran.m.key.packets.find((p) => p.file === u.packet)!.state])).toEqual([["primary", byId(states, "c-off", B)]]);
    expect(ran.mr.unjudged[0]!.reason).toMatch(/no JSON object/);
    expect(ran.m.mechanical.sort()).toEqual([byId(states, "c-on", C), byId(states, "c-high", B)].sort());
  });

  test("the second reads every item of a bug-pass whose outcomes differ, plus a seeded 20% of the rest, and the third reads where they differ", () => {
    const sets = ran.mj.sets;
    expect(sets.differ).toBe(12);
    expect(sets.second.size).toBe(13);
    expect(sets.third!.size).toBe(3);
    expect([...sets.third!].every((k) => k.endsWith(" B2"))).toBe(true);
    expect(calls.filter((c) => c.role === "second" && ran.m.key.packets.some((p) => p.file === c.file)).length).toBe(8);
    expect(calls.filter((c) => c.role === "third" && ran.m.key.packets.some((p) => p.file === c.file)).map((c) => c.model)).toEqual([route.third, route.third, route.third]);
    expect(ran.mj.judges).toEqual({ primary: route.primary, second: route.second, third: route.third });
    expect(ran.mj.kappa_primary_second).toBe(kappa([...sets.second].map((k) => [ran.mj.primary.get(k)!.size ? 1 : 0, sets.third!.has(k) ? 1 - (ran.mj.primary.get(k)!.size ? 1 : 0) : ran.mj.primary.get(k)!.size ? 1 : 0] as const)));
  });

  test("the joined label is the third read's where it read, else the primary's", () => {
    const state = (arm: string, u: typeof A) => ran.judged.states.find((j) => j.id === byId(states, arm, u))!;
    expect(state("c-high", A).matches).toEqual({ B1: [0], B2: [] });
    expect(state("c-on", A).matches).toEqual({ B1: [0], B2: [1] });
    expect(state("c-none", A).matches).toEqual({ B1: [], B2: [0] });
    expect(state("c-off", A).extracted).toBe(true);
    expect(state("c-off", B).gap).toMatch(/refused twice/);
    expect(state("c-high", B).mechanical).toBe(true);
  });

  test("adjudication rules each unmatched blocking finding, and scoring counts new and false blockers", () => {
    expect(ran.ak.packets.map((p) => p.state).sort()).toEqual([byId(states, "c-on", B), byId(states, "c-off", C), byId(states, "c-high", A)].sort());
    for (const p of ran.ak.packets) expect(existsSync(join(dir, "adjudicate", p.sheet!.file))).toBe(true);
    expect(ran.ar.replies.third).toBeUndefined();
    expect(ran.aj.sets.second.size).toBe(3);
    const scored = scoreSessions(states, ran.full, maps);
    expect(scored.judge_gaps.map((g) => g.arm)).toEqual(["c-off"]);
    const get = (arm: string, u: typeof A) => scored.sessions.find((s) => s.session.arm === arm && s.session.unit.id === u.id)!.states;
    expect(get("c-on", A).first_stop.found).toEqual({ B1: true, B2: false });
    expect(get("c-on", A).final.found).toEqual({ B1: true, B2: true });
    expect(get("c-on", A).final.blocking).toEqual({ B1: true, B2: false });
    expect(get("c-on", B).final).toMatchObject({ unmatched: 1, unmatched_blocking: 1, new_blockers: 1, false_blockers: 0 });
    expect(get("c-off", C).final).toMatchObject({ false_blockers: 1, new_blockers: 0 });
    expect(get("c-none", C).final).toMatchObject({ false_blockers: 1, unmatched: 0 });
    expect(get("c-high", A).final).toMatchObject({ false_blockers: 1, found: { B1: true, B2: false } });
    expect(get("c-none", A).final.blocking).toEqual({ B1: false, B2: true });
    const a = analyze(suite, states, scored, { units: units.map((u) => u.id), passes: 1 });
    expect(a.arms["c-off"].not_scored).toEqual({ E_CH_C_JUDGE_GAP: 1 });
    expect(a.arms["c-high"].not_scored).toEqual({ E_CH_C_NO_RECORD: 1 });
    expect(a.arms["c-none"].not_scored).toEqual({ UPSTREAM: 1 });
    expect(a.arms["c-on"].extracted_states).toEqual({ first_stop: 0, final: 0 });
    expect(a.arms["c-high"].extracted_states.final).toBe(1);
    expect(a.primary.stats).toMatchObject({ pairs: 3, gains: 1, losses: 0 });
    expect(a.primary.stats!.delta).toBeCloseTo(1 / 3, 12);
  });

  test("the join refuses a second reply that is short, a third from a judge who read, and a missing third", () => {
    const args = { key: ran.m.key, suite, states, counted: ran.counted, maps, mechanical: ran.m.mechanical, primary: ran.mr.replies.primary!, unjudged: ran.mr.unjudged };
    const second = JSON.parse(ran.mr.replies.second!);
    second.packets = second.packets.slice(1);
    expect(() => joinReplies({ ...args, second: JSON.stringify(second), third: ran.mr.replies.third! })).toThrow(/^E_CH_C_REPLY the second reply must answer exactly/);
    const third = JSON.parse(ran.mr.replies.third!);
    third.judge = route.second;
    expect(() => joinReplies({ ...args, second: ran.mr.replies.second!, third: JSON.stringify(third) })).toThrow(/needs a third judge/);
    expect(() => joinReplies({ ...args, second: ran.mr.replies.second!, third: null })).toThrow(/waits for a third read on 3 items/);
    const same = JSON.parse(ran.mr.replies.second!);
    same.judge = route.primary;
    expect(() => joinReplies({ ...args, second: JSON.stringify(same), third: ran.mr.replies.third! })).toThrow(/a second read needs another judge/);
    const other = JSON.parse(ran.mr.replies.primary!);
    other.batch = "0".repeat(64);
    expect(() => joinReplies({ ...args, primary: JSON.stringify(other), second: ran.mr.replies.second!, third: ran.mr.replies.third! })).toThrow(/names batch/);
  });

  test("readExtraction refuses a reply that skips a packet nobody recorded as unjudged", () => {
    const r = JSON.parse(ran.er.replies.primary!);
    r.packets = r.packets.slice(1);
    expect(() => readExtraction(ran.ek, JSON.stringify(r), [])).toThrow(/unanswered and it is not recorded as unjudged/);
    expect(readExtraction(ran.ek, JSON.stringify(r), [{ role: "primary", packet: ran.ek.packets[0]!.file, reason: "x" }]).get(ran.ek.packets[0]!.state!)).toBeNull();
  });
});

describe("join helpers", () => {
  test("joinLabels takes the third read where it read and drops items the primary left unjudged", () => {
    const sets = { judged: ["P1 B1", "P1 B2", "P2 B1"], differ: 0, second: new Set(["P1 B1"]), third: new Set(["P1 B1"]), dropped: new Map([["P2 B1", { role: "primary" as const, packet: "P2", reason: "x" }]]) };
    const joined = joinLabels(sets, new Map([["P1 B1", "a"], ["P1 B2", "b"], ["P2 B1", "c"]]), new Map([["P1 B1", "z"]]));
    expect([...joined]).toEqual([["P1 B1", "z"], ["P1 B2", "b"]]);
  });

  // Value: protects=an item whose required second or third read was refused twice gets no joined label, so the primary's label never stands in for an unfinished read: its state reads as a judging gap and its finding as unadjudicated (R2's join); fails_when=an unresolved match or ruling earns credit from the primary alone; why_new=GEVA-562 part C, PR 400 review; seam=joinLabels; no_claim=which items need a second read
  test("joinLabels gives no label to an item a required second or third read left unjudged", () => {
    const sets = { judged: ["P1 B1", "P1 B2", "P3 B1"], differ: 0, second: new Set(["P1 B1", "P3 B1"]), third: new Set(["P1 B1"]), dropped: new Map([["P1 B2", { role: "second" as const, packet: "P1", reason: "x" }], ["P3 B1", { role: "third" as const, packet: "P3", reason: "y" }]]) };
    const joined = joinLabels(sets, new Map([["P1 B1", "a"], ["P1 B2", "b"], ["P3 B1", "c"]]), new Map([["P1 B1", "z"]]));
    expect([...joined]).toEqual([["P1 B1", "z"]]);
  });

  test("kappa is Cohen's: 1 on agreement, 0 at chance, null with one category", () => {
    expect(kappa([["a", "a"], ["b", "b"]])).toBe(1);
    expect(kappa([["a", "a"], ["a", "b"], ["b", "a"], ["b", "b"]])).toBe(0);
    expect(kappa([["a", "a"]])).toBeNull();
    expect(kappa([])).toBeNull();
    expect(kappa([["m", "m"], ["m", "m"], ["n", "n"], ["n", "m"]])).toBe(0.5);
  });

  test("firstObject reads the first JSON object in or out of a fence", () => {
    expect(firstObject("text ~~~json\n{\"a\": \"}{\", \"b\": {\"c\": 1}}\n~~~ {\"d\": 2}")).toEqual({ a: "}{", b: { c: 1 } });
    expect(() => firstObject("none")).toThrow(/no JSON object/);
    expect(() => firstObject("{\"a\": 1")).toThrow(/never closes/);
  });

  test("readSets refuses a primary reply that leaves an item unanswered", () => {
    const { states, base } = setup([{ arm: "c-on", unit: A, final: [at(A, "B1")] }]);
    const d = tmp();
    mkdirSync(d, { recursive: true });
    const m = writeMatch({ ...base(d, "match"), counted: new Map(), anchors: [] });
    expect(() => readSets({ key: m.key, suite, states, counted: new Map(), maps, mechanical: [], primary: new Map([[m.key.packets[0]!.file + " B1", new Set()]]), second: null, unjudged: [] })).toThrow(/leaves 1 items unanswered/);
  });
});
