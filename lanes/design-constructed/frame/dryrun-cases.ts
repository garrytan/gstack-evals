// Copyright (c) 2026 Garry Tan. MIT License.
// The frame area's dry-run cases (build plan sections 8 and 15; addendum R2-1 and R2-19; Captain rulings A1 and C1):
// the search's query and pacing, every entry-filter edge, the frame order, the owner dedupe, the clone limits, an
// unfetchable oid, each file-check test both ways and the route matcher on every R2-19 case, all on invented fixtures.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRAME } from "../frozen.ts";
import { DcError } from "../errors.ts";
import type { DryRunCase } from "../types.ts";
import { customProperties, designKind, fileCheck, type FileCheck } from "./filecheck.ts";
import { buildFrame, firstFailed, frameKey, readmeTitle } from "./filters.ts";
import { cssVars, failingApp, fakeGh, node, PASSING_APP, writeTree } from "./fixtures.ts";
import { openGitHub } from "./gh.ts";
import { fetchAt } from "./git.ts";
import { discoverRoutes, distinctRoutes, matchingRoutes, matchRoute, type Router } from "./routes.ts";
import { cloneLimits, runFrame, type FrameSeams } from "./run.ts";
import { buildSearchQuery, readNode, runSearch, SEARCH_QUERY, searchQueries } from "./search.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "dc-frame-dry-"));
const expect = (ok: boolean, why: string): string | null => (ok ? null : why);
const repo = (name: string, o: Record<string, unknown> = {}) => readNode(node(name, o), "fixture");
const topics = (...t: string[]) => ({ repositoryTopics: { nodes: t.map((name) => ({ topic: { name } })) } });
const readme = (text: string) => ({ readmeMd: { text } });

/** One entry-filter edge: the overrides and whether the repository stays in. */
const FILTER_EDGES: { name: string; o: Record<string, unknown>; in: boolean }[] = [
  { name: "stars 199 leaves", o: { stargazerCount: 199 }, in: false },
  { name: "stars 200 stays", o: { stargazerCount: 200 }, in: true },
  { name: "pushed 2026-05-31 leaves", o: { pushedAt: "2026-05-31T23:59:59Z" }, in: false },
  { name: "pushed 2026-06-01 stays", o: { pushedAt: "2026-06-01T00:00:00Z" }, in: true },
  ...FRAME.licenses.flatMap((l) => [
    { name: "licence " + l + " lowercase stays", o: { licenseInfo: { spdxId: l } }, in: true },
    { name: "licence " + l + " uppercase stays", o: { licenseInfo: { spdxId: l.toUpperCase() } }, in: true },
  ]),
  { name: "licence GPL-3.0 leaves", o: { licenseInfo: { spdxId: "GPL-3.0" } }, in: false },
  { name: "licence NOASSERTION leaves", o: { licenseInfo: { spdxId: "NOASSERTION" } }, in: false },
  { name: "no licence leaves", o: { licenseInfo: null }, in: false },
  ...FRAME.languages.map((l) => ({ name: "language " + l + " stays", o: { primaryLanguage: { name: l } }, in: true })),
  { name: "language Python leaves", o: { primaryLanguage: { name: "Python" } }, in: false },
  { name: "no primary language leaves", o: { primaryLanguage: null }, in: false },
  { name: "topic word template leaves", o: topics("crm", "nextjs-template"), in: false },
  { name: "topic word starter leaves", o: topics("starter"), in: false },
  { name: "topic word boilerplate leaves", o: topics("vue-boilerplate"), in: false },
  { name: "topic word uikit leaves", o: topics("react-uikit"), in: false },
  { name: "topic pair ui kit leaves", o: topics("ui-kit"), in: false },
  { name: "topic pair component library leaves", o: topics("vue-component-library"), in: false },
  { name: "topic templates (not a whole word) stays", o: topics("templates", "starterkit"), in: true },
  { name: "readme title template leaves", o: readme("# Ledger Template\n"), in: false },
  { name: "readme title starter leaves", o: readme("Intro line\n\n## The Starter for desks\n"), in: false },
  { name: "readme title boilerplate leaves", o: readme("Desk Boilerplate\n================\n"), in: false },
  { name: "readme title ui kit leaves", o: readme("# Plum UI-Kit\n"), in: false },
  { name: "readme title component library leaves", o: readme("# A Component Library for desks\n"), in: false },
  { name: "readme title starts the file when it has no heading", o: readme("\nStarter desk for invented teams\nmore\n"), in: false },
  { name: "readme words below the title don't count", o: readme("# Orchard Desk\n\nNot a template.\n"), in: true },
  { name: "a heading inside fenced code is not the title", o: readme("```\n# starter\n```\n# Orchard Desk\n"), in: true },
  { name: "readme title uikit (not a title word) stays", o: readme("# Plum UIKit Desk\n"), in: true },
  { name: "readme.md is read when README.md is absent", o: { readmeMd: null, readmeLower: { text: "# Orchard Starter\n" } }, in: false },
  { name: "no readme stays", o: { readmeMd: null }, in: true },
  { name: "a centred HTML h1 saying template is the title and leaves, over a later Markdown heading", o: readme('<p align="center"><img src="logo.svg" alt="logo"></p>\n<h1 align="center">Orchard Template</h1>\n\n## Features\n'), in: false },
  { name: "an HTML h1 over several lines is read to its close", o: readme("<h1>\n  Orchard Boilerplate\n</h1>\n\n# Later\n"), in: false },
  { name: "an image URL and alt text inside the HTML h1 don't count", o: readme('<h1 align="center"><img src="https://cdn.example.invalid/template.svg" alt="starter template"> Orchard Desk</h1>\n'), in: true },
  { name: "a Markdown image's alt text and URL in the heading don't count", o: readme("# ![starter template](https://cdn.example.invalid/template.png) Orchard Desk\n"), in: true },
  { name: "with no heading, a badge line as the first line is read the same way", o: readme("[![build](https://ci.example.invalid/template/badge.svg)](https://ci.example.invalid)\n\nOrchard desk for invented teams\n"), in: true },
  { name: "a fork leaves", o: { isFork: true }, in: false },
  { name: "an archive leaves", o: { isArchived: true }, in: false },
  { name: "a template leaves", o: { isTemplate: true }, in: false },
  { name: "a private repository leaves", o: { isPrivate: true }, in: false },
];

