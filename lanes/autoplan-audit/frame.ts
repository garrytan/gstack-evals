// Copyright (c) 2026 Garry Tan. MIT License.
// Section 4: the frozen frame. The snapshot's two manifest files, every per-file digest and the run id list must match
// what the preregistration froze; a mismatch, a missing or extra file, or a different id set stops the run with
// E_AR_FRAME_DRIFT. Counts only: nothing here prints record text.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fail } from "./errors.ts";

export interface FrozenFrame {
  records_manifest_sha256: string;
  approvals_manifest_sha256: string;
  ids_sha256: string;
  records: number;
  approvals: number;
  runs: number;
}

export const FRAME: FrozenFrame = {
  records_manifest_sha256: "da75352985ffc8c527abc41c01a65153e2ed3065d1efb951c9ad5a7eee1615cb",
  approvals_manifest_sha256: "edea3b08db4823896beeeb97a7b0c5d39f9cb68d75127806eedf9ed317eec1ce",
  ids_sha256: "f683d85e4cf417ea99ec29aaf5d174db63d66aceb43c03629d895ee32f495ada",
  records: 1280,
  approvals: 198,
  runs: 40,
};

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const go = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) go(p);
      else out.push(relative(root, p));
    }
  };
  go(root);
  return out.sort();
}

function manifest(path: string, columns: number, what: string): string[][] {
  if (!existsSync(path)) fail("E_AR_FRAME_DRIFT", what + " manifest is missing");
  const rows = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0).map((l) => l.split("\t"));
  if (rows.some((r) => r.length !== columns || !/^[0-9a-f]{64}$/.test(r[columns - 1]!))) fail("E_AR_FRAME_DRIFT", what + " manifest has a malformed row");
  return rows;
}

/** The sha256 of the run ids, sorted and joined by newlines with no trailing newline. */
export const idsDigest = (ids: readonly string[]): string => sha256([...ids].sort().join("\n"));

/** Checks the snapshot at dir against the frozen frame; returns the run ids and file counts. */
export function checkFrame(dir: string, frozen: FrozenFrame = FRAME): { ids: string[]; records: number; approvals: number } {
  const recPath = join(dir, "MANIFEST-records.tsv");
  const appPath = join(dir, "MANIFEST-approvals.tsv");
  const recRows = manifest(recPath, 3, "the records");
  const appRows = manifest(appPath, 2, "the approvals");
  if (sha256(readFileSync(recPath)) !== frozen.records_manifest_sha256) fail("E_AR_FRAME_DRIFT", "the records manifest's sha256 differs from the frozen digest");
  if (sha256(readFileSync(appPath)) !== frozen.approvals_manifest_sha256) fail("E_AR_FRAME_DRIFT", "the approvals manifest's sha256 differs from the frozen digest");
  if (recRows.length !== frozen.records || appRows.length !== frozen.approvals) fail("E_AR_FRAME_DRIFT", "the manifests list " + recRows.length + " record and " + appRows.length + " approvals files, not " + frozen.records + " and " + frozen.approvals);
  const ids = [...new Set(recRows.map((r) => r[0]!))].sort();
  if (ids.length !== frozen.runs || idsDigest(ids) !== frozen.ids_sha256) fail("E_AR_FRAME_DRIFT", "the run id set differs from the frozen list (" + ids.length + " ids)");
  const check = (root: string, rows: Array<{ path: string; digest: string }>, what: string) => {
    const want = new Map(rows.map((r) => [r.path, r.digest]));
    if (want.size !== rows.length) fail("E_AR_FRAME_DRIFT", "the " + what + " manifest lists a file twice");
    const have = walk(root);
    const extra = have.filter((p) => !want.has(p)).length;
    const missing = [...want.keys()].filter((p) => !existsSync(join(root, p))).length;
    if (extra || missing) fail("E_AR_FRAME_DRIFT", "the " + what + " directory has " + extra + " extra and " + missing + " missing files");
    let bad = 0;
    for (const [p, d] of want) if (sha256(readFileSync(join(root, p))) !== d) bad++;
    if (bad) fail("E_AR_FRAME_DRIFT", bad + " " + what + " files differ from their manifest digest");
  };
  check(join(dir, "records"), recRows.map((r) => ({ path: r[0] + "/" + r[1], digest: r[2]! })), "records");
  check(join(dir, "approvals"), appRows.map((r) => ({ path: r[0]!, digest: r[1]! })), "approvals");
  return { ids, records: recRows.length, approvals: appRows.length };
}
