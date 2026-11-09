// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10, stage 2 (paid) and the GATE-2 reading. It runs only after stage 1's gates pass and the Captain records
// the panel cap: the paid smoke, the re-projection, the gold pool at maximum effort with its one top-up, the judge
// check at medium effort, and production, all on one ledger lease through the metered client and the request journal.
// Packets are rebuilt from the frozen paths at the frozen main commit and pass the outbound check before any call.
// E_AR_SUPPLY_SHORT and E_AR_JUDGE_KAPPA stop the panel part, E_AR_PACKET_LEAK the run; each settles the lease first.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { recordPath } from "../../src/runner/ledger/paths.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { builtText, gitAt, type Frozen } from "./built.ts";
import { ablate } from "./diff.ts";
import { drawGold, topUp, GOLD_HITS, type Candidate, type GoldDraw } from "./draws.ts";
import { ArError, fail } from "./errors.ts";
import { checkFrame, FRAME, type FrozenFrame } from "./frame.ts";
import { Journal, type Crash } from "./journal.ts";
import { openMeter } from "./meter.ts";
import { buildPacket, exportCheck, outbound, sixGrams, type Identity, type Packet } from "./packet.ts";
import { checkPass, goldCounts, goldPass, GOLD_PER_CLASS, production, reproject, smoke, type CheckResult, type GoldItem, type PanelState, type SmokeRow } from "./panel.ts";
import { readFrame, type RunRecord } from "./records.ts";
import { readApprovals } from "./readers.ts";
import { approvalLines, builtFor, identityOf, ownerTextOf, withoutIntentionIds, writeJson, type Stage1Out, type UnitRow } from "./stage1.ts";
import { DRAWS, landedInterval, overMissing, type RunCounts } from "./stats.ts";
import { accepted } from "./units.ts";
import { gate2Verdict, type Verdict } from "./verdict.ts";
import { SEED } from "./draws.ts";

export type Phase2 = "smoke" | "project" | "gold" | "check" | "production";

