// Copyright (c) 2026 Garry Tan. MIT License.
// One PF session's Harbor run copy (run.ts runCopy) and the pf-session.v1 record it reads back from pf_agent's
// pf-summary.json (run.ts pfRecord): the end rules of both turns, the whole-session retry and the tree-check refusal.
// Keyless and docker-free: a hand-made unit dir and a made-up session image.
import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SessionImage } from "../../lanes/outcome-skills/statemachines/image.ts";
import { sessionLimits, type PfArm } from "../../lanes/outcome-skills/pfchecks/arms.ts";
import { OPUS, P1 } from "../../lanes/outcome-skills/pfchecks/items.ts";
import { PSTACK_DIR, pstackVolume } from "../../lanes/outcome-skills/pfchecks/pstack.ts";
import { TASK_RERUN, pfRecord, retriesSession, runCopy, type PfRunInput } from "../../lanes/outcome-skills/pfchecks/run.ts";
import { toolsVolume } from "../../lanes/outcome-skills/pfchecks/tools.ts";

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

const image: SessionImage = { image_id: "sha256:" + "e".repeat(64), tag: "pf-session:test", runtime_id: "sha256:" + "c".repeat(64), volume: "v", commits: 1, head: "a".repeat(40), home: "none", tree_patch_sha256: null };
const input = (arm: PfArm, model = OPUS): PfRunInput => ({ unitDir: unitDir(), session: { unit: "pf-run-flag", part: 0, index: 3, model, arm, item: "pf-opus" }, names: "short", control: "http://172.17.0.1:9000", proxy: "172.17.0.1:9001", out: "/unused", volume: "v", claude: "/opt/claude", probeNode: "", effort: null });
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
  expect(pf.limits.wrapup.allowance_usd).toBe(6);
  expect(pf.plugin).toBe(PSTACK_DIR);
  expect(pf.task_text).toStartWith("/create-formal-verification-skill ");
  expect(pf.task_text).toContain("The flag is never reset.");
  expect(pf.env).toMatchObject({ CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", HOME: "/root" });
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

const turn = (termination: string, refused: string[] = []) => ({ termination, refused, wall_s: 12.5 });
const slot = (phase: string, spent: number, rerun: string | null = null, first?: Record<string, unknown> | null) => ({ phase, rerun, id: "ses_" + phase + spent, allowance_micros: 1, close: { spent_micros: spent, ...(first !== undefined ? { first_request: first } : {}) } });
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
  expect(retriesSession(summary({ task: turn("completed") }), r)).toBe(false);
});

test("pfRecord: a limit in either turn still scores, and a wrap-up time or turn limit is the scored wrap-up end", () => {
  const i = input("C");
  expect(pfRecord(i, 1, summary({ task: turn("wall_limit"), wrapup: [turn("completed")] }), null)).toMatchObject({ task: { end: "limit_wall" }, wrapup_end: "completed", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed", ["E_ALLOWANCE"]), wrapup: [turn("completed")] }), null)).toMatchObject({ task: { end: "limit_allowance" }, gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("turn_ceiling")] }), null)).toMatchObject({ wrapup_end: "limit_turns", gap: null });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("wall_limit")] }), null)).toMatchObject({ wrapup_end: "limit_wall", gap: null });
});

test("pfRecord: a wrap-up turn refused for its allowance, by the proxy or at the driver's open, is gap E_PF_WRAPUP_ALLOWANCE with no rerun and no session retry", () => {
  const i = input("P");
  const proxy = summary({ task: turn("completed"), wrapup: [turn("error_result", ["E_ALLOWANCE"])], slots: [slot("task", 10), slot("wrapup", 2)] });
  const a = pfRecord(i, 1, proxy, null);
  expect(a).toMatchObject({ attempt: 1, task: { end: "completed" }, wrapup: { ends: ["limit_allowance"], spent_micros: 2 }, wrapup_end: null, gap: "E_PF_WRAPUP_ALLOWANCE" });
  expect(retriesSession(proxy, a)).toBe(false);
  const open = summary({ task: turn("completed"), wrapup: [{ termination: "open_refused", refused: ["CAP_STOP"], wall_s: 0 }], slots: [slot("task", 10), { phase: "wrapup", rerun: null, id: null, allowance_micros: null, close: null, open_refused: "409 CAP_STOP" }] });
  const b = pfRecord(i, 1, open, null);
  expect(b).toMatchObject({ wrapup: { ends: ["limit_allowance"], spent_micros: 0 }, wrapup_end: null, gap: "E_PF_WRAPUP_ALLOWANCE" });
  expect(retriesSession(open, b)).toBe(false);
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("error_result"), { termination: "open_refused", refused: ["CAP_STOP"], wall_s: 0 }] }), null)).toMatchObject({ wrapup: { ends: ["upstream", "limit_allowance"] }, gap: "E_PF_WRAPUP_ALLOWANCE" });
  expect(pfRecord(i, 1, summary({ task: turn("completed"), wrapup: [turn("completed", ["E_ALLOWANCE"])] }), null)).toMatchObject({ wrapup_end: null, gap: "E_PF_WRAPUP_ALLOWANCE" });
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
