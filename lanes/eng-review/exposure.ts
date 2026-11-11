// Copyright (c) 2026 Garry Tan. MIT License.
// The plan-eng-review intentions eval's three procedure detectors (prereg 2026-11-08-geva-405, section 5), built from
// the strings the pinned skills print and write (GSTACK_ER_PINS). Each reads one session's evidence: the final
// transcript, the copied gstack state root, the copied plan-coverage folder and, for the eng phase arm, its opening
// record. Never a gate's own report. The rules, with every build-time choice where the prereg is silent:
//
// - Own words are the main agent's text blocks and the text of its own successful Write, Edit and MultiEdit calls, in
//   transcript order. A call whose result is an error, carries a tool_use_error tag or is absent did not happen. Subagent
//   text, tool results and injected skill bodies are never own words, so the eng voice subagent's review counts only
//   through its dispatch and terminal result.
// - A heading is a markdown heading or a line that is all bold (an optional colon after it), outside code fences. Its
//   body runs to the next heading at its level or above; an all-bold line ranks below every markdown heading.
// - Scope Challenge: a heading naming "Scope Challenge" with a non-blank body. The eng phase arm's findings need a list
//   item, a table row or the words "No issues found" in that body.
// - Sections 1 to 4: a heading counts as Section N when it names "Section N", starts with N and the section's name, or
//   names the section's review (Architecture, Code Quality, Test or Tests, Performance). Each section's first such
//   heading must come in the order 1, 2, 3, 4 in the own words.
// - Coverage diagram: a block (a code fence, or a run of non-blank lines outside fences) holding at least 3 path lines
//   that carry the skill's markers (star ratings, GAP, [\u2192E2E] or [\u2192EVAL]), not counting COVERAGE:, QUALITY: or
//   Legend: summary lines. The block must start after the first Section 3 heading.
// - Test plan artifact (pre-cut and eng phase): a non-empty regular file whose name matches *-eng-review-test-plan-*.md
//   anywhere under the state root copy. Symlinks, to files or folders, are skipped. The state root is seeded fresh per
//   session, so any such file is this session's.
// - Native eng voice: an own Agent or Task call whose prompt holds the pinned snapshot tool's nativeDispatchPrompt opening
//   ("You are the independent ENG reviewer for this phase."), that the CLI started (a non-error result, a task_started
//   message or a message from the subagent), with a terminal result: a task_notification for the call, whatever its
//   status, or a non-error result that is not an async launch receipt.
// - Consensus table: a line naming ENG DUAL VOICES and CONSENSUS TABLE, with all six dimensions named in the 12 lines
//   after it (architecture, test coverage, perf, security, error paths, deployment).
// - Failure modes registry: a heading naming failure modes whose body holds a list item or a table with a row under
//   its header.
// - Pre-cut load: a successful Read of plan-eng-review/sections/review-sections.md, or a simple cat, head, nl or sed -n
//   Bash read of it, with a non-empty result.
// - Eng phase load: for every readRanges chunk in er-opening.json, a successful own Read of the methodology path (the
//   container path, relative paths resolved against /work) with a non-empty result whose range covers the chunk. Read's
//   offset defaults to 1 and its limit to 2000 lines, Claude Code's defaults. No opening record, or no chunk, fails it.
// - Candidate: each of the three files is a regular file in the plan-coverage copy whose first line is its header. A
//   line "Status: no-plan" in any of them makes the session unexposed. A path counts when a path-map.md line holds its
//   ID (P<n> or F<n>) and a tag (NEW, CHANGED or AT-RISK); coverage-map.md rates a path when a line holds its ID and a
//   star or GAP, and its last non-blank line starts with COVERAGE:. A test is a heading T<n> in test-plan.md whose body
//   has a Kind line (extend, unit, e2e, ci-job or eval) and a non-empty Catches line. The PLAN_COVERAGE: line may sit in
//   any main-agent text block. Candidate load: a successful Read or simple Bash read of plan-coverage/SKILL.md, a
//   successful Skill call naming plan-coverage, or a main-thread user message holding the skill's title line (the body
//   Claude Code injects for /plan-coverage).
// - exposed is every required check passing; the load check is listed in checks as "load" and never decides exposed.
// - Decisions. Every arm: each question of a successful own AskUserQuestion call (the harness's user answers with the
//   recommended option) is decided, each question of a call with no successful result is pending, and each list item
//   under an "Unresolved decisions" heading in the own words is pending. Pre-cut adds its Decision ledger records
//   ("R<n>: <choice>" headings): the last State line seen for a record decides it, approved to decided and pending to
//   pending. The eng phase adds its Decision Audit Trail rows (a table whose header has Decision and Classification
//   columns): decided, except a User Challenge row, which autoplan never auto-decides, so it is pending. The candidate
//   adds the list items under test-plan.md's Decisions heading (the text before ": took"), each decided. Labels are
//   kept once each, in order; a label once pending stays pending.
// - test_plan_artifact in erDecisions is the pre-cut and eng phase artifact above, or for the candidate a regular
//   test-plan.md opening with its header line.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";