export interface Stage2Options {
  frame: string;
  repo: string;
  stage1: string;
  sink: string;
  item: string;
  runId: string;
  phases: Phase2[];
  record?: string;
  ledger?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  withheld?: string[];
  frozenFrame?: FrozenFrame;
  crash?: { at: Crash; cell: string; exit: () => never };
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

export interface Prepared {
  id: Identity;
  records: RunRecord[];
  rows: UnitRow[];
  packets: Map<string, Packet>;
  ablated: Map<string, Packet>;
  draws: { seed: number; gold: GoldDraw; full: string[] };
  cands: Candidate[];
  stage1: Stage1Out;
}

/** Rebuilds every packet from the frozen paths at the frozen commit and runs the outbound check on each. */
export function prepare(o: Pick<Stage2Options, "frame" | "repo" | "stage1" | "withheld" | "frozenFrame">): Prepared {
  const { ids } = checkFrame(o.frame, o.frozenFrame ?? FRAME);
  const records = readFrame(join(o.frame, "records"), ids);
  const frozen = readJson<Frozen>(join(o.stage1, "matched.json"));
  const g = gitAt(o.repo, frozen.main_commit);
  if (g.commit !== frozen.main_commit) fail("E_AR_FRAME_DRIFT", "the frozen main commit does not resolve to itself");
  const appr = readApprovals(join(o.frame, "approvals"));
  const id = identityOf(records, appr.docs, approvalLines(join(o.frame, "approvals")), o.withheld ?? []);
  const built = builtFor(records, g, frozen);
  const rows: UnitRow[] = [];
  const packets = new Map<string, Packet>();
  const ablated = new Map<string, Packet>();
  for (const b of built) {
    if (!b.path || b.text === null) continue;
    const owner = sixGrams(ownerTextOf(b.record));
    for (const u of (b.units ?? []).filter(accepted)) {
      const uid = b.record.id + "|" + u.key;
      const change = u.changeText ?? "";
      const src = () => ({ unit: uid, commit: g.commit, path: b.path!, built: builtText(g, b.path!) ?? "", change });
      const p = buildPacket(src(), id);
      if (!p) continue;
      outbound(p, src, id, owner);
      packets.set(uid, p);
      const cut = ablate(change, b.record.restore ?? "", b.text);
      if (cut !== null) {
        const asrc = () => {
          const t = builtText(g, b.path!);
          return { unit: uid, commit: g.commit, path: b.path!, built: t === null ? "" : ablate(change, b.record.restore ?? "", t) ?? "", change };
        };
        const ap = buildPacket(asrc(), id);
        if (ap) {
          outbound(ap, asrc, id, owner);
          ablated.set(uid, ap);
        }
      }
    }
  }
  const stage1 = readJson<Stage1Out>(join(o.stage1, "stage1.json"));
  const units = readJson<UnitRow[]>(join(o.stage1, "units.json"));
  const draws = readJson<Prepared["draws"]>(join(o.stage1, "draws.json"));
  for (const r of units) rows.push(r);
  const cands = rows.filter((r) => r.packetBytes !== null).map((r) => ({ id: r.id, hit: r.hit === true, ablatable: r.ablatable }));
  if (JSON.stringify(drawGold(cands, draws.seed).hits) !== JSON.stringify(draws.gold.hits)) fail("E_AR_FRAME_DRIFT", "the gold draw does not reproduce from the frozen seed");
  return { id, records, rows, packets, ablated, draws, cands, stage1 };
}

function goldItems(pp: Prepared, d: GoldDraw): GoldItem[] {
  const items: GoldItem[] = [];
  for (const u of d.hits) if (pp.packets.has(u)) items.push({ id: "hit:" + u, kind: "hit", packet: pp.packets.get(u)! });
  for (const u of d.ablated) if (pp.ablated.has(u)) items.push({ id: "abl:" + u, kind: "ablated", packet: pp.ablated.get(u)! });
  for (const u of d.misses) if (pp.packets.has(u)) items.push({ id: "miss:" + u, kind: "miss", packet: pp.packets.get(u)! });
  return items;
}

/** The production units: every lean unit with a built text (census) and the full-kind sample. */
export const productionUnits = (pp: Prepared) => [...pp.rows.filter((r) => (r.stratum === "lean-primary" || r.stratum === "lean-desc") && pp.packets.has(r.id)).map((r) => r.id), ...pp.draws.full.filter((u) => pp.packets.has(u))];

const PHASES: Phase2[] = ["smoke", "project", "gold", "check", "production"];

/** Refuses a phase unless every earlier phase's saved result in the sink passed, so a failed or skipped gate stops every phase after it. */
export function admitPhase(sink: string, phase: Phase2): void {
  const saved = <T>(name: string): T | null => (existsSync(join(sink, name)) ? readJson<T>(join(sink, name)) : null);
  const before = PHASES.slice(0, PHASES.indexOf(phase));
  if (before.includes("smoke") && saved<{ pass?: boolean }>("smoke.json")?.pass !== true) fail("E_AR_SMOKE_FAIL", "the saved paid smoke is missing or did not pass; no later phase runs");
  if (before.includes("project") && saved<{ stop?: boolean }>("projection.json")?.stop !== false) fail("E_CAP_TOO_LOW", "the saved re-projection is missing or stopped at the panel cap; no paid phase after it runs");
  const c = saved<{ counts?: { landed: number; not: number } }>("gold.json")?.counts;
  if (before.includes("gold") && !(c && c.landed >= GOLD_PER_CLASS && c.not >= GOLD_PER_CLASS)) fail("E_AR_SUPPLY_SHORT", "the saved gold is missing or short of " + GOLD_PER_CLASS + " items in a class; GATE-2 reads NO READ");
  const p = saved<CheckResult>("check.json")?.pass;
  if (before.includes("check") && !(p?.astra && p.opus && p.argon)) fail("E_AR_JUDGE_KAPPA", "the saved judge check is missing or a judge failed it; GATE-2 reads NO READ");
}

/** The cap the meter's approval record holds for the item, and what the item's other leases spent or left unknown. */
export function budgetFor(o: Pick<Stage2Options, "record" | "env" | "item">, leaseId: string): { cap_micros: number; prior_micros: number } {
  const state = readItem(recordPath(o.record, o.env ?? process.env).path, o.item);
  const prior = state.leases.filter((l) => l.lease.lease_id !== leaseId).reduce((sum, { lease, close }) => sum + (close ? close.spent_micros + close.unknown_micros : lease.reserved_micros), 0);
  return { cap_micros: state.cap_micros ?? 0, prior_micros: prior };
}

export function writeGold(sink: string, counts: { landed: number; not: number }, gold: ReadonlyMap<string, boolean>, items: readonly GoldItem[]): void {
  writeJson(join(sink, "gold.json"), { counts, gold: [...gold], items: items.map((it) => it.id) });
}

/** The gold labels and every gold item the gold phase sent, top-ups included, rebuilt from this run's packets. */
export function savedGold(pp: Pick<Prepared, "packets" | "ablated">, sink: string): { gold: Map<string, boolean>; items: GoldItem[] } {
  const saved = readJson<{ gold: Array<[string, boolean]>; items?: string[] }>(join(sink, "gold.json"));
  if (!Array.isArray(saved.items)) fail("E_AR_FRAME_DRIFT", "the saved gold lists no gold items; rerun the gold phase");
  const kinds: Record<string, GoldItem["kind"]> = { hit: "hit", abl: "ablated", miss: "miss" };
  const items = saved.items!.map((id) => {
    const kind = kinds[id.slice(0, id.indexOf(":"))];
    const packet = (kind === "ablated" ? pp.ablated : pp.packets).get(id.slice(id.indexOf(":") + 1));
    if (!kind || !packet) fail("E_AR_FRAME_DRIFT", "a saved gold item no longer rebuilds from the frozen paths");
    return { id, kind: kind!, packet: packet! };
  });
  return { gold: new Map(saved.gold), items };
}

/** Amendment A1: no packet is sent while any stage 1 refusal stands, so smoke, project and stage2 refuse to start. */
export function blockOnRefusals(s: Pick<Stage1Out, "gate2">): void {
  if (s.gate2.refused) fail("E_AR_PACKET_LEAK", "stage 1 refused " + s.gate2.refused + " packets in " + s.gate2.refusedRuns + " runs; no packet is sent while a refusal stands");
}

/** A failed stage 1 parser smoke stops the paid stages: no packet built by that parser is sent. */
export function blockOnParserSmoke(s: Pick<Stage1Out, "smoke">): void {
  if (!s.smoke.pass) fail("E_AR_SMOKE_FAIL", "stage 1's parser smoke failed on a gstack minor; no panel call is made");
}

export async function stage2(o: Stage2Options): Promise<Record<string, unknown>> {
  const pp = prepare(o);
  blockOnRefusals(pp.stage1);
  blockOnParserSmoke(pp.stage1);
  if (!pp.stage1.gate2.ok) fail("E_AR_SUPPLY_SHORT", "stage 1's GATE-2 gates did not pass (" + pp.stage1.gate2.reasons.join("; ") + "); no panel call is made");
  const markers = [...pp.id.runIds, ...pp.id.names, ...sixGrams(pp.id.ownerText)];
  const meter = await openMeter({ item: o.item, runId: o.runId, out: o.sink, maxOutputTokens: 16_000, forbiddenMarkers: markers, record: o.record, ledger: o.ledger, env: o.env, fetch: o.fetch });
  const j = new Journal(join(o.sink, "journal"), o.crash);
  const rec = j.reconcile();
  const st: PanelState = { argonStopped: false, missing: 0 };
  const out: Record<string, unknown> = { reconciled: rec };
  let stop: unknown = null;
  try {
    if (o.phases.includes("smoke")) {
      const s = await smoke(j, meter.call, st, pp.draws.gold.hits.slice(0, 4).map((u) => pp.packets.get(u)!).filter(Boolean));
      writeJson(join(o.sink, "smoke.json"), s);
      out.smoke = { pass: s.pass, calls: s.rows.length };
      if (!s.pass) fail("E_AR_SMOKE_FAIL", "the paid smoke failed (" + s.rows.filter((r) => !r.ok).length + " unusable, " + s.rows.filter((r) => r.truncated).length + " truncated)");
    }
    const items = goldItems(pp, pp.draws.gold);
    const prod = productionUnits(pp);
    if (o.phases.includes("project")) {
      admitPhase(o.sink, "project");
      const s = readJson<{ rows: SmokeRow[] }>(join(o.sink, "smoke.json"));
      const remaining = [...items.flatMap((it) => [["astra", "max"], ["opus", "max"], ["astra", "medium"], ["opus", "medium"], ["argon", "medium"]].map(([judge, effort]) => ({ judge, effort, body: it.packet.body }))), ...prod.flatMap((u) => ["astra", "opus", "argon"].map((judge) => ({ judge, effort: "medium", body: pp.packets.get(u)!.body })))] as Parameters<typeof reproject>[0]["remaining"];
      const budget = budgetFor(o, meter.leaseId);
      const p = reproject({ smoke: s.rows, remaining, unresolved_micros: meter.unknown(), spent_micros: budget.prior_micros + meter.spent(), cap_micros: budget.cap_micros });
      writeJson(join(o.sink, "projection.json"), p);
      out.projection = p;
      if (p.stop) fail("E_CAP_TOO_LOW", "the re-projection with 12 worst cases passes the panel cap; stop for the Captain");
    }
    let gold = new Map<string, boolean>();
    let all = [...items];
    if (o.phases.includes("gold")) {
      admitPhase(o.sink, "gold");
      gold = await goldPass(j, meter.call, st, items);
      let c = goldCounts(gold);
      for (const [short, kind] of [[c.landed < GOLD_PER_CLASS, "hit"], [c.not < GOLD_PER_CLASS, "ablated"]] as const) {
        if (!short) continue;
        const extra = topUp(pp.draws.gold, pp.cands, kind).map((u) => ({ id: (kind === "hit" ? "hit:" : "abl:") + u, kind, packet: (kind === "hit" ? pp.packets : pp.ablated).get(u)! })).filter((x) => x.packet);
        all.push(...extra);
        for (const [k, v] of await goldPass(j, meter.call, st, extra)) gold.set(k, v);
      }
      c = goldCounts(gold);
      writeGold(o.sink, c, gold, all);
      out.gold = c;
      if (c.landed < GOLD_PER_CLASS || c.not < GOLD_PER_CLASS) fail("E_AR_SUPPLY_SHORT", "gold is short after the top-up (" + c.landed + " LANDED, " + c.not + " NOT_LANDED); GATE-2 reads NO READ");
    } else if (existsSync(join(o.sink, "gold.json"))) ({ gold, items: all } = savedGold(pp, o.sink));
    let check: CheckResult | null = null;
    if (o.phases.includes("check")) {
      admitPhase(o.sink, "check");
      check = await checkPass(j, meter.call, st, all, gold);
      writeJson(join(o.sink, "check.json"), check);
      out.check = check;
      if (!check.pass.astra || !check.pass.opus || !check.pass.argon) fail("E_AR_JUDGE_KAPPA", "a judge's kappa against gold is below 0.6; GATE-2 reads NO READ");
    } else if (existsSync(join(o.sink, "check.json"))) check = readJson<CheckResult>(join(o.sink, "check.json"));
    if (o.phases.includes("production")) {
      admitPhase(o.sink, "production");
      const labels = await production(j, meter.call, st, prod.map((u) => ({ id: u, packet: pp.packets.get(u)! })), check?.pass.argon ?? false);
      writeJson(join(o.sink, "labels.json"), [...labels]);
      out.production = { units: labels.size, missing: [...labels.values()].filter((c) => c.binary === null).length, argon: [...labels.values()].filter((c) => c.argonUsed).length };
    }
  } catch (e) {
    stop = e;
  } finally {
    const settled = await meter.close();
    out.settled = settled;
    out.missing_labels = st.missing;
    out.argon_stopped = st.argonStopped;
    for (const r of j.all().filter((r) => r.state === "label")) {
      const hit = j.cached(r.digest);
      if (hit) exportCheck(hit.text, pp.id, "a reply cache file");
    }
    writeJson(join(o.sink, "stage2.json"), out);
    if (!stop && o.phases.includes("production")) rmSync(join(o.sink, "INCOMPLETE"), { force: true });
  }
  if (stop) throw stop;
  return out;
}

export interface Gate2Reading {
  verdict: Verdict;
  lost: { point: number; lo: number; hi: number } | null;
  landed: { point: number; lo: number; hi: number } | null;
  labelled: { point: number; lo: number; hi: number } | null;
  uncorrected: number | null;
  units: number;
  missing: number;
  runs: number;
  partly: number;
  reversed: number;
  split: number;
  incorporatedNotLanded: number;
}

/** GATE-2's lean primary reading from stage 1's units and stage 2's labels and judge check. */
export function gate2Reading(units: readonly UnitRow[], labels: ReadonlyMap<string, { binary: "LANDED" | "NOT" | null; subclass: string | null }>, check: CheckResult | null, stage: "lean-primary" | "lean-desc" | "full", only?: ReadonlySet<string>): Gate2Reading {
  const mine = units.filter((u) => u.stratum === stage && (!only || only.has(u.id)));
  const byRun = new Map<string, RunCounts>();
  for (const u of mine) {
    const r = byRun.get(u.run) ?? { k: 0, n: 0, m: 0 };
    const l = labels.get(u.id)?.binary ?? null;
    if (l === null) r.m++;
    else {
      r.n++;
      if (l === "LANDED") r.k++;
    }
    byRun.set(u.run, r);
  }
  const runs = [...byRun.keys()].sort().map((k) => byRun.get(k)!);
  const missing = runs.reduce((a, r) => a + r.m, 0);
  const n = runs.reduce((a, r) => a + r.n, 0);
  const subs = mine.map((u) => labels.get(u.id)?.subclass ?? null);
  const base = { units: mine.length, missing, runs: runs.length, partly: subs.filter((s) => s === "PARTLY").length, reversed: subs.filter((s) => s === "REVERSED").length, split: subs.filter((s) => s === "split").length, incorporatedNotLanded: mine.filter((u) => u.incorporated && labels.get(u.id)?.binary === "NOT").length, uncorrected: n ? runs.reduce((a, r) => a + r.k, 0) / n : null };
  const passed = check !== null && check.pass.astra && check.pass.opus && check.pass.argon && check.sensN >= GOLD_PER_CLASS && check.specN >= GOLD_PER_CLASS;
  if (!passed || !runs.length) return { ...base, verdict: "NO READ", lost: null, landed: null, labelled: null };
  const gold = { sensK: check!.sensK, sensN: check!.sensN, specK: check!.specK, specN: check!.specN };
  const lost = landedInterval(runs, gold, { seed: SEED, draws: DRAWS, bound: "lost" });
  const landed = landedInterval(runs, gold, { seed: SEED, draws: DRAWS, bound: "landed" });
  const labelled = landedInterval(runs, gold, { seed: SEED, draws: DRAWS, bound: "labelled" });
  return { ...base, verdict: gate2Verdict({ noRead: overMissing(missing, mine.length), lost, landed }), lost, landed, labelled };
}

/** The report's GATE-2 line, scanned before it leaves the sink. */
export function gate2Export(r: Gate2Reading, id: Identity): string {
  const text = JSON.stringify(r);
  exportCheck(withoutIntentionIds(text), id, "the GATE-2 export");
  return text;
}

export { ArError, GOLD_HITS };
