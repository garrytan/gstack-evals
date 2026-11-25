// Value: protects=the review-models run loop features: the seeded order puts each unit's five cells in one round, each
// cell binds through its own rig (one lease per cell) with its voice listed so the proxy can remove the voice's
// web_search, a session that ends on a provider error reruns once on the retry rig and keeps its first attempt, a cell's
// own cap stops the run before a round it cannot hold, and an empty retry reserve leaves the cell a gap with E_RM_RESERVE;
// fails_when=a group mixes units, the order changes with the seed held, an attempt-2 bind reaches a cell's rig, a rerun is
// lost from the journal, the voice is missing from a gstack cell's bind, or a cell's cap is ignored; why_new=GEVA-590 pilot
// run driver (prereg sections 3 and 8); seam=runReviewUnits over composeRigs with stand-in rigs and a scripted driver;
// no_claim=Docker, the proxy and the CLIs, which the keyless end-to-end run covers
import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import type { ArmInstall } from "../../../src/arms/install.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { armCells, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { dirTreeSha256 } from "../../../src/trial/cache.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { AgentSession, Sandbox } from "../../../src/trial/sandbox.ts";
import { composeRigs, loadCellItems } from "../../../src/trial/review/cell-rigs.ts";
import { RM_CELLS, RM_CODEX_DIR, RM_GSTACK } from "../../../src/trial/review/rm-cells.ts";
import { toyRepo } from "../../../src/trial/review/rm-check.ts";
import { armId, rerunnable, runReviewUnits, type PreparedUnit, type ReviewEntry } from "../../../src/trial/review/run.ts";
import { unitTaskId } from "../../../src/trial/review/unit.ts";

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const ids = RM_CELLS.map((c) => armId(c.arm, c.model));

function localSandbox(): Sandbox {
  const session = (work: string, env: Record<string, string>): AgentSession => ({
    exec: (command, timeoutMs) => {
      const r = spawnSync("sh", ["-c", command], { cwd: work, env, timeout: timeoutMs, encoding: "utf8" });
      return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    spawn: (argv) => spawn(argv[0]!, argv.slice(1), { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] }),
    stop() {},
  });
  return {
    isolation: "process",
    workPath: (w) => w,
    fixturesPath: (f) => f,
    homePath: (dir) => join(dir, "home"),
    step(_role, command, _task, o) {
      const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: o.timeoutMs, encoding: "utf8" });
      return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    agent(_task, o) {
      mkdirSync(o.env.HOME!, { recursive: true });
      return session(o.work, o.env);
    },
  };
}

interface Bound { rig: string; arm: string; model: string; attempt: number; unit: string; voices: string[] }

