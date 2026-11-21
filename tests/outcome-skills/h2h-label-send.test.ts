// Copyright (c) 2026 Garry Tan. MIT License.
// The paid sender for the B1 browser-only label (h2h/breadth/label-send.ts) on the state machines sender: two calls per
// unit on sm-labels' routes, the label packet as the one user message, the both-yes rule written to unit.json, agreement,
// and the sender's stop rules (cap stop, upstream failure, uncharged resend, resume). On a temporary ledger with a stub
// upstream behind the real metering proxy; no key, no paid call.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/outcome-skills/h2h/cli.ts";
import { LABEL_ITEM, sendLabels, type LabelSendOptions } from "../../lanes/outcome-skills/h2h/breadth/label-send.ts";
import { agreement, LABEL_MODELS, labelPacket, type LabelRow } from "../../lanes/outcome-skills/h2h/breadth/label.ts";
import { candidateOf, writeBUnit } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import { isDrop, testPlan, type TestPlan } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";
import { readUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../src/runner/proxy/metering-proxy.ts";

const D = 1_000_000;
const KEYS = { OPENAI_API_KEY: "fake-openai-value-for-h2h-label-send-tests", ANTHROPIC_API_KEY: "fake-anthropic-value-for-h2h-label-send-tests" };
const quote = { words: "test words", by: "test", source: "h2h-label-send.test.ts" };
const YES = "Yes.\nThe focus ring is drawn by the browser.", NO = "No. jsdom shows it too.";
const [ASTRA, OPUS] = LABEL_MODELS;
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

type Setup = { root: string; record: string; ledger: string; out: string; units: string; dirs: string[]; byText: Map<string, string> };
type Call = { model: string; unit: string; body: any };
type Reply = { status?: number; text?: string; usage?: { input: number; output: number }; throws?: boolean };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** One planted B1 unit dir per issue number, its id acme__web-<n>. */
function plant(root: string, n: number): string {
  const c = candidateOf("B1", { repo: "acme/web", number: n, url: "u", merged: "2026-06-02", month: "2026-06", window: "primary", licence: "MIT", second_read_pending: false, licence_from: "graphql", runners: ["playwright"], fix: { commit: "e".repeat(40), parent: "d".repeat(40) }, files: { browser_test: 1, test: 1, source: 1, total: 2 }, issue_url: "https://github.com/acme/web/issues/" + n, statement_sha256: "0".repeat(64), statement_chars: 300 });
  const plan = testPlan("playwright", ["e2e/focus.spec.ts"], { files: ["package.json"], texts: {} });
  if (isDrop(plan)) throw new Error("plan");
  const dir = join(root, c.id);
  writeBUnit(dir, {
    c, lang: "ts", plan: plan as TestPlan, statement: "Focus ring disappears after dialog " + n + " closes.\n",
    patches: { fix: "diff --git a/src/focus.ts b/src/focus.ts\n+restore(" + n + ")\n", test: "diff --git a/e2e/focus.spec.ts b/e2e/focus.spec.ts\n+test('focus')\n", all: ["e2e/focus.spec.ts", "src/focus.ts"], testFiles: ["e2e/focus.spec.ts"], fixFiles: ["src/focus.ts"], sourceFiles: ["src/focus.ts"] },
    tests: { f2p: ["[chromium]::focus.spec.ts::focus.spec.ts::::focus"], p2p: ["[chromium]::focus.spec.ts::focus.spec.ts::::opens"] },
    h2h: { kind: "B1", image_ref: "127.0.0.1:5000/h2h@sha256:" + "f".repeat(64), runner: "playwright", format: "junit-playwright", ecosystem: "npm", licence: "MIT", second_read_pending: false, statement_sha256: "0".repeat(64), build: { image_id: "sha256:" + "1".repeat(64), dockerfile_sha256: "2".repeat(64) } },
  });
  return dir;
}

/** A record with an h2h program and h2h-labels at its cap in dollars, n planted B1 units and a units file that lists them
 *  by relative path. */
function setup(cap: number, n: number): Setup {
  const root = mkdtempSync(join(tmpdir(), "h2h-label-send-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "h2h", cap_micros: 100 * D, skill_cap_micros: 100 * D, skills: ["h2h"], credit_rate_micros: D, quotes: [quote] });
  recordApproval(record, { action: "init", item: LABEL_ITEM, cap_micros: Math.round(cap * D), quotes: [quote], admission: "required", program: "h2h", skills: ["h2h"] });
  const dirs = Array.from({ length: n }, (_, i) => plant(join(root, "units"), i + 1));
  const s: Setup = { root, record, ledger: join(root, "ledger.sqlite"), out: join(root, "out"), units: join(root, "units.txt"), dirs, byText: new Map() };
  list(s, dirs);
  return s;
}

const list = (s: Setup, dirs: string[]) => {
  writeFileSync(s.units, dirs.map((d) => d.slice(s.root.length + 1)).join("\n") + "\n\n");
  for (const d of dirs) s.byText.set(labelPacket(d).text, readUnit(d).id);
};
const id = (dir: string) => readUnit(dir).id;

/** A fake provider behind the proxy that names each call by the unit whose packet is its one user message. */
const upstream = (s: Setup, calls: Call[], reply: (model: string, unit: string) => Reply) => async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const unit = s.byText.get((body.input ?? body.messages)[0].content) ?? "unknown";
  calls.push({ model: body.model, unit, body });
  const r = reply(body.model, unit);
  if (r.throws) throw new Error("connection reset by peer");
  if (r.status !== undefined && r.status !== 200) return Response.json({ error: { type: "server_error", message: "no" } }, { status: r.status });
  const u = r.usage ?? { input: 1_000, output: 100 };
  const text = r.text ?? YES;
  return body.input
    ? Response.json({ id: "r", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: u.input, input_tokens_details: { cached_tokens: 0 }, output_tokens: u.output, output_tokens_details: { reasoning_tokens: 0 } } })
    : Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: u.input, output_tokens: u.output } });
};

