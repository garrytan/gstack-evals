// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { toldScreen } from "../../lanes/outcome-skills/pfchecks/told.ts";

const long = "The counter is not reset after the connection closes, so the next session starts in the wrong state. ".repeat(3);
const fix = "+++ b/src/a.rs\n+        self.state = State::Idle; // reset after close, always\n+        self.retries = 0; // and the retry counter goes back too\n+short\n";
test("passes a plain long report", () => expect(toldScreen(long, fix)).toBeNull());
test("drops a missing or short issue", () => {
  expect(toldScreen(null, fix)?.rule).toBe("issue_missing");
  expect(toldScreen("  ", fix)?.rule).toBe("issue_missing");
  expect(toldScreen("x".repeat(199), fix)).toEqual({ rule: "issue_short", value: 199 });
  expect(toldScreen("é".repeat(200), fix)).toBeNull();
});
test("drops a diff block line", () => {
  for (const l of ["@@ -1,2 +1,2 @@", "+++ b/x", "--- a/x"]) expect(toldScreen(long + "\n" + l + "\n", fix)?.rule).toBe("diff_block");
  expect(toldScreen(long + "\n---\n", fix)).toBeNull();
});
test("drops two verbatim added lines of 30 characters or more, not one", () => {
  expect(toldScreen(long + "\n        self.state = State::Idle; // reset after close, always\n", fix)).toBeNull();
  expect(toldScreen(long + "\n  self.state = State::Idle; // reset after close, always\nself.retries = 0; // and the retry counter goes back too\n", fix)).toEqual({ rule: "fix_lines", value: 2 });
});
test("drops the Rust dry-run unit skim-rs__skim-1044, whose issue text is 108 characters, under the 200-character floor", () => {
  const issue = "--border none as in FZF (support for neovim fzf-lua)\nImplement value `none` for option `--border` as in FZF\n";
  expect(toldScreen(issue, "")).toEqual({ rule: "issue_short", value: 108 });
});
