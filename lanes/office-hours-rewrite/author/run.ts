// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's authoring run (prereg section 3, "Supply" and "Unanimous key"; section 13's authoring
// line; pre-run change 1 item 4d). It drives the 76 slots of the seeded schedule through runDraft:
// - The pilot comes first, on pair slots only, in draw order: first twins, and a second-twin draw for every partner that
//   passed, top-ups included, until exactly 16 second-twin draws have settled. The gate then reads the yield against the
//   line from the pilot's own cost per draw (the authoring lease's spend over its drafts) and its first twins' pass rate.
//   An open read draws on to 32 and reads once more. A stop, an open second read, a missing line or a cap stop halts
//   authoring with the numbers.
// - Then every slot draws until all 110 briefs are placed, the cap stops it or the draft bound is reached: an unpaired
//   slot or a pair's first twin that fails is drawn again, and a pair whose second twin fails gets a newly authored twin
//   against the same partner. A pair is placed only when both twins pass; a partner still unmatched at the end drops.
// - A batch never starts more drafts than the cap less the spend so far covers at one $3.50 allowance each.
// - A stop a draft or label call throws (a ledger refusal, a closed lease, a model or provider drift, or the empty-reply
//   bound) ends the run like a cap stop once the batch's drafts settle, and the run carries it as its halt, so ohr author
//   still seals what placed.
// Pilot briefs are placed like any other, through the same checks and slots; when the run continues from an earlier
// pilot whose prompts or screen differ from the current ones (its frozen-inputs digest), no pilot brief is placed.
import { sha256 } from "../../office-hours-founder/author/files.ts";
import { PILOT, QUOTA } from "../frozen.ts";
import type { BriefMeta } from "../types.ts";
import { runDraft, firstPrompt, type Outcome } from "./brief.ts";
import type { Deps } from "./checks.ts";
import { authorOf, schedule, type Slot } from "./draws.ts";
import { AuthorError } from "../../office-hours-founder/author/files.ts";
import { BRIEF_ALLOWANCE, line, pilotRead, projectedCost, type ReadRecord } from "./pilot.ts";
import { ANSWER_NOW, AUDIT_CHECKS, FACTS_LINE, NAMED_TERMS, REQUEST, REWRITE_NOTE, twinPrompt } from "./prompts.ts";
import { placeSets, setRecord, type Member, type Sets } from "./sets.ts";
import type { Screen } from "./screens.ts";
import type { CheckAnswer } from "../score/packets.ts";
import type { Validation, Validator } from "./checks.ts";

/** More drafts than any run can make inside its cap. */
export const MAX_DRAFTS = 1000;

/** sha256 over every author prompt, the twin prompt's text, the screen and the fixed notes: a change voids the pilot's briefs. */
export function inputsDigest(screen: Screen): string {
  return sha256(JSON.stringify({
    first: schedule().map(firstPrompt),
    twin: twinPrompt("T1", 0, "opening", { persona: "persona", facts: [] }, ["F1"], "call"),
    screen: [...screen.grams].sort(),
    notes: [AUDIT_CHECKS, REWRITE_NOTE, FACTS_LINE, REQUEST, ANSWER_NOW, NAMED_TERMS],
  }));
}

export type PilotVerdict = "go" | "stop" | "open" | "no-line" | "cap" | "schedule";

export interface PilotRecord {
  digest: string;
  verdict: PilotVerdict;
  drafts: number;
  spent: number;
  draw_usd: number;
  first_draws: number;
  first_passed: number;
  first_pass: number;
  second_draws: number;
  second_passed: number;
  line: number | null;
  reads: ReadRecord[];
  /** Authoring's projected cost at the measured yield, on a go. */
  projected: number | null;
  outcomes: Outcome[];
}

export interface AuthorRun {
  pilot: PilotRecord;
  /** Whether the pilot's passing briefs may be placed (its digest matches the current inputs). */
  pilot_placed: boolean;
  outcomes: Outcome[];
  sets: Sets;
  /** First twins still waiting for a passing second twin when authoring ended; they drop. */
  unmatched: string[];
  stopped: "quotas" | "cap" | "schedule" | "pilot";
  /** The stop a draft or label call threw, which ended the run; null when none did. */
  halt: AuthorError | null;
}