async function send(s: Setup, calls: Call[], reply: (model: string, unit: string) => Reply = () => ({}), extra: Partial<LabelSendOptions> = {}) {
  const printed: string[] = [];
  try {
    const result = await sendLabels({ run_id: "run-1", units: s.units, out: s.out, record: s.record, ledger: s.ledger, env: KEYS, fetch: upstream(s, calls, reply), sleep: async () => {}, requireAdmission: () => null, log: () => {}, print: (l) => printed.push(l), ...extra });
    return { code: "ok", message: "", result, printed };
  } catch (e) {
    const message = (e as Error).message;
    return { code: message.split(" ")[0]!, message, result: null, printed };
  }
}
const lines = (s: Setup) => readFileSync(join(s.out, "replies.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const replies = (s: Setup) => lines(s).filter((l) => l.event === "reply");
const sentTo = (calls: Call[]) => calls.map((c) => c.model + " " + c.unit);
const label = (dir: string) => (readUnit(dir).labels as { browser_only?: LabelRow } | null)?.browser_only ?? null;
const agreed = (s: Setup) => JSON.parse(readFileSync(join(s.out, "agreement.json"), "utf8"));

describe("each unit gets two calls and its label", () => {
  test("both yes: Astra then Opus on sm-labels' routes, the packet text as the one user message, and the unit is in", async () => {
    const s = setup(54, 1);
    const [dir] = s.dirs as [string];
    const u = id(dir);
    const calls: Call[] = [];
    const r = await send(s, calls);
    expect([r.code, r.message]).toEqual(["ok", ""]);
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + u, "claude-opus-5-5 " + u]);
    const packet = labelPacket(dir);
    const astra = calls[0]!.body;
    expect([astra.reasoning, astra.max_output_tokens, astra.store, astra.tools, astra.input.length, astra.input[0].content]).toEqual([{ effort: "medium" }, DEFAULT_MAX_OUTPUT_TOKENS, false, undefined, 1, packet.text]);
    const opus = calls[1]!.body;
    expect([opus.max_tokens, opus.system, opus.tools, opus.thinking, opus.messages.length, opus.messages[0].content]).toEqual([DEFAULT_MAX_OUTPUT_TOKENS, undefined, undefined, undefined, 1, packet.text]);
    const row: LabelRow = { id: u, packet_sha256: packet.sha256, answers: { [ASTRA]: "yes", [OPUS]: "yes" }, reply_sha256: { [ASTRA]: sha(YES), [OPUS]: sha(YES) }, in: true };
    expect(label(dir)).toEqual(row);
    expect(agreed(s)).toEqual(agreement([row]));
    expect(r.printed).toEqual([JSON.stringify(agreement([row]))]);
    expect(lines(s).filter((l) => l.event === "send").map((l) => l.packet_sha256)).toEqual([packet.sha256, packet.sha256]);
    expect(replies(s).map((x) => [x.packet, x.reader, x.model, x.outcome, x.answer])).toEqual([[u, "astra", "openai/gpt-6-astra", "answered", "yes"], [u, "opus", "anthropic/claude-opus-5-5", "answered", "yes"]]);
    const item = readItem(s.record, LABEL_ITEM);
    expect([item.open, item.leases.length, item.stops.length]).toEqual([null, 1, 0]);
    expect(item.leases[0]!.close).toMatchObject({ how: "settled", spent_micros: 1_000 * 10 + 100 * 50 + 1_000 * 4 + 100 * 20, unknown_micros: 0 });
    expect(r.result).toMatchObject({ item: LABEL_ITEM, sent: 2, counts: { answered: 2, malformed: 0, cap_stop: 0, upstream: 0 } });
    const again = await send(s, calls);
    expect([again.code, calls.length, readItem(s.record, LABEL_ITEM).leases.length, again.printed]).toEqual(["ok", 2, 1, r.printed]);
  });

  test("one no: the unit is out", async () => {
    const s = setup(54, 1);
    const [dir] = s.dirs as [string];
    const r = await send(s, [], (model) => ({ text: model === "claude-opus-5-5" ? NO : YES }));
    expect(r.code).toBe("ok");
    expect(label(dir)).toMatchObject({ answers: { [ASTRA]: "yes", [OPUS]: "no" }, reply_sha256: { [OPUS]: sha(NO) }, in: false });
    expect(agreed(s)).toMatchObject({ units: 1, both_yes: 0, split: 1, unclear: 0 });
  });

  test("unclear: a reply whose first word is neither yes nor no is a recorded answer that counts as not yes, never malformed and never asked again", async () => {
    const s = setup(54, 2);
    const [d1, d2] = s.dirs as [string, string];
    const calls: Call[] = [];
    const r = await send(s, calls, (model, unit) => ({ text: model === "claude-opus-5-5" && unit === id(d2) ? "Probably, since layout is involved." : YES }));
    expect(r.code).toBe("ok");
    expect(r.result!.counts).toMatchObject({ answered: 4, malformed: 0 });
    expect(replies(s).find((x) => x.packet === id(d2) && x.reader === "opus")).toMatchObject({ outcome: "answered", code: null, answer: "unclear" });
    expect(label(d2)).toMatchObject({ answers: { [ASTRA]: "yes", [OPUS]: "unclear" }, in: false });
    expect(label(d1)!.in).toBe(true);
    expect(agreed(s)).toEqual(agreement([label(d1)!, label(d2)!]));
    expect(agreed(s)).toMatchObject({ units: 2, both_yes: 1, split: 1, unclear: 1 });
    const again = await send(s, calls);
    expect([again.code, again.result!.sent, calls.length]).toEqual(["ok", 0, 4]);
  });
});

