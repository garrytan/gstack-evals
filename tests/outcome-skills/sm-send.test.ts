// Copyright (c) 2026 Garry Tan. MIT License.
// The paid sender for section 3's label packets and section 10's judge packets (send.ts, GST-1959): each call reserved
// on its own item's lease at the per-call bound, the item's stops refused before any call, no retry after a cap or an
// allowance stop, a malformed reply recorded once, and an upstream error's reservation settled as the ledger's rules
// say. On a temporary ledger with a stub upstream behind the real metering proxy; no key, no paid call.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/outcome-skills/statemachines/cli.ts";
import { judgeKey, judgePacket, labelledQueue, labelPacket } from "../../lanes/outcome-skills/statemachines/packets.ts";
import { sendPackets, type SendOptions } from "../../lanes/outcome-skills/statemachines/send.ts";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { openLease, reconcileLease, recordApproval, recordStop } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";

const D = 1_000_000;
const KEYS = { OPENAI_API_KEY: "fake-openai-value-for-sm-send-tests", ANTHROPIC_API_KEY: "fake-anthropic-value-for-sm-send-tests" };
const quote = { words: "test words", by: "test", source: "sm-send.test.ts" };
const LABEL = JSON.stringify({ defect: "yes", state_shaped: "no", reason: "The flag is never reset on close." });
const JUDGE = JSON.stringify({ ux: { score: 0, reason: "Nothing users see." }, dx: { score: 1, reason: "Clearer names." }, ax: { score: 0, reason: "Same." }, hunks: [{ id: "h1", real_defect: "no" }] });
const AT_BOUND = { input: 20_000, output: 1_500 };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

type Item = "sm-labels" | "sm-judges";
type Setup = { root: string; record: string; packets: string; ledger: string };
type Call = { model: string; packet: string; body: any };
type Reply = { status?: number; text?: string; usage?: { input: number; output: number }; throws?: boolean };

/** A record with the state machines line and each named item at its cap in dollars, and an empty packets dir. */
function setup(caps: Partial<Record<Item, number>>): Setup {
  const root = mkdtempSync(join(tmpdir(), "sm-send-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "state-machines", cap_micros: 4000 * D, skill_cap_micros: 4000 * D, skills: ["sm"], credit_rate_micros: D, quotes: [quote] });
  for (const [item, usd] of Object.entries(caps)) recordApproval(record, { action: "init", item, cap_micros: Math.round(usd * D), quotes: [quote], admission: "required", program: "state-machines", skills: ["sm"] });
  const packets = join(root, "packets");
  mkdirSync(packets);
  return { root, record, packets, ledger: join(root, "ledger.sqlite") };
}

const put = (dir: string, v: { packet: string }, key: unknown) => {
  writeFileSync(join(dir, v.packet + ".json"), JSON.stringify(v, null, 1) + "\n");
  writeFileSync(join(dir, v.packet + ".key.json"), JSON.stringify(key, null, 1) + "\n");
  return v.packet;
};

/** Label packets from invented units, sorted by packet id; issue(i) is unit i's issue text. */
function labels(s: Setup, n: number, issue: (i: number) => string = (i) => "The counter does not reset after close (" + i + ").\n"): string[] {
  return Array.from({ length: n }, (_, i) => {
    const u = join(s.root, "unit-" + i);
    mkdirSync(u, { recursive: true });
    writeFileSync(join(u, "unit.json"), JSON.stringify({ id: "acme__widget-" + i }));
    writeFileSync(join(u, "issue.md"), issue(i));
    writeFileSync(join(u, "fix.patch"), "diff --git a/src/c.go b/src/c.go\n--- a/src/c.go\n+++ b/src/c.go\n@@ -1,1 +1,1 @@\n-a\n+b\n");
    writeFileSync(join(u, "test.patch"), "diff --git a/src/c_test.go b/src/c_test.go\n--- a/src/c_test.go\n+++ b/src/c_test.go\n@@ -1,0 +2,1 @@\n+t\n");
    const { packet, key } = labelPacket(u);
    return put(s.packets, packet, key);
  }).sort();
}

/** One judge packet with one hunk: a first-stage diff of the session model's run, or an R78 labelled item when model is null. */
function judged(s: Setup, name: string, model: string | null): string {
  const p = "src/" + name + ".go";
  const diff = "diff --git a/" + p + " b/" + p + "\n--- a/" + p + "\n+++ b/" + p + "\n@@ -3,0 +4,4 @@\n" + "+line\n".repeat(4);
  const { packet, lines_total } = judgePacket({ diff, files: ["src/a.go", p] });
  const key = model ? judgeKey(packet, { unit: "acme__" + name, model, cell: "A1", lines_total, stock: null }) : { schema: "sm-r78-key.v1", packet: packet.packet, unit: "acme__" + name, kind: "bad", axis: "ux", made_by: "negate_condition", lines_total };
  return put(s.packets, packet, key);
}

/** A fake provider behind the proxy. The prompt is the packet's body as JSON, so its digest is the packet id. */
const upstream = (calls: Call[], reply: (model: string, packet: string) => Reply) => async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const prompt: string = (body.input ?? body.messages)[0].content;
  const packet = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
  calls.push({ model: body.model, packet, body });
  const r = reply(body.model, packet);
  if (r.throws) throw new Error("connection reset by peer");
  if (r.status !== undefined && r.status !== 200) return Response.json({ error: { type: "server_error", message: "no" } }, { status: r.status });
  const u = r.usage ?? { input: 1_000, output: 100 };
  const text = r.text ?? LABEL;
  return body.input
    ? Response.json({ id: "r", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: u.input, input_tokens_details: { cached_tokens: 0 }, output_tokens: u.output, output_tokens_details: { reasoning_tokens: 0 } } })
    : Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: u.input, output_tokens: u.output } });
};

