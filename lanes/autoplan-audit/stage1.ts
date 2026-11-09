// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10, stage 1 (free): check the frame, parse every record, find and freeze built texts, run the mechanical
// diff, X-1, X-2, X-3 and GATE-1 on every stratum, build and scan every packet, count gold candidates and fix the seeded
// draws, then the parser smoke. Writes into a sink that must not exist before; prints counts only.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { builtText, gitAt, matchBuilt, type Frozen, type Git } from "./built.ts";
import { ablate, diffScore } from "./diff.ts";
import { drawFullSample, drawGold, supply, SEED, type Candidate } from "./draws.ts";
import { ArError, fail } from "./errors.ts";
import { checkFrame, FRAME, type FrozenFrame } from "./frame.ts";
import type { Matrix } from "./matrix.ts";
import { buildPacket, exportCheck, outbound, sixGrams, type Identity, type Packet } from "./packet.ts";
import { answered, minorOf, parses, readFrame, type RunRecord } from "./records.ts";
import { gate1, leanByDesign, outsideOnlyAccepted, readApprovals, x1, x2, x3, type ApprovalDoc } from "./readers.ts";
import { bootstrapMeans, DRAWS, mean, overMissing, percentileInterval, wilson } from "./stats.ts";
import { accepted, unitsOf, type Unit } from "./units.ts";
import { BAR_SHARE, decide, gate1Verdict, type Verdict } from "./verdict.ts";
import { frontMatterId } from "./built.ts";

export type Stratum = "lean-primary" | "lean-desc" | "full" | "none";

export interface UnitRow {
  id: string;
  run: string;
  kind: RunRecord["kind"];
  stratum: Stratum;
  path: string | null;
  hit: boolean | null;
  score: number | null;
  ablatable: boolean;
  packetBytes: number | null;
  incorporated: boolean;
}

/** Opens a run sink: the directory must not exist before the run; the check is recorded in SINK.json. */
export function openSink(path: string, what: string): string {
  if (existsSync(path)) fail("E_USAGE", "the sink " + what + " already exists; a run writes only into a new directory");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(path, "SINK.json"), JSON.stringify({ existed_before: false, created_at: new Date().toISOString(), stage: what }) + "\n");
  writeFileSync(join(path, "INCOMPLETE"), "a run is writing here; this file is removed when it finishes\n");
  return path;
}

export const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 1) + "\n", { mode: 0o600 });

/** A run's owner replies and gate reply: the text whose 6-word runs its packets may not hold. */
export function ownerTextOf(r: RunRecord): string[] {
  const out: string[] = [];
  for (const d of r.decisions ?? []) if (typeof d.owner_reply === "string" && d.owner_reply.trim()) out.push(d.owner_reply);
  for (const t of [r.run?.gate?.owner_reply, r.run?.gate?.reply]) if (typeof t === "string" && t.trim()) out.push(t);
  return out;
}

const PERSON = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/;
const NOT_NAMES = new Set(["Captain", "Manual", "Owner", "Agent", "Parent", "Crew", "None"]);

export function identityOf(records: readonly RunRecord[], docs: readonly ApprovalDoc[], approvalsRaw: readonly string[], withheld: readonly string[]): Identity {
  const ownerText: string[] = records.flatMap(ownerTextOf);
  const names = new Set<string>();
  for (const line of approvalsRaw) {
    try {
      const x = JSON.parse(line);
      const by = String(x.by ?? "").trim();
      if (PERSON.test(by) && !NOT_NAMES.has(by)) {
        names.add(by);
        for (const part of by.split(/\s+/)) if (part.length >= 3 && !NOT_NAMES.has(part)) names.add(part);
      }
    } catch {}
  }
  void docs;
  return { runIds: records.map((r) => r.id), names: [...names], ownerText, withheldIds: withheld };
}

export function approvalLines(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".jsonl")) out.push(...readFileSync(p, "utf8").split("\n").filter((l) => l.trim()));
    }
  };
  walk(dir);
  return out;
}

export interface Built {
  record: RunRecord;
  units: Unit[] | null;
  stratum: Stratum;
  path: string | null;
  how: string | null;
  text: string | null;
}

