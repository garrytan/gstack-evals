import { describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { CapStop, Ledger, lockLedger, Reserver } from "../src/ledger.ts";
import { costUsd, fromApiUsage, mergeStreamUsage } from "../src/usage.ts";
import { bootstrapMeanCI, signFlipP, wilson } from "../src/analyze.ts";

describe("ledger", () => {
  test("approval first, reserve before spend, cap stop never overspends", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    const l = new Ledger(p, 10, "t");
    expect(() => l.reserve("a", 1, {})).toThrow("E_LEDGER_MISSING");
    l.approve({ words: ["Rec"], by: "x", source: "y" });
    l.reserve("a", 4, {});
    l.reserve("b", 4, {});
    expect(() => l.reserve("c", 4, {})).toThrow(CapStop);
    l.settle("a", 1.5, {});
    l.settle("a", 1.5, {});
    l.reserve("c", 4, {});
    expect(l.totals()).toMatchObject({ settled: 1.5, open: 8 });
    const again = new Ledger(p, 10, "t");
    expect(again.totals()).toMatchObject({ settled: 1.5, open: 8 });
    expect(readFileSync(p, "utf8").split("\n")[0]).toContain('"type":"approval"');
  });
  const approved = (cap = 10) => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    new Ledger(p, cap, "t").approve({ words: ["Rec"], by: "x", source: "y" });
    return p;
  };
  test("settleStale charges a stopped runner's open reserve in full, once", () => {
    const p = approved();
    const stopped = new Ledger(p, 10, "t");
    stopped.reserve("a", 4, {});
    const next = new Ledger(p, 10, "t");
    next.settleStale("stale");
    expect(next.totals()).toMatchObject({ settled: 4, open: 0 });
    stopped.settle("a", 1, {});
    expect(new Ledger(p, 10, "t").totals()).toMatchObject({ settled: 4, open: 0 });
  });
  test("a second runner on the same ledger sees the first one's reserves", () => {
    const p = approved();
    const a = new Ledger(p, 10, "t");
    const b = new Ledger(p, 10, "t");
    a.reserve("a1", 4, {});
    b.reserve("b1", 4, {});
    expect(() => a.reserve("a2", 4, {})).toThrow(CapStop);
    expect(new Ledger(p, 10, "t").totals().open).toBe(8);
  });
  test("replay counts one settle row per reservation", () => {
    const p = approved();
    new Ledger(p, 10, "t").reserve("a", 4, {});
    appendFileSync(p, JSON.stringify({ type: "settle", reservation_id: "a", usd: 4 }) + "\n" + JSON.stringify({ type: "settle", reservation_id: "a", usd: 1 }) + "\n");
    expect(new Ledger(p, 10, "t").totals()).toMatchObject({ settled: 4, open: 0 });
  });
  test("refuses amounts that are not finite and non-negative", () => {
    const l = new Ledger(approved(), 10, "t");
    expect(() => l.reserve("a", NaN, {})).toThrow("E_LEDGER_AMOUNT");
    expect(() => l.reserve("a", -1, {})).toThrow("E_LEDGER_AMOUNT");
    l.reserve("a", 1, {});
    expect(() => l.settle("a", NaN, {})).toThrow("E_LEDGER_AMOUNT");
    expect(l.totals()).toMatchObject({ settled: 0, open: 1 });
  });
  test("only a complete approval for this cap, not a fake one, authorizes a paid ledger", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    expect(() => new Ledger(p, 10, "t").approve({ words: [], by: "x", source: "y" })).toThrow("E_APPROVAL");
    expect(() => new Ledger(p, 10, "t").approve({ words: ["Rec"], by: "", source: "y" })).toThrow("E_APPROVAL");
    new Ledger(p, 10, "t", undefined, true).approve({ words: ["fake"], by: "test", source: "none" });
    expect(new Ledger(p, 10, "t", undefined, true).hasApproval()).toBe(true);
    expect(new Ledger(p, 10, "t").hasApproval()).toBe(false);
    const q = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    new Ledger(q, 20, "t").approve({ words: ["Rec"], by: "x", source: "y" });
    expect(new Ledger(q, 10, "t").hasApproval()).toBe(false);
    expect(new Ledger(q, 20, "t").hasApproval()).toBe(true);
  });
  test("approve on an approved ledger with rows adds nothing and keeps it authorized", () => {
    for (const fake of [false, true]) {
      const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
      const a = fake ? { words: ["keyless fake run, no spend"], by: "lanea-quick test", source: "none" } : { words: ["Rec"], by: "x", source: "y" };
      const l = new Ledger(p, 10, "t", undefined, fake);
      l.approve(a);
      l.reserve("a", 1, {});
      l.settle("a", 1, {});
      const before = readFileSync(p, "utf8");
      new Ledger(p, 10, "t", undefined, fake).approve(a);
      expect(readFileSync(p, "utf8")).toBe(before);
      expect(new Ledger(p, 10, "t", undefined, fake).hasApproval()).toBe(true);
    }
  });
  test("only the first row can approve, and the old fake runner's approval never authorizes a paid ledger", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    writeFileSync(p, JSON.stringify({ type: "approval", cap_usd: 10, words: ["keyless fake run, no spend"], by: "lanea-quick test", source: "none" }) + "\n");
    expect(new Ledger(p, 10, "t").hasApproval()).toBe(false);
    expect(() => new Ledger(p, 10, "t").approve({ words: ["Rec"], by: "x", source: "y" })).toThrow("E_APPROVAL");
    const q = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    writeFileSync(q, JSON.stringify({ type: "reserve", reservation_id: "a", usd: 1 }) + "\n" + JSON.stringify({ type: "approval", cap_usd: 10, words: ["Rec"], by: "x", source: "y" }) + "\n");
    expect(new Ledger(q, 10, "t").hasApproval()).toBe(false);
  });
  test("a resume fails closed on a ledger approved for another item or another cap, and writes nothing", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    new Ledger(p, 35, "lanea-quick-rerun").approve({ words: ["Rec"], by: "x", source: "y" });
    expect(JSON.parse(readFileSync(p, "utf8"))).toMatchObject({ type: "approval", item: "lanea-quick-rerun", cap_usd: 35 });
    const before = readFileSync(p, "utf8");
    for (const [cap, item] of [[35, "lanea-quick"], [130, "lanea-quick-rerun"]] as const) {
      const l = new Ledger(p, cap, item);
      expect(l.hasApproval()).toBe(false);
      expect(() => l.reserve("a", 1, {})).toThrow("E_LEDGER_MISSING");
      expect(() => l.approve({ words: ["Rec"], by: "x", source: "y" })).toThrow("E_APPROVAL");
    }
    expect(readFileSync(p, "utf8")).toBe(before);
    new Ledger(p, 35, "lanea-quick-rerun").reserve("a", 1, {});
  });
  test("a close row ends the line item: money it moved away can't be reserved again, and open reserves still settle", () => {
    const p = approved(130);
    const l = new Ledger(p, 130, "t");
    l.reserve("spent", 109.56, {});
    l.settle("spent", 109.56, {});
    l.reserve("open", 1, {});
    appendFileSync(p, JSON.stringify({ type: "note", note: "moved the unspent $20.44 to t-rerun" }) + "\n");
    expect(new Ledger(p, 130, "t").totals().remaining).toBeCloseTo(19.44, 9);
    appendFileSync(p, JSON.stringify({ type: "close", reason: "unspent money moved", moved_usd: 20.44, to_item: "t-rerun", by: "x", source: "y" }) + "\n");
    expect(() => l.reserve("again", 7.25, {})).toThrow("E_LEDGER_CLOSED");
    expect(() => new Ledger(p, 130, "t").reserve("again", 7.25, {})).toThrow("E_LEDGER_CLOSED");
    l.settle("open", 1, {});
    const t = new Ledger(p, 130, "t").totals();
    expect(t).toMatchObject({ open: 0, remaining: 0 });
    expect(t.settled).toBeCloseTo(110.56, 9);
  });
  test("the lock sits beside the ledger and admits one runner", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    const release = lockLedger(p);
    expect(() => lockLedger(p)).toThrow("E_LOCK");
    release();
    lockLedger(p)();
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: 1, host: "other-machine" }));
    expect(() => lockLedger(p)).toThrow("other-machine");
  });
  test("a lock is never replaced, even one whose pid is dead on this machine, and a release keeps a lock it no longer owns", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: 2 ** 22 + 1, host: hostname(), token: "dead" }));
    expect(() => lockLedger(p)).toThrow("remove it by hand");
    expect(JSON.parse(readFileSync(`${p}.lock`, "utf8")).token).toBe("dead");
    rmSync(`${p}.lock`);
    const release = lockLedger(p);
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: 1, host: hostname(), token: "someone-else" }));
    release();
    expect(existsSync(`${p}.lock`)).toBe(true);
  });
  test("settleStale leaves a settled reserve alone", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    const l = new Ledger(p, 10, "t");
    l.approve({ words: ["Rec"], by: "x", source: "y" });
    l.reserve("done", 3, {});
    l.settle("done", 1, {});
    l.reserve("orphan", 4, {});
    new Ledger(p, 10, "t").settleStale("stale");
    expect(readFileSync(p, "utf8").trim().split("\n").map((x) => JSON.parse(x)).filter((x) => x.type === "settle" && x.reservation_id === "done")).toHaveLength(1);
    expect(new Ledger(p, 10, "t").totals()).toMatchObject({ settled: 5, open: 0 });
  });
});

