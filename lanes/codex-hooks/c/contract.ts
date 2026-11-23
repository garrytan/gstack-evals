// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.6's exposure readout and pre-run change 1's pilot flags, per part C session.
//
// From gstack's contract log ($GSTACK_STATE_ROOT/hooks/skill-contract.log, copied to host/gstack-hooks/), the root
// thread's lines only (sub-agents log under their own session ids, as codex-subagent):
// - stops: one per Stop hook run. A run that logs agents-stalled goes on to log its outcome in the same run, so
//   agents-stalled lines are not counted as stops.
// - evaluated: stops whose line is a contract outcome (blocked, miss, met, met_after_block, met_waived, unchanged) or
//   stop-hook-active (an outcome that would block, held because Codex says the stop hook already fired). no-contract-skill,
//   not-final-turn and agents-running are stops the contract did not evaluate; state-error is a fail-open.
// - blocked and items: the blocked lines and the union of the items they name as missing.
//
// The independent check reads the root rollout in order. The adversarial pass is a spawn_agent call in any namespace whose
// message holds gstack's marker, or a code-mode exec cell whose input calls spawn_agent and holds the marker. The report is
// an assistant message holding the "Pre-Landing Review" heading and the "Gate edits" label. At each contract block the
// check notes whether both came before it; a false block is a block before which both did. would_block says whether the
// contract would have blocked at the session's first stop (the first block, or the session's end when nothing blocked):
// the pass or the report is missing before it. On c-off that counts the sessions the contract would have blocked.
//
// Pilot flags (pre-run change 1, sections 6, 7 and 10):
// - Every read of a SKILL.md, by tool and shape. Flagged: a sed range that quits early; a read inside bash -c or sh -c,
//   or through <, whose call exits non-zero with no output text. A direct shell call's exit status is in its output; a
//   code-mode cell's nested calls report none, so such a read in a cell is flagged with exit null.
// - spawn_agent calls outside the multi_agent_v1 and collaboration namespaces, or with none.
// - Sub-agents on another model: a spawn_agent model argument, or a sub-agent thread whose turns ran another model.
// - spawn_agent calls that do not pass fork_turns "none", and calls that pass a reasoning_effort.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GATE_LABEL, MARKER, MODEL, REPORT_HEADING } from "./pins.ts";
import { blockIndexes, type Item, type SessionRollouts, type Thread } from "./rollout.ts";

export const EVALUATED: ReadonlySet<string> = new Set(["blocked", "miss", "met", "met_after_block", "met_waived", "unchanged", "stop-hook-active"]);
const KNOWN_NAMESPACES: ReadonlySet<string> = new Set(["multi_agent_v1", "collaboration"]);
const SHELL_TOOLS: ReadonlySet<string> = new Set(["exec_command", "shell", "shell_command", "local_shell"]);

export interface LogLine {
  ts: string;
  session: string;
  event: string;
  fields: Record<string, string>;
}

/** gstack's hook trace lines: <ts> session=<id> key=value ..., a value in double quotes when it holds spaces. */
export function parseHookLog(text: string): LogLine[] {
  const out: LogLine[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\S+) (.*)$/.exec(line.trim());
    if (!m) continue;
    const fields: Record<string, string> = {};
    for (const f of m[2]!.matchAll(/([a-z_]+)=("(?:[^"\\]|\\.)*"|\S*)/g)) fields[f[1]!] = f[2]!.startsWith('"') ? f[2]!.slice(1, -1).replace(/\\(.)/g, "$1") : f[2]!;
    if (fields.session === undefined || fields.event === undefined) continue;
    out.push({ ts: m[1]!, session: fields.session, event: fields.event, fields });
  }
  return out;
}

export interface Spawn {
  line: number;
  via: "direct" | "code-mode";
  namespace: string | null;
  marker: boolean;
  fork_turns: string | null;
  model: string | null;
  reasoning_effort: string | null;
}

export interface SkillRead {
  line: number;
  via: "direct" | "code-mode";
  shape: "sed-quit" | "shell-c" | "redirect" | "plain";
  command: string;
  exit: number | null;
  text: boolean | null;
  flagged: boolean;
}

