// Copyright (c) 2026 Garry Tan. MIT License.
// The tbv report driver against a scripted provider stub behind the real metering proxy, a real local ledger and a temp
// approval record: real sends, reservations and settlements.
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driveItem, openItemRun, readingOrder, run, runItem, smokeItem, spliceBy, type DrivePlan } from "../../lanes/tbv/drive.ts";
import { buildRequest, validateRequest } from "../../lanes/tbv/request.ts";
import type { Arm, BuildInput, Model, ReadingRecord, Validation } from "../../lanes/tbv/types.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { cleanup, clock, fakeBuild, history, KEYS, ledgerDir, shape, sse, status, stub, text, tmp, TURNS, type Script } from "./drive-fixture.ts";

afterAll(cleanup);
const ITEM = "tbv-test";

interface Go {
  script: Script;
  records?: (id: string) => Response;
  tasks?: string[];
  arms?: Arm[];
  models?: Model[];
  passes?: number;
  cap?: number;
  roundWorst?: number;
  validate?: (body: Record<string, unknown>, model: Model) => Validation;
  closer?: () => boolean;
  splice?: boolean;
  real?: boolean;
}
const plan = (o: Go): DrivePlan => ({
  item: ITEM,
  tasks: (o.tasks ?? ["t1"]).map((t) => history(t, t.startsWith("s") ? "ship" : "investigate")),
  arms: o.arms ?? ["none"],
  models: o.models ?? ["opus"],
  passes: { opus: o.passes ?? 1, sol: o.passes ?? 1, particle: o.passes ?? 1 },
  turns: TURNS,
  shape: (a) => shape(a),
  splice: (family, arm) => (o.splice && arm !== "none" ? { schema: "tbv-splice.v1", family, pin: "pin0", opening: [], head: [], tail: [], closer: { kind: "preamble", paragraph: "Report what you verified." }, skillStart: null, files: [], sha256: "3".repeat(64) } : null),
  ...(o.roundWorst === undefined ? {} : { roundWorstMicros: Math.round(o.roundWorst * 1e6) }),
});
const journalOf = (out: string) =>
  readdirSync(out)
    .filter((n) => n.startsWith("journal") && n.endsWith(".ndjson"))
    .flatMap((n) => readFileSync(join(out, n), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));

async function go(o: Go) {
  const L = ledgerDir(ITEM, o.cap ?? 50);
  const s = stub(o.script, o.records);
  const c = clock();
  const logs: string[] = [];
  const res = await runItem({ item: ITEM, runId: "run-1", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: s.fetch, sleep: c.sleep, now: c.now, plan: plan({ roundWorst: 0.000001, ...o }), plaintext: L.plain, sealCmd: null, unsealCmd: null, devPlaintext: true, held: false, deps: o.real ? { build: buildRequest, validate: validateRequest, closer: () => true } : { build: fakeBuild, validate: o.validate ?? (() => ({ ok: true })), closer: o.closer ?? (() => true) }, log: (t) => logs.push(t) });
  const by = (task: string, arm: Arm = "none", model: Model = "opus", pass = 1) => res.records.find((r) => r.task === task && r.arm === arm && r.model === model && r.pass === pass)!;
  return { res, s, L, c, logs, by, journal: journalOf(L.out), item: readItem(L.record, ITEM) };
}
const kinds = (r: ReadingRecord) => r.sends.map((x) => x.turn + ":" + x.kind);

