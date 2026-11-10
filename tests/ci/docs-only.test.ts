import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classifyDocsOnly, generatedPages, pathRefusal, references } from "../../scripts/docs-only.ts";

// Docs-only pull requests: sample diffs in both directions, each a real commit on a small repo laid out like this one, run
// through scripts/docs-only.ts, the classifier ci.yml uses to skip typecheck and the test suites. Then the same rule on
// this repo's own tree, ci.yml's wiring, and a ratchet on code that reads docs by folder or reads the root README.
const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "scripts", "docs-only.ts");
const SELF = "tests/ci/docs-only.test.ts";
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const BASE: Record<string, string> = {
  "README.md": "# repo\nSee docs/glossary.md.\n",
  "AGENTS.md": "Read wiki/README.md first. Follow docs/style.md.\n",
  "CHANGELOG.md": "Moved the arms table to docs/stacks.md.\n",
  "NOTICE.md": "| pstack | The stacks round (docs/stacks.md). |\n",
  ".gstack/generated.json": JSON.stringify({ entries: [{ id: "errors-doc", command: "bun run errors:doc", outputs: ["docs/errors.md"] }] }),
  "docs/stacks.md": "# Stacks\n",
  "docs/glossary.md": "# Glossary\n",
  "docs/style.md": "# Style\n",
  "docs/rig.md": "# The rig\n",
  "docs/skill-eval.md": "# skill-eval\n",
  "docs/guide/setup.md": "# Setup\n",
  "docs/errors.md": "# Reason codes\n",
  "docs/benchmarks/seeded/SKILL.md": "# a stack-neutral skill\n",
  "src/cli.ts": "export const VERSION = 1;\n",
  "src/rig.ts": 'export const HELP = "see docs/rig.md";\n',
  "tests/docs.test.ts": 'const doc = readFileSync(join(ROOT, "docs", "skill-eval.md"), "utf8");\n',
  "tests/guide.test.ts": 'const doc = readFileSync(join(ROOT, "docs", "guide", "setup.md"), "utf8");\n',
  "tests/rebuild.test.ts": 'expect(post("board/2026-11-04-bob-pinned.md")).toContain("Build");\n',
  "wiki/README.md": "# wiki rules\n",
  "wiki/board/2026-11-01-ann-handoff.md": "---\nstatus: open\n---\nA handoff.\n",
  "wiki/board/2026-11-02-ann-decision.md": "---\nstatus: done\n---\nA decision.\n",
  "wiki/board/2026-11-03-ann-bundle/README.md": "---\nstatus: done\n---\nA bundle.\n",
  "wiki/board/2026-11-03-ann-bundle/data.json": "{}\n",
  "wiki/board/2026-11-04-bob-pinned.md": "---\nstatus: open\n---\nBuild 1.\n",
  "wiki/plans/2026-11-05-bob-arm-prereg/README.md": "---\nstatus: open\n---\nA preregistration.\n",
};

let dir = "";
let copy = "";
let base = "";
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
};
const put = (p: string, body = "new\n") => {
  mkdirSync(join(dir, dirname(p)), { recursive: true });
  writeFileSync(join(dir, p), body);
};
const add = (p: string, line = "more\n") => appendFileSync(join(dir, p), line);
const remove = (p: string) => rmSync(join(dir, p));
const move = (a: string, b: string) => {
  mkdirSync(join(dir, dirname(b)), { recursive: true });
  renameSync(join(dir, a), join(dir, b));
};
const commit = (edit: () => void) => {
  git(dir, "checkout", "-q", "--detach", base);
  git(dir, "reset", "-q", "--hard");
  git(dir, "clean", "-fdq");
  edit();
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "sample");
};
const cli = (args: string[], event: string | undefined) => {
  const out = join(dirname(dir), "github-output-" + Math.random().toString(36).slice(2));
  writeFileSync(out, "");
  const env: Record<string, string | undefined> = { ...ENV, GITHUB_EVENT_NAME: event };
  const r = spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", copy, ...args, "--github-output", out], { cwd: dir, encoding: "utf8", env });
  return { code: r.status, stdout: r.stdout, output: readFileSync(out, "utf8") };
};

