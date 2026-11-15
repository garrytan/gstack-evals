// Copyright (c) 2026 Garry Tan. MIT License.
// Part B miners, keyless: the exclusion, licence, window and file-count screens over planted rows, and the B1 statement
// read through a stub GraphQL client.
import { describe, expect, test } from "bun:test";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { b1Counts, isBrowserTest, screenPr, screenRepos, statementText, type PrNode, type RepoRow } from "../../lanes/outcome-skills/h2h/breadth/b1.ts";
import { newDrops, readAdvisory, screenAdvisories, screenFiles, screenLicences, type Advisory, type LicencedCandidate } from "../../lanes/outcome-skills/h2h/breadth/b2.ts";
import { excludedBy, licenceStatus, secondReadVerdict, sha256, windows, type Gql } from "../../lanes/outcome-skills/h2h/breadth/frame.ts";
import { commands } from "../../lanes/outcome-skills/h2h/breadth/commands.ts";
import type { SecondRead } from "../../lanes/outcome-skills/h2h/ordinary/frame.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b1Statement, candidateOf } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";

const p = readPrereg();
const w = windows(p);
const C40 = "a".repeat(40), P40 = "b".repeat(40);

describe("exclusion list", () => {
  test("org globs and exact names", () => {
    expect(excludedBy("openclaw/openclaw", p.exclusion)).toBe("openclaw/*");
    expect(excludedBy("garrytan/gstack", p.exclusion)).toBe("garrytan/*");
    expect(excludedBy("addyosmani/agent-skills", p.exclusion)).toBe("addyosmani/agent-skills");
    expect(excludedBy("addyosmani/other", p.exclusion)).toBeNull();
    expect(excludedBy("vercel/next.js", p.exclusion)).toBeNull();
  });
});

describe("licence rule", () => {
  test("permissive, pending the second read, or out", () => {
    expect(licenceStatus("MIT", p.licences)).toBe("permissive");
    expect(licenceStatus("MIT-0", p.licences)).toBe("permissive");
    expect(licenceStatus("NOASSERTION", p.licences)).toBe("second_read_pending");
    expect(licenceStatus(null, p.licences)).toBe("second_read_pending");
    expect(licenceStatus("GPL-3.0", p.licences)).toBe("out");
    expect(licenceStatus("MPL-2.0", p.licences)).toBe("out");
  });
});

