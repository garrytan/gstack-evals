import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// .gstack/ship-policy.json's review_exclude_paths takes a preregistration's frozen data files (its frame, repository and
// licence lists under wiki/plans) and the harness mechanics eval's recorded session fixtures (transcripts, SDK logs,
// first-request captures and hook records under tests/harness-mechanics/fixtures/arms) out of the diff /ship's model
// reviewers read, so a post with megabytes of frozen rows or recordings stays under gstack's 2 MB reviewer ceiling. gstack
// applies each pattern as a git glob pathspec, so these checks ask git which paths the patterns match: every tracked file
// here, and a scratch repository of near misses. A pattern that reached outside those places, or matched anything but a
// .json file under wiki/plans, would hide code or prose from review. The skill-pack head-to-head's published session data
// (wiki/board/2026-11-19-geva-540-skill-pack-h2h-session-data) is excluded too: its per-session .patch files, licence
// texts, MANIFEST.sha256 and session JSONL, about 12 MB that took #352's reviewer diff past the ceiling. gstack counts a
// .patch file, a MANIFEST.sha256 and an extension-less licence as code, so review_content_patterns declares those three
// kinds as data; gstack excludes a file only when both keys match it, and still keeps source, agent prose and config.
// The post's README.md and units.json stay in review. The Codex hooks eval's arm manifests (the file lists of part R's arm
// tarballs, quick/laneb/arms/manifests/codex-hooks-r/*.files.tsv) and its recorded Codex rollouts, hook logs and states
// (tests/codex-hooks/**/fixtures/**) are excluded too: about 4.8 MB that took #400's reviewer diff past the ceiling. gstack
// keeps the fixtures READMEs in review as prose.
const ROOT = join(import.meta.dir, "..", "..");
const POLICY = JSON.parse(readFileSync(join(ROOT, ".gstack", "ship-policy.json"), "utf8")) as { review_exclude_paths: string[]; review_content_patterns: string[] };
const DATA = "wiki/board/2026-11-19-geva-540-skill-pack-h2h-session-data";
const PATTERNS = [
  "wiki/plans/*/*-frame.json",
  "wiki/plans/*/*-repos.json",
  "wiki/plans/*/*-licences.json",
  "tests/harness-mechanics/fixtures/arms/**",
  DATA + "/diffs/**",
  DATA + "/licences/**",
  DATA + "/MANIFEST.sha256",
  DATA + "/*.jsonl",
  "quick/laneb/arms/manifests/codex-hooks-r/*.files.tsv",
  "tests/codex-hooks/**/fixtures/**",
];
const CONTENT = [DATA + "/diffs/*.patch", DATA + "/licences/**", DATA + "/MANIFEST.sha256"];

const scratch = mkdtempSync(join(tmpdir(), "review-exclude-policy-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The tracked paths in the repository at `dir` that `patterns` match, read the way gstack reads them. */
function matched(dir: string, patterns: string[] = POLICY.review_exclude_paths): string[] {
  const r = spawnSync("git", ["ls-files", "-z", "--", ...patterns.map((p) => ":(top,glob)" + p)], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git ls-files failed: " + r.stderr);
  return r.stdout.split("\0").filter(Boolean).sort();
}

/** A .json file directly inside one post folder under wiki/plans. */
const inPlansPost = (p: string) => /^wiki\/plans\/[^/]+\/[^/]+\.json$/.test(p);
/** A file at any depth inside the harness mechanics eval's recorded arm fixtures. */
const inArmFixtures = (p: string) => p.startsWith("tests/harness-mechanics/fixtures/arms/");
/** The head-to-head session data's diffs, licences, manifest and JSONL files. */
const inSessionData = (p: string) => p.startsWith(DATA + "/") && /^(diffs\/|licences\/|MANIFEST\.sha256$|[^/]+\.jsonl$)/.test(p.slice(DATA.length + 1));
/** The Codex hooks eval's arm file lists, and anything inside a fixtures folder under tests/codex-hooks. */
const inCodexHooksData = (p: string) => /^quick\/laneb\/arms\/manifests\/codex-hooks-r\/[^/]+\.files\.tsv$/.test(p) || /^tests\/codex-hooks\/(.+\/)?fixtures\//.test(p);
/** The files review_content_patterns may declare: the session data's .patch files, licence texts and manifest. */
const declarable = (p: string) => p.startsWith(DATA + "/") && /^(diffs\/[^/]+\.patch$|licences\/|MANIFEST\.sha256$)/.test(p.slice(DATA.length + 1));

/** A scratch repository holding `paths`, each a one-line file, all added to the index. */
function scratchRepo(name: string, paths: string[]): string {
  const dir = join(scratch, name);
  for (const p of paths) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), "{}\n");
  }
  for (const args of [["init", "-q"], ["add", "-A"]]) expect(spawnSync("git", args, { cwd: dir }).status).toBe(0);
  return dir;
}

const DATA_HITS = [DATA + "/diffs/0000-none.patch", DATA + "/licences/acme__lib/LICENSE", DATA + "/licences/acme__lib/NOTICE.txt", DATA + "/MANIFEST.sha256", DATA + "/sessions.jsonl", DATA + "/score-records.jsonl"];
const DATA_MISSES = [
  DATA + "/README.md",
  DATA + "/units.json",
  DATA + "/sub/sessions.jsonl",
  DATA + "-copy/diffs/0000-none.patch",
  "wiki/board/2026-11-19-geva-540-skill-pack-h2h-results/kit/pub-export.ts.txt",
  "wiki/board/2026-11-19-geva-540-skill-pack-h2h-results/stage2-analysis.json",
  "wiki/board/2030-01-02-other-data/diffs/0000-none.patch",
  "wiki/board/2030-01-02-other-data/MANIFEST.sha256",
];

