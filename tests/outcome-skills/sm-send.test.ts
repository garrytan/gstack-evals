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
import { JUDGE_ROUTE } from "../../src/adapters/judge.ts";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { openLease, reconcileLease, recordApproval, recordStop } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { priceRequest, reservationMicros } from "../../src/runner/pricing/prices.ts";

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

/** A judge packet whose diff fills the 1,500-line cut with lines of width bytes, with one key per session model named. */
function bigJudged(s: Setup, name: string, models: string[], width = 40): string {
  const p = "src/" + name + ".go";
  const diff = "diff --git a/" + p + " b/" + p + "\n--- a/" + p + "\n+++ b/" + p + "\n@@ -1,0 +1,1496 @@\n" + ("+" + "x".repeat(width - 1) + "\n").repeat(1496);
  const { packet, lines_total } = judgePacket({ diff, files: [p] });
  writeFileSync(join(s.packets, packet.packet + ".json"), JSON.stringify(packet, null, 1) + "\n");
  models.forEach((model, i) => writeFileSync(join(s.packets, packet.packet + "-" + i + ".key.json"), JSON.stringify(judgeKey(packet, { unit: "acme__" + name, model, cell: "A" + i, lines_total, stock: null }))));
  return packet.packet;
}

/** What the proxy's own formula reserves for the request it forwarded upstream. */
const proxyWorst = (c: Call) => {
  const provider = c.body.input ? "openai" : "anthropic";
  return reservationMicros(priceRequest(provider, c.body, 1500, JUDGE_ROUTE[provider]));
};

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
    const result = await sendPackets({ item, run_id: "run-1", packets: s.packets, out: outDir(s, item as Item), record: s.record, ledger: s.ledger, env: KEYS, fetch: upstream(calls, reply), sleep: async () => {}, requireAdmission: () => null, log: () => {}, ...extra });
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

  test("judges: two sessions whose diffs match share one packet, every key of it is checked, and each key's judge reads it once", async () => {
    const s = setup({ "sm-judges": 180 });
    const diff = "diff --git a/src/same.go b/src/same.go\n--- a/src/same.go\n+++ b/src/same.go\n@@ -3,0 +4,4 @@\n" + "+line\n".repeat(4);
    const { packet, lines_total } = judgePacket({ diff, files: ["src/a.go", "src/same.go"] });
    const key = (model: string, cell: string) => judgeKey(packet, { unit: "acme__same", model, cell, lines_total, stock: null });
    writeFileSync(join(s.packets, packet.packet + ".json"), JSON.stringify(packet, null, 1) + "\n");
    writeFileSync(join(s.packets, "opus-a1.key.json"), JSON.stringify(key("claude-opus-5-5", "A1")));
    writeFileSync(join(s.packets, "sol-a2.key.json"), JSON.stringify(key("openai/gpt-6.1-sol", "A2")));
    const calls: Call[] = [];
    const r = await send(s, "sm-judges", calls, () => ({ text: JUDGE }));
    expect([r.code, r.message]).toEqual(["ok", ""]);
    expect(sentTo(calls).sort()).toEqual(["claude-opus-5-5 " + packet.packet, "gpt-6-astra " + packet.packet]);

    const t = setup({ "sm-judges": 180 });
    writeFileSync(join(t.packets, packet.packet + ".json"), JSON.stringify(packet, null, 1) + "\n");
    writeFileSync(join(t.packets, "a-tampered.key.json"), JSON.stringify({ ...key("openai/gpt-6.1-sol", "A2"), judge: "openai/gpt-6-astra" }));
    writeFileSync(join(t.packets, "b-opus.key.json"), JSON.stringify(key("claude-opus-5-5", "A1")));
    const tampered = await send(t, "sm-judges", calls, () => ({ text: JUDGE }));
    expect([tampered.code, calls.length, readItem(t.record, "sm-judges").leases.length]).toEqual(["E_SM_PACKET", 2, 0]);
  });
});