beforeAll(() => {
  const parent = mkdtempSync(join(tmpdir(), "docs-only-"));
  copy = join(parent, "docs-only.ts");
  copyFileSync(SCRIPT, copy);
  dir = join(parent, "repo");
  mkdirSync(dir);
  for (const [p, body] of Object.entries(BASE)) put(p, body);
  git(dir, "init", "-q", ".");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  base = git(dir, "rev-parse", "HEAD").trim();
});
afterAll(() => rmSync(dirname(dir), { recursive: true, force: true }));

const DOCS: [string, () => void][] = [
  ["a new wiki/board post", () => put("wiki/board/2026-11-08-ann-handoff.md")],
  ["a new wiki/board bundle holding only its README", () => put("wiki/board/2026-11-08-ann-decision/README.md")],
  ["a README edit", () => add("README.md")],
  ["a docs page that only root prose (CHANGELOG.md, NOTICE.md) names", () => add("docs/stacks.md")],
  ["a docs page that only another doc (README.md) names", () => add("docs/glossary.md")],
  ["a new post that supersedes an old one and flips its status", () => {
    put("wiki/board/2026-11-08-ann-decision.md");
    writeFileSync(join(dir, "wiki/board/2026-11-02-ann-decision.md"), "---\nstatus: superseded\n---\nA decision.\n");
  }],
  ["a docs page renamed within docs/", () => move("docs/stacks.md", "docs/arms.md")],
  ["a deleted docs page that nothing else names", () => remove("docs/stacks.md")],
];
const FULL: [string, () => void, string, string][] = [
  ["a preregistration under wiki/plans", () => add("wiki/plans/2026-11-05-bob-arm-prereg/README.md"), "wiki/plans/2026-11-05-bob-arm-prereg/README.md", "not on the docs allowlist"],
  ["a SKILL.md, even under docs/", () => add("docs/benchmarks/seeded/SKILL.md"), "docs/benchmarks/seeded/SKILL.md", "agent instructions"],
  ["a README edit mixed with a code change", () => (add("README.md"), add("src/cli.ts")), "src/cli.ts", "not on the docs allowlist"],
  ["AGENTS.md", () => add("AGENTS.md"), "AGENTS.md", "not on the docs allowlist"],
  ["a docs page AGENTS.md names", () => add("docs/style.md"), "docs/style.md", "named by AGENTS.md"],
  ["wiki/README.md, the wiki's rules", () => add("wiki/README.md"), "wiki/README.md", "not on the docs allowlist"],
  ["a generated page", () => add("docs/errors.md"), "docs/errors.md", "generated page"],
  ["a data file attached to a wiki/board bundle", () => add("wiki/board/2026-11-03-ann-bundle/data.json", "1\n"), "wiki/board/2026-11-03-ann-bundle/data.json", "not on the docs allowlist"],
  ["a README nested inside a wiki/board bundle", () => put("wiki/board/2026-11-03-ann-bundle/sub/README.md"), "wiki/board/2026-11-03-ann-bundle/sub/README.md", "not on the docs allowlist"],
  ["a wiki/board file that is not a post", () => put("wiki/board/notes.md"), "wiki/board/notes.md", "not on the docs allowlist"],
  ["a results post", () => put("wiki/board/2026-11-08-ann-pilot-results.md"), "wiki/board/2026-11-08-ann-pilot-results.md", "results post"],
  ["a wiki/board post a test reads by its id", () => add("wiki/board/2026-11-04-bob-pinned.md"), "wiki/board/2026-11-04-bob-pinned.md", "named by tests/rebuild.test.ts"],
  ["a docs page code names by path", () => add("docs/rig.md"), "docs/rig.md", "named by src/rig.ts"],
  ["a docs page a test reads through path segments", () => add("docs/skill-eval.md"), "docs/skill-eval.md", "named by tests/docs.test.ts"],
  ["a nested docs page a test reads through path segments", () => add("docs/guide/setup.md"), "docs/guide/setup.md", "named by tests/guide.test.ts"],
  ["a rename of a docs page code names", () => move("docs/rig.md", "docs/rig2.md"), "docs/rig2.md", "named by src/rig.ts"],
  ["a deleted docs page a test reads", () => remove("docs/skill-eval.md"), "docs/skill-eval.md", "named by tests/docs.test.ts"],
  ["a prompt file under docs/", () => put("docs/prompts/review.md"), "docs/prompts/review.md", "agent instructions"],
  ["an executable docs page", () => (put("docs/run.md"), chmodSync(join(dir, "docs/run.md"), 0o755)), "docs/run.md", "mode 000000 to 100755"],
  ["a symlinked docs page", () => symlinkSync("stacks.md", join(dir, "docs/link.md")), "docs/link.md", "mode 000000 to 120000"],
  ["a docs page renamed into src/", () => move("docs/stacks.md", "src/stacks.md"), "src/stacks.md", "not on the docs allowlist"],
  ["an empty diff", () => {}, "-", "no changed paths"],
];

