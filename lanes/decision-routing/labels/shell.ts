// Copyright (c) 2026 Garry Tan. MIT License.
// A small shell reader for the frozen label rules (next-step mapping, safety rule) and the scorer's edit test. It splits
// a command into pipelines of simple commands, removes quotes, keeps redirections apart from words and attaches each
// here-document body to the command that opened it. It is not a full shell: $(...) and backticks stay inside words.

export interface Redirect { op: string; target: string }
export interface Simple { words: string[]; redirects: Redirect[]; heredoc: string | null }

type Tok = { t: "w"; v: string } | { t: "op"; v: string };

function hereDocs(cmd: string): { text: string; bodies: string[] } {
  const lines = cmd.split("\n");
  const kept: string[] = [];
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    kept.push(line);
    for (const m of line.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) {
      if (line[m.index! + 2] === "<") continue;
      const body: string[] = [];
      while (i + 1 < lines.length && lines[i + 1]!.trim() !== m[2]) body.push(lines[++i]!);
      if (i + 1 < lines.length) i++;
      bodies.push(body.join("\n"));
    }
  }
  return { text: kept.join("\n"), bodies };
}

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let w = "", has = false, i = 0;
  const push = () => { if (has) out.push({ t: "w", v: w }); w = ""; has = false; };
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") { const j = s.indexOf("'", i + 1); const end = j < 0 ? s.length : j; w += s.slice(i + 1, end); has = true; i = end + 1; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === "\\" && j + 1 < s.length) { w += s[j + 1]; j += 2; } else { w += s[j]; j++; } }
      has = true; i = j + 1; continue;
    }
    if (c === "\\" && i + 1 < s.length) { if (s[i + 1] !== "\n") w += s[i + 1]; has = true; i += 2; continue; }
    if (c === " " || c === "\t") { push(); i++; continue; }
    if (c === "\n" || c === ";") { push(); out.push({ t: "op", v: ";" }); i++; continue; }
    if (c === "&" || c === "|") {
      const two = s.slice(i, i + 2);
      if (two === "&&" || two === "||") { push(); out.push({ t: "op", v: ";" }); i += 2; continue; }
      if (two === "&>") { push(); const app = s[i + 2] === ">"; out.push({ t: "op", v: app ? ">>" : ">" }); i += app ? 3 : 2; continue; }
      push(); out.push({ t: "op", v: c === "|" ? "|" : ";" }); i += c === "|" && s[i + 1] === "&" ? 2 : 1; continue;
    }
    if (c === ">" || c === "<") {
      if (/^\d+$/.test(w)) { w = ""; has = false; } else push();
      let op = c; i++;
      if (s[i] === c) { op += c; i++; if (c === "<" && s[i] === "<") { op += "<"; i++; } }
      if (op === "<<" && s[i] === "-") i++;
      if (s[i] === "&") { op += "&"; i++; }
      if (c === ">" && s[i] === "|") i++;
      out.push({ t: "op", v: op });
      continue;
    }
    w += c; has = true; i++;
  }
  push();
  return out;
}

/** Pipelines in order (split on ;, &&, ||, & and newlines), each a list of simple commands split on |. */
export function parse(cmd: string): Simple[][] {
  const { text, bodies } = hereDocs(cmd);
  const pipelines: Simple[][] = [];
  let pipe: Simple[] = [];
  let cur: Simple = { words: [], redirects: [], heredoc: null };
  const endSimple = () => { if (cur.words.length || cur.redirects.length) pipe.push(cur); cur = { words: [], redirects: [], heredoc: null }; };
  const endPipe = () => { endSimple(); if (pipe.length) pipelines.push(pipe); pipe = []; };
  const toks = lex(text);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t === "w") { cur.words.push(t.v); continue; }
    if (t.v === ";") { endPipe(); continue; }
    if (t.v === "|") { endSimple(); continue; }
    const next = toks[i + 1];
    const target = next && next.t === "w" ? next.v : "";
    if (next && next.t === "w") i++;
    cur.redirects.push({ op: t.v, target });
    if (t.v === "<<") cur.heredoc = bodies.shift() ?? "";
  }
  endPipe();
  return pipelines;
}

const WRAPPERS = new Set(["sudo", "env", "nohup", "time", "command", "exec", "nice"]);

/** The words after leading VAR=value assignments and wrappers such as sudo, env or nohup. */
export function bare(words: string[]): string[] {
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || WRAPPERS.has(words[i]!))) i++;
  return words.slice(i);
}

/** Index of the first top-level single | (not ||, not quoted), or -1. */
export function firstPipe(s: string): number {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === "\\" && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "|") { if (s[i + 1] === "|") { i++; continue; } if (s[i - 1] === ">") continue; return i; }
  }
  return -1;
}
