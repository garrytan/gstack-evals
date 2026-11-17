// Copyright (c) 2026 Garry Tan. MIT License.
// The judge's output caps through the real judge seam, keyless (Captain's dated plan change, 2026-11-17): the gold
// labeller on Gemini 4 Carbon asks for 32,000 tokens like the Carbon rater, and GPT-6 Astra and the Opus gold labeller
// keep the judge's 16,000, all at the frozen high effort.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { underLease } from "../../../lanes/eng-build/pipeline.ts";
import { REAL } from "../../../lanes/eng-planted/stages/commands.ts";
import { CARBON_MAX_TOKENS, JUDGE_MAX_TOKENS } from "../../../lanes/eng-planted/stages/local.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";

const root = mkdtempSync(join(tmpdir(), "ep-judge-cap-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const record = join(root, "record");
const ledger = join(root, "ledger.sqlite");
recordApproval(record, { action: "init", item: "ep-judge", cap_micros: 50_000_000, quotes: [{ words: "judge cap test on a temporary ledger", by: "ep tests", source: "tests/ep/stages/judge-cap.test.ts" }], admission: "warn" });

describe("the judge's output caps", () => {
  test("the Carbon gold labeller asks for 32,000 tokens; Astra and the Opus gold labeller keep 16,000; all at high effort", async () => {
    const seen: Array<{ to: string; body: any }> = [];
    const fetch = (async (url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const to = String(url).includes("anthropic") ? "anthropic" : String(url).includes("openai.com") ? "openai" : "openrouter";
      seen.push({ to, body });
      if (to === "anthropic") return Response.json({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "none" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
      if (to === "openai") return Response.json({ id: "r", object: "response", status: "completed", model: body.model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "none" }] }], usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
      return Response.json({ id: "g", model: body.model, provider: "Google", choices: [{ message: { role: "assistant", content: "none" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }) as unknown as typeof globalThis.fetch;
    const roles = ["judge", "gold-opus", "gold-gemini"] as const;
    const opts = { out: join(root, "out"), cacheDir: join(root, "cache"), roles: [...roles], fetch, env: { OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test", OPENROUTER_API_KEY: "test" } };
    await underLease({ item: "ep-judge", capUsd: 5, record, ledger }, REAL.judge(opts), async (call) => {
      for (const role of roles) await call(role, "Label bundle " + role + ".");
    });
    const by = (to: string) => seen.filter((s) => s.to === to).map((s) => s.body);
    expect(by("openrouter").map((b) => [b.model, b.max_tokens, b.reasoning, b.stream])).toEqual([["google/gemini-4-carbon", CARBON_MAX_TOKENS, { effort: "high" }, true]]);
    expect(by("anthropic").map((b) => [b.max_tokens, b.output_config])).toEqual([[JUDGE_MAX_TOKENS, { effort: "high" }]]);
    expect(by("openai").map((b) => [b.max_output_tokens, b.reasoning?.effort])).toEqual([[JUDGE_MAX_TOKENS, "high"]]);
    expect([CARBON_MAX_TOKENS, JUDGE_MAX_TOKENS]).toEqual([32_000, 16_000]);
  });
});
