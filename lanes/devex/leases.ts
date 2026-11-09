// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's money (prereg 2026-11-09-geva-417 section 14, section 4's DX scope check and section 15 rules 1, 3
// and 4): every line item and cap in the section 14 table, the frozen runs in admission order with their projections
// and lease sizes, the cut list, the DX scope gate, and what each stopping code does to a lease (GST-2016: a per-model
// stop settles only that model's sessions and reservations). checks() opens and settles one lease per frozen run on a
// temporary ledger, so every item is shown to admit its run. Nothing here reads a key or makes a paid call.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { openLease, recordApproval, settleLease, type RequireAdmission } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import type { Io } from "./cli.ts";
import { MODEL_STRINGS, type ArmId, type DryCheck, type ModelId } from "./types.ts";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const usd = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);

/** The in-flight reserve: at most 8 sessions at once, each holding only its current call's worst case. */
export const IN_FLIGHT = { sessions: 8, call_micros: $(1.5) };
export const IN_FLIGHT_MICROS = IN_FLIGHT.sessions * IN_FLIGHT.call_micros;
export const GUIDELINE_MICROS = $(4000);
export const STOP_MICROS = $(5000);
/** Section 4: no stage 2 lease opens while under 0.80 of comparison plans would load the DX lens. */
export const SCOPE_BOUND = 0.8;
/** Start rule 5: a cut that takes the Opus MDD past 0.13 goes to the Captain instead. */
export const MDD_BOUND = 0.13;
/** Supply rule 1 (E_DX_SUPPLY_SHORT): the calibration set must fill within $250 of authoring spend. */
export const CALIBRATION_BOUND_MICROS = $(250);

export interface Item {
  id: string;
  name: string;
  projection_micros: number;
  cap_micros: number;
  /** The run id every lease on the item carries: an item that served one run refuses another (E_ITEM_BOUND). Null for an item the ledger does not lease. */
  run_id: string | null;
  note: string;
}

/** The section 14 table, in its order. */
export const ITEMS: readonly Item[] = [
  { id: "dx-s1-runs", name: "Stage 1 runs", projection_micros: $(91), cap_micros: $(160), run_id: "dx-s1", note: "144 none reviews (48 a model), 22 smoke sessions, and a re-smoke reserve for repaired arms in the cap" },
  { id: "dx-s2-runs", name: "Stage 2 runs", projection_micros: $(1420), cap_micros: $(1560), run_id: "dx-s2", note: "Opus 128 unit-passes at $7.35, Sol 64 at $6.60, particle-1 64 at $0.74" },
  { id: "dx-s3-builds", name: "Stage 3 builds", projection_micros: $(179), cap_micros: $(210), run_id: "dx-s3", note: "16 units x 4 build arms at $2.80" },
  { id: "dx-judges", name: "Judges", projection_micros: $(384), cap_micros: $(450), run_id: "dx-judges", note: "stage 1 labels, judge check, stage 2 labels with the blind calibration packets, arm-guess probe and anchors" },
  { id: "dx-authoring", name: "Authoring and mining", projection_micros: $(817), cap_micros: $(1000), run_id: "dx-authoring", note: "86 keyed units at about $7.50, the miss sample, generic-screen labels, stage 3 goals, checkers and probes" },
  { id: "dx-hosts", name: "Runner hosts", projection_micros: $(70), cap_micros: $(80), run_id: "dx-hosts", note: "the miner, run and verifier hosts, stage 3 sandboxes, on Ubicloud" },
  { id: "crew", name: "Crew", projection_micros: $(480), cap_micros: $(500), run_id: null, note: "no lease: read from thread counters; overrun comes out of stage 2 under the net-envelope rules" },
  { id: "reserve", name: "Reserve", projection_micros: 0, cap_micros: $(40), run_id: null, note: "no lease" },
];
const item = (id: string) => ITEMS.find((i) => i.id === id)!;

/** Planning session costs on Opus, by arm; Sol at 0.9 times Opus and particle-1 at a tenth. */
export const OPUS_ARM: Readonly<Record<ArmId, number>> = { none: $(0.4), lens: $(0.45), "plan-devex-review": $(3), autoplan: $(3.5) };
export const MODEL_FACTOR: Readonly<Record<ModelId, number>> = { opus: 1, sol: 0.9, particle: 0.1 };
export const session = (model: ModelId, arm: ArmId) => Math.round(OPUS_ARM[arm] * MODEL_FACTOR[model]);
const ARMS: readonly ArmId[] = ["none", "lens", "plan-devex-review", "autoplan"];
const BUILD_ARM = $(2.8);
const KEYED_UNIT = $(7.5);
const STAGE3_AUTHORING = $(8);