describe("B2 screens", () => {
  const adv = (o: Partial<Advisory>): Advisory => ({ ghsa: "GHSA-x", path: "a.json", published: "2026-05-01", withdrawn: false, reviewed: true, ecosystems: ["npm"], refs: [{ repo: "acme/lib", kind: "commit", ref: "abc1234" }], ...o });
  test("readAdvisory reads fix references and sorted ecosystems", () => {
    const a = readAdvisory({ id: "GHSA-1", published: "2026-04-02T00:00:00Z", database_specific: { github_reviewed: true }, affected: [{ package: { ecosystem: "npm" } }, { package: { ecosystem: "Go" } }], references: [{ url: "https://github.com/acme/lib/commit/abcdef1" }, { url: "https://github.com/acme/lib/pull/12" }, { url: "https://example.com/x" }] }, "p.json");
    expect(a.ecosystems).toEqual(["Go", "npm"]);
    expect(a.refs).toEqual([{ repo: "acme/lib", kind: "commit", ref: "abcdef1" }, { repo: "acme/lib", kind: "pull", ref: "12" }]);
    expect(a.published).toBe("2026-04-02");
  });
  test("each keyless rule drops by name, and a pull reference wins over a commit", () => {
    const d = newDrops();
    const out = screenAdvisories([
      adv({ ghsa: "unrev", reviewed: false }), adv({ ghsa: "wd", withdrawn: true }), adv({ ghsa: "old", published: "2025-01-01" }),
      adv({ ghsa: "pypi", ecosystems: ["PyPI"] }), adv({ ghsa: "norefs", refs: [] }),
      adv({ ghsa: "two", refs: [{ repo: "a/b", kind: "commit", ref: "1234567" }, { repo: "c/d", kind: "commit", ref: "1234567" }] }),
      adv({ ghsa: "ex", refs: [{ repo: "openclaw/openclaw", kind: "commit", ref: "1234567" }] }),
      adv({ ghsa: "ok", published: "2025-07-01", refs: [{ repo: "acme/lib", kind: "commit", ref: "1234567" }, { repo: "acme/lib", kind: "pull", ref: "9" }] }),
    ], p, w, d);
    expect(out.map((c) => [c.ghsa, c.window, c.fix.kind])).toEqual([["ok", "widened", "pull"]]);
    expect(Object.keys(d.by_rule).sort()).toEqual(["ecosystem", "excluded", "fix_repos_not_one", "no_github_fix_ref", "not_reviewed", "outside_window", "withdrawn"]);
    expect(d.excluded["openclaw/*"]).toEqual({ primary: 1 });
  });
  test("licence screen: not found, renamed into the exclusion list, not permissive, archived, kept, and pending kept and marked", () => {
    const d = newDrops();
    const c = (repo: string) => ({ ghsa: repo, path: "x", published: "2026-05-01", window: "primary" as const, ecosystems: ["npm"], repo, fix: { repo, kind: "commit" as const, ref: "1234567" }, fix_refs: 1 });
    const out = screenLicences([c("a/gone"), c("a/moved"), c("a/mpl"), c("a/arch"), c("a/ok"), c("a/other"), c("a/none")], {
      "a/gone": "NOT_FOUND", "a/moved": { name_with_owner: "garrytan/moved", spdx: "MIT", archived: false }, "a/mpl": { name_with_owner: "a/mpl", spdx: "MPL-2.0", archived: false },
      "a/arch": { name_with_owner: "a/arch", spdx: "NOASSERTION", archived: true }, "a/ok": { name_with_owner: "A/Ok", spdx: "Apache-2.0", archived: false },
      "a/other": { name_with_owner: "a/other", spdx: "NOASSERTION", archived: false }, "a/none": { name_with_owner: "a/none", spdx: null, archived: false },
    }, p, d);
    expect(out.map((x) => [x.ghsa, x.licence, x.second_read_pending, x.canonical])).toEqual([["a/ok", "Apache-2.0", false, "A/Ok"], ["a/other", "NOASSERTION", true, "a/other"], ["a/none", null, true, "a/none"]]);
    expect(Object.keys(d.by_rule).sort()).toEqual(["archived", "excluded", "licence_not_found", "licence_not_permissive"]);
  });
  test("file-count screen: a test file and 1 to 6 source files under the ecosystems' languages", () => {
    const d = newDrops();
    const c = (ghsa: string): LicencedCandidate => ({ ghsa, path: "x", published: "2026-05-01", window: "primary", ecosystems: ["Go"], repo: "a/b", fix: { repo: "a/b", kind: "commit", ref: "1234567" }, fix_refs: 1, licence: "MIT", second_read_pending: false, licence_from: "graphql", canonical: "a/b" });
    const files: Record<string, string[]> = {
      notest: ["a.go"], nosrc: ["a_test.go", "README.md"], many: ["a_test.go", ...Array.from({ length: 7 }, (_, i) => "s" + i + ".go")], ok: ["pkg/a.go", "pkg/a_test.go", "go.sum"],
    };
    const out = screenFiles(["notest", "nosrc", "many", "ok"].map(c), (x) => ({ status: "ok", commit: C40, parent: P40, files: files[x.ghsa]! }), d);
    expect(out.map((r) => [r.ghsa, r.files])).toEqual([["ok", { test: 1, source: 1, total: 3 }]]);
    expect(Object.keys(d.by_rule).sort()).toEqual(["no_test_file", "source_files_0", "source_files_over_6"]);
  });
});