/** sha256 of this file; rows record it. */
export const ER_EXPOSURE_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

/** The gstack commits the detectors were built from, and the files they read strings from, by sha256. */
export const GSTACK_ER_PINS = {
  precut: { repo: "garrytan/gstack", sha: "b493d4e31ac9619ef7e52e176d590ad4f454cd66", version: "1.97.0.0", files: { "plan-eng-review/SKILL.md": "58d96f6f3e296ccc2942e2e1a5732810b18f9f8bcd6ed9338115c99c91a88524", "plan-eng-review/sections/review-sections.md": "202df94f20273ae6fb1cd4e6f65953a4dd50880d04fd5010a05d2557359f11dc" } },
  engphase: { repo: "garrytan/gstack", sha: "199931029e9fe9808554a4863c960d4b9b663a60", version: "1.98.0.0", files: { "autoplan/SKILL.md": "b39b19c02ee73e46fb4325e11e9fa86e7ff195a4f65c21c4d4384c6ed4c039e8", "autoplan/sections/eng-phase.md": "527e7ff9c629cbee410d292de179ea4477ecbb12b338e97952c1c6749411fb9e", "bin/gstack-autoplan-snapshot.ts": "f9a31c701d8a86af3b752ab0901661a12f54cd7cd73b512e33f0eea62e555e73" } },
  candidate: { repo: "garrytan/gstack", sha: "57295cbc510fcafc4d404d4ba70afc463b01e341", version: null, files: { "plan-coverage/SKILL.md": "4778462dbff92da7b5df3088c7b96b6dc1a16e35d063cbb2322a34457dcd9882" } },
} as const;

export type ErSkillArm = "precut" | "engphase" | "candidate";
export const ER_SKILL_ARMS: readonly ErSkillArm[] = ["precut", "engphase", "candidate"];

export interface ErEvidence {
  transcript: string;
  stateRoot: string | null;
  coverage: string | null;
  opening: { methodology: string; readRanges: Array<{ offset: number; limit: number }> } | null;
}
export interface ErCheck {
  name: string;
  pass: boolean;
  detail: string;
}
export interface ErExposure {
  exposed: boolean;
  loaded: boolean;
  missing: string[];
  checks: ErCheck[];
}
export interface ErDecisions {
  decided: string[];
  pending: string[];
  test_plan_artifact: boolean;
}

type Rec = Record<string, any>;
type Use = { id: string; name: string; input: Rec; ok: boolean; result: string; meta: unknown };
const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));
const own = (transcript: string) => readTranscript(transcript).filter((m) => !m.parent_tool_use_id && Array.isArray(m.message?.content));
const said = (m: Rec) => m.type === "assistant" && !m.error && !m.is_api_error_message;

