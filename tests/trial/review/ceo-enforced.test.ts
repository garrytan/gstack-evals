// The hook-enforced CEO arm's harness parts (stage 2 amendment, section 3.3), keyless and without the Claude Code CLI:
// the printed settings with both ceo-review shims at 30 s, the session id, the record copy and report through
// skill-gates.ts's gateRecord with the 4743132 tree's own report (OUTCOME_GSTACK_ENFORCED_PIN), how enforcedExposure reads
// each gate, and per-arm session kinds through runReviewUnits with a recording driver. The armed-and-blocked test with the
// real CLI is ceo-enforced-armed.test.ts.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { hostDriver } from "../../../src/adapters/host.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { enforcedExposure } from "../../../src/trial/review/ceo-exposure.ts";
import { runReviewUnits, type ReviewArm, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { GATE_DEADLINE_MS, GATE_HOOK_TIMEOUT_S, gateRecord, gateSettings, initSessionId } from "../../../src/trial/review/skill-gates.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

const PIN = process.env.OUTCOME_GSTACK_ENFORCED_PIN ?? "";
const HAS_PIN = !!PIN && existsSync(join(PIN, "bin", "gstack-skill-gates"));
const SID = "0f9d3c2a-5b1e-4c7d-9a8b-6e2f1d0c4b3a";
const tmp = (name: string) => mkdtempSync(join(tmpdir(), "gse-enforced-" + name + "-"));
const shim = (dir: string, name: string) => ({ type: "command", command: dir + "/hosts/claude/hooks/" + name, timeout: 10 });
const printed = (dir: string) => JSON.stringify({ env: { GSTACK_CEO_REVIEW_GATE: "on" }, hooks: { Stop: [{ hooks: [shim(dir, "ceo-review-gate-stop")] }], SubagentStop: [{ hooks: [shim(dir, "ceo-review-gate-subagent-stop")] }] } }, null, 2);
/** A transcript that reads review-sections.md and names a mode, so standalone's two checks pass and the gate decides. */
const transcript = (sid: string | null) => [
  JSON.stringify({ type: "system", subtype: "init", session_id: sid, parent_tool_use_id: null }),
  JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Mode: HOLD SCOPE." }, { type: "tool_use", id: "toolu_r", name: "Read", input: { file_path: "/h/.claude/skills/gstack/plan-ceo-review/sections/review-sections.md" } }] } }),
  JSON.stringify({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "toolu_r", content: "Section 1" }] } }),
].join("\n") + "\n";
type Run = { released_at?: string; exhausted_at?: string; blocked?: number };
/** A work dir whose state root holds a gate record for SID, and a host dir with the session's transcript. */
function session(o: { runs?: Run[]; errors?: number; record?: "none" | "symlink"; sid?: string | null }) {
  const dir = tmp("session");
  const work = join(dir, "work");
  const host = join(dir, "host");
  mkdirSync(host, { recursive: true });
  writeFileSync(join(host, "transcript.ndjson"), transcript(o.sid === undefined ? SID : o.sid));
  const gates = join(work, ".gstack-home", "skill-gates");
  mkdirSync(gates, { recursive: true });
  if (o.record === "symlink") {
    mkdirSync(join(dir, "elsewhere"));
    writeFileSync(join(dir, "elsewhere", "record.json"), "{}");
    symlinkSync(join(dir, "elsewhere"), join(gates, SID));
  } else if (o.record !== "none") {
    mkdirSync(join(gates, SID));
    const runs = Object.fromEntries((o.runs ?? []).map((r, i) => ["plan-ceo-review@" + (i + 3), { skill: "plan-ceo-review", load_line: i + 3, fired_at: "2026-11-06T10:00:00.000Z", blocked: r.blocked ?? 0, observed: 0, ...r }]));
    const errors = Array.from({ length: o.errors ?? 0 }, () => ({ at: "2026-11-06T10:00:01.000Z", code: "GATE_TIMEOUT", why: "timed out after 20000 ms" }));
    writeFileSync(join(gates, SID, "record.json"), JSON.stringify({ version: 1, session_id: SID, transcript_path: "/h/t.jsonl", hooks: { "ceo-review-gate": { runs, errors } } }, null, 2));
  }
  return { work, host };
}
const exposure = (host: string, r: ReturnType<typeof gateRecord>) => enforcedExposure(readFileSync(join(host, "transcript.ndjson"), "utf8"), { session_id: r.gate.session_id, exit: r.gate.exit, json: r.gate.json, copy_failed: r.copy_out.length > 0 });

