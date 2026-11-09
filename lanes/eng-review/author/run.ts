// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals er author (prereg 2026-11-08-geva-405, sections 3, 4 and 17): author units under custody on a named
// ledger item, every model call through lanes/product-value/meter.ts at high reasoning effort, replies cached by request
// digest so a resumed run never pays twice. Each step sees only what its role may see:
//   collect (free)  the earliest plan text, the unit's diff, the window's changes, the aftermath candidates with their
//                   messages, pull requests, linked issues and diffs, and the repository's description and topics
//   repo (free)     repo/: a fresh git repository at the parent commit, one commit, no remote
//   plan            plan.md: Opus rewrites the earliest plan text with section 4's frozen prompt; it never sees the
//                   diff or anything dated after the merge
//   key             no key before the unit's window closes; Opus reads the whole window and writes B, T and C items,
//                   the mentioned flags and up to 4 own-test items; the touched files and functions and the diffstat
//                   come from the real diff, and each B item's files and functions from its blamed lines
//   audit           Opus 5.5 in a fresh session and GPT-6.1 Sol each run the input audit and the key audit; any problem
//                   gets one fix round, and a unit that fails an audit twice drops
//   foreseeable     each auditor rates every item yes, maybe or no
// Then the primary list (before the generic screen, which the score side runs), key.json and unit.json in the types.ts
// layout, and with --seal-to an age-encrypted copy to the recipient. The work dir must sit under /dev/shm/er (mode 0700);
// stdout and the log carry unit ids, stages, counts and verdicts only.
//   er author --candidates <mine.json> [--candidates ...] --frame <frame.jsonl> --clones <dir> --work <custody dir>
//             --item <ledger item> --ids <candidate ids> [--set pilot|calibration|comparison|reserve]
//             [--seal-to <dir> --recipient <file>] [--concurrency n] [--record <dir>] [--ledger <path>]
// Build-time choices where the prereg is silent (lanes/eng-review/README.md, authoring side):
// - A unit id is "er-" and the first 10 hex of sha256("20261108\n" + the candidate id).
// - repo/ is written from the base tree's raw blobs (git ls-tree and cat-file), so no filter, attribute or LFS driver
//   runs; submodules are left out. Its one commit is written by fast-import as "unit <unit@example.invalid>" at the
//   base commit's committer date.
// - An item statement over 30 words, an item dated outside its window or an item whose candidate is unknown counts as
//   an audit problem. Items either auditor drops are removed first, so a fix verdict, an unreviewed mark or a mechanical
//   problem on a dropped item doesn't count; on any other item they fail the round. A missing candidate fails it only
//   when both auditors name it, as an item stays only when both keep it.
// - Before each audit, an item's kind is set from its candidate's (B or R as B, T, C).
// - A candidate's diff is a merge commit's diff against its first parent, its pull request's net change.
// - Primary order: B (defect revert, then a fix linked to an issue opened by someone outside the maintainer team, then
//   other fixes), then C, then T, then sha256("20261108\n" + unit + "\n" + item id); mentioned and generic items never
//   enter; at most 6.
// - A unit with no primary item drops at authoring; the generic screen may drop more later.
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { listChanges } from "../../real-outcome/mine/changes.ts";
import { git, gitLines, gitRun } from "../../real-outcome/mine/git.ts";
import { graphql } from "../../product-value/author/gh.ts";
import { ask, cut, fence, pinnedHead } from "../../product-value/author/run.ts";
import { need, parseArgs, PvError, readRecords } from "../../product-value/io.ts";
import { openMeter, pool, sha256, type Meter } from "../../product-value/meter.ts";
import type { Io } from "../cli.ts";
import type { BSource, BugSite, Foreseeable, FunctionRef, Key, KeyItem, OwnItem, ProjectType, Set_, UnitMeta } from "../types.ts";
import type { FrameRepo } from "./frame.ts";
import { erClass, functionAt, hunkFunctions, MIN_PLAN_WORDS, order, planTexts, SEED, words, type Candidate, type MineResult, type PlanText } from "./mine.ts";
import * as P from "./prompts.ts";

