// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10's keyless secondaries on a first-stage change. Found it: a changed line within 20 lines of a hunk the real
// fix changed, in the same file. What it changed: descriptive counts. Later-fix overlap (exploratory): fix-titled
// upstream commits within 120 days after the base commit that changed lines within 3 lines of a hunk outside the real
// fix, read from a local clone of the public repository. Positions are lines of the base file; a run of changes that only
// adds lines sits between two base lines (k + 0.5). A hunk here is a run of consecutive changed lines, as git diff -U0
// writes it, whatever context the patch carries.
import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import { classify, CONSTRUCT_KINDS, FIX_TITLE, fixTitleDigest, GENERATED_HEADER, GENERATED_LINES, isProtected, isTestPath, STATE_CONSTRUCTS, type ConstructKind, type Lang } from "./langs.ts";
import { smFail } from "./unit.ts";

export const FOUND_LINES = 20;
export const LATER_LINES = 3;
export const LATER_DAYS = 120;

export interface Block {
  path: string; lo: number; hi: number; added: number; removed: number;
  /** First new line of the run (or the new line it sits before when it only removes), and the run's rows in the patch. */
  newAt: number; rows: [number, number]; lines: string[];
}
export interface FileDiff { oldPath: string | null; newPath: string | null; binary: boolean; blocks: Block[]; plus: string[]; minus: string[] }

const side = (s: string): string | null => {
  const t = s.replace(/\t.*$/, "").trim().replace(/^"(.*)"$/, "$1");
  return t === "/dev/null" ? null : t.replace(/^[ab]\//, "");
};

/** Every file of a git patch with its runs of changed lines. Hunks are read by their line counts. */
export function fileDiffs(patch: string): FileDiff[] {
  const out: FileDiff[] = [];
  const L = patch.split("\n");
  let cur: FileDiff | null = null;
  let i = 0;
  while (i < L.length) {
    const line = L[i]!;
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      cur = { oldPath: m?.[1] ?? null, newPath: m?.[2] ?? null, binary: false, blocks: [], plus: [], minus: [] };
      out.push(cur);
      for (i++; i < L.length && !L[i]!.startsWith("@@") && !L[i]!.startsWith("diff --git "); i++) {
        const h = L[i]!;
        if (h.startsWith("--- ")) cur.oldPath = side(h.slice(4));
        else if (h.startsWith("+++ ")) cur.newPath = side(h.slice(4));
        else if (h.startsWith("new file mode")) cur.oldPath = null;
        else if (h.startsWith("deleted file mode")) cur.newPath = null;
        else if (h.startsWith("Binary files ") || h === "GIT binary patch") cur.binary = true;
      }
      continue;
    }
    const hm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hm || !cur) { i++; continue; }
    const f: FileDiff = cur;
    let oldLeft = hm[2] === undefined ? 1 : Number(hm[2]);
    let newLeft = hm[4] === undefined ? 1 : Number(hm[4]);
    let nextOld = oldLeft === 0 ? Number(hm[1]) + 1 : Number(hm[1]);
    let nextNew = newLeft === 0 ? Number(hm[3]) + 1 : Number(hm[3]);
    let run: { first: number; last: number; at: number; newAt: number; added: number; removed: number; row: number; lines: string[] } | null = null;
    const close = (row: number) => {
      if (!run) return;
      const path = f.oldPath ?? f.newPath ?? "";
      const [lo, hi] = run.removed ? [run.first, run.last] : [run.at - 0.5, run.at - 0.5];
      f.blocks.push({ path, lo, hi, added: run.added, removed: run.removed, newAt: run.newAt, rows: [run.row, row], lines: run.lines });
      run = null;
    };
    for (i++; i < L.length && (oldLeft > 0 || newLeft > 0); i++) {
      const l = L[i]!;
      const c = l[0];
      if (c === "\\") continue;
      if (c === "-" || c === "+") {
        run ??= { first: 0, last: 0, at: nextOld, newAt: nextNew, added: 0, removed: 0, row: i, lines: [] };
        run.lines.push(l);
        if (c === "-") {
          if (!run.removed) run.first = nextOld;
          run.last = nextOld;
          run.removed++;
          f.minus.push(l.slice(1));
          nextOld++;
          oldLeft--;
        } else {
          run.added++;
          f.plus.push(l.slice(1));
          nextNew++;
          newLeft--;
        }
        continue;
      }
      close(i - 1);
      nextOld++;
      nextNew++;
      oldLeft--;
      newLeft--;
    }
    close(i - 1);
  }
  return out;
}

export const blocks = (patch: string): Block[] => fileDiffs(patch).filter((f) => !f.binary).flatMap((f) => f.blocks);
export const dist = (a: { lo: number; hi: number }, b: { lo: number; hi: number }): number => Math.max(0, a.lo - b.hi, b.lo - a.hi);

