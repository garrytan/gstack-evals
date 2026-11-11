// Copyright (c) 2026 Garry Tan. MIT License.
// One PF session's Harbor run copy (run.ts runCopy) and the pf-session.v1 record it reads back from pf_agent's
// pf-summary.json (run.ts pfRecord): the end rules of both turns, the whole-session retry and the tree-check refusal.
// Keyless and docker-free: a hand-made unit dir and a made-up session image.
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CODES } from "../../src/errors/codes.ts";
import type { SessionImage } from "../../lanes/outcome-skills/statemachines/image.ts";
import { sessionLimits, type PfArm } from "../../lanes/outcome-skills/pfchecks/arms.ts";
import { OPUS, P1 } from "../../lanes/outcome-skills/pfchecks/items.ts";
import { PSTACK_DIR, pstackVolume } from "../../lanes/outcome-skills/pfchecks/pstack.ts";
import { BOUNDS, TASK_RERUN, finishSession, harbor, pfRecord, retriesSession, retryAfter, runCopy, runPfSession, sessionBudget, type PfRunInput } from "../../lanes/outcome-skills/pfchecks/run.ts";
import { toolsVolume } from "../../lanes/outcome-skills/pfchecks/tools.ts";
import { main as pfMain } from "../../lanes/outcome-skills/pfchecks/cli.ts";
import { DOCKER_ENV } from "../../lanes/real-outcome/task/docker.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const sha = (b: string) => createHash("sha256").update(b).digest("hex");
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};

function unitDir(): string {
  const dir = temp("pf-run-unit-");
  const body: Record<string, string> = {
    "fix.patch": "", "test.patch": "", "issue.md": "The flag is never reset.\n", "parser.py": "", "harbor/task.toml": 'version = "1.0"\n\n[environment]\ndocker_image = "old"\ncpus = 2\n',
    "harbor/environment/Dockerfile": "FROM scratch\n", "harbor/instruction.md": "invented",
  };
  for (const [p, b] of Object.entries(body)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), b);
  }
  const u = {
    schema: "sm-unit.v1", id: "pf-run-flag", lang: "go", base_commit: "b".repeat(40), repo_dir: "/w", work_dir: "/w", image: { ref: "example/fixture@sha256:" + "c".repeat(64), image_id: "sha256:" + "c".repeat(64), runtime_id: "sha256:" + "c".repeat(64) },
    tests: { f2p: ["t1"], p2p: ["t2"] }, files: Object.fromEntries(Object.entries(body).map(([p, b]) => [p, sha(b)])),
  };
  writeFileSync(join(dir, "unit.json"), JSON.stringify(u));
  return dir;
}

const image: SessionImage = { image_id: "sha256:" + "e".repeat(64), tag: "pf-session:test", runtime_id: "sha256:" + "c".repeat(64), volume: "v", commits: 1, head: "a".repeat(40), home: "none", tree_patch_sha256: null, qa_home: null };
const input = (arm: PfArm, model = OPUS): PfRunInput => ({ unitDir: unitDir(), session: { unit: "pf-run-flag", part: 0, index: 3, model, arm, item: "pf-opus" }, names: "short", control: "http://127.0.0.1:9", proxy: "172.17.0.1:9001", out: "/unused", volume: "v", claude: "/opt/claude", probeNode: "", effort: null });
const ak = (argv: string[]): Record<string, string> => Object.fromEntries(argv.flatMap((a, i) => (argv[i - 1] === "--ak" ? [[a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]] : [])));

test("runCopy writes the run copy naming the session image, the pf config and the overlay, with no provider key", () => {
  const i = input("P");
  const dir = temp("pf-run-copy-");
  const { argv, env, config } = runCopy(i, image, 1, dir);
  expect(argv.slice(0, 7)).toEqual(["run", "-y", "-p", join(dir, "task"), "-a", "pf_agent:PfAgent", "-m"]);
  expect(argv[argv.indexOf("-m") + 1]).toBe("anthropic/claude-opus-5-5");
  expect(argv[argv.indexOf("--base-url") + 1]).toBe("http://172.17.0.1:9001");
  expect(argv[argv.indexOf("--job-name") + 1]).toEndWith("-a1");
  expect(argv).toContain("--disable-verification");
  expect(argv.filter((a) => a === "--extra-docker-compose").length).toBe(2);
  const k = ak(argv);
  expect(k).toMatchObject({ skip_install: "true", arm: "pf:P", upstream_model: OPUS, control_url: i.control, ledger: "u4", task_label: "pf-run-flag/" + OPUS + "/P/3", trial_n: "1", image_id: image.image_id, repo_dir: "/w", workdir: "/w", probe_node: "" });
  expect(k.rerun).toBeUndefined();
  expect(sha(readFileSync(k.manifest!, "utf8"))).toBe(k.manifest_sha256!);
  expect(JSON.parse(readFileSync(k.task_json!, "utf8"))).toEqual({ repo_dir: "/w", commits: 1, base_commit: image.head, kind: "PF" });
  const toml = readFileSync(join(dir, "task/task.toml"), "utf8");
  expect(toml).toContain('[environment]\ndocker_image = "pf-session:test"\ncpus = 2');
  expect(toml).not.toContain('"old"');
  expect(readFileSync(join(dir, "task/environment/Dockerfile"), "utf8")).toBe("FROM pf-session:test\n");

  expect(env.ANTHROPIC_API_KEY).toBe("placeholder-not-a-key");
  expect(env.HARBOR_TELEMETRY).toBe("0");
  expect(Object.keys(env).filter((n) => /_KEY$|_TOKEN$/.test(n))).toEqual(["ANTHROPIC_API_KEY"]);
  expect(env.PYTHONPATH!.split(":")[0]).toEndWith("lanes/outcome-skills/pfchecks");

  const pf = JSON.parse(readFileSync(k.pf_config!, "utf8"));
  expect(pf).toEqual(JSON.parse(JSON.stringify(config)));
  expect(pf.limits).toEqual(sessionLimits("P", OPUS));
  expect(pf.limits.wrapup.allowance_usd).toBe(13);
  expect(pf.plugin).toBe(PSTACK_DIR);
  expect(pf.task_text).toStartWith("/create-formal-verification-skill ");
  expect(pf.task_text).toContain("The flag is never reset.");
  expect(pf.env).toMatchObject({ CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "2", HOME: "/root" });
  const overlay = JSON.parse(readFileSync(join(dir, "pf.compose.yaml"), "utf8"));
  expect(overlay.services.main.volumes.map((v: any) => [v.source, v.target, v.read_only])).toEqual([[toolsVolume(), "/opt/pf-tools", true], [pstackVolume(), PSTACK_DIR, true], ["/opt/claude", "/usr/local/bin/claude", true]]);
  expect(Object.keys(overlay.volumes)).toEqual([toolsVolume(), pstackVolume()]);
});

test("runCopy's attempt 2 names its rerun, and an arm with no plugin mounts no pstack volume", () => {
  const dir = temp("pf-run-copy-");
  const { argv, config } = runCopy(input("N", P1), image, 2, dir);
  expect(ak(argv).rerun).toBe(TASK_RERUN);
  expect(argv[argv.indexOf("-m") + 1]).toBe("anthropic/particle-ai/particle-1");
  expect(argv[argv.indexOf("--job-name") + 1]).toEndWith("-a2");
  expect(config.plugin).toBeNull();
  expect(config.limits.wrapup.allowance_usd).toBe(0.5);
  const overlay = JSON.parse(readFileSync(join(dir, "pf.compose.yaml"), "utf8"));
  expect(overlay.services.main.volumes.map((v: any) => v.source)).toEqual([toolsVolume(), "/opt/claude"]);
  const haiku = input("N");
  expect(() => runCopy({ ...haiku, session: { ...haiku.session, model: "claude-haiku-5-5" } }, image, 1, temp("pf-run-copy-"))).toThrow("E_PF_ARM");
});

