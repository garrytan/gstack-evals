// Copyright (c) 2026 Garry Tan. MIT License.
// The spend a failed call carries to the item gate's journal (the /ship notes on #346), each fix tested both ways, and
// the ledger lease that caps real spend whatever the journal counts: a real meter, metering proxy and local ledger
// against a stub upstream.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EbError } from "../../../lanes/eng-build/errors.ts";
import { finishTrial } from "../../../lanes/eng-build/launch.ts";
import { underLease } from "../../../lanes/eng-build/pipeline.ts";
import { addSpend, spending, SpendError, takeSpend } from "../../../lanes/eng-build/spend.ts";
import { EpError } from "../../../lanes/eng-planted/errors.ts";
import { ROLE_MODEL, type JudgeRole } from "../../../lanes/eng-planted/readings/judge.ts";
import { codeOf } from "../../../lanes/eng-planted/stages/cases.ts";
import { gatedJudge, JUDGE_ROUTES, meterLauncher } from "../../../lanes/eng-planted/stages/commands.ts";
import { gatedBuild } from "../../../lanes/eng-planted/stages/e2e.ts";
import { itemOf, ItemGate, runGated, settleThrown, type ItemPlan } from "../../../lanes/eng-planted/stages/ledger.ts";
import { gatedCall, runPlantedReviews } from "../../../lanes/eng-planted/stages/pipeline.ts";
import type { PlantedUnit } from "../../../lanes/eng-planted/types.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import { plantedUnits } from "./fixture.ts";

