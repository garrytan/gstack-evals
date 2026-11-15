import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proxyLinks } from "../../lanes/ask-replay/chains.ts";
import { main } from "../../lanes/ask-replay/cli.ts";
import { DECISION_FIXTURES, labelRecord } from "../../lanes/ask-replay/fixtures.ts";
import { FROZEN } from "../../lanes/ask-replay/frozen.ts";
import { labelId } from "../../lanes/ask-replay/label.ts";
import { schedule } from "../../lanes/ask-replay/run.ts";
import { absentSamples, compare, decide, itemInfos, itemMeans, missingShares, pastCeiling, pilotReadout, readout, sampleScore } from "../../lanes/ask-replay/score.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";
import { outcomeOf } from "../../lanes/ask-replay/types.ts";
import type { Action, Arm, AskItem, Label, LabelKind, MissingKind, ModelKey, Outcome, Sample, SampleRecord } from "../../lanes/ask-replay/types.ts";

const items = generate().items;
const links = proxyLinks(items);
const infos = itemInfos(items, links);

/** Outcomes for every synthetic item on opus and sol, from an action rule per arm. */
function outcomes(rule: (it: AskItem, arm: Arm, r: number) => Action | MissingKind, arms: Arm[] = ["a", "b", "c", "d"]): Outcome[] {
  const out: Outcome[] = [];
  for (const model of ["opus", "sol"] as const) for (const it of items) for (const arm of arms) for (const replicate of [1, 2]) {
    const v = rule(it, arm, replicate);
    const missing = v === "parse" || v === "safety" || v === "upstream" ? v : null;
    const action = missing ? null : (v as Action);
    out.push({ item: it.item, arm, model, replicate, missing, agent_action: action, final_action: action, repeats: "new", reask_reason: false, gate: "none", reason: "r" });
  }
  return out;
}
const needless = (it: AskItem) => it.label !== "DECISION";
const record = (s: Sample): SampleRecord => ({ sample: s, draw: 1, attempts: 1, missing: null, agent_action: "SEND", final_action: "SEND", repeats: s.arm === "c" || s.arm === "d" ? "new" : "not_asked", named: null, reask_reason: false, gate: "none", reason: null, text: null, capped: false, micros: null, upstream_redraw: false });
/** Sealed labeller records for one kind on items, each labeller giving cls(item), each carrying the count its shard scheduled. */
const labels = (kind: LabelKind, on: readonly AskItem[], cls: (it: AskItem) => Label = (it) => it.label, scheduled = on.length) => (["opus", "astra"] as const).flatMap((m) => on.map((it) => labelRecord(labelId(it.item, kind, m), it.item, m, { class: cls(it), repeats_of: null, answer_judgement: [], reason: "r" }, scheduled)));

describe("per-sample codings (section 8)", () => {
  const dupAnswered = { label: "DUPLICATE" as const, answered_dup: true };
  const dupOpen = { label: "DUPLICATE" as const, answered_dup: false };
  const perm = { label: "PERMISSION_FOR_DEFAULT" as const, answered_dup: null };
  const must = { label: "DECISION" as const, answered_dup: null };
  const s = (i: Parameters<typeof sampleScore>[0], a: Action, c: "primary" | "secondary") => sampleScore(i, { missing: null, final_action: a }, c);
  test("primary: a needless send is SEND; a must-ask miss is FOLD or DROP", () => {
    expect([s(dupOpen, "SEND", "primary"), s(dupOpen, "FOLD", "primary"), s(perm, "DROP", "primary")]).toEqual([1, 0, 0]);
    expect([s(must, "SEND", "primary"), s(must, "FOLD", "primary"), s(must, "DROP", "primary")]).toEqual([0, 1, 1]);
  });
  test("secondary: FOLD is an ask on answered duplicates, permission and observable items; only DROP misses a must-ask", () => {
    expect([s(dupAnswered, "FOLD", "secondary"), s(dupOpen, "FOLD", "secondary"), s(perm, "FOLD", "secondary")]).toEqual([1, 0, 1]);
    expect([s(must, "FOLD", "secondary"), s(must, "DROP", "secondary")]).toEqual([0, 1]);
  });
  test("MISSING scores null, and the bounds count it against the treatment and for the comparator", () => {
    expect(sampleScore(must, { missing: "safety", final_action: null }, "primary")).toBeNull();
    const o = outcomes((it, arm, r) => (arm === "c" && r === 1 ? "upstream" : arm === "b" && r === 1 ? "parse" : needless(it) ? "FOLD" : "SEND"));
    const t = itemMeans(infos, o, "opus", "c", "primary", "treatment");
    const c = itemMeans(infos, o, "opus", "b", "primary", "comparator");
    const ex = itemMeans(infos, o, "opus", "c", "primary", "excluded");
    const dup = items.find((i) => i.label === "DUPLICATE")!;
    const dec = items.find((i) => i.label === "DECISION")!;
    expect([t.get(dup.item), c.get(dup.item), ex.get(dup.item)]).toEqual([0.5, 0, 0]);
    expect([t.get(dec.item), c.get(dec.item)]).toEqual([0.5, 0]);
  });
  test("a cell past 3% MISSING makes its model's rows inconclusive", () => {
    let n = 0;
    const o = outcomes((it, arm) => (arm === "a" && n++ % 20 === 0 ? "safety" : "SEND"));
    const shares = missingShares(o, "opus");
    expect(shares.a!.share).toBeGreaterThan(0.03);
    expect(pastCeiling(shares)).toBe(true);
    expect(pastCeiling(missingShares(outcomes(() => "SEND"), "opus"))).toBe(false);
    expect(readout(items, o, { links, seed: 1, draws: 1000 }).decision.per_model.opus!.readable).toBe(false);
  });
});