export interface Exposure {
  log: { present: boolean; stops: number; evaluated: number; events: Record<string, number>; blocked: number; items: string[]; fail_open: number; every_stop_evaluated: boolean };
  rollout_blocks: number;
  pass: "before" | "after_block" | "never";
  report: boolean;
  false_blocks: number;
  would_block: boolean;
  spawns: Spawn[];
}

export interface Flags {
  reads: SkillRead[];
  unknown_namespace: number;
  other_model: { thread: string; model: string; via: "spawn" | "turn" }[];
  fork_not_none: number;
  effort_override: number;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The spawn_agent calls of a thread: direct calls in any namespace, and code-mode cells whose input calls spawn_agent. */
export function spawns(t: Thread): Spawn[] {
  const out: Spawn[] = [];
  for (const x of t.items) {
    if (x.kind !== "call") continue;
    if (x.type === "function_call" && x.name === "spawn_agent") {
      const a = x.args ?? {};
      const message = [str(a.message), ...(Array.isArray(a.items) ? a.items.map((i: any) => str(i?.text)) : [])].filter((s): s is string => s !== null).join("\n");
      out.push({ line: x.line, via: "direct", namespace: x.namespace, marker: message.includes(MARKER), fork_turns: str(a.fork_turns), model: str(a.model), reasoning_effort: str(a.reasoning_effort) });
    } else if (x.type === "custom_tool_call" && x.name === "exec" && x.input !== null && /\bspawn_agent\b/.test(x.input)) {
      const fork = /fork_turns\s*:\s*["']([a-z]+)["']/.exec(x.input);
      const model = /\bmodel\s*:\s*["']([^"']+)["']/.exec(x.input);
      const effort = /reasoning_effort\s*:\s*["']([a-z]+)["']/.exec(x.input);
      out.push({ line: x.line, via: "code-mode", namespace: null, marker: x.input.includes(MARKER), fork_turns: fork?.[1] ?? null, model: model?.[1] ?? null, reasoning_effort: effort?.[1] ?? null });
    }
  }
  return out;
}

const isPass = (x: Item, s: Spawn[]): boolean => x.kind === "call" && s.some((p) => p.line === x.line && p.marker);
const isReport = (x: Item): boolean => x.kind === "message" && x.role === "assistant" && x.text.includes(REPORT_HEADING) && x.text.includes(GATE_LABEL);

/** Section 5.6 for one session: the contract log's root lines and the independent check over the root rollout. */
export function exposure(r: SessionRollouts, logText: string | null): Exposure {
  const root = r.root;
  const lines = logText === null || !root ? [] : parseHookLog(logText).filter((l) => l.session === root.id);
  const events: Record<string, number> = {};
  for (const l of lines) events[l.event] = (events[l.event] ?? 0) + 1;
  const stopLines = lines.filter((l) => l.event !== "agents-stalled");
  const blockedLines = lines.filter((l) => l.event === "blocked");
  const items = [...new Set(blockedLines.flatMap((l) => (l.fields.missing && l.fields.missing !== "-" ? l.fields.missing.split(",") : [])))].sort();
  const evaluated = stopLines.filter((l) => EVALUATED.has(l.event)).length;
  const log = { present: logText !== null, stops: stopLines.length, evaluated, events, blocked: blockedLines.length, items, fail_open: lines.filter((l) => l.event === "state-error").length, every_stop_evaluated: stopLines.length > 0 && evaluated === stopLines.length };
  if (!root) return { log, rollout_blocks: 0, pass: "never", report: false, false_blocks: 0, would_block: true, spawns: [] };
  const s = spawns(root);
  const blocks = blockIndexes(root);
  const seen = (end: number) => ({ pass: root.items.slice(0, end).some((x) => isPass(x, s)), report: root.items.slice(0, end).some(isReport) });
  const first = blocks[0] ?? root.items.length;
  const atFirst = seen(first);
  const anyPass = root.items.some((x) => isPass(x, s));
  return {
    log,
    rollout_blocks: blocks.length,
    pass: atFirst.pass ? "before" : anyPass ? "after_block" : "never",
    report: root.items.some(isReport),
    false_blocks: blocks.filter((b) => {
      const at = seen(b);
      return at.pass && at.report;
    }).length,
    would_block: !(atFirst.pass && atFirst.report),
    spawns: s,
  };
}

const READ_PROGRAM = /(?:^|[\s;|&(\x60'"])(?:cat|sed|head|tail|nl|less|more|bat|awk)(?=\s)/;
const SED_QUIT = /\bsed\s+-n\s+['"]?\d+,\d+p\s*;\s*\d+q/;
const SHELL_C = /\b(?:bash|sh)\s+-l?c\b/;
const REDIRECT = /<\s*['"]?[^\s'"<>]*SKILL\.md/;
const EXIT = /(?:^|\n)Process exited with code (\d+)/;

const shellLine = (args: Record<string, unknown> | null): string | null => {
  const c = args?.cmd ?? args?.command;
  return typeof c === "string" ? c : Array.isArray(c) && c.every((w) => typeof w === "string") ? c.join(" ") : null;
};

/** The quoted cmd strings a code-mode cell passes to exec_command, as written in its JavaScript. */
export function cellCommands(input: string): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(/exec_command\s*\(\s*(?:\{[^}]*?\bcmd\s*:\s*)?("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60)/g)) {
    const q = m[1]!;
    out.push(q.slice(1, -1).replace(/\\(.)/g, "$1"));
  }
  return out;
}

function readOf(command: string, line: number, via: SkillRead["via"], output: string | null): SkillRead | null {
  if (!/SKILL\.md/.test(command) || !(READ_PROGRAM.test(command) || REDIRECT.test(command))) return null;
  const shape: SkillRead["shape"] = SED_QUIT.test(command) ? "sed-quit" : SHELL_C.test(command) ? "shell-c" : REDIRECT.test(command) ? "redirect" : "plain";
  const code = output === null ? null : EXIT.exec(output);
  const exit = code ? Number(code[1]) : null;
  const text = output === null || !code ? null : (output.split(/Output:\n/)[1] ?? "").trim() !== "";
  const silentFail = via === "code-mode" ? true : exit !== null && exit !== 0 && text === false;
  return { line, via, shape, command, exit, text, flagged: shape === "sed-quit" || ((shape === "shell-c" || shape === "redirect") && silentFail) };
}

/** Pre-run change 1's pilot flags for one session. */
export function pilotFlags(r: SessionRollouts): Flags {
  const reads: SkillRead[] = [];
  const root = r.root;
  if (root) {
    const outputs = new Map(root.items.flatMap((x) => (x.kind === "output" ? [[x.call_id, x.text] as const] : [])));
    for (const x of root.items) {
      if (x.kind !== "call") continue;
      if (x.type === "function_call" && SHELL_TOOLS.has(x.name)) {
        const c = shellLine(x.args);
        const got = c === null ? null : readOf(c, x.line, "direct", outputs.get(x.call_id) ?? null);
        if (got) reads.push(got);
      } else if (x.type === "custom_tool_call" && x.name === "exec" && x.input !== null) {
        for (const c of cellCommands(x.input)) {
          const got = readOf(c, x.line, "code-mode", null);
          if (got) reads.push(got);
        }
      }
    }
  }
  const all = [root, ...r.subs].filter((t): t is Thread => t !== null).flatMap((t) => spawns(t).map((s) => ({ t, s })));
  const other_model: Flags["other_model"] = [
    ...all.filter(({ s }) => s.model !== null && s.model !== MODEL).map(({ t, s }) => ({ thread: t.id, model: s.model!, via: "spawn" as const })),
    ...r.subs.flatMap((t) => [...new Set(t.turns.map((x) => x.model).filter((m): m is string => m !== null && m !== MODEL))].map((model) => ({ thread: t.id, model, via: "turn" as const }))),
  ];
  return {
    reads,
    unknown_namespace: all.filter(({ s }) => s.via === "direct" && (s.namespace === null || !KNOWN_NAMESPACES.has(s.namespace))).length,
    other_model,
    fork_not_none: all.filter(({ s }) => s.fork_turns !== "none").length,
    effort_override: all.filter(({ s }) => s.reasoning_effort !== null).length,
  };
}

/** The contract log a session's host dir holds, or null when the hooks wrote none. */
export const readContractLog = (hostDir: string): string | null => {
  const f = join(hostDir, "gstack-hooks", "skill-contract.log");
  return existsSync(f) ? readFileSync(f, "utf8") : null;
};
