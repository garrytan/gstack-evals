// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, armsFor, report, rowState } from "../../lanes/outcome-skills/h2h/analysis/analyze.ts";
import { reprice } from "../../lanes/outcome-skills/h2h/analysis/cost.ts";
import { ledgerDryRun } from "../../lanes/outcome-skills/h2h/analysis/ledger-dryrun.ts";
import { powerTable } from "../../lanes/outcome-skills/h2h/analysis/power.ts";
import { readKey, readout, seal, unseal } from "../../lanes/outcome-skills/h2h/analysis/readout.ts";
import { defaultRng } from "../../lanes/outcome-skills/h2h/analysis/rng.ts";
import { clusteredMcNemar, logRatio, pairedTest, type Pair } from "../../lanes/outcome-skills/h2h/analysis/stats.ts";
import { PREREG_PATH, readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { planningPrice } from "../../lanes/outcome-skills/h2h/rerun.ts";
import type { H2hArm, H2hScore, H2hSession, H2hUnit, Stage, UnitKind } from "../../lanes/outcome-skills/h2h/types.ts";

const p = readPrereg();
const temp = (x: string) => mkdtempSync(join(tmpdir(), x));

/** Units of one kind, two to a repository. */
function units(kind: UnitKind, n: number, stage: Stage, o: { feature?: number; prefix?: string } = {}): H2hUnit[] {
  return Array.from({ length: n }, (_, k) => ({
    id: (o.prefix ?? kind) + "-" + k, class: kind === "O" ? "O" : "B", kind, repo: kind + "-repo-" + Math.floor(k / 2), month: k % 5 === 0 ? "2026-07" : "2026-04", language: k % 2 ? "go" : "ts",
    entry: kind === "O" && k < (o.feature ?? 0) ? "feature" : "bug", image_digest: "sha256:" + "a".repeat(64), licence: "MIT", position: k + 1, stage,
  }));
}
/** k is the unit's index within its kind. */
type Plan = (u: H2hUnit, arm: H2hArm, k: number) => { v: 0 | 1 | "gap"; procedure?: boolean; cost?: number; lines?: number };
function records(us: readonly H2hUnit[], stage: Stage, plan: Plan): { sessions: H2hSession[]; scores: H2hScore[] } {
  const sessions: H2hSession[] = [], scores: H2hScore[] = [];
  us.forEach((u) => {
    const k = u.position - 1;
    for (const arm of armsFor(u)) {
      const r = plan(u, arm, k);
      const gap = r.v === "gap" ? "E_PF_UPSTREAM" : null;
      sessions.push({
        schema: "h2h-session.v1", unit: u.id, arm, model: "claude-opus-5-5", item: "h2h-opus", stage, index: k, end: gap ? "upstream" : "completed", gap, turns: 2, scripted_turns: 1,
        continuations: 0, spurious_continuations: 0, done_seen: true, questions: 0, reservation_refusals: 0, cost_usd: r.cost ?? 1, tokens: { input: 10, output: 5, cache_read: 0, cache_write: 0 }, wall_ms: 1000,
        exposure: { loaded: true, procedure: r.procedure ?? true, markers: [], foreign_reads: [] }, transcript: "t", tree_bundle: "tree",
      });
      scores.push({
        schema: "h2h-score.v1", unit: u.id, arm, stage, outcome: gap ? null : r.v ? "clean_fix" : "no_fix", verified: r.v === 1, verified_without_new_test_rule: r.v === 1, adapted_verified: gap ? null : r.v === 1,
        gap, dropped_arm_tests: [], worktree_pass: null, lines_changed: r.lines ?? 10, planning_lines: 0,
      });
    }
  });
  return { sessions, scores };
}

describe("h2h rng and power", () => {
  test("the numpy stream port matches numpy's own default_rng values", () => {
    const g = defaultRng(20261115);
    expect(Array.from({ length: 5 }, () => g.bits.nextDouble())).toEqual([0.5018875197161071, 0.32147970915293544, 0.586886008230633, 0.29993187655128106, 0.6974616053774219]);
    const g2 = defaultRng(20261115);
    const m: number[][] = [];
    for (let i = 0; i < 2000; i++) m.push(g2.multinomial(83, [0.25, 0.05, 0.7]));
    for (let i = 0; i < 2000; i++) m.push(g2.multinomial(167, [0.35, 0.05, 0.6]));
    expect(createHash("sha256").update(JSON.stringify(m)).digest("hex")).toBe("e2f08a8fdc710e3b5050244fd2675d5689a20c848cafafe7aa66a71fe423394f");
  });

  test("the power port prints power.txt's rows for section 13's sizes", () => {
    const txt = readFileSync(join(PREREG_PATH, "..", "power.txt"), "utf8").split("\n");
    const got = powerTable([60, 80, 100, 150]).trimEnd().split("\n");
    expect(got[0]).toBe(txt.find((l) => l.startsWith("n units"))!);
    for (const l of got.slice(1)) expect(txt).toContain(l);
    expect(got).toHaveLength(13);
  }, 60_000);
});

describe("h2h section 9 tests", () => {
  test("the clustered test and exact McNemar disagree when wins sit in few repositories", () => {
    const pairs: Pair[] = [];
    for (let r = 0; r < 10; r++)
      for (let k = 0; k < 3; k++) {
        const win = r < 3, loss = r === 3 && k === 0;
        pairs.push({ unit: "u" + r + "-" + k, repo: "r" + r, a: loss ? 1 : 0, b: win ? 1 : 0 });
      }
    const t = pairedTest(pairs, p.bootstrap_seed);
    expect(t.b_only).toBe(9);
    expect(t.a_only).toBe(1);
    expect(t.p_exact).toBeCloseTo(0.0215, 3);
    expect(t.p).toBeCloseTo(0.1025, 3);
    expect(t.p).toBeGreaterThan(0.05);
    expect(t.delta).toBeCloseTo(8 / 30, 12);
    expect(t.ci95![0]).toBeLessThanOrEqual(t.delta!);
    expect(clusteredMcNemar(0.5, 0, 4)).toEqual({ z: null, p: 0 });
    expect(clusteredMcNemar(0, 0, 4)).toEqual({ z: null, p: 1 });
    expect(clusteredMcNemar(0.5, 0.1, 1)).toEqual({ z: null, p: 1 });
  });

  test("piece G's log-ratio leaves out zero-line units and counts them", () => {
    const lr = logRatio([{ repo: "a", x: 10, y: 5 }, { repo: "b", x: 20, y: 10 }, { repo: "c", x: 0, y: 4 }, { repo: "d", x: 8, y: 4 }], p.bootstrap_seed);
    expect(lr).toMatchObject({ both_fixed: 4, zero_excluded: 1, n: 3, n_repos: 3 });
    expect(lr.ratio).toBeCloseTo(0.5, 12);
    expect(lr.sd_log).toBeCloseTo(0, 12);
  });

  test("row states take section 9's precedence", () => {
    const base = { incomplete: false, pHolm: 0.001, ci95: [0.1, 0.3] as [number, number] };
    expect(rowState(base)).toBe("ahead");
    expect(rowState({ ...base, ci95: [-0.3, -0.1] })).toBe("behind");
    expect(rowState({ ...base, ci95: [-0.1, 0.3] })).toBe("no_difference");
    expect(rowState({ ...base, pHolm: 0.2 })).toBe("no_difference");
    expect(rowState({ ...base, notExercised: true })).toBe("not_exercised");
    expect(rowState({ ...base, notExercised: true, runAsPublished: true })).toBe("run_as_published");
    expect(rowState({ ...base, runAsPublished: true, incomplete: true })).toBe("incomplete");
    expect(rowState({ ...base, incomplete: true, infeasible: true })).toBe("infeasible");
  });
});

describe("h2h analyze", () => {
  test("a planted stage 2 reads every row state, the MDD, ideas to study and section 10's rows", () => {
    const us = [...units("O", 100, "stage2", { feature: 10 }), ...units("B1", 10, "stage2"), ...units("B2", 50, "stage2")];
    const plan: Plan = (u, arm, k) => {
      if (u.class === "O") {
        if (arm === "gstack" || arm === "superpowers" || arm === "pstack" || arm.startsWith("gstack-")) return { v: 1 };
        if (arm === "agent-skills") return { v: k < 20 ? "gap" : 1 };
        if (arm === "gsd") return { v: 0, procedure: false };
        if (arm === "tstack") return { v: k < 3 ? 0 : 1 };
        return { v: 0 };
      }
      const b = k + (u.kind === "B2" ? 10 : 0);
      if (arm === "tstack") return { v: 1 };
      if (arm === "superpowers") return { v: b < 12 || b === 21 || b === 23 || b === 25 ? (b < 12 ? 1 : 0) : 0 };
      if (arm === "gstack") return { v: b === 21 || b === 23 || b === 25 ? 1 : 0 };
      return { v: 0 };
    };
    const { sessions, scores } = records(us, "stage2", plan);
    const a = analyze({ units: us, sessions, scores, stage: "stage2", runAsPublished: ["pstack"] }, p);
    const state = (cls: string, other: string) => a.family.find((r) => r.class === cls && r.other === other)!;
    expect(state("O", "none").state).toBe("ahead");
    expect(state("O", "superpowers").state).toBe("no_difference");
    expect(state("O", "agent-skills").state).toBe("incomplete");
    expect(state("O", "agent-skills").p_holm_input).toBe(1);
    expect(state("O", "gsd").state).toBe("not_exercised");
    expect(state("O", "pstack").state).toBe("run_as_published");
    expect(state("B", "tstack").state).toBe("behind");
    expect(state("B", "none").state).toBe("no_difference");
    expect(a.qa.map((q) => q.state)).toEqual(["infeasible", "infeasible"]);
    expect(a.family.map((r) => r.holm_rank).sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, k) => k + 1));
    const sp = state("B", "superpowers");
    expect(sp.test.delta).toBeCloseTo(-9 / 60, 12);
    expect(sp.state).toBe("no_difference");
    expect(sp.mdd).not.toBeNull();
    expect(sp.idea_to_study).toBe(true);
    expect(a.ideas_to_study).toEqual(["superpowers on B"]);
    expect(a.fix_method_exposure).toEqual({ O: false, B: false });
    expect(a.triggers).toContain("gstack ahead of plain Opus on O");
    expect(a.triggers).toContain("gstack ties or trails plain Opus on B");
    expect(a.triggers).toContain("A pack ahead of gstack on a class (after Holm, exercised as designed): tstack on B");
    expect(a.triggers).toContain("A pack not exercised as designed: gsd on O");
    expect(report(a).some((l) => l.includes("no difference larger than about"))).toBe(true);
    expect(a.arms.find((r) => r.class === "O" && r.arm === "agent-skills")!.cell).toMatchObject({ units: 100, gaps: 20, incomplete: true });
  }, 120_000);

  test("gstack's own exposure under the floor reads FIX-METHOD, and bug units count as run", () => {
    const us = units("O", 40, "stage2", { feature: 20 });
    const { sessions, scores } = records(us, "stage2", (u, arm) => ({ v: arm === "none" ? 1 : 0, procedure: !(arm === "gstack" && u.entry === "feature") }));
    const a = analyze({ units: us, sessions, scores, stage: "stage2" }, p);
    expect(a.family.find((r) => r.class === "O" && r.other === "none")!.exposure_gstack.procedure).toBe(0.5);
    expect(a.fix_method_exposure.O).toBe(true);
    expect(a.why_null.find((w) => w.class === "O" && w.other === "none")!.reads).toStartWith("FIX-METHOD on exposure");
  }, 120_000);

  test("refuses duplicate, unknown and misplaced records", () => {
    const us = units("O", 4, "stage2");
    const { sessions, scores } = records(us, "stage2", () => ({ v: 1 }));
    expect(() => analyze({ units: us, sessions, scores: [...scores, scores[0]!], stage: "stage2" }, p)).toThrow(/^E_H2H_ANALYSIS_INPUT /);
    expect(() => analyze({ units: us, sessions, scores: [...scores, { ...scores[0]!, unit: "nope" }], stage: "stage2" }, p)).toThrow(/^E_H2H_ANALYSIS_INPUT /);
    expect(() => analyze({ units: us, sessions, scores: [...scores, { ...scores[0]!, arm: "gstack-qa" }], stage: "stage2" }, p)).toThrow(/^E_H2H_ANALYSIS_INPUT /);
  });
});