describe("end states, in the frozen precedence", () => {
  test("a report with text is scored, and D1 and D2 follow on the same conversation", async () => {
    const { by, s } = await go({ script: () => text() });
    const r = by("t1");
    expect(r.cls).toBe("scored");
    expect(kinds(r)).toEqual(["report:text", "d1:text", "d2:text"]);
    expect(r.texts.report).toContain("test_widget_parse");
    expect(r.drill).toEqual({ d1: "ok", d2: "ok" });
    expect(r.responseIds.length).toBe(3);
    expect(s.calls.map((c) => c.body.messages.length)).toEqual([1, 3, 5]);
    expect(r.label).toMatch(/^[0-9a-f]{32}$/);
  });

  test("the cap refusing D2 stops the item; the report stands and D2 drops", async () => {
    const { res, by, item } = await go({ script: () => text(), cap: 0.093 });
    expect(by("t1").cls).toBe("scored");
    expect(kinds(by("t1"))).toEqual(["report:text", "d1:text", "d2:budget"]);
    expect(by("t1").drill.d2).toContain("cap");
    expect(item.leases[0]!.close!.cap_stop).toBeDefined();
    expect(res.stop?.cls).toBe("cap");
  });

  test("a 4xx that is no refusal is a harness failure that stops the item before more readings", async () => {
    const { res, by, s } = await go({ script: (c) => (c.task === "t1" ? status(400) : text()), tasks: ["t1", "t2", "t3", "t4", "t5"] });
    expect(by("t1").cls).toBe("harness");
    expect(kinds(by("t1"))).toEqual(["report:4xx"]);
    expect(res.stop?.cls).toBe("harness");
    expect(by("t5").cls).toBe("harness");
    expect(s.calls.some((c) => c.task === "t5")).toBe(false);
  });

  test("a validator failure that is not about size and a failed closer check are harness failures with no send", async () => {
    const v = await go({ script: () => text(), validate: () => ({ ok: false, size: false, problem: "roles do not alternate" }) });
    expect(v.by("t1").cls).toBe("harness");
    expect(v.s.calls.length).toBe(0);
    const k = await go({ script: () => text(), closer: () => false, arms: ["current"], splice: true });
    expect(k.by("t1", "current").cls).toBe("harness");
    expect(k.by("t1", "current").why).toContain("closer");
    expect(k.s.calls.length).toBe(0);
  });

  test("transport failures retry the same request up to twice, each a new send with its own reservation", async () => {
    const { by, journal } = await go({ script: (c) => (c.turn === "report" && c.n <= 2 ? status(503) : text()) });
    const r = by("t1");
    expect(r.cls).toBe("scored");
    expect(kinds(r)).toEqual(["report:5xx", "report:5xx", "report:text", "d1:text", "d2:text"]);
    const keys = r.sends.map((x) => x.idempotencyKey);
    expect(new Set(keys).size).toBe(5);
    for (const k of keys) expect(journal.filter((l) => l.kind === "reserve" && l.idempotency_key === k).length).toBe(1);
  });

  test("still failing after two retries is a gap", async () => {
    const { by } = await go({ script: () => status(500) });
    expect(by("t1").cls).toBe("gap");
    expect(kinds(by("t1"))).toEqual(["report:5xx", "report:5xx", "report:5xx"]);
  });

  test("a 429 comes back from the proxy as UPSTREAM 502 and the driver retries it", async () => {
    const { by, journal } = await go({ script: (c) => (c.turn === "report" && c.n === 1 ? status(429) : text()) });
    expect(by("t1").cls).toBe("scored");
    expect(by("t1").sends[0]).toMatchObject({ kind: "5xx", status: 502 });
    expect(journal.filter((l) => l.kind === "outcome" && l.status === 429).length).toBe(1);
  });

  test("a stream that ends without the final message retries as a transport failure", async () => {
    const { by } = await go({ script: (c) => (c.turn === "report" && c.n === 1 ? sse({ text: "partial", final: false }) : text()) });
    expect(by("t1").cls).toBe("scored");
    expect(["truncated", "no-final", "broken-stream"]).toContain(by("t1").sends[0]!.kind);
  });

  test("a refusal is no-report and takes no drill-down", async () => {
    const { by } = await go({ script: () => sse({ text: "", stop: "refusal" }) });
    expect(by("t1").cls).toBe("no-report");
    expect(kinds(by("t1"))).toEqual(["report:refusal"]);
  });

  test("a tool-only report gets one follow-up; text there is scored", async () => {
    const { by, s } = await go({ script: (c) => (c.turn === "report" ? sse({ tool: true, stop: "tool_use" }) : text()) });
    expect(by("t1").cls).toBe("scored");
    expect(kinds(by("t1"))).toEqual(["report:tool-only", "followup:text", "d1:text", "d2:text"]);
    expect(JSON.stringify(s.calls[1]!.body.messages.at(-1))).toContain(TURNS.followup);
  });

  test("real builder: a tool-only report reaches the follow-up with its tool calls dropped; text there is scored, an empty follow-up is no-report", async () => {
    let n = 0;
    const scored = await go({ real: true, script: () => (++n === 1 ? sse({ text: "Checking.", tool: true, stop: "tool_use" }) : text()) });
    expect(scored.res.stop).toBeNull();
    expect(scored.by("t1").cls).toBe("scored");
    expect(kinds(scored.by("t1"))).toEqual(["report:text", "d1:text", "d2:text"]);
    let m = 0;
    const toolOnly = await go({ real: true, script: () => (++m === 1 ? sse({ tool: true, stop: "tool_use" }) : text()) });
    expect(toolOnly.res.stop).toBeNull();
    expect(kinds(toolOnly.by("t1"))).toEqual(["report:tool-only", "followup:text", "d1:text", "d2:text"]);
    expect(toolOnly.by("t1").cls).toBe("scored");
    const followup = toolOnly.s.calls[1]!.body;
    expect(JSON.stringify(followup)).not.toContain("tool_use");
    expect(JSON.stringify(followup.messages.at(-1))).toContain(TURNS.followup);
    let k = 0;
    const empty = await go({ real: true, script: () => (++k === 1 ? sse({ tool: true, stop: "tool_use" }) : sse({})) });
    expect(empty.res.stop).toBeNull();
    expect(kinds(empty.by("t1"))).toEqual(["report:tool-only", "followup:empty"]);
    expect(empty.by("t1").cls).toBe("no-report");
  });

  test("an empty report and an empty follow-up are no-report", async () => {
    const { by } = await go({ script: () => sse({}) });
    expect(by("t1").cls).toBe("no-report");
    expect(kinds(by("t1"))).toEqual(["report:empty", "followup:empty"]);
  });

  test("max_tokens with text on the report turn is scored as returned, with no retry", async () => {
    const { by } = await go({ script: (c) => (c.turn === "report" ? sse({ text: "a long report", stop: "max_tokens" }) : text()) });
    expect(by("t1").cls).toBe("scored");
    expect(by("t1").maxTokens).toEqual(["report"]);
    expect(kinds(by("t1"))).toEqual(["report:max-tokens", "d1:text", "d2:text"]);
  });

  test("max_tokens with no text on the report turn takes the no-report path (one follow-up)", async () => {
    const { by } = await go({ script: (c) => (c.turn === "report" ? sse({ tool: true, stop: "max_tokens" }) : c.turn === "followup" ? sse({ stop: "max_tokens" }) : text()) });
    expect(by("t1").cls).toBe("no-report");
    expect(by("t1").maxTokens).toEqual(["report", "followup"]);
    expect(by("t1").sends.map((x) => x.turn)).toEqual(["report", "followup"]);
  });

  test("max_tokens on the follow-up, D1 and D2 is read as returned", async () => {
    const { by } = await go({ script: (c) => (c.turn === "report" ? sse({ tool: true, stop: "tool_use" }) : sse({ text: "cut " + c.turn, stop: "max_tokens" })) });
    const r = by("t1");
    expect(r.cls).toBe("scored");
    expect(r.maxTokens).toEqual(["followup", "d1", "d2"]);
    expect(r.drill).toEqual({ d1: "ok", d2: "ok" });
    expect(r.texts.d1).toBe("cut d1");
  });

  test("real builder: D1 failing after two retries is a drill-down gap; D2 is still sent on [report, d1] and read", async () => {
    let n = 0;
    const { by, s } = await go({ real: true, script: () => (++n === 1 || n === 5 ? text() : status(500)) });
    const r = by("t1");
    expect(r.cls).toBe("scored");
    expect(kinds(r)).toEqual(["report:text", "d1:5xx", "d1:5xx", "d1:5xx", "d2:text"]);
    expect(r.drill).toEqual({ d1: "drill-down gap", d2: "ok" });
    expect(r.texts.d2).toContain("test_widget_parse");
    const last = s.calls.at(-1)!.body.messages;
    expect(validateRequest(s.calls.at(-1)!.body, "opus")).toEqual({ ok: true });
    expect(JSON.stringify(last.at(-1))).toContain(TURNS.d1);
    expect(JSON.stringify(last.at(-1))).toContain(TURNS.d2);
  });

  test("an allowance refusal on D1 drops only D1; D2 is still read", async () => {
    const { by, journal } = await go({ script: () => text(), tasks: ["wide1"] });
    const r = by("wide1");
    expect(r.cls).toBe("scored");
    expect(r.drill.d1).toContain("allowance");
    expect(r.drill.d2).toBe("ok");
    expect(journal.some((l) => l.kind === "refusal" && l.code === "E_ALLOWANCE")).toBe(true);
  });
});

