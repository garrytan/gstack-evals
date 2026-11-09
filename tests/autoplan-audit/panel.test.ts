// Copyright (c) 2026 Garry Tan. MIT License.
// The paid panel's guards on a temporary ledger with stubbed providers: a send with an unknown outcome is never sent
// again, each paid phase needs the saved gates before it, the re-projection reads the same approval record as the meter
// and counts earlier leases, and the gold items, top-ups included, survive a phase boundary.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { DRY_ENV, reply, stubUpstream, tmp } from "../../lanes/autoplan-audit/fixtures.ts";
import { Journal, ask } from "../../lanes/autoplan-audit/journal.ts";
import { openMeter, type CallRequest } from "../../lanes/autoplan-audit/meter.ts";
import type { Packet } from "../../lanes/autoplan-audit/packet.ts";
import { admitPhase, budgetFor, savedGold, writeGold } from "../../lanes/autoplan-audit/stage2.ts";

const dir = tmp("panel");
const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
const quote = { words: "panel guard tests on a temporary ledger", by: "ar tests", source: "tests/autoplan-audit/panel.test.ts" };
const item = (name: string) => (recordApproval(record, { action: "init", item: name, cap_micros: 5_000_000, quotes: [quote], admission: "warn" }), name);
const req: CallRequest = { model: "opus", prompt: "p", maxTokens: 8000, effort: "medium", label: "t1" };
const parse = () => ({ label: "LANDED", missing: null });

