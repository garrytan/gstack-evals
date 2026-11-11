// Copyright (c) 2026 Garry Tan. MIT License.
// er Stop hook: smoke rule 2's fallback blocks an unexposed session's stop at most twice with the fixed message, then
// releases it, and never blocks an exposed session. Keyless; the transcripts are synthetic.
import { describe, expect, test } from "bun:test";
import type { ErEvidence } from "../../lanes/eng-review/exposure.ts";
import { ER_STOP_MESSAGE, erStopHook } from "../../lanes/eng-review/stophook.ts";
import { ARTIFACT, nd, review, say, tree } from "./transcripts.ts";

describe("erStopHook", () => {
  const root = tree(ARTIFACT);
  const evidence = (transcript: string): ErEvidence => ({ transcript, stateRoot: root, coverage: null, opening: null });
  test("an unexposed session is blocked twice with the message naming what is missing, then released", () => {
    const h = erStopHook("precut", evidence);
    const t = nd(say(review([1, 2, 3, 4], 2)));
    const first = h.onStop(t);
    expect(first).toBe(ER_STOP_MESSAGE.replace("{missing}", "the Section 3 coverage diagram, with at least 3 path lines marked with star ratings, GAP, [\u2192E2E] or [\u2192EVAL]"));
    expect(h.onStop(t)).toBe(first);
    expect(h.onStop(t)).toBeNull();
    expect(h.blocks()).toBe(2);
  });
  test("an exposed session is never blocked, and a session that becomes exposed is released", () => {
    const h = erStopHook("precut", evidence);
    expect(h.onStop(nd(say(review())))).toBeNull();
    expect(h.blocks()).toBe(0);
    const g = erStopHook("precut", evidence);
    expect(g.onStop(nd(say("partial")))).not.toBeNull();
    expect(g.onStop(nd(say(review())))).toBeNull();
    expect(g.blocks()).toBe(1);
  });
});
