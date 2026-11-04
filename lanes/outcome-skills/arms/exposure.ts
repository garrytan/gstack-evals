// The G exposure detectors (G admission prereg section 5; O1), built from gstack 699a41cb's own files, whose sha256s
// told.ts pins: plan-eng-review/SKILL.md and sections/review-sections.md for plan-eng-review; autoplan/SKILL.md,
// sections/phase-close.md and bin/gstack-autoplan-snapshot.ts for autoplan. A detector reads the session's own records
// in the skill turn only (phase t2, parent_tool_use_id null): its own text and its own tool calls with their results.
// Text the session never wrote (the injected skill body, a tool result, turn 1's plan, a subagent's output) never counts,
// and a call whose result is an error, or carries a tool_use_error tag, did not happen. Every check is reported; the read
// is exposed only when all pass, and failed names the first that did not.
import { readFileSync } from "node:fs";
import { AUTOPLAN_TOLD } from "./autoplan.ts";
import { loadRegistry, skillTurn } from "./registry.ts";

type Rec = Record<string, any>;
export type ExposureRead = { skill: string; exposed: boolean; failed: string | null; checks: Record<string, boolean>; phases?: string[] | null; published?: string[] };
type Use = { name: string; input: Rec; at: number; ok: boolean; result: string | null };

/** Reads a session record file (one JSON object per line). A torn last line is dropped and returned; any other bad line is refused. */
export function readTranscript(path: string): { records: Rec[]; torn: string | null } {
  const lines = readFileSync(path, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const records: Rec[] = [];
  let torn: string | null = null;
  for (const [i, line] of lines.entries()) {
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      rec = null;
    }
    if (rec && typeof rec === "object" && !Array.isArray(rec)) records.push(rec as Rec);
    else if (i === lines.length - 1) torn = line;
    else throw new Error("E_OUTCOME_TRANSCRIPT " + path + ": line " + (i + 1) + " is not a JSON object, and only a torn last line may be");
  }
  return { records, torn };
}

