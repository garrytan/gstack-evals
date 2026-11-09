// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals pv mine (prereg section 4): free GitHub mining of the public frame, no model call.
//   pv mine repos   --out <dir>   repositories with at least 500 stars and an allowed licence, found through topic
//                                 searches per provisional type, written to repos.jsonl
//   pv mine records --out <dir> [--repos <n>]   per repository, in seeded order, the merged feature pull requests
//                                 (PR-as-plan) and closed plans (issues closed by a merged pull request) first posted
//                                 2026-07-01 to 2026-09-30, at least 300 words, shipped in the first release after the
//                                 merge, published by 2026-10-09; written to records.jsonl in seeded order
// The provisional type only orders the quotas; every unit's type comes from the frozen classifier rule before any arm
// runs. Record ids are sealed material once authored, so --out must sit on tmpfs.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import { drawOrder, searchTopic } from "../../aftermath/draw.ts";
import type { ProjectType } from "../types.ts";
import { graphql, graphqlLeft, pointsUsed, rest } from "./gh.ts";

export const SEED = "20261108";
export const LICENCES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "MPL-2.0", "CC0-1.0"]);
export const FRAME = { from: "2026-07-01", plansTo: "2026-09-30", shippedBy: "2026-10-09", closedBy: "2026-09-27" } as const;
export const MIN_STARS = 500, MIN_WORDS = 300, WINDOW_DAYS = 42;

/** Topic searches per provisional type. */
export const TOPICS: Record<ProjectType, string[]> = {
  consumer: ["desktop-app", "electron-app", "tauri-app", "game", "note-taking", "markdown-editor", "music-player", "media-player", "photo-management", "password-manager", "browser-extension", "chat-application", "productivity", "todo-app", "rss-reader", "ebook-reader", "video-player", "home-assistant", "personal-finance", "knowledge-base"],
  server: ["database", "analytics", "observability", "monitoring", "identity-management", "authentication", "message-queue", "search-engine", "etl", "data-pipeline", "crm", "erp", "business-intelligence", "logging", "workflow-engine", "headless-cms", "sso", "feature-flags", "time-series-database", "data-warehouse"],
  mobile: ["android-app", "ios-app", "flutter-app", "react-native-app", "mobile-app", "fdroid", "f-droid", "kotlin-android", "swiftui-app"],
  other: ["cli", "developer-tools", "framework", "library", "sdk", "devtools", "compiler", "testing-tools", "linter", "terminal"],
};

export const order = (id: string) => drawOrder(SEED, id);
const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const BAD_TITLE = /\b(fix(es|ed)?|bug|hotfix|chore|docs?|documentation|readme|typos?|bump(s|ed)?|deps?|dependenc\w*|upgrade|refactor\w*|clean ?up|lint\w*|format\w*|ci|tests?|release|revert\w*|translations?|i18n|l10n|changelog|security patch)\b/i;
const BAD_LABEL = /^(bug|type: ?bug|kind\/bug|dependencies|deps|documentation|docs|chore|refactor|ci|release|translation|i18n|security)$/i;
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function repos(out: string, io: Io): number {
  const file = join(out, "repos.jsonl");
  const seen = new Set<string>(existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).repo) : []);
  let added = 0;
  for (const [type, topics] of Object.entries(TOPICS) as [ProjectType, string[]][]) {
    for (const topic of topics) {
      searchTopic((path) => rest<any>(path), { topic, stars: ">=" + MIN_STARS, pushedSince: FRAME.from, maxPages: 2, paceMs: 2_200 }, (items) => {
        for (const it of items) {
          const spdx = it.license?.spdx_id;
          if (!LICENCES.has(spdx) || seen.has(it.full_name)) continue;
          seen.add(it.full_name);
          appendFileSync(file, JSON.stringify({ repo: it.full_name, stars: it.stargazers_count, licence: spdx, type_prov: type, topic, order: order(it.full_name) }) + "\n");
          added++;
        }
      });
    }
  }
  io.out("pv mine repos: " + added + " added, " + seen.size + " in repos.jsonl");
  return 0;
}

const Q = `query($q1:String!, $q2:String!, $owner:String!, $name:String!) {
  prs: search(query:$q1, type:ISSUE, first:50) { nodes { ... on PullRequest { number title createdAt mergedAt bodyText authorAssociation labels(first:10){nodes{name}} } } }
  issues: search(query:$q2, type:ISSUE, first:50) { nodes { ... on Issue { number title createdAt closedAt bodyText authorAssociation labels(first:10){nodes{name}} closedByPullRequestsReferences(first:3, includeClosedPrs:false){ nodes { number merged mergedAt } } } } }
  repository(owner:$owner, name:$name) { releases(first:100, orderBy:{field:CREATED_AT, direction:DESC}) { nodes { tagName publishedAt isDraft isPrerelease } } }
  rateLimit { cost remaining resetAt }
}`;

