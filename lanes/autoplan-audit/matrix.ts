// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.2's versioned required-output matrix. Each gstack_version in the frame resolves to its release commit in one
// full gstack clone (the first commit on the pin's history whose VERSION file reads that version); that release's
// autoplan/SKILL.md Pre-Gate Verification table gives the phase's cells, each found by its identifying phrase. The
// pinned table (autoplan/SKILL.md lines 596-605 at b6155921) must give exactly the frozen cells before any scoring, else
// E_AR_FRAME_DRIFT. The CEO section list for the per-section cell comes from the same release's plan-ceo-review text.
// No gstack text is copied here beyond short identifying phrases.
import { spawnSync } from "node:child_process";
import { fail } from "./errors.ts";
import type { Phase } from "./records.ts";

export const PIN = "b6155921a564ba9ec2470fd2cb3894c05e2c2d13";
export const PIN_LINES: readonly [number, number] = [596, 605];

/** The frozen cells (section 5.2's table), in order, and the phrase that names each one in a release's table row. */
export const CELLS: Readonly<Record<Phase, ReadonlyArray<readonly [string, RegExp]>>> = {
  ceo: [
    ["premise", /premise/i],
    ["sections", /per applicable section|examination/i],
    ["error_rescue", /error (&|and) rescue/i],
    ["failure_modes", /failure modes/i],
    ["not_in_scope", /not in scope/i],
    ["already_exists", /already exists/i],
    ["dream", /dream state/i],
    ["completion", /completion summary/i],
    ["consensus", /consensus/i],
  ],
  design: [
    ["scores", /dimensions/i],
    ["issues", /issues/i],
    ["litmus", /litmus/i],
  ],
  dx: [
    ["scores", /dimensions/i],
    ["journey", /journey/i],
    ["empathy", /empathy/i],
    ["tthw", /tthw|time to hello/i],
    ["checklist", /implementation checklist/i],
    ["consensus", /consensus/i],
  ],
  eng: [
    ["scope", /scope challenge/i],
    ["architecture", /architecture/i],
    ["test_diagram", /codepath|test diagram/i],
    ["test_plan", /test plan/i],
    ["not_in_scope", /not in scope/i],
    ["already_exists", /already exists/i],
    ["failure_modes", /failure modes/i],
    ["completion", /completion summary/i],
    ["consensus", /consensus/i],
  ],
};

export interface Release {
  version: string;
  commit: string;
  cells: Record<Phase, string[]>;
  dims: { design: number; dx: number };
  /** CEO review sections at this release: the name a finding must carry, and whether it applies only with UI scope. */
  ceoSections: Array<{ name: string; ui: boolean }>;
}

const git = (repo: string, args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

export function preGateRows(skill: string): Map<Phase, string> | null {
  const at = skill.search(/^## Pre-Gate Verification\s*$/m);
  if (at < 0) return null;
  const section = skill.slice(at).split(/\n## /)[0]!;
  const rows = new Map<Phase, string>();
  for (const line of section.split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!m) continue;
    const head = m[1]!.toLowerCase();
    const phase: Phase | null = head.startsWith("ceo") ? "ceo" : head.startsWith("design") ? "design" : head.startsWith("dx") ? "dx" : head.startsWith("eng") ? "eng" : null;
    if (phase) rows.set(phase, m[2]!);
  }
  return rows.size ? rows : null;
}

export function cellsOf(rows: Map<Phase, string>): { cells: Record<Phase, string[]>; dims: { design: number; dx: number } } {
  const cells = { ceo: [], design: [], dx: [], eng: [] } as Record<Phase, string[]>;
  for (const [phase, text] of rows) cells[phase] = CELLS[phase].filter(([, re]) => re.test(text)).map(([id]) => id);
  const dim = (p: Phase, d: number) => Number(/(\d+)\s+dimensions/i.exec(rows.get(p) ?? "")?.[1] ?? d);
  return { cells, dims: { design: dim("design", 7), dx: dim("dx", 8) } };
}

/** Checks the pinned table against the frozen cells; the gstack clone must hold the pin with its history. */
export function checkPinned(repo: string, pin = PIN, lines = PIN_LINES): void {
  const r = git(repo, ["show", pin + ":autoplan/SKILL.md"]);
  if (r.status !== 0) fail("E_AR_FRAME_DRIFT", "the gstack clone does not hold the pin's autoplan/SKILL.md");
  if (git(repo, ["rev-parse", "--is-shallow-repository"]).stdout.trim() !== "false") fail("E_AR_FRAME_DRIFT", "the gstack clone is shallow; the matrix needs its full history");
  const slice = r.stdout.split("\n").slice(lines[0] - 1, lines[1]).join("\n");
  const rows = preGateRows("## Pre-Gate Verification\n" + slice.replace(/^## Pre-Gate Verification\s*\n/m, ""));
  const got = rows ? cellsOf(rows) : null;
  const want = Object.fromEntries((Object.keys(CELLS) as Phase[]).map((p) => [p, CELLS[p].map(([id]) => id)]));
  if (!got || JSON.stringify(got.cells) !== JSON.stringify(want) || got.dims.design !== 7 || got.dims.dx !== 8) fail("E_AR_FRAME_DRIFT", "the pinned Pre-Gate table (lines " + lines[0] + "-" + lines[1] + ") does not give the frozen cells");
}

/** version to its release commit: the first commit on the pin's history whose VERSION file reads that version. */
export function releaseCommits(repo: string, pin = PIN): Map<string, string> {
  const out = new Map<string, string>();
  const log = git(repo, ["log", "--reverse", "--format=COMMIT %H", "-p", pin, "--", "VERSION"]).stdout;
  let commit = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("COMMIT ")) commit = line.slice(7).trim();
    else if (/^\+\d+(\.\d+)+\s*$/.test(line) && !out.has(line.slice(1).trim())) out.set(line.slice(1).trim(), commit);
  }
  return out;
}

function ceoSections(repo: string, commit: string): Array<{ name: string; ui: boolean }> {
  const files = git(repo, ["ls-tree", "-r", "--name-only", commit, "plan-ceo-review/"]).stdout.split("\n").filter((f) => /\.md$/.test(f));
  const seen = new Map<string, boolean>();
  for (const f of files) {
    for (const m of git(repo, ["show", commit + ":" + f]).stdout.matchAll(/^###\s+Section\s+\d+:\s*(.+)$/gm)) {
      const title = m[1]!.trim();
      const name = title.replace(/\(.*?\)/g, "").replace(/\s+review\s*$/i, "").trim();
      if (!seen.has(name)) seen.set(name, /skip if no ui|\bui\b/i.test(title));
    }
  }
  return [...seen].map(([name, ui]) => ({ name, ui }));
}

export class Matrix {
  private releases: Map<string, string>;
  private memo = new Map<string, Release | null>();
  constructor(
    private repo: string,
    pin = PIN,
  ) {
    checkPinned(repo, pin);
    this.releases = releaseCommits(repo, pin);
  }
  /** The release a gstack_version resolves to, or null (its X-2 cells are missing). */
  forVersion(version: string): Release | null {
    if (!this.memo.has(version)) {
      const commit = this.releases.get(version);
      const skill = commit ? git(this.repo, ["show", commit + ":autoplan/SKILL.md"]) : null;
      const rows = skill && skill.status === 0 ? preGateRows(skill.stdout) : null;
      this.memo.set(version, commit && rows ? { version, commit, ...cellsOf(rows), ceoSections: ceoSections(this.repo, commit) } : null);
    }
    return this.memo.get(version)!;
  }
}
