// Copyright (c) 2026 Garry Tan. MIT License.
// The miner's draw reads no repository path over REST: a fake gh answers GraphQL and rate_limit and fails any other
// call, a fake git answers the partial clone, and one unit runs through every read a draw makes (files paged,
// release ancestry, the tree walked by oid, the licence, the diff and the window).
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const dir = mkdtempSync(join(tmpdir(), "dx-no-rest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const A = "a".repeat(40), B = "b".repeat(40);
const words = Array.from({ length: 130 }, (_, i) => "word" + String.fromCharCode(97 + (i % 26))).join(" ");
const answers = { words, A, B };

const FAKE_GH = `
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const log = process.argv[1].replace(/fake-gh\\.ts$/, "gh.log");
const a = ${JSON.stringify(answers)};
const rl = { cost: 1, remaining: 5000, resetAt: "2026-01-01T00:00:00Z" };
const empty = { search: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] }, rateLimit: rl };
const ok = (data) => { process.stdout.write(JSON.stringify(data)); process.exit(0); };
if (args[0] === "api" && args[1] === "rate_limit") {
  appendFileSync(log, JSON.stringify({ args }) + "\\n");
  ok({ resources: { graphql: { remaining: 5000, reset: 0 }, core: { remaining: 5000, reset: 0 } } });
}
if (!(args[0] === "api" && args[1] === "graphql")) {
  appendFileSync(log, JSON.stringify({ args, refused: true }) + "\\n");
  process.stderr.write("HTTP 403: the fake refuses every REST call but rate_limit\\n");
  process.exit(1);
}
const { query: q, variables: v } = JSON.parse(readFileSync(0, "utf8"));
appendFileSync(log, JSON.stringify({ args, query: q, variables: v }) + "\\n");
const res = (repository) => ok({ data: { repository, rateLimit: rl } });
if (q.includes("releases(first: 100")) res({ releases: { totalCount: 1, nodes: [{ tagName: "v1.0.0", publishedAt: "2026-08-01T00:00:00Z", isDraft: false, isPrerelease: false }] }, refs: { nodes: [] } });
if (q.includes("type: DISCUSSION")) ok({ data: empty });
if (q.includes("baseRefName")) ok({ data: { search: { issueCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: 7, title: "Add a --json flag to the export command", createdAt: "2026-07-10T00:00:00Z", mergedAt: "2026-07-20T00:00:00Z", baseRefName: "main", labels: { nodes: [] }, files: { totalCount: 2, nodes: [{ path: "src/cli/export.ts", additions: 50 }] } }] }, rateLimit: rl } });
if (q.includes("type: ISSUE")) ok({ data: empty });
if (q.includes("closingIssuesReferences")) res({ pullRequest: { body: a.words, createdAt: "2026-07-10T00:00:00Z", lastEditedAt: null, userContentEdits: { nodes: [] }, mergeCommit: { oid: a.A, parents: { nodes: [{ oid: a.B }] } }, commits: { nodes: [{ commit: { authoredDate: "2026-07-09T00:00:00Z", committedDate: "2026-07-09T00:00:00Z" } }] }, timelineItems: { nodes: [] }, closingIssuesReferences: { nodes: [] } } });
if (q.includes("files(first: 100, after: $after)")) res({ pullRequest: { files: v.after ? { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ path: "src/format.ts", additions: 20 }] } : { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ path: "src/cli/export.ts", additions: 50 }] } } });
if (q.includes("compare(headRef")) res({ ref: v.ref === "refs/tags/v1.0.0" && v.head === a.A ? { compare: { status: "BEHIND" } } : null });
if (q.includes("object(expression:")) res({ t0: { entries: [{ name: "LICENSE", type: "blob", size: 1000, oid: "c".repeat(40), object: {} }, { name: "src", type: "tree", size: 0, oid: "d".repeat(40), object: { entries: [{ name: "cli", type: "tree", size: 0, oid: "e".repeat(40), object: { entries: [{ name: "deep", type: "tree", size: 0, oid: "f".repeat(40) }] } }] } }] } });
if (q.includes("object(oid:")) res({ t0: { entries: [{ name: "export.ts", type: "blob", size: 500, oid: "1".repeat(40), object: {} }, { name: ".claude-notes.md", type: "blob", size: 5, oid: "2".repeat(40), object: {} }] } });
if (q.includes("licenseInfo")) res({ licenseInfo: { spdxId: "MIT" }, defaultBranchRef: { target: { tree: { entries: [{ name: "LICENSE", type: "blob", oid: "c".repeat(40) }] } } } });
process.stderr.write("the fake has no answer for this query\\n");
process.exit(1);
`;

const FAKE_GIT = `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.argv[1].replace(/fake-git\\.ts$/, "git.log"), JSON.stringify(args) + "\\n");
let i = 0;
while (args[i] === "-c") i += 2;
if (args[i] === "diff") process.stdout.write("diff --git a/docs/export.md b/docs/export.md\\n--- a/docs/export.md\\n+++ b/docs/export.md\\n+Pass \\x60--json-out\\x60 to write a file.\\n");
process.exit(0);
`;

function setup() {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "fake-gh.ts"), FAKE_GH);
  writeFileSync(join(dir, "fake-git.ts"), FAKE_GIT);
  for (const [name, file] of [["gh", "fake-gh.ts"], ["git", "fake-git.ts"]]) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexec " + JSON.stringify(process.execPath) + " " + JSON.stringify(join(dir, file)) + ' "$@"\n');
    chmodSync(join(bin, name), 0o755);
  }
  const out = join(dir, "out");
  mkdirSync(out);
  writeFileSync(join(out, "repos.json"), JSON.stringify({ repos: [{ repo: "fixture-owner/fixture-repo", stars: 900, licence_field: "MIT", tier: "permissive", topics: ["cli"], stratum: null, sides: ["dev"], default_branch: "main" }] }));
  return { bin, out };
}