describe("the enforced arm's printed settings (skill-gates.ts gateSettings)", () => {
  // Value: protects=B1: both ceo-review shims run under a 30 s timeout and nothing else in the printed settings changes; fails_when=a shim keeps 10 s, another field moves, or settings missing a shim pass; why_new=GEVA-348 3.3 item 2; seam=gateSettings; no_claim=the CLI honouring the timeout (ceo-enforced-armed.test.ts)
  test("both ceo-review shims go to 30 s and nothing else changes", () => {
    const made = gateSettings(printed("/h/gstack")) as any;
    expect(made.hooks.Stop[0].hooks[0].timeout).toBe(GATE_HOOK_TIMEOUT_S);
    expect(made.hooks.SubagentStop[0].hooks[0].timeout).toBe(30);
    const back = JSON.parse(printed("/h/gstack"));
    back.hooks.Stop[0].hooks[0].timeout = 30;
    back.hooks.SubagentStop[0].hooks[0].timeout = 30;
    expect(made).toEqual(back);
    expect(gateSettings(JSON.stringify({ env: {}, hooks: { Stop: [{ hooks: [shim("/h", "ceo-review-gate-stop")] }] } }))).toContain("not one ceo-review-gate-stop and one ceo-review-gate-subagent-stop hook");
    expect(gateSettings("not json")).toBe("the printed settings are not JSON");
  });
  test.skipIf(!HAS_PIN)("with OUTCOME_GSTACK_ENFORCED_PIN: the pin's own printed settings raise to 30 s on both shims", () => {
    const r = spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", join(PIN, "bin", "gstack-skill-gates"), "settings", "--ceo-review"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const made = gateSettings(r.stdout) as any;
    expect(typeof made).toBe("object");
    expect([made.hooks.Stop[0].hooks[0].timeout, made.hooks.SubagentStop[0].hooks[0].timeout, made.env]).toEqual([30, 30, { GSTACK_CEO_REVIEW_GATE: "on" }]);
  });
  test("the session id is the first main-agent init message's", () => {
    expect(initSessionId(transcript(SID))).toBe(SID);
    expect(initSessionId(JSON.stringify({ type: "system", subtype: "init", session_id: "sub", parent_tool_use_id: "toolu_1" }) + "\n" + transcript(SID))).toBe(SID);
    expect(initSessionId("{}\n")).toBeNull();
  });
});

