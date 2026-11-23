// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installScript, type Recipe } from "../../lanes/outcome-skills/h2h/arms/recipes.ts";
import { autoplanStart, lExposure, sentenceIn } from "../../lanes/outcome-skills/h2h/ext/lexposure.ts";
import { extSessionEnv, lHomeArm, lRecipe, telemetrySteps } from "../../lanes/outcome-skills/h2h/ext/homes.ts";
import { readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { events, readEvents, type Ev } from "../../lanes/outcome-skills/h2h/sessions/exposure.ts";

const x = readExtPrereg();
const FIX = join(import.meta.dir, "fixtures", "h2hx-l");
const evs = (name: string) => readEvents([join(FIX, name, "claude-session.jsonl")]);
const first = (name: string) => JSON.parse(readFileSync(join(FIX, name, "first-request.json"), "utf8"));
const user = (text: string) => ({ type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text }] } });
const bash = (command: string, id = "t1") => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const result = (text: string, id = "t1") => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } });
const START = '~/.claude/skills/gstack/bin/gstack-skill-start --skill "autoplan" --model "claude"';
const BT = "BTICK";

describe("h2hx part L detectors on real Claude Code 2.1.325 transcripts at gstack v1.102.1.0", () => {
  test("the start step printed inline in the expanded /autoplan body, and the sentence in the CLAUDE.md of the first request", () => {
    const e = evs("md-feature");
    expect(autoplanStart(e).form).toBe("inline");
    expect(sentenceIn(first("md-feature"), x)).toBe("claude_md");
    const exp = lExposure("l-gstack-md", "feature", e, first("md-feature"), x);
    expect(exp).toMatchObject({ loaded: true, procedure: true, start_form: "inline", sentence: "claude_md" });
    expect(exp.markers[0]).toBe("command:/autoplan");
    expect(exp.markers).toContain("sentence:claude_md");
  });

  test("the fallback: gstack-skill-load's start failed at load and a later Bash call ran gstack-skill-start", () => {
    const s = autoplanStart(evs("fallback-feature"));
    expect(s.form).toBe("fallback");
    expect(s.markers.map((m) => m.split("@")[0])).toEqual(["start:fallback", "start:bash"]);
    expect(lExposure("l-gstack", "feature", evs("fallback-feature"), first("fallback-feature"), x)).toMatchObject({ loaded: true, procedure: true, start_form: "fallback" });
  });

  test("the sentence at the end of T reads as the task placement, never as CLAUDE.md", () => {
    const f = first("task-bug");
    expect(sentenceIn(f, x)).toBe("task");
    expect(lExposure("l-gstack-task", "bug", evs("task-bug"), f, x)).toMatchObject({ loaded: true, procedure: true, sentence: "task", markers: ["installed-pack", "sentence:task"] });
    expect(lExposure("l-gstack-md", "bug", evs("task-bug"), f, x).loaded).toBe(false);
    expect(lExposure("l-none", "bug", evs("task-bug"), f, x)).toMatchObject({ loaded: false, procedure: false });
  });
});

describe("h2hx part L detectors, planted cases", () => {
  const at = (recs: object[]) => events(recs as Record<string, unknown>[]) as Ev[];
  test("each fallback line counts only with a later Bash call to the autoplan start", () => {
    for (const line of ["SHARED_PREAMBLE: not loaded (x is missing, unreadable or not a gstack shared preamble); Read the file named above.", "SKILL_LOAD: unknown mode 'x'; run the start command below yourself.", "SKILL_START: timed out after 15s at load; run the start command below yourself with Bash, then continue."]) {
      expect(autoplanStart(at([user("## Preamble (run first)\n\n" + line), bash(START), result("SKILL_START_PROTO: 1")])).form).toBe("fallback");
      expect(autoplanStart(at([user("## Preamble (run first)\n\n" + line)])).form).toBe(null);
      expect(autoplanStart(at([bash(START), user(line)])).form).toBe(null);
      expect(autoplanStart(at([user(line), bash("~/.claude/skills/gstack/bin/gstack-skill-start --skill \"ship\"")])).form).toBe(null);
    }
  });

  test("start lines inside a tool result or inside SKILL.md's prose never count as the inline form", () => {
    const block = "SKILL_START_PROTO: 1\nSESSION_KIND: interactive\nautoplan guard: enforced (GUARD_ENFORCED)";
    expect(autoplanStart(at([bash("cat SKILL.md"), result(block)])).form).toBe(null);
    expect(autoplanStart(at([user("if BTICKSKILL_START_PROTO: 1BTICK is missing, treat BTICKSESSION_KIND: interactiveBTICK; the autoplan guard: line".replaceAll(BT, "\u0060"))])).form).toBe(null);
    expect(autoplanStart(at([user("## Preamble (run first)\n\n" + block)])).form).toBe("inline");
  });

  test("a sentence anywhere else in the first request is reported as elsewhere, and none as absent", () => {
    expect(sentenceIn({ messages: [{ role: "user", content: "Note: " + x.sentence }] }, x)).toBe("elsewhere");
    expect(sentenceIn({ messages: [{ role: "user", content: "Fix it." }] }, x)).toBe(null);
  });
});

describe("h2hx part L homes", () => {
  test("l-gstack installs gstack v1.102.1.0 as the base layer does, seeds telemetry off, and writes its CLAUDE.md", () => {
    const r = lRecipe("l-gstack", x);
    expect(r.sources).toEqual([{ name: "gstack", repo: "garrytan/gstack", sha: x.gstack.L.sha, kind: "clone" }]);
    expect(r.steps.some((s) => s.includes("fetch -q --depth 1 file:///h2h-src/gstack " + x.gstack.L.sha))).toBe(true);
    expect(r.steps.indexOf("(cd $HOME/.claude/skills/gstack && ./setup)")).toBeLessThan(r.steps.indexOf(telemetrySteps(x)[0]!));
    expect(r.steps.slice(-2)).toEqual(["$HOME/.claude/skills/gstack/bin/gstack-config set telemetry off", "test \"$($HOME/.claude/skills/gstack/bin/gstack-config get telemetry)\" = off"]);
    expect(r.claude_md_text).toBe(x.parts.L.claude_md["l-gstack"]!);
    expect(installScript(r as unknown as Recipe)).toContain("gstack-config set telemetry off");
  });

  test("l-gstack-md has its own CLAUDE.md with the sentence, l-gstack-task runs on l-gstack's home, l-none has none", () => {
    expect(lRecipe("l-gstack-md", x).claude_md_text).toBe(x.parts.L.claude_md["l-gstack"] + x.sentence + "\n");
    expect(lHomeArm("l-gstack-task")).toBe("l-gstack");
    expect(lRecipe("l-gstack-task", x)).toEqual(lRecipe("l-gstack", x));
    expect(lRecipe("l-none", x)).toEqual({ home: "l-none", sources: [], steps: [], claude_md: false, claude_md_text: null });
  });

  test("every extension session's environment carries GSTACK_TELEMETRY_SOURCE=eval", () => {
    for (const arm of ["l-none", "l-gstack-md", "p-gstack", "s-none"] as const) expect(extSessionEnv(arm, x)).toEqual({ GSTACK_TELEMETRY_SOURCE: "eval" });
    expect(() => extSessionEnv("gstack" as never, x)).toThrow(/^E_H2HX_INPUT /);
  });
});
