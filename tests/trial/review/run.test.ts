import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArm } from "../../../lanes/review-noloss/contract.ts";
import type { Suite } from "../../../lanes/review-noloss/suite.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { dirTreeSha256 } from "../../../src/trial/cache.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { AgentOutcome } from "../../../src/trial/trial.ts";
import { ARM_ID, armId, modelTag, readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { sourceRepo } from "./helpers.ts";

const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-5-5";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const durable = () => {
  const dir = mkdtempSync(join(REPO_ROOT, ".review-units-test-"));
  roots.push(dir);
  return dir;
};
const files = (dir: string) => {
  const map = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : map.set(relative(dir, join(d, n)), readFileSync(join(d, n)));
  };
  walk(dir);
  return map;
};

describe("arm ids", () => {
  // Value: protects=every model in the default policy, the DeepSeek and particle rungs included, gets an arm id that fits contract v1 with each told arm; fails_when=a model tag keeps a provider prefix or grows past 24 characters.
  test("every policy model fits ARM_ID with each told arm", () => {
    for (const m of Object.keys(policy.policy.models)) for (const arm of ["none", "gstack", "pstack", "tstack"]) expect(armId(arm, m)).toMatch(ARM_ID);
    expect(modelTag("deepseek/deepseek-v4.1-flash-1017")).toBe("deepseek-v4-1-flash-1017");
    expect(modelTag("particle-ai/particle-1")).toBe("particle-1");
    expect(modelTag(OPUS)).toBe("opus");
    const long = modelTag("vendor/" + "x".repeat(40));
    expect(long).toHaveLength(24);
    expect(long).not.toBe(modelTag("vendor/" + "x".repeat(41)));
  });
});

