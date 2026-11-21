// Copyright (c) 2026 Garry Tan. MIT License.
// A fake OpenAI Responses upstream for B2's keyless smoke (smoke.sh), after part R's (lanes/codex-hooks/r/fake-responses.ts
// on the Codex hooks branch): the first turn lists Codex's skills and the work tree with exec_command, every later turn ends
// with a short answer. It streams the events Codex 0.170 reads, with small usage numbers so the metering proxy has something
// to price, and logs each request's model and reasoning effort. GET /healthz answers ok.
import { appendFileSync } from "node:fs";

const port = Number(process.env.FAKE_RESPONSES_PORT ?? 8799), log = process.env.FAKE_UPSTREAM_LOG;
Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    if (req.method === "GET") return new Response("ok");
    const body: any = await req.json().catch(() => ({}));
    if (log) appendFileSync(log, JSON.stringify({ path: new URL(req.url).pathname, model: body.model, effort: body.reasoning?.effort ?? null, items: (body.input ?? []).length }) + "\n");
    const step = (body.input ?? []).filter((i: any) => i?.type === "function_call_output" || i?.type === "custom_tool_call_output").length;
    const item = step === 0
      ? { type: "function_call", id: "fc_0", call_id: "call_smoke_0", name: "exec_command", arguments: JSON.stringify({ cmd: "ls ~/.codex/skills 2>/dev/null | head -50; git status --short | head; echo PATH=$PATH; command -v bun || echo no-bun" }), status: "completed" }
      : { type: "message", id: "msg_" + step, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Smoke test: no change made.", annotations: [] }] };
    const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1050 };
    const id = "resp_smoke_" + step;
    const events = [
      { type: "response.created", response: { id } },
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id, usage } },
    ];
    return new Response(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
  },
});
console.log("fake responses upstream on 127.0.0.1:" + port);
