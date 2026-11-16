// Copyright (c) 2026 Garry Tan. MIT License.
// Two planted-unit checks (plan section 2). The body check: removed body lines are needles wherever they appear, so the
// lines a stub took out (whitespace-normalized, 20 or more characters) are searched in B's tree, in a unit or session
// image, and in any source map's sourcesContent; a unit drops when a run of 3 of them, laid out as in the body, or more
// than 10% of them appear outside the stubbed region. The one-commit check: a unit bundle, unit image or session image
// whose repository holds more than one commit could carry P's real bodies, so it refuses with E_EP_TESTBED_HISTORY.
// Both print counts only.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker, dockerRun } from "../../real-outcome/task/docker.ts";
import { fail } from "../errors.ts";
import { FROZEN } from "../frozen.ts";

export const normalize = (line: string): string => line.replace(/\s+/g, " ").trim();

export interface Needle {
  /** Normalized text, and the raw trimmed line it came from. */
  text: string;
  raw: string;
  /** The line's index in its removed body, so a run keeps the body's layout. */
  at: number;
}

/** The needles of the removed body lines of every stubbed file. */
export function needlesOf(removed: { file: string; lines: string[] }[]): Needle[][] {
  return removed.map((r) => r.lines.map((raw, at) => ({ text: normalize(raw), raw: raw.trim(), at })).filter((n) => n.text.length >= FROZEN.bodyCheck.minChars));
}

/** Where needles were found: per file, needle index to line numbers. */
type Hits = Map<string, Map<number, Set<number>>>;

export interface BodyResult {
  needles: number;
  found: number;
  run: boolean;
  passes: boolean;
}

/** The rule over hits for one stubbed file's needles: a run of runLines needles found on lines spaced as in the body (or
 * all on one line, as in a source map or minified file). Lines found apart from such a run are counted, never dropped. */
export function judge(needles: Needle[], hits: Hits): BodyResult {
  const k = FROZEN.bodyCheck.runLines;
  const found = new Set<number>();
  let run = false;
  for (const byNeedle of hits.values()) {
    for (const i of byNeedle.keys()) found.add(i);
    for (let j = 0; j + k - 1 < needles.length && !run; j++) {
      for (const start of byNeedle.get(j) ?? []) {
        const at = (m: number) => byNeedle.get(j + m) ?? new Set<number>();
        const spaced = Array.from({ length: k }, (_, m) => m).every((m) => at(m).has(start + needles[j + m].at - needles[j].at));
        const oneLine = Array.from({ length: k }, (_, m) => m).every((m) => at(m).has(start));
        if (spaced || oneLine) run = true;
      }
    }
  }
  return { needles: needles.length, found: found.size, run, passes: !run };
}

const add = (hits: Hits, file: string, i: number, line: number) => {
  const f = hits.get(file) ?? hits.set(file, new Map()).get(file)!;
  (f.get(i) ?? f.set(i, new Set()).get(i)!).add(line);
};

/** Scans texts (path and content) for needles. A source map is scanned in its sourcesContent, line by line. */
export function scanTexts(needles: Needle[], texts: Iterable<{ path: string; text: string }>): Hits {
  const hits: Hits = new Map();
  const scan = (label: string, text: string) =>
    text.split("\n").forEach((line, n) => {
      const l = normalize(line);
      if (l.length >= FROZEN.bodyCheck.minChars) needles.forEach((nd, i) => l.includes(nd.text) && add(hits, label, i, n));
    });
  for (const t of texts) {
    if (t.path.endsWith(".map")) {
      try {
        const map = JSON.parse(t.text);
        (Array.isArray(map.sourcesContent) ? map.sourcesContent : []).forEach((s: unknown, i: number) => typeof s === "string" && scan(t.path + "#" + i, s));
      } catch {}
      continue;
    }
    scan(t.path, t.text);
  }
  return hits;
}