describe("dx mine draw reads no repository path over REST", () => {
  test("a fake gh that fails every REST call but rate_limit still sees the draw keep and screen its unit", () => {
    const { bin, out } = setup();
    const refused = spawnSync(join(bin, "gh"), ["api", "repos/fixture-owner/fixture-repo/compare/a...b"], { encoding: "utf8" });
    expect(refused.status).toBe(1);
    writeFileSync(join(dir, "gh.log"), "");
    const r = spawnSync(process.execPath, [join(ROOT, "bin/gstack-evals"), "dx", "mine", "draw", "--out", out, "--draws", "5"], { encoding: "utf8", env: { ...process.env, PATH: bin + ":" + process.env.PATH } });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const summary = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    expect({ draws: summary.draws, kept: summary.kept, screened: summary.screened, drops: summary.drops }).toEqual({ draws: 1, kept: 1, screened: 1, drops: {} });
    const calls = readFileSync(join(dir, "gh.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls.filter((c) => c.refused)).toEqual([]);
    for (const c of calls) expect(["graphql", "rate_limit"]).toContain(c.args[1]);
    const queries = calls.filter((c) => c.query).map((c) => c.query as string);
    expect(queries.filter((q) => q.includes("files(first: 100, after: $after)")).length).toBe(2);
    expect(queries.filter((q) => q.includes("object(oid:")).length).toBe(1);
    expect(queries.filter((q) => q.includes("compare(headRef")).length).toBe(1);
    const draws = JSON.parse(readFileSync(join(out, "draws.json"), "utf8"));
    expect(draws.kept[0].base).toEqual({ bytes: 1505, truncated: false, claude_dir: false, mcp_json: false, licence: "MIT" });
    const git = readFileSync(join(dir, "git.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
    const sub = (a: string[]) => a.find((x, i) => x !== "-c" && a[i - 1] !== "-c");
    expect(git.map(sub)).toEqual(["init", "remote", "fetch", "diff"]);
    expect(git[0]).toContain("core.hooksPath=/dev/null");
    expect(git[2]).toContain("--filter=blob:none");
    const s = JSON.parse(readFileSync(join(out, "screen.jsonl"), "utf8").trim());
    expect(s.identifiers.map((x: { token: string }) => x.token)).toContain("--json-out");
  }, 120_000);
});
