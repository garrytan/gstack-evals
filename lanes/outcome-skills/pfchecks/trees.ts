// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 6.3: the three scoring trees, each one commit on top of S with the same fixed identity, date and message,
// so every tree has the same history shape and only content differs. Parent is T; fix is T plus the fix less its
// in-source test-module hunks, applied with git apply --3way (a conflict is the gap E_PF_FIX_CONFLICT); neutral is T plus
// the unit's validated neutral edit. All git work runs on a host clone of S.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lang } from "../statemachines/langs.ts";
import { neutralEdit, type NeutralMode } from "./neutral.ts";
import { pfFail } from "./prereg.ts";
import { planTransplant, type Change, type TransplantPlan } from "./transplant.ts";

export const IDENT = { name: "scoring", email: "scoring@localhost", date: "2000-01-01T00:00:02Z", message: "scoring tree" } as const;

export function git(repo: string, args: string[], o: { input?: string; env?: Record<string, string>; ok?: number[] } = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-c", "safe.directory=*", "-c", "core.quotepath=off", "-c", "gc.auto=0", ...args], { cwd: repo, input: o.input, encoding: "latin1", maxBuffer: 1 << 29, env: { ...process.env, ...o.env } });
  const out = { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  if (!(o.ok ?? [0]).includes(out.status)) pfFail("E_PF_INPUT", "git " + args.slice(0, 3).join(" ") + " in " + repo + " exited " + out.status + ": " + out.stderr.slice(-300));
  return out;
}
const one = (repo: string, args: string[]) => git(repo, args).stdout.trim();

/** S's root commit: the unit's one-commit base. */
export function rootOf(repo: string, ref: string): string {
  const roots = one(repo, ["rev-list", "--max-parents=0", ref]).split("\n").filter(Boolean);
  if (roots.length !== 1) pfFail("E_PF_INPUT", ref + " has " + roots.length + " root commits; S must sit on the unit's one-commit base");
  return roots[0]!;
}

export function changesOf(repo: string, from: string, to: string): Change[] {
  const f = git(repo, ["diff", "--no-renames", "--name-status", "-z", from, to]).stdout.split("\0");
  const out: Change[] = [];
  for (let i = 0; i + 1 < f.length; i += 2) {
    const s = f[i]![0];
    out.push({ path: f[i + 1]!, status: s === "A" ? "A" : s === "D" ? "D" : "M" });
  }
  return out;
}

export const show = (repo: string, commit: string, path: string): string => git(repo, ["show", commit + ":" + path]).stdout;

export function commitTree(repo: string, tree: string, parent: string): string {
  const env = { GIT_AUTHOR_DATE: IDENT.date, GIT_COMMITTER_DATE: IDENT.date };
  return git(repo, ["-c", "user.name=" + IDENT.name, "-c", "user.email=" + IDENT.email, "commit-tree", tree, "-p", parent, "-m", IDENT.message], { env }).stdout.trim();
}

/** A tree commit with files removed, on top of s (the compile-blocked rerun trees). */
export function withoutFiles(repo: string, commit: string, s: string, files: string[]): string {
  const tmp = mkdtempSync(join(tmpdir(), "pf-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(tmp, "index") };
    git(repo, ["read-tree", commit], { env });
    if (files.length) git(repo, ["--literal-pathspecs", "rm", "--cached", "-q", "--ignore-unmatch", "--", ...files], { env });
    return commitTree(repo, git(repo, ["write-tree"], { env }).stdout.trim(), s);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface Trees { s: string; base: string; parent: string; fix: string | null; neutral: string; gap: "E_PF_FIX_CONFLICT" | null; conflict: string | null; plan: TransplantPlan }

export function buildTrees(o: { repo: string; ref: string; lang: Lang; testFiles: ReadonlySet<string>; fixPatch: string; neutral: { mode: NeutralMode; files: string[] } }): Trees {
  const s = one(o.repo, ["rev-parse", "--verify", o.ref + "^{commit}"]);
  const base = rootOf(o.repo, s);
  const plan = planTransplant(o.lang, o.testFiles, changesOf(o.repo, base, s), (p) => ({ base: show(o.repo, base, p), diff: git(o.repo, ["diff", "--no-renames", "--no-color", "--no-ext-diff", base, s, "--", p]).stdout }));
  const wt = mkdtempSync(join(tmpdir(), "pf-tree-"));
  git(o.repo, ["worktree", "add", "-q", "--detach", "-f", wt, s]);
  try {
    if (plan.restore.length) git(wt, ["--literal-pathspecs", "checkout", base, "--", ...plan.restore]);
    for (const w of plan.write) writeFileSync(join(wt, w.path), w.text, "latin1");
    if (plan.write.length) git(wt, ["--literal-pathspecs", "add", "--", ...plan.write.map((w) => w.path)]);
    const tTree = one(wt, ["write-tree"]);
    const parent = commitTree(o.repo, tTree, s);
    const ap = git(wt, ["apply", "--3way", "--whitespace=nowarn", "-"], { input: o.fixPatch, ok: [0, 1, 128] });
    let fix: string | null = null;
    if (ap.status === 0) fix = commitTree(o.repo, one(wt, ["write-tree"]), s);
    git(wt, ["reset", "-q", "--hard", parent]);
    git(wt, ["clean", "-q", "-fdx"]);
    for (const f of o.neutral.files) {
      const p = join(wt, f);
      if (!existsSync(p)) continue;
      writeFileSync(p, neutralEdit(o.lang, readFileSync(p, "latin1"), o.neutral.mode), "latin1");
      git(wt, ["--literal-pathspecs", "add", "--", f]);
    }
    const neutral = commitTree(o.repo, one(wt, ["write-tree"]), s);
    for (const [k, v] of [["parent", parent], ["fix", fix], ["neutral", neutral]] as const) if (v) git(o.repo, ["update-ref", "refs/pf/" + k, v]);
    return { s, base, parent, fix, neutral, gap: fix ? null : "E_PF_FIX_CONFLICT", conflict: fix ? null : ap.stderr.slice(-600), plan };
  } finally {
    git(o.repo, ["worktree", "remove", "--force", wt], { ok: [0, 128] });
    rmSync(wt, { recursive: true, force: true });
  }
}
