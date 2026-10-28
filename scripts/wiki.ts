#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const KINDS = ["plan", "design", "research", "decision", "finding", "handoff", "report", "question"];
export const STATUSES = ["open", "done", "superseded", "answered"];
export const SECTIONS: Record<string, string[]> = {
  board: ["decision", "finding", "handoff", "report", "question"],
  plans: ["plan", "design"],
  research: ["research"],
};
const REQUIRED = ["id", "kind", "title", "summary", "author", "date", "status"];
const SCALARS = new Set([...REQUIRED, "model", "captain", "source"]);
const LISTS = new Set(["supersedes", "answers", "links", "attachments"]);
const NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUMMARY_MAX = 200;

export const SECRET_RULES: [string, RegExp][] = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["sk-key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  ["slack-token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["stripe-key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/],
  ["huggingface-token", /\bhf_[A-Za-z0-9]{30,}/],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["assigned-secret", /\b(?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{24,}/i],
];
export const SEALED_MARKER = /\bSEALED(?: [A-Z]+)*:/;

export type Problem = { file: string; line?: number; message: string };
export type FrontMatter = Record<string, string | string[]>;
export type Entry = { id: string; section: string; path: string; bundle: boolean; fm: FrontMatter };

function scalar(raw: string): string | null {
  const v = raw.trim();
  if (v.startsWith('"')) return /^"[^"\\]*"$/.test(v) ? v.slice(1, -1) : null;
  if (v.startsWith("'")) return /^'(?:[^']|'')*'$/.test(v) ? v.slice(1, -1).replaceAll("''", "'") : null;
  if (/^[[\]{}#&*!|>%@\x60,]/.test(v) || /^[-?:](?:\s|$)/.test(v)) return null;
  if (v.includes(": ") || v.includes(" #") || v.endsWith(":")) return null;
  return v;
}

function splitFlowList(inner: string): string[] | null {
  const parts: string[] = [];
  let quote = "";
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === "'" && quote === "'" && inner[i + 1] === "'") i++;
      else if (ch === quote) quote = "";
    } else if ((ch === '"' || ch === "'") && inner.slice(start, i).trim() === "") {
      quote = ch;
    } else if (ch === ",") {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (quote) return null;
  parts.push(inner.slice(start));
  return parts;
}

export function parseFrontMatter(text: string): { fm: FrontMatter } | { error: string; line?: number } {
  if (text.includes("\r")) return { error: "use LF line endings" };
  const lines = text.split("\n");
  if (lines[0] !== "---") return { error: "no front matter: the file must start with a --- line", line: 1 };
  const close = lines.indexOf("---", 1);
  if (close < 0) return { error: "front matter is not closed by a --- line", line: 1 };
  const fm: FrontMatter = {};
  let listKey: string | null = null;
  let listIndent: string | null = null;
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const unquotable = { error: "value is not a plain or quoted YAML string; quote it with double quotes", line: i + 1 };
    const item = line.match(/^((?:  )?)- (.*)$/);
    if (item) {
      if (!listKey) return { error: "list item without a list field above it", line: i + 1 };
      if (listIndent !== null && item[1] !== listIndent) return { error: "items of one list must share one indentation", line: i + 1 };
      listIndent = item[1];
      const v = scalar(item[2]);
      if (v === null) return unquotable;
      (fm[listKey] as string[]).push(v);
      continue;
    }
    const kv = line.match(/^([a-z_]+):(?: (.*))?$/);
    if (!kv) return { error: 'front matter lines are "key: value", "key: [a, b]", "key:" or "  - item"', line: i + 1 };
    const key = kv[1];
    const value = (kv[2] ?? "").trim();
    if (key in fm) return { error: 'duplicate field "' + key + '"', line: i + 1 };
    listKey = null;
    listIndent = null;
    if (value === "") {
      fm[key] = [];
      listKey = key;
    } else if (value.startsWith("[")) {
      if (!value.endsWith("]")) return { error: "inline list must end with ]", line: i + 1 };
      const parts = splitFlowList(value.slice(1, -1));
      if (!parts) return { error: "inline list has an unclosed quote", line: i + 1 };
      const items: string[] = [];
      for (const part of parts.length === 1 && parts[0].trim() === "" ? [] : parts) {
        if (part.trim() === "") return { error: "inline list has an empty item", line: i + 1 };
        const v = scalar(part);
        if (v === null || (!/^\s*["']/.test(part) && /[[\]{}]/.test(v))) return unquotable;
        items.push(v);
      }
      fm[key] = items;
    } else {
      const v = scalar(value);
      if (v === null) return unquotable;
      fm[key] = v;
    }
  }
  return { fm };
}

const str = (e: Entry, k: string) => (typeof e.fm[k] === "string" ? (e.fm[k] as string) : "");
const list = (e: Entry, k: string) => (Array.isArray(e.fm[k]) ? (e.fm[k] as string[]) : []);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const rel = prefix ? prefix + "/" + name : name;
      return statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name), rel) : [rel];
    });
}

