// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 4, 8 and 9: the /cso session runner (cso/run.ts) against a stub Harbor that drops each attempt's summary and
// transcript where h2h_agent writes them. Harbor's argv and the attempt's config, overlay and manifest; a completed session
// and its record with exposure and resolved handles; one whole-session retry naming meta.rerun, then a gap; a retry the
// spend cap can't cover; the finalize halts and their POST /stop; and a home that no longer hashes to its arm record.
// No Docker, no key, no model call.
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeTreeSha256 } from "../../lanes/outcome-skills/h2h/arms/hash.ts";
import { pathId } from "../../lanes/outcome-skills/cso/exposure.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { CSO_BASE_IMAGE, CSO_RERUN, csoRunCopy, runCsoSession, treePaths, type CsoSessionInput } from "../../lanes/outcome-skills/cso/run.ts";
import { csoRunner } from "../../lanes/outcome-skills/cso/rerunner.ts";
import type { UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";

const p = loadCsoPrereg();
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "cso-run-test-"));
  roots.push(d);
  return d;
};
const L = "~/.claude/skills/gstack/bin/gstack-cso-launcher";
const RUN = "1767225600000-0123456789abcdef";
const H = "@cso-path//" + pathId("config/prod.env");

function tree(): string {
  const d = tmp();
  mkdirSync(join(d, "config"), { recursive: true });
  writeFileSync(join(d, "index.js"), "module.exports = 1;\n");
  writeFileSync(join(d, "config/prod.env"), "KEY=x\n");
  const g = (a: string[]) => spawnSync("git", ["-C", d, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "audit tree"]);
  return d;
}
const UNIT = { unit: "u1", tree_sha256: "a".repeat(64) } as UnitRecord;
const IMAGE = { image_id: "sha256:" + "b".repeat(64), tag: "gstack-evals-cso-session:aaaaaaaaaaaaaaaa", runtime_id: CSO_BASE_IMAGE, volume: "", commits: 1, head: "c".repeat(40), home: "none" as const, tree_patch_sha256: null, qa_home: null, removed: [] };

const init = { type: "SystemMessage", subtype: "init", data: { model: "claude-opus-5-5-20261101", claude_code_version: "2.1.325" } };
const tu = (id: string, command: string) => ({ type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] });
const tr = (id: string, content: string) => ({ type: "UserMessage", content: [{ type: "tool_result", tool_use_id: id, content }] });
const transcript = [
  init,
  { type: "UserMessage", content: [{ type: "text", text: "<command-message>cso</command-message>\n<command-name>/cso</command-name>" }] },
  tu("t1", L + " start --repo /work/repo"), tr("t1", JSON.stringify({ runId: RUN, source: { root: "/snap" } })),
  tu("t2", L + " inspect " + RUN), tr("t2", JSON.stringify({ report: { runId: RUN }, manifest: { root: "/snap", entries: [{ path: "index.js" }, { path: H, displayPath: "config/[redacted]" }] } })),
  tu("t3", L + " finish " + RUN), tr("t3", JSON.stringify({ runId: RUN, status: "finished", completeness: "complete" })),
  { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "text", text: "Finding 1: " + H + ":1 holds a key.\nDONE" }] },
];
const close = (spent: number, extra: Record<string, unknown> = {}) => ({ finalized: true, allowance_stops: 0, spent_micros: spent, usage: { input: 10, output: 5, cache_read: 0, cache_write: 0 }, refusals: [], ...extra });
const completed = (spent = 1_000_000) => ({ done: true, continuations: 0, turns: [{ termination: "completed", drive: {} }], slot: { id: "ses_1", close: close(spent) } });
const upstream = (spent = 500_000) => ({ done: false, turns: [{ termination: "error_result", drive: {} }], slot: { id: "ses_1", close: close(spent, { refusals: ["E_UPSTREAM 529"] }) } });

/** A stub Harbor: copies stub/a<N>/* into <-o>/<job>/trial/agent/evaluator and appends its job name to stub/jobs.txt. */
function stub(attempts: Array<{ summary?: unknown; opens?: boolean }>): { bin: string; dir: string } {
  const dir = tmp();
  attempts.forEach((a, n) => {
    const d = join(dir, "a" + (n + 1));
    mkdirSync(d, { recursive: true });
    if (a.summary) writeFileSync(join(d, "h2h-summary.json"), JSON.stringify(a.summary));
    if (a.opens) writeFileSync(join(d, "h2h-opens.jsonl"), "{\"open\":1}\n");
    writeFileSync(join(d, "sdk-messages.jsonl"), transcript.map((r) => JSON.stringify(r)).join("\n") + "\n");
  });
  const bin = join(dir, "harbor");
  writeFileSync(bin, "#!/usr/bin/env bash\nout=; job=\nwhile [ $# -gt 0 ]; do case \"$1\" in -o) out=$2; shift;; --job-name) job=$2; shift;; esac; shift; done\nn=$(echo \"$job\" | sed 's/.*-a//')\nmkdir -p \"$out/$job/trial/agent/evaluator\"\ncp " + JSON.stringify(dir) + "/a$n/* \"$out/$job/trial/agent/evaluator/\"\necho \"$job\" >> " + JSON.stringify(join(dir, "jobs.txt")) + "\n");
  chmodSync(bin, 0o755);
  return { bin, dir };
}
const input = (o: Partial<CsoSessionInput> & { harbor: string }): CsoSessionInput => ({ unit: UNIT, tree: tree(), image: IMAGE, arm: "none", model: "opus", stage: "stage0", index: 0, home: { dir: null, home_tree_sha256: "d".repeat(64) }, control: "http://127.0.0.1:9", proxy: "127.0.0.1:8", out: join(tmp(), "s"), runtime: { volume: "h2h-runtimes-x", path: "/usr/bin:/opt/h2h-runtimes/bin" }, claude: "/opt/claude", ...o });

