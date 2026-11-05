// The stub model for R3c's keyless capture (r3/r3c-capture.sh): fake_upstream.ts's server with a script that writes the
// three kinds of assistant text R3c's closing-block reader must tell apart, through the real Claude Code and Agent SDK. On
// the main thread it opens with a thinking block that holds a ROOT CAUSE FILES block naming a wrong file, fixes the task
// with one Bash call, starts one subagent whose only text is another ROOT CAUSE FILES block naming a second wrong file,
// then ends its turn with a DEBUG REPORT followed by the closing block naming calc.py. A task whose instruction holds
// STOP_UNMET_FIRST first ends with the closing block and no DEBUG REPORT, which the told arm's contract Stop hook must
// refuse; once the hook's refusal reaches it, it ends with the DEBUG REPORT alone, so the only closing block comes before
// the hook's continuation. A task whose instruction holds NO_MAIN_BLOCK ends with the DEBUG REPORT alone, so its only
// closing blocks are the thinking block's and the subagent's, which a reader must not take. It never sees a key and makes
// no network call.
import { startFakeUpstream, toolResults, type Block } from "./fake_upstream.ts";
import { BLOCK_TEXT, REPORT, UNMET_MARKER } from "./fake_upstream_contract.ts";

export const SUBAGENT_MARKER = "R3C_SUBAGENT_PROBE";
export const NO_MAIN_MARKER = "NO_MAIN_BLOCK";
export const WRONG = { thinking: "wrong_thinking.py", subagent: "wrong_subagent.py" };
const block = (file: string) => "ROOT CAUSE FILES\n" + file;

export function r3cTurn(body: any): Block[] {
  const first = JSON.stringify(body.messages?.[0]?.content ?? "");
  if (first.includes(SUBAGENT_MARKER)) return [{ type: "text", text: "Checked calc.py for the probe.\n\n" + block(WRONG.subagent) }];
  const r = toolResults(body.messages), names: string[] = (body.tools ?? []).map((t: any) => t.name);
  if (!("toolu_fix_1" in r)) return [{ type: "thinking", thinking: "Planning the fix.\n\n" + block(WRONG.thinking) }, { type: "tool_use", id: "toolu_fix_1", name: "Bash", input: { command: "sed -i 's/return a - b/return a + b/' calc.py && python3 -c 'import calc; print(calc.add(2, 3))'", description: "Fix add and check it" } }];
  const task = names.includes("Task") ? "Task" : names.includes("Agent") ? "Agent" : null;
  if (task && !("toolu_sub_1" in r)) return [{ type: "tool_use", id: "toolu_sub_1", name: task, input: { description: "Probe calc.py", prompt: SUBAGENT_MARKER + ": read calc.py and report the file that holds the bug.", subagent_type: "general-purpose" } }];
  const seen = JSON.stringify(body.messages ?? []);
  if (seen.includes(UNMET_MARKER) && !seen.includes(BLOCK_TEXT)) return [{ type: "text", text: "Fixed add() in calc.py.\n\n" + block("calc.py") }];
  if (seen.includes(UNMET_MARKER) || first.includes(NO_MAIN_MARKER)) return [{ type: "text", text: REPORT }];
  return [{ type: "text", text: REPORT + "\n\n" + block("calc.py") }];
}

if (import.meta.main) {
  const s = startFakeUpstream(undefined, undefined, r3cTurn);
  console.log("fake r3c upstream on 127.0.0.1:" + s.port);
}