describe("order, rounds and admission", () => {
  test("pass 1's report turn finishes before any other pass of that task, arm and model starts, and at most 4 readings are in flight", async () => {
    const events: string[] = [];
    let inflight = 0, most = 0;
    const script: Script = async (c) => {
      inflight++;
      most = Math.max(most, inflight);
      events.push("start " + c.arm + " " + c.turn + " " + c.n);
      await Bun.sleep(c.turn === "report" && c.n === 1 ? 40 : 2);
      events.push("end " + c.arm + " " + c.turn + " " + c.n);
      inflight--;
      return text();
    };
    const { res } = await go({ script, arms: ["none", "current"], passes: 3 });
    expect(res.records.every((r) => r.cls === "scored")).toBe(true);
    for (const arm of ["none", "current"]) {
      const first = events.indexOf("end " + arm + " report 1");
      const starts = events.map((e, i) => [e, i] as const).filter(([e]) => e.startsWith("start " + arm + " "));
      expect(starts[0]![0]).toBe("start " + arm + " report 1");
      for (const [, i] of starts.slice(1)) expect(i).toBeGreaterThan(first);
    }
    expect(most).toBeLessThanOrEqual(4);
    expect(readingOrder(plan({ script, arms: ["none"], passes: 2, tasks: ["t1", "t2"] })).map((r) => r.task + r.pass)).toEqual(["t11", "t12", "t21", "t22"]);
  });

  test("a full item never meets E_ALLOWANCE, and the lease settles at the readings' total", async () => {
    const { res, journal, item } = await go({ script: () => text(), tasks: ["t1", "t2"], arms: ["none", "current"], models: ["opus", "sol", "particle"], passes: 2, cap: 100, roundWorst: undefined });
    expect(res.records.length).toBe(24);
    expect(res.records.every((r) => r.cls === "scored")).toBe(true);
    expect(journal.filter((l) => l.kind === "refusal").length).toBe(0);
    const close = item.leases[0]!.close!;
    expect(close.unknown_calls).toBe(0);
    expect(close.spent_micros).toBe(Math.round(res.records.reduce((a, r) => a + r.usd, 0) * 1e6));
    expect(res.stop).toBeNull();
  });

  test("round admission refuses a round past the cap: the item stops mid-item and the rest are cap readings", async () => {
    const { res, s } = await go({ script: () => text(), tasks: ["t1", "t2", "t3", "t4", "t5"], cap: 20.05, roundWorst: 20 });
    expect(res.records.filter((r) => r.cls === "scored").length).toBe(4);
    expect(res.records.find((r) => r.task === "t5")!.cls).toBe("cap");
    expect(res.stop?.cls).toBe("cap");
    expect(s.calls.some((c) => c.task === "t5")).toBe(false);
  });
});

