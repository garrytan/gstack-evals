// Copyright (c) 2026 Garry Tan. MIT License.
// The money area's keyless dry-run rig: a temporary approval record holding every leased item at its frozen cap, a
// temporary local ledger, the controller on main's ledger, an off-host target in a temporary directory, and the real
// metering proxy in process with a fake upstream. Nothing here reads a key or reaches a network: the proxy gets
// invented key strings and a fetch that answers from memory.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { MeteringProxy } from "../../../src/runner/proxy/metering-proxy.ts";
import type { ReservationLedger } from "../../../src/types.ts";
import { LEDGER_ITEMS } from "../frozen.ts";
import type { LedgerItemId } from "../types.ts";
import { $, MoneyController } from "./book.ts";
import { DirTarget, writeAheadLedger } from "./durability.ts";
import { mainLeases } from "./ledger-main.ts";
import type { Admission, LeaseSeam, OffHostTarget, Sub } from "./types.ts";
import { WriteAhead } from "./wal.ts";

export const DRY_RUN_ID = "dc-dryrun";
export const QUOTE = [{ words: "Approved for the keyless dry run only.", by: "dry-run fixture", source: "invented fixture" }];
const FAKE_KEYS = { ANTHROPIC_API_KEY: "dry-run-not-a-key-anthropic", OPENAI_API_KEY: "dry-run-not-a-key-openai", OPENROUTER_API_KEY: "dry-run-not-a-key-openrouter" };

export interface Rig {
  dir: string;
  record: string;
  ledgerPath: string;
  local: LocalLedger;
  holder: string;
  target: OffHostTarget;
  wal: WriteAhead | null;
  leases: LeaseSeam & { nonce: string };
  c: MoneyController;
  cleanup: () => void;
}

export interface RigOptions {
  wal?: boolean;
  target?: OffHostTarget;
  runId?: string;
  dir?: string;
  holder?: string;
  now?: () => Date;
  caps?: Partial<Record<LedgerItemId, number>>;
}

/** A fresh temporary record and local ledger with every leased item approved at its frozen cap. */
export function makeRecord(dir: string, caps: Partial<Record<LedgerItemId, number>> = {}): string {
  const record = join(dir, "record");
  for (const [item, spec] of Object.entries(LEDGER_ITEMS)) {
    if (!spec.leased) continue;
    recordApproval(record, { action: "init", item, cap_micros: caps[item as LedgerItemId] ?? $(spec.capUsd), quotes: QUOTE, admission: "warn" });
  }
  return record;
}

export function rig(o: RigOptions = {}): Rig {
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), "dc-money-"));
  const record = makeRecord(dir, o.caps);
  const ledgerPath = join(dir, "host", "ledger.sqlite");
  const local = LocalLedger.open(ledgerPath, o.now);
  const runId = o.runId ?? DRY_RUN_ID;
  const holder = o.holder ?? join(dir, "holders", runId);
  const target = o.target ?? new DirTarget(join(dir, "offhost"));
  const wal = o.wal ? new WriteAhead(target, o.now) : null;
  const leases = mainLeases({ record, local, requireAdmission: () => null });
  const c = new MoneyController({ runId, holder, leases, wal, now: o.now });
  return { dir, record, ledgerPath, local, holder, target, wal, leases, c, cleanup: () => { try { local.close(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}

/** Collects failed expectations; null when every one held. */
export function expectations() {
  const fails: string[] = [];
  return {
    want: (cond: boolean, why: string) => {
      if (!cond) fails.push(why);
    },
    result: () => (fails.length ? fails.join("; ") : null),
  };
}

export const admitted = (a: Admission, what: string): Sub => {
  if (a.kind !== "admitted") throw new Error(what + " was not admitted: " + a.kind + ": " + a.why);
  return a.sub;
};

/** Runs a check on a fresh rig and always cleans it up. */
export async function withRig(o: RigOptions, fn: (r: Rig) => Promise<string | null>): Promise<string | null> {
  const r = rig(o);
  try {
    return await fn(r);
  } finally {
    r.cleanup();
  }
}

/** The upstream's reply per provider; openrouter replies name provider. */
export type Upstream = (url: string, body: any) => Response;

export const fakeReply = (o: { text?: string; provider?: string; input?: number; output?: number } = {}): Upstream => (url) => {
  const text = o.text ?? "ok";
  const input = o.input ?? 100;
  const output = o.output ?? 20;
  if (url.includes("api.anthropic.com")) return Response.json({ id: "msg", type: "message", content: [{ type: "text", text }], usage: { input_tokens: input, output_tokens: output } });
  if (url.includes("api.openai.com")) return Response.json({ id: "resp", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: input, output_tokens: output } });
  return Response.json({ id: "gen", provider: o.provider ?? "OpenAI", choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: input, completion_tokens: output } });
};

export interface ProxyRig {
  proxy: MeteringProxy;
  journal: string;
  /** Every body the fake upstream received. */
  sent: Array<{ url: string; body: any }>;
  stop: () => void;
}

/** The real metering proxy on the item's open lease, with a fake upstream. ledger defaults to the rig's local ledger. */
export function startProxy(r: Rig, item: LedgerItemId, upstream: Upstream, o: { ledger?: ReservationLedger; journal?: string; walLedger?: boolean } = {}): ProxyRig {
  const lease = r.c.lease(item);
  if (!lease) throw new Error(item + " has no open lease");
  const journal = o.journal ?? join(r.dir, "proxy-" + item + "-" + lease.leaseId.slice(-6), "journal.ndjson");
  const sent: ProxyRig["sent"] = [];
  const ledger = o.ledger ?? (o.walLedger && r.wal ? writeAheadLedger(r.local, r.wal) : r.local);
  const proxy = new MeteringProxy({
    ledger,
    leaseId: lease.leaseId,
    host: "127.0.0.1",
    managementSocket: join(r.dir, "m-" + lease.leaseId.slice(-6) + ".sock"),
    managementToken: "dry-run-management-token-0123456789",
    journal,
    retry: { attempts: 1, elapsed_ms: 60_000 },
    env: FAKE_KEYS,
    maxOutputTokens: 64_000,
    sleep: async () => {},
    fetch: async (url, init) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      sent.push({ url, body });
      return upstream(url, body);
    },
  });
  mkdirSync(dirname(journal), { recursive: true });
  proxy.start();
  let stopped = false;
  return { proxy, journal, sent, stop: () => { if (!stopped) proxy.stop(); stopped = true; } };
}
