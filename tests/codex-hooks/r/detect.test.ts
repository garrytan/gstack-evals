// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's load detector (section 4.5) against rollouts real Codex 0.170 wrote in the gstack arm images, driven by a
// scripted stub model (fixtures/README.md).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { detect, hasWildcard, namesFile, namesOther, outputText } from "../../../lanes/codex-hooks/r/detect.ts";

const FX = join(import.meta.dir, "fixtures");
const d = (name: string) => detect(join(FX, name));
const pi = (name: string) => d(name).loads["prove-it"];
const vf = (name: string) => d(name).loads["gstack-verify"];

describe("path forms", () => {
  test("a call names prove-it's file by any path form", () => {
    for (const s of ["cat /root/.codex/skills/prove-it/SKILL.md", "cat ~/.codex/skills/prove-it/SKILL.md", "cat $CODEX_HOME/skills/prove-it/SKILL.md", "cat \"${CODEX_HOME}/skills/prove-it/SKILL.md\"", "cat prove-it/SKILL.md", "cd ~/.codex/skills/prove-it && cat SKILL.md"])
      expect(namesFile(s, "prove-it")).toBe(true);
    for (const s of ["cat ~/.codex/skills/not-prove-it/SKILL.md", "ls ~/.codex/skills/prove-it && cat ~/.codex/skills/gstack/SKILL.md", "cat ~/.codex/skills/prove-it/notes.md"])
      expect(namesFile(s, "prove-it")).toBe(false);
  });
  test("another skill file and wildcards", () => {
    expect(namesOther("cat ~/.codex/skills/prove-it/SKILL.md ~/.codex/skills/gstack-verify/SKILL.md", "prove-it")).toBe(true);
    expect(namesOther("cat $CODEX_HOME/skills/gstack/bin/x", "prove-it")).toBe(true);
    expect(namesOther("cat ~/.codex/skills/prove-it/SKILL.md", "prove-it")).toBe(false);
    for (const s of ["cat ~/.codex/skills/*/SKILL.md", "cat ~/.codex/skills/prove-?t/SKILL.md", "cat ~/.codex/skills/{prove-it,gstack}/SKILL.md", "head SKILL*"]) expect(hasWildcard(s)).toBe(true);
    expect(hasWildcard("const x = a ? b : c; cat('~/.codex/skills/prove-it/SKILL.md')")).toBe(false);
  });
  test("a tool result's text is its string or its text parts joined", () => {
    expect(outputText("x")).toBe("x");
    expect(outputText([{ type: "input_text", text: "a" }, { type: "input_text", text: "b" }])).toBe("a\nb");
  });
});

describe("loads in real Codex 0.170 rollouts", () => {
  test("a direct cat is a load at the first call, with the steps", () => {
    expect(pi("direct")).toMatchObject({ loaded: true, rules: ["a", "b"], at_first_call: true, where: ["root"], failed: 0 });
    expect(d("direct").steps_arrived).toBe(true);
    expect(vf("direct").loaded).toBe(false);
  });
  test("a code-mode cell's text parts count; sed 1,80p reaches a unique line but not the steps", () => {
    expect(pi("code")).toMatchObject({ loaded: true, rules: ["a", "b"], at_first_call: true });
    expect(d("code").steps_arrived).toBe(false);
  });
  test("a read that printed no line is a failed load, whatever its exit code", () => {
    expect(pi("fail")).toMatchObject({ loaded: false, failed: 1 });
    expect(pi("none-direct")).toMatchObject({ loaded: false, failed: 1 });
    expect(d("none-direct").line_delivered).toBe(false);
  });
  test("front matter alone is no load and names no file", () => {
    expect(pi("grepdesc")).toMatchObject({ loaded: false, failed: 0, b_excluded: 0 });
    expect(d("grepdesc").named_in_text).toBe(false);
  });
  test("a cell that reads two skills and passes on one: /verify by (a), prove-it excluded from (b), not failed", () => {
    expect(vf("two")).toMatchObject({ loaded: true, rules: ["a"], at_first_call: true, b_excluded: 1 });
    expect(pi("two")).toMatchObject({ loaded: false, failed: 0, b_excluded: 1 });
  });
  test("/verify alone", () => {
    expect(vf("verify")).toMatchObject({ loaded: true, at_first_call: true });
    expect(pi("verify").loaded).toBe(false);
  });
  test("a load after another call is not at the first call", () => {
    expect(pi("late")).toMatchObject({ loaded: true, at_first_call: false });
  });
  test("Codex's injection is rule (c)", () => {
    expect(pi("inject")).toMatchObject({ loaded: true, rules: ["c"], at_first_call: false });
  });
  test("naming without loading", () => {
    expect(pi("named").loaded).toBe(false);
    expect(d("named").named_in_text).toBe(true);
  });
  test("a sub-agent's read counts, and is not the root's first call", () => {
    const s = d("sub");
    expect(s.threads).toBe(2);
    expect(s.loads["prove-it"]).toMatchObject({ loaded: true, at_first_call: false, where: ["sub"] });
  });
  test("the hook's line is delivered in r-on and absent in r-off", () => {
    expect(d("route").line_delivered).toBe(true);
    expect(d("route-off").line_delivered).toBe(false);
    expect(pi("route").loaded).toBe(false);
  });
});
