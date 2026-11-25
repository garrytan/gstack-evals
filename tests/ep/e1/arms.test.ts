import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EB_COMMON, EB_FORCED } from "../../../lanes/eng-build/arms.ts";
import { C_LINE, D_LINE, e1ArmSpec, e1Env, e1Prompt, pMarker } from "../../../lanes/eng-planted/e1/arms.ts";
import { e1Mount, writtenFiles } from "../../../lanes/eng-planted/e1/bundle.ts";
import { PINS } from "../../../lanes/eng-planted/e1/frozen.ts";
import { codexFailures, codexGstackInstall, e1Stop, TMP_COPY_STEP } from "../../../lanes/eng-planted/e1/launch.ts";

describe("prompts", () => {
  test("every arm ends with the common line, its lines joined by one newline", () => {
    expect(e1Prompt("N", "opus")).toBe(EB_COMMON);
    expect(e1Prompt("D", "sol")).toBe(D_LINE + "\n" + EB_COMMON);
    expect(e1Prompt("C", "particle")).toBe(C_LINE + "\n" + EB_COMMON);
    expect(e1Prompt("P", "opus")).toBe("/statechart model the states this plan adds and the rules they must keep, then improve the plan.\n" + EB_COMMON);
    expect(e1Prompt("P", "particle", "/pstack:statechart").startsWith("/pstack:statechart model the states")).toBe(true);
    expect(e1Prompt("G", "opus")).toBe("/plan-eng-review plan.md\n" + EB_FORCED + "\n" + EB_COMMON);
    expect(e1Prompt("G", "sol")).toBe("$plan-eng-review plan.md\n" + EB_FORCED + "\n" + EB_COMMON);
  });
  test("P does not run on Sol", () => {
    expect(() => e1Prompt("P", "sol")).toThrow(/does not run on sol/);
    expect(() => e1ArmSpec("P", "sol")).toThrow(/does not run on sol/);
  });
});

