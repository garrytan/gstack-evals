// Copyright (c) 2026 Garry Tan. MIT License.
// Advisory-id containment needles (plan section 3, gate 6, and deviation (a)): a unit's GHSA id, every CVE id of its
// advisory at the pinned advisory database, and the first 12 hex characters of its fix commit, lowercased and matched
// case-insensitively. A CVE id must not run on into another digit, so CVE-2026-1234 never hits CVE-2026-12345; a GHSA id
// has a fixed length, and a fix prefix is meant to hit inside a longer hex string. scanIds reads one tree with
// sh/scan-ids.sh (every file raw, every git object store object by object) and opens archives (gzip, tar, zip, xz,
// bzip2, found by their bytes; the head-to-head's findArchives and extract) two levels deep, listing a third. A scan
// that did not finish fails closed (E_CSO_SCAN). Ids are public, so a hit keeps its needle beside its path.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { ARCHIVE_LEVELS, extract, findArchives } from "../../h2h/arms/contain.ts";
import { csoFail } from "../prereg.ts";

// An unpacked archive can hold a file name that is not UTF-8, which findArchives cannot stat by string. Such a name
// becomes "_x" and its bytes in hex, in the scratch copy only; the bytes scan-ids.sh reads do not change.
function utf8Names(dir: Buffer): void {
  for (const n of readdirSync(dir, { encoding: "buffer" })) {
    let p = Buffer.concat([dir, Buffer.from("/"), n]);
    if (!Buffer.from(n.toString("utf8")).equals(n)) {
      const q = Buffer.concat([dir, Buffer.from("/_x" + n.toString("hex"))]);
      renameSync(p, q);
      p = q;
    }
    if (lstatSync(p).isDirectory()) utf8Names(p);
  }
}

export const SCAN_IDS = readFileSync(join(import.meta.dir, "sh", "scan-ids.sh"), "utf8");
export const FIX_PREFIX_CHARS = 12;

export interface UnitIds { unit: string; ghsa: string; cves: string[]; fix_commit: string }
export type IdKind = "ghsa" | "cve" | "fix_prefix";
export interface IdNeedle { unit: string; kind: IdKind; needle: string }
export interface IdHit extends IdNeedle { where: "file" | "git" | "archive"; path: string }
export interface IdArchive { path: string; level: number; opened: boolean; note?: string }
export interface IdScan { root: string; needles: number; hits: IdHit[]; stores: string[]; archives: IdArchive[] }

/** One unit's needles (E_CSO_UNIT_IDS when an id is malformed, so a bad id never scans as nothing). */
export function unitNeedles(u: UnitIds): IdNeedle[] {
  const ghsa = u.ghsa.toLowerCase();
  if (!/^ghsa(-[23456789cfghjmpqrvwx]{4}){3}$/.test(ghsa)) csoFail("E_CSO_UNIT_IDS", u.unit + ": GHSA id " + JSON.stringify(u.ghsa) + " is malformed");
  const cves = u.cves.map((c) => c.toLowerCase());
  for (const c of cves) if (!/^cve-\d{4}-\d{4,}$/.test(c)) csoFail("E_CSO_UNIT_IDS", u.unit + ": CVE id " + JSON.stringify(c) + " is malformed");
  if (!/^[0-9a-f]{40}$/i.test(u.fix_commit)) csoFail("E_CSO_UNIT_IDS", u.unit + ": fix commit " + JSON.stringify(u.fix_commit) + " is not 40 hex characters");
  return [{ unit: u.unit, kind: "ghsa", needle: ghsa }, ...cves.map((needle) => ({ unit: u.unit, kind: "cve" as const, needle })), { unit: u.unit, kind: "fix_prefix", needle: u.fix_commit.slice(0, FIX_PREFIX_CHARS).toLowerCase() }];
}

/** The scan's extended-regex line for a needle: ids hold only [a-z0-9-], so each is its own literal. */
const pattern = (n: IdNeedle) => (n.kind === "cve" ? n.needle + "([^0-9]|$)" : n.needle);
/** The scan's needle file: one pattern a line, and empty with no needles, so the scan exits at once and never runs grep
 *  with an empty pattern (which matches every line of every file). */
