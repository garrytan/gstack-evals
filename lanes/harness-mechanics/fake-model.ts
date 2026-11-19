// Copyright (c) 2026 Garry Tan. MIT License.
// The stub model for the harness mechanics scripted sessions (dry-run steps 1 and 2): quick/laneb's fake upstream with a
// script chosen by a [hm-script <mode>] marker in the task text. Every script reads calc.py, edits it with the Edit tool
// and ends its turn with no check after the edit. stop ends with STATUS: FIXED on every stop; waive runs the waiver the
// Stop hook's block text names once the block reaches it, then stops; blocked ends with STATUS: BLOCKED; reread reads the
// installed verify/SKILL.md after the edit, then stops. D2's step uses one more script, cmds, which runs each [hm-cmd] of the
// task text (base64) through the Bash tool in order and then stops. It logs every request body it answers (one JSON line each), so a
// session's loaded memory and first request can be checked. It never sees a key.
//
//   bun lanes/harness-mechanics/fake-model.ts <port> <request log> <body log>
import { appendFileSync } from "node:fs";
import { startFakeUpstream, toolResults, type Block } from "../../quick/laneb/runner/fake_upstream.ts";

export const MODES = ["stop", "waive", "blocked", "reread"] as const;
export type Mode = (typeof MODES)[number];
export const BLOCK_MARK = "SKILL_CONTRACT_UNMET";
export const FINAL_DELAY_MS = 1500;
export const VERIFY_READ = "/root/.claude/skills/gstack/verify/SKILL.md";

const textOf = (m: any): string => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((b: any) => b.text ?? "").join("\n"));

export function scriptTurn(body: any): Block[] {
  const seen = (body.messages ?? []).map((m: any) => textOf(m) + JSON.stringify(toolResults([m]))).join("\n");
  const mode = (/\[hm-script (\w+)\]/.exec(seen)?.[1] ?? "stop") as Mode;
  const r = toolResults(body.messages);
  // D2's live-session step: run each [hm-cmd <base64>] of the task text through the Bash tool in order, then stop.
  const first = textOf((body.messages ?? []).find((m: any) => m.role === "user"));
  if (first.includes("[hm-script cmds]")) {
    const cmds = [...first.matchAll(/\[hm-cmd ([A-Za-z0-9+/=]+)\]/g)].map((m) => atob(m[1]!));
    const i = cmds.findIndex((_, k) => !(("toolu_hm_c" + k) in r));
    if (i < 0) return [{ type: "text", text: "Ran the commands.\nSTATUS: DONE" }];
    return [{ type: "tool_use", id: "toolu_hm_c" + i, name: "Bash", input: { command: cmds[i], description: "hm cmd " + i, timeout: 600000 } }];
  }
  if (!("toolu_hm_read" in r)) return [{ type: "tool_use", id: "toolu_hm_read", name: "Read", input: { file_path: "/testbed/calc.py" } }];
  if (!("toolu_hm_edit" in r)) return [{ type: "tool_use", id: "toolu_hm_edit", name: "Edit", input: { file_path: "/testbed/calc.py", old_string: "return a - b", new_string: "return a + b" } }];
  if (mode === "reread" && !("toolu_hm_reread" in r)) return [{ type: "tool_use", id: "toolu_hm_reread", name: "Read", input: { file_path: VERIFY_READ } }];
  if (mode === "waive" && seen.includes(BLOCK_MARK) && !("toolu_hm_waive" in r)) {
    const bin = /run '((?:[^']|'\\'')+)' waive/.exec(seen)?.[1]?.replaceAll("'\\''", "'") ?? "gstack-skill-contract";
    return [{ type: "tool_use", id: "toolu_hm_waive", name: "Bash", input: { command: `'${bin}' waive check-after-edit --reason "the fixture has no test suite"`, description: "Waive the check" } }];
  }
  if (mode === "blocked") return [{ type: "text", text: "I changed add() but cannot run anything here.\nSTATUS: BLOCKED" }];
  return [{ type: "text", text: "Changed add() in calc.py to return a + b.\nSTATUS: FIXED" }];
}

if (import.meta.main) {
  const [port, reqLog, bodyLog] = process.argv.slice(2);
  if (!port || !reqLog || !bodyLog) { console.error("E_USAGE usage: fake-model.ts <port> <request log> <body log>"); process.exit(2); }
  const s = startFakeUpstream(Number(port), reqLog, (body) => {
    const blocks = scriptTurn(body);
    // A final reply waits like a model would, so Claude Code has written the last tool call to its transcript before the
    // Stop hook reads it. At stub speed the hook once read the transcript before the waiver landed and recorded a miss.
    if (blocks.every((b) => b.type === "text")) Bun.sleepSync(FINAL_DELAY_MS);
    appendFileSync(bodyLog, JSON.stringify({ session: /\[hm-session ([\w-]+)\]/.exec(textOf((body.messages ?? []).find((m: any) => m.role === "user")))?.[1] ?? null, system: body.system, messages: body.messages, reply: blocks }) + "\n");
    return blocks;
  });
  console.log(`hm fake model on 127.0.0.1:${s.port}`);
}
