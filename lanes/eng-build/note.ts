// Copyright (c) 2026 Garry Tan. MIT License.
// The statement note of the eng-review build read (plan section 3): one paragraph, the same in every arm, that names
// every public name the merge adds or changes with its signature or shape. The request is built from the merge diff
// alone, never from which names the hidden tests call, and never names what exists only at a later fix. GPT-6.1 Sol
// writes the note and Opus 5.5 audits it with no tools (the real-outcome lane's V4 and V5). The model calls go through
// main's adapters; this module takes the call as a function, so its tests stub it and make no call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { git, gitRun, showFile } from "../real-outcome/mine/git.ts";
import { classifyFile } from "../real-outcome/task/region.ts";
import { ebProtected } from "./unit.ts";

export const NOTE_MODELS = { writer: "openai/gpt-6.1-sol", audit: "anthropic/claude-opus-5-5" } as const;
export const WRITER_PROMPT = join(import.meta.dir, "prompts/note-writer.md");
export const AUDIT_PROMPT = join(import.meta.dir, "prompts/note-audit.md");

export interface PublicName {
  file: string;
  name: string;
  kind: string;
  signature: string;
}

const DECLS: [RegExp, RegExp, (m: RegExpExecArray) => { name: string; kind: string } | null][] = [
  [/\.go$/, /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)\s*[[(]|^type\s+([A-Z]\w*)\s+(\w+)|^(?:var|const)\s+([A-Z]\w*)\b/, (m) => (m[1] ? { name: m[1], kind: "func" } : m[2] ? { name: m[2], kind: m[3] === "interface" || m[3] === "struct" ? m[3] : "type" } : { name: m[4], kind: "value" })],
  [/\.py$/, /^\s*(?:async\s+)?def\s+([A-Za-z]\w*)\s*\(|^class\s+([A-Za-z]\w*)\b/, (m) => (m[1] ? { name: m[1], kind: "def" } : { name: m[2], kind: "class" })],
  [/\.[cm]?[jt]sx?$/, /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([\w$]+)/, (m) => ({ name: m[2], kind: m[1].replace(/\s+/g, " ") })],
  [/\.rs$/, /^\s*pub(?:\([^)]*\))?\s+(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait|type|const|static|mod)\s+(\w+)/, (m) => ({ name: m[2], kind: m[1] })],
];

/** The signature as written on its line, without a trailing body opener. */
const signatureOf = (line: string): string => line.trim().replace(/\s*(\{|:)\s*$/, "").replace(/\s+/g, " ");

/** Public names a diff's added lines declare in product files. Lines inside a Rust file's test region, and every
 * protected test path, are left out. */
export function publicNames(repo: string, a: string, b: string): PublicName[] {
  const out = new Map<string, PublicName>();
  const files = git(repo, ["diff", "--name-only", "-z", "--no-renames", a, b]).split("\0").filter((p) => p && !ebProtected(p));
  for (const file of files) {
    const rule = DECLS.find(([f]) => f.test(file));
    const text = showFile(repo, b, file);
    if (!rule || text === null) continue;
    const c = classifyFile(file, text);
    const lineOf = (off: number) => text.slice(0, off).split("\n").length;
    const region = c.kind === "region" ? [lineOf(c.start), lineOf(c.end)] : null;
    let line = 0;
    for (const l of git(repo, ["diff", "-U0", "--no-renames", a, b, "--", file]).split("\n")) {
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
      if (h) {
        line = Number(h[1]);
        continue;
      }
      if (l.startsWith("+++") || l.startsWith("---")) continue;
      if (!l.startsWith("+")) continue;
      const at = line++;
      if (region && at >= region[0] && at <= region[1]) continue;
      const m = rule[1].exec(l.slice(1));
      const d = m ? rule[2](m) : null;
      if (!d || d.name.startsWith("_") || (file.endsWith(".py") && /^(test_|Test)/.test(d.name))) continue;
      const key = file + "\0" + d.name;
      if (!out.has(key)) out.set(key, { file, name: d.name, kind: d.kind, signature: signatureOf(l.slice(1)) });
    }
  }
  return [...out.values()].sort((x, y) => x.file.localeCompare(y.file) || x.name.localeCompare(y.name));
}

/** Names later fixes declare that the merged tree never mentions: a note that names one gives the fix away. */
export function fixOnlyNames(repo: string, merge: string, fixes: string[]): string[] {
  const names = new Set(fixes.flatMap((f) => publicNames(repo, f + "^1", f).map((n) => n.name)));
  return [...names].filter((n) => gitRun(repo, ["grep", "-q", "-w", "-F", "-e", n, merge]).status !== 0).sort();
}

export interface NoteRequest {
  names: PublicName[];
  writerPrompt: string;
}

const render = (names: PublicName[]): string => names.map((n) => "- " + n.name + " (" + n.kind + ", in " + n.file + "): " + n.signature).join("\n");

/** The writer's request: the frozen prompt file with the merge diff's public names. */
export function noteRequest(repo: string, base: string, merge: string): NoteRequest {
  const names = publicNames(repo, base, merge);
  return { names, writerPrompt: readFileSync(WRITER_PROMPT, "utf8").replace("{{NAMES}}", render(names)) };
}

export const auditPrompt = (req: NoteRequest, note: string): string => readFileSync(AUDIT_PROMPT, "utf8").replace("{{NAMES}}", render(req.names)).replace("{{NOTE}}", note.trim());

/** The audit's refusal rule: the note stands only when the auditor's whole answer is the line PASS, it names every
 * requested name, it names no fix-only name and it is one paragraph. Returns the reason for a refusal, or null. */
export function refusal(answer: string, note: string, req: NoteRequest, fixOnly: string[]): string | null {
  const first = answer.trim();
  if (first !== "PASS") return "auditor: " + (first.split("\n")[0] || "no answer").slice(0, 200);
  const has = (n: string) => new RegExp("(^|[^\\w$])" + n.replace(/[$]/g, "\\$") + "($|[^\\w$])").test(note);
  const missing = req.names.filter((n) => !has(n.name)).map((n) => n.name);
  if (missing.length) return "the note leaves out " + missing.join(", ");
  const leaked = fixOnly.filter(has);
  if (leaked.length) return "the note names what exists only at a later fix: " + leaked.join(", ");
  if (note.trim().split(/\n\s*\n/).length > 1) return "the note is more than one paragraph";
  return null;
}

/** A model call through main's adapters: the role picks the model in NOTE_MODELS. */
export type ModelCall = (role: keyof typeof NOTE_MODELS, prompt: string) => Promise<string>;

/** Writes and audits one note. A refused note is returned with its reason and is never used. */
export async function writeNote(req: NoteRequest, fixOnly: string[], call: ModelCall): Promise<{ note: string; refused: string | null }> {
  if (req.names.length === 0) return { note: "", refused: null };
  const note = (await call("writer", req.writerPrompt)).trim();
  const answer = await call("audit", auditPrompt(req, note));
  return { note, refused: refusal(answer, note, req, fixOnly) };
}