/** Found it: some run of the arm's change within 20 lines of a run the real fix changed, same file. found_not_fixed needs
 *  the strict reading's fixed bit (null when the change was not scored). */
export function foundIt(arm: string, fix: string, fixed: boolean | null): { found: boolean; nearest: number | null; files: string[]; found_not_fixed: boolean | null } {
  const fb = blocks(fix);
  let nearest: number | null = null;
  const files = new Set<string>();
  for (const a of blocks(arm)) {
    for (const f of fb) {
      if (a.path !== f.path) continue;
      const d = dist(a, f);
      if (nearest === null || d < nearest) nearest = d;
      if (d <= FOUND_LINES) files.add(a.path);
    }
  }
  const found = files.size > 0;
  return { found, nearest, files: [...files].sort(), found_not_fixed: fixed === null ? null : found && !fixed };
}

export interface ChangeContext { lang: Lang; scopeDir: string | null; testFiles: string[]; readBase: (path: string) => string | null }
export interface Changed {
  files: number; lines: { added: number; removed: number }; outside_folder: string[] | null; test_files: string[]; build_files: string[];
  generated: Array<{ path: string; by: "gitattributes" | "header" }>; state_constructs: Record<ConstructKind, number>;
}

/** The linguist-generated mark for path from every .gitattributes on its way down from the root; a later or deeper line
 *  wins. A pattern with a slash matches from its file's dir, one without matches the file name. */
