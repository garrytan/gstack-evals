// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 6.4: CHECKS.json read as the arm's manifest. Entries in listed order; an entry whose command is missing,
// empty or not a string is skipped and counted. An entry counts only when it holds no inline program and names something
// in T. Counted entries run in two groups in listed order (entries that name no model file, then the ones that do); at
// most the first 25 run and the rest are beyond the cap. Section 5: a file that is absent, not JSON, not an array, or
// holds an element that is not an object is no manifest (the session scores 0).
export const INTERPRETER = /^(bash|sh|zsh|python|python3(\.\d+)?|node|bun|deno|ruby|perl|php)$/;
export const MODEL_EXT = [".tla", ".cfg", ".pcal", ".als", ".pml", ".smv", ".qnt"] as const;
export const CAP = 25;

export type NoManifest = "absent" | "not_json" | "not_array" | "not_objects" | "wrapup_limit";
export interface Entry { index: number; name: string | null; command: string; model: boolean }
export interface TFacts {
  /** Paths new or edited in T against base. */
  changed: string[];
  /** Every test file in T by the unit language's patterns (and the unit's test.patch files). */
  test_files: string[];
  /** Identifiers of 4 characters or more in the new or edited test files of T. */
  test_words: ReadonlySet<string>;
}
export interface ManifestRead {
  none: NoManifest | null; listed: number; skipped: number[]; inline: number[]; names_nothing: number[]; beyond_cap: number[];
  /** The entries that run, in run order. */
  run: Entry[];
}

/** Shell-ish words: operators split off, quotes removed. Only used to find interpreter flags. */
export function words(cmd: string): string[] {
  return cmd.replace(/(&&|\|\||[;|&()])/g, " $1 ").split(/\s+/).filter(Boolean).map((w) => w.replace(/^['"\x60]+|['"\x60]+$/g, ""));
}

/** An -c or -e argument to an interpreter (also inside a short-flag cluster such as -ec, and --eval), a heredoc or
 *  here-string (<<), or process substitution (<( or >(). Interpreter flags are read up to the first word that is not a
 *  flag, "--", or python's -m. */
export function inlineProgram(cmd: string): boolean {
  if (cmd.includes("<<") || /[<>]\(/.test(cmd)) return true;
  const w = words(cmd);
  for (let i = 0; i < w.length; i++) {
    const base = w[i]!.split("/").pop()!;
    if (!INTERPRETER.test(base)) continue;
    for (let j = i + 1; j < w.length; j++) {
      const x = w[j]!;
      if (!x.startsWith("-") || x === "--" || (base.startsWith("python") && x === "-m")) break;
      if (x === "--eval" || (/^-[A-Za-z]+$/.test(x) && /[ce]/.test(x))) return true;
    }
  }
  return false;
}

export const tokens = (cmd: string): string[] => cmd.split(/[\s'"=:,#/\x60]+/).filter(Boolean);
const baseName = (p: string) => p.split("/").pop()!;
/** A file's names for the rule: its basename, the basename less its last extension, and less everything from its first dot. */
export const stems = (p: string): string[] => {
  const b = baseName(p);
  return [...new Set([b, b.replace(/\.[^.]*$/, ""), b.replace(/\..*$/, "")])].filter(Boolean);
};
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{3,}$/;

/** The tokens of cmd that name something in T: a new or edited file's path or basename, a test file's basename or stem,
 *  or an identifier of 4 characters or more that is a whole word in a new or edited test file. */
export function namedBy(cmd: string, f: TFacts): string[] {
  const files = new Set(f.changed.flatMap((p) => [p, baseName(p)]));
  const tests = new Set(f.test_files.flatMap(stems));
  return tokens(cmd).filter((t) => files.has(t) || tests.has(t) || (IDENT.test(t) && f.test_words.has(t)));
}
export const namesModel = (cmd: string): boolean => tokens(cmd).some((t) => MODEL_EXT.some((e) => t.toLowerCase().endsWith(e)));

export function parseManifest(text: string | null): unknown[] | NoManifest {
  if (text === null) return "absent";
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return "not_json";
  }
  if (!Array.isArray(j)) return "not_array";
  if (j.some((e) => !e || typeof e !== "object" || Array.isArray(e))) return "not_objects";
  return j;
}

export function readManifest(text: string | null, facts: TFacts, o: { wrapupLimit?: boolean } = {}): ManifestRead {
  const parsed = parseManifest(text);
  const out: ManifestRead = { none: null, listed: 0, skipped: [], inline: [], names_nothing: [], beyond_cap: [], run: [] };
  if (typeof parsed === "string") return { ...out, none: o.wrapupLimit ? "wrapup_limit" : parsed };
  out.listed = parsed.length;
  const counted: Entry[] = [];
  parsed.forEach((e, index) => {
    const r = e as Record<string, unknown>;
    if (typeof r.command !== "string" || !r.command.trim()) return void out.skipped.push(index);
    if (inlineProgram(r.command)) return void out.inline.push(index);
    if (!namedBy(r.command, facts).length) return void out.names_nothing.push(index);
    counted.push({ index, name: typeof r.name === "string" ? r.name : null, command: r.command, model: namesModel(r.command) });
  });
  const ordered = [...counted.filter((e) => !e.model), ...counted.filter((e) => e.model)];
  out.run = ordered.slice(0, CAP);
  out.beyond_cap = ordered.slice(CAP).map((e) => e.index);
  return out;
}
