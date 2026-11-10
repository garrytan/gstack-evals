// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SessionImage } from "../../lanes/outcome-skills/statemachines/image.ts";
import type { SmUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { CONTAIN_RECORD, containHost, containInputs, containUnit, leafName, readContain, upstreamAfter } from "../../lanes/outcome-skills/pfchecks/containment.ts";

const g = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" }).stdout.trim();
const put = (d: string, files: Record<string, string>) => { for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), t); } };
const LINE = "    return hiddenFixValue(alpha, beta, gamma) + 1;";
const NAME = "testHiddenFeatureName";
const BASE = { "a.txt": "base line one\nbase line two\n", ".gitignore": "build/\n" };

/** A scan root holding the repository at testbed, with one base commit; returns root, repo and the base sha. */
function fixture(base: Record<string, string> = BASE) {
  const root = mkdtempSync(join(tmpdir(), "pf-contain-"));
  const repo = join(root, "testbed");
  mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  put(repo, base);
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "base");
  return { root, repo, base: g(repo, "rev-parse", "HEAD") };
}
const FIXED = "base line one\n" + LINE + "\n";
const FIX = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n base line one\n-base line two\n+" + LINE + "\n";
const inputs = (upstream = "0".repeat(40), after: string[] = [], fix = FIX) => ({ lines: LINE + "\n", names: NAME + "\n", upstream: upstream + "\n", after: after.map((a) => a + "\n").join(""), "fix.patch": fix, "test.patch": "" });
const later = (repo: string) => { put(repo, { "a.txt": FIXED }); g(repo, "commit", "-q", "-am", "fix"); return g(repo, "rev-parse", "HEAD"); };
/** A repository outside the scan root with one commit of files, bare-cloned to dest inside it; returns the commit. */
const mirror = (files: Record<string, string>, dest: string) => {
  const src = mkdtempSync(join(tmpdir(), "pf-contain-src-"));
  g(src, "init", "-q", "-b", "main");
  put(src, files);
  g(src, "add", "-A");
  g(src, "commit", "-q", "-m", "upstream");
  const id = g(src, "rev-parse", "HEAD");
  spawnSync("git", ["clone", "-q", "--bare", src, dest]);
  rmSync(src, { recursive: true, force: true });
  return id;
};

test("a clean one-commit tree passes and counts its needles", () => {
  const f = fixture();
  const r = containHost(f.repo, inputs(), f.root);
  expect(r.ok).toBe(true);
  expect(r.summary).toMatchObject({ base: f.base, refs: "1", commits: "1", bad_refs: "0", bad_commits: "0", fix_blobs: "1", repo_fix_blobs: "0", other_gitdirs: "0", leaked_after: "0", leaked_fix: "0", lines: "1", names: "1", hits: "0" });
  rmSync(f.root, { recursive: true, force: true });
});

test("a tag on a later commit fails as a bad ref and a bad commit, and so do ORIG_HEAD and the reflog", () => {
  const f = fixture();
  const fix = later(f.repo);
  g(f.repo, "tag", "v2");
  g(f.repo, "reset", "-q", "--hard", f.base);
  const r = containHost(f.repo, inputs(), f.root);
  expect(r.ok).toBe(false);
  expect(r.findings).toContain("bad_ref refs/tags/v2");
  expect(r.findings).toContain("bad_commit " + fix);
  expect(r.findings).toContain("bad_ref ORIG_HEAD " + fix);
  expect(r.findings).toContain("bad_ref reflog " + fix);
  rmSync(f.root, { recursive: true, force: true });
});

test("a later commit object that no ref reaches still fails", () => {
  const f = fixture();
  const fix = later(f.repo);
  g(f.repo, "update-ref", "refs/heads/main", f.base);
  g(f.repo, "reset", "-q", "--hard");
  rmSync(join(f.repo, ".git/logs"), { recursive: true, force: true });
  rmSync(join(f.repo, ".git/ORIG_HEAD"), { force: true });
  const r = containHost(f.repo, inputs(), f.root);
  expect(r.ok).toBe(false);
  expect(r.summary).toMatchObject({ bad_refs: "0", commits: "2", bad_commits: "1" });
  expect(r.findings).toContain("bad_commit " + fix);
  rmSync(f.root, { recursive: true, force: true });
});