describe.skipIf(!HAS_PIN)("the gate record and report through gateRecord, on the 4743132 tree's own report (OUTCOME_GSTACK_ENFORCED_PIN)", () => {
  // Value: protects=3.3 item 5 and section 4.4: the record copies byte for byte, the report runs on a scratch copy, and each report outcome reads as 4.4 says through enforcedExposure; fails_when=the copy differs, the stored copy is touched, a failed copy or missing id still reports, or an unexposed gate reads exposed; why_new=GEVA-348 3.3 items 5 and 6; seam=gateRecord, enforcedExposure; no_claim=a live session's record (ceo-enforced-armed.test.ts)
  test("released: exit 0, the copy is byte for byte, the row reads exposed", () => {
    const s = session({ runs: [{ blocked: 1, released_at: "2026-11-06T10:00:02.000Z" }] });
    const r = gateRecord({ work: s.work, host: s.host, gstack: PIN, settingsSha256: "abc" });
    expect([r.copy_out, r.gate.session_id, r.gate.exit, r.gate.deadline_ms, r.gate.hook_timeout_s, r.gate.settings_sha256]).toEqual([[], SID, 0, GATE_DEADLINE_MS, 30, "abc"]);
    expect(readFileSync(join(s.host, "skill-gates", SID, "record.json"))).toEqual(readFileSync(join(s.work, ".gstack-home", "skill-gates", SID, "record.json")));
    expect((r.gate.json as any).rows[0]).toMatchObject({ session: SID, hook: "ceo-review-gate", fired: 1, blocked: 1, released: 1, exhausted: 0 });
    expect(exposure(s.host, r)).toMatchObject({ exposed: true });
  });
  test("exhausted: exit 0, gate_released false, unexposed", () => {
    const s = session({ runs: [{ blocked: 3, exhausted_at: "2026-11-06T10:00:02.000Z" }] });
    const r = gateRecord({ work: s.work, host: s.host, gstack: PIN, settingsSha256: null });
    expect(r.gate.exit).toBe(0);
    expect(exposure(s.host, r)).toMatchObject({ exposed: false, failed: "gate_released" });
  });
  test("a hook error: exit 3, unexposed", () => {
    const s = session({ runs: [{}], errors: 1 });
    const r = gateRecord({ work: s.work, host: s.host, gstack: PIN, settingsSha256: null });
    expect(r.gate.exit).toBe(3);
    expect(r.gate.stderr).toContain("GATE_ERRORED");
    expect(exposure(s.host, r)).toMatchObject({ exposed: false, failed: "gate_armed" });
  });
  test("no record (the gate never fired): no copy failure, exit 2, unexposed", () => {
    const s = session({ record: "none" });
    const r = gateRecord({ work: s.work, host: s.host, gstack: PIN, settingsSha256: null });
    expect([r.copy_out, r.gate.exit]).toEqual([[], 2]);
    expect(r.gate.stderr).toContain("GATE_NOT_ARMED");
    expect(exposure(s.host, r)).toMatchObject({ exposed: false });
  });
  test("a copy failure (a symlinked record dir): logs it, exit null, unexposed", () => {
    const s = session({ record: "symlink" });
    const r = gateRecord({ work: s.work, host: s.host, gstack: PIN, settingsSha256: null });
    expect(r.copy_out.length).toBe(1);
    expect(r.copy_out[0]).toStartWith("skill-gates: ");
    expect(r.gate.exit).toBeNull();
    expect(existsSync(join(s.host, "skill-gates"))).toBe(false);
    expect(exposure(s.host, r)).toMatchObject({ exposed: false, failed: "gate_armed" });
  });
  test("no session id: exit null, unexposed; a usage exit 1 reads unexposed too", () => {
    const s = session({ sid: null });
    const r = gateRecord({ work: s.work, host: s.host, gstack: PIN, settingsSha256: null });
    expect([r.copy_out, r.gate.session_id, r.gate.exit]).toEqual([[], null, null]);
    expect(exposure(s.host, r)).toMatchObject({ exposed: false });
    const t = readFileSync(join(s.host, "transcript.ndjson"), "utf8");
    expect(enforcedExposure(t, { session_id: SID, exit: 1, json: { rows: [{ session: SID, hook: "ceo-review-gate", fired: 1, released: 1, exhausted: 0 }] }, copy_failed: false })).toMatchObject({ exposed: false, failed: "gate_armed" });
  });
});

/** A gstack home layer with a stand-in bin/gstack-session-kind that prints what it is told to. */
function gstackHome(kindScript: string) {
  const home = tmp("gstack");
  const gdir = join(home, ".claude", "skills", "gstack");
  mkdirSync(join(gdir, "bin"), { recursive: true });
  mkdirSync(join(gdir, "scripts"), { recursive: true });
  writeFileSync(join(gdir, "VERSION"), "1.96.0.0\n");
  writeFileSync(join(gdir, "scripts", "question-registry.ts"), "  'plan-ceo-review-mode': { id: 'plan-ceo-review-mode' },\n");
  writeFileSync(join(gdir, "bin", "gstack-session-kind"), kindScript, { mode: 0o755 });
  return home;
}