describe("h2h stage 1 readout", () => {
  const stage1 = () => [...units("O", 12, "stage1", { feature: 2 }), ...units("B1", 6, "stage1"), ...units("B2", 6, "stage1")];
  const keyFile = () => {
    const d = temp("h2h-key-");
    const f = join(d, "key");
    writeFileSync(f, "ab".repeat(32) + "\n");
    chmodSync(f, 0o600);
    return f;
  };
  const plan = (swap: boolean): Plan => (u, arm, k) => {
    if (u.class === "O" && k < 2) {
      const gs = swap ? (k === 0 ? 0 : 1) : k === 0 ? 1 : 0;
      if (arm === "gstack") return { v: gs as 0 | 1 };
      if (arm === "superpowers") return { v: (1 - gs) as 0 | 1 };
      if (arm === "gstack-pony") return { v: 0 };
      return { v: 1 };
    }
    return { v: (k + arm.length) % 3 === 0 ? 0 : 1, cost: 1 + (k % 4) + arm.length / 10, lines: 5 + k };
  };

  test("the release is byte-identical when gstack and Superpowers swap outcomes, and only the sealed file changes", () => {
    const us = stage1();
    const run = (swap: boolean) => {
      const r = readout({ units: us, ...records(us, "stage1", plan(swap)) }, p);
      return { text: JSON.stringify(r.release, null, 2), sealed: r.sealed };
    };
    const a = run(false), b = run(true);
    expect(a.text).toBe(b.text);
    expect(JSON.stringify(a.sealed)).not.toBe(JSON.stringify(b.sealed));
    const key = readKey(keyFile());
    const dir = temp("h2h-sealed-");
    const fa = join(dir, "a.sealed"), fb = join(dir, "b.sealed");
    const sha = seal(a.sealed, key, fa);
    seal(b.sealed, key, fb);
    expect(createHash("sha256").update(readFileSync(fa)).digest("hex")).toBe(sha);
    expect(readFileSync(fa, "utf8")).not.toContain("clean_fix");
    expect(unseal(fa, key)).toEqual(a.sealed);
    expect(unseal(fb, key)).toEqual(b.sealed);
    expect(() => seal(a.sealed, key, fa)).toThrow(/^E_H2H_READOUT_OUT /);
    expect(() => unseal(fa, Buffer.alloc(32, 7))).toThrow(/^E_H2H_READOUT_KEY /);
    expect(Object.keys(JSON.parse(a.text)).sort()).toEqual(["classes", "costs", "cost", "discordant_share", "full_size_flag", "gap_rate", "mdd_restated", "piece_g", "readings", "schema"].sort());
  }, 120_000);

  test("readings fire on their frozen thresholds", () => {
    const us = stage1();
    const floor = readout({ units: us, ...records(us, "stage1", (u, arm, k) => ({ v: arm === "none" ? (k === 0 && u.kind !== "B2" ? 1 : 0) : 1 })) }, p).release;
    expect(floor.readings.filter((r) => r.reading === "FLOOR").map((r) => r.where)).toEqual(["O", "B"]);
    const ceiling = readout({ units: us, ...records(us, "stage1", (u, arm, k) => ({ v: arm === "none" ? (k === 0 && u.kind !== "B2" ? 0 : 1) : 1 })) }, p).release;
    expect(ceiling.readings.filter((r) => r.reading === "CEILING").map((r) => r.where)).toEqual(["O", "B"]);
    const infra = readout({ units: us, ...records(us, "stage1", (u, arm, k) => ({ v: arm === "gsd" && u.class === "B" && k < 2 ? "gap" : 1 })) }, p).release;
    expect(infra.readings.filter((r) => r.reading === "INFRA").map((r) => r.where)).toEqual(["B gsd"]);
    const dear = readout({ units: us, ...records(us, "stage1", (u, arm) => ({ v: 1, cost: 3 * planningPrice(arm, u.class) })) }, p).release;
    expect(dear.readings.map((r) => r.reading)).toContain("COST");
    expect(dear.cost.n_cut).not.toBeNull();
    const flag = readout({ units: us, ...records(us, "stage1", (u, arm) => ({ v: u.class === "B" && arm === "gstack" ? 1 : 0 })) }, p).release;
    expect(flag.full_size_flag).toBe(true);
    expect(infra.full_size_flag).toBe(false);
  }, 120_000);

  test("the key must sit outside any git work tree, mode 0600, 32 bytes", () => {
    const d = temp("h2h-keyrepo-");
    mkdirSync(join(d, ".git"));
    const inRepo = join(d, "key");
    writeFileSync(inRepo, Buffer.alloc(32, 1));
    chmodSync(inRepo, 0o600);
    expect(() => readKey(inRepo)).toThrow(/^E_H2H_READOUT_KEY .*git work tree/);
    const loose = join(temp("h2h-key-"), "key");
    writeFileSync(loose, Buffer.alloc(32, 1));
    chmodSync(loose, 0o644);
    expect(() => readKey(loose)).toThrow(/^E_H2H_READOUT_KEY .*0600/);
    const short = join(temp("h2h-key-"), "key");
    writeFileSync(short, "abc");
    chmodSync(short, 0o600);
    expect(() => readKey(short)).toThrow(/^E_H2H_READOUT_KEY /);
    expect(readKey(keyFile())).toEqual(Buffer.from("ab".repeat(32), "hex"));
  });
});