/** Section 10's arm smoke: [model, arm, sessions]. */
export const SMOKE: ReadonlyArray<readonly [ModelId, ArmId, number]> = [
  ["opus", "plan-devex-review", 6], ["opus", "autoplan", 6], ["sol", "plan-devex-review", 2], ["sol", "autoplan", 2], ["particle", "plan-devex-review", 2], ["particle", "autoplan", 2], ["opus", "lens", 2],
];

/** What the cut list changes. */
export interface Design {
  units: number;
  stage3_units: number;
  sol_lens: boolean;
  opus_pass2_gstack: boolean;
  /** The arms a re-smoke reruns after a repair; the frozen run is sized for the costliest single arm. */
  resmoke: readonly ArmId[];
}
export const FULL: Design = { units: 64, stage3_units: 16, sol_lens: true, opus_pass2_gstack: true, resmoke: ["autoplan"] };

export interface FrozenRun {
  id: string;
  item: string;
  run_id: string;
  what: string;
  projection_micros: number;
  lease_micros: number;
  models: readonly ModelId[];
  /** Opens only when its condition holds (a re-smoke after a repair). */
  conditional?: string;
}

const pass = (model: ModelId, arms: readonly ArmId[], units: number) => units * arms.reduce((s, a) => s + session(model, a), 0);
/** Projection plus a tenth plus the in-flight reserve; a run with no model sessions holds no in-flight reserve. */
export const leaseOf = (projection: number, inFlight = true, floor = 0) => Math.max(projection + Math.round(projection / 10) + (inFlight ? IN_FLIGHT_MICROS : 0), floor);

/** The frozen runs, grouped by item in the table's order and in admission order within each item. */
export function frozenRuns(d: Design = FULL): FrozenRun[] {
  const run = (id: string, itemId: string, what: string, projection: number, models: readonly ModelId[], o: { inFlight?: boolean; floor?: number; conditional?: string } = {}): FrozenRun => ({ id, item: itemId, run_id: item(itemId).run_id!, what, projection_micros: projection, lease_micros: leaseOf(projection, o.inFlight ?? true, o.floor ?? 0), models, ...(o.conditional ? { conditional: o.conditional } : {}) });
  const smoke = (arms: readonly ArmId[] | null) => SMOKE.filter(([, a]) => arms === null || arms.includes(a)).reduce((s, [m, a, n]) => s + n * session(m, a), 0);
  const all: ModelId[] = ["opus", "sol", "particle"];
  return [
    run("s1-none", "dx-s1-runs", "stage 1 none reviews: 16 calibration units x 3 passes on each model", pass("opus", ["none"], 48) + pass("sol", ["none"], 48) + pass("particle", ["none"], 48), all),
    run("s1-smoke", "dx-s1-runs", "the arm smoke: 22 sessions", smoke(null), all),
    run("s1-resmoke", "dx-s1-runs", "a re-smoke of the repaired arms (" + d.resmoke.join(", ") + ")", smoke(d.resmoke), all, { conditional: "an arm repaired at the smoke" }),
    run("s2-opus-1", "dx-s2-runs", "Opus pass 1: " + d.units + " unit-passes", pass("opus", ARMS, d.units), ["opus"]),
    run("s2-sol", "dx-s2-runs", "Sol: " + d.units + " unit-passes" + (d.sol_lens ? "" : ", lens cells cut"), pass("sol", d.sol_lens ? ARMS : ARMS.filter((a) => a !== "lens"), d.units), ["sol"]),
    run("s2-particle", "dx-s2-runs", "particle-1: " + d.units + " unit-passes", pass("particle", ARMS, d.units), ["particle"]),
    run("s2-opus-2", "dx-s2-runs", "Opus pass 2: " + d.units + " unit-passes" + (d.opus_pass2_gstack ? "" : ", gstack arms cut"), pass("opus", d.opus_pass2_gstack ? ARMS : ["none", "lens"], d.units), ["opus"]),
    run("s3-builds", "dx-s3-builds", "stage 3: " + d.stage3_units + " units x 4 build arms", d.stage3_units * 4 * BUILD_ARM, ["opus"]),
    run("j-s1-labels", "dx-judges", "stage 1 labels", $(90), all),
    run("j-check", "dx-judges", "the judge check", $(95), all),
    run("j-s2-labels", "dx-judges", "stage 2 labels with the blind calibration packets", $(178) + $(11), all),
    run("j-probe", "dx-judges", "the arm-guess probe and anchors", $(10), all),
    run("a-calibration", "dx-authoring", "calibration authoring (16 keyed units), the 24-unit miss sample and generic-screen labels", 16 * KEYED_UNIT + $(26) + $(15), all, { floor: CALIBRATION_BOUND_MICROS + IN_FLIGHT_MICROS }),
    run("a-comparison", "dx-authoring", "comparison and reserve authoring (70 keyed units)", 70 * KEYED_UNIT, all),
    run("a-stage3", "dx-authoring", "stage 3 goals, checkers and probes on 16 units", 16 * STAGE3_AUTHORING, all),
    run("h-hosts", "dx-hosts", "the miner, run and verifier hosts and stage 3 sandboxes", $(70), [], { inFlight: false }),
  ];
}

