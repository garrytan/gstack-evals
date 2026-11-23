#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// Adapted from gstack lib/docs-only.ts and bin/gstack-docs-only at e077053. Changes: the allowlist adds wiki/board post
// bodies and drops changelog.d; the denylist adds prompt and brief files, docs/benchmarks/ and results posts; the reference
// scan matches a wiki post by its id and a docs page by its path below docs/ and its base name, skips root README.md, and
// lets root prose (CHANGELOG.md, TODOS.md, NOTICE.md, CONTRIBUTING.md, SECURITY.md) name a doc; review-depth's classifyPath
// and the docs lane of reader tests are left out; the script imports only node: modules and runs on its own.
//
// Docs-only pull requests: is every changed path human-facing documentation? When it is, ci.yml skips typecheck and the
// test suites; wiki:check, errors:check and sealed.yml still run. ci.yml runs the default branch's copy of this file on the
// pull request's merge commit (HEAD^1..HEAD), so a branch never changes the rule that judges it. Pushes to main, dispatched
// runs and pull requests into any other branch always run every check.
//   bun scripts/docs-only.ts --base <commit> --head <commit> [--github-output <file>]
// It prints DOCS_ONLY: yes and exits 0, DOCS_ONLY: no with each refused path and exits 1, or DOCS_ONLY: error with a fix and
// exits 2. --github-output appends docs_only=true|false to that file, and writes true only on a pull_request run.
//
// The rule is an allowlist with a denylist on top, never a "*.md" glob, because most Markdown here is read by an agent or
// pinned by an eval. A path is docs only when all of these hold:
//   - it is a plain file (mode 100644) that was added, modified, deleted, renamed or copied; a rename needs both sides to pass;
//   - it is on the allowlist: root README.md, docs/**/*.md, or a wiki/board post body (<id>.md or <id>/README.md);
//   - it matches no denylist entry: agent instructions, prompts and briefs, policy docs, preferences, templates, benchmark
//     material, preregistrations, results posts, and the generated pages .gstack/generated.json lists;
//   - no tracked file outside human docs names it: a wiki post by its id, a docs page by its path below docs/ or its base
//     name. Root prose that no code loads (CHANGELOG.md, TODOS.md, NOTICE.md, CONTRIBUTING.md, SECURITY.md) does not count;
//     AGENTS.md does.
// Root README.md has no name scan, because its bare name also stands for the READMEs of task fixtures and wiki bundles, so a
// scan would refuse every README edit; tests/ci/docs-only.test.ts lists the code that reads it or lists docs folders. An
// empty diff, or any git failure, is never docs-only.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export type Change = { status: string; path: string; from?: string; mode: string; oldMode: string };
export type Refusal = { path: string; reason: string };
export type Verdict = { docsOnly: boolean; files: string[]; refusals: Refusal[] };

const WIKI_POST = /^wiki\/board\/(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)(?:\.md|\/README\.md)$/;
const ALLOW = [/^README\.md$/, /^docs\/(?:[^/]+\/)*[^/]+\.md$/, WIKI_POST];
const DENY: [RegExp, string][] = [
  [/(?:^|\/)(?:skill|agents|claude|gemini|ethos|crew|captain|factory|driver|checklist|unattended|pregate|lane-card|notes|digest|soul)\.md$/i, "agent instructions"],
  [/(?:^|\/)(?:sections|templates|specialists|skills|prompts?|briefs?)\//i, "agent instructions"],
  [/(?:prompt|brief)[^/]*$/i, "prompt or brief"],
  [/-policy\.md$/i, "policy doc"],
  [/(?:^|\/)preferences[^/]*$/i, "preferences"],
  [/\.tmpl$/i, "template"],
  [/^docs\/benchmarks\//, "benchmark material (tasks, arms and pinned results)"],
  [/prereg/i, "preregistration"],
  [/^wiki\/board\/[^/]*results/i, "results post (pinned results)"],
];
const PROSE = new Set(["CHANGELOG.md", "TODOS.md", "NOTICE.md", "CONTRIBUTING.md", "SECURITY.md"]);
const CHANGE_KINDS = new Set(["A", "M", "D", "R", "C"]);
const RERUN = "rerun in a git checkout of this repository";

export class DocsOnlyError extends Error {
  constructor(message: string, readonly fix: string) {
    super(message);
  }
}

function git(root: string, args: string[], ok = [0]): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status === null || !ok.includes(r.status)) {
    const detail = (r.error?.message ?? r.stderr ?? "").trim().split("\n")[0] || "exit " + r.status;
    const missing = /bad revision|unknown revision|needed a single revision|no merge base|ambiguous argument|bad object|invalid object/i.test(detail);
    throw new DocsOnlyError("git " + args.join(" ") + ": " + detail, missing ? "fetch both commits (actions/checkout fetch-depth: 0, or git fetch origin <base>)" : RERUN);
  }
  return r.stdout;
}

/** Parse `git diff --raw -z`: a ":<old mode> <new mode> <old blob> <new blob> <status>" record, then one path, or two for a rename or copy. */
export function parseRaw(raw: string): Change[] {
  const parts = raw.split("\0");
  const out: Change[] = [];
  for (let i = 0; i < parts.length && parts[i]!.startsWith(":"); ) {
    const [oldMode = "", mode = "", , , status = ""] = parts[i++]!.slice(1).split(" ");
    const kind = status.slice(0, 1);
    if (kind === "R" || kind === "C") out.push({ status: kind, from: parts[i++]!, path: parts[i++]!, mode, oldMode });
    else out.push({ status: kind, path: parts[i++]!, mode, oldMode });
  }
  return out;
}

