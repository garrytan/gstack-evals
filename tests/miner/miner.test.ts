import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog } from "../../lanes/review-replay/catalog/catalog.ts";
import {
  type Api, auditOrder, blameRanges, build, canHoldDefect, caseId, ghApi, type Hand, isFixTitle, mapLine, mentions, mine, type Mined, namedIssues, parseBlame, parseDiff,
  reviewSection, rewrittenRanges,
} from "../../scripts/mine-review-cases.ts";

// The mine tests drive dozens of git commands, 1.5 to 4.5 s each on a 4-core machine, so bun's 5 s default fails them under load (GST-1016, GST-978).
setDefaultTimeout(30_000);

const ROOT = join(import.meta.dir, "../..");
const tmp = mkdtempSync(join(tmpdir(), "miner-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}

/** A work tree whose commits the tests push to a bare remote, then clone the way the miner expects. */
class Fixture {
  readonly work: string;
  readonly remote: string;
  constructor(readonly name: string) {
    this.work = join(tmp, name + "-work");
    this.remote = join(tmp, name + ".git");
    mkdirSync(this.work, { recursive: true });
    git(tmp, "init", "-q", "--bare", this.remote);
    git(this.work, "init", "-q");
  }
  commit(files: Record<string, string>, message: string): string {
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(join(this.work, p, ".."), { recursive: true });
      writeFileSync(join(this.work, p), t);
    }
    git(this.work, "add", "-A");
    git(this.work, "commit", "-q", "-m", message);
    return git(this.work, "rev-parse", "HEAD");
  }
  /** A squash merge onto main of the branch head's tree. */
  squash(head: string, onto: string, message: string): string {
    const sha = git(this.work, "commit-tree", head + "^{tree}", "-p", onto, "-m", message);
    git(this.work, "update-ref", "refs/heads/main", sha);
    git(this.work, "reset", "-q", "--hard");
    return sha;
  }
  clone(): string {
    git(this.work, "push", "-q", "--force", this.remote, "refs/heads/*:refs/heads/*", "refs/pull/*:refs/pull/*");
    const dir = join(tmp, "clones-" + this.name, this.name);
    git(tmp, "clone", "-q", this.remote, dir);
    return join(tmp, "clones-" + this.name);
  }
}

const lines = (xs: string[]) => xs.join("\n") + "\n";
const BASE = Array.from({ length: 10 }, (_, i) => "base " + (i + 1));
const FEAT = ["feat a", "feat b", "bug c", "feat d", "feat e", "feat f", "feat g", "feat h", "feat i", "feat j", "feat k", "feat l"];

function fakeApi(responses: Record<string, unknown>): Api & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    calls: () => seen.length,
    async get(path: string, opts?: { fresh?: boolean }) {
      seen.push(path + (opts?.fresh ? " fresh" : ""));
      if (path.startsWith("repos/o/") && path.includes("/issues/")) return null;
      if (!(path in responses)) throw new Error("unexpected GET " + path);
      return structuredClone(responses[path]);
    },
  };
}

const pr = (n: number, title: string, merged: string, merge: string, head: string, body = "") =>
  ({ number: n, title, body, merged_at: merged, created_at: merged.replace("T12", "T08"), updated_at: merged, merge_commit_sha: merge, head: { sha: head }, base: { ref: "main" }, user: { login: "dev" + n } });
const scope = () => ({ text: "SCOPE_BACKEND=true\nSCOPE_FRONTEND=false\n", sha: "f".repeat(40) });
const catalogDir = () => { const d = mkdtempSync(join(tmp, "catalog-")); return d; };

