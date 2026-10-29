// The verdict's lock checks (interface v0.4, "The lock is the preregistration"): re-derive the lock's rows from the before
// copy, then find the contract lines the after copy rewrote or removed that no covering task still passes.
//
// The lock's derived fields (id, file, kind, categories, load, ask, text_sha256) are never trusted as written (the U6
// brief's decision 4, from GSTA-17's note on #18). They are rebuilt with U5's buildLock over the before copy, which carries
// the author's claims by file and text, and compared row by row. A mismatch, such as an ask set to null by hand or a
// deleted row, is a LOCK_DRIFT line, and the gates read the rebuilt rows, so a hand edit cannot weaken them.
//
// Thresholds: a claimed line is reached when at least one passing old-arm run of a claiming task read the line's file
// and, for an ask line, asked a question of its category (U5's reached). A reaching task still passes in after when it
// passes at least two thirds of its after runs on the pooled rounds, the contract's panel threshold.
import type { SidecarFile } from "../contract/sidecar.ts";
import type { TasksFile } from "../contract/tasks.ts";
import { contractLines, lineFates, type SkillFile } from "../lock/contract-lines.ts";
import { buildLock, coverageGaps, lineCoverage, lockDrift, uncoveredRemovals, type GateRemoval, type Lock, type LockLine, type OldArmRun } from "../lock/lock.ts";

/** What the gate checks read: the committed lock and the files it pins, and both skill copies. */
export interface GateEvidence {
  lockPath: string;
  lock: Lock;
  tasks: TasksFile;
  ext: SidecarFile | null;
  policy: { path: string; sha256: string } | null;
  before: SkillFile[];
  after: SkillFile[];
}

const ROW_FIELDS = ["id", "file", "kind", "categories", "load", "ask", "text_sha256"] as const;

/** The lock's rows rebuilt from the before copy with the lock's claims, and every LOCK_DRIFT line. */
export function rederiveLock(e: GateEvidence): { lines: LockLine[]; drift: string[] } {
  const drift = lockDrift(e.lock, { tasks: e.tasks, ext: e.ext, policySha256: e.policy?.sha256 ?? null, before: e.before });
  const { lock } = buildLock({ lockPath: e.lockPath, tasks: e.tasks, ext: e.ext, policy: e.policy, skillName: e.lock.skill.name, before: e.before, previous: e.lock });
  if (lock.lines.length !== e.lock.lines.length) drift.push("the lock lists " + e.lock.lines.length + " contract lines; the before copy has " + lock.lines.length);
  const rows: string[] = [];
  lock.lines.forEach((derived, i) => {
    const stored = e.lock.lines[i];
    if (!stored) return;
    for (const field of ROW_FIELDS) {
      const [was, now] = [JSON.stringify(stored[field]), JSON.stringify(derived[field])];
      if (was !== now) rows.push("lines[" + i + "] (" + stored.id + "): " + field + " is " + was + " in the lock and " + now + " from the before copy");
    }
  });
  drift.push(...rows.slice(0, 20), ...(rows.length > 20 ? [rows.length - 20 + " more row mismatches"] : []));
  return { lines: lock.lines, drift };
}

export interface GateResult {
  /** Every contract line the after copy rewrote or removed, with the tasks that claim it. */
  removed: { id: string; class: "rewritten" | "removed"; tasks: string[] }[];
  uncovered: GateRemoval[];
  gaps: ReturnType<typeof coverageGaps>;
}

export function gateCheck(lines: readonly LockLine[], before: readonly SkillFile[], after: readonly SkillFile[], runs: readonly OldArmRun[], passesInAfter: (task: string) => boolean): GateResult {
  const fates = lineFates(contractLines(before), after);
  const coverage = lineCoverage(lines, runs);
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    removed: fates.flatMap((f) => (f.class === "rewritten" || f.class === "removed" ? [{ id: f.id, class: f.class, tasks: byId.get(f.id)?.tasks ?? [] }] : [])),
    uncovered: uncoveredRemovals(lines, fates, coverage, passesInAfter),
    gaps: coverageGaps(lines, fates, coverage),
  };
}