export interface Cut {
  id: string;
  what: string;
  apply: (d: Design) => Design;
}
/** Section 14's cut list, in order. particle-1 stays, since its cells cost little. */
export const CUTS: readonly Cut[] = [
  { id: "stage3-12", what: "stage 3 down to 12 units", apply: (d) => ({ ...d, stage3_units: 12 }) },
  { id: "sol-lens", what: "Sol's lens cells", apply: (d) => ({ ...d, sol_lens: false }) },
  { id: "units-48", what: "comparison units down to 48", apply: (d) => ({ ...d, units: 48 }) },
  { id: "opus-pass2-gstack", what: "Opus's second pass on the gstack arms", apply: (d) => ({ ...d, opus_pass2_gstack: false }) },
];

/** Section 4's DX scope gate: null when stage 2 may lease, else why not. captainGo is the Captain's answer to go on. */
export function scopeGate(rate: number | null | undefined, captainGo = false): string | null {
  if (captainGo) return null;
  if (rate === null || rate === undefined || !Number.isFinite(rate) || rate < 0 || rate > 1) return "the DX scope rate of comparison plans is not read yet, so no stage 2 lease opens";
  if (rate < SCOPE_BOUND) return "the DX scope rate of comparison plans is " + rate.toFixed(4) + ", under " + SCOPE_BOUND.toFixed(2) + ": the rate goes to the Captain and no stage 2 lease opens until the Captain answers";
  return null;
}

export type Admission = { ok: true; design: Design; lease_micros: number; cuts: string[] } | { ok: false; design: Design; cuts: string[]; stop: string };

/**
 * Admits one frozen run against what its item has left after the earlier runs settled. A lease that doesn't fit applies
 * the cut list first, in order, skipping a cut that can't change this lease or that changes a run already opened; it
 * stops for the Captain when a cut would take the Opus MDD past 0.13 or when every cut leaves it unadmitted.
 */
export function admit(o: { run: string; design?: Design; left_micros: number; opened: readonly string[]; scope_rate?: number | null; captain_go?: boolean; mdd: (d: Design) => number }): Admission {
  let d = o.design ?? FULL;
  const size = (x: Design) => frozenRuns(x).find((r) => r.id === o.run)?.lease_micros;
  const first = frozenRuns(d).find((r) => r.id === o.run);
  if (!first) throw Object.assign(new Error("no frozen run " + JSON.stringify(o.run)), { code: "E_USAGE" });
  const cuts: string[] = [];
  if (first.item === "dx-s2-runs") {
    const gate = scopeGate(o.scope_rate, o.captain_go);
    if (gate) return { ok: false, design: d, cuts, stop: gate };
  }
  let lease = first.lease_micros;
  if (lease <= o.left_micros) return { ok: true, design: d, lease_micros: lease, cuts };
  for (const cut of CUTS) {
    const next = cut.apply(d);
    if (size(next) === lease) continue;
    const before = frozenRuns(d), after = frozenRuns(next);
    if (before.some((r, i) => r.lease_micros !== after[i]!.lease_micros && o.opened.includes(r.id))) continue;
    const mdd = o.mdd(next);
    if (mdd > MDD_BOUND) return { ok: false, design: d, cuts, stop: "cutting " + cut.what + " would take the Opus MDD to " + mdd.toFixed(3) + ", past " + MDD_BOUND + ", so it goes to the Captain (start rule 5)" };
    d = next;
    lease = size(d)!;
    cuts.push(cut.id);
    if (lease <= o.left_micros) return { ok: true, design: d, lease_micros: lease, cuts };
  }
  return { ok: false, design: d, cuts, stop: "run " + o.run + " needs a lease of " + usd(lease) + " after the cut list (" + (cuts.join(", ") || "no cut applies") + ") and its item has " + usd(o.left_micros) + " left; it stops for the Captain" };
}

/** Opens one frozen run's lease on the ledger, admitted against what its item's earlier runs settled. */
export function openRun(record: string, local: LocalLedger | null, o: { run: string; design?: Design; opened: readonly string[]; scope_rate?: number | null; captain_go?: boolean; mdd: (d: Design) => number; requireAdmission?: RequireAdmission; warn?: (code: ReasonCode, message: string) => void }): { admission: Admission; lease_id?: string } {
  const r = frozenRuns(o.design ?? FULL).find((x) => x.id === o.run);
  if (!r) throw Object.assign(new Error("no frozen run " + JSON.stringify(o.run)), { code: "E_USAGE" });
  const state = readItem(record, r.item);
  const left = state.cap_micros === null ? Number.MAX_SAFE_INTEGER : state.cap_micros - state.committed_micros;
  const admission = admit({ ...o, left_micros: left });
  if (!admission.ok) return { admission };
  const lease = openLease(record, local, { item: r.item, run_id: r.run_id, amount_micros: admission.lease_micros, requireAdmission: o.requireAdmission, warn: o.warn });
  return { admission, lease_id: lease.lease_id };
}

