// Copyright (c) 2026 Garry Tan. MIT License.
// The repository-instruction strip, asserted from each session's loaded memory (prereg 2026-11-09-geva-417, section 4
// "Repository instructions stripped", section 5, and section 15 rule 4's strip line). The unit snapshot removes every
// CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/AGENTS.md (lanes/devex/unit/snapshot.ts). Each session then records
// what Claude Code actually loaded: the driver's memoryLog option writes one memory.ndjson line per instruction file the
// CLI loads (the Agent SDK's InstructionsLoaded hook), and init.json names the skills the session sees. At SDK 0.3.314
// the hook fires for session-start files only when one holds an @import, so memory.ndjson is a partial record; pass the
// request bodies too where they are on hand (the keyless tests do).
// memoryReading asserts both ways:
// - no fixture text appears in any loaded file (read through the caller's path map), nor in any request body given,
//   and no loaded file sits under the unit's repo;
// - in each gstack arm, gstack's own installed instructions are still present after setup: init's skills name the
//   arm's skill (gstack's install writes after the strip); in none and lens, no gstack skill shows.
import type { ArmId } from "../types.ts";

export interface LoadedFile {
  file_path: string;
  memory_type: string;
  load_reason: string;
  parent_file_path?: string;
}
export const loadedFiles = (memoryNdjson: string | null): LoadedFile[] => (memoryNdjson ?? "").split("\n").filter((l) => l.trim()).flatMap((l) => {
  try {
    const v = JSON.parse(l);
    return typeof v?.file_path === "string" ? [v as LoadedFile] : [];
  } catch {
    return [];
  }
});

const GSTACK_SKILLS = ["plan-devex-review", "autoplan"] as const;
const hasSkill = (skills: readonly string[], name: string) => skills.some((s) => s === name || s.endsWith(":" + name) || s.endsWith("/" + name));

export interface MemoryReading {
  /** Fixture strings found in loaded memory or a request body, each with where it was found. */
  fixture_hits: string[];
  /** Loaded instruction files under the unit's repo. */
  repo_files: string[];
  /** gstack arms: the arm's skill is in init's skills; none and lens: no gstack skill is. */
  gstack_ok: boolean;
  problems: string[];
}

export function memoryReading(o: { arm: ArmId; loaded: readonly LoadedFile[]; read: (path: string) => string | null; bodies?: readonly string[]; skills: readonly string[]; repoRoot: string; fixtures: readonly string[] }): MemoryReading {
  const fixture_hits: string[] = [];
  for (const f of o.loaded) {
    const t = o.read(f.file_path);
    for (const x of o.fixtures) if (t !== null && t.includes(x)) fixture_hits.push(JSON.stringify(x) + " in " + f.file_path);
  }
  (o.bodies ?? []).forEach((b, i) => {
    for (const x of o.fixtures) if (b.includes(x)) fixture_hits.push(JSON.stringify(x) + " in request " + (i + 1));
  });
  const root = o.repoRoot.replace(/\/+$/, "") + "/";
  const repo_files = o.loaded.map((f) => f.file_path).filter((p) => p.startsWith(root));
  const gstack = o.arm === "plan-devex-review" || o.arm === "autoplan";
  const gstack_ok = gstack ? hasSkill(o.skills, o.arm) : !GSTACK_SKILLS.some((s) => hasSkill(o.skills, s));
  const problems = [
    ...fixture_hits.map((h) => "repository instruction text loaded: " + h),
    ...repo_files.map((p) => "a repository instruction file loaded: " + p),
    ...(gstack_ok ? [] : [gstack ? "gstack's installed " + o.arm + " skill is not in the session's skills after setup" : "a gstack skill is in a " + o.arm + " session's skills"]),
  ];
  return { fixture_hits, repo_files, gstack_ok, problems };
}
