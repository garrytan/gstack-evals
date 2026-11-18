// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's authoring run, second attempt (its sections 4 and 5, over the first attempt's
// section 3, "Supply" and "Unanimous key"). It drives the 68 kept slots of the seeded schedule through runDraft:
// - The reused briefs, each already checked against its recorded digest and slot by the reader (custody.ts
//   readReuse), are placed in their slots before anything is drawn.
// - Each slot's drafts follow a fixed sequence (section 5.1): its k-th first-twin or unpaired draft is draw
//   1000 * (p + 1) + k, from the family p + k names, and a second twin is its partner's next attempt, from its partner's
//   family. A batch gives the first slots that want a draft, in section 5.6's order, their next draft, so concurrency
//   changes how many drafts run at once and never which draft a slot makes next.
// - A partner gets at most 30 second twins (section 5.3, as the Captain ruled on 2026-11-18). When all fail, the
//   partner drops and its slot starts its next pair; a pair is placed only with both twins, and a partner still open
//   when authoring ends drops.
// - The pilot (section 5.4) comes first: the first two open calibration and comparison slots of each pair type, each
//   until it settles one partner or has drafted 3 first twins, and 8 drafts each of T7, T8 and builders, one a slot in
//   turn over that kind's open slots in seeded order. Its briefs are placed like any other.
// - Then every open calibration and comparison slot draws in seeded order, and then the reserves (section 5.6). The
//   projection (pilot.ts) is read at the pilot's end and after every later batch and recorded in the summary. It is a
//   descriptive read only: since the Captain's ruling of 2026-11-18 it never stops authoring, which ends only at its
//   quotas, its cap, a stop that is not about money, or the draft limit.
// - Every settled draft, with the dollars its calls took on the meter, goes through the journal before the run counts
//   it, and after every batch, before the next starts, the journal seals the outcome log and the placed briefs (section
//   5.2); the run's last checkpoint also holds why it ended. A run resumes from
//   a checkpoint and the drafts sealed after it: each slot's state is rebuilt from the log, so a settled draft is never
//   requested again and a draft that was in flight is drawn again as the same request.
// - A batch never starts more drafts than the cap less the spend so far covers at one $3.50 allowance each. Authoring
//   also stops after 10,000 drafts, or before a slot's 1,000th first-twin or unpaired draft, whose draw number would
//   reach the next slot's; the cap stops a real run long before either.
// - A cap stop (that batch rule, or CAP_STOP thrown by a call) before calibration and comparison are full halts
//   authoring; after, it ends authoring with the reserves it placed. A stop that is not about money (a closed lease, a
//   model or provider drift, the empty-reply bound) halts the run in any phase. A thrown stop ends the run once the
//   batch's drafts settle, so the briefs already placed are still written and sealed; a cap stop thrown in a batch
//   takes precedence over any other stop there, and the run keeps every stop code the batch threw. A cap stop is final:
//   the journal records it, and a resume refuses its run (custody.ts readJournal).
import { AuthorError } from "../../office-hours-founder/author/files.ts";
import { BRIEF_ALLOWANCE, PAIRED_TYPES, PILOT, QUOTA, REUSED_SLOTS, TOP_UP_BOUND } from "../frozen.ts";
import type { BriefMeta } from "../types.ts";
import type { CheckAnswer } from "../score/packets.ts";
import { draftId, runDraft, type Outcome, type Partner } from "./brief.ts";
import type { Deps, Validation, Validator } from "./checks.ts";
import { drawOf, familyOf, schedule, type Slot } from "./draws.ts";
import type { Role } from "./files.ts";
import { predicted, readProjection, UNPAIRED_KINDS, type Counts, type KN, type Open, type ProjectionRead, type UnpairedKind } from "./pilot.ts";
import { placeSets, setRecord, type Member, type Sets } from "./sets.ts";

/** More drafts than any run can make inside its cap: $409 buys about 4,400 second twins at the first attempt's $0.093. */
export const MAX_DRAFTS = 10000;
/** A slot's first-twin and unpaired drafts stay below this, so its draw numbers never reach the next slot's. */
export const SLOT_DRAWS = 999;

/** One settled draft in the outcome log: its outcome, its place in the log and the dollars its calls took on the meter. */
export interface LogEntry extends Outcome {
  seq: number;
  spend: number;
}

