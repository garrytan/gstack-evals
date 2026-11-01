import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkWiki, gitBaseFiles, loadWiki, parseFrontMatter, renderIndex, resolveBase } from "../scripts/wiki.ts";

const repoRoot = join(import.meta.dir, "..");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

type Fields = Record<string, string | string[]>;

function post(fields: Fields, body = "\n# Post\n\nBody.\n"): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (!Array.isArray(v)) lines.push(k + ": " + v);
    else lines.push(k + ":", ...v.map((item) => "  - " + item));
  }
  return lines.join("\n") + "\n---\n" + body;
}

function fields(id: string, kind: string, extra: Fields = {}): Fields {
  return { id, kind, title: "A title", summary: "A summary.", author: "GSTA-9", date: id.slice(0, 10), status: "done", ...extra };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function write(root: string, path: string, text: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function makeWiki(files: Record<string, string>, { index = true } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-test-"));
  roots.push(root);
  write(root, "wiki/README.md", "# rules\n");
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  if (index) write(root, "wiki/INDEX.md", renderIndex(loadWiki(root).entries));
  return root;
}

function problems(root: string, opts: Parameters<typeof checkWiki>[1] = { markers: [] }): string[] {
  return checkWiki(root, opts).problems.map((p) => p.file + (p.line ? ":" + p.line : "") + ": " + p.message);
}

const DECISION_ID = "2026-10-28-gsta-9-a-decision";
const DECISION = "wiki/board/" + DECISION_ID + ".md";
const QUESTION_ID = "2026-10-28-gsta-9-a-question";
const QUESTION = "wiki/board/" + QUESTION_ID + ".md";
const BUNDLE = "wiki/research/2026-10-28-gsta-9-a-brief";

describe("the committed wiki", () => {
  test("passes the check", () => {
    expect(problems(repoRoot, { baseFiles: null })).toEqual([]);
  });

  test("reading posts at a commit skips README.md and INDEX.md", () => {
    for (const path of gitBaseFiles(repoRoot, "HEAD").keys()) {
      expect(path.startsWith("wiki/")).toBe(true);
      expect(["wiki/README.md", "wiki/INDEX.md"]).not.toContain(path);
    }
  });

  test("reading posts at a base that still commits INDEX.md skips it", () => {
    const root = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")) });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["add", "wiki"], { cwd: root });
    const tree = spawnSync("git", ["write-tree"], { cwd: root }).stdout.toString().trim();
    expect([...gitBaseFiles(root, tree).keys()]).toEqual([DECISION]);
  });

  test("reading posts at a commit returns every file byte for byte", () => {
    const files: Record<string, Buffer> = {
      "wiki/board/also-empty.md": Buffer.alloc(0),
      "wiki/board/empty.md": Buffer.alloc(0),
      "wiki/board/no-newline.md": Buffer.from("no trailing newline"),
      "wiki/research/bundle/header.txt": Buffer.from("0000000000000000000000000000000000000000 blob 3\nabc\n"),
      "wiki/research/bundle/latin1.txt": Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x00, 0xff, 0x80]),
    };
    const root = makeWiki({ "wiki/INDEX.md": "# index\n" }, { index: false });
    for (const [path, bytes] of Object.entries(files)) write(root, path, bytes);
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["add", "wiki"], { cwd: root });
    spawnSync("git", ["update-index", "--add", "--cacheinfo", "160000," + "1".repeat(40) + ",wiki/board/a-gitlink"], { cwd: root });
    const tree = spawnSync("git", ["write-tree"], { cwd: root }).stdout.toString().trim();
    const hex = (m: Iterable<[string, Buffer]>) => [...m].map(([path, bytes]) => [path, bytes.toString("hex")]);
    expect(hex(gitBaseFiles(root, tree))).toEqual([["wiki/board/a-gitlink", ""], ...hex(Object.entries(files))]);
  });

  test("reading posts at a commit fails when git cat-file --batch output is cut short", () => {
    const root = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")) });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["add", "wiki"], { cwd: root });
    const tree = spawnSync("git", ["write-tree"], { cwd: root }).stdout.toString().trim();
    const path = process.env.PATH;
    write(root, "bin/git", "#!/bin/sh\nPATH='" + path + "'\nif [ \"$1\" = cat-file ]; then git \"$@\" | head -c 60; exit 0; fi\nexec git \"$@\"\n");
    chmodSync(join(root, "bin/git"), 0o755);
    process.env.PATH = join(root, "bin") + ":" + path;
    try {
      expect(() => gitBaseFiles(root, tree)).toThrow("could not read " + DECISION);
    } finally {
      process.env.PATH = path;
    }
  });

  test("reading posts at a commit fails when the tree or a blob is missing", () => {
    const root = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")) });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["add", "wiki"], { cwd: root });
    const tree = spawnSync("git", ["write-tree"], { cwd: root }).stdout.toString().trim();
    expect(() => gitBaseFiles(root, "3".repeat(40))).toThrow("git ls-tree failed listing wiki/");
    const oid = spawnSync("git", ["rev-parse", tree + ":" + DECISION], { cwd: root }).stdout.toString().trim();
    unlinkSync(join(root, ".git", "objects", oid.slice(0, 2), oid.slice(2)));
    expect(() => gitBaseFiles(root, tree)).toThrow("could not read " + DECISION + " at " + tree);
  });
});

