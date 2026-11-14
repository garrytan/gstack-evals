// Copyright (c) 2026 Garry Tan. MIT License.
// Unit prep on the tree (post sections 4 and 5): the strip rule, the one-commit history, the follow-on's second commit and
// the commit-count preflight. Each step is a bash script that runs either on a host dir (tests, on invented fixture repos)
// or in a container from the unit's image as root with --network none, on the unit's tree volume mounted at repo_dir.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { dockerRun } from "../../real-outcome/task/docker.ts";
import { parsePatch as fileChanges } from "../mutation/diff.ts";
import { smFail } from "./unit.ts";

export type Where = { kind: "host"; dir: string } | { kind: "docker"; image: string; volume: string; repoDir: string; name: string; timeoutMs?: number };

/** Runs script with $1 = the tree, $2 = a dir holding files, then args. */
export function runBash(where: Where, script: string, files: Record<string, string> = {}, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const inDir = mkdtempSync(join(tmpdir(), "sm-in-"));
  try {
    for (const [n, body] of Object.entries(files)) writeFileSync(join(inDir, n), body);
    if (where.kind === "host") {
      const r = spawnSync("bash", ["-c", script, "bash", where.dir, inDir, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    }
    const r = dockerRun(where.name, ["--rm", "--network", "none", "--user", "0:0", "-v", where.volume + ":" + where.repoDir, "-v", inDir + ":/sm-in:ro", "--entrypoint", "bash", where.image, "-c", script, "bash", where.repoDir, "/sm-in", ...args], { timeoutMs: where.timeoutMs ?? 1_800_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(inDir, { recursive: true, force: true });
  }
}

/** One of the family's bash scripts under sh/. */
export const sh = (name: string): string => readFileSync(join(import.meta.dir, "sh", name), "utf8");
const b64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

export const LIST_SCRIPT = sh("list.sh");

/** The @imports a CLAUDE.md names, outside code blocks and code spans, resolved one level from the file's own dir. Only
 *  paths inside the repository are returned (relative to it); home (~) and outside paths are not the repository's. */
export function importsOf(file: string, content: string, repoDir: string): string[] {
  const text = content.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, "").replace(/`[^`\n]*`/g, "");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
    const p = m[1]!;
    if (p.startsWith("~")) continue;
    let rel: string;
    if (p.startsWith("/")) {
      if (!p.startsWith(repoDir.replace(/\/+$/, "") + "/")) continue;
      rel = posix.normalize(p.slice(repoDir.replace(/\/+$/, "").length + 1));
    } else rel = posix.normalize(posix.join(dirname(file) === "." ? "" : dirname(file), p));
    if (rel === "." || rel === ".." || rel.startsWith("../") || rel.startsWith("/") || rel.split("/").includes(".git")) continue;
    out.push(rel.replace(/\/+$/, ""));
  }
  return out;
}

export interface StripPlan { head: string; dirty: number; remove: string[] }

/** Section 5.3's rule on the listing LIST_SCRIPT prints: every CLAUDE.md, CLAUDE.local.md and AGENTS.md (so .claude/AGENTS.md
 *  too) and every .claude dir at any depth, then each in-repository @import a removed CLAUDE.md or CLAUDE.local.md names. */
export function stripPlan(listing: string, repoDir: string): StripPlan {
  let head = "none", dirty = 0;
  const remove = new Set<string>();
  for (const line of listing.split("\n")) {
    const [k, a, c] = line.split("\t");
    if (k?.startsWith("HEAD ")) head = k.slice(5).trim();
    else if (k?.startsWith("DIRTY ")) dirty = Number(k.slice(6).trim());
    else if (k === "D" || k === "P") remove.add(b64(a!));
    else if (k === "F") {
      const path = b64(a!);
      remove.add(path);
      for (const i of importsOf(path, b64(c ?? ""), repoDir)) remove.add(i);
    }
  }
  return { head, dirty, remove: [...remove].sort() };
}

export const REWRITE_SCRIPT = sh("rewrite.sh");

/** Commit two of a follow-on tree: the first stage's full-tree patch, staged by git apply --index, so build output the tree
 *  holds untracked stays out, less the paths followOnStrip names. */
export const FOLLOWON_SCRIPT = sh("followon.sh");

/** Section 4's strip rule on a first stage's full-tree patch, for the follow-on tree built on it: every CLAUDE.md,
 *  CLAUDE.local.md and AGENTS.md the patch writes (so .claude/AGENTS.md too), the outermost .claude a written path sits
 *  in, and each in-repository @import a written CLAUDE.md or CLAUDE.local.md names. The base tree was stripped already,
 *  so anything the rule names in a follow-on tree came from the patch. */
export function followOnStrip(treePatch: string, repoDir: string): string[] {
  const remove = new Set<string>();
  const texts = treePatch.split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git "));
  fileChanges(treePatch).forEach((c, i) => {
    const p = c.newPath;
    if (!p) return;
    const parts = p.split("/");
    const name = parts[parts.length - 1]!;
    const at = parts.indexOf(".claude");
    if (at >= 0) remove.add(parts.slice(0, at + 1).join("/"));
    else if (name === "AGENTS.md" || name === "CLAUDE.md" || name === "CLAUDE.local.md") remove.add(p);
    if ((name === "CLAUDE.md" || name === "CLAUDE.local.md") && !c.binary) {
      const body = (texts[i] ?? "").split("\n");
      const hunk = body.findIndex((l) => l.startsWith("@@"));
      const text = hunk < 0 ? "" : body.slice(hunk).filter((l) => l.startsWith("+")).map((l) => l.slice(1)).join("\n");
      for (const imp of importsOf(p, text, repoDir)) remove.add(imp);
    }
  });
  return [...remove].sort();
}

/** The files sh/followon.sh reads beside itself: the first stage's patch and followOnStrip's paths, NUL-separated. The
 *  session image and the follow-on scorer's start tree both build from these, so their trees match. */
export function followOnFiles(treePatch: string, repoDir: string): Record<string, string> {
  return { "tree.patch": treePatch, remove: followOnStrip(treePatch, repoDir).map((p) => p + "\0").join("") };
}

/** The paths followon.sh removed after the patch applied, from its output. */
export const strippedPaths = (out: string): string[] => out.split("\n").filter((l) => l.startsWith("STRIPPED\t")).map((l) => b64(l.slice(9))).sort();

export const PREFLIGHT_SCRIPT = sh("preflight.sh");

export const RESTORE_SCRIPT = sh("restore.sh");

/** Section 4's preflight: one commit on a base tree, two on a follow-on tree, every commit reachable from HEAD, refs only
 *  main, no remote, stash, reflog or loose object. Returns the PREFLIGHT line; refuses with E_SM_HISTORY. */
export function preflight(where: Where, want: 1 | 2, label: string): string {
  const r = runBash(where, PREFLIGHT_SCRIPT);
  const line = r.stdout.split("\n").find((l) => l.startsWith("PREFLIGHT ")) ?? "";
  const f = Object.fromEntries(line.slice(10).split(" ").map((kv) => kv.split("=") as [string, string]));
  const ok = f.count === String(want) && f.refs === "refs/heads/main" && f.remotes === "0" && f.stash === "0" && f.loose === "0" && f.logs === "0" && f.headmatch === "1";
  if (!ok) smFail("E_SM_HISTORY", label + ": the commit-count preflight wants " + want + " commit(s) on main alone, got " + (line || "no answer: " + r.stderr.slice(-300)));
  return line;
}

/** Strip, one-commit history and preflight on a base tree. Refuses (E_SM_HISTORY) when the tree is not at base_commit.
 *  Tracked files the image changed go back to the base commit's checkout first (section 4 gives the repository at the base
 *  commit), and are returned as restored; one that still differs refuses. Returns removed and restored paths and the
 *  preflight line. */
export function prepareBase(where: Where, base: string, repoDir: string, label: string): { removed: string[]; restored: string[]; preflight: string } {
  const list = () => {
    const l = runBash(where, LIST_SCRIPT);
    if (l.status !== 0) smFail("E_SM_HISTORY", label + ": the tree listing failed: " + l.stderr.slice(-300));
    return stripPlan(l.stdout, repoDir);
  };
  let plan = list();
  if (plan.head !== base) smFail("E_SM_HISTORY", label + ": the image's tree is at " + plan.head + ", not base_commit " + base);
  let restored: string[] = [];
  if (plan.dirty) {
    const s = runBash(where, RESTORE_SCRIPT);
    if (s.status !== 0) smFail("E_SM_HISTORY", label + ": restoring tracked files to base_commit failed: " + s.stderr.slice(-300));
    restored = s.stdout.split("\n").filter((x) => x.startsWith("RESTORED\t")).map((x) => b64(x.slice(9))).sort();
    plan = list();
  }
  if (plan.dirty) smFail("E_SM_HISTORY", label + ": " + plan.dirty + " tracked file(s) still differ from base_commit after the restore");
  const w = runBash(where, REWRITE_SCRIPT, { remove: plan.remove.map((p) => p + "\0").join("") });
  if (w.status !== 0) smFail("E_SM_HISTORY", label + ": the history rewrite failed: " + w.stderr.slice(-300));
  const removed = w.stdout.split("\n").filter((x) => x.startsWith("REMOVED\t")).map((x) => b64(x.slice(8))).sort();
  return { removed, restored, preflight: preflight(where, 1, label) };
}

/** A follow-on tree: commit two on top of a prepared base, then the preflight for two commits. */
export function prepareFollowOn(where: Where, treePatch: string, label: string): string {
  const w = runBash(where, FOLLOWON_SCRIPT, followOnFiles(treePatch, where.kind === "host" ? where.dir : where.repoDir));
  if (w.status !== 0) smFail("E_SM_HISTORY", label + ": the follow-on commit failed: " + w.stderr.slice(-300));
  return preflight(where, 2, label);
}
