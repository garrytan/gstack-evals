// Copyright (c) 2026 Garry Tan. MIT License.
// Containment over an arm's installed home (plan section 3): a pack can install a unit's repository as a dependency
// (gstack's node_modules and Playwright, GSD's runtime), so the state machines needles run over every arm's home for
// every unit. The needles are the state machines eval's own: fix lines (leak.ts needles, the fix's added lines of 30
// code points or more that no base line holds), test-side markers (the same rule over test.patch and fix-tests.patch, as
// contain.ts reads markers) and hidden test names (contain.ts containInputs, leaf names of the fail-to-pass tests that no
// base file holds as a whole word). sh/scan-home.sh reads every file raw and every git object store object by object;
// archives (gzip, tar, zip, xz, bzip2, found by their bytes) are opened two levels deep and scanned the same way, and a
// third level is listed. A hit keeps its path and the needle's sha256, never the text. The frozen idiom rule classifies
// a hit as an idiom when it is a test name of 12 characters or fewer, or when the needle appears in at least 3 unrelated
// repositories of the unit's frame; any other hit is confirmed, and a confirmed hit drops the unit for every arm.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { containInputs } from "../../statemachines/contain.ts";
import { runBash, type Where } from "../../statemachines/history.ts";
import { hitKind, needles, ownNames, type HitKind } from "../../statemachines/leak.ts";
import { readUnit } from "../../statemachines/unit.ts";
import { h2hFail } from "../prereg.ts";
import type { H2hArm } from "../types.ts";
import { homeTreeSha256 } from "./hash.ts";
import { homeArm } from "./layer.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const SCAN_HOME = readFileSync(join(import.meta.dir, "sh", "scan-home.sh"), "utf8");
/** The base tree's files that hold a hidden name as a whole word print it (the names filter, as contain.sh's hidden()). */
export const BASE_NAMES = 'set -u\ncd "$1"\n[ -s "$2/names" ] || exit 0\ngit ls-files -z | xargs -0 -r grep -h -a -o -w -F -f "$2/names" -- 2>/dev/null\nexit 0\n';

/** The frozen idiom rule's two thresholds. */
export const IDIOM = { short_name_max: 12, frame_repos_min: 3 } as const;
/** Archive depth the scan opens; a deeper archive is listed, not opened. */
export const ARCHIVE_LEVELS = 2;

export type Needle = "line" | "marker" | "name";
export type Idiom = "short_name" | "frame_common";
export interface HomeHit { needle: Needle; where: "file" | "git" | "archive"; path: string; needle_sha256: string; kind?: HitKind; package?: string; idiom: Idiom | null; frame_repos?: number }
export interface HomeArchive { path: string; level: number; opened: boolean; note?: string }
export interface HomeContain {
  schema: "h2h-home-contain.v1";
  arm: H2hArm;
  home: H2hArm;
  unit: string;
  home_tree_sha256: string;
  needles: Record<Needle, number>;
  hits: HomeHit[];
  confirmed: number;
  idioms: number;
  stores: string[];
  archives: HomeArchive[];
  ok: boolean;
}

/** One unit of the frame as the idiom rule reads it: its repository and its patches' text. */
export interface FrameUnit { repo: string; text: string }

/** A frame's units for the idiom rule: every unit dir listed in a file (one per line), its repository and the text of its
 *  fix and test patches (fix.patch, test.patch, fix-tests.patch when present). */
