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
  if (!m.bin || !existsSync(m.bin)) {
    throw new LedgerError("E_APPROVAL_RECORD", "gstack-approvals not found (" + (m.bin ?? "not on PATH or in ~/.local/share/gstack/bin") + "); install gstack: " + INSTALL);
  }
  const ask = m.action === "init" ? "Approve a gstack-evals spend cap of " + usd(m.cap_micros) + " for line item " + m.item : "Raise the gstack-evals spend cap for line item " + m.item + " to " + usd(m.cap_micros);
  const scope = "gstack-evals line item " + m.item + " in the approval record " + m.record;
  for (const q of m.quotes) {
    const args = ["add", "--ask", ask, "--words", q.words, "--by", q.by, "--scope", scope, "--source", q.source, ...(m.branch ? ["--branch", m.branch] : [])];
    const result = spawnSync(m.bin, args, { encoding: "utf8", timeout: 60_000 });
    if (result.status === 0) continue;
    const stderr = (result.stderr ?? "") + (result.error ? result.error.message : "");
    const code = /\b(APPROVAL_RECORD_[A-Z_]+)\b/.exec(stderr)?.[1] ?? "no APPROVAL_RECORD_* code";
    throw new LedgerError("E_APPROVAL_RECORD", m.bin + " exited " + (result.status ?? result.signal ?? "without a status") + " (" + code + "): " + (stderr.trim().split("\n")[0] ?? ""));
  }
}