describe("installs and env", () => {
  test("N, D and C are bare; P is pstack's plugin at the pin; G is gstack at the pin", () => {
    for (const a of ["N", "D", "C"] as const) expect(e1ArmSpec(a, "opus").kind).toBe("bare");
    const p = e1ArmSpec("P", "particle");
    expect(p.kind === "stack" && p.stack).toEqual({ repo: PINS.pstack.repo, sha: PINS.pstack.sha, path: PINS.pstack.harness });
    expect(p.kind === "stack" && typeof p.install.claude).toBe("string");
    const g = e1ArmSpec("G", "opus");
    expect(g.kind === "stack" && [g.stack.sha, g.install]).toEqual([PINS.gstack.sha, {}]);
    const gs = e1ArmSpec("G", "sol");
    expect(gs.kind === "stack" && gs.install).toEqual({ codex: "./setup --host codex" });
    expect(e1Env("G")).toEqual({ GSTACK_SESSION_KIND: "unattended" });
    expect(e1Env("C")).toEqual({});
  });
  test("P's marker refuses a SKILL.md that is not the pinned file", () => {
    const d = mkdtempSync(join(tmpdir(), "e1-pm-"));
    mkdirSync(join(d, "skills", "statechart"), { recursive: true });
    writeFileSync(join(d, "skills", "statechart", "SKILL.md"), "# Statechart\n\nnot it\n");
    expect(() => pMarker(d)).toThrow(/not the pinned file/);
  });
  test("G's Codex install seeds the model line for setup only", () => {
    const d = mkdtempSync(join(tmpdir(), "e1-gi-"));
    const home = join(d, "home");
    mkdirSync(home);
    writeFileSync(join(d, "setup"), '#!/bin/sh\ngrep -qxF \'model = "gpt-6.2-sol"\' "$HOME/.codex/config.toml" && echo seen > "$HOME/seen"\n', { mode: 0o755 });
    const r = spawnSync("bash", ["-c", codexGstackInstall()], { cwd: d, env: { PATH: process.env.PATH!, HOME: home }, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(readFileSync(join(home, "seen"), "utf8")).toBe("seen\n");
    expect(existsSync(join(home, ".codex", "config.toml"))).toBe(false);
  });
  test("the /tmp copy keeps only files newer than the mark and none of the launcher's marks", () => {
    expect(TMP_COPY_STEP).toContain("-newer /tmp/.e1-start");
    expect(TMP_COPY_STEP).toContain('! -path "./.e1-*"');
  });
});

describe("the review bundle", () => {
  const work = () => {
    const w = mkdtempSync(join(tmpdir(), "e1-w-"));
    for (const [p, t] of [["repo/a.ts", "x"], ["plan.md", "plan"], [".gstack-home/projects/p/test-plan.md", "tp"], ["notes/spec.tla", "---- MODULE M ----"], ["model.cfg", "INIT Init"], [".e1-tmp/chart/model.cfg", "INVARIANT Safe"], [".e1-tmp/.e1-start", ""]] as const) {
      mkdirSync(join(w, p, ".."), { recursive: true });
      writeFileSync(join(w, p), t);
    }
    writeFileSync(join(w, "states.bin"), Buffer.from([1, 0, 2]));
    return w;
  };
  test("text files outside repo/, in /work then /tmp path order, binaries counted", () => {
    const got = writtenFiles(work());
    expect(got.files.map((f) => f.path)).toEqual(["/work/model.cfg", "/work/notes/spec.tla", "/tmp/chart/model.cfg"]);
    expect([got.binary, got.large]).toEqual([1, 0]);
  });
  const reply = (t: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } }) + "\n";
  test("plan, reply, then written files, a repeated name numbered", () => {
    const m = e1Mount("C", { plan: "final plan", transcript: reply("done"), stateRoot: null, written: writtenFiles(work()).files }, "authored");
    expect(m.plan).toBe("final plan");
    expect(m.files.map((f) => f.name)).toEqual(["review.md", "model.cfg", "spec.tla", "2-model.cfg"]);
    expect(m.truncated).toBe(false);
  });
  test("every name is allocated against every name already taken, the plan's included", () => {
    const written = [["/tmp/2-model.cfg", "a"], ["/work/model.cfg", "b"], ["/tmp/model.cfg", "c"], ["/tmp/plan.md", "d"]].map(([path, text]) => ({ path: path!, text: text! }));
    const m = e1Mount("C", { plan: "final plan", transcript: reply("done"), stateRoot: null, written }, "authored");
    const names = m.files.map((f) => f.name);
    expect(names).toEqual(["review.md", "2-model.cfg", "model.cfg", "3-model.cfg", "2-plan.md"]);
    expect(new Set(names).size).toBe(names.length);
  });
  test("a missing plan mounts the authored plan; the cap cuts in order", () => {
    const m = e1Mount("N", { plan: null, transcript: reply("one two three four"), stateRoot: null, written: [{ path: "/tmp/x.md", text: "five six" }] }, "a b", 5);
    expect([m.plan, m.planMissing, m.truncated, m.fullWords, m.words]).toEqual(["a b", true, true, 8, 5]);
    expect(m.files.map((f) => f.name)).toEqual(["review.md"]);
  });
});

describe("session ends eval 1 reads first", () => {
  const spent = "E_ALLOWANCE: the slot's allowance of $3.00 cannot hold this call's worst case";
  test("Codex's allowance refusal is a limit stop; any other E_ALLOWANCE is not", () => {
    expect(e1Stop({ kind: "missing", code: "E_ALLOWANCE" }, spent)).toEqual({ end: "limit" });
    expect(e1Stop({ kind: "missing", code: "E_ALLOWANCE" }, "E_ALLOWANCE")).toBeNull();
  });
  test("a safety filter or a refusal is a result; an upstream failure and a cap stop are not", () => {
    const events = [{ type: "turn.failed", error: { message: "Invalid prompt: flagged as potentially violating our usage policy (cyber_policy)" } }, { type: "error", message: "stream closed" }].map((e) => JSON.stringify(e)).join("\n");
    expect(codexFailures(events)).toContain("cyber_policy");
    expect(e1Stop({ kind: "missing", code: "UPSTREAM" }, codexFailures(events))).toEqual({ end: "completed", stop: "safety" });
    expect(e1Stop({ kind: "arm_failure", failure: "refusal" }, "")).toEqual({ end: "completed", stop: "refusal" });
    expect(e1Stop({ kind: "missing", code: "UPSTREAM" }, "502 Bad Gateway")).toBeNull();
    expect(e1Stop({ kind: "cap_stop" }, "cyber_policy")).toBeNull();
    expect(e1Stop({ kind: "completed" }, "")).toBeNull();
  });
});