describe("reservation release before a headroom refusal", () => {
  const noUsage: Script = () => sse({ text: "a report", usage: false });
  test("a send the generation record shows was not billed is released, and the round is admitted", async () => {
    const zero = (id: string) => Response.json({ data: { id, total_cost: 0, tokens_prompt: 0, tokens_completion: 0 } });
    const { res, s, L, item } = await go({ script: noUsage, records: zero, tasks: ["t1", "t2", "t3", "t4", "t5"], models: ["sol"], cap: 1.3, roundWorst: 1 });
    expect(res.records.find((r) => r.task === "t5")!.cls).toBe("scored");
    expect(s.gets.length).toBeGreaterThanOrEqual(12);
    expect(s.gets.every((u) => /^https:\/\/openrouter\.ai\/api\/v1\/generation\?id=gen-/.test(u))).toBe(true);
    const db = new Database(L.ledger, { readonly: true });
    const rows = db.query("SELECT generation_id, record_sha256 FROM releases").all() as Array<{ generation_id: string; record_sha256: string }>;
    db.close();
    expect(rows.length).toBe(12);
    expect(rows.every((r) => /^gen-/.test(r.generation_id) && /^[0-9a-f]{64}$/.test(r.record_sha256))).toBe(true);
    expect(item.leases[0]!.close!.unknown_calls).toBe(3);
  });

  test("a send with no generation record (404) keeps its full reservation and stops the item (E_TBV_RUN); no lookup or send retries", async () => {
    const { res, s, item } = await go({ script: noUsage, tasks: ["t1", "t2", "t3", "t4", "t5"], models: ["sol"], cap: 1.3, roundWorst: 1 });
    expect(res.stop?.cls).toBe("harness");
    expect(res.stop?.why).toContain("E_TBV_RUN");
    expect(res.stop?.why).toContain("no OpenRouter generation record");
    expect(res.records.find((r) => r.task === "t5")!.cls).toBe("harness");
    expect(s.gets.length).toBe(1);
    expect(item.leases[0]!.close!.unknown_calls).toBeGreaterThanOrEqual(12);
  });
  test("a record for another generation id counts as no record: the item stops and nothing is released", async () => {
    const other = () => Response.json({ data: { id: "gen-someone-else", total_cost: 0 } });
    const { res, s, L } = await go({ script: noUsage, records: other, tasks: ["t1", "t2", "t3", "t4", "t5"], models: ["sol"], cap: 1.3, roundWorst: 1 });
    expect(res.stop?.cls).toBe("harness");
    expect(s.gets.length).toBe(1);
    const db = new Database(L.ledger, { readonly: true });
    expect((db.query("SELECT COUNT(*) AS n FROM releases").get() as { n: number }).n).toBe(0);
    db.close();
  });
  test("other direction: a billed record keeps its reservation and the round is refused as a cap stop", async () => {
    const billed = (id: string) => Response.json({ data: { id, total_cost: 0.01 } });
    const { res } = await go({ script: noUsage, records: billed, tasks: ["t1", "t2", "t3", "t4", "t5"], models: ["sol"], cap: 1.3, roundWorst: 1 });
    expect(res.stop?.cls).toBe("cap");
    expect(res.records.find((r) => r.task === "t5")!.cls).toBe("cap");
  });
});

