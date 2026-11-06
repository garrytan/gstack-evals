// Copyright (c) 2026 Garry Tan. MIT License.
// tbv routes: each request goes through a stub provider behind the real metering proxy on a real lease, and the test
// reads the body the provider got.
import { afterAll, describe, expect, test } from "bun:test";
import { openItemRun } from "../../lanes/tbv/drive.ts";
import { TbvError } from "../../lanes/tbv/errors.ts";
import { armSend, JUDGE_MAX_TOKENS, judgeSend, KEY_WRITER, keyWriterSend } from "../../lanes/tbv/routes.ts";
import type { SendRequest } from "../../lanes/tbv/types.ts";
import { cleanup, KEYS, ledgerDir, sse } from "./drive-fixture.ts";

afterAll(cleanup);

async function through(req: SendRequest, reply: Response) {
  const L = ledgerDir("tbv-routes", 20);
  const got: Array<{ url: string; body: any }> = [];
  const run = await openItemRun({ item: "tbv-routes", runId: "routes-1", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: async (url, init) => (got.push({ url, body: JSON.parse(String(init.body)) }), reply) });
  try {
    const slot = run.slot("routes", [req.provider + ":" + String(req.body.model)], 5_000_000);
    const res = await slot.send(req);
    await slot.close();
    return { res, got: got[0]! };
  } finally {
    await run.close();
  }
}
const arm = { max_tokens: 4000, system: [{ type: "text", text: "sys" }], messages: [{ role: "user", content: [{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }] }] };
const anthropicJson = (t: string) => Response.json({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });

describe("arm routes", () => {
  test("Opus goes to Anthropic's Messages route, streamed, with no thinking field", async () => {
    const { res, got } = await through(armSend("opus", arm), sse({ text: "fine" }));
    expect(got.url).toBe("https://api.anthropic.com/v1/messages");
    expect(got.body.model).toBe("claude-opus-5-5");
    expect(got.body.stream).toBe(true);
    expect(got.body.thinking).toBeUndefined();
    expect(got.body.provider).toBeUndefined();
    expect(res.kind).toBe("text");
    expect(res.reply?.text).toBe("fine");
  });

  test("Sol and particle-1 go to OpenRouter's Messages route with the Anthropic body, the provider pin and data_collection deny", async () => {
    for (const [model, id, pin] of [["sol", "openai/gpt-6.1-sol", "openai"], ["particle", "particle-ai/particle-1", "particle-ai"]] as const) {
      const { got } = await through(armSend(model, arm), sse({ text: "fine" }));
      expect(got.url).toBe("https://openrouter.ai/api/v1/messages");
      expect(got.body.model).toBe(id);
      expect(got.body.messages).toEqual(arm.messages);
      expect(got.body.system).toEqual(arm.system);
      expect(got.body.thinking).toBeUndefined();
      expect(got.body.reasoning).toBeUndefined();
      expect(got.body.provider).toMatchObject({ only: [pin], allow_fallbacks: false, data_collection: "deny" });
    }
  });

  test("an arm body that carries a thinking field is refused before any send", () => {
    let code = "";
    try {
      armSend("opus", { ...arm, thinking: { type: "enabled", budget_tokens: 1024 } });
    } catch (e) {
      code = e instanceof TbvError ? e.code : "";
    }
    expect(code).toBe("E_TBV_REQUEST");
  });
});

describe("judge and key-writer routes", () => {
  test("the Sol judge goes to OpenAI's Responses route at reasoning effort medium", async () => {
    const { got, res } = await through(judgeSend("sol", "judge this", JUDGE_MAX_TOKENS.first), Response.json({ id: "resp_1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "answer" }] }], usage: { input_tokens: 10, output_tokens: 5 } }));
    expect(got.url).toBe("https://api.openai.com/v1/responses");
    expect(got.body).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "medium" }, max_output_tokens: 16000, store: false });
    expect(res.reply?.text).toBe("answer");
    expect(res.responseId).toBe("resp_1");
  });

  test("the Opus judge goes to Anthropic's Messages route with output_config effort medium and no thinking", async () => {
    const { got, res } = await through(judgeSend("opus", "judge this", JUDGE_MAX_TOKENS.d2), anthropicJson("verdict"));
    expect(got.url).toBe("https://api.anthropic.com/v1/messages");
    expect(got.body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 8000, output_config: { effort: "medium" } });
    expect(got.body.thinking).toBeUndefined();
    expect(res.reply?.text).toBe("verdict");
  });

  test("the key writer goes to OpenRouter's chat route pinned to one provider with data_collection deny", async () => {
    const { got, res } = await through(keyWriterSend("write the key", 12000), Response.json({ id: "gen-k1", choices: [{ message: { role: "assistant", content: "key" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    expect(got.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(got.body.model).toBe(KEY_WRITER.model);
    expect(got.body.max_tokens).toBe(12000);
    expect(got.body.provider).toMatchObject({ only: ["google-vertex"], allow_fallbacks: false, data_collection: "deny" });
    expect(res.reply?.text).toBe("key");
  });

  test("judge output caps are explicit per packet kind", () => {
    expect(JUDGE_MAX_TOKENS).toEqual({ first: 16000, control: 16000, d2: 8000 });
  });
});
