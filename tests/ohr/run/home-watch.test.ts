// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=pre-run change 5's F1 and G1 on the Sol arms: the harness's snapshots of Codex's home, the rollout prefix check, the event-stream flags, the unreadable-rollout missing code and its listing, the sensitivity row, and the collaboration mode of every turn; fails_when=a Sol session that deletes, moves, edits or rewrites anything under Codex's home, or runs a non-default turn, reads clean, or a clean session reads flagged.
import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX, CONTAINER_HOME } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { sensitivity, solTrust } from "../../../lanes/office-hours-rewrite/read/report.ts";
import { leadTable } from "../../../lanes/office-hours-rewrite/read/report.ts";
import { plant } from "../../../lanes/office-hours-rewrite/read/seams.ts";
import { scoredValue, METRIC } from "../../../lanes/office-hours-rewrite/read/estimate.ts";
import { solDriver } from "../../../lanes/office-hours-rewrite/run/codex.ts";
import { diffSnapshots, parseSnapshot, streamFlags, nonDefaultTurns, type RolloutGuard } from "../../../lanes/office-hours-rewrite/run/home-watch.ts";
import { entryId } from "../../../lanes/office-hours-rewrite/run/manifest.ts";
import { sessionRow, unrunRow } from "../../../lanes/office-hours-rewrite/run/rows.ts";
import { attemptOutcome, closingLoop, settle, type AttemptRead } from "../../../lanes/office-hours-rewrite/run/session.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "ohr-watch-"));
const o = { proxy: { baseUrl: "http://tap:8099/", slot: "s1", token: "t" }, home: CONTAINER_HOME, skillArm: true };

/** A stub agent session whose shell steps print their output, as the Docker rig's do, with HOME a fresh directory that holds a skill install. */
function watchSession(fake: string, blind = false) {
  const dir = tmp();
  const bin = join(dir, "codex");
  writeFileSync(bin, "#!/usr/bin/env bun\n" + fake);
  chmodSync(bin, 0o755);
  mkdirSync(join(dir, ".codex/skills/gstack-office-hours"), { recursive: true });
  writeFileSync(join(dir, ".codex/skills/gstack-office-hours/SKILL.md"), "the skill\n");
  const env = { PATH: process.env.PATH!, HOME: dir, TMPDIR: dir };
  return {
    home: dir,
    exec: (command: string, _ms: number, input?: string) => {
      const r = spawnSync("sh", ["-c", command], { cwd: dir, env, encoding: "utf8", input });
      return { exitCode: r.status ?? 1, stdout: blind ? "" : r.stdout, stderr: r.stderr, timedOut: false };
    },
    spawn: (argv: string[]) => spawn(argv[0] === CODEX.bin ? bin : argv[0]!, argv.slice(1).map((x) => (x === CODEX.bin ? bin : x)), { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] }),
    stop() {},
  };
}

/** A stand-in for Codex that writes what Codex writes: the session's rollout (its meta once, then each turn's start, turn_context and end) and a state database's write-ahead log, then the exec --json events. fault runs in the second exec, after Codex's own writes. */
const fake = (x: { fault?: string; mode2?: string; stream?: string; noRollout?: boolean } = {}) => [
  'if (process.argv.includes("--version")) { console.log("codex-cli 0.170.0"); process.exit(0); }',
  'const fs = require("node:fs");',
  'const H = process.env.HOME + "/.codex"; const dir = H + "/sessions/2026/11/19"; const R = dir + "/rollout-2026-11-19T00-00-00-th-1.jsonl";',
  'const resume = process.argv.includes("resume"); await Bun.stdin.text();',
  'const out = (e) => fs.writeSync(1, JSON.stringify(e) + "\\n");',
  x.noRollout ? "" : [
    "fs.mkdirSync(dir, { recursive: true });",
    'if (!resume) fs.appendFileSync(R, JSON.stringify({ type: "session_meta", payload: { id: "th-1" } }) + "\\n");',
    'const t = resume ? "t2" : "t1"; const mode = resume ? ' + JSON.stringify(x.mode2 ?? "default") + ' : "default";',
    'fs.appendFileSync(R, [{ type: "event_msg", payload: { type: "task_started", turn_id: t } }, { type: "turn_context", payload: { turn_id: t, collaboration_mode: { mode } } }, { type: "event_msg", payload: { type: "task_complete", turn_id: t } }].map((e) => JSON.stringify(e) + "\\n").join(""));',
    'fs.appendFileSync(H + "/state_5.sqlite-wal", "x");',
  ].join("\n"),
  'out({ type: "thread.started", thread_id: "th-1" }); out({ type: "turn.started" });',
  x.stream ?? "",
  "if (resume) { " + (x.fault ?? "") + " }",
  'out({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "ok" } });',
  'out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });',
].join("\n");