test("alternates, a nested .git, changed tracked files and a clone elsewhere each fail", () => {
  const cases: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ["alternates", (f) => put(f.repo, { ".git/objects/info/alternates": "/elsewhere/objects\n" })],
    ["nested", (f) => { mkdirSync(join(f.repo, "build/vendored"), { recursive: true }); g(join(f.repo, "build/vendored"), "init", "-q"); }],
    ["tracked_changed", (f) => put(f.repo, { "a.txt": "edited\n" })],
    ["clones", (f) => { spawnSync("git", ["clone", "-q", "--bare", f.repo, join(f.root, "opt/copy.git")]); }],
  ];
  for (const [key, make] of cases) {
    const f = fixture();
    make(f);
    const r = containHost(f.repo, inputs(f.base), f.root);
    expect([key, r.ok, r.summary[key]]).toEqual([key, false, "1"]);
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("another git directory holding the fix commit fails, whether it sits outside the repository or nested inside it", () => {
  const f = fixture();
  const fixed = spawnSync("git", ["hash-object", "--stdin"], { input: FIXED, encoding: "utf8" }).stdout.trim();
  mirror({ "a.txt": FIXED }, join(f.root, "opt/mirror.git"));
  const r = containHost(f.repo, inputs(), f.root);
  expect(r.ok).toBe(false);
  expect(r.summary).toMatchObject({ leaked_fix: "1", leaked_after: "0", clones: "0", other_gitdirs: "1", nested: "0", hits: "0" });
  expect(r.findings).toContain("leak fix " + fixed + " " + join(f.root, "opt/mirror.git"));
  expect(r.gitdirs).toEqual([{ path: join(f.root, "opt/mirror.git"), commits: 1 }]);
  rmSync(f.root, { recursive: true, force: true });
  const n = fixture();
  const inner = join(n.repo, "build/upstream");
  mkdirSync(inner, { recursive: true });
  g(inner, "init", "-q", "-b", "main");
  put(inner, { "a.txt": FIXED });
  g(inner, "add", "-A");
  g(inner, "commit", "-q", "-m", "upstream fix");
  const rn = containHost(n.repo, inputs(), n.root);
  expect(rn.ok).toBe(false);
  expect(rn.summary).toMatchObject({ nested: "1", leaked_fix: "1", other_gitdirs: "1" });
  expect(rn.findings).toContain("leak fix " + fixed + " " + join(inner, ".git"));
  rmSync(n.root, { recursive: true, force: true });
});

test("another git directory holding an upstream commit after the base fails, and an unrelated dependency checkout passes with its path and commit count", () => {
  const f = fixture();
  const id = mirror({ "x.txt": "later upstream work\n" }, join(f.root, "srv/later.git"));
  const r = containHost(f.repo, inputs(f.base, [id]), f.root);
  expect(r.ok).toBe(false);
  expect(r.summary).toMatchObject({ after: "1", leaked_after: "1", leaked_fix: "0", clones: "0" });
  expect(r.findings).toContain("leak after " + id + " " + join(f.root, "srv/later.git"));
  const ok = containHost(f.repo, inputs(f.base, ["f".repeat(40)]), f.root);
  expect(ok.ok).toBe(true);
  expect(ok.summary).toMatchObject({ after: "1", leaked_after: "0", leaked_fix: "0", other_gitdirs: "1" });
  expect(ok.gitdirs).toEqual([{ path: join(f.root, "srv/later.git"), commits: 1 }]);
  rmSync(f.root, { recursive: true, force: true });
});

test("a blob of the fixed file in the session repository fails, and a fix patch that does not apply fails closed", () => {
  const f = fixture();
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.repo, input: FIXED, encoding: "utf8" }).stdout.trim();
  const r = containHost(f.repo, inputs(), f.root);
  expect(r.ok).toBe(false);
  expect(r.summary).toMatchObject({ commits: "1", bad_commits: "0", repo_fix_blobs: "1" });
  expect(r.findings).toContain("fix_blob_in_repo " + blob);
  rmSync(f.root, { recursive: true, force: true });
  const h = fixture();
  const bad = containHost(h.repo, inputs("0".repeat(40), [], FIX.replace("-base line two", "-a line the base lacks")), h.root);
  expect(bad.ok).toBe(false);
  expect(bad.summary.fix_blobs).toBe("0");
  expect(bad.findings).toContain("error the fix and test patches do not apply to the base commit");
  rmSync(h.root, { recursive: true, force: true });
});

test("upstreamAfter lists the image repository's commits after the base, every commit when the base is absent, and none with no repository", () => {
  const f = fixture();
  const fix = later(f.repo);
  g(f.repo, "reset", "-q", "--hard", f.base);
  expect(upstreamAfter({ host: f.root }, "testbed", f.base)).toEqual({ source: "after", ids: [fix] });
  expect(upstreamAfter({ host: f.root }, "testbed", "e".repeat(40)).source).toBe("all");
  expect(upstreamAfter({ host: f.root }, "testbed", "e".repeat(40)).ids.sort()).toEqual([f.base, fix].sort());
  expect(upstreamAfter({ host: f.root }, "nothing-here", f.base)).toEqual({ source: "none", ids: [] });
  rmSync(f.root, { recursive: true, force: true });
});