describe("the sender's stop rules hold for labels", () => {
  test("a cap stop: the call that no longer fits is refused before it is sent, nothing more goes out, the item admits no new lease, and usage past any bound halts nothing", async () => {
    const s = setup(3, 2);
    const [d1, d2] = s.dirs as [string, string];
    const calls: Call[] = [];
    const r = await send(s, calls, () => ({ text: YES, usage: { input: 30_000, output: 30_000 } }));
    expect(r.code).toBe("CAP_STOP");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + id(d1), "claude-opus-5-5 " + id(d1)]);
    expect(replies(s).map((x) => [x.packet, x.reader, x.outcome, x.code])).toEqual([[id(d1), "astra", "answered", null], [id(d1), "opus", "answered", null], [id(d2), "astra", "cap_stop", "CAP_STOP"]]);
    expect(lines(s).filter((l) => l.event === "halt")).toEqual([]);
    const item = readItem(s.record, LABEL_ITEM);
    expect(item.stops.map((x) => x.scope)).toEqual([LABEL_ITEM + " only"]);
    expect(item.leases[0]!.close).toMatchObject({ cap_stop: LABEL_ITEM + " only" });
    expect([label(d1)!.in, label(d2)]).toEqual([true, null]);
    expect(agreed(s)).toMatchObject({ units: 1, both_yes: 1 });
    const rerun = await send(s, calls);
    expect([rerun.code, calls.length, readItem(s.record, LABEL_ITEM).leases.length]).toEqual(["CAP_STOP", 2, 1]);
  });

  test("an upstream failure stops the send and is never resent; the unit it hit gets no label and the next send goes on", async () => {
    const s = setup(54, 2);
    const [d1, d2] = s.dirs as [string, string];
    const calls: Call[] = [];
    const r = await send(s, calls, (model, unit) => (model === "gpt-6-astra" && unit === id(d1) ? { status: 500 } : {}));
    expect(r.code).toBe("UPSTREAM");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + id(d1)]);
    expect(replies(s).map((x) => [x.outcome, x.code])).toEqual([["upstream", "UPSTREAM"]]);
    expect(readItem(s.record, LABEL_ITEM).leases[0]!.close!.spent_micros).toBeGreaterThan(0);
    const resumed = await send(s, calls);
    expect(resumed.code).toBe("ok");
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + id(d1), "claude-opus-5-5 " + id(d1), "gpt-6-astra " + id(d2), "claude-opus-5-5 " + id(d2)]);
    expect([label(d1), label(d2)!.in]).toEqual([null, true]);
    expect(agreed(s)).toMatchObject({ units: 1 });
  });

  test("an uncharged call is resent once, then recorded as a gap that keeps the first code and is never asked again", async () => {
    const s = setup(54, 1);
    const [dir] = s.dirs as [string];
    const u = id(dir);
    const calls: Call[] = [];
    const deny = (model: string) => (model === "gpt-6-astra" ? { status: 401 } : {});
    expect((await send(s, calls, deny)).code).toBe("UPSTREAM");
    expect(replies(s).map((x) => [x.outcome, x.code])).toEqual([["uncharged", "UPSTREAM"]]);
    expect(readItem(s.record, LABEL_ITEM).leases[0]!.close).toMatchObject({ spent_micros: 0, unknown_micros: 0 });
    expect((await send(s, calls, deny)).code).toBe("UPSTREAM");
    expect(replies(s).map((x) => [x.outcome, x.code, x.first_code])).toEqual([["uncharged", "UPSTREAM", undefined], ["gap", "UPSTREAM", "UPSTREAM"]]);
    const third = await send(s, calls, deny);
    expect([third.code, third.result!.counts.gap]).toEqual(["ok", 0]);
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + u, "gpt-6-astra " + u, "claude-opus-5-5 " + u]);
    expect((await send(s, calls, deny)).result!.sent).toBe(0);
    expect(label(dir)).toBeNull();
  });

  test("a resumed send skips every call already sent: answered ones, and one whose answer a stopped send never recorded, which is lost and halts nothing", async () => {
    const s = setup(54, 3);
    const [d1, d2, d3] = s.dirs as [string, string, string];
    list(s, [d1]);
    const calls: Call[] = [];
    expect((await send(s, calls)).code).toBe("ok");
    list(s, [d1, d2, d3]);
    appendFileSync(join(s.out, "replies.jsonl"), JSON.stringify({ item: LABEL_ITEM, run_id: "run-1", event: "send", packet: id(d2), reader: "astra", meter_id: "m-cut", packet_sha256: labelPacket(d2).sha256 }) + "\n");
    const r = await send(s, calls);
    expect([r.code, r.message]).toEqual(["ok", ""]);
    expect(sentTo(calls)).toEqual(["gpt-6-astra " + id(d1), "claude-opus-5-5 " + id(d1), "claude-opus-5-5 " + id(d2), "gpt-6-astra " + id(d3), "claude-opus-5-5 " + id(d3)]);
    expect(replies(s).find((x) => x.packet === id(d2) && x.reader === "astra")).toMatchObject({ outcome: "lost", code: "UPSTREAM", answer: null });
    expect(lines(s).filter((l) => l.event === "halt")).toEqual([]);
    expect([label(d1)!.in, label(d2), label(d3)!.in]).toEqual([true, null, true]);
    expect(agreed(s)).toMatchObject({ units: 2, both_yes: 2 });
    expect((await send(s, calls)).result!.sent).toBe(0);
  });
});