test("runCopy gives the blind probe its one-line scope and refuses a blind session with none", () => {
  const blind = { ...input("blind"), session: { ...input("blind").session, item: "pf-blind" }, scope: "flag/" };
  const { config } = runCopy(blind, image, 1, temp("pf-run-copy-"));
  expect(config.task_text).toStartWith("/create-formal-verification-skill model the state machines in flag/, one skill per subsystem");
  expect(config.task_text).not.toContain("The flag is never reset.");
  expect(config.plugin).toBe(PSTACK_DIR);
  expect(() => runCopy({ ...blind, scope: undefined }, image, 1, temp("pf-run-copy-"))).toThrow("E_PF_ARM");
  expect(() => runCopy({ ...blind, scope: "flag/\nmore" }, image, 1, temp("pf-run-copy-"))).toThrow("E_PF_ARM");
});

const turn = (termination: string, refused: string[] = [], allowance_stops = 0, finalized?: boolean) => ({ termination, refused, allowance_stops, wall_s: 12.5, ...(finalized === undefined ? {} : { finalized }) });
const slot = (phase: string, spent: number, rerun: string | null = null, first?: Record<string, unknown> | null, bound?: number) => ({ phase, rerun, id: "ses_" + phase + spent, allowance_micros: 1, close: { spent_micros: spent, ...(first !== undefined ? { first_request: first } : {}), ...(bound !== undefined ? { reservation_bound: bound } : {}) } });
const summary = (o: { task?: unknown; wrapup?: unknown[]; slots?: unknown[] }) => ({
  task: o.task ?? null, wrapup: o.wrapup ?? [], slots: o.slots ?? [],
  capture: "PF_CAPTURE changed=1 deleted=0 forced=0 head=" + "a".repeat(40) + "\n", keep: "PF_WRAPUP checks=1 discarded=1\nPF_DISCARD checks/late_test.sh\n",
  events: [{ event: "u4_slot", lease_id: "pf-opus.0001.abcdef" }], questions: { task: { ask_user_question: 1, prose_questions: 2 }, wrapup: { ask_user_question: 0, prose_questions: 1 } },
});

test("pfRecord: a completed session scores, with each turn's spend, the lease, the discard and the questions", () => {
  const r = pfRecord(input("P"), 1, summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 41_200, null, { thinking: { type: "adaptive" }, output_config: null, reasoning: null, reasoning_effort: null, effort: null }), slot("wrapup", 10_300, null, { thinking: { type: "disabled" } })] }), null);
  expect(r).toMatchObject({ schema: "pf-session.v1", unit: "pf-run-flag", index: 3, model: OPUS, arm: "P", item: "pf-opus", attempt: 1, lease_id: "pf-opus.0001.abcdef", gap: null, wrapup_end: "completed", plugin: PSTACK_DIR, tools: toolsVolume() });
  expect(r.task).toEqual({ end: "completed", turns: null, wall_ms: 12_500, spent_micros: 41_200 });
  expect(r.wrapup).toEqual({ ends: ["completed"], turns: null, spent_micros: 10_300 });
  expect(r.discarded).toEqual(["checks/late_test.sh"]);
  expect(r.questions).toEqual({ ask_user_question: 1, prose: 3 });
  expect(r.effort).toMatchObject({ thinking: { type: "adaptive" }, effort: null });
  expect(r.checks).toBeNull();
  expect(r.s).toBeNull();
  expect(r.in_flight).toEqual({ reservation_bound: 0, subagents: 0, subagent_cap_refused: 0 });
  expect(r.env).toEqual({ CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "2" });
  expect(retriesSession(summary({ task: turn("completed") }), r)).toBe(false);
});

test("pfRecord counts reservation-bound refusals from each slot's close answer, and subagent spawns and cap refusals from the SDK stream", () => {
  const ev = temp("pf-run-ev-");
  const spawn = (id: string) => ({ type: "AssistantMessage", phase: "task", content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: "Explore", prompt: "look", run_in_background: true } }] });
  const result = (id: string, text: string, is_error = false) => ({ type: "UserMessage", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] });
  const lines = [spawn("a1"), result("a1", "Async agent launched"), spawn("a2"), spawn("a3"), result("a3", "Concurrent subagent limit reached. You can run 2 subagents at once. Do not retry.", true), { type: "AssistantMessage", phase: "wrapup", content: [{ type: "tool_use", id: "t1", name: "Task", input: {} }] }];
  writeFileSync(join(ev, "sdk-messages.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const r = pfRecord(input("P"), 1, summary({ task: turn("completed", ["E_ALLOWANCE"], 2), wrapup: [turn("completed")], slots: [slot("task", 41_200, null, undefined, 2), slot("wrapup", 10_300, null, undefined, 1)] }), ev);
  expect(r.in_flight).toEqual({ reservation_bound: 3, subagents: 4, subagent_cap_refused: 1 });
});

test("pfRecord: a limit in either turn still scores, and a wrap-up time or turn limit is the scored wrap-up end", () => {
  const i = input("C");
  expect(pfRecord(i, 1, summary({ task: turn("wall_limit"), wrapup: [turn("completed")] }), null)).toMatchObject({ task: { end: "limit_wall" }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed", ["E_ALLOWANCE"], 1), wrapup: [turn("completed")] }), null)).toMatchObject({ task: { end: "limit_allowance" }, gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("turn_ceiling")] }), null)).toMatchObject({ wrapup_end: "limit_turns", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("wall_limit")] }), null)).toMatchObject({ wrapup_end: "limit_wall", gap: null });
});

test("pfRecord: a wrap-up turn refused for its allowance, by the proxy or at the driver's open, is gap E_PF_WRAPUP_ALLOWANCE with no rerun and no session retry", () => {
  const i = input("P");
  const proxy = summary({ task: turn("completed"), wrapup: [turn("error_result", ["E_ALLOWANCE"], 1)], slots: [slot("task", 10), slot("wrapup", 2)] });
  const a = pfRecord(i, 1, proxy, null);
  expect(a).toMatchObject({ attempt: 1, task: { end: "completed" }, wrapup: { ends: ["limit_allowance"], spent_micros: 2 }, wrapup_end: null, gap: "E_PF_WRAPUP_ALLOWANCE" });
  expect(retriesSession(proxy, a)).toBe(false);
  const open = summary({ task: turn("completed"), wrapup: [{ termination: "open_refused", refused: ["CAP_STOP"], wall_s: 0 }], slots: [slot("task", 10), { phase: "wrapup", rerun: null, id: null, allowance_micros: null, close: null, open_refused: "409 CAP_STOP" }] });
  const b = pfRecord(i, 1, open, null);
  expect(b).toMatchObject({ wrapup: { ends: ["limit_allowance"], spent_micros: 0 }, wrapup_end: null, gap: "E_PF_WRAPUP_ALLOWANCE" });
  expect(retriesSession(open, b)).toBe(false);
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result"), { termination: "open_refused", refused: ["CAP_STOP"], wall_s: 0 }] }), null)).toMatchObject({ wrapup: { ends: ["upstream", "limit_allowance"] }, gap: "E_PF_WRAPUP_ALLOWANCE" });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("completed", ["E_ALLOWANCE"], 1)] }), null)).toMatchObject({ wrapup_end: null, gap: "E_PF_WRAPUP_ALLOWANCE" });
});

test("pfRecord: only the proxy's allowance stop count makes an allowance end; an E_ALLOWANCE refusal for anything else (a model off the allowlist, a body that is not JSON) does not", () => {
  const i = input("P");
  expect(pfRecord(i, 1, summary({ task: turn("completed", ["E_ALLOWANCE"]), wrapup: [turn("completed")] }), null)).toMatchObject({ task: { end: "completed" }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("error_result", ["E_ALLOWANCE"]), wrapup: [] }), null)).toMatchObject({ task: { end: "upstream" } });
  expect(pfRecord(i, 1, summary({ task: turn("error_result", ["E_ALLOWANCE"], 1), wrapup: [turn("completed")] }), null)).toMatchObject({ task: { end: "limit_allowance" }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("completed", ["E_ALLOWANCE"])] }), null)).toMatchObject({ wrapup: { ends: ["completed"] }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result", ["E_ALLOWANCE"]), turn("completed")] }), null)).toMatchObject({ wrapup: { ends: ["upstream", "completed"] }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result", ["E_ALLOWANCE"], 1)] }), null)).toMatchObject({ wrapup: { ends: ["limit_allowance"] }, gap: "E_PF_WRAPUP_ALLOWANCE" });
});