describe("reserver", () => {
  test("waits for its own open reserves to settle instead of stopping, and stops only on settled spend", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    const l = new Ledger(p, 130, "t");
    l.approve({ words: ["Rec"], by: "x", source: "y" });
    for (let i = 0; i < 90; i++) {
      l.reserve(`s${i}`, 1, {});
      l.settle(`s${i}`, 1, {});
    }
    const r = new Reserver(l);
    for (let i = 0; i < 5; i++) expect(await r.reserve(`o${i}`, 7.25, {})).toBe(true);
    const sixth = r.reserve("o5", 7.25, {});
    const seventh = r.reserve("o6", 7.25, {});
    await Bun.sleep(10);
    expect(r.open.size).toBe(5);
    r.settle("o0", 3, {});
    expect(await sixth).toBe(true);
    expect(r.stopped).toBeNull();
    for (const id of ["o1", "o2", "o3", "o4", "o5"]) r.settle(id, 3, {});
    expect(await seventh).toBe(true);
    r.settle("o6", 3, {});
    expect(l.totals().settled).toBeCloseTo(111, 9);
    expect(await r.reserve("o7", 7.25, {})).toBe(true);
    expect(await r.reserve("o8", 7.25, {})).toBe(true);
    r.settle("o7", 7.25, {});
    r.settle("o8", 7.25, {});
    expect(await r.reserve("o9", 7.25, {})).toBe(false);
    expect(r.stopped).toContain("budget_exhausted");
  });
  test("halt frees a waiting reserve", async () => {
    const l = new Ledger(join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl"), 10, "t");
    l.approve({ words: ["Rec"], by: "x", source: "y" });
    const r = new Reserver(l);
    await r.reserve("a", 6, {});
    const waiting = r.reserve("b", 6, {});
    await Bun.sleep(10);
    r.halt();
    expect(await Promise.race([waiting, Bun.sleep(1000).then(() => "stuck")])).toBe(false);
  });
  test("a runner error settles each reserve still open once in full and leaves settled ones alone", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    const l = new Ledger(p, 10, "t");
    l.approve({ words: ["Rec"], by: "x", source: "y" });
    const r = new Reserver(l);
    await r.reserve("a", 4, {});
    await r.reserve("b", 3, {});
    await r.reserve("c", 2, {});
    r.settle("b", 1, {});
    l.settle("c", 1, {});
    r.halt();
    l.settleStale("error");
    const settles = readFileSync(p, "utf8").trim().split("\n").map((x) => JSON.parse(x)).filter((x) => x.type === "settle");
    expect(settles.filter((x) => x.reservation_id === "a")).toEqual([expect.objectContaining({ usd: 4, stale: true })]);
    expect(settles.filter((x) => x.reservation_id === "c")).toHaveLength(1);
    expect(new Ledger(p, 10, "t").totals()).toMatchObject({ settled: 6, open: 0 });
  });
});

