// Copyright (c) 2026 Garry Tan. MIT License.
// A fake GitHub for the miner's keyless tests and dry run: eight fixture repositories (six on the developer side, three
// on the UI side) answer the GraphQL reads a draw makes, batched or not, and REST's rate_limit, on a fake clock where
// each call takes 1.5 seconds. failAt stops the fake at a call, as a killed segment would stop; remaining sets what
// rate_limit reports; gone names repositories GitHub no longer returns, whose repository field comes back null with a
// NOT_FOUND error and a failed gh exit, as GitHub answers; vanish names repositories that answer the listing and then
// answer every later read the same way. execAsync answers the same calls after a short delay that
// varies by query, so calls in flight together finish out of order; peak is the most in flight at once. No network.
import { createHash } from "node:crypto";
import type { GhExec } from "../../aftermath/gh.ts";
import type { GhExecAsync } from "./ahead.ts";
import type { FrameRepo } from "./github.ts";

const DAY = 86_400_000;
const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const words = Array.from({ length: 130 }, (_, i) => "word" + String.fromCharCode(97 + (i % 26))).join(" ");
const RELEASES = [["v1", "2026-08-10T00:00:00Z"], ["v2", "2026-09-15T00:00:00Z"], ["v3", "2026-09-29T00:00:00Z"]] as const;
const SIZES: Array<[string, number, Array<"dev" | "ui">]> = [["alpha", 60, ["dev"]], ["beta", 10, ["dev"]], ["gamma", 10, ["dev", "ui"]], ["delta", 6, ["ui"]], ["epsilon", 10, ["dev"]], ["zeta", 10, ["dev"]], ["eta", 10, ["dev"]], ["theta", 6, ["ui"]]];

export const FIXTURE_START = Date.parse("2026-11-09T12:00:00Z");

export interface FixtureGitHub {
  repos: FrameRepo[];
  exec: GhExec;
  execAsync: GhExecAsync;
  peak: () => number;
  now: () => number;
  sleep: (ms: number) => void;
  calls: () => number;
  points: () => number;
}

