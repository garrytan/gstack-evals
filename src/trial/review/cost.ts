// cost.tsv for review units from the metering proxy's journal (plan 2026-10-30-geva-59-stacks-round-1-plan, sections
// 5, 8 and 9). Each unit-pass runs on its own proxy slot, so its meter holds exactly its calls. For one meter the
// journal's request lines name each call's model and its outcome lines carry the usage and spent_micros; refusal lines
// count requests the proxy refused from the slot's bearer.
//
// - The all row sums every call of the unit-pass; a voice row sums the calls to the cell's cross-family voice.
// - A call with no outcome line, or an unknown outcome, makes its row's usd and token columns unavailable, never a guess.
// - total_tokens is input + output + cache_read + cache_write; reasoning_tokens is shown as the proxy recorded it.
// - requests, refused and unknown_calls are extra columns, which the arm contract keeps and ignores. refusals.tsv sums
//   them per arm and cell: an arm with more than 2% of its requests refused in a cell is reported as degraded there.
import { existsSync, readFileSync } from "node:fs";

export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
  spent_micros: number;
  /** Paid calls sent upstream, retries included. */
  requests: number;
  /** Calls with no recorded outcome or an unknown one. */
  unknown: number;
}

export interface MeterCost {
  meter_id: string;
  all: Usage;
  /** The calls to the cell's voice model, or null when the cell keeps no voice. */
  voice: Usage | null;
  /** Requests the proxy refused from this slot's bearer. */
  refused: number;
}

export const DEGRADED_SHARE = 0.02;
export const COST_COLUMNS = ["pr", "scope", "pass", "total_tokens", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "usd", "wall_seconds", "meter_source", "requests", "refused", "unknown_calls"] as const;
export const REFUSAL_COLUMNS = ["arm_id", "arm", "model", "sessions", "requests", "refused", "refused_share", "degraded"] as const;

const zero = (): Usage => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, spent_micros: 0, requests: 0, unknown: 0 });
type Line = Record<string, any>;

/** The journal's lines; a torn or blank line is skipped. */
export function readJournalLines(path: string): Line[] {
  if (!existsSync(path)) return [];
  const out: Line[] = [];
  for (const text of readFileSync(path, "utf8").split("\n")) {
    if (!text.trim()) continue;
    try {
      const line = JSON.parse(text);
      if (line && typeof line === "object") out.push(line);
    } catch {
      continue;
    }
  }
  return out;
}

/** One meter's cost from the journal, split into all and the voice's calls. */
export function meterCost(lines: readonly Line[], meterId: string, voice: string | null): MeterCost {
  const calls = new Map<string, { model: string | null; outcome: Line | null }>();
  let refused = 0;
  for (const l of lines) {
    if (l.kind === "request" && l.cell?.meter_id === meterId) calls.set(l.reservation_id, { model: l.model ?? null, outcome: calls.get(l.reservation_id)?.outcome ?? null });
    else if (l.kind === "outcome" && l.meter_id === meterId) calls.set(l.reservation_id, { model: calls.get(l.reservation_id)?.model ?? null, outcome: l.outcome ?? null });
    else if (l.kind === "refusal" && l.meter_id === meterId) refused++;
  }
  const all = zero();
  const v = voice ? zero() : null;
  for (const call of calls.values()) {
    for (const u of call.model === voice && v ? [all, v] : [all]) {
      u.requests++;
      const o = call.outcome;
      if (!o || o.kind !== "spent" || typeof o.spent_micros !== "number" || !o.usage) {
        u.unknown++;
        continue;
      }
      u.input += o.usage.input ?? 0;
      u.output += o.usage.output ?? 0;
      u.cache_read += o.usage.cache_read ?? 0;
      u.cache_write += o.usage.cache_write ?? 0;
      u.reasoning += o.usage.reasoning ?? 0;
      u.spent_micros += o.spent_micros;
    }
  }
  return { meter_id: meterId, all, voice: v, refused };
}

export interface CostSession {
  /** The unit ref for the pr column. */
  pr: string;
  pass: number;
  wall_ms: number | null;
  cost: MeterCost | null;
}

const usd = (micros: number) => (micros / 1_000_000).toFixed(6);

function row(pr: string, scope: string, pass: number, u: Usage | null, wall: string, refused: number | null): string[] {
  const known = u !== null && u.unknown === 0;
  const n = (x: number) => (known ? String(x) : "unavailable");
  return [pr, scope, String(pass), u ? n(u.input + u.output + u.cache_read + u.cache_write) : "unavailable", u ? n(u.input) : "unavailable", u ? n(u.output) : "unavailable", u ? n(u.cache_read) : "unavailable", u ? n(u.cache_write) : "unavailable", u ? n(u.reasoning) : "unavailable", u && known ? usd(u.spent_micros) : "unavailable", wall, "proxy-journal", u ? String(u.requests) : "", refused === null ? "" : String(refused), u ? String(u.unknown) : ""];
}

/** cost.tsv text: an all row per unit-pass, and a voice row per unit-pass whose cell keeps a voice. */
export function costTsv(sessions: readonly CostSession[]): string {
  const rows = [COST_COLUMNS.join("\t")];
  for (const s of sessions) {
    const wall = s.wall_ms === null ? "" : String(Math.round(s.wall_ms / 100) / 10);
    rows.push(row(s.pr, "all", s.pass, s.cost?.all ?? null, wall, s.cost?.refused ?? null).join("\t"));
    if (s.cost?.voice) rows.push(row(s.pr, "voice", s.pass, s.cost.voice, "", null).join("\t"));
  }
  return rows.join("\n") + "\n";
}

export interface CellRefusals {
  arm_id: string;
  arm: string;
  model: string;
  sessions: number;
  requests: number;
  refused: number;
}

/** refusals.tsv text: the refused share of each arm and cell's requests, degraded above 2%. */
export function refusalsTsv(cells: readonly CellRefusals[]): string {
  const rows = [REFUSAL_COLUMNS.join("\t")];
  for (const c of cells) {
    const share = c.requests + c.refused ? c.refused / (c.requests + c.refused) : 0;
    rows.push([c.arm_id, c.arm, c.model, String(c.sessions), String(c.requests), String(c.refused), share.toFixed(4), share > DEGRADED_SHARE ? "yes" : "no"].join("\t"));
  }
  return rows.join("\n") + "\n";
}
