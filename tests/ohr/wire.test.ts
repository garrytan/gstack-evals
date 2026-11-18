// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=pre-run change 4's wire rules on the real meter and metering proxy with a stub upstream: a judge, auditor or simulator reply counts only when it names its pinned model (or that model's dated snapshot), and a ledger refusal on a judge or auditor call stops the command as a cap stop; fails_when=a reply from another model is labelled or audited, or a cap stop turns into a missing label or an empty auditor answer.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { openWire, type Wire } from "../../lanes/office-hours-rewrite/wire.ts";

const D = 1_000_000;
const KEYS = { OPENAI_API_KEY: "stub-not-a-key", ANTHROPIC_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" };
const SIM_TEXT = JSON.stringify({ reply: "Two services pay me.", revealed: ["f1"], rules: [3], done: false });

/** A stub upstream in each provider's shape that names the model rename(asked) returns. */
function upstream(rename: (asked: string) => string | null, outputTokens = 20): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const model = rename(String(body.model));
    const named = model === null ? {} : { model };
    if (u.includes("anthropic")) return Response.json({ id: "msg_1", type: "message", role: "assistant", ...named, content: [{ type: "text", text: '{"marked": []}' }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    if (u.includes("openrouter")) return Response.json({ id: "gen-1", provider: "Google", ...named, choices: [{ index: 0, message: { role: "assistant", content: SIM_TEXT }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 } });
    return Response.json({ id: "resp_1", object: "response", ...named, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"marked": []}' }] }], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: outputTokens, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 120 } });
  }) as typeof fetch;
}

async function withWire<T>(o: { rename?: (asked: string) => string | null; capMicros?: number; outputTokens?: number }, body: (w: Wire) => Promise<T>): Promise<T> {
  const W = mkdtempSync(join(tmpdir(), "ohr-wire-"));
  const record = join(W, "record");
  const item = "ohr-wire-test";
  recordApproval(record, { action: "init", item, cap_micros: 20 * D, quotes: [{ words: "wire test on a temporary ledger, not an approval", by: "tests/ohr/wire.test.ts", source: "pre-run change 4" }], admission: "warn" });
  const w = await openWire({ dir: join(W, "wire"), item, capMicros: o.capMicros ?? 20 * D, label: "ohr-wire-test", record, ledger: join(W, "ledger.sqlite"), env: KEYS, io: { out: () => {}, err: () => {} }, upstream: upstream(o.rename ?? ((m) => m), o.outputTokens) });
  try {
    return await body(w);
  } finally {
    await w.close("wire test");
  }
}

const judgeReq = (judge: "astra" | "opus") => ({ judge, prompt: "Reply with the one word ok.", effort: "medium", maxTokens: 2000, label: "probe:" + judge });
const simReq = { system: "s", messages: [{ role: "user" as const, content: "Does anyone pay you?" }] };
const thrown = async (f: () => Promise<unknown>): Promise<{ code?: string; message: string } | null> => {
  try {
    await f();
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
};

describe("the wire's build commit (pre-run change 4's build rule)", () => {
  test("run.json records the build commit, and a resume on another commit is refused", async () => {
    const W = mkdtempSync(join(tmpdir(), "ohr-wire-commit-"));
    const record = join(W, "record");
    recordApproval(record, { action: "init", item: "ohr-wire-commit", cap_micros: 20 * D, quotes: [{ words: "wire test on a temporary ledger, not an approval", by: "tests/ohr/wire.test.ts", source: "pre-run change 4" }], admission: "warn" });
    const open = (commit: string) => openWire({ dir: join(W, "wire"), item: "ohr-wire-commit", capMicros: 20 * D, label: "ohr-wire-commit", record, ledger: join(W, "ledger.sqlite"), env: KEYS, io: { out: () => {}, err: () => {} }, upstream: upstream((m) => m), buildCommit: commit });
    await (await open("a".repeat(40))).close("wire test");
    expect(JSON.parse(readFileSync(join(W, "wire", "run.json"), "utf8")).build_commit).toBe("a".repeat(40));
    expect((await thrown(() => open("b".repeat(40))))?.code).toBe("E_OHR_BUILD_COMMIT");
    await (await open("a".repeat(40))).close("wire test");
  });
});

describe("the wire's relaunches on one ledger item (the second attempt's section 5.2)", () => {
  const item = "ohr-wire-relaunch";
  const setup = () => {
    const W = mkdtempSync(join(tmpdir(), "ohr-wire-relaunch-"));
    const record = join(W, "record");
    recordApproval(record, { action: "init", item, cap_micros: 20 * D, quotes: [{ words: "wire test on a temporary ledger, not an approval", by: "tests/ohr/wire.test.ts", source: "section 5.2" }], admission: "warn" });
    const open = (dir: string, runId?: string) => openWire({ dir: join(W, dir), item, capMicros: 20 * D, label: item, runId, record, ledger: join(W, "ledger.sqlite"), env: KEYS, io: { out: () => {}, err: () => {} }, upstream: upstream((m) => m) });
    return { W, record, open };
  };
  const ask = (w: Wire) => w.call({ model: "opus", prompt: "Reply with the one word ok.", maxTokens: 2000, effort: "medium", label: "d1001a:author:1" });
  test("a relaunch reserves the spend cap less what the item has committed, and spent() starts from the ledger", async () => {
    const { record, open } = setup();
    const a = await open("wire");
    await ask(a);
    await a.close("wire test");
    const committed = readItem(record, item).committed_micros;
    expect(committed).toBeGreaterThan(0);
    const b = await open("wire");
    expect(readItem(record, item).open!.reserved_micros).toBe(20 * D - committed);
    expect(Math.round(b.spent() * D)).toBe(committed);
    await b.close("wire test");
  });
  test("runId continues a run whose dir was lost, and a dir whose run.json names another run is refused", async () => {
    const { W, record, open } = setup();
    const a = await open("wire");
    await ask(a);
    await a.close("wire test");
    expect((await thrown(() => open("other")))?.code).toBe("E_ITEM_BOUND");
    expect((await thrown(() => open("wire", item + "-elsewhere")))?.code).toBe("E_OHR_RESUME");
    const b = await open("lost", a.runId);
    expect(b.runId).toBe(a.runId);
    expect(Math.round(b.spent() * D)).toBe(readItem(record, item).leases[0]!.close!.spent_micros);
    await ask(b);
    const spent = b.spent();
    await b.close("wire test");
    const end = readItem(record, item).committed_micros;
    expect(Math.round(spent * D)).toBe(end);
    expect(JSON.parse(readFileSync(join(W, "lost", "run.json"), "utf8")).spent_micros).toBe(end);
  });
});

describe("the wire's spend by brief (the second attempt's section 5.2)", () => {
  test("spentOn sums the calls labelled for one brief, every attempt of it included, and the brief's calls add up to the settled spend", async () => {
    await withWire({}, async (w) => {
      const ask = (label: string) => w.call({ model: "opus", prompt: "Reply with the one word ok, for " + label + ".", maxTokens: 2000, effort: "medium", label });
      for (const label of ["d1001b.2:author:1", "d1001b:generic:opus", "d2001a:author:1"]) await ask(label);
      const one = w.spentOn("d1001b"), two = w.spentOn("d2001a");
      expect(one).toBeGreaterThan(two);
      expect(two).toBeGreaterThan(0);
      expect(w.spentOn("d1001b.2")).toBe(0);
      expect(one + two).toBeCloseTo(w.spent(), 9);
    });
  });
});

describe("the wire's counted replies (pre-run change 4)", () => {
  test("judge, auditor and simulator replies that name their pin, or a dated snapshot of it, count", async () => {
    await withWire({}, async (w) => {
      expect((await w.judge(judgeReq("astra"))).text).not.toBeNull();
      expect((await w.judge(judgeReq("opus"))).text).not.toBeNull();
      expect(await w.auditor("opus")("audit prompt")).toBe('{"marked": []}');
      expect((await w.sim("audit:b1")(simReq)).kind).toBe("text");
    });
    await withWire({ rename: (m) => m + (m.startsWith("claude") ? "-20261101" : "-2026-11-01") }, async (w) => {
      expect((await w.judge(judgeReq("astra"))).text).not.toBeNull();
      expect((await w.auditor("opus")("audit prompt"))).toBe('{"marked": []}');
      expect((await w.sim("audit:b1")(simReq)).kind).toBe("text");
    });
  });

  test("a judge or auditor reply that names another model stops the command (E_OHR_MODEL_DRIFT)", async () => {
    await withWire({ rename: (m) => (m === "gpt-6.2-astra" ? "gpt-6-astra" : m === "claude-opus-5-5" ? "claude-sonnet-5-5" : m) }, async (w) => {
      const j = await thrown(() => w.judge(judgeReq("astra")));
      expect(j?.code).toBe("E_OHR_MODEL_DRIFT");
      expect(j?.message).toContain("gpt-6-astra");
      expect((await thrown(() => w.auditor("opus")("audit prompt")))?.code).toBe("E_OHR_MODEL_DRIFT");
    });
    await withWire({ rename: () => null }, async (w) => {
      expect((await thrown(() => w.judge(judgeReq("opus"))))?.code).toBe("E_OHR_MODEL_DRIFT");
    });
  });

  test("a simulator reply that names another model than Argon is a drift, which the audit and the launches halt on", async () => {
    await withWire({ rename: (m) => (m.startsWith("google/") ? "google/gemini-4-hydrogen" : m) }, async (w) => {
      const r = await w.sim("audit:b1")(simReq);
      expect(r.kind === "call-failed" && r.reason === "drift" && r.detail.startsWith("E_OHR_MODEL_DRIFT")).toBe(true);
    });
  });

  test("a ledger refusal on a judge or auditor call stops the command as a cap stop, not a missing label or an empty answer", async () => {
    await withWire({ capMicros: 300_000, outputTokens: 20_000 }, async (w) => {
      expect((await w.judge(judgeReq("astra"))).text).not.toBeNull();
      const j = await thrown(() => w.judge({ ...judgeReq("astra"), prompt: "Reply with ok again." }));
      expect(j?.code).toBe("CAP_STOP");
      expect(j?.message).toContain("CAP_STOP: ");
      expect((await thrown(() => w.auditor("astra")("audit prompt")))?.code).toBe("CAP_STOP");
      const s = await w.sim("audit:b1")(simReq);
      expect(s.kind === "call-failed" && s.reason === "cap").toBe(true);
    });
    await withWire({ capMicros: 1000 }, async (w) => {
      const j = await thrown(() => w.judge(judgeReq("astra")));
      expect(j?.code).toBe("CAP_STOP");
      expect(j?.message).toContain("INCOMPLETE");
      expect((await thrown(() => w.auditor("astra")("audit prompt")))?.code).toBe("CAP_STOP");
    });
  });
});
