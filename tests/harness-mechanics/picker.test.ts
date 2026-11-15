// Copyright (c) 2026 Garry Tan. MIT License.
// Unit 7's bo2 picker (section 7): the picker model per family, the seeded coin, the 40,000-character cut, the
// deterministic rules, one picker call through the decision-routing metering proxy, the Lane B ledger adapter and the
// none-row columns.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coinOrder, cutDiff, deterministicShip, LaneBReservations, pickerColumns, pickerModel, pickerPrompt, pickTask, proxySend, PICKER_CUT, type Pick, type PickTask } from "../../lanes/harness-mechanics/picker.ts";
import { taskCustody } from "../../lanes/harness-mechanics/leak.ts";
import { HM } from "../../lanes/harness-mechanics/pins.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { Ledger, readRows } from "../../quick/laneb/runner/ledger.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const WORK = join(process.env.HOME!, ".capy/work/hm/unit7/test-tmp");
let dirs: string[] = [], stops: Array<() => void> = [];
afterEach(() => { stops.forEach((s) => s()); stops = []; dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = []; });
const temp = () => { mkdirSync(WORK, { recursive: true }); const d = mkdtempSync(join(WORK, "pick-")); dirs.push(d); return d; };
function proxyWorld(dir: string, reply: string, ledger: ReservationLedger = new MemLedger()) {
  const bodies: string[] = [];
  const proxy = new MeteringProxy({
    ledger, leaseId: "hm-stage1-opus.0001", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789",
    journal: join(dir, "journal.ndjson"), retry: { attempts: 1, elapsed_ms: 60_000 }, env: { ANTHROPIC_API_KEY: "sk-ant-hm-0123456789", OPENAI_API_KEY: "sk-oa-hm-0123456789" },
    sleep: async () => {}, allowanceCode: "DR_ALLOWANCE_STOP",
    fetch: async (url, init) => {
      bodies.push(String(init.body ?? ""));
      return String(url).includes("openai") ? Response.json({ id: "c", choices: [{ message: { role: "assistant", content: reply } }], usage: { prompt_tokens: 1000, completion_tokens: 50 } })
        : Response.json({ id: "m", content: [{ type: "text", text: reply }], usage: { input_tokens: 1000, output_tokens: 50 } });
    },
  });
  proxy.start();
  return { proxy, bodies, journal: join(dir, "journal.ndjson") };
}
class MemLedger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + (this.reservations.size + 1), ...r, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.reservations.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}


const DIFF_A = "diff --git a/calc.py b/calc.py\n-    return a - b\n+    return a + b\n";
const DIFF_B = "diff --git a/calc.py b/calc.py\n-    return a - b\n+    return b + a\n";
const task = (a: string, b: string, pa = true, pb = false): PickTask => ({ task: "t1", model: "claude-opus-5-5", trial: "1", issue: "add() returns the difference", a: { diff: a, pass: pa }, b: { diff: b, pass: pb } });
function custody(root: string) {
  const t = join(root, "task");
  mkdirSync(join(t, "tests"), { recursive: true });
  writeFileSync(join(t, "tests", "test.patch"), "diff --git a/tests/test_calc.py b/tests/test_calc.py\n+def test_hidden_regression_case():\n");
  return taskCustody(t, { files: [], testNames: [] }, join(root, "custody"));
}