export const CUSTODY_ROOT = "/dev/shm/er";
export const EFFORT = "high";
export const MAX_PRIMARY = 6, MAX_OWN = 4, MAX_STATEMENT_WORDS = 30;
export const unitId = (candidateId: string) => "er-" + order(candidateId).slice(0, 10);

/** A sealed path must sit under the custody root; it is created with mode 0700. */
export function custody(path: string, root = CUSTODY_ROOT): string {
  const abs = resolve(path);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const r = realpathSync(root);
  if (abs !== r && !abs.startsWith(r + sep) && abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) throw new PvError("E_USAGE", path + " is outside " + root + "; unit material is plaintext only under " + root + " (section 17)");
  mkdirSync(abs, { recursive: true, mode: 0o700 });
  chmodSync(abs, 0o700);
  return abs;
}

export const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
export const put = (p: string, data: unknown) => {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 1) + "\n", { mode: 0o600 });
};

const B_RANK: Record<BSource, number> = { revert: 0, "user-issue": 1, fix: 2 };
const rankOf = (i: KeyItem) => (i.kind === "B" ? B_RANK[i.b_source ?? "fix"] : i.kind === "C" ? 3 : 4);

/** Section 3's primary list: neither mentioned nor generic, B then C then T, seeded ties, at most 6. */
export function rankPrimary(uid: string, items: readonly KeyItem[]): string[] {
  const tie = (id: string) => sha256(SEED + "\n" + uid + "\n" + id);
  return items.filter((i) => !i.mentioned && !i.generic).sort((a, b) => rankOf(a) - rankOf(b) || (tie(a.id) < tie(b.id) ? -1 : 1)).slice(0, MAX_PRIMARY).map((i) => i.id);
}

const quotePath = (p: string) => (/^"|[\n\\"]/.test(p) ? JSON.stringify(p) : p);

/** repo/: the base tree from raw blobs, then one commit by fast-import and no remote. */
export function buildUnitRepo(clone: string, base: string, dest: string): void {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const entries = git(clone, ["ls-tree", "-r", "-z", "--full-tree", base]).split("\0").filter(Boolean).map((l) => {
    const [meta, path] = [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)];
    const [mode, type, sha] = meta.split(" ");
    return { mode: mode!, type: type!, sha: sha!, path };
  }).filter((e) => e.type === "blob");
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "cat-file", "--batch"], { cwd: clone, input: entries.map((e) => e.sha).join("\n") + "\n", maxBuffer: 2 * 1024 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  const buf = r.stdout as Buffer;
  let at = 0;
  for (const e of entries) {
    const nl = buf.indexOf(10, at);
    const size = Number(buf.subarray(at, nl).toString().split(" ")[2]);
    const data = buf.subarray(nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
    const file = join(dest, e.path);
    mkdirSync(dirname(file), { recursive: true });
    if (e.mode === "120000") symlinkSync(data.toString(), file);
    else writeFileSync(file, data, { mode: e.mode === "100755" ? 0o755 : 0o644 });
  }
  const date = git(clone, ["show", "-s", "--format=%ct", base]).trim();
  git(dirname(dest), ["init", "-q", "-b", "main", dest]);
  git(dest, ["add", "-A", "-f"]);
  const staged = git(dest, ["ls-files", "-s", "-z"]).split("\0").filter(Boolean).map((l) => {
    const [meta, path] = [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)];
    const [mode, sha] = meta.split(" ");
    return "M " + mode + " " + sha + " " + quotePath(path);
  });
  const msg = "The repository before the change\n";
  git(dest, ["fast-import", "--quiet"], "commit refs/heads/main\nauthor unit <unit@example.invalid> " + date + " +0000\ncommitter unit <unit@example.invalid> " + date + " +0000\ndata " + Buffer.byteLength(msg) + "\n" + msg + staged.join("\n") + "\ndone\n");
  git(dest, ["reset", "-q"]);
}