/** The main agent's own tool calls with their results, in order. */
export function ownUses(transcript: string): Use[] {
  const messages = own(transcript);
  const results = new Map<string, { block: Rec; meta: unknown }>();
  for (const m of messages) if (m.type === "user") for (const b of m.message.content) if (b?.type === "tool_result") results.set(b.tool_use_id, { block: b, meta: m.tool_use_result });
  return messages.filter(said).flatMap((m) => m.message.content.filter((b: Rec) => b?.type === "tool_use")).map((b: Rec) => {
    const res = results.get(b.id);
    const result = res ? text(res.block.content) : "";
    return { id: b.id, name: b.name, input: b.input ?? {}, ok: !!res && res.block.is_error !== true && !result.includes("<tool_use_error>"), result, meta: res?.meta };
  });
}

/** The main agent's own words in transcript order: its text blocks and what its successful Write, Edit and MultiEdit calls wrote. */
export function ownWords(transcript: string): string[] {
  const ok = new Set(ownUses(transcript).filter((u) => u.ok).map((u) => u.id));
  return own(transcript).filter(said).flatMap((m) => m.message.content.flatMap((b: Rec) => {
    if (b?.type === "text" && typeof b.text === "string") return [b.text];
    if (b?.type !== "tool_use" || !ok.has(b.id)) return [];
    const i = b.input ?? {};
    if (b.name === "Write" && typeof i.content === "string") return [i.content];
    if (b.name === "Edit" && typeof i.new_string === "string") return [i.new_string];
    if (b.name === "MultiEdit" && Array.isArray(i.edits)) return i.edits.flatMap((e: Rec) => (typeof e?.new_string === "string" ? [e.new_string] : []));
    return [];
  }));
}

type Heading = { line: number; level: number; title: string };
const FENCE = /^ {0,3}(\x60{3,}|~{3,})/;
const MD_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BOLD_LINE = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/;
const LIST = /^\s*(?:[-*+\u2022]|\d{1,3}[.)])\s+\S/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const plain = (s: string) => s.replace(/\*\*|__|\x60/g, "").trim();

/** The headings of a text's lines, outside code fences. */
export function headings(lines: readonly string[]): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((l, line) => {
    const f = FENCE.exec(l);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const md = MD_HEADING.exec(l);
    if (md) return void out.push({ line, level: md[1]!.length, title: plain(md[2]!) });
    const bold = BOLD_LINE.exec(l);
    if (bold) out.push({ line, level: 7, title: plain(bold[1]!).replace(/:$/, "") });
  });
  return out;
}

const bodyOf = (lines: readonly string[], hs: readonly Heading[], h: Heading): string[] => {
  const next = hs.find((x) => x.line > h.line && x.level <= h.level);
  return lines.slice(h.line + 1, next ? next.line : undefined);
};
const tableRows = (body: readonly string[]) => body.filter((l) => l.includes("|") && !TABLE_SEPARATOR.test(l)).length;

const SECTION_NAMES = ["architecture", "code quality", "tests?", "performance"];
/** Which of Sections 1 to 4 a heading names, or null. */
export function sectionOf(title: string): number | null {
  const t = plain(title).toLowerCase();
  for (let n = 1; n <= 4; n++) {
    const name = SECTION_NAMES[n - 1]!;
    if (new RegExp("\\bsection\\s+" + n + "\\b").test(t) || new RegExp("^" + n + "\\s*[.):]?\\s*(?:[-\u2013\u2014:]\\s*)?" + name + "\\b").test(t) || new RegExp("\\b" + name + "\\s+review\\b").test(t)) return n;
  }
  return null;
}

const MARKER = /\u2605|\bGAP\b|\[\u2192E2E\]|\[\u2192EVAL\]/;
const SUMMARY = /^\s*(?:COVERAGE|QUALITY|Legend)\s*:/i;
/** Each block of a text's lines (a code fence, or a run of non-blank lines outside fences) with its count of marked path lines. */
export function diagramBlocks(lines: readonly string[]): Array<{ line: number; paths: number }> {
  const out: Array<{ line: number; paths: number }> = [];
  let block: { line: number; paths: number; fence: string | null } | null = null;
  const close = () => {
    if (block) out.push({ line: block.line, paths: block.paths });
    block = null;
  };
  lines.forEach((l, i) => {
    const f = FENCE.exec(l);
    if (block?.fence) {
      if (f && f[1]![0] === block.fence) close();
      else if (MARKER.test(l) && !SUMMARY.test(l)) block.paths++;
      return;
    }
    if (f) {
      close();
      block = { line: i, paths: 0, fence: f[1]![0]! };
      return;
    }
    if (!l.trim()) return close();
    block ??= { line: i, paths: 0, fence: null };
    if (MARKER.test(l) && !SUMMARY.test(l)) block.paths++;
  });
  close();
  return out;
}