/** Built texts for answered runs: the frozen path when one is given (stage 2), else the matcher's (stage 1). */
export function builtFor(records: readonly RunRecord[], g: Git, frozen?: Frozen): Built[] {
  const cache = new Map<string, Set<string>>();
  return records.map((r) => {
    const units = unitsOf(r);
    if (!answered(r) || !r.run) return { record: r, units, stratum: "none" as Stratum, path: null, how: null, text: null };
    const fm = r.gatePlan !== null && frontMatterId(r.gatePlan) !== null;
    const m = frozen ? { how: frozen.paths[r.id]?.how ?? null, path: frozen.paths[r.id]?.path ?? null } : matchBuilt(r, g, cache);
    const stratum: Stratum = r.kind === "full" ? (m.path ? "full" : "none") : fm ? "lean-primary" : m.path ? "lean-desc" : "none";
    return { record: r, units, stratum, path: m.path, how: m.how, text: m.path ? builtText(g, m.path) : null };
  });
}

export interface Refusal {
  run: string;
  path: string;
  packets: number;
}

export function unitRows(built: readonly Built[], id: Identity): { rows: UnitRow[]; packets: Map<string, Packet>; changes: Map<string, string>; refused: Map<string, Refusal> } {
  const rows: UnitRow[] = [];
  const packets = new Map<string, Packet>();
  const changes = new Map<string, string>();
  const refused = new Map<string, Refusal>();
  for (const b of built) {
    const owner = sixGrams(ownerTextOf(b.record));
    if (b.stratum === "none" && b.record.kind === "full") continue;
    for (const u of (b.units ?? []).filter(accepted)) {
      const uid = b.record.id + "|" + u.key;
      const change = u.changeText ?? "";
      changes.set(uid, change);
      let hit: boolean | null = null, score: number | null = null, ablatable = false, bytes: number | null = null;
      if (b.text !== null && b.path) {
        const d = diffScore(change, b.record.restore ?? "", b.text);
        hit = d.hit;
        score = d.score;
        ablatable = ablate(change, b.record.restore ?? "", b.text) !== null;
        const src = { unit: uid, commit: "", path: b.path, built: b.text, change };
        const p = buildPacket(src, id);
        if (p) {
          try {
            outbound(p, () => src, id, owner);
            packets.set(uid, p);
            bytes = p.bytes;
          } catch (e) {
            if (!(e instanceof ArError) || e.code !== "E_AR_PACKET_LEAK") throw e;
            const key = b.record.id + "\t" + b.path;
            const r = refused.get(key) ?? { run: b.record.id, path: b.path, packets: 0 };
            r.packets++;
            refused.set(key, r);
          }
        }
      }
      rows.push({ id: uid, run: b.record.id, kind: b.record.kind, stratum: b.stratum, path: b.path, hit, score, ablatable, packetBytes: bytes, incorporated: u.incorporated });
    }
  }
  return { rows, packets, changes, refused };
}

export interface Reading {
  intention: string;
  verdict: Verdict;
  k?: number;
  n?: number;
  value?: number | null;
  lo?: number | null;
  hi?: number | null;
  missing?: number;
  notes: Record<string, number | string | boolean | null>;
}

/** The intention ids (AP-GATE-1 looks like a thread code) are the lane's own constants; the export scan reads around them. */
export const withoutIntentionIds = (t: string): string => t.replace(/\bAP-(?:X-[123]|GATE-[12])\b/g, "AP");

export interface Stage1Out {
  counts: Record<string, number>;
  readable: Record<string, { parsed: number; total: number; gate: boolean }>;
  readings: Reading[];
  gate2: { eligibleRuns: number; eligibleUnits: number; missing: number; hits: number; ablatable: number; refused: number; refusedRuns: number; ok: boolean; reasons: string[] };
  smoke: { minors: number; pass: boolean };
  /** Amendment A1: the refused packets by run and post, kept out of stage1.json and written to refused.json. */
  refusals?: Refusal[];
}