// Value: protects=sections 5 and 6.8's end kinds when the driver's proxy finalize fails; fails_when=a turn with unknown counts scores by its own termination, or an allowance stop on such a turn reads as infra and gets a second attempt; why_new=the state machines eval's finalized flag, ordered after the allowance stop; seam=run.ts pfRecord over pf_turns.py's turn finalized; no_claim=the driver's close answer (pf-driver.test.ts)
test("pfRecord: a turn whose proxy finalize failed is an infra end, read after its allowance stop, so a turn that also counts an allowance stop keeps its allowance end and is never retried", () => {
  const i = input("P");
  const lost = summary({ task: turn("completed", [], 0, false), slots: [slot("task", 9)] });
  const a1 = pfRecord(i, 1, lost, null);
  expect(a1).toMatchObject({ task: { end: "infra" }, wrapup: null, gap: "E_PF_INFRA_GAP" });
  expect(pfRecord(i, 2, lost, null)).toMatchObject({ attempt: 2, task: { end: "infra" }, gap: "E_PF_INFRA_GAP" });
  expect(pfRecord(i, 1, summary({ task: turn("completed", [], 0, true), wrapup: [turn("completed", [], 0, true)] }), null)).toMatchObject({ task: { end: "completed" }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("completed", [], 0, false)] }), null)).toMatchObject({ wrapup: { ends: ["infra"] }, wrapup_end: null, gap: "E_PF_INFRA_GAP" });
  const both = summary({ task: turn("error_result", ["E_ALLOWANCE"], 1, false), wrapup: [turn("completed")] });
  const b = pfRecord(i, 1, both, null);
  expect(b).toMatchObject({ task: { end: "limit_allowance" }, wrapup_end: "completed", gap: null });
  expect(retriesSession(both, b)).toBe(false);
  const wrapBoth = summary({ task: turn("completed"), wrapup: [turn("error_result", ["E_ALLOWANCE"], 1, false)] });
  const w = pfRecord(i, 1, wrapBoth, null);
  expect(w).toMatchObject({ wrapup: { ends: ["limit_allowance"] }, wrapup_end: null, gap: "E_PF_WRAPUP_ALLOWANCE" });
  expect(retriesSession(wrapBoth, w)).toBe(false);
});

// Value: protects=the Captain's ruling that a failed proxy finalize is a harness fault to read before any retry; fails_when=a slot with unknown counts gets the automatic fresh-container retry, or a retry starts on attempt 2's slot, or a slot that counts an allowance stop halts; why_new=today's in-process proxy never reports finalized false, so one that does is a fault, not an infra end to retry; seam=run.ts retryAfter, which runPfSession calls after every attempt; no_claim=the driver's halt of the stage (pf-driver.test.ts)
test("a slot whose proxy finalize failed halts the session with E_PF_FINALIZE_HALT before its fresh-container retry; a slot that also counts an allowance stop does not halt", async () => {
  const i = input("P");
  const lostSlot = (phase: string, stops: number | null = null) => ({ ...slot(phase, 9), id: "ses_lost_" + phase, close: { spent_micros: 9, finalized: false, allowance_stops: stops } });
  const task = summary({ task: turn("completed", [], 0, false), slots: [lostSlot("task")] });
  const a1 = pfRecord(i, 1, task, null);
  expect(retriesSession(task, a1)).toBe(true);
  await expect(retryAfter(i, 1, task, a1, "/out/a1")).rejects.toThrow(/^E_PF_FINALIZE_HALT pf-run-flag\/claude-opus-5-5\/P\/3 attempt 1: the proxy's finalize failed at the close of session ses_lost_task on lease pf-opus\.0001\.abcdef/);
  const wrap = summary({ task: turn("completed"), wrapup: [turn("completed", [], 0, false)], slots: [slot("task", 4), lostSlot("wrapup")] });
  await expect(retryAfter(i, 1, wrap, pfRecord(i, 1, wrap, null), "/out/a1")).rejects.toThrow("session ses_lost_wrapup");
  await expect(retryAfter(i, 2, task, pfRecord(i, 2, task, null), "/out/a2")).rejects.toThrow("E_PF_FINALIZE_HALT");
  const upstream = summary({ task: turn("error_result"), slots: [{ ...slot("task", 5), close: { spent_micros: 5, finalized: true } }] });
  expect(await retryAfter(i, 1, upstream, pfRecord(i, 1, upstream, null), "/out/a1")).toBe(true);
  expect(await retryAfter(i, 2, upstream, pfRecord(i, 2, upstream, null), "/out/a2")).toBe(false);
  const both = summary({ task: turn("error_result", ["E_ALLOWANCE"], 1, false), wrapup: [turn("completed")], slots: [lostSlot("task", 1), slot("wrapup", 2)] });
  expect(await retryAfter(i, 1, both, pfRecord(i, 1, both, null), "/out/a1")).toBe(false);
});

// Value: protects=the Captain's ruling on #324's red-team#2: a Harbor kill after a turn opened may already have been charged, so it halts as a failed finalize does; fails_when=an attempt run.ts killed at its timeout after pf_turns recorded a slot open, with no summary, gets the whole-session retry, or a kill before any open, an attempt that ended on its own, or a killed attempt that still wrote its summary halts; why_new=a kill leaves no pf-summary.json, and pfRecord read that as an infra end and retried the whole session; seam=run.ts retryAfter over the evaluator dir's pf-opens.jsonl; no_claim=that pf_turns writes the line before each open (pf_agent_sdk_test.py)
test("an attempt run.ts killed at its timeout after a slot open, with no summary, halts with E_PF_FINALIZE_HALT instead of retrying the whole session", async () => {
  const i = input("P");
  const ev = temp("pf-run-ev-");
  const none = pfRecord(i, 1, null, ev);
  const killed = "Harbor was killed at its timeout";
  expect(await retryAfter(i, 1, null, none, "/out/a1", killed, ev)).toBe(true);
  writeFileSync(join(ev, "pf-opens.jsonl"), JSON.stringify({ phase: "task", rerun: null, at: 3.1 }) + "\n");
  await expect(retryAfter(i, 1, null, none, "/out/a1", killed, ev)).rejects.toThrow(/^E_PF_FINALIZE_HALT pf-run-flag\/claude-opus-5-5\/P\/3 attempt 1: Harbor was killed at its timeout after pf_turns opened a slot/);
  await expect(retryAfter(i, 2, null, pfRecord(i, 2, null, ev), "/out/a2", killed, ev)).rejects.toThrow("E_PF_FINALIZE_HALT");
  const done = summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 4), slot("wrapup", 2)] });
  expect(await retryAfter(i, 1, done, pfRecord(i, 1, done, null), "/out/a1", killed, ev)).toBe(false);
});