describe("B1 screens", () => {
  const repo = (o: Partial<RepoRow>): RepoRow => ({ repo: "acme/web", stars: 9000, licence: "MIT", language: "TypeScript", archived: false, runners: ["playwright"], ...o });
  test("repository screen", () => {
    const s = screenRepos([repo({ repo: "obra/x" }), repo({ repo: "a/gpl", licence: "GPL-3.0" }), repo({ repo: "a/arch", archived: true }), repo({ repo: "a/none", runners: [] }), repo({}), repo({ repo: "a/unlicensed", licence: null }), repo({ repo: "a/other", licence: "NOASSERTION" })], p);
    expect(s.kept.map((r) => r.repo)).toEqual(["acme/web", "a/unlicensed", "a/other"]);
    expect(s.drops).toEqual({ excluded: 1, licence_not_permissive: 1, archived: 1, no_root_browser_runner: 1 });
  });
  test("browser-test path rule", () => {
    for (const f of ["e2e/login.spec.ts", "tests/browser/focus.test.js", "src/menu.cy.tsx", "packages/x/playwright/a.ts", "a.browser.test.mjs"]) expect(isBrowserTest(f)).toBe(true);
    for (const f of ["src/browser/index.ts", "e2e/types.d.ts", "e2e/fixture.json", "tests/unit.test.ts"]) expect(isBrowserTest(f)).toBe(false);
    expect(b1Counts(["e2e/a.spec.ts", "src/a.ts", "README.md"])).toEqual({ browser_test: 1, test: 1, source: 1, total: 3 });
  });
  test("pull request screen: every rule, and a kept row keeps only the statement's digest", () => {
    const pr = (o: Partial<PrNode>): PrNode => ({ number: 7, title: "fix: focus ring", url: "https://github.com/acme/web/pull/7", mergedAt: "2026-06-02T10:00:00Z", mergeCommit: { oid: C40, parents: { nodes: [{ oid: P40 }] } }, files: { totalCount: 2, nodes: [{ path: "e2e/focus.spec.ts" }, { path: "src/focus.ts" }] }, closingIssuesReferences: { totalCount: 1, nodes: [{ url: "https://github.com/acme/web/issues/3", title: "Focus lost", body: "Steps" }] }, ...o });
    const r = repo({});
    expect(screenPr(r, pr({ title: "prefix the menu" }), w)).toBe("title_no_fix");
    expect(screenPr(r, pr({ mergedAt: "2025-01-01T00:00:00Z" }), w)).toBe("outside_window");
    expect(screenPr(r, pr({ closingIssuesReferences: { totalCount: 0, nodes: [] } }), w)).toBe("no_closing_issue");
    expect(screenPr(r, pr({ closingIssuesReferences: { totalCount: 2, nodes: [] } }), w)).toBe("closes_many");
    expect(screenPr(r, pr({ files: { totalCount: 2, nodes: [{ path: "src/a.test.ts" }, { path: "src/a.ts" }] } }), w)).toBe("no_browser_test");
    expect(screenPr(r, pr({ files: { totalCount: 1, nodes: [{ path: "e2e/a.spec.ts" }] } }), w)).toBe("source_files_0");
    expect(screenPr(r, pr({ files: { totalCount: 8, nodes: [{ path: "e2e/a.spec.ts" }, ...Array.from({ length: 7 }, (_, i) => ({ path: "src/s" + i + ".ts" }))] } }), w)).toBe("source_files_over_6");
    expect(screenPr(r, pr({ mergeCommit: null }), w)).toBe("no_merge_commit");
    const row = screenPr(r, pr({}), w);
    if (typeof row === "string") throw new Error(row);
    expect(row.statement_sha256).toBe(sha256(statementText("Focus lost", "Steps")));
    expect(JSON.stringify(row)).not.toContain("Focus lost");
    expect(row.fix).toEqual({ commit: C40, parent: P40 });
    expect([row.licence, row.second_read_pending]).toEqual(["MIT", false]);
    const pending = screenPr(repo({ licence: "NOASSERTION" }), pr({}), w);
    if (typeof pending === "string") throw new Error(pending);
    expect([pending.licence, pending.second_read_pending]).toEqual(["NOASSERTION", true]);
  });
  test("the B1 statement is read again through GraphQL and checked against the frozen digest", async () => {
    const c = candidateOf("B1", { repo: "acme/web", number: 7, url: "u", merged: "2026-06-02", month: "2026-06", window: "primary", licence: "MIT", second_read_pending: false, licence_from: "graphql", runners: ["playwright"], fix: { commit: C40, parent: P40 }, files: { browser_test: 1, test: 1, source: 1, total: 2 }, issue_url: "https://github.com/acme/web/issues/3", statement_sha256: sha256(statementText("Focus lost", "Steps")), statement_chars: 17 });
    const stub = (resource: unknown): Gql => async (q) => {
      expect(q).toContain(JSON.stringify("https://github.com/acme/web/issues/3"));
      return { data: { resource } };
    };
    expect(await b1Statement(stub({ title: "Focus lost", body: "Steps" }), c)).toBe("Focus lost\n\nSteps");
    expect(await b1Statement(stub({ title: "Focus lost", body: "Steps, edited" }), c)).toEqual({ code: "E_H2H_B_MINE", rule: "statement_changed_since_freeze" });
    expect(await b1Statement(stub(null), c)).toEqual({ code: "E_H2H_B_MINE", rule: "issue_unreadable" });
    expect(c.id).toBe("acme__web-7");
  });
});