const list = (d: string) => {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
};

/** The test plan artifacts under a state root copy: non-empty regular files named *-eng-review-test-plan-*.md, symlinks skipped. */
export function testPlanArtifacts(stateRoot: string | null): string[] {
  if (!stateRoot) return [];
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const n of list(join(stateRoot, rel)).sort()) {
      const r = rel ? rel + "/" + n : n;
      const st = lstatSync(join(stateRoot, r), { throwIfNoEntry: false });
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(r);
      else if (st.isFile() && st.size > 0 && /^.+-eng-review-test-plan-.*\.md$/.test(n)) out.push(r);
    }
  };
  walk("");
  return out;
}

const esc = (file: string) => file.replace(/[.]/g, "\\.");
const readsFile = (uses: readonly Use[], file: string) =>
  uses.some((u) => u.ok && u.result.trim() !== "" && ((u.name === "Read" && typeof u.input.file_path === "string" && new RegExp("(?:^|/)" + esc(file) + "$").test(u.input.file_path)) || (u.name === "Bash" && typeof u.input.command === "string" && new RegExp("^\\s*(?:cat|head|nl|sed\\s+-n\\s+([\"']?)[\\d,$]*p\\1)\\s[^<>|;&]*" + esc(file) + "\\s*$").test(u.input.command))));

/** Whether every readRanges chunk of the methodology was covered by a successful own Read. */
export function methodologyLoaded(uses: readonly Use[], opening: ErEvidence["opening"]): { pass: boolean; covered: number; chunks: number } {
  if (!opening || !opening.readRanges.length) return { pass: false, covered: 0, chunks: opening?.readRanges.length ?? 0 };
  const target = posix.resolve("/work", opening.methodology);
  const reads = uses.filter((u) => u.ok && u.name === "Read" && typeof u.input.file_path === "string" && posix.resolve("/work", u.input.file_path) === target && u.result.trim() !== "").map((u) => {
    const offset = Math.max(1, Number.isFinite(u.input.offset) ? u.input.offset : 1);
    return { from: offset, to: offset + (Number.isFinite(u.input.limit) ? u.input.limit : 2000) };
  });
  const covered = opening.readRanges.filter((c) => reads.some((r) => r.from <= c.offset && r.to >= c.offset + c.limit)).length;
  return { pass: covered === opening.readRanges.length, covered, chunks: opening.readRanges.length };
}

export const ENG_VOICE_OPENING = "You are the independent ENG reviewer for this phase.";
const LAUNCH_RECEIPT = /Async agent launched|async_launched|"isAsync"\s*:\s*true/;
/** The native eng voice's dispatches and whether one was started and reached a terminal result. */
export function engVoice(transcript: string): { dispatched: number; terminal: boolean } {
  const all = readTranscript(transcript);
  const calls = ownUses(transcript).filter((u) => (u.name === "Agent" || u.name === "Task") && typeof u.input.prompt === "string" && u.input.prompt.includes(ENG_VOICE_OPENING));
  const terminal = calls.some((u) => {
    const receipt = LAUNCH_RECEIPT.test(u.result) || LAUNCH_RECEIPT.test(JSON.stringify(u.meta ?? null));
    const started = u.ok || all.some((m) => (m.type === "system" && m.subtype === "task_started" && m.tool_use_id === u.id) || m.parent_tool_use_id === u.id);
    const notified = all.some((m) => m.type === "system" && m.subtype === "task_notification" && m.tool_use_id === u.id);
    return started && (notified || (u.ok && !receipt));
  });
  return { dispatched: calls.length, terminal };
}

const DIMENSIONS = [/architecture/i, /test coverage/i, /\bperf/i, /security/i, /error paths?/i, /deployment/i];
const CONSENSUS = /ENG DUAL VOICES\W+CONSENSUS TABLE/i;

