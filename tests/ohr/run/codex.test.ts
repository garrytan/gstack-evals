// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the Sol arms on Codex CLI (the second attempt's pre-run change 2): the pinned CLI, the install check, the first message, the settings, the none arm's cleanliness, the model tap, the transcript form the readers take and the question loop; fails_when=a Sol session runs another CLI, a duplicate skill hides the injection, a question reaches no simulator or a Codex transcript reads differently from Claude Code's.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { CODEX, CODEX_LAYOUT_FIX, CODEX_SETTINGS, CONTAINER_HOME, firstMessage, LENS_LINE, RENDER_GAP } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { BEARER_ENV, codexPinProblems, codexReads, codexTranscript, codexTreeProblems, gapProblems, homeCommand, homeProblems, renderGap, solArgv, solDriver, solEnv } from "../../../lanes/office-hours-rewrite/run/codex.ts";
import { tapOffPin } from "../../../lanes/office-hours-rewrite/run/codex-rig.ts";
import { reportedModels } from "../../../lanes/office-hours-rewrite/run/tap.ts";
import { trialEnv, TrialEnvError } from "../../../src/trial/env.ts";
import { codexEnv, codexQuestions } from "../../../src/adapters/codex/driver.ts";
import { safetyStop, sessionKindOf } from "../../../lanes/office-hours-rewrite/run/session.ts";
import { replies } from "../../../lanes/office-hours-founder/parse.ts";
import { exposure, loadMarkers, questionsAsked } from "../../../lanes/office-hours-rewrite/score/detect.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const tmp = () => mkdtempSync(join(tmpdir(), "ohr-codex-"));
const o = { proxy: { baseUrl: "http://tap:8099/", slot: "s1", token: "t" }, home: CONTAINER_HOME, skillArm: true };

describe("1. pin", () => {
  test("Codex CLI 0.170.0 is pinned by version, tarball and binary sha256 in frozen.ts, docker/host-cli.json and the trial Dockerfile", () => {
    const dockerfile = readFileSync(join(REPO, "docker/trial.Dockerfile"), "utf8");
    expect(CODEX.version).toBe("0.170.0");
    expect(JSON.parse(readFileSync(join(REPO, "docker/host-cli.json"), "utf8")).codex_office_hours_rewrite).toBe(CODEX.version);
    expect(dockerfile).toContain("ADD --checksum=sha256:" + CODEX.tarball_sha256 + " " + CODEX.tarball + " ");
    expect(dockerfile).toContain('echo "' + CODEX.binary_sha256 + "  " + CODEX.bin + '" | sha256sum -c -');
    expect(dockerfile).toContain('test "$(' + CODEX.bin + ' --version)" = "codex-cli ' + CODEX.version + '"');
    expect(codexPinProblems(CODEX.binary_sha256 + "  " + CODEX.bin + "\n", null)).toEqual([]);
    expect(codexPinProblems("0".repeat(64) + "  " + CODEX.bin + "\n", null)).toHaveLength(1);
  });
});

