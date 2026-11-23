// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.5: canonical units. gstack gives a carried gate item a new decision id at each revision and records
// carried_from, so a unit is one carry chain followed back to its first row. Its disposition is the last answered row
// (highest gate revision, then latest answer). It is a plan change when that row's chosen option starts with "apply the
// fix" or "accept the change", or when the chain has an incorporated amendment in run.json; a chain whose amendment was
// settled with no edit or withdrawn is excluded and counted. The change text is the chosen option after its leading
// verb phrase, with the originating finding's fix field appended when it is under 12 words or ends in an ellipsis.
import type { Decision, Finding, Kind, RunRecord } from "./records.ts";

export interface Unit {
  run: string;
  kind: Kind;
  /** The chain's first row id. */
  key: string;
  rows: Decision[];
  /** The last answered row, or null when no row of the chain was answered. */
  last: Decision | null;
  chosenText: string | null;
  planChange: boolean;
  /** settled (no edit: packaging or ordering) or withdrawn; such a unit is not an accepted change. */
  excluded: "settled" | "withdrawn" | null;
  incorporated: boolean;
  changeText: string | null;
  finding: Finding | null;
  userChallenge: boolean;
}

export const CHANGE = /^(apply the fix|accept the change)\b/i;
export const NO_CHANGE = /^(carry it into the build|accept with findings|keep your direction)\b|\(no plan change\)/i;
const LETTER = /^\(?[a-e][).:]\s+/i;
export const wordCount = (t: string): number => t.split(/\s+/).filter(Boolean).length;

export function chosenText(d: Decision): string | null {
  if (typeof d.chosen_text === "string" && d.chosen_text.trim()) return d.chosen_text.trim();
  if (typeof d.chosen !== "string") return null;
  const i = d.chosen.toLowerCase().charCodeAt(0) - 97;
  return i >= 0 && i < d.options.length ? d.options[i]!.trim() : null;
}

/** The finding a decision came from: origin is phase|finding id|time, several ids joined by +; the first is taken. */
export function originFinding(r: RunRecord, d: Decision): Finding | null {
  const id = (d.origin ?? "").split("|")[1]?.split("+")[0];
  if (!id) return null;
  const all = [...(r.findings ?? []), ...[...r.boundFindings.values()].flatMap((f) => f ?? [])];
  return all.find((f) => f.id === id) ?? null;
}

export function changeTextOf(chosen: string, finding: Finding | null): string {
  const rest = chosen.replace(LETTER, "").replace(/^(apply the fix|accept the change)\b[\s:,.;\u2014\u2013-]*/i, "").trim();
  const short = wordCount(rest) < 12 || /(\.\.\.|\u2026)$/.test(rest);
  return short && finding?.resolution ? (rest + " " + finding.resolution).trim() : rest;
}

const isUc = (d: Decision): boolean => /(^|-)uc\d+$/i.test(d.id) || /^UC\d+$/i.test(d.label ?? "") || d.options.some((o) => /accept the change both reviewers recommend/i.test(o));

/** The row a decision was carried from: its carried_from, or (older releases) the gate file item's carried.from. */
export function carriedFrom(r: RunRecord): (d: Decision) => string | undefined {
  const gate = new Map<string, string>();
  for (const g of r.gates.values()) for (const it of Array.isArray(g?.items) ? g.items : []) if (typeof it?.id === "string" && typeof it?.carried?.from === "string") gate.set(it.id, it.carried.from);
  return (d) => d.carried_from ?? gate.get(d.id);
}

/** Returns null when decisions.jsonl is missing or unreadable (the record's units are missing). */
export function unitsOf(r: RunRecord): Unit[] | null {
  if (!r.decisions) return null;
  const byId = new Map(r.decisions.map((d) => [d.id, d]));
  const from = carriedFrom(r);
  const root = (d: Decision): string => {
    let cur = d;
    const seen = new Set<string>([cur.id]);
    while (from(cur)) {
      const next = byId.get(from(cur)!);
      if (!next) return from(cur)!;
      if (seen.has(next.id)) return next.id;
      seen.add(next.id);
      cur = next;
    }
    return cur.id;
  };
  const chains = new Map<string, Decision[]>();
  for (const d of r.decisions) chains.set(root(d), [...(chains.get(root(d)) ?? []), d]);
  const amendments: any[] = Array.isArray(r.run?.amendments) ? r.run.amendments : [];
  const out: Unit[] = [];
  for (const [key, rows] of chains) {
    const ids = new Set(rows.map((d) => d.id));
    const answeredRows = rows.filter((d) => d.answered_at).sort((a, b) => b.gate_rev - a.gate_rev || String(b.answered_at).localeCompare(String(a.answered_at)));
    const last = answeredRows[0] ?? null;
    const mine = amendments.filter((a) => ids.has(a?.decision));
    const incorporated = mine.some((a) => a.status === "incorporated");
    const settled = mine.find((a) => a.status === "settled" || a.status === "withdrawn");
    const text = last ? chosenText(last) : null;
    const planChange = last !== null && ((text !== null && CHANGE.test(text.replace(LETTER, "")) && !NO_CHANGE.test(text.replace(LETTER, ""))) || incorporated);
    const finding = last ? originFinding(r, last) : rows.map((d) => originFinding(r, d)).find(Boolean) ?? null;
    out.push({
      run: r.id,
      kind: r.kind,
      key,
      rows,
      last,
      chosenText: text,
      planChange,
      excluded: planChange && settled ? (settled.status as "settled" | "withdrawn") : null,
      incorporated,
      changeText: planChange && text !== null ? changeTextOf(text, finding) : null,
      finding,
      userChallenge: rows.some(isUc) || rows.some((d) => originFinding(r, d)?.user_challenge === true),
    });
  }
  return out;
}

/** Accepted plan changes: answered, a plan change, not excluded as no-edit. */
export const accepted = (u: Unit): boolean => u.planChange && u.excluded === null;
