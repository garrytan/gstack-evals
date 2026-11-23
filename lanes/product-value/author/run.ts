// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals pv author (prereg sections 3 and 4): author public units under custody, one record at a time, on an
// authoring line item. Every step is a separate call that sees only what its role may see:
//   collect (free)   the record's first version, the requests that led to it, the README at plan time, the release
//                    check and the titles of everything created in the 42-day window
//   screen           a fix, chore or refactor is not a plan; the selector picks the window records that touch the
//                    feature and the unit drops when it picks none (the picks reach only the key writer)
//   inputs           a name map, plan.md (the frozen PR-as-plan rewrite, or the first version with names replaced),
//                    context/project.md and brief.md, written from material dated before the plan only
//   input audit      blind to the key: names, dates, design in the brief, additions to the plan; one fix round
//   key              reads the picked records in full and every window title, writes U, E and R items,
//                    the mentioned flags and the 3 plan commitments
//   key audit        support, window, kind rules, mentioned flags, wording; one fix round
// A unit that fails an audit twice drops. Writers of inputs never see the window, the key or the key writer's notes.
// The work dir must sit on tmpfs; stdout carries counts, stages and verdicts only.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Io } from "../cli.ts";
import { openMeter, pool, sha256, type Meter, type ModelKey } from "../meter.ts";
import type { Key, KeyItem, UnitMeta } from "../types.ts";
import { graphql } from "./gh.ts";
import { FRAME, SEED, WINDOW_DAYS, order } from "./mine.ts";
import * as P from "./prompts.ts";

export const words = (s: string) => (s.match(/\S+/g) ?? []).length;
export const cut = (s: string, n: number) => {
  let k = 0, out = "";
  for (const t of s.split(/(\s+)/)) {
    if (/\S/.test(t) && ++k > n) return out.trimEnd() + " [cut]";
    out += t;
  }
  return out;
};
export const fence = (label: string, text: string) => "\n\n" + label + ":\n~~~~\n" + String(text).replace(/~~~~/g, "~~~") + "\n~~~~";
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();
export class AuthorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** The last fenced json block in a reply, parsed; null when none parses. */
export function lastJson(text: string | null): any {
  if (!text) return null;
  const blocks = [...text.matchAll(/\u0060{3}(?:json)?[^\n]*\n([\s\S]*?)\u0060{3}/g)].map((m) => m[1]!);
  for (const b of blocks.reverse()) {
    try {
      return JSON.parse(b);
    } catch {}
  }
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

/** Fenced blocks by label (T1's three files). */
/** Files from backtick or tilde fences labelled with a file name (plan.md, context/project.md). A file runs to the next file label, so code
 * fences inside it stay; its own closing fence is the last bare fence line before that label, and a last file left
 * unclosed keeps everything after its label. */
export function labelled(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = (text ?? "").split("\n");
  const starts = lines.flatMap((l, i) => {
    const m = /^(\u0060{3,}|~{3,})([A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)+)\s*$/.exec(l);
    return m ? [{ i, name: m[2]!, mark: m[1]![0]! }] : [];
  });
  starts.forEach((s, k) => {
    const body = lines.slice(s.i + 1, k + 1 < starts.length ? starts[k + 1]!.i : lines.length);
    const close = body.map((l) => l.length >= 3 && l.trimEnd() === s.mark.repeat(l.trimEnd().length)).lastIndexOf(true);
    out[s.name] = body.slice(0, close >= 0 ? close : body.length).join("\n").trim() + "\n";
  });
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");

/** Applies a name map, longest names first, case-insensitive, on word boundaries where a name starts or ends with a word character; links to code hosts become [link]. */
export function applyNames(text: string, names: Array<{ original: string; replacement: string }>): string {
  let s = text;
  for (const n of [...names].filter((n) => n.original && n.original.length >= 2).sort((a, b) => b.original.length - a.original.length)) {
    const pre = /^\w/.test(n.original) ? "(?<!\\w)" : "";
    const post = /\w$/.test(n.original) ? "(?!\\w)" : "";
    s = s.replace(new RegExp(pre + escapeRe(n.original) + post, "gi"), n.replacement);
  }
  return s.replace(/https?:\/\/(github\.com|gitlab\.com)\/[^\s)\]]+/g, "[link]");
}