describe("2. install", () => {
  test("a Sol skill arm hides the three duplicate copies, one [[skills.config]] entry each, and nothing else; none hides nothing", () => {
    const pairs = (skillArm: boolean) => solArgv({ ...o, skillArm }, null).filter((a, i, all) => all[i - 1] === "-c" && a.startsWith("skills.config="));
    expect(CODEX_LAYOUT_FIX).toEqual(["skills/gstack/office-hours/SKILL.md", "skills/gstack/plan-design-review/SKILL.md", "skills/gstack/gstack-upgrade/SKILL.md"]);
    expect(pairs(true)).toEqual(['skills.config=[{path="' + CONTAINER_HOME + '/.codex/skills/gstack/office-hours/SKILL.md",enabled=false},{path="' + CONTAINER_HOME + '/.codex/skills/gstack/plan-design-review/SKILL.md",enabled=false},{path="' + CONTAINER_HOME + '/.codex/skills/gstack/gstack-upgrade/SKILL.md",enabled=false}]']);
    expect(pairs(false)).toEqual([]);
  });
  test("the install check reads the rendered SKILL.md at both entries, and the current-to-new gap must be 62 lines in the pins and in the render", () => {
    const h = tmp();
    mkdirSync(join(h, ".codex/skills/gstack-office-hours"), { recursive: true });
    writeFileSync(join(h, ".codex/skills/gstack-office-hours/SKILL.md"), "not the render\n");
    const p = codexTreeProblems(h, "current");
    expect(p.join("\n")).toContain(".codex/skills/gstack-office-hours/SKILL.md hashes to");
    expect(p.join("\n")).toContain(".codex/skills/gstack/office-hours/SKILL.md is missing");
    expect(p.join("\n")).toContain("VERSION is not the pin's 1.102.0.0");
    const lines = Array.from({ length: 100 }, (_, i) => "line " + i);
    const changed = lines.map((l, i) => (i % 3 === 0 && i < 93 ? l + " changed" : l));
    expect(renderGap(lines.join("\n") + "\n", changed.join("\n") + "\n")).toBe(RENDER_GAP);
    const [a, b] = [tmp(), tmp()];
    for (const [d, text] of [[a, lines], [b, changed]] as const) for (const f of [".local/share/gstack/office-hours/SKILL.md", ".codex/skills/gstack-office-hours/SKILL.md"]) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), text.join("\n") + "\n");
    }
    expect(gapProblems(a, b)).toEqual([]);
    expect(gapProblems(a, a)[0]).toContain("0 changed lines in the pins and 0 in the render");
  });
});

describe("3. invocation", () => {
  test("a Sol skill arm's first message is $office-hours, the lens line and the opening; none is plain; Opus keeps /office-hours", () => {
    expect(firstMessage("current", " An opening. ", "sol")).toBe("$office-hours " + LENS_LINE + "\n\nAn opening.");
    expect(firstMessage("new", "An opening.", "sol")).toBe(firstMessage("current", "An opening.", "sol"));
    expect(firstMessage("none", "An opening.", "sol")).toBe(LENS_LINE + "\n\nAn opening.");
    expect(firstMessage("new", "An opening.", "opus")).toBe("/office-hours " + LENS_LINE + "\n\nAn opening.");
  });
});

