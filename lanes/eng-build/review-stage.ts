// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's review stage (prereg 2026-11-11-geva-522 section 4): the session outcome rule and one
// ReviewRecord per review session. The sessions themselves run on the ported eng-review session loop
// (src/trial/review/er-run.ts); this module decides what an attempt's end means and what the record holds.
//
// - Outcomes: a completed session or one a limit ended is scored as is. An upstream error gets one retry from a fresh
//   container, and a second upstream error is an upstream gap. An infrastructure failure gets one rerun, and a second is
//   an infra gap. The two budgets are separate, so a session runs at most 3 attempts (one of each failure, then a third).
//   A gap prints E_EB_GAP with the cell, the outcome and the retries used; a review that ends in a gap leaves its build
//   unbuilt.
// - Record: exposure is the arm's frozen detector (exposure.ts) on the last attempt's final transcript, null for plain.
//   exposedBeforeBlock is exposure with no Stop hook block: the hook blocks only an unexposed stop, so a session it
//   blocked was not exposed at its first stop. blocks, the bundle's words and cut, the discarded repository edits and
//   the cost come from the last attempt; the cost sums every attempt.
import { erExposure, type ErEvidence } from "../eng-review/exposure.ts";
import { isSkillArm } from "./arms.ts";
import type { Bundle } from "./bundle.ts";
import type { Arm, ReviewRecord, Reviewer, SessionOutcome } from "./types.ts";

/** How one attempt ended, from the driver's termination. */
export type AttemptEnd = "completed" | "limit" | "upstream" | "infra";

export interface Attempt<T> {
  end: AttemptEnd;
  costUsd: number;
  /** Whatever the caller needs from the attempt, such as its session dir. */
  result: T;
}

export interface SessionRun<T> {
  outcome: SessionOutcome;
  attempts: Attempt<T>[];
  /** Attempts past the first. */
  retries: number;
}

export const MAX_TRIES = { upstream: 2, infra: 2 } as const;

/** Runs a session under the outcome rule; start(n) must start attempt n in a fresh container. */
export async function runSession<T>(cell: string, start: (attempt: number) => Promise<Attempt<T>>, log: (line: string) => void = () => {}): Promise<SessionRun<T>> {
  const attempts: Attempt<T>[] = [];
  const seen = { upstream: 0, infra: 0 };
  for (;;) {
    const a = await start(attempts.length + 1);
    attempts.push(a);
    if (a.end === "completed" || a.end === "limit") return { outcome: a.end, attempts, retries: attempts.length - 1 };
    seen[a.end]++;
    if (seen[a.end] >= MAX_TRIES[a.end]) {
      const outcome: SessionOutcome = a.end === "upstream" ? "upstream_gap" : "infra_gap";
      log("E_EB_GAP " + cell + ": " + outcome + " after " + (attempts.length - 1) + " retr" + (attempts.length === 2 ? "y" : "ies") + "; the cell is a recorded gap and its build is not run");
      return { outcome, attempts, retries: attempts.length - 1 };
    }
  }
}

export const isGap = (o: SessionOutcome) => o === "upstream_gap" || o === "infra_gap";

/** One review session's record. evidence is the last attempt's (its final transcript and copied state). */
export function reviewRecord(o: {
  unit: string;
  arm: Exclude<Arm, "none">;
  reviewer: Reviewer;
  rep: number;
  outcome: SessionOutcome;
  evidence: ErEvidence;
  blocks: number;
  bundle: Pick<Bundle, "words" | "truncated">;
  repoEditsDiscarded: number;
  costUsd: number;
}): ReviewRecord {
  const exposed = isSkillArm(o.arm) ? erExposure(o.arm, o.evidence).exposed : null;
  return {
    unit: o.unit,
    arm: o.arm,
    reviewer: o.reviewer,
    rep: o.rep,
    outcome: o.outcome,
    exposed,
    exposedBeforeBlock: exposed === null ? null : exposed && o.blocks === 0,
    blocks: o.blocks,
    bundleWords: o.bundle.words,
    truncated: o.bundle.truncated,
    repoEditsDiscarded: o.repoEditsDiscarded,
    costUsd: o.costUsd,
  };
}