/** Two execs (the first and one resume), with between run after the first; the guard the driver reports. */
async function watched(f: string, x: { between?: (home: string) => void; blind?: boolean } = {}): Promise<{ guard: RolloutGuard | null; out: string; termination: unknown }> {
  const s = watchSession(f, x.blind);
  const out = tmp();
  let guard: RolloutGuard | null = null;
  let n = 0;
  const d = solDriver({ ...o, out, onGuard: (g) => (guard = g), nextUser: async () => (++n === 1 ? (x.between?.(s.home), { reply: "more" }) : { end: true }) });
  const r = await d.run(s as any, { id: "ohr", prompt: "hi" } as any, 60_000);
  return { guard, out, termination: r.termination };
}

const SKILL_CMD = 'out({ type: "item.completed", item: { id: "c1", type: "command_execution", command: "bash -lc \\"$HOME/.codex/skills/gstack/bin/gstack-slug\\"", status: "completed" } });';

describe("F1: the harness's snapshots of Codex's home", () => {
  test("a clean session is not flagged, every snapshot is logged beside the trial, and running the skill install by its path is no flag", async () => {
    const { guard, out } = await watched(fake({ stream: SKILL_CMD }));
    expect(guard).not.toBeNull();
    expect(guard!.flags).toEqual([]);
    expect(guard!.rollout_unreadable).toBe(false);
    expect(guard!.snapshots).toBe(5);
    const log = readFileSync(join(out, "codex", "home-watch.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.filter((l) => l.snapshot).map((l) => l.snapshot)).toEqual(["before exec 1", "after exec 1", "before exec 2", "after exec 2", "after copy-out"]);
    expect(log.filter((l) => l.snapshot).every((l) => l.ok && l.entries.length > 0)).toBe(true);
  });

  const faults: [string, string, RegExp][] = [
    ["deletes a file under Codex's home through a glob", 'for (const f of fs.readdirSync(H + "/skills/gstack-office-hours")) fs.rmSync(H + "/skills/gstack-office-hours/" + f);', /delete/],
    ["moves a file there", 'fs.renameSync(H + "/skills/gstack-office-hours/SKILL.md", H + "/skills/gstack-office-hours/old.md");', /move/],
    ["edits a file there and puts back its bytes and its mtime", 'const p = H + "/skills/gstack-office-hours/SKILL.md"; const b = fs.readFileSync(p); const st = fs.statSync(p); fs.writeFileSync(p, "changed"); fs.writeFileSync(p, b); fs.utimesSync(p, st.atime, st.mtime);', /modify/],
    ["truncates the rollout", "fs.truncateSync(R, 20);", /truncat|prefix/],
    ["rewrites the rollout at the same size", 'fs.writeFileSync(R, fs.readFileSync(R, "utf8").replace("th-1", "th-2"));', /prefix/],
    ["deletes the rollout and writes the same bytes back (a disk may reuse the inode number; its directory still changes)", "const b = fs.readFileSync(R); fs.unlinkSync(R); fs.writeFileSync(R, b);", /delete|modify sessions\/2026\/11\/19 /],
  ];
  for (const [name, fault, word] of faults)
    test("a session that " + name + " is flagged", async () => {
      const { guard } = await watched(fake({ fault }));
      expect(guard!.flags.length).toBeGreaterThan(0);
      expect(guard!.flags.join("\n")).toMatch(word);
    });

  test("a change between execs, while Codex is not running, is flagged even where a turn may change that file", async () => {
    const { guard } = await watched(fake(), { between: (home) => appendFileSync(join(home, ".codex/state_5.sqlite-wal"), "y") });
    expect(guard!.flags.join("\n")).toMatch(/between/);
  });

  test("fail closed: a snapshot that prints nothing is a flag", async () => {
    const { guard } = await watched(fake(), { blind: true });
    expect(guard!.flags.join("\n")).toMatch(/snapshot/);
  });

  test("a move reads as the same inode under a new path, and a create, delete and truncation read as such", () => {
    const snap = (rows: string[]) => parseSnapshot(rows.map((r) => r + "\0").join("") + "END\0")!;
    const a = snap(["d\t1\t60\t1.0\t1.0\t", "f\t2\t10\t1.0\t1.0\ta", "f\t3\t10\t1.0\t1.0\tb", "f\t4\t10\t1.0\t1.0\tc"]);
    const b = snap(["d\t1\t60\t2.0\t2.0\t", "f\t2\t10\t1.0\t1.0\tz", "f\t4\t5\t2.0\t2.0\tc", "f\t9\t1\t2.0\t2.0\tnew"]);
    const kinds = diffSnapshots(a, b).map((e) => e.kind + " " + e.path + ("from" in e && e.from ? " from " + e.from : ""));
    expect(kinds.sort()).toEqual(["create new", "delete b", "modify ", "move z from a", "truncate c"]);
  });
});

describe("F1: the event stream the adapter holds", () => {
  test("a command naming Codex's home, its sessions or a rollout, and a file_change there, are flagged; the skill install's path is not", () => {
    const ev = (item: object) => JSON.stringify({ type: "item.completed", item });
    const stream = [
      ev({ id: "1", type: "command_execution", command: "cat ~/.codex/sessions/2026/11/19/x" }),
      ev({ id: "2", type: "command_execution", command: "ls rollout-*" }),
      ev({ id: "3", type: "file_change", changes: [{ path: CONTAINER_HOME + "/.codex/config.toml", kind: "add" }] }),
      ev({ id: "4", type: "command_execution", command: "~/.codex/skills/gstack/bin/gstack-slug" }),
      ev({ id: "5", type: "command_execution", command: "cat ~/.codex/skills/gstack/../../sessions/x" }),
      ev({ id: "6", type: "file_change", changes: [{ path: "/work/notes.md", kind: "add" }] }),
    ].join("\n");
    const flags = streamFlags(stream, []);
    expect(flags).toHaveLength(4);
    expect(flags.join("\n")).toContain(".codex/sessions/2026");
    expect(flags.join("\n")).toContain("rollout-*");
    expect(flags.join("\n")).toContain("config.toml");
    expect(flags.join("\n")).toContain("../../sessions");
    const rollout = JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "await tools.exec_command({cmd: \"rm $CODEX_HOME/x\"})" } });
    expect(streamFlags("", [rollout])).toHaveLength(1);
  });
  test("the driver joins the event-stream flags to the snapshot flags", async () => {
    const { guard } = await watched(fake({ stream: 'out({ type: "item.completed", item: { id: "c9", type: "command_execution", command: "ls -la ~/.codex", status: "completed" } });' }));
    expect(guard!.flags.join("\n")).toMatch(/stream/);
  });
});