export function stage1(o: { frame: string; repo: string; commit: string; matrix: Matrix; withheld?: string[]; sink: string; frozenFrame?: FrozenFrame }): Stage1Out {
  const { ids } = checkFrame(o.frame, o.frozenFrame ?? FRAME);
  const records = readFrame(join(o.frame, "records"), ids);
  const g = gitAt(o.repo, o.commit);
  const appr = readApprovals(join(o.frame, "approvals"));
  const id = identityOf(records, appr.docs, approvalLines(join(o.frame, "approvals")), o.withheld ?? []);
  const readable: Stage1Out["readable"] = {};
  for (const kind of ["lean", "full"] as const) {
    const rs = records.filter((r) => r.kind === kind);
    const parsed = rs.filter(parses).length;
    readable[kind] = { parsed, total: rs.length, gate: rs.length > 0 && parsed * 10 >= rs.length * 9 };
  }
  const leanOk = readable.lean!.gate;
  const answeredLean = records.filter((r) => r.kind === "lean" && answered(r));

  // X-1
  const x1rows = records.filter((r) => answered(r)).map(x1);
  const x1lean = x1rows.filter((r) => r.kind === "lean");
  const x1k = x1lean.filter((r) => r.completion === true).length, x1n = x1lean.filter((r) => r.completion !== null).length;
  const [x1lo, x1hi] = wilson(x1k, x1n);
  const x1miss = x1lean.length - x1n;
  const readings: Reading[] = [{ intention: "AP-X-1", verdict: decide({ noRead: !leanOk || overMissing(x1miss, x1lean.length) || x1n === 0, lo: x1lo, hi: x1hi, bar: BAR_SHARE }), k: x1k, n: x1n, lo: x1lo, hi: x1hi, missing: x1miss, notes: { delivered: x1lean.filter((r) => r.delivery === true).length, delivery_unread: x1lean.filter((r) => r.delivery === null).length, silence: "by construction on the runner path", full_met: x1rows.filter((r) => r.kind === "full" && r.completion === true).length, full_read: x1rows.filter((r) => r.kind === "full" && r.completion !== null).length, reopens: x1rows.reduce((a, r) => a + r.reopens, 0) } }];

  // X-2
  const x2rows = records.filter((r) => answered(r)).map((r) => x2(r, o.matrix));
  const x2lean = x2rows.filter((r) => r.kind === "lean");
  const shares = x2lean.map((r) => r.share).filter((s): s is number => s !== null);
  const sorted = shares.length ? bootstrapMeans(shares, { seed: SEED, draws: DRAWS }) : [];
  const [x2lo, x2hi] = shares.length ? percentileInterval(sorted, 0.95) : [null, null];
  const strict = x2lean.map((r) => r.strictShare).filter((s): s is number => s !== null);
  const full = x2rows.filter((r) => r.kind === "full").map((r) => r.share).filter((s): s is number => s !== null);
  readings.push({ intention: "AP-X-2", verdict: decide({ noRead: !leanOk || overMissing(x2lean.length - shares.length, x2lean.length) || !shares.length, lo: x2lo, hi: x2hi, bar: BAR_SHARE }), value: shares.length ? mean(shares) : null, lo: x2lo, hi: x2hi, n: shares.length, missing: x2lean.length - shares.length, notes: { strict_mean: strict.length ? mean(strict) : null, missing_cells: x2lean.reduce((a, r) => a + r.missing, 0), absent_cells: x2lean.reduce((a, r) => a + r.applicable - r.present, 0), consensus_excluded: x2lean.reduce((a, r) => a + r.excludedConsensus, 0), checklist_mean: (() => { const c = x2lean.map((r) => r.checklist).filter((x): x is number => x !== null); return c.length ? mean(c) : null; })(), full_mean: full.length ? mean(full) : null, full_runs: full.length } });

  // X-3
  const x3rows = records.flatMap(x3);
  const byDesign = leanByDesign(records);
  const leanPh = x3rows.filter((r) => r.kind === "lean");
  const both = leanPh.filter((r) => r.ran && r.crossFamily === true).length;
  const [x3lo, x3hi] = wilson(both, leanPh.length);
  const fullPh = x3rows.filter((r) => r.kind === "full");
  const accUnits = records.flatMap((r) => unitsOf(r) ?? []);
  readings.push({ intention: "AP-X-3", verdict: decide({ noRead: !leanOk || (!byDesign && !leanPh.length), byDesign, lo: x3lo, hi: x3hi, bar: BAR_SHARE }), k: both, n: leanPh.length, lo: byDesign ? null : x3lo, hi: byDesign ? null : x3hi, notes: { full_phases: fullPh.length, full_ran: fullPh.filter((r) => r.ran).length, full_cross_family: fullPh.filter((r) => r.crossFamily === true).length, honest_coverage: x3rows.filter((r) => r.honest === true).length, not_ran: x3rows.filter((r) => !r.ran).length, outside_findings: fullPh.reduce((a, r) => a + r.outsideFindings, 0), new_by_gstack: fullPh.reduce((a, r) => a + r.newByGstack, 0), new_mechanical: fullPh.reduce((a, r) => a + r.newMechanical, 0), accepted_outside_only: outsideOnlyAccepted(accUnits) } });

  // GATE-1
  const g1 = records.map((r) => gate1(r, appr.docs));
  const violations = g1.filter((r) => r.violation).length;
  const leanG = g1.filter((r) => r.kind === "lean" && r.answered);
  const leanRevs = leanG.flatMap((r) => r.revisions);
  const missingProv = leanRevs.filter((v) => v.attribution === "missing").length;
  const ucViol = leanG.reduce((a, r) => a + r.ucViolations, 0);
  const ownerRevs = g1.flatMap((r) => r.revisions).filter((v) => v.changed !== null);
  readings.push({ intention: "AP-GATE-1", verdict: gate1Verdict({ violations: violations + ucViol, noRead: !leanOk || overMissing(missingProv, leanRevs.length), ucRead: leanG.reduce((a, r) => a + r.ucKept, 0) }), k: violations + ucViol, n: leanRevs.length, missing: missingProv, notes: { self_approvals: violations, unreadable_records: g1.filter((r) => !r.readable).length, uc_lean_items: leanG.reduce((a, r) => a + r.ucItems, 0), uc_lean_kept: leanG.reduce((a, r) => a + r.ucKept, 0), uc_lean_violations: ucViol, uc_lean_missing: leanG.reduce((a, r) => a + r.ucMissing, 0), recorded: g1.flatMap((r) => r.revisions).filter((v) => v.attribution === "recorded").length, corroborated: g1.flatMap((r) => r.revisions).filter((v) => v.attribution === "corroborated").length, delegated: g1.flatMap((r) => r.revisions).filter((v) => v.attribution === "delegated").length, missing_provenance: g1.flatMap((r) => r.revisions).filter((v) => v.attribution === "missing").length, changed_revisions: ownerRevs.filter((v) => v.changed).length, owner_revisions: ownerRevs.length, changed_items: ownerRevs.reduce((a, v) => a + v.changedItems, 0), owner_items: ownerRevs.reduce((a, v) => a + v.items, 0), auto_rec: g1.reduce((a, r) => a + r.autoRec, 0), reversed: g1.reduce((a, r) => a + r.reversed, 0), reopens: g1.reduce((a, r) => a + r.reopens, 0), approvals_unreadable: appr.unreadable } });

  // GATE-2 preparation
  const built = builtFor(records, g);
  const { rows, packets, refused } = unitRows(built, id);
  const refusedPackets = [...refused.values()].reduce((a, r) => a + r.packets, 0);
  const refusedRuns = new Set([...refused.values()].map((r) => r.run)).size;
  const primary = rows.filter((r) => r.stratum === "lean-primary");
  const primaryMissing = primary.filter((r) => r.packetBytes === null).length;
  const eligibleRuns = new Set(built.filter((b) => b.stratum === "lean-primary").map((b) => b.record.id)).size;
  const cands: Candidate[] = rows.filter((r) => r.packetBytes !== null).map((r) => ({ id: r.id, hit: r.hit === true, ablatable: r.ablatable }));
  const sup = supply(cands);
  const reasons: string[] = [];
  if (!leanOk) reasons.push("lean stratum under 90% readable");
  if (eligibleRuns < 10) reasons.push("fewer than 10 eligible lean runs");
  if (primary.length < 40) reasons.push("fewer than 40 eligible lean units");
  if (overMissing(primaryMissing, primary.length)) reasons.push("more than 20% of eligible units missing");
  if (!sup.ok) reasons.push("gold supply short");
  if (refusedPackets) reasons.push("E_AR_PACKET_LEAK refused " + refusedPackets + " packets in " + refusedRuns + " runs");
  const gate2 = { eligibleRuns, eligibleUnits: primary.length, missing: primaryMissing, hits: sup.hits, ablatable: sup.ablatable, refused: refusedPackets, refusedRuns, ok: reasons.length === 0, reasons };
  const frozen: Frozen = { main_commit: g.commit, paths: Object.fromEntries(built.filter((b) => b.path).map((b) => [b.record.id, { path: b.path!, how: b.how! }])) };
  const draws = { seed: SEED, gold: drawGold(cands), full: drawFullSample(rows.filter((r) => r.stratum === "full" && r.packetBytes !== null).map((r) => r.id)) };

  // Parser smoke (free): one record from each gstack minor version.
  const minors = new Map<string, RunRecord>();
  for (const r of [...records].sort((a, b) => (a.id < b.id ? -1 : 1))) if (!minors.has(minorOf(r))) minors.set(minorOf(r), r);
  const smoke = { minors: minors.size, pass: [...minors.values()].every(parses) };

  const counts: Record<string, number> = {
    records: records.length,
    lean: records.filter((r) => r.kind === "lean").length,
    full: records.filter((r) => r.kind === "full").length,
    answered_lean: answeredLean.length,
    answered_full: records.filter((r) => r.kind === "full" && answered(r)).length,
    unreadable_files: records.reduce((a, r) => a + r.unreadable.length, 0),
    units_lean: records.filter((r) => r.kind === "lean").reduce((a, r) => a + (unitsOf(r)?.length ?? 0), 0),
    units_full: records.filter((r) => r.kind === "full").reduce((a, r) => a + (unitsOf(r)?.length ?? 0), 0),
    plan_change_rows_lean: records.filter((r) => r.kind === "lean").reduce((a, r) => a + (unitsOf(r) ?? []).filter((u) => u.planChange).reduce((s, u) => s + u.rows.length, 0), 0),
    accepted_lean: records.filter((r) => r.kind === "lean").reduce((a, r) => a + (unitsOf(r) ?? []).filter(accepted).length, 0),
    accepted_full: records.filter((r) => r.kind === "full").reduce((a, r) => a + (unitsOf(r) ?? []).filter(accepted).length, 0),
    excluded_no_edit: records.reduce((a, r) => a + (unitsOf(r) ?? []).filter((u) => u.excluded !== null).length, 0),
    front_matter_runs: built.filter((b) => b.record.gatePlan !== null && frontMatterId(b.record.gatePlan) !== null && b.stratum !== "none").length,
    built_runs_lean: built.filter((b) => b.record.kind === "lean" && b.path).length,
    built_runs_full: built.filter((b) => b.record.kind === "full" && b.path).length,
    units_lean_primary: primary.length,
    units_lean_desc: rows.filter((r) => r.stratum === "lean-desc" && r.path).length,
    units_full_built: rows.filter((r) => r.stratum === "full").length,
    mechanical_hits_primary: primary.filter((r) => r.hit === true).length,
    packets: packets.size,
    packets_refused: refusedPackets,
    largest_packet: Math.max(0, ...[...packets.values()].map((p) => p.bytes)),
  };
  const out: Stage1Out = { counts, readable, readings, gate2, smoke };
  const exported = JSON.stringify(out);
  exportCheck(withoutIntentionIds(exported), id, "the stage 1 export");
  writeJson(join(o.sink, "stage1.json"), out);
  writeJson(join(o.sink, "matched.json"), frozen);
  writeJson(join(o.sink, "units.json"), rows);
  writeJson(join(o.sink, "draws.json"), draws);
  writeJson(join(o.sink, "refused.json"), [...refused.values()]);
  return { ...out, refusals: [...refused.values()] };
}