describe("docs-only samples that skip typecheck and the test suites", () => {
  for (const [name, edit] of DOCS) {
    test(name, () => {
      commit(edit);
      expect(classifyDocsOnly(dir, base, "HEAD").refusals).toEqual([]);
    });
  }
});

describe("samples that keep full CI", () => {
  for (const [name, edit, path, reason] of FULL) {
    test(name, () => {
      commit(edit);
      const v = classifyDocsOnly(dir, base, "HEAD");
      expect(v.docsOnly).toBe(false);
      expect(v.refusals).toContainEqual({ path, reason: expect.stringContaining(reason) });
    });
  }

  test("a .gstack/generated.json that does not parse is an error, never docs-only", () => {
    commit(() => (writeFileSync(join(dir, ".gstack/generated.json"), "{"), add("README.md")));
    expect(() => classifyDocsOnly(dir, base, "HEAD")).toThrow("does not parse");
  });
});

describe("the command ci.yml runs, from a copy outside the repo", () => {
  test("writes docs_only=true for a docs-only pull_request run", () => {
    commit(() => put("wiki/board/2026-11-08-ann-handoff.md"));
    expect(cli(["--base", base, "--head", "HEAD"], "pull_request")).toEqual({ code: 0, stdout: "DOCS_ONLY: yes (1 file)\n", output: "docs_only=true\n" });
  });

  test("writes docs_only=false on a push or a dispatch, even for a docs-only diff", () => {
    commit(() => put("wiki/board/2026-11-08-ann-handoff.md"));
    for (const event of ["push", "workflow_dispatch", undefined]) {
      const r = cli(["--base", base, "--head", "HEAD"], event);
      expect([event, r.code, r.output]).toEqual([event, 1, "docs_only=false\n"]);
    }
  });

  test("lists every refused path and writes docs_only=false", () => {
    commit(() => (add("README.md"), add("src/cli.ts"), add("AGENTS.md")));
    expect(cli(["--base", base, "--head", "HEAD"], "pull_request")).toEqual({
      code: 1,
      stdout: 'DOCS_ONLY: no (3 files, 2 refused)\n  "AGENTS.md": not on the docs allowlist (README.md, docs/**/*.md, wiki/board posts)\n  "src/cli.ts": not on the docs allowlist (README.md, docs/**/*.md, wiki/board posts)\n',
      output: "docs_only=false\n",
    });
  });

  test("quotes a refused path, so a newline in a file name cannot start a workflow command line", () => {
    commit(() => put("src/x\n::warning title=injected::y.ts"));
    const r = cli(["--base", base, "--head", "HEAD"], "pull_request");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('"src/x\\n::warning title=injected::y.ts"');
    for (const line of r.stdout.split("\n")) expect(line.trimStart().startsWith("::")).toBe(false);
  });

  test("reads a missing commit as an error with a fix, writes docs_only=false and exits 2", () => {
    const r = cli(["--base", "0".repeat(40), "--head", "HEAD"], "pull_request");
    expect([r.code, r.output]).toEqual([2, "docs_only=false\n"]);
    expect(r.stdout).toStartWith("DOCS_ONLY: error (git rev-parse");
    expect(r.stdout).toContain("fix: fetch both commits");
    expect(r.stdout).toEndWith("; nothing changed, so every check runs)\n");
  });

  test("reads an unparseable .gstack/generated.json as an error with a fix", () => {
    commit(() => (writeFileSync(join(dir, ".gstack/generated.json"), "{"), add("README.md")));
    const r = cli(["--base", base, "--head", "HEAD"], "pull_request");
    expect([r.code, r.output, r.stdout.includes("fix: repair .gstack/generated.json")]).toEqual([2, "docs_only=false\n", true]);
  });

  test("reads a missing flag as an error with a fix, writes docs_only=false and exits 2", () => {
    const r = cli(["--base", base], "pull_request");
    expect([r.code, r.output, r.stdout.includes("fix: pass both --base and --head")]).toEqual([2, "docs_only=false\n", true]);
  });
});