describe("G1: collaboration mode", () => {
  test("a turn whose turn_context records another mode than default is reported with its turn, and is no F1 flag", async () => {
    const { guard } = await watched(fake({ mode2: "plan" }));
    expect(guard!.non_default_turns).toHaveLength(1);
    expect(guard!.non_default_turns[0]).toContain("t2");
    expect(guard!.non_default_turns[0]).toContain("plan");
    expect(guard!.flags).toEqual([]);
  });
  test("a started turn with no turn_context, or one with no mode, is reported too", () => {
    const l = (x: object) => JSON.stringify(x);
    const r = [l({ type: "event_msg", payload: { type: "task_started", turn_id: "a" } }), l({ type: "event_msg", payload: { type: "task_started", turn_id: "b" } }), l({ type: "turn_context", payload: { turn_id: "b" } })].join("\n");
    expect(nonDefaultTurns([{ name: "rollout-x.jsonl", text: r }])).toHaveLength(2);
    expect(nonDefaultTurns([{ name: "rollout-x.jsonl", text: "" }])).toHaveLength(1);
  });
});

describe("F1: an unreadable rollout", () => {
  const read = (x: Partial<AttemptRead>): AttemptRead => ({
    termination: { kind: "completed" }, loop: closingLoop({ parse: () => ({ kind: "no-block", reason: "" }) as any, founder: async () => ({}) as any }).state, gstack_reads: [], contained: [], pin: [], overflow: false, safety: null, session_kind: null,
    off_pin: [], served_model: null, cli_version: null, micros: 0, sim_micros: 0, rollout_flags: [], non_default_turns: [], rollout_unreadable: false, ...x,
  });
  test("the driver reports a rollout it could not read", async () => {
    const { guard, termination } = await watched(fake({ noRollout: true }));
    expect(termination).toEqual({ kind: "missing", code: "E_INFRA_FAILURE" });
    expect(guard!.rollout_unreadable).toBe(true);
  });
  test("retries once, then reads missing with its own code", () => {
    const first = attemptOutcome(read({ termination: { kind: "missing", code: "E_INFRA_FAILURE" }, rollout_unreadable: true }), "new");
    expect(first).toMatchObject({ state: "retry", as: "infra", code: "E_OHR_ROLLOUT_UNREADABLE" });
    expect(settle(first, 2)).toMatchObject({ state: "missing", code: "E_OHR_ROLLOUT_UNREADABLE" });
  });
  test("rows carry the flags and the non-default turns on Sol, null elsewhere, and the report lists unreadable cells apart from other infra misses", () => {
    const sol = { stage: 2 as const, brief: "b1", model: "sol" as const, arm: "new" as const };
    const opus = { ...sol, model: "opus" as const };
    const a = read({ rollout_flags: ["after exec 2: delete skills/x"], non_default_turns: ["rollout-x.jsonl turn t2: plan"] });
    const row = sessionRow({ entry: sol, end: { state: "no-block", code: "E_OHR_NO_BLOCK" }, attempts: [a], transcript: null, state_root: null });
    expect(row.rollout_flags).toEqual(["attempt 1: after exec 2: delete skills/x"]);
    expect(row.non_default_turns).toEqual(["attempt 1: rollout-x.jsonl turn t2: plan"]);
    const o2 = sessionRow({ entry: opus, end: { state: "no-block", code: "E_OHR_NO_BLOCK" }, attempts: [read({ rollout_flags: null, non_default_turns: null })], transcript: null, state_root: null });
    expect(o2.rollout_flags).toBeNull();
    expect(o2.non_default_turns).toBeNull();
    const unreadable = { ...unrunRow({ ...sol, brief: "b2" }), code: "E_OHR_ROLLOUT_UNREADABLE", rollout_flags: [], non_default_turns: [] };
    const infra = { ...unrunRow({ ...sol, brief: "b3" }), code: "E_OHR_INFRA_MISSING", rollout_flags: [], non_default_turns: [] };
    const t = solTrust([row, o2, unreadable, infra]);
    expect(t.flagged).toEqual([{ cell: entryId(sol), flags: row.rollout_flags! }]);
    expect(t.non_default).toEqual([{ cell: entryId(sol), turns: row.non_default_turns! }]);
    expect(t.unreadable).toEqual([entryId({ ...sol, brief: "b2" })]);
    expect(t.other_infra_missing).toEqual([{ cell: entryId({ ...sol, brief: "b3" }), code: "E_OHR_INFRA_MISSING" }]);
  });
});