interface Ctx {
  author: Meter;
  brief: Meter;
  log: (uid: string, stage: string, data: Record<string, unknown>) => void;
}

export async function ask(ctx: { log: Ctx["log"] }, m: Meter, uid: string, label: string, model: ModelKey, prompt: string, maxTokens: number, effort: string | null, json: boolean): Promise<any> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await m.call({ model, prompt: attempt === 1 ? prompt : prompt + "\n\nYour previous reply could not be read. Follow the output format exactly.", maxTokens, effort, label: uid + ":" + label });
    ctx.log(uid, label, { model, status: r.status, micros: r.micros, cached: r.cached, problem: r.problem });
    if (r.status !== 200 || r.text === null) {
      if (attempt === 2) throw new AuthorError("E_PV_INFRA_MISSING", uid + " " + label + ": " + (r.problem ?? "no reply"));
      continue;
    }
    if (!json) return r.text.trim();
    const parsed = lastJson(r.text);
    if (parsed !== null) return parsed;
  }
  throw new AuthorError("E_PV_INFRA_MISSING", uid + " " + label + ": the reply did not parse twice");
}

const EDITS = "userContentEdits(first:100){ totalCount nodes { editedAt diff } }";
const RL = " rateLimit{cost remaining resetAt} }";
const CMP_Q = "query($o:String!,$n:String!,$tag:String!,$sha:String!){ repository(owner:$o,name:$n){ ref(qualifiedName:$tag){ compare(headRef:$sha){ status } } }" + RL;
const BEFORE_Q = "query($o:String!,$n:String!,$until:GitTimestamp!){ repository(owner:$o,name:$n){ defaultBranchRef{ target{ ... on Commit { history(first:1,until:$until){ nodes{ oid } } } } } }" + RL;
const TREE_Q = "query($o:String!,$n:String!,$expr:String!){ repository(owner:$o,name:$n){ object(expression:$expr){ ... on Tree { entries{ name type } } } }" + RL;
const REL_Q = "query($o:String!,$n:String!){ repository(owner:$o,name:$n){ releases(first:30,orderBy:{field:CREATED_AT,direction:DESC}){ nodes{ tagName publishedAt isDraft isPrerelease } } }" + RL;
const BLOB_Q = "query($o:String!,$n:String!,$expr:String!){ repository(owner:$o,name:$n){ object(expression:$expr){ ... on Blob { text } } }" + RL;
const PR_Q = "query($o:String!,$n:String!,$num:Int!){ repository(owner:$o,name:$n){ description repositoryTopics(first:20){nodes{topic{name}}} issueOrPullRequest(number:$num){ __typename" +
  " ... on PullRequest { title body createdAt mergedAt author{login} authorAssociation mergeCommit{oid} " + EDITS + " closingIssuesReferences(first:5){ nodes { number title body createdAt author{login} authorAssociation " + EDITS + " } } }" +
  " ... on Issue { title body createdAt author{login} authorAssociation " + EDITS + " } } } rateLimit{cost remaining resetAt} }";

/** The earliest recoverable version of a body: the body itself when never edited, else the oldest edit's text; null when the history is incomplete. */
export const firstVersion = (body: string, edits: any): { text: string; at: string | null } | null => {
  if (!edits || edits.totalCount === 0) return { text: body ?? "", at: null };
  const nodes = (edits.nodes ?? []).filter((n: any) => typeof n.diff === "string");
  if (!nodes.length || edits.totalCount > nodes.length) return null;
  const oldest = [...nodes].sort((a: any, b: any) => (a.editedAt < b.editedAt ? -1 : 1))[0];
  return { text: oldest.diff, at: oldest.editedAt };
};

const WIN_Q = "query($q:String!,$after:String){ search(query:$q,type:ISSUE,first:100,after:$after){ issueCount pageInfo{hasNextPage endCursor} nodes{ __typename" +
  " ... on Issue { number title createdAt authorAssociation author{login} labels(first:5){nodes{name}} comments{totalCount} }" +
  " ... on PullRequest { number title createdAt authorAssociation author{login} labels(first:5){nodes{name}} comments{totalCount} merged mergedAt } } } rateLimit{cost remaining resetAt} }";