describe("decision rows (section 1)", () => {
  for (const [name, f] of Object.entries(DECISION_FIXTURES)) {
    test(name + " reads " + f.row + (f.cut_candidate ? " and the cut candidate" : ""), () => {
      const d = decide({ opus: f.opus, sol: f.sol });
      expect(d.row).toBe(f.row);
      expect(d.cut_candidate).toBe(f.cut_candidate);
      expect(d.why_null).toBe(f.row === "inconclusive");
    });
  }
  test("particle-1 never decides a row", () => {
    const f = DECISION_FIXTURES.build_and_trim!;
    expect(decide({ particle: f.opus, sol: f.sol }).row).toBe("inconclusive");
  });
  test("end to end: (c) folds every needless ask that (b) sends, with no must-ask cost: build and trim", () => {
    const o = outcomes((it, arm) => (needless(it) && (arm === "c" || arm === "d") ? "FOLD" : "SEND"));
    const r = readout(items, o, { links, seed: 7, draws: 2000 });
    expect(r.decision.row).toBe("build and trim");
    expect(r.decision.cut_candidate).toBe(false);
  });
  test("end to end: (c) clearly worse than (b) reads drop", () => {
    const o = outcomes((it, arm, rep) => (needless(it) && arm !== "c" && rep === 1 ? "FOLD" : "SEND"));
    expect(readout(items, o, { links, seed: 7, draws: 2000 }).decision.row).toBe("drop");
  });
  test("end to end: (a) clearly better than both reads the cut candidate", () => {
    const o = outcomes((it, arm) => (needless(it) && arm === "a" ? "DROP" : "SEND"));
    const r = readout(items, o, { links, seed: 7, draws: 2000 });
    expect(r.decision.cut_candidate).toBe(true);
    expect(r.decision.row).toBe("drop");
  });
  test("end to end: a cut that holds back must-asks reads FIX-METHOD", () => {
    const o = outcomes((it, arm) => ((arm === "c" || arm === "d") ? (needless(it) ? "FOLD" : "FOLD") : "SEND"));
    expect(readout(items, o, { links, seed: 7, draws: 2000 }).decision.row).toBe("fix-method");
  });
});

describe("readout parts", () => {
  test("comparisons pair by item and report a leave-one-thread-out range", () => {
    const o = outcomes((it, arm) => (needless(it) && arm === "c" ? "FOLD" : "SEND"));
    const iv = compare(infos, o, { model: "opus", t: "c", c: "b", set: "needless", seed: 3, draws: 2000 })!;
    expect(iv.delta).toBe(-1);
    expect(iv.n_items).toBe(25);
    expect(iv.loto).toEqual([-1, -1]);
  });
  test("S2 counts the gate's share, and the exposure count reads the frozen phrase list", () => {
    const o = outcomes((it, arm) => (needless(it) && arm === "b" ? "SEND" : "SEND"));
    for (const x of o) if (x.arm === "c" && items.find((i) => i.item === x.item)!.label !== "DECISION") Object.assign(x, { final_action: "DROP", gate: "drop_answered", repeats: "named" });
    for (const x of o) if (x.arm === "b") x.reason = "I already asked this earlier";
    const r = readout(items, o, { links, seed: 3, draws: 1000 }) as any;
    expect(r.models.opus.s2.c.gate_share).toBe(1);
    expect(r.models.opus.s2.c.gate.drop_answered).toBeGreaterThan(0);
    expect(r.models.opus.exposure.b_reasons_citing_earlier_ask.rate).toBe(1);
    expect(r.models.opus.per_class.PERMISSION_FOR_DEFAULT.b.k).toBe(6);
  });
});