export type LeaseAction = "scope-model" | "scope-arm" | "settle" | "end" | "none";

/**
 * What a stopping code does to the lease it fires on (section 15 rule 3). Arm stops leave the lease open for the other
 * arms. A per-model stop on a lease several models share settles only that model's scope (GST-2016); on a one-model
 * lease it settles the lease. E_DX_JUDGE_KAPPA and E_DX_STOCK_FAIL on Opus lists in stage 1 end the eval as
 * E_DX_NO_READ does: "end" settles at the spend so far with a cap stop, so the item admits no later lease.
 */
export function stopAction(code: ReasonCode, o: { stage: 1 | 2 | 3; model?: ModelId; lease_models: readonly ModelId[] }): LeaseAction {
  if (code === "E_DX_EXPOSURE_STOP" || code === "E_DX_ARM_DROPPED") return "scope-arm";
  if (code === "E_DX_NO_READ" || code === "E_DX_SUPPLY_SHORT" || code === "E_DX_SANDBOX_BREACH") return "end";
  if (code === "E_DX_JUDGE_KAPPA" || code === "E_DX_STOCK_FAIL" || code === "E_DX_PROVIDER_DRIFT") {
    if (code !== "E_DX_PROVIDER_DRIFT" && o.stage === 1 && o.model === "opus") return "end";
    return o.lease_models.length > 1 ? "scope-model" : "settle";
  }
  return "none";
}

/** Applies stopAction on the ledger. A scope stop refuses the scope's later calls; settleScope follows once its sends are over. */
export function applyStop(record: string, local: LocalLedger, lease_id: string, code: ReasonCode, o: { stage: 1 | 2 | 3; model?: ModelId; arm?: ArmId; lease_models: readonly ModelId[]; scope: string }): LeaseAction {
  const action = stopAction(code, o);
  if (action === "scope-model") local.stopScope(lease_id, { field: "model", value: MODEL_STRINGS[o.model!] }, code, o.scope);
  if (action === "scope-arm") local.stopScope(lease_id, { field: "arm", value: o.arm! }, code, o.scope);
  if (action === "settle") settleLease(record, local, lease_id);
  if (action === "end") settleLease(record, local, lease_id, undefined, code + " " + o.scope);
  return action;
}

// ---- the dry run's lease lines ----

const T = (rule: string, parts: Array<[boolean, string]>): DryCheck => ({ rule, pass: parts.every(([ok]) => ok), detail: parts.map(([ok, what]) => (ok ? "ok: " : "FAILED: ") + what).join("; ") });
const QUOTE = { words: "dry run on a temporary ledger", by: "dx dryrun", source: "devex prereg section 15 rule 4" };
const USAGE0 = { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 };
const flatMdd = () => 0.1;
const FIRST3 = ["s2-opus-1", "s2-sol", "s2-particle"];

interface Temp {
  record: string;
  local: LocalLedger;
  done: () => void;
}
function temp(): Temp {
  const dir = mkdtempSync(join(tmpdir(), "dx-leases-dry-"));
  const record = join(dir, "record");
  for (const i of ITEMS) if (i.run_id) recordApproval(record, { action: "init", item: i.id, cap_micros: i.cap_micros, quotes: [QUOTE], admission: "warn" });
  const local = LocalLedger.open(join(dir, "ledger.sqlite"));
  return {
    record,
    local,
    done: () => {
      local.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
let keys = 0;
async function spend(t: Temp, lease_id: string, micros: number, model: ModelId = "opus", arm: ArmId = "none"): Promise<boolean> {
  const cell = { run_id: "dx-dry", arm, task: "unit-1", model: MODEL_STRINGS[model], trial: 1, attempt: 1, meter_id: "dry" };
  const r = await t.local.reserve({ idempotency_key: "dry-" + ++keys, lease_id, cell, max_micros: micros });
  if (!r.ok) return false;
  return (await t.local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: micros, usage: USAGE0 })).ok;
}
const leaseCount = (t: Temp, id: string) => readItem(t.record, id).leases.length;
const left = (t: Temp, id: string) => {
  const s = readItem(t.record, id);
  return s.cap_micros! - s.committed_micros;
};
function codeOf(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "thrown";
  }
}