function setup(dir: string, fail: (arm: string, model: string, task: string, attempt: number) => boolean) {
  const stack = (name: string): ArmInstall => ({ name, layers: [], tree_sha256: "tree-" + name, skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], provenance: { kind: "stack", stack: { repo: RM_GSTACK.repo, sha: RM_GSTACK.sha } } });
  const installs = [stack("gstack-sol"), stack("gstack-astra")];
  const cells = armCells(installs, ["claude-opus-5-5", "claude-fable-5-2"], policy, join(dir, "cells"), { voices: { "gstack-sol": "gpt-6.2-sol", "gstack-astra": "gpt-6.2-astra" }, voiceCli: { bin_dir: RM_CODEX_DIR } });
  const bound: Bound[] = [];
  const slots = new Map<string, Bound>();
  let n = 0;
  const standIn = (name: string): HostRig => ({
    baseUrl: "http://" + name + ".invalid", network: null, imageDigest: null,
    recovery: { lease_id: "lease-" + name, proxy_container: name, journal: join(dir, name + ".journal") },
    bind: async (request) => {
      const slot = name + "-slot" + ++n;
      const b = { rig: name, arm: request.cell.arm, model: request.cell.model, attempt: request.cell.attempt, unit: request.cell.task, voices: [...(request.voices ?? [])] };
      bound.push(b);
      slots.set(slot, b);
      return { slot, token: "t", meter_id: slot };
    },
    finalize: async (meter_id) => ({ meter_id, micros: 400_000 }) as never,
    arms: { none: { tree_sha256: "bare:none", skill: null, gstack: null, plugins: [] }, ...Object.fromEntries(installs.map((i) => [i.name, { tree_sha256: i.tree_sha256, skill: null, gstack: i.gstack, plugins: [] }])) },
    cells,
    sandbox: () => localSandbox(),
    judgeSandbox: () => localSandbox(),
    egress: () => ({ open: false, detail: "stand-in" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: "lease-" + name }),
    driver: (d) => ({
      async run() {
        const b = slots.get(d.proxy.slot)!;
        const bad = fail(b.arm, b.model, b.unit, b.attempt);
        return { turns: bad ? [] : ["```json\n[]\n```"], termination: bad ? { kind: "missing", code: "UPSTREAM" } : { kind: "completed" }, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null } as never;
      },
    }),
  });
  const rig = composeRigs(new Map(ids.map((id) => [id, standIn(id)])), standIn("retry"));
  const units: PreparedUnit[] = [1, 2].map((i) => {
    const t = toyRepo(join(dir, "toy" + i));
    const unit = { id: "o/toy" + i + "#" + i + "@" + t.head.slice(0, 12), repo: "o/toy" + i, pr: i, head: t.head, base: t.base };
    return { unit, task: unitTaskId(unit), base_branch: "main", merge_base: t.base, tree: join(dir, "toy" + i), tree_sha256: dirTreeSha256(join(dir, "toy" + i)), instructions: {} };
  });
  const arms = [{ name: "none", told: "none" as const }, ...installs.map((i) => ({ name: i.name, told: "gstack" as const }))];
  const base = { host: "claude" as const, suite: { id: "rm-loop", sha256: null }, units, arms, models: ["claude-opus-5-5", "claude-fable-5-2"], armModels: { none: ["claude-opus-5-5"] }, passes: 1, parallel: 5, timeoutS: 600, cap: null, runId: "rm-loop", date: "2026-11-25", policy, keyBase: { image_digest: null, recipe: "r", host_version: null, adapter_sha256: "a", isolation: "docker" }, journal: null, env: {}, order: { seed: 1795598571 }, cellAllowances: Object.fromEntries(ids.map((id) => [id, 1_000_000])), keepSessions: true };
  return { rig, bound, units, base };
}

const entries = (out: string): ReviewEntry[] => readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const work = () => mkdtempSync(join(REPO_ROOT, ".rm-loop-test-"));

