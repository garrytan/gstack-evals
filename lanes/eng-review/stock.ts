// Copyright (c) 2026 Garry Tan. MIT License.
// Section 8's stock rows and stock paths for the plan-eng-review intentions eval (prereg 2026-11-08-geva-405), verbatim.
// Rules: rows 1 and 2 are known-bad anchors in the judge check and the only rows the generic screen uses; row 3, built
// from the skill's own checklist, is labelled like any list in every label packet and never screens and never counts as
// an anchor; the stock paths appear only in the pairwise stock block. Every row and the paths go through parse.ts's
// normalizer, the same one every arm's block goes through. Build-time choice: the prereg's "(1)" to "(8)" numbering is
// not part of a check's text.
import { normalizeChecks, normalizePaths } from "./parse.ts";

export const STOCK_ROWS_RAW: readonly (readonly string[])[] = [
  [
    "Unit tests for every new function, covering valid, invalid and empty input.",
    "An integration test for the main happy path, end to end.",
    "Tests for error handling when a dependency or network call fails.",
    "Tests for null, empty and maximum-size inputs.",
    "Run the full existing test suite in CI before merging to catch regressions.",
    "A test for concurrent access to shared state.",
    "Tests that existing callers still behave the same after the change.",
    "A performance test with large inputs.",
  ],
  [
    "Run the test suite on Linux, macOS and Windows in CI.",
    "Test with the oldest and newest supported runtime versions.",
    "Add lint and type-check jobs to CI.",
    "Add end-to-end tests in CI for the main user flow.",
    "Add code coverage reporting with a minimum threshold.",
    "Test configuration parsing with missing and malformed config.",
    "Test upgrading from the previous version with existing data.",
    "Add an eval or golden-output test for any model or prompt output.",
  ],
  [
    "Diagram every branch and error path of each new function and test both sides of each branch.",
    "An end-to-end test for any user flow spanning three or more components.",
    "A regression test for every existing behavior the change puts at risk.",
    "Test double submit, navigating away mid-operation and stale data.",
    "Test what the user sees on a network failure or a 500 response.",
    "Test zero, one and 10,000 results.",
    "An eval for every prompt or model call the change touches.",
    "For each new path, name a production failure and test its error handling.",
  ],
];

export const STOCK_PATHS_RAW: readonly string[] = [
  "the main entry point",
  "the new public function",
  "the configuration loader",
  "the database layer",
  "the API handler",
  "the user interface component",
  "the error handler",
  "the test suite",
];

/** Stock row k (1, 2 or 3), normalized as a checks list. */
export function stockRow(k: 1 | 2 | 3): string[] {
  return normalizeChecks([...STOCK_ROWS_RAW[k - 1]!]);
}

/** The stock paths, normalized as a paths list. */
export const stockPaths = (): string[] => normalizePaths([...STOCK_PATHS_RAW]);

/** Rows 1 and 2: the generic screen's rows and the judge check's known-bad anchors. */
export const SCREEN_ROWS = [1, 2] as const;
export const isAnchorRow = (k: number): boolean => k === 1 || k === 2;