export function printLines(out: Stage1Out): string[] {
  const f = (x: number | null | undefined) => (x === null || x === undefined ? "none" : Number.isInteger(x) ? String(x) : x.toFixed(4));
  return [
    ...Object.entries(out.counts).map(([k, v]) => "count " + k + " " + v),
    ...Object.entries(out.readable).map(([k, v]) => "readable " + k + " " + v.parsed + " of " + v.total + (v.gate ? " pass" : " FAIL")),
    ...out.readings.map((r) => r.intention + " " + r.verdict + (r.k !== undefined ? " k " + r.k : "") + (r.n !== undefined ? " n " + r.n : "") + (r.value !== undefined ? " value " + f(r.value) : "") + (r.lo !== undefined ? " ci " + f(r.lo) + " " + f(r.hi) : "") + (r.missing !== undefined ? " missing " + r.missing : "") + " | " + Object.entries(r.notes).map(([k, v]) => k + " " + (typeof v === "number" ? f(v) : String(v))).join(" ")),
    "gate2 eligible_runs " + out.gate2.eligibleRuns + " eligible_units " + out.gate2.eligibleUnits + " missing " + out.gate2.missing + " hits " + out.gate2.hits + " ablatable " + out.gate2.ablatable + " " + (out.gate2.ok ? "pass" : "NO READ (" + out.gate2.reasons.join("; ") + ")"),
    ...(out.refusals ?? []).map((r) => "refused run " + r.run + " path " + r.path + " packets " + r.packets),
    "parser smoke minors " + out.smoke.minors + " " + (out.smoke.pass ? "pass" : "FAIL"),
  ];
}

export { ArError };