const outDir = (s: Setup, item: Item) => join(s.root, "out-" + item);
async function send(s: Setup, item: string, calls: Call[], reply: (model: string, packet: string) => Reply = () => ({}), extra: Partial<SendOptions> = {}) {
  try {
    const result = await sendPackets({ item, run_id: "run-1", packets: s.packets, out: outDir(s, item as Item), record: s.record, ledger: s.ledger, concurrency: 1, env: KEYS, fetch: upstream(calls, reply), sleep: async () => {}, requireAdmission: () => null, log: () => {}, ...extra });
    return { code: "ok", message: "", result };
  } catch (e) {
    const message = (e as Error).message;
    return { code: message.split(" ")[0]!, message, result: null };
  }
}
const lines = (s: Setup, item: Item) => readFileSync(join(outDir(s, item), "replies.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const replies = (s: Setup, item: Item) => lines(s, item).filter((l) => l.event === "reply");
const sentTo = (calls: Call[]) => calls.map((c) => c.model + " " + c.packet);
/** The worst case the proxy reserved for each call it sent, from the one lease's journal, in send order. */
const reserved = (s: Setup, item: Item) => readFileSync(join(outDir(s, item), readdirSync(outDir(s, item)).find((n) => n.endsWith(".journal.ndjson"))!), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.kind === "request").map((l) => l.max_micros as number);

describe("a send on the item's own lease", () => {
  test("labels: Astra and Opus each answer every packet once on the frozen routes, the prompt is the packet's digested body, and sm-labels settles while sm-judges stays untouched", async () => {
    const s = setup({ "sm-labels": 150, "sm-judges": 180 });
    const [a, b] = labels(s, 2) as [string, string];
    const calls: Call[] = [];
    const r = await send(s, "sm-labels", calls);
    expect([r.code, r.message]).toEqual(["ok", ""]);
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "claude-opus-5-5 " + a, "gpt-6-astra " + b, "claude-opus-5-5 " + b]);
    const astra = calls[0]!.body;
    expect([astra.reasoning, astra.max_output_tokens, astra.store, astra.tools, astra.input.length]).toEqual([{ effort: "medium" }, 1500, false, undefined, 1]);
    const opus = calls[1]!.body;
    expect([opus.max_tokens, opus.system, opus.tools, opus.thinking, opus.messages.length]).toEqual([1500, undefined, undefined, undefined, 1]);
    const { schema: _schema, packet: _id, ...body } = JSON.parse(readFileSync(join(s.packets, a + ".json"), "utf8"));
    expect(astra.input[0].content).toBe(JSON.stringify(body));
    const item = readItem(s.record, "sm-labels");
    expect([item.open, item.leases.length, item.stops.length]).toEqual([null, 1, 0]);
    expect(item.leases[0]!.lease.run_id).toBe("run-1");
    expect(item.leases[0]!.close).toMatchObject({ how: "settled", spent_micros: 2 * (1_000 * 10 + 100 * 50) + 2 * (1_000 * 4 + 100 * 20), unknown_micros: 0, unknown_calls: 0 });
    expect(item.leases[0]!.close!.cap_stop).toBeUndefined();
    expect(readItem(s.record, "sm-judges").leases.length).toBe(0);
    expect(r.result).toMatchObject({ item: "sm-labels", lease_id: item.leases[0]!.lease.lease_id, sent: 4, counts: { answered: 4, malformed: 0, allowance_stop: 0, cap_stop: 0, upstream: 0, lost: 0 } });
    const rs = replies(s, "sm-labels");
    expect(rs.map((x) => [x.packet, x.reader, x.model, x.outcome])).toEqual([[a, "astra", "openai/gpt-6-astra", "answered"], [a, "opus", "anthropic/claude-opus-5-5", "answered"], [b, "astra", "openai/gpt-6-astra", "answered"], [b, "opus", "anthropic/claude-opus-5-5", "answered"]]);
    expect(rs[0].answer).toEqual(JSON.parse(LABEL));
    expect(readFileSync(join(outDir(s, "sm-labels"), rs[0].raw), "utf8")).toBe(LABEL);
    const again = await send(s, "sm-labels", calls);
    expect([again.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["ok", 4, 1]);
  });

  test("judges: Astra judges Opus runs, Opus judges Sol and particle-1 runs, both judges take the queued R78 items in each queue's order, and only sm-judges is leased", async () => {
    const s = setup({ "sm-labels": 150, "sm-judges": 180 });
    const d1 = judged(s, "d1", "claude-opus-5-5"), d2 = judged(s, "d2", "openai/gpt-6.1-sol"), d3 = judged(s, "d3", "particle-ai/particle-1"), r1 = judged(s, "r1", null);
    const qa = labelledQueue(join(s.packets, "queue-astra.json"), [r1, d2]).order, qo = labelledQueue(join(s.packets, "queue-opus.json"), [r1, d2]).order;
    const calls: Call[] = [];
    const r = await send(s, "sm-judges", calls, () => ({ text: JUDGE }));
    expect([r.code, r.message]).toEqual(["ok", ""]);
    const astra = [...qa, d1], opus = [...qo, d3];
    expect(sentTo(calls)).toEqual(astra.flatMap((id, i) => ["gpt-6-astra " + id, "claude-opus-5-5 " + opus[i]]));
    expect(replies(s, "sm-judges").every((x) => x.outcome === "answered" && x.answer.hunks[0].id === "h1")).toBe(true);
    expect(readItem(s.record, "sm-judges").leases[0]!.close).toMatchObject({ how: "settled", unknown_micros: 0 });
    expect(readItem(s.record, "sm-labels").leases.length).toBe(0);
  });
});

describe("refusals before any lease or call", () => {
  test("no recorded cap is E_LEDGER_MISSING; a cap-stopped item and a drained item are CAP_STOP", async () => {
    const calls: Call[] = [];
    const none = setup({ "sm-judges": 180 });
    labels(none, 1);
    const missing = await send(none, "sm-labels", calls);
    expect(missing.code).toBe("E_LEDGER_MISSING");
    expect(readItem(none.record, "sm-labels").leases.length).toBe(0);

    const stopped = setup({ "sm-labels": 150 });
    labels(stopped, 1);
    const early = openLease(stopped.record, null, { item: "sm-labels", run_id: "run-1", ttl_ms: 1_000, requireAdmission: () => null });
    recordStop(stopped.record, early.lease_id, "sm-labels only");
    const source = join(stopped.root, "usage.csv");
    writeFileSync(source, "spent,0\n");
    reconcileLease(stopped.record, { lease_id: early.lease_id, spent_micros: 0, quotes: [quote], source, now: new Date(Date.now() + 60_000) });
    const capStopped = await send(stopped, "sm-labels", calls);
    expect(capStopped.code).toBe("CAP_STOP");
    expect(capStopped.message).toContain("cap-stopped");

    const drained = setup({ "sm-labels": 150 });
    labels(drained, 1);
    const all = openLease(drained.record, null, { item: "sm-labels", run_id: "run-1", ttl_ms: 1_000, requireAdmission: () => null });
    writeFileSync(join(drained.root, "usage.csv"), "spent,150\n");
    reconcileLease(drained.record, { lease_id: all.lease_id, spent_micros: 150 * D, quotes: [quote], source: join(drained.root, "usage.csv"), now: new Date(Date.now() + 60_000) });
    const empty = await send(drained, "sm-labels", calls);
    expect(empty.code).toBe("CAP_STOP");
    expect(empty.message).toContain("$0.00 left");
    expect(readItem(drained.record, "sm-labels").leases.length).toBe(1);
    expect(calls.length).toBe(0);
  });

  test("packets of the other item, a changed packet, a packet with no key and an R78 item with no queue are refused", async () => {
    const calls: Call[] = [];
    const s = setup({ "sm-labels": 150, "sm-judges": 180 });
    const [id] = labels(s, 1) as [string];
    expect((await send(s, "sm-qa-opus", calls)).code).toBe("E_USAGE");
    expect((await send(s, "sm-judges", calls)).code).toBe("E_USAGE");
    const file = join(s.packets, id + ".json");
    const good = readFileSync(file, "utf8");
    writeFileSync(file, good.replace("does not reset", "does not resett"));
    const changed = await send(s, "sm-labels", calls);
    expect([changed.code, changed.message.includes(id)]).toEqual(["E_SM_PACKET", true]);
    writeFileSync(file, good);
    rmSync(join(s.packets, id + ".key.json"));
    expect((await send(s, "sm-labels", calls)).code).toBe("E_SM_PACKET");

    const j = setup({ "sm-judges": 180 });
    judged(j, "d1", "claude-opus-5-5");
    const r1 = judged(j, "r1", null);
    labelledQueue(join(j.packets, "queue-astra.json"), [r1]);
    const noQueue = await send(j, "sm-judges", calls, () => ({ text: JUDGE }));
    expect([noQueue.code, noQueue.message.includes(r1)]).toEqual(["E_SM_PACKET", true]);
    expect(calls.length).toBe(0);
    expect([readItem(s.record, "sm-labels").leases.length, readItem(j.record, "sm-judges").leases.length]).toEqual([0, 0]);
  });
});

describe("stops are never retried", () => {
  test("a call whose allowance does not fit the item's room cap-stops the item: the stop is recorded, nothing more is sent, and a rerun is refused without a call", async () => {
    const s = setup({ "sm-labels": 0.5 });
    const [a, b] = labels(s, 2) as [string, string];
    const calls: Call[] = [];
    const r = await send(s, "sm-labels", calls, () => ({ usage: AT_BOUND }));
    expect(r.code).toBe("CAP_STOP");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "claude-opus-5-5 " + a]);
    expect(replies(s, "sm-labels").map((x) => [x.packet, x.reader, x.outcome, x.code])).toEqual([[a, "astra", "answered", null], [a, "opus", "answered", null], [b, "astra", "cap_stop", "CAP_STOP"]]);
    const item = readItem(s.record, "sm-labels");
    expect(item.stops.map((x) => x.scope)).toEqual(["sm-labels only"]);
    expect(item.leases[0]!.close).toMatchObject({ spent_micros: 275_000 + 110_000, cap_stop: "sm-labels only" });
    const rerun = await send(s, "sm-labels", calls, () => ({ usage: AT_BOUND }));
    expect([rerun.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["CAP_STOP", 2, 1]);

    const tight = setup({ "sm-labels": 0.2 });
    labels(tight, 1);
    const first = await send(tight, "sm-labels", calls);
    expect([first.code, calls.length]).toEqual(["CAP_STOP", 2]);
    expect(readItem(tight.record, "sm-labels").leases[0]!.close).toMatchObject({ spent_micros: 0, cap_stop: "sm-labels only" });
  });

  test("calls in flight hold their allowance against the room, so concurrent sends never pass the cap", async () => {
    const s = setup({ "sm-labels": 0.5 });
    const [a] = labels(s, 2) as [string, string];
    const calls: Call[] = [];
    const r = await send(s, "sm-labels", calls, () => ({ usage: AT_BOUND }), { concurrency: 3 });
    expect(r.code).toBe("CAP_STOP");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "claude-opus-5-5 " + a]);
    expect(readItem(s.record, "sm-labels").leases[0]!.close!.spent_micros).toBeLessThanOrEqual(500_000);
  });

  test("a packet whose worst case is over a reader's per-call allowance is an allowance stop for that reader only, sent nowhere and never again", async () => {
    const s = setup({ "sm-labels": 150 });
    const ids = labels(s, 2, (i) => (i === 0 ? "x".repeat(15_000) + "\n" : "A short issue.\n"));
    const big = ids.find((id) => readFileSync(join(s.packets, id + ".json"), "utf8").includes("xxxx"))!, small = ids.find((id) => id !== big)!;
    const calls: Call[] = [];
    const r = await send(s, "sm-labels", calls);
    expect([r.code, r.message]).toEqual(["ok", ""]);
    expect(sentTo(calls).sort()).toEqual(["claude-opus-5-5 " + big, "claude-opus-5-5 " + small, "gpt-6-astra " + small].sort());
    const stop = replies(s, "sm-labels").find((x) => x.packet === big && x.reader === "astra");
    expect([stop.outcome, stop.code, stop.answer]).toEqual(["allowance_stop", "E_ALLOWANCE", null]);
    expect(stop.why).toContain("allowance of $0.27");
    expect(replies(s, "sm-labels").find((x) => x.packet === big && x.reader === "opus").outcome).toBe("answered");
    expect(Math.max(...reserved(s, "sm-labels"))).toBeLessThanOrEqual(275_000);
    await send(s, "sm-labels", calls);
    expect(calls.length).toBe(3);
  });
});