const DISC_Q = "query($o:String!,$n:String!,$after:String){ repository(owner:$o,name:$n){ discussions(first:100,after:$after,orderBy:{field:CREATED_AT,direction:DESC}){ pageInfo{hasNextPage endCursor} nodes{ number title createdAt authorAssociation author{login} category{name} comments{totalCount} } } } rateLimit{cost remaining resetAt} }";

function windowTitles(repo: string, from: string, to: string): any[] {
  const [o, n] = repo.split("/");
  const out: any[] = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += 7 * 86_400_000) {
    const a = new Date(t).toISOString().slice(0, 19) + "Z";
    const b = new Date(Math.min(t + 7 * 86_400_000, Date.parse(to))).toISOString().slice(0, 19) + "Z";
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const d: any = graphql(WIN_Q, { q: "repo:" + repo + " created:" + a + ".." + b, after });
      for (const x of d.search.nodes) if (x?.number) out.push({ number: x.number, kind: x.__typename === "PullRequest" ? (x.merged ? "merged PR" : "PR") : "issue", date: x.createdAt.slice(0, 10), assoc: x.authorAssociation, labels: (x.labels?.nodes ?? []).map((l: any) => l.name), comments: x.comments?.totalCount ?? 0, title: x.title, merged_at: x.mergedAt ?? null });
      if (!d.search.pageInfo.hasNextPage) break;
      after = d.search.pageInfo.endCursor;
    }
  }
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const d: any = graphql(DISC_Q, { o, n, after });
    const nodes = d.repository?.discussions?.nodes ?? [];
    for (const x of nodes) if (x.createdAt >= from && x.createdAt < to) out.push({ number: x.number, kind: "discussion", date: x.createdAt.slice(0, 10), assoc: x.authorAssociation, labels: [x.category?.name].filter(Boolean), comments: x.comments?.totalCount ?? 0, title: x.title });
    if (!nodes.length || nodes.at(-1).createdAt < from || !d.repository.discussions.pageInfo.hasNextPage) break;
    after = d.repository.discussions.pageInfo.endCursor;
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.kind + x.number) ? false : (seen.add(x.kind + x.number), true))).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number));
}

const COMMENTS = "comments(first:30){nodes{ body createdAt authorAssociation author{login} }}";
function fetchRecords(repo: string, picks: Array<{ number: number; kind: string }>): any[] {
  const [o, n] = repo.split("/");
  const out: any[] = [];
  for (let i = 0; i < picks.length; i += 8) {
    const batch = picks.slice(i, i + 8);
    const parts = batch.map((p, j) =>
      p.kind === "discussion"
        ? "d" + j + ": discussion(number:" + p.number + "){ title body createdAt authorAssociation author{login} " + COMMENTS + " }"
        : "r" + j + ": issueOrPullRequest(number:" + p.number + "){ __typename ... on Issue { title body createdAt authorAssociation author{login} labels(first:8){nodes{name}} " + COMMENTS + " } ... on PullRequest { title body createdAt merged mergedAt authorAssociation author{login} labels(first:8){nodes{name}} " + COMMENTS + " closingIssuesReferences(first:5){nodes{number}} } }",
    );
    const d: any = graphql("query($o:String!,$n:String!){ repository(owner:$o,name:$n){ " + parts.join(" ") + " } rateLimit{cost remaining resetAt} }", { o, n });
    batch.forEach((p, j) => {
      const x = d.repository?.[(p.kind === "discussion" ? "d" : "r") + j];
      if (!x) return;
      out.push({ number: p.number, kind: p.kind, title: x.title, date: x.createdAt, author: x.author?.login ?? null, assoc: x.authorAssociation, labels: (x.labels?.nodes ?? []).map((l: any) => l.name), merged_at: x.mergedAt ?? null, closes: (x.closingIssuesReferences?.nodes ?? []).map((c: any) => c.number), body: cut(x.body ?? "", 1500), comments: (x.comments?.nodes ?? []).map((c: any) => ({ author: c.author?.login ?? null, assoc: c.authorAssociation, date: c.createdAt, body: cut(c.body ?? "", 300) })) });
    });
  }
  return out;
}