function glob(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?|\*|\?/g, (m) => (m === "?" ? "[^/]" : m === "*" ? "[^/]*" : ".*"));
  return new RegExp("^" + body + "$");
}

/** Why one path is not human docs by its name and place, or null when it qualifies. */
export function pathRefusal(path: string, generated: readonly string[] = []): string | null {
  if (!ALLOW.some((r) => r.test(path))) return "not on the docs allowlist (README.md, docs/**/*.md, wiki/board posts)";
  for (const [r, why] of DENY) if (r.test(path)) return why;
  if (generated.some((g) => glob(g).test(path))) return "generated page";
  return null;
}

/** The strings that name a doc in another file: a wiki post's id; a docs page's path below docs/ and its base name; nothing for root README.md. */
export function needles(path: string): string[] {
  const post = WIKI_POST.exec(path);
  if (post) return [post[1]!];
  if (!path.startsWith("docs/")) return [];
  return [...new Set([path.slice("docs/".length), path.slice(path.lastIndexOf("/") + 1)])];
}

/** Classify a parsed diff. refs(path) lists the tracked files outside human docs that name the path. */
export function classify(changes: readonly Change[], generated: readonly string[], refs: (path: string) => string[]): Verdict {
  const refusals: Refusal[] = [];
  const check = (p: string) => {
    const why = pathRefusal(p, generated);
    if (why) return why;
    const by = refs(p);
    return by.length ? "named by " + by.slice(0, 3).join(", ") + (by.length > 3 ? " and " + (by.length - 3) + " more" : "") : null;
  };
  for (const c of changes) {
    const plain = (c.status === "A" || c.oldMode === "100644") && (c.status === "D" || c.mode === "100644");
    const why = !CHANGE_KINDS.has(c.status) ? "change type " + c.status : !plain ? "mode " + c.oldMode + " to " + c.mode : ((c.from === undefined ? null : check(c.from)) ?? check(c.path));
    if (why) refusals.push({ path: c.path, reason: why });
  }
  if (!changes.length) refusals.push({ path: "-", reason: "no changed paths" });
  return { docsOnly: refusals.length === 0, files: changes.map((c) => c.path), refusals };
}

/** The generated pages .gstack/generated.json lists at a commit; none when the file is absent. A file that does not parse throws. */
export function generatedPages(root: string, commit: string): string[] {
  if (!git(root, ["ls-tree", "--name-only", commit, "--", ".gstack/generated.json"]).trim()) return [];
  const text = git(root, ["cat-file", "blob", commit + ":.gstack/generated.json"]);
  let j: { entries?: { outputs?: unknown }[] };
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new DocsOnlyError(".gstack/generated.json at " + commit + " does not parse: " + (e as Error).message, "repair .gstack/generated.json so it parses as JSON");
  }
  return (j.entries ?? []).flatMap((e) => (Array.isArray(e.outputs) ? e.outputs.filter((o): o is string => typeof o === "string") : []));
}

/** Tracked files at a commit, outside human docs, that name a doc. */
export function references(root: string, commit: string, path: string, generated: readonly string[]): string[] {
  const ns = needles(path);
  if (!ns.length) return [];
  const out = git(root, ["grep", "-l", "-z", "-F", "--text", ...ns.flatMap((n) => ["-e", n]), commit, "--"], [0, 1]);
  return out
    .split("\0")
    .filter(Boolean)
    .map((f) => f.slice(commit.length + 1))
    .filter((f) => f !== path && !PROSE.has(f) && pathRefusal(f, generated) !== null);
}

/** The whole decision for base..head. Throws DocsOnlyError on any git failure. */
export function classifyDocsOnly(root: string, base: string, head: string): Verdict {
  const [b, h] = [base, head].map((r) => git(root, ["rev-parse", "--verify", "--end-of-options", r + "^{commit}"]).trim()) as [string, string];
  const generated = generatedPages(root, h);
  const changes = parseRaw(git(root, ["diff", "--raw", "-z", "-M", "--no-ext-diff", b, h, "--"]));
  return classify(changes, generated, (p) => references(root, h, p, generated));
}

const escape = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [base, head, out] = [flag("--base"), flag("--head"), flag("--github-output")];
  const answer = (docsOnly: boolean, line: string, code: number) => {
    if (out) appendFileSync(out, "docs_only=" + docsOnly + "\n");
    console.log(line);
    process.exitCode = code;
  };
  const error = (message: string, fix: string) => answer(false, "DOCS_ONLY: error (" + escape(message) + "; fix: " + fix + "; nothing changed, so every check runs)", 2);
  if (!base || !head) error("usage: bun scripts/docs-only.ts --base <commit> --head <commit> [--github-output <file>]", "pass both --base and --head");
  else if (out && process.env.GITHUB_EVENT_NAME !== "pull_request") answer(false, "DOCS_ONLY: no (event " + escape(process.env.GITHUB_EVENT_NAME || "unset") + ": only a pull_request run may skip checks)", 1);
  else {
    try {
      const v = classifyDocsOnly(process.cwd(), base, head);
      const n = v.files.length + (v.files.length === 1 ? " file" : " files");
      if (v.docsOnly) answer(true, "DOCS_ONLY: yes (" + n + ")", 0);
      else answer(false, ["DOCS_ONLY: no (" + n + ", " + v.refusals.length + " refused)", ...v.refusals.map((r) => "  " + JSON.stringify(r.path) + ": " + escape(r.reason))].join("\n"), 1);
    } catch (e) {
      error((e as Error).message, e instanceof DocsOnlyError ? e.fix : RERUN);
    }
  }
}
