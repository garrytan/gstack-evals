// Copyright (c) 2026 Garry Tan. MIT License.
// Section 4's leak scan, exactly: the needles are the lines the fix adds that are 30 characters or more (code points, after
// removing the line's newline only, no trimming) and appear as a line in no file of the base commit's tree. The scan reads
// the whole filesystem except /proc and /sys, binary files included, for any needle as a whole line. A hit logs the
// needle's sha256 and the path, never the line. No directory is excluded, because section 4 states no exclusion.
import { createHash } from "node:crypto";
import { added30 } from "./unit.ts";
import { runBash, sh, type Where } from "./history.ts";
import { smFail } from "./unit.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const BASE_LINES_SCRIPT = sh("baselines.sh");

/** $3 is the scan root: "/" in a container, a fixture dir in tests. Every entry of it but proc, sys and sm-in is read. */
export const SCAN_SCRIPT = sh("scan.sh");

/** The needles: added lines of 30 code points or more that are no line of any base file. */
export function needles(where: Where, fixPatch: string): string[] {
  const cand = [...new Set(added30(fixPatch))];
  if (!cand.length) return [];
  const r = runBash(where, BASE_LINES_SCRIPT, { cand: cand.join("\n") + "\n" });
  const inBase = new Set(r.stdout.split("\n"));
  return cand.filter((l) => !inBase.has(l));
}

export interface LeakResult { needles: number; hits: { path: string; needle_sha256: string }[]; scan_exit: string }

/** Scans root for the needles. Lines never leave this function; only their sha256 does. */
export function scan(where: Where, ns: string[], root = "/"): LeakResult {
  if (!ns.length) return { needles: 0, hits: [], scan_exit: "no needles" };
  const r = runBash(where, SCAN_SCRIPT, { needles: ns.join("\n") + "\n" }, [root]);
  const hits = new Map<string, { path: string; needle_sha256: string }>();
  for (const rec of r.stdout.split("\n")) {
    const i = rec.indexOf("\0");
    if (i < 0) continue;
    const h = { path: rec.slice(0, i), needle_sha256: sha(rec.slice(i + 1)) };
    hits.set(h.path + " " + h.needle_sha256, h);
  }
  return { needles: ns.length, hits: [...hits.values()].sort((a, b) => (a.path < b.path ? -1 : 1)), scan_exit: (r.stderr.match(/SCANEXIT (\d+)/) ?? [])[1] ?? "none" };
}

/** Needles from the stripped one-commit tree, then the scan; any hit refuses with E_SM_LEAKED. */
export function leakCheck(where: Where, fixPatch: string, label: string, root = "/"): LeakResult {
  const res = scan(where, needles(where, fixPatch), root);
  if (res.scan_exit === "none" || Number(res.scan_exit) > 1 && !res.hits.length) smFail("E_SM_LEAKED", label + ": the leak scan did not finish (grep exit " + res.scan_exit + "); the unit drops, fail closed");
  if (res.hits.length) smFail("E_SM_LEAKED", label + ": " + res.hits.length + " fix line(s) found: " + res.hits.map((h) => h.path + " needle sha256 " + h.needle_sha256).join("; "));
  return res;
}
