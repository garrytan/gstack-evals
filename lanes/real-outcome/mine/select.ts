// Copyright (c) 2026 Garry Tan. MIT License.
// The panel keeps at most 3 tasks per repository (plan section 2), and no two tasks share an upstream change. Within a
// repository, K1 pairs come first because they are scarce, then the rest in a seeded hash order, so the pick is
// frozen by the seed and the candidate list, never by the order the miner happened to write.
import { createHash } from "node:crypto";
import type { Candidate } from "./mine.ts";

export const MAX_PER_REPO = 3;

const rank = (seed: string, id: string): string => createHash("sha256").update(seed + "\n" + id).digest("hex");

export interface Panel {
  seed: string;
  per_repo: number;
  selected: Candidate[];
  held: { id: string; reason: "repo_cap" | "shares_change" }[];
}

export function selectPanel(candidates: Candidate[], seed: string, perRepo = MAX_PER_REPO): Panel {
  const byRepo = new Map<string, Candidate[]>();
  for (const c of candidates.filter((c) => c.eligible)) byRepo.set(c.repo, [...(byRepo.get(c.repo) ?? []), c]);
  const selected: Candidate[] = [];
  const held: Panel["held"] = [];
  for (const repo of [...byRepo.keys()].sort()) {
    const used = new Set<string>();
    const ordered = byRepo.get(repo)!.sort((a, b) => Number(b.kind === "K1") - Number(a.kind === "K1") || rank(seed, a.id).localeCompare(rank(seed, b.id)));
    let n = 0;
    for (const c of ordered) {
      const changes = [c.change, ...(c.fix ? [c.fix] : [])];
      if (changes.some((id) => used.has(id))) held.push({ id: c.id, reason: "shares_change" });
      else if (n >= perRepo) held.push({ id: c.id, reason: "repo_cap" });
      else {
        selected.push(c);
        changes.forEach((id) => used.add(id));
        n++;
      }
    }
  }
  return { seed, per_repo: perRepo, selected, held };
}
