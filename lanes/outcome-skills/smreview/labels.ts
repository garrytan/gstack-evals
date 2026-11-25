// Copyright (c) 2026 Garry Tan. MIT License.
// SR's labels (plan section 3): pf-labels.v1 files for pstack-checks' labels gate. Two sources, read in this order so the
// first wins (readLabels): the state machines eval's own records (GEVA-520's unit.json labels, which keep each reader's
// defect and state-shaped answers but not the reason), then SR's own sr-labels replies, labelled with the same packet,
// questions, readers and strict reply reader. A reader with no answered reply gets null, so the unit fails closed.
import { readFileSync } from "node:fs";
import type { LabelAnswer } from "../statemachines/packets.ts";
import { srFail } from "./errors.ts";

export interface PfLabels { schema: "pf-labels.v1"; source: string; labels: Record<string, { astra: LabelAnswer | null; opus: LabelAnswer | null }> }
type Reader = "astra" | "opus";
const READERS: Reader[] = ["astra", "opus"];
const yn = (v: unknown): v is "yes" | "no" => v === "yes" || v === "no";

/** The state machines eval's combined labels (unit.json labels: defect and state_shaped as [astra, opus], malformed
 *  naming any reader with no answer). Only ids in want are kept. */
export function labelsFromSmUnits(units: Array<{ id: string; labels?: unknown }>, want: Set<string>, source: string): PfLabels {
  const out: PfLabels = { schema: "pf-labels.v1", source, labels: {} };
  for (const u of units) {
    if (!want.has(u.id) || !u.labels) continue;
    const l = u.labels as { defect?: unknown[]; state_shaped?: unknown[]; malformed?: unknown[]; packet?: unknown };
    if (!Array.isArray(l.defect) || !Array.isArray(l.state_shaped) || !Array.isArray(l.malformed)) srFail("E_SR_INPUT", u.id + "'s labels are not the state machines eval's combined form");
    const one = (i: number): LabelAnswer | null => {
      const d = l.defect![i], s = l.state_shaped![i];
      return l.malformed!.includes(READERS[i]) || !yn(d) || !yn(s) ? null : { defect: d, state_shaped: s, reason: "reused from the state machines eval's sm-labels, packet " + String(l.packet) };
    };
    out.labels[u.id] = { astra: one(0), opus: one(1) };
  }
  return out;
}

/** Units a merged results post lists as having passed both labellers' defect and state-shaped answers, when the answers
 *  themselves are not kept: pstack-checks' 30 test units (wiki/board/2026-11-17-geva-521-pstack-checks-results/units.tsv,
 *  whose README says each passed two cross-family state-shape labels). Only ids in want are kept. */
export function labelsFromPublished(tsv: string, want: Set<string>, source: string): PfLabels {
  const out: PfLabels = { schema: "pf-labels.v1", source, labels: {} };
  const yes: LabelAnswer = { defect: "yes", state_shaped: "yes", reason: "passed both labels in " + source };
  for (const l of tsv.split("\n")) {
    const id = l.split("\t")[0]!;
    if (!l.startsWith("#") && id !== "unit" && want.has(id)) out.labels[id] = { astra: yes, opus: yes };
  }
  return out;
}

/** SR's own replies (the sender's reply events) through each packet's key (sm-label-key.v1). A packet with no key, a key
 *  for an id twice, or an answered reply with no answer is an input error. */
export function labelsFromReplies(keys: Array<{ schema?: string; packet: string; unit: string }>, events: Array<Record<string, unknown>>, source: string): PfLabels {
  const unitOf = new Map<string, string>();
  for (const k of keys) {
    if (k.schema !== "sm-label-key.v1") srFail("E_SR_INPUT", "a label key is not sm-label-key.v1");
    if ([...unitOf.values()].includes(k.unit)) srFail("E_SR_INPUT", k.unit + " has two label keys");
    unitOf.set(k.packet, k.unit);
  }
  const out: PfLabels = { schema: "pf-labels.v1", source, labels: {} };
  for (const u of unitOf.values()) out.labels[u] = { astra: null, opus: null };
  for (const e of events) {
    if (e.event !== "reply") continue;
    const unit = unitOf.get(String(e.packet));
    if (!unit) srFail("E_SR_INPUT", "a reply names packet " + String(e.packet) + ", which no label key lists");
    const reader = e.reader as Reader;
    if (!READERS.includes(reader) || e.outcome !== "answered") continue;
    const a = e.answer as LabelAnswer | null;
    if (!a || !yn(a.defect) || !yn(a.state_shaped)) srFail("E_SR_INPUT", unit + " has an answered " + reader + " reply with no answer");
    out.labels[unit!]![reader] ??= a;
  }
  return out;
}

export const readJsonl = (path: string): Array<Record<string, unknown>> =>
  readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