describe("front matter", () => {
  test("reads scalars, quoted values, inline lists and block lists", () => {
    const ok = parseFrontMatter("---\ntitle: It's fine\nsummary: \"Quoted: with a colon\"\nlinks: [a, \"b c\"]\nattachments:\n  - one\n  - two\nanswers:\n- three\n---\nbody\n");
    expect(ok).toEqual({ fm: { title: "It's fine", summary: "Quoted: with a colon", links: ["a", "b c"], attachments: ["one", "two"], answers: ["three"] } });
  });

  test("keeps commas inside quoted inline list items", () => {
    const parsed = parseFrontMatter("---\nlinks: [\"https://example.org/?ids=a,b\", 'x, it''s y', plain]\n---\n");
    expect(parsed).toEqual({ fm: { links: ["https://example.org/?ids=a,b", "x, it's y", "plain"] } });
    expect(parseFrontMatter("---\nlinks: ['x, it''s, y', plain]\n---\n")).toEqual({ fm: { links: ["x, it's, y", "plain"] } });
    expect(parseFrontMatter("---\nlinks: [\"a, b]\n---\n")).toMatchObject({ error: expect.stringContaining("unclosed quote"), line: 2 });
    expect(parseFrontMatter("---\nlinks: [https://x.org/?q[0]=1]\n---\n")).toMatchObject({ line: 2 });
  });

  test("treats an apostrophe inside a plain inline list item as text", () => {
    expect(parseFrontMatter("---\nlinks: [Garry's take, wiki/README.md]\n---\n")).toEqual({ fm: { links: ["Garry's take", "wiki/README.md"] } });
    expect(parseFrontMatter("---\nlinks: [anna's.md, bob's.md]\n---\n")).toEqual({ fm: { links: ["anna's.md", "bob's.md"] } });
  });

  test("refuses empty inline items and mixed block list indentation, as YAML does", () => {
    expect(parseFrontMatter("---\nlinks: []\n---\n")).toEqual({ fm: { links: [] } });
    expect(parseFrontMatter("---\nlinks: [,a]\n---\n")).toMatchObject({ error: expect.stringContaining("empty item"), line: 2 });
    expect(parseFrontMatter("---\nlinks:\n  - a\n- b\n---\n")).toMatchObject({ error: expect.stringContaining("one indentation"), line: 4 });
  });

  test("refuses a file with no front matter, an unclosed block, CRLF and duplicate fields", () => {
    expect(parseFrontMatter("# just markdown\n")).toMatchObject({ error: expect.stringContaining("no front matter") });
    expect(parseFrontMatter("---\ntitle: x\n")).toMatchObject({ error: expect.stringContaining("not closed") });
    expect(parseFrontMatter("---\r\ntitle: x\r\n---\r\n")).toMatchObject({ error: expect.stringContaining("LF") });
    expect(parseFrontMatter("---\ntitle: x\ntitle: y\n---\n")).toMatchObject({ error: expect.stringContaining("duplicate"), line: 3 });
  });

  test("refuses values that YAML would not read as plain strings", () => {
    for (const value of ["a: b", "a #b", "[x", "*ref", "&anchor", "ends:", '"has \\" escape"']) {
      expect(parseFrontMatter("---\ntitle: " + value + "\n---\n")).toMatchObject({ line: 2 });
    }
  });
});

