// Copyright (c) 2026 Garry Tan. MIT License.
// ep pin (prereg 2026-11-15-geva-537 sections 1 and 6): reads a gstack checkout at a commit and prints what frozen.ts's
// RESTORE_PIN records, and what changed since b6155921a, the commit the intentions inventory was compared with.
//
// - Files: the commit and its VERSION, then the sha256 of every file the arms and detectors read: the files each detector
//   reads strings from (exposure.ts ER_DETECTOR_FILES), the standalone skill's shared preamble (plan-eng-review/SKILL.md
//   tells the session to Read sections/preamble.md first), and every source the eng phase methodology is built from
//   (render.ts run keylessly at the checkout on a one-line plan). Each line says whether RESTORE_PIN records the file at
//   that digest ("pinned"), at another one ("differs"), or not at all ("extra": the parent adds it).
// - Changes against b6155921a: every file under plan-eng-review/, autoplan/sections/eng-phase.md and unattended.md and
//   bin/gstack-autoplan-snapshot.ts by blob, and autoplan/SKILL.md by the parts the eng phase arm carries: its Phase 3
//   section, the Step 3 loader, and the three sections render.ts quotes.
// - The detector strings (exposure.ts ER_DETECTOR_STRINGS) on the checkout, both arms.
// It exits 0 when the checkout matches RESTORE_PIN and every detector string holds, else 2.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectorStringProblems, ER_DETECTOR_FILES } from "../../eng-review/exposure.ts";
import { renderEngPhase, section, skipList } from "../../eng-review/render.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { fail } from "../errors.ts";
import { RESTORE_PIN } from "../frozen.ts";
import type { Command } from "../types.ts";

/** The commit the intentions inventory was compared with (prereg section 1). */
export const INVENTORY_BASE = "b6155921a564ba9ec2470fd2cb3894c05e2c2d13";
/** Files an arm reads beyond the detectors' own: the standalone skill's shared preamble. */
export const EXTRA_READS = ["plan-eng-review/sections/preamble.md"] as const;
/** The Phase 3 files compared whole. */
export const PHASE3_FILES = ["autoplan/sections/eng-phase.md", "autoplan/sections/unattended.md", "bin/gstack-autoplan-snapshot.ts"] as const;
/** The autoplan/SKILL.md parts the eng phase arm carries or follows, by heading (a trailing ":" heading matches by prefix). */
export const AUTOPLAN_PARTS = ["## Phase 3:", "### Step 3: Locate review skills; load each at phase entry", "## The 6 Decision Principles", "## Decision Classification", '## What "Auto-Decide" Means'] as const;

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const git = (dir: string, args: string[]) => spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", LANG: "C" } });
const show = (dir: string, at: string, path: string): string | null => {
  const r = git(dir, ["show", at + ":" + path]);
  return r.status === 0 ? r.stdout : null;
};
const blob = (dir: string, at: string, path: string): Buffer | null => {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "-C", dir, "show", at + ":" + path], { maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1" } });
  return r.status === 0 ? r.stdout : null;
};

/** One heading's section of autoplan/SKILL.md, or null when it is not there exactly once. */
export function autoplanPart(md: string, heading: string): string | null {
  const full = heading.endsWith(":") ? md.split("\n").filter((l) => l.startsWith(heading + " ")) : [heading];
  if (full.length !== 1) return null;
  try {
    const s = section(md, full[0]!);
    return heading.startsWith("### Step 3") ? s + "\n" + skipList(md) : s;
  } catch {
    return null;
  }
}

export interface PinReport {
  sha: string;
  version: string;
  files: Array<{ path: string; sha256: string | null; state: "pinned" | "differs" | "extra" | "missing" }>;
  methodology: string[];
  changed: string[];
  strings: string[];
  /** Why the checkout is not RESTORE_PIN, one line each; empty when it is. */
  problems: string[];
}

