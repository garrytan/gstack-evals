// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests for the hidden-test count (hidden.ts): Rust doctest ids, the ids an early stop hides, the static
// no-fail-fast reading of a frozen test command, and the summary counts.
import { describe, expect, test } from "bun:test";
import { dropOf, f2pPassing, hiddenIds, isDoctest, noFailFast, summarize, type HiddenRecord } from "../../lanes/outcome-skills/statemachines/hidden.ts";

describe("doctest ids", () => {
  test("libtest's doctest forms are doctests", () => {
    for (const id of ["file-id/src/lib.rs - (line 12)", "src/lib.rs - Watcher::watch (line 99)", "crate/src/lib.rs - SomeName (line 99) - compile", "src/a.rs - m::f (line 3) - compile fail"]) expect(isDoctest(id)).toBe(true);
  });
  test("unit and integration test ids are not", () => {
    for (const id of ["tests::state::file_name_05", "inotify::tests::native_error_type_on_missing_path", "error::display_formatted_errors", "it_works", "tests/cli.rs::case (line 3)"]) expect(isDoctest(id)).toBe(false);
  });
});

describe("hidden ids", () => {
  test("an id that passed in the first run and is absent from the second is hidden; a fail or a skip in the second is not", () => {
    const first = { "a::t": "pass", "src/lib.rs - (line 1)": "pass", "b::t": "pass", "c::t": "fail", "d::t": "pass" };
    const second = { "a::t": "pass", "d::t": "fail", "f::new": "fail" };
    expect(hiddenIds(first, second)).toEqual({ doctest: ["src/lib.rs - (line 1)"], other: ["b::t"] });
    expect(hiddenIds(first, { ...second, "b::t": "skip" })).toEqual({ doctest: ["src/lib.rs - (line 1)"], other: [] });
  });
});

describe("fail-to-pass ids passing on base", () => {
  test("the unit's fail-to-pass ids that pass in each run, so an id that passes once the fix's tests are on base shows apart", () => {
    const f2p = ["m::case_2", "m::case_1", "m::bug", "n::absent"];
    const first = { "m::bug": "fail", "x::old": "pass" };
    const second = { "m::bug": "fail", "m::case_1": "pass", "m::case_2": "pass", "x::old": "pass" };
    expect(f2pPassing(f2p, first, second)).toEqual({ first: [], second: ["m::case_1", "m::case_2"] });
    expect(f2pPassing(f2p, second, { ...second, "m::case_1": "skip" })).toEqual({ first: ["m::case_1", "m::case_2"], second: ["m::case_2"] });
  });
});

describe("no-fail-fast in the frozen test command", () => {
  test("the flag on every runner invocation", () => {
    expect(noFailFast(["cd /testbed ; cargo test --no-fail-fast -- --show-output 2>&1 | tee test-output.log"])).toEqual({ no_fail_fast: true, how: "flag", runners: 1 });
    expect(noFailFast(["mkdir -p r ; NEXTEST_EXPERIMENTAL_LIBTEST_JSON=1 cargo nextest run --workspace --no-fail-fast > r/x.jsonl"])).toEqual({ no_fail_fast: true, how: "flag", runners: 1 });
    expect(noFailFast(["cargo +stable test --workspace --no-fail-fast -- --nocapture"]).how).toBe("flag");
  });
  test("a cargo or nextest run without it stops early", () => {
    expect(noFailFast(["cd /testbed && cargo test --verbose 2>&1 | tee test-output.log"])).toEqual({ no_fail_fast: false, how: null, runners: 1 });
    expect(noFailFast(["cargo nextest run --workspace"]).no_fail_fast).toBe(false);
    expect(noFailFast(["cargo test --no-fail-fast ; cargo test --workspace"]).no_fail_fast).toBe(false);
    expect(noFailFast(["cargo test -- --no-fail-fast"]).no_fail_fast).toBe(false);
  });
  test("separate commands per target that don't stop on failure", () => {
    expect(noFailFast(["cargo test --lib 2>&1 | tee a.log ; cargo test --doc 2>&1 | tee -a a.log"])).toEqual({ no_fail_fast: true, how: "per_target", runners: 2 });
    expect(noFailFast(["cargo test --lib", "cargo test --test cli"])).toEqual({ no_fail_fast: true, how: "per_target", runners: 2 });
    expect(noFailFast(["cargo test --lib && cargo test --doc"]).no_fail_fast).toBe(false);
    expect(noFailFast(["cargo test --lib --tests ; cargo test --doc"]).no_fail_fast).toBe(false);
  });
  test("a command with no cargo runner is not counted as one", () => {
    expect(noFailFast(["pnpm exec rstest run"])).toEqual({ no_fail_fast: false, how: null, runners: 0 });
  });
});

describe("summary", () => {
  const rec = (id: string, inWindow: boolean, d: number, o: number, nff = false, drop: string | null = null): HiddenRecord => ({
    schema: "sm-hidden.v1", id, month: inWindow ? "2026-07" : "2025-08", in_window: inWindow, hidden_doctests: d, hidden_other: o,
    hidden: { doctest: [], other: [] }, no_fail_fast: nff, how: nff ? "flag" : null, runs: null, drop: drop ? { code: "E_SM_SLOW_TEST", reason: drop } : null,
  });
  test("units and ids by kind, in window and overall; drops counted apart", () => {
    const s = summarize([rec("a", true, 11, 0), rec("b", true, 0, 3, true), rec("c", false, 2, 1), rec("d", true, 0, 0, true), rec("e", true, 0, 0, false, "slow")]);
    expect(s.overall).toEqual({ units: 5, measured: 4, dropped: 1, with_hidden_doctests: 2, with_hidden_other: 2, with_any_hidden: 3, hidden_doctest_ids: 13, hidden_other_ids: 4, no_fail_fast: 2 });
    expect(s.window).toEqual({ units: 4, measured: 3, dropped: 1, with_hidden_doctests: 1, with_hidden_other: 1, with_any_hidden: 2, hidden_doctest_ids: 11, hidden_other_ids: 3, no_fail_fast: 2 });
  });
});

describe("a failure's record", () => {
  const rec = { schema: "sm-hidden.v1", id: "u", month: "2026-04", in_window: true, hidden_doctests: 0, hidden_other: 0, hidden: { doctest: [], other: [] }, no_fail_fast: false, how: null, runs: null, drop: null } as HiddenRecord;
  test("a coded failure is a drop with its code and reason", () => {
    expect(dropOf(rec, new Error("E_SM_HISTORY u: the history rewrite failed: x")).drop).toEqual({ code: "E_SM_HISTORY", reason: "E_SM_HISTORY u: the history rewrite failed: x" });
  });
  test("a full disk stops the count for a rerun to resume and records no drop", () => {
    expect(() => dropOf(rec, new Error("E_SM_HISTORY u: copying /testbed out of the image failed: cp: error writing 'x': No space left on device"))).toThrow(/^E_SM_INFRA_GAP u: /);
  });
});