describe("failures are recorded, never resent", () => {
  test("a malformed reply is recorded with E_SM_JUDGE_ANSWER after one ask, its raw text kept for packets read", async () => {
    const s = setup({ "sm-labels": 150 });
    const [a] = labels(s, 1) as [string];
    const fenced = "\u0060\u0060\u0060json\n" + LABEL + "\n\u0060\u0060\u0060";
    const calls: Call[] = [];
    const r = await send(s, "sm-labels", calls, (model) => ({ text: model === "gpt-6-astra" ? fenced : LABEL }));
    expect(r.code).toBe("ok");
    expect(r.result!.counts).toMatchObject({ answered: 1, malformed: 1 });
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "claude-opus-5-5 " + a]);
    const bad = replies(s, "sm-labels").find((x) => x.reader === "astra");
    expect([bad.outcome, bad.code, bad.answer]).toEqual(["malformed", "E_SM_JUDGE_ANSWER", null]);
    expect(bad.why).toContain("not one bare JSON object");
    expect(readFileSync(join(outDir(s, "sm-labels"), bad.raw), "utf8")).toBe(fenced);
    await send(s, "sm-labels", calls);
    expect(calls.length).toBe(2);
  });

  test("an upstream error stops the send and settles its reservation by the ledger's rules: released on a 4xx, held as unknown when the send is lost, and on a 5xx charged for each send the proxy's retry fits inside the call's allowance", async () => {
    const calls: Call[] = [];
    const four = setup({ "sm-labels": 150 });
    const [a, b] = labels(four, 2) as [string, string];
    const r4 = await send(four, "sm-labels", calls, (model, packet) => (model === "gpt-6-astra" && packet === a ? { status: 400 } : {}));
    expect(r4.code).toBe("UPSTREAM");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a]);
    expect(replies(four, "sm-labels").map((x) => [x.outcome, x.code])).toEqual([["upstream", "UPSTREAM"]]);
    expect(readItem(four.record, "sm-labels").leases[0]!.close).toMatchObject({ spent_micros: 0, unknown_micros: 0, unknown_calls: 0 });
    const resumed = await send(four, "sm-labels", calls);
    expect(resumed.code).toBe("ok");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "claude-opus-5-5 " + a, "gpt-6-astra " + b, "claude-opus-5-5 " + b]);

    const lost = setup({ "sm-labels": 150 });
    labels(lost, 1);
    const n = calls.length;
    expect((await send(lost, "sm-labels", calls, () => ({ throws: true }))).code).toBe("UPSTREAM");
    expect(calls.length - n).toBe(1);
    expect(readItem(lost.record, "sm-labels").leases[0]!.close).toMatchObject({ spent_micros: 0, unknown_micros: reserved(lost, "sm-labels")[0], unknown_calls: 1 });

    const five = setup({ "sm-labels": 150 });
    const [p5] = labels(five, 1) as [string];
    const m = calls.length;
    const r5 = await send(five, "sm-labels", calls, () => ({ status: 500 }));
    expect(r5.code).toBe("UPSTREAM");
    const charged = reserved(five, "sm-labels") as [number, number];
    expect([calls.length - m, charged.length]).toEqual([2, 2]);
    expect(charged[0] + charged[1]).toBeLessThanOrEqual(275_000);
    expect(3 * charged[0]).toBeGreaterThan(275_000);
    expect(replies(five, "sm-labels").map((x) => [x.outcome, x.code])).toEqual([["upstream", "UPSTREAM"]]);
    expect(readItem(five.record, "sm-labels").leases[0]!.close).toMatchObject({ spent_micros: charged[0] + charged[1], unknown_micros: 0 });
    await send(five, "sm-labels", calls);
    expect(sentTo(calls.slice(m))).toEqual(["gpt-6-astra " + p5, "gpt-6-astra " + p5, "claude-opus-5-5 " + p5]);
  });

  test("a call whose answer was never recorded is recorded as lost on the next send and never resent", async () => {
    const s = setup({ "sm-labels": 150 });
    const [a] = labels(s, 1) as [string];
    mkdirSync(outDir(s, "sm-labels"));
    appendFileSync(join(outDir(s, "sm-labels"), "replies.jsonl"), JSON.stringify({ item: "sm-labels", run_id: "run-1", event: "send", packet: a, reader: "astra", meter_id: "m-cut" }) + "\n");
    const calls: Call[] = [];
    expect((await send(s, "sm-labels", calls)).code).toBe("ok");
    expect(sentTo(calls)).toEqual(["claude-opus-5-5 " + a]);
    expect(replies(s, "sm-labels").find((x) => x.reader === "astra")).toMatchObject({ outcome: "lost", code: "UPSTREAM", answer: null });
  });
});

test("sm packets send is listed and refuses an item that is not sm-labels or sm-judges", async () => {
  const log = console.log, err = console.error;
  const out: string[] = [];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    expect(await main(["packets", "--help"])).toBe(0);
    expect(await main(["packets", "send", "--item", "sm-opus", "--run", "r", "--packets", tmpdir(), "--out", join(tmpdir(), "sm-send-none")])).toBe(2);
  } finally {
    console.log = log;
    console.error = err;
  }
  expect(out.join("\n")).toContain("packets send --item sm-labels|sm-judges");
  expect(out.join("\n")).toContain("E_USAGE");
});
