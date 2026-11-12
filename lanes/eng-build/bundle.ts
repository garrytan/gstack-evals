// Copyright (c) 2026 Garry Tan. MIT License.
// The review bundle (prereg 2026-11-11-geva-522 section 4): what a build gets from one review session, written as
// /work/review/bundle.md. In a fixed order, each under its file name as a heading: the session's final plan.md, its
// final reply as review.md, then the skill's own written files (the pre-cut and eng phase test plan artifacts in path
// order, the candidate's path-map.md, coverage-map.md and test-plan.md). The whole bundle is capped at
// FROZEN.bundle.maxWords words, and a cut is counted. Edits the review made to repository files are discarded: the build
// starts from the unit's base tree, and the count of changed, added and removed files is recorded.
//
// Build-time choices where the prereg is silent:
// - The final reply is the main agent's last non-empty text block in the final transcript (capped.ts's mainAgentTexts).
// - A heading is "# <name>" on its own line, and the parts are joined by a blank line. Words are runs of non-space
//   characters over the whole bundle, headings included; a cut keeps the first maxWords words and ends with " [cut]".
// - A part that is missing (no plan.md, no reply, no file) is left out with its heading. The candidate's files count when
//   they are regular files in the plan-coverage folder, header or not; the detector, not the bundle, judges them.
// - Repository edits compare every regular file and symlink under repo/ with the base tree, by bytes, outside .git/ and
//   the candidate's own .gstack/plan-coverage/ folder, which holds the skill's files rather than an edit.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testPlanArtifacts } from "../eng-review/exposure.ts";
import { cut } from "../product-value/author/run.ts";
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { fail } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import type { Arm } from "./types.ts";

export const BUNDLE_FILE = "bundle.md";
const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
export const COVERAGE_FILES = ["path-map.md", "coverage-map.md", "test-plan.md"] as const;

export interface BundlePart {
  name: string;
  text: string;
}
export interface Bundle {
  text: string;
  parts: string[];
  /** Words in the bundle the build gets (at most the cap). */
  words: number;
  /** Words before the cap. */
  fullWords: number;
  truncated: boolean;
}

/** What one finished review session left: its final plan.md, final transcript, gstack state root and plan-coverage folder copies. */
export interface ReviewOutputs {
  plan: string | null;
  transcript: string;
  stateRoot: string | null;
  coverage: string | null;
}

const regular = (path: string): string | null => (lstatSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path, "utf8") : null);

/** The bundle's parts in the fixed order, for an arm with a review session. */
export function bundleParts(arm: Exclude<Arm, "none">, o: ReviewOutputs): BundlePart[] {
  const parts: BundlePart[] = [];
  if (o.plan !== null) parts.push({ name: "plan.md", text: o.plan });
  const reply = mainAgentTexts(o.transcript).at(-1);
  if (reply !== undefined) parts.push({ name: "review.md", text: reply });
  if (arm === "precut" || arm === "engphase") for (const rel of testPlanArtifacts(o.stateRoot)) parts.push({ name: rel.split("/").at(-1)!, text: readFileSync(join(o.stateRoot!, rel), "utf8") });
  if (arm === "candidate" && o.coverage) for (const name of COVERAGE_FILES) {
    const text = regular(join(o.coverage, name));
    if (text !== null) parts.push({ name, text });
  }
  return parts;
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The parts under their headings, capped at maxWords words. */
export function assembleBundle(parts: readonly BundlePart[], maxWords: number = FROZEN.bundle.maxWords): Bundle {
  const full = parts.map((p) => "# " + p.name + "\n\n" + p.text.replace(/\s+$/, "") + "\n").join("\n");
  const fullWords = countWords(full);
  const truncated = fullWords > maxWords;
  return { text: truncated ? cut(full, maxWords) + "\n" : full, parts: parts.map((p) => p.name), words: Math.min(fullWords, maxWords), fullWords, truncated };
}

/** Writes the bundle as <reviewDir>/bundle.md, the build's /work/review/. A resume reuses a bundle with the same bytes
 * and refuses one with other bytes. */
export function writeBundle(reviewDir: string, b: Bundle): string {
  mkdirSync(reviewDir, { recursive: true });
  const path = join(reviewDir, BUNDLE_FILE);
  const found = lstatSync(path, { throwIfNoEntry: false }) ? readFileSync(path) : null;
  if (found === null) writeFileSync(path, b.text, { flag: "wx" });
  else if (!found.equals(Buffer.from(b.text))) fail("E_EB_CACHE_STALE", "review bundle " + path + " holds sha256 " + sha256(found) + ", not the assembled " + sha256(b.text) + "; rebuild the bundle from its session, then --resume");
  return path;
}

const SKIP = (rel: string) => rel === ".git" || rel.startsWith(".git/") || rel === ".gstack/plan-coverage" || rel.startsWith(".gstack/plan-coverage/");

function entries(root: string, rel = "", out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(join(root, rel)).sort()) {
    const r = rel ? rel + "/" + name : name;
    if (SKIP(r)) continue;
    const st = lstatSync(join(root, r));
    if (st.isDirectory()) entries(root, r, out);
    else if (st.isSymbolicLink()) out.set(r, "link:" + readlinkSync(join(root, r)));
    else if (st.isFile()) out.set(r, (st.mode & 0o111 ? "x:" : "f:") + sha256(readFileSync(join(root, r))));
  }
  return out;
}

/** Files the review changed, added or removed in its repo/ against the base tree; the build never sees these edits. A
 * repo/ the review removed counts every base file as removed. */
export function repoEdits(baseRepo: string, finalRepo: string): number {
  const a = entries(baseRepo), b = lstatSync(finalRepo, { throwIfNoEntry: false })?.isDirectory() ? entries(finalRepo) : new Map<string, string>();
  let n = 0;
  for (const [k, v] of a) if (b.get(k) !== v) n++;
  for (const k of b.keys()) if (!a.has(k)) n++;
  return n;
}