describe("the check", () => {
  test("passes a minimal valid wiki", () => {
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")) }))).toEqual([]);
  });

  test("fails on missing, unknown and mistyped fields", () => {
    const f = fields(DECISION_ID, "decision", { supercedes: ["x"], links: "not-a-list" });
    delete f.summary;
    const out = problems(makeWiki({ [DECISION]: post(f) }));
    expect(out).toContainEqual(DECISION + ': missing required field "summary"');
    expect(out).toContainEqual(DECISION + ': unknown field "supercedes"');
    expect(out).toContainEqual(DECISION + ': "links" takes a list');
  });

  test("fails on a bad kind, a kind in the wrong folder, a bad status and a bad date", () => {
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "memo")) }))).toContainEqual(expect.stringContaining('kind "memo" is not one of'));
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "plan")) }))).toContainEqual(DECISION + ": a plan belongs in wiki/plans/, not wiki/board/");
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision", { status: "closed" })) }))).toContainEqual(expect.stringContaining('status "closed"'));
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision", { status: "answered" })) }))).toContainEqual(expect.stringContaining("only a question"));
    const bad = "2026-02-30-gsta-9-a-decision";
    expect(problems(makeWiki({ ["wiki/board/" + bad + ".md"]: post(fields(bad, "decision")) }))).toContainEqual(expect.stringContaining('date "2026-02-30" is not a real'));
  });

  test("fails when the id, file name, date and author disagree", () => {
    expect(problems(makeWiki({ [DECISION]: post(fields("2026-10-28-gsta-9-other", "decision")) }))).toContainEqual(expect.stringContaining("must equal the file name"));
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision", { author: "GSTA-10" })) }))).toContainEqual(expect.stringContaining('must start with "2026-10-28-gsta-10-"'));
    expect(problems(makeWiki({ "wiki/board/Notes.md": post(fields("Notes", "decision", { date: "2026-10-28" })) }))).toContainEqual(expect.stringContaining("must be YYYY-MM-DD-<author>-<slug>"));
  });

  test("fails on a duplicate id and a long summary", () => {
    const dup = makeWiki({
      [DECISION]: post(fields(DECISION_ID, "decision")),
      ["wiki/research/" + DECISION_ID + ".md"]: post(fields(DECISION_ID, "research")),
    });
    expect(problems(dup)).toContainEqual(expect.stringContaining('duplicate id "' + DECISION_ID + '"'));
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision", { summary: "x".repeat(201) })) }))).toContainEqual(expect.stringContaining("longer than 200"));
  });

  test("requires superseded and answered statuses to match the links", () => {
    const newer = "2026-10-29-gsta-9-newer";
    const newerPath = "wiki/board/" + newer + ".md";
    expect(problems(makeWiki({ [newerPath]: post(fields(newer, "decision", { supersedes: ["2026-01-01-gsta-9-gone"] })) }))).toContainEqual(expect.stringContaining("which does not exist"));
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")), [newerPath]: post(fields(newer, "decision", { supersedes: [DECISION_ID] })) }))).toContainEqual(DECISION + ': status must be "superseded": ' + newer + " supersedes it");
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision", { status: "superseded" })) }))).toContainEqual(DECISION + ': status is "superseded" but no post supersedes it');
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision", { status: "superseded" })), [newerPath]: post(fields(newer, "decision", { supersedes: [DECISION_ID] })) }))).toEqual([]);
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")), [newerPath]: post(fields(newer, "decision", { answers: [DECISION_ID] })) }))).toContainEqual(expect.stringContaining("not a question"));
    expect(problems(makeWiki({ [QUESTION]: post(fields(QUESTION_ID, "question", { status: "answered" })) }))).toContainEqual(expect.stringContaining("no post answers it"));
    expect(problems(makeWiki({ [QUESTION]: post(fields(QUESTION_ID, "question", { status: "open" })), [newerPath]: post(fields(newer, "decision", { answers: [QUESTION_ID] })) }))).toContainEqual(QUESTION + ': status must be "answered": ' + newer + " answers it");
    expect(problems(makeWiki({ [QUESTION]: post(fields(QUESTION_ID, "question", { status: "answered" })), [newerPath]: post(fields(newer, "decision", { answers: [QUESTION_ID] })) }))).toEqual([]);
  });

  test("pins every bundle file by sha256", () => {
    const note = "# note\n";
    const brief = (attachments: string[]) => post(fields("2026-10-28-gsta-9-a-brief", "research", { attachments }));
    expect(problems(makeWiki({ [BUNDLE + "/README.md"]: brief([sha(note) + "  notes/a.md"]), [BUNDLE + "/notes/a.md"]: note }))).toEqual([]);
    expect(problems(makeWiki({ [BUNDLE + "/README.md"]: brief([sha("other") + "  notes/a.md"]), [BUNDLE + "/notes/a.md"]: note }))).toContainEqual(expect.stringContaining('"notes/a.md" does not match its sha256'));
    expect(problems(makeWiki({ [BUNDLE + "/README.md"]: brief([]), [BUNDLE + "/notes/a.md"]: note }))).toContainEqual(expect.stringContaining('"notes/a.md" in the bundle is not listed'));
    expect(problems(makeWiki({ [BUNDLE + "/README.md"]: brief([sha(note) + "  notes/b.md"]) }))).toContainEqual(expect.stringContaining('"notes/b.md" is listed but missing'));
    expect(problems(makeWiki({ [BUNDLE + "/README.md"]: brief([sha(note) + "  ../escape.md"]) }))).toContainEqual(expect.stringContaining("must be a file inside the bundle"));
    expect(problems(makeWiki({ [BUNDLE + "/README.md"]: brief(["notes/a.md"]), [BUNDLE + "/notes/a.md"]: note }))).toContainEqual(expect.stringContaining("as sha256sum prints it"));
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision", { attachments: [sha(note) + "  a.md"] })) }))).toContainEqual(expect.stringContaining("only a bundle"));
    expect(problems(makeWiki({ [BUNDLE + "/notes/a.md"]: note }))).toContainEqual(BUNDLE + ": bundle has no README.md");
  });

  test("fails on stray files", () => {
    expect(problems(makeWiki({ "wiki/notes.txt": "x" }))).toContainEqual(expect.stringContaining("wiki/notes.txt: unexpected file"));
    expect(problems(makeWiki({ "wiki/board/data.json": "{}" }))).toContainEqual(expect.stringContaining("wiki/board/data.json: unexpected file"));
  });

  test("fails on key shapes without printing the key", () => {
    const keys = [
      ["sk", "proj", "x".repeat(32)].join("-"),
      "AKIA" + "ABCDEFGHIJKLMNOP",
      "ghp" + "_" + "a".repeat(36),
      "xox" + "b-" + "1".repeat(20),
      "-----BEGIN " + "RSA PRIVATE KEY-----",
      "api" + "_key = " + "Z".repeat(30),
    ];
    for (const key of keys) {
      const out = problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision"), "\nconfig " + key + "\n") }));
      expect(out).toContainEqual(expect.stringContaining(DECISION + ":11: possible secret"));
      expect(out.join("\n")).not.toContain(key);
    }
  });

  test("fails on sealed markers, including the repo's pregate answer markers", () => {
    const marked = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision"), "\n" + "SEALED" + " ANSWER: 42\n") });
    expect(problems(marked)).toContainEqual(DECISION + ":11: sealed marker: sealed material never goes in wiki/");
    const custom = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision"), "\nCANARY" + "-7f3a\n"), ".gstack/pregate.json": JSON.stringify({ sealed: { answer_markers: ["CANARY" + "-7f3a"] } }) });
    expect(problems(custom, {})).toContainEqual(expect.stringContaining("sealed marker"));
    const pattern = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision"), "\ncanary-" + "0042\n"), ".gstack/pregate.json": JSON.stringify({ sealed: { answer_markers: ["canary-\\d{4}"] } }) });
    expect(problems(pattern, {})).toContainEqual(expect.stringContaining("sealed marker"));
    const broken = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")), ".gstack/pregate.json": JSON.stringify({ sealed: { answer_markers: ["("] } }) });
    expect(problems(broken, {})).toContainEqual(expect.stringContaining("does not compile"));
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision"), "\nThe catalogue stays in sealed custody.\n") }))).toEqual([]);
  });

  test("passes with no INDEX.md or an untracked stale one, and fails when INDEX.md is committed", () => {
    expect(problems(makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")) }, { index: false }))).toEqual([]);
    const root = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")) });
    write(root, QUESTION, post(fields(QUESTION_ID, "question", { status: "open" })));
    expect(problems(root)).toEqual([]);
    spawnSync("git", ["init", "-q"], { cwd: root });
    expect(problems(root)).toEqual([]);
    spawnSync("git", ["add", "wiki/INDEX.md"], { cwd: root });
    expect(problems(root)).toEqual(["wiki/INDEX.md: generated, so it must not be committed; run git rm --cached wiki/INDEX.md"]);
  });

  test("fails when git cannot say whether INDEX.md is committed", () => {
    const root = makeWiki({ [DECISION]: post(fields(DECISION_ID, "decision")) });
    write(root, ".git", "gitdir: /nonexistent-gstack-evals-test\n");
    expect(problems(root)).toEqual(["wiki/INDEX.md: git ls-files failed, so the check cannot tell whether INDEX.md is committed"]);
  });

  test("allows only status to change in a merged post", () => {
    const text = post(fields(DECISION_ID, "decision", { status: "open" }));
    const merged = () => new Map([[DECISION, Buffer.from(text)]]);
    const root = makeWiki({ [DECISION]: text });
    expect(problems(root, { markers: [], baseFiles: merged() })).toEqual([]);

    write(root, DECISION, text.replace("status: open", "status: done"));
    expect(problems(root, { markers: [], baseFiles: merged() })).toEqual([]);

    write(root, DECISION, text.replace("Body.", "Edited body."));
    expect(problems(root, { markers: [], baseFiles: merged() })).toContainEqual(expect.stringContaining(DECISION + ": merged post was edited"));

    write(root, DECISION, text.replace("title: A title", "title: Another title"));
    expect(problems(root, { markers: [], baseFiles: merged() })).toContainEqual(expect.stringContaining(DECISION + ": merged post was edited"));

    unlinkSync(join(root, DECISION));
    expect(problems(root, { markers: [], baseFiles: merged() })).toContainEqual(expect.stringContaining(DECISION + ": merged file was removed or renamed"));
  });

  test("treats a merged attachment as immutable", () => {
    const note = "# note\n";
    const readme = post(fields("2026-10-28-gsta-9-a-brief", "research", { attachments: [sha(note) + "  notes/a.md"] }));
    const root = makeWiki({ [BUNDLE + "/README.md"]: readme, [BUNDLE + "/notes/a.md"]: note });
    const merged = new Map([[BUNDLE + "/README.md", Buffer.from(readme)], [BUNDLE + "/notes/a.md", Buffer.from(note)]]);
    write(root, BUNDLE + "/notes/a.md", "# changed\n");
    const out = problems(root, { markers: [], baseFiles: merged });
    expect(out).toContainEqual(BUNDLE + "/notes/a.md: merged post was edited; only its status may change (write a new post that supersedes it)");
  });
});

describe("the index", () => {
  test("lists open posts first and links replacements", () => {
    const newer = "2026-10-29-gsta-9-newer";
    const root = makeWiki({
      [DECISION]: post(fields(DECISION_ID, "decision", { status: "superseded", title: "Old | piped" })),
      ["wiki/board/" + newer + ".md"]: post(fields(newer, "decision", { supersedes: [DECISION_ID], status: "open", title: "New" })),
    });
    const index = readFileSync(join(root, "wiki/INDEX.md"), "utf8");
    expect(index).toContain("## Open\n\n- [New](board/" + newer + ".md) (decision, GSTA-9, 2026-10-29): A summary.");
    expect(index).toContain("superseded by [" + newer + "](board/" + newer + ".md)");
    expect(index).toContain("[Old \\| piped]");
    expect(index).toContain("## Plans\n\nNo posts yet.");
    expect(index.indexOf(newer + ".md) | decision")).toBeLessThan(index.indexOf(DECISION_ID + ".md) | decision"));
  });
});

describe("the base for the history comparison", () => {
  test("none and an all-zero sha skip it; an unknown ref is an error", () => {
    expect(resolveBase(repoRoot, "none").ref).toBeNull();
    expect(resolveBase(repoRoot, "0".repeat(40))).toMatchObject({ ref: null, note: expect.stringContaining("no previous commit") });
    expect(resolveBase(repoRoot, "no-such-ref-" + sha("x").slice(0, 8)).error).toContain("no merge base");
    expect(resolveBase(repoRoot, "HEAD").ref).toMatch(/^[0-9a-f]{40}$/);
  });
});