export function loadWiki(root: string): { entries: Entry[]; problems: Problem[] } {
  const wiki = join(root, "wiki");
  const entries: Entry[] = [];
  const problems: Problem[] = [];
  if (!existsSync(wiki)) return { entries, problems: [{ file: "wiki", message: "no wiki/ folder" }] };
  const read = (section: string, id: string, path: string, bundle: boolean) => {
    const parsed = parseFrontMatter(readFileSync(join(root, path), "utf8"));
    if ("error" in parsed) problems.push({ file: path, line: parsed.line, message: parsed.error });
    else entries.push({ id, section, path, bundle, fm: parsed.fm });
  };
  for (const name of readdirSync(wiki).sort()) {
    if (name === "README.md" || name === "INDEX.md") continue;
    const rel = "wiki/" + name;
    if (!(name in SECTIONS) || !statSync(join(wiki, name)).isDirectory()) {
      problems.push({ file: rel, message: "unexpected file: wiki/ holds README.md, INDEX.md, board/, plans/ and research/" });
      continue;
    }
    for (const item of readdirSync(join(wiki, name)).sort()) {
      const itemRel = rel + "/" + item;
      if (statSync(join(root, itemRel)).isDirectory()) {
        if (existsSync(join(root, itemRel, "README.md"))) read(name, item, itemRel + "/README.md", true);
        else problems.push({ file: itemRel, message: "bundle has no README.md" });
      } else if (item.endsWith(".md")) {
        read(name, item.slice(0, -3), itemRel, false);
      } else {
        problems.push({ file: itemRel, message: "unexpected file: a post is <id>.md or a bundle <id>/README.md" });
      }
    }
  }
  return { entries, problems };
}