/** The first attempt's briefs as the reader checked them: the placed outcomes, their recorded check answers, and every brief that failed and is drafted again. */
export interface Reuse {
  placed: Outcome[];
  answers: CheckAnswer[];
  failed: { id: string; slot: string; why: string }[];
}
export const NO_REUSE: Reuse = { placed: [], answers: [], failed: [] };

/** Why a run ended: how it stopped, and every stop code its last batch threw. */
export interface End {
  stopped: AuthorRun["stopped"];
  codes: string[];
}

/** What a checkpoint holds and a resume starts from; the run's last checkpoint also holds its end. */
export interface Checkpoint {
  log: LogEntry[];
  reuse: Reuse;
  reads: ProjectionRead[];
  end?: End;
}

/** Seals each settled draft before the run counts it, and the outcome log with every placed brief after a batch (custody.ts sealedJournal). */
export interface Journal {
  record(e: LogEntry): void;
  checkpoint(c: Checkpoint, placed: readonly Outcome[]): void;
}

/** The meter's settled spend on the item, and the dollars settled on one brief's calls (every call label starts with its brief id). */
export type AuthorDeps = Deps & { spent: () => number; spentOn: (brief: string) => number };

export interface AuthorRun {
  /** This run's settled drafts, resumed ones included, in the order they settled. */
  outcomes: LogEntry[];
  reuse: Reuse;
  reads: ProjectionRead[];
  sets: Sets;
  /** First twins still waiting for a passing second twin when authoring ended; they drop. */
  unmatched: string[];
  stopped: "quotas" | "cap" | "schedule" | "halt";
  /** Calibration and comparison were full when authoring ended. */
  full: boolean;
  /** The stop a draft or label call threw, which ended the run (a cap stop before any other); null when none did. */
  halt: AuthorError | null;
  /** Every stop code the last batch threw. */
  codes: string[];
}

interface SlotState {
  /** First-twin or unpaired drafts made. */
  k: number;
  placed: Outcome[] | null;
  partner: Outcome | null;
  /** Second twins drafted against the current partner. */
  seconds: number;
}

/** The stops a draft or label call may throw (wire.ts, meter.ts); any other error is a bug and still rejects the run. */
const STOPS: ReadonlySet<string> = new Set(["CAP_STOP", "E_LEASE_CLOSED", "E_OHR_MODEL_DRIFT", "E_PV_PROVIDER_DRIFT", "E_PV_EMPTY_REPLIES"]);

/** Waits for every draft in the batch, then returns its stop (a cap stop before any other) with every stop code, or null; any other error is rethrown. */
async function settleBatch(batch: Promise<void>[]): Promise<{ halt: AuthorError; codes: string[] } | null> {
  const errors = (await Promise.allSettled(batch)).flatMap((x) => (x.status === "rejected" ? [x.reason] : []));
  const other = errors.find((e) => !STOPS.has(e?.code));
  if (other) throw other;
  const e = errors.find((x) => x.code === "CAP_STOP") ?? errors[0];
  return e ? { halt: new AuthorError(e.code, String(e.message).slice(e.code.length + 1)), codes: [...new Set(errors.map((x) => String(x.code)))] } : null;
}

export const kindOf = (s: Pick<Slot, "kind" | "type">): UnpairedKind | null => (s.kind === "builder" ? "builder" : s.kind === "founder" ? (s.type as UnpairedKind) : null);

/** This run's part of the projection's counts, from the outcome log. */
export function countsOf(log: readonly Outcome[]): Counts {
  const slots = new Map(schedule().map((s) => [s.slot, s]));
  const kn = (xs: readonly Outcome[]): KN => [xs.filter((x) => x.status === "pass").length, xs.length];
  const seconds = log.filter((x) => x.role === "second");
  const settled = (t: string) => seconds.filter((x) => slots.get(x.slot)!.type === t && (x.status === "pass" || x.attempt === TOP_UP_BOUND));
  const matched = seconds.filter((x) => x.status === "pass");
  const unpaired = (u: UnpairedKind) => kn(log.filter((x) => x.role === "unpaired" && kindOf(slots.get(x.slot)!) === u));
  return {
    first: kn(log.filter((x) => x.role === "first")),
    partners: Object.fromEntries(PAIRED_TYPES.map((t) => [t, kn(settled(t))])),
    matched_draws: [matched.reduce((n, x) => n + x.attempt, 0), matched.length],
    unpaired: { T7: unpaired("T7"), T8: unpaired("T8"), builder: unpaired("builder") },
  };
}