/** The real diff's touched non-test source files and functions, and its diffstat. */
export function touchedOf(clone: string, base: string, change: string): { touched: Key["touched"]; diffstat: Key["diffstat"] } {
  const diffstat = gitLines(clone, ["diff", "--numstat", "--no-renames", "--no-ext-diff", "--no-textconv", base, change]).flatMap((l) => {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(l);
    return m ? [{ file: m[3]!, added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]) }] : [];
  });
  const files = diffstat.map((d) => d.file).filter((f) => erClass(f) === "source");
  const functions: FunctionRef[] = [];
  for (const file of files) {
    const after = gitRun(clone, ["show", change + ":" + file]);
    const side = after.status === 0 ? "new" : "old";
    const lines = (side === "new" ? after.stdout : git(clone, ["show", base + ":" + file])).split("\n");
    const names = new Set<string>();
    for (const [n, header] of hunkFunctions(clone, base, change, file, side)) {
      const name = functionAt(lines, n) ?? header;
      if (name) names.add(name);
    }
    for (const name of names) functions.push({ file, name });
  }
  return { touched: { files, functions }, diffstat };
}

export interface CandidateText {
  id: string;
  kind: "B" | "R" | "T" | "C";
  change: string;
  pr: number | null;
  merged_at: string;
  subject: string;
  message: string;
  pr_text: string;
  issues: Array<{ number: number; title: string; user: boolean; body: string }>;
  diff: string;
  sites: BugSite[];
}

export interface Material {
  repo: string;
  candidate: string;
  merged_at: string;
  window_closes: string;
  plan_source: PlanText;
  unit_diff: string;
  window: string[];
  candidates: CandidateText[];
  about: { description: string; topics: string[] };
  base_files: string[];
}

type Query = (q: string, v?: Record<string, unknown>) => any;
const MAX_CANDIDATES = 40;

