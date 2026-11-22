// Copyright (c) 2026 Garry Tan. MIT License.
// A keyless stand-in for the OpenAI Responses API, for part S's Codex tests, rollout fixtures and the stage 0 check
// (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg sections 3, 8 and 11). It streams the events Codex
// 0.170.0 reads (response.created, response.output_item.done, response.completed) with small usage numbers, and plays a
// fixed script chosen by a tag "[fx:<name>]" in the newest tagged user message. A step counts the tool outputs after the
// newest user message; a newest user message with no tag (a question reply or a continuation) gets the script's answer
// after a reply. Scripts:
//   done        a final message ending in DONE
//   nodone      a final message without DONE, every time
//   ask         request_user_input_async with one question, then DONE after the reply
//   asksync     request_user_input with one question, then DONE after Codex's own answer
//   fail        response.failed with error code cyber_policy and the message OpenAI sent with it on a real part S
//               session (tests/fixtures/codex-cyber-policy.json), which names no code
//   bound       the metering proxy's 429 E_H2H_RESERVATION_BOUND refusal, then DONE after the next user message
//   boundlate   one exec cell that runs true, then the proxy's 429 on the next request, after every user message
//   hang        no answer until the client goes away
//   cmd:<sh>    a code-mode exec cell that runs <sh> through tools.exec_command, then DONE (the rest of the message's
//               first line after the tag is the command)
//   direct:<sh> a direct exec_command function call that runs <sh>, then DONE
//   patch:<p>   a code-mode cell that adds file <p> through tools.apply_patch, then DONE
//   plan:<p>    one response with a "Using writing-plans to ..." message and the patch cell for <p>, then DONE
//   tdd:<t>|<s> the patch cell for test file <t>, a cell whose command fails, the patch cell for source file <s>, then DONE
// Every request is written to LOG_DIR as req-NNN.json (path, headers without authorization, body). Usage:
// bun stub-responses.ts [--port N]; it prints "stub-responses listening <port>" when ready.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { problem, RESERVATION_RETRY_AFTER_S } from "../../../../src/runner/proxy/metering-proxy";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const dir = process.env.LOG_DIR;
if (dir) mkdirSync(dir, { recursive: true });
let n = 0;