function records(out: string, argv: string[], io: Io): number {
  const limit = Number(flag(argv, "--repos") ?? "100000");
  const typeOnly = flag(argv, "--type");
  const rows = readFileSync(join(out, "repos.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => !typeOnly || r.type_prov === typeOnly).sort((a, b) => (a.order < b.order ? -1 : 1));
  const doneFile = join(out, "repos-done.txt");
  const done = new Set(existsSync(doneFile) ? readFileSync(doneFile, "utf8").split("\n").filter(Boolean) : []);
  const before = graphqlLeft();
  let n = 0, kept = 0;
  for (const r of rows) {
    if (n >= limit) break;
    if (done.has(r.repo)) continue;
    n++;
    const [owner, name] = r.repo.split("/");
    const d = graphql<any>(Q, { owner, name, q1: "repo:" + r.repo + " is:pr is:merged created:>=" + FRAME.from + " merged:" + FRAME.from + ".." + FRAME.plansTo, q2: "repo:" + r.repo + " is:issue is:closed reason:completed created:" + FRAME.from + ".." + FRAME.plansTo });
    const releases = (d.repository?.releases?.nodes ?? []).filter((x: any) => !x.isDraft && x.publishedAt).sort((a: any, b: any) => (a.publishedAt < b.publishedAt ? -1 : 1));
    const shipped = (merged: string) => releases.find((x: any) => x.publishedAt >= merged);
    const found: any[] = [];
    const ok = (title: string, labels: any) => !BAD_TITLE.test(title) && !(labels?.nodes ?? []).some((l: any) => BAD_LABEL.test(l.name));
    for (const p of d.prs?.nodes ?? []) {
      if (!p?.number || !ok(p.title, p.labels) || words(p.bodyText ?? "") < MIN_WORDS) continue;
      found.push({ number: p.number, kind: "pr-as-plan", created_at: p.createdAt, merged_at: p.mergedAt, assoc: p.authorAssociation });
    }
    for (const i of d.issues?.nodes ?? []) {
      if (!i?.number || !ok(i.title, i.labels) || words(i.bodyText ?? "") < MIN_WORDS) continue;
      const pr = (i.closedByPullRequestsReferences?.nodes ?? []).filter((x: any) => x.merged && x.mergedAt <= FRAME.plansTo + "T23:59:59Z").sort((a: any, b: any) => (a.mergedAt < b.mergedAt ? -1 : 1))[0];
      if (!pr) continue;
      found.push({ number: i.number, kind: ["OWNER", "MEMBER", "COLLABORATOR"].includes(i.authorAssociation) ? "plan" : "accepted-outside", created_at: i.createdAt, merged_at: pr.mergedAt, closing_pr: pr.number, assoc: i.authorAssociation });
    }
    const per = r.type_prov === "consumer" || r.type_prov === "mobile" ? 3 : 2;
    const rec = found
      .map((f) => {
        const rel = shipped(f.merged_at);
        if (!rel || rel.publishedAt > FRAME.shippedBy + "T23:59:59Z") return null;
        const id = r.repo + "#" + f.number;
        return { id, repo: r.repo, type_prov: r.type_prov, stars: r.stars, licence: r.licence, ...f, release_tag: rel.tagName, release_prerelease: rel.isPrerelease, release_at: rel.publishedAt, window_close: addDays(rel.publishedAt, WINDOW_DAYS), wave: rel.publishedAt <= FRAME.closedBy + "T23:59:59Z" ? "closed" : "b", order: order(id) };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (a.order < b.order ? -1 : 1))
      .slice(0, per);
    for (const x of rec) appendFileSync(join(out, "records.jsonl"), JSON.stringify(x) + "\n");
    kept += rec.length;
    appendFileSync(doneFile, r.repo + "\n");
  }
  const after = graphqlLeft();
  appendFileSync(join(out, "mine.log"), JSON.stringify({ at: new Date().toISOString(), repos: n, kept, points: pointsUsed(), graphql_before: before.remaining, graphql_after: after.remaining }) + "\n");
  io.out("pv mine records: " + n + " repositories read, " + kept + " records kept, " + pointsUsed() + " GraphQL points (left " + after.remaining + ")");
  return 0;
}

export async function run(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest_] = argv;
  const out = flag(rest_, "--out");
  if (!out) throw Object.assign(new Error("pv mine needs --out <dir on tmpfs>"), { code: "E_USAGE" });
  mkdirSync(out, { recursive: true, mode: 0o700 });
  if (sub === "repos") return repos(out, io);
  if (sub === "records") return records(out, rest_, io);
  throw Object.assign(new Error("pv mine repos|records --out <dir>"), { code: "E_USAGE" });
}