interface SlotState {
  placed: Outcome[] | null;
  partner: Outcome | null;
  seconds: number;
}

/** The stops a draft or label call may throw (wire.ts, meter.ts); any other error is a bug and still rejects the run. */
const STOPS: ReadonlySet<string> = new Set(["CAP_STOP", "E_LEASE_CLOSED", "E_OHR_MODEL_DRIFT", "E_PV_PROVIDER_DRIFT", "E_PV_EMPTY_REPLIES"]);

/** Waits for every draft in the batch, then returns the first stop one threw, or null; any other error is rethrown. */
async function settleBatch(batch: Promise<void>[]): Promise<AuthorError | null> {
  const errors = (await Promise.allSettled(batch)).flatMap((x) => (x.status === "rejected" ? [x.reason] : []));
  const other = errors.find((e) => !STOPS.has(e?.code));
  if (other) throw other;
  return errors.length ? new AuthorError(errors[0].code, String(errors[0].message).slice(errors[0].code.length + 1)) : null;
}

export async function authorRun(deps: Deps & { spent: () => number }, o: { cap: number; concurrency: number; pilotOnly?: boolean; pilot?: PilotRecord }): Promise<AuthorRun> {
  const slots = schedule();
  const digest = inputsDigest(deps.screen);
  const st = new Map<string, SlotState>(slots.map((s) => [s.slot, { placed: null, partner: null, seconds: 0 }]));
  const outcomes: Outcome[] = [];
  let draw = 0;
  let inPilot = !o.pilot;
  let halt: AuthorError | null = null;

  const settle = (slot: Slot, out: Outcome) => {
    outcomes.push(out);
    const s = st.get(slot.slot)!;
    if (out.status !== "pass") return;
    if (out.role === "first") s.partner = out;
    else if (out.role === "second") (s.placed = [s.partner!, out]), (s.partner = null);
    else s.placed = [out];
  };
  const first = (slot: Slot) => {
    const n = ++draw;
    return runDraft(slot, slot.kind === "pair" ? "first" : "unpaired", { draw: n, attempt: 1, author: authorOf(n), pilot: inPilot, partner: null }, deps).then((x) => settle(slot, x));
  };
  const second = (slot: Slot) => {
    const s = st.get(slot.slot)!, p = s.partner!;
    s.seconds++;
    return runDraft(slot, "second", { draw: p.draw, attempt: s.seconds, author: p.author, pilot: inPilot, partner: { id: p.id, files: p.files!, twin_call: p.twin_call! } }, deps).then((x) => settle(slot, x));
  };
  const room = () => Math.min(o.concurrency, Math.floor((o.cap - deps.spent()) / BRIEF_ALLOWANCE));
  const open = (slot: Slot) => !st.get(slot.slot)!.placed;

  if (o.pilot) {
    if (o.pilot.verdict !== "go") throw new AuthorError("E_USAGE", "authoring continues only from a pilot that read go; this one read " + o.pilot.verdict);
    draw = Math.max(0, ...o.pilot.outcomes.map((x) => x.draw));
    if (o.pilot.digest === digest) for (const x of o.pilot.outcomes) settle(slots.find((s) => s.slot === x.slot)!, x);
  }

  let pilot: PilotRecord | null = o.pilot ?? null;
  const pairs = slots.filter((s) => s.kind === "pair");
  const pilotSeconds = () => outcomes.filter((x) => x.role === "second").length;
  const pilotStop = (verdict: PilotVerdict, reads: ReadRecord[], l: number | null): PilotRecord => {
    const firsts = outcomes.filter((x) => x.role === "first");
    const seconds = outcomes.filter((x) => x.role === "second");
    const spent = deps.spent();
    const firstPass = firsts.length ? firsts.filter((x) => x.status === "pass").length / firsts.length : 0;
    const y = seconds.length ? seconds.filter((x) => x.status === "pass").length / seconds.length : 0;
    const drawUsd = outcomes.length ? spent / outcomes.length : 0;
    return { digest, verdict, drafts: outcomes.length, spent, draw_usd: drawUsd, first_draws: firsts.length, first_passed: firsts.filter((x) => x.status === "pass").length, first_pass: firstPass, second_draws: seconds.length, second_passed: seconds.filter((x) => x.status === "pass").length, line: l, reads, projected: verdict === "go" && y > 0 ? projectedCost(drawUsd, firstPass, y) : null, outcomes: [...outcomes] };
  };

  if (!pilot) {
    const reads: { k: number; n: number }[] = [];
    for (let target: number = PILOT.first_read; !pilot; ) {
      while (pilotSeconds() < target) {
        const size = room();
        if (size <= 0) {
          pilot = pilotStop("cap", [], null);
          break;
        }
        if (outcomes.length >= MAX_DRAFTS) {
          pilot = pilotStop("schedule", [], null);
          break;
        }
        const left = target - pilotSeconds();
        const waiting = pairs.filter((s) => open(s) && st.get(s.slot)!.partner);
        const batch = [...waiting.slice(0, Math.min(size, left)).map(second)];
        const fresh = pairs.filter((s) => open(s) && !st.get(s.slot)!.partner).slice(0, Math.max(0, Math.min(size - batch.length, left - waiting.length)));
        batch.push(...fresh.map(first));
        if (!batch.length) {
          pilot = pilotStop("schedule", [], null);
          break;
        }
        halt = await settleBatch(batch);
        if (halt) {
          pilot = pilotStop("cap", [], null);
          break;
        }
      }
      if (pilot) break;
      const seconds = outcomes.filter((x) => x.role === "second");
      reads.push({ k: seconds.filter((x) => x.status === "pass").length, n: seconds.length });
      const firsts = outcomes.filter((x) => x.role === "first");
      const l = line(deps.spent() / outcomes.length, firsts.filter((x) => x.status === "pass").length / firsts.length);
      const r = pilotRead(reads, l);
      if (l === null) pilot = pilotStop("no-line", r.reads, null);
      else if (r.verdict === "more") target = PILOT.second_read;
      else pilot = pilotStop(r.verdict, r.reads, l);
    }
  }
  inPilot = false;
  const pilotPlaced = !o.pilot || o.pilot.digest === digest;
  const finish = (stopped: AuthorRun["stopped"]): AuthorRun => {
    const members: Member[] = slots.flatMap((s) => (st.get(s.slot)!.placed ?? []).map((x) => memberOf(s, x)));
    return { pilot: pilot!, pilot_placed: pilotPlaced, outcomes: [...outcomes], sets: placeSets(members), unmatched: slots.flatMap((s) => (st.get(s.slot)!.partner ? [st.get(s.slot)!.partner!.id] : [])), stopped, halt };
  };
  if (pilot.verdict !== "go" || o.pilotOnly) return finish("pilot");

  for (;;) {
    if (slots.every((s) => !open(s))) return finish("quotas");
    const size = room();
    if (size <= 0) return finish("cap");
    if (outcomes.length >= MAX_DRAFTS) return finish("schedule");
    const batch = slots.filter(open).slice(0, size).map((s) => (st.get(s.slot)!.partner ? second(s) : first(s)));
    halt = await settleBatch(batch);
    if (halt) return finish("cap");
  }
}

