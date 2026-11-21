// Copyright (c) 2026 Garry Tan. MIT License.
// A keyless stand-in for the Responses API that part C's fixtures and its end-to-end check run Codex against
// (lanes/codex-hooks/README.md). It never calls a model. It answers each POST to <base>/v1/responses with one streamed
// output item, picked from the request alone, and logs every request body to the log file as one JSON line.
//
// The parent session is the request whose user text holds the review prompt ("Review the changes on this branch") or a
// "[stub:<scenario>]" marker; any other request is a sub-agent's, answered "DONE". A request after a contract block holds
// gstack's <hook_prompt. Scenarios, by marker (none means block):
//   block      a report with one finding in a json block; after a block, two findings.
//   nojson     prose with no json block; after a block, one finding in a json block.
//   met        a spawn_agent call in the collaboration namespace with gstack's adversarial marker, then the
//              "Pre-Landing Review" report with "Gate edits" and one finding.
//   falseblock the same spawn_agent call in another namespace (multi_agent_v2), then the same report; after a block, the
//              report again.
//   codemode   a code-mode exec cell that reads the review SKILL.md in pre-run change 1's three flagged shapes (a sed
//              range that quits early, a bash -lc read and a < read that exit non-zero with no text), then the report
//              with no adversarial pass; after a block, the report again.
//   override   a spawn_agent call in the collaboration namespace with gstack's marker and a model and effort override
//              (gpt-6.2-sol at high), then the report.
// Usage: bun lanes/codex-hooks/c/stub.ts <port> <log file>
import { appendFileSync } from "node:fs";

export const MARKER = "Think like an attacker and a chaos engineer";
const FINDING_A = { file: "src/a.ts", line: 1, severity: "P1", claim: "a is set to 2, which breaks callers that expect 1.", evidence: "src/a.ts: export const a = 2;" };
const FINDING_B = { file: "src/b.ts", line: 1, severity: "P2", claim: "b is exported but never used.", evidence: "src/b.ts: export const b = 1;" };
const FENCE = "```";
const block = (findings: object[]) => "\n\n" + FENCE + "json\n" + JSON.stringify(findings, null, 2) + "\n" + FENCE + "\n";
const REPORT = "## Pre-Landing Review\n\nOne finding.\n\nGate edits: none.";

type Item = Record<string, unknown>;
const message = (id: string, text: string): Item => ({ type: "message", id, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
const spawn = (namespace: string, extra: Record<string, string> = {}): Item => ({ type: "function_call", id: "fc_spawn", call_id: "call_spawn_1", name: "spawn_agent", namespace, arguments: JSON.stringify({ message: MARKER + ". Review the diff on this branch for ways it can fail.", fork_turns: "none", task_name: "adversarial", ...extra }), status: "completed" });
const SKILL = "~/.codex/skills/gstack-review/SKILL.md";
const CELL = [
  "const a = await tools.exec_command({ cmd: \"sed -n '1,40p;41q' " + SKILL + "\" });",
  "const b = await tools.exec_command({ cmd: 'bash -lc \"cat /nope/skills/gstack-review/SKILL.md 2>/dev/null\"' });",
  "const c = await tools.exec_command({ cmd: 'cat 2>/dev/null < /nope/skills/gstack-review/SKILL.md' });",
  "text([a.exit_code, b.exit_code, c.exit_code].join(','));",
].join("\n");
const cell = (): Item => ({ type: "custom_tool_call", id: "ctc_exec", call_id: "call_exec_1", name: "exec", input: CELL, status: "completed" });

const textOf = (item: any): string => (typeof item?.content === "string" ? item.content : (item?.content ?? []).map((c: any) => c?.text ?? "").join(""));

/** The one output item the stub answers a request body with. */
export function answer(body: any): Item {
  const input: any[] = Array.isArray(body?.input) ? body.input : [];
  const users = input.filter((i) => i?.type === "message" && i.role === "user").map(textOf);
  const all = users.join("\n");
  if (!all.includes("Review the changes on this branch") && !all.includes("[stub:")) return message("msg_sub", "DONE");
  const scenario = /\[stub:([a-z]+)\]/.exec(all)?.[1] ?? "block";
  const blocked = users.some((u) => u.includes("<hook_prompt"));
  const called = input.some((i) => (i?.type === "function_call_output" && i.call_id === "call_spawn_1") || (i?.type === "custom_tool_call_output" && i.call_id === "call_exec_1"));
  if (scenario === "met") return called ? message("msg_report", REPORT + block([FINDING_A])) : spawn("collaboration");
  if (scenario === "falseblock") return !called ? spawn("multi_agent_v2") : message(blocked ? "msg_again" : "msg_report", REPORT + block([FINDING_A]));
  if (scenario === "codemode") return !called ? cell() : message(blocked ? "msg_again" : "msg_report", REPORT + block([FINDING_A]));
  if (scenario === "override") return called ? message("msg_report", REPORT + block([FINDING_A])) : spawn("collaboration", { model: "gpt-6.2-sol", reasoning_effort: "high" });
  if (scenario === "nojson") return blocked ? message("msg_final", "Here is the complete block." + block([FINDING_A])) : message("msg_first", "I reviewed the branch. src/a.ts sets a to 2, which breaks callers that expect 1.");
  return blocked ? message("msg_final", "After a second look, two findings." + block([FINDING_A, FINDING_B])) : message("msg_first", "One finding." + block([FINDING_A]));
}

if (import.meta.main) {
  const [port, log] = [Number(Bun.argv[2]), Bun.argv[3]!];
  Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const body = await req.json().catch(() => ({}));
      appendFileSync(log, JSON.stringify({ path: new URL(req.url).pathname, body }) + "\n");
      const item = answer(body);
      const usage = { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 };
      const events = [{ type: "response.created", response: { id: "resp_stub" } }, { type: "response.output_item.added", output_index: 0, item }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "resp_stub", usage } }];
      return new Response(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });
}
