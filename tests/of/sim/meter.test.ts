// Value: protects=the metered client's request bodies and cache keys, which must stay byte for byte when a request carries no chat fields, so no other eval's cache or digest moves.
import { describe, expect, test } from "bun:test";
import { cacheKey, MODELS, requestBody } from "../../../lanes/product-value/meter.ts";

describe("meter chat fields", () => {
  test("a request without them keeps its body and cache key", () => {
    const want: Record<string, [string, string]> = {
      opus: ['{"model":"claude-opus-5-5","max_tokens":100,"messages":[{"role":"user","content":"Say hi."}],"output_config":{"effort":"medium"}}', "2634d805a06802ee38cc5c17cb060bd98390a6c9623219c1a73d448c6d006b54"],
      astra: ['{"model":"gpt-6-astra","input":[{"role":"user","content":"Say hi."}],"store":false,"max_output_tokens":100,"reasoning":{"effort":"medium"}}', "5186ecf57639af0264345b354121401d24571d12daecdb473ca7b93604b9ffd5"],
      gemini: ['{"model":"google/gemini-4-argon","max_tokens":100,"messages":[{"role":"user","content":"Say hi."}],"reasoning":{"effort":"medium"}}', "cb7c2d9779c0b6813b2bae1033046a279a7af2a534bf2852ecc57c08209be475"],
    };
    for (const [k, [body, key]] of Object.entries(want) as [keyof typeof MODELS, [string, string]][]) {
      expect(JSON.stringify(requestBody(MODELS[k], "Say hi.", 100, "medium"))).toBe(body);
      expect(JSON.stringify(requestBody(MODELS[k], "Say hi.", 100, "medium", {}))).toBe(body);
      expect(cacheKey(k, requestBody(MODELS[k], "Say hi.", 100, "medium"))).toBe(key);
    }
    expect(JSON.stringify(requestBody(MODELS.gemini, "Say hi.", 100, null))).toBe('{"model":"google/gemini-4-argon","max_tokens":100,"messages":[{"role":"user","content":"Say hi."}]}');
  });
  test("on OpenRouter the system text leads the chat and temperature and seed are top-level", () => {
    const b = requestBody(MODELS.gemini, "", 1200, "medium", { system: "S", messages: [{ role: "user", content: "q" }, { role: "assistant", content: "r" }, { role: "user", content: "q2" }], temperature: 0, seed: 7 });
    expect(b).toEqual({ model: "google/gemini-4-argon", max_tokens: 1200, messages: [{ role: "system", content: "S" }, { role: "user", content: "q" }, { role: "assistant", content: "r" }, { role: "user", content: "q2" }], reasoning: { effort: "medium" }, temperature: 0, seed: 7 });
    expect(requestBody(MODELS.gemini, "p", 10, null, { temperature: 0 })).toEqual({ model: "google/gemini-4-argon", max_tokens: 10, messages: [{ role: "user", content: "p" }], temperature: 0 });
  });
  test("the chat fields are refused off OpenRouter", () => {
    expect(() => requestBody(MODELS.opus, "p", 10, null, { system: "S" })).toThrow("E_USAGE");
    expect(() => requestBody(MODELS.astra, "p", 10, null, { seed: 1 })).toThrow("E_USAGE");
  });
});