describe("the outage pause", () => {
  test("3 transport failures in a row pause the route for 10 minutes; the probe succeeds and the item goes on", async () => {
    const c0 = clock().now();
    let now = () => c0;
    const script: Script = () => (now() < c0 + 600_000 ? status(503) : text());
    const L = ledgerDir(ITEM, 50);
    const s = stub(script);
    const c = clock(c0);
    now = c.now;
    const res = await runItem({ item: ITEM, runId: "run-1", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: s.fetch, sleep: c.sleep, now: c.now, plan: plan({ script, tasks: ["t1", "t2"], models: ["sol"], roundWorst: 0.000001 }), plaintext: L.plain, sealCmd: null, unsealCmd: null, devPlaintext: true, held: false, deps: { build: fakeBuild, validate: () => ({ ok: true }), closer: () => true }, log: () => {} });
    expect(c.sleeps.filter((ms) => ms === 600_000).length).toBe(1);
    expect(res.stop).toBeNull();
    expect(res.records.some((r) => r.cls === "scored")).toBe(true);
    for (const r of res.records) {
      const fails = r.sends.filter((x) => x.kind === "5xx").length;
      if (r.cls === "gap") expect(fails).toBe(3);
    }
  });

  test("6 waits with no success end the item as an outage stop; every unfinished reading is an outage", async () => {
    const { res, c } = await go({ script: () => status(503), tasks: ["t1", "t2", "t3"], models: ["sol"] });
    expect(c.sleeps.filter((ms) => ms === 600_000).length).toBe(6);
    expect(res.stop?.cls).toBe("outage");
    expect(res.records.length).toBe(3);
    expect(res.records.every((r) => r.cls === "outage" || r.cls === "gap")).toBe(true);
    expect(res.records.find((r) => r.task === "t3")!.cls).toBe("outage");
  });
});