/** A fake frame run in a fresh out folder: invented search pages, clones written from trees, a clean lane. */
function fakeRun(byQ: Record<string, unknown[]>, trees: (name: string) => Record<string, string> | null, o: { out?: string; dirty?: boolean; root?: string; bound?: "sessions" | "clones"; check?: (d: string) => FileCheck } = {}) {
  const gh = fakeGh(byQ);
  const cloned: string[] = [];
  const seams: FrameSeams = {
    gh: gh.exec,
    sleep: gh.sleep,
    now: gh.now,
    clone: (name, _oid, dest) => {
      cloned.push(name);
      const t = trees(name);
      if (!t) throw new Error("fatal: remote error: upload-pack: not our ref");
      writeTree(t, dest);
    },
    lane: () => ({ commit: "0".repeat(40), dirty: o.dirty ?? false, root: o.root ?? "/nonexistent-lane-root" }),
    check: o.check ?? fileCheck,
  };
  const out = o.out ?? tmp();
  return { out, gh, cloned, run: () => runFrame(out, seams, o.bound) };
}

/** n invented frame repositories, all on the first query's page. */
const manyRepos = (n: number) => ({ [buildSearchQuery(FRAME.topics[0], FRAME.licenses[0]).variables.q]: Array.from({ length: n }, (_, i) => node("owner" + i + "/desk" + i)) });

const neverPass: FileCheck = { frontEnd: false, components: false, designSystem: false, routes: false, pass: false, frameworks: [], componentFolder: null, designSource: null, routeCount: 0, routeSets: [] };