export const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
export const put = (p: string, data: unknown) => {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
};

/** Free collection: returns a drop reason or null. */
function collect(dir: string, rec: any): string | null {
  const [o, n] = rec.repo.split("/");
  const d: any = graphql(PR_Q, { o, n, num: rec.number });
  const x = d.repository?.issueOrPullRequest;
  if (!x) return "record not readable";
  const fv = firstVersion(x.body ?? "", x.userContentEdits);
  if (!fv) return "first version not recoverable";
  if (words(fv.text) < 300) return "first version under 300 words";
  const requests = (x.closingIssuesReferences?.nodes ?? [])
    .filter((r: any) => r.createdAt < x.createdAt)
    .map((r: any) => ({ number: r.number, title: r.title, created_at: r.createdAt, assoc: r.authorAssociation, author: r.author?.login ?? null, body: cut(firstVersion(r.body ?? "", r.userContentEdits)?.text ?? "", 1500) }));
  let mergeSha: string | null = x.mergeCommit?.oid ?? null;
  if (rec.kind !== "pr-as-plan" && rec.closing_pr) {
    const pr: any = graphql(PR_Q, { o, n, num: rec.closing_pr });
    mergeSha = pr.repository?.issueOrPullRequest?.mergeCommit?.oid ?? null;
  }
  if (mergeSha) {
    const contains = (tag: string) => ["BEHIND", "IDENTICAL"].includes(graphql<any>(CMP_Q, { o, n, tag: "refs/tags/" + tag, sha: mergeSha }).repository?.ref?.compare?.status ?? "");
    if (!contains(rec.release_tag)) {
      const later = (graphql<any>(REL_Q, { o, n }).repository?.releases?.nodes ?? [])
        .filter((x: any) => !x.isDraft && x.publishedAt && x.publishedAt > rec.release_at && x.publishedAt <= FRAME.shippedBy + "T23:59:59Z")
        .sort((a: any, b: any) => (a.publishedAt < b.publishedAt ? -1 : 1))
        .slice(0, 4);
      const rel = later.find((x: any) => contains(x.tagName));
      if (!rel) return "no release by " + FRAME.shippedBy + " contains the merge commit";
      if (rel.publishedAt > FRAME.closedBy + "T23:59:59Z") return "the first release containing the merge commit has a window still open (wave B)";
      rec = { ...rec, release_tag: rel.tagName, release_at: rel.publishedAt, release_prerelease: rel.isPrerelease };
    }
  }
  const before: string | null = graphql<any>(BEFORE_Q, { o, n, until: x.createdAt }).repository?.defaultBranchRef?.target?.history?.nodes?.[0]?.oid ?? null;
  const entry = before ? (graphql<any>(TREE_Q, { o, n, expr: before + ":" }).repository?.object?.entries ?? []).find((e: any) => e.type === "blob" && /^readme(\.(md|markdown|rst|txt|adoc))?$/i.test(e.name)) : null;
  const readmeText: string = entry ? graphql<any>(BLOB_Q, { o, n, expr: before + ":" + entry.name }).repository?.object?.text ?? "" : "";
  const commits = before ? [{ sha: before }] : [];
  const titles = windowTitles(rec.repo, rec.release_at, addDays(rec.release_at, WINDOW_DAYS));
  if (!titles.length) return "empty window";
  put(join(dir, "raw/record.json"), { repo: rec.repo, number: rec.number, kind: rec.kind, title: x.title, first_body: fv.text, first_at: fv.at, created_at: x.createdAt, merged_at: x.mergedAt ?? rec.merged_at, author: x.author?.login ?? null, assoc: x.authorAssociation, requests, release_tag: rec.release_tag, release_at: rec.release_at, description: d.repository.description ?? "", topics: (d.repository.repositoryTopics?.nodes ?? []).map((t: any) => t.topic.name), readme_commit: commits[0]?.sha ?? null });
  put(join(dir, "raw/readme.md"), cut(readmeText, 6000));
  put(join(dir, "raw/window.json"), titles);
  return null;
}