test("harbor() says whether its timer killed Harbor", async () => {
  const dir = temp("pf-run-harbor-");
  const bin = join(dir, "harbor");
  writeFileSync(bin, "#!/bin/sh\n[ \"$1\" = slow ] && exec sleep 30\necho done\n", { mode: 0o755 });
  expect(await harbor(bin, ["slow"], {}, 300, join(dir, "slow.log"))).toEqual({ exit: 1, killed: true });
  expect(await harbor(bin, ["fast"], {}, 10_000, join(dir, "fast.log"))).toEqual({ exit: 0, killed: false });
  expect(readFileSync(join(dir, "fast.log"), "utf8")).toBe("done\n");
});

test("pfRecord: effort is the task slot's proxy record; with the dry run's record, a match scores and a missing or different record is an infra gap", () => {
  const rec = { thinking: { type: "adaptive" }, output_config: null, reasoning: null, reasoning_effort: null, effort: null };
  const i = { ...input("N"), effort: { [OPUS]: rec } };
  const run = (first?: Record<string, unknown> | null) => pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 10, null, first), slot("wrapup", 2, null, rec)] }), null);
  expect(run({ thinking: { type: "adaptive" } })).toMatchObject({ gap: null, effort: rec, wrapup_end: "completed" });
  expect(run(null)).toMatchObject({ gap: "E_PF_INFRA_GAP", effort: null });
  expect(run()).toMatchObject({ gap: "E_PF_INFRA_GAP", effort: null });
  expect(run({ thinking: { type: "adaptive" }, output_config: { effort: "high" } })).toMatchObject({ gap: "E_PF_INFRA_GAP", effort: { output_config: { effort: "high" } } });
  expect(pfRecord({ ...i, session: { ...i.session, model: P1 } }, 1, summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 10, null, rec)] }), null).gap).toBe("E_PF_INFRA_GAP");
  expect(pfRecord({ ...i, effort: null }, 1, summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 10)] }), null)).toMatchObject({ gap: null, effort: null });
  expect(pfRecord(i, 1, { refused: "E_PF_ARM the tree holds CLAUDE.md", task: null, wrapup: [], slots: [], events: [] }, null).gap).toBe("E_PF_ARM");
});

test("pfRecord: an upstream task end retries the whole session once, and a second upstream end is a gap", () => {
  const i = input("P");
  const s1 = summary({ task: turn("error_result"), slots: [slot("task", 5)] });
  const a1 = pfRecord(i, 1, s1, null);
  expect(a1).toMatchObject({ task: { end: "upstream" }, wrapup: null, wrapup_end: null, gap: "E_PF_INFRA_GAP" });
  expect(retriesSession(s1, a1)).toBe(true);
  expect(retriesSession(null, pfRecord(i, 1, summary({ task: turn("stopped", ["UPSTREAM"]) }), null))).toBe(true);
  expect(pfRecord(i, 2, summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 7, "x"), slot("wrapup", 3)] }), null)).toMatchObject({ attempt: 2, task: { end: "completed", spent_micros: 7 }, gap: null, wrapup_end: "completed" });
  expect(pfRecord(i, 2, summary({ task: turn("error_result") }), null)).toMatchObject({ attempt: 2, gap: "E_PF_UPSTREAM_GAP" });
});

test("pfRecord: an attempt with no summary or a harness error is an infra end, retried once, then an infra gap", () => {
  const i = input("N");
  const none = pfRecord(i, 1, null, null);
  expect(none).toMatchObject({ task: { end: "infra", wall_ms: 0, spent_micros: 0 }, wrapup: null, gap: "E_PF_INFRA_GAP", lease_id: "", capture: null, discarded: [] });
  expect(retriesSession(null, none)).toBe(true);
  expect(pfRecord(i, 1, summary({ task: turn("error") }), null).task.end).toBe("infra");
  expect(pfRecord(i, 2, null, null)).toMatchObject({ attempt: 2, gap: "E_PF_INFRA_GAP" });
});

test("a task open refused with 409 CAP_STOP (the agent's LedgerCapStop, as Harbor records it) ends the part as a cap stop, with no session retry and no gap", () => {
  const i = input("P");
  for (const attempt of [1, 2] as const) {
    const r = pfRecord(i, attempt, null, null, "LedgerCapStop");
    expect(r).toMatchObject({ attempt, cap_stop: true, gap: null, wrapup: null, wrapup_end: null, s: null });
    expect(retriesSession(null, r)).toBe(false);
    const file = join(temp("pf-run-cap-"), "session.json");
    expect(() => finishSession(file, r)).toThrow(/^CAP_STOP /);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ cap_stop: true, gap: null, attempt });
  }
});

test("a task turn that ends for an infra reason other than a cap stop still retries once and reads E_PF_INFRA_GAP on a second failure", () => {
  const i = input("C");
  for (const exception of [null, "LanebInfraError", "RuntimeError", "SandboxSetupError"]) {
    const a1 = pfRecord(i, 1, null, null, exception);
    expect(a1).toMatchObject({ cap_stop: false, task: { end: "infra" }, gap: "E_PF_INFRA_GAP" });
    expect(retriesSession(null, a1)).toBe(true);
    const a2 = pfRecord(i, 2, null, null, exception);
    expect(a2).toMatchObject({ cap_stop: false, attempt: 2, gap: "E_PF_INFRA_GAP" });
    const file = join(temp("pf-run-infra-"), "session.json");
    finishSession(file, a2);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ cap_stop: false, gap: "E_PF_INFRA_GAP" });
  }
});

test("pfRecord: a tree-check refusal before any slot is gap E_PF_ARM and takes no retry", () => {
  const s = { refused: "E_PF_ARM the tree holds CLAUDE.md, which no arm may read", task: null, wrapup: [], slots: [], events: [] };
  const r = pfRecord(input("C"), 1, s, null);
  expect(r).toMatchObject({ gap: "E_PF_ARM", task: { end: "infra", spent_micros: 0 }, wrapup: null, wrapup_end: null, lease_id: "" });
  expect(retriesSession(s, r)).toBe(false);
  expect(retriesSession({ ...s, refused: "E_REAL_SANDBOX_SETUP no container" }, r)).toBe(true);
});

test("pfRecord: a wrap-up upstream or infra end reruns the wrap-up once on the saved S, and a second is a gap", () => {
  const i = input("P");
  const rerun = pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result"), turn("completed")], slots: [slot("task", 10), slot("wrapup", 2), slot("wrapup", 3, "wrapup_upstream")] }), null);
  expect(rerun).toMatchObject({ wrapup: { ends: ["upstream", "completed"], spent_micros: 5 }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error"), turn("wall_limit")] }), null)).toMatchObject({ wrapup: { ends: ["infra", "limit_wall"] }, wrapup_end: "limit_wall", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result"), turn("error_result")] }), null)).toMatchObject({ wrapup_end: null, gap: "E_PF_UPSTREAM_GAP" });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result"), turn("error")] }), null)).toMatchObject({ gap: "E_PF_INFRA_GAP" });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result")] }), null)).toMatchObject({ wrapup_end: null, gap: "E_PF_INFRA_GAP" });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [] }), null)).toMatchObject({ wrapup: null, gap: "E_PF_INFRA_GAP" });
});