describe("the review-models run loop (keyless)", () => {
  test("seeded order, one rig per cell, voices on the bind and one rerun on the retry rig", async () => {
    const dir = work();
    try {
      const s = setup(dir, (arm, model, task, attempt) => arm === "gstack-sol" && model === "claude-opus-5-5" && task.startsWith("toy1-") && attempt === 1);
      const out = join(dir, "out");
      const logs: string[] = [];
      const run = await runReviewUnits({ ...s.base, out, cellCaps: Object.fromEntries(ids.map((id) => [id, 5_000_000])), rerun: { cap: 3_000_000 } }, s.rig, (l) => logs.push(l));
      expect(run.stops).toEqual([]);
      const order = readFileSync(join(out, "order.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
      expect(order).toHaveLength(10);
      for (const g of ["1", "2"]) {
        const rows = order.filter((r) => r[0] === g);
        expect(new Set(rows.map((r) => r[3])).size).toBe(1);
        expect(rows.map((r) => r[2]).sort()).toEqual([...ids].sort());
      }
      expect(order.filter((r) => r[0] === "1").map((r) => r[2])).not.toEqual(ids);
      const again = setup(join(dir, "again"), () => false);
      await runReviewUnits({ ...again.base, units: s.base.units, out: join(dir, "out2") }, again.rig);
      expect(readFileSync(join(dir, "out2", "order.tsv"), "utf8")).toBe(readFileSync(join(out, "order.tsv"), "utf8"));
      for (const b of s.bound) {
        expect(b.rig).toBe(b.attempt === 1 ? armId(b.arm, b.model) : "retry");
        expect(b.voices).toEqual(b.arm === "none" ? [] : ["openai:" + (b.arm === "gstack-sol" ? "gpt-6.2-sol" : "gpt-6.2-astra")]);
      }
      expect(s.bound.filter((b) => b.attempt === 2)).toHaveLength(1);
      const reran = entries(out).filter((e) => e.rerun);
      expect(reran).toHaveLength(1);
      expect(reran[0]!.rerun).toMatchObject({ ran: true, first: { termination: { kind: "missing", code: "UPSTREAM" }, usd: 0.4 } });
      expect(reran[0]!.parse.kind).toBe("findings");
      expect(reran[0]!.record.termination.kind).toBe("completed");
      expect(existsSync(reran[0]!.rerun!.first.dir)).toBe(true);
      expect(JSON.parse(readFileSync(join(out, "arms", "gstack-sol-opus", "arm.json"), "utf8")).reruns).toEqual({ ran: 1, reserve_out: 0 });
      expect(logs.some((l) => l.includes("its one rerun runs on the retry reserve"))).toBe(true);
    } finally {
      removeTree(dir);
    }
  }, 120_000);

  test("a cell's own cap stops the run, and an empty reserve leaves a gap", async () => {
    const dir = work();
    try {
      const s = setup(dir, (arm, model, _t, attempt) => arm === "gstack-astra" && model === "claude-fable-5-2" && attempt === 1);
      const out = join(dir, "out");
      const logs: string[] = [];
      const run = await runReviewUnits({ ...s.base, out, cellCaps: { ...Object.fromEntries(ids.map((id) => [id, 5_000_000])), "gstack-astra-fable": 1_300_000 }, rerun: { cap: 500_000 } }, s.rig, (l) => logs.push(l));
      expect(run.stops.map((x) => x.code)).toContain("CAP_STOP");
      expect(run.stops.find((x) => x.code === "CAP_STOP")!.message).toContain("gstack-astra-fable");
      expect(entries(out)).toHaveLength(5);
      expect(s.bound.some((b) => b.attempt === 2)).toBe(false);
      expect(logs.some((l) => l.startsWith("E_RM_RESERVE "))).toBe(true);
      const gap = entries(out).find((e) => e.cell.arm === "gstack-astra")!;
      expect(gap.rerun).toMatchObject({ ran: false });
      expect(JSON.parse(readFileSync(join(out, "arms", "gstack-astra-fable", "arm.json"), "utf8")).coverage_gaps).toHaveLength(1);
    } finally {
      removeTree(dir);
    }
  }, 120_000);

  test("rerunnable covers provider and infrastructure ends only", () => {
    expect([{ kind: "missing", code: "UPSTREAM" }, { kind: "missing", code: "E_INFRA_FAILURE" }, { kind: "infra", incident: "x" }, { kind: "unknown", reservation_id: "r" }].every((t) => rerunnable(t as never))).toBe(true);
    expect([{ kind: "completed" }, { kind: "timeout" }, { kind: "missing", code: "E_ALLOWANCE" }, { kind: "missing", code: "E_BACKGROUND_DEADLINE" }, { kind: "arm_failure", failure: "harness_crash" }, { kind: "cap_stop" }].some((t) => rerunnable(t as never))).toBe(false);
  });

  test("the cell items file names every cell, apart items and a sane retry", () => {
    const dir = work();
    try {
      const f = join(dir, "items.json");
      const cells = Object.fromEntries(ids.map((id, i) => [id, { item: "geva590-pilot-" + i, cap_usd: 20, allowance_usd: 2 }]));
      writeFileSync(f, JSON.stringify({ schema: "rm-cell-items.v1", cells, retry: { item: "geva590-retry", run_id: "geva590-retry", cap_usd: 5 } }));
      expect(Object.keys(loadCellItems(f, ids).cells)).toEqual(ids);
      writeFileSync(f, JSON.stringify({ schema: "rm-cell-items.v1", cells: { ...cells, [ids[0]!]: { item: "geva590-pilot-1", cap_usd: 1, allowance_usd: 2 } }, retry: { item: "geva590-pilot-2", run_id: "r", cap_usd: 5 } }));
      const err = (() => { try { loadCellItems(f, [...ids, "extra-opus"]); return ""; } catch (e) { return (e as Error).message; } })();
      for (const want of ["no entry for cell extra-opus", "allowance is above its cap", "two cells name the same item", "the retry item is also a cell's item"]) expect(err).toContain(want);
    } finally {
      removeTree(dir);
    }
  });
});
