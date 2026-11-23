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

export type HitKind = "own_package" | "other_package" | "not_cache";
export interface LeakHit { path: string; needle_sha256: string; kind?: HitKind; package?: string }
export interface LeakResult { needles: number; hits: LeakHit[]; scan_exit: string; kinds?: Record<HitKind, number> }

/** Dependency caches, frozen: each pattern's group 1 is the package the cached file belongs to. */
const CACHES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\/cargo\/registry\/src\/[^/]+\/([^/]+?)-\d+\.\d+\.\d+[^/]*\//, (m) => m[1]!],
  [/\/cargo\/git\/checkouts\/([^/]+?)-[0-9a-f]{6,}\//, (m) => m[1]!],
  [/\/rustup\/toolchains\/[^/]+\/lib\/rustlib\/src\/rust\/library\/([^/]+)\//, (m) => "rust-std:" + m[1]!],
  [/\/pkg\/mod\/(.+?)@[^/]+\//, (m) => m[1]!.replace(/!([a-z])/g, (_, c: string) => c.toUpperCase())],
  [/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//, (m) => m[1]!],
  [/\/\.m2\/repository\/(.+)\/([^/]+)\/[^/]+\/[^/]+$/, (m) => m[1]!.replace(/\//g, ".") + ":" + m[2]!],
  [/\/\.gradle\/caches\/modules-2\/files-2\.1\/([^/]+)\/([^/]+)\//, (m) => m[1]! + ":" + m[2]!],
  [/\/\.nuget\/packages\/([^/]+)\//, (m) => m[1]!],
];

/** A hit's kind (section 4's split): a dependency cache file of a package the repository publishes (same crate, module or
 *  package name; for Maven the artifactId, for Go the module path or its last segment), another package's cache file, or
 *  not a dependency cache at all. The match is case-insensitive. */
export function hitKind(path: string, own: readonly string[]): { kind: HitKind; package?: string } {
  for (const [re, name] of CACHES) {
    const m = path.match(re);
    if (!m) continue;
    const pkg = name(m);
    const keys = new Set([pkg, pkg.split(":").pop()!, pkg.split("/").pop()!].map((x) => x.toLowerCase()));
    return { kind: own.some((o) => keys.has(o.toLowerCase())) ? "own_package" : "other_package", package: pkg };
  }
  return { kind: "not_cache" };
}

export const OWNED_SCRIPT = sh("owned.sh");

/** The names the repository publishes: its own repository name and every manifest name owned.sh finds in the tree. */
export function ownNames(where: Where, repo: string): string[] {
  const r = runBash(where, OWNED_SCRIPT);
  return [...new Set([repo.split("/").pop()!, "github.com/" + repo, ...r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)])].sort();
}

/** Each hit with its kind, and the counts by kind. */
export function classifyHits(res: LeakResult, own: readonly string[]): LeakResult {
  const hits = res.hits.map((h) => ({ ...h, ...hitKind(h.path, own) }));
  const kinds: Record<HitKind, number> = { own_package: 0, other_package: 0, not_cache: 0 };
  for (const h of hits) kinds[h.kind]++;
  return { ...res, hits, kinds };
}

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
export function leakCheck(where: Where, fixPatch: string, label: string, root = "/", own: readonly string[] = []): LeakResult {
  const res = classifyHits(scan(where, needles(where, fixPatch), root), own);
  if (res.scan_exit === "none" || Number(res.scan_exit) > 1 && !res.hits.length) smFail("E_SM_LEAKED", label + ": the leak scan did not finish (grep exit " + res.scan_exit + "); the unit drops, fail closed");
  if (res.hits.length) smFail("E_SM_LEAKED", label + ": " + res.hits.length + " fix line(s) found: " + res.hits.map((h) => h.path + " needle sha256 " + h.needle_sha256 + " (" + h.kind + (h.package ? " " + h.package : "") + ")").join("; "));
  return res;
}