// A squash-merged repo like gstack: #1 adds a feature with two defects; its own review fixes one (k2); #2 fixes the other
// after merge; #3 and #4 later rewrite the lines #2's fix and k2 added; #5 is a fix that touches only a test.
function squashRepo(name = "r") {
  const f = new Fixture(name);
  const R = "repos/o/" + name;
  const c0 = f.commit({ "src/app.ts": lines(BASE), "test/app.test.ts": "t\n" }, "init");
  git(f.work, "checkout", "-q", "-b", "b1");
  const k1 = f.commit({ "src/app.ts": lines([...BASE, ...FEAT]) }, "feat: things");
  const k2 = f.commit({ "src/app.ts": lines([...BASE, ...FEAT.map((l) => (l === "bug c" ? "fixed c" : l))]) }, "Pre-landing review fix: guard c");
  git(f.work, "update-ref", "refs/pull/1/head", k2);
  git(f.work, "checkout", "-q", "main");
  const s1 = f.squash(k2, c0, "feat: things (#1)");
  const after1 = [...BASE, ...FEAT.map((l) => (l === "bug c" ? "fixed c" : l))];
  const step = (n: number, from: string, edit: (xs: string[]) => string[], title: string, extra: Record<string, string> = {}) => {
    git(f.work, "checkout", "-q", "-b", "b" + n, from);
    const cur = readFileSync(join(f.work, "src/app.ts"), "utf8").trimEnd().split("\n");
    const k = f.commit({ "src/app.ts": lines(edit(cur)), ...extra }, title);
    git(f.work, "update-ref", "refs/pull/" + n + "/head", k);
    git(f.work, "checkout", "-q", "main");
    return { k, s: f.squash(k, from, title + " (#" + n + ")") };
  };
  const p2 = step(2, s1, (xs) => xs.map((l) => (l === "feat b" ? "good b" : l)), "fix: correct feat b");
  const p3 = step(3, p2.s, (xs) => xs.map((l) => (l === "good b" ? "tidy b" : l)), "refactor: tidy b");
  const p4 = step(4, p3.s, (xs) => xs.map((l) => (l === "fixed c" ? "renamed c" : l)), "chore: rename c");
  const p5 = step(5, p4.s, (xs) => xs, "fix: flaky test", { "test/app.test.ts": "t2\n" });
  const clones = f.clone();
  const prs = [
    pr(1, "feat: things", "2026-10-20T12:00:00Z", s1, k2, "## Pre-Landing Review\n\nPass 1 found a guard gap, fixed in " + k2.slice(0, 7) + ".\n\n## Tests\napp.ts is covered.\n"),
    pr(2, "fix: correct feat b", "2026-10-21T12:00:00Z", p2.s, p2.k),
    pr(3, "refactor: tidy b", "2026-10-22T12:00:00Z", p3.s, p3.k),
    pr(4, "chore: rename c", "2026-10-23T12:00:00Z", p4.s, p4.k),
    pr(5, "fix: flaky test", "2026-10-24T12:00:00Z", p5.s, p5.k),
  ];
  const commit = (sha: string, parent: string, message: string) => ({ sha, parents: [{ sha: parent }], commit: { message, author: { name: "t" } }, author: { login: "dev1" } });
  const api = fakeApi({
    [R]: { visibility: "public", private: false, default_branch: "main" },
    [R + "/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=1"]: [...prs].reverse(),
    ...Object.fromEntries(prs.map((p) => [R + "/pulls/" + p.number, p])),
    ...Object.fromEntries(prs.map((p) => [R + "/commits/" + p.merge_commit_sha + "/pulls", [p]])),
    [R + "/commits/" + c0 + "/pulls"]: [],
    [R + "/pulls/1/commits?per_page=100&page=1"]: [commit(k1, c0, "feat: things"), commit(k2, k1, "Pre-landing review fix: guard c")],
    ...Object.fromEntries([p2, p3, p4, p5].map((p, i) => [R + "/pulls/" + (i + 2) + "/commits?per_page=100&page=1", [commit(p.k, "x", "one")]])),
  });
  return { clones, api, c0, k1, k2, s1, p2, p3, p4, p5 };
}

