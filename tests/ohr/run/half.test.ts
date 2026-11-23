// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 2's preregistered half (pre-run change 3 to the second attempt, part B): 16 of the 32 founder clusters, two of
// each type's four, and 12 of the 24 builders, on every arm and both models, fixed by the seed before any stage 2
// session. The half runs first, the interim read follows, and the second part runs only what that read allows.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PINS, ARMS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { stage2Half } from "../../../lanes/office-hours-rewrite/run/half.ts";
import { comparisonSet, entryId, loadBriefs, makeManifest } from "../../../lanes/office-hours-rewrite/run/manifest.ts";
import { runLaunch } from "../../../lanes/office-hours-rewrite/run/run.ts";
import { ALLOWANCES } from "../../../lanes/office-hours-rewrite/run/run.ts";
import { fixtureBriefs, fixtureSim, scriptedLaunch } from "../../../lanes/office-hours-rewrite/run/seams.ts";
import { parseBlock } from "../../../lanes/office-hours-rewrite/score/block.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";

/** The run area's fixture briefs, with each pair's twins sharing one opening cluster as the real briefs do. */
function pairedBriefs(): string {
  const dir = fixtureBriefs();
  for (const m of loadBriefs(dir)) if (m.twin_of) writeFileSync(join(dir, m.id, "brief.json"), JSON.stringify({ ...m, cluster: [m.id, m.twin_of].sort()[0] }));
  return dir;
}
const briefs = pairedBriefs();
const metas = loadBriefs(briefs);
const ids = comparisonSet(metas, []).ids;
const base = { launch: "stage2" as const, briefsDir: briefs, models: ["opus", "sol"] as const, arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] };
const kindOf = new Map(metas.map((m) => [m.id, m.kind]));
const clusterOf = new Map(metas.map((m) => [m.id, m.cluster]));

describe("the half", () => {
  const h = stage2Half(metas, ids);
  test("holds 16 founder clusters with all their briefs and 12 builders, and the rest is the second half", () => {
    expect(h.first.clusters).toBe(16);
    expect(h.second.clusters).toBe(16);
    expect(h.first.builder.length).toBe(12);
    expect(h.second.builder.length).toBe(12);
    const all = [...h.first.founder, ...h.first.builder, ...h.second.founder, ...h.second.builder];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(ids));
    for (const id of h.first.founder) expect(h.second.founder.some((x) => clusterOf.get(x) === clusterOf.get(id))).toBe(false);
  });
  test("takes half of each founder type's clusters", () => {
    const types = (fs: string[]) => {
      const out: Record<string, Set<string>> = {};
      for (const id of fs) (out[String(metas.find((m) => m.id === id)!.type)] ??= new Set()).add(clusterOf.get(id)!);
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.size]));
    };
    expect(types(h.first.founder)).toEqual(types(h.second.founder));
  });
  test("is seeded: the same on every build, and not the first 16 clusters in id order", () => {
    expect(stage2Half(metas, ids)).toEqual(h);
    const sorted = [...new Set(metas.filter((m) => ids.includes(m.id) && m.kind === "founder").map((m) => m.cluster))].sort();
    expect([...new Set(h.first.founder.map((id) => clusterOf.get(id)))].sort()).not.toEqual(sorted.slice(0, 16));
  });
});

describe("stage 2's two parts", () => {
  const full = makeManifest(base);
  const h = stage2Half(metas, ids);
  const first = makeManifest({ ...base, look: { part: "first" } });
  test("the first part schedules only the half, in the full schedule's seeded order, arms adjacent, and freezes the half", () => {
    const want = new Set([...h.first.founder, ...h.first.builder]);
    expect(first.part).toBe("first");
    expect(first.half).toEqual(h);
    expect(first.entries.length).toBe(40 * 3 * 2);
    expect(first.entries.every((e) => want.has(e.brief))).toBe(true);
    expect(first.entries).toEqual(full.entries.filter((e) => want.has(e.brief)));
    expect(full.entries.slice(0, first.entries.length)).toEqual(first.entries);
  });
  test("after a read that continues, the second part schedules every other comparison brief", () => {
    const second = makeManifest({ ...base, look: { part: "second", half: h, action: "continue", interim_sha256: "a".repeat(64) } });
    const want = new Set([...h.second.founder, ...h.second.builder]);
    expect(second.entries.length).toBe(40 * 3 * 2);
    expect(second.entries.every((e) => want.has(e.brief))).toBe(true);
    expect(new Set([...first.entries, ...second.entries].map(entryId))).toEqual(new Set(full.entries.map(entryId)));
    expect([second.part, second.action, second.interim_sha256]).toEqual(["second", "continue", "a".repeat(64)]);
  });
  test("after a stop for the new skill, the second part schedules only the second half's builders", () => {
    const second = makeManifest({ ...base, look: { part: "second", half: h, action: "stop-new", interim_sha256: "b".repeat(64) } });
    expect(second.entries.length).toBe(12 * 3 * 2);
    expect(second.entries.every((e) => kindOf.get(e.brief) === "builder" && h.second.builder.includes(e.brief))).toBe(true);
  });
  test("a read that stopped the other way or for futility schedules no second part", () => {
    for (const action of ["stop-current", "stop-futility"] as const) expect(() => makeManifest({ ...base, look: { part: "second", half: h, action, interim_sha256: "c".repeat(64) } })).toThrow(/^E_OHR_MANIFEST /);
  });
  test("the second part refuses to drop a brief that ran in the first", () => {
    expect(() => makeManifest({ ...base, dropped: [h.first.builder[0]!], look: { part: "second", half: h, action: "continue", interim_sha256: "d".repeat(64) } })).toThrow(/^E_OHR_RESERVE /);
  });
  test("a part is refused on any launch but stage 2", () => {
    expect(() => makeManifest({ ...base, launch: "stage1", look: { part: "first" } })).toThrow(/^E_OHR_MANIFEST /);
    expect(() => makeManifest({ ...base, launch: "stage2-particle", models: ["particle"], look: { part: "first" } })).toThrow(/^E_OHR_MANIFEST /);
  });
  test("a launch of the first part runs only the half's sessions", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "ohr-half-")), "out");
    const calls: string[] = [];
    const rig = { recovery: null, arms: {}, close: async () => ({ committed: 0, unknown: 0, lease_id: null }) } as unknown as HostRig;
    const run = await runLaunch({ ...base, models: ["opus"], out, runId: "half", allowances: ALLOWANCES, cap: 400_000_000, simCap: 100_000_000, parallel: 1, policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, docker: "docker", day: "2026-11-18", ledger: null, log: () => {}, look: { part: "first" } }, {
      openRig: () => rig,
      simSlot: () => ({ call: async () => ({ kind: "text", text: "" }), spent: () => 0 }),
      simTurn: fixtureSim(),
      parse: parseBlock,
      launch: scriptedLaunch(new Map(), calls),
      treeProblems: () => [],
    });
    const want = new Set([...h.first.founder, ...h.first.builder]);
    expect(run.stops).toEqual([]);
    expect(run.rows.length).toBe(40 * 3);
    expect(run.rows.every((l) => want.has(l.row.brief))).toBe(true);
  });
});