test("Harbor's argv runs h2h_agent on the cso arm, the driver's model name and the session image, with the attempt's config", () => {
  const dir = tmp();
  const i = input({ harbor: "harbor", model: "particle", arm: "cso", home: { dir: "/homes/cso", home_tree_sha256: "e".repeat(64) } });
  const { argv, env, config } = csoRunCopy(i, 2, dir, p);
  const ak = Object.fromEntries(argv.flatMap((a, n) => (argv[n - 1] === "--ak" ? [[a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] as [string, string]] : [])));
  expect(argv.slice(0, 7)).toEqual(["run", "-y", "-p", join(dir, "task"), "-a", "h2h_agent:H2hAgent", "-m"]);
  expect(argv[7]).toBe("anthropic/particle-ai/particle-1");
  expect(ak).toMatchObject({ arm: "cso:cso", upstream_model: "particle-ai/particle-1", rerun: CSO_RERUN, image_id: IMAGE.image_id, repo_dir: "/work/repo", probe_node: "/usr/local/bin/node", ledger: "u4", task_label: "u1/cso/particle/stage0/0" });
  expect(config).toMatchObject({ arm: "cso:cso", home: "/homes/cso", home_rule: "gstack", limits: { allowance_usd: 3 } });
  expect(env.ANTHROPIC_API_KEY).toBe("placeholder-not-a-key");
  expect(Object.keys(env).filter((k) => /OPENROUTER|OPENAI|EXA/.test(k))).toEqual([]);
  expect(readFileSync(join(dir, "task/environment/Dockerfile"), "utf8")).toBe("FROM " + IMAGE.tag + "\n");
  const compose = JSON.parse(readFileSync(join(dir, "cso.compose.yaml"), "utf8"));
  expect(compose.services.main.environment.PATH).toBe("/usr/bin:/opt/h2h-runtimes/bin");
  expect(compose.services.main.volumes[0]).toMatchObject({ source: "/opt/claude", target: "/usr/local/bin/claude", read_only: true });
  expect(JSON.parse(readFileSync(join(dir, "images.json"), "utf8")).rows[0]).toMatchObject({ label: "u1/cso/particle/stage0/0", image_id: IMAGE.image_id, runtime_id: CSO_BASE_IMAGE });
  expect(CSO_BASE_IMAGE).toMatch(/^node:24-bookworm@sha256:[0-9a-f]{64}$/);
});

test("a completed session writes its record, with exposure and the redacted path's handle resolved, and a run record with the image", async () => {
  const s = stub([{ summary: completed() }]);
  const i = input({ harbor: s.bin });
  const { record } = await runCsoSession(i);
  expect(record).toMatchObject({ end: "completed", attempts: 1, done_seen: true, cost_usd: 1, model_id: "claude-opus-5-5-20261101", texts: ["Finding 1: " + H + ":1 holds a key.\nDONE"] });
  expect(record.exposure).toMatchObject({ loaded: true, procedure_ran: true, run_id: RUN, completeness: "complete" });
  expect(record.helper).toEqual({ snapshot_root: "/snap", handles: { [H]: "config/prod.env" } });
  expect(treePaths(i.tree).sort()).toEqual(["config/prod.env", "index.js"]);
  const run = JSON.parse(readFileSync(join(i.out, "run.json"), "utf8"));
  expect(run).toMatchObject({ image_id: IMAGE.image_id, base_image: CSO_BASE_IMAGE, attempts: [{ attempt: 1, end: "completed" }] });
});

test("an upstream end gets one retry naming meta.rerun; a second is a gap; spend sums over both", async () => {
  const s = stub([{ summary: upstream() }, { summary: upstream() }]);
  const i = input({ harbor: s.bin });
  const { record } = await runCsoSession(i);
  expect(readFileSync(join(s.dir, "jobs.txt"), "utf8").trim().split("\n").map((j) => j.slice(-3))).toEqual(["-a1", "-a2"]);
  expect(JSON.parse(readFileSync(join(i.out, "a2/h2h-config.json"), "utf8")).arm).toBe("cso:none");
  expect(record).toMatchObject({ end: "gap", attempts: 2, cost_usd: 1 });
  expect(record.reason).toStartWith("E_CSO_GAP_UPSTREAM");
});