describe("each call reserves its packet's byte worst case and runs alone", () => {
  test("a 1,500-line judge packet, refused before at the per-call price, now sends to both judges, each call reserving what the proxy's formula reserves for its request", async () => {
    const s = setup({ "sm-judges": 180 });
    const id = bigJudged(s, "big", ["claude-opus-5-5", "openai/gpt-6.1-sol"]);
    const calls: Call[] = [];
    const r = await send(s, "sm-judges", calls, () => ({ text: JUDGE }));
    expect([r.code, r.message]).toEqual(["ok", ""]);
    expect(sentTo(calls).sort()).toEqual(["claude-opus-5-5 " + id, "gpt-6-astra " + id]);
    const worst = calls.map(proxyWorst);
    expect(worst.map((w, i) => w > (calls[i]!.model === "gpt-6-astra" ? 275_000 : 110_000))).toEqual([true, true]);
    expect(reserved(s, "sm-judges")).toEqual(worst);
    expect(lines(s, "sm-judges").filter((l) => l.event === "send").map((l) => l.worst_micros)).toEqual(worst);
    expect(replies(s, "sm-judges").map((x) => x.outcome)).toEqual(["answered", "answered"]);
  });

  test("calls run one at a time: no call starts before the one before it settles", async () => {
    const s = setup({ "sm-labels": 150 });
    labels(s, 2);
    const calls: Call[] = [];
    let live = 0, peak = 0;
    const plain = upstream(calls, () => ({}));
    const r = await send(s, "sm-labels", calls, undefined, { fetch: async (url, init) => { peak = Math.max(peak, ++live); try { await Bun.sleep(5); return await plain(url, init); } finally { live--; } } });
    expect([r.code, calls.length, peak]).toEqual(["ok", 4, 1]);
  });

  test("a call whose byte worst case does not fit the item's remaining cap is refused before it is sent and cap-stops the item, never retried", async () => {
    const s = setup({ "sm-judges": 0.5 });
    const id = bigJudged(s, "big", ["claude-opus-5-5"]);
    const calls: Call[] = [];
    const r = await send(s, "sm-judges", calls, () => ({ text: JUDGE }));
    expect([r.code, calls.length]).toEqual(["CAP_STOP", 0]);
    expect(r.message).toContain(id);
    expect(replies(s, "sm-judges").map((x) => [x.packet, x.reader, x.outcome, x.code])).toEqual([[id, "astra", "cap_stop", "CAP_STOP"]]);
    const item = readItem(s.record, "sm-judges");
    expect(item.stops.map((x) => x.scope)).toEqual(["sm-judges only"]);
    expect(item.leases[0]!.close).toMatchObject({ spent_micros: 0, cap_stop: "sm-judges only" });
    const rerun = await send(s, "sm-judges", calls, () => ({ text: JUDGE }));
    expect([rerun.code, calls.length, readItem(s.record, "sm-judges").leases.length]).toEqual(["CAP_STOP", 0, 1]);
  });

  test("a call whose reported usage passes the prereg's bound of 20,000 input or 1,500 output tokens halts the item before the next send; a rerun is refused until --lift-halt records the Captain's ruling", async () => {
    const s = setup({ "sm-labels": 150 });
    const [a, b] = labels(s, 2, (i) => "x".repeat(30_000) + " (" + i + ").\n") as [string, string];
    const calls: Call[] = [];
    const over = (model: string, packet: string): Reply => (model === "gpt-6-astra" && packet === a ? { usage: { input: 20_001, output: 100 } } : {});
    const r = await send(s, "sm-labels", calls, over);
    expect(r.code).toBe("E_SM_USAGE_HALT");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a]);
    const sent = lines(s, "sm-labels").find((l) => l.event === "send");
    expect(lines(s, "sm-labels").find((l) => l.event === "halt")).toMatchObject({ packet: a, reader: "astra", meter_id: sent.meter_id, code: "E_SM_USAGE_HALT", usage: { input: 20_001, output: 100 } });
    expect(r.message).toContain(sent.meter_id);
    expect(replies(s, "sm-labels").map((x) => [x.packet, x.reader, x.outcome])).toEqual([[a, "astra", "answered"]]);
    const item = readItem(s.record, "sm-labels");
    expect([item.open, item.stops.length, item.leases[0]!.close!.how]).toEqual([null, 0, "settled"]);
    const file = join(outDir(s, "sm-labels"), "replies.jsonl");
    const full = readFileSync(file, "utf8");
    const answered = lines(s, "sm-labels").findIndex((l) => l.event === "reply" && l.packet === a && l.reader === "astra");
    writeFileSync(file, full.split("\n").slice(0, answered + 1).join("\n") + "\n");
    const cut = await send(s, "sm-labels", calls);
    expect([cut.code, calls.length]).toEqual(["E_SM_USAGE_HALT", 1]);
    writeFileSync(file, full);
    const again = await send(s, "sm-labels", calls);
    expect([again.code, calls.length]).toEqual(["E_SM_USAGE_HALT", 1]);
    expect(again.message).toContain("--lift-halt " + sent.meter_id);
    expect((await send(s, "sm-labels", calls, undefined, { lift_halts: ["m-none"] })).code).toBe("E_USAGE");
    const lifted = await send(s, "sm-labels", calls, undefined, { lift_halts: [sent.meter_id] });
    expect([lifted.code, lifted.message]).toEqual(["ok", ""]);
    expect(sentTo(calls.slice(1))).toEqual(["claude-opus-5-5 " + a, "gpt-6-astra " + b, "claude-opus-5-5 " + b]);
    expect(lines(s, "sm-labels").filter((l) => l.event === "lift").map((l) => l.meter_id)).toEqual([sent.meter_id]);

    const t = setup({ "sm-labels": 150 });
    labels(t, 1);
    const out = await send(t, "sm-labels", calls, (model) => (model === "gpt-6-astra" ? { usage: { input: 100, output: 1_501 } } : {}));
    expect([out.code, calls.length]).toEqual(["E_SM_USAGE_HALT", 5]);
  });
});