function checkEntry(root: string, e: Entry, problems: Problem[]) {
  const p = (message: string) => problems.push({ file: e.path, message });
  for (const k of Object.keys(e.fm)) if (!SCALARS.has(k) && !LISTS.has(k)) p('unknown field "' + k + '"');
  for (const k of REQUIRED) if (!str(e, k)) p('missing required field "' + k + '"');
  for (const k of SCALARS) if (k in e.fm && typeof e.fm[k] !== "string") p('"' + k + '" takes one value, not a list');
  for (const k of LISTS) if (k in e.fm && !Array.isArray(e.fm[k])) p('"' + k + '" takes a list');
  const kind = str(e, "kind");
  const status = str(e, "status");
  const date = str(e, "date");
  if (str(e, "id") && str(e, "id") !== e.id) p('id "' + str(e, "id") + '" must equal the ' + (e.bundle ? "bundle folder" : "file") + ' name "' + e.id + '"');
  if (!NAME.test(e.id)) p('name "' + e.id + '" must be YYYY-MM-DD-<author>-<slug>, lowercase letters, digits and hyphens');
  if (kind && !KINDS.includes(kind)) p('kind "' + kind + '" is not one of ' + KINDS.join(", "));
  else if (kind && !SECTIONS[e.section].includes(kind)) {
    const home = Object.keys(SECTIONS).find((s) => SECTIONS[s].includes(kind));
    p("a " + kind + " belongs in wiki/" + home + "/, not wiki/" + e.section + "/");
  }
  if (status && !STATUSES.includes(status)) p('status "' + status + '" is not one of ' + STATUSES.join(", "));
  if (status === "answered" && kind !== "question") p('only a question can have status "answered"');
  if (date && !(/^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date + "T00:00:00Z").toISOString().startsWith(date))) p('date "' + date + '" is not a real YYYY-MM-DD date');
  if (date && str(e, "author") && !e.id.startsWith(date + "-" + slug(str(e, "author")) + "-")) {
    p('name must start with "' + date + "-" + slug(str(e, "author")) + '-" (date, then author)');
  }
  if (str(e, "summary").length > SUMMARY_MAX) p("summary is longer than " + SUMMARY_MAX + " characters");
  if (!e.bundle) {
    if (list(e, "attachments").length) p("only a bundle (<id>/README.md) can have attachments");
    return;
  }
  const dir = e.path.slice(0, -"/README.md".length);
  const listed = new Set<string>();
  for (const a of list(e, "attachments")) {
    const m = a.match(/^([0-9a-f]{64}) {2}(\S.*)$/);
    if (!m) {
      p('attachment "' + a + '" must be "<sha256>  <path>", as sha256sum prints it');
      continue;
    }
    const [, sha, rel] = m;
    listed.add(rel);
    if (rel.startsWith("/") || rel.split("/").includes("..") || rel === "README.md") {
      p('attachment path "' + rel + '" must be a file inside the bundle other than README.md');
      continue;
    }
    if (!existsSync(join(root, dir, rel))) {
      p('attachment "' + rel + '" is listed but missing');
      continue;
    }
    if (createHash("sha256").update(readFileSync(join(root, dir, rel))).digest("hex") !== sha) {
      p('attachment "' + rel + '" does not match its sha256');
    }
  }
  for (const rel of filesUnder(join(root, dir))) {
    if (rel !== "README.md" && !listed.has(rel)) p('file "' + rel + '" in the bundle is not listed in attachments');
  }
}

function checkLinks(entries: Entry[], problems: Problem[]) {
  const byId = new Map<string, Entry>();
  for (const e of entries) {
    const first = byId.get(e.id);
    if (first) problems.push({ file: e.path, message: 'duplicate id "' + e.id + '" (also ' + first.path + ")" });
    else byId.set(e.id, e);
  }
  const named = { supersedes: new Set<string>(), answers: new Set<string>() };
  for (const e of entries) {
    for (const field of ["supersedes", "answers"] as const) {
      for (const target of list(e, field)) {
        named[field].add(target);
        const t = byId.get(target);
        if (target === e.id) problems.push({ file: e.path, message: field + " names the post itself" });
        else if (!t) problems.push({ file: e.path, message: field + ' names "' + target + '", which does not exist' });
        else if (field === "supersedes" && str(t, "status") !== "superseded") {
          problems.push({ file: t.path, message: 'status must be "superseded": ' + e.id + " supersedes it" });
        } else if (field === "answers" && str(t, "kind") !== "question") {
          problems.push({ file: e.path, message: 'answers names "' + target + '", which is a ' + str(t, "kind") + ", not a question" });
        } else if (field === "answers" && str(t, "status") !== "answered") {
          problems.push({ file: t.path, message: 'status must be "answered": ' + e.id + " answers it" });
        }
      }
    }
  }
  for (const e of entries) {
    if (str(e, "status") === "superseded" && !named.supersedes.has(e.id)) problems.push({ file: e.path, message: 'status is "superseded" but no post supersedes it' });
    if (str(e, "status") === "answered" && !named.answers.has(e.id)) problems.push({ file: e.path, message: 'status is "answered" but no post answers it' });
  }
}