// The squash-merged repo and its mine are built once for the tests that only read them; each gets its own copy of the result.
let squashMined: Promise<{ r: ReturnType<typeof squashRepo>; mined: Mined }> | undefined;
async function minedSquashRepo() {
  squashMined ??= (async () => {
    const r = squashRepo();
    return { r, mined: await mine({ clones: r.clones, repos: ["o/r"], api: r.api, until: "2026-10-29T00:00:00Z", catalog: catalogDir(), scope }) };
  })();
  const { r, mined } = await squashMined;
  return { r, mined: structuredClone(mined) };
}

describe("scripts/mine-review-cases.ts", () => {
  test("the committed catalog regenerates byte for byte from mined.json and hand.json, and every case validates with an audit", () => {
    const run = spawnSync("bun", ["scripts/mine-review-cases.ts", "build", "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const { cases, problems } = loadCatalog(join(ROOT, "lanes/review-replay/catalog/public"));
    expect(problems).toEqual([]);
    for (const c of cases) expect([c.id, c.visibility, c.answer_key_audit?.verdict]).toEqual([c.id, "public", "confirmed"]);
  });

  test("parseDiff reads -U0 hunks, renames and new files, and never takes a removed '-- ' line for a header", () => {
    const d = parseDiff([
      "diff --git a/x.ts b/x.ts", "index 1..2 100644", "--- a/x.ts", "+++ b/x.ts", "@@ -3 +3 @@", "--- a comment", "+-- b comment", "@@ -7,0 +8,2 @@", "+n1", "+n2",
      "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts", "--- a/old.ts", "+++ b/new.ts", "@@ -1,2 +1 @@", "-a", "-b", "+c",
      "diff --git a/n.ts b/n.ts", "new file mode 100644", "--- /dev/null", "+++ b/n.ts", "@@ -0,0 +1 @@", "+x",
    ].join("\n"));
    expect(d.map((f) => [f.oldPath, f.newPath])).toEqual([["x.ts", "x.ts"], ["old.ts", "new.ts"], [null, "n.ts"]]);
    expect(d[0]!.hunks).toEqual([{ oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 }, { oldStart: 7, oldCount: 0, newStart: 8, newCount: 2 }]);
  });

  test("mapLine moves lines across insertions, deletions and rewrites, and drops a rewritten line", () => {
    const hunks = [{ oldStart: 3, oldCount: 1, newStart: 3, newCount: 2 }, { oldStart: 7, oldCount: 0, newStart: 9, newCount: 2 }, { oldStart: 10, oldCount: 2, newStart: 12, newCount: 0 }];
    expect([1, 2, 3, 4, 7, 8, 9, 10, 12].map((l) => mapLine(hunks, l, "old"))).toEqual([1, 2, null, 5, 8, 11, 12, null, 13]);
    expect([3, 4, 5, 9, 10, 11, 12, 14].map((l) => mapLine(hunks, l, "new"))).toEqual([null, null, 4, null, null, 8, 9, 13]);
  });

  test("blame ranges cover rewritten lines and an insertion's neighbours, clamped to the file; decoy hits count only rewrites", () => {
    const hunks = [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 }, { oldStart: 4, oldCount: 2, newStart: 5, newCount: 1 }, { oldStart: 9, oldCount: 0, newStart: 10, newCount: 3 }];
    expect(blameRanges(hunks, 9)).toEqual([[1, 1], [4, 5], [9, 9]]);
    expect(rewrittenRanges(hunks)).toEqual([[4, 5]]);
  });

  test("parseBlame reads --line-porcelain", () => {
    const sha = "a".repeat(40);
    const b = parseBlame([sha + " 3 7 2", "author t", "filename src/x.ts", "\tline one", sha + " 4 8", "author t", "filename src/x.ts", "\tline two"].join("\n"));
    expect(b).toEqual([{ sha, orig: 3, final: 7, path: "src/x.ts", text: "line one" }, { sha, orig: 4, final: 8, path: "src/x.ts", text: "line two" }]);
  });

  test("the rule patterns: fix titles, source files, named issues and the review section", () => {
    expect(["fix: a", "v0.60.1.0 fix(sync): b", "Hotfix the queue", "fixes #12", "bugfix: x"].every(isFixTitle)).toBe(true);
    expect(["prefix the names", "fixture update", "Revert \"fix: a\"", "v1.2.3.0 revert fix(x)", "feat: y"].some(isFixTitle)).toBe(false);
    expect([["src/a.ts", ""], ["review/SKILL.md.tmpl", ""], ["bin/gstack-x", ""]].every(([p, h]) => canHoldDefect(p!, h!))).toBe(true);
    expect([["test/a.ts", ""], ["src/a.test.ts", ""], ["README.md", ""], ["CHANGELOG.md", ""], ["bun.lock", ""], ["SKILL.md", ""], ["gen.ts", "// AUTO-GENERATED"]].some(([p, h]) => canHoldDefect(p!, h!))).toBe(false);
    expect(namedIssues("fix(x): y (#7959)", "Fixes #12, closes: #13 and see #14")).toEqual([12, 13, 7959]);
    const body = "intro\n## Pre-Landing Review\n\nPass 1: 2 blocking findings, both fixed in 109be19 (lib/a.ts:292 never saw it). Pass 2: clean.\n## Tests\nlib/a.ts tests";
    expect(reviewSection(body)).toStartWith("## Pre-Landing Review");
    expect(reviewSection(body)).not.toContain("## Tests");
    expect(mentions(reviewSection(body), ["109be19"])).toEqual(["Pass 1: 2 blocking findings, both fixed in 109be19 (lib/a.ts:292 never saw it)."]);
    expect(reviewSection("no receipt")).toBe("");
  });

  test("mine finds an escaped and a review-caught case in a squash-merged repo, with decoy hits from every later commit", async () => {
    const { r, mined } = await minedSquashRepo();
    expect(mined.candidates.map((c) => c.candidate)).toEqual(["o/r#1@" + r.k2.slice(0, 12), "o/r#2"]);
    const [caught, escaped] = mined.candidates as [Mined["candidates"][0], Mined["candidates"][0]];
    expect([escaped.kind, escaped.pr, escaped.reviewed_head, escaped.merge_base, escaped.file, escaped.lines, escaped.fix.commit]).toEqual(["escaped", 1, r.k2, r.c0, "src/app.ts", [12], r.p2.s]);
    expect(escaped.decoy.hits.map((h) => [h.commit, h.pr, h.lines])).toEqual([[r.p3.s, 3, [12]]]);
    expect(escaped.history.default).toEqual({ by: "gstack Pre-Landing Review in #1's PR body", rated: "not raised: the review section does not name app.ts" });
    expect([caught.kind, caught.reviewed_head, caught.merge_base, caught.lines, caught.fix.commit, caught.decoy.from]).toEqual(["review-caught", r.k1, r.c0, [13], r.k2, r.k1]);
    expect(caught.decoy.hits.map((h) => [h.commit, h.pr, h.lines])).toEqual([[r.p4.s, 4, [13]]]);
    expect(caught.history.excerpt).toEqual(["Pass 1 found a guard gap, fixed in " + r.k2.slice(0, 7) + "."]);
    expect(caught.roles).toEqual([{ role: "specialist", checklist: "state-machines" }, { role: "red-team" }]);
    expect(caught.shelf).toEqual({ first_appeared: "2026-10-20", source: "GitHub API: o/r#1 (the fix PR) created_at 2026-10-20T08:00:00Z" });
    expect(mined.drops.map((d) => [d.candidate, d.code])).toEqual([["o/r#5", "no-source-file"]]);
    expect(mined.run.repos[0]).toMatchObject({ repo: "o/r", visibility: "public", merged_prs: 5, fix_prs: 2, review_fix_commits: 1 });
    expect(r.api.seen.filter((p) => p.endsWith(" fresh"))).toEqual(["repos/o/r fresh", "repos/o/r/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=1 fresh"]);
  });

  test("mine follows a merge-commit repo's blame through the branch commit to its PR", async () => {
    const f = new Fixture("m");
    const c0 = f.commit({ "src/app.ts": lines(BASE) }, "init");
    const merge = (n: number, from: string, edit: (xs: string[]) => string[], title: string) => {
      git(f.work, "checkout", "-q", "-b", "m" + n, from);
      const cur = readFileSync(join(f.work, "src/app.ts"), "utf8").trimEnd().split("\n");
      const k = f.commit({ "src/app.ts": lines(edit(cur)) }, title);
      git(f.work, "checkout", "-q", "main");
      git(f.work, "merge", "-q", "--no-ff", "-m", "Merge pull request #" + n + " from o/m" + n, "m" + n);
      return { k, m: git(f.work, "rev-parse", "HEAD") };
    };
    const p1 = merge(1, c0, (xs) => [...xs, ...FEAT], "feat: things");
    const p2 = merge(2, p1.m, (xs) => xs.map((l) => (l === "feat b" ? "good b" : l)), "fix: b");
    const p3 = merge(3, p2.m, (xs) => xs.map((l) => (l === "good b" ? "tidy b" : l)), "refactor: b");
    const clones = f.clone();
    const prs = [pr(1, "feat: things", "2026-10-20T12:00:00Z", p1.m, p1.k), pr(2, "fix: b", "2026-10-21T12:00:00Z", p2.m, p2.k), pr(3, "refactor: b", "2026-10-22T12:00:00Z", p3.m, p3.k)];
    const one = (p: { k: string }, parent: string) => [{ sha: p.k, parents: [{ sha: parent }], commit: { message: "x", author: { name: "t" } }, author: null }];
    const api = fakeApi({
      "repos/o/m": { visibility: "public", private: false, default_branch: "main" },
      "repos/o/m/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=1": prs,
      ...Object.fromEntries(prs.map((p) => ["repos/o/m/pulls/" + p.number, p])),
      ...Object.fromEntries(prs.map((p) => ["repos/o/m/commits/" + p.merge_commit_sha + "/pulls", [p]])),
      "repos/o/m/pulls/1/commits?per_page=100&page=1": one(p1, c0), "repos/o/m/pulls/2/commits?per_page=100&page=1": one(p2, p1.m), "repos/o/m/pulls/3/commits?per_page=100&page=1": one(p3, p2.m),
    });
    const mined = await mine({ clones, repos: ["o/m"], api, until: "2026-10-29T00:00:00Z", catalog: catalogDir(), scope });
    expect(mined.candidates.map((c) => [c.candidate, c.pr, c.reviewed_head, c.merge_base, c.lines, c.introduced_by])).toEqual([["o/m#2", 1, p1.k, c0, [12], [p1.k]]]);
    expect(mined.candidates[0]!.decoy.hits.map((h) => [h.commit, h.pr])).toEqual([[p3.m, 3]]);
  });

  test("the API cache serves repeat reads, but a fresh read always asks GitHub", async () => {
    let n = 0;
    const api = ghApi(mkdtempSync(join(tmp, "cache-")), () => ({ out: "HTTP/2.0 200 OK\r\nX-Ratelimit-Remaining: 5000\r\n\r\n{\"n\":" + ++n + "}", stderr: "" }));
    expect([await api.get("repos/o/r/pulls/1"), await api.get("repos/o/r/pulls/1")]).toEqual([{ n: 1 }, { n: 1 }]);
    expect([await api.get("repos/o/r", { fresh: true }), await api.get("repos/o/r", { fresh: true })]).toEqual([{ n: 2 }, { n: 3 }]);
    expect(api.calls()).toBe(3);
  });

  test("the decoy search follows a rename on the PR branch into the squash commit", async () => {
    const f = new Fixture("n");
    const c0 = f.commit({ "src/app.ts": lines(BASE) }, "init");
    git(f.work, "checkout", "-q", "-b", "b1");
    const k1 = f.commit({ "src/app.ts": lines([...BASE, ...FEAT]) }, "feat: things");
    const k2 = f.commit({ "src/app.ts": lines([...BASE, ...FEAT.map((l) => (l === "bug c" ? "fixed c" : l))]) }, "Pre-landing review fix: guard c");
    git(f.work, "mv", "src/app.ts", "src/main.ts");
    git(f.work, "commit", "-q", "-m", "move app");
    const k3 = git(f.work, "rev-parse", "HEAD");
    git(f.work, "update-ref", "refs/pull/1/head", k3);
    git(f.work, "checkout", "-q", "main");
    const s1 = f.squash(k3, c0, "feat: things (#1)");
    git(f.work, "checkout", "-q", "-b", "b2");
    const k4 = f.commit({ "src/main.ts": lines([...BASE, ...FEAT.map((l) => (l === "bug c" ? "renamed c" : l))]) }, "chore: c");
    git(f.work, "checkout", "-q", "main");
    const s2 = f.squash(k4, s1, "chore: c (#2)");
    const clones = f.clone();
    const prs = [pr(1, "feat: things", "2026-10-20T12:00:00Z", s1, k3), pr(2, "chore: c", "2026-10-21T12:00:00Z", s2, k4)];
    const commit = (sha: string, parent: string, message: string) => ({ sha, parents: [{ sha: parent }], commit: { message, author: { name: "t" } }, author: null });
    const api = fakeApi({
      "repos/o/n": { visibility: "public", private: false, default_branch: "main" },
      "repos/o/n/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=1": prs,
      ...Object.fromEntries(prs.map((p) => ["repos/o/n/pulls/" + p.number, p])),
      ...Object.fromEntries(prs.map((p) => ["repos/o/n/commits/" + p.merge_commit_sha + "/pulls", [p]])),
      "repos/o/n/pulls/1/commits?per_page=100&page=1": [commit(k1, c0, "feat: things"), commit(k2, k1, "Pre-landing review fix: guard c"), commit(k3, k2, "move app")],
      "repos/o/n/pulls/2/commits?per_page=100&page=1": [commit(k4, s1, "chore: c")],
    });
    const mined = await mine({ clones, repos: ["o/n"], api, until: "2026-10-29T00:00:00Z", catalog: catalogDir(), scope });
    expect(mined.candidates.map((c) => c.candidate)).toEqual(["o/n#1@" + k2.slice(0, 12)]);
    const d = mined.candidates[0]!.decoy;
    expect([d.files, d.hits.map((h) => [h.commit, h.pr, h.file, h.lines]), d.unresolved]).toEqual([["src/app.ts", "src/main.ts"], [[s2, 2, "src/main.ts", [13]]], []]);
  });

  test("build never removes a seed, even when a partial mine did not audit it", async () => {
    const { mined } = await minedSquashRepo();
    const catalog = catalogDir();
    const seed = "gstack-3516-ship-hook-actor-negation-guard.json";
    writeFileSync(join(catalog, seed), readFileSync(join(ROOT, "lanes/review-replay/catalog/public", seed)));
    mkdirSync(join(catalog, "mining"), { recursive: true });
    writeFileSync(join(catalog, "mining", "mined.json"), JSON.stringify(mined));
    const run = spawnSync("bun", ["scripts/mine-review-cases.ts", "build", "--catalog", catalog], { cwd: ROOT, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(readFileSync(join(catalog, seed), "utf8")).toBe(readFileSync(join(ROOT, "lanes/review-replay/catalog/public", seed), "utf8"));
  });

  test("a repo that is not public yields nothing", async () => {
    const api = fakeApi({ "repos/o/p": { visibility: "private", private: true, default_branch: "main" } });
    const mined = await mine({ clones: tmp, repos: ["o/p"], api, until: "2026-10-29T00:00:00Z", catalog: catalogDir(), scope });
    expect(mined.candidates).toEqual([]);
    expect(mined.drops.map((d) => d.code)).toEqual(["repo-not-public"]);
    expect(api.seen).toEqual(["repos/o/p fresh"]);
  });

  test("build writes valid cases in audit order, one per PR, drops a case whose decoy holds a defect, and stops at the target", async () => {
    const { mined } = await minedSquashRepo();
    const [caught, escaped] = mined.candidates as [Mined["candidates"][0], Mined["candidates"][0]];
    const confirmed = (extra: object) => ({ at: "2026-10-30", verdict: "confirmed" as const, notes: "read the fix", summary: "b is wrong", severity: { deserved: null, basis: "the evidence does not settle it" }, ...extra });
    const hand: Hand = {
      auditor: "test auditor",
      audits: {
        [escaped.candidate]: confirmed({ decoys: { "0": { verdict: "clean", later_fix: null, reason: "a rename" } }, needs_human_check: [{ item: "severity", reason: "no failing test named" }] }),
        [caught.candidate]: confirmed({ in_history: [{ by: "pass 1", rated: "blocking" }], decoys: { "0": { verdict: "holds-defect", later_fix: { ref: "o/r#4", fixed: "c" }, reason: "a later fix" } } }),
      },
    };
    const catalog = catalogDir();
    const b = build(catalog, mined, hand);
    expect(b.problems).toEqual([]);
    const order = auditOrder(mined.candidates).map((c) => c.candidate);
    const drops = JSON.parse(b.files.get(join(catalog, "mining", "drops.json"))!).map((d: { candidate: string; code: string }) => [d.candidate, d.code]);
    expect(drops).toContainEqual([caught.candidate, order[0] === caught.candidate ? "decoy-holds-defect" : "one-case-per-pr"]);
    for (const [p, t] of b.files) { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, t); }
    const loaded = loadCatalog(catalog);
    expect(loaded.problems).toEqual([]);
    expect(loaded.cases.map((c) => c.id)).toEqual([caseId(escaped)]);
    const c = loaded.cases[0]!;
    expect(c.decoys[0]!.audit).toMatchObject({ verdict: "clean", later_fix: null, by: "test auditor" });
    expect(c.answer_key_audit!.notes).toBe("read the fix Needs human check: severity (no failing test named).");
    expect(c.severity.in_history).toEqual([escaped.history.default!]);
    const record = JSON.parse(readFileSync(join(catalog, "audit", c.id + ".json"), "utf8"));
    expect(record.needs_human_check).toEqual([{ item: "severity", reason: "no failing test named" }]);

    const incomplete: Hand = { auditor: "t", audits: { [escaped.candidate]: confirmed({}) } };
    expect(build(catalogDir(), mined, incomplete).problems.join("\n")).toContain("decoys[\"0\"] needs a hand verdict");
    const none = build(catalogDir(), mined, hand, 0);
    expect(none.confirmed).toBe(0);
    expect(JSON.parse(none.files.get([...none.files.keys()].find((k) => k.endsWith("drops.json"))!)!).filter((d: { code: string }) => d.code === "not-audited")).toHaveLength(2);

    const check = (dir: string) => spawnSync("bun", ["scripts/mine-review-cases.ts", "build", "--catalog", dir, "--check"], { cwd: ROOT, encoding: "utf8" });
    mkdirSync(join(catalog, "mining"), { recursive: true });
    writeFileSync(join(catalog, "mining", "mined.json"), JSON.stringify(mined));
    writeFileSync(join(catalog, "mining", "hand.json"), JSON.stringify(hand));
    expect(check(catalog).status).toBe(0);
    writeFileSync(join(catalog, c.id + ".json"), "{}\n");
    const stale = check(catalog);
    expect(stale.status).toBe(2);
    expect(stale.stderr).toStartWith("E_MINE_STALE ");
  });
});
