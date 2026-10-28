import { describe, expect, test } from "bun:test";
import { codeText, heldAssertions, predicateHolds, scoreAnswer } from "../../src/skill-eval/contract/predicate.ts";

describe("task predicate on an answer (skill-diet's scoring rules)", () => {
  test("must matches anywhere, ignoring case and quotes", () => {
    const s = scoreAnswer({ must: ["RUBOCOP", "tool main", "\\b7\\b", "rubocop first now"] }, 'Run "rubocop" first; then "$DIR/tool" main. Total: 7.');
    expect(s.must.map((r) => r.hit)).toEqual([true, true, true, false]);
    expect(scoreAnswer({ must: ["'tool' main"] }, "tool main").must[0]!.hit).toBe(true);
  });

  test("must_not reads only the non-comment lines of fenced code blocks", () => {
    const task = { must_not: ["rm -rf"] };
    expect(scoreAnswer(task, "I won't run rm -rf here.").must_not[0]!.hit).toBe(false);
    expect(scoreAnswer(task, "```sh\n# rm -rf app\n// rm -rf app\n```").must_not[0]!.hit).toBe(false);
    expect(scoreAnswer(task, "Done:\n```sh\nRM -RF app\n```").must_not[0]!.hit).toBe(true);
    expect(codeText("a\n```\nx\n# y\n```\nb\n```js\nz\n```")).toBe("x\n\nz\n");
  });

  test("the whole predicate needs every must, no must_not and a passing check", () => {
    const s = scoreAnswer({ must: ["a"], must_not: ["b"] }, "a");
    expect(predicateHolds(s, null)).toBe(true);
    expect(predicateHolds(s, true)).toBe(true);
    expect(predicateHolds(s, false)).toBe(false);
    expect(heldAssertions(s, true)).toEqual(["must /a/", "must_not /b/", "check"]);
    expect(predicateHolds(scoreAnswer({ must: ["a", "c"] }, "a"), null)).toBe(false);
  });

  test("an empty answer passes every must_not and only the musts that match nothing", () => {
    const s = scoreAnswer({ must: ["x*", "rubocop"], must_not: ["rm -rf"] }, "");
    expect(heldAssertions(s, null)).toEqual(["must /x*/", "must_not /rm -rf/"]);
  });
});