test("a retry the spend cap can't cover is not run, and the session is a gap that says so", async () => {
  const s = stub([{ summary: upstream(500_000) }, { summary: completed() }]);
  const { record } = await runCsoSession(input({ harbor: s.bin, capLeftUsd: 8.4 }));
  expect(readFileSync(join(s.dir, "jobs.txt"), "utf8").trim().split("\n").length).toBe(1);
  expect(record).toMatchObject({ end: "gap", attempts: 1 });
  expect(record.reason).toContain("the retry needs a full $8 allowance");
});

test("a failed finalize halts with no record; an open with no summary posts E_CSO_FINALIZE_HALT to /stop first", async () => {
  const bad = { ...completed(), slot: { id: "ses_9", close: { ...close(1), finalized: false } } };
  const i1 = input({ harbor: stub([{ summary: bad }]).bin });
  await expect(runCsoSession(i1)).rejects.toThrow(/^E_CSO_FINALIZE_HALT .*ses_9/);
  expect(existsSync(join(i1.out, "session.json"))).toBe(false);
  const posts: unknown[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (r) => (posts.push(await r.json()), Response.json({ ok: true })) });
  const i2 = input({ harbor: stub([{ opens: true }]).bin, control: "http://127.0.0.1:" + server.port });
  await expect(runCsoSession(i2)).rejects.toThrow(/^E_CSO_FINALIZE_HALT .*driver was stopped through POST \/stop/);
  expect(posts).toEqual([{ code: "E_CSO_FINALIZE_HALT", session: "u1/none/opus/stage0/0 attempt 1" }]);
  server.stop(true);
});

test("a home that no longer hashes to its arm record, a none arm with a home, and a used out dir are refused before Harbor", async () => {
  const s = stub([{ summary: completed() }]);
  const home = tmp();
  writeFileSync(join(home, "f"), "x");
  const pinned = homeTreeSha256(home);
  writeFileSync(join(home, "f"), "y");
  await expect(runCsoSession(input({ harbor: s.bin, arm: "cso", home: { dir: home, home_tree_sha256: pinned } }))).rejects.toThrow(/^E_CSO_ARM .*no longer hashes/);
  await expect(runCsoSession(input({ harbor: s.bin, arm: "none", home: { dir: home, home_tree_sha256: pinned } }))).rejects.toThrow(/^E_CSO_ARM none runs with no home/);
  const used = tmp();
  await expect(runCsoSession(input({ harbor: s.bin, out: used }))).rejects.toThrow(/^E_CSO_SESSION .*exists/);
  expect(existsSync(join(s.dir, "jobs.txt"))).toBe(false);
});
test("rerun's runner refuses Sol, a missing driver or home, an unknown stage and a missing arm record before any session", () => {
  const work = tmp();
  mkdirSync(join(work, "arms"));
  writeFileSync(join(work, "arms", "cso.json"), JSON.stringify({ home_tree_sha256: "f".repeat(64) }));
  const env = { CSO_CONTROL: "http://127.0.0.1:9", CSO_PROXY: "127.0.0.1:8", CSO_WORK: work, CSO_HOME: "/homes/cso" };
  const pre = (e: Record<string, string>, arm: "none" | "cso" | "untold", model: "opus" | "sol" = "opus") => () => csoRunner(e).preflight!({ arm, model });
  expect(pre(env, "cso", "sol")).toThrow(/^E_CSO_RERUN_PRECONDITION Sol runs in Codex/);
  expect(pre({ ...env, CSO_CONTROL: "" }, "none")).toThrow(/^E_CSO_RERUN_PRECONDITION CSO_CONTROL is not set/);
  expect(pre({ ...env, CSO_HOME: "" }, "cso")).toThrow(/^E_CSO_RERUN_PRECONDITION CSO_HOME is not set/);
  expect(pre({ ...env, CSO_STAGE: "stage9" }, "cso")).toThrow(/^E_CSO_RERUN_PRECONDITION CSO_STAGE/);
  expect(pre(env, "none")).toThrow(/^E_CSO_RERUN_PRECONDITION arm record .*none\.json/);
  expect(pre(env, "cso")).not.toThrow();
  expect(pre(env, "untold")).not.toThrow();
});
test("an attempt pair that leaves no summary and no transcript is an infra gap with an empty identity, never a refusal", async () => {
  const dir = tmp();
  const bin = join(dir, "harbor");
  writeFileSync(bin, "#!/usr/bin/env bash\nexit 1\n");
  chmodSync(bin, 0o755);
  const { record } = await runCsoSession(input({ harbor: bin }));
  expect(record).toMatchObject({ end: "gap", attempts: 2, model_id: "", harness_version: "", texts: [], cost_usd: 0 });
  expect(record.reason).toStartWith("E_CSO_GAP_INFRA");
});
