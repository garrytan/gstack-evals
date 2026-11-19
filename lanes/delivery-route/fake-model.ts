// Copyright (c) 2026 Garry Tan. MIT License.
// The stub model for B1's scripted sessions (sessions.ts): quick/laneb's fake upstream with a script chosen by a
// [b1-script <mode>] marker in the task text. The task is calc.py's add(), which returns a - b. Each script is a fixed list
// of tool calls, sent one per turn until each has a result, then a closing STATUS line. The scripts drive the detector both
// ways on real Claude Code output (prove, bash, background: followed; stop, late, nofail: not), run the gstack-shaped
// preamble's three gstack commands as the skill writes them (setup), and open the described skill through the Skill tool (skill), or B1b's prove-it skill (load).
// B1d adds two: open gstack's /verify through the Skill tool (verify), and run a git reset --hard that gstack's destructive
// guard asks about, between an edit and a status count (guard). It logs every request body it answers,
// so a session's first request can be checked. It never sees a key.
//
//   bun lanes/delivery-route/fake-model.ts <port> <request log> <body log>
import { appendFileSync } from "node:fs";
import { startFakeUpstream, toolResults, type Block } from "../../quick/laneb/runner/fake_upstream.ts";
import { DESCRIBED_SKILL, SKILL } from "./pins.ts";

export const MODES = ["stop", "prove", "bash", "late", "nofail", "background", "setup", "skill", "load", "verify", "guard"] as const;
export type Mode = (typeof MODES)[number];
const T = "/testbed";
const TEST = T + "/tests/test_calc.py";
const test = (a: number, b: number, sum: number) => "import unittest\nfrom calc import add\n\n\nclass AddTest(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(" + a + ", " + b + "), " + sum + ")\n";
const RUN = "cd " + T + " && python3 -m unittest tests.test_calc";
const DISCOVER = "cd " + T + " && python3 -m unittest discover -s tests -v";
type Step = { name: string; input: unknown } | ((r: Record<string, string>) => { name: string; input: unknown });
const read = { name: "Read", input: { file_path: T + "/calc.py" } };
const edit = { name: "Edit", input: { file_path: T + "/calc.py", old_string: "return a - b", new_string: "return a + b" } };
const write = (a: number, b: number, sum: number) => ({ name: "Write", input: { file_path: TEST, content: test(a, b, sum) } });
const bash = (command: string, extra: Record<string, unknown> = {}) => ({ name: "Bash", input: { command, description: "b1 step", ...extra } });
export const SCRIPTS: Record<Mode, Step[]> = {
  stop: [read, edit],
  prove: [read, write(2, 3, 5), bash(RUN), edit, bash(RUN)],
  bash: [read, bash("mkdir -p " + T + "/tests && cat > " + TEST + " <<'EOF'\n" + test(2, 3, 5) + "EOF"), bash(DISCOVER), bash("cd " + T + " && sed -i 's/return a - b/return a + b/' calc.py"), bash(DISCOVER)],
  late: [read, edit, write(2, 3, 5), bash(RUN)],
  nofail: [read, write(0, 0, 0), bash(RUN), edit, bash(RUN)],
  background: [read, write(2, 3, 5), bash(RUN + " > /tmp/b1-run.log 2>&1; cat /tmp/b1-run.log", { run_in_background: true }), bash("sleep 3"),
    (r) => { const f = /Output is being written to: (\S+?)\.?(?:\s|$)/.exec(Object.values(r).join("\n"))?.[1] ?? "/nonexistent"; return { name: "Read", input: { file_path: f } }; }, edit, bash(RUN)],
  setup: [bash("~/.claude/skills/gstack/bin/gstack-skill-start --skill \"" + SKILL + "\" --model \"claude\""),
    bash("~/.claude/skills/gstack/bin/gstack-learnings-log '{\"skill\":\"" + SKILL + "\",\"type\":\"operational\",\"key\":\"b1-session\",\"insight\":\"The preamble ran.\",\"confidence\":5,\"source\":\"observed\"}'"),
    bash("~/.claude/skills/gstack/bin/gstack-skill-end --skill \"" + SKILL + "\" --outcome success --session-id \"b1-session\" --tel-start \"$(date +%s)\" --used-browse no --error-message \"\" --failed-step \"\" 2>/dev/null || true")],
  skill: [{ name: "Skill", input: { skill: DESCRIBED_SKILL } }],
  load: [{ name: "Skill", input: { skill: SKILL } }],
  verify: [{ name: "Skill", input: { skill: "verify" } }],
  guard: [bash("cd " + T + " && echo '# b1d' >> calc.py"), bash("cd " + T + " && git reset --hard"), bash("cd " + T + " && git status --porcelain | wc -l")],
};
const textOf = (m: any): string => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((b: any) => b.text ?? "").join("\n"));

export function scriptTurn(body: any): Block[] {
  const first = (body.messages ?? []).map((m: any) => textOf(m)).join("\n");
  const mode = (/\[b1-script (\w+)\]/.exec(first)?.[1] ?? "stop") as Mode;
  const r = toolResults(body.messages);
  const steps = SCRIPTS[mode] ?? SCRIPTS.stop;
  const i = steps.findIndex((_, k) => !(("toolu_b1_" + k) in r));
  if (i < 0) return [{ type: "text", text: "Changed add() in calc.py to return a + b.\nSTATUS: FIXED" }];
  const s = steps[i]!, step = typeof s === "function" ? s(r) : s;
  return [{ type: "tool_use", id: "toolu_b1_" + i, name: step.name, input: step.input }];
}

if (import.meta.main) {
  const [port, reqLog, bodyLog] = process.argv.slice(2);
  if (!port || !reqLog || !bodyLog) { console.error("E_USAGE usage: fake-model.ts <port> <request log> <body log>"); process.exit(2); }
  const s = startFakeUpstream(Number(port), reqLog, (body) => {
    const blocks = scriptTurn(body);
    appendFileSync(bodyLog, JSON.stringify({ session: /\[b1-session ([\w-]+)\]/.exec(textOf((body.messages ?? []).find((m: any) => m.role === "user")))?.[1] ?? null, system: body.system, tools: (body.tools ?? []).map((t: any) => ({ name: t.name, description: t.description })), messages: body.messages, reply: blocks }) + "\n");
    return blocks;
  });
  console.log("b1 fake model on 127.0.0.1:" + s.port);
}
