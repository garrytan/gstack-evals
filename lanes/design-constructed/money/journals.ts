// Copyright (c) 2026 Garry Tan. MIT License.
// The proxy journals on a same-host relaunch (wiring item 6). Every metering proxy the host runs keeps its journal under
// the service's journalDir, in direct/ for the in-process direct callers and sessions/ for the session proxies, and
// every slot a proxy binds is linked to its sub-reservation in links/<folder>.ndjson before anything is sent
// (appendLink). On a relaunch, recovery holds every sub-reservation that was in flight as unknown at its full
// reservation (money/durability.ts recover). This then reads each journal with main's reconcileJournal, which settles
// in the local ledger every call whose outcome the journal shows and holds the rest as unknown, and reconciles each held
// sub-reservation at its meters' spend when every meter linked to it reads settled. A sub-reservation with no link, a
// link to a journal that could not be read (a proxy still holds its lock) or a meter with a call still unknown stays
// unknown, under PD-18, until the owner's reconcile.
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { reconcileJournal } from "../../../src/runner/proxy/metering-proxy.ts";
import type { LedgerItemId } from "../types.ts";
import type { MoneyController } from "./book.ts";
import { writeAheadLedger } from "./durability.ts";
import type { Sub } from "./types.ts";
import type { WriteAhead } from "./wal.ts";

/** The proxy folders under the service's journalDir. */
export const PROXY_FOLDERS = ["direct", "sessions"] as const;

/** One bound slot: the sub-reservation it spends on, its lease, its meter and the proxy journal that records its calls. */
export interface Link {
  sub: string;
  item: LedgerItemId;
  lease: string;
  meter: string;
  journal: string;
}

/** Where a proxy folder's links sit: beside it, in links/<folder>.ndjson, so the folder holds only proxy folders. */
export const linksFile = (dir: string) => join(dirname(dir), "links", basename(dir) + ".ndjson");

/** Appends one link, fsynced, before the slot sends anything. */
export function appendLink(dir: string, link: Link): void {
  const file = linksFile(dir);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, JSON.stringify(link) + "\n", { mode: 0o600 });
  const fd = openSync(file, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

const readLinks = (dir: string): Link[] =>
  existsSync(linksFile(dir))
    ? readFileSync(linksFile(dir), "utf8")
        .split("\n")
        .flatMap((l) => {
          try {
            return l.trim() ? [JSON.parse(l) as Link] : [];
          } catch {
            return [];
          }
        })
    : [];

export interface JournalScan {
  /** Journals read, with what reconcileJournal did. */
  read: Array<{ journal: string; settled: number; unknown: number; released: number; refused: number; unreadable: number }>;
  /** Journals that could not be read, and why; their sub-reservations stay unknown. */
  unread: Array<{ journal: string; why: string }>;
  /** Held sub-reservations reconciled at their meters' spend. */
  settled: Array<{ sub: string; spentMicros: number }>;
  /** Held sub-reservations that stay unknown, and why. */
  unknown: Array<{ sub: string; why: string }>;
}

/** Reads every proxy journal under journalDir and settles the held sub-reservations they show. */
export async function settleFromJournals(o: { controller: MoneyController; local: LocalLedger; wal: WriteAhead; journalDir: string; held: readonly Sub[] }): Promise<JournalScan> {
  const ledger = writeAheadLedger(o.local, o.wal);
  const scan: JournalScan = { read: [], unread: [], settled: [], unknown: [] };
  const links: Link[] = [];
  for (const folder of PROXY_FOLDERS) {
    const dir = join(o.journalDir, folder);
    if (!existsSync(dir)) continue;
    links.push(...readLinks(dir));
    for (const name of readdirSync(dir).sort()) {
      const journal = join(dir, name, "journal.ndjson");
      if (!existsSync(journal)) continue;
      try {
        const r = await reconcileJournal(journal, ledger);
        scan.read.push({ journal, settled: r.settled.length, unknown: r.unknown.length, released: r.released.length, refused: r.refused.length, unreadable: r.unreadable });
      } catch (e) {
        scan.unread.push({ journal, why: (e as Error).message });
      }
    }
  }
  const unread = new Set(scan.unread.map((u) => u.journal));
  const read = new Set(scan.read.map((r) => r.journal));
  for (const sub of o.held) {
    const mine = links.filter((l) => l.sub === sub.id);
    const why = !mine.length
      ? "no slot was linked to it"
      : mine.find((l) => unread.has(l.journal) || !read.has(l.journal))
        ? "its proxy journal could not be read"
        : null;
    if (why) {
      scan.unknown.push({ sub: sub.id, why });
      continue;
    }
    let spent = 0;
    let open: string | null = null;
    for (const l of mine) {
      const m = o.local.meters(l.lease).get(l.meter);
      if (m && m.unknown_calls > 0) open = "meter " + l.meter + " has " + m.unknown_calls + " call(s) the journal shows no outcome for";
      spent += m?.spent_micros ?? 0;
    }
    if (open) {
      scan.unknown.push({ sub: sub.id, why: open });
      continue;
    }
    if (o.controller.sub(sub.id)?.state !== "unknown") continue;
    await o.controller.reconcile(sub.id, spent);
    scan.settled.push({ sub: sub.id, spentMicros: spent });
  }
  return scan;
}

/** Writes the scan beside the service's state, for the Captain and the attaching agent. */
export function writeScan(stateDir: string, at: Date, scan: JournalScan): string {
  const file = join(stateDir, "journals-" + at.toISOString().replace(/[:.]/g, "-") + ".json");
  writeFileSync(file, JSON.stringify(scan, null, 2) + "\n", { mode: 0o600 });
  return file;
}
