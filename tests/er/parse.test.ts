// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { endStateOf, erOutcome, headingArrays, normalizeEngPlan, normalizeItem, parseEngPlan, retries } from "../../lanes/eng-review/parse.ts";

const block = (body: string, label = "eng-plan") => "Notes.\n\n```" + label + "\n" + body + "\n```\n";
const ok = JSON.stringify({ paths: ["src/a.ts parseRow"], checks: ["Unit test: parseRow skips empty rows"] });

describe("eng-plan parse", () => {
  test("strict reads the last eng-plan block, even with a closing line after it", () => {
    const p = parseEngPlan([block(JSON.stringify({ paths: ["x"], checks: ["y"] })), block(ok) + "\nPLAN_COVERAGE: paths=3 gaps=1 tests=2 out=.gstack/plan-coverage"]);
    expect(p.kind).toBe("block");
    if (p.kind === "block") {
      expect(p.lenient).toBeNull();
      expect(p.checks).toEqual(["Unit test: parseRow skips empty rows"]);
    }
  });
  test("strict refuses one key, the lenient parse takes it with the other empty", () => {
    const p = parseEngPlan([block(JSON.stringify({ checks: ["c1"] }))]);
    expect(p.kind === "block" && p.lenient).toEqual(["one-key"]);
    expect(p.kind === "block" && p.paths).toEqual([]);
  });
  test("a fence labelled otherwise and trailing commas read leniently", () => {
    const p = parseEngPlan([block('{"paths": ["a",], "checks": ["b",],}', "json")]);
    expect(p.kind === "block" && p.lenient).toEqual(["label", "commas"]);
  });
  test("two bare arrays under paths and checks headings read leniently", () => {
    const text = "## Paths\n```json\n[\"src/a.ts f\"]\n```\nChecks:\n```\n[\"test g\"]\n```\n";
    expect(headingArrays(text)).toEqual({ paths: ["src/a.ts f"], checks: ["test g"] });
    const p = parseEngPlan([text]);
    expect(p.kind === "block" && p.lenient).toEqual(["headings"]);
  });
  test("no fence, prose only, or a non-string array is no-block", () => {
    expect(parseEngPlan(["no block here"]).kind).toBe("no-block");
    expect(parseEngPlan([block(JSON.stringify({ paths: [1], checks: ["a"] }))]).kind).toBe("no-block");
    expect(parseEngPlan([block("not json")]).kind).toBe("no-block");
    expect(headingArrays("## Paths\n```\n[\"a\"]\n```\n")).toBeNull();
  });
});

describe("normalization", () => {
  test("keeps 15 paths and 8 checks and cuts at 25 and 40 words", () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
    const n = normalizeEngPlan(Array.from({ length: 20 }, () => long(26)), Array.from({ length: 10 }, () => long(41)));
    expect(n.paths.length).toBe(15);
    expect(n.checks.length).toBe(8);
    expect(n.paths[0]!.split(" ").length).toBe(25);
    expect(n.checks[0]!.split(" ").length).toBe(40);
    expect(n.cut).toBe(23);
    const edge = normalizeEngPlan([long(25)], [long(40)]);
    expect(edge.cut).toBe(0);
  });
  test("strips markdown and leading numbering", () => {
    expect(normalizeItem("1. **Unit** test for `parse()` [link](http://x)", 40).text).toBe("Unit test for parse() link");
    expect(normalizeItem("- ## (2) step", 40).text).toBe("step");
  });
});

describe("end states", () => {
  const tx = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n";
  test("a completed reply with no block is no-block, never retried", () => {
    const o = erOutcome({ kind: "completed" }, tx("nothing"));
    expect(o.outcome.state).toBe("no-block");
    expect(retries(o.outcome, 1)).toBe(false);
  });
  test("turn, time and dollar limits are arm stops: retried once, then no-block with arm_stop", () => {
    for (const t of [{ kind: "turn_cap" }, { kind: "timeout" }, { kind: "allowance_stop" }] as const) {
      const o = erOutcome(t, tx("partial")).outcome;
      expect(o.state).toBe("arm-stop");
      expect(retries(o, 1)).toBe(true);
      expect(retries(o, 2)).toBe(false);
      expect(endStateOf(o)).toEqual({ end: "no-block", arm_stop: true });
    }
  });
  test("a provider error is infrastructure: missing after its retry, never 0", () => {
    const o = erOutcome({ kind: "infra", incident: "upstream 529" }, tx("partial")).outcome;
    expect(o.state).toBe("infra");
    expect(endStateOf(o)).toEqual({ end: "missing", arm_stop: false });
  });
  test("a context overflow is an arm stop", () => {
    const t = JSON.stringify({ type: "result", is_error: true, result: "prompt is too long: 210000 tokens" }) + "\n";
    expect(erOutcome({ kind: "infra", incident: "api" }, t).outcome.state).toBe("arm-stop");
  });
  test("a block wins over a timeout, and a cap stop has no end state", () => {
    expect(erOutcome({ kind: "timeout" }, tx(block(ok))).outcome.state).toBe("block");
    expect(endStateOf(erOutcome({ kind: "cap_stop" }, tx("x")).outcome)).toBeNull();
  });
});
