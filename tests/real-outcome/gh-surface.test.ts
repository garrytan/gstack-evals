// gh-surface.ts on a small fixture tree: the gh shapes it finds in ship/SKILL.md, ship/sections/*.md and the helpers they
// call, and which of them the sidecar serves. gh api is classified by path: graphql and unserved REST paths are unserved.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GhContext, Pr } from "../../lanes/real-outcome/sandbox/gh.ts";
import { runGh } from "../../lanes/real-outcome/sandbox/gh.ts";
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
    "api POST graphql": false,
    "api PUT repos/{owner}/{repo}/pulls/1/merge": true,
    "api repos/{owner}/{repo}/pulls/$PR/comments": true,
    "pr checks": true,
    "pr create": true,
    "pr view": true,
    "release create": false,
  });
  expect(Object.fromEntries(rows.map((r) => [r.shape, r.files]))).toMatchObject({ "api PUT repos/{owner}/{repo}/pulls/1/merge": ["lib/merge.ts"], "pr checks": ["lib/merge.ts"], "pr create": ["ship/sections/release.md"], "api POST graphql": ["ship/SKILL.md"] });
});

// Each call sits in its own helper file, so its row names it. A row is served only where apiCmd in gh.ts answers that method
// and path without a rig error; GitHub paths apiCmd has no handler for stay unserved.
test("gh api rows name their method and are served only where the sidecar's apiCmd answers that method and path", () => {
  const calls: string[][] = [
    ["api", "repos/{owner}/{repo}/issues/1"],
    ["api", "-X", "POST", "repos/{owner}/{repo}/pulls/1/reviews", "-f", "event=COMMENT"],
    ["api", "repos/{owner}/{repo}/pulls/1/requested_reviewers", "-f", "reviewers[]=someone"],
    ["api", "repos/{owner}/{repo}/pulls/1/comments/1/replies"],
    ["api", "repos/{owner}/{repo}/pulls/comments"],
    ["api", "repos/{owner}/{repo}/issues/1/merge"],
    ["api", "-X", "DELETE", "repos/{owner}/{repo}/pulls/1"],
    ["api", "repos/{owner}/{repo}/pulls", "-f", "title=x"],
    ["api", "repos/{owner}/{repo}/pulls/1/reviews"],
    ["api", "repos/{owner}/{repo}/issues/1/requested_reviewers"],
    ["api", "--method=POST", "repos/{owner}/{repo}/pulls/1/comments/1/replies", "--field=body=@-"],
    ["api", "--method=PATCH", "repos/{owner}/{repo}/pulls/1", "--raw-field=title=t"],
    ["api", "-XPUT", "repos/{owner}/{repo}/issues/1/merge"],
    ["api", "repos/{owner}/{repo}/issues/1/comments", "-F", "body=x"],
    ["api", "--paginate", "repos/{owner}/{repo}/pulls/1/comments"],
    ["api", "-X", "GET", "repos/{owner}/{repo}/pulls", "-f", "state=open"],
    ["api", "repos/{owner}/{repo}/commits/0123abc/check-runs"],
    ["api", "repos/{owner}/{repo}"],
  ];
  const helpers = calls.map((_, i) => "lib/c" + i + ".ts");
  put("ship/SKILL.md", "Then run gstack-calls.\n");
  put("bin/gstack-calls", helpers.map((h, i) => "import { c" + i + ' } from "../' + h + '";\n').join(""));
  calls.forEach((argv, i) => put(helpers[i]!, 'spawn("gh", ' + JSON.stringify(argv) + ");\n"));
  const rows = ghSurface(tree);
  const pr: Pr = { number: 1, title: "t", body: "", head: "feature", base: "main", draft: false, state: "OPEN", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", labels: [], comments: [] };
  const events: { type: string }[] = [];
  const ctx: GhContext = { repo: "o/r", baseBranch: "main", visibility: "PUBLIC", origin: tree, prs: [pr], issues: [], journal: (e) => events.push(e), deleteBranch: () => {}, now: () => "2026-11-01T00:00:00Z" };
  const got = calls.map((argv, i) => {
    events.length = 0;
    runGh(ctx, { argv, stdin: "x" });
    const row = rows.find((r) => r.files.includes(helpers[i]!));
    return { argv: argv.join(" "), served: row?.served, sidecar: !events.some((e) => e.type === "rig_error") };
  });
  expect(got.filter((g) => g.served !== g.sidecar)).toEqual([]);
  expect(got.map((g) => g.served)).toEqual([false, false, false, false, false, false, false, false, true, true, true, true, true, true, true, true, true, true]);
  expect(rows.map((r) => r.shape)).toContain("api POST repos/{owner}/{repo}/pulls/1/reviews");
  expect(rows.map((r) => r.shape)).toContain("api PATCH repos/{owner}/{repo}/pulls/1");
  expect(rows.map((r) => r.shape)).toContain("api repos/{owner}/{repo}/pulls/1/reviews");
});

test("in prose, a gh api call's method is read past shell line continuations and stops at the end of the command", () => {
  put("ship/SKILL.md", "Read `gh api repos/{owner}/{repo}/issues/$PR`, then `gh api repos/{owner}/{repo}/pulls/$PR/comments --jq length` and `gh pr comment -F body.md`.\n\n```\ngh api repos/{owner}/{repo}/pulls/$PR/reviews \\\n  -f event=COMMENT\n```\n");
  for (const path of ["ship/sections", "bin", "lib"]) rmSync(join(tree, path), { recursive: true, force: true });
  expect(Object.fromEntries(ghSurface(tree).map((r) => [r.shape, r.served]))).toEqual({
    "api POST repos/{owner}/{repo}/pulls/$PR/reviews": false,
    "api repos/{owner}/{repo}/issues/$PR": false,
    "api repos/{owner}/{repo}/pulls/$PR/comments": true,
    "pr comment": true,
  });
});

test("a tree without ship/SKILL.md is refused", () => {
  expect(() => ghSurface(join(tree, "nowhere"))).toThrow("holds no ship/SKILL.md");
});