describe("stops inside a round", () => {
  test("after one reading's 4xx, no other reading in the round makes a new send", async () => {
    const script: Script = async (c) => {
      if (c.task === "t1") return status(400);
      await Bun.sleep(50);
      return text();
    };
    const { res, s, by } = await go({ script, tasks: ["t1", "t2", "t3"] });
    expect(res.stop?.cls).toBe("harness");
    const at = s.calls.findIndex((c) => c.task === "t1");
    expect(s.calls.slice(at + 1).map((c) => c.task + ":" + c.turn)).toEqual(["t2:report", "t3:report"]);
    expect(by("t2").cls).toBe("harness");
    expect(by("t3").cls).toBe("harness");
  });

  test("an allowance refusal during an outage probe does not clear the outage state", async () => {
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    const script: Script = async (c) => {
      if (c.task === "t2") {
        if (c.n === 3) void Bun.sleep(100).then(release);
        return status(503);
      }
      if (c.turn === "report") {
        await held;
        return text();
      }
      return status(503);
    };
    const { res, by, c } = await go({ script, tasks: ["wide1", "t2"], models: ["sol"] });
    expect(by("wide1", "none", "sol").sends.filter((x) => x.turn === "d1").map((x) => x.kind)).toEqual(["allowance"]);
    expect(c.sleeps.filter((ms) => ms === 600_000).length).toBe(6);
    expect(res.stop?.cls).toBe("outage");
    expect(by("wide1", "none", "sol").cls).toBe("outage");
  });
});

describe("size drops", () => {
  test("a size-only validator refusal drops the task from every arm and model in the item", async () => {
    const validate = (body: Record<string, unknown>, model: Model): Validation => (JSON.stringify(body).includes("TASK t2 ") && model === "sol" ? { ok: false, size: true, tokens: 210_000, window: 200_000 } : { ok: true });
    const { res, s } = await go({ script: () => text(), tasks: ["t1", "t2"], arms: ["none", "current"], models: ["opus", "sol"], validate });
    const t2 = res.records.filter((r) => r.task === "t2");
    expect(t2.length).toBe(4);
    expect(t2.every((r) => r.cls === "size-drop")).toBe(true);
    expect(s.calls.some((c) => c.task === "t2")).toBe(false);
    expect(res.records.filter((r) => r.task === "t1").every((r) => r.cls === "scored")).toBe(true);
    expect(res.dropped).toEqual(["t2"]);
    expect(res.stop).toBeNull();
  });
});

describe("the shape smoke", () => {
  test("one report-turn send per model, arm, family and source shape, with reported prompt tokens beside the estimate", async () => {
    const L = ledgerDir(ITEM, 50);
    const s = stub((c) => sse({ text: "ok", input: c.task === "s1" && c.model === "claude-opus-5-5" ? 50_000 : 10 }));
    const run = await openItemRun({ item: ITEM, runId: "smoke-1", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: s.fetch });
    let lines: string[];
    try {
      lines = await smokeItem(run, plan({ script: () => text(), tasks: ["t1", "s1"], arms: ["none", "current"], models: ["opus", "sol"] }), { build: fakeBuild, validate: () => ({ ok: true }), closer: () => true });
    } finally {
      await run.close();
    }
    expect(s.calls.length).toBe(8);
    expect(s.calls.every((c) => c.turn === "report")).toBe(true);
    const rows = lines.filter((l) => /reported \d+/.test(l));
    expect(rows.length).toBe(8);
    expect(rows.every((l) => /estimate \d+/.test(l))).toBe(true);
    expect(rows.filter((l) => l.includes("OVER")).length).toBe(2);
  });
});

