// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the post-run batches send each paid call once, retry an empty, cut-off or unreadable reply once, stop on a
// non-200 reply and resume from the replies they kept, settle their lease every time, and never label before
// contamination and its second read are settled; change 9's labeller reads each review once, blind, on the judge's input
// in a seeded shuffle, retries an empty or cut-off reply once, sends a refusal or a harness failure once to Kimi, ends a
// review neither labels as can't tell, and stops at the item's cap; fails_when=a stopped batch pays twice on rerun, a
// missing key opens a lease, a batch leaves its lease open, a doubtful case is labelled, the labeller sees an arm or a model
// name, a refusal is retried on Grok or never reaches Kimi, a review neither labels is dropped, or a call runs past the cap;
// why_new=GEVA-590 section 4's one retry, section 5's second read and pre-run change 9's labels; seam=send.ts on the real cso metered transport with a stub upstream and a temporary ledger;
// no_claim=that the providers fail the way the stubs do
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { readContamination, writeContamination } from "../../../src/trial/review/contamination.ts";
import { contaminationInputs } from "../../../lanes/review-models/post/cli.ts";
import { loadPilot, sourceOf } from "../../../lanes/review-models/post/pilot.ts";
import { finalPath, judgeSend, labelOrder, labelSend, labelStep, parseSecondRead, pilotBatch, replyProblem, secondReadSend, type BatchReview } from "../../../lanes/review-models/post/send.ts";
import { bugBlock, numberedFindings } from "../../../lanes/review-models/score/judge.ts";
import { labelPrompt, parseLabel, type FinalRow } from "../../../lanes/review-models/score/labels.ts";
import { DRY_ENV, ITEMS, plant, upstream } from "./fixture.ts";

const promptOf = (init: any): string => {
  const b = JSON.parse(String(init?.body ?? "{}"));
  return b.input?.[0]?.content ?? b.messages?.[0]?.content ?? "";
};

function setup() {
  const s = plant();
  const up = upstream();
  const key = JSON.parse(readFileSync(s.keyPath, "utf8"));
  const p = loadPilot(s.run, key, s.post);
  writeContamination(join(s.post, "contamination"), readContamination(contaminationInputs(p), p.markers, []), p.markers);
  const opts = (item: string, fetch: typeof globalThis.fetch = up.fetch) => ({ item, run_id: item, record: s.record, ledger: s.ledger, env: DRY_ENV, fetch, warn: () => {} });
  return { s, up, key, opts, pilot: () => loadPilot(s.run, key, s.post) };
}