test("a hidden line outside the repository and a hidden name in an ignored file are hits, named by sha", () => {
  const f = fixture();
  put(f.root, { "tmp/leftover.patch": "+x\n" + LINE + "\n" });
  put(f.repo, { "build/classes.txt": "compiled " + NAME + "Case\n" });
  const r = containHost(f.repo, inputs(), f.root);
  expect(r.ok).toBe(false);
  expect(r.summary.hits).toBe("2");
  expect(r.findings.filter((x) => x.startsWith("hit line ")).map((x) => x.split(" ").pop())).toEqual([join(f.root, "tmp/leftover.patch")]);
  expect(r.findings.filter((x) => x.startsWith("hit name ")).map((x) => x.split(" ").pop())).toEqual([join(f.repo, "build/classes.txt")]);
  expect(r.detail).not.toContain(NAME);
  rmSync(f.root, { recursive: true, force: true });
});

test("a candidate the base tree holds is no needle, even inside a longer word", () => {
  const f = fixture({ ...BASE, "t.txt": "void " + NAME + "Longer() {}\n" + LINE + "\n" });
  put(f.root, { "tmp/x.txt": NAME + "\n" + LINE + "\n" });
  const r = containHost(f.repo, inputs(), f.root);
  expect(r.ok).toBe(true);
  expect(r.summary).toMatchObject({ lines: "0", names: "0", hits: "0" });
  rmSync(f.root, { recursive: true, force: true });
});

test("leaf names of the id shapes the pool uses", () => {
  expect(leafName("io.agentscope.core.memory.mem0.Mem0ClientTest::testSearchRequestEmptyResults")).toBe("testSearchRequestEmptyResults");
  expect(leafName("checkout::entry::tests::let_readers_execute_panics_on_directory - should panic")).toBe("let_readers_execute_panics_on_directory");
  expect(leafName("Config Suite :: Duration :: UnmarshalText :: should parse duration with unit")).toBe("should parse duration with unit");
  expect(leafName("org.example.FooTest.testBar(String)[1]")).toBe("testBar");
  expect(leafName("TestServer/handles_empty_body")).toBe("handles_empty_body");
  expect(leafName("should accept 1.2.3 as a version")).toBe("should accept 1.2.3 as a version");
});

test("inputs hold the fix's and the test patch's added lines of 30 code points or more, and names of 12 or more", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-contain-unit-"));
  put(d, { "fix.patch": "+++ b/a.go\n+" + LINE + "\n+short\n", "test.patch": "+++ b/a_test.go\n+func " + NAME + "(t *testing.T) { check(t, 42) }\n" });
  const i = containInputs(d, { base_commit: "a".repeat(40), tests: { f2p: ["pkg::" + NAME, "pkg::short_name"], p2p: [] } });
  expect(String(i.lines).split("\n").filter(Boolean)).toEqual([LINE, "func " + NAME + "(t *testing.T) { check(t, 42) }"]);
  expect(i.names).toBe(NAME + "\n");
  expect(i.upstream).toBe("a".repeat(40) + "\n");
  expect(i.after).toBe("");
  expect(String(i["fix.patch"])).toBe("+++ b/a.go\n+" + LINE + "\n+short\n");
  expect(containInputs(d, { base_commit: "a".repeat(40), tests: { f2p: [], p2p: [] } }, ["b".repeat(40), "c".repeat(40)]).after).toBe("b".repeat(40) + "\n" + "c".repeat(40) + "\n");
  rmSync(d, { recursive: true, force: true });
});

test("a check that did not finish does not pass", () => {
  const sum = "PF_CONTAIN summary commits=1 bad_refs=0 bad_commits=0 alternates=0 gitfile=0 modules=0 nested=0 tracked_changed=0 fix_blobs=1 repo_fix_blobs=0 clones=0 leaked_after=0 leaked_fix=0 hits=0\n";
  expect(readContain(sum).ok).toBe(false);
  expect(readContain(sum + "PF_CONTAIN done\n").ok).toBe(true);
  expect(readContain(sum.replace("fix_blobs=1", "fix_blobs=0") + "PF_CONTAIN done\n").ok).toBe(false);
  expect(readContain(sum.replace("leaked_fix=0", "leaked_fix=1") + "PF_CONTAIN done\n").ok).toBe(false);
  expect(readContain("PF_CONTAIN error no HEAD commit in /x\nPF_CONTAIN done\n").ok).toBe(false);
});

test("the gate before a session reuses a passing record for the same session image tag and runs no check", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-contain-gate-"));
  const prior = { schema: "pf-contain.v1", unit: "u", tag: "gstack-evals-sm-session:abc", ok: true, summary: { commits: "1" }, findings: [], gitdirs: [], detail: "passed earlier" };
  writeFileSync(join(d, CONTAIN_RECORD), JSON.stringify({ schema: "pf-contain.v1", checks: { [prior.tag]: prior } }));
  const u = { id: "u", repo_dir: "/testbed", base_commit: "a".repeat(40), tests: { f2p: [], p2p: [] } } as unknown as SmUnit;
  const image = { tag: prior.tag, runtime_id: "sha256:" + "0".repeat(64), image_id: "sha256:" + "1".repeat(64), head: "b".repeat(40) } as unknown as SessionImage;
  expect(containUnit(d, u, image)).toEqual(prior as never);
  rmSync(d, { recursive: true, force: true });
});