describe("review units in the run loop (keyless)", () => {
  // Value: protects=each review is a trial on its own proxy slot: findings files and cost.tsv with usd from the real journal, the voice admitted only in its cell, missing and malformed outputs counted apart (a malformed or incomplete pass stops its arm with a coverage gap, so it is never scored as an empty review; a missing block stays a flagged zero), resume reusing every cell with no spend, a changed key refused with E_CACHE_STALE, receipts copied to the sink, and arms that parse under contract v1; fails_when=any of those regress; why_new=GEVA-70 build step 2; seam=runReviewUnits on a test rig with the harness proxy; no_claim=Claude Code and the Docker rig, which the canary and the Docker tier cover
  test("findings, cost, voice, resume and a changed key", async () => {
    const h = harness(() => [{ type: "text", text: "ok" }]);
    roots.push(h.dir);
    const s = sourceRepo();
    const unit = { id: "garrytan/gstack#7@" + s.head.slice(0, 12), repo: "garrytan/gstack", pr: 7, head: s.head, base: s.base };
    const repoDir = join(mkdtempSync(join(tmpdir(), "gse-rununit-")), "repo");
    roots.push(repoDir);
    const repo = buildUnitRepo({ unit, source: s.root, dest: repoDir });
    const prepared: PreparedUnit = { unit, task: unitTaskId(unit), base_branch: repo.base_branch, merge_base: repo.merge_base, tree: repoDir, tree_sha256: dirTreeSha256(repoDir), instructions: repo.instructions };
    const slots = new Map<string, { arm: string; model: string }>();
    const prompts: string[] = [];
    const output: Record<string, string> = { ["gstack " + OPUS]: fixture("gstack.md"), ["gstack " + HAIKU]: fixture("empty.md"), ["none " + OPUS]: fixture("malformed-bad-json.md"), ["none " + HAIKU]: fixture("missing.md") };
    const post = (base: string, token: string, route: string, body: unknown) => fetch(base + route, { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", authorization: "Bearer " + token }, body: JSON.stringify(body) });
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => {
        const b = h.proxy.bind(request);
        slots.set(b.slot, { arm: request.cell.arm, model: request.cell.model });
        return b;
      },
      finalize: (m) => h.proxy.finalize(m),
      arms: { none: { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] }, gstack: { tree_sha256: "gstack-tree", skill: null, gstack: null, plugins: [] } },
      cells: { gstack: { [OPUS]: { cell: { model: OPUS, voice: "gpt-6.1-sol" }, layer: null, gstack_config: { codex_reviews: "enabled" }, codex: { model: "gpt-6.1-sol" }, tree_sha256: "gstack-opus" }, [HAIKU]: { cell: { model: HAIKU, voice: null }, layer: null, gstack_config: { codex_reviews: "disabled" }, codex: null, tree_sha256: "gstack-haiku" } } },
      sandbox: () => localSandbox(() => {}),
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
      driver: (o) => ({
        async run(session, task): Promise<AgentOutcome> {
          const cell = slots.get(o.proxy.slot)!;
          prompts.push(task.prompt);
          const base = o.proxy.baseUrl + "/" + o.proxy.slot;
          const main = await post(base + "/anthropic", o.proxy.token, "/v1/messages", { model: o.model, max_tokens: 64, messages: [{ role: "user", content: task.prompt }] });
          await main.text();
          if (cell.arm === "gstack") (await post(base + "/openai", o.proxy.token, "/v1/responses", { model: "gpt-6.1-sol", input: "second opinion", max_output_tokens: 64 })).text();
          const config = session.exec('cat "$GSTACK_STATE_ROOT/config.yaml"', 10_000).stdout;
          if (cell.arm === "gstack" && !config.includes("codex_reviews: " + (o.codex ? "enabled" : "disabled"))) throw new Error("the cell's gstack config did not reach the state root");
          return { turns: ["working", output[cell.arm + " " + cell.model]!], termination: { kind: "completed" }, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 2, loaded_bytes: null };
        },
      }),
    };
    const out = durable();
    const sink = durable();
    const input: ReviewRunInput = { host: "claude", suite: { id: "review-test", sha256: null }, units: [prepared], arms: [{ name: "none", told: "none" }, { name: "gstack", told: "gstack" }], models: [OPUS, HAIKU], passes: 1, parallel: 2, timeoutS: 120, cap: 50_000_000, runId: "review-run", out, date: "2026-10-30", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: join(h.dir, "journal.ndjson"), env: { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: sink } };
    try {
      const first = await runReviewUnits(input, rig);
      expect(first.stops).toEqual([]);
      expect(first.spent).toBeGreaterThan(0);
      expect(prompts.filter((p) => p.startsWith("/review Review the changes on this branch against the base branch main")).length).toBe(2);
      expect(first.outcomes).toEqual({ "none-opus": { findings: 0, empty: 0, missing: 0, malformed: 1, incomplete: 0, not_run: 0 }, "none-haiku": { findings: 0, empty: 0, missing: 1, malformed: 0, incomplete: 0, not_run: 0 }, "gstack-opus": { findings: 1, empty: 0, missing: 0, malformed: 0, incomplete: 0, not_run: 0 }, "gstack-haiku": { findings: 0, empty: 1, missing: 0, malformed: 0, incomplete: 0, not_run: 0 } });
      const file = "findings/garrytan__gstack#7@" + s.head.slice(0, 12) + ".jsonl";
      const findings = readFileSync(join(out, "arms", "gstack-opus", file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(findings.map((f) => [f.severity, f.path, f.line, f.pass, f.id])).toEqual([["CRITICAL", "src/parse.ts", 17, 1, "p1-1"], ["INFORMATIONAL", "README.md", null, 1, "p1-2"]]);
      expect(readFileSync(join(out, "arms", "none-opus", file), "utf8")).toBe("");
      const cost = (arm: string) => readFileSync(join(out, "arms", arm, "cost.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
      const opus = cost("gstack-opus");
      expect(opus.map((r) => r[1])).toEqual(["all", "voice"]);
      expect(Number(opus[0]![9])).toBeGreaterThan(0);
      expect(opus[0]![11]).toBe("proxy-journal");
      expect(opus[1]!.slice(12, 15)).toEqual(["1", "", "0"]);
      expect(Number(opus[1]![9])).toBeGreaterThan(0);
      const haiku = cost("gstack-haiku");
      expect(haiku.length).toBe(1);
      expect(haiku[0]!.slice(12, 15)).toEqual(["1", "1", "0"]);
      expect(Number(haiku[0]![9])).toBeGreaterThan(0);
      const refusals = readFileSync(join(out, "refusals.tsv"), "utf8");
      expect(refusals).toContain("gstack-haiku\tgstack\t" + HAIKU + "\t1\t1\t1\t0.5000\tyes");
      expect(readFileSync(join(out, "parses.tsv"), "utf8")).toContain("none-opus\tnone\t" + OPUS + "\t" + unit.id + "\t1\tmalformed\t\t");
      const units = JSON.parse(readFileSync(join(out, "units.json"), "utf8"));
      expect(units.units[0]).toMatchObject({ id: unit.id, task: unitTaskId(unit), merge_base: s.mergeBase, base_branch: "main", tree_sha256: prepared.tree_sha256 });
      const suite = { schema_version: 1, id: "review-test", title: "t", kind: "noloss", units: [{ ...unit, cluster: "garrytan/gstack#7", group: null, blockers: [] }] } as unknown as Suite;
      for (const id of ["none-opus", "none-haiku", "gstack-opus", "gstack-haiku"]) expect(() => parseArm(files(join(out, "arms", id)), suite)).not.toThrow();
      const malformed = JSON.parse(readFileSync(join(out, "arms", "none-opus", "arm.json"), "utf8"));
      expect(malformed.status).toBe("stopped");
      expect(malformed.coverage_gaps).toEqual([expect.stringMatching(new RegExp("^" + unit.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " pass 1: malformed, "))]);
      expect(JSON.parse(readFileSync(join(out, "arms", "none-haiku", "arm.json"), "utf8"))).toMatchObject({ status: "complete" });
      expect(JSON.parse(readFileSync(join(out, "arms", "none-haiku", "arm.json"), "utf8")).coverage_gaps).toBeUndefined();
      expect(JSON.parse(readFileSync(join(out, "arms", "gstack-opus", "arm.json"), "utf8"))).toMatchObject({ id: "gstack-opus", passes: 1, status: "complete", models: [{ role: "driver", model: OPUS }, { role: "voice", model: "gpt-6.1-sol" }], cell_tree_sha256: "gstack-opus" });
      expect(existsSync(join(sink, "arms", "gstack-opus", "cost.tsv"))).toBe(true);
      expect(existsSync(join(sink, "cells.ndjson"))).toBe(true);

      const calls = h.upstream.length;
      mkdirSync(join(out, "arms", "none-particle-ai-particle-1"), { recursive: true });
      const again = await runReviewUnits({ ...input, reuse: readReviewJournal(out), env: {} }, rig);
      expect(existsSync(join(out, "arms", "none-particle-ai-particle-1"))).toBe(false);
      expect(again.stops).toEqual([]);
      expect(again.spent).toBe(0);
      expect(h.upstream.length).toBe(calls);
      expect(readFileSync(join(out, "arms", "gstack-opus", file), "utf8").trim().split("\n").length).toBe(2);
      expect(cost("gstack-opus")).toEqual(opus);

      const changed = await runReviewUnits({ ...input, units: [{ ...prepared, tree_sha256: "0".repeat(64) }], reuse: readReviewJournal(out), env: {} }, rig);
      expect(changed.stale.length).toBe(4);
      expect(changed.stops.every((x) => x.code === "E_CACHE_STALE")).toBe(true);
      expect(changed.stale[0]!.message).toContain("fixture_tree");
      expect(changed.spent).toBe(0);
      expect(h.upstream.length).toBe(calls);

      const volatile = await runReviewUnits({ ...input, out: join(tmpdir(), "gse-review-volatile"), env: {} }, rig);
      expect(volatile.stops.map((x) => x.code)).toEqual(["E_RECEIPTS_VOLATILE"]);
    } finally {
      h.proxy.stop();
    }
  }, 120_000);
});
