// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.3's states per part C session, and the blind copy the judge reads.
//
// - The final state is the root thread's last assistant message. In the contract arms (c-on, c-high) the first-stop state
//   is the last assistant message before the root rollout's first contract block; a session the contract never blocked
//   gets a first-stop row whose text is its final state's (same_as_final). c-off and c-none get final states only.
// - A state's findings are the last fenced json block of its message, parsed by review-units' parser (parseFinalTurn), the
//   first 15 in their order. A message with no parseable block is "missing" or "malformed", so the judge extracts its
//   findings key-blind, the same in every arm and state; a state with no assistant text is "no_text" and finds nothing.
// - Blind ids are an HMAC-SHA256 of the session and the state's text under a key kept in the readout dir (blind.key, 32
//   random bytes, never committed), so one session's first-stop and final states share an id only when their texts match.
//   states-blind.jsonl holds each distinct (session, text) once, ordered by blind id, with the unit and no arm, state, pass
//   or model.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFinalTurn, type ToldFinding } from "../../../src/trial/review/findings.ts";
import { CONTRACT_ARMS, type ArmName } from "./pins.ts";
import { blockIndexes, lastAssistant, type SessionRollouts } from "./rollout.ts";

export const MAX_FINDINGS = 15;

export interface Cell {
  model: string;
  arm: string;
  unit: string;
  pass: number;
}

export interface StateRow extends Cell {
  state: "final" | "first_stop";
  blocked: boolean;
  same_as_final: boolean;
  text: string | null;
  text_sha256: string | null;
  outcome: "findings" | "missing" | "malformed" | "no_text";
  findings: ToldFinding[];
  /** Findings past the first 15, which are not counted. */
  dropped: number;
  blind_id: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The readout's blind key, made on first use. */
export function blindKey(dir: string): Buffer {
  const f = join(dir, "blind.key");
  if (!existsSync(f)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(f, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
  }
  return Buffer.from(readFileSync(f, "utf8").trim(), "hex");
}

const blindId = (key: Buffer, c: Cell, text: string | null) => createHmac("sha256", key).update([c.model, c.arm, c.unit, String(c.pass), text ?? ""].join("\n")).digest("hex").slice(0, 16);

function state(c: Cell, kind: StateRow["state"], text: string | null, blocked: boolean, same: boolean, key: Buffer): StateRow {
  const base = { ...c, state: kind, blocked, same_as_final: same, text, text_sha256: text === null ? null : sha256(text), blind_id: blindId(key, c, text) };
  if (text === null) return { ...base, outcome: "no_text", findings: [], dropped: 0 };
  const p = parseFinalTurn(text);
  if (p.kind !== "findings") return { ...base, outcome: p.kind === "malformed" ? "malformed" : "missing", findings: [], dropped: 0 };
  return { ...base, outcome: "findings", findings: p.findings.slice(0, MAX_FINDINGS), dropped: Math.max(0, p.findings.length - MAX_FINDINGS) };
}

/** A session's states: its final state, and in a contract arm its first-stop state. */
export function sessionStates(c: Cell, r: SessionRollouts, key: Buffer): StateRow[] {
  const root = r.root;
  const final = root ? lastAssistant(root) : null;
  const blocks = root ? blockIndexes(root) : [];
  const rows = [state(c, "final", final, blocks.length > 0, false, key)];
  if (!(CONTRACT_ARMS as readonly string[]).includes(c.arm as ArmName)) return rows;
  if (!blocks.length) return [...rows, state(c, "first_stop", final, false, true, key)];
  return [...rows, state(c, "first_stop", lastAssistant(root!, blocks[0]), true, false, key)];
}

/** The judge's copy: each distinct (session, text) once, by blind id, with the unit and nothing else of the cell. */
export function blindRows(rows: readonly StateRow[]): { blind_id: string; unit: string; text: string | null; outcome: StateRow["outcome"]; findings: ToldFinding[] }[] {
  const seen = new Map<string, StateRow>();
  for (const r of rows) if (!seen.has(r.blind_id)) seen.set(r.blind_id, r);
  return [...seen.values()].sort((a, b) => (a.blind_id < b.blind_id ? -1 : 1)).map((r) => ({ blind_id: r.blind_id, unit: r.unit, text: r.text, outcome: r.outcome, findings: r.findings }));
}
