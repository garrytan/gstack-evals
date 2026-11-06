// Copyright (c) 2026 Garry Tan. MIT License.
// Splice sets (prereg section 3): the captured skill invocation, the skill-start Bash call and its stdout, Reads as Claude
// Code renders them, capy's three files; and the closer byte check on de-rendered text.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fail } from "./errors.ts";
import { renderHistory } from "./history/events.ts";
import { captureSession, flags, isMain, mapStrings, need, outsideRepo, refuseForbidden, sha256, type StubRequest, type StubTurn } from "./shape.ts";
import { PLACEHOLDERS, type Block, type Family, type History, type Io, type Message, type SpliceSet } from "./types.ts";

export interface SpliceOptions {
  family: Family;
  pin: string;
  claude: string;
  gstack: string;
  out: string;
  /** Every request the stub provider saw, for checks on the raw requests. */
  onRequests?: (requests: StubRequest[]) => void;
}

const SKILL_ROOT = "~/.claude/skills/gstack/";
const CAPY_ROOT = "~/.local/share/gstack/";
const CAPY_HEAD = ["capy/skill/gstack/factory.md"];
const CAPY_TAIL = ["captain/templates/report.md", "captain/templates/READY.md"];

/** The skill's first step (the gstack-skill-start line in its first bash block) and the files SKILL.md reads before it, preamble.md first. */
export function skillPlan(skillMd: string): { command: string; reads: string[] } {
  const lines = skillMd.split("\n");
  let fence = -1;
  let command = "";
  for (let i = 0; i < lines.length && !command; i++) {
    if (/^\s*```/.test(lines[i]!)) fence = fence < 0 ? i : -1;
    else if (fence >= 0 && lines[i]!.includes("gstack-skill-start")) command = lines[i]!.trim();
  }
  if (!command) fail("E_TBV_SHAPE", "SKILL.md has no gstack-skill-start line in a code block");
  const before = lines.slice(0, fence).filter((l) => !l.startsWith(">")).join("\n");
  const reads = [...new Set([...before.matchAll(/Read `(~\/\.claude\/skills\/gstack\/[^`]+)`/g)].map((m) => m[1]!))];
  const preamble = reads.filter((r) => r.endsWith("/sections/preamble.md"));
  if (preamble.length !== 1) fail("E_TBV_SHAPE", "SKILL.md names " + preamble.length + " sections/preamble.md Reads before its first step, not one");
  return { command, reads: [...preamble, ...reads.filter((r) => r !== preamble[0])] };
}

/** null when the skill-start stdout is clean; else why it takes a degraded path. */
export function skillStartProblem(stdout: string): string | null {
  if (!/^SKILL_START_PROTO: 1$/m.test(stdout)) return "no SKILL_START_PROTO: 1 line (degraded mode)";
  if (/\.\/setup\b|\/gstack-upgrade\b|UPGRADE_AVAILABLE/.test(stdout)) return "it advises ./setup or /gstack-upgrade";
  const blocks = instructionBlocks(stdout).filter((id) => id !== "unattended-session");
  return blocks.length ? "it carries instruction blocks " + blocks.join(", ") : null;
}
/** The ids of the GSTACK_INSTRUCTION_BEGIN blocks in a skill-start stdout. */
export const instructionBlocks = (stdout: string): string[] => [...stdout.matchAll(/^GSTACK_INSTRUCTION_BEGIN: (\S+)/gm)].map((m) => m[1]!);

/** The first paragraph whose bold label names the closer, as the file ships it. */
export function closerParagraph(preamble: string): string {
  const p = preamble.split(/\n[ \t]*\n/).find((x) => /^\*\*[^*]*closer[^*]*\*\*/i.test(x));
  return p ?? fail("E_TBV_SHAPE", "sections/preamble.md has no closer paragraph");
}

const strip = (b: Block): Block => {
  const { cache_control: _, ...rest } = b as Block & { cache_control?: unknown };
  return rest as Block;
};
const asBlocks = (c: unknown): Block[] => (typeof c === "string" ? [{ type: "text", text: c }] : (c as Block[]).map(strip));
const resultText = (b: Block | undefined): string => (b?.type !== "tool_result" ? "" : typeof b.content === "string" ? b.content : b.content.map((x) => x.text).join("\n"));

