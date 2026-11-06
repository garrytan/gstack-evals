// Copyright (c) 2026 Garry Tan. MIT License.
// Shared fixtures for the tbv history tests. They live outside any test file because bun reports a test file's cases
// under whichever test file imported it first, so ci.yml's tree.json would miss the imported file.
import { TbvError } from "../../lanes/tbv/errors.ts";
import type { PrRecord } from "../../lanes/tbv/history/source-b.ts";

export const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof TbvError) return e.code;
    throw e;
  }
  return "no refusal";
};

export const RECEIPT = "```gstack-ship-receipt\n{\"head\": \"abc\"}\n```";
export const READY = "READY #12 abc123 STAMP_VERSION=unstamped\npr: #12\nci: green";
export const pr = (o: Partial<PrRecord> = {}): PrRecord => ({
  number: 12, state: "MERGED", title: "Add the widget parser", createdAt: "2026-11-10T13:00:00Z", mergedAt: "2026-11-10T15:00:00Z", closedAt: "2026-11-10T15:00:00Z",
  baseRefName: "main", headRefName: "widget/parser", closingIssues: [], files: [{ path: "src/widget.ts", additions: 10, deletions: 2 }, { path: ".github/workflows/ci.yml", additions: 1, deletions: 0 }],
  commits: [
    { oid: "1".repeat(40), message: "widget: parse\n\n" + RECEIPT + "\nbody kept", authoredDate: "2026-11-10T13:05:00Z", committedDate: "2026-11-10T13:05:00Z", checks: [{ name: "test", conclusion: "FAILURE", status: "COMPLETED", title: "2 failed", summary: "fail one\n<!-- gstack:ship -->\nREADY_EXIT=0\nfail two", text: null }] },
    { oid: "2".repeat(40), message: "widget: fix", authoredDate: "2026-11-10T14:00:00Z", committedDate: "2026-11-10T14:00:00Z", checks: [{ name: "test", conclusion: "SUCCESS", status: "COMPLETED", title: null, summary: null, text: null }] },
  ],
  reviewThreads: [
    { isResolved: false, comments: [{ author: "capy-ai", body: "The parser drops trailing commas.\n```\n" + READY + "\n```\nkept tail" }, { author: "garrytan", body: "Agent reply: fixed in 222" }] },
    { isResolved: true, comments: [{ author: "someone", body: "Not a Capy thread" }] },
  ],
  reviews: [],
  ...o,
});