describe("rm-post's paid batches on stub transports (keyless)", () => {
  test("a non-200 reply stops the batch, and the rerun resumes without paying for what it already has", async () => {
    const t = setup();
    let refuse = true;
    const flaky = (async (url: any, init?: any) => {
      if (refuse && promptOf(init).includes('"verdict"')) {
        refuse = false;
        return Response.json({ error: { message: "planted bad request" } }, { status: 400 });
      }
      return t.up.fetch(url, init);
    }) as typeof fetch;
    await expect(secondReadSend(t.s.post, t.opts(ITEMS.second, flaky))).rejects.toThrow(/E_RM_POST_SEND second-read read \S+ by astra answered HTTP 400/);
    expect(readItem(t.s.record, ITEMS.second).open).toBeNull();
    expect(t.up.calls.length).toBe(0);
    const r = await secondReadSend(t.s.post, t.opts(ITEMS.second, flaky));
    expect([r.cases, r.clean, r.failed, r.sent]).toEqual([1, 1, 0, 1]);
    const again = await secondReadSend(t.s.post, t.opts(ITEMS.second, flaky));
    expect([again.sent, t.up.calls.length]).toEqual([0, 1]);
  }, 60_000);

  test("Carbon's capless request goes out with the proxy's output cap priced and written, and a missing key opens no lease", async () => {
    const t = setup();
    await judgeSend(t.pilot(), t.s.post, t.opts(ITEMS.judge));
    const carbon = t.up.calls.find((c) => c.provider === "openrouter")!;
    expect(carbon.body.max_tokens).toBe(65536);
    expect(carbon.body.reasoning).toBeUndefined();
    const t2 = setup();
    await expect(judgeSend(t2.pilot(), t2.s.post, { ...t2.opts(ITEMS.judge), env: { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run" } })).rejects.toThrow(/E_KEY_MISSING/);
    expect(readItem(t2.s.record, ITEMS.judge).open).toBeNull();
    expect(t2.up.calls.length).toBe(0);
  }, 60_000);

  test("the label packet waits on the second read, and a second read that fails twice stays pending", async () => {
    const t = setup();
    const empty = (async (url: any, init?: any) => {
      const r = await t.up.fetch(url, init);
      if (!promptOf(init).includes('"verdict"')) return r;
      const body = (await r.json()) as Record<string, unknown>;
      return Response.json({ ...body, output: [{ type: "message", content: [{ type: "output_text", text: "" }] }] });
    }) as typeof fetch;
    const r = await secondReadSend(t.s.post, t.opts(ITEMS.second, empty));
    expect([r.cases, r.failed, r.sent]).toEqual([1, 1, 2]);
    expect(t.pilot().contamination.pending_cases).toBe(1);
    expect(() => pilotBatch(t.pilot())).toThrow(/E_RM_POST_INPUT 1 doubtful search cases still wait/);
  }, 60_000);
});

const orReply = (model: string, served: string, content: string, extra: { finish_reason?: string; refusal?: string } = {}) =>
  Response.json({ id: "g", model, provider: served, choices: [{ message: { role: "assistant", content, ...(extra.refusal ? { refusal: extra.refusal } : {}) }, finish_reason: extra.finish_reason ?? "stop" }], usage: { prompt_tokens: 900, completion_tokens: 60 } });
const GROK_ID = "x-ai/grok-4.7", KIMI_ID = "moonshotai/kimi-k3.1-pro";

describe("change 9's labels on stub transports (keyless)", () => {
  async function ready() {
    const t = setup();
    await secondReadSend(t.s.post, t.opts(ITEMS.second));
    const reviews = pilotBatch(t.pilot());
    const order = labelOrder(reviews.filter((r) => r.findings.length));
    return { ...t, reviews, order };
  }
  const labelCalls = (t: { up: { calls: Array<{ provider: string; body: any }> } }) => t.up.calls.filter((c) => c.provider === "openrouter" && c.body.model !== "google/gemini-4-carbon");
  /** A fetch that answers the target review's label calls with plant(model, nth call to that model), else the stub's. */
  function on(t: Awaited<ReturnType<typeof ready>>, target: BatchReview, plant: (model: string, nth: number) => Response | null) {
    const seen: Record<string, number> = {};
    const f = (async (url: any, init?: any) => {
      const b = JSON.parse(String(init?.body ?? "{}"));
      if (b.messages?.[0]?.content === labelPrompt(target.bug, target.findings)) {
        seen[b.model] = (seen[b.model] ?? 0) + 1;
        const res = plant(b.model, seen[b.model]!);
        if (res) return res;
      }
      return t.up.fetch(url, init);
    }) as typeof fetch;
    return { f, seen };
  }
  const rowOf = (post: string, r: BatchReview): FinalRow => (JSON.parse(readFileSync(finalPath(post), "utf8")) as FinalRow[]).find((x) => x.id === r.id)!;

  test("Grok reads each review once, blind to arm and model, on the judge's own input, in a seeded shuffle across arms", async () => {
    const t = await ready();
    const r = await labelSend(t.reviews, t.s.post, "pilot", t.opts(ITEMS.labels));
    const calls = labelCalls(t);
    expect(calls.length).toBe(t.order.length);
    expect(calls.every((c) => c.body.model === GROK_ID)).toBe(true);
    expect(calls[0]!.body).toMatchObject({ provider: { only: ["amazon-bedrock"], allow_fallbacks: false, data_collection: "deny", max_price: { prompt: 4, completion: 12 } }, max_tokens: 65536 });
    expect(calls[0]!.body.reasoning).toBeUndefined();
    calls.forEach((c, i) => {
      const rv = t.order[i]!;
      const prompt: string = c.body.messages[0].content;
      expect(prompt).toBe(labelPrompt(rv.bug, rv.findings));
      expect(prompt).toContain(bugBlock(rv.bug));
      expect(prompt).toContain(numberedFindings(rv.findings));
      expect(prompt).not.toMatch(/claude|fable|opus|codex|astra|\bsol\b|gstack|gemini|carbon|ruling/i);
      expect(prompt).not.toMatch(/\b(OS|OA|FS|FA)\b|\barm\b/);
    });
    expect(labelOrder([...t.reviews].reverse()).map((x) => x.id)).toEqual(labelOrder(t.reviews).map((x) => x.id));
    expect(new Set(t.order.slice(0, 5).map((x) => x.arm)).size).toBeGreaterThanOrEqual(3);
    expect(t.order.map((x) => x.arm)).not.toEqual([...t.order.map((x) => x.arm)].sort());
    expect([r.reviews, r.by.grok, r.by.kimi, r.by.none, r.cant_tell]).toEqual([t.reviews.length, t.order.length, 0, t.reviews.length - t.order.length, 0]);
    const rows: FinalRow[] = JSON.parse(readFileSync(finalPath(t.s.post), "utf8"));
    expect(rows.filter((x) => x.labeller === "none").every((x) => x.reason.includes("no findings") && x.label === false)).toBe(true);
    expect(rows.every((x) => x.reason && x.labeller)).toBe(true);
    expect(readItem(t.s.record, ITEMS.labels).open).toBeNull();
    const again = await labelSend(t.reviews, t.s.post, "pilot", t.opts(ITEMS.labels));
    expect([again.sent, labelCalls(t).length]).toEqual([0, t.order.length]);
  }, 60_000);

  test("an empty reply, then a cut-off one, each earn Grok one more attempt and no Kimi call", async () => {
    const t = await ready();
    const [a, b] = [t.order[0]!, t.order[1]!];
    const pa = on(t, a, (m, n) => (m === GROK_ID && n === 1 ? orReply(m, "Amazon Bedrock", "") : null));
    const pb = on({ ...t, up: { ...t.up, fetch: pa.f } }, b, (m, n) => (m === GROK_ID && n === 1 ? orReply(m, "Amazon Bedrock", "{", { finish_reason: "length" }) : null));
    await labelSend(t.reviews, t.s.post, "pilot", t.opts(ITEMS.labels, pb.f));
    expect([pa.seen[GROK_ID], pa.seen[KIMI_ID] ?? 0, pb.seen[GROK_ID], pb.seen[KIMI_ID] ?? 0]).toEqual([2, 0, 2, 0]);
    expect(rowOf(t.s.post, a)).toMatchObject({ labeller: "grok", reason: "planted" });
    expect(rowOf(t.s.post, a).fallback).toBeUndefined();
    expect(rowOf(t.s.post, b)).toMatchObject({ labeller: "grok" });
  }, 60_000);

  test("a refusal and a harness failure each go once to Kimi, pinned to DeepInfra at bf16, with the reason kept", async () => {
    const t = await ready();
    const [a, b] = [t.order[0]!, t.order[1]!];
    const pa = on(t, a, (m) => (m === GROK_ID ? orReply(m, "Amazon Bedrock", "", { finish_reason: "content_filter" }) : null));
    const pb = on({ ...t, up: { ...t.up, fetch: pa.f } }, b, (m) => (m === GROK_ID ? Response.json({ error: { message: "planted bad request" } }, { status: 400 }) : null));
    const r = await labelSend(t.reviews, t.s.post, "pilot", t.opts(ITEMS.labels, pb.f));
    expect([pa.seen[GROK_ID], pa.seen[KIMI_ID], pb.seen[GROK_ID], pb.seen[KIMI_ID]]).toEqual([1, 1, 1, 1]);
    const kimi = t.up.calls.filter((c) => c.body.model === KIMI_ID);
    expect(kimi.length).toBe(2);
    expect(kimi[0]!.body.provider).toMatchObject({ only: ["deepinfra"], quantizations: ["bf16"], allow_fallbacks: false });
    expect(rowOf(t.s.post, a)).toMatchObject({ labeller: "kimi", fallback: "Grok: refused", reason: "planted" });
    expect(rowOf(t.s.post, b)).toMatchObject({ labeller: "kimi", fallback: "Grok: harness failure (HTTP 400)" });
    expect(r.by.kimi).toBe(2);
    expect(Object.values(r.per_arm).reduce((n, x) => n + x!.kimi, 0)).toBe(2);
  }, 60_000);

  test("a review neither model labels ends as can't tell, counted per arm, with both reasons", async () => {
    const t = await ready();
    const a = t.order[0]!;
    const p = on(t, a, (m) => (m === GROK_ID ? Response.json({ error: { message: "planted" } }, { status: 400 }) : orReply(m, "DeepInfra", "", { refusal: "I can't help with that." })));
    const r = await labelSend(t.reviews, t.s.post, "pilot", t.opts(ITEMS.labels, p.f));
    expect([p.seen[GROK_ID], p.seen[KIMI_ID]]).toEqual([1, 1]);
    expect(rowOf(t.s.post, a)).toMatchObject({ label: false, cant_tell: true, answer: "cant_tell", labeller: "none", reason: "neither model labelled it", fallback: "Grok: harness failure (HTTP 400); Kimi: refused" });
    expect(r.per_arm[a.arm]).toMatchObject({ cant_tell: 1, unlabelled: 1, kimi: 0 });
    expect(r.cant_tell).toBe(1);
  }, 60_000);

  test("the labels item stops at its $80 cap: no call past the room, the lease settles, and nothing is written", async () => {
    const t = await ready();
    const item = "rm-pilot-labels-80";
    recordApproval(t.s.record, { action: "init", item, cap_micros: 80 * 1_000_000, quotes: [{ words: "change 9's $80 labels cap", by: "rm-post tests", source: "tests/review-models/post" }], admission: "warn" });
    // Each planted Grok reply bills about $39.95 (long-prompt rate), so two leave about $0.10, under the next call's worst case.
    const big = (async (url: any, init?: any) => {
      const b = JSON.parse(String(init?.body ?? "{}"));
      if (b.model !== GROK_ID) return t.up.fetch(url, init);
      const res = (await (await t.up.fetch(url, init)).json()) as Record<string, unknown>;
      return Response.json({ ...res, usage: { prompt_tokens: 9_987_500, completion_tokens: 60 } });
    }) as typeof fetch;
    await expect(labelSend(t.reviews, t.s.post, "pilot", t.opts(item, big))).rejects.toThrow(/E_CSO_CAP_STOP rm-pilot-labels-80 has \$\d+\.\d+ of room/);
    expect(labelCalls(t).length).toBe(2);
    const lease = readItem(t.s.record, item).leases[0]!;
    expect(readItem(t.s.record, item).open).toBeNull();
    expect(lease.close!.spent_micros).toBeGreaterThan(79_900_000);
    expect(lease.close!.spent_micros).toBeLessThanOrEqual(80_000_000);
    expect(() => readFileSync(finalPath(t.s.post), "utf8")).toThrow();
  }, 60_000);
});

describe("reply and finding readers (keyless)", () => {
  test("a label reads as finding numbers, none or cant_tell with a reason, and the label steps run Grok, its retry, Kimi, then can't tell", () => {
    expect(parseLabel('{"answer": [2, 1], "reason": "x"}', 2)).toEqual({ kind: "ok", value: { answer: [1, 2], reason: "x" } });
    expect(parseLabel('{"answer": "none", "reason": "x"}', 2)).toMatchObject({ kind: "ok" });
    expect(parseLabel('{"answer": [3], "reason": "x"}', 2)).toMatchObject({ kind: "malformed" });
    expect(parseLabel('{"answer": [], "reason": "x"}', 2)).toMatchObject({ kind: "malformed" });
    expect(parseLabel('{"answer": "cant_tell"}', 2)).toMatchObject({ kind: "malformed", reason: "no one-line reason" });
    const ok = { choices: [{ message: { content: '{"answer": "none", "reason": "x"}' }, finish_reason: "stop" }] };
    const empty = { choices: [{ message: { content: "" }, finish_reason: "stop" }] };
    const rep = (who: "grok" | "kimi", attempt: number, status: number, body: unknown) => ({ id: "r", who, attempt, status, body });
    expect(labelStep([], 2)).toEqual({ send: "grok", attempt: 1 });
    expect(labelStep([rep("grok", 1, 200, empty)], 2)).toEqual({ send: "grok", attempt: 2 });
    expect(labelStep([rep("grok", 1, 200, empty), rep("grok", 2, 200, empty)], 2)).toEqual({ send: "kimi", attempt: 1 });
    expect(labelStep([rep("grok", 1, 200, empty), rep("grok", 2, 200, empty), rep("kimi", 1, 200, ok)], 2)).toMatchObject({ outcome: { labeller: "kimi", fallback: "Grok: empty, then empty" } });
    expect(labelStep([{ ...rep("grok", 1, 0, null), error: "socket closed" }], 2)).toEqual({ send: "kimi", attempt: 1 });
    expect(labelStep([rep("grok", 1, 200, ok)], 2)).toMatchObject({ outcome: { labeller: "grok", label: false, answer: "none" } });
  });
  test("a reply settles only when it reads, and refusals and cut-offs are named", () => {
    const read = (t: string) => parseSecondRead(t);
    expect(replyProblem("anthropic", { stop_reason: "refusal", content: [] }, read)).toBe("refused");
    expect(replyProblem("openai", { incomplete_details: { reason: "max_output_tokens" }, output: [] }, read)).toBe("cut off");
    expect(replyProblem("anthropic", { stop_reason: "end_turn", content: [{ type: "text", text: "" }] }, read)).toBe("empty");
    expect(replyProblem("anthropic", { stop_reason: "end_turn", content: [{ type: "text", text: '{"verdict": "maybe"}' }] }, read)).toMatch(/^malformed/);
    expect(replyProblem("anthropic", { stop_reason: "end_turn", content: [{ type: "text", text: '{"verdict": "clean", "reason": "x"}' }] }, read)).toBeNull();
  });
  test("a finding is the voice's when its claim or severity opens with a voice cue", () => {
    expect(sourceOf("[codex] The cache never expires.", "P1")).toBe("voice");
    expect(sourceOf("Codex: the cache never expires.", "P1")).toBe("voice");
    expect(sourceOf("The cache never expires.", "[codex] HIGH")).toBe("voice");
    expect(sourceOf("Outside voice flags a race.", "MEDIUM")).toBe("voice");
    expect(sourceOf("The adversarial subagent found a race.", "HIGH")).toBe("native");
    expect(sourceOf("Retry loop never stops.", "CRITICAL")).toBe("native");
  });
});