describe("the rule on this repo's own tree", () => {
  const generated = generatedPages(ROOT, "HEAD");
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\0").filter(Boolean);

  test("docs pages that code or tests name keep full CI, and so does the generated reason-code page", () => {
    for (const page of ["docs/skill-eval.md", "docs/rig.md"]) expect([page, references(ROOT, "HEAD", page, generated).length > 0]).toEqual([page, true]);
    expect(pathRefusal("docs/errors.md", generated)).toBe("generated page");
  });

  test("every results post and every wiki/plans file keeps full CI", () => {
    const results = tracked.filter((f) => /^wiki\/board\/[^/]*results/.test(f));
    const plans = tracked.filter((f) => f.startsWith("wiki/plans/"));
    expect([results.length > 0, plans.length > 0]).toEqual([true, true]);
    for (const f of [...results, ...plans]) expect([f, pathRefusal(f, generated) !== null]).toEqual([f, true]);
  });

  // The reference scan cannot see code that lists a docs or wiki folder, or every tracked file, or that reads the root
  // README.md, which has no name scan. Each such file is listed with why a docs-only skip stays safe; a new one fails here
  // until it is listed or the classifier refuses the tree it reads. This file is left out, since it lists files to look.
  const READERS: Record<string, string> = {
    "scripts/wiki.ts": "wiki:check itself; ci.yml runs it on every pull request, docs-only ones included",
    "tests/wiki.test.ts": "runs wiki:check's rules on the committed wiki, which the wiki:check step also runs on a docs-only pull request",
    "lanes/tbv/dryrun.ts": "lists a wiki/plans preregistration folder, and wiki/plans is never docs-only",
    "tests/arms/stacks.test.ts": "writes and reads README.md in a scratch repo, not the committed one",
    "lanes/autoplan-audit/built.ts": "lists wiki posts by folder with git ls-tree at a commit its caller names, not the working tree, and names README.md only to skip wiki/README.md",
    "tests/outcome-skills/sm-history.test.ts": "lists the files of a scratch repo it builds, docs folder included, not the committed one",
  };
  test("code that reads docs by folder or reads the root README is listed with a reason", () => {
    const lists = /readdirSync|readdir\(|opendirSync|ls-files|ls-tree|Glob|globSync|walk\(/;
    const names = /["'](?:docs|wiki)["'/]|\b(?:ROOT|REPO_ROOT|repoRoot|REPO)\b/;
    const readme = /\b(?:ROOT|REPO_ROOT|repoRoot|REPO|root)\s*,\s*["']README\.md["']|["'](?:\.\.\/)+README\.md["']/;
    const found = tracked
      .filter((f) => f !== SELF && /\.(?:[cm]?[jt]s|tsx|sh|py)$/.test(f))
      .filter((f) => readFileSync(join(ROOT, f), "utf8").split("\n").some((l) => (lists.test(l) && names.test(l)) || readme.test(l)));
    expect(found.sort()).toEqual(Object.keys(READERS).sort());
  });
});

describe("ci.yml's docs-only scope", () => {
  type Step = { id?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown> };
  const steps = (Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")) as { jobs: { checks: { steps: Step[] } } }).jobs.checks.steps;
  const scope = steps.find((s) => s.id === "scope")!;

  test("runs only for pull requests into the default branch, so a stacked PR runs every check", () => {
    expect(scope.if).toBe("github.event_name == 'pull_request' && github.base_ref == github.event.repository.default_branch");
  });

  test("runs the base branch's copy on the merge commit against its first parent, and warns when it writes no verdict", () => {
    expect(scope.run).toContain('git show HEAD^1:scripts/docs-only.ts > "$RUNNER_TEMP/docs-only.ts"');
    expect(scope.run).toContain('bun --no-env-file --config=/dev/null "$RUNNER_TEMP/docs-only.ts" --base HEAD^1 --head HEAD --github-output "$GITHUB_OUTPUT"');
    expect(scope.run).toContain("grep -q '^docs_only=' \"$GITHUB_OUTPUT\" ||");
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@"))!;
    expect([checkout.with?.ref, checkout.with?.["fetch-depth"]]).toEqual([undefined, 0]);
  });
});