export function sealedMarkers(root: string): string[] {
  const path = join(root, ".gstack", "pregate.json");
  if (!existsSync(path)) return [];
  const markers = JSON.parse(readFileSync(path, "utf8"))?.sealed?.answer_markers;
  return Array.isArray(markers) ? markers.filter((m: unknown) => typeof m === "string" && m !== "") : [];
}

function scanText(root: string, markers: string[], problems: Problem[]) {
  const patterns: RegExp[] = [];
  for (const m of markers) {
    try {
      patterns.push(new RegExp(m));
    } catch {
      problems.push({ file: ".gstack/pregate.json", message: "sealed.answer_markers holds a pattern that does not compile: " + JSON.stringify(m) });
    }
  }
  for (const rel of filesUnder(join(root, "wiki"), "wiki")) {
    const lines = readFileSync(join(root, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const [rule, re] of SECRET_RULES) if (re.test(line)) problems.push({ file: rel, line: i + 1, message: "possible secret (" + rule + "); remove it and rotate the key if it was real" });
      if (SEALED_MARKER.test(line) || patterns.some((re) => re.test(line))) problems.push({ file: rel, line: i + 1, message: "sealed marker: sealed material never goes in wiki/" });
    });
  }
}

const stripStatus = (text: string) => {
  const lines = text.split("\n");
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  return lines.filter((l, i) => !(i > 0 && i < close && l.startsWith("status:"))).join("\n");
};

const isEntryPath = (path: string) => {
  const parts = path.split("/");
  return (parts.length === 3 && parts[2].endsWith(".md")) || (parts.length === 4 && parts[3] === "README.md");
};

export function checkImmutable(root: string, baseFiles: Map<string, Buffer>, problems: Problem[]) {
  for (const [path, before] of baseFiles) {
    const abs = join(root, path);
    if (!existsSync(abs)) {
      problems.push({ file: path, message: "merged file was removed or renamed; merged posts are permanent (supersede instead)" });
      continue;
    }
    const now = readFileSync(abs);
    const changed = isEntryPath(path) ? stripStatus(before.toString("utf8")) !== stripStatus(now.toString("utf8")) : !before.equals(now);
    if (changed) problems.push({ file: path, message: "merged post was edited; only its status may change (write a new post that supersedes it)" });
  }
}

export function renderIndex(entries: Entry[]): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const by = { supersedes: new Map<string, string[]>(), answers: new Map<string, string[]>() };
  for (const e of entries) for (const f of ["supersedes", "answers"] as const) for (const t of list(e, f)) by[f].set(t, [...(by[f].get(t) ?? []), e.id]);
  const cell = (s: string) => s.replaceAll("|", "\\|");
  const href = (e: Entry) => e.path.slice("wiki/".length);
  const link = (e: Entry) => "[" + cell(str(e, "title")) + "](" + href(e) + ")";
  const status = (e: Entry) => {
    const s = str(e, "status");
    const ids = s === "superseded" ? by.supersedes.get(e.id) : s === "answered" ? by.answers.get(e.id) : undefined;
    if (!ids?.length) return s;
    return s + " by " + ids.map((id) => (byId.has(id) ? "[" + id + "](" + href(byId.get(id)!) + ")" : id)).join(", ");
  };
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const out = [
    "# Wiki index",
    "",
    "Generated from each post's front matter by \x60bun run wiki:index\x60. Do not edit it by hand: \x60bun run wiki:check\x60 fails when it is stale. The rules are in [README.md](README.md).",
    "",
    "## Open",
    "",
  ];
  const open = sorted.filter((e) => str(e, "status") === "open");
  if (!open.length) out.push("Nothing is open.");
  for (const e of open) out.push("- " + link(e) + " (" + str(e, "kind") + ", " + str(e, "author") + ", " + str(e, "date") + "): " + str(e, "summary"));
  for (const section of Object.keys(SECTIONS)) {
    out.push("", "## " + section[0].toUpperCase() + section.slice(1), "");
    const rows = sorted.filter((e) => e.section === section);
    if (!rows.length) {
      out.push("No posts yet.");
      continue;
    }
    out.push("| Date | Post | Kind | Status | Author | Summary |", "|---|---|---|---|---|---|");
    for (const e of rows) out.push("| " + [str(e, "date"), link(e), str(e, "kind"), status(e), cell(str(e, "author")), cell(str(e, "summary"))].join(" | ") + " |");
  }
  return out.join("\n") + "\n";
}