// Value: protects=section 6.8's S custody from the task turn's capture to the exported bundle; fails_when=an S bundle whose HEAD is not the head capture.sh committed scores, retries, or leaves the session with no record, or the record drops the unit's base commit; why_new=the bundle was trusted as S whatever its HEAD; seam=run.ts pfRecord over the attempt's s.bundle; no_claim=S's root against the base commit (pf-score.test.ts)
test("pfRecord: an S bundle whose HEAD is not the head captured after the task turn is gap E_PF_ARM (head_mismatch) with no retry, and the record carries the unit's base commit", async () => {
  const repo = temp("pf-run-s-"), ev = temp("pf-run-ev-");
  const gitc = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" }).stdout.trim();
  gitc("init", "-q");
  gitc("commit", "-q", "--allow-empty", "-m", "session end");
  gitc("bundle", "create", join(ev, "s.bundle"), "HEAD");
  const head = gitc("rev-parse", "HEAD");
  const i = input("C");
  const at = (h: string) => ({ ...summary({ task: turn("completed"), wrapup: [turn("completed")] }), capture: "PF_CAPTURE changed=1 deleted=0 forced=0 head=" + h + "\n" });
  expect(pfRecord(i, 1, at(head), ev, null, image.head)).toMatchObject({ gap: null, gap_reason: null, base_commit: image.head, s: { repo: join(ev, "s.bundle"), ref: "HEAD" }, wrapup_end: "completed" });
  const moved = at("f".repeat(40));
  const bad = pfRecord(i, 1, moved, ev, null, image.head);
  expect(bad).toMatchObject({ gap: "E_PF_ARM", gap_reason: "head_mismatch", base_commit: image.head, wrapup_end: "completed" });
  expect(retriesSession(moved, bad)).toBe(false);
  expect(await retryAfter(i, 1, moved, bad, "/out/a1")).toBe(false);
  const file = join(temp("pf-run-head-"), "session.json");
  finishSession(file, bad);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ gap: "E_PF_ARM", gap_reason: "head_mismatch" });
  writeFileSync(join(ev, "s.bundle"), "not a bundle\n");
  expect(pfRecord(i, 1, at(head), ev, null, image.head)).toMatchObject({ gap: "E_PF_ARM", gap_reason: "head_mismatch" });
  expect(pfRecord(i, 1, { refused: "E_PF_ARM the tree holds CLAUDE.md", task: null, wrapup: [], slots: [], events: [] }, null)).toMatchObject({ gap: "E_PF_ARM", gap_reason: "tree_check" });
});

// Value: protects=section 5's end rules when wrapup.sh keep fails after a completed wrap-up turn; fails_when=such a session scores, retries, writes no session.json or stops the driver loop; why_new=the refusal left a no-gap record with no S, which writeSessionRecord refuses, so the run threw; seam=run.ts pfRecord, retryAfter and finishSession over pf_turns' summary (pf_agent_sdk_test.py drives the real keep failure); no_claim=the capture or reset steps
test("pfRecord: wrapup.sh keep failing after a completed wrap-up turn is gap E_PF_INFRA_GAP with no retry, and the session still gets its session.json", async () => {
  const i = input("C");
  const failed = { ...summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 10), slot("wrapup", 2)] }), keep: null, checks: false, refused: "E_PF_CAPTURE wrapup.sh keep exited 3: keep failed" };
  const r = pfRecord(i, 1, failed, temp("pf-run-ev-"), null, image.head);
  expect(r).toMatchObject({ gap: "E_PF_INFRA_GAP", gap_reason: null, s: null, wrapup: { ends: ["completed"] }, discarded: [], checks: null });
  expect(retriesSession(failed, r)).toBe(false);
  expect(await retryAfter(i, 1, failed, r, "/out/a1")).toBe(false);
  const file = join(temp("pf-run-keep-"), "session.json");
  finishSession(file, r);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ gap: "E_PF_INFRA_GAP", attempt: 1 });
  expect(pfRecord(i, 1, { ...failed, refused: undefined, keep: "PF_WRAPUP checks=0 discarded=0\n" }, null, null, image.head)).toMatchObject({ gap: null, wrapup_end: "completed" });
});

// Value: protects=sections 5 and 6.8's routing of a post-turn failure (#305's run notes item 4); fails_when=a capture, wrap-up or bundle step that failed on what the agent wrote (pf_turns' E_PF_ARM post_turn) reads as a tree-check refusal, gets a session retry or an infra gap, or a post-turn failure of either kind masks a wrap-up refused for its allowance; why_new=every post-turn failure was E_PF_INFRA_GAP, whatever its cause, and it masked E_PF_WRAPUP_ALLOWANCE; seam=run.ts pfRecord and retryAfter over pf_turns' summary (pf_agent_sdk_test.py drives the real failures); no_claim=state.sh's reading of the tree (pf-capture.test.ts)
test("pfRecord: a post-turn failure in what the agent wrote is gap E_PF_ARM with reason post_turn and no retry, and a post-turn failure of either kind leaves a wrap-up refused for its allowance E_PF_WRAPUP_ALLOWANCE", async () => {
  const i = input("C");
  const done = summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 10), slot("wrapup", 2)] });
  const keep = { ...done, keep: null, checks: false, refused: "E_PF_ARM post_turn wrapup.sh keep: lock .git/index.lock" };
  const r = pfRecord(i, 1, keep, temp("pf-run-ev-"), null, image.head);
  expect(r).toMatchObject({ gap: "E_PF_ARM", gap_reason: "post_turn", s: null, task: { end: "completed" }, wrapup: { ends: ["completed"] } });
  expect(retriesSession(keep, r)).toBe(false);
  expect(await retryAfter(i, 1, keep, r, "/out/a1")).toBe(false);
  const file = join(temp("pf-run-post-"), "session.json");
  finishSession(file, r);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ gap: "E_PF_ARM", gap_reason: "post_turn", attempt: 1 });
  const capture = { ...summary({ task: turn("wall_limit"), slots: [slot("task", 10)] }), capture: null, keep: null, refused: "E_PF_ARM post_turn capture.sh commit: missing inv" };
  const c = pfRecord(i, 1, capture, null, null, image.head);
  expect(c).toMatchObject({ gap: "E_PF_ARM", gap_reason: "post_turn", task: { end: "limit_wall" }, wrapup: null });
  expect(retriesSession(capture, c)).toBe(false);
  const stopped = (refused: string) => ({ ...summary({ task: turn("completed"), wrapup: [turn("error_result", ["E_ALLOWANCE"], 1)], slots: [slot("task", 10), slot("wrapup", 2)] }), keep: null, checks: false, refused });
  for (const refused of ["E_PF_ARM post_turn wrapup.sh keep: missing s.head", "E_PF_CAPTURE wrapup.sh keep exited 1: no s.head", "E_PF_CAPTURE bundle exited 128: fatal"]) {
    const w = stopped(refused);
    const rec = pfRecord(i, 1, w, null, null, image.head);
    expect([refused, rec.gap, rec.gap_reason, rec.wrapup?.ends]).toEqual([refused, "E_PF_WRAPUP_ALLOWANCE", null, ["limit_allowance"]]);
    expect(retriesSession(w, rec)).toBe(false);
  }
  const open = { ...summary({ task: turn("completed"), wrapup: [{ termination: "open_refused", refused: ["CAP_STOP"], wall_s: 0 }], slots: [slot("task", 10)] }), keep: null, refused: "E_PF_ARM post_turn wrapup.sh keep: lock .git/index.lock" };
  expect(pfRecord(i, 1, open, null, null, image.head)).toMatchObject({ gap: "E_PF_WRAPUP_ALLOWANCE", gap_reason: null });
  expect(pfRecord(i, 1, { refused: "E_PF_ARM the session tree or home holds files the strip rule removes", task: null, wrapup: [], slots: [], events: [] }, null)).toMatchObject({ gap: "E_PF_ARM", gap_reason: "tree_check" });
});