export async function authorRun(deps: AuthorDeps, o: { cap: number; concurrency: number; reuse?: Reuse; resume?: Checkpoint; journal?: Journal }): Promise<AuthorRun> {
  const slots = schedule();
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const st = new Map<string, SlotState>(slots.map((s) => [s.slot, { k: 0, placed: null, partner: null, seconds: 0 }]));
  const reuse = o.resume?.reuse ?? o.reuse ?? NO_REUSE;
  const log: LogEntry[] = [];
  const reads: ProjectionRead[] = [...(o.resume?.reads ?? [])];
  let checkpointed = -1;

  for (const slot of new Set(reuse.placed.map((x) => x.slot))) {
    const s = bySlot.get(slot), xs = reuse.placed.filter((x) => x.slot === slot);
    const whole = s?.kind === "pair" ? xs.length === 2 && xs.some((x) => x.role === "first") && xs.some((x) => x.role === "second") : xs.length === 1;
    if (!s || !REUSED_SLOTS.includes(slot) || !whole) throw new AuthorError("E_OHR_REUSE", "reused slot " + slot + " is not one of the second attempt's reused slots, or does not hold one whole brief or pair");
    st.get(slot)!.placed = [...xs].sort((a, b) => (a.role === "first" ? -1 : b.role === "first" ? 1 : 0));
  }
  const reusedSlots = new Set(reuse.placed.map((x) => x.slot));

  const apply = (x: Outcome) => {
    const s = st.get(x.slot)!;
    if (x.role !== "second") s.k++;
    if (x.role === "second") s.seconds++;
    if (x.status === "pass" && x.role === "first") (s.partner = x), (s.seconds = 0);
    else if (x.status === "pass" && x.role === "second") (s.placed = [s.partner!, x]), (s.partner = null);
    else if (x.status === "pass") s.placed = [x];
    else if (x.role === "second" && s.seconds >= TOP_UP_BOUND) s.partner = null;
  };
  for (const e of o.resume?.log ?? []) {
    if (e.seq !== log.length + 1) throw new AuthorError("E_OHR_RESUME", "the outcome log holds draft " + e.seq + " at place " + (log.length + 1));
    log.push(e);
    apply(e);
  }

  const settle = (e: LogEntry) => {
    e.seq = log.length + 1;
    o.journal?.record(e);
    log.push(e);
    apply(e);
  };
  const start = (slot: Slot, pilot: boolean): Promise<void> => {
    const s = st.get(slot.slot)!;
    const p = s.partner;
    const k = s.k + 1;
    const role: Role = p ? "second" : slot.kind === "pair" ? "first" : "unpaired";
    const partner: Partner | null = p ? { id: p.id, files: p.files!, twin_call: p.twin_call! } : null;
    const spec = p ? { draw: p.draw, attempt: s.seconds + 1, author: p.author, pilot, partner } : { draw: drawOf(slot.p, k), attempt: 1, author: familyOf(slot.p, k), pilot, partner };
    const id = draftId(role, spec.draw, partner);
    const before = deps.spentOn(id);
    return runDraft(slot, role, spec, deps).then((x) => settle({ ...x, seq: 0, spend: deps.spentOn(id) - before }));
  };
  const open = (s: Slot) => !st.get(s.slot)!.placed;
  const main = slots.filter((s) => s.set !== "reserve");
  const reserves = slots.filter((s) => s.set === "reserve");
  const pilotPairs = new Set(PAIRED_TYPES.flatMap((t) => main.filter((s) => s.type === t && !reusedSlots.has(s.slot)).slice(0, PILOT.pair_slots).map((s) => s.slot)));
  const pilotLog = (slot: string) => log.filter((x) => x.pilot && x.slot === slot);

  const pilotWants = (): Slot[] => {
    const out = main.filter((s) => {
      if (!pilotPairs.has(s.slot) || !open(s)) return false;
      const mine = pilotLog(s.slot), partner = st.get(s.slot)!.partner;
      if (mine.some((x) => x.role === "second" && (x.status === "pass" || x.attempt === TOP_UP_BOUND))) return false;
      return partner ? partner.pilot : mine.filter((x) => x.role === "first").length < PILOT.first_twins;
    });
    for (const u of UNPAIRED_KINDS) {
      const kind = main.filter((s) => kindOf(s) === u && open(s));
      const made = log.filter((x) => x.pilot && kindOf(bySlot.get(x.slot)!) === u).length;
      if (!kind.length || made >= PILOT.unpaired_drafts) continue;
      const turn = Math.min(...kind.map((s) => pilotLog(s.slot).length));
      out.push(...kind.filter((s) => pilotLog(s.slot).length === turn).slice(0, PILOT.unpaired_drafts - made));
    }
    return out.sort((a, b) => a.p - b.p);
  };
  const openOf = (): Open => {
    const left = main.filter(open);
    const pairs = Object.fromEntries(PAIRED_TYPES.map((t) => [t, left.filter((s) => s.kind === "pair" && s.type === t).length]));
    const n = (u: UnpairedKind) => left.filter((s) => kindOf(s) === u).length;
    return { pairs, unpaired: { T7: n("T7"), T8: n("T8"), builder: n("builder") } };
  };
  const placedOutcomes = () => slots.flatMap((s) => st.get(s.slot)!.placed ?? []);
  const checkpoint = (end?: End) => {
    if (log.length === checkpointed && !end) return;
    checkpointed = log.length;
    o.journal?.checkpoint({ log: [...log], reuse, reads: [...reads], ...(end ? { end } : {}) }, placedOutcomes());
  };
  const finish = (stopped: AuthorRun["stopped"], stop: { halt: AuthorError; codes: string[] } | null): AuthorRun => {
    const codes = stop?.codes ?? [];
    checkpoint({ stopped, codes });
    const members: Member[] = slots.flatMap((s) => (st.get(s.slot)!.placed ?? []).map((x) => memberOf(s, x)));
    return { outcomes: [...log], reuse, reads: [...reads], sets: placeSets(members), unmatched: slots.flatMap((s) => (st.get(s.slot)!.partner ? [st.get(s.slot)!.partner!.id] : [])), stopped, full: main.every((s) => !open(s)), halt: stop?.halt ?? null, codes };
  };

  if (o.resume) checkpointed = log.length;
  for (;;) {
    const pilot = pilotWants();
    const wants = pilot.length ? pilot : main.some(open) ? main.filter(open) : reserves.filter(open);
    if (!wants.length) return finish("quotas", null);
    const size = Math.min(o.concurrency, Math.floor((o.cap - deps.spent()) / BRIEF_ALLOWANCE));
    if (size <= 0) return finish("cap", null);
    const batch = wants.slice(0, size);
    if (log.length >= MAX_DRAFTS || batch.some((s) => st.get(s.slot)!.k >= SLOT_DRAWS)) return finish("schedule", null);
    checkpoint();
    const stop = await settleBatch(batch.map((s) => start(s, pilot.length > 0)));
    if (!pilotWants().length) reads.push(readProjection({ counts: countsOf(log), open: openOf(), spend: log.reduce((t, x) => t + x.spend, 0), predicted: log.reduce((t, x) => t + predicted(x.role), 0), cap: o.cap, committed: deps.spent(), drafts: log.length }));
    if (stop) return finish(stop.halt.code === "CAP_STOP" ? "cap" : "halt", stop);
  }
}

