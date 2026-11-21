import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// review_exclude_paths in .gstack/ship-policy.json takes data out of the diff /ship's reviewers read. A wide pattern, such as
// tests/codex-hooks/**/fixtures/**, could also take out a scorer or other code that lands under it later, so this test fails
// on any tracked file a pattern matches whose extension marks it as code. gstack applies each pattern as a git glob pathspec.
const ROOT = join(import.meta.dir, "..", "..");
const POLICY = JSON.parse(readFileSync(join(ROOT, ".gstack", "ship-policy.json"), "utf8")) as { review_exclude_paths: string[] };
const CODE = /\.([cm]?[jt]sx?|py|sh|bash|zsh|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|php|pl|lua|sql)$/i;

test("review_exclude_paths matches no tracked code file", () => {
  const r = spawnSync("git", ["ls-files", "-z", "--", ...POLICY.review_exclude_paths.map((p) => ":(top,glob)" + p)], { cwd: ROOT, encoding: "utf8" });
  expect(r.status).toBe(0);
  const matched = r.stdout.split("\0").filter(Boolean);
  expect(matched.length).toBeGreaterThan(0);
  expect(matched.filter((p) => CODE.test(p))).toEqual([]);
});