function gitRepo(): { dir: string; first: string; second: string } {
  const dir = tmp();
  const g = (...a: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...a], { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  g("init", "-q");
  writeTree({ "a.txt": "one\n" }, dir);
  g("add", "a.txt");
  g("commit", "-q", "-m", "one");
  const first = g("rev-parse", "HEAD");
  writeTree({ "a.txt": "two\n" }, dir);
  g("commit", "-q", "-am", "two");
  return { dir, first, second: g("rev-parse", "HEAD") };
}

/** Per-router fixtures: the files, the paths that must match a discovered route and one that must not. */
const ROUTER_FIXTURES: { router: Router; files: Record<string, string>; hit: string[]; miss: string }[] = [
  {
    router: "next-pages",
    files: { "package.json": JSON.stringify({ dependencies: { next: "14.2.0" } }), "pages/index.tsx": "", "pages/_app.tsx": "", "pages/api/x.ts": "", "pages/accounts/[id].tsx": "", "pages/docs/[...slug].tsx": "" },
    hit: ["/", "/accounts/7/", "/docs/a/b"],
    miss: "/docs",
  },
  {
    router: "next-app",
    files: { "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }), "app/page.tsx": "", "app/(shop)/orders/page.tsx": "", "app/orders/[id]/page.tsx": "", "app/@modal/(.)orders/[id]/page.tsx": "", "app/_lib/page.tsx": "" },
    hit: ["/orders", "/orders/9"],
    miss: "/shop/orders",
  },
  {
    router: "sveltekit",
    files: { "package.json": JSON.stringify({ devDependencies: { "@sveltejs/kit": "2.0.0" } }), "svelte.config.js": "export default { kit: { paths: { base: '/desk' } } };", "src/routes/+page.svelte": "", "src/routes/(app)/inbox/+page.svelte": "", "src/routes/inbox/[id]/+page.svelte": "" },
    hit: ["/desk/inbox", "/desk/inbox/3", "/inbox"],
    miss: "/desk/inbox/3/4",
  },
  {
    router: "nuxt",
    files: { "package.json": JSON.stringify({ dependencies: { nuxt: "^3.12.0" } }), "pages/index.vue": "", "pages/users/[id].vue": "", "pages/files/[...path].vue": "" },
    hit: ["/", "/users/2", "/files/a"],
    miss: "/users",
  },
  {
    router: "react-router",
    files: {
      "package.json": JSON.stringify({ dependencies: { "react-router-dom": "6.26.0" } }),
      "src/App.tsx": 'import { HashRouter, Routes, Route, Navigate } from "react-router-dom";\nexport default () => (<HashRouter><Routes><Route path="/" element={<Shell />}><Route index element={<Home />} /><Route path="leads/:leadId" element={<Lead />} /><Route path="settings" element={<Settings />} /><Route path="old" element={<Navigate to="/" />} /><Route path="*" element={<Missing />} /></Route></Routes></HashRouter>);\n',
    },
    hit: ["/#/", "/#/leads/12", "/#/settings/"],
    miss: "/#/old",
  },
  {
    router: "vue-router",
    files: {
      "package.json": JSON.stringify({ dependencies: { "vue-router": "4.4.0" } }),
      "src/router/index.ts": "import { createRouter, createWebHistory } from 'vue-router';\nexport default createRouter({ history: createWebHistory('/ops/'), routes: [{ path: '/', component: () => import('../Home.vue') }, { path: '/stock', component: Stock, children: [{ path: ':sku', component: Item }] }, { path: '/:pathMatch(.*)*', component: Missing }] });\n",
    },
    hit: ["/ops/stock/", "/ops/stock/A1", "/stock"],
    miss: "/ops/nothing",
  },
  {
    router: "angular",
    files: {
      "package.json": JSON.stringify({ dependencies: { "@angular/core": "18.0.0", "@angular/router": "18.0.0" } }),
      "src/app/app.routes.ts": "import { Routes } from '@angular/router';\nexport const routes: Routes = [{ path: '', component: HomeComponent }, { path: 'bookings', component: BookingsComponent, children: [{ path: ':id', component: BookingComponent }] }, { path: 'old', redirectTo: 'bookings' }, { path: '**', component: MissingComponent }];\n",
    },
    hit: ["/", "/bookings", "/bookings/5"],
    miss: "/old",
  },
];

export function cases(): DryRunCase[] {
  const out: DryRunCase[] = [];

  // ---- Search
  out.push({
    rule: "S8-search",
    name: "the query builder gives the frozen search string and the fields section 8 lists",
    check: () => {
      const q = buildSearchQuery("helpdesk", "bsd-2-clause");
      const fields = ["first: 100", "nameWithOwner", "isPrivate", "isFork", "isArchived", "isTemplate", "stargazerCount", "pushedAt", "licenseInfo { spdxId }", "primaryLanguage { name }", "repositoryTopics(first: 20)", "defaultBranchRef { name target { oid } }", '"HEAD:README.md"', '"HEAD:readme.md"', '"HEAD:Readme.md"', '"HEAD:README"', "rateLimit { cost"];
      return expect(q.variables.q === "topic:helpdesk license:bsd-2-clause sort:stars" && fields.every((f) => SEARCH_QUERY.includes(f)), "query " + q.variables.q);
    },
  });
  out.push({
    rule: "S8-search",
    name: "50 distinct queries, 10 topics times 5 licences",
    check: () => {
      const qs = searchQueries();
      return expect(qs.length === 50 && new Set(qs.map((q) => q.variables.q)).size === 50 && new Set(qs.map((q) => q.digest)).size === 50, qs.length + " queries");
    },
  });
  out.push({
    rule: "S8-search",
    name: "concurrency 1 with at least 3 seconds between requests, each cost recorded, a rerun answered from the cache",
    check: () => {
      const dir = tmp();
      try {
        const gh = fakeGh(manyRepos(3));
        const client = openGitHub({ floor: 1000, tries: 1, backoffMs: () => 0, paceMs: FRAME.requestGapMs, exec: gh.exec, sleep: gh.sleep, now: gh.now });
        const first = runSearch(client, dir);
        const starts = gh.log.map((l) => l.at);
        const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
        const again = runSearch(client, dir);
        if (gaps.some((g) => g < FRAME.requestGapMs)) return "a gap under 3 s: " + Math.min(...gaps);
        if (first.queries.some((q) => q.cached || q.cost !== 1)) return "first run costs not recorded";
        if (gh.log.length !== 50) return gh.log.length + " calls on the first run";
        return expect(again.queries.every((q) => q.cached) && gh.log.length === 50 && JSON.stringify(again.repos) === JSON.stringify(first.repos), "the rerun called GitHub or read different repos");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  });
  out.push({
    rule: "S8-search",
    name: "a reply carrying an error is refused and never cached",
    check: () => {
      const dir = tmp();
      try {
        const q0 = searchQueries()[0]!;
        const gh = fakeGh({}, { failQ: [q0.variables.q] });
        const client = openGitHub({ floor: 1000, tries: 1, backoffMs: () => 0, paceMs: 0, exec: gh.exec, sleep: gh.sleep, now: gh.now });
        try {
          runSearch(client, dir, [q0]);
          return "the error reply was accepted";
        } catch {
          return expect(!existsSync(join(dir, q0.digest + ".json")), "the error reply was cached");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  });
  out.push({
    rule: "S8-search",
    name: "a repository two queries return is kept once, read from the first",
    check: () => {
      const dir = tmp();
      try {
        const [a, b] = searchQueries();
        const gh = fakeGh({ [a!.variables.q]: [node("acme/alpha", { stargazerCount: 300 })], [b!.variables.q]: [node("acme/alpha", { stargazerCount: 900 })] });
        const r = runSearch(openGitHub({ floor: 0, tries: 1, backoffMs: () => 0, paceMs: 0, exec: gh.exec, sleep: gh.sleep, now: gh.now }), dir, [a!, b!]);
        return expect(r.returned === 2 && r.repos.length === 1 && r.repos[0]!.stars === 300, JSON.stringify(r.repos.map((x) => x.stars)));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  });

  // ---- Entry filters
  for (const e of FILTER_EDGES) {
    out.push({ rule: "S8-filter", name: e.name, check: () => {
      const failed = firstFailed(repo("acme/alpha", e.o));
      return expect((failed === null) === e.in, "first failed filter: " + failed);
    } });
  }
  out.push({
    rule: "S8-filter",
    name: "the README title is the first Markdown heading or HTML h1, else the first non-empty line, visible text only",
    check: () => {
      const cases: [string, string | null][] = [["# Plum Desk #\nbody", "Plum Desk"], ["intro\n\nPlum Desk\n---\n", "Plum Desk"], ["- item\n---\n\n## Real\n", "Real"], ["\n\n  first line  \nnext", "first line"], ["", null], ["#hashtag\n# [Plum](https://example.invalid/template) Desk", "Plum Desk"]];
      const bad = cases.filter(([t, want]) => readmeTitle(t) !== want);
      return expect(bad.length === 0, JSON.stringify(bad.map(([t]) => [t, readmeTitle(t)])));
    },
  });

  // ---- Frame order and the owner dedupe
  out.push({
    rule: "S8-order",
    name: "the frame orders by sha256 of 20261114, a newline and nameWithOwner, hex ascending",
    check: () => {
      const names = ["beta-labs/console", "acme/alpha", "epsilon/ops-panel", "Gamma/crm-app", "delta/helpdesk"];
      const f = buildFrame(names.map((n) => repo(n)));
      const want = ["acme/alpha", "Gamma/crm-app", "delta/helpdesk", "epsilon/ops-panel", "beta-labs/console"];
      return expect(frameKey("acme/alpha").startsWith("1c3e210e217cac81") && JSON.stringify(f.frame.map((e) => e.nameWithOwner)) === JSON.stringify(want) && f.frame.every((e, i) => e.position === i + 1), JSON.stringify(f.frame.map((e) => e.nameWithOwner)));
    },
  });
  out.push({
    rule: "S8-order",
    name: "the order doesn't depend on the order the search returned repositories",
    check: () => {
      const names = ["beta-labs/console", "acme/alpha", "epsilon/ops-panel", "Gamma/crm-app", "delta/helpdesk"];
      const a = buildFrame(names.map((n) => repo(n))).frame.map((e) => e.nameWithOwner);
      const b = buildFrame([...names].reverse().map((n) => repo(n))).frame.map((e) => e.nameWithOwner);
      return expect(JSON.stringify(a) === JSON.stringify(b), "orders differ");
    },
  });
  out.push({
    rule: "S8-dedupe",
    name: "every repository after an owner's first in frame order leaves, owners compared case-insensitively",
    check: () => {
      const names = ["Acme/alpha", "acme/bravo", "ACME/charlie", "other/desk"];
      const f = buildFrame(names.map((n) => repo(n)));
      const ordered = [...names].sort((x, y) => (frameKey(x) < frameKey(y) ? -1 : 1));
      const firstAcme = ordered.find((n) => n.toLowerCase().startsWith("acme/"))!;
      const kept = f.frame.map((e) => e.nameWithOwner);
      const dropped = f.outcome.filter((x) => x.left_at === "owner dedupe").length;
      return expect(f.ordered === 4 && kept.length === 2 && kept.includes(firstAcme) && kept.includes("other/desk") && dropped === 2, JSON.stringify(kept));
    },
  });
  out.push({
    rule: "S8-dedupe",
    name: "the owner dedupe runs after every entry filter, so a filtered repository never holds its owner's place",
    check: () => {
      const names = ["acme/alpha", "acme/bravo"];
      const first = names.sort((x, y) => (frameKey(x) < frameKey(y) ? -1 : 1))[0]!;
      const second = names.find((n) => n !== first)!;
      const f = buildFrame([repo(first, { isFork: true }), repo(second)]);
      return expect(f.frame.length === 1 && f.frame[0]!.nameWithOwner === second, JSON.stringify(f.frame));
    },
  });

  // ---- Clones
  for (const n of [100, 101]) {
    out.push({
      rule: "A1-clones",
      name: "clone limit with " + n + " frame repositories: at most 100 attempts",
      check: () => {
        const f = fakeRun(manyRepos(n), () => ({ "README.md": "x" }), { check: () => neverPass });
        try {
          const r = f.run();
          const clones = JSON.parse(readFileSync(join(f.out, "clones.json"), "utf8"));
          return expect(clones.length === 100 && f.cloned.length === 100 && new Set(f.cloned).size === 100 && r.lines.some((l) => l.startsWith("clone attempts: 100 (limit 100)")), clones.length + " attempts");
        } finally {
          rmSync(f.out, { recursive: true, force: true });
        }
      },
    });
  }
  out.push({
    rule: "A1-clones",
    name: "the walk stops once 30 candidates pass the file check, the most recipe sessions A1 allows",
    check: () => {
      const f = fakeRun(manyRepos(40), () => ({ "README.md": "x" }), { check: () => ({ ...neverPass, pass: true }) });
      try {
        f.run();
        return expect(f.cloned.length === 30, f.cloned.length + " clones");
      } finally {
        rmSync(f.out, { recursive: true, force: true });
      }
    },
  });
  out.push({
    rule: "R2-1",
    name: "the other reading bounds clones at 30; A1's sessions reading is the default",
    check: () => {
      const f = fakeRun(manyRepos(40), () => ({ "README.md": "x" }), { check: () => neverPass, bound: "clones" });
      try {
        f.run();
        const d = cloneLimits("sessions");
        return expect(f.cloned.length === 30 && d.attempts === 100 && d.passes === 30, f.cloned.length + " clones");
      } finally {
        rmSync(f.out, { recursive: true, force: true });
      }
    },
  });
  out.push({
    rule: "S8-clone",
    name: "an oid that can't be fetched counts as a clone attempt, leaves the frame, prints its position and gets no file check",
    check: () => {
      const f = fakeRun(manyRepos(3), (name) => (name === "owner1/desk1" ? null : PASSING_APP));
      try {
        const r = f.run();
        const clones = JSON.parse(readFileSync(join(f.out, "clones.json"), "utf8"));
        const checks = JSON.parse(readFileSync(join(f.out, "filecheck.json"), "utf8"));
        const bad = clones.find((c: any) => c.nameWithOwner === "owner1/desk1");
        return expect(clones.length === 3 && !bad.fetched && /can't be fetched/.test(bad.reason) && checks.length === 2 && r.lines.includes("unfetchable: frame position " + bad.position + " leaves the frame") && r.lines.some((l) => l.includes("all four 2")), JSON.stringify(r.lines));
      } finally {
        rmSync(f.out, { recursive: true, force: true });
      }
    },
  });
  out.push({
    rule: "S8-clone",
    name: "the real fetch takes the recorded oid at depth 1, not the branch tip, and an unknown oid fails with nothing left",
    check: () => {
      const g = gitRepo();
      const parents = [tmp(), tmp(), tmp()];
      const [dest, bad, plain] = parents.map((d) => join(d, "clone")) as [string, string, string];
      try {
        fetchAt("file://" + g.dir, g.first, dest, ["file"]);
        const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dest, encoding: "utf8" }).stdout.trim();
        const count = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: dest, encoding: "utf8" }).stdout.trim();
        const text = readFileSync(join(dest, "a.txt"), "utf8");
        let refused = false;
        try {
          fetchAt("file://" + g.dir, "f".repeat(40), bad, ["file"]);
        } catch {
          refused = true;
        }
        let httpsOnly = false;
        try {
          fetchAt("file://" + g.dir, g.first, plain);
        } catch {
          httpsOnly = true;
        }
        return expect(head === g.first && count === "1" && text === "one\n" && refused && !existsSync(bad) && httpsOnly, [head, count, refused, httpsOnly].join(" "));
      } finally {
        for (const d of [g.dir, ...parents]) rmSync(d, { recursive: true, force: true });
      }
    },
  });
  out.push({
    rule: "S8-clone",
    name: "a relaunch reuses the cache, never retries a failed clone and keeps one commit",
    check: () => {
      const f = fakeRun(manyRepos(2), (name) => (name === "owner0/desk0" ? null : PASSING_APP));
      try {
        try {
          f.run();
        } catch {}
        rmSync(join(f.out, "run.json"));
        const again = fakeRun(manyRepos(2), () => PASSING_APP, { out: f.out });
        const r = again.run();
        const graphql = again.gh.log.filter((l) => l.kind === "graphql").length;
        return expect(graphql === 0 && !again.cloned.includes("owner0/desk0") && r.lines.some((l) => l.startsWith("queries: 50 (50 from cache, 0 from GitHub)")), "graphql " + graphql + ", cloned " + again.cloned.join(","));
      } finally {
        rmSync(f.out, { recursive: true, force: true });
      }
    },
  });

  // ---- File check
  const fc = (files: Record<string, string>) => {
    const dir = writeTree(files);
    try {
      return fileCheck(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const TESTS: [1 | 2 | 3 | 4, keyof FileCheck, string][] = [
    [1, "frontEnd", "a package.json naming react, vue, svelte or @angular/core"],
    [2, "components", "10 component files directly in one folder"],
    [3, "designSystem", "a design-system source"],
    [4, "routes", "3 distinct routes"],
  ];
  for (const [n, key, what] of TESTS) {
    out.push({ rule: "S8-filecheck", name: "test " + n + " passes with " + what, check: () => expect(fc(PASSING_APP)[key] === true, "failed") });
    out.push({ rule: "S8-filecheck", name: "test " + n + " fails without " + what, check: () => {
      const r = fc(failingApp(n));
      return expect(r[key] === false && !r.pass && TESTS.filter(([m]) => m !== n).every(([, k]) => r[k] === true), JSON.stringify({ [key]: r[key], pass: r.pass }));
    } });
  }
  out.push({ rule: "S8-filecheck", name: "all four pass on the passing fixture", check: () => expect(fc(PASSING_APP).pass, "failed") });
  out.push({
    rule: "S8-filecheck",
    name: "a package.json under node_modules and test or story files don't count",
    check: () => {
      const t: Record<string, string> = { ...failingApp(1), "node_modules/react/package.json": JSON.stringify({ dependencies: { react: "19.0.0" } }), "src/components/Panel9.test.tsx": "", "src/components/Panel9.stories.tsx": "" };
      delete t["src/components/Panel9.tsx"];
      const r = fc(t);
      return expect(!r.frontEnd && !r.components && r.componentFolder?.count === 9, JSON.stringify({ fe: r.frontEnd, c: r.componentFolder }));
    },
  });
  out.push({
    rule: "S8-filecheck",
    name: "each design-system source: theme.*, tokens.*, *.tokens.json, Tailwind theme.extend, 20 custom properties, DESIGN.md",
    check: () => {
      const dir = writeTree({
        "a/theme.scss": "",
        "b/tokens.ts": "",
        "c/brand.tokens.json": "{}",
        "d/tailwind.config.ts": "import type { Config } from 'tailwindcss';\nexport default { content: [], theme: { extend: { colors: {} } } } satisfies Config;\n",
        "e/tailwind.config.js": "module.exports = { theme: { colors: {} }, plugins: [] };\n",
        "f/vars.css": cssVars(20),
        "g/vars.scss": cssVars(19) + "// --not-a-declaration: 1;\n/* --nor-this: 2; */\n",
        "h/DESIGN.md": "# Design\n",
      });
      try {
        const kinds = ["a/theme.scss", "b/tokens.ts", "c/brand.tokens.json", "d/tailwind.config.ts", "e/tailwind.config.js", "f/vars.css", "g/vars.scss", "h/DESIGN.md"].map((f) => designKind(dir, f));
        const want = ["theme", "tokens", "tokens", "tailwind", null, "css", null, "design-md"];
        return expect(JSON.stringify(kinds) === JSON.stringify(want) && customProperties(cssVars(20), false) === 20, JSON.stringify(kinds));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  });

  // ---- Route discovery and R2-19's matcher
  const R219: [string, string, { hash?: boolean; basePath?: string }, boolean][] = [
    ["/accounts/7", "/accounts/[id]", {}, true],
    ["/accounts/7", "/accounts/:id", {}, true],
    ["/accounts", "/accounts/[id]", {}, false],
    ["/accounts//", "/accounts/:id", {}, false],
    ["/accounts/7/notes", "/accounts/[id]", {}, false],
    ["/docs/a", "/docs/[...slug]", {}, true],
    ["/docs/a/b/c", "/docs/[...slug]", {}, true],
    ["/docs", "/docs/[...slug]", {}, false],
    ["/orders", "/(shop)/orders", {}, true],
    ["/desk/orders", "/orders", { basePath: "/desk" }, true],
    ["/desk/orders", "/orders", { basePath: "/desk/" }, true],
    ["/orders", "/orders", { basePath: "/desk" }, true],
    ["/orders/", "/orders", {}, true],
    ["/orders", "/orders/", {}, true],
    ["/#/orders/3", "/orders/:id", { hash: true }, true],
    ["/#!/orders/3", "/orders/:id", { hash: true }, true],
    ["/orders/3", "/orders/:id", { hash: true }, false],
    ["/#/orders/3", "/orders/:id", {}, false],
    ["http://localhost:3000/desk/orders/3?tab=1", "/orders/[id]", { basePath: "/desk" }, true],
  ];
  for (const [path, pattern, o, want] of R219) {
    out.push({ rule: "R2-19", name: (want ? "matches " : "doesn't match ") + path + " against " + pattern + (o.hash ? " (hash)" : "") + (o.basePath ? " (base " + o.basePath + ")" : ""), check: () => expect(matchRoute(path, pattern, o) === want, "got " + !want) });
  }
  out.push({
    rule: "R2-19",
    name: "a static route ranks before a dynamic one, and two routers' names for one route count once",
    check: () => {
      const sets = [{ router: "next-pages" as const, root: "", patterns: ["/users/[id]", "/users/new"], hash: false, basePath: null }, { router: "react-router" as const, root: "web", patterns: ["/users/:userId"], hash: false, basePath: null }];
      const m = matchingRoutes("/users/new", sets);
      return expect(JSON.stringify(m) === JSON.stringify(["/users/new", "/users/:"]) && distinctRoutes(sets).length === 2, JSON.stringify(m));
    },
  });
  for (const fx of ROUTER_FIXTURES) {
    out.push({
      rule: "R2-19",
      name: fx.router + ": discovery finds its routes and the matcher reads them",
      check: () => {
        const dir = writeTree(fx.files);
        try {
          const sets = discoverRoutes(dir).filter((s) => s.router === fx.router);
          if (sets.length !== 1) return sets.length + " " + fx.router + " sets";
          const misses = fx.hit.filter((p) => matchingRoutes(p, sets).length === 0);
          return expect(misses.length === 0 && matchingRoutes(fx.miss, sets).length === 0 && distinctRoutes(sets).length >= 3, "patterns " + JSON.stringify(sets[0]!.patterns) + ", unmatched " + JSON.stringify(misses));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    });
  }

  // ---- The run record and C1
  out.push({
    rule: "C1-run",
    name: "an end-to-end run prints only counts and digests and records the lane commit",
    check: () => {
      const f = fakeRun(manyRepos(4), () => PASSING_APP);
      try {
        const r = f.run();
        const run = JSON.parse(readFileSync(join(f.out, "run.json"), "utf8"));
        const leaks = r.lines.filter((l) => /owner\d|desk\d/.test(l));
        const rl = f.gh.log.filter((l) => l.kind === "rate_limit").length;
        return expect(leaks.length === 0 && run.lane_commit === "0".repeat(40) && rl === 2 && r.lines.some((l) => /points used: 50$/.test(l)) && ["search.json", "entry.json", "frame.json", "clones.json", "filecheck.json", "run.json"].every((n) => r.lines.some((l) => l.startsWith("sha256 " + n + " "))), JSON.stringify(r.lines));
      } finally {
        rmSync(f.out, { recursive: true, force: true });
      }
    },
  });
  const refuses = (name: string, o: Parameters<typeof fakeRun>[2], pre?: (out: string) => void) =>
    out.push({
      rule: "C1-run",
      name,
      check: () => {
        const f = fakeRun({}, () => PASSING_APP, o);
        try {
          pre?.(f.out);
          f.run();
          return "it ran";
        } catch (e) {
          return expect(e instanceof DcError && e.code === "E_USAGE" && f.gh.log.length === 0, String((e as Error).message));
        } finally {
          rmSync(f.out, { recursive: true, force: true });
        }
      },
    });
  refuses("a dirty tree is refused before any GitHub call", { dirty: true });
  const inside = join(tmpdir(), "dc-frame-dry-lane-root");
  refuses("an out folder inside the repository is refused", { out: join(inside, "sealed"), root: inside });
  refuses("a finished run in the out folder is refused: the frame runs once", {}, (o) => writeTree({ "run.json": "{}" }, o));
  return out;
}