function reviewChecks(arm: "precut" | "engphase", ev: ErEvidence): ErCheck[] {
  const lines = ownWords(ev.transcript).join("\n").split("\n");
  const hs = headings(lines);
  const scope = hs.filter((h) => /scope challenge/i.test(h.title)).map((h) => bodyOf(lines, hs, h));
  const findings = (b: string[]) => b.some((l) => LIST.test(l)) || tableRows(b) > 0 || b.some((l) => /no issues found/i.test(l));
  const scopeOk = arm === "precut" ? scope.some((b) => b.some((l) => l.trim())) : scope.some(findings);
  const first = [1, 2, 3, 4].map((n) => hs.find((h) => sectionOf(h.title) === n)?.line ?? null);
  const inOrder = first.every((p, i) => p !== null && (i === 0 || p > first[i - 1]!));
  const s3 = first[2] ?? null;
  const best = s3 === null ? 0 : Math.max(0, ...diagramBlocks(lines).filter((b) => b.line > s3).map((b) => b.paths));
  const artifacts = testPlanArtifacts(ev.stateRoot);
  const checks: ErCheck[] = [{ name: "scope_challenge", pass: scopeOk, detail: scope.length ? scope.length + " Scope Challenge heading(s)" + (scopeOk ? "" : arm === "precut" ? ", each with an empty body" : ", none with findings") : "no Scope Challenge heading" }];
  if (arm === "engphase") {
    const v = engVoice(ev.transcript);
    checks.push({ name: "native_eng_voice", pass: v.terminal, detail: v.dispatched + " eng voice dispatch(es)" + (v.terminal ? ", one with a terminal result" : v.dispatched ? ", none started with a terminal result" : "") });
    const at = lines.findIndex((l, i) => CONSENSUS.test(l) && DIMENSIONS.every((d) => lines.slice(i + 1, i + 13).some((x) => d.test(x))));
    checks.push({ name: "consensus_table", pass: at >= 0, detail: at >= 0 ? "table at own-words line " + (at + 1) : lines.some((l) => CONSENSUS.test(l)) ? "title without all six dimensions" : "no ENG DUAL VOICES consensus table" });
  }
  checks.push({ name: "sections_in_order", pass: inOrder, detail: "first heading lines for Sections 1 to 4: " + first.map((p) => (p === null ? "none" : p + 1)).join(", ") });
  checks.push({ name: "coverage_diagram", pass: best >= 3, detail: s3 === null ? "no Section 3 heading" : "most marked path lines in one block after Section 3: " + best });
  if (arm === "engphase") {
    const reg = hs.filter((h) => /failure modes?\b/i.test(h.title)).map((h) => bodyOf(lines, hs, h));
    const ok = reg.some((b) => b.some((l) => LIST.test(l)) || tableRows(b) >= 2);
    checks.push({ name: "failure_modes", pass: ok, detail: reg.length ? reg.length + " failure modes heading(s)" + (ok ? "" : ", none with entries") : "no failure modes heading" });
  }
  checks.push({ name: "test_plan_artifact", pass: artifacts.length > 0, detail: artifacts.length ? artifacts.join(", ") : ev.stateRoot ? "no *-eng-review-test-plan-*.md under the state root" : "no state root copy" });
  const uses = ownUses(ev.transcript);
  if (arm === "precut") {
    const loaded = readsFile(uses, "plan-eng-review/sections/review-sections.md");
    checks.push({ name: "load", pass: loaded, detail: loaded ? "review-sections.md read" : "review-sections.md not read" });
  } else {
    const m = methodologyLoaded(uses, ev.opening);
    checks.push({ name: "load", pass: m.pass, detail: ev.opening ? "methodology chunks read: " + m.covered + " of " + m.chunks : "no er-opening.json" });
  }
  return checks;
}

export const PLAN_COVERAGE_HEADERS = { "path-map.md": "<!-- gstack:plan-coverage path-map v1 -->", "coverage-map.md": "<!-- gstack:plan-coverage coverage-map v1 -->", "test-plan.md": "<!-- gstack:plan-coverage test-plan v1 -->" } as const;
type CoverageFile = keyof typeof PLAN_COVERAGE_HEADERS;

