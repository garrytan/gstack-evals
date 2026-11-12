// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals of dryrun (prereg section 14, start rule 7): the keyless dry run. It runs every area's seams, each driving
// one frozen rule through the area's real code on one side of its edge, then opens and settles one ledger lease per
// item on a temporary ledger and checks that an item that served one run refuses a second. It prints one PASS, FAIL or
// SKIP line per seam and exits 1 on any FAIL or SKIP: the container seams need GSTACK_EVALS_DOCKER=1, and a SKIP is never
// a pass. The keyless end to end through the real Docker rig is its own command, of e2e.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import type { Seam } from "./types.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** The areas whose seams the dry run drives, in the order it prints them. */
export const AREAS = ["seams.ts", "sim/seams.ts", "author/seams.ts", "run/seams.ts", "score/seams.ts", "read/seams.ts"] as const;

/**
 * The eval's ledger items, one per frozen run (an item serves one run). The cells are run.ts's launches; labels, the
 * judge check and the audits are judge runs; hosts holds the runner VMs; probe is the one-time route check.
 */
export const ITEMS = [
  "of-author-pilot", "of-author",
  "of-s1-runs", "of-s1-sim", "of-smoke-runs", "of-smoke-sim", "of-s1-labels", "of-s1-check", "of-s1-audit",
  "of-s2-runs", "of-s2-sim", "of-s2-labels", "of-s2-audit",
  "of-real-runs", "of-real-sim", "of-real-labels",
  "of-pitch-runs", "of-pitch-labels",
  "of-probe", "of-hosts",
] as const;

export interface Line {
  name: string;
  state: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

async function seamLines(): Promise<Line[]> {
  const out: Line[] = [];
  for (const area of AREAS) {
    let seams: Seam[];
    try {
      seams = ((await import(join(import.meta.dir, area))) as { seams: Seam[] }).seams;
    } catch (e) {
      out.push({ name: area + " loads", state: "FAIL", detail: (e as Error).message.split("\n")[0]! });
      continue;
    }
    for (const s of seams) {
      try {
        const r = await s.run();
        out.push({ name: s.name, state: r.ok ? "PASS" : r.detail.startsWith("SKIP") ? "SKIP" : "FAIL", detail: r.detail });
      } catch (e) {
        out.push({ name: s.name, state: "FAIL", detail: "threw " + (e as Error).message.split("\n")[0] });
      }
    }
  }
  return out;
}

function ledgerLines(): Line[] {
  const dir = mkdtempSync(join(tmpdir(), "of-dryrun-ledger-"));
  const out: Line[] = [];
  try {
    const record = join(dir, "record");
    const path = ledgerPath(join(dir, "ledger.sqlite"), {});
    const quote = { words: "dry run on a temporary ledger, not an approval", by: "of dryrun", source: "start rule 7" };
    const failed: string[] = [];
    for (const item of ITEMS) {
      try {
        recordApproval(record, { action: "init", item, cap_micros: 1_000_000, quotes: [quote], admission: "warn" });
        const local = openLocalLedger(path);
        try {
          settleLease(record, local, openLease(record, local, { item, run_id: item }).lease_id);
        } finally {
          local.close();
        }
      } catch (e) {
        failed.push(item + " (" + (e as Error).message.split("\n")[0] + ")");
      }
    }
    out.push({ name: "ledger: one lease opens and settles on each of the " + ITEMS.length + " items on a temporary ledger", state: failed.length ? "FAIL" : "PASS", detail: failed.join("; ") });
    const local = openLocalLedger(path);
    let code = "";
    try {
      openLease(record, local, { item: "of-s2-runs", run_id: "another-run" });
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    } finally {
      local.close();
    }
    out.push({ name: "ledger: an item that served one run refuses a second run (E_ITEM_BOUND)", state: code === "E_ITEM_BOUND" ? "PASS" : "FAIL", detail: code === "E_ITEM_BOUND" ? "" : code || "no refusal" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

export async function dryRun(o: { ledger: boolean }): Promise<Line[]> {
  return [...(await seamLines()), ...(o.ledger ? ledgerLines() : [])];
}

export async function run(argv: string[], io: Io): Promise<number> {
  for (const a of argv) if (a !== "--no-ledger") throw Object.assign(new Error("unknown argument " + JSON.stringify(a) + "; usage: gstack-evals of dryrun [--no-ledger]"), { code: "E_USAGE" });
  const lines = await dryRun({ ledger: !argv.includes("--no-ledger") });
  for (const l of lines) io.out(l.state + " " + l.name + (l.detail ? " (" + l.detail + ")" : ""));
  const n = (s: Line["state"]) => lines.filter((l) => l.state === s).length;
  io.out("of dryrun: " + n("PASS") + " PASS, " + n("FAIL") + " FAIL, " + n("SKIP") + " SKIP");
  if (n("FAIL") + n("SKIP")) io.err("E_OF_DRYRUN_FAIL of dryrun: " + n("FAIL") + " failed and " + n("SKIP") + " skipped; a skipped seam is not a pass");
  return n("FAIL") + n("SKIP") ? 1 : 0;
}
