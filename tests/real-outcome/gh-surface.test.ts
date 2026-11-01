// gh-surface.ts on a small fixture tree: the gh shapes it finds in ship/SKILL.md, ship/sections/*.md and the helpers they
// call, and which of them the sidecar serves. gh api is classified by path: graphql and unserved REST paths are unserved.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghSurface } from "../../lanes/real-outcome/sandbox/gh-surface.ts";

const tree = mkdtempSync(join(tmpdir(), "gh-surface-"));
afterAll(() => rmSync(tree, { recursive: true, force: true }));
const put = (path: string, text: string) => {
  mkdirSync(join(tree, path, ".."), { recursive: true });
  writeFileSync(join(tree, path), text);
};

test("finds the shapes in the ship skill, its sections and the helpers it calls, and classifies gh api by path", () => {
  put("ship/SKILL.md", "Run `gh pr view --json number`, then `gh api repos/{owner}/{repo}/pulls/$PR/comments --jq length`.\nNever `gh api graphql -f query=x`. Then run gstack-x.\n");
  put("ship/sections/release.md", "Open it with `gh pr create --fill`, and skip `gh release create`.\n");
  put("bin/gstack-x", 'import { merge } from "../lib/merge";\nmerge();\n');
  put("lib/merge.ts", 'export const merge = () => spawn("gh", ["api", "-X", "PUT", "repos/{owner}/{repo}/pulls/1/merge"]) && spawn("gh", ["pr", "checks"]);\n');
  put("bin/gstack-unused", 'spawn("gh", ["workflow", "run"]);\n');
  const rows = ghSurface(tree);
  expect(Object.fromEntries(rows.map((r) => [r.shape, r.served]))).toEqual({
    "api graphql": false,
    "api repos/{owner}/{repo}/pulls/$PR/comments": true,
    "api repos/{owner}/{repo}/pulls/1/merge": true,
    "pr checks": true,
    "pr create": true,
    "pr view": true,
    "release create": false,
  });
  expect(Object.fromEntries(rows.map((r) => [r.shape, r.files]))).toMatchObject({ "api repos/{owner}/{repo}/pulls/1/merge": ["lib/merge.ts"], "pr checks": ["lib/merge.ts"], "pr create": ["ship/sections/release.md"], "api graphql": ["ship/SKILL.md"] });
});

test("a tree without ship/SKILL.md is refused", () => {
  expect(() => ghSurface(join(tree, "nowhere"))).toThrow("holds no ship/SKILL.md");
});