describe("restart under the same run id", () => {
  test("a SIGKILL in the middle of a batch: the restart deletes leftover plaintext, reconciles the dead journal, marks the in-flight reading a crash gap and sends no reading twice", async () => {
    const L = ledgerDir(ITEM, 50);
    const marker = join(L.root, "hung");
    const child = Bun.spawn(["bun", join(import.meta.dir, "drive-child.ts"), L.root, ITEM], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: L.root } });
    const sealed = () => (existsSync(join(L.out, "sealed")) ? readdirSync(join(L.out, "sealed")).filter((n) => n.startsWith("reading-")).length : 0);
    for (let i = 0; i < 300 && !(existsSync(marker) && sealed() >= 3); i++) await Bun.sleep(50);
    expect(existsSync(marker)).toBe(true);
    expect(sealed()).toBe(3);
    child.kill("SIGKILL");
    await child.exited;
    expect(existsSync(L.plain)).toBe(true);
    const s = stub(() => text());
    const logs: string[] = [];
    const { childPlan, sealCmd, unsealCmd } = await import("./drive-child.ts");
    const res = await runItem({ item: ITEM, runId: "run-crash", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: s.fetch, plan: childPlan(), plaintext: L.plain, sealCmd: sealCmd(L.root), unsealCmd: unsealCmd(L.root), devPlaintext: false, held: false, mounts: "tmpfs " + L.root + " tmpfs rw 0 0\n", deps: { build: fakeBuild, validate: () => ({ ok: true }), closer: () => true }, log: (t) => logs.push(t) });
    expect(logs.some((l) => l.includes("leftover") && l.includes(L.plain))).toBe(true);
    const crashed = res.records.find((r) => r.task === "t2" && r.arm === "current")!;
    expect(crashed.cls).toBe("gap");
    expect(crashed.why).toContain("crash");
    expect(s.calls.filter((c) => c.task === "t1" || c.task === "t2").length).toBe(0);
    expect(s.calls.filter((c) => c.task === "t3").length).toBe(6);
    expect(res.records.length).toBe(6);
    expect(res.records.filter((r) => r.cls === "scored").length).toBe(5);
    const item = readItem(L.record, ITEM);
    expect(item.leases.length).toBe(2);
    expect(item.leases[0]!.close!.unknown_calls).toBe(1);
    expect(item.open).toBeNull();
    const plainSealed = readdirSync(join(L.out, "sealed")).map((n) => readFileSync(join(L.out, "sealed", n), "utf8"));
    expect(plainSealed.every((t) => t.startsWith("STUB-SEALED"))).toBe(true);
  }, 30_000);
});