/** One plan unit for every run here, so two runs' session keys differ only where their arms do. */
function planUnit() {
  const root = tmp("kinds");
  const panel = planPanel(mkdtempSync(join(root, "panel-")), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(mkdtempSync(join(root, "unit-")), "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(mkdtempSync(join(root, "tree-")), "tree"), image: "unused", test: null, install: null, scratch: mkdtempSync(join(root, "build-")), run: () => { throw new Error("a plan unit runs no container"); } });
  return { unit, repo, tree };
}
let shared: ReturnType<typeof planUnit> | null = null;

async function kindsRun(kindScript: string, unattended = true) {
  shared ??= planUnit();
  const { unit, repo, tree } = shared;
  const h = harness(() => [{ type: "text", text: "unused" }]);
  const gstack = { tree_sha256: "gstack-tree", skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], layers: [{ src: gstackHome(kindScript), dest: "" }] };
  const bare = (name: string) => ({ tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] });
  const seen: { arm: string; env: Record<string, string> }[] = [];
  const rig: HostRig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request) => h.proxy.bind(request), finalize: (m) => h.proxy.finalize(m),
    arms: { none: bare("none"), lens: bare("lens"), "gstack-forced": gstack },
    sandbox: () => localSandbox(() => {}), judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }), close: async () => ({ committed: 0, unknown: 0, lease_id: null }), recovery: null,
    driver: (o) => {
      const d = hostDriver(o);
      return { env: d.env, run: async () => { seen.push({ arm: o.out.split("/").slice(-4)[0]!, env: d.env ?? {} }); return { turns: [], termination: { kind: "completed" }, model_output: false, text_output: false, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: null, loaded_bytes: null }; } };
    },
  };
  const arms: ReviewArm[] = [{ name: "none", told: "none" }, { name: "lens", told: "lens" }, { name: "gstack-forced", told: "gstack", ...(unattended ? { sessionKind: "unattended" as const } : {}) }];
  const kept = mkdtempSync(join(homedir(), ".gstack-evals-ceo-enforced-test-"));
  const out = join(kept, "out");
  const input: ReviewRunInput = { host: "claude", suite: { id: "ceo-outcome-test", sha256: null }, units: [{ unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null }], arms, models: ["claude-opus-5-5"], passes: 1, parallel: 3, timeoutS: 60, cap: 50_000_000, runId: "kinds", out, date: "2026-11-06", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo-outcome" }, env: {} };
  let stops: unknown[] = [];
  try {
    stops = (await runReviewUnits(input, rig)).stops;
  } catch (e) {
    rmSync(kept, { recursive: true, force: true });
    return { error: String(e), seen, keys: [] as { arm: string; task: string }[] };
  } finally {
    h.proxy.stop();
  }
  const cells = existsSync(join(out, "cells.ndjson")) ? readFileSync(join(out, "cells.ndjson"), "utf8") : "";
  rmSync(kept, { recursive: true, force: true });
  if (!cells) return { error: "no cells: " + JSON.stringify(stops), seen, keys: [] };
  const keys = cells.trim().split("\n").map((l) => JSON.parse(l)).map((e) => ({ arm: e.cell.arm as string, task: e.key.parts.task as string }));
  return { error: null, seen, keys };
}

describe("per-arm session kinds (ReviewArm.sessionKind)", () => {
  // Value: protects=section 3.3 item 3: in a run whose gstack arm is unattended, none and lens get no GSTACK_SESSION_KIND in their env or session key, the gstack arm gets it in both, and a pin whose own gstack-session-kind does not print unattended refuses the run before any session; fails_when=the kind leaks to none or lens, misses the gstack arm, or a wrong pin runs; why_new=GEVA-348 3.3 item 3; seam=runReviewUnits keyOf, the driver options, the pin check; no_claim=the CLI flag's parsing (cli.ts)
  test("none and lens stay unset; the gstack arm is unattended in its env and key", async () => {
    const r = await kindsRun('#!/usr/bin/env bash\ncase "${GSTACK_SESSION_KIND:-}" in unattended) echo unattended; exit 0;; esac\necho interactive\n');
    expect(r.error).toBeNull();
    const env = Object.fromEntries(r.seen.map((s) => [s.arm, s.env.GSTACK_SESSION_KIND ?? "unset"]));
    expect(env).toEqual({ none: "unset", lens: "unset", "gstack-forced": "unattended" });
    const unset = await kindsRun("#!/usr/bin/env bash\necho interactive\n", false);
    expect(unset.error).toBeNull();
    const task = (keys: { arm: string; task: string }[]) => Object.fromEntries(keys.map((k) => [k.arm, k.task]));
    const [was, now] = [task(unset.keys), task(r.keys)];
    expect([now.none, now.lens]).toEqual([was.none, was.lens] as string[]);
    expect(now["gstack-forced"]).not.toBe(was["gstack-forced"]!);
  }, 60_000);
  test("a pin whose gstack-session-kind prints something else refuses the run before any session", async () => {
    const r = await kindsRun("#!/usr/bin/env bash\necho interactive\n");
    expect(r.error).toContain("E_SESSION_KIND_PIN: arm gstack-forced: its gstack tree's bin/gstack-session-kind prints \"interactive\"");
    expect(r.seen).toEqual([]);
  }, 60_000);
});