const sources = (r: any, readme: string) =>
  fence("Repository path", r.repo) + fence("Description", r.description) + fence("README at plan time", readme) + fence("Plan or pull request title", r.title) + fence("Plan or pull request description, first version", r.first_body) + r.requests.map((q: any) => fence("Request that led to it (#" + q.number + ", " + q.created_at.slice(0, 10) + ")", q.title + "\n\n" + q.body)).join("");

async function inputs(ctx: Ctx, uid: string, dir: string): Promise<void> {
  const r = readJson(join(dir, "raw/record.json"));
  const readme = readFileSync(join(dir, "raw/readme.md"), "utf8");
  const authors = [r.author, ...r.requests.map((q: any) => q.author)].filter(Boolean);
  const nm = await ask(ctx, ctx.author, uid, "namemap", "opus", P.NAMEMAP + sources(r, readme) + fence("Author handles", authors.join(", ")), 8000, "medium", true);
  const names: Array<{ original: string; replacement: string }> = (nm?.names ?? []).filter((x: any) => typeof x?.original === "string" && typeof x?.replacement === "string");
  const [o, n] = r.repo.split("/");
  for (const extra of [r.repo, n, o, ...authors]) if (!names.some((x) => x.original.toLowerCase() === String(extra).toLowerCase())) names.push({ original: String(extra), replacement: extra === r.repo ? "the-project" : extra === n ? "the project" : "@person-" + names.length });
  put(join(dir, "namemap.json"), names);
  const nmText = fence("Name replacements", names.map((x) => x.original + " -> " + x.replacement).join("\n"));
  const anonBody = applyNames(r.first_body, names);
  const anonReq = r.requests.map((q: any) => applyNames(q.title + "\n\n" + q.body, names));
  const plan = applyNames(
    r.kind === "pr-as-plan"
      ? await ask(ctx, ctx.author, uid, "rewrite", "opus", P.REWRITE + fence("Description", anonBody) + (anonReq.length ? fence("Request that led to it", anonReq.join("\n\n---\n\n")) : ""), 8000, "medium", false)
      : await ask(ctx, ctx.author, uid, "sweep", "opus", P.SWEEP + nmText + fence("Text", anonBody), 8000, "low", false),
    names,
  );
  const ctxText = applyNames(await ask(ctx, ctx.author, uid, "context", "opus", P.CONTEXT.replaceAll("DATE", r.created_at.slice(0, 10)) + nmText + fence("Description", r.description) + fence("README at that time", readme) + fence("The area the plan touches (title only)", applyNames(r.title, names)), 6000, "medium", false), names);
  const briefText = applyNames(await ask(ctx, ctx.brief, uid, "brief", "opus", P.BRIEF + nmText + fence("Request that led to it", anonReq.join("\n\n---\n\n") || "(none recorded)") + fence("The plan (for reference only; take no part of its design)", plan) + fence("The project then", ctxText), 4000, "medium", false), names);
  put(join(dir, "unit/plan.md"), plan.trim() + "\n");
  put(join(dir, "unit/context/project.md"), ctxText.trim() + "\n");
  put(join(dir, "unit/brief.md"), briefText.trim() + "\n");
}

export const INPUT_FILES = ["plan.md", "brief.md", "context/project.md"];