function markedGenerated(path: string, readBase: (p: string) => string | null): boolean {
  const parts = path.split("/");
  let mark = false;
  for (let d = 0; d < parts.length; d++) {
    const dir = parts.slice(0, d).join("/");
    const text = readBase(dir ? dir + "/.gitattributes" : ".gitattributes");
    if (!text) continue;
    const rel = parts.slice(d).join("/");
    for (const raw of text.split("\n")) {
      const [pat, ...attrs] = raw.trim().split(/\s+/);
      if (!pat || pat.startsWith("#")) continue;
      const set = attrs.find((a) => /^[-!]?linguist-generated(=|$)/.test(a));
      if (!set) continue;
      const p = pat.replace(/^\//, "");
      const hit = pat.replace(/\/$/, "").includes("/") ? new Bun.Glob(p).match(rel) : new Bun.Glob(p).match(posix.basename(rel));
      if (hit) mark = !(set.startsWith("-") || set.startsWith("!") || set === "linguist-generated=false");
    }
  }
  return mark;
}

/** What it changed: descriptive counts over the arm's change against the base tree. */
export function whatChanged(arm: string, ctx: ChangeContext): Changed {
  const fds = fileDiffs(arm);
  const testSet = new Set(ctx.testFiles);
  const paths = (f: FileDiff) => [f.oldPath, f.newPath].filter((p): p is string => p !== null);
  const at = (f: FileDiff) => f.newPath ?? f.oldPath ?? "";
  const inside = (p: string) => ctx.scopeDir === null || ctx.scopeDir === "" || ctx.scopeDir === "." || p === ctx.scopeDir || p.startsWith(ctx.scopeDir + "/");
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const constructs = Object.fromEntries(CONSTRUCT_KINDS.map((k) => [k, 0])) as Record<ConstructKind, number>;
  const generated: Changed["generated"] = [];
  for (const f of fds) {
    const p = at(f);
    if (markedGenerated(p, ctx.readBase)) generated.push({ path: p, by: "gitattributes" });
    else {
      const head = (f.oldPath ? ctx.readBase(f.oldPath)?.split("\n") : f.plus) ?? [];
      if (head.slice(0, GENERATED_LINES).some((l) => GENERATED_HEADER.test(l))) generated.push({ path: p, by: "header" });
    }
    if (f.binary || classify(ctx.lang, p, testSet) !== "source") continue;
    for (const { kind, re } of STATE_CONSTRUCTS[ctx.lang]) constructs[kind] += Math.max(0, f.plus.filter((l) => re.test(l)).length - f.minus.filter((l) => re.test(l)).length);
  }
  return {
    files: fds.length,
    lines: { added: fds.reduce((s, f) => s + f.plus.length, 0), removed: fds.reduce((s, f) => s + f.minus.length, 0) },
    outside_folder: ctx.scopeDir === null ? null : uniq(fds.filter((f) => paths(f).some((p) => !inside(p))).map(at)),
    test_files: uniq(fds.map(at).filter((p) => isTestPath(ctx.lang, p, testSet))),
    build_files: uniq(fds.flatMap(paths).filter(isProtected)),
    generated: generated.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    state_constructs: constructs,
  };
}

export interface LaterFix {
  ref: string; window: { from: string; to: string }; fix_title_sha256: string; candidates: number; excluded: string[];
  outside: number; overlapping: number; hunks: Array<{ path: string; lo: number; hi: number; commits: string[] }>;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Base line span of line p of a later tree, through the base-to-later runs of one file. */
function toBase(runs: Block[], p: number): [number, number] {
  if (p <= 0) return [0, 0];
  let offset = 0;
  for (const r of runs) {
    if (r.added && p >= r.newAt && p < r.newAt + r.added) return [r.lo, r.hi];
    if (r.added ? r.newAt + r.added - 1 < p : r.newAt <= p) offset += r.added - r.removed;
  }
  return [p - offset, p - offset];
}

/** Later-fix overlap from a local clone: non-merge commits on the clone's HEAD whose committer date falls after the base
 *  commit's and within 120 days, titled by the frozen fix words, minus the target fix's commits (exclude, any commit on
 *  refs/sm/pull-<n> past the base, and any commit whose message names #<n>). Each candidate's runs are mapped to base
 *  lines through the diff from the base to its parent. */
export function laterFix(arm: string, fix: string, clone: string, o: { base: string; pull: string; exclude?: string[] }): LaterFix {
  const git = (args: string[], ok = [0]) => {
    const r = spawnSync("git", ["-C", clone, "-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    if (!ok.includes(r.status ?? 1)) smFail("E_SM_SECONDARY", "git " + args.slice(0, 2).join(" ") + " failed in the clone: " + (r.stderr ?? "").trim().split("\n")[0]);
    return { status: r.status ?? 1, out: r.stdout ?? "" };
  };
  const from = new Date(git(["log", "-1", "--format=%cI", o.base]).out.trim());
  const to = new Date(from.getTime() + LATER_DAYS * 86_400_000);
  const ref = git(["rev-parse", "HEAD"]).out.trim();
  const fb = blocks(fix);
  const outside = blocks(arm).filter((a) => !fb.some((f) => f.path === a.path && dist(a, f) === 0));
  const paths = [...new Set(outside.map((a) => a.path))].sort();
  const hunks = outside.map((a) => ({ path: a.path, lo: a.lo, hi: a.hi, commits: [] as string[] }));
  const window = { from: iso(from), to: iso(to) };
  const res = (candidates: number, excluded: string[]): LaterFix => ({
    ref, window, fix_title_sha256: fixTitleDigest(), candidates, excluded,
    outside: hunks.length, overlapping: hunks.filter((h) => h.commits.length).length, hunks,
  });
  if (!paths.length) return res(0, []);
  const pullRef = "refs/sm/pull-" + o.pull;
  const onPull = new Set(git(["rev-parse", "--verify", "-q", pullRef], [0, 1]).status === 0 ? git(["rev-list", o.base + ".." + pullRef]).out.split("\n").filter(Boolean) : []);
  const skip = new Set([...(o.exclude ?? []), ...onPull]);
  const names = new RegExp("#" + o.pull.replace(/\D/g, "") + "\\b");
  const log = git(["log", "--no-merges", "--format=%H%x1f%cI%x1f%s%x1f%B%x1e", "HEAD", "--", ...paths]).out.split("\x1e").map((s) => s.trim()).filter(Boolean);
  let candidates = 0;
  const excluded: string[] = [];
  for (const entry of log) {
    const [sha, date, subject, body] = entry.split("\x1f") as [string, string, string, string];
    const t = new Date(date).getTime();
    if (!(t > from.getTime() && t <= to.getTime()) || !FIX_TITLE.test(subject)) continue;
    if (skip.has(sha) || names.test(subject) || names.test(body ?? "")) { excluded.push(sha); continue; }
    candidates++;
    const touched = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", sha]).out.split("\n").filter((p) => paths.includes(p));
    for (const p of touched) {
      const toParent = blocks(git(["diff", "--no-renames", "-U0", o.base, sha + "^", "--", p]).out);
      for (const r of blocks(git(["diff", "--no-renames", "-U0", sha + "^", sha, "--", p]).out)) {
        let span: [number, number];
        if (r.removed) span = [toBase(toParent, r.lo)[0], toBase(toParent, r.hi)[1]];
        else {
          const k = Math.floor(r.lo);
          const lo = toBase(toParent, k)[1] + 0.5, hi = toBase(toParent, k + 1)[0] - 0.5;
          span = lo <= hi ? [lo, hi] : [hi, lo];
        }
        for (const h of hunks) if (h.path === p && dist(h, { lo: span[0], hi: span[1] }) <= LATER_LINES && !h.commits.includes(sha)) h.commits.push(sha);
      }
    }
  }
  return res(candidates, excluded);
}