describe("one send per item and run", () => {
  test("while a send is live, a second send on its item is refused before it writes, recovers or opens anything, from the same --out or another", async () => {
    const s = setup({ "sm-labels": 150 });
    labels(s, 2);
    const calls: Call[] = [];
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((r) => (release = r)), inFlight = new Promise<void>((r) => (reached = r));
    const plain = upstream(calls, () => ({}));
    const first = send(s, "sm-labels", calls, undefined, { fetch: async (url, init) => (reached(), await gate, plain(url, init)) });
    await inFlight;
    const other: Call[] = [];
    const same = await send(s, "sm-labels", other);
    const elsewhere = await send(s, "sm-labels", other, undefined, { out: join(s.root, "out-elsewhere") });
    expect([same.code, elsewhere.code, other.length]).toEqual(["E_USAGE", "E_USAGE", 0]);
    expect(same.message).toContain("another send");
    expect(readItem(s.record, "sm-labels").open).not.toBeNull();
    release();
    const done = await first;
    expect([done.code, done.message]).toEqual(["ok", ""]);
    expect(replies(s, "sm-labels").map((x) => x.outcome)).toEqual(["answered", "answered", "answered", "answered"]);
    expect(readItem(s.record, "sm-labels").leases.map((l) => [l.close?.how, l.close?.unknown_micros])).toEqual([["settled", 0]]);
  });

  test("a replies file that does not name every call the ledger holds for the item and run is refused before any recovery or call: another --out, a send line lost in a crash, or a dead send's open lease", async () => {
    const s = setup({ "sm-labels": 150 });
    labels(s, 1);
    const calls: Call[] = [];
    expect((await send(s, "sm-labels", calls)).code).toBe("ok");
    const elsewhere = await send(s, "sm-labels", calls, undefined, { out: join(s.root, "out-elsewhere") });
    expect([elsewhere.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_USAGE", 2, 1]);
    expect(elsewhere.message).toContain(readItem(s.record, "sm-labels").leases[0]!.lease.lease_id);
    const file = join(outDir(s, "sm-labels"), "replies.jsonl");
    writeFileSync(file, readFileSync(file, "utf8").split("\n").filter((l) => !l.includes('"reader":"astra"')).join("\n"));
    const cut = await send(s, "sm-labels", calls);
    expect([cut.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_USAGE", 2, 1]);

    const d = setup({ "sm-labels": 150 });
    labels(d, 1);
    const local = openLocalLedger({ path: d.ledger, rule: "--ledger" });
    const lease = openLease(d.record, local, { item: "sm-labels", run_id: "run-1", requireAdmission: () => null });
    expect((await local.reserve({ idempotency_key: "k-dead", lease_id: lease.lease_id, cell: { run_id: "run-1", arm: "astra", task: "p", model: "gpt-6-astra", trial: 1, attempt: 1, meter_id: "m-dead" }, max_micros: 1_000 })).ok).toBe(true);
    local.close();
    const dead = await send(d, "sm-labels", calls);
    expect([dead.code, calls.length, readItem(d.record, "sm-labels").open?.lease_id]).toEqual(["E_USAGE", 2, lease.lease_id]);
    expect(dead.message).toContain("m-dead");
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
  test("a call whose byte worst case no longer fits the room left after earlier calls cap-stops the item: the stop is recorded, nothing more is sent, and a rerun is refused without a call", async () => {
    const s = setup({ "sm-judges": 1 });
    const [a, b] = [bigJudged(s, "big1", ["claude-opus-5-5"]), bigJudged(s, "big2", ["claude-opus-5-5"])].sort() as [string, string];
    const calls: Call[] = [];
    const r = await send(s, "sm-judges", calls, () => ({ text: JUDGE, usage: AT_BOUND }));
    expect(r.code).toBe("CAP_STOP");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a]);
    expect(replies(s, "sm-judges").map((x) => [x.packet, x.reader, x.outcome, x.code])).toEqual([[a, "astra", "answered", null], [b, "astra", "cap_stop", "CAP_STOP"]]);
    const item = readItem(s.record, "sm-judges");
    expect(item.stops.map((x) => x.scope)).toEqual(["sm-judges only"]);
    expect(item.leases[0]!.close).toMatchObject({ spent_micros: 275_000, cap_stop: "sm-judges only" });
    const rerun = await send(s, "sm-judges", calls, () => ({ text: JUDGE, usage: AT_BOUND }));
    expect([rerun.code, calls.length, readItem(s.record, "sm-judges").leases.length]).toEqual(["CAP_STOP", 1, 1]);
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

  test("an upstream error stops the send and settles its reservation by the ledger's rules: released on a 4xx, held as unknown when the send is lost, and on a 5xx charged once at the call's worst case, which is the whole of its allowance, so the proxy does not resend it", async () => {
    const calls: Call[] = [];
    const four = setup({ "sm-labels": 150 });
    const [a, b] = labels(four, 2) as [string, string];
    const r4 = await send(four, "sm-labels", calls, (model, packet) => (model === "gpt-6-astra" && packet === a ? { status: 400 } : {}));
    expect(r4.code).toBe("UPSTREAM");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a]);
    expect(replies(four, "sm-labels").map((x) => [x.outcome, x.code])).toEqual([["uncharged", "UPSTREAM"]]);
    expect(readItem(four.record, "sm-labels").leases[0]!.close).toMatchObject({ spent_micros: 0, unknown_micros: 0, unknown_calls: 0 });
    const resumed = await send(four, "sm-labels", calls);
    expect(resumed.code).toBe("ok");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "gpt-6-astra " + a, "claude-opus-5-5 " + a, "gpt-6-astra " + b, "claude-opus-5-5 " + b]);

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
    const charged = reserved(five, "sm-labels") as [number];
    expect([calls.length - m, charged]).toEqual([1, [proxyWorst(calls[m]!)]]);
    expect(replies(five, "sm-labels").map((x) => [x.outcome, x.code])).toEqual([["upstream", "UPSTREAM"]]);
    expect(readItem(five.record, "sm-labels").leases[0]!.close).toMatchObject({ spent_micros: charged[0], unknown_micros: 0 });
    await send(five, "sm-labels", calls);
    expect(sentTo(calls.slice(m))).toEqual(["gpt-6-astra " + p5, "claude-opus-5-5 " + p5]);
  });

  test("a failure with no answer and nothing charged is resent at most once: a second uncharged failure is recorded as a gap that keeps the first code, and no later send asks again; a charged 5xx and a call lost in transit are never resent", async () => {
    const s = setup({ "sm-labels": 150 });
    const [a] = labels(s, 1) as [string];
    const calls: Call[] = [];
    const deny = (model: string) => (model === "gpt-6-astra" ? { status: 401 } : {});
    expect((await send(s, "sm-labels", calls, deny)).code).toBe("UPSTREAM");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a]);
    expect(replies(s, "sm-labels").map((x) => [x.outcome, x.code])).toEqual([["uncharged", "UPSTREAM"]]);
    expect(readItem(s.record, "sm-labels").leases[0]!.close).toMatchObject({ spent_micros: 0, unknown_micros: 0, unknown_calls: 0 });
    expect((await send(s, "sm-labels", calls, deny)).code).toBe("UPSTREAM");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "gpt-6-astra " + a]);
    expect(replies(s, "sm-labels").map((x) => [x.outcome, x.code, x.first_code])).toEqual([["uncharged", "UPSTREAM", undefined], ["gap", "UPSTREAM", "UPSTREAM"]]);
    const third = await send(s, "sm-labels", calls, deny);
    expect([third.code, third.result?.counts.gap]).toEqual(["ok", 0]);
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + a, "gpt-6-astra " + a, "claude-opus-5-5 " + a]);
    expect((await send(s, "sm-labels", calls, deny)).result?.sent).toBe(0);

    const five = setup({ "sm-labels": 150 });
    const [p5] = labels(five, 1) as [string];
    const m = calls.length;
    expect((await send(five, "sm-labels", calls, () => ({ status: 500 }))).code).toBe("UPSTREAM");
    expect(replies(five, "sm-labels").map((x) => x.outcome)).toEqual(["upstream"]);
    await send(five, "sm-labels", calls);
    expect(sentTo(calls.slice(m))).toEqual(["gpt-6-astra " + p5, "claude-opus-5-5 " + p5]);

    const transit = setup({ "sm-labels": 150 });
    const [pt] = labels(transit, 1) as [string];
    const n = calls.length;
    expect((await send(transit, "sm-labels", calls, () => ({ throws: true }))).code).toBe("UPSTREAM");
    expect(replies(transit, "sm-labels").map((x) => x.outcome)).toEqual(["upstream"]);
    await send(transit, "sm-labels", calls);
    expect(sentTo(calls.slice(n))).toEqual(["gpt-6-astra " + pt, "claude-opus-5-5 " + pt]);
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

