// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAMES, NO_ANSWER, PF_ARMS, SUFFIX_HEAD, SUFFIX_TAIL, TEXT, WRAPUP, loadsPlugin, sessionLimits, taskTurn, withNames } from "../../lanes/outcome-skills/pfchecks/arms.ts";
import { costReading } from "../../lanes/outcome-skills/pfchecks/admission.ts";
import { OPUS, P1, SOL } from "../../lanes/outcome-skills/pfchecks/items.ts";

const POST = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-09-geva-487-pstack-checks-prereg/README.md"), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

test("every arm text, the suffix, the wrap-up turn and the fixed answer are the post's words", () => {
  for (const arm of PF_ARMS) expect(POST.includes('"' + TEXT[arm] + '"')).toBe(true);
  expect(POST.includes("> " + SUFFIX_HEAD + "\n>\n> {issue text}\n>\n> " + SUFFIX_TAIL)).toBe(true);
  expect(POST.includes("> " + WRAPUP + "\n")).toBe(true);
  expect(POST.includes('"' + NO_ANSWER + '"')).toBe(true);
  expect(sha(TEXT.P + TEXT.C + TEXT.N + TEXT.blind + WRAPUP)).toBe(sha(PF_ARMS.map((a) => TEXT[a]).join("") + WRAPUP));
});

test("task turns: text, blank line, suffix with the issue trimmed; P opens with its skill command; the blind probe has no report", () => {
  const t = taskTurn("P", { issue: "The flag is never reset.\n\n  " });
  expect(t).toBe(TEXT.P + "\n\nHere is the bug report:\n\nThe flag is never reset.\n\nMy app is the repository in this directory. Don't stop to ask.");
  expect(t.startsWith("/create-formal-verification-skill ")).toBe(true);
  const f = taskTurn("P", { issue: "x", names: "plugin" });
  expect(f.startsWith(NAMES.plugin[0] + " model the state machine")).toBe(true);
  expect(f.includes(" " + NAMES.plugin[1] + " to visualize")).toBe(true);
  expect(withNames("C", "plugin")).toBe(TEXT.C);
  expect(taskTurn("blind", { scope: "src/core" })).toBe(TEXT.blind.replace("{scope}", "src/core") + "\n\n" + SUFFIX_TAIL);
  expect(() => taskTurn("N", { issue: " \n" })).toThrow(/E_PF_ARM/);
  expect(() => taskTurn("blind", { scope: "a\nb" })).toThrow(/E_PF_ARM/);
  expect(loadsPlugin("P") && loadsPlugin("blind") && !loadsPlugin("C") && !loadsPlugin("N")).toBe(true);
});

test("limits per arm and model (sections 5 and 13), and the doubled allowance from costReading", () => {
  expect(sessionLimits("P", OPUS).task).toEqual({ wall_limit_sec: 5400, max_turns: 250, allowance_usd: 12, quiet_sec: 30, bg_wait_sec: 600 });
  expect(sessionLimits("N", P1).task.allowance_usd).toBe(3);
  expect(sessionLimits("N", SOL).task).toMatchObject({ wall_limit_sec: 3600, max_turns: 150, allowance_usd: 6 });
  expect(sessionLimits("C", P1).wrapup).toEqual({ wall_limit_sec: 300, max_turns: 20, allowance_usd: 0.5, quiet_sec: 30, bg_wait_sec: 600 });
  expect(sessionLimits("C", SOL).wrapup.allowance_usd).toBe(1);
  expect(sessionLimits("blind", OPUS).task).toMatchObject({ wall_limit_sec: 5400, allowance_usd: 15 });
  expect(() => sessionLimits("blind", SOL)).toThrow(/E_PF_ARM/);
  const doubled = costReading({ P: [1, 2, 7], C: [1, 1, 1], N: [1, 1, 1] }).allowance;
  expect(sessionLimits("P", P1, doubled).task.allowance_usd).toBe(10);
  expect(sessionLimits("C", P1, doubled).task.allowance_usd).toBe(5);
});
