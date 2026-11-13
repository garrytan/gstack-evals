// Copyright (c) 2026 Garry Tan. MIT License.
// Section 22's money, keyless: item approvals at their caps, reserve mechanics through the real ledger against every
// item's cap, the line and the C1 guard before each launch (wired into hm launch), section 13's infrastructure rerun, and
// dry-run steps 6-ledger, leases-per-item and reserve-mechanics.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { itemCheck, plannedCells } from "../../quick/laneb/l1/l1.ts";
import { Ledger, readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { approve, c1Guard, infraRerun, launchGuard, lineCheck, markDone, needsRerun, runSessions, stepLeases, stepLedger, stepReserve, type Item } from "../../lanes/harness-mechanics/money.ts";
import { bundleLists, CAPS_USD, MODELS, REPO, sha256, STAGE1_OPUS_R2_TASKS, unscreenedText } from "../../lanes/harness-mechanics/pins.ts";
import { HM_PROFILE, itemPlan, ITEMS } from "../../lanes/harness-mechanics/plans.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "hm-money-"));
const items = Object.keys(CAPS_USD) as Item[];
const lists = bundleLists();
const crew = (credits: number) => ({ as_of: "2026-11-09", threads: [{ code: "t1", credits }] });
const CLI = join(REPO, "lanes/harness-mechanics/cli.ts");
const run = (args: string[], env: Record<string, string> = {}) => Bun.spawnSync([process.execPath, CLI, ...args], { env: { ...process.env, ...env }, cwd: REPO, stdout: "pipe", stderr: "pipe" });

describe("approvals", () => {
  test("each item's ledger takes its approval row at its recorded cap, and the row passes L1's item check", () => {
    expect(CAPS_USD).toEqual({ "stage1-opus": 150, "stage1-opus-r2": 121.685384, "stage1-sol": 180, "stage1-sol-run": 179.96147, "stage1-p1": 70, "stage2-replay": 90, "stage2-replay-2": 88.088418, "stage3-pilot": 90, "stage4-opus": 660, "stage4-sol": 800, "stage4-p1": 280, vms: 160 });
    const d = tmp();
    for (const i of items) {
      const p = join(d, i + ".jsonl");
      approve(p, i, CAPS_USD[i], "the Captain");
      const rows = readRows(p);
      expect(rows.map((r) => [r.kind, r.item, r.usd_micros])).toEqual([["approval", i, toMicros(CAPS_USD[i])]]);
      expect(() => itemCheck(rows, i, CAPS_USD[i])).not.toThrow();
      expect(() => approve(p, i, CAPS_USD[i], "the Captain")).toThrow("E_USAGE refused");
    }
  });
  test("any other amount, an unknown item or no approver is refused and writes nothing", () => {
    const d = tmp();
    for (const i of items) for (const usd of [CAPS_USD[i] + 1, CAPS_USD[i] - 0.01, 0]) {
      expect(() => approve(join(d, i + ".jsonl"), i, usd, "the Captain")).toThrow("E_USAGE refused: " + i + "'s recorded cap is $" + CAPS_USD[i]);
      expect(readRows(join(d, i + ".jsonl"))).toEqual([]);
    }
    expect(() => approve(join(d, "x.jsonl"), "crew", 400, "the Captain")).toThrow("E_USAGE hm approve: unknown item crew");
    expect(() => approve(join(d, "y.jsonl"), "vms", 160, " ")).toThrow("--approved-by");
  });
  test("hm approve writes the row at the cap and refuses another amount", () => {
    const d = tmp();
    const ok = run(["approve", "--ledger", join(d, "a.jsonl"), "--item", "stage4-sol", "--usd", "800", "--approved-by", "the Captain"]);
    expect(ok.exitCode).toBe(0);
    expect(readRows(join(d, "a.jsonl"))[0]).toMatchObject({ kind: "approval", item: "stage4-sol", usd_micros: 800_000_000, approved_by: "the Captain" });
    const bad = run(["approve", "--ledger", join(d, "b.jsonl"), "--item", "stage4-sol", "--usd", "810", "--approved-by", "the Captain"]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr.toString()).toStartWith("E_USAGE refused: stage4-sol's recorded cap is $800");
  });
});

describe("reserve mechanics", () => {
  test("against every session item's cap: at the allowance the item stops exactly when settled plus open plus one allowance would pass", () => {
    for (const i of Object.keys(ITEMS) as Item[]) {
      const p = join(tmp(), i + ".jsonl"), a = ITEMS[i]!.allowanceUsd;
      approve(p, i, CAPS_USD[i], "t");
      const r = runSessions(new Ledger(p, i), i + "/p/", Array(400).fill(a), a);
      expect(r.capStop).toContain("passes the cap");
      expect(r.maxCommitted).toBeLessThanOrEqual(toMicros(CAPS_USD[i]));
      expect(r.status.openIds).toEqual([]);
      expect(r.started).toBe(Math.floor(CAPS_USD[i] / a));
      expect(r.status.settledMicros).toBe(toMicros(r.started * a));
      expect(r.notRun).toBe(400 - r.started);
    }
  });
  test("sessions settle at their metered cost, six allowances held open, and an item at its planning rates completes", () => {
    const p = join(tmp(), "s.jsonl");
    approve(p, "stage1-p1", 70, "t");
    const l = new Ledger(p, "stage1-p1");
    const r = runSessions(l, "stage1-p1/s1-1/", [0.2, 2.5, 0.1, 0.3, 0.2, 0.2, 0.2], 2);
    expect(r.allowanceStops).toBe(1);
    expect(r.status.settledMicros).toBe(toMicros(0.2 + 2 + 0.1 + 0.3 + 0.2 + 0.2 + 0.2));
    expect(r.maxCommitted).toBe(toMicros(6 * 2 + 0.2));
    const s1 = readRows(p).filter((x) => x.kind === "reserve").map((x) => x.usd_micros);
    expect(new Set(s1)).toEqual(new Set([toMicros(2)]));
  });
  test("dry-run steps 6-ledger, leases-per-item and reserve-mechanics pass and print the reserve check per item", () => {
    const out = tmp();
    for (const s of [stepLedger, stepLeases, stepReserve]) expect(s(out)).toMatchObject({ pass: true });
    const txt = readFileSync(join(out, "reserve-mechanics.txt"), "utf8");
    expect(txt).toContain("RESERVE stage1-opus: cap $150, reserve per launch $30.00 (6 x $5), room for settled spend $120.00");
    expect(txt).toContain("RESERVE stage4-p1: cap $280, reserve per launch $12.00 (6 x $2), room for settled spend $268.00");
    expect(txt).not.toContain("BAD");
    expect(txt).toContain("RESERVE stage1-sol-run: cap $179.96147, reserve per launch $30.00 (6 x $5), room for settled spend $149.96; C1 projection $138.64 fits");
    expect(txt.split("\n").filter((x) => x.startsWith("RESERVE")).length).toBe(12);
  }, 60_000);
});

describe("infrastructure rerun", () => {
  const row = (o: any) => ({ task: "t", arm: "none", outcome: "graded", reason: "graded", ...o });
  test("no successful response or no verifier reward reruns once; allowance, turn-limit and after-response errors and cap stops never rerun", () => {
    expect(needsRerun(row({ outcome: "infra", reason: "no model response reached the agent (X)" }))).toBe(true);
    expect(needsRerun(row({ outcome: "infra", reason: "no result.json" }))).toBe(true);
    for (const r of ["allowance stop, graded fail", "turn cap, graded fail", "NonZeroAgentExitCodeError, graded"]) expect(needsRerun(row({ reason: r }))).toBe(false);
    expect(needsRerun(row({ outcome: "infra", reason: "no verifier reward, verifier infrastructure error (NonZeroAgentExitCodeError)" }))).toBe(true);
    expect(needsRerun(row({ outcome: "cap_stop", reason: "ledger cap stop" }))).toBe(false);
  });
  test("attempt 2 runs once per owed cell; its failure is missing; a stray attempt 2 is refused", () => {
    const a = row({ task: "a", outcome: "infra", reason: "no result.json" }), b = row({ task: "b", outcome: "infra", reason: "no result.json" });
    const r = infraRerun([a, b, row({ task: "c" })], [row({ task: "a" }), row({ task: "b", outcome: "infra", reason: "no result.json" })]);
    expect(r.rerun).toEqual(["a\tnone", "b\tnone"]);
    expect(r.missing).toEqual(["b\tnone"]);
    expect(r.rects.map((x) => x.attempts)).toEqual([1]);
    expect(() => infraRerun([a], [row({ task: "c" })])).toThrow("E_USAGE hm rerun");
  });
});

describe("launch guard", () => {
  const approved = () => { const d = tmp(); const out: Partial<Record<Item, any[]>> = {}; for (const i of items) { approve(join(d, i + ".jsonl"), i, CAPS_USD[i], "t"); out[i] = readRows(join(d, i + ".jsonl")); } return { d, out }; };
  test("the line: items not done at their caps plus the crew, inside 3,000 and past it", () => {
    const { out } = approved();
    expect(lineCheck(out, crew(400_000)).total).toBe(toMicros(2880));
    expect(lineCheck(out, crew(520_000)).fits).toBe(true);
    expect(lineCheck(out, crew(520_010)).fits).toBe(false);
    const p = join(tmp(), "d.jsonl");
    approve(p, "stage1-p1", 70, "t");
    const l = new Ledger(p, "stage1-p1");
    l.reserve("x", toMicros(10)); l.settle("x", toMicros(9));
    markDone(p, "stage1-p1");
    expect(lineCheck({ ...out, "stage1-p1": readRows(p) }, crew(0)).total).toBe(toMicros(2480 - 70 + 9));
  });
  test("D3: stage1-opus-r2's cap sits inside stage1-opus's, and it launches only once stage1-opus is done at the settled amount its cap leaves", () => {
    expect(toMicros(CAPS_USD["stage1-opus"]) - toMicros(28.314616)).toBe(toMicros(CAPS_USD["stage1-opus-r2"]));
    expect(STAGE1_OPUS_R2_TASKS.length).toBe(23);
    expect(new Set(STAGE1_OPUS_R2_TASKS).size).toBe(23);
    expect(itemPlan("stage1-opus-r2", lists).parts.map((p) => [p.name, p.prefix, [...plannedCells(p).values()].reduce((a, b) => a + b, 0)])).toEqual([["r2-1", "stage1-opus-r2/r2-1/", 92]]);
    const { out } = approved(), parts = itemPlan("stage1-opus-r2", lists).parts;
    const opus = (settled: number, done: boolean) => {
      const p = join(tmp(), "o.jsonl");
      approve(p, "stage1-opus", 150, "t");
      const l = new Ledger(p, "stage1-opus");
      l.reserve("stage1-opus/s1-1/a", toMicros(settled)); l.settle("stage1-opus/s1-1/a", toMicros(settled));
      if (done) markDone(p, "stage1-opus");
      return readRows(p);
    };
    expect(lineCheck({ ...out, "stage1-opus": opus(28.314616, false) }, crew(400_000)).total).toBe(toMicros(2880));
    expect(lineCheck({ ...out, "stage1-opus": opus(28.314616, true) }, crew(400_000)).total).toBe(toMicros(2880));
    expect(launchGuard("stage1-opus-r2", { ...out, "stage1-opus": opus(28.314616, false) }, crew(0), parts, []).why).toEqual(["stage1-opus-r2's cap sits inside stage1-opus's, so it launches only once stage1-opus is marked done"]);
    expect(launchGuard("stage1-opus-r2", { ...out, "stage1-opus": opus(30, true) }, crew(0), parts, []).why).toEqual(["stage1-opus-r2's cap $121.69 is not stage1-opus's cap less its settled $30.00"]);
    expect(launchGuard("stage1-opus-r2", { ...out, "stage1-opus": opus(28.314616, true) }, crew(0), parts, []).ok).toBe(true);
    const f = join(tmp(), "screened.txt"), saved = [process.env.HM_SCREENED, process.env.HM_SCREENED_SHA256];
    writeFileSync(f, unscreenedText(lists));
    Object.assign(process.env, { HM_SCREENED: f, HM_SCREENED_SHA256: sha256(readFileSync(f)) });
    try {
      expect(() => HM_PROFILE.parts("stage1-opus-r2", () => "", {})).toThrow("E_HM_INPUT stage1-opus-r2 names " + STAGE1_OPUS_R2_TASKS.filter((t) => !lists.calibration.includes(t)).join(", "));
      expect(HM_PROFILE.parts("stage1-opus", () => "", {}).length).toBe(2);
    } finally {
      for (const [k, v] of [["HM_SCREENED", saved[0]], ["HM_SCREENED_SHA256", saved[1]]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  test("D4: stage1-sol-run runs stage1-sol's 160 sessions inside stage1-sol's cap, once stage1-sol is done holding only the Sol gate", () => {
    expect(toMicros(CAPS_USD["stage1-sol"]) - toMicros(0.03853)).toBe(toMicros(CAPS_USD["stage1-sol-run"]));
    expect(ITEMS["stage1-sol-run"]).toEqual({ ...ITEMS["stage1-sol"]!, capUsd: 179.96147 });
    const run = itemPlan("stage1-sol-run", lists), sol = itemPlan("stage1-sol", lists);
    expect([run.sessions, run.picker_calls]).toEqual([160, 40]);
    expect(run.parts.map((p) => [p.name, p.prefix, [...plannedCells(p).values()].reduce((a, b) => a + b, 0)])).toEqual([["s1-1", "stage1-sol-run/s1-1/", 80], ["s1-2", "stage1-sol-run/s1-2/", 80]]);
    expect(run.parts.map((p) => p.rects)).toEqual(sol.parts.map((p) => p.rects));
    const { out } = approved();
    const gate = (settled: number, done: boolean) => {
      const p = join(tmp(), "s.jsonl");
      approve(p, "stage1-sol", 180, "t");
      const l = new Ledger(p, "stage1-sol");
      l.reserve("route-s-1", toMicros(5)); l.settle("route-s-1", toMicros(settled));
      if (done) markDone(p, "stage1-sol");
      return readRows(p);
    };
    expect(() => itemCheck(gate(0.03853, true), "stage1-sol", 180)).toThrow("an item serves one run");
    const fresh = join(tmp(), "r.jsonl");
    approve(fresh, "stage1-sol-run", CAPS_USD["stage1-sol-run"], "t");
    expect(() => itemCheck(readRows(fresh), "stage1-sol-run", CAPS_USD["stage1-sol-run"])).not.toThrow();
    expect(lineCheck({ ...out, "stage1-sol": gate(0.03853, false) }, crew(400_000)).total).toBe(toMicros(2880));
    expect(lineCheck({ ...out, "stage1-sol": gate(0.03853, true) }, crew(400_000)).total).toBe(toMicros(2880));
    expect(launchGuard("stage1-sol-run", { ...out, "stage1-sol": gate(0.03853, false) }, crew(0), run.parts, []).why).toEqual(["stage1-sol-run's cap sits inside stage1-sol's, so it launches only once stage1-sol is marked done"]);
    expect(launchGuard("stage1-sol-run", { ...out, "stage1-sol": gate(0.5, true) }, crew(0), run.parts, []).why).toEqual(["stage1-sol-run's cap $179.96 is not stage1-sol's cap less its settled $0.50"]);
    expect(launchGuard("stage1-sol-run", { ...out, "stage1-sol": gate(0.03853, true) }, crew(0), run.parts, []).ok).toBe(true);
  });
  test("C1: every session item fits fresh, and VM rows that would push the projection past the cap refuse", () => {
    for (const i of Object.keys(ITEMS) as Item[]) expect(c1Guard(i, [], itemPlan(i, lists).parts, []).fits).toBe(true);
    const parts = itemPlan("stage1-opus", lists).parts, fresh = c1Guard("stage1-opus", [], parts, []);
    expect(fresh.parallel).toBe(toMicros(30));
    expect(fresh.host).toBe(toMicros(78 * 0.08));
    const p = join(tmp(), "c.jsonl");
    approve(p, "stage1-opus", 150, "t");
    const l = new Ledger(p, "stage1-opus");
    l.reserve("stage1-opus/s1-1/a", toMicros(20)); l.settle("stage1-opus/s1-1/a", toMicros(20));
    expect(c1Guard("stage1-opus", readRows(p), parts, []).fits).toBe(true);
    l.reserve("stage1-opus/s1-1/vm", toMicros(30)); l.settle("stage1-opus/s1-1/vm", toMicros(30));
    const g = launchGuard("stage1-opus", { "stage1-opus": readRows(p) }, crew(0), parts, []);
    expect(g.ok).toBe(false);
    expect(g.why[0]).toStartWith("C1: stage1-opus's projection");
    expect(launchGuard("stage1-opus", { "stage1-opus": readRows(p) }, crew(0), parts, ["s1-1"]).ok).toBe(true);
  });
  test("hm launch runs the guard first: a refusal exits 2 with E_HM_LAUNCH and starts nothing; a pass reaches L1", () => {
    const { d } = approved(), work = tmp();
    writeFileSync(join(work, "plan.json"), JSON.stringify({ item: "stage1-opus", parts: itemPlan("stage1-opus", lists).parts }));
    const c = join(tmp(), "crew.json");
    writeFileSync(c, JSON.stringify(crew(600_000)));
    const env = { HM_LEDGERS: d, HM_CREW: c, LEDGER: join(d, "stage1-opus.jsonl") };
    const bad = run(["launch", work, "--part", "s1-1"], env);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr.toString()).toStartWith("E_HM_LAUNCH stage1-opus: the line: all-in $3080.00");
    writeFileSync(c, JSON.stringify(crew(100_000)));
    const ok = run(["launch", work, "--part", "s1-1"], env);
    expect(ok.stdout.toString()).toStartWith("HM_LAUNCH PASS stage1-opus");
    expect(ok.stderr.toString()).not.toContain("E_HM_LAUNCH");
    expect(run(["launch", work, "--part", "s1-1"], { HM_CREW: c }).stderr.toString()).toStartWith("E_USAGE hm launch guard");
  });
});

describe("D6: done needs the item's pick records", () => {
  const work = (item: string, pickerCalls: number, arms: string[], picks: string[] | null) => {
    const w = tmp();
    writeFileSync(join(w, "hm.json"), JSON.stringify({ item, sessions: 2 * arms.length, picker_calls: pickerCalls }) + "\n");
    writeFileSync(join(w, "plan.json"), JSON.stringify({ item, parts: [{ name: "p1", rects: [{ tasks: ["t1", "t2"], arms, attempts: 1 }] }] }) + "\n");
    if (picks) { mkdirSync(join(w, "pick")); writeFileSync(join(w, "pick", "picks.jsonl"), picks.map((t) => JSON.stringify({ task: t, trial: t + "__x", ships: "A" }) + "\n").join("")); }
    return w;
  };
  const ledger = (item: Item) => { const p = join(tmp(), item + ".jsonl"); approve(p, item, CAPS_USD[item], "t"); return p; };
  const done = (p: string) => readRows(p).some((r) => r.kind === "note" && r.id === "done");
  const pairArms = ["none", "plain-2", "verify-prose", "verify-hook"];

  test("hm done refuses an item with picker calls until its pick records cover every none and plain-2 pair", () => {
    const p = ledger("stage4-p1");
    const bare = run(["done", "--ledger", p, "--item", "stage4-p1"]);
    expect(bare.exitCode).toBe(2);
    expect(bare.stderr.toString()).toStartWith("E_USAGE refused: hm done needs --work <work> for stage4-p1");
    const none = run(["done", "--ledger", p, "--item", "stage4-p1", "--work", work("stage4-p1", 2, pairArms, null)]);
    expect(none.exitCode).toBe(2);
    expect(none.stderr.toString()).toStartWith("E_USAGE refused: stage4-p1 has 2 of 2 picker pairs with no pick record");
    const half = run(["done", "--ledger", p, "--item", "stage4-p1", "--work", work("stage4-p1", 2, pairArms, ["t1"])]);
    expect(half.exitCode).toBe(2);
    expect(half.stderr.toString()).toContain("1 of 2 picker pairs with no pick record");
    expect(half.stderr.toString()).toContain("(t2)");
    expect(done(p)).toBe(false);
    const full = run(["done", "--ledger", p, "--item", "stage4-p1", "--work", work("stage4-p1", 2, pairArms, ["t1", "t2"])]);
    expect(full.exitCode).toBe(0);
    expect(done(p)).toBe(true);
  });

  test("another item's work dir is refused, and an item with no picker calls is done with its work dir alone", () => {
    const p = ledger("stage4-sol");
    const other = run(["done", "--ledger", p, "--item", "stage4-sol", "--work", work("stage4-p1", 2, pairArms, ["t1", "t2"])]);
    expect(other.exitCode).toBe(2);
    expect(other.stderr.toString()).toContain("stage4-p1's work dir, not stage4-sol's");
    expect(done(p)).toBe(false);
    const q = ledger("stage3-pilot");
    const judge = run(["done", "--ledger", q, "--item", "stage3-pilot", "--work", work("stage3-pilot", 0, ["judge-jev", "judge-p1"], null)]);
    expect(judge.exitCode).toBe(0);
    expect(done(q)).toBe(true);
  });

  test("vms and stage2-replay, which plan no sessions, are done with no work dir", () => {
    for (const item of ["vms", "stage2-replay", "stage2-replay-2"] as Item[]) {
      const p = ledger(item);
      expect(run(["done", "--ledger", p, "--item", item]).exitCode).toBe(0);
      expect(done(p)).toBe(true);
    }
  });
});

