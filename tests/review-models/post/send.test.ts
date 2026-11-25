// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the post-run batches send each paid call once, retry an empty, cut-off or unreadable reply once, stop on a
// non-200 reply and resume from the replies they kept, settle their lease every time, and never let the label packet be
// built before contamination and its second read are settled; fails_when=a stopped batch pays twice on rerun, a missing
// key opens a lease, a batch leaves its lease open, or a doubtful case reaches the people's packet; why_new=GEVA-590
// section 4's one retry, section 5's second read and pre-run change 5's person labels; seam=send.ts on the real cso metered transport with a stub upstream and a temporary ledger;
// no_claim=that the providers fail the way the stubs do
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { readContamination, writeContamination } from "../../../src/trial/review/contamination.ts";
import { contaminationInputs } from "../../../lanes/review-models/post/cli.ts";
import { loadPilot, sourceOf } from "../../../lanes/review-models/post/pilot.ts";
import { pilotBatch } from "../../../lanes/review-models/post/desk.ts";
import { judgeSend, parseSecondRead, replyProblem, secondReadSend } from "../../../lanes/review-models/post/send.ts";
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

describe("reply and finding readers (keyless)", () => {
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
