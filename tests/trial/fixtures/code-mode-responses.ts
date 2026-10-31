/** A fake Responses endpoint for the Docker tier's Code Mode test (GST-360). Turn 1 answers with one call to Code Mode's exec tool, whose JS runs echo through tools.exec_command; turn 2 returns that call's output as the final message. It runs on the trial image's bun beside codex, and writes the path in its first argument once it listens. */
import { writeFileSync } from "node:fs";

const usage = { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 };
let n = 0;

function sse(model: string, output: unknown[]): Response {
  const id = "resp_" + n;
  const events: [string, unknown][] = [["response.created", { type: "response.created", response: { id, object: "response", model, status: "in_progress", output: [] } }]];
  output.forEach((item, output_index) => {
    events.push(["response.output_item.added", { type: "response.output_item.added", output_index, item }]);
    events.push(["response.output_item.done", { type: "response.output_item.done", output_index, item }]);
  });
  events.push(["response.completed", { type: "response.completed", response: { id, object: "response", model, status: "completed", output, usage } }]);
  return new Response(events.map(([name, e]) => "event: " + name + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
}

Bun.serve({
  port: 8080,
  hostname: "127.0.0.1",
  async fetch(req) {
    const body = (await req.json()) as { model: string; input?: { type?: string; call_id?: string; output?: unknown }[] };
    n++;
    const done = (body.input ?? []).find((i) => i.type === "custom_tool_call_output" && i.call_id === "call_cm");
    if (!done) return sse(body.model, [{ type: "custom_tool_call", id: "ctc_0", call_id: "call_cm", name: "exec", input: "const r = await tools.exec_command({ cmd: 'echo gse-code-mode-' + 'ok' });\ntext(r);", status: "completed" }]);
    return sse(body.model, [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "FINAL: " + JSON.stringify(done.output).slice(0, 400), annotations: [] }] }]);
  },
});
writeFileSync(Bun.argv[2]!, "ready\n");