/** Free collection; returns the material or a drop reason. */
export function collect(clone: string, c: Candidate, query: Query): Material | string {
  if (c.pr === null) return "no pull request";
  const plan = planTexts(c.repo, [{ pr: c.pr, merged_at: c.merged_at }], query).get(c.pr) ?? null;
  if (!plan) return "plan text not recoverable";
  if (plan.words < MIN_PLAN_WORDS) return "plan text under 120 words";
  const after = c.aftermath.filter((x) => x.kind !== "R" || x.defect);
  const kept = [...after.filter((x) => x.kind === "B" || x.kind === "R"), ...after.filter((x) => x.kind === "C"), ...after.filter((x) => x.kind === "T")].slice(0, MAX_CANDIDATES);
  const [o, n] = c.repo.split("/");
  const prs = [...new Set(kept.map((x) => x.pr).filter((x): x is number => x !== null))];
  const info = new Map<number, any>();
  let about = { description: "", topics: [] as string[] };
  for (let i = 0; i < Math.max(prs.length, 1); i += 10) {
    const parts = prs.slice(i, i + 10).map((pr, j) => "p" + j + ": pullRequest(number:" + pr + "){ title body closingIssuesReferences(first:5){ nodes { number title body authorAssociation } } }");
    const d = query("query($o:String!,$n:String!){ repository(owner:$o,name:$n){ description repositoryTopics(first:20){ nodes { topic { name } } } " + parts.join(" ") + " } rateLimit{cost remaining resetAt} }", { o, n });
    about = { description: d?.repository?.description ?? "", topics: (d?.repository?.repositoryTopics?.nodes ?? []).map((t: any) => t.topic.name) };
    prs.slice(i, i + 10).forEach((pr, j) => info.set(pr, d?.repository?.["p" + j] ?? null));
  }
  const count: Record<string, number> = {};
  const candidates: CandidateText[] = kept.map((x) => {
    const p = x.pr === null ? null : info.get(x.pr);
    const issues = (p?.closingIssuesReferences?.nodes ?? []).map((q: any) => ({ number: q.number, title: q.title ?? "", user: !["OWNER", "MEMBER", "COLLABORATOR"].includes(q.authorAssociation), body: cut(q.body ?? "", 250) }));
    count[x.kind] = (count[x.kind] ?? 0) + 1;
    return {
      id: x.kind + count[x.kind], kind: x.kind, change: x.change, pr: x.pr, merged_at: x.merged_at, subject: x.subject, message: cut(git(clone, ["log", "-1", "--format=%B", x.change]).trim(), 300),
      pr_text: p ? p.title + "\n" + cut(p.body ?? "", 400) : "", issues, diff: cut(candidateDiff(clone, x.change), 2500),
      sites: x.kind === "B" ? x.sites ?? [] : x.kind === "R" ? x.files.map((file) => ({ file, function: null })) : [],
    };
  });
  const window = listChanges(clone, git(clone, ["rev-parse", "HEAD"]).trim(), c.merged_at, null)
    .filter((w) => Date.parse(w.merged_at) > Date.parse(c.merged_at) && Date.parse(w.merged_at) <= Date.parse(c.window_closes))
    .map((w) => w.merged_at.slice(0, 10) + " " + w.id.slice(0, 12) + " (" + w.files.length + " files) " + w.subject);
  return {
    repo: c.repo, candidate: c.id, merged_at: c.merged_at, window_closes: c.window_closes, plan_source: plan,
    unit_diff: cut(gitRun(clone, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", c.base, c.change]).stdout, 12000), window, candidates, about,
    base_files: gitLines(clone, ["ls-tree", "-r", "--name-only", c.base]).slice(0, 600),
  };
}

const sourceText = (s: PlanText) => fence("Pull request title", s.title) + fence("Pull request description, earliest version", s.description) + s.issues.map((q) => fence("Request that led to it (#" + q.number + ", opened " + q.created_at.slice(0, 10) + ")", q.title + "\n\n" + q.text)).join("");
const candText = (c: CandidateText) =>
  fence("Candidate " + c.id + " (" + c.kind + ", merged " + c.merged_at.slice(0, 10) + ", commit " + c.change.slice(0, 12) + (c.pr ? ", pull request #" + c.pr : "") + ")",
    (c.sites.length ? "Blamed on the change: " + c.sites.map((s) => s.file + (s.function ? " :: " + s.function : "")).join("; ") + "\n" : "") + "Message: " + c.message + "\n" + (c.pr_text ? "Pull request: " + c.pr_text + "\n" : "") + c.issues.map((q) => "Linked issue #" + q.number + " (opened by " + (q.user ? "a user" : "a maintainer") + "): " + q.title + "\n" + q.body + "\n").join("") + "Diff:\n" + c.diff);
const material = (m: Material, plan: string) =>
  fence("plan.md", plan) + fence("Merge date and window end", m.merged_at.slice(0, 10) + " to " + m.window_closes.slice(0, 10)) + fence("The change's own diff", m.unit_diff) + fence("Every change merged in the window", m.window.join("\n") || "(none)") + m.candidates.map(candText).join("");

interface Draft {
  items: Array<{ candidate: string; kind: string; statement: string; file: string; mentioned: boolean; mentioned_where?: string }>;
  own: string[];
}

const draftOf = (x: any): Draft => ({ items: Array.isArray(x?.items) ? x.items.filter((i: any) => i && typeof i.statement === "string") : [], own: Array.isArray(x?.own) ? x.own.filter((s: any) => typeof s === "string").slice(0, MAX_OWN) : [] });

/** A candidate's diff: a merge commit's against its first parent, its pull request's net change (plain git show prints a clean merge's combined diff, which is empty). */
export const candidateDiff = (clone: string, sha: string) => gitRun(clone, ["show", "--format=", "--diff-merges=first-parent", "--no-ext-diff", "--no-textconv", "--no-renames", sha]).stdout;

/** An item's kind follows its candidate's: a B or R candidate keys as B, a T candidate as T and a C candidate as C, since section 3 takes B candidates only from SZZ and reverts. */
export function withKinds(m: Material, d: Draft): Draft {
  const by = new Map(m.candidates.map((c) => [c.id, c.kind]));
  return { ...d, items: d.items.map((it) => (by.has(it.candidate) ? { ...it, kind: by.get(it.candidate) === "R" ? "B" : by.get(it.candidate)! } : it)) };
}

/** Mechanical problems an audit round counts: an unknown candidate, a kind its candidate can't carry, a statement over 30 words, a date outside the window. */
export function mechanical(m: Material, d: Draft): string[] {
  const by = new Map(m.candidates.map((c) => [c.id, c]));
  return d.items.flatMap((it, i) => {
    const c = by.get(it.candidate);
    const p: string[] = [];
    if (!c) return ["item " + i + ": unknown candidate"];
    if (!["B", "T", "C"].includes(it.kind) || (it.kind === "B") !== (c.kind === "B" || c.kind === "R")) p.push("item " + i + ": kind " + it.kind + " on a " + c.kind + " candidate");
    if (words(it.statement) > MAX_STATEMENT_WORDS) p.push("item " + i + ": statement over 30 words");
    if (!(Date.parse(c.merged_at) > Date.parse(m.merged_at) && Date.parse(c.merged_at) <= Date.parse(m.window_closes))) p.push("item " + i + ": outside the window");
    return p;
  });
}

export interface AuditVerdict {
  failed: boolean;
  drops: Set<number>;
  input: string[];
  key: string[];
}

/** Reads one round's four audit replies (input and key, from each auditor) beside the mechanical problems. */
export function readAudit(d: Draft, replies: Array<{ input: any; key: any }>, mech: string[]): AuditVerdict {
  const drops = new Set<number>();
  for (const r of replies) for (const x of Array.isArray(r.key?.items) ? r.key.items : []) if (x?.verdict === "drop") drops.add(Number(x.index));
  const input: string[] = [], key: string[] = mech.filter((p) => !drops.has(Number(/^item (\d+):/.exec(p)?.[1] ?? -1)));
  for (const r of replies) {
    const probs = Array.isArray(r.input?.problems) ? r.input.problems : [];
    if (r.input?.verdict !== "pass" || probs.length) input.push(...(probs.length ? probs.map((p: any) => String(p.quote ?? "") + ": " + String(p.fix ?? "")) : ["the input audit did not pass"]));
    const v: any[] = Array.isArray(r.key?.items) ? r.key.items : [];
    const seen = new Set(v.map((x) => Number(x?.index)));
    for (let i = 0; i < d.items.length; i++) if (!seen.has(i) && !drops.has(i)) key.push("item " + i + ": unreviewed");
    for (const x of v) if (x?.verdict !== "drop" && x?.verdict !== "keep" && !drops.has(Number(x?.index))) key.push("item " + x?.index + ": " + String(x?.note ?? "fix"));
  }
  const named = replies.map((r) => new Map<string, string>((Array.isArray(r.key?.missing) ? r.key.missing : []).map((x: unknown) => [String(x).split(":")[0]!.trim(), String(x)])));
  for (const [id] of named[0] ?? []) if (named.every((n) => n.has(id))) key.push("missing " + named.map((n) => n.get(id)).join(" | "));
  return { failed: input.length > 0 || key.length > 0, drops, input, key };
}

export interface Clock {
  now: () => number;
}

interface Ctx {
  meter: Meter;
  log: (uid: string, stage: string, data: Record<string, unknown>) => void;
}

const call = (ctx: Ctx, uid: string, label: string, model: "opus" | "sol", prompt: string, maxTokens: number, json: boolean) => ask(ctx, ctx.meter, uid, label, model, prompt, maxTokens, EFFORT, json);

async function audit(ctx: Ctx, uid: string, m: Material, plan: string, d: Draft, round: number, scratch: string): Promise<AuditVerdict> {
  const statements = fence("Answer key statements", d.items.map((it, i) => i + ". " + it.statement).join("\n") || "(none)");
  const keyText = fence("The key", JSON.stringify(d.items.map((it, i) => ({ index: i, ...it })), null, 1));
  const replies = [];
  for (const model of ["opus", "sol"] as const) {
    const input = await call(ctx, uid, "audit-in-" + round + "-" + model, model, P.INPUT_AUDIT + sourceText(m.plan_source) + fence("Merge date", m.merged_at.slice(0, 10)) + fence("plan.md", plan) + statements, 8000, true);
    const key = await call(ctx, uid, "audit-key-" + round + "-" + model, model, P.KEY_AUDIT + material(m, plan) + keyText, 12000, true);
    put(join(scratch, "audit-" + round + "-" + model + ".json"), { input, key });
    replies.push({ input, key });
  }
  return readAudit(d, replies, mechanical(m, d));
}

/** The key and unit files once the audit passed. */
export function keyOf(uid: string, m: Material, d: Draft, ratings: Record<"opus" | "sol", Foreseeable[]>, touched: ReturnType<typeof touchedOf>): Key {
  const by = new Map(m.candidates.map((c) => [c.id, c]));
  const items: KeyItem[] = d.items.map((it, i) => {
    const c = by.get(it.candidate)!;
    const kind = it.kind as KeyItem["kind"];
    return {
      id: "k" + (i + 1), kind, ...(kind === "B" ? { b_source: (c.kind === "R" ? "revert" : c.issues.some((q) => q.user) ? "user-issue" : "fix") as BSource, sites: c.sites } : {}),
      statement: it.statement, file: it.file, evidence: [c.change, ...(c.pr ? ["#" + c.pr] : [])], dated: c.merged_at, mentioned: it.mentioned === true, generic: false,
      foreseeable: { opus: ratings.opus[i] ?? null, sol: ratings.sol[i] ?? null },
    };
  });
  const own: OwnItem[] = d.own.map((s, i) => ({ id: "o" + (i + 1), statement: s }));
  return { unit: uid, items, primary: rankPrimary(uid, items), own, touched: touched.touched, diffstat: touched.diffstat };
}

const FORE = new Set(["yes", "maybe", "no"]);

async function foreseeable(ctx: Ctx, uid: string, m: Material, plan: string, d: Draft): Promise<Record<"opus" | "sol", Foreseeable[]>> {
  const out = { opus: [] as Foreseeable[], sol: [] as Foreseeable[] };
  if (!d.items.length) return out;
  const prompt = P.FORESEEABLE + fence("plan.md", plan) + fence("Files before the change", m.base_files.join("\n")) + fence("Statements", d.items.map((it, i) => i + ". " + it.statement + " (" + it.file + ")").join("\n"));
  for (const model of ["opus", "sol"] as const) {
    const r = await call(ctx, uid, "foreseeable-" + model, model, prompt, 4000, true);
    const by = new Map((Array.isArray(r?.ratings) ? r.ratings : []).map((x: any) => [Number(x?.index), x?.foreseeable]));
    out[model] = d.items.map((_, i) => (FORE.has(by.get(i) as string) ? (by.get(i) as Foreseeable) : (null as unknown as Foreseeable)));
  }
  return out;
}

export type Sealer = (work: string, uid: string, sealTo: string) => void;

/** tar of the unit and its audit records, age-encrypted to the recipient; plaintext never leaves the custody root. */
export const ageSealer = (recipient: string): Sealer => (work, uid, sealTo) => {
  mkdirSync(sealTo, { recursive: true });
  const r = spawnSync("bash", ["-o", "pipefail", "-c", 'tar -C "$1" --exclude=cache -cf - "units/$2" "scratch/$2" | age -R "$3" -o "$4.tmp" && mv "$4.tmp" "$4"', "seal", work, uid, recipient, join(sealTo, uid + ".tar.age")], { encoding: "utf8" });
  if (r.status !== 0) throw new PvError("E_USAGE", uid + ": sealing failed: " + (r.stderr ?? "").trim().slice(0, 200));
};

export interface RunOptions {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  custodyRoot?: string;
  journals?: string;
  clock?: Clock;
  query?: Query;
  sealer?: Sealer;
  head?: string;
}

const USAGE = "er author --candidates <mine.json> --frame <frame.jsonl> --clones <dir> --work <custody dir> --item <ledger item> --ids <candidate ids> [--set pilot|calibration|comparison|reserve] [--seal-to <dir> --recipient <file>] [--concurrency n] [--record <dir>] [--ledger <path>]";
const SETS = new Set(["pilot", "calibration", "comparison", "reserve"]);
export const cloneDir = (root: string, repo: string) => join(root, repo.replace("/", "__"));

export async function run(argv: string[], io: Io, o: RunOptions = {}): Promise<number> {
  const a = parseArgs(argv, { candidates: "many", frame: "one", clones: "one", work: "one", item: "one", ids: "one", set: "one", "seal-to": "one", recipient: "one", concurrency: "one", record: "one", ledger: "one" }, USAGE);
  need(a, ["candidates", "frame", "clones", "work", "item", "ids"], USAGE);
  const set = (a.one.set ?? "pilot") as Set_;
  if (!SETS.has(set)) throw new PvError("E_USAGE", "--set takes pilot, calibration, comparison or reserve");
  if (!!a.one["seal-to"] !== !!a.one.recipient) throw new PvError("E_USAGE", "--seal-to and --recipient go together");
  const work = custody(a.one.work!, o.custodyRoot);
  const head = o.head ?? pinnedHead();
  const sealer = a.one["seal-to"] ? o.sealer ?? ageSealer(a.one.recipient!) : null;
  if (sealer && !o.sealer && spawnSync("age", ["--version"]).status !== 0) throw new PvError("E_USAGE", "--seal-to needs the age binary on PATH");
  const all = new Map<string, Candidate>();
  for (const f of a.many.candidates!) for (const c of (readJson(f) as MineResult).candidates) all.set(c.id, c);
  const frame = new Map(readRecords<FrameRepo>(a.one.frame!, "--frame").map((f) => [f.repo, f]));
  const ids = a.one.ids!.split(",").filter(Boolean);
  for (const id of ids) {
    if (!all.has(id)) throw new PvError("E_USAGE", "no candidate " + id + " in --candidates");
    if (!all.get(id)!.eligible) throw new PvError("E_USAGE", id + " is not an eligible candidate");
    if (!frame.has(all.get(id)!.repo)) throw new PvError("E_USAGE", id + ": its repository is not in --frame");
  }
  const query = o.query ?? graphql;
  const clock = o.clock ?? { now: () => Date.now() };
  const logFile = join(work, "author-log.jsonl");
  const log = (uid: string, stage: string, data: Record<string, unknown>) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), head, item: a.one.item, uid, stage, ...data }) + "\n", { mode: 0o600 });
  const meter = await openMeter({ item: a.one.item!, runId: a.one.item!, out: join(o.journals ?? join(process.env.HOME ?? "/tmp", ".capy/work/er/journals"), a.one.item!), cacheDir: join(work, "cache"), maxOutputTokens: 32000, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch, warn: (c, msg) => log("-", "warn", { code: c, message: msg.slice(0, 200) }) });
  const ctx: Ctx = { meter, log };
  const results: string[] = [];
  try {
    await pool(Number(a.one.concurrency ?? "2"), ids.map((id) => async () => {
      const c = all.get(id)!;
      const f = frame.get(c.repo)!;
      const uid = unitId(id);
      const unit = join(work, "units", uid), scratch = join(work, "scratch", uid);
      const stateFile = join(scratch, "state.json");
      const state = existsSync(stateFile) ? readJson(stateFile) : { uid, candidate: id, stage: "collect", status: "open" };
      const save = () => put(stateFile, state);
      const drop = (reason: string) => {
        Object.assign(state, { status: "dropped", reason });
        save();
        log(uid, "drop", { reason });
        results.push(uid + " dropped (" + reason + ")");
      };
      try {
        if (state.status === "dropped" || state.status === "passed") return results.push(uid + " " + state.status);
        const clone = cloneDir(a.one.clones!, c.repo);
        if (state.stage === "collect") {
          const mat = collect(clone, c, query);
          if (typeof mat === "string") return drop(mat);
          put(join(scratch, "material.json"), mat);
          state.stage = "repo";
          save();
        }
        const m = readJson(join(scratch, "material.json")) as Material;
        if (state.stage === "repo") {
          buildUnitRepo(clone, c.base, join(unit, "repo"));
          put(join(scratch, "touched.json"), touchedOf(clone, c.base, c.change));
          state.stage = "plan";
          save();
        }
        if (state.stage === "plan") {
          const plan = await call(ctx, uid, "rewrite", "opus", P.REWRITE + fence("Description", m.plan_source.title + "\n\n" + m.plan_source.description) + (m.plan_source.issues.length ? fence("Request that led to it", m.plan_source.issues.map((q) => q.title + "\n\n" + q.text).join("\n\n---\n\n")) : ""), 8000, false);
          put(join(unit, "plan.md"), String(plan).trim() + "\n");
          state.stage = "key";
          save();
        }
        if (clock.now() < Date.parse(m.window_closes)) {
          state.status = "waiting";
          save();
          return results.push(uid + " waiting for its window to close on " + m.window_closes.slice(0, 10));
        }
        state.status = "open";
        if (state.stage === "key") {
          const d = withKinds(m, draftOf(await call(ctx, uid, "key-1", "opus", P.KEY + material(m, readFileSync(join(unit, "plan.md"), "utf8")), 16000, true)));
          put(join(scratch, "key-draft-1.json"), d);
          state.stage = "audit";
          save();
        }
        if (state.stage === "audit") {
          let d = withKinds(m, readJson(join(scratch, "key-draft-1.json")) as Draft);
          let plan = readFileSync(join(unit, "plan.md"), "utf8");
          let v = await audit(ctx, uid, m, plan, d, 1, scratch);
          log(uid, "audit-1", { failed: v.failed, input_problems: v.input.length, key_problems: v.key.length, drops: v.drops.size });
          if (v.failed) {
            if (v.input.length) {
              plan = String(await call(ctx, uid, "fix-plan", "opus", P.FIX + fence("Problems", v.input.map((p) => "- " + p).join("\n")) + sourceText(m.plan_source) + fence("plan.md", plan), 8000, false)).trim() + "\n";
              put(join(unit, "plan.md"), plan);
            }
            if (v.key.length || v.drops.size) {
              d = withKinds(m, draftOf(await call(ctx, uid, "key-2", "opus", P.KEY + material(m, plan) + fence("Your earlier key", JSON.stringify(d, null, 1)) + fence("Auditors' notes", v.key.concat([...v.drops].map((i) => "item " + i + ": drop")).join("\n")) + "\n\n" + P.KEY_FIX, 16000, true)));
              put(join(scratch, "key-draft-2.json"), d);
            }
            v = await audit(ctx, uid, m, plan, d, 2, scratch);
            log(uid, "audit-2", { failed: v.failed, input_problems: v.input.length, key_problems: v.key.length, drops: v.drops.size });
            if (v.failed) return drop("failed an audit twice");
          }
          d = { ...d, items: d.items.filter((_, i) => !v.drops.has(i)) };
          put(join(scratch, "key-final.json"), d);
          state.stage = "foreseeable";
          save();
        }
        if (state.stage === "foreseeable") {
          const d = readJson(join(scratch, "key-final.json")) as Draft;
          const plan = readFileSync(join(unit, "plan.md"), "utf8");
          const key = keyOf(uid, m, d, await foreseeable(ctx, uid, m, plan, d), readJson(join(scratch, "touched.json")));
          put(join(unit, "key.json"), key);
          if (!key.primary.length) return drop("no primary item");
          const meta: UnitMeta = {
            id: uid, set, type: f.type_prov as ProjectType, repo: c.repo, licence: c.licence, copyleft: f.copyleft, language: c.language ?? "unknown", merge_sha: c.change, base_sha: c.base, pr: c.pr, merged_at: c.merged_at,
            exposed_at: c.exposed_at, wave: c.wave, window_closes: c.window_closes, source_files: c.source_files, source_added: c.source_added, rank: 0, aftermath: c.aftermath.map((x) => x.change),
          };
          put(join(unit, "unit.json"), meta);
          state.stage = "seal";
          save();
        }
        if (state.stage === "seal") {
          if (sealer) sealer(work, uid, a.one["seal-to"]!);
          Object.assign(state, { stage: "done", status: "passed", sealed: !!sealer });
          save();
          log(uid, "passed", { items: (readJson(join(unit, "key.json")) as Key).items.length, primary: (readJson(join(unit, "key.json")) as Key).primary.length, sealed: !!sealer });
        }
        results.push(uid + " " + state.status);
      } catch (e) {
        const code = (e as { code?: string }).code ?? "E_INTERNAL";
        log(uid, "error", { code, message: String((e as Error).message).slice(0, 300) });
        if (code === "E_PV_PROVIDER_DRIFT") throw new PvError("E_ER_PROVIDER_DRIFT", uid + ": " + String((e as Error).message).replace(/^E_PV_PROVIDER_DRIFT /, ""));
        results.push(uid + " error (" + code + ")");
      }
    }));
  } finally {
    const s = await meter.close();
    log("-", "close", { spent_micros: s.spent_micros });
    io.out("er author: spent " + (s.spent_micros / 1e6).toFixed(4) + " USD on " + a.one.item);
  }
  for (const r of results) io.out(r);
  return 0;
}