export function checkWiki(root: string, opts: { baseFiles?: Map<string, Buffer> | null; markers?: string[] } = {}) {
  const { entries, problems } = loadWiki(root);
  if (!existsSync(join(root, "wiki", "README.md"))) problems.push({ file: "wiki/README.md", message: "the rules file is missing" });
  for (const e of entries) checkEntry(root, e, problems);
  checkLinks(entries, problems);
  if (existsSync(join(root, "wiki"))) scanText(root, opts.markers ?? sealedMarkers(root), problems);
  const indexPath = join(root, "wiki", "INDEX.md");
  if (!existsSync(indexPath) || readFileSync(indexPath, "utf8") !== renderIndex(entries)) {
    problems.push({ file: "wiki/INDEX.md", message: "stale; run bun run wiki:index and commit the result" });
  }
  if (opts.baseFiles) checkImmutable(root, opts.baseFiles, problems);
  return { entries, problems };
}

function git(root: string, args: string[]) {
  const r = spawnSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? Buffer.alloc(0) };
}

export function resolveBase(root: string, requested?: string): { ref: string | null; note: string; error?: string } {
  if (requested === "none") return { ref: null, note: "immutability not checked (--base none)" };
  if (requested && /^0+$/.test(requested)) return { ref: null, note: "immutability not checked: the push created the branch, so there is no previous commit" };
  for (const candidate of requested ? [requested] : ["origin/HEAD", "origin/main", "origin/master"]) {
    const mb = git(root, ["merge-base", "HEAD", candidate]);
    if (mb.ok) return { ref: mb.out.toString().trim(), note: "immutability checked against " + candidate + " (merge base " + mb.out.toString().trim().slice(0, 12) + ")" };
  }
  if (requested) return { ref: null, note: "", error: "base " + requested + " has no merge base with HEAD in this clone; fetch full history or pass --base none" };
  return { ref: null, note: "immutability not checked: no origin/HEAD, origin/main or origin/master in this clone" };
}

export function gitBaseFiles(root: string, ref: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const path of git(root, ["ls-tree", "-r", "-z", "--name-only", ref, "--", "wiki/"]).out.toString().split("\0")) {
    if (!path || path === "wiki/README.md" || path === "wiki/INDEX.md") continue;
    files.set(path, git(root, ["cat-file", "blob", ref + ":" + path]).out);
  }
  return files;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const [command, ...args] = process.argv.slice(2);
  const report = (problems: Problem[]) => {
    for (const p of problems) console.error(p.file + (p.line ? ":" + p.line : "") + ": " + p.message);
  };
  if (command === "index") {
    const { entries, problems } = loadWiki(root);
    writeFileSync(join(root, "wiki", "INDEX.md"), renderIndex(entries));
    console.log("wrote wiki/INDEX.md (" + entries.length + " posts)");
    report(problems);
    process.exit(problems.length ? 1 : 0);
  } else if (command === "check") {
    const at = args.indexOf("--base");
    const base = resolveBase(root, (at >= 0 ? args[at + 1] : process.env.WIKI_BASE) || undefined);
    if (base.error) {
      console.error("wiki: " + base.error);
      process.exit(1);
    }
    const { entries, problems } = checkWiki(root, { baseFiles: base.ref ? gitBaseFiles(root, base.ref) : null });
    report(problems);
    console.log((problems.length ? "wiki: " + problems.length + " problem(s)" : "wiki: ok") + ", " + entries.length + " posts; " + base.note);
    process.exit(problems.length ? 1 : 0);
  } else {
    console.error("usage: bun scripts/wiki.ts index | check [--base <ref>|none]");
    process.exit(2);
  }
}
