import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EB_COMMON, EB_FORCED } from "../../../lanes/eng-build/arms.ts";
import { C_LINE, D_LINE, e1ArmSpec, e1Env, e1Prompt, pMarker } from "../../../lanes/eng-planted/e1/arms.ts";
import { e1Mount, writtenFiles } from "../../../lanes/eng-planted/e1/bundle.ts";
import { PINS } from "../../../lanes/eng-planted/e1/frozen.ts";
import { claudeFailures, codexFailures, codexGstackInstall, e1Stop, TMP_COPY_STEP, tmpCopyStep, withTmpCapture } from "../../../lanes/eng-planted/e1/launch.ts";

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
  test("on Claude hosts a Usage Policy or moderation refusal is a safety result, never an upstream gap; a transport error stays one", () => {
    const api = (text: string) => JSON.stringify({ type: "assistant", is_api_error_message: true, error: "invalid_request", message: { content: [{ type: "text", text }] } });
    const said = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "This plan violates no usage policy." }] } });
    const policy = [said, api("API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup).")].join("\n");
    expect(claudeFailures(policy)).toContain("Usage Policy");
    expect(claudeFailures(policy)).not.toContain("violates no");
    expect(e1Stop({ kind: "missing", code: "UPSTREAM" }, claudeFailures(policy))).toEqual({ end: "completed", stop: "safety" });
    expect(e1Stop({ kind: "missing", code: "UPSTREAM" }, claudeFailures(api("Provider returned error: particle-1 requires moderation on OpenRouter. Your input was flagged for \"violence\"")))).toEqual({ end: "completed", stop: "safety" });
    expect(e1Stop({ kind: "missing", code: "UPSTREAM" }, claudeFailures([said, api("API Error: 529 Overloaded")].join("\n")))).toBeNull();
    expect(e1Stop({ kind: "missing", code: "UPSTREAM" }, claudeFailures(said))).toBeNull();
  });
});

describe("the /tmp copy fails closed", () => {
  const root = () => {
    const d = mkdtempSync(join(tmpdir(), "e1-copy-"));
    const tmp = join(d, "tmp"), work = join(d, "work");
    mkdirSync(join(tmp, "old"), { recursive: true });
    mkdirSync(work);
    writeFileSync(join(tmp, "old", "before.txt"), "old\n");
    spawnSync("touch", ["-d", "2020-01-01", join(tmp, "old", "before.txt")]);
    writeFileSync(join(tmp, ".e1-start"), "");
    spawnSync("touch", ["-d", "2021-01-01", join(tmp, ".e1-start")]);
    mkdirSync(join(tmp, "chart"));
    writeFileSync(join(tmp, "chart", "model.cfg"), "INVARIANT Safe\n");
    return { tmp, work };
  };
  const copy = (r: { tmp: string; work: string }) => spawnSync("sh", ["-c", tmpCopyStep(r.tmp)], { cwd: r.work, encoding: "utf8" });
  const asRoot = process.getuid?.() === 0;

  test("control: a clean copy exits 0 with the new files only, and leaves no list or archive behind", () => {
    const r = root();
    expect(copy(r).status).toBe(0);
    expect(readFileSync(join(r.work, ".e1-tmp", "chart", "model.cfg"), "utf8")).toBe("INVARIANT Safe\n");
    expect(existsSync(join(r.work, ".e1-tmp", "old", "before.txt"))).toBe(false);
    expect(existsSync(join(r.work, ".e1-tmp", ".e1-start"))).toBe(false);
    expect(spawnSync("sh", ["-c", "ls -A " + JSON.stringify(r.tmp) + " | grep -c '^.e1-' || true"], { encoding: "utf8" }).stdout.trim()).toBe("1");
  });
  test.skipIf(asRoot)("a file the copy cannot read fails the step", () => {
    const r = root();
    writeFileSync(join(r.tmp, "chart", "secret.cfg"), "x\n");
    spawnSync("chmod", ["000", join(r.tmp, "chart", "secret.cfg")]);
    expect(copy(r).status).not.toBe(0);
  });
  test.skipIf(asRoot)("a folder find cannot enter fails the step", () => {
    const r = root();
    mkdirSync(join(r.tmp, "locked"));
    writeFileSync(join(r.tmp, "locked", "f.txt"), "x\n");
    spawnSync("chmod", ["000", join(r.tmp, "locked")]);
    const s = copy(r);
    spawnSync("chmod", ["755", join(r.tmp, "locked")]);
    expect(s.status).not.toBe(0);
  });
  test.skipIf(asRoot)("a destination the copy cannot write fails the step", () => {
    const r = root();
    mkdirSync(join(r.work, ".e1-tmp", "chart"), { recursive: true });
    spawnSync("chmod", ["555", join(r.work, ".e1-tmp", "chart")]);
    const s = copy(r);
    spawnSync("chmod", ["755", join(r.work, ".e1-tmp", "chart")]);
    expect(s.status).not.toBe(0);
  });
  test("a Claude session whose own session file cannot be copied, or is empty, reports a failed copy", async () => {
    const run = async (cat: { exitCode: number; stdout: string }, sol = false) => {
      const d = mkdtempSync(join(tmpdir(), "e1-keep-"));
      let copied = null as boolean | null;
      const session = { exec: (cmd: string) => (cmd.startsWith("cat ") ? { ...cat, stderr: "" } : { exitCode: 0, stdout: "", stderr: "" }) };
      const agent = withTmpCapture({ run: async () => ({}) } as never, sol, { home: "/home/u", session: join(d, "claude-session.jsonl") }, (ok) => void (copied = ok));
      await agent.run(session as never, {} as never, 1000);
      return { copied, kept: existsSync(join(d, "claude-session.jsonl")) };
    };
    expect(await run({ exitCode: 0, stdout: "{}\n" })).toEqual({ copied: true, kept: true });
    expect(await run({ exitCode: 1, stdout: "" })).toEqual({ copied: false, kept: false });
    expect(await run({ exitCode: 0, stdout: "" })).toEqual({ copied: false, kept: false });
    expect((await run({ exitCode: 1, stdout: "" }, true)).copied).toBe(true);
  });
});

