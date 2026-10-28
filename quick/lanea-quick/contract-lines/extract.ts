#!/usr/bin/env bun
// Extracts "contract lines" from a gstack skill at two commits and classifies each
// before line against the after copy (kept / moved / rewritten / removed).
//
// Usage:
//   bun quick/lanea-quick/contract-lines/extract.ts --gstack ~/.capy/work/gstack \
//     --before <sha> --after <sha> --skill office-hours \
//     --out quick/lanea-quick/contract-lines/lines.json
//
// Reads only through "git show", so a blobless clone works. No dependencies.
// Every rule below is also written into the output's meta.rules block.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

type Category = "must" | "never" | "stop" | "prohibition" | "ask" | "output";
type Kind = "prose" | "heading" | "table" | "format";
type Load = "always" | "always (read first)" | "on-demand";

interface Unit {
  file: string;
  line: number;
  end_line: number;
  kind: Kind;
  heading: string;
  raw: string;
  norm: string;
}

interface FileInfo {
  path: string;
  sha256: string;
  lines: number;
  units: Unit[];
}

function arg(name: string): string {
  const i = process.argv.indexOf("--" + name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error("missing --" + name);
    console.error(
      "usage: bun extract.ts --gstack <repo> --before <sha> --after <sha> --skill <name> --out <lines.json>",
    );
    process.exit(2);
  }
  return v;
}

const GSTACK = resolve(arg("gstack").replace(/^~(?=\/|$)/, homedir()));
const BEFORE = arg("before");
const AFTER = arg("after");
const SKILL = arg("skill");
const OUT = resolve(arg("out"));

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", GSTACK, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    console.error("git " + args.join(" ") + " failed: " + r.stderr.toString());
    process.exit(1);
  }
  return r.stdout.toString();
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Fences in these languages hold commands, not instructions; they are skipped whole.
const SHELL_FENCE = /^(?:bash|sh|shell|zsh|console)$/i;

// Inside any other fence (plain, text, markdown, yaml) only output-format lines count:
// a markdown heading the output must carry, or an ALL-CAPS label such as "PREMISES:",
// "APPROACH A: [Name]", "SECOND OPINION (Codex):", "D<N> —", "Q<N> —".
const FORMAT_LINE = [
  /^#{1,6}\s+\S/,
  /^(?:[A-Z][A-Z0-9_]+(?:\s+[A-Z0-9<>_]+)*|[A-Z]<N>)(?:\s*\([^)]*\))?\s*(?::|—)/,
];

const CATEGORY_RULES: Record<Category, RegExp[]> = {
  must: [/\bmust\b/i, /\bALWAYS\b/, /\b(?:required|mandatory|non-negotiable)\b/i],
  never: [/\bnever\b/i],
  stop: [/\bSTOP\b/, /\bstop (?:immediately|here|the loop|and (?:wait|read|reassess))\b/i],
  prohibition: [
    /\b(?:do not|don['’]t|does not|doesn['’]t|must not|should not|cannot|can['’]t|may not)\b/i,
    /\bNOT\b/,
    /\bskips?\b/i,
    /\bavoid\b/i,
  ],
  ask: [
    /\bAskUserQuestion\b/,
    /\bask(?:s|ing)?\b/i,
    /\bapprov(?:e|es|ed|al)\b/i,
    /\bconfirm(?:s|ed|ation)?\b/i,
    /\bwait(?:s|ing)?\b/i,
    /\buser responds\b/i,
  ],
  output: [
    /\boutput\b/i,
    /\bformat\b/i,
    /\b(?:header|heading)s?\b/i,
    /\b(?:design doc(?:ument)?s?|wireframe|mockups?|sketch|screenshot|assignment)\b/i,
    /\b(?:write|writes|save|saves|append|appends|log|print|emit|present|show|display)\b[^.]*?(?:\.(?:md|json|jsonl|html|png)\b|\bfile\b|\bline\b|\bentry\b)/i,
    /\b(?:say|says|display|tell the user)\b[^.]{0,60}?["“:]/i,
  ],
};

// Similarity for "rewritten": Sørensen-Dice over multisets of lowercase word tokens,
// stopwords removed (negations are kept because they carry the contract).
const STOPWORDS = new Set(
  (
    "a an the and or of to in on for with by at as is are be been it its this that these those " +
    "from into than then so if when while which who what your you we our their they them he she " +
    "i me my his her there here will would can could should may might just also only any each"
  ).split(" "),
);
const REWRITE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  let t = s;
  t = t.replace(/^\s*(?:>\s?)+/, "");
  t = t.replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+/, "");
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/`/g, "");
  t = t.replace(/\*\*|__/g, "");
  t = t.replace(/(?<=^|[\s(["'])\*(?=\S)(.+?)(?<=\S)\*(?=$|[\s).,;:!?"'\]])/g, "$1");
  t = t.replace(/(?<=^|[\s(["'])_(?=\S)(.+?)(?<=\S)_(?=$|[\s).,;:!?"'\]])/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

const TERMINAL = /[.?!:;]["'”’)\]*_`]*\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]\s|\d+[.)]\s|[A-Z]\)\s)/;

