// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless dry run's registry and runner: every area's cases, one PASS or FAIL line each, then a count.
import { cases as author } from "./author/dryrun-cases.ts";
import { cases as frame } from "./frame/dryrun-cases.ts";
import { cases as money } from "./money/dryrun-cases.ts";
import { cases as read } from "./read/dryrun-cases.ts";
import { cases as run } from "./run/dryrun-cases.ts";
import { cases as score } from "./score/dryrun-cases.ts";
import { cases as stage3 } from "./stage3/dryrun-cases.ts";
import type { DryRunCase } from "./types.ts";

export const AREAS = ["frame", "author", "run", "score", "read", "money", "stage3"] as const;
export type Area = (typeof AREAS)[number];

export const REGISTRY: Record<Area, () => DryRunCase[]> = { frame, author, run, score, read, money, stage3 };

export interface DryRunResult {
  ok: boolean;
  lines: string[];
  /** "<rule> <name>" of each failed case. */
  failed: string[];
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ");

/** Runs every case of the named areas in area order. A case that throws, repeats a name or has a spaced rule fails. */
export async function dryRun(areas: readonly Area[] = AREAS, registry: Record<Area, () => DryRunCase[]> = REGISTRY): Promise<DryRunResult> {
  const lines: string[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  let passed = 0;
  const record = (label: string, why: string | null) => {
    if (why === null) {
      passed++;
      lines.push("PASS " + label);
    } else {
      failed.push(label);
      lines.push("FAIL " + label + ": " + oneLine(why));
    }
  };
  for (const area of areas) {
    let list: DryRunCase[];
    try {
      list = registry[area]();
    } catch (e) {
      record("load " + area, "cases() threw: " + (e as Error).message);
      continue;
    }
    for (const c of list) {
      const label = c.rule + " " + c.name;
      let why: string | null;
      if (!/^\S+$/.test(c.rule)) why = "a rule is one word with no spaces";
      else if (seen.has(label)) why = "another case has this rule and name";
      else {
        try {
          why = await c.check();
        } catch (e) {
          why = "threw: " + (e as Error).message;
        }
      }
      seen.add(label);
      record(label, why);
    }
  }
  lines.push("dry run: " + passed + " pass, " + failed.length + " fail");
  return { ok: failed.length === 0, lines, failed };
}