describe("picker rules", () => {
  test("GPT-6.1 Sol picks for Opus; Opus 5.5 picks for Sol and particle-1", () => {
    expect(pickerModel("opus")).toEqual({ provider: "openai", model: "gpt-6.1-sol" });
    expect(pickerModel("sol")).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(pickerModel("p1")).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
  });
  test("the coin is seeded by HM.seed and the task id: stable per task, both orders across tasks, and a different seed moves some", () => {
    const ids = Array.from({ length: 40 }, (_, i) => "task-" + i);
    expect(ids.map((t) => coinOrder(t))).toEqual(ids.map((t) => coinOrder(t, HM.seed)));
    const firsts = new Set(ids.map((t) => coinOrder(t)[0]));
    expect(firsts).toEqual(new Set(["A", "B"]));
    expect(ids.some((t) => coinOrder(t, HM.seed + 1)[0] !== coinOrder(t)[0])).toBe(true);
  });
  test("a diff is cut at 40,000 characters and the cut is counted; one at the limit is not cut", () => {
    expect(cutDiff("x".repeat(PICKER_CUT + 1))).toEqual({ text: "x".repeat(PICKER_CUT), cut: true });
    expect(cutDiff("x".repeat(PICKER_CUT))).toEqual({ text: "x".repeat(PICKER_CUT), cut: false });
  });
  test("an empty diff loses to a non-empty one in both positions, two empty diffs ship empty, two non-empty need the picker", () => {
    expect(deterministicShip("", DIFF_B)).toBe("B");
    expect(deterministicShip(DIFF_A, "  \n")).toBe("A");
    expect(deterministicShip("", "")).toBe("A");
    expect(deterministicShip(DIFF_A, DIFF_B)).toBeNull();
  });
  test("the prompt holds the issue and the diffs in position order and asks for PATCH 1 or PATCH 2", () => {
    const p = pickerPrompt("ISSUE-X", "FIRST-DIFF", "SECOND-DIFF");
    expect(p).toContain("ISSUE-X");
    expect(p.indexOf("FIRST-DIFF")).toBeLessThan(p.indexOf("SECOND-DIFF"));
    expect(p).toMatch(/PATCH 1 or PATCH 2/);
  });
});

describe("pickTask", () => {
  test("deterministic cases make no call and leave picker_parsed null", async () => {
    let calls = 0;
    const p = await pickTask(task("", DIFF_B, true, true), "opus", async () => { calls++; return { reply: "PATCH 1", cost_usd: 1 }; });
    expect(calls).toBe(0);
    expect(p).toMatchObject({ called: false, ships: "B", parsed: null, bo2_pass: true, cost_usd: 0 });
  });
  test("a parsed reply ships the attempt at that position under the coin", async () => {
    const order = coinOrder("t1"), p = await pickTask(task(DIFF_A, DIFF_B), "opus", async () => ({ reply: "B looks right.\nPATCH 2", cost_usd: 0.25 }));
    expect(p).toMatchObject({ called: true, parsed: true, ships: order[1], order, cost_usd: 0.25, picker: "openai:gpt-6.1-sol", cuts: 0 });
    expect(p.bo2_pass).toBe(order[1] === "A");
    expect(p.pass2).toBe(true);
  });
  test("any other reply ships attempt A and is counted as unparsed", async () => {
    const p = await pickTask(task(DIFF_A, DIFF_B, false, true), "sol", async () => ({ reply: "PATCH 2 is better, I think", cost_usd: 0.1 }));
    expect(p).toMatchObject({ called: true, parsed: false, ships: "A", bo2_pass: false, picker: "anthropic:claude-opus-5-5" });
  });
  test("cuts are counted per diff and the prompt carries the cut diffs", async () => {
    let body = "";
    const p = await pickTask(task("+" + "a".repeat(PICKER_CUT + 5), "+" + "b".repeat(PICKER_CUT + 5)), "opus", async (r) => { body = r.prompt; return { reply: "PATCH 1", cost_usd: 0 }; });
    expect(p.cuts).toBe(2);
    expect(body).not.toContain("a".repeat(PICKER_CUT + 1));
  });
});

describe("proxySend through the decision-routing metering proxy", () => {
  test("binds a slot with the task's markers, returns the reply and the metered cost, and settles on the ledger", async () => {
    const root = temp(), ledger = new MemLedger(), w = proxyWorld(root, "ok\nPATCH 1", ledger);
    stops.push(() => w.proxy.stop());
    const send = proxySend(w.proxy, { run_id: "hm-stage1", arm: "picker", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 }, 1_000_000, custody(root));
    const r = await send({ provider: "openai", model: "gpt-6.1-sol", prompt: "pick one" });
    expect(r.reply).toBe("ok\nPATCH 1");
    expect(r.cost_usd).toBeGreaterThan(0);
    expect(JSON.parse(w.bodies[0]!).model).toBe("gpt-6.1-sol");
    expect([...ledger.reservations.values()].every((x) => x.state === "settled")).toBe(true);
  });
  test("a prompt carrying the task's canary stops with DR_CUSTODY_HIT and sends nothing upstream", async () => {
    const root = temp(), w = proxyWorld(root, "PATCH 1"), c = custody(root);
    stops.push(() => w.proxy.stop());
    const send = proxySend(w.proxy, { run_id: "hm-stage1", arm: "picker", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 }, 1_000_000, c);
    await expect(send({ provider: "anthropic", model: "claude-opus-5-5", prompt: "diff with " + c.canary })).rejects.toThrow(/DR_CUSTODY_HIT/);
    expect(w.bodies).toHaveLength(0);
  });
});