describe("F1: the sensitivity row", () => {
  const rows = plant("merge").rows;
  const primary = leadTable(rows).find((r) => r.contrast === "new minus current" && r.scope === "pooled")!;
  test("it is there beside the primary with zero flagged sessions, and then equals it", () => {
    const s = sensitivity(rows, new Set());
    expect(s.flagged).toBe(0);
    expect(s.flagged_cells).toEqual([]);
    expect({ estimate: s.estimate, lo: s.lo, hi: s.hi, C: s.C }).toEqual({ estimate: primary.estimate, lo: primary.lo, hi: primary.hi, C: primary.C });
  });
  test("it scores a flagged session as a fail", () => {
    const pass = rows.find((s) => s.arm === "new" && s.stage === 2 && s.kind === "founder" && s.R === 1 && scoredValue(s, METRIC.R) === 1 && rows.some((c) => c.arm === "current" && c.brief === s.brief && c.model === s.model && c.stage === 2 && scoredValue(c, METRIC.R) !== null) && (s.model === "opus" || s.model === "sol"))!;
    expect(pass).toBeDefined();
    const s = sensitivity(rows, new Set([entryId(pass)]));
    expect(s.flagged).toBe(1);
    expect(s.flagged_cells).toEqual([entryId(pass)]);
    expect(s.estimate!).toBeLessThan(primary.estimate!);
  });
});

