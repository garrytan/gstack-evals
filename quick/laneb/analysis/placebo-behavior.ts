// Placebo-behavior coding for the explicit-invocation run.
//
// Unit redefinition (supersedes prereg 1's "first skill open" unit, which no longer exists under
// explicit invocation: the body is in context from turn 1, so there is nothing to open). The unit is
// each invoked trial (gstack and placebo arms). The window runs from the first assistant message to the
// third tool call after it, inclusive, and covers every assistant text block in between. The ordered
// categories and the dismisses/cites regexes are byte-identical to the frozen prereg-1 coding. Needs the
// Captain's re-freeze before any paid call.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const CATEGORIES = ["ends", "opens_another", "dismisses", "cites", "continues"] as const;
export type Category = (typeof CATEGORIES)[number];

// Byte-identical to analysis/analyze.ts: a skill open is the Skill tool, or a Read/cat/head/less/sed/tail/grep
// of a /.claude/skills/<name>/SKILL.md path.
const SKILL_PATH = /\/\.claude\/skills\/([^/\s"']+)\/SKILL\.md/;

// Frozen regexes (prereg 1); kept byte-for-byte.
export const DISMISSES = /not (very )?(helpful|useful|relevant|applicable)|(does ?n[o']t|did ?n[o']t|won'?t) (help|apply)|is ?n[o']t (helpful|useful|relevant|applicable)|no (actionable|concrete|specific|useful) (steps|guidance|instructions|procedure|content)|too (vague|generic)|nothing (useful|actionable)|(generic|general) (advice|guidance|prose)/i;
export const CITES = /(the|this) skill (says|suggests|recommends|advises)|(following|per|according to) the skill|as the skill (says|suggests)/i;

type Block = { name?: unknown; input?: any; text?: unknown };
type Event = { kind: "tool"; block: Block } | { kind: "text"; text: string };

function isSkillOpen(block: Block): boolean {
  const name = block.name;
  const input = block.input ?? {};
  if (name === "Skill") return true;
  if (name === "Read" && typeof input.file_path === "string") return SKILL_PATH.test(input.file_path);
  if (name === "Bash" && typeof input.command === "string") return SKILL_PATH.test(input.command) && /\b(cat|head|less|sed|tail|grep)\b/.test(input.command);
  return false;
}

// Flatten an SDK message log into assistant text and tool-use events, in order, from the first assistant
// message onward. Tool results (UserMessage) carry no assistant text and no tool calls, so they are skipped.
export function eventsFromMessages(lines: string[]): Event[] {
  const out: Event[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== "AssistantMessage" || !Array.isArray(rec.content)) continue;
    for (const block of rec.content) {
      if (!block || typeof block !== "object") continue;
      if (typeof block.name === "string") out.push({ kind: "tool", block });
      else if (typeof block.text === "string") out.push({ kind: "text", text: block.text });
    }
  }
  return out;
}

export type Coding = { category: Category; quote: string | null };

export function codeTrial(lines: string[]): Coding {
  const events = eventsFromMessages(lines);
  const toolIdx = events.map((e, i) => (e.kind === "tool" ? i : -1)).filter((i) => i >= 0);
  if (toolIdx.length === 0) {
    const firstText = events.find((e) => e.kind === "text") as Extract<Event, { kind: "text" }> | undefined;
    return { category: "ends", quote: firstText ? firstText.text.slice(0, 200) : null };
  }
  const firstThree = toolIdx.slice(0, 3).map((i) => (events[i] as Extract<Event, { kind: "tool" }>).block);
  if (firstThree.some(isSkillOpen)) return { category: "opens_another", quote: null };
  const windowEnd = toolIdx[Math.min(2, toolIdx.length - 1)];
  const windowText = events
    .slice(0, windowEnd + 1)
    .filter((e): e is Extract<Event, { kind: "text" }> => e.kind === "text")
    .map((e) => e.text)
    .join("\n");
  const dm = DISMISSES.exec(windowText);
  if (dm) return { category: "dismisses", quote: windowText.slice(dm.index, dm.index + 200) };
  const cm = CITES.exec(windowText);
  if (cm) return { category: "cites", quote: windowText.slice(cm.index, cm.index + 200) };
  return { category: "continues", quote: windowText.slice(0, 200) || null };
}

// Aggregate a run's invoked trials into per (model, arm) category counts with up to three quotes each,
// taken in trial-name order. A trial is read from its Harbor directory (config.json for model and arm,
// agent/sdk-messages.jsonl for the log).
export type Aggregate = Record<string, { counts: Record<Category, number>; quotes: Record<Category, string[]> }>;

export function aggregate(trials: { model: string; arm: string; trialName: string; lines: string[] }[]): Aggregate {
  const out: Aggregate = {};
  for (const t of [...trials].sort((a, b) => a.trialName.localeCompare(b.trialName))) {
    if (t.arm !== "gstack" && t.arm !== "placebo") continue;
    const key = `${t.model}|${t.arm}`;
    out[key] ??= {
      counts: { ends: 0, opens_another: 0, dismisses: 0, cites: 0, continues: 0 },
      quotes: { ends: [], opens_another: [], dismisses: [], cites: [], continues: [] },
    };
    const { category, quote } = codeTrial(t.lines);
    out[key].counts[category] += 1;
    if (quote && out[key].quotes[category].length < 3) out[key].quotes[category].push(quote);
  }
  return out;
}

function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

if (import.meta.main) {
  const jobDirs = Bun.argv.slice(2);
  if (!jobDirs.length) throw new Error("E_USAGE usage: placebo-behavior.ts <job dir> [<job dir> ...]");
  const trials: { model: string; arm: string; trialName: string; lines: string[] }[] = [];
  for (const job of jobDirs) {
    for (const name of readdirSync(job)) {
      const dir = join(job, name);
      if (!statSync(dir).isDirectory()) continue;
      const config = readJson(join(dir, "config.json"));
      if (!config) continue;
      const kwargs = config.agent?.kwargs ?? {};
      const msgs = join(dir, "agent", "sdk-messages.jsonl");
      trials.push({
        model: String(kwargs.upstream_model ?? config.agent?.model_name ?? "?"),
        arm: String(kwargs.arm ?? "?"),
        trialName: name,
        lines: existsSync(msgs) ? readFileSync(msgs, "utf8").split("\n") : [],
      });
    }
  }
  console.log(JSON.stringify(aggregate(trials), null, 2));
}
