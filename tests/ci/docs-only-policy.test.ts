import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classifyDocsOnly, pathRefusal } from "../../scripts/docs-only.ts";
import { checkWiki } from "../../scripts/wiki.ts";
import { compareVersions } from "../../src/trial/review/plan.ts";

// .gstack/ship-policy.json's docs_only block names the human docs gstack's own docs-only classifier may admit beyond its
// built-in README.md, docs/**.md and changelog.d/*.md (pregate's lanes, CI carry and land use it; gstack 1.99.0.0 and later
// read it). ci.yml decides with scripts/docs-only.ts, so the block must never admit a change that rule refuses. These checks
// run gstack's classifier, from the commit ci.yml fetches, beside scripts/docs-only.ts: on the block, on single paths, and on
// the same sample diffs in both directions.
//
// gstack's globs have only * and ** (deny also takes ?) and match case-sensitively, so two parts of our rule are written
// another way. Our rule refuses any name holding "prompt" or "brief" in any case: each deny glob pins three letters of the
// word to one case and leaves the others as ?, and the eight case mixes cover every spelling (they also refuse a few
// unrelated names with the same letters in those places, which only keeps more changes on full CI). Our rule admits a board
// post only under a YYYY-MM-DD-<slug> name, which the globs cannot spell: they ask for three hyphens, and every name they
// admit beyond our rule fails wiki:check's name rule, which ci.yml runs on every pull request, docs-only ones included.
// Two differences run the other way and make gstack narrower: its reference scan matches the string README.md anywhere, the
// block's own bundle pattern included, so it never admits a root README edit; and it refuses a board post while any
// non-prose file names a wiki/ folder without being tied to docs_only.tests.
const ROOT = join(import.meta.dir, "..", "..");
const POLICY_TEXT = readFileSync(join(ROOT, ".gstack", "ship-policy.json"), "utf8");
const POLICY = JSON.parse(POLICY_TEXT) as { min_gstack_version: string; docs_only: { allow: string[]; deny: string[]; tests: string[] } };
const BLOCK = { ...POLICY.docs_only, label: ".gstack/ship-policy.json" };
const GSTACK = [process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, "gstack") : "", join(homedir(), ".local", "share", "gstack")].find(
  (d) => d && existsSync(join(d, "lib", "docs-only.ts")),
);
if (!GSTACK) throw new Error("gstack not found: ci.yml fetches it into $RUNNER_TEMP/gstack; elsewhere install it at ~/.local/share/gstack");
const gstack = await import(join(GSTACK, "lib", "docs-only.ts"));
const shipPolicy = await import(join(GSTACK, "lib", "ship-policy.ts"));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const NAME_RULE = "must be YYYY-MM-DD-<author>-<slug>";

const scratch = mkdtempSync(join(tmpdir(), "docs-only-policy-"));
const empty = join(scratch, "empty");
mkdirSync(empty);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const write = (dir: string, p: string, body: string) => {
  mkdirSync(join(dir, dirname(p)), { recursive: true });
  writeFileSync(join(dir, p), body);
};
const gstackRefusal = (p: string): string | null => gstack.pathRefusal(p, empty, [], BLOCK);