const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));
const json = (s: string | null): Rec | null => {
  try {
    const v = JSON.parse(s ?? "");
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

function own(records: Rec[], phase: string) {
  records.forEach((r, i) => {
    if ((r.type === "AssistantMessage" || r.type === "UserMessage") && !("phase" in r && "parent_tool_use_id" in r)) throw new Error("E_OUTCOME_TRANSCRIPT record " + (i + 1) + " (" + r.type + ") has no phase or parent_tool_use_id, so its turn and author are unknown");
  });
  const mine = records.map((r, at) => ({ r, at })).filter(({ r }) => r.phase === phase && r.parent_tool_use_id === null);
  const results = new Map<string, Rec>();
  for (const { r } of mine) if (r.type === "UserMessage" && Array.isArray(r.content)) for (const b of r.content) if (b?.type === "tool_result") results.set(b.tool_use_id, b);
  const uses: Use[] = [];
  const lines: { line: string; at: number }[] = [];
  for (const { r, at } of mine) {
    if (r.type !== "AssistantMessage" || !Array.isArray(r.content)) continue;
    for (const b of r.content) {
      if (b?.type === "text" && typeof b.text === "string") for (const line of b.text.split("\n")) lines.push({ line: line.trim(), at });
      if (b?.type !== "tool_use") continue;
      const res = results.get(b.id);
      const result = res ? text(res.content) : null;
      uses.push({ name: b.name, input: b.input ?? {}, at, ok: !!res && res.is_error !== true && !result!.includes("<tool_use_error>"), result });
    }
  }
  return { uses, lines, bash: uses.filter((u) => u.name === "Bash" && typeof u.input.command === "string") };
}

const read = (checks: Record<string, boolean>) => {
  const failed = Object.entries(checks).find(([, v]) => !v)?.[0] ?? null;
  return { exposed: failed === null, failed, checks };
};

let registry: ReturnType<typeof loadRegistry> | null = null;
const turnOf = (skill: string) => skillTurn((registry ??= loadRegistry()), skill + ":told")!;

const REVIEW_SECTIONS = /(?:^|\/)plan-eng-review\/sections\/review-sections\.md$/;
const REVIEW_SECTIONS_BASH = /^(?!.*\s--(?:help|version)(?![\w-]))\s*(?:cat|head|tail|nl|sed\s+-n\s+(["']?)[\d,$]*p\1)\s[^<>]*plan-eng-review\/sections\/review-sections\.md(?![\w.])/;
const SCOPE_CHALLENGE = [/^#{1,6}\s+(?:Step 0:\s*)?Scope Challenge\b/, /^\*\*(?:Step 0:\s*)?Scope Challenge\*\*/, /^-\s+Step 0:\s*Scope Challenge\b/];
const SECTIONS = ([["1", "architecture"], ["2", "code quality"], ["3", "tests?"], ["4", "performance"]] as const).map(([n, name]) => new RegExp("^(?:#{1,6}\\s+|\\*\\*)?(?:section\\s+" + n + "(?![\\d.])|" + n + "[.)]\\s+(?:" + name + ")\\b|(?:" + name + ")\\s+review\\b)", "i"));
const TEST_PLAN = /\/projects\/[^/]+\/[^/]+-eng-review-test-plan-[^/]+\.md$/;
const TEST_PLAN_BASH = /^(?:\$\{?PROJECT_DIR\}?|.*\/projects\/[^/]+)\/[^/]+-eng-review-test-plan-[^/]+\.md$/;

/** A Bash command a successful call proves ran: one simple command, with no &&, ||, ;, &, !, second command line, $( or
 * backtick, and no if, case or loop. A heredoc body is allowed when its delimiter closes it on the last line, and so is
 * one pipe; the caller decides what the pipe may feed. Returns the command line split at its pipe, or null. */
function simpleCommand(command: string): string[] | null {
  const [head, ...rest] = command.split("\n");
  const heredocs = [...head!.matchAll(/(?<!<)<<(?!<)(-?)\s*(["']?)(\w+)\2/g)];
  if (heredocs.length > 1) return null;
  const doc = heredocs[0];
  const end = doc ? rest.findIndex((l) => (doc[1] ? l.replace(/^\t+/, "") : l) === doc[3]) : -1;
  if (doc ? end < 0 || rest.slice(end + 1).some((l) => l.trim()) : rest.some((l) => l.trim())) return null;
  const bare = head!.replace(/'[^']*'/g, (m) => "'" + "_".repeat(m.length - 2) + "'").replace(/\d*>&\d*-?|&>>?/g, (m) => " ".repeat(m.length));
  if (/&|;|`|\$\(|\|\|/.test(bare) || /^\s*!/.test(bare) || /(?:^|\|)\s*(?:if|case|for|while|until)\b/.test(bare)) return null;
  const pipes = [...bare.matchAll(/\|/g)].map((m) => m.index!);
  if (pipes.length > 1) return null;
  return pipes.length ? [head!.slice(0, pipes[0]), head!.slice(pipes[0]! + 1)] : [head!];
}

/** The files a simple command writes: each > or >> target outside quotes and before a comment (never a numbered or & redirect
 * such as 2>), and a tee the pipe feeds. */
function writeTargets(parts: string[]): string[] {
  const head = parts[0]!;
  const bare = head.replace(/'[^']*'|"(?:[^"\\]|\\.)*"|(?<!\S)#.*/g, (m) => (m[0] === "#" ? " ".repeat(m.length) : m[0] + "_".repeat(m.length - 2) + m[0]));
  const targets = [...bare.matchAll(/(?:^|[^\d&>])>>?/g)].flatMap((m) => /^\s*(["']?)([^\s"'<>|;&]+)\1/.exec(head.slice(m.index! + m[0].length))?.[2] ?? []);
  if (parts.length === 1) return targets;
  const tee = /^\s*tee(?:\s+-a)?\s+(["']?)([^\s"'<>|;&]+)\1\s*$/.exec(parts[1]!);
  return tee ? [...targets, tee[2]!] : [];
}

/** plan-eng-review: review-sections.md read, the Step 0 Scope Challenge marker, Sections 1 to 4 in order, a test plan written.
 * A section counts at a heading in the pin's forms that has content (a non-empty line that is not a markdown heading)
 * before the next section heading, so a preview list or the completion summary's list lines are not sections. A Bash read
 * counts as a simple command whose result is not empty; a Bash write as a simple command that writes the pin's test-plan
 * path, by redirect or tee. Edit and MultiEdit never write a test plan. */
export function planEngReviewExposure(records: Rec[]): ExposureRead {
  const { uses, lines } = own(records, turnOf("plan-eng-review"));
  const isSection = (line: string) => SECTIONS.some((re) => re.test(line));
  const hasBody = (i: number) => {
    for (const { line } of lines.slice(i + 1)) {
      if (isSection(line)) return false;
      if (line && !/^#{1,6}\s/.test(line)) return true;
    }
    return false;
  };
  let at = -1;
  const inOrder = SECTIONS.every((re) => (at = lines.findIndex((l, i) => i > at && re.test(l.line) && hasBody(i))) >= 0);
  const bashRead = (u: Use) => {
    const parts = simpleCommand(u.input.command);
    return parts?.length === 1 && REVIEW_SECTIONS_BASH.test(parts[0]!) && u.result!.trim() !== "";
  };
  const bashWrite = (u: Use) => {
    const parts = simpleCommand(u.input.command);
    return !!parts && writeTargets(parts).some((t) => TEST_PLAN_BASH.test(t));
  };
  return {
    skill: "plan-eng-review",
    ...read({
      review_sections_read: uses.some((u) => u.ok && ((u.name === "Read" && REVIEW_SECTIONS.test(String(u.input.file_path ?? ""))) || (u.name === "Bash" && typeof u.input.command === "string" && bashRead(u)))),
      scope_challenge: lines.some((l) => SCOPE_CHALLENGE.some((re) => re.test(l.line))),
      sections_in_order: inOrder,
      test_plan_written: uses.some((u) => u.ok && ((u.name === "Write" && TEST_PLAN.test(String(u.input.file_path ?? ""))) || (u.name === "Bash" && typeof u.input.command === "string" && bashWrite(u)))),
    }),
  };
}

const PHASE_NUMBER: Record<string, string> = { ceo: "1", design: "2", dx: "2.5", eng: "3" };
const PHASE_SKILL: Record<string, string> = { ceo: "plan-ceo-review", design: "plan-design-review", dx: "plan-devex-review", eng: "plan-eng-review" };
const snapshot = (command: string) => new RegExp("gstack-autoplan-snapshot(?:\\.ts)?[\"']?\\s+" + command + "(?:\\s|$)");
const PUBLISHED = /^true autoplan-published (ceo|design|dx|eng)$/;

/** autoplan: the run matches the configuration O1 froze, and every phase its scope chose loaded its review skill and published its report in order, Eng last. */
export function autoplanExposure(records: Rec[]): ExposureRead {
  const { uses, lines, bash } = own(records, turnOf("autoplan"));
  const kinds = bash.filter((u) => /gstack-skill-start\b[^\n]*--skill\s+["']?autoplan(?![\w-])/.test(u.input.command)).map((u) => (u.ok ? /^SESSION_KIND: (\S+)/m.exec(u.result!)?.[1] : undefined));
  const codex = uses.filter((u) => u.ok).flatMap((u) => [...u.result!.matchAll(/^CODEX_MODE: (.+)$/gm)].map((m) => m[1]!.trim()));
  const config =
    kinds.length > 0 &&
    codex.length > 0 &&
    kinds.every((k) => k === AUTOPLAN_TOLD.session_kind) &&
    !bash.some((u) => /\bgstack-autoplan["']?\s+[a-z]/.test(u.input.command) || /(?:^|\s)--kind\b/.test(u.input.command)) &&
    codex.every((m) => (AUTOPLAN_TOLD.outside_voice.codex_modes as readonly string[]).includes(m)) &&
    !uses.some((u) => (u.name === "Agent" || u.name === "Task") && u.input.model !== undefined && !["opus", "inherit"].includes(u.input.model));
  let scope: Rec | null = null;
  for (const u of bash) {
    if (!u.ok) continue;
    const s = snapshot("init").test(u.input.command) ? json(u.result)?.scope : snapshot("scope").test(u.input.command) ? json(u.result) : undefined;
    if (s && typeof s.uiRequired === "boolean" && typeof s.dxRequired === "boolean") scope = s;
  }
  const phases = scope ? AUTOPLAN_TOLD.phases.order.filter((p) => p === "ceo" || p === "eng" || (p === "design" && scope!.uiRequired) || (p === "dx" && scope!.dxRequired)) : null;
  const pubs = bash.filter((u) => u.ok && PUBLISHED.test(u.input.command.trim()));
  const published: string[] = [];
  pubs.forEach((u, i) => {
    const phase = PUBLISHED.exec(u.input.command.trim())![1]!;
    const from = i ? pubs[i - 1]!.at : -1;
    const report = new RegExp("^\\*\\*Phase " + PHASE_NUMBER[phase]!.replace(".", "\\.") + " complete\\.\\*\\*$");
    if (lines.some((l) => l.at > from && l.at <= u.at && report.test(l.line)) && published.at(-1) !== phase) published.push(phase);
  });
  const paths = new Map<string, Set<string>>();
  for (const u of bash) {
    const m = u.ok ? /gstack-autoplan-snapshot(?:\.ts)?["']?\s+methodology\s+(ceo|design|dx|eng)(?:\s|$)/.exec(u.input.command) : null;
    const j = m ? json(u.result) : null;
    if (m && j?.phase === m[1] && typeof j.methodologyPath === "string") paths.set(m[1]!, (paths.get(m[1]!) ?? new Set()).add(j.methodologyPath));
  }
  const loaded = (phase: string) => {
    const by = pubs.find((u) => PUBLISHED.exec(u.input.command.trim())![1] === phase)?.at ?? Infinity;
    const direct = new RegExp("(?:^|/)" + PHASE_SKILL[phase] + "/SKILL\\.md$");
    return uses.some((u) => u.ok && u.name === "Read" && u.at < by && typeof u.input.file_path === "string" && (paths.get(phase)?.has(u.input.file_path) || direct.test(u.input.file_path)));
  };
  return {
    skill: "autoplan",
    ...read({ config, scope: phases !== null, review_skills_loaded: !!phases?.every(loaded), findings_in_order: !!phases && published.join() === phases.join() }),
    phases,
    published,
  };
}

/** The detector for a wave-1 skill. A skill whose family is not built has none yet, and is refused rather than read unexposed. */
export function detectExposure(skill: string, records: Rec[]): ExposureRead {
  if (skill === "plan-eng-review") return planEngReviewExposure(records);
  if (skill === "autoplan") return autoplanExposure(records);
  const family = Object.entries((registry ??= loadRegistry()).families).find(([, f]) => f.skills.includes(skill));
  if (family && !family[1].built) throw new Error("E_OUTCOME_ARM skill " + skill + " has no exposure detector yet: it comes with family " + family[0] + " (" + family[1].why + ")");
  throw new Error("E_OUTCOME_ARM no exposure detector for " + skill + "; G has plan-eng-review and autoplan");
}
