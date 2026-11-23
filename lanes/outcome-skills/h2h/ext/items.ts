// Copyright (c) 2026 Garry Tan. MIT License.
// The extension's ledger items (plan section 14; prereg.json items, from the post's Agent notes A2) and the pilot cap rule
// of section 11. Central and cap come from prereg.json; the ledger reads each item's cap from the approvals record the
// Captain writes before its first lease, never from this file. extLedgerDryRun opens and settles one lease per item on a
// temporary ledger and drives the pilot cap rule on fixture spend. Nothing here spends.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../../../src/runner/ledger/envelope.ts";
import { machineId, openLease, recordApproval, settleLease } from "../../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../../src/runner/ledger/local.ts";
import { MICROS_PER_USD } from "../../../../src/runner/ledger/money.ts";
import { readItem } from "../../../../src/runner/ledger/record.ts";
import type { Check } from "../analysis/ledger-dryrun.ts";
import { CAP_FACTOR } from "../items.ts";
import { h2hFail } from "../prereg.ts";
import { EXT_ARMS, extArmsFor, PARTS, partOf, readExtPrereg, type ExtArm, type ExtPrereg, type Part } from "./prereg.ts";

export interface ExtItem { item: string; central_usd: number; cap_usd: number; model: string | null; part: Part | null; what: string }
/** Sessions a part runs in parallel, which A2's caps cover at one allowance each. */
export const PARALLEL = 6;

/** prereg.json's items, each with the model it pays for: h2hx-<part>-pilot and -main pay for that part's sessions. */
export function extItems(x: ExtPrereg = readExtPrereg()): ExtItem[] {
  return x.items.map((i) => {
    const part = PARTS.find((p) => i.id.startsWith("h2hx-" + p.toLowerCase() + "-")) ?? null;
    return { item: i.id, central_usd: i.central_usd, cap_usd: i.cap_usd, model: part ? x.parts[part].model : null, part, what: i.what };
  });
}

/** Pilot sessions an arm runs in stage 1: 6 O and 4 B2 units in parts S and P (6 for an O-only arm), 6 units in part L. */
export function pilotSessions(arm: ExtArm, x: ExtPrereg = readExtPrereg()): number {
  const part = partOf(arm);
  if (part === "L") return x.pilot.l_units;
  return x.pilot.o_units + (extArmsFor(part, "B2", x).includes(arm) ? x.pilot.b2_units : 0);
}

/** Section 11's pilot cap rule: the driver opens an arm's next pilot session only while its settled pilot spend is under
 *  its cap. An arm whose settled spend reaches the cap before all its pilot sessions have run is left out under R111. */
export function pilotState(arm: ExtArm, settledUsd: number, sessionsRun: number, x: ExtPrereg = readExtPrereg()): "open" | "done" | "left_out" {
  if (!(EXT_ARMS as readonly string[]).includes(arm)) h2hFail("E_H2HX_INPUT", "arm " + arm + " is not an extension arm");
  if (!(settledUsd >= 0) || !(sessionsRun >= 0)) h2hFail("E_H2HX_INPUT", "settled spend and sessions run are each a number at or above 0");
  if (sessionsRun >= pilotSessions(arm, x)) return "done";
  return settledUsd < x.pilot_caps_usd[arm] ? "open" : "left_out";
}
export const mayOpenPilot = (arm: ExtArm, settledUsd: number, sessionsRun: number, x: ExtPrereg = readExtPrereg()): boolean => pilotState(arm, settledUsd, sessionsRun, x) === "open";

/** Opens and settles one lease per item on a temporary ledger at prereg.json's caps (or an approvals-record override),
 *  checks A2's cap rule and the approved total, then drives the pilot cap rule on fixture spend. */
