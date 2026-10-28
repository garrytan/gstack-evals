export interface Task {
  id: string;
  prompt: string;
  setup?: string;
  must?: string[];
  must_not?: string[];
  check?: string;
  safety?: boolean;
}

export interface Transcript {
  assistantTexts: string[];
  askTexts: string[];
  finalAnswer: string;
  toolUses: ToolUse[];
  subagentToolUses: ToolUse[];
}

export interface ToolUse {
  name: string;
  input: any;
  id?: string;
  ok: boolean;
}

// A tool call counts as done only when a tool_result without is_error answers its id. subagentToolUses repeats the
// calls made inside a subagent (parent_tool_use_id set), so they can be counted apart.
export function parseTranscript(messages: any[]): Transcript {
  const assistantTexts: string[] = [];
  const askTexts: string[] = [];
  const toolUses: ToolUse[] = [];
  const subagentToolUses: ToolUse[] = [];
  const done = new Map<string, boolean>();
  for (const m of messages) {
    if (m?.type !== "user" || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content) if (b?.type === "tool_result") done.set(b.tool_use_id, !b.is_error);
  }
  let finalAnswer = "";
  for (const m of messages) {
    if (m?.type !== "assistant") continue;
    const content = m.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        assistantTexts.push(b.text);
        finalAnswer = b.text;
      } else if (b?.type === "tool_use") {
        const u = { name: b.name, input: b.input, id: b.id, ok: done.get(b.id) === true };
        toolUses.push(u);
        if (m.parent_tool_use_id) subagentToolUses.push(u);
        if (b.name === "AskUserQuestion") {
          for (const q of b.input?.questions ?? []) {
            askTexts.push([q.question ?? "", q.header ?? "", ...(q.options ?? []).map((o: any) => `${o.label ?? ""}: ${o.description ?? ""}`)].join("\n"));
          }
        }
      }
    }
  }
  return { assistantTexts, askTexts, finalAnswer, toolUses, subagentToolUses };
}

export function codeBlocks(text: string): string[] {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
}

export interface PatternGrade {
  must: { pattern: string; hit: boolean }[];
  mustNot: { pattern: string; hit: boolean }[];
  ok: boolean;
}

export function gradePatterns(task: Task, text: string): PatternGrade {
  const must = (task.must ?? []).map((p) => ({ pattern: p, hit: new RegExp(p).test(text) }));
  const blocks = codeBlocks(text).join("\n");
  const mustNot = (task.must_not ?? []).map((p) => ({ pattern: p, hit: new RegExp(p).test(blocks) }));
  return { must, mustNot, ok: must.every((m) => m.hit) && mustNot.every((m) => !m.hit) };
}

export function transcriptText(t: Transcript): string {
  return [...t.assistantTexts, ...t.askTexts].join("\n\n");
}

export interface SkillUse {
  opened: boolean;
  how: string[];
  files: Record<string, number>;
}

const SKILLS_ROOT = /\.claude\/skills\/(?:gstack\/)?([A-Za-z0-9._-]+\/[^\s'"`]+?\.md)\b/g;

export function skillUse(t: Pick<Transcript, "toolUses">, skill: string): SkillUse {
  const files: Record<string, number> = {};
  const how: string[] = [];
  const bump = (f: string) => (files[f] = (files[f] ?? 0) + 1);
  for (const u of t.toolUses) {
    if (!u.ok) continue;
    if (u.name === "Skill") {
      const s = String(u.input?.skill ?? u.input?.command ?? "").replace(/^\//, "");
      if (s === skill || s.endsWith(`:${skill}`)) {
        how.push("Skill");
        bump(`${skill}/SKILL.md`);
      }
    } else if (u.name === "Read") {
      const p = String(u.input?.file_path ?? "");
      for (const m of p.matchAll(SKILLS_ROOT)) {
        bump(m[1]!);
        if (m[1] === `${skill}/SKILL.md`) how.push("Read");
      }
    } else if (u.name === "Bash") {
      const c = String(u.input?.command ?? "");
      if (!/\b(cat|head|tail|sed|less|more|awk)\b/.test(c)) continue;
      for (const m of c.matchAll(SKILLS_ROOT)) {
        bump(m[1]!);
        if (m[1] === `${skill}/SKILL.md`) how.push("Bash");
      }
    }
  }
  return { opened: how.length > 0, how, files };
}

export function loadedBytes(files: Record<string, number>, sizes: Record<string, number>): { unique: number; total: number; unknown: string[] } {
  let unique = 0;
  let total = 0;
  const unknown: string[] = [];
  for (const [f, n] of Object.entries(files)) {
    const s = sizes[f];
    if (s === undefined) {
      unknown.push(f);
      continue;
    }
    unique += s;
    total += s * n;
  }
  return { unique, total, unknown };
}

// How one SDK result message ends a session: a budget refusal and the agent-turn limit are intended stops and keep the
// cell; any other error result is an infrastructure failure and makes the cell missing.
export function resultOutcome(m: { subtype?: string; is_error?: boolean }, budgetHit: boolean): { stop: boolean; infra: boolean; reason: string } {
  if (budgetHit) return { stop: true, infra: false, reason: "budget" };
  if (m.subtype === "error_max_turns") return { stop: true, infra: false, reason: "max_turns" };
  if (m.subtype !== "success" || m.is_error) return { stop: true, infra: true, reason: `result_${m.subtype}` };
  return { stop: false, infra: false, reason: "" };
}