/** wiki:check's problems for one board post, written alone into a scratch wiki with front matter that is otherwise valid. */
const wikiProblems = (p: string): string[] => {
  const dir = mkdtempSync(join(scratch, "wiki-"));
  const id = p.replace(/^wiki\/board\//, "").replace(/(?:\/README)?\.md$/, "");
  write(dir, "wiki/README.md", "# rules\n");
  write(dir, p, ["---", "id: " + id, "kind: decision", "title: A title", "summary: A summary.", "author: ann", "date: 2030-01-02", "status: done", "---", "", "Body.", ""].join("\n"));
  return checkWiki(dir).problems.filter((x) => x.file === p).map((x) => x.message);
};

describe("the docs_only block in .gstack/ship-policy.json", () => {
  test("passes the policy check of the gstack this test runs, which reads every key in it", () => {
    expect(shipPolicy.validatePolicy(POLICY)).toEqual([]);
    expect(shipPolicy.policyWarnings(POLICY)).toEqual([]);
    expect(compareVersions(POLICY.min_gstack_version, shipPolicy.minimumReader(POLICY))).toBeGreaterThanOrEqual(0);
    expect(compareVersions(shipPolicy.installedGstackVersion(), POLICY.min_gstack_version)).toBeGreaterThanOrEqual(0);
  });

  test("lists the wiki's secret-scan test for the docs lane, and only tests that exist", () => {
    expect(POLICY.docs_only.tests).toContain("tests/wiki.test.ts");
    for (const t of POLICY.docs_only.tests) expect([t, existsSync(join(ROOT, t))]).toEqual([t, true]);
    expect(readFileSync(join(ROOT, "tests", "wiki.test.ts"), "utf8")).toContain("possible secret");
  });

  test("ci.yml and sealed.yml fetch a gstack that reads it", () => {
    for (const f of ["ci.yml", "sealed.yml"]) {
      const pin = readFileSync(join(ROOT, ".github", "workflows", f), "utf8").match(/GSTACK_SHA:\s*[0-9a-f]{40}\s*# gstack v(\d+\.\d+\.\d+\.\d+)/);
      expect([f, compareVersions(pin?.[1] ?? "0", POLICY.min_gstack_version) >= 0]).toEqual([f, true]);
    }
  });
});

describe("single paths, by name and place", () => {
  const FOLDERS = ["", "docs/", "docs/guide/", "docs/briefs/", "docs/Brief/", "docs/prompts/", "docs/benchmarks/r1/", "docs/skills/", "docs/evals/", "wiki/", "wiki/board/", "wiki/plans/", "wiki/research/", "changelog.d/", "src/", "tests/", ".github/", "wiki/board/2030-01-02-ann-bundle/", "wiki/board/2030-01-02-ann-pilot-results/", "wiki/board/2030-01-02-ann-arm-prereg/", "wiki/board/a-b-c-d/", "wiki/board/2030-01-02-ann-bundle/sub/"];
  const NAMES = ["README.md", "setup-notes.md", "SKILL.md", "AGENTS.md", "CREW.md", "crew.md", "CLAUDE.md", "review-prompt.md", "Prompt-Guide.md", "PROMPTS.md", "arm-brief.md", "Debriefing.md", "release-policy.md", "preferences.md", "prereg.md", "2030-01-02-ann-handoff.md", "2030-01-02-ann-brief.md", "2030-01-02-ann-pilot-results.md", "2030-01-02-ann-arm-prereg.md", "a-b-c-d.md", "2030-01-02-Ann-handoff.md", "page.mdx", "data.json"];
  const PATHS = FOLDERS.flatMap((f) => NAMES.map((n) => f + n));

  test("gstack admits a path scripts/docs-only.ts refuses only for a board name wiki:check refuses", () => {
    const wider = PATHS.filter((p) => gstackRefusal(p) === null && pathRefusal(p) !== null);
    expect(wider.sort()).toEqual(["wiki/board/2030-01-02-Ann-handoff.md", "wiki/board/a-b-c-d.md", "wiki/board/a-b-c-d/README.md"]);
    for (const p of wider) expect([p, wikiProblems(p).some((m) => m.includes(NAME_RULE))]).toEqual([p, true]);
    expect(wikiProblems("wiki/board/2030-01-02-ann-handoff.md")).toEqual([]);
  });

  test("both admit README.md, docs pages and dated board posts", () => {
    const both = PATHS.filter((p) => gstackRefusal(p) === null && pathRefusal(p) === null);
    expect(both).toEqual(expect.arrayContaining(["README.md", "docs/setup-notes.md", "docs/guide/setup-notes.md", "wiki/board/2030-01-02-ann-bundle/README.md", "wiki/board/2030-01-02-ann-handoff.md"]));
  });

  const spellings = (word: string) => Array.from({ length: 2 ** word.length }, (_, m) => [...word].map((c, i) => ((m >> i) & 1 ? c.toUpperCase() : c)).join(""));
  test("both refuse every spelling of prompt and brief in a docs page's name or folder", () => {
    const paths = [
      ...spellings("prompt").flatMap((w) => ["docs/" + w + ".md", "docs/my-" + w + "-notes.md", "docs/guide/" + w + "s.md"]),
      ...spellings("brief").flatMap((w) => ["docs/" + w + ".md", "docs/de" + w + "ing.md", "docs/" + w + "/a.md", "docs/" + w + "s/a.md", "wiki/board/2030-01-02-ann-" + w + ".md"]),
    ];
    expect(paths.length).toBe(64 * 3 + 32 * 5);
    expect(paths.filter((p) => pathRefusal(p) === null)).toEqual([]);
    expect(paths.filter((p) => gstackRefusal(p) === null)).toEqual([]);
  });
});

describe("the same sample diffs through both classifiers", () => {
  const BASE: Record<string, string> = {
    "README.md": "# repo\n",
    "AGENTS.md": "Read the wiki rules first.\n",
    "CREW.md": "# crew rules\n",
    ".gstack/ship-policy.json": POLICY_TEXT,
    ".gstack/generated.json": JSON.stringify({ entries: [{ id: "errors-doc", command: "bun run errors:doc", outputs: ["docs/reason-codes.md"] }] }),
    "docs/setup-notes.md": "# Setup\n",
    "docs/reason-codes.md": "# Reason codes\n",
    "docs/guide/SKILL.md": "# a skill\n",
    "scripts/wiki.ts": 'export const WIKI = "wiki/";\n',
    "tests/wiki.test.ts": 'import { WIKI } from "../scripts/wiki.ts";\n',
    "src/cli.ts": "export const VERSION = 1;\n",
    "wiki/README.md": "# wiki rules\n",
    "wiki/board/2030-01-01-ann-handoff.md": "---\nstatus: open\n---\nA handoff.\n",
    "wiki/board/2030-01-02-ann-bundle/README.md": "---\nstatus: done\n---\nA bundle.\n",
    "wiki/plans/2030-01-03-bob-arm-prereg/README.md": "---\nstatus: open\n---\nA preregistration.\n",
  };
  let dir = "";
  let base = "";
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: ENV });
    if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
    return r.stdout;
  };
  const put = (p: string, body = "new\n") => write(dir, p, body);
  const add = (p: string, line = "more\n") => appendFileSync(join(dir, p), line);
  const verdicts = (edit: () => void) => {
    git("checkout", "-q", "--detach", base);
    git("reset", "-q", "--hard");
    git("clean", "-fdq");
    edit();
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", "sample");
    const g = gstack.classifyDocsOnly({ root: dir, base, head: "HEAD" }) as { docsOnly: boolean; refusals: { path: string; reason: string }[] };
    return { ours: classifyDocsOnly(dir, base, "HEAD").docsOnly, gstack: g.docsOnly, gstackRefusals: g.refusals };
  };

  beforeAll(() => {
    dir = join(scratch, "repo");
    mkdirSync(dir);
    for (const [p, body] of Object.entries(BASE)) put(p, body);
    git("init", "-q", ".");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    base = git("rev-parse", "HEAD").trim();
  });

  const DOCS: [string, () => void][] = [
    ["a new board post", () => put("wiki/board/2030-01-09-ann-handoff.md")],
    ["a new board bundle holding only its README", () => put("wiki/board/2030-01-09-ann-decision/README.md")],
    ["a new post that supersedes an old one and flips its status", () => {
      put("wiki/board/2030-01-09-ann-handoff.md");
      put("wiki/board/2030-01-01-ann-handoff.md", "---\nstatus: superseded\n---\nA handoff.\n");
    }],
    ["an edit to a docs page nothing names", () => add("docs/setup-notes.md")],
    ["a new nested docs page", () => put("docs/guide/install.md")],
  ];
  const FULL: [string, () => void][] = [
    ["a SKILL.md, even under docs/", () => add("docs/guide/SKILL.md")],
    ["AGENTS.md", () => add("AGENTS.md")],
    ["CREW.md", () => add("CREW.md")],
    ["a CREW.md under docs/", () => put("docs/team/CREW.md")],
    ["a prompt file", () => put("docs/review-prompt.md")],
    ["a prompt file with a capital P", () => put("docs/Prompt-Guide.md")],
    ["a page in a prompts folder", () => put("docs/prompts/review.md")],
    ["a brief", () => put("docs/arm-brief.md")],
    ["a page in a Briefs folder", () => put("docs/Briefs/r1.md")],
    ["a preregistration posted to the board", () => put("wiki/board/2030-01-09-ann-arm-prereg.md")],
    ["a preregistration under wiki/plans", () => add("wiki/plans/2030-01-03-bob-arm-prereg/README.md")],
    ["a results post (pinned results)", () => put("wiki/board/2030-01-09-ann-pilot-results.md")],
    ["a results bundle's README", () => put("wiki/board/2030-01-09-ann-pilot-results/README.md")],
    ["a benchmark page under docs/benchmarks", () => put("docs/benchmarks/r1/README.md")],
    ["a changelog.d fragment", () => put("changelog.d/fix.md")],
    ["a generated page", () => add("docs/reason-codes.md")],
    ["a README edit mixed with a code change", () => (add("README.md"), add("src/cli.ts"))],
    ["a board post mixed with a change to the wiki checker", () => (put("wiki/board/2030-01-09-ann-handoff.md"), add("scripts/wiki.ts"))],
    ["a docs page mixed with an AGENTS.md edit", () => (add("docs/setup-notes.md"), add("AGENTS.md"))],
    ["an edit to .gstack/ship-policy.json", () => add(".gstack/ship-policy.json", " ")],
  ];

  for (const [name, edit] of DOCS) {
    test("both skip the suites: " + name, () => {
      expect(verdicts(edit)).toEqual({ ours: true, gstack: true, gstackRefusals: [] });
    });
  }

  for (const [name, edit] of FULL) {
    test("both keep full CI: " + name, () => {
      const v = verdicts(edit);
      expect([v.ours, v.gstack]).toEqual([false, false]);
    });
  }

  test("a README-only edit: scripts/docs-only.ts skips the suites, and gstack keeps them because .gstack/ship-policy.json names README.md", () => {
    const v = verdicts(() => add("README.md"));
    expect([v.ours, v.gstack]).toEqual([true, false]);
    expect(v.gstackRefusals).toEqual([{ path: "README.md", reason: expect.stringContaining("named by .gstack/ship-policy.json") }]);
  });

  test("a board post named a-b-c-d: gstack admits it, scripts/docs-only.ts refuses it, and wiki:check refuses the name", () => {
    const v = verdicts(() => put("wiki/board/a-b-c-d.md"));
    expect([v.ours, v.gstack]).toEqual([false, true]);
    expect(wikiProblems("wiki/board/a-b-c-d.md")).toContainEqual(expect.stringContaining(NAME_RULE));
  });
});
