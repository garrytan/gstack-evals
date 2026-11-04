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
const REVIEW_SECTIONS_BASH = /(?:^|[\s;&|(])(?:cat|sed|head|tail|awk|less|more|nl)\s[^;&|]*plan-eng-review\/sections\/review-sections\.md(?![\w.])/;
const SCOPE_CHALLENGE = [/^#{1,6}\s+(?:Step 0:\s*)?Scope Challenge\b/, /^\*\*(?:Step 0:\s*)?Scope Challenge\*\*/, /^-\s+Step 0:\s*Scope Challenge\b/];
const SECTIONS = ([["1", "architecture"], ["2", "code quality"], ["3", "tests?"], ["4", "performance"]] as const).map(([n, name]) => new RegExp("^(?:#{1,6}\\s+|\\*\\*|-\\s+)?(?:section\\s+" + n + "(?![\\d.])|" + n + "[.)]\\s+(?:" + name + ")\\b|(?:" + name + ")\\s+review\\b)", "i"));
const TEST_PLAN = /\/projects\/[^/]+\/[^/]+-eng-review-test-plan-[^/]+\.md$/;
const TEST_PLAN_BASH = /(?:>>?|\btee(?:\s+-a)?)\s*["']?[^\s"'<>|;&]*-eng-review-test-plan-[^\s"'/<>|;&]*\.md/;

/** plan-eng-review: review-sections.md read, the Step 0 Scope Challenge marker, Sections 1 to 4 in order, a test plan written. */
export function planEngReviewExposure(records: Rec[]): ExposureRead {
  const { uses, lines, bash } = own(records, turnOf("plan-eng-review"));
  const first = SECTIONS.map((re) => lines.findIndex((l) => re.test(l.line)));
  return {
    skill: "plan-eng-review",
    ...read({
      review_sections_read: uses.some((u) => u.ok && ((u.name === "Read" && REVIEW_SECTIONS.test(String(u.input.file_path ?? ""))) || (u.name === "Bash" && REVIEW_SECTIONS_BASH.test(String(u.input.command ?? ""))))),
      scope_challenge: lines.some((l) => SCOPE_CHALLENGE.some((re) => re.test(l.line))),
      sections_in_order: first.every((i, k) => i >= 0 && (k === 0 || i > first[k - 1]!)),
      test_plan_written: uses.some((u) => u.ok && ((u.name === "Write" && TEST_PLAN.test(String(u.input.file_path ?? ""))) || (u.name === "Bash" && TEST_PLAN_BASH.test(u.input.command)))),
    }),
  };
}

const PHASE_NUMBER: Record<string, string> = { ceo: "1", design: "2", dx: "2.5", eng: "3" };
const PHASE_SKILL: Record<string, string> = { ceo: "plan-ceo-review", design: "plan-design-review", dx: "plan-devex-review", eng: "plan-eng-review" };
const snapshot = (command: string) => new RegExp("gstack-autoplan-snapshot(?:\\.ts)?[\"']?\\s+" + command + "\\s");
const PUBLISHED = /^true autoplan-published (ceo|design|dx|eng)$/;

/** autoplan: the run matches the configuration O1 froze, and every phase its scope chose loaded its review skill and published its report in order, Eng last. */
export function autoplanExposure(records: Rec[]): ExposureRead {
  const { uses, lines, bash } = own(records, turnOf("autoplan"));
  const kinds = bash.filter((u) => /gstack-skill-start\b[^\n]*--skill\s+["']?autoplan(?![\w-])/.test(u.input.command)).map((u) => (u.ok ? /^SESSION_KIND: (\S+)/m.exec(u.result!)?.[1] : undefined));
  const codex = uses.filter((u) => u.ok).flatMap((u) => [...u.result!.matchAll(/^CODEX_MODE: (.+)$/gm)].map((m) => m[1]!.trim()));
  const config =
    kinds.length > 0 &&
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
  const pubs = bash.filter((u) => u.result !== null && PUBLISHED.test(u.input.command.trim()));
  const published: string[] = [];
  pubs.forEach((u, i) => {
    const phase = PUBLISHED.exec(u.input.command.trim())![1]!;
    const from = i ? pubs[i - 1]!.at : -1;
    const report = new RegExp("^\\*\\*Phase " + PHASE_NUMBER[phase]!.replace(".", "\\.") + " complete\\.\\*\\*$");
    if (lines.some((l) => l.at > from && l.at <= u.at && report.test(l.line)) && published.at(-1) !== phase) published.push(phase);
  });
  const paths = new Map<string, Set<string>>();
  for (const u of bash) {
    const m = u.ok ? /gstack-autoplan-snapshot(?:\.ts)?["']?\s+methodology\s+(ceo|design|dx|eng)\s/.exec(u.input.command) : null;
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