/** Opens and settles every frozen run in order up to stopAt, spending factor(run) times its projection. */
async function driveAll(t: Temp, factor: (run: string) => number = () => 1, stopAt?: string): Promise<{ opened: string[]; failed: string[]; left: Record<string, number> }> {
  const opened: string[] = [], failed: string[] = [], before: Record<string, number> = {};
  for (const r of frozenRuns()) {
    if (r.id === stopAt) break;
    before[r.id] = left(t, r.item);
    try {
      const o = openRun(t.record, t.local, { run: r.id, opened, scope_rate: SCOPE_BOUND, mdd: flatMdd });
      if (!o.admission.ok || !o.lease_id) {
        failed.push(r.id + " (" + (o.admission.ok ? "no lease" : o.admission.stop) + ")");
        continue;
      }
      opened.push(r.id);
      if (!(await spend(t, o.lease_id, Math.round(r.projection_micros * factor(r.id)), r.models[0] ?? "opus"))) failed.push(r.id + " (its spend was refused)");
      settleLease(t.record, t.local, o.lease_id);
    } catch (e) {
      failed.push(r.id + " (" + (e as Error).message.split("\n")[0] + ")");
    }
  }
  return { opened, failed, left: before };
}

/** The lease lines of the keyless dry run (section 15 rule 4), each on its own temporary ledger. */
export async function checks(): Promise<DryCheck[]> {
  const out: DryCheck[] = [];
  const runs = frozenRuns();
  const leased = ITEMS.filter((i) => i.run_id);
  const lease = (id: string) => runs.find((r) => r.id === id)!.lease_micros;
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  const capSum = ITEMS.reduce((s, i) => s + i.cap_micros, 0), projSum = ITEMS.reduce((s, i) => s + i.projection_micros, 0);
  out.push(T("section 14: every item and cap in the table, caps summing to the $4,000 guideline under the $5,000 stop, and each item's runs adding up to its projection", [
    [capSum === GUIDELINE_MICROS && capSum < STOP_MICROS, "caps sum to " + usd(capSum)],
    [near(projSum, $(3440), $(5)), "projections sum to " + usd(projSum)],
    ...leased.map((i): [boolean, string] => {
      const sum = runs.filter((r) => r.item === i.id && !r.conditional).reduce((s, r) => s + r.projection_micros, 0);
      return [near(sum, i.projection_micros, Math.round(i.projection_micros / 100)), i.id + " runs project " + usd(sum) + " against " + usd(i.projection_micros)];
    }),
  ]));
  out.push(T("lease size: projection plus a tenth plus 8 sessions at $1.50 in flight; stage 2 in order Opus pass 1 about $530, Sol about $480, particle-1 about $65, Opus pass 2 about $530", [
    [IN_FLIGHT_MICROS === $(12), "in-flight reserve " + usd(IN_FLIGHT_MICROS)],
    [near(lease("s2-opus-1"), $(530), $(5)), "Opus pass 1 " + usd(lease("s2-opus-1"))],
    [near(lease("s2-sol"), $(480), $(5)), "Sol " + usd(lease("s2-sol"))],
    [near(lease("s2-particle"), $(65), $(2)), "particle-1 " + usd(lease("s2-particle"))],
    [near(lease("s2-opus-2"), $(530), $(5)), "Opus pass 2 " + usd(lease("s2-opus-2"))],
    [runs.filter((r) => r.item === "dx-s2-runs").map((r) => r.id).join(",") === "s2-opus-1,s2-sol,s2-particle,s2-opus-2", "admission order Opus pass 1, Sol, particle-1, Opus pass 2"],
  ]));
  {
    const t = temp();
    try {
      const a = await driveAll(t);
      const room = a.left["s2-opus-2"] ?? 0;
      out.push(T("one ledger lease opens and settles per frozen run on a temporary ledger, each admitted against what its item's earlier runs settled", [
        [a.failed.length === 0 && a.opened.length === runs.length, a.opened.length + " of " + runs.length + " runs leased and settled" + (a.failed.length ? ": " + a.failed.join("; ") : "")],
        [leased.every((i) => leaseCount(t, i.id) === runs.filter((r) => r.item === i.id).length && readItem(t.record, i.id).open === null), "every leased item holds one settled lease per run"],
        [near(room, $(620), $(2)) && room >= lease("s2-opus-2"), "Opus pass 2 opened with " + usd(room) + " of $1,560 left for its " + usd(lease("s2-opus-2")) + " lease"],
      ]));
    } finally {
      t.done();
    }
  }
  {
    const over8 = temp(), over12 = temp();
    try {
      const first3 = (f: number) => (id: string) => (FIRST3.includes(id) ? f : 1);
      const a = await driveAll(over8, first3(1.08));
      await driveAll(over12, first3(1.12), "s2-opus-2");
      const room = left(over12, "dx-s2-runs");
      const refused = codeOf(() => openLease(over12.record, over12.local, { item: "dx-s2-runs", run_id: "dx-s2", amount_micros: lease("s2-opus-2") }));
      out.push(T("an 8% overrun on stage 2's first three runs still admits Opus pass 2; at 12%, still inside each lease, the ledger refuses its full lease", [
        [a.opened.includes("s2-opus-2") && (a.left["s2-opus-2"] ?? 0) >= lease("s2-opus-2"), "at 8%, " + usd(a.left["s2-opus-2"] ?? 0) + " left admits " + usd(lease("s2-opus-2"))],
        [refused === "CAP_STOP", "at 12%, " + usd(room) + " left refuses it (" + refused + ")"],
      ]));
    } finally {
      over8.done();
      over12.done();
    }
  }
  {
    const pastMdd = (d: Design) => (d.opus_pass2_gstack ? 0.1 : 0.131);
    const fits = admit({ run: "s2-opus-2", left_micros: $(300), opened: FIRST3, scope_rate: SCOPE_BOUND, mdd: flatMdd });
    const short = admit({ run: "s2-opus-2", left_micros: $(60), opened: FIRST3, scope_rate: SCOPE_BOUND, mdd: flatMdd });
    const mdd = admit({ run: "s2-opus-2", left_micros: $(300), opened: FIRST3, scope_rate: SCOPE_BOUND, mdd: pastMdd });
    const atBound = admit({ run: "s2-opus-2", left_micros: $(300), opened: FIRST3, scope_rate: SCOPE_BOUND, mdd: (d) => (d.opus_pass2_gstack ? 0.1 : 0.13) });
    const s3 = admit({ run: "s3-builds", left_micros: $(200), opened: [], mdd: flatMdd });
    const t = temp();
    let ledgerSide: [boolean, string] = [false, "the ledger side did not run"];
    try {
      await driveAll(t, (id) => (FIRST3.includes(id) ? 1.12 : 1), "s2-opus-2");
      const before = leaseCount(t, "dx-s2-runs");
      const r = openRun(t.record, t.local, { run: "s2-opus-2", opened: FIRST3, scope_rate: SCOPE_BOUND, mdd: pastMdd });
      ledgerSide = [!r.lease_id && !r.admission.ok && leaseCount(t, "dx-s2-runs") === before, "on the ledger, with " + usd(left(t, "dx-s2-runs")) + " left, the stopped admission opens no lease"];
    } finally {
      t.done();
    }
    const perUnit = (d: Design) => frozenRuns(d).find((r) => r.id === "s2-particle")!.projection_micros / d.units;
    const particleKept = CUTS.every((c) => perUnit(c.apply(FULL)) === perUnit(FULL));
    out.push(T("a lease that can't be admitted applies the cut list first, in order, then stops for the Captain; a cut past the 0.13 MDD stops instead", [
      [CUTS.map((c) => c.id).join(",") === "stage3-12,sol-lens,units-48,opus-pass2-gstack" && particleKept, "cut order stage 3 to 12 units, Sol's lens cells, units to 48, Opus pass 2's gstack arms; particle-1 stays"],
      [fits.ok && fits.cuts.join(",") === "opus-pass2-gstack", "Opus pass 2 at $300 left skips the cuts on other items and on runs already open, and the gstack-arms cut admits it at " + (fits.ok ? usd(fits.lease_micros) : "nothing")],
      [!short.ok && short.cuts.join(",") === "opus-pass2-gstack", "at $60 left it still doesn't fit after the cut and stops for the Captain"],
      [!mdd.ok && mdd.cuts.length === 0 && /MDD/.test(mdd.stop) && atBound.ok, "a cut taking the MDD to 0.131 stops for the Captain; at 0.130 it is applied"],
      [s3.ok && s3.cuts.join(",") === "stage3-12", "stage 3 at $200 left takes the first cut, 12 units, at " + (s3.ok ? usd(s3.lease_micros) : "nothing")],
      ledgerSide,
    ]));
  }
  {
    const t = temp();
    try {
      const first = openRun(t.record, t.local, { run: "s1-none", opened: [], mdd: flatMdd });
      const whileOpen = codeOf(() => openLease(t.record, t.local, { item: "dx-s1-runs", run_id: "dx-s1-other", amount_micros: $(1) }));
      settleLease(t.record, t.local, first.lease_id!);
      const second = openRun(t.record, t.local, { run: "s1-smoke", opened: ["s1-none"], mdd: flatMdd });
      settleLease(t.record, t.local, second.lease_id!);
      const bound = codeOf(() => openLease(t.record, t.local, { item: "dx-s1-runs", run_id: "dx-s1-other", amount_micros: $(1) }));
      out.push(T("each item's runs share its run id, so one item serves all its runs; a lease under another run id is refused (E_ITEM_BOUND)", [
        [leased.every((i) => runs.filter((x) => x.item === i.id).every((x) => x.run_id === i.run_id)), "every run carries its item's run id"],
        [!!second.lease_id, "the smoke batch opens on dx-s1-runs after the none batch settles"],
        [bound === "E_ITEM_BOUND" && whileOpen === "E_ITEM_BOUND", "another run id is refused with " + bound],
      ]));
    } finally {
      t.done();
    }
  }
  {
    const t = temp();
    try {
      const below = openRun(t.record, t.local, { run: "s2-opus-1", opened: [], scope_rate: 0.79, mdd: flatMdd });
      const unread = openRun(t.record, t.local, { run: "s2-opus-1", opened: [], scope_rate: null, mdd: flatMdd });
      const n = leaseCount(t, "dx-s2-runs");
      const at = openRun(t.record, t.local, { run: "s2-opus-1", opened: [], scope_rate: 0.8, mdd: flatMdd });
      out.push(T("the DX scope check: at 0.79 of comparison plans no stage 2 lease opens; at 0.80 Opus pass 1 opens", [
        [!below.lease_id && !unread.lease_id && n === 0, "at 0.79, and with the rate unread, dx-s2-runs holds no lease"],
        [!!at.lease_id && leaseCount(t, "dx-s2-runs") === 1, "at 0.80 the first stage 2 lease opens"],
      ]));
    } finally {
      t.done();
    }
  }
  {
    const t = temp();
    try {
      const none = openRun(t.record, t.local, { run: "s1-none", opened: [], mdd: flatMdd }).lease_id!;
      const solFirst = await spend(t, none, $(0.36), "sol");
      const act = applyStop(t.record, t.local, none, "E_DX_PROVIDER_DRIFT", { stage: 1, model: "sol", lease_models: ["opus", "sol", "particle"], scope: "dry run: Sol served by another provider" });
      const solAfter = await spend(t, none, $(0.36), "sol");
      const opusAfter = await spend(t, none, $(0.4), "opus");
      const figures = t.local.settleScope(none, { field: "model", value: MODEL_STRINGS.sol });
      const stillOpen = t.local.getLease(none)!.state === "open";
      settleLease(t.record, t.local, none);
      settleLease(t.record, t.local, openRun(t.record, t.local, { run: "s2-opus-1", opened: [], scope_rate: SCOPE_BOUND, mdd: flatMdd }).lease_id!);
      const sol = openRun(t.record, t.local, { run: "s2-sol", opened: ["s2-opus-1"], scope_rate: SCOPE_BOUND, mdd: flatMdd }).lease_id!;
      const one = applyStop(t.record, t.local, sol, "E_DX_PROVIDER_DRIFT", { stage: 2, model: "sol", lease_models: ["sol"], scope: "dry run: Sol served by another provider" });
      const particle = openRun(t.record, t.local, { run: "s2-particle", opened: ["s2-opus-1", "s2-sol"], scope_rate: SCOPE_BOUND, mdd: flatMdd });
      out.push(T("GST-2016: a per-model stop on a lease several models share settles only that model's sessions and reservations; on a one-model lease it settles that lease and the item admits its next run", [
        [solFirst && act === "scope-model" && !solAfter && opusAfter && stillOpen && figures.settled_calls === 1, "on the stage 1 none lease, Sol's later call is refused while Opus keeps reserving and the lease stays open"],
        [one === "settle" && t.local.getLease(sol)!.state === "settled" && !!particle.lease_id, "Sol's own stage 2 lease settles and particle-1's opens"],
      ]));
    } finally {
      t.done();
    }
  }
  {
    const t = temp();
    try {
      settleLease(t.record, t.local, openRun(t.record, t.local, { run: "s1-none", opened: [], mdd: flatMdd }).lease_id!);
      const smoke = openRun(t.record, t.local, { run: "s1-smoke", opened: ["s1-none"], mdd: flatMdd }).lease_id!;
      await spend(t, smoke, $(3.5), "opus", "autoplan");
      const act = applyStop(t.record, t.local, smoke, "E_DX_ARM_DROPPED", { stage: 1, arm: "autoplan", lease_models: ["opus", "sol", "particle"], scope: "dry run: autoplan dropped after a failed repair" });
      const dropped = await spend(t, smoke, $(3.5), "opus", "autoplan");
      const kept = await spend(t, smoke, $(3), "opus", "plan-devex-review");
      const open = t.local.getLease(smoke)!.state === "open";
      const close = settleLease(t.record, t.local, smoke);
      out.push(T("E_DX_EXPOSURE_STOP and E_DX_ARM_DROPPED leave the lease open for the other arms, and the stopped arm's unrun sessions release when it settles", [
        [act === "scope-arm" && stopAction("E_DX_EXPOSURE_STOP", { stage: 2, lease_models: ["opus"] }) === "scope-arm", "both arm stops scope the arm and settle nothing"],
        [!dropped && kept && open, "autoplan's next session is refused while plan-devex-review keeps reserving on the open lease"],
        [close.spent_micros === $(6.5) && close.unknown_micros === 0 && close.spent_micros < lease("s1-smoke"), "the settle commits " + usd(close.spent_micros) + " of the " + usd(lease("s1-smoke")) + " lease and releases the rest"],
      ]));
    } finally {
      t.done();
    }
  }
  {
    const t = temp();
    try {
      const cal = openRun(t.record, t.local, { run: "a-calibration", opened: [], mdd: flatMdd }).lease_id!;
      await spend(t, cal, $(120));
      const act = applyStop(t.record, t.local, cal, "E_DX_SUPPLY_SHORT", { stage: 1, lease_models: ["opus"], scope: "dry run: the calibration set did not fill" });
      const next = codeOf(() => openRun(t.record, t.local, { run: "a-comparison", opened: ["a-calibration"], mdd: flatMdd }));
      const quiet: ReasonCode[] = ["E_DX_ARM_STOP", "E_DX_INFRA_MISSING", "E_DX_NO_BLOCK", "E_DX_WEB_CONTAMINATED", "E_DX_ARM_CONTAMINATED", "E_DX_LABEL_MISSING", "E_DX_BUILD_INSTRUMENT", "E_DX_LEAK_EXPOSED", "E_DX_EXPOSURE_REPAIR"];
      out.push(T("E_DX_NO_READ, E_DX_SUPPLY_SHORT and E_DX_SANDBOX_BREACH settle the open lease at the spend so far and admit no later lease on the item; Opus lists' kappa or stock fail in stage 1 ends the same way; failure-table codes touch no lease", [
        [act === "end" && readItem(t.record, "dx-authoring").open === null && next === "CAP_STOP" && stopAction("E_DX_NO_READ", { stage: 1, lease_models: ["opus"] }) === "end" && stopAction("E_DX_SANDBOX_BREACH", { stage: 3, lease_models: ["opus"] }) === "end", "after E_DX_SUPPLY_SHORT, comparison authoring is refused (" + next + ")"],
        [stopAction("E_DX_JUDGE_KAPPA", { stage: 1, model: "opus", lease_models: ["opus", "sol"] }) === "end" && stopAction("E_DX_JUDGE_KAPPA", { stage: 1, model: "sol", lease_models: ["opus", "sol"] }) === "scope-model" && stopAction("E_DX_STOCK_FAIL", { stage: 2, model: "opus", lease_models: ["opus"] }) === "settle", "kappa on Opus lists in stage 1 ends; on Sol lists it stops Sol's scope; a stage 2 stock fail settles its one-model lease"],
        [quiet.every((c) => stopAction(c, { stage: 2, lease_models: ["opus"] }) === "none"), "the failure table's codes, E_DX_LEAK_EXPOSED and E_DX_EXPOSURE_REPAIR touch no lease"],
      ]));
    } finally {
      t.done();
    }
  }
  return out;
}