/** A placed brief's set membership: the slot's set and skin, its opening cluster and its digest. */
export const memberOf = (s: Slot, x: Outcome): Member => ({ id: x.id, slot: s.slot, set: s.set, kind: s.kind, type: s.type, skin: s.skin, cluster: "d" + x.draw, draw: x.draw, twin: x.files!.key.twin, digest: x.digest!, pilot: x.pilot });

/** A placed brief's brief.json. */
export const metaOf = (s: Slot, x: Outcome): BriefMeta => ({ id: x.id, kind: s.kind === "builder" ? "builder" : "founder", type: s.type, skin: s.skin, cluster: "d" + x.draw, set: s.set, draw: x.draw, author: x.author, twin_of: x.files!.key.twin, traction: x.files!.key.traction, anti_pattern: s.anti_pattern, industry: s.industry, pilot: x.pilot, digest: x.digest! });

const needed = QUOTA.founder + QUOTA.builder + QUOTA.calibration + QUOTA.reserve;
export const placedCount = (r: AuthorRun): number => r.sets.calibration.length + r.sets.comparison.length + r.sets.reserve.length;

/**
 * The halt a run owes after its files are written: a stop a draft or label call threw, a pilot that read stop or stayed open, a missing line or a pilot cap
 * stop, or a shortfall below the 110 briefs. Null when every brief is placed or --pilot asked for the pilot alone.
 */