/** A placed brief's set membership: the slot's set and skin, its opening cluster and its digest. */
export const memberOf = (s: Slot, x: Outcome): Member => ({ id: x.id, slot: s.slot, set: s.set, kind: s.kind, type: s.type, skin: s.skin, cluster: "d" + x.draw, draw: x.draw, twin: x.files!.key.twin, digest: x.digest!, pilot: x.pilot });

/** A placed brief's brief.json. */
export const metaOf = (s: Slot, x: Outcome): BriefMeta => ({ id: x.id, kind: s.kind === "builder" ? "builder" : "founder", type: s.type, skin: s.skin, cluster: "d" + x.draw, set: s.set, draw: x.draw, author: x.author, twin_of: x.files!.key.twin, traction: x.files!.key.traction, anti_pattern: s.anti_pattern, industry: s.industry, pilot: x.pilot, digest: x.digest! });

const needed = QUOTA.founder + QUOTA.builder + QUOTA.calibration + QUOTA.reserve;
export const placedCount = (r: AuthorRun): number => r.sets.calibration.length + r.sets.comparison.length + r.sets.reserve.length;
const placedLine = (r: AuthorRun) => placedCount(r) + " of " + needed + " briefs placed (calibration " + r.sets.calibration.length + ", comparison " + r.sets.comparison.length + ", reserve " + r.sets.reserve.length + ", " + r.reuse.placed.length + " of them reused)";