const root = mkdtempSync(join(tmpdir(), "ep-spend-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const plan: ItemPlan = { item: "ep-stock", row: "fixture", projectionUsd: 100, capUsd: 60, kinds: { build: { planned: 20, usd: 2 } } };
const lines = (journal: string) => readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("spend on an error (build.ts:227)", () => {
  test("the spend rides beside the error: a frozen error keeps it and is thrown unchanged", () => {
    const e = Object.freeze(new Error("noVerdict"));
    expect(addSpend(e, 2)).toBe(e);
    expect(Object.keys(e)).toEqual([]);
    expect(takeSpend(e)).toBe(2);
  });
  test("a thrown value that is not an object is wrapped once; spend adds up; nothing spent leaves the value alone", () => {
    const w = addSpend("boom", 1.5);
    expect(w).toBeInstanceOf(SpendError);
    expect((w as SpendError).thrown).toBe("boom");
    expect(addSpend(w, 0.5)).toBe(w);
    expect(takeSpend(w)).toBe(2);
    expect(addSpend("boom", 0)).toBe("boom");
    expect(takeSpend(new Error("unspent"))).toBe(0);
  });
  test("one error read by two callers settles its spend once", async () => {
    const shared = addSpend(new Error("shared"), 4);
    const g = new ItemGate(plan);
    for (const c of [1, 2]) await codeOf(() => runGated([c], { gate: g, kind: () => "build", key: (x) => "c" + x, run: async () => { throw shared; } }));
    expect([g.settled(), g.sessions(), g.inFlight()]).toEqual([4, 1, 0]);
  });
  test("spending adds its amount to whatever its body throws, and returns the body's value untouched", async () => {
    expect(await spending(3, async () => 7)).toBe(7);
    const e = await spending(3, () => { throw new Error("cap"); }).then(() => null, (x) => x);
    expect([(e as Error).message, takeSpend(e)]).toEqual(["cap", 3]);
  });
});

describe("a failed cell counts once in the re-projection (ledger.ts:305 and 312)", () => {
  test("a cell that spent and failed, then ran again on a resume, is one cell: the rest of the plan is still projected", async () => {
    const journal = join(mkdtempSync(join(root, "j-")), "ep-stock.jsonl");
    const a = new ItemGate(plan, { journal });
    expect(await codeOf(() => runGated(["u1"], { gate: a, kind: () => "build", key: (c) => c, run: async () => { throw addSpend(new Error("grading"), 3); } }))).toBe("error: grading");
    expect(lines(journal)).toEqual([{ kind: "build", usd: 3, cell: "u1", failed: true }]);
    expect(a.reprojection()).toBe(3 + 20 * 2);
    const b = new ItemGate(plan, { journal });
    await runGated(["u1"], { gate: b, kind: () => "build", key: (c) => c, run: async () => ({ costUsd: 3 }) });
    expect(b.reprojection()).toBe(6 + 19 * 3);
  });
  test("two different cells still count as two, and a cached repeat under one key adds nothing", async () => {
    const g = new ItemGate(plan);
    await runGated(["u1", "u2"], { gate: g, kind: () => "build", key: (c) => c, run: async () => ({ costUsd: 3 }) });
    expect(g.reprojection()).toBe(6 + 18 * 3);
    await runGated(["u2"], { gate: g, kind: () => "build", key: (c) => c, run: async () => ({ costUsd: 0 }) });
    expect(g.reprojection()).toBe(6 + 18 * 3);
  });
});

describe("a gate stop raised while settling a failed cell (ledger.ts:311)", () => {
  test("the stop is what the stage throws, and it names the cell's own error", async () => {
    const g = new ItemGate({ ...plan, kinds: { build: { planned: 20, usd: 2 } } });
    const e = await runGated([1], { gate: g, kind: () => "build", key: (c) => "c" + c, run: async () => { throw addSpend(new Error("noVerdict"), 30); } }).then(() => null, (x) => x);
    expect((e as EpError).code).toBe("E_EP_REPROJECT");
    expect((e as EpError).message).toContain("the session that spent it ended with: noVerdict");
  });
  test("with no stop, the cell's own error is thrown; a stop met later outranks an earlier ordinary error", async () => {
    const g = new ItemGate(plan);
    expect(await codeOf(() => runGated([1], { gate: g, kind: () => "build", key: (c) => "c" + c, run: async () => { throw addSpend(new Error("noVerdict"), 2); } }))).toBe("error: noVerdict");
    const h = new ItemGate(plan);
    for (let i = 0; i < 9; i++) {
      await h.acquire("build");
      h.settle("build", 2, "old" + i);
    }
    let n = 0;
    const e = await codeOf(() => runGated([1, 2], { gate: h, parallel: 2, kind: () => "build", key: (c) => "c" + c, run: async (c) => { n++; await Bun.sleep(c === 1 ? 1 : 20); if (c === 1) throw new Error("infra"); return { costUsd: 30 }; } }));
    expect([e, n]).toEqual(["E_EP_REPROJECT", 2]);
  });
});

describe("the driven launch's build goes through the gate (e2e.ts:153)", () => {
  test("its cost settles; spend on its error settles and the error is rethrown", async () => {
    const g = new ItemGate(plan, { planned: { build: 1 } });
    expect((await gatedBuild(g, "cell", async () => ({ costUsd: 1.25 }))).costUsd).toBe(1.25);
    expect(await codeOf(() => gatedBuild(g, "cell2", async () => { throw addSpend(new Error("grading"), 0.75); }))).toBe("error: grading");
    expect([g.settled(), g.sessions()]).toEqual([2, 2]);
  });
  test("a build that throws before it spent settles nothing", async () => {
    const g = new ItemGate(plan, { planned: { build: 1 } });
    expect(await codeOf(() => gatedBuild(g, "cell", async () => { throw new Error("launch"); }))).toBe("error: launch");
    expect([g.settled(), g.sessions(), g.inFlight()]).toEqual([0, 0, 0]);
  });
});

describe("the review stage's spend after the session (pipeline.ts:358)", () => {
  const dir = mkdtempSync(join(root, "rev-"));
  const { repos, ids } = plantedUnits(dir, 1);
  const id = ids[0]!;
  const planFile = join(dir, "plan.md");
  writeFileSync(planFile, "# Plan\n");
  const unit = { id, repo: "r0", set: "comparison", ecosystem: "go", stars: "300-999", publicMonth: "2026-10", strictWindow: true, regionLines: 4, planted: ["p1"], plantedClass: { p1: "assert" }, functional: ["f1"], foresee: null, winnable: null, hard: null, pilot: false } as PlantedUnit;
  const units = new Map([[id, { unit, base: join(repos, id), plan: planFile, opening: null }]]);
  const left = (transcript: unknown) => ({ dir, outputs: { plan: "# Reviewed\n", transcript: transcript as string, stateRoot: null, coverage: null }, repoEdits: 0, blocks: 0 });
  test("a mount that fails after a paid session settles every attempt's spend as a failed line", async () => {
    const g = new ItemGate(itemOf("ep-comparison"), { capUsd: 40, planned: { "review:plain": 1, "review:standalone": 0, "review:engphase": 0, build: 0 } });
    let attempt = 0;
    const session = async () => (++attempt === 1 ? { end: "infra" as const, costUsd: 0.5, result: left("") } : { end: "completed" as const, costUsd: 1.5, result: left(null) });
    const e = await codeOf(() => runPlantedReviews({ cells: [{ unit: id, arm: "plain", rep: 1 }], units, reviewer: "opus", out: join(dir, "out1"), session, gate: g, interim: false }));
    expect(e.startsWith("error:")).toBe(true);
    expect([g.settled(), g.sessions(), g.inFlight()]).toEqual([2, 1, 0]);
  });
  test("a launcher stop on a later attempt carries its own spend and the earlier attempts'; a session that spent nothing settles nothing", async () => {
    const g = new ItemGate(itemOf("ep-comparison"), { capUsd: 40, planned: { "review:plain": 1, "review:standalone": 0, "review:engphase": 0, build: 0 } });
    let attempt = 0;
    const session = async () => {
      if (++attempt === 1) return { end: "upstream" as const, costUsd: 0.5, result: left("") };
      throw addSpend(new EbError("E_EB_CELL_INCOMPLETE", "cap"), 1);
    };
    expect(await codeOf(() => runPlantedReviews({ cells: [{ unit: id, arm: "plain", rep: 1 }], units, reviewer: "opus", out: join(dir, "out2"), session, gate: g, interim: false }))).toBe("E_EB_CELL_INCOMPLETE");
    expect(g.settled()).toBe(1.5);
    const h = new ItemGate(itemOf("ep-comparison"), { capUsd: 40, planned: { "review:plain": 1, "review:standalone": 0, "review:engphase": 0, build: 0 } });
    expect(await codeOf(() => runPlantedReviews({ cells: [{ unit: id, arm: "plain", rep: 1 }], units, reviewer: "opus", out: join(dir, "out3"), session: async () => { throw new Error("sandbox"); }, gate: h, interim: false }))).toBe("error: sandbox");
    expect([h.settled(), h.sessions()]).toEqual([0, 0]);
  });
});

describe("the launchers' cap stops carry what the attempt spent (launch.ts:318)", () => {
  test("a lane or ledger stop rethrown after the meter finalizes carries the attempt's spend, unchanged otherwise", async () => {
    for (const e of [new EbError("E_EB_CELL_INCOMPLETE", "cap"), new LedgerError("CAP_STOP", "cap")]) {
      const thrown = await finishTrial(async () => { throw e; }, async () => ({ micros: 2_500_000 })).then(() => null, (x) => x);
      expect(thrown).toBe(e);
      expect(takeSpend(thrown)).toBe(2.5);
    }
  });
  test("a stop whose meter spent nothing carries nothing, and any other throw still ends the attempt infra", async () => {
    const e = new EbError("E_EB_CELL_INCOMPLETE", "cap");
    expect(takeSpend(await finishTrial(async () => { throw e; }, async () => ({ micros: 0 })).then(() => null, (x) => x))).toBe(0);
    expect(await finishTrial(async () => { throw new TypeError("docker"); }, async () => ({ micros: 9 }))).toEqual({ trial: null, error: "TypeError: docker", micros: 9 });
  });
});

describe("a metered call that billed and failed (commands.ts:125), on a real lease", () => {
  const dir = mkdtempSync(join(root, "meter-"));
  const record = join(dir, "record");
  const ledger = join(dir, "ledger.sqlite");
  recordApproval(record, { action: "init", item: "ep-judge", cap_micros: 5_000_000, quotes: [{ words: "spend journal test on a temporary ledger", by: "ep tests", source: "tests/ep/stages/spend.test.ts" }], admission: "warn" });
  const reply = (text: string) => Response.json({ id: "resp_1", object: "response", model: "gpt-6-astra-2026-09-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } });
  const upstream = (async (_url: unknown, init?: { body?: unknown }) => {
    const prompt = String(JSON.parse(String(init?.body ?? "{}")).input?.[0]?.content ?? "");
    if (prompt.includes("not-json")) return new Response("upstream sent half a reply", { status: 200 });
    if (prompt.includes("refused")) return Response.json({ error: { message: "bad request" } }, { status: 400 });
    return reply("FINE");
  }) as unknown as typeof fetch;
  const launcher = (n: number) => meterLauncher({ out: join(dir, "out" + n), cacheDir: join(dir, "cache" + n), maxTokens: 1000, effort: null, label: "ep-judge", models: ROLE_MODEL, routes: JUDGE_ROUTES, roles: ["judge"] as JudgeRole[], fetch: upstream, env: { OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test", OPENROUTER_API_KEY: "test" } });
  const journal = join(dir, "costs", "ep-judge.jsonl");

  test("a reply with no usable text is journaled at what the lease holds for it; a refused call journals nothing", async () => {
    const g = new ItemGate(itemOf("ep-judge"), { capUsd: 5, journal, planned: { call: 4 } });
    const leaseSpend = await underLease({ item: "ep-judge", capUsd: 5, record, ledger }, launcher(1), async (call) => {
      const judge = gatedJudge(g, call);
      expect(await judge("judge", "an ordinary prompt")).toBe("FINE");
      expect(await codeOf(() => judge("judge", "a not-json prompt"))).toBe("E_USAGE");
      expect(await codeOf(() => judge("judge", "a refused prompt"))).toBe("E_USAGE");
      return null;
    });
    expect(leaseSpend).toBeNull();
    const j = lines(journal);
    expect(j.map((l) => [l.failed === true, l.usd > 0])).toEqual([[false, true], [true, true]]);
    const close = readItem(record, "ep-judge").leases[0]!.close!;
    expect(Math.round(g.settled() * 1_000_000)).toBe(close.spent_micros + close.unknown_micros);
    expect(g.inFlight()).toBe(0);
  });

  test("the lease caps real spend: the next lease holds only what the cap has left, and a call past it spends nothing", async () => {
    const before = readItem(record, "ep-judge").leases.reduce((s, l) => s + (l.close ? l.close.spent_micros + l.close.unknown_micros : 0), 0);
    const g = new ItemGate(itemOf("ep-judge"), { capUsd: 5, journal, planned: { call: 4 } });
    const settled = g.settled();
    await underLease({ item: "ep-judge", capUsd: 0.0001, record, ledger }, launcher(2), async (call) => {
      const open = readItem(record, "ep-judge").open!;
      expect(readItem(record, "ep-judge").leases.find((l) => l.lease.lease_id === open.lease_id)!.lease.reserved_micros).toBeLessThanOrEqual(5_000_000 - before);
      expect(await codeOf(() => gatedJudge(g, call)("judge", "another ordinary prompt"))).toBe("E_USAGE");
      return null;
    });
    const close = readItem(record, "ep-judge").leases.at(-1)!.close!;
    expect([close.spent_micros, close.unknown_micros, g.settled()]).toEqual([0, 0, settled]);
  });

  test("an authoring call that spent and threw settles the same way; one that spent nothing frees its slot", async () => {
    const g = new ItemGate(itemOf("ep-authoring"));
    const call = gatedCall(g, async (role) => { throw role === "writer" ? addSpend(new EpError("E_USAGE", "no text"), 0.2) : new EpError("E_USAGE", "refused"); }, "u1");
    expect(await codeOf(() => call("writer", "p"))).toBe("E_USAGE");
    expect(await codeOf(() => call("audit", "p"))).toBe("E_USAGE");
    expect([g.settled(), g.sessions(), g.inFlight()]).toEqual([0.2, 1, 0]);
  });

  test("settleThrown returns the error it was given when the gate does not stop", () => {
    const g = new ItemGate(plan);
    const e = addSpend(new Error("x"), 1);
    expect(settleThrown(g, "build", e, "c")).toBe(e);
  });
});

describe("an empty judge reply is a failed call, asked once more (commands.ts gatedJudge, plan change 2026-11-23)", () => {
  const run = (replies: string[]) => {
    const journal = join(mkdtempSync(join(root, "empty-")), "ep-judge.jsonl");
    const g = new ItemGate(itemOf("ep-judge"), { capUsd: 5, journal, planned: { call: 4 } });
    const attempts: Array<number | undefined> = [];
    const call = async (_role: JudgeRole, _prompt: string, attempt?: number) => {
      attempts.push(attempt);
      return { text: replies[attempts.length - 1] ?? "a third call", costUsd: 0.3 };
    };
    return { g, journal, attempts, judge: gatedJudge(g, call) };
  };

  test("a reply with text settles once as an ordinary line and is not asked again", async () => {
    const t = run(["NONE"]);
    expect(await t.judge("gold-gemini", "p")).toBe("NONE");
    expect(t.attempts).toEqual([undefined]);
    expect(lines(t.journal).map((l) => l.failed === true)).toEqual([false]);
  });

  test("an empty reply settles as a failed line, and the re-ask is attempt 2 under the same cell, whose text counts", async () => {
    const t = run(["", "MATCH 1"]);
    expect(await t.judge("gold-gemini", "p")).toBe("MATCH 1");
    expect(t.attempts).toEqual([undefined, 2]);
    const j = lines(t.journal);
    expect(j.map((l) => [l.failed === true, l.usd, l.cell === j[0].cell])).toEqual([[true, 0.3, true], [false, 0.3, true]]);
    expect(t.g.inFlight()).toBe(0);
  });

  test("a second empty reply comes back empty after two failed lines, with no third call", async () => {
    const t = run([" ", ""]);
    expect(await t.judge("gold-gemini", "p")).toBe("");
    expect(t.attempts).toEqual([undefined, 2]);
    expect(lines(t.journal).map((l) => l.failed === true)).toEqual([true, true]);
    expect(t.g.inFlight()).toBe(0);
  });
});