const MANIFESTS = "quick/laneb/arms/manifests/codex-hooks-r";
const CODEX_HOOKS_HITS = [MANIFESTS + "/r-on.files.tsv", MANIFESTS + "/r-none.files.tsv", "tests/codex-hooks/c/fixtures/sessions/rollout.jsonl", "tests/codex-hooks/r/fixtures/hooks/a.jsonl", "tests/codex-hooks/fixtures/states.jsonl"];
const CODEX_HOOKS_MISSES = [
  MANIFESTS + "/r-on.json",
  MANIFESTS + "/sub/r-on.files.tsv",
  "quick/laneb/arms/manifests/b1c/b1c.files.tsv",
  "quick/laneb/arms/manifests/codex-hooks-r.files.tsv",
  "tests/codex-hooks/allin.test.ts",
  "tests/codex-hooks/c/run.test.ts",
  "tests/codex-hooks/c/fixturesx/a.json",
  "tests/codex-hooks-x/fixtures/a.json",
  "lanes/codex-hooks/c/fixtures/a.json",
];

describe("review_exclude_paths in .gstack/ship-policy.json", () => {
  test("holds exactly the three frozen data-file patterns, the recorded arm fixtures, the head-to-head session data and the Codex hooks eval's data", () => {
    expect(POLICY.review_exclude_paths).toEqual(PATTERNS);
  });

  test("matches only .json files directly inside a wiki/plans post, the recorded arm fixtures, the session data and the Codex hooks eval's data, in this tree", () => {
    expect(matched(ROOT).filter((p) => !inPlansPost(p) && !inArmFixtures(p) && !inSessionData(p) && !inCodexHooksData(p))).toEqual([]);
  });

  test("matches no file but a wiki/plans post's data files, the recorded arm fixtures, the session data and the Codex hooks eval's data", () => {
    const dir = join(scratch, "repo");
    const post = "wiki/plans/2030-01-02-a-prereg";
    const arms = "tests/harness-mechanics/fixtures/arms";
    const hits = [post + "/b1-frame.json", post + "/b1-repos.json", post + "/o-licences.json", arms + "/hook-stop/transcript.jsonl", arms + "/hook-stop/first-request.json", arms + "/in-image/none.txt", ...CODEX_HOOKS_HITS];
    const misses = [
      "b1-frame.json",
      "wiki/b1-frame.json",
      "wiki/board/2030-01-02-a/b1-frame.json",
      "wiki/plans/b1-frame.json",
      "lanes/a/b1-frame.json",
      "tests/fixtures/wiki/plans/p/b1-frame.json",
      "src/wiki/plans/p/o-licences.json",
      post + "/sub/b1-frame.json",
      post + "/b1-frame.json.gz",
      post + "/b1-frame.jsonl",
      post + "/b1-frame.ts",
      post + "/o-licences.py",
      post + "/b1-repos.md",
      post + "/frame.json",
      post + "/prereg.json",
      post + "/README.md",
      "tests/harness-mechanics/arms.test.ts",
      "tests/harness-mechanics/fixtures/scorer/cases.json",
      "tests/harness-mechanics/fixtures/arms.json",
      "tests/harness-mechanics/fixtures/armsx/a.jsonl",
      "lanes/harness-mechanics/fixtures/arms/a.jsonl",
      "tests/fixtures/arms/a.jsonl",
      ...DATA_MISSES,
      ...CODEX_HOOKS_MISSES,
    ];
    for (const p of [...hits, ...DATA_HITS, ...misses]) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), "{}\n");
    }
    for (const args of [["init", "-q"], ["add", "-A"]]) expect(spawnSync("git", args, { cwd: dir }).status).toBe(0);
    expect(matched(dir)).toEqual([...hits, ...DATA_HITS].sort());
  });
});

describe("review_content_patterns in .gstack/ship-policy.json", () => {
  test("declares exactly the session data's .patch files, licence texts and manifest", () => {
    expect(POLICY.review_content_patterns).toEqual(CONTENT);
  });

  test("declares nothing that review_exclude_paths does not also match, and nothing else, in this tree", () => {
    const declared = matched(ROOT, POLICY.review_content_patterns);
    const excluded = new Set(matched(ROOT));
    expect(declared.filter((p) => !excluded.has(p) || !declarable(p))).toEqual([]);
  });

  test("declares no file but the session data's .patch files, licence texts and manifest", () => {
    const hits = [DATA + "/diffs/0000-none.patch", DATA + "/diffs/1319-gstack.patch", DATA + "/licences/acme__lib/LICENSE", DATA + "/licences/acme__lib/NOTICE.txt", DATA + "/MANIFEST.sha256"];
    const misses = [...DATA_MISSES, DATA + "/sessions.jsonl", DATA + "/diffs/helper.ts", DATA + "/diffs/sub/0000-none.patch", "wiki/board/2030-01-02-other-data/licences/LICENSE"];
    const dir = scratchRepo("content", [...hits, ...misses]);
    expect(matched(dir, POLICY.review_content_patterns)).toEqual([...hits].sort());
    const excluded = new Set(matched(dir));
    expect(hits.filter((p) => !excluded.has(p))).toEqual([]);
  });
});