/** A plan-coverage file's text when it is a regular file opening with its header line, else null. */
export function coverageFile(dir: string | null, name: CoverageFile): string | null {
  if (!dir) return null;
  const st = lstatSync(join(dir, name), { throwIfNoEntry: false });
  if (!st?.isFile()) return null;
  const body = readFileSync(join(dir, name), "utf8").replace(/^\uFEFF/, "");
  return body.split("\n")[0]!.trim() === PLAN_COVERAGE_HEADERS[name] ? body : null;
}

const ids = (line: string) => line.match(/\b[PF][1-9]\d*\b/g) ?? [];
const PLAN_COVERAGE_LINE = /^\s*\x60?PLAN_COVERAGE: paths=\d+ gaps=\d+ tests=\d+ out=\S+?\x60?\s*$/m;

/** The tests in test-plan.md: T<n> headings whose body has a Kind and a Catches line. */
export function planTests(doc: string): string[] {
  const lines = doc.split("\n");
  const hs = headings(lines);
  return hs.filter((h) => /^T[1-9]\d*\b/.test(h.title)).filter((h) => {
    const b = bodyOf(lines, hs, h).map(plain);
    return b.some((l) => /^(?:[-*]\s*)?Kind:\s*(?:extend|unit|e2e|ci-job|eval)\b/i.test(l)) && b.some((l) => /^(?:[-*]\s*)?Catches:\s*\S/i.test(l));
  }).map((h) => h.title);
}

const skillInjected = (transcript: string) =>
  readTranscript(transcript).some((m) => m.type === "user" && !m.parent_tool_use_id && (typeof m.message?.content === "string" ? m.message.content : Array.isArray(m.message?.content) ? m.message.content.filter((b: Rec) => b?.type === "text").map((b: Rec) => b.text).join("\n") : "").includes("# /plan-coverage: path map, coverage map, test plan"));

function candidateChecks(ev: ErEvidence): ErCheck[] {
  const names = Object.keys(PLAN_COVERAGE_HEADERS) as CoverageFile[];
  const files = Object.fromEntries(names.map((n) => [n, coverageFile(ev.coverage, n)])) as Record<CoverageFile, string | null>;
  const absent = names.filter((n) => files[n] === null);
  const noPlan = Object.values(files).some((t) => t !== null && /^\s*Status:\s*no-plan\b/im.test(t));
  const tagged = new Set((files["path-map.md"] ?? "").split("\n").filter((l) => /\b(?:NEW|CHANGED|AT-RISK)\b/.test(l)).flatMap(ids));
  const cov = files["coverage-map.md"] ?? "";
  const rated = new Set(cov.split("\n").filter((l) => /\u2605|\bGAP\b/.test(l)).flatMap(ids));
  const ends = /^COVERAGE:/.test(cov.split("\n").filter((l) => l.trim()).at(-1)?.trim() ?? "");
  const tests = planTests(files["test-plan.md"] ?? "");
  const line = mainAgentTexts(ev.transcript).some((t) => PLAN_COVERAGE_LINE.test(t));
  const uses = ownUses(ev.transcript);
  const loaded = readsFile(uses, "plan-coverage/SKILL.md") || uses.some((u) => u.ok && u.name === "Skill" && /(?:^|:)plan-coverage$/.test(String(u.input.skill ?? u.input.command ?? u.input.name ?? ""))) || skillInjected(ev.transcript);
  return [
    { name: "files", pass: absent.length === 0, detail: absent.length ? "missing or without its header line: " + absent.join(", ") : "all three files with their header lines" },
    { name: "status", pass: absent.length < 3 && !noPlan, detail: noPlan ? "Status: no-plan" : absent.length < 3 ? "a plan was mapped" : "no files" },
    { name: "path_map", pass: tagged.size >= 3, detail: tagged.size + " tagged path IDs in path-map.md" },
    { name: "coverage_map", pass: rated.size >= 3 && ends, detail: rated.size + " rated path IDs; " + (ends ? "ends with its COVERAGE: line" : "does not end with a COVERAGE: line") },
    { name: "test_plan", pass: tests.length > 0, detail: tests.length + " test(s) with a Kind and a Catches line" },
    { name: "plan_coverage_line", pass: line, detail: line ? "PLAN_COVERAGE: line in the reply" : "no PLAN_COVERAGE: line in the reply" },
    { name: "load", pass: loaded, detail: loaded ? "plan-coverage/SKILL.md loaded" : "plan-coverage/SKILL.md not loaded" },
  ];
}