async function inputAudit(ctx: Ctx, uid: string, dir: string): Promise<string | null> {
  const r = readJson(join(dir, "raw/record.json"));
  const readme = readFileSync(join(dir, "raw/readme.md"), "utf8");
  const names = readJson(join(dir, "namemap.json"));
  for (let round = 1; round <= 2; round++) {
    const body = INPUT_FILES.map((f) => fence("Input file " + f, readFileSync(join(dir, "unit", f), "utf8"))).join("");
    const a = await ask(ctx, ctx.author, uid, "audit-in-" + round, "opus", P.INPUT_AUDIT.replaceAll("DATE", r.created_at.slice(0, 10)).replace("PLANRULE", r.kind === "pr-as-plan" ? P.PLANRULE_PR : P.PLANRULE_PLAN) + sources(r, readme) + body, 8000, "high", true);
    put(join(dir, "audit-in-" + round + ".json"), a);
    const problems = Array.isArray(a?.problems) ? a.problems : [];
    if (a?.verdict === "pass" && !problems.length) return null;
    if (round === 2) return "input audit failed twice (" + problems.length + " problems)";
    for (const f of INPUT_FILES) {
      const probs = problems.filter((p: any) => p.file === f);
      if (!probs.length) continue;
      const fixed = await ask(ctx, f === "brief.md" ? ctx.brief : ctx.author, uid, "fix-" + f.replace(/\W/g, ""), "opus", P.FIX + fence("Problems", probs.map((p: any) => "- " + p.quote + ": " + p.fix).join("\n")) + fence("File " + f, readFileSync(join(dir, "unit", f), "utf8")), 8000, "medium", false);
      put(join(dir, "unit", f), applyNames(fixed, names).trim() + "\n");
    }
  }
  return "unreachable";
}

const titleLine = (t: any) => "#" + t.number + " | " + t.kind + " | " + t.date + " | " + t.assoc + " | " + (t.labels.join(",") || "-") + " | " + t.comments + " comments | " + t.title;
const recordText = (x: any) => "#" + x.number + " (" + x.kind + ", " + String(x.date).slice(0, 10) + ", " + x.assoc + (x.merged_at ? ", merged " + x.merged_at.slice(0, 10) : "") + (x.closes?.length ? ", closes #" + x.closes.join(" #") : "") + ") " + x.title + "\n" + x.body + x.comments.map((c: any) => "\n  > [" + c.assoc + " @" + c.author + ", " + String(c.date).slice(0, 10) + "] " + c.body.replace(/\n/g, "\n    ")).join("");

/** Before any input is written: the record must be a plan (section 4 excludes fixes and chores), and the window must hold at least one record the selector says touches the feature. The selector's picks reach only the key writer. */
async function screen(ctx: Ctx, uid: string, dir: string): Promise<string | null> {
  const r = readJson(join(dir, "raw/record.json"));
  const s = await ask(ctx, ctx.author, uid, "screen", "opus", P.SCREEN + fence("Record", r.title + "\n\n" + cut(r.first_body, 2500)), 1500, "low", true);
  put(join(dir, "screen.json"), s);
  if (s?.plan === false) return "not a plan for a user-facing change";
  const titles = readJson(join(dir, "raw/window.json"));
  const planFirst = fence("The plan as first written", r.title + "\n\n" + r.first_body);
  const sel = await ask(ctx, ctx.author, uid, "select", "opus", P.SELECT.replace("RELEASE", r.release_at.slice(0, 10)) + planFirst + fence("Records created in the 42 days after the release", titles.map(titleLine).join("\n")), 4000, "medium", true);
  const want = new Set((sel?.pick ?? []).map(Number));
  const picks = titles.filter((t: any) => want.has(t.number)).slice(0, 60);
  if (!picks.length) return "no record in the window touches the feature";
  put(join(dir, "raw/picked.json"), fetchRecords(r.repo, picks.map((t: any) => ({ number: t.number, kind: t.kind === "discussion" ? "discussion" : "issue" }))));
  return null;
}