// Value: protects=the Captain's ruling item 7 on #324 (p2/specialist-batched#1, p2/red-team#1): section 3's effort check compares every effort key, whoever calls runPfSession; fails_when=runPfSession takes an effort record with an entry that is a scalar, null, an array, an empty object, a partial object or one with another key, or makes its run dir first; why_new=effortFields read a missing key as null, so a malformed entry matched a session that sent no effort fields; seam=run.ts runPfSession; no_claim=session run's own refusal (pf-session-cli.test.ts)
test("runPfSession refuses an effort record with an entry that is a scalar, an empty object or a partial object before it makes its run dir", async () => {
  const full = { thinking: null, output_config: null, reasoning: null, reasoning_effort: null, effort: null };
  for (const [model, entry] of [[OPUS, 7], [OPUS, "high"], [OPUS, null], [OPUS, []], [OPUS, {}], [OPUS, { thinking: null }], [OPUS, { ...full, extra: 1 }], [P1, {}]] as const) {
    const out = join(temp("pf-run-effort-"), "s");
    const i: PfRunInput = { ...input("P"), unitDir: join(out, "..", "no-unit"), out, effort: { [OPUS]: full, [P1]: full, [model]: entry } as any };
    await expect(runPfSession(i)).rejects.toThrow(/^E_PF_INPUT the effort record is not the dry run's effort\.json: /);
    expect(existsSync(out)).toBe(false);
  }
});

// Value: protects=the Captain's ruling item 8 on #324: E_PF_ARM's docs entry fits its session gaps, which come after paid turns; fails_when=E_PF_ARM says it is refused before any spend or is retry safe, drops a gap reason the session record can carry, or changes its exit; why_new=the entry said "None: refused before any spend" and "retry safe" while post_turn, head_mismatch and base_mismatch gaps follow paid turns; seam=src/errors/codes.ts E_PF_ARM; no_claim=docs/errors.md (bun run errors:check)
test("E_PF_ARM's entry says its session gaps follow paid turns and are not retry safe, and keeps exit 2", () => {
  const e = CODES.E_PF_ARM;
  expect([e.exit, e.retry_safe]).toEqual([2, false]);
  expect(e.side_effects).not.toBe("None: refused before any spend.");
  for (const reason of ["tree_check", "post_turn", "head_mismatch", "base_mismatch"]) expect(e.meaning).toContain(reason);
});

// Value: protects=the Captain's ruling A(i) on #324: Harbor's agent phase outlasts section 4's session, so a task turn that runs to its wall still gets both wrap-up turns; fails_when=the run copy's task.toml keeps the unit's [agent] timeout_sec, or sets one the session's longest path (each step at its code timeout, each turn at its wall) passes before the last step ends; why_new=the unit's 5400 s agent timeout cut off a P, C or blind session at its task wall, before the capture and the wrap-up; seam=run.ts runCopy's task.toml; no_claim=that the code's constants are these (the budget's own drift test)
test("on a stub clock, the run copy's agent timeout lets a task turn run to its wall and both wrap-up turns run to theirs, and the unit's 5400 s does not", () => {
  const STEP = 600, OPEN = 3 * 30 + 2 * 2, CLOSE = 3 * 120 + 2 * 2, DISCONNECT = 30, WRAPUP = 300;
  const turn = (wall: number) => OPEN + wall + DISCONNECT + CLOSE;
  const phases = (taskWall: number): Array<[string, number]> => [
    ["pre-open", 2 * 60 + 3 * 120 + 60 + 120 + 3 * STEP], ["task turn", turn(taskWall)], ["capture", 2 * STEP], ["wrap-up 1", turn(WRAPUP)], ["reset", 2 * STEP],
    ["wrap-up 2", turn(WRAPUP)], ["keep", 2 * STEP], ["CHECKS.json", STEP], ["bundle", 2 * STEP + 60 + STEP], ["transcript", STEP],
  ];
  const reached = (timeout: number, taskWall: number) => {
    let clock = 0;
    const done: string[] = [];
    for (const [name, s] of phases(taskWall)) {
      clock += s;
      if (clock > timeout) break;
      done.push(name);
    }
    return done;
  };
  expect(reached(5400, 5400)).toEqual(["pre-open"]);
  for (const [arm, wall] of [["P", 5400], ["C", 5400], ["N", 3600], ["blind", 5400]] as const) {
    const i = { ...input(arm), ...(arm === "blind" ? { scope: "flag/" } : {}) };
    const toml = 'version = "1.0"\n\n[agent]\ntimeout_sec = 5400\n\n[verifier]\ntimeout_sec = 900\n\n[environment]\ndocker_image = "old"\n';
    writeFileSync(join(i.unitDir, "harbor/task.toml"), toml);
    const u = JSON.parse(readFileSync(join(i.unitDir, "unit.json"), "utf8"));
    u.files["harbor/task.toml"] = sha(toml);
    writeFileSync(join(i.unitDir, "unit.json"), JSON.stringify(u));
    const dir = temp("pf-run-clock-");
    runCopy(i, image, 1, dir);
    const written = readFileSync(join(dir, "task/task.toml"), "utf8");
    const agent = Number(written.match(/^\[agent\]\ntimeout_sec = (\d+)$/m)?.[1]);
    expect([arm, reached(agent, wall)]).toEqual([arm, phases(wall).map((p) => p[0])]);
    expect(written).toContain("[verifier]\ntimeout_sec = 900\n");
    expect(written.match(/timeout_sec/g)?.length).toBe(2);
  }
});

// Value: protects=the owner's ruling on adversarial-native#7: a task.toml header with a trailing comment is still a header; fails_when=the run copy appends a second [agent] table after a commented [agent] header, keeps the unit's agent timeout_sec, or drops the timeout_sec of a table whose header carries a comment; why_new=runCopy's header regexes ended at the closing bracket, so [agent] # comment read as no header, and Harbor got two [agent] tables; seam=run.ts runCopy's task.toml; no_claim=quoted or dotted table names
test("runCopy reads a task.toml header with a trailing comment as a header, so it sets one [agent] timeout and keeps the other tables'", () => {
  const i = input("P");
  const toml = 'version = "1.0"\n\n[agent] # Harbor\'s agent phase\ntimeout_sec = 5400\n\n[verifier]   # checks\ntimeout_sec = 900\n\n[environment]\ndocker_image = "old"\n';
  writeFileSync(join(i.unitDir, "harbor/task.toml"), toml);
  const u = JSON.parse(readFileSync(join(i.unitDir, "unit.json"), "utf8"));
  u.files["harbor/task.toml"] = sha(toml);
  writeFileSync(join(i.unitDir, "unit.json"), JSON.stringify(u));
  const dir = temp("pf-run-toml-");
  runCopy(i, image, 1, dir);
  const written = readFileSync(join(dir, "task/task.toml"), "utf8");
  const agentS = sessionBudget(sessionLimits("P", OPUS)).agent_s;
  expect(written.match(/^\s*\[agent\]/gm)?.length).toBe(1);
  expect(written).toContain("[agent] # Harbor's agent phase\ntimeout_sec = " + agentS + "\n");
  expect(written).toContain("[verifier]   # checks\ntimeout_sec = 900\n");
  expect(written.match(/timeout_sec/g)?.length).toBe(2);
});
// Value: protects=the Captain's ruling A(i) on #324: the session budget is the code's own bounds, not an estimate; fails_when=a timeout, retry count or wall the budget sums differs from the one in its source file, a post-turn container call or step is added without the budget counting it, the terms do not add up, or run.ts's timer does not sit above Harbor's agent timeout, agent setup and image build; why_new=Harbor's agent timeout was the unit's 5400 s and run.ts's timer a fixed 900 s over the walls; seam=run.ts BOUNDS and sessionBudget; no_claim=Harbor's own build_timeout_sec default (read from the pinned Harbor, not this repo)
test("the session budget sums the code's own timeouts, retries and walls, and run.ts's timer sits above Harbor's agent timeout", () => {
  const src = (p: string) => readFileSync(join(import.meta.dir, "../..", p), "utf8");
  const laneb = src("quick/laneb/runner/agent/laneb_agent.py"), egress = src("lanes/real-outcome/agent/egress.py"), agent = src("lanes/outcome-skills/pfchecks/pf_agent.py"), turns = src("lanes/outcome-skills/pfchecks/pf_turns.py");
  expect(laneb).toMatch(new RegExp("^PROBE_TIMEOUT_S = " + BOUNDS.probe_s + "$", "m"));
  expect(laneb).toMatch(new RegExp("^OPEN_ATTEMPTS = " + BOUNDS.tries + "$", "m"));
  expect(laneb).toMatch(new RegExp("^OPEN_RETRY_S = " + BOUNDS.sleep_s + "$", "m"));
  expect(laneb).toContain("def post_json(url: str, body: dict, timeout: float = " + BOUNDS.open_s + ")");
  expect(laneb).toContain("DEFAULT_SETUP_TIMEOUT_SEC = " + BOUNDS.setup_s + ".0");
  expect(egress).toContain('docker: str = "docker", timeout: float = ' + BOUNDS.egress_s + ")");
  expect(egress.match(/= _helper\(container|\[_helper\(container/g)?.length).toBe(2);
  expect(egress).toContain("exec_fn(container, script, None, " + BOUNDS.egress_probe_s + ")");
  expect(agent).toMatch(new RegExp("^CLOSE_TIMEOUT_S = " + BOUNDS.close_s + "$", "m"));
  expect(agent).toContain('f"{container}:{SH_DIR}"], capture_output=True, text=True, timeout=' + BOUNDS.copy_s + ")");
  expect(turns).toContain("def sh(self, script: str, *args: str, input: bytes | None = None, timeout: float = " + BOUNDS.step_s + ")");
  expect(turns).toMatch(new RegExp("^KILL_TIMEOUT_S = " + BOUNDS.kill_s + "$", "m"));
  expect(turns).toContain("wait_for(client.disconnect(), timeout=" + BOUNDS.disconnect_s + ")");
  expect(turns.match(/self\.sh\(/g)?.length).toBe(9);
  expect(turns.match(/= self\.script\(|\bself\.script\("wrapup|self\.step\("bundle"/g)?.length).toBe(4);
  for (const [arm, wall] of [["P", 5400], ["N", 3600]] as const) {
    const b = sessionBudget(sessionLimits(arm, OPUS));
    expect(b.terms.reduce((n, t) => n + t[1], 0)).toBe(b.agent_s);
    expect(b.agent_s).toBe(wall + 11784);
    expect(b.timer_ms).toBe((b.agent_s + BOUNDS.setup_s + BOUNDS.build_s + BOUNDS.margin_s) * 1000);
  }
});

// Value: protects=the Captain's ruling A(ii) on #324: any attempt that ends with no summary after pf_turns logged a slot open may have spent, so it halts, whatever ended it; fails_when=such an attempt gets the whole-session retry because run.ts did not kill it (Harbor's AgentTimeoutError, a crash, any other exit), the halt line does not say what ended it, or an attempt with no logged open halts; why_new=item 3 halted only on run.ts's own kill; seam=run.ts retryAfter; no_claim=how runPfSession names the end (its harbor exit, kill and result.json exception)
test("an attempt with no summary after a logged slot open halts with E_PF_FINALIZE_HALT whatever ended it", async () => {
  const i = input("C");
  const ev = temp("pf-run-ev-");
  const none = pfRecord(i, 1, null, ev);
  for (const ended of [null, "Harbor ended on AgentTimeoutError", "Harbor exited 1"]) expect(await retryAfter(i, 1, null, none, "/out/a1", ended, ev)).toBe(true);
  writeFileSync(join(ev, "pf-opens.jsonl"), JSON.stringify({ phase: "wrapup", rerun: null, at: 5410.2 }) + "\n");
  await expect(retryAfter(i, 1, null, none, "/out/a1", null, ev)).rejects.toThrow(/^E_PF_FINALIZE_HALT pf-run-flag\/claude-opus-5-5\/C\/3 attempt 1: the attempt ended after pf_turns opened a slot/);
  for (const ended of ["Harbor ended on AgentTimeoutError", "Harbor exited 1"]) await expect(retryAfter(i, 1, null, none, "/out/a1", ended, ev)).rejects.toThrow(new RegExp("attempt 1: " + ended + " after pf_turns opened a slot"));
});

// Value: protects=the owner's ruling A2: a task open the driver refused at the cap ends the part as a cap stop, while any other open with no summary still halts; fails_when=a cap stop whose only logged open is the task open halts with E_PF_FINALIZE_HALT or writes no session.json, or a cap stop with a second logged open or a lone wrap-up open line, or a task open line with no cap stop, does not halt; why_new=pf_turns logs the task open before DriverSlots.open raises LedgerCapStop, so no summary is written and retryAfter halted a normal cap stop; seam=run.ts retryAfter then finishSession over a real evaluator dir; no_claim=that a refused open reserves nothing (pf-driver.test.ts)
test("a cap stop whose only logged open is the task open ends as CAP_STOP with a session record; a second open line, a lone wrap-up line or no cap stop halts", async () => {
  const i = input("P");
  const ev = (...phases: string[]) => {
    const dir = temp("pf-run-ev-");
    writeFileSync(join(dir, "pf-opens.jsonl"), phases.map((phase) => JSON.stringify({ phase, rerun: null, at: 3.1 }) + "\n").join(""));
    return dir;
  };
  const ended = "Harbor ended on LedgerCapStop";
  for (const attempt of [1, 2] as const) {
    const dir = ev("task");
    const r = pfRecord(i, attempt, null, dir, "LedgerCapStop");
    expect(await retryAfter(i, attempt, null, r, "/out/a" + attempt, ended, dir)).toBe(false);
    const file = join(temp("pf-run-cap-"), "session.json");
    expect(() => finishSession(file, r)).toThrow(/^CAP_STOP /);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ cap_stop: true, gap: null, attempt });
  }
  for (const phases of [["task", "wrapup"], ["task", "task"], ["wrapup"]]) {
    const dir = ev(...phases);
    await expect(retryAfter(i, 1, null, pfRecord(i, 1, null, dir, "LedgerCapStop"), "/out/a1", ended, dir)).rejects.toThrow(/^E_PF_FINALIZE_HALT /);
  }
  const dir = ev("task");
  for (const exception of [null, "LanebInfraError", "RuntimeError"]) await expect(retryAfter(i, 1, null, pfRecord(i, 1, null, dir, exception), "/out/a1", "Harbor exited 1", dir)).rejects.toThrow(/^E_PF_FINALIZE_HALT /);
});

// Value: protects=the Captain's ruling C1 item 2 on #327: an open log run.ts cannot read in full counts as an open that may have happened, so the attempt stops the driver and halts; fails_when=a cap stop whose pf-opens.jsonl holds an unparseable line, a line that is not an object or a cut-off line after the task open, or whose log cannot be read, throws anything but E_PF_FINALIZE_HALT, skips POST /stop or takes the cap-stop exemption, or a well-formed lone task open line stops being exempt; why_new=JSON.parse threw a bare SyntaxError on one bad line, which skipped both the driver stop and E_PF_FINALIZE_HALT; seam=run.ts retryAfter over the evaluator dir's pf-opens.jsonl; no_claim=what the driver does with the stop (pf-driver.test.ts)
test("a cap stop whose open log has a malformed line or cannot be read stops the driver and halts with E_PF_FINALIZE_HALT, never the cap-stop exemption", async () => {
  const stops: string[] = [];
  const control = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname !== "/stop") return new Response("no route", { status: 404 });
      stops.push(await req.text());
      return Response.json({ stopping: true });
    },
  });
  try {
    const i = { ...input("P"), control: "http://127.0.0.1:" + control.port };
    const ended = "Harbor ended on LedgerCapStop";
    const task = JSON.stringify({ phase: "task", rerun: null, at: 3.1 });
    const logs: Array<(file: string) => void> = [(f) => writeFileSync(f, '{"phase": "ta\n'), (f) => writeFileSync(f, "null\n"), (f) => writeFileSync(f, task + '\n{"phase": "wr'), (f) => mkdirSync(f)];
    for (const write of logs) {
      const dir = temp("pf-run-ev-");
      write(join(dir, "pf-opens.jsonl"));
      const before = stops.length;
      await expect(retryAfter(i, 1, null, pfRecord(i, 1, null, dir, "LedgerCapStop"), "/out/a1", ended, dir)).rejects.toThrow(/^E_PF_FINALIZE_HALT pf-run-flag\/claude-opus-5-5\/P\/3 attempt 1: .*pf-run stopped the driver through POST /);
      expect(stops.length).toBe(before + 1);
    }
    const dir = temp("pf-run-ev-");
    writeFileSync(join(dir, "pf-opens.jsonl"), task + "\n");
    const before = stops.length;
    expect(await retryAfter(i, 1, null, pfRecord(i, 1, null, dir, "LedgerCapStop"), "/out/a1", ended, dir)).toBe(false);
    expect(stops.length).toBe(before);
  } finally {
    control.stop(true);
  }
});

// Value: protects=the Captain's ruling C1 item 3 on #327: pf-run's stop tells the driver it is a halt and names the session; fails_when=the no-summary halt's POST /stop carries no JSON body, or one that does not name E_PF_FINALIZE_HALT and the session; why_new=the stop was a bare POST, which the driver read as an operator's stop and settled every stage with no live session as completed; seam=run.ts retryAfter's stop request; no_claim=what the driver records (pf-driver.test.ts)
test("the no-summary halt's POST /stop carries a JSON body naming E_PF_FINALIZE_HALT and the session", async () => {
  const stops: Array<[string | null, unknown]> = [];
  const control = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname !== "/stop") return new Response("no route", { status: 404 });
      const body = await req.text();
      stops.push([req.headers.get("content-type"), body ? JSON.parse(body) : body]);
      return Response.json({ stopping: true });
    },
  });
  try {
    const i = { ...input("C"), control: "http://127.0.0.1:" + control.port };
    const ev = temp("pf-run-ev-");
    writeFileSync(join(ev, "pf-opens.jsonl"), JSON.stringify({ phase: "wrapup", rerun: null, at: 5410.2 }) + "\n");
    await expect(retryAfter(i, 2, null, pfRecord(i, 2, null, ev), "/out/a2", "Harbor exited 1", ev)).rejects.toThrow(/^E_PF_FINALIZE_HALT .*pf-run stopped the driver through POST /);
    expect(stops).toEqual([["application/json", { code: "E_PF_FINALIZE_HALT", session: "pf-run-flag/claude-opus-5-5/C/3 attempt 2" }]]);
  } finally {
    control.stop(true);
  }
});

