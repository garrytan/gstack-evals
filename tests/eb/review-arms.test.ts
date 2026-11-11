// Copyright (c) 2026 Garry Tan. MIT License.
// The build read's review arms (prereg 2026-11-11-geva-522 section 4): the arm table, each prompt byte for byte, the
// session limits, and the Stop hook on skill arms only, with its two blocks and release. Keyless; no session runs.
import { describe, expect, test } from "bun:test";
import type { ErEvidence } from "../../lanes/eng-review/exposure.ts";
import { ER_STOP_MESSAGE } from "../../lanes/eng-review/stophook.ts";
import { EB_ASK_ANSWER, EB_COMMON, EB_FORCED, REVIEW_ARMS, REVIEW_SESSION, reviewPrompt, reviewStopHook } from "../../lanes/eng-build/arms.ts";
import { EbError } from "../../lanes/eng-build/errors.ts";
import { FROZEN } from "../../lanes/eng-build/frozen.ts";
import type { Arm } from "../../lanes/eng-build/types.ts";
import { ER_ALLOWANCE_MICROS, ER_MAX_TURNS, ER_TIMEOUT_S } from "../../src/trial/review/eng-review.ts";
import { ARTIFACT, nd, review, say, tree } from "../er/transcripts.ts";

const codeOf = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof EbError ? e.code : "not an EbError";
  }
  return null;
};

describe("review arm table", () => {
  test("pins, installs, Stop hook and session kind per arm", () => {
    const row = (a: Arm) => {
      const r = REVIEW_ARMS[a];
      return [r.session, r.gstack?.sha.slice(0, 9) ?? null, r.gstack?.version ?? null, r.gstack?.install ?? null, r.stopHook, r.env.GSTACK_SESSION_KIND ?? null];
    };
    expect(row("none")).toEqual([false, null, null, null, false, null]);
    expect(row("plain")).toEqual([true, null, null, null, false, null]);
    expect(row("precut")).toEqual([true, "b493d4e31", "1.97.0.0", "default", true, "unattended"]);
    expect(row("engphase")).toEqual([true, "199931029", "1.98.0.0", "default", true, "unattended"]);
    expect(row("candidate")).toEqual([true, "57295cbc5", "1.98.0.0", "./setup --host claude", true, "unattended"]);
  });

  test("prompts: the common line, after the command or opening and the forced sentence on skill arms", () => {
    expect(EB_COMMON).toBe("Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it. Leave the improved plan in plan.md.");
    expect(EB_FORCED).toBe("Run its whole procedure unattended, taking your recommended option at every decision.");
    expect(reviewPrompt("plain")).toBe(EB_COMMON);
    expect(reviewPrompt("precut")).toBe("/plan-eng-review plan.md\n" + EB_FORCED + "\n" + EB_COMMON);
    expect(reviewPrompt("candidate")).toBe("/plan-coverage plan.md\n" + EB_FORCED + "\n" + EB_COMMON);
    expect(reviewPrompt("engphase", "# Phase 3\n\nRead methodology.md.\n\n")).toBe("# Phase 3\n\nRead methodology.md.\n" + EB_FORCED + "\n" + EB_COMMON);
    expect(codeOf(() => reviewPrompt("engphase"))).toBe("E_USAGE");
    expect(codeOf(() => reviewPrompt("none"))).toBe("E_USAGE");
  });

  test("the fixed AskUserQuestion answer and the frozen session limits", () => {
    expect(EB_ASK_ANSWER).toBe("Go with your recommendation.");
    expect(REVIEW_SESSION).toMatchObject({ systemPrompt: "claude-code-preset", contextTokens: 200_000, maxTurns: 200, timeoutS: 5400, allowanceMicros: 10_000_000, deniedTools: ["WebSearch", "WebFetch"] });
    expect(REVIEW_SESSION.env).toEqual({ CLAUDE_CODE_DISABLE_1M_CONTEXT: "1", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" });
    expect([REVIEW_SESSION.maxTurns, REVIEW_SESSION.timeoutS, REVIEW_SESSION.allowanceMicros]).toEqual([ER_MAX_TURNS, ER_TIMEOUT_S, ER_ALLOWANCE_MICROS]);
  });
});

describe("review Stop hook", () => {
  const root = tree(ARTIFACT);
  const evidence = (transcript: string): ErEvidence => ({ transcript, stateRoot: root, coverage: null, opening: null });

  test("plain and none get none; every skill arm gets one", () => {
    expect(reviewStopHook("plain", evidence)).toBeNull();
    expect(reviewStopHook("none", evidence)).toBeNull();
    for (const a of ["precut", "engphase", "candidate"] as const) expect(reviewStopHook(a, evidence)).not.toBeNull();
  });

  test("an unexposed session is blocked twice with the fixed message naming what is missing, then released", () => {
    const h = reviewStopHook("precut", evidence)!;
    const t = nd(say(review([1, 2, 3, 4], 2)));
    const first = h.onStop(t);
    expect(first).toBe(ER_STOP_MESSAGE.replace("{missing}", "the Section 3 coverage diagram, with at least 3 path lines marked with star ratings, GAP, [\u2192E2E] or [\u2192EVAL]"));
    expect(h.onStop(t)).toBe(first);
    expect(h.onStop(t)).toBeNull();
    expect(h.blocks()).toBe(FROZEN.stopHook.maxBlocks);
  });

  test("an exposed session is released without a block", () => {
    const h = reviewStopHook("precut", evidence)!;
    expect(h.onStop(nd(say(review())))).toBeNull();
    expect(h.blocks()).toBe(0);
  });
});