describe("a partial run", () => {
  test("scheduled samples with no record count as absent per model and arm, so the run is incomplete", () => {
    const its = items.slice(0, 2);
    const all = schedule(its, "opus", FROZEN.replicates.k, 7);
    expect(absentSamples(its, all, ["opus"])).toEqual({ total: 0, by: {} });
    const capped = all.filter((s) => !(s.arm === "b" && s.replicate === 2));
    expect(absentSamples(its, capped, ["opus"])).toEqual({ total: 2, by: { opus: { b: 2 } } });
  });
  test("a run cut short at k = 3 counts its unsealed third replicates as absent", () => {
    const its = items.slice(0, 2);
    const all = [...schedule(its, "opus", 3, 7), ...schedule(its, "sol", 3, 7)];
    const cut = all.filter((s) => s.replicate <= 2);
    const r = absentSamples(its, cut, FROZEN.frontier_models);
    expect(r.total).toBe(all.length - cut.length);
    expect(r.by.opus).toEqual({ a: 2, b: 2, c: 2, d: 2 });
  });
  test("a complete pilot run, with its own count per arm, has no absent samples", () => {
    const its = items.slice(0, 2);
    const pilot = FROZEN.pilot.arms as Partial<Record<Arm, number>>;
    const all = [...schedule(its, "opus", pilot, 7), ...schedule(its, "sol", pilot, 7)];
    expect(absentSamples(its, all, FROZEN.frontier_models)).toEqual({ total: 0, by: {} });
    expect(absentSamples(its, all.slice(1), FROZEN.frontier_models).total).toBe(1);
  });
  test("a frontier model with no record counts every sample its peers' plan schedules as absent", () => {
    const its = items.slice(0, 2);
    const r = absentSamples(its, schedule(its, "opus", 3, 7), FROZEN.frontier_models);
    expect(r.by.opus).toBeUndefined();
    expect(r.by.sol).toEqual({ a: 6, b: 6, c: 6, d: 6 });
  });
});

