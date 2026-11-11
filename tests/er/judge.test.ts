// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { panelLabel, parseLabels, readEntry } from "../../lanes/eng-review/judge.ts";
import type { PacketFile, PacketMeta } from "../../lanes/eng-review/packets.ts";

const packet: PacketFile = { id: "p", prompt: "brief", items: [{ id: "i1", statement: "x" }, { id: "i2", statement: "y" }], lists: [{ id: "l1", checks: ["a", "b"] }] };
const e = (o: object) => ({ list: "l1", item: "i1", anticipated: false, checks: [], path_hit: false, path_checks: [], credit: null, ...o });

describe("reading a judge's answer (section 7)", () => {
  test("an anticipated cell needs check indices in range and a credit; anticipated implies path hit", () => {
    expect(readEntry(e({ anticipated: true, checks: [2], credit: "code" }), 2)).toEqual({ anticipated: true, checks: [2], path_hit: true, path_checks: [2], credit: "code" });
    expect(readEntry(e({ anticipated: true, checks: [3], credit: "check" }), 2)).toBeNull();
    expect(readEntry(e({ anticipated: true, checks: [1] }), 2)).toBeNull();
    expect(readEntry(e({ path_hit: true, path_checks: [] }), 2)).toBeNull();
    expect(readEntry(e({}), 2)).toEqual({ anticipated: false, checks: [], path_hit: false, path_checks: [], credit: null });
  });
  test("a missing or contradictory cell is missing; a repeated identical one is kept", () => {
    const one = JSON.stringify({ labels: [e({}), e({})] });
    expect(parseLabels(one, packet, false).missing).toEqual(["l1|i2"]);
    const clash = JSON.stringify({ labels: [e({}), e({ anticipated: true, checks: [1], credit: "check" }), e({ item: "i2" })] });
    expect(parseLabels(clash, packet, false).missing).toEqual(["l1|i1"]);
    expect(parseLabels("not json", packet, false).missing.length).toBe(2);
  });
  test("the panel takes the majority on each label, the union of yes indices and the majority credit, a tie taking check", () => {
    const y = (checks: number[], credit: "check" | "code") => ({ anticipated: true, checks, path_hit: true, path_checks: checks, credit });
    const n = { anticipated: false, checks: [], path_hit: false, path_checks: [], credit: null };
    expect(panelLabel([y([1], "code"), y([2], "check"), n])).toEqual({ anticipated: true, checks: [1, 2], path_hit: true, path_checks: [1, 2], credit: "check" });
    expect(panelLabel([y([1], "code"), y([1], "code"), y([2], "check")]).credit).toBe("code");
    expect(panelLabel([y([1], "code"), n, n]).anticipated).toBe(false);
  });
});

describe("Gemini's effort", () => {
  test("the judge check's maximum reaches Gemini as high, and every other judge and effort passes through", async () => {
    const { effortFor } = await import("../../lanes/eng-review/judge.ts");
    expect(effortFor("gemini", "max")).toBe("high");
    expect(effortFor("gemini", "medium")).toBe("medium");
    expect(effortFor("astra", "max")).toBe("max");
    expect(effortFor("opus", "max")).toBe("max");
  });
});

describe("the judge check's output room (GSTA-2 deviation, 2026-11-11)", () => {
  test("Opus's audit call asks for 64,000 output tokens; Astra's, Gemini's and every other prompt keep their frozen caps", async () => {
    const { maxTokensFor } = await import("../../lanes/eng-review/judge.ts");
    expect(maxTokensFor("opus", "audit")).toBe(64_000);
    expect(maxTokensFor("astra", "audit")).toBe(32_000);
    expect(maxTokensFor("gemini", "audit")).toBe(32_000);
    expect(maxTokensFor("opus", "brief")).toBe(16_000);
    expect(maxTokensFor("astra", "brief")).toBe(16_000);
  });
  test("a judge-check packet sends Opus 64,000 and Astra 32,000 output tokens", async () => {
    const { labelPacket } = await import("../../lanes/eng-review/judge.ts");
    const asked = new Set<string>();
    const p: PacketFile = { id: "c", prompt: "audit", items: [{ id: "i1", statement: "The importer failed on tag-z." }], lists: [{ id: "l1", checks: ["Unit test for tag-z"] }] };
    const meta = { id: "c", role: "check", stage: 1, unit: "u", model: "opus", pass: 1, judges: ["astra", "opus"], lists: { l1: { kind: "arm", unit: "u", model: "opus", pass: 1, words: 4 } }, items: { i1: { unit: "u", item: "z", kind: "B" } } } as unknown as PacketMeta;
    await labelPacket(p, meta, "max", async (c) => {
      asked.add(c.judge + " " + c.maxTokens);
      return { text: null, model_id: c.judge, version: "v", problem: null };
    }, []);
    expect([...asked].sort()).toEqual(["astra 32000", "opus 64000"]);
  });
  test("the er judge client's meter admits a 64,000-token call that the product-value client's 32,000 cap refuses", async () => {
    const { openErJudge } = await import("../../lanes/eng-review/judge.ts");
    const { openJudge } = await import("../../lanes/product-value/judge.ts");
    const { fakeUpstream } = await import("../../lanes/product-value/dryrun.ts");
    const { recordApproval } = await import("../../src/runner/ledger/ledger.ts");
    const dir = mkdtempSync(join(tmpdir(), "er-judge-room-"));
    try {
      const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
      for (const item of ["er-room-er", "er-room-pv"]) recordApproval(record, { action: "init", item, cap_micros: 5_000_000, quotes: [{ words: "test", by: "test", source: "test" }], admission: "warn" });
      const env = { ANTHROPIC_API_KEY: "test", OPENAI_API_KEY: "test", OPENROUTER_API_KEY: "test" };
      const io = { out: () => {}, err: () => {} };
      const ask = { judge: "opus" as const, prompt: "Label tag-z.", effort: "max", maxTokens: 64_000, label: "room" };
      const er = await openErJudge({ item: "er-room-er", runId: "er", out: join(dir, "er"), cacheDir: join(dir, "cache-er"), record, ledger, env, fetch: fakeUpstream(() => "ok"), io });
      try {
        expect((await er.call(ask)).text).toBe("ok");
      } finally {
        await er.close();
      }
      const pv = await openJudge({ item: "er-room-pv", runId: "pv", out: join(dir, "pv"), cacheDir: join(dir, "cache-pv"), record, ledger, env, fetch: fakeUpstream(() => "ok"), io });
      try {
        await expect(pv.call(ask)).rejects.toThrow(/output cap of 32000/);
      } finally {
        await pv.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