const MISSING: Record<string, string> = {
  scope_challenge: "the Scope Challenge (Step 0) with its findings",
  native_eng_voice: "the native eng voice: the snapshot's nativeDispatchPrompt sent through the Agent tool, with its result",
  consensus_table: "the ENG DUAL VOICES consensus table",
  sections_in_order: "Sections 1 to 4 (Architecture, Code Quality, Tests, Performance), in that order",
  coverage_diagram: "the Section 3 coverage diagram, with at least 3 path lines marked with star ratings, GAP, [\u2192E2E] or [\u2192EVAL]",
  failure_modes: "the failure modes registry",
  test_plan_artifact: "the test plan artifact, a *-eng-review-test-plan-*.md file under the gstack state root",
  files: "path-map.md, coverage-map.md and test-plan.md in /work/repo/.gstack/plan-coverage/, each opening with its header line",
  status: "the three files for the plan named in the prompt (they must not say Status: no-plan)",
  path_map: "at least 3 paths in path-map.md, numbered P1 or F1 onward and each tagged NEW, CHANGED or AT-RISK",
  coverage_map: "a star rating or GAP for at least 3 paths in coverage-map.md, which ends with its COVERAGE: line",
  test_plan: "at least one test in test-plan.md, numbered T1 onward, with a Kind and a Catches line",
  plan_coverage_line: "the PLAN_COVERAGE: line in your reply",
};

/** The arm's frozen detector over one session's evidence. */
export function erExposure(arm: ErSkillArm, ev: ErEvidence): ErExposure {
  const checks = arm === "candidate" ? candidateChecks(ev) : reviewChecks(arm, ev);
  const required = checks.filter((c) => c.name !== "load");
  return { exposed: required.every((c) => c.pass), loaded: checks.find((c) => c.name === "load")!.pass, missing: required.filter((c) => !c.pass).map((c) => MISSING[c.name]!), checks };
}

