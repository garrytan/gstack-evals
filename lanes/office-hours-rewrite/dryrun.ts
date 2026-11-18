// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ohr dryrun (prereg section 12, step 1): the keyless dry run. It runs every area's seams, each driving one
// frozen rule through the area's real code on one side of its edge, checks the ledger split (ledger.ts) on both sides,
// then opens and settles one ledger lease per ledger item, at that item's cap, on a temporary ledger, and checks that an
// item that served one run refuses a second. It prints one PASS, FAIL or SKIP line per check and exits 1 on any FAIL or
// SKIP: a SKIP is never a pass. The keyless end to end through the real Docker rig is its own command, ohr e2e.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { CAPS } from "./frozen.ts";
import { SPLIT, splitProblems } from "./ledger.ts";
import type { Seam } from "./types.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** The areas whose seams the dry run drives, in the order it prints them. */
export const AREAS = ["author/seams.ts", "run/seams.ts", "sim/seams.ts", "score/seams.ts", "read/seams.ts"] as const;

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
    if (!seams.length) out.push({ name: area + " exports seams", state: "FAIL", detail: "no seams" });
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

function splitLines(): Line[] {
  const held = splitProblems();
  const over = splitProblems(SPLIT.map((p) => (p.item === "ohr-s2-arms" ? { ...p, cap: p.cap + CAPS.stage2 } : p)));
  const thin = splitProblems(SPLIT.map((p) => (p.item === "ohr-s1-sim" ? { ...p, cap: 7 } : p)));
  const sums = (Object.keys(CAPS) as (keyof typeof CAPS)[]).map((l) => l + " $" + SPLIT.filter((p) => p.line === l).reduce((t, p) => t + p.cap, 0) + "/$" + CAPS[l]).join(", ");
  return [
    { name: "ledger split: every approved item's ledger items sum to at most its cap, and each keeps 1.35 times central plus its allowance | holds", state: held.length ? "FAIL" : "PASS", detail: held.join("; ") || sums },
    { name: "ledger split: a part that pushes an approved item past its cap is refused | breaks", state: over.some((p) => p.startsWith("stage2's ledger items sum")) ? "PASS" : "FAIL", detail: over[0] ?? "no refusal" },
    { name: "ledger split: a part under 1.35 times its central figure is refused | breaks", state: thin.some((p) => p.startsWith("ohr-s1-sim")) ? "PASS" : "FAIL", detail: thin[0] ?? "no refusal" },
  ];
}

function ledgerLines(): Line[] {
  const dir = mkdtempSync(join(tmpdir(), "ohr-dryrun-ledger-"));
  const out: Line[] = [];
  try {
    const record = join(dir, "record");
    const path = ledgerPath(join(dir, "ledger.sqlite"), {});
    const quote = { words: "dry run on a temporary ledger, not an approval", by: "ohr dryrun", source: "prereg section 12 step 1" };
    const failed: string[] = [];
    for (const p of SPLIT) {
      try {
        recordApproval(record, { action: "init", item: p.item, cap_micros: p.cap * 1_000_000, quotes: [quote], admission: "warn" });
        const local = openLocalLedger(path);
        try {
          settleLease(record, local, openLease(record, local, { item: p.item, run_id: p.item }).lease_id);
        } finally {
          local.close();
        }
      } catch (e) {
        failed.push(p.item + " (" + (e as Error).message.split("\n")[0] + ")");
      }
    }
    out.push({ name: "ledger: one lease opens and settles on each of the " + SPLIT.length + " ledger items at its cap on a temporary ledger", state: failed.length ? "FAIL" : "PASS", detail: failed.join("; ") });
    const local = openLocalLedger(path);
    let code = "";
    try {
      openLease(record, local, { item: "ohr-s2-arms", run_id: "another-run" });
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
  return [...(await seamLines()), ...splitLines(), ...(o.ledger ? ledgerLines() : [])];
}

export async function run(argv: string[], io: Io): Promise<number> {
  for (const a of argv) if (a !== "--no-ledger") throw Object.assign(new Error("unknown argument " + JSON.stringify(a) + "; usage: gstack-evals ohr dryrun [--no-ledger]"), { code: "E_USAGE" });
  const lines = await dryRun({ ledger: !argv.includes("--no-ledger") });
  for (const l of lines) io.out(l.state + " " + l.name + (l.detail ? " (" + l.detail + ")" : ""));
  const n = (s: Line["state"]) => lines.filter((l) => l.state === s).length;
  io.out("ohr dryrun: " + n("PASS") + " PASS, " + n("FAIL") + " FAIL, " + n("SKIP") + " SKIP");
  if (n("FAIL") + n("SKIP")) io.err("E_OHR_DRYRUN_FAIL ohr dryrun: " + n("FAIL") + " failed and " + n("SKIP") + " skipped; a skipped check is not a pass");
  return n("FAIL") + n("SKIP") ? 1 : 0;
}