describe("h2h money", () => {
  test("the frozen n cut is the largest that fits", () => {
    const sess = (scale: number) => (["none", "gstack", "superpowers", "agent-skills", "gsd", "pstack", "tstack", "gstack-pony", "gstack-oneline", "gstack-qa"] as H2hArm[]).flatMap((arm) =>
      (["O", "B"] as const).map((cls) => ({ s: { arm, cost_usd: scale * planningPrice(arm, cls), end: "completed" } as H2hSession, cls })));
    const r = reprice(p, sess(2));
    expect(r.above).toBe(true);
    const cut = r.n_cut!;
    expect(cut.total_at_caps).toBeLessThanOrEqual(r.approved_total);
    const bigger = reprice(p, sess(2), { approved: cut.total_at_caps - 1 });
    expect(bigger.n_cut!.n_O + bigger.n_cut!.n_B).toBeLessThan(cut.n_O + cut.n_B);
    expect(reprice(p, sess(1)).above).toBe(false);
  });

  test("the doubling rule reads a retried session's summed cost, as pricing does", () => {
    const allowance = p.limits.allowance_usd;
    const retried = { arm: "none", end: "completed", cost_usd: (allowance * 3) / 4, attempt_usage: [{ spent_micros: (allowance / 2) * 1e6 }, { spent_micros: (allowance / 4) * 1e6 }] } as unknown as H2hSession;
    const r = reprice(p, [{ s: retried, cls: "O" as const }]);
    expect([r.doubled, r.max_p95, r.costs.none?.O?.mean]).toEqual([true, { arm: "none", usd: (allowance * 3) / 4 }, (allowance * 3) / 4]);
    const cheap = { arm: "none", end: "completed", cost_usd: allowance / 4 } as H2hSession;
    expect(reprice(p, [{ s: cheap, cls: "O" as const }]).doubled).toBe(false);
  });

  test("the ledger dry run opens and settles one lease per item and drives the COST rule", () => {
    const r = ledgerDryRun(p);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.checks.length).toBe(14);
  });
});
