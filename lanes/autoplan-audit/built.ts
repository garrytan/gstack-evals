// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.5's built-text matcher. A gate-time plan that opens with wiki front matter carrying an id is matched to the
// post at the main commit whose path holds that id. Otherwise the code and shingle rule: among posts whose path holds
// the record's thread code, the one with the highest share of the plan's 8-word shingles, accepted at 0.10 or more; with
// no code match, the best post over all of wiki/ at 0.50 or more. Either way the post must have been first added after
// the run started. Restatement sections (Review record, Approval, Approvals, Changelog) are removed from every built
// text. Stage 1 freezes each run's matched path with the main commit; stage 2 reads only those paths at that commit.
import { spawnSync } from "node:child_process";
import { words } from "./diff.ts";
import { fail } from "./errors.ts";
import type { RunRecord } from "./records.ts";
import { threadCode } from "./records.ts";

export const CODE_SHARE = 0.1;
export const CONTAINMENT_SHARE = 0.5;
export const SHINGLE = 8;

export interface Git {
  show(path: string): string | null;
  posts(): string[];
  firstAdded(path: string): string | null;
  commit: string;
}

const git = (repo: string, args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

/** git at one commit of a gstack-evals checkout. */
export function gitAt(repo: string, commit: string): Git {
  const full = git(repo, ["rev-parse", "--verify", commit + "^{commit}"]).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(full)) fail("E_USAGE", "the main commit does not resolve in " + repo);
  const added = new Map<string, string | null>();
  return {
    commit: full,
    show: (p) => {
      const r = git(repo, ["show", full + ":" + p]);
      return r.status === 0 ? r.stdout : null;
    },
    posts: () => git(repo, ["ls-tree", "-r", "--name-only", full, "wiki/"]).stdout.split("\n").filter((p) => /\.md$/.test(p) && !/^wiki\/(README|INDEX)\.md$/.test(p)),
    firstAdded: (p) => {
      if (!added.has(p)) {
        const lines = git(repo, ["log", "--diff-filter=A", "--format=%cI", full, "--", p]).stdout.trim().split("\n").filter(Boolean);
        added.set(p, lines.length ? lines[lines.length - 1]! : null);
      }
      return added.get(p)!;
    },
  };
}

export function frontMatterId(plan: string): string | null {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(plan);
  if (!m) return null;
  const id = /^id:\s*["']?([^"'\s]+)["']?\s*$/m.exec(m[1]!);
  return id ? id[1]! : null;
}

export function shingles(text: string, n = SHINGLE): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export const containment = (plan: ReadonlySet<string>, post: ReadonlySet<string>): number => {
  if (!plan.size) return 0;
  let k = 0;
  for (const s of plan) if (post.has(s)) k++;
  return k / plan.size;
};

/** Removes each restatement section from its heading to the next heading of the same or a higher level. */
export function stripRestatement(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let skip = 0;
  let fence = false;
  for (const line of lines) {
    if (/^\s*(\x60\x60\x60|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      if (skip && level <= skip) skip = 0;
      if (!skip && /^(review record|approval|approvals|changelog)\b/i.test(h[2]!.replace(/[*_\x60]/g, "").trim())) skip = level;
    }
    if (!skip) out.push(line);
  }
  return out.join("\n");
}

export interface Match {
  how: "id" | "code" | "containment" | null;
  path: string | null;
  share: number | null;
  frontMatter: boolean;
}

const postId = (path: string) => path.replace(/\/README\.md$/, "").replace(/\.md$/, "").split("/").pop()!;

export function matchBuilt(r: RunRecord, g: Git, cache: Map<string, Set<string>> = new Map()): Match {
  const plan = r.gatePlan;
  if (plan === null) return { how: null, path: null, share: null, frontMatter: false };
  const id = frontMatterId(plan);
  const posts = g.posts();
  const started = String(r.run?.created_at ?? "");
  const after = (p: string) => {
    const a = g.firstAdded(p);
    return a !== null && started !== "" && Date.parse(a) > Date.parse(started);
  };
  if (id) {
    const hit = posts.filter((p) => p.includes(id)).sort((a, b) => Number(postId(b) === id) - Number(postId(a) === id) || a.length - b.length)[0];
    if (hit) return { how: "id", path: hit, share: null, frontMatter: true };
  }
  const mine = shingles(plan);
  const share = (p: string) => {
    if (!cache.has(p)) cache.set(p, shingles(g.show(p) ?? ""));
    return containment(mine, cache.get(p)!);
  };
  const best = (cands: string[]) => cands.map((p) => ({ p, s: share(p) })).sort((a, b) => b.s - a.s || a.p.localeCompare(b.p))[0];
  const code = threadCode(r);
  const coded = code ? posts.filter((p) => p.toLowerCase().includes(code)) : [];
  const c = coded.length ? best(coded) : undefined;
  if (c && c.s >= CODE_SHARE && after(c.p)) return { how: "code", path: c.p, share: c.s, frontMatter: id !== null };
  const all = best(posts);
  if (all && all.s >= CONTAINMENT_SHARE && after(all.p)) return { how: "containment", path: all.p, share: all.s, frontMatter: id !== null };
  return { how: null, path: null, share: c?.s ?? all?.s ?? null, frontMatter: id !== null };
}

/** The built text a check reads: the matched post at the commit without its restatement sections. */
export function builtText(g: Git, path: string): string | null {
  const t = g.show(path);
  return t === null ? null : stripRestatement(t);
}

export interface Frozen {
  main_commit: string;
  paths: Record<string, { path: string; how: string }>;
}