describe("LaneBReservations", () => {
  const cell: CellAttempt = { run_id: "hm-stage1", arm: "picker", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1, meter_id: "m1" };
  test("reserves under the item's cap and settles at the spent amount", async () => {
    const path = join(temp(), "ledger.jsonl"), l = new Ledger(path, "stage1-opus");
    l.approve(1, { by: "test" });
    const a = new LaneBReservations(l, "picker-t1");
    const r = await a.reserve({ idempotency_key: "k1", lease_id: "lease", cell, max_micros: 400_000 });
    expect(r.ok).toBe(true);
    const id = r.ok ? r.reservation.reservation_id : "";
    expect((await a.settle(id, { kind: "spent", spent_micros: 120_000, usage: { input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0 } as any })).ok).toBe(true);
    expect(readRows(path).filter((x) => x.kind === "settle").map((x) => x.usd_micros)).toEqual([120_000]);
  });
  test("an unknown outcome settles at the reserved maximum marked unknown, and a spent one at its metered cost (D1); nothing stays open", async () => {
    const path = join(temp(), "ledger.jsonl"), l = new Ledger(path, "stage1-opus");
    l.approve(1, { by: "test" });
    const a = new LaneBReservations(l, "picker-t1");
    const lost = await a.reserve({ idempotency_key: "k1", lease_id: "lease", cell, max_micros: 400_000 });
    const spent = await a.reserve({ idempotency_key: "k2", lease_id: "lease", cell, max_micros: 300_000 });
    const lid = lost.ok ? lost.reservation.reservation_id : "", sid = spent.ok ? spent.reservation.reservation_id : "";
    const u = await a.settle(lid, { kind: "unknown" });
    expect(u.ok && u.reservation.state).toBe("unknown");
    expect((await a.settle(sid, { kind: "spent", spent_micros: 90_000, usage: { input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0 } as any })).ok).toBe(true);
    const settles = readRows(path).filter((x) => x.kind === "settle");
    expect(settles.map((x) => [x.id, x.usd_micros, x.unknown ?? false, x.usage === undefined])).toEqual([["picker-t1:k1", 400_000, true, true], ["picker-t1:k2", 90_000, false, false]]);
    expect(l.status().openIds).toEqual([]);
  });
  test("a reserve past the cap is refused CAP_STOP", async () => {
    const path = join(temp(), "ledger.jsonl"), l = new Ledger(path, "stage1-opus");
    l.approve(0.1, { by: "test" });
    const r = await new LaneBReservations(l, "picker-t1").reserve({ idempotency_key: "k1", lease_id: "lease", cell, max_micros: 400_000 });
    expect(r).toMatchObject({ ok: false, code: "CAP_STOP" });
  });
});

describe("pickerColumns", () => {
  test("fills bo2_pass, picker_parsed and picker_cost_usd on the matching none row only", () => {
    const base = { schema: "hm-session/1", model: "claude-opus-5-5", task: "t1", trial: "1", part: null, outcome: "graded", pass: true } as any;
    const pick: Pick = { task: "t1", model: "claude-opus-5-5", trial: "1", order: ["A", "B"], called: true, cuts: 0, parsed: false, ships: "A", bo2_pass: true, pass2: true, cost_usd: 0.2, picker: "openai:gpt-6.1-sol" } as any;
    const [none, plain2, other] = pickerColumns([{ ...base, arm: "none" }, { ...base, arm: "plain-2" }, { ...base, arm: "none", task: "t2" }], [pick]);
    expect(none).toMatchObject({ bo2_pass: true, picker_parsed: false, picker_cost_usd: 0.2 });
    expect(plain2!.bo2_pass).toBeUndefined();
    expect(other!.bo2_pass).toBeUndefined();
  });
});