// Value: protects=the owner's ruling on adversarial-native#5: a unit with no valid runtime image id refuses clearly before any docker call; fails_when=runPfSession or pf contain on a unit with a missing or malformed runtime_id calls docker, or refuses with anything but E_SM_INFRA_GAP "run its oracle first"; why_new=both took the tree volume's digest with docker run on that id before buildSessionImage checked it, so the refusal was a docker error; seam=run.ts runPfSession and pfchecks/cli.ts contain over statemachines/image.ts runtimeId; no_claim=dryrun-units.ts, which calls the same check but needs a real unit fixture
test("runPfSession and pf contain refuse a unit with a missing or malformed runtime id with E_SM_INFRA_GAP before any docker call", async () => {
  const bin = temp("pf-run-docker-");
  const log = join(bin, "calls");
  writeFileSync(join(bin, "docker"), "#!/bin/sh\necho \"$*\" >> '" + log + "'\nexit 1\n", { mode: 0o755 });
  const path = DOCKER_ENV.PATH;
  DOCKER_ENV.PATH = bin + ":" + path;
  try {
    for (const runtime of [undefined, "latest"]) {
      const i = { ...input("P"), out: join(temp("pf-run-out-"), "s") };
      const u = JSON.parse(readFileSync(join(i.unitDir, "unit.json"), "utf8"));
      u.image.runtime_id = runtime;
      writeFileSync(join(i.unitDir, "unit.json"), JSON.stringify(u));
      await expect(runPfSession(i)).rejects.toThrow(/^E_SM_INFRA_GAP unit pf-run-flag has no runtime image id; run its oracle first/);
      expect(await pfMain(["contain", "--unit", i.unitDir])).toBe(CODES.E_SM_INFRA_GAP.exit ?? 2);
    }
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
  } finally {
    DOCKER_ENV.PATH = path;
  }
});