export async function captureSplice(o: SpliceOptions): Promise<SpliceSet> {
  if (o.family === "review") fail("E_TBV_INPUT", "the review family has no splice set (prereg section 3 names investigate, ship and capy)");
  const out = outsideRepo(o.out);
  const read = (path: string): StubTurn => ({ tool: { name: "Read", input: { file_path: path } } });
  const capy = o.family === "capy";
  let rels: string[];
  let script: StubTurn[];
  let command: string | null = null;
  if (capy) {
    rels = [...CAPY_HEAD, ...CAPY_TAIL];
    script = rels.map((r) => read(CAPY_ROOT + r));
  } else {
    const plan = skillPlan(readFileSync(join(o.gstack, o.family, "SKILL.md"), "utf8"));
    command = plan.command;
    rels = plan.reads.map((r) => r.slice(SKILL_ROOT.length));
    script = [{ tool: { name: "Bash", input: { command, description: "Run the skill's first step" } } }, ...plan.reads.map(read)];
  }
  const raw = (rel: string) => readFileSync(join(o.gstack, rel), "utf8");
  const { requests, norm } = await captureSession({
    claude: o.claude,
    pin: o.pin,
    gstack: o.gstack,
    prompt: capy ? PLACEHOLDERS.firstUser : "/" + o.family + " " + PLACEHOLDERS.firstUser,
    script,
    env: { SKILL_START_PROTO: "1", GSTACK_SESSION_KIND: "unattended" },
  });
  o.onRequests?.(requests);
  const last = requests.filter((r) => isMain(r.body)).pop()!.body;
  const msgs: Message[] = (last.messages as Array<{ role: string; content: unknown }>).filter((m) => m.role !== "system").map((m) => mapStrings({ role: m.role as Message["role"], content: asBlocks(m.content) }, norm));
  const at = msgs[0]?.role === "user" ? msgs[0].content.findIndex((b) => b.type === "text" && b.text.includes(PLACEHOLDERS.firstUser)) : -1;
  if (at < 0) fail("E_TBV_SHAPE", "the captured first user message does not carry " + PLACEHOLDERS.firstUser);
  const opening = msgs[0]!.content.slice(at);
  const pairs = msgs.slice(1);
  if (pairs.length !== 2 * script.length) fail("E_TBV_SHAPE", "the captured request holds " + pairs.length + " messages after the opening, not the " + 2 * script.length + " of " + script.length + " tool calls");
  script.forEach((s, i) => {
    const use = pairs[2 * i]!.content.find((b) => b.type === "tool_use");
    const result = pairs[2 * i + 1]!.content.find((b) => b.type === "tool_result");
    if (pairs[2 * i]!.role !== "assistant" || use?.type !== "tool_use" || use.name !== s.tool!.name || JSON.stringify(use.input) !== JSON.stringify(s.tool!.input)) return fail("E_TBV_SHAPE", "captured tool call " + (i + 1) + " is not the scripted " + s.tool!.name);
    if (pairs[2 * i + 1]!.role !== "user" || result?.type !== "tool_result" || result.tool_use_id !== use.id || result.is_error) fail("E_TBV_SHAPE", "captured tool call " + (i + 1) + " (" + s.tool!.name + ") has no clean result");
  });
  let skillStart: SpliceSet["skillStart"] = null;
  if (command !== null) {
    const stdout = resultText(pairs[1]!.content.find((b) => b.type === "tool_result"));
    const problem = skillStartProblem(stdout);
    if (problem) fail("E_TBV_SHAPE", "the " + o.family + " skill start at " + o.pin + " is not clean: " + problem);
    skillStart = { command, stdout_sha256: sha256(stdout) };
  }
  const headPairs = capy ? CAPY_HEAD.length : script.length;
  const base = {
    schema: "tbv-splice.v1" as const,
    family: o.family,
    pin: o.pin,
    opening,
    head: pairs.slice(0, 2 * headPairs),
    tail: pairs.slice(2 * headPairs),
    closer: capy ? { kind: "capy" as const, files: rels.map((r) => ({ name: basename(r), sha256: sha256(raw(r)) })) } : { kind: "preamble" as const, paragraph: closerParagraph(raw(rels[0]!)) },
    skillStart,
    files: rels.map((r) => ({ path: r, sha256: sha256(raw(r)) })),
  };
  refuseForbidden(JSON.stringify([base.opening, base.head, base.tail]), "the " + o.family + " splice", ["a crew rules file name"]);
  const set: SpliceSet = { ...base, sha256: sha256(JSON.stringify(base)) };
  if (!closerHolds({ messages: [{ role: "user", content: opening }, ...set.head, ...set.tail] }, set)) fail("E_TBV_SHAPE", "the captured Reads do not de-render to the files at the pin (closer check failed on the capture itself)");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "splice-" + o.family + "-" + o.pin + ".json"), JSON.stringify(set, null, 2) + "\n");
  return set;
}