type Item = Record<string, unknown>;
export const CYBER_POLICY_MESSAGE = "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. If you’re doing authorized security work that requires more cyber permissive safeguards, apply for Daybreak access via https://platform.openai.com/settings/organization/status-and-access before retrying.";
const sse = (events: Item[]) => new Response(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 1050 };
const message = (text: string): Item => ({ type: "message", id: "msg_" + n, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
const call = (name: string, args: unknown): Item => ({ type: "function_call", id: "fc_" + n, call_id: "call_" + name + "_" + n, name, arguments: JSON.stringify(args), status: "completed" });
const cell = (cmd: string): Item => ({ type: "custom_tool_call", id: "ctc_" + n, call_id: "call_exec_" + n, name: "exec", input: "const r = await tools.exec_command({cmd: " + JSON.stringify(cmd) + "});\ntext(typeof r === \"string\" ? r : (r.output ?? JSON.stringify(r)));", status: "completed" });
const patchCell = (path: string): Item => ({ type: "custom_tool_call", id: "ctc_" + n, call_id: "call_exec_" + n, name: "exec", input: "await tools.apply_patch(" + JSON.stringify("*** Begin Patch\n*** Add File: " + path + "\n+x\n*** End Patch\n") + ");\ntext(\"patched\");", status: "completed" });
const question = { questions: [{ id: "scope", header: "Scope", question: "Should I also add a regression test?", options: [{ label: "Yes", description: "Add one" }, { label: "No", description: "Skip it" }] }] };

const textOf = (i: any): string => (Array.isArray(i?.content) ? i.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("") : typeof i?.content === "string" ? i.content : "");
const isUser = (i: any) => i?.type === "message" && i.role === "user" && !textOf(i).startsWith("<environment_context>") && !textOf(i).startsWith("<skill>");

/** The script's next output item for one request body, or null for hang. */
export function next(body: any): Item | Item[] | "fail" | "bound" | null {
  const input: any[] = Array.isArray(body?.input) ? body.input : [];
  const users = input.map((x, i) => [x, i] as const).filter(([x]) => isUser(x));
  const last = users.at(-1);
  const tagged = [...users].reverse().find(([x]) => /\[fx:[^\]]+\]/.test(textOf(x)));
  const m = tagged ? textOf(tagged[0]).match(/\[fx:([a-z]+)(?::([^\]\n]*))?\]([^\n]*)/) : null;
  const script = m?.[1] ?? "done";
  const rest = ((m?.[2] ?? "") + (m?.[3] ?? "")).trim();
  const steps = last ? input.slice(last[1] + 1).filter((x) => x?.type === "function_call_output" || x?.type === "custom_tool_call_output").length : 0;
  const reply = last && tagged && last[1] !== tagged[1];
  if (script === "nodone") return message("Still working on it.");
  if (script === "hang") return null;
  if (script === "fail") return reply ? message("Fixed.\nDONE") : "fail";
  if (script === "bound") return reply ? message("Fixed.\nDONE") : "bound";
  if (script === "boundlate") return steps === 0 ? cell("true") : "bound";
  if (script === "loop") return steps < Number(m?.[2] ?? 8) ? cell("sleep 1") : message("Fixed it.\n\nDONE");
  const arg = (m?.[2] ?? "").trim();
  if (script === "tdd" && !reply && steps < 3) {
    const [test, src] = arg.split("|");
    return [patchCell(test ?? "tests/test_x.py"), cell("echo FAILED: 1 failing; exit 1"), patchCell(src ?? "src/x.py")][steps]!;
  }
  if (reply || steps > 0) return message("Fixed it.\n\nDONE");
  if (script === "patch") return patchCell(arg);
  if (script === "plan") return [message("Using writing-plans to write the plan for this change."), patchCell(arg)];
  if (script === "ask") return call("request_user_input_async", question);
  if (script === "asksync") return call("request_user_input", question);
  if (script === "cmd") return cell(rest);
  if (script === "direct") return call("exec_command", { cmd: rest });
  return message("Fixed it.\n\nDONE");
}

if (import.meta.main) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(arg("--port") ?? 0),
    idleTimeout: 0,
    async fetch(req) {
      const raw = await req.text();
      n++;
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = { unparsed: raw.slice(0, 200) };
      }
      const headers = Object.fromEntries([...req.headers].filter(([k]) => k !== "authorization"));
      if (dir) writeFileSync(join(dir, "req-" + String(n).padStart(3, "0") + ".json"), JSON.stringify({ method: req.method, path: new URL(req.url).pathname, headers, body }, null, 1) + "\n");
      if (req.method === "GET") return Response.json({ object: "list", data: [] });
      const id = "resp_stub_" + n;
      const item = next(body);
      if (item === null) {
        await new Promise((r) => req.signal.addEventListener("abort", r));
        return new Response(null, { status: 499 });
      }
      if (item === "fail") return sse([{ type: "response.created", response: { id } }, { type: "response.failed", response: { id, status: "failed", error: { code: "cyber_policy", message: CYBER_POLICY_MESSAGE }, usage } }]);
      if (item === "bound") return problem("E_H2H_RESERVATION_BOUND", 429, "only calls still in flight fill the slot's allowance; retry once one settles", "rate_limit_error", { "retry-after": String(RESERVATION_RETRY_AFTER_S), "x-should-retry": "true" });
      const items = Array.isArray(item) ? item : [item];
      return sse([{ type: "response.created", response: { id } }, ...items.map((it, i) => ({ type: "response.output_item.done", output_index: i, item: it })), { type: "response.completed", response: { id, status: "completed", usage } }]);
    },
  });
  console.log("stub-responses listening " + server.port);
}