// Value: protects=the Captain's ruling D on #324: E_PF_CAPTURE's entry fits a post-turn capture failure, which comes after paid turns; fails_when=E_PF_CAPTURE says it is refused before any spend or is retry safe, or changes its exit; why_new=the entry said "None: refused before any spend" and "retry safe" for a capture that runs after the task turn spent; seam=src/errors/codes.ts E_PF_CAPTURE; no_claim=docs/errors.md (bun run errors:check)
test("E_PF_CAPTURE's entry says a post-turn capture failure follows paid turns and is not retry safe, and keeps exit 2", () => {
  const e = CODES.E_PF_CAPTURE;
  expect([e.exit, e.retry_safe]).toEqual([2, false]);
  expect(e.side_effects).not.toBe("None: refused before any spend.");
  expect(e.meaning).toContain("after");
});

// Value: protects=the Captain's ruling B on #324: the run report counts lock gaps the agent's git left, per arm and model, apart from other arm gaps; fails_when=the session record carries no post_turn object, or one whose causes or turn end a script cannot read, for an arm gap or an infra gap, or carries one when no post-turn step failed; why_new=the record kept only gap_reason post_turn, and the cause lived in the refusal text; seam=run.ts pfRecord over pf_turns' summary.post_turn; no_claim=that pf_turns writes it (pf_agent_sdk_test.py)
test("pfRecord carries the summary's post_turn object, a lock cause after a wall-limit end a script can read, for an arm gap and an infra gap", () => {
  const i = input("P");
  const base = { task: turn("wall_limit"), slots: [slot("task", 4)] };
  const pt = { step: "capture.sh commit", timed_out: false, failed: "exited 128: fatal", causes: ["lock .git/index.lock"], after: { phase: "task", termination: "wall_limit" } };
  const arm = pfRecord(i, 1, { ...summary(base), capture: null, keep: null, refused: "E_PF_ARM post_turn capture.sh commit: lock .git/index.lock", post_turn: pt }, null) as any;
  expect([arm.gap, arm.gap_reason, arm.post_turn]).toEqual(["E_PF_ARM", "post_turn", pt]);
  expect(arm.post_turn.causes.some((c: string) => c.startsWith("lock ")) && arm.post_turn.after.termination === "wall_limit").toBe(true);
  const ipt = { ...pt, timed_out: true, failed: "timed out after 600 s", causes: [] };
  const infra = pfRecord(i, 1, { ...summary(base), capture: null, keep: null, refused: "E_PF_CAPTURE capture.sh commit timed out after 600 s", post_turn: ipt }, null) as any;
  expect([infra.gap, infra.post_turn]).toEqual(["E_PF_INFRA_GAP", ipt]);
  expect((pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("completed")], slots: [slot("task", 4), slot("wrapup", 2)] }), null) as any).post_turn).toBeNull();
});