function parse(file: string, text: string): Unit[] {
  const lines = text.split("\n");
  const units: Unit[] = [];
  let i = 0;
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") i++;
    i++;
  }
  let fence: { lang: string } | null = null;
  let heading = "";
  let cur: (Unit & { quote: boolean; last: string }) | null = null;
  const flush = () => {
    if (cur) {
      const { quote: _q, last: _l, ...u } = cur;
      u.norm = normalize(u.raw);
      if (u.norm) units.push(u);
    }
    cur = null;
  };
  for (; i < lines.length; i++) {
    const ln = lines[i] ?? "";
    const n = i + 1;
    const fm = ln.match(/^\s*(?:>\s*)?(```+|~~~+)\s*([\w-]*)/);
    if (fm) {
      flush();
      fence = fence ? null : { lang: fm[2] ?? "" };
      continue;
    }
    if (fence) {
      if (SHELL_FENCE.test(fence.lang)) continue;
      const t = ln.trim();
      if (FORMAT_LINE.some((r) => r.test(t)))
        units.push({ file, line: n, end_line: n, kind: "format", heading, raw: t, norm: normalize(t) });
      continue;
    }
    const t = ln.trim();
    if (!t || /^<!--.*-->$/.test(t) || /^(?:-{3,}|\*{3,})$/.test(t) || /^>\s*$/.test(t)) {
      flush();
      continue;
    }
    const hm = t.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      flush();
      heading = normalize(hm[2] ?? "");
      units.push({ file, line: n, end_line: n, kind: "heading", heading, raw: t, norm: heading });
      continue;
    }
    if (t.startsWith("|")) {
      flush();
      if (!/^\|[-:|\s]+\|$/.test(t))
        units.push({ file, line: n, end_line: n, kind: "table", heading, raw: t, norm: normalize(t) });
      continue;
    }
    const quote = t.startsWith(">");
    const body = quote ? t.replace(/^(?:>\s?)+/, "") : t;
    const marker = LIST_MARKER.test(body);
    const c = cur as (Unit & { quote: boolean; last: string }) | null;
    if (c && !TERMINAL.test(c.last) && !marker && (quote === c.quote || !quote)) {
      c.raw += " " + body;
      c.end_line = n;
      c.last = body;
    } else {
      flush();
      cur = { file, line: n, end_line: n, kind: "prose", heading, raw: body, norm: "", quote, last: body };
    }
  }
  flush();
  return units;
}

function categories(u: Unit): Category[] {
  if (u.kind === "format") return ["output"];
  return (Object.keys(CATEGORY_RULES) as Category[]).filter((c) =>
    CATEGORY_RULES[c].some((r) => r.test(u.norm)),
  );
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9#<>/._'-]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^[.'_/-]+|[.'_/-]+$/g, ""))
    .filter((w) => w && !STOPWORDS.has(w));
}

function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const m = new Map<string, number>();
  for (const w of a) m.set(w, (m.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const k = m.get(w) ?? 0;
    if (k > 0) {
      shared++;
      m.set(w, k - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const clip = (s: string) => (s.length > 200 ? s.slice(0, 199) + "…" : s);

function loadOf(file: string): Load {
  if (file === "SKILL.md") return "always";
  if (file === "sections/preamble.md") return "always (read first)";
  return "on-demand";
}

function readSkill(sha: string): FileInfo[] {
  const sectionFile = new RegExp("^" + SKILL + "/sections/[^/]+\\.md$");
  const paths = git("ls-tree", "-r", "--name-only", sha, SKILL + "/")
    .split("\n")
    .filter((p) => p === SKILL + "/SKILL.md" || sectionFile.test(p))
    .sort((a, b) => (a.endsWith("/SKILL.md") ? -1 : b.endsWith("/SKILL.md") ? 1 : a.localeCompare(b)));
  return paths.map((p) => {
    const text = git("show", sha + ":" + p);
    const rel = p.slice(SKILL.length + 1);
    return { path: rel, sha256: sha256(text), lines: text.split("\n").length - 1, units: parse(rel, text) };
  });
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const before = readSkill(BEFORE);
const after = readSkill(AFTER);
const fileOrder = (f: string) => (f === "SKILL.md" ? "" : f);

const beforeUnits = before.flatMap((f) => f.units);
const afterUnits = after.flatMap((f) => f.units);
const beforeContract = beforeUnits.map((u) => ({ u, cats: categories(u) })).filter((x) => x.cats.length);

// Exact pairing is a multiset match on normalized text: same-file occurrences pair first,
// in line order; leftovers pair in order, after-SKILL.md occurrences first, then sections by name.
const afterByNorm = new Map<string, Unit[]>();
for (const u of afterUnits) afterByNorm.set(u.norm, [...(afterByNorm.get(u.norm) ?? []), u]);
const beforeByNorm = new Map<string, Unit[]>();
for (const { u } of beforeContract) beforeByNorm.set(u.norm, [...(beforeByNorm.get(u.norm) ?? []), u]);

const pair = new Map<Unit, Unit>();
for (const [norm, bs] of beforeByNorm) {
  const pool = [...(afterByNorm.get(norm) ?? [])];
  const left: Unit[] = [];
  for (const b of bs) {
    const k = pool.findIndex((a) => a.file === b.file);
    if (k >= 0) pair.set(b, pool.splice(k, 1)[0] as Unit);
    else left.push(b);
  }
  pool.sort((x, y) => fileOrder(x.file).localeCompare(fileOrder(y.file)) || x.line - y.line);
  for (const b of left) {
    const a = pool.shift();
    if (a) pair.set(b, a);
  }
}

const beforeNorms = new Set(beforeUnits.map((u) => u.norm));
const tokenCache = new Map<Unit, string[]>();
const tok = (u: Unit) => {
  let t = tokenCache.get(u);
  if (!t) tokenCache.set(u, (t = tokens(u.norm)));
  return t;
};
const afterSkillNew = afterUnits.filter((u) => u.file === "SKILL.md" && !beforeNorms.has(u.norm));

function closest(src: Unit, pool: Unit[], preferFile?: string) {
  const st = tok(src);
  let best: { u: Unit; score: number } | null = null;
  for (const u of pool) {
    const score = dice(st, tok(u));
    const better =
      !best ||
      score > best.score ||
      (score === best.score &&
        ((u.file === "SKILL.md" && best.u.file !== "SKILL.md") ||
          (u.file === preferFile && best.u.file !== preferFile)));
    if (better) best = { u, score };
  }
  return best;
}

const ref = (u: Unit) => ({ file: u.file, line: u.line, text: clip(u.norm) });
const round = (x: number) => Math.round(x * 1000) / 1000;
const idOf = (prefix: string, u: Unit) =>
  prefix + ":" + u.file.replace(/^sections\//, "").replace(/\.md$/, "") + ":" + String(u.line).padStart(4, "0");

const beforeLines = beforeContract.map(({ u, cats }) => {
  const exact = pair.get(u);
  let cls: "kept" | "moved" | "rewritten" | "removed";
  let match: { file: string; line: number; text: string; similarity: number } | null = null;
  let skillRewrite: { file: string; line: number; text: string; similarity: number } | null = null;
  if (exact) {
    cls = exact.file === "SKILL.md" ? "kept" : "moved";
    match = { ...ref(exact), similarity: 1 };
    if (cls === "moved" && u.file === "SKILL.md") {
      const c = closest(u, afterSkillNew);
      if (c && c.score >= REWRITE_THRESHOLD) skillRewrite = { ...ref(c.u), similarity: round(c.score) };
    }
  } else {
    const c = closest(u, afterUnits, u.file);
    if (c && c.score >= REWRITE_THRESHOLD) {
      cls = "rewritten";
      match = { ...ref(c.u), similarity: round(c.score) };
    } else {
      cls = "removed";
      match = c ? { ...ref(c.u), similarity: round(c.score) } : null;
    }
  }
  const afterFile = cls === "removed" || !match ? null : match.file;
  return {
    id: idOf("B", u),
    before_file: u.file,
    before_line: u.line,
    before_end_line: u.end_line,
    load_before: loadOf(u.file),
    heading: u.heading,
    kind: u.kind,
    categories: cats,
    text: clip(u.norm),
    class: cls,
    after_file: afterFile,
    load_after: afterFile ? loadOf(afterFile) : null,
    diet_change: cls === "rewritten" || cls === "removed" || (u.file === "SKILL.md" && cls === "moved"),
    match,
    skill_rewrite: skillRewrite,
  };
});

const afterOnly = afterUnits
  .map((u) => ({ u, cats: categories(u) }))
  .filter(({ u, cats }) => cats.length && !beforeNorms.has(u.norm))
  .map(({ u, cats }) => {
    const c = closest(u, beforeUnits, u.file);
    return {
      id: idOf("A", u),
      after_file: u.file,
      after_line: u.line,
      load_after: loadOf(u.file),
      heading: u.heading,
      kind: u.kind,
      categories: cats,
      text: clip(u.norm),
      closest_before: c ? { ...ref(c.u), similarity: round(c.score) } : null,
    };
  });

const count = <T>(xs: T[], key: (x: T) => string) => {
  const o: Record<string, number> = {};
  for (const x of xs) o[key(x)] = (o[key(x)] ?? 0) + 1;
  return o;
};

const out = {
  meta: {
    tool: "quick/lanea-quick/contract-lines/extract.ts",
    gstack_repo: "garrytan/gstack (public, MIT)",
    skill: SKILL,
    before: BEFORE,
    after: AFTER,
    files: {
      before: before.map(({ path, sha256, lines, units }) => ({ path, sha256, lines, units: units.length })),
      after: after.map(({ path, sha256, lines, units }) => ({ path, sha256, lines, units: units.length })),
    },
    rules: {
      files: SKILL + "/SKILL.md plus every " + SKILL + "/sections/*.md (no .tmpl, no manifest.json)",
      units:
        "Logical lines. Outside fences, consecutive non-blank physical lines join while the previous line does not end in . ? ! : ; (optionally followed by closing quotes, brackets or emphasis) and the next line starts no list item (-, *, +, 1., 1), A)); a blockquote line never continues into a plain line. Blank lines, horizontal rules, headings, table rows and fences end a unit. Headings and table rows are their own units. YAML front matter and whole-line HTML comments are skipped.",
      fences:
        "Fences in " + String(SHELL_FENCE) + " are skipped whole (commands, not instructions). In other fences only output-format lines count: " +
        FORMAT_LINE.map(String).join(" or ") + ".",
      normalization:
        "Strip blockquote, list and heading markers; curly quotes to straight; drop backticks; drop ** and __; drop single * or _ emphasis around words; collapse whitespace; trim. Case is kept.",
      categories: Object.fromEntries(Object.entries(CATEGORY_RULES).map(([k, v]) => [k, v.map(String)])),
      contract_line: "A unit whose normalized text matches at least one category regex; every format line counts as output.",
      classes: {
        kept: "Exact normalized match in after SKILL.md (always loaded).",
        moved:
          "No exact match left in after SKILL.md, exact match in an after sections/*.md file (on-demand, except preamble.md which SKILL.md reads first).",
        rewritten: "No exact match anywhere in after; best similarity to any after unit >= " + REWRITE_THRESHOLD + ".",
        removed: "No exact match and best similarity < " + REWRITE_THRESHOLD + ".",
      },
      exact_pairing:
        "Multiset match on normalized text: occurrences in the same file pair first, in line order; leftover before occurrences pair in order with leftover after occurrences, after SKILL.md first, then sections by name. A line that appears twice in before needs two copies in after to be matched twice.",
      similarity:
        "Sørensen-Dice over multisets of lowercase word tokens (split on characters outside [a-z0-9#<>/._'-], edge punctuation trimmed), stopwords removed: " +
        [...STOPWORDS].join(" ") + ". Negations are not stopwords. Ties prefer after SKILL.md, then the before line's own file.",
      rewrite_threshold: REWRITE_THRESHOLD,
      skill_rewrite:
        "For a SKILL.md line classed moved: the closest after-SKILL.md unit that is new in after, when its similarity is >= the threshold. It marks a moved block whose shortened copy stayed in the always-loaded file.",
      diet_change:
        "true for rewritten and removed lines, and for lines that moved out of SKILL.md. false for kept lines and for lines that were already in a section and stayed there.",
      load: "SKILL.md is always loaded; sections/preamble.md is read first on every run (SKILL.md says so); other sections are read on demand.",
    },
    counts: {
      before_units: beforeUnits.length,
      after_units: afterUnits.length,
      before_contract_lines: beforeLines.length,
      by_class: count(beforeLines, (x) => x.class),
      by_class_and_before_file: count(beforeLines, (x) => x.class + " | " + x.before_file),
      diet_change: beforeLines.filter((x) => x.diet_change).length,
      after_only_contract_lines: afterOnly.length,
      after_only_by_file: count(afterOnly, (x) => x.after_file),
    },
  },
  before_lines: beforeLines,
  after_only_lines: afterOnly,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.meta.counts, null, 2));
