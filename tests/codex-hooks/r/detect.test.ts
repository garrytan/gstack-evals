// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's load detector (section 4.5) against rollouts real Codex 0.170 wrote in the gstack arm images, driven by a
// scripted stub model (fixtures/README.md).
import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect, hasWildcard, namesFile, namesOther, outputText, readHookLog, split, whyNoLoad } from "../../../lanes/codex-hooks/r/detect.ts";
import { AGENT } from "../../../lanes/codex-hooks/r/pins.ts";
import { rRow } from "../../../lanes/codex-hooks/r/table.ts";

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

describe("hook log, reasons and split", () => {
  const ROOT = "01a1fcf3-6f7a-7840-925b-97840f71d550";
  test("the session's own first line gives the position", () => {
    expect(readHookLog(join(FX, "direct"), d("direct").root)).toMatchObject({ position: "alone", event: "routed", named: ["prove-it"], lines: 1 });
    expect(readHookLog(join(FX, "route-off"), d("route-off").root).position).toBe("log missing");
    expect(readHookLog(join(FX, "direct"), "another-session").position).toBe("log missing");
  });
  test("two routes, no route and later lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "r-hook-"));
    const at = (lines: string[]) => {
      mkdirSync(join(dir, "gstack-hooks", "hooks"), { recursive: true });
      writeFileSync(join(dir, "gstack-hooks", "hooks", "skill-route.log"), lines.join("\n") + "\n");
      return readHookLog(dir, ROOT);
    };
    const t = "2026-11-21T07:12:54.834Z session=" + ROOT;
    expect(at([t + " event=routed skill=prove-it score=2 source=x also=verify also_score=1 also_source=gstack host=codex"])).toMatchObject({ position: "first of two", named: ["prove-it", "verify"] });
    expect(at([t + " event=routed skill=verify score=2 source=gstack also=prove-it also_score=1 also_source=y host=codex"]).position).toBe("second of two");
    expect(at([t + " event=no-route reason=below-threshold chars=40 top=none host=codex", t + " event=routed skill=prove-it score=1"])).toMatchObject({ position: "not named", event: "no-route", lines: 2 });
    expect(at(["2026-11-21T07:12:54.834Z session=other event=routed skill=prove-it", t + " event=routed skill=prove-it score=1"]).position).toBe("alone");
    rmSync(dir, { recursive: true, force: true });
  });
  test("reasons in section 4.6's order", () => {
    const why = (name: string) => whyNoLoad(d(name), readHookLog(join(FX, name), d(name).root));
    expect(why("direct")).toBeNull();
    expect(why("route-off")).toBe("hook log missing");
    expect(why("two")).toBe("loaded /verify instead");
    expect(why("fail")).toBe("load failed");
    expect(why("named")).toBe("named, not loaded");
    expect(why("route")).toBe("never named");
    const quiet = { ...d("route"), line_delivered: false };
    expect(whyNoLoad(quiet, readHookLog(join(FX, "route"), quiet.root))).toBe("line not delivered");
  });
  test("the split counts each position's loads", () => {
    const rows = split([
      { position: "alone", prove_it: true, verify: false },
      { position: "alone", prove_it: false, verify: false },
      { position: "first of two", prove_it: true, verify: true },
      { position: "log missing", prove_it: false, verify: true },
    ]);
    expect(rows.map((r) => [r.position, r.sessions, r.prove_it, r.verify, r.neither])).toEqual([
      ["alone", 2, 1, 0, 1], ["first of two", 1, 1, 1, 0], ["second of two", 0, 0, 0, 0], ["not named", 0, 0, 0, 0], ["log missing", 1, 0, 1, 0],
    ]);
  });
});

describe("destructive-command check, read audit and the table row", () => {
  test("a gstack deny and Codex's own reject are counted apart", () => {
    expect(d("careful").guard).toEqual({ denies: 1, codex_rejects: 1 });
    expect(d("direct").guard).toEqual({ denies: 0, codex_rejects: 0 });
  });
  test("the read audit counts calls naming gstack or skill paths", () => {
    expect(d("none-direct").audit.calls).toBe(1);
    expect(d("route-off").audit.calls).toBe(0);
  });
  test("a trial dir's row carries the loads, the hook's position and the guard", () => {
    const dir = mkdtempSync(join(tmpdir(), "r-row-"));
    const root = d("direct").root;
    mkdirSync(join(dir, "evaluator"), { recursive: true });
    cpSync(join(FX, "direct"), join(dir, "evaluator"), { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: AGENT.name, kwargs: { arm: "r-on" } }, task: { path: "x/optuna__optuna-6428" } }));
    writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: "t1", verifier_result: { rewards: { reward: 1 } } }));
    writeFileSync(join(dir, "evaluator", "laneb-summary.json"), JSON.stringify({ session: { ok_responses: 1 }, result: { thread_id: root } }));
    const row = rRow(dir, { part: null, sessions: new Map(), requests: new Map([["t1", [{ event: "request", trial: "t1", reasoning_effort: "low" }]]]) })!;
    expect([row.outcome, row.reason]).toEqual(["graded", "graded"]);
    expect(row.loads).toMatchObject({ prove_it: { loaded: true, at_first_call: true }, line_delivered: true, hook: { position: "alone" }, why_no_load: null });
    expect(row.destructive).toEqual({ denies: 0, codex_rejects: 0 });
    expect(row.read_audit).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