/** Every decision the skill took on its own, any it left pending, and whether it wrote its test plan artifact. */
export function erDecisions(arm: ErSkillArm, ev: ErEvidence): ErDecisions {
  const state = new Map<string, "decided" | "pending">();
  const mark = (label: string, s: "decided" | "pending") => {
    const l = label.replace(/<gstack-qid:[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (l && !/^none\b/i.test(l)) state.set(l, state.get(l) === "pending" ? "pending" : s);
  };
  for (const u of ownUses(ev.transcript)) {
    if (u.name !== "AskUserQuestion" && !/^mcp__.+__AskUserQuestion$/.test(u.name)) continue;
    for (const q of Array.isArray(u.input.questions) ? u.input.questions : []) mark(String(q?.question ?? q?.header ?? "").split("\n")[0]!, u.ok ? "decided" : "pending");
  }
  const lines = ownWords(ev.transcript).join("\n").split("\n");
  const hs = headings(lines);
  const items = (b: readonly string[]) => b.filter((l) => LIST.test(l)).map((l) => plain(l.replace(/^\s*(?:[-*+\u2022]|\d{1,3}[.)])\s+/, "")));
  if (arm === "precut") {
    const records = new Map<string, "decided" | "pending">();
    for (const h of hs.filter((x) => /^R\d+:\s*\S/.test(x.title))) {
      const st = bodyOf(lines, hs, h).map((l) => /^State:\s*(approved|pending)\b/i.exec(plain(l))?.[1]?.toLowerCase()).filter(Boolean).at(-1);
      if (st) records.set(h.title, st === "approved" ? "decided" : "pending");
    }
    for (const [label, s] of records) mark(label, s);
  }
  if (arm === "engphase") {
    lines.forEach((l, i) => {
      if (!l.includes("|") || !TABLE_SEPARATOR.test(lines[i + 1] ?? "")) return;
      const head = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => plain(c).toLowerCase());
      const [d, c] = [head.indexOf("decision"), head.indexOf("classification")];
      if (d < 0 || c < 0) return;
      for (let j = i + 2; j < lines.length && lines[j]!.includes("|"); j++) {
        const row = lines[j]!.trim().replace(/^\||\|$/g, "").split("|").map((x) => plain(x));
        if (row[d]) mark(row[d]!, /user challenge/i.test(row[c] ?? "") ? "pending" : "decided");
      }
    });
  }
  for (const h of hs.filter((x) => /unresolved decisions/i.test(x.title))) for (const it of items(bodyOf(lines, hs, h))) mark(it, "pending");
  let artifact: boolean;
  if (arm === "candidate") {
    const plan = coverageFile(ev.coverage, "test-plan.md");
    artifact = plan !== null;
    if (plan) {
      const pl = plan.split("\n");
      const ph = headings(pl);
      for (const h of ph.filter((x) => /^decisions$/i.test(x.title))) for (const it of items(bodyOf(pl, ph, h))) mark(it.split(/:\s*took\b/i)[0]!, "decided");
    }
  } else artifact = testPlanArtifacts(ev.stateRoot).length > 0;
  const all = [...state.entries()];
  return { decided: all.filter(([, s]) => s === "decided").map(([l]) => l), pending: all.filter(([, s]) => s === "pending").map(([l]) => l), test_plan_artifact: artifact };
}

/** One session's evidence from its directory: host/transcript.ndjson, host/gstack-state/, host/plan-coverage/ and host/er-opening.json. */
export function sessionEvidence(sessionDir: string): ErEvidence {
  const host = join(sessionDir, "host");
  const dir = (n: string) => (lstatSync(join(host, n), { throwIfNoEntry: false })?.isDirectory() ? join(host, n) : null);
  let transcript = "";
  try {
    transcript = readFileSync(join(host, "transcript.ndjson"), "utf8");
  } catch {
    transcript = "";
  }
  let opening: ErEvidence["opening"] = null;
  try {
    const o = JSON.parse(readFileSync(join(host, "er-opening.json"), "utf8"));
    if (typeof o?.methodology === "string" && Array.isArray(o.readRanges)) opening = { methodology: o.methodology, readRanges: o.readRanges.filter((r: Rec) => Number.isFinite(r?.offset) && Number.isFinite(r?.limit)).map((r: Rec) => ({ offset: r.offset, limit: r.limit })) };
  } catch {
    opening = null;
  }
  return { transcript, stateRoot: dir("gstack-state"), coverage: dir("plan-coverage"), opening };
}

const HELP = "gstack-evals er exposure --session <session dir> --arm precut|engphase|candidate\n  Prints the arm's procedure detector, its load check and the session's decisions, from host/transcript.ndjson,\n  host/gstack-state/, host/plan-coverage/ and host/er-opening.json.";

export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(HELP);
    return 0;
  }
  const session = get("--session");
  const arm = get("--arm");
  const refuse = (why: string, fix: string) => {
    io.err("E_USAGE er exposure: " + why + "\nE_USAGE fix: " + fix);
    return 2;
  };
  if (!session || !ER_SKILL_ARMS.includes(arm as ErSkillArm)) return refuse("needs --session <dir> and --arm precut, engphase or candidate", "run gstack-evals er exposure --help");
  if (!existsSync(join(session, "host", "transcript.ndjson"))) return refuse(session + "/host/transcript.ndjson cannot be read", "pass a session dir from a review-units eng-review run");
  const ev = sessionEvidence(session);
  io.out(JSON.stringify({ exposure_sha256: ER_EXPOSURE_SHA256, arm, ...erExposure(arm as ErSkillArm, ev), decisions: erDecisions(arm as ErSkillArm, ev) }, null, 2));
  return 0;
}
