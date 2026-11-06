// Copyright (c) 2026 Garry Tan. MIT License.
// tbv check: the handoff check, the leak check and the org-rules scan over histories, keys and a gstack checkout
// (prereg section 11 items 4 and 7, amendment 1 section 2 rule 7 and item 15). Synthetic histories, keys and a
// throwaway git repository only.
import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addedLines, namesOf, repoNames, treeText } from "../../lanes/tbv/check.ts";
import { main } from "../../lanes/tbv/cli.ts";
import { historySha256 } from "../../lanes/tbv/history/events.ts";
import type { History, HistoryEvent, Key, Source } from "../../lanes/tbv/types.ts";

const ROOT = mkdtempSync(join(tmpdir(), "tbv-check-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
let n = 0;

function hist(source: Source, task: string, results: string[], files: string[] = []): History {
  const events: HistoryEvent[] = [{ n: 1, kind: "user-text", text: "Fix the failing work." }];
  results.forEach((out, i) => {
    const id = "toolu_" + i;
    events.push({ n: events.length + 1, kind: "tool-use", id, name: "Bash", input: { command: "pytest -q" } });
    events.push({ n: events.length + 1, kind: "tool-result", tool_use_id: id, content: out, is_error: false });
  });
  return { schema: "tbv-history.v1", source, task, cluster: task, family: source === "A" ? "investigate" : "ship", events, sha256: historySha256(events), side: { files, resolved: false, patch: null } };
}
function key(task: string, digest: string, list: Key["list"] = null): Key {
  return { schema: "tbv-key.v1", task, history_sha256: "a".repeat(64), facts: [{ id: "F1", category: "broken test", statement: "One lexer test fails.", events: [3], critical: true }], traps: [], list, digest, audits: [], dropped: [] };
}
function dir(items: Array<History | Key>): string {
  const d = join(ROOT, "d" + ++n);
  mkdirSync(d);
  items.forEach((x, i) => writeFileSync(join(d, i + ".json"), JSON.stringify(x)));
  return d;
}
function file(text: string): string {
  const f = join(ROOT, "f" + ++n);
  writeFileSync(f, text);
  return f;
}
async function tbv(...argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const HELD = hist("A", "acme__parserlib-12", ["tests/test_lexer.py::test_unicode_escape FAILED\ntests/test_lexer.py::test_plain PASSED"], ["src/lexer.py", "README.md"]);
const HELD_KEY = key("acme__parserlib-12", "The lexer drops every escaped quote inside a raw string literal today.");
const DEV = hist("A", "demo__toolkit-3", ["tests/test_cli.py::test_help PASSED\nREADME.md\nsetup.cfg", "Always state what you ran and what you did not run before you report."], ["README.md"]);
const HELD_B = hist("B", "pr-901", ["== check unit: FAILURE"]);
const dev = dir([DEV]), held = dir([HELD]), heldKeys = dir([HELD_KEY]);

test("repoNames reads owner and repository from a SWE-rebench instance id, and nothing from other ids", () => {
  expect(repoNames("acme__parserlib-12")).toEqual(["acme/parserlib", "parserlib", "acme"]);
  expect(repoNames("pr-901")).toEqual([]);
});

test("namesOf gives the task id, the repository, the changed files and the extractor's test names", () => {
  const names = namesOf(HELD, HELD_KEY);
  for (const x of ["acme__parserlib-12", "acme/parserlib", "parserlib", "src/lexer.py", "README.md", "tests/test_lexer.py::test_unicode_escape", "test_unicode_escape"]) expect(names).toContain(x);
});

test("handoff: a name a dev history holds whole is shared and clears", async () => {
  const r = await tbv("check", "handoff", "--artifact", file("Read README.md first, then run the checks."), "--dev", dev, "--held", held, "--held-keys", heldKeys);
  expect(r.out).toContain("held-out source A only");
  expect(r.out).toContain("Verdict: CLEAR");
  expect(r.code).toBe(0);
});

test("handoff: a held-out test name, the repository, an 8-word run of a key and an extra name each block", async () => {
  const names = file(JSON.stringify(["Zorblax"]));
  const cases: Array<[string, string]> = [
    ["Watch test_unicode_escape when you change escapes.", 'identifier "test_unicode_escape"'],
    ["The parserlib work is the hard one.", 'identifier "parserlib"'],
    ["Note that it drops every escaped quote inside a raw string literal.", "8-word run"],
    ["The zorblax module is next.", 'identifier "Zorblax"'],
  ];
  for (const [artifact, hit] of cases) {
    const r = await tbv("check", "handoff", "--artifact", file(artifact), "--dev", dev, "--held", held, "--held-keys", heldKeys, "--names", names);
    expect(r.out).toContain(hit);
    expect(r.out).toContain("Verdict: BLOCK");
    expect(r.code).toBe(1);
  }
});

test("handoff: --held takes source A only; held-out source B comes in through --held-b", async () => {
  const a = file("Nothing held here.");
  const refused = await tbv("check", "handoff", "--artifact", a, "--dev", dev, "--held", dir([HELD, HELD_B]));
  expect(refused.code).toBe(2);
  expect(refused.err).toMatch(/^E_TBV_INPUT .*source B history where source A is required/);
  const both = await tbv("check", "handoff", "--artifact", file("See pr-901 next."), "--dev", dev, "--held", held, "--held-b", dir([HELD_B]));
  expect(both.out).toContain("held-out source A and B");
  expect(both.out).toContain('identifier "pr-901"');
  expect(both.code).toBe(1);
  const wrong = await tbv("check", "handoff", "--artifact", a, "--dev", dev, "--held", held, "--held-b", dir([DEV]));
  expect(wrong.code).toBe(2);
});

test("handoff refuses a file that is not a history and a missing flag", async () => {
  const bad = await tbv("check", "handoff", "--artifact", file("x"), "--dev", dir([HELD_KEY as unknown as History]), "--held", held);
  expect(bad.code).toBe(2);
  expect(bad.err).toMatch(/^E_TBV_INPUT .*not a tbv-history\.v1 file/);
  const missing = await tbv("check", "handoff", "--artifact", file("x"), "--dev", dev);
  expect(missing.err).toMatch(/^E_TBV_INPUT .*--held is required/);
  expect((await tbv("check", "nope")).code).toBe(2);
});

function gstack(c: Record<string, string>, p: Record<string, string>) {
  const d = join(ROOT, "g" + ++n);
  mkdirSync(d);
  const g = (...args: string[]) => execFileSync("git", ["-C", d, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).trim();
  g("init", "-q");
  const commit = (files: Record<string, string>) => {
    for (const [f, text] of Object.entries(files)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), text); }
    g("add", "-A");
    g("commit", "-q", "-m", "x");
    return g("rev-parse", "HEAD");
  };
  const C = commit(c);
  return { d, C, P: commit(p) };
}
const AT_C = { "skills/a.md": "Read README.md before you start.\nAlways state what you ran and what you did not run before you report.\n", "bin/blob": "\u0000binary" };
const WORDING = "Open every report with a summary that carries the real detail the reader needs.";

test("treeText joins gstack's text files at C and leaves binary blobs out; addedLines reads C..P's added lines", () => {
  const g = gstack(AT_C, { "skills/a.md": AT_C["skills/a.md"] + "Keep the report short.\n" });
  const text = treeText(g.d, g.C);
  expect(text).toContain("Read README.md before you start.");
  expect(text).not.toContain("binary");
  expect(addedLines(g.d, g.C, g.P)).toEqual(["Keep the report short."]);
});

test("leak: a held-out test name and a material run not in gstack at C hit; a run and a name gstack holds at C do not", async () => {
  const g = gstack(AT_C, { "skills/b.md": "Name test_unicode_escape when it fails.\nSee README.md.\nAlways state what you ran and what you did not run before you report.\nIt drops every escaped quote inside a raw string literal.\n" });
  const r = await tbv("check", "leak", "--gstack", g.d, "--c", g.C, "--p", g.P, "--wording", file(WORDING), "--dev", dev, "--held", held, "--held-keys", heldKeys);
  expect(r.out).toMatch(/leak: 2 8-word runs shared with task material .*, 1 task names \([1-9]\d* exempt/);
  expect(r.out).toContain('name "test_unicode_escape"');
  expect(r.out).toContain('8-word run "drops every escaped quote inside a raw string"');
  expect(r.out).not.toContain('name "README.md"');
  expect(r.out).toContain("Verdict: HIT (to the Captain)");
  expect(r.code).toBe(1);
});

test("leak: a clean diff over clean histories exits 0; the org-rules scan alone turns it into a hit", async () => {
  const g = gstack(AT_C, { "skills/b.md": "Keep the report short.\n" });
  const clean = await tbv("check", "leak", "--gstack", g.d, "--c", g.C, "--p", g.P, "--wording", file(WORDING), "--dev", dev, "--held", held);
  expect(clean.out).toContain("Verdict: CLEAN");
  expect(clean.out).toContain("rules: 2 histories scanned");
  expect(clean.code).toBe(0);
  const told = hist("A", "demo__told-1", ["Start with a summary that carries the real detail the reader needs, always."]);
  const hit = await tbv("check", "leak", "--gstack", g.d, "--c", g.C, "--p", g.P, "--wording", file(WORDING), "--dev", dir([DEV, told]), "--held", held);
  expect(hit.out).toMatch(/rules: 3 histories scanned .*; 1 hold a run/);
  expect(hit.out).toContain("history source A sha256 " + told.sha256.slice(0, 12));
  expect(hit.out).not.toContain("demo__told-1");
  expect(hit.code).toBe(1);
});

test("leak refuses a ref that is not a commit sha and a commit the checkout lacks", async () => {
  const g = gstack(AT_C, { "skills/b.md": "x\n" });
  const base = ["check", "leak", "--gstack", g.d, "--wording", file(WORDING), "--dev", dev, "--held", held];
  expect((await tbv(...base, "--c", "HEAD~1", "--p", g.P)).err).toMatch(/^E_TBV_INPUT .*--c takes a commit sha/m);
  expect((await tbv(...base, "--c", "1234567", "--p", g.P)).err).toMatch(/^E_TBV_INPUT .*git rev-parse/m);
});

test("check rules scans every history for the org rules' wording and refuses a wording under 8 words", async () => {
  const told = hist("B", "pr-77", ["Open every report with a summary that carries the real detail."]);
  const r = await tbv("check", "rules", "--wording", file(WORDING), "--histories", dir([DEV, told]));
  expect(r.out).toContain("1 hold a run");
  expect(r.code).toBe(1);
  expect((await tbv("check", "rules", "--wording", file(WORDING), "--histories", dev)).code).toBe(0);
  expect((await tbv("check", "rules", "--wording", file("too short to scan"), "--histories", dev)).err).toMatch(/^E_TBV_INPUT .*fewer than 8 words/m);
});

test("leak: an added line that starts with \"++ \" is an added line; the file header's +++ line is not", () => {
  const g = gstack({ "skills/a.md": "keep\n" }, { "skills/a.md": "keep\n++ leaked-name here\nplain added\n" });
  expect(addedLines(g.d, g.C, g.P)).toEqual(["++ leaked-name here", "plain added"]);
});

test("handoff and leak refuse an empty held-out, --held-b or dev directory (E_TBV_INPUT); a filled one still runs", async () => {
  const a = file("Nothing held here.");
  const none = await tbv("check", "handoff", "--artifact", a, "--dev", dev, "--held", dir([]));
  expect(none.code).toBe(2);
  expect(none.err).toMatch(/^E_TBV_INPUT .*no held-out histories/m);
  const noB = await tbv("check", "handoff", "--artifact", a, "--dev", dev, "--held", held, "--held-b", dir([]));
  expect(noB.code).toBe(2);
  expect(noB.err).toMatch(/^E_TBV_INPUT .*--held-b/m);
  const filled = await tbv("check", "handoff", "--artifact", a, "--dev", dev, "--held", held);
  expect(filled.code).toBe(0);
  expect(filled.out).toContain("1 held-out histories");
  const g = gstack(AT_C, { "skills/b.md": "Keep the report short.\n" });
  const noDev = await tbv("check", "leak", "--gstack", g.d, "--c", g.C, "--p", g.P, "--wording", file(WORDING), "--dev", dir([]), "--held", held);
  expect(noDev.code).toBe(2);
  expect(noDev.err).toMatch(/^E_TBV_INPUT .*no dev histories/m);
  const noHeld = await tbv("check", "leak", "--gstack", g.d, "--c", g.C, "--p", g.P, "--wording", file(WORDING), "--dev", dev, "--held", dir([]));
  expect(noHeld.code).toBe(2);
  expect((await tbv("check", "leak", "--gstack", g.d, "--c", g.C, "--p", g.P, "--wording", file(WORDING), "--dev", dev, "--held", held)).code).toBe(0);
});
