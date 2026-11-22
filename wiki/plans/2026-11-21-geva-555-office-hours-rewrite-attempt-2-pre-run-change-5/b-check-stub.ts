// Keyless Responses stub: request 1 runs the probe, request 2 one apply_patch, request 3 one command, request 4 a short reply. Each step's output is checked by the runner.
import { appendFileSync } from "node:fs";
const [out, port, probe] = [process.argv[2]!, Number(process.argv[3]), process.argv[4]!];
let n = 0;
const patch = "*** Begin Patch\n*** Add File: ohr-patch.txt\n+patched by apply_patch\n*** End Patch\n";
Bun.serve({ port, hostname: "127.0.0.1", idleTimeout: 120, async fetch(req) {
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json() : null;
  appendFileSync(out, JSON.stringify({ method: req.method, path: url.pathname, body }) + "\n");
  if (!url.pathname.endsWith("/responses")) return Response.json({ object: "list", data: [] });
  n++;
  const input = (body.input ?? []) as any[];
  const outputs = input.filter((i) => /_output$/.test(String(i.type))).length;
  const code = [
    "const r = await tools.exec_command({cmd: " + JSON.stringify("bash " + probe) + "});\ntext(typeof r === \"string\" ? r : JSON.stringify(r));",
    "const r = await tools.apply_patch(" + JSON.stringify(patch) + ");\ntext(\"PATCH_RESULT \" + (typeof r === \"string\" ? r : JSON.stringify(r)));",
    "const r = await tools.exec_command({cmd: " + JSON.stringify("printf cmd-ok > ohr-cmd.txt && test \"$(cat ohr-patch.txt)\" = \"patched by apply_patch\" && echo CMD_RAN=yes PATCH_FILE=ok") + "});\ntext(typeof r === \"string\" ? r : JSON.stringify(r));",
  ][outputs];
  const item = code === undefined
    ? { id: "msg_" + n, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] }
    : { id: "ctc_" + n, type: "custom_tool_call", status: "completed", call_id: "call_" + n, name: "exec", input: code };
  const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1020 };
  const ev = (type: string, data: object) => "event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n";
  const resp = { id: "resp_" + n, object: "response", model: body.model, status: "completed", output: [item], usage };
  return new Response([ev("response.created", { response: { ...resp, status: "in_progress", output: [] } }), ev("response.output_item.added", { output_index: 0, item }), ev("response.output_item.done", { output_index: 0, item }), ev("response.completed", { response: resp })].join(""), { headers: { "content-type": "text/event-stream" } });
} });
