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
// .json file under wiki/plans, would hide code or prose from review.
const ROOT = join(import.meta.dir, "..", "..");
const POLICY = JSON.parse(readFileSync(join(ROOT, ".gstack", "ship-policy.json"), "utf8")) as { review_exclude_paths: string[] };
const PATTERNS = ["wiki/plans/*/*-frame.json", "wiki/plans/*/*-repos.json", "wiki/plans/*/*-licences.json", "tests/harness-mechanics/fixtures/arms/**"];

const scratch = mkdtempSync(join(tmpdir(), "review-exclude-policy-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The tracked paths in the repository at `dir` that the policy's patterns match, read the way gstack reads them. */
function matched(dir: string): string[] {
  const r = spawnSync("git", ["ls-files", "-z", "--", ...POLICY.review_exclude_paths.map((p) => ":(top,glob)" + p)], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git ls-files failed: " + r.stderr);
  return r.stdout.split("\0").filter(Boolean).sort();
}

/** A .json file directly inside one post folder under wiki/plans. */
const inPlansPost = (p: string) => /^wiki\/plans\/[^/]+\/[^/]+\.json$/.test(p);
/** A file at any depth inside the harness mechanics eval's recorded arm fixtures. */
const inArmFixtures = (p: string) => p.startsWith("tests/harness-mechanics/fixtures/arms/");

describe("review_exclude_paths in .gstack/ship-policy.json", () => {
  test("holds exactly the three frozen data-file patterns and the recorded arm fixtures", () => {
    expect(POLICY.review_exclude_paths).toEqual(PATTERNS);
  });

  test("matches only .json files directly inside a wiki/plans post, and the recorded arm fixtures, in this tree", () => {
    expect(matched(ROOT).filter((p) => !inPlansPost(p) && !inArmFixtures(p))).toEqual([]);
  });

  test("matches no file but a wiki/plans post's data files and the recorded arm fixtures", () => {
    const dir = join(scratch, "repo");
    const post = "wiki/plans/2030-01-02-a-prereg";
    const arms = "tests/harness-mechanics/fixtures/arms";
    const hits = [post + "/b1-frame.json", post + "/b1-repos.json", post + "/o-licences.json", arms + "/hook-stop/transcript.jsonl", arms + "/hook-stop/first-request.json", arms + "/in-image/none.txt"];
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
    ];
    for (const p of [...hits, ...misses]) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), "{}\n");
    }
    for (const args of [["init", "-q"], ["add", "-A"]]) expect(spawnSync("git", args, { cwd: dir }).status).toBe(0);
    expect(matched(dir)).toEqual([...hits].sort());
  });
});
