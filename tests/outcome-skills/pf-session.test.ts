// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitLocal, inventoryLocal } from "../../lanes/outcome-skills/pfchecks/capture.ts";
import { effortDiffers, effortFields, effortHolds, planPart, readWrapup, taskStep, wrapupStep, writeSessionRecord, type PfSessionRecord } from "../../lanes/outcome-skills/pfchecks/session.ts";

test("the plan: 9 told cells per unit, interleaved by order_seed, each on its model's item; admission and blind parts", () => {
  const p = planPart(["u1", "u2"], 2151444076, 1);
  expect(p.length).toBe(18);
  expect(p.slice(0, 9).every((s) => s.unit === "u1")).toBe(true);
  expect(new Set(p.slice(0, 9).map((s) => s.model + "/" + s.arm)).size).toBe(9);
  expect(p.map((s) => s.index)).toEqual([...Array(18).keys()]);
  expect(p.every((s) => s.item === { "claude-opus-5-5": "pf-opus", "openai/gpt-6.1-sol": "pf-sol", "particle-ai/particle-1": "pf-particle" }[s.model])).toBe(true);
  expect(planPart(["u1", "u2"], 2151444076, 1)).toEqual(p);
  expect(planPart(["u1", "u2"], 2151444076, 2)).not.toEqual(p);
  const a = planPart(["u1"], 2151444076, 0, "admit");
  expect(a.map((s) => s.arm).sort()).toEqual(["C", "N", "P"]);
  expect(a.every((s) => s.item === "pf-admit" && s.model === "claude-opus-5-5")).toBe(true);
  expect(planPart(["u1"], 1, 0, "admit", ["openai/gpt-6.1-sol", "particle-ai/particle-1"]).length).toBe(6);
  expect(planPart(["u1"], 1, 9, "blind")).toEqual([{ unit: "u1", part: 9, index: 0, model: "claude-opus-5-5", arm: "blind", item: "pf-blind" }]);
  expect(() => planPart(["u1"], -1, 0)).toThrow(/E_PF_SEED/);
});

test("end rules: the task turn retries the whole session once; the wrap-up turn reruns once; a limit still runs the wrap-up", () => {
  expect(taskStep(["completed"])).toEqual({ action: "wrapup" });
  expect(taskStep(["limit_wall"])).toEqual({ action: "wrapup" });
  expect(taskStep(["upstream"])).toEqual({ action: "retry_session" });
  expect(taskStep(["upstream", "upstream"])).toEqual({ action: "gap", code: "E_PF_UPSTREAM_GAP" });
  expect(taskStep(["upstream", "infra"])).toEqual({ action: "gap", code: "E_PF_INFRA_GAP" });
  expect(taskStep(["upstream", "completed"])).toEqual({ action: "wrapup" });
  expect(wrapupStep(["limit_turns"])).toEqual({ action: "score", wrapup_end: "limit_turns" });
  expect(wrapupStep(["upstream"])).toEqual({ action: "rerun_wrapup" });
  expect(wrapupStep(["upstream", "completed"])).toEqual({ action: "score", wrapup_end: "completed" });
  expect(wrapupStep(["upstream", "upstream"])).toEqual({ action: "gap", code: "E_PF_UPSTREAM_GAP" });
  expect(wrapupStep(["limit_allowance"])).toEqual({ action: "gap", code: "E_PF_WRAPUP_ALLOWANCE" });
  expect(wrapupStep(["upstream", "limit_allowance"])).toEqual({ action: "gap", code: "E_PF_WRAPUP_ALLOWANCE" });
  expect(taskStep(["limit_allowance"])).toEqual({ action: "wrapup" });
});

test("effort fields of a first request and the infra-gap comparison", () => {
  const body = { model: "m", thinking: { type: "adaptive" }, messages: [] };
  expect(effortFields(body)).toEqual({ thinking: { type: "adaptive" }, output_config: null, reasoning: null, reasoning_effort: null, effort: null });
  expect(effortDiffers(body, { ...body, messages: [1] })).toBe(false);
  expect(effortDiffers(body, { ...body, output_config: { effort: "high" } })).toBe(true);
  const rec = effortFields(body);
  expect(effortHolds({ thinking: { type: "adaptive" } }, rec)).toBe(true);
  expect(effortHolds(null, rec)).toBe(false);
  expect(effortHolds({ thinking: { type: "adaptive" } }, undefined)).toBe(false);
  expect(effortHolds({ thinking: { type: "disabled" } }, rec)).toBe(false);
});