describe("the request journal and the meter", () => {
  test("a send whose outcome the proxy could not settle is recorded unknown and never sent again", async () => {
    const name = item("ar-test-unknown");
    let sends = 0;
    const lost = (async () => {
      sends++;
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const m = await openMeter({ item: name, runId: name, out: join(dir, "unknown"), maxOutputTokens: 16_000, record, ledger, env: DRY_ENV, fetch: lost });
    try {
      const a = await ask(new Journal(join(dir, "unknown", "journal")), m.call, req, parse);
      const b = await ask(new Journal(join(dir, "unknown", "journal")), m.call, req, parse);
      expect({ missing: a.missing, unknown: a.result?.unknown, again: b.missing, sends }).toEqual({ missing: "unknown", unknown: true, again: "unknown", sends: 1 });
    } finally {
      await m.close();
    }
  });
  test("a known failure is still retried once", async () => {
    const name = item("ar-test-known");
    let sends = 0;
    const m = await openMeter({ item: name, runId: name, out: join(dir, "known"), maxOutputTokens: 16_000, record, ledger, env: DRY_ENV, fetch: stubUpstream(() => (sends++, { status: 400 })) });
    try {
      const a = await ask(new Journal(join(dir, "known", "journal")), m.call, req, parse);
      expect({ missing: a.missing, sends }).toEqual({ missing: "retried", sends: 2 });
    } finally {
      await m.close();
    }
  });
});

describe("stage 2 admission", () => {
  const sink = tmp("sink");
  const save = (name: string, v: unknown) => writeFileSync(join(sink, name), JSON.stringify(v));
  const code = (f: () => void) => {
    try {
      f();
      return "admitted";
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };
  test("each paid phase refuses until every earlier saved gate passed", () => {
    expect(code(() => admitPhase(sink, "smoke"))).toBe("admitted");
    expect(code(() => admitPhase(sink, "project"))).toBe("E_AR_SMOKE_FAIL");
    save("smoke.json", { pass: false, rows: [] });
    expect(code(() => admitPhase(sink, "gold"))).toBe("E_AR_SMOKE_FAIL");
    save("smoke.json", { pass: true, rows: [] });
    expect(code(() => admitPhase(sink, "project"))).toBe("admitted");
    expect(code(() => admitPhase(sink, "gold"))).toBe("E_CAP_TOO_LOW");
    save("projection.json", { stop: true });
    expect(code(() => admitPhase(sink, "gold"))).toBe("E_CAP_TOO_LOW");
    save("projection.json", { stop: false });
    expect(code(() => admitPhase(sink, "gold"))).toBe("admitted");
    expect(code(() => admitPhase(sink, "check"))).toBe("E_AR_SUPPLY_SHORT");
    save("gold.json", { counts: { landed: 39, not: 40 }, gold: [], items: [] });
    expect(code(() => admitPhase(sink, "check"))).toBe("E_AR_SUPPLY_SHORT");
    save("gold.json", { counts: { landed: 40, not: 40 }, gold: [], items: [] });
    expect(code(() => admitPhase(sink, "check"))).toBe("admitted");
    expect(code(() => admitPhase(sink, "production"))).toBe("E_AR_JUDGE_KAPPA");
    save("check.json", { pass: { astra: true, opus: true, argon: false } });
    expect(code(() => admitPhase(sink, "production"))).toBe("E_AR_JUDGE_KAPPA");
    save("check.json", { pass: { astra: true, opus: true, argon: true } });
    expect(code(() => admitPhase(sink, "production"))).toBe("admitted");
  });
});

describe("the re-projection's budget", () => {
  test("reads the approval record the meter resolves and counts the item's earlier leases", async () => {
    const name = item("ar-test-budget");
    const env = { ...DRY_ENV, GSTACK_EVALS_LEDGER_RECORD: record };
    const first = await openMeter({ item: name, runId: name, out: join(dir, "budget1"), maxOutputTokens: 16_000, ledger, env, fetch: stubUpstream(() => reply("LANDED", "x")) });
    await first.call({ ...req, label: "b1" });
    await first.close();
    const earlier = readItem(record, name).leases[0]!.close!;
    const second = await openMeter({ item: name, runId: name, out: join(dir, "budget2"), maxOutputTokens: 16_000, ledger, env, fetch: stubUpstream(() => reply("LANDED", "x")) });
    try {
      const b = budgetFor({ item: name, env }, second.leaseId);
      expect(earlier.spent_micros).toBeGreaterThan(0);
      expect(b).toEqual({ cap_micros: 5_000_000, prior_micros: earlier.spent_micros + earlier.unknown_micros });
    } finally {
      await second.close();
    }
  });
});

describe("the gold items across a phase boundary", () => {
  const pk = (body: string) => ({ body }) as unknown as Packet;
  const pp = { packets: new Map([["r|u1", pk("one")], ["r|u3", pk("three")]]), ablated: new Map([["r|u2", pk("two")]]) };
  test("a later phase restores every gold item the gold phase sent, top-ups included", () => {
    const sink = tmp("gold");
    const items = [{ id: "hit:r|u1", kind: "hit" as const, packet: pp.packets.get("r|u1")! }, { id: "abl:r|u2", kind: "ablated" as const, packet: pp.ablated.get("r|u2")! }, { id: "miss:r|u3", kind: "miss" as const, packet: pp.packets.get("r|u3")! }];
    writeGold(sink, { landed: 40, not: 40 }, new Map([["hit:r|u1", true], ["abl:r|u2", false]]), items);
    const back = savedGold(pp, sink);
    expect(back.items.map((i) => [i.id, i.kind, (i.packet as any).body])).toEqual([["hit:r|u1", "hit", "one"], ["abl:r|u2", "ablated", "two"], ["miss:r|u3", "miss", "three"]]);
    expect([...back.gold]).toEqual([["hit:r|u1", true], ["abl:r|u2", false]]);
  });
  test("a saved list with no items, or an item that no longer rebuilds, refuses", () => {
    const sink = tmp("gold-bad");
    mkdirSync(sink, { recursive: true });
    writeFileSync(join(sink, "gold.json"), JSON.stringify({ counts: { landed: 40, not: 40 }, gold: [] }));
    expect(() => savedGold(pp, sink)).toThrow();
    writeFileSync(join(sink, "gold.json"), JSON.stringify({ counts: { landed: 40, not: 40 }, gold: [], items: ["hit:r|gone"] }));
    expect(() => savedGold(pp, sink)).toThrow();
  });
});