describe("the drive CLI's splice callback", () => {
  const set = (family: "investigate" | "ship", pin: string) => ({ schema: "tbv-splice.v1" as const, family, pin, opening: [], head: [], tail: [], closer: { kind: "preamble" as const, paragraph: "p" }, skillStart: null, files: [], sha256: pin.padEnd(64, "0") });
  const pins = (arm: Arm) => (arm === "current" ? "pinC" : arm === "principle" ? "pinP" : null);
  test("with C and P captures for one family, each gstack arm gets the splice at its own shape's pin", () => {
    const splice = spliceBy([set("investigate", "pinC"), set("investigate", "pinP"), set("ship", "pinC")], pins, "splices/");
    expect(splice("investigate", "current")!.pin).toBe("pinC");
    expect(splice("investigate", "principle")!.pin).toBe("pinP");
    expect(splice("ship", "current")!.pin).toBe("pinC");
    expect(splice("investigate", "none")).toBeNull();
  });
  test("the lens arm, like none, takes no splice set", () => {
    const splice = spliceBy([set("investigate", "pinC")], pins, "splices/");
    expect(splice("investigate", "lens")).toBeNull();
    expect(splice("ship", "lens")).toBeNull();
  });
  test("no splice at the arm's pin, or two files with one family and pin, is E_TBV_INPUT", () => {
    const refusal = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as { code?: string }).code + " " + (e as Error).message;
      }
      return "no error";
    };
    const splice = spliceBy([set("investigate", "pinC"), set("ship", "pinC")], pins, "splices/");
    expect(refusal(() => splice("investigate", "principle"))).toMatch(/^E_TBV_INPUT .*investigate.*pinP/);
    expect(refusal(() => splice("ship", "principle"))).toMatch(/^E_TBV_INPUT .*pinP/);
    expect(refusal(() => spliceBy([set("investigate", "pinC"), set("investigate", "pinC")], pins, "splices/"))).toMatch(/^E_TBV_INPUT .*investigate.*pinC/);
  });
});

describe("item run teardown", () => {
  test("the plaintext root is deleted even when closing the run throws", async () => {
    const L = ledgerDir(ITEM, 50);
    const s = stub(() => {
      rmSync(L.record, { recursive: true, force: true });
      return text();
    });
    const c = clock();
    const err = await runItem({ item: ITEM, runId: "run-1", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: s.fetch, sleep: c.sleep, now: c.now, plan: plan({ script: () => text(), roundWorst: 0.000001 }), plaintext: L.plain, sealCmd: null, unsealCmd: null, devPlaintext: true, held: false, deps: { build: fakeBuild, validate: () => ({ ok: true }), closer: () => true }, log: () => {} }).then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    expect(existsSync(L.plain)).toBe(false);
  });
  test("a reading that throws lets the round's other readings finish before the item run closes", async () => {
    let inflight = 0;
    const script: Script = async (c) => {
      inflight++;
      if (c.task === "t2") await Bun.sleep(100);
      inflight--;
      return text();
    };
    const L = ledgerDir(ITEM, 50);
    const s = stub(script);
    const c = clock();
    const build = (i: BuildInput) => {
      if (i.history.task === "t1" && i.turn === "d1") throw new Error("boom in t1's d1 build");
      return fakeBuild(i);
    };
    let at = -1;
    const err = await runItem({ item: ITEM, runId: "run-1", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: s.fetch, sleep: c.sleep, now: c.now, plan: plan({ script, tasks: ["t1", "t2"], roundWorst: 0.000001 }), plaintext: L.plain, sealCmd: null, unsealCmd: null, devPlaintext: true, held: false, deps: { build, validate: () => ({ ok: true }), closer: () => true }, log: () => {} }).then(
      () => null,
      (e) => {
        at = inflight;
        return e;
      },
    );
    expect(String(err)).toContain("boom in t1's d1 build");
    expect(at).toBe(0);
    expect(s.calls.filter((x) => x.task === "t2").map((x) => x.turn)).toEqual(["report", "d1", "d2"]);
  });
});

describe("drive --held custody", () => {
  const refusal = async (tasks: string) => {
    const argv = ["drive", "--models", "opus", "--arms", "none", "--passes", "opus=1", "--held", "--seal-cmd", "cat", "--tasks", tasks];
    try {
      await run(argv, { out: () => {}, err: () => {} });
    } catch (e) {
      return (e as { code?: string }).code + " " + (e as Error).message;
    }
    return "no error";
  };
  test("with --held, --tasks on a disk directory is refused (E_TBV_CUSTODY)", async () => {
    expect(await refusal(tmp("tbv-held-tasks-"))).toMatch(/^E_TBV_CUSTODY .*--tasks/);
  });
  test("with --held, --tasks under /dev/shm passes the custody check", async () => {
    expect(await refusal("/dev/shm/tbv-held-tasks-test")).not.toMatch(/^E_TBV_CUSTODY/);
  });
});