const WRAP = join(import.meta.dir, "../../lanes/outcome-skills/pfchecks/sh/wrapup.sh");
const git = (cwd: string, args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
test("wrapup.sh keeps only CHECKS.json, counts every other change, and puts the tree back to S", () => {
  const repo = mkdtempSync(join(tmpdir(), "pf-wrap-"));
  writeFileSync(join(repo, "a.go"), "package a\n");
  writeFileSync(join(repo, ".gitignore"), "gen/\n");
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "base"]);
  const inv = join(repo, "..", "pf-wrap-inv-" + process.pid);
  writeFileSync(inv, inventoryLocal(repo));
  mkdirSync(join(repo, "gen"));
  writeFileSync(join(repo, "gen", "model.tla"), "---- MODULE M ----\n====\n");
  const cap = commitLocal(repo, inv);
  expect(cap.forced).toEqual(["gen/model.tla"]);
  const dir = mkdtempSync(join(tmpdir(), "pf-wrapdir-"));
  expect(spawnSync("bash", [WRAP, "save", repo, dir]).status).toBe(0);
  writeFileSync(join(repo, "CHECKS.json"), '[{"name":"m","command":"bash run.sh"}]');
  writeFileSync(join(repo, "a_test.go"), "package a\n");
  writeFileSync(join(repo, "gen", "late.txt"), "x");
  writeFileSync(join(repo, "a.go"), "package b\n");
  const r = spawnSync("bash", [WRAP, "keep", repo, dir], { encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(readWrapup(r.stdout)).toEqual({ checks: true, discarded: ["a.go", "a_test.go", "gen/late.txt"] });
  expect(readFileSync(join(dir, "CHECKS.json"), "utf8")).toContain("run.sh");
  expect(readFileSync(join(repo, "a.go"), "utf8")).toBe("package a\n");
  expect(git(repo, ["status", "--porcelain", "--ignored"]).stdout.trim()).toBe("");
  expect(git(repo, ["rev-parse", "HEAD"]).stdout.trim()).toBe(cap.head);
  const none = spawnSync("bash", [WRAP, "keep", repo, dir], { encoding: "utf8" });
  expect(readWrapup(none.stdout)).toEqual({ checks: false, discarded: [] });
});

test("the session record refuses a plugin on C and a record with no S", () => {
  const dir = mkdtempSync(join(tmpdir(), "pf-rec-"));
  const r: PfSessionRecord = {
    schema: "pf-session.v1", unit: "u", part: 1, index: 0, model: "claude-opus-5-5", arm: "C", item: "pf-opus", lease_id: "l", attempt: 1, names: "short",
    task: { end: "completed", turns: 3, wall_ms: 1, spent_micros: 1 }, wrapup: { ends: ["completed"], turns: 1, spent_micros: 1 }, wrapup_end: "completed", gap: null,
    capture: null, forced: [], discarded: [], checks: null, s: { repo: "/r", ref: "HEAD" }, transcript: null, claude_session: null, effort: null, questions: { ask_user_question: 0, prose: 0 },
    env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" }, disallowed_tools: ["WebSearch", "WebFetch"], plugin: null, tools: "pf-tools-x",
  };
  writeSessionRecord(join(dir, "ok.json"), r);
  expect(() => writeSessionRecord(join(dir, "ok.json"), r)).toThrow();
  expect(() => writeSessionRecord(join(dir, "p.json"), { ...r, plugin: "/opt/pf-pstack" })).toThrow(/E_PF_ARM/);
  expect(() => writeSessionRecord(join(dir, "s.json"), { ...r, s: null })).toThrow(/E_PF_INPUT/);
  expect(() => writeSessionRecord(join(dir, "pn.json"), { ...r, arm: "P", plugin: "/opt/pf-pstack" })).toThrow(/claude-session/);
  writeSessionRecord(join(dir, "pc.json"), { ...r, arm: "P", plugin: "/opt/pf-pstack", claude_session: "/r/claude-session.jsonl" });
});