export function extLedgerDryRun(o: { x?: ExtPrereg; dir?: string; caps?: Record<string, number> } = {}): { dir: string; checks: Check[] } {
  const x = o.x ?? readExtPrereg();
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), "h2hx-ledger-dryrun-"));
  mkdirSync(dir, { recursive: true });
  const checks: Check[] = [];
  const rule = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const items = extItems(x);
  const caps = { ...Object.fromEntries(items.map((i) => [i.item, i.cap_usd])), ...(o.caps ?? {}) } as Record<string, number>;
  const total = Object.values(caps).reduce((a, c) => a + c, 0);
  const quote = { words: "dry-run fixture words on a temporary ledger, not an approval", by: "h2hx-ledger-dryrun", source: "lanes/outcome-skills/h2h/ext/items.ts" };
  const record = join(dir, "record");
  recordProgram(record, { program: "h2hx", cap_micros: Math.round(total * MICROS_PER_USD), skill_cap_micros: Math.round(total * MICROS_PER_USD), skills: ["h2hx"], credit_rate_micros: MICROS_PER_USD, quotes: [quote] });
  const local = LocalLedger.open(join(dir, "ledger.sqlite"));
  const machine = machineId();
  for (const i of items) {
    const cap = Math.round(caps[i.item]! * MICROS_PER_USD);
    recordApproval(record, { action: "init", item: i.item, cap_micros: cap, quotes: [quote], admission: "required", program: "h2hx", skills: ["h2hx"] });
    settleLease(record, local, openLease(record, local, { item: i.item, run_id: "h2hx-dryrun", machine_id: machine, requireAdmission: () => null }).lease_id);
    const it = readItem(record, i.item);
    rule("ledger lease " + i.item, it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null && it.cap_micros === cap, "cap $" + caps[i.item] + ", leases " + it.leases.length + ", spent " + it.leases[0]?.close?.spent_micros + " micros");
    if (i.part) {
      const want = Math.round(CAP_FACTOR * i.central_usd + PARALLEL * x.parts[i.part].limits.allowance_usd);
      rule("A2 cap rule " + i.item, want === i.cap_usd, "1.35 x $" + i.central_usd + " + " + PARALLEL + " x $" + x.parts[i.part].limits.allowance_usd + " = $" + want + " against prereg.json's $" + i.cap_usd);
    }
  }
  rule("caps fit the approved all-in total", total <= x.approved_all_in_cap_usd, "$" + total + " at caps against the approved $" + x.approved_all_in_cap_usd);
  for (const part of PARTS) {
    const sum = x.parts[part].arms.reduce((a, arm) => a + x.pilot_caps_usd[arm], 0);
    const item = items.find((i) => i.item === "h2hx-" + part.toLowerCase() + "-pilot")!;
    rule("part " + part + " pilot caps fit its pilot item", sum <= item.cap_usd + 1e-9, "$" + sum.toFixed(2) + " of pilot caps against $" + item.cap_usd);
  }
  const arm: ExtArm = "s-gstack";
  const cap = x.pilot_caps_usd[arm], each = (cap / pilotSessions(arm, x)) * 1.5;
  let settled = 0, run = 0;
  while (mayOpenPilot(arm, settled, run, x)) {
    settled += each;
    run++;
  }
  const state = pilotState(arm, settled, run, x);
  rule("the pilot cap rule leaves out an arm whose settled spend reaches its cap first", state === "left_out" && run < pilotSessions(arm, x) && settled - cap < each + 1e-9 && settled - cap <= x.parts.S.limits.allowance_usd,
    arm + ": " + run + " of " + pilotSessions(arm, x) + " sessions at $" + each.toFixed(2) + " each, settled $" + settled.toFixed(2) + " against the $" + cap + " cap, state " + state);
  settled = 0;
  run = 0;
  while (mayOpenPilot(arm, settled, run, x)) {
    settled += cap / 20;
    run++;
  }
  rule("an arm under its cap runs every pilot session", pilotState(arm, settled, run, x) === "done" && run === pilotSessions(arm, x), arm + ": " + run + " sessions, settled $" + settled.toFixed(2));
  return { dir, checks };
}