describe("pre-run fixes for #317's deferred findings", () => {
  // Value: protects=calls already paid for when a rerun names the same --run on a fresh local ledger (and a fresh --out): the record holds the run's lease, the fresh ledger does not, so the guard that asks the local ledger alone saw nothing to account for and the send went out again; fails_when=a send on a ledger that lacks a lease the item record holds for the run opens a lease or sends a call; why_new=#317 deferred outside-voice finding 1 (send.ts unnamed check), the Captain's pre-run list item 6; seam=send.ts sendHeld with two local ledgers on one record; no_claim=a send from another machine, which the same rule refuses
  test("a rerun with the same --run on a fresh --ledger is refused before it sends, because the record holds a lease that ledger lacks", async () => {
    const s = setup({ "sm-labels": 150 });
    labels(s, 1);
    const calls: Call[] = [];
    expect((await send(s, "sm-labels", calls)).code).toBe("ok");
    const fresh = await send(s, "sm-labels", calls, undefined, { ledger: join(s.root, "fresh.sqlite"), out: join(s.root, "out-fresh") });
    expect([fresh.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_USAGE", 2, 1]);
    expect(fresh.message).toContain(readItem(s.record, "sm-labels").leases[0]!.lease.lease_id);
    const sameOut = await send(s, "sm-labels", calls, undefined, { ledger: join(s.root, "fresh-2.sqlite") });
    expect([sameOut.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_USAGE", 2, 1]);
  });

  const reconciled = (s: Setup) => {
    const gone = openLocalLedger({ path: join(s.root, "gone.sqlite"), rule: "--ledger" });
    const lease = openLease(s.record, gone, { item: "sm-labels", run_id: "run-1", ttl_ms: 1_000, requireAdmission: () => null });
    gone.close();
    const source = join(s.root, "usage.csv");
    writeFileSync(source, "spent,1\n");
    reconcileLease(s.record, { lease_id: lease.lease_id, spent_micros: D, quotes: [quote], source, now: new Date(Date.now() + 60_000) });
    return { lease_id: lease.lease_id, source };
  };
  /** Writes the replies a dead send on lease_id left: a/astra answered, and with lost, b/astra sent and never answered. */
  const recorded = (s: Setup, a: string, b: string, lease_id: string | null, lost: boolean) => {
    mkdirSync(outDir(s, "sm-labels"), { recursive: true });
    const at = { item: "sm-labels", run_id: "run-1" };
    const rows = [
      ...(lease_id ? [{ ...at, event: "lease", lease_id }] : []),
      { ...at, event: "send", packet: a, reader: "astra", meter_id: "m-a" },
      { ...at, event: "reply", packet: a, reader: "astra", outcome: "answered", code: null, meter_id: "m-a" },
      ...(lost ? [{ ...at, event: "send", packet: b, reader: "astra", meter_id: "m-b" }] : []),
    ];
    writeFileSync(join(outDir(s, "sm-labels"), "replies.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };

  // Value: protects=calls already paid for when the run's lease was reconciled because its ledger is gone: the reconciled lease is exempt from the fresh-ledger refusal only when this --out's replies.jsonl records it (the lease line a send writes when it opens a lease), so every packet it answered or charged is known and none is asked again; fails_when=a reconciled lease lets a send on a fresh ledger go ahead from a missing replies file, or from one that does not record that lease, or the send that goes ahead asks again a call the replies record; why_new=the Captain's correction on #320 (item 6's reconciled exemption must not reopen OV1); seam=send.ts sendHeld with a lease opened on another local ledger and reconciled on the record; no_claim=the cap-stopped and drained items, which report CAP_STOP (the refusals test), and a lost call on the reconciled lease (the next test)
  test("a reconciled lease is exempt from the fresh-ledger refusal only when this --out's replies record it, and then nothing they record is asked again", async () => {
    for (const replies of ["missing", "unrecorded"] as const) {
      const m = setup({ "sm-labels": 150 });
      const [ma, mb] = labels(m, 2) as [string, string];
      const { lease_id } = reconciled(m);
      if (replies === "unrecorded") recorded(m, ma, mb, null, false);
      const none: Call[] = [];
      const refused = await send(m, "sm-labels", none, undefined, { ledger: join(m.root, "fresh.sqlite") });
      expect([replies, refused.code, none.length, readItem(m.record, "sm-labels").leases.length]).toEqual([replies, "E_USAGE", 0, 1]);
      expect(refused.message).toContain(lease_id);
    }

    const s = setup({ "sm-labels": 150 });
    const [a, b] = labels(s, 2) as [string, string];
    recorded(s, a, b, reconciled(s).lease_id, false);
    const calls: Call[] = [];
    const ok = await send(s, "sm-labels", calls, undefined, { ledger: join(s.root, "fresh.sqlite") });
    expect([ok.code, ok.message]).toEqual(["ok", ""]);
    expect(sentTo(calls)).toEqual(["claude-opus-5-5 " + a, "gpt-6-astra " + b, "claude-opus-5-5 " + b]);
    expect(replies(s, "sm-labels").map((x) => [x.packet, x.reader, x.outcome])).toEqual([[a, "astra", "answered"], [a, "opus", "answered"], [b, "astra", "answered"], [b, "opus", "answered"]]);
    expect(lines(s, "sm-labels").filter((l) => l.event === "halt")).toEqual([]);
    const leases = readItem(s.record, "sm-labels").leases.map((x) => x.lease.lease_id);
    expect(lines(s, "sm-labels").filter((l) => l.event === "lease").map((l) => l.lease_id)).toEqual(leases);
  });

  // Value: protects=the usage halt for a call whose usage no ledger can show: a call sent on a lease the owner reconciled (its ledger gone) and never answered has unknown usage, so the next send halts the item (E_SM_USAGE_HALT, usage unknown) and names the lease's proxy journal and the provider export the reconcile cites, which the Captain reads before ruling; fails_when=the send records the call as lost and goes on sending, the halt or its message omits the journal or the export, a send without the lift goes ahead, or the lifted call is sent again; why_new=Capy's review of 7191a4f on #320 and the Captain's pick A (GSTA-2, 2026-11-11); seam=send.ts sendHeld's lost-call recovery with a lease opened on another local ledger and reconciled on the record; no_claim=what the journal or export shows, which the Captain reads
  test("a lost call on a reconciled lease halts the item as usage unknown, naming the lease's proxy journal and the export the reconcile cites, and after the lift it stays lost, never resent", async () => {
    const s = setup({ "sm-labels": 150 });
    const [a, b] = labels(s, 2) as [string, string];
    const { lease_id, source } = reconciled(s);
    recorded(s, a, b, lease_id, true);
    const journal = join(outDir(s, "sm-labels"), lease_id + ".journal.ndjson");
    const fresh = { ledger: join(s.root, "fresh.sqlite") };
    const calls: Call[] = [];
    const halted = await send(s, "sm-labels", calls, undefined, fresh);
    expect([halted.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_SM_USAGE_HALT", 0, 1]);
    for (const part of ["usage unknown", "--lift-halt m-b", journal, source]) expect(halted.message).toContain(part);
    expect(lines(s, "sm-labels").filter((l) => l.event === "halt")).toEqual([expect.objectContaining({ packet: b, reader: "astra", meter_id: "m-b", code: "E_SM_USAGE_HALT", usage: null, lease_id, journal, source })]);
    expect(replies(s, "sm-labels").map((x) => [x.packet, x.reader, x.outcome])).toEqual([[a, "astra", "answered"], [b, "astra", "lost"]]);
    const again = await send(s, "sm-labels", calls, undefined, fresh);
    expect([again.code, calls.length]).toEqual(["E_SM_USAGE_HALT", 0]);
    for (const part of ["usage unknown", journal, source]) expect(again.message).toContain(part);
    const lifted = await send(s, "sm-labels", calls, undefined, { ...fresh, lift_halts: ["m-b"] });
    expect([lifted.code, lifted.message]).toEqual(["ok", ""]);
    expect(sentTo(calls)).toEqual(["claude-opus-5-5 " + a, "claude-opus-5-5 " + b]);
    expect(lines(s, "sm-labels").filter((l) => l.event === "halt").length).toBe(1);
  });

  // Value: protects=the usage halt across a crash after the call settles: a send whose reply and halt never reached replies.jsonl but whose settled usage passes 20,000 input or 1,500 output tokens becomes a standing halt at the next send, before any lease opens; fails_when=the next send records the call as lost and goes on sending; why_new=#317 deferred outside-voice finding 2, the Captain's pre-run list item 7; seam=send.ts sendHeld's lost-call recovery, with replies.jsonl cut after the call's send line; no_claim=a call whose usage the ledger never settled, which stays lost at its full reservation
  test("a call that settled past the bound but whose halt and reply a crash lost halts the item at the next send, and after the lift it stays lost, never resent", async () => {
    const s = setup({ "sm-labels": 150 });
    const [a, b] = labels(s, 2, (i) => "x".repeat(30_000) + " (" + i + ").\n") as [string, string];
    const calls: Call[] = [];
    const over = (model: string, packet: string): Reply => (model === "gpt-6-astra" && packet === a ? { usage: { input: 20_001, output: 100 } } : {});
    expect((await send(s, "sm-labels", calls, over)).code).toBe("E_SM_USAGE_HALT");
    const file = join(outDir(s, "sm-labels"), "replies.jsonl");
    const all = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const sendAt = all.findIndex((l) => JSON.parse(l).event === "send");
    const meter = JSON.parse(all[sendAt]!).meter_id as string;
    writeFileSync(file, all.slice(0, sendAt + 1).join("\n") + "\n");
    const rerun = await send(s, "sm-labels", calls);
    expect([rerun.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_SM_USAGE_HALT", 1, 1]);
    expect(rerun.message).toContain("--lift-halt " + meter);
    expect(lines(s, "sm-labels").filter((l) => l.event === "halt")).toEqual([expect.objectContaining({ packet: a, reader: "astra", meter_id: meter, code: "E_SM_USAGE_HALT", usage: { input: 20_001, output: 100 } })]);
    expect(replies(s, "sm-labels").map((x) => [x.packet, x.reader, x.outcome])).toEqual([[a, "astra", "lost"]]);
    expect([(await send(s, "sm-labels", calls)).code, calls.length]).toEqual(["E_SM_USAGE_HALT", 1]);
    const lifted = await send(s, "sm-labels", calls, undefined, { lift_halts: [meter] });
    expect([lifted.code, lifted.message]).toEqual(["ok", ""]);
    expect(sentTo(calls.slice(1))).toEqual(["claude-opus-5-5 " + a, "gpt-6-astra " + b, "claude-opus-5-5 " + b]);
    expect(lines(s, "sm-labels").filter((l) => l.event === "halt").length).toBe(1);
  });

  // Value: protects=the usage halt for a call whose usage no ledger settled: a lost call on a lease this ledger holds, whose meter shows the call unknown, halts the item as usage unknown and names the lease and its proxy journal, while a lost call with no meter on the lease never reached its reservation and stays unhalted; fails_when=the unknown call is written off as lost and the send goes on, its halt names no lease or journal, or the call with no meter halts; why_new=the Red Team's finding on #320 (send.ts:292), the Captain's ruling B2 (GSTA-2, 2026-11-11); seam=sendPackets with a fetch that throws, then replies.jsonl cut after the send line; no_claim=what a real provider bills for an unanswered call
  test("a lost call on a lease this ledger holds halts as usage unknown when its meter shows the call unknown, naming the lease and its proxy journal, and a lost call with no meter on the lease stays unhalted", async () => {
    const s = setup({ "sm-labels": 150 });
    const [a, c] = labels(s, 2) as [string, string];
    const calls: Call[] = [];
    expect((await send(s, "sm-labels", calls, () => ({ throws: true }))).code).toBe("UPSTREAM");
    const file = join(outDir(s, "sm-labels"), "replies.jsonl");
    const all = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const sendAt = all.findIndex((l) => JSON.parse(l).event === "send");
    const meter = JSON.parse(all[sendAt]!).meter_id as string;
    const none = { item: "sm-labels", run_id: "run-1", event: "send", packet: c, reader: "astra", meter_id: "m-none" };
    writeFileSync(file, [...all.slice(0, sendAt + 1), JSON.stringify(none)].join("\n") + "\n");
    const lease_id = readItem(s.record, "sm-labels").leases[0]!.lease.lease_id;
    const journal = join(outDir(s, "sm-labels"), lease_id + ".journal.ndjson");
    const rerun = await send(s, "sm-labels", calls);
    expect([rerun.code, calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_SM_USAGE_HALT", 1, 1]);
    for (const part of ["usage unknown", lease_id, journal, "--lift-halt " + meter]) expect(rerun.message).toContain(part);
    expect(rerun.message).not.toContain("m-none");
    expect(lines(s, "sm-labels").filter((l) => l.event === "halt")).toEqual([expect.objectContaining({ packet: a, reader: "astra", meter_id: meter, code: "E_SM_USAGE_HALT", usage: null, lease_id, journal })]);
    expect(replies(s, "sm-labels").map((x) => [x.packet, x.reader, x.outcome])).toEqual([[a, "astra", "lost"], [c, "astra", "lost"]]);
  });

  // Value: protects=the cap stop's place first: an item that can't lease (cap-stopped or no cap left) whose run lease this ledger lacks is refused CAP_STOP before the send writes any lift, recovery or lost-reply line, so a later send on the right ledger still sees every lost call; fails_when=the send writes a lift or a lost reply before CAP_STOP, or returns ok; why_new=the Red Team's finding on #320 (send.ts:268), the Captain's ruling C (GSTA-2, 2026-11-11); seam=sendPackets on a fresh --ledger against a drained item with a reconciled lease whose lease line is missing; no_claim=none beyond protects
  test("an item that can't lease, with a run lease this ledger lacks, is CAP_STOP before any lift, recovery or lost-reply line is written", async () => {
    const s = setup({ "sm-labels": 1 });
    const [a, b] = labels(s, 2) as [string, string];
    reconciled(s);
    recorded(s, a, b, null, true);
    const file = join(outDir(s, "sm-labels"), "replies.jsonl");
    appendFileSync(file, JSON.stringify({ item: "sm-labels", run_id: "run-1", event: "halt", packet: b, reader: "astra", meter_id: "m-b", code: "E_SM_USAGE_HALT", why: "a test halt" }) + "\n");
    const before = readFileSync(file, "utf8");
    const calls: Call[] = [];
    const r = await send(s, "sm-labels", calls, undefined, { ledger: join(s.root, "fresh.sqlite"), lift_halts: ["m-b"] });
    expect([r.code, calls.length]).toEqual(["CAP_STOP", 0]);
    expect(r.message).toContain("$0.00 left");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  // Value: protects=replies.jsonl as the send's record: a line that won't parse is refused, unless it is the torn tail a crash left at the end, which the next send marks with a torn line so later sends read past it; fails_when=an unparseable line in the middle is dropped silently (so its reply reads as missing), or a torn tail blocks the send or any later send; why_new=the Captain's pre-run list item 8 (send.ts catch {}); seam=send.ts sendHeld's reader and write; no_claim=a file someone edited by hand into valid JSON
  test("a replies line that won't parse is refused unless it is the torn tail a crash left, which the next send marks so later sends read past it", async () => {
    const m = setup({ "sm-labels": 150 });
    labels(m, 2);
    const calls: Call[] = [];
    expect([(await send(m, "sm-labels", calls)).code, calls.length]).toEqual(["ok", 4]);
    const mfile = join(outDir(m, "sm-labels"), "replies.jsonl");
    const parts = readFileSync(mfile, "utf8").split("\n");
    const mid = parts.findIndex((l) => l.includes('"event":"reply"'));
    parts[mid] = parts[mid]!.slice(0, 40);
    writeFileSync(mfile, parts.join("\n"));
    const bad = await send(m, "sm-labels", calls);
    expect([bad.code, calls.length]).toEqual(["E_USAGE", 4]);
    expect(bad.message).toContain("line " + (mid + 1));
    expect(readFileSync(mfile, "utf8")).toBe(parts.join("\n"));

    const s = setup({ "sm-labels": 150 });
    labels(s, 2);
    const more: Call[] = [];
    mkdirSync(outDir(s, "sm-labels"));
    const file = join(outDir(s, "sm-labels"), "replies.jsonl");
    const torn = '{"item":"sm-labels","run_id":"run-1","event":"se';
    writeFileSync(file, torn);
    expect([(await send(s, "sm-labels", more)).code, more.length]).toEqual(["ok", 4]);
    const after = readFileSync(file, "utf8").split("\n");
    expect(after[0]).toBe(torn);
    expect(JSON.parse(after[1]!)).toMatchObject({ item: "sm-labels", run_id: "run-1", event: "torn" });
    expect([(await send(s, "sm-labels", more)).code, more.length]).toEqual(["ok", 4]);
  });

  // Value: protects=the packets dir as the send's whole input: a key whose packet is missing is refused before anything is opened, as a packet with no key already is; fails_when=the send skips the orphan key and spends on the rest; why_new=the Captain's pre-run list item 9; seam=send.ts loadPackets; no_claim=why a packet went missing
  test("a key whose packet is missing is refused before anything is opened", async () => {
    const s = setup({ "sm-labels": 150 });
    const [id] = labels(s, 1) as [string];
    const key = JSON.parse(readFileSync(join(s.packets, id + ".key.json"), "utf8"));
    writeFileSync(join(s.packets, "orphan.key.json"), JSON.stringify({ ...key, packet: "0123456789abcdef" }));
    const calls: Call[] = [];
    const r = await send(s, "sm-labels", calls);
    expect([r.code, r.message.includes("0123456789abcdef"), calls.length, readItem(s.record, "sm-labels").leases.length]).toEqual(["E_SM_PACKET", true, 0, 0]);
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