export function readFrame(listFile: string): FrameUnit[] {
  const dirs = readFileSync(listFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  return dirs.map((d) => ({ repo: readUnit(d).repo, text: ["fix.patch", "test.patch", "fix-tests.patch"].filter((f) => existsSync(join(d, f))).map((f) => readFileSync(join(d, f), "utf8")).join("\n") }));
}

/** Two repositories are unrelated when their owners differ and their names differ (case-insensitive), so a fork or a
 *  sibling under one owner never counts. */
export function unrelated(a: string, b: string): boolean {
  const [oa, na] = a.toLowerCase().split("/");
  const [ob, nb] = b.toLowerCase().split("/");
  return oa !== ob && na !== nb;
}

/** A patch's content lines (added, removed and context, diff prefix removed, headers left out), trimmed. */
export function patchLines(text: string): string[] {
  return text.split("\n").filter((l) => /^[+\- ]/.test(l) && !l.startsWith("+++ ") && !l.startsWith("--- ")).map((l) => l.slice(1).trim()).filter(Boolean);
}

/** How many repositories of the frame, unrelated to repo, hold the needle: a line or marker as a trimmed patch line, a
 *  name as a whole word of a patch line. */
export function frameRepos(needle: Needle, text: string, repo: string, frame: readonly FrameUnit[]): number {
  const t = text.trim();
  const word = new RegExp("(^|[^\\w$])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\w$])");
  const holders = new Set<string>();
  for (const u of frame) {
    if (!unrelated(u.repo, repo) || holders.has(u.repo.toLowerCase())) continue;
    const lines = patchLines(u.text);
    if (needle === "name" ? lines.some((l) => word.test(l)) : lines.includes(t)) holders.add(u.repo.toLowerCase());
  }
  return holders.size;
}

/** The frozen idiom rule for one hit's needle text. */
export function idiomOf(needle: Needle, text: string, repo: string, frame: readonly FrameUnit[]): { idiom: Idiom | null; frame_repos: number } {
  if (needle === "name" && Array.from(text).length <= IDIOM.short_name_max) return { idiom: "short_name", frame_repos: frameRepos(needle, text, repo, frame) };
  const n = frameRepos(needle, text, repo, frame);
  return { idiom: n >= IDIOM.frame_repos_min ? "frame_common" : null, frame_repos: n };
}

/** The unit's three needle sets, filtered against its base tree (where: the stripped one-commit tree, on the host or in
 *  its tree volume). */
export function homeNeedles(unitDir: string, where: Where): Record<Needle, string[]> {
  const patch = (n: string) => (existsSync(join(unitDir, n)) ? readFileSync(join(unitDir, n), "utf8") : "");
  const { names } = containInputs(unitDir);
  const inBase = new Set(names.length ? runBash(where, BASE_NAMES, { names: names.join("\n") + "\n" }).stdout.split("\n") : []);
  return { line: needles(where, patch("fix.patch")), marker: needles(where, patch("test.patch") + "\n" + patch("fix-tests.patch")), name: names.filter((n) => !inBase.has(n)) };
}

const MAGIC: Array<[string, (b: Buffer) => boolean]> = [
  ["gzip", (b) => b[0] === 0x1f && b[1] === 0x8b],
  ["zip", (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))],
  ["xz", (b) => b.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))],
  ["bzip2", (b) => b.subarray(0, 3).toString("latin1") === "BZh"],
  ["tar", (b) => b.subarray(257, 262).toString("latin1") === "ustar"],
];