describe("pre-run change 7: gstack's Codex skill root", () => {
  const ev = (item: object) => JSON.stringify({ type: "item.completed", item });
  const cmd = (command: string) => ev({ id: "c", type: "command_execution", command });
  const exec = (c: string) => JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "const r = await tools.exec_command({cmd: " + JSON.stringify(c) + "});" } });
  const call = (c: string) => JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: c }) } });
  const ROOT = "$" + "{CODEX_HOME:-~/.codex}/skills/gstack";
  test("the exact skill-root token, alone or followed by a path with no '..', is no flag in a command or a rollout tool call", () => {
    const seeded = ["GSTACK_ROOT=" + ROOT + "\n\"$GSTACK_ROOT/bin/gstack-skill-start\"", "_r=" + ROOT + ";[ -d \"$_r/bin\" ]||echo none", "[ -x \"" + ROOT + "/bin/gstack-skill-start\" ]&&\"" + ROOT + "/bin/gstack-skill-start\""];
    expect(streamFlags(seeded.map(cmd).join("\n"), [seeded.map(exec).join("\n"), seeded.map(call).join("\n")])).toEqual([]);
  });
  test("every other CODEX_HOME use still flags, the token with '..' after it included, and so does a file_change path", () => {
    const seeded = ["cat " + ROOT + "/../../sessions/x", "ls " + ROOT + "-office-hours", "cat $" + "{CODEX_HOME:-~/.codex}/config.toml", "echo $CODEX_HOME", "cat $" + "{CODEX_HOME}/skills/gstack/bin/x", "GSTACK_ROOT=" + ROOT + "; ls $CODEX_HOME/sessions"];
    const stream = [...seeded.map(cmd), ev({ id: "f", type: "file_change", changes: [{ path: ROOT + "/bin/x", kind: "add" }] })].join("\n");
    expect(streamFlags(stream, [])).toHaveLength(seeded.length + 1);
    for (const c of seeded) {
      expect(streamFlags("", [exec(c)])).toHaveLength(1);
      expect(streamFlags("", [call(c)])).toHaveLength(1);
    }
  });
});