/** Every text file of a tree in a repository, up to 2 MB each. */
export function treeTexts(repo: string, rev: string): { path: string; text: string }[] {
  const ls = spawnSync("git", ["ls-tree", "-r", "-l", "-z", rev], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 30 });
  const out: { path: string; text: string }[] = [];
  for (const entry of (ls.stdout ?? "").split("\0").filter(Boolean)) {
    const [meta, path] = [entry.slice(0, entry.indexOf("\t")), entry.slice(entry.indexOf("\t") + 1)];
    const [, type, oid, size] = meta.split(/\s+/);
    if (type !== "blob" || Number(size) > 2 << 20) continue;
    const text = spawnSync("git", ["cat-file", "blob", oid], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 30 }).stdout ?? "";
    if (!text.includes("\0")) out.push({ path, text });
  }
  return out;
}

/** Scans an image by id: every text file outside /proc, /sys and /dev, for each needle's raw line and its JSON-escaped
 * form (a source map's sourcesContent). */
export function scanImage(image: string, needles: Needle[]): Hits {
  const hits: Hits = new Map();
  if (needles.length === 0) return hits;
  const patterns = new Map<string, number[]>();
  needles.forEach((n, i) => {
    for (const p of [n.raw, JSON.stringify(n.raw).slice(1, -1)]) patterns.set(p, [...(patterns.get(p) ?? []), i]);
  });
  const dir = mkdtempSync(join(tmpdir(), "ep-body-"));
  try {
    writeFileSync(join(dir, "patterns.txt"), [...patterns.keys()].join("\n") + "\n");
    const r = dockerRun("ep-body-" + randomBytes(6).toString("hex"), ["--rm", "--network", "none", "--user", "0:0", "--entrypoint", "sh", "-v", dir + ":/ep:ro", image, "-c", "grep -rInoF -f /ep/patterns.txt / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev --exclude-dir=ep 2>/dev/null; true"], { timeoutMs: 1800000 });
    if (r.status !== 0) fail("E_EP_NOT_BUILT", "the body check's image scan did not finish (docker exited " + r.status + ")");
    for (const line of r.stdout.split("\n")) {
      const m = /^(.*?):(\d+):(.*)$/.exec(line);
      if (!m) continue;
      for (const i of patterns.get(m[3]) ?? []) add(hits, m[1], i, Number(m[2]));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return hits;
}

/** Commit objects in a git directory, reachable or not. */
export function commitCount(gitDir: string): number {
  const r = spawnSync("git", ["--git-dir", gitDir, "cat-file", "--batch-all-objects", "--batch-check=%(objecttype)"], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) return -1;
  return r.stdout.split("\n").filter((l) => l === "commit").length;
}

/** Refuses a unit bundle with more than one commit. */
export function bundleHistory(unit: string, bundle: string): void {
  const dir = mkdtempSync(join(tmpdir(), "ep-history-"));
  try {
    const g = join(dir, "b.git");
    const r = spawnSync("sh", ["-c", 'git init -q --bare "$1" && git --git-dir "$1" fetch -q "$2" "+refs/*:refs/*"', "sh", g, bundle], { encoding: "utf8" });
    const n = r.status === 0 ? commitCount(g) : -1;
    if (n !== 1) fail("E_EP_TESTBED_HISTORY", unit + ": the unit bundle holds " + (n < 0 ? "no readable" : n) + " commits; it must hold exactly 1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Refuses an image whose repository (/testbed for a unit image, /work/repo for a session image) holds more than one
 * commit. The .git directory is copied out of a created container and counted on the host. */
export function imageHistory(unit: string, image: string, repoDir = "/testbed"): void {
  const dir = mkdtempSync(join(tmpdir(), "ep-history-"));
  const name = "ep-history-" + randomBytes(6).toString("hex");
  try {
    const created = docker(["create", "--name", name, image, "true"]);
    if (created.status !== 0) fail("E_EP_TESTBED_HISTORY", unit + ": the image could not be read for its history");
    const cp = docker(["cp", name + ":" + repoDir + "/.git", join(dir, "git")]);
    const n = cp.status === 0 ? commitCount(join(dir, "git")) : -1;
    if (n !== 1) fail("E_EP_TESTBED_HISTORY", unit + ": " + repoDir + "/.git in the image holds " + (n < 0 ? "no readable" : n) + " commits; it must hold exactly 1");
  } finally {
    docker(["rm", "-f", name]);
    rmSync(dir, { recursive: true, force: true });
  }
}