describe("4. config", () => {
  test("every Sol exec names gpt-6.1-sol on the proxy's Responses route with the frozen settings, keeps its session, and resumes it by thread", () => {
    const first = solArgv(o, null);
    const settings = Object.fromEntries(first.filter((_, i) => first[i - 1] === "-c").map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
    expect(first.slice(0, 8)).toEqual(["exec", "--json", "--strict-config", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "--color", "never", "-m"]);
    expect(first[8]).toBe("gpt-6.1-sol");
    expect(first).not.toContain("--ephemeral");
    expect(settings).toMatchObject({ model_reasoning_effort: '"low"', model_context_window: "500000", model_auto_compact_token_limit: "450000", "skills.bundled.enabled": "false", web_search: '"disabled"', "features.sleep_tool": "false", "model_providers.gstack_evals_proxy.base_url": '"http://tap:8099/s1/openai/v1"', "model_providers.gstack_evals_proxy.wire_api": '"responses"' });
    expect(CODEX_SETTINGS.model_auto_compact_token_limit as number).toBe(CODEX_SETTINGS.model_context_window * 9 / 10);
    expect(first.at(-1)).toBe("-");
    expect(solArgv(o, "th-1").slice(-3)).toEqual(["resume", "th-1", "-"]);
  });
});

describe("5. none arm clean", () => {
  test("the HOME check refuses any Codex state, skill or AGENTS.md on none, and allows a skill arm only its Codex skills and gstack tree", () => {
    expect(homeProblems("", false)).toEqual([]);
    expect(homeProblems("present .codex\nagents /work/x/AGENTS.md\nskill " + CONTAINER_HOME + "/a/SKILL.md\n", false)).toHaveLength(3);
    expect(homeProblems("present .codex\npresent .codex/skills\npresent .local/share/gstack\nskill " + CONTAINER_HOME + "/.codex/skills/x/SKILL.md\n", true)).toEqual([]);
    expect(homeProblems("present .codex\npresent .codex/config.toml\n", true)).toEqual(["skill arm HOME: present .codex/config.toml"]);
    const gstackTree = "agents " + CONTAINER_HOME + "/.local/share/gstack/AGENTS.md\nagents " + CONTAINER_HOME + "/.local/share/gstack/captain/templates/AGENTS.md\n";
    expect(homeProblems("present .local/share/gstack\n" + gstackTree, true)).toEqual([]);
    expect(homeProblems(gstackTree, false)).toHaveLength(2);
    expect(homeProblems("agents /work/idea/AGENTS.md\nagents " + CONTAINER_HOME + "/.codex/AGENTS.md\n", true)).toHaveLength(2);
  });
  test("the HOME check runs in sh and finds a planted AGENTS.md, override, Codex config and skill; a bare HOME prints nothing", () => {
    const [home, work, bare] = [tmp(), tmp(), tmp()];
    mkdirSync(join(home, ".codex/skills/x"), { recursive: true });
    writeFileSync(join(home, ".codex/config.toml"), "");
    writeFileSync(join(home, ".codex/skills/x/SKILL.md"), "");
    writeFileSync(join(work, "AGENTS.override.md"), "");
    mkdirSync(join(home, "a/b"), { recursive: true });
    writeFileSync(join(home, "a/b/AGENTS.md"), "");
    const run = (h: string) => spawnSync("sh", ["-c", homeCommand], { cwd: work, env: { PATH: process.env.PATH!, HOME: h }, encoding: "utf8" });
    const r = run(home);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(homeProblems(r.stdout, false).sort()).toEqual(["none arm HOME: agents " + join(home, "a/b/AGENTS.md"), "none arm HOME: agents " + join(work, "AGENTS.override.md"), "none arm HOME: present .codex", "none arm HOME: present .codex/config.toml", "none arm HOME: present .codex/skills", "none arm HOME: skill " + join(home, ".codex/skills/x/SKILL.md")].sort());
    const empty = spawnSync("sh", ["-c", homeCommand], { cwd: bare, env: { PATH: process.env.PATH!, HOME: bare }, encoding: "utf8" });
    expect([empty.status, empty.stdout, empty.stderr]).toEqual([0, "", ""]);
  });
  test("the slot's bearer reaches Codex as OPENAI_API_KEY, which the trial env admits in the agent env only as a session bearer, never a provider key", () => {
    const bearer = "gse_" + "a".repeat(32);
    const env = solEnv({ proxy: { ...o.proxy, token: bearer } });
    expect(BEARER_ENV).toBe("OPENAI_API_KEY");
    expect(Object.keys(codexEnv({ proxy: o.proxy }))).toEqual([BEARER_ENV]);
    expect(env[BEARER_ENV]).toBe(bearer);
    expect(trialEnv("agent", { PATH: "/usr/bin", HOME: CONTAINER_HOME, ...env }, [], {})).toEqual({ PATH: "/usr/bin", HOME: CONTAINER_HOME, ...env });
    expect(() => trialEnv("agent", { ...env, OPENAI_API_KEY: "sk-not-a-session-bearer" }, [], {})).toThrow(TrialEnvError);
    expect(solArgv(o, null)).toContain("model_providers.gstack_evals_proxy.env_key=" + JSON.stringify(BEARER_ENV));
  });
  test("the read audit flags a tool call naming gstack and any injected skill or AGENTS.md item", () => {
    const line = (payload: object) => JSON.stringify({ type: "response_item", payload });
    const meta = (k: string) => ({ internal_chat_message_metadata_passthrough: { content_item_metadata: [{ provenance: { type: k } }] } });
    expect(codexReads([[line({ type: "custom_tool_call", name: "exec", input: "tools.exec_command({cmd: 'ls'})" }), line({ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }], ...meta("user") })].join("\n")])).toEqual([]);
    expect(codexReads([[line({ type: "custom_tool_call", name: "exec", input: "cat ~/.local/share/gstack/x" }), line({ type: "message", role: "user", content: [{ type: "input_text", text: "<skill>" }], ...meta("skills") }), line({ type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md" }], ...meta("agents_md") })].join("\n")])).toHaveLength(3);
  });
});

describe("6. metering and drift", () => {
  test("the tap reads each response's reported model from a Responses stream or a JSON body", () => {
    const ev = (type: string, response: object) => "event: " + type + "\ndata: " + JSON.stringify({ type, response }) + "\n\n";
    expect(reportedModels(ev("response.created", { id: "r1", model: "gpt-6.1-sol" }) + ev("response.completed", { id: "r1", model: "gpt-6.1-sol-2026-11-01" }))).toEqual([{ id: "r1", model: "gpt-6.1-sol-2026-11-01" }]);
    expect(reportedModels('{"id":"r2","model":"gpt-6.2-sol"}')).toEqual([{ id: "r2", model: "gpt-6.2-sol" }]);
  });
  test("off-pin reads only the session's slot and successful responses: a dated pin counts, another model or none does not", () => {
    const d = tmp();
    const log = join(d, "models.ndjson");
    const l = (slot: string, status: number, models: (string | null)[]) => JSON.stringify({ slot, status, path: "/" + slot + "/openai/v1/responses", responses: models.map((model, i) => ({ id: "r" + i, model })) });
    writeFileSync(log, [l("a", 200, ["gpt-6.1-sol-2026-11-01"]), l("a", 502, [null]), l("b", 200, ["gpt-9"])].join("\n") + "\n");
    expect(tapOffPin(log, "a", "gpt-6.1-sol")).toEqual([]);
    writeFileSync(log, [l("a", 200, ["gpt-6.2-sol", null])].join("\n") + "\n");
    expect(tapOffPin(log, "a", "gpt-6.1-sol")).toEqual(["gpt-6.2-sol", "(no model)"]);
  });
});

const SKILL_TEXT = "---\nname: office-hours\n---\n## Phase 2A: Startup Mode\nAsk one question at a time.\n## Phase 2B: Builder Mode\n";
const BLOCK = "Here is where I land.\n\nDECISION: Ask the two paying bakeries for a referral this week.\nNEXT ACTION: You call both owners by Friday.\nWHY: Two bakeries paid 40 dollars each.";
const Q1 = "Who has paid you so far, and how much?";
const Q2 = "What do the bakeries use today instead, and what does it cost them?";

/** One conversation as Claude Code's driver records it (SDK messages, the founder's own messages not echoed). */
function claudeForm(): string {
  const a = (content: object[]) => ({ type: "assistant", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: null, usage: null }, parent_tool_use_id: null, session_id: "s" });
  const u = (content: object[]) => ({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "s" });
  const r = (result: string) => ({ type: "result", subtype: "success", is_error: false, num_turns: 1, result, session_id: "s" });
  return [
    { type: "system", subtype: "init", session_id: "s", model: "claude-opus-5-5" },
    a([{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "office-hours" } }]), u([{ type: "tool_result", tool_use_id: "t1", content: "Launching skill: office-hours" }]), u([{ type: "text", text: SKILL_TEXT }]),
    a([{ type: "text", text: "Let me start." }]), a([{ type: "tool_use", id: "t2", name: "Bash", input: { command: "gstack-skill-start --skill office-hours" } }]), u([{ type: "tool_result", tool_use_id: "t2", content: "SESSION_KIND: interactive\nSLUG: idea" }]),
    a([{ type: "text", text: Q1 }]), r(Q1),
    a([{ type: "text", text: Q2 }]), r(Q2),
    a([{ type: "text", text: BLOCK }]), r(BLOCK),
  ].map((m) => JSON.stringify(m) + "\n").join("");
}

/** The same conversation as Codex 0.170.0 records it in its rollout: the skill injected, a code-mode call, Q1 through request_user_input_async. */
function codexRollout(): string {
  const ri = (payload: object) => ({ type: "response_item", payload });
  const ev = (payload: object) => ({ type: "event_msg", payload });
  const user = (text: string, kind: string) => ri({ type: "message", role: "user", content: [{ type: "input_text", text }], internal_chat_message_metadata_passthrough: { content_item_metadata: [{ provenance: { type: kind } }] } });
  const said = (text: string) => ri({ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] });
  const done = (last: string) => ev({ type: "task_complete", last_agent_message: last });
  return [
    { type: "session_meta", payload: { id: "th", cwd: "/work", cli_version: "0.170.0" } }, { type: "turn_context", payload: { model: "gpt-6.1-sol" } },
    user("<environment_context></environment_context>", "harness"), user("$office-hours hi", "user"), user("<skill>\n<name>office-hours</name>\n<path>/p</path>\n" + SKILL_TEXT + "\n</skill>", "skills"),
    said("Let me start."), ri({ type: "custom_tool_call", call_id: "c1", name: "exec", input: "await tools.exec_command({cmd: 'gstack-skill-start --skill office-hours'})" }), ri({ type: "custom_tool_call_output", call_id: "c1", output: [{ type: "input_text", text: "SESSION_KIND: interactive\nSLUG: idea" }] }),
    ri({ type: "function_call", call_id: "q1", name: "request_user_input_async", arguments: JSON.stringify({ questions: [{ title: Q1 }] }) }), ev({ type: "item_completed", item: { type: "AgentMessage", id: "q1", content: [{ type: "Text", text: Q1 }], delivery: "async", questions: [{ title: Q1, options: null }] } }), ri({ type: "function_call_output", call_id: "q1", output: '{"accepted":true}' }), done(Q1),
    user("Two bakeries paid.", "user"), said(Q2), done(Q2),
    user("I need to stop here.", "user"), said(BLOCK), done(BLOCK),
  ].map((m) => JSON.stringify(m) + "\n").join("");
}

describe("7. transcript", () => {
  test("one conversation reads the same from Claude Code's transcript and from Codex's rollout converted: replies, session kind, safety, exposure's skill read and questions, and the text and result lines", () => {
    const [cc, cx] = [claudeForm(), codexTranscript(codexRollout())];
    expect(replies(cx)).toEqual(replies(cc));
    expect(replies(cx)).toEqual([["Let me start.", Q1], [Q2], [BLOCK]]);
    expect(sessionKindOf(cx)).toBe(sessionKindOf(cc));
    expect(sessionKindOf(cx)).toBe("interactive");
    expect(safetyStop(cx)).toBe(safetyStop(cc));
    expect(questionsAsked(cx, 1)).toBe(questionsAsked(cc, 1));
    const m = loadMarkers("current");
    const turns = [{ delivered: true }, { delivered: true }] as any;
    const ex = (t: string) => exposure({ transcript: t, stateRoot: null, sessionKind: "interactive", turns, markers: m });
    expect(ex(cx)).toEqual(ex(cc));
    expect(ex(cx).read_skill).toBe(true);
    const form = (t: string) => t.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.type === "result" || (x.type === "assistant" && x.message.content[0].type === "text")).map((x) => (x.type === "result" ? ["result", x.subtype, x.is_error, x.result] : ["assistant", Object.keys(x).sort(), Object.keys(x.message).sort(), x.message.content]));
    expect(form(cx)).toEqual(form(cc));
    const toolNames = (t: string) => t.split("\n").filter(Boolean).map((l) => JSON.parse(l)).flatMap((x) => (x.type === "assistant" ? x.message.content.filter((c: any) => c.type === "tool_use").map((c: any) => c.name) : []));
    expect(toolNames(cx)).toEqual(["exec"]);
    expect(codexQuestions(codexRollout())).toEqual([{ call_id: "q1", questions: [{ title: Q1 }] }]);
  });
});

/** A session whose spawn runs a fake codex: a question first (as exec shows request_user_input_async), the stdin echoed on resume. */
function fakeSession(fake: string) {
  const dir = tmp();
  const bin = join(dir, "codex");
  writeFileSync(bin, "#!/usr/bin/env bun\n" + fake);
  chmodSync(bin, 0o755);
  const spawned: string[][] = [];
  return {
    spawned,
    exec: (command: string) => ({ exitCode: spawnSync("sh", ["-c", command], { cwd: dir, env: { PATH: process.env.PATH!, HOME: dir }, encoding: "utf8" }).status ?? 1, stdout: "", stderr: "", timedOut: false }),
    spawn(argv: string[]) {
      spawned.push(argv);
      const a = argv.map((x) => (x === CODEX.bin ? bin : x));
      return spawn(a[0]!, a.slice(1), { cwd: dir, env: { PATH: process.env.PATH!, HOME: dir }, stdio: ["pipe", "pipe", "pipe"] });
    },
    stop() {},
  };
}
const FAKE = 'const fs = require("node:fs"); const dir = process.env.HOME + "/.codex/sessions/2026/11/19"; fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(dir + "/rollout-x-th-1.jsonl", JSON.stringify({ type: "session_meta", payload: { id: "th-1" } }) + "\\n");\nconst input = await Bun.stdin.text(); const resume = process.argv.includes("resume"); const out = (o) => fs.writeSync(1, JSON.stringify(o) + "\\n");\nout({ type: "thread.started", thread_id: "th-1" }); out({ type: "turn.started" });\nif (process.env.ASK !== "0" && !resume) { out({ type: "item.completed", item: { id: "call_q1", type: "agent_message", text: "' + Q1 + '" } }); out({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "I asked above." } }); }\nelse out({ type: "item.completed", item: { id: "i2", type: "agent_message", text: resume ? "Thanks: " + input.trim() : "A plan with no question." } });\nout({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 3, reasoning_output_tokens: 1 } });';

describe("questions", () => {
  test("a question asked through Codex reaches the closing loop as reply text, the simulator's answer goes back by exec resume, and the session continues", async () => {
    const s = fakeSession(FAKE);
    const seen: string[][] = [];
    const d = solDriver({ ...o, out: tmp(), nextUser: async (texts) => (seen.push(texts), seen.length === 1 ? { reply: "Two bakeries paid." } : { end: true }) });
    const r = await d.run(s as any, { id: "ohr", prompt: "$office-hours hi" } as any, 60_000);
    expect(seen).toEqual([[Q1, "I asked above."], ["Thanks: Two bakeries paid."]]);
    expect(r.termination).toEqual({ kind: "completed" });
    const execs = s.spawned.filter((a) => a.includes(CODEX.bin));
    expect(execs).toHaveLength(2);
    expect(execs[1]!.slice(-3)).toEqual(["resume", "th-1", "-"]);
    expect(r.usage).toEqual({ input: 6, output: 2, reasoning: 1, cache_read: 4, cache_write: 0 });
  });
  test("a reply that starts more tool items than the cap is killed and ends the session as a turn cap, before the loop is asked", async () => {
    const s = fakeSession(FAKE.replace('out({ type: "turn.started" });', 'out({ type: "turn.started" }); for (let i = 0; i < 3; i++) out({ type: "item.started", item: { id: "c" + i, type: "command_execution" } }); await Bun.sleep(5000);'));
    const seen: string[][] = [];
    const d = solDriver({ ...o, out: tmp(), maxToolItems: 2, nextUser: async (texts) => (seen.push(texts), { end: true }) });
    const r = await d.run(s as any, { id: "ohr", prompt: "hi" } as any, 60_000);
    expect(r.termination).toEqual({ kind: "turn_cap" });
    expect(r.agent_turns).toBe(3);
    expect(seen).toEqual([]);
  });
  test("a session with no question ends after one exec when the loop ends it, and reads as done", async () => {
    const s = fakeSession(FAKE.replace('process.env.ASK !== "0"', "false"));
    const seen: string[][] = [];
    const d = solDriver({ ...o, out: tmp(), nextUser: async (texts) => (seen.push(texts), { end: true }) });
    const r = await d.run(s as any, { id: "ohr", prompt: "hi" } as any, 60_000);
    expect(seen).toEqual([["A plan with no question."]]);
    expect(r.termination).toEqual({ kind: "completed" });
    expect(s.spawned.filter((a) => a.includes(CODEX.bin))).toHaveLength(1);
  });
});