describe("score's completeness guard", () => {
  const its = items.slice(0, 4);
  const shard = (m: ModelKey) => schedule(its, m, FROZEN.replicates.k, 7);
  const standing = () => labels("audit", its);
  async function score(samples: Sample[], labelRecords: SampleRecord[] | null = standing()) {
    const dir = mkdtempSync(join(tmpdir(), "ask-score-"));
    try {
      writeFileSync(join(dir, "items.jsonl"), its.map((i) => JSON.stringify(i)).join("\n") + "\n");
      mkdirSync(join(dir, "replies"));
      for (const s of samples) writeFileSync(join(dir, "replies", s.id + ".ask.json"), JSON.stringify(record(s)));
      mkdirSync(join(dir, "labels"));
      for (const r of labelRecords ?? []) writeFileSync(join(dir, "labels", r.sample.id + ".ask.json"), JSON.stringify(r));
      const out: string[] = [];
      const err: string[] = [];
      const code = await main(["score", "--items", join(dir, "items.jsonl"), "--replies", join(dir, "replies"), ...(labelRecords ? ["--labels", join(dir, "labels")] : []), "--draws", "20", "--keyless"], { out: (t) => out.push(t), err: (t) => err.push(t) });
      return { code, out: JSON.parse(out.join("\n")), err: err.join("\n") };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  test("a frontier shard with no records blocks the decision rows", async () => {
    const r = await score(shard("opus"));
    expect(r.code).toBe(2);
    expect(r.err).toContain("E_ASK_INCOMPLETE");
    expect(r.out.absent_by_model_arm.sol).toEqual({ a: 8, b: 8, c: 8, d: 8 });
    expect(r.out.decision).toBeUndefined();
  });
  test("a particle-1 cap stop reads as untested and the decision rows still print", async () => {
    const r = await score([...shard("opus"), ...shard("sol"), ...shard("particle").slice(0, 3)]);
    expect(r.code).toBe(0);
    expect(typeof r.out.decision.row).toBe("string");
    expect(r.out.models.particle.untested).toBe(true);
    expect(Object.values(r.out.models.particle.absent_by_arm as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(shard("particle").length - 3);
    expect(r.out.models.opus.untested).toBeUndefined();
  });
});

describe("the pilot readout (sections 9 and 10)", () => {
  const pilotItems = [...items.filter(needless).slice(0, 24), ...items.filter((i) => !needless(i)).slice(0, 16)];
  const run = (send: (it: AskItem, r: number) => boolean) => (["opus", "sol"] as const).flatMap((m) => schedule(pilotItems, m, FROZEN.pilot.arms as Partial<Record<Arm, number>>, 3)).map((s) => {
    const it = pilotItems.find((i) => i.item === s.item)!;
    const a: Action = s.arm === "b" && send(it, s.replicate) ? "SEND" : needless(it) ? "FOLD" : "SEND";
    return outcomeOf({ ...record(s), agent_action: a, final_action: a });
  });
  test("a (b) that sends no needless item does not admit, and its zero spread keeps k = 2", () => {
    const r = pilotReadout(pilotItems, run(() => false));
    expect(r).toMatchObject({ items: 40, needless: 24, must_ask: 16, admit: false, k: FROZEN.replicates.k });
    expect(r.models.opus).toMatchObject({ needless_sends: 0, must_misses: 0, admit: false, mdd_k2: 0, k: 2 });
  });
  test("a (b) that sends half the needless items on one replicate admits, and its within-item spread sets k = 3", () => {
    const r = pilotReadout(pilotItems, run((it, rep) => needless(it) && rep === 1 && pilotItems.indexOf(it) % 2 === 0));
    expect(r.admit).toBe(true);
    expect(r.models.sol).toMatchObject({ needless_sends: 6, admit: true, k: 3 });
    expect(r.models.sol!.mdd_k2).toBeGreaterThan(FROZEN.pilot.k3_when_projected_mdd_above);
    expect(r.k).toBe(FROZEN.replicates.k_after_pilot_rule);
  });
});

describe("score's label guard (section 7)", () => {
  const its = items.slice(0, 4);
  const all = () => (["opus", "sol"] as const).flatMap((m) => schedule(its, m, FROZEN.replicates.k, 7));
  const flip = (it: AskItem): Label => (it.label === "DECISION" ? "DUPLICATE" : "DECISION");
  async function score(labelRecords: SampleRecord[] | null) {
    const dir = mkdtempSync(join(tmpdir(), "ask-score-labels-"));
    try {
      writeFileSync(join(dir, "items.jsonl"), its.map((i) => JSON.stringify(i)).join("\n") + "\n");
      mkdirSync(join(dir, "replies"));
      for (const s of all()) writeFileSync(join(dir, "replies", s.id + ".ask.json"), JSON.stringify(record(s)));
      mkdirSync(join(dir, "labels"));
      for (const r of labelRecords ?? []) writeFileSync(join(dir, "labels", r.sample.id + ".ask.json"), JSON.stringify(r));
      const out: string[] = [];
      const err: string[] = [];
      const code = await main(["score", "--items", join(dir, "items.jsonl"), "--replies", join(dir, "replies"), ...(labelRecords ? ["--labels", join(dir, "labels")] : []), "--draws", "20", "--keyless"], { out: (t) => out.push(t), err: (t) => err.push(t) });
      return { code, out: JSON.parse(out.join("\n")), err: err.join("\n") };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const withheld = (r: Awaited<ReturnType<typeof score>>) => {
    expect(r.code).toBe(2);
    expect(r.err).toContain("E_ASK_INCOMPLETE");
    expect(r.out.decision).toBeNull();
    expect(typeof r.out.decision_withheld).toBe("string");
    expect(r.out.models.opus).toBeDefined();
  };
  test("with no --labels the audit has not stood: the readout numbers print and the decision is withheld", async () => {
    const r = await score(null);
    withheld(r);
    expect(r.out.decision_withheld).toContain("no --labels");
  });
  test("an audit with a scheduled label missing is incomplete, so no decision rows", async () => {
    const r = await score(labels("audit", its).slice(1));
    withheld(r);
    expect(r.out.labels.audit_complete).toBe(false);
  });
  test("labels with no scheduled count give no completeness evidence, so no decision rows", async () => {
    const r = await score(labels("audit", its).map((l) => ({ ...l, sample: { ...l.sample, scheduled: undefined } })));
    withheld(r);
  });
  test("a complete audit that stands prints the decision rows", async () => {
    const r = await score(labels("audit", its));
    expect(r.code).toBe(0);
    expect(r.out.labels).toMatchObject({ audit_complete: true, decision_withheld: null });
    expect(typeof r.out.decision.row).toBe("string");
  });
  test("a failed audit withholds the decision until the contingency on the items outside the audit is complete, then the agreement labels decide", async () => {
    const audited = its.slice(0, 2);
    const rest = its.slice(2);
    const failed = labels("audit", audited, flip);
    const r = await score(failed);
    withheld(r);
    expect(r.out.labels.kappa.stands).toBe(false);
    withheld(await score([...failed, ...labels("contingency", rest).slice(1)]));
    const done = await score([...failed, ...labels("contingency", rest)]);
    expect(done.code).toBe(0);
    expect(done.out.labels).toMatchObject({ contingency_complete: true, primary_labels: "the labellers' agreement", decision_withheld: null });
    expect(typeof done.out.decision.row).toBe("string");
  });
});
