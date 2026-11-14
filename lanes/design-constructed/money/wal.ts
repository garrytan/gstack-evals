// Copyright (c) 2026 Garry Tan. MIT License.
// The write-ahead copy (R2-4): every ledger admission and every proxy journal reserve line is chained, hashed and
// appended to an off-host target, and the append resolves only once the target acknowledges it. Nothing is forwarded
// before that. After one failed append the log refuses every later line until a snapshot restarts the chain, so the
// target never holds a gap that a forwarded call could hide in.
import { createHash } from "node:crypto";
import type { OffHostTarget } from "./types.ts";

export const GENESIS = "0".repeat(64);

export interface WalLine {
  seq: number;
  prev: string;
  at: string;
  entry: Record<string, unknown>;
  hash: string;
}

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

const hashOf = (l: Omit<WalLine, "hash">) => sha256(JSON.stringify({ seq: l.seq, prev: l.prev, at: l.at, entry: l.entry }));

export function parseWal(text: string): WalLine | null {
  try {
    const l = JSON.parse(text) as WalLine;
    if (!Number.isSafeInteger(l.seq) || typeof l.prev !== "string" || typeof l.hash !== "string" || typeof l.entry !== "object" || l.entry === null) return null;
    return hashOf(l) === l.hash ? l : null;
  } catch {
    return null;
  }
}

/**
 * The lines after a watermark, checked as one unbroken chain from the snapshot's head. Null when completeness can't be
 * shown: an unreadable line, a gap, a fork (two lines on one seq) or a line that doesn't chain.
 */
export function chainAfter(lines: string[], watermark: number, head: string): { lines: WalLine[] } | { broken: string } {
  const after = new Map<number, WalLine>();
  for (const text of lines) {
    if (!text.trim()) continue;
    const l = parseWal(text);
    if (!l) return { broken: "an off-host line does not parse or its hash does not match" };
    if (l.seq <= watermark) continue;
    const seen = after.get(l.seq);
    if (seen && seen.hash !== l.hash) return { broken: "two different off-host lines hold seq " + l.seq };
    after.set(l.seq, l);
  }
  const out: WalLine[] = [];
  let prev = head;
  for (let seq = watermark + 1; after.has(seq); seq++) {
    const l = after.get(seq)!;
    if (l.prev !== prev) return { broken: "off-host line " + seq + " does not chain to the line before it" };
    out.push(l);
    prev = l.hash;
  }
  if (out.length !== after.size) return { broken: "the off-host copy has a gap after seq " + (watermark + out.length) };
  return { lines: out };
}

export class WriteAhead {
  seq: number;
  head: string;
  broken: string | null = null;

  constructor(
    private readonly target: OffHostTarget,
    private readonly now: () => Date = () => new Date(),
    start: { seq: number; head: string } = { seq: 0, head: GENESIS },
  ) {
    this.seq = start.seq;
    this.head = start.head;
  }

  /** Appends one entry and resolves once the target holds it. Throws when the target doesn't acknowledge it. */
  async append(entry: Record<string, unknown>): Promise<WalLine> {
    if (this.broken) throw new Error("the write-ahead copy is broken (" + this.broken + "); take a snapshot to restart it");
    const body = { seq: this.seq + 1, prev: this.head, at: this.now().toISOString(), entry };
    const line: WalLine = { ...body, hash: hashOf(body) };
    this.seq = line.seq;
    this.head = line.hash;
    try {
      await this.target.append(JSON.stringify(line));
    } catch (e) {
      this.broken ??= "line " + line.seq + " was not acknowledged: " + (e as Error).message;
      throw new Error(this.broken);
    }
    return line;
  }

  /** Restarts the chain at a snapshot's watermark once the snapshot is verified off host. */
  restart(seq: number, head: string): void {
    if (seq < this.seq) return;
    this.seq = seq;
    this.head = head;
    this.broken = null;
  }
}