/** Consecutive messages of one role become one. */
export function joinRoles(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content.push(...m.content);
    else out.push({ role: m.role, content: [...m.content] });
  }
  return out;
}

/** The arm's messages: the splice's opening (filled with the task's first user message), head, the history's work, tail. */
export function applySplice(history: History, splice: SpliceSet): Message[] {
  const first = history.events[0];
  if (first?.kind !== "user-text") return fail("E_TBV_HISTORY", history.task + " does not open with the task's first user message");
  const [m0, ...work] = renderHistory(history);
  const opening = splice.opening.map((b) => (b.type === "text" ? { ...b, text: b.text.split(PLACEHOLDERS.firstUser).join(first.text) } : b));
  const copy = (m: Message[]): Message[] => structuredClone(m);
  return joinRoles([{ role: "user", content: [...opening, ...m0!.content.slice(1)] }, ...copy(splice.head), ...copy(work), ...copy(splice.tail)]);
}

/** Read's rendering with its line-number prefixes removed (cat -n with a tab, or the arrow form); other text is unchanged. */
export function deRender(text: string): string {
  const prefix = /^\s*\d+(\t|\u2192)/;
  return prefix.test(text) ? text.split("\n").map((l) => l.replace(prefix, "")).join("\n") : text;
}

/** The closer byte check on de-rendered request text (line-number prefixes removed). */
export function closerHolds(body: Record<string, unknown>, splice: SpliceSet): boolean {
  const texts: string[] = [];
  for (const m of (body.messages ?? []) as Array<{ content: unknown }>) {
    for (const b of asBlocks(m.content)) {
      if (b.type === "text") texts.push(b.text);
      if (b.type === "tool_result") texts.push(...(typeof b.content === "string" ? [b.content] : b.content.map((x) => x.text)).map(deRender));
    }
  }
  if (splice.closer.kind === "preamble") {
    const paragraph = splice.closer.paragraph;
    return texts.some((t) => t.includes(paragraph));
  }
  const shas = new Set(texts.map(sha256));
  return splice.closer.files.every((f) => shas.has(f.sha256));
}

/** gstack-evals tbv splice --family <investigate|ship|capy> --pin <sha> --gstack <dir> --claude <bin> --out <dir> */
export async function run(argv: string[], io: Io): Promise<number> {
  const f = flags(argv, ["--family", "--pin", "--gstack", "--claude", "--out"]);
  const family = need(f, "--family") as Family;
  if (!["investigate", "ship", "capy", "review"].includes(family)) fail("E_TBV_INPUT", "unknown family " + JSON.stringify(family));
  const s = await captureSplice({ family, pin: need(f, "--pin"), gstack: need(f, "--gstack"), claude: need(f, "--claude"), out: need(f, "--out") });
  const chars = JSON.stringify([s.opening, s.head, s.tail]).length;
  io.out("splice " + family + " " + s.pin + " " + s.sha256 + " chars " + chars + " est " + Math.ceil(chars / 3));
  for (const file of s.files) io.out("file " + file.path + " " + file.sha256);
  if (s.skillStart) {
    const stdout = resultText(s.head[1]!.content.find((b) => b.type === "tool_result"));
    io.out("skill start clean " + s.skillStart.stdout_sha256 + " instruction blocks: " + (instructionBlocks(stdout).join(", ") || "none"));
  } else io.out("skill start none (capy)");
  return 0;
}