describe("refusals before anything is opened", () => {
  test("a missing or empty units file, a unit that is not B1, a unit listed twice and a packet changed since its call was sent are E_H2H_LABEL_INPUT", async () => {
    const s = setup(54, 2);
    const [d1, d2] = s.dirs as [string, string];
    const calls: Call[] = [];
    expect((await send(s, calls, () => ({}), { units: join(s.root, "none.txt") })).code).toBe("E_H2H_LABEL_INPUT");
    writeFileSync(join(s.root, "empty.txt"), "\n");
    expect((await send(s, calls, () => ({}), { units: join(s.root, "empty.txt") })).code).toBe("E_H2H_LABEL_INPUT");
    list(s, [d1, d1]);
    expect((await send(s, calls)).message).toContain("twice");
    const other = join(s.root, "other");
    mkdirSync(other);
    const b2 = plant(other, 9);
    writeFileSync(join(b2, "unit.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(b2, "unit.json"), "utf8")), source: "h2h-b2" }));
    list(s, [d1, b2]);
    expect((await send(s, calls)).message).toContain("not a B1 unit");
    expect([calls.length, readItem(s.record, LABEL_ITEM).leases.length]).toEqual([0, 0]);

    list(s, [d1, d2]);
    expect((await send(s, calls, (model, unit) => (model === "claude-opus-5-5" && unit === id(d2) ? { status: 500 } : {}))).code).toBe("UPSTREAM");
    const before = labelPacket(d1).sha256;
    expect(label(d1)!.packet_sha256).toBe(before);
    const u = JSON.parse(readFileSync(join(d1, "unit.json"), "utf8"));
    writeFileSync(join(d1, "unit.json"), JSON.stringify({ ...u, tests: { ...u.tests, f2p: ["[chromium]::focus.spec.ts::focus.spec.ts::::other"] } }));
    expect(labelPacket(d1).sha256).not.toBe(before);
    const changed = await send(s, calls);
    expect([changed.code, changed.message.includes(id(d1) + " is now sha256"), calls.length, readItem(s.record, LABEL_ITEM).leases.length]).toEqual(["E_H2H_LABEL_INPUT", true, 4, 1]);
    expect(label(d1)!.packet_sha256).toBe(before);
  });

  test("h2h label-send is wired in the h2h command table and refuses a missing flag", async () => {
    const err = console.error;
    const out: string[] = [];
    console.error = (...a: unknown[]) => void out.push(a.join(" "));
    try {
      expect(await main(["label-send", "--units", "u.txt", "--out", join(tmpdir(), "h2h-label-send-none")])).toBe(2);
    } finally {
      console.error = err;
    }
    expect(out.join("\n")).toContain("E_USAGE label-send: --run is required");
  });
});