/** Every archive under root, found by its leading bytes, with its format. */
export function findArchives(root: string): Array<{ path: string; format: string }> {
  const out: Array<{ path: string; format: string }> = [];
  const head = Buffer.alloc(512);
  const walk = (abs: string) => {
    for (const n of readdirSync(abs)) {
      const p = join(abs, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.size >= 4) {
        const fd = openSync(p, "r");
        const got = readSync(fd, head, 0, 512, 0);
        closeSync(fd);
        const b = head.subarray(0, got);
        const m = MAGIC.find(([, test]) => test(b));
        if (m) out.push({ path: p, format: m[0] });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Extracts one archive into to; returns null or why it could not be opened. */
export function extract(path: string, format: string, to: string): string | null {
  mkdirSync(to, { recursive: true });
  const r = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  if (format === "zip") {
    const z = r("unzip", ["-qq", "-o", path, "-d", to]);
    return z.status === 0 || z.status === 1 ? null : "unzip exited " + z.status;
  }
  const t = r("tar", ["--no-same-owner", "--no-same-permissions", "-xf", path, "-C", to]);
  if (t.status === 0) return null;
  if (format === "tar") return "tar exited " + t.status;
  const tool = format === "gzip" ? "gzip" : format === "xz" ? "xz" : "bzip2";
  const d = spawnSync(tool, ["-dc", path], { maxBuffer: 1024 * 1024 * 1024, timeout: 600_000 });
  if (d.status !== 0) return tool + " exited " + d.status;
  writeFileSync(join(to, "content"), d.stdout);
  return null;
}

interface RawHit { needle: Needle; where: "file" | "git"; path: string; text: string }

/** Runs sh/scan-home.sh over root and reads its lines; an ERR line refuses (E_H2H_HOME_SCAN). */
function scanTree(root: string, ns: Record<Needle, string[]>): { hits: RawHit[]; stores: string[] } {
  const inDir = mkdtempSync(join(tmpdir(), "h2h-scan-"));
  try {
    const body = (a: string[]) => (a.length ? a.join("\n") + "\n" : "");
    writeFileSync(join(inDir, "names"), body(ns.name));
    writeFileSync(join(inDir, "markers"), body(ns.marker));
    writeFileSync(join(inDir, "lines"), body(ns.line));
    const r = spawnSync("bash", ["-c", SCAN_HOME, "bash", root, inDir], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 3_600_000 });
    if (r.status !== 0) h2hFail("E_H2H_HOME_SCAN", "the home scan of " + root + " exited " + r.status + ": " + (r.stderr ?? "").slice(-300));
    const b64 = (s: string) => Buffer.from(s, "base64").toString("utf8");
    const hits: RawHit[] = [];
    const stores: string[] = [];
    for (const l of r.stdout.split("\n")) {
      const [k, a = "", b = "", c = "", d = ""] = l.split(" ");
      if (k === "ERR") h2hFail("E_H2H_HOME_SCAN", "the home scan of " + root + " did not finish: " + b64(a) + " failed; the unit drops for every arm, fail closed");
      if (k === "STORE") stores.push(b64(a));
      if (k === "HIT") hits.push({ needle: a as Needle, where: b as "file" | "git", path: b64(c), text: b64(d) });
    }
    return { hits, stores };
  } finally {
    rmSync(inDir, { recursive: true, force: true });
  }
}

/** The containment record for one arm's home and one unit. where: the unit's base tree. frame: the frame's units for the
 *  idiom rule (none given: only the short-name rule can classify). */
export function containHome(o: { arm: H2hArm; home: string; unitDir: string; where: Where; frame?: readonly FrameUnit[] }): HomeContain {
  const home = resolve(o.home);
  if (!existsSync(home)) h2hFail("E_H2H_HOME_SCAN", home + " does not exist");
  const u = readUnit(o.unitDir);
  const ns = homeNeedles(o.unitDir, o.where);
  const own = ownNames(o.where, u.repo);
  const frame = o.frame ?? [];
  const raw: Array<RawHit & { archive?: string }> = [];
  const archives: HomeArchive[] = [];
  const first = scanTree(home, ns);
  raw.push(...first.hits);
  const stores = first.stores;
  const scratch = mkdtempSync(join(tmpdir(), "h2h-arch-"));
  try {
    let level: Array<{ dir: string; label: string }> = [{ dir: home, label: "" }];
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
          const s = scanTree(to, ns);
          raw.push(...s.hits.map((h) => ({ ...h, archive: path, path: path + "!" + h.path })));
          next.push({ dir: to, label: path + "!" });
        }
      }
      level = next;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const seen = new Set<string>();
  const hits: HomeHit[] = [];
  for (const h of raw) {
    const key = h.needle + " " + h.path + " " + sha(h.text);
    if (seen.has(key)) continue;
    seen.add(key);
    const k = hitKind("/" + h.path, own);
    hits.push({ needle: h.needle, where: h.archive ? "archive" : h.where, path: h.path, needle_sha256: sha(h.text), kind: k.kind, ...(k.package ? { package: k.package } : {}), ...idiomOf(h.needle, h.text, u.repo, frame) });
  }
  hits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.needle_sha256 < b.needle_sha256 ? -1 : 1));
  const confirmed = hits.filter((h) => h.idiom === null).length;
  return { schema: "h2h-home-contain.v1", arm: o.arm, home: homeArm(o.arm), unit: u.id, home_tree_sha256: homeTreeSha256(home), needles: { line: ns.line.length, marker: ns.marker.length, name: ns.name.length }, hits, confirmed, idioms: hits.length - confirmed, stores, archives, ok: confirmed === 0 };
}

/** Refuses (E_H2H_HOME_LEAK) a record with a confirmed hit, naming the arm, each path and needle sha256, never text. The
 *  unit drops for every arm. */
export function assertHomeContained(r: HomeContain): void {
  if (r.ok) return;
  const c = r.hits.filter((h) => h.idiom === null);
  h2hFail("E_H2H_HOME_LEAK", r.unit + ": " + c.length + " confirmed hit(s) in the " + r.home + " home (arm " + r.arm + "): " + c.slice(0, 5).map((h) => h.needle + " " + h.path + " sha256 " + h.needle_sha256).join("; ") + (c.length > 5 ? "; ..." : "") + "; the unit drops for every arm");
}
