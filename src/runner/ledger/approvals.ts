// Mirrors a ledger approval through gstack's gstack-approvals, so the owner's words also appear in the thread's
// approval table. The ledger's own record stays the one skill-eval reads. Any absence or failure of the binary is one
// code, E_APPROVAL_RECORD, with the binary path, its exit and its APPROVAL_RECORD_* code.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { usd } from "./money.ts";
import { LedgerError, type Quote } from "./record.ts";

const INSTALL = "git clone --depth 1 https://github.com/garrytan/gstack.git ~/.local/share/gstack && ~/.local/share/gstack/setup";

/** GSTACK_EVALS_APPROVALS_BIN, then gstack-approvals on PATH, then gstack's default checkout. */
export function approvalsBin(env: Record<string, string | undefined> = process.env): string | null {
  if (env.GSTACK_EVALS_APPROVALS_BIN) return env.GSTACK_EVALS_APPROVALS_BIN;
  const candidates = (env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "gstack-approvals"));
  candidates.push(join(homedir(), ".local", "share", "gstack", "bin", "gstack-approvals"));
  return candidates.find((path) => existsSync(path)) ?? null;
}

export interface MirrorRequest {
  bin: string | null;
  action: "init" | "raise";
  item: string;
  cap_micros: number;
  record: string;
  quotes: Quote[];
  branch?: string;
}

/** Adds one gstack-approvals row per quote. gstack-approvals skips a row it already holds, so a retry is safe. */
export function mirrorApproval(m: MirrorRequest): void {
  const ask = m.action === "init" ? "Approve a gstack-evals spend cap of " + usd(m.cap_micros) + " for line item " + m.item : "Raise the gstack-evals spend cap for line item " + m.item + " to " + usd(m.cap_micros);
  addRows(m.bin, ask, "gstack-evals line item " + m.item + " in the approval record " + m.record, m.quotes, m.branch);
}

/** Mirrors a program envelope's approval the same way, one row per quote. */
export function mirrorEnvelope(m: { bin: string | null; program: string; cap_micros: number; skill_cap_micros: number; skills: string[]; credit_rate_micros: number; record: string; quotes: Quote[]; branch?: string }): void {
  const ask = "Approve a gstack-evals program envelope of " + usd(m.cap_micros) + " for program " + m.program + ", with " + usd(m.skill_cap_micros) + " for each of its " + m.skills.length + " skills (" + m.skills.join(", ") + "), counting crew use at " + usd(m.credit_rate_micros) + " per 1,000 credits";
  addRows(m.bin, ask, "gstack-evals program " + m.program + " in the approval record " + m.record, m.quotes, m.branch);
}

function addRows(bin: string | null, ask: string, scope: string, quotes: Quote[], branch?: string): void {
  if (!bin || !existsSync(bin)) {
    throw new LedgerError("E_APPROVAL_RECORD", "gstack-approvals not found (" + (bin ?? "not on PATH or in ~/.local/share/gstack/bin") + "); install gstack: " + INSTALL);
  }
  for (const q of quotes) {
    const args = ["add", "--ask", ask, "--words", q.words, "--by", q.by, "--scope", scope, "--source", q.source, ...(branch ? ["--branch", branch] : [])];
    const result = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
    if (result.status === 0) continue;
    const stderr = (result.stderr ?? "") + (result.error ? result.error.message : "");
    const code = /\b(APPROVAL_RECORD_[A-Z_]+)\b/.exec(stderr)?.[1] ?? "no APPROVAL_RECORD_* code";
    throw new LedgerError("E_APPROVAL_RECORD", bin + " exited " + (result.status ?? result.signal ?? "without a status") + " (" + code + "): " + (stderr.trim().split("\n")[0] ?? ""));
  }
}