/**
 * The halt a run owes after its files are written: a stop a draft or label call threw (a cap stop only before
 * calibration and comparison are full), or a shortfall before calibration and comparison are full.
 * Null when they are full and authoring ended on its quotas or on a cap stop.
 */
export function haltOf(r: AuthorRun, mdd: (comparisonFounderBriefs: number) => number | null): AuthorError | null {
  if (r.halt && !(r.halt.code === "CAP_STOP" && r.full)) return new AuthorError(r.halt.code, r.halt.message.slice(r.halt.code.length + 1) + "; authoring stopped there with " + placedCount(r) + " briefs placed, all written and sealed under custody");
  if (r.full && r.stopped !== "schedule") return null;
  const founders = r.sets.comparison.filter((m) => m.kind !== "builder").length;
  const m = mdd(founders);
  return new AuthorError("E_OHR_SUPPLY_SHORT", "authoring stopped at " + r.stopped + " with " + placedLine(r) + "; the comparison set holds " + founders + " founder briefs, MDD " + (m === null ? "not defined" : m.toFixed(3)) + " there; " + r.unmatched.length + " unmatched twins dropped");
}

/**
 * Section 12's judge check reads authoring's full-information and opening-only answers in block form: one per validator
 * and source on every placed brief, in score/packets.ts's CheckAnswer shape. author names the validator that answered.
 * A reused brief's answers are the ones its first attempt recorded.
 */
export function checkAnswers(r: AuthorRun): CheckAnswer[] {
  const placed = new Set([...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].map((m) => m.id));
  const out: CheckAnswer[] = r.reuse.answers.filter((a) => placed.has(a.brief));
  for (const x of r.outcomes) {
    if (x.status !== "pass" || !placed.has(x.id)) continue;
    const v = x.record.validators as { unanimous: Record<Validator, Validation | null>; opening_only: Record<Validator, Validation | null> | null };
    for (const [source, got] of [["full", v.unanimous], ["opening", v.opening_only]] as const) for (const [author, a] of Object.entries(got ?? {})) if (a) out.push({ brief: x.id, author, source, block: a.block });
  }
  return out;
}

/** The run's printable record: counts and digests only. */
export function summaryOf(r: AuthorRun) {
  const drops = r.outcomes.filter((x) => x.status === "drop");
  const seconds = r.outcomes.filter((x) => x.role === "second");
  const pilot = r.outcomes.filter((x) => x.pilot);
  const slots = new Map(schedule().map((s) => [s.slot, s]));
  return {
    stopped: r.stopped,
    full: r.full,
    codes: r.codes,
    drafts: r.outcomes.length,
    passed: r.outcomes.length - drops.length,
    rewritten: r.outcomes.filter((x) => x.rewrites).length,
    spend: Math.round(r.outcomes.reduce((t, x) => t + x.spend, 0) * 1e6) / 1e6,
    drops: Object.fromEntries([...new Set(drops.map((x) => x.step!))].sort().map((k) => [k, drops.filter((x) => x.step === k).length])),
    pilot: { drafts: pilot.length, passed: pilot.filter((x) => x.status === "pass").length, by_kind: Object.fromEntries(["pair", "founder", "builder"].map((k) => [k, pilot.filter((x) => slots.get(x.slot)!.kind === k).length])) },
    second_twins: { draws: seconds.length, passed: seconds.filter((x) => x.status === "pass").length, dropped_at_bound: seconds.filter((x) => x.status !== "pass" && x.attempt === TOP_UP_BOUND).length },
    reused: { placed: r.reuse.placed.length, failed: r.reuse.failed.map((f) => ({ id: f.id, slot: f.slot, why: f.why })) },
    projections: r.reads.map((p) => ({ drafts: p.drafts, projection: Math.round(p.projection * 100) / 100, room: Math.round(p.room * 100) / 100, scale: Math.round(p.scale * 1000) / 1000, over: p.over })),
    unmatched: r.unmatched.length,
    placed: placedCount(r),
    sets: { calibration: setRecord(r.sets.calibration), comparison: setRecord(r.sets.comparison), reserve: setRecord(r.sets.reserve) },
  };
}