describe("second licence read", () => {
  const second = (repos: Record<string, "matched" | "no_file" | "unmatched">): SecondRead => ({
    read_at: "2026-11-15T07:00:00.000Z", rule: "classifyLicenceFiles", templates: { source: "spdx/license-list-data", tag: "t", commit: "c", sha256: {} },
    repos: Object.fromEntries(Object.entries(repos).map(([k, reason]) => [k, { head: null, eligible: reason === "matched", reason, files: [] }])),
  });
  const s = second({ "a/ok": "matched", "a/none": "no_file", "a/other": "unmatched" });
  test("verdicts: kept from its files, dropped by reason, or still pending with no read for it", () => {
    expect(["a/ok", "a/none", "a/other", "a/unread"].map((r) => secondReadVerdict(r, s))).toEqual(["files", "licence_files_no_file", "licence_files_unmatched", "pending"]);
    expect(secondReadVerdict("a/ok", undefined)).toBe("pending");
  });
  test("B2 licence screen applies it by the canonical name", () => {
    const d = newDrops();
    const c = (repo: string) => ({ ghsa: repo, path: "x", published: "2026-05-01", window: "primary" as const, ecosystems: ["npm"], repo, fix: { repo, kind: "commit" as const, ref: "1234567" }, fix_refs: 1 });
    const lic = (name: string, spdx: string | null) => ({ name_with_owner: name, spdx, archived: false });
    const out = screenLicences([c("old/ok"), c("a/none"), c("a/other"), c("a/unread"), c("a/mit")], { "old/ok": lic("a/ok", "NOASSERTION"), "a/none": lic("a/none", null), "a/other": lic("a/other", "NOASSERTION"), "a/unread": lic("a/unread", null), "a/mit": lic("a/mit", "MIT") }, p, d, s);
    expect(out.map((x) => [x.canonical, x.licence, x.licence_from, x.second_read_pending])).toEqual([["a/ok", "NOASSERTION", "files", false], ["a/unread", null, null, true], ["a/mit", "MIT", "graphql", false]]);
    expect(d.by_rule).toMatchObject({ licence_files_no_file: { primary: 1 }, licence_files_unmatched: { primary: 1 } });
  });
  test("B1 repository screen and rows apply it", () => {
    const repo = (o: Partial<RepoRow>): RepoRow => ({ repo: "a/ok", stars: 9000, licence: "NOASSERTION", language: "TypeScript", archived: false, runners: ["playwright"], ...o });
    const rs = screenRepos([repo({}), repo({ repo: "a/none", licence: null }), repo({ repo: "a/other" }), repo({ repo: "a/unread" }), repo({ repo: "a/mit", licence: "MIT" })], p, s);
    expect(rs.kept.map((r) => r.repo)).toEqual(["a/ok", "a/unread", "a/mit"]);
    expect(rs.drops).toMatchObject({ licence_files_no_file: 1, licence_files_unmatched: 1 });
  });
  test("a second read already recorded is refused before anything is read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "h2h-b-second-"));
    writeFileSync(join(dir, "b1-repos.json"), JSON.stringify({ repos: [] }));
    writeFileSync(join(dir, "b1-licences.json"), JSON.stringify({ second_read: s }));
    await expect(commands["mine-b1"]!(["--work", dir, "--read-licence-files"])).rejects.toThrow(/E_H2H_B_MINE .*already holds a second read from 2026-11-15T07:00:00.000Z; it is read once/);
  });
});
