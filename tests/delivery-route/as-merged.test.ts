// Copyright (c) 2026 Garry Tan. MIT License.
// The as-merged table (lanes/delivery-route/analyze.ts asMerged) prints every as-merged line from its own field: a row whose
// detection has no followed_as_merged is refused with E_B1_AS_MERGED_UNREAD, never counted as not followed (B2
// preregistration section 6.3, last bullet).
import { describe, expect, test } from "bun:test";
import { asMerged, report } from "../../lanes/delivery-route/analyze.ts";
import { ARM_NAMES } from "../../lanes/delivery-route/pins.ts";
import type { B1Row } from "../../lanes/delivery-route/table.ts";

const row = (arm: string, task: string, merged: boolean | undefined): B1Row => ({
  schema: "b1-session/1", model: "claude-opus-5-5", part: "b1-1", arm: arm as B1Row["arm"], task, trial: task + "__" + arm, outcome: "graded", reason: "graded", pass: false, reward: 0,
  allowance_stop: false, turn_cap: false, cost_usd: 0.1, tokens: 1, steps_seen: true, skill_loads: 0, safety_stop: false, audit_hits: [],
  detect: { followed: true, followed_tool_only: true, ...(merged === undefined ? {} : { followed_as_merged: merged }), test_before_source: true, failing_before_source: true, passing_after_source: true, source_changed: true, bash_only_source: false, source_write_unseen: false, unread_background: 0, unresolved_writes: 0, spec_folder_write: false, test_file: null, fix_files: [] } as B1Row["detect"],
});
const rows = (merged: (i: number) => boolean | undefined) => ARM_NAMES.flatMap((a) => Array.from({ length: 60 }, (_, i) => row(a, "t" + i, merged(i))));

describe("the as-merged table reads only rows that carry the field", () => {
  test("rows with the field keep their own as-merged reading, false and true alike", () => {
    const out = asMerged(rows((i) => i < 30));
    expect([out.filter((r) => r.detect.followed).length, out.length]).toEqual([30 * ARM_NAMES.length, 60 * ARM_NAMES.length]);
  });
  test("a row without the field is refused, by trial, and never printed as a zero", () => {
    const r = rows((i) => (i === 7 ? undefined : true));
    expect(() => asMerged(r)).toThrow(/^E_B1_AS_MERGED_UNREAD .*t7__none/);
    expect(() => report(r)).toThrow(/^E_B1_AS_MERGED_UNREAD/);
    const bad = rows(() => true).map((x, i) => (i === 0 ? { ...x, detect: { ...x.detect, followed_as_merged: null as unknown as boolean } } : x));
    expect(() => asMerged(bad)).toThrow(/^E_B1_AS_MERGED_UNREAD/);
  });
});