async function keyStep(ctx: Ctx, uid: string, dir: string): Promise<string | null> {
  const r = readJson(join(dir, "raw/record.json"));
  const titles = readJson(join(dir, "raw/window.json"));
  const names = readJson(join(dir, "namemap.json"));
  const planFirst = fence("The plan as first written", r.title + "\n\n" + r.first_body);
  const picked = readJson(join(dir, "raw/picked.json"));
  const inputsText = INPUT_FILES.map((f) => fence("Input file " + f, readFileSync(join(dir, "unit", f), "utf8"))).join("");
  const material = planFirst + fence("Release", r.release_tag + " on " + r.release_at.slice(0, 10)) + fence("Titles of everything created in the 42 days", titles.map(titleLine).join("\n")) + fence("Records that touch the feature, in full", picked.map(recordText).join("\n\n")) + inputsText + fence("Name replacements (use the replacement names)", names.map((x: any) => x.original + " -> " + x.replacement).join("\n"));
  let key = await ask(ctx, ctx.author, uid, "key-1", "opus", P.KEY.replace("RELEASE", r.release_at.slice(0, 10)) + material, 16000, "high", true);
  for (let round = 1; round <= 2; round++) {
    put(join(dir, "key-draft-" + round + ".json"), key);
    const a = await ask(ctx, ctx.author, uid, "audit-key-" + round, "opus", P.KEY_AUDIT.replace("RELEASE", r.release_at.slice(0, 10)) + material + fence("The key", JSON.stringify(key, null, 2)), 12000, "high", true);
    put(join(dir, "audit-key-" + round + ".json"), a);
    const verdicts: any[] = Array.isArray(a?.items) ? a.items : [];
    const fixNeeded = verdicts.length !== (key?.items ?? []).length || verdicts.some((v) => v?.verdict !== "keep" && v?.verdict !== "drop") || (a?.missing ?? []).length > 0;
    if (a?.verdict === "pass" || !fixNeeded) {
      const dropped = new Set(verdicts.filter((v) => v?.verdict === "drop").map((v) => Number(v.index)));
      key = { ...key, items: (key?.items ?? []).filter((_: unknown, i: number) => !dropped.has(i)) };
      put(join(dir, "key-final.json"), key);
      break;
    }
    if (round === 2) return "key audit failed twice";
    key = await ask(ctx, ctx.author, uid, "key-2", "opus", P.KEY.replace("RELEASE", r.release_at.slice(0, 10)) + material + fence("Your earlier key", JSON.stringify(key, null, 2)) + fence("Auditor's notes", JSON.stringify(a, null, 2)) + "\n\n" + P.KEY_FIX, 16000, "high", true);
  }
  const items: KeyItem[] = (key?.items ?? [])
    .filter((it: any) => ["U", "E", "R"].includes(it?.kind) && typeof it.statement === "string")
    .map((it: any, i: number) => ({ id: "k" + (i + 1), kind: it.kind, statement: applyNames(it.statement, names), evidence: (it.evidence ?? []).map(String), outside_users: Number(it.outside_users) || 0, mentioned: it.mentioned === true, generic: false, foreseeable: ["yes", "maybe", "no"].includes(it.foreseeable) ? it.foreseeable : "maybe" }));
  const out: Key = { unit: uid, items, primary: rankPrimary(uid, items), commitments: (key?.commitments ?? []).slice(0, 3).map((c: any) => applyNames(String(c), names)) };
  put(join(dir, "unit/key.json"), out);
  return out.primary.length ? null : "no primary item";
}

/** Section 3: U by distinct outside users, E by outside users on linked issues, then a seeded tie-break; at most 6; mentioned and generic items never enter. */
export function rankPrimary(uid: string, items: KeyItem[]): string[] {
  const tie = (id: string) => sha256(SEED + "\n" + uid + "\n" + id);
  return items
    .filter((i) => (i.kind === "U" || i.kind === "E") && !i.mentioned && !i.generic)
    .sort((a, b) => b.outside_users - a.outside_users || (tie(a.id) < tie(b.id) ? -1 : 1))
    .slice(0, 6)
    .map((i) => i.id);
}

export function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The commit a paid run is pinned to; refuses a dirty tracked tree. */
export function pinnedHead(): string {
  const cwd = join(import.meta.dir, "../../..");
  if (spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", cwd }).stdout.trim()) throw new AuthorError("E_USAGE", "paid authoring runs only from a clean checkout of a pushed commit; commit first");
  return spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd }).stdout.trim();
}