/** Reads a checkout at its HEAD. pin defaults to RESTORE_PIN; base to b6155921a. */
export function pinReport(gstack: string, pin: { sha: string; version: string; digests: Readonly<Record<string, string>> } = RESTORE_PIN, base: string = INVENTORY_BASE): PinReport {
  const head = git(gstack, ["rev-parse", "HEAD"]);
  if (head.status !== 0) return fail("E_USAGE", gstack + " is not a git checkout (" + head.stderr.trim() + ")");
  const sha = head.stdout.trim();
  const dirty = git(gstack, ["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  if (dirty) return fail("E_USAGE", gstack + " has local changes, so its files are not the commit's: " + dirty.split("\n").slice(0, 3).join("; "));
  if (git(gstack, ["cat-file", "-e", base + "^{commit}"]).status !== 0) return fail("E_USAGE", gstack + " does not hold " + base + "; fetch gstack's history (a shallow clone cannot diff against it)");
  const version = (show(gstack, "HEAD", "VERSION") ?? "").trim();
  const scratch = mkdtempSync(join(tmpdir(), "ep-pin-"));
  let methodology: string[] = [];
  try {
    const r = renderEngPhase({ gstack, plan: "# Plan\n\nImplement the stubbed functions.\n", out: join(scratch, "out"), pin: { repo: "garrytan/gstack", sha, version } });
    const mj = JSON.parse(readFileSync(r.files.find((f) => f.name === "methodology.json")!.host, "utf8")) as { sources: Array<{ path: string }> };
    methodology = mj.sources.map((s) => s.path.replace(/^~\/\.claude\/skills\/gstack\//, ""));
  } finally {
    removeTree(scratch);
  }
  const paths = [...new Set([...Object.keys(pin.digests), ...Object.values(ER_DETECTOR_FILES).flat(), ...EXTRA_READS, ...methodology])].sort();
  const files = paths.map((path) => {
    const body = blob(gstack, "HEAD", path);
    const got = body === null ? null : sha256(body);
    const want = pin.digests[path];
    const state = got === null ? ("missing" as const) : want === undefined ? ("extra" as const) : want === got ? ("pinned" as const) : ("differs" as const);
    return { path, sha256: got, state };
  });
  const changed: string[] = [];
  const names = git(gstack, ["diff", "--name-only", base, "HEAD", "--", "plan-eng-review/", ...PHASE3_FILES]).stdout.split("\n").filter(Boolean);
  changed.push(...names);
  const before = show(gstack, base, "autoplan/SKILL.md") ?? "";
  const after = show(gstack, "HEAD", "autoplan/SKILL.md") ?? "";
  for (const h of AUTOPLAN_PARTS) {
    const a = autoplanPart(before, h);
    const b = autoplanPart(after, h);
    if (a === null || b === null || a !== b) changed.push("autoplan/SKILL.md " + JSON.stringify(h) + (b === null ? " (missing or not unique)" : ""));
  }
  const strings = detectorStringProblems((p) => show(gstack, "HEAD", p));
  const problems = [
    ...(sha !== pin.sha ? ["the checkout is at " + sha + ", not RESTORE_PIN " + (pin.sha || "(empty)")] : []),
    ...(version !== pin.version ? ["VERSION reads " + version + ", not RESTORE_PIN's " + (pin.version || "(empty)")] : []),
    ...files.filter((f) => f.state === "differs" || f.state === "missing").map((f) => f.path + " is " + f.state + " against RESTORE_PIN"),
    ...files.filter((f) => f.state === "extra").map((f) => f.path + " is read by an arm but RESTORE_PIN records no digest for it"),
    ...strings,
  ];
  return { sha, version, files, methodology, changed, strings, problems };
}

export const PIN_COMMAND: Command = {
  bools: [],
  usage: "--gstack <checkout at a commit>",
  summary: "print a gstack commit's VERSION and file digests for RESTORE_PIN, and what changed since b6155921a",
  run: (a, io) => {
    const gstack = a.flags.get("--gstack") ?? fail("E_USAGE", "ep pin needs --gstack <checkout>");
    const r = pinReport(gstack);
    io.out("gstack " + r.sha + " VERSION " + r.version);
    io.out("digests (paste into RESTORE_PIN.digests):");
    for (const f of r.files) io.out('  "' + f.path + '": "' + (f.sha256 ?? "missing") + '",  // ' + f.state);
    io.out("eng phase methodology sources: " + r.methodology.join(", "));
    io.out("changed against " + INVENTORY_BASE.slice(0, 9) + ": " + (r.changed.length ? r.changed.join("; ") : "none"));
    io.out("detector strings: " + (r.strings.length ? r.strings.length + " missing" : "all present in both arms' files"));
    for (const p of r.problems) io.err("E_USAGE ep pin: " + p);
    return r.problems.length ? 2 : 0;
  },
};