export const needleFile = (ns: readonly IdNeedle[]): string => {
  const lines = [...new Set(ns.map(pattern))];
  return lines.length ? lines.join("\n") + "\n" : "";
};

function scanTree(root: string, ns: IdNeedle[]): { raw: Array<{ where: "file" | "git"; path: string; match: string }>; stores: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "cso-ids-"));
  try {
    writeFileSync(join(dir, "needles"), needleFile(ns));
    const r = spawnSync("bash", ["-c", SCAN_IDS, "bash", root, join(dir, "needles")], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 3_600_000 });
    if (r.status !== 0) csoFail("E_CSO_SCAN", "the id scan of " + root + " exited " + r.status + ": " + (r.stderr ?? "").slice(-300));
    const b64 = (s: string) => Buffer.from(s, "base64").toString("utf8");
    const raw: Array<{ where: "file" | "git"; path: string; match: string }> = [];
    const stores: string[] = [];
    for (const l of r.stdout.split("\n")) {
      const [k, a = "", b = "", c = ""] = l.split(" ");
      if (k === "ERR") csoFail("E_CSO_SCAN", "the id scan of " + root + " did not finish: " + b64(a) + " failed; fail closed");
      if (k === "STORE") stores.push(b64(a));
      if (k === "HIT") raw.push({ where: a as "file" | "git", path: b64(b), match: b64(c).toLowerCase() });
    }
    return { raw, stores };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every needle of units found under root: files, git objects, and archives two levels deep. */
export function scanIds(rootIn: string, units: readonly UnitIds[]): IdScan {
  const root = resolve(rootIn);
  if (!existsSync(root)) csoFail("E_CSO_SCAN", root + " does not exist");
  const ns = units.flatMap(unitNeedles);
  const byNeedle = new Map<string, IdNeedle[]>();
  for (const n of ns) byNeedle.set(n.needle, [...(byNeedle.get(n.needle) ?? []), n]);
  const found: Array<{ where: "file" | "git" | "archive"; path: string; match: string }> = [];
  const archives: IdArchive[] = [];
  const first = scanTree(root, ns);
  found.push(...first.raw);
  const scratch = mkdtempSync(join(tmpdir(), "cso-arch-"));
  try {
    let level: Array<{ dir: string; label: string }> = [{ dir: root, label: "" }];
    for (let depth = 1; depth <= ARCHIVE_LEVELS + 1; depth++) {
      const next: Array<{ dir: string; label: string }> = [];
      for (const { dir, label } of level) {
        for (const a of findArchives(dir)) {
          const path = label + relative(dir, a.path);
          if (depth > ARCHIVE_LEVELS) {
            archives.push({ path, level: depth, opened: false, note: "past the two levels the scan opens" });
            continue;
          }
          const to = join(scratch, String(archives.length));
          const why = extract(a.path, a.format, to);
          archives.push({ path, level: depth, opened: why === null, ...(why ? { note: why } : {}) });
          if (why) continue;
          spawnSync("chmod", ["-R", "u+rwX", to]);
          utf8Names(Buffer.from(to));
          found.push(...scanTree(to, ns).raw.map((h) => ({ where: "archive" as const, path: path + "!" + h.path, match: h.match })));
          next.push({ dir: to, label: path + "!" });
        }
      }
      level = next;
    }
  } finally {
    spawnSync("chmod", ["-R", "u+rwX", scratch]);
    rmSync(scratch, { recursive: true, force: true });
  }
  const seen = new Set<string>();
  const hits: IdHit[] = [];
  for (const f of found) {
    const id = byNeedle.has(f.match) ? f.match : f.match.slice(0, -1);
    for (const n of byNeedle.get(id) ?? []) {
      const key = n.unit + " " + n.needle + " " + f.where + " " + f.path;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ ...n, where: f.where, path: f.path });
    }
  }
  hits.sort((a, b) => (a.unit + a.path + a.needle < b.unit + b.path + b.needle ? -1 : 1));
  return { root, needles: ns.length, hits, stores: first.stores, archives };
}