export async function run(argv: string[], io: Io): Promise<number> {
  const records = flag(argv, "--records"), work = flag(argv, "--work"), item = flag(argv, "--item"), set = (flag(argv, "--set") ?? "pilot") as UnitMeta["set"];
  const ids = (flag(argv, "--ids") ?? "").split(",").filter(Boolean);
  const conc = Number(flag(argv, "--concurrency") ?? "3");
  if (!records || !work || !item || !ids.length) throw new AuthorError("E_USAGE", "pv author --records <records.jsonl> --work <tmpfs dir> --item <authoring item> --ids <record ids> [--set pilot|calibration|comparison|reserve] [--concurrency n]");
  const head = pinnedHead();
  const all = readFileSync(records, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const recs = ids.map((id) => {
    const r = all.find((x) => x.id === id);
    if (!r) throw new AuthorError("E_USAGE", "no record " + id + " in " + records);
    return r;
  });
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const logFile = join(work, "author-log.jsonl");
  const log = (uid: string, stage: string, data: Record<string, unknown>) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), head, item, uid, stage, ...data }) + "\n");
  const journals = join(process.env.HOME!, ".capy/work/pv/journals");
  const warn = (c: string, m: string) => log("-", "warn", { code: c, message: m.slice(0, 200) });
  const author = await openMeter({ item, runId: item, out: join(journals, item), cacheDir: join(work, "cache"), maxOutputTokens: 32000, warn });
  const brief = await openMeter({ item: "pv-auth-brief", runId: "pv-auth-brief", out: join(journals, "pv-auth-brief"), cacheDir: join(work, "cache"), maxOutputTokens: 32000, warn });
  const ctx: Ctx = { author, brief, log };
  const results: Array<{ uid: string; status: string; reason?: string }> = [];
  try {
    await pool(conc, recs.map((rec) => async () => {
      const uid = "pv-" + order(rec.id).slice(0, 10);
      const dir = join(work, "units", uid);
      const stateFile = join(dir, "state.json");
      const state = existsSync(stateFile) ? readJson(stateFile) : { uid, record: rec.id, stage: "collect", status: "open" };
      const save = () => put(stateFile, state);
      const done = (status: string, reason?: string) => {
        if (reason) {
          state.status = "dropped";
          state.reason = reason;
          save();
          log(uid, "drop", { reason });
        }
        results.push({ uid, status: reason ? "dropped" : status, ...(reason ? { reason } : {}) });
      };
      try {
        if (state.status !== "open") return done(state.status, state.status === "dropped" ? undefined : undefined);
        if (state.stage === "collect") {
          const why = collect(dir, rec);
          if (why) return done("dropped", why);
          state.stage = "screen";
          save();
        }
        if (state.stage === "screen") {
          const why = await screen(ctx, uid, dir);
          if (why) return done("dropped", why);
          state.stage = "inputs";
          save();
        }
        if (state.stage === "inputs") {
          await inputs(ctx, uid, dir);
          state.stage = "audit-in";
          save();
        }
        if (state.stage === "audit-in") {
          const why = await inputAudit(ctx, uid, dir);
          if (why) return done("dropped", why);
          state.stage = "key";
          save();
        }
        if (state.stage === "key") {
          const why = await keyStep(ctx, uid, dir);
          if (why) return done("dropped", why);
          const r = readJson(join(dir, "raw/record.json"));
          const meta: UnitMeta = { id: uid, set, source: "public", source_kind: rec.kind, type: rec.type_prov, plan_date: r.created_at, rank: 0 };
          put(join(dir, "unit/unit.json"), meta);
          state.stage = "done";
          state.status = "passed";
          save();
        }
        done(state.status);
      } catch (e) {
        log(uid, "error", { code: (e as AuthorError).code ?? "E_INTERNAL", message: String((e as Error).message).slice(0, 300) });
        results.push({ uid, status: "error", reason: (e as AuthorError).code ?? "E_INTERNAL" });
      }
    }));
  } finally {
    const a = await author.close();
    const b = await brief.close();
    log("-", "close", { author_micros: a.spent_micros, brief_micros: b.spent_micros });
    io.out("pv author: spent " + (a.spent_micros / 1e6).toFixed(4) + " USD on " + item + " and " + (b.spent_micros / 1e6).toFixed(4) + " USD on pv-auth-brief");
  }
  for (const r of results) io.out(r.uid + " " + r.status + (r.reason ? " (" + r.reason + ")" : ""));
  return 0;
}