export function fixtureGitHub(o: { failAt?: number; remaining?: (call: number) => number; start?: number; gone?: string[]; vanish?: string[] } = {}): FixtureGitHub {
  let t = o.start ?? FIXTURE_START, n = 0, points = 0, inFlight = 0, peak = 0;
  const gone = new Set(o.gone ?? []), vanish = new Set(o.vanish ?? []);
  const repos: FrameRepo[] = SIZES.map(([name, , sides]) => ({ repo: "fixture-owner/" + name, stars: 900, licence_field: "MIT", tier: "permissive", topics: ["cli"], stratum: null, sides, default_branch: "main" }));
  const prs = new Map<string, any[]>();
  const merges = new Map<string, number>();
  for (const [name, count] of SIZES) {
    const repo = "fixture-owner/" + name;
    prs.set(repo, Array.from({ length: count }, (_, i) => {
      const k = i + 1, merged = Date.parse("2026-07-03T00:00:00Z") + ((k * 7 + name.length) % 88) * DAY;
      merges.set(sha(repo + "#" + k), merged);
      return { number: k, title: k % 3 === 0 ? "Fix crash " + k : "Add a --json" + k + " flag to the export command", createdAt: iso(merged - DAY), mergedAt: iso(merged), baseRefName: "main", labels: { nodes: [] }, files: { totalCount: 2, nodes: [{ path: "src/cli/export" + k + ".ts", additions: 50 }, { path: "src/format" + k + ".ts", additions: 20 }] }, body: k % 5 === 0 ? "short body" : words + " Adds \x60--json" + k + "\x60 to \x60export\x60." };
    }));
  }
  const page = (all: any[], after: string | null) => {
    const from = after ? Number(after) : 0, nodes = all.slice(from, from + 50);
    return { issueCount: all.length, pageInfo: { hasNextPage: from + 50 < all.length, endCursor: String(from + 50) }, nodes };
  };
  const range = (q: string, key: string) => {
    const m = new RegExp(key + ":(\\S+)\\.\\.(\\S+)").exec(q)!;
    return [Date.parse(m[1]!), Date.parse(m[2]!)] as const;
  };
  const search = (q: string, after: string | null) => {
    const repo = /repo:(\S+)/.exec(q)![1]!;
    const list = gone.has(repo) ? [] : prs.get(repo) ?? [];
    if (q.includes("base:")) {
      const [a, b] = range(q, "merged");
      return page(list.filter((p) => Date.parse(p.mergedAt) >= a && Date.parse(p.mergedAt) <= b), after);
    }
    if (q.includes("is:issue")) {
      const [a] = range(q, "created");
      return page(list.filter((p) => p.number % 4 === 1).map((p) => ({ number: 9000 + p.number, title: "--json" + p.number + " is ignored", body: "setting --json" + p.number + " does nothing", createdAt: iso(a + DAY), authorAssociation: "NONE", author: { login: "someone", __typename: "User" } })), after);
    }
    return page([], after);
  };
  const tree = (sel: string) => (sel.startsWith("expression") ? [{ name: "LICENSE", type: "blob", size: 1000, oid: "c".repeat(40) }, { name: "src", type: "tree", size: 0, oid: "d".repeat(40) }] : [{ name: "export.ts", type: "blob", size: 500, oid: "e".repeat(40) }]);
  const part = (text: string, v: Record<string, any>, i: number): any => {
    const x = (k: string) => v[k + "_" + i];
    if (text.includes("releases(first: 100")) return { releases: { totalCount: 3, nodes: RELEASES.map(([tag, at]) => ({ tagName: tag, publishedAt: at, isDraft: false, isPrerelease: tag === "v3" })) }, refs: { nodes: [] } };
    if (text.includes("search(")) return search(x("q"), x("after"));
    if (text.includes("closingIssuesReferences")) {
      const repo = x("owner") + "/" + x("name"), p = prs.get(repo)!.find((y) => y.number === x("n"))!;
      return { pullRequest: { body: p.body, createdAt: p.createdAt, lastEditedAt: null, userContentEdits: { nodes: [] }, mergeCommit: { oid: sha(repo + "#" + p.number), parents: { nodes: [{ oid: sha(repo + "#" + p.number + " base") }] } }, commits: { nodes: [{ commit: { authoredDate: p.createdAt, committedDate: p.createdAt } }] }, timelineItems: { nodes: [] }, closingIssuesReferences: { nodes: [] } } };
    }
    if (text.includes("compare(headRef")) {
      const rel = RELEASES.find(([tag]) => "refs/tags/" + tag === x("ref"));
      return { ref: rel ? { compare: { status: merges.get(x("head"))! <= Date.parse(rel[1]) ? "BEHIND" : "AHEAD" } } : null };
    }
    if (text.includes(") { id }")) return { id: "R_" + x("name") };
    throw new Error("the fixture has no answer for part " + i);
  };
  const exec: GhExec = (args, input) => {
    n++;
    t += 1500;
    if (o.failAt !== undefined && n >= o.failAt) return { status: 1, stdout: "", stderr: "HTTP 401: the fixture stopped here" };
    const remaining = o.remaining?.(n) ?? 4000;
    if (args[1] === "rate_limit") return { status: 0, stdout: JSON.stringify({ resources: { graphql: { limit: 5000, remaining, reset: 1 } } }), stderr: "" };
    const { query, variables: v } = JSON.parse(input!);
    const aliases = [...query.matchAll(/\bp(\d+): /g)];
    let data: any;
    const errors: any[] = [];
    if (aliases.length) {
      data = {};
      aliases.forEach((m: RegExpMatchArray, k: number) => {
        const text = query.slice(m.index!, aliases[k + 1]?.index ?? query.length), i = Number(m[1]);
        const r = v["owner_" + i] + "/" + v["name_" + i];
        if (text.includes("repository(owner") && (gone.has(r) || (vanish.has(r) && !text.includes("releases(first: 100")))) {
          data["p" + i] = null;
          errors.push({ type: "NOT_FOUND", path: ["p" + i], message: "Could not resolve to a Repository" });
        } else data["p" + i] = part(text, v, i);
      });
    } else if (vanish.has(v?.owner + "/" + v?.name)) {
      data = { repository: null };
      errors.push({ type: "NOT_FOUND", path: ["repository"], message: "Could not resolve to a Repository" });
    } else if (query.includes("licenseInfo")) data = { repository: { licenseInfo: { spdxId: "MIT" }, defaultBranchRef: { target: { tree: { entries: [{ name: "LICENSE", type: "blob", oid: "c".repeat(40) }] } } } } };
    else data = { repository: Object.fromEntries([...query.matchAll(/(t\d+): object\((expression|oid)/g)].map((m: RegExpMatchArray) => [m[1], { entries: tree(m[2]!) }])) };
    const cost = Math.max(1, aliases.length);
    points += cost;
    data.rateLimit = { cost, remaining, resetAt: "2026-11-09T13:00:00Z" };
    if (errors.length) return { status: 1, stdout: JSON.stringify({ data, errors }), stderr: "gh: Could not resolve to a Repository" };
    return { status: 0, stdout: JSON.stringify({ data }), stderr: "" };
  };
  const execAsync: GhExecAsync = (args, input) => {
    peak = Math.max(peak, ++inFlight);
    const later = [queueMicrotask, setImmediate, (f: () => void) => setTimeout(f, 1)][createHash("sha1").update(input ?? args.join(" ")).digest()[0]! % 3]!;
    return new Promise((done) => later(() => (inFlight--, done(exec(args, input)))));
  };
  return { repos, exec, execAsync, peak: () => peak, now: () => t, sleep: (ms) => void (t += ms), calls: () => n, points: () => points };
}