export function haltOf(r: AuthorRun, mdd: (comparisonFounderBriefs: number) => number | null, pilotOnly = false): AuthorError | null {
  if (r.halt) return new AuthorError(r.halt.code, r.halt.message.slice(r.halt.code.length + 1) + "; authoring stopped there with " + placedCount(r) + " briefs placed, all written and sealed under custody");
  const p = r.pilot;
  const nums = "after " + p.second_draws + " second-twin draws, " + p.second_passed + " passed; reads " + (p.reads.map((x) => x.k + "/" + x.n + " [" + x.lo.toFixed(3) + ", " + x.hi.toFixed(3) + "]").join(", ") || "none") + "; line " + (p.line === null ? "none" : p.line.toFixed(3)) + " from " + p.draw_usd.toFixed(2) + " a draw and a first-pass rate of " + p.first_pass.toFixed(3) + " (" + p.first_passed + " of " + p.first_draws + "); spent " + p.spent.toFixed(2);
  if (p.verdict === "stop" || p.verdict === "no-line") return new AuthorError("E_OHR_PILOT_STOP", "the authoring pilot stops authoring: " + (p.verdict === "no-line" ? "the first twins and unpaired briefs alone would use up the cap, so there is no line; " : "the yield's upper bound is below the line; ") + nums);
  if (p.verdict === "open") return new AuthorError("E_OHR_PILOT_OPEN", "the authoring pilot's second read is still open: " + nums);
  const placed = placedCount(r);
  if (p.verdict !== "go" || (!pilotOnly && placed < needed)) {
    const founders = r.sets.comparison.filter((m) => m.kind !== "builder").length;
    const m = mdd(founders);
    return new AuthorError("E_OHR_SUPPLY_SHORT", "authoring placed " + placed + " of " + needed + " briefs (calibration " + r.sets.calibration.length + ", comparison " + r.sets.comparison.length + ", reserve " + r.sets.reserve.length + ") before it stopped at " + (p.verdict !== "go" ? "the pilot's " + p.verdict : r.stopped) + "; the comparison set holds " + founders + " founder briefs, MDD " + (m === null ? "not defined" : m.toFixed(3)) + " there; " + r.unmatched.length + " unmatched twins dropped");
  }
  return null;
}

/**
 * Section 12's judge check reads authoring's full-information and opening-only answers in block form: one per validator
 * and source on every placed brief, in score/packets.ts's CheckAnswer shape. author names the validator that answered.
 */
export function checkAnswers(r: AuthorRun): CheckAnswer[] {
  const placed = new Set([...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].map((m) => m.id));
  const out: CheckAnswer[] = [];
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
  const { outcomes: _o, ...pilot } = r.pilot;
  return {
    stopped: r.stopped,
    pilot,
    pilot_placed: r.pilot_placed,
    drafts: r.outcomes.length,
    passed: r.outcomes.length - drops.length,
    rewritten: r.outcomes.filter((x) => x.rewrites).length,
    drops: Object.fromEntries([...new Set(drops.map((x) => x.step!))].sort().map((k) => [k, drops.filter((x) => x.step === k).length])),
    second_twins: { draws: seconds.length, passed: seconds.filter((x) => x.status === "pass").length },
    unmatched: r.unmatched.length,
    placed: placedCount(r),
    sets: { calibration: setRecord(r.sets.calibration), comparison: setRecord(r.sets.comparison), reserve: setRecord(r.sets.reserve) },
  };
}