// ---- dx leases ----

const USAGE = "gstack-evals dx leases [--scope-rate <0..1>]";

export async function run(argv: string[], io: Io): Promise<number> {
  let rate: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      io.out(USAGE);
      return 0;
    }
    if (a === "--scope-rate" && /^(0(\.\d+)?|1(\.0+)?)$/.test(argv[i + 1] ?? "")) rate = Number(argv[++i]);
    else throw Object.assign(new Error("unknown or malformed argument " + JSON.stringify(a) + "; usage: " + USAGE), { code: "E_USAGE" });
  }
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines = ["dx leases: the section 14 line items (projection, cap)"];
  for (const i of ITEMS) lines.push("  " + pad(i.id, 14) + pad(i.name, 22) + pad(i.projection_micros ? usd(i.projection_micros) : "", 11) + pad(usd(i.cap_micros), 11) + (i.run_id ? "run " + i.run_id : i.note));
  lines.push("  " + pad("all-in", 36) + pad(usd(ITEMS.reduce((s, i) => s + i.projection_micros, 0)), 11) + pad(usd(ITEMS.reduce((s, i) => s + i.cap_micros, 0)), 11) + "stop " + usd(STOP_MICROS));
  lines.push("", "frozen runs in admission order (projection, lease = projection + a tenth + " + IN_FLIGHT.sessions + " sessions x " + usd(IN_FLIGHT.call_micros) + " in flight)");
  for (const r of frozenRuns()) lines.push("  " + pad(r.item, 14) + pad(r.id, 15) + pad(usd(r.projection_micros), 11) + pad(usd(r.lease_micros), 11) + r.what + (r.conditional ? " (only after " + r.conditional + ")" : ""));
  lines.push("", "cut list, in order, applied before a lease that can't be admitted stops for the Captain; a cut past an Opus MDD of " + MDD_BOUND + " goes to the Captain:");
  CUTS.forEach((c, n) => lines.push("  " + (n + 1) + ". " + c.what));
  lines.push("  particle-1 stays.", "", "DX scope gate: no stage 2 lease opens while under " + SCOPE_BOUND.toFixed(2) + " of comparison plans would load the DX lens.");
  if (rate !== undefined) lines.push("  rate " + rate.toFixed(4) + ": " + (scopeGate(rate) ?? "stage 2 may lease"));
  io.out(lines.join("\n"));
  return 0;
}