describe("usage and price", () => {
  test("splits cache writes and prices Opus 5.5", () => {
    const u = fromApiUsage({ input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 } });
    expect(u).toEqual({ input: 1000, output: 1000, cacheRead: 1_000_000, cacheWrite5m: 1000, cacheWrite1h: 1000, webSearches: 0 });
    expect(costUsd("claude-opus-5-5", u)).toBeCloseTo((4000 + 20000 + 200000 + 5000 + 8000) / 1e6, 9);
  });
  test("Haiku 5.5 uses the long-context price above 100k prompt tokens", () => {
    const short = fromApiUsage({ input_tokens: 50_000, output_tokens: 1000 });
    const long = fromApiUsage({ input_tokens: 150_000, output_tokens: 1000 });
    expect(costUsd("claude-haiku-5-5", short)).toBeCloseTo((50_000 * 0.1 + 1000 * 0.5) / 1e6, 9);
    expect(costUsd("claude-haiku-5-5", long)).toBeCloseTo((150_000 * 0.5 + 1000 * 2.5) / 1e6, 9);
  });
  test("a stream delta without the cache split does not count the 1h writes twice", () => {
    const start = fromApiUsage({ input_tokens: 10, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 } });
    const delta = fromApiUsage({ output_tokens: 50, cache_creation_input_tokens: 2000 });
    expect(mergeStreamUsage(start, delta)).toEqual({ input: 10, output: 50, cacheRead: 0, cacheWrite5m: 1000, cacheWrite1h: 1000, webSearches: 0 });
  });
});

describe("stats", () => {
  test("wilson, bootstrap and sign-flip behave", () => {
    const [lo, hi] = wilson(9, 10);
    expect(lo).toBeLessThan(0.9);
    expect(hi).toBeGreaterThan(0.9);
    expect(bootstrapMeanCI([0, 0, 0])).toEqual([0, 0]);
    expect(signFlipP([-1, -1, -1, -1, -1])).toBeCloseTo(1 / 32, 9);
    expect(signFlipP([1, 1, -1])).toBeGreaterThan(0.5);
  });
});
