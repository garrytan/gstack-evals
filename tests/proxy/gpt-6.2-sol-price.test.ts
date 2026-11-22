// Copyright (c) 2026 Garry Tan. MIT License.
// GPT-6.2 Sol's price row: OpenAI's published Standard rates, and a Responses call priced from its own usage.
import { expect, test } from "bun:test";
import { chatPrice, priceRequest, usageCost } from "../../src/runner/pricing/prices.ts";

test("GPT-6.2 Sol has OpenAI's published rates, the same as 6.1 Sol's", () => {
  expect(chatPrice("openai:gpt-6.2-sol")).toEqual({ input: 2, output: 10, cache_read: 0.1, cache_write: 2.5, long: { above_input_tokens: 272_000, input: 4, output: 15, cache_read: 0.2, cache_write: 5 } });
  expect(chatPrice("openai:gpt-6.2-sol")).toEqual(chatPrice("openai:gpt-6.1-sol"));
});

test("a Responses call to GPT-6.2 Sol is priced from its reported usage", () => {
  const price = priceRequest("openai", { model: "gpt-6.2-sol", input: "Fix this issue." }, 32_000, "/v1/responses");
  const usage = { input_tokens: 100_000, input_tokens_details: { cached_tokens: 20_000 }, output_tokens: 2_000, output_tokens_details: { reasoning_tokens: 500 }, total_tokens: 102_000 };
  const cost = usageCost(price, usage);
  expect(cost?.micros).toBe(182_000);
});
