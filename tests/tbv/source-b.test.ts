// Copyright (c) 2026 Garry Tan. MIT License.
// Source B (prereg section 4, amendment section 2): the history from GitHub's record with no writer, the gstack strip,
// lineage clusters, the dev window and held-out accrual edges. Synthetic records only; GitHub is never called.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accrualClosed, assembleB, clustersOf, devEligible, fromGraphql, heldOutCluster, heldOutEligible, lineageOf, type LineageStub, type PrRecord, run, stripGstack } from "../../lanes/tbv/history/source-b.ts";
import { codeOf, pr, READY, RECEIPT } from "./history-helpers.ts";

const P = "2026-11-10T12:00:00Z";
const at = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString().replace(".000Z", "Z");

test("stripGstack removes receipt fences, READY blocks (fenced or not), gstack comments and READY_EXIT lines, keeping the rest", () => {
  expect(stripGstack("before\n" + RECEIPT + "\nafter")).toBe("before\nafter");
  expect(stripGstack("x\n```\n" + READY + "\n```\ny")).toBe("x\ny");
  expect(stripGstack("x\n" + READY + "\n\ny")).toBe("x\n\ny");
  expect(stripGstack("a <!-- gstack:receipt\nmore --> b")).toBe("a  b");
  expect(stripGstack("one\nREADY_EXIT=0\ntwo")).toBe("one\ntwo");
  const plain = "ordinary text\n```ts\nconst READY = 1;\n```\n<!-- note -->";
  expect(stripGstack(plain)).toBe(plain);
});

test("assembleB: ask, per round a git log call and a check-run call, the changed files, then Capy findings; stripped; no agent reply", () => {
  const r = assembleB(pr(), "pr-12");
  if (!r.ok) throw new Error(r.drop);
  const h = r.history;
  expect(h).toMatchObject({ source: "B", task: "pr-12", cluster: "pr-12", family: "ship", side: { files: ["src/widget.ts", ".github/workflows/ci.yml"], resolved: null, patch: null } });
  expect(h.events.map((e) => e.kind)).toEqual(["user-text", ...Array(4).fill(["tool-use", "tool-result"]).flat(), "tool-use", "tool-result", "tool-use", "tool-result"]);
  expect(h.events[0]).toMatchObject({ kind: "user-text" });
  expect((h.events[0] as { text: string }).text).toContain("#12");
  const all = JSON.stringify(h.events);
  for (const gone of ["gstack-ship-receipt", "READY #12", "READY_EXIT", "<!-- gstack", "Agent reply", "Not a Capy thread"]) expect(all).not.toContain(gone);
  for (const kept of ["body kept", "fail one", "fail two", "The parser drops trailing commas.", "kept tail", ".github/workflows/ci.yml", "== check test: FAILURE", "== finding 1: unresolved"]) expect(all).toContain(kept);
  expect(h.events[2]).toMatchObject({ kind: "tool-result", content: expect.stringContaining("AuthorDate: 2026-11-10T13:05:00Z") });
  expect(h.events.filter((e) => e.kind === "tool-result").every((e) => !(e as { is_error: boolean }).is_error)).toBe(true);
});

test("assembleB refuses a record whose text holds a drive path", () => {
  expect(codeOf(() => assembleB(pr({ title: "notes from " + ["", "home", "ada", ".capy", "drive", ""].join("/") + "plan.md" }), "pr-12"))).toBe("E_TBV_HISTORY");
});

test("clustersOf joins same head branch, stacked bases, shared closing issues and shared code keys", () => {
  const m = clustersOf([
    pr({ number: 1, headRefName: "a", title: "one" }),
    pr({ number: 2, headRefName: "a", title: "two" }),
    pr({ number: 3, headRefName: "b", baseRefName: "a", title: "three" }),
    pr({ number: 4, headRefName: "c", title: "four", closingIssues: [9] }),
    pr({ number: 5, headRefName: "d", title: "five", closingIssues: [9] }),
    pr({ number: 6, headRefName: "e", title: "GEVA-77: six" }),
    pr({ number: 7, headRefName: "geva-77/f", title: "seven" }),
    pr({ number: 8, headRefName: "g", title: "eight" }),
  ]);
  expect(Object.fromEntries(m)).toEqual({ 1: "pr-1", 2: "pr-1", 3: "pr-1", 4: "pr-4", 5: "pr-4", 6: "pr-6", 7: "pr-6", 8: "pr-8" });
});

test("held-out accrual: merged and opened after P, no commit authored or committed before P, no cluster sibling opened before P", () => {
  const ok = pr();
  expect(heldOutEligible(ok, [ok], P)).toEqual({ ok: true });
  expect(heldOutEligible(pr({ createdAt: at(P, -1) }), [], P).ok).toBe(false);
  expect(heldOutEligible(pr({ createdAt: P }), [], P).ok).toBe(false);
  expect(heldOutEligible(pr({ mergedAt: at(P, -60) }), [], P).ok).toBe(false);
  expect(heldOutEligible(pr({ state: "CLOSED", mergedAt: null }), [], P).ok).toBe(false);
  const rebased = pr({ commits: [{ ...pr().commits[0], authoredDate: at(P, -86400), committedDate: at(P, 3600) }] });
  const r = heldOutEligible(rebased, [rebased], P);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.why).toContain("author");
  expect(heldOutEligible(pr({ commits: [{ ...pr().commits[0], committedDate: at(P, -1) }] }), [], P).ok).toBe(false);
  const early = pr({ number: 11, createdAt: at(P, -1), mergedAt: null, state: "CLOSED" });
  const s = heldOutEligible(ok, [early, ok], P);
  expect(s.ok).toBe(false);
  if (!s.ok) expect(s.why).toContain("#11");
  expect(heldOutEligible(ok, [pr({ number: 13, createdAt: at(P, 1) }), ok], P)).toEqual({ ok: true });
  expect(codeOf(() => heldOutEligible(ok, [], "not a time"))).toBe("E_TBV_INPUT");
});

test("dev window: merged strictly before the scorer pin post", () => {
  const pin = "2026-11-08T00:00:00Z";
  expect(devEligible(pr({ mergedAt: at(pin, -1) }), pin)).toBe(true);
  expect(devEligible(pr({ mergedAt: pin }), pin)).toBe(false);
  expect(devEligible(pr({ mergedAt: at(pin, 1) }), pin)).toBe(false);
  expect(devEligible(pr({ state: "CLOSED", mergedAt: null }), pin)).toBe(false);
});

test("accrual closes at the 50th qualifier or 21 days after P, whichever is first", () => {
  expect(accrualClosed({ qualifyingNonClean: 49, pPostMergedAt: P, now: at(P, 20 * 86400) }).closed).toBe(false);
  expect(accrualClosed({ qualifyingNonClean: 50, pPostMergedAt: P, now: at(P, 3600) }).closed).toBe(true);
  expect(accrualClosed({ qualifyingNonClean: 3, pPostMergedAt: P, now: at(P, 21 * 86400 - 1) }).closed).toBe(false);
  expect(accrualClosed({ qualifyingNonClean: 3, pPostMergedAt: P, now: at(P, 21 * 86400) }).closed).toBe(true);
  expect(accrualClosed({ qualifyingNonClean: 3, pPostMergedAt: P, now: at(P, 22 * 86400) }).closed).toBe(true);
  expect(codeOf(() => accrualClosed({ qualifyingNonClean: 0, pPostMergedAt: P, now: at(P, -1) }))).toBe("E_TBV_INPUT");
});

test("fromGraphql maps a GraphQL node to a PrRecord with both commit dates, and skips a truncated record", () => {
  const node = {
    number: 5, state: "MERGED", title: "t", createdAt: "c", mergedAt: "m", closedAt: "x", baseRefName: "main", headRefName: "h",
    closingIssuesReferences: { nodes: [{ number: 3 }] }, files: { totalCount: 1, nodes: [{ path: "a.ts", additions: 1, deletions: 0 }] },
    commits: { totalCount: 1, nodes: [{ commit: { oid: "o", message: "msg", authoredDate: "ad", committedDate: "cd", checkSuites: { nodes: [{ checkRuns: { nodes: [{ name: "n", conclusion: null, status: "IN_PROGRESS", title: null, summary: null, text: null }] } }] } } }] },
    reviewThreads: { totalCount: 1, nodes: [{ isResolved: true, comments: { nodes: [{ author: null, body: "b" }] } }] },
    reviews: { nodes: [{ author: { login: "capy-ai" }, body: "r" }] },
  };
  expect(fromGraphql(node)).toEqual({
    number: 5, state: "MERGED", title: "t", createdAt: "c", mergedAt: "m", closedAt: "x", baseRefName: "main", headRefName: "h", closingIssues: [3], files: [{ path: "a.ts", additions: 1, deletions: 0 }],
    commits: [{ oid: "o", message: "msg", authoredDate: "ad", committedDate: "cd", checks: [{ name: "n", conclusion: null, status: "IN_PROGRESS", title: null, summary: null, text: null }] }],
    reviewThreads: [{ isResolved: true, comments: [{ author: null, body: "b" }] }], reviews: [{ author: "capy-ai", body: "r" }],
  });
  expect(fromGraphql({ ...node, files: { totalCount: 101, nodes: [] } })).toBeNull();
});

test("assemble-b writes one history per record, clustered over the whole file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tbv-assemble-b-"));
  writeFileSync(join(dir, "prs.json"), JSON.stringify({ schema: "tbv-prs.v1", prs: [pr(), pr({ number: 13, closingIssues: [] })] }));
  const out: string[] = [];
  expect(await run(["assemble-b", "--records", join(dir, "prs.json"), "--out-dir", join(dir, "h")], { out: (s) => out.push(s), err: (s) => out.push(s) })).toBe(0);
  const h13 = JSON.parse(readFileSync(join(dir, "h/pr-13.json"), "utf8"));
  expect(h13.cluster).toBe("pr-12");
  expect(codeOf(() => {})).toBe("no refusal");
});

test("A7: a skipped pre-P record keeps its lineage keys, and a post-P PR sharing its branch or issue is refused held-out", () => {
  const node = { number: 7, state: "MERGED", title: "Start the widget", createdAt: at(P, -3600), baseRefName: "main", headRefName: "widget/parser", closingIssuesReferences: { totalCount: 1, nodes: [{ number: 40 }] }, files: { totalCount: 101, nodes: [] } };
  expect(fromGraphql(node)).toBeNull();
  const stub = lineageOf(node);
  expect(stub).toEqual({ number: 7, createdAt: at(P, -3600), title: "Start the widget", baseRefName: "main", headRefName: "widget/parser", closingIssues: [40] });
  expect(lineageOf({ ...node, closingIssuesReferences: { totalCount: 11, nodes: [{ number: 40 }] } }).closingIssues).toBeNull();
  const branch = pr();
  const r = heldOutEligible(branch, heldOutCluster(branch, [branch], [stub]), P);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.why).toContain("#7");
  const issue = pr({ number: 13, headRefName: "other/branch", closingIssues: [40] });
  expect(heldOutEligible(issue, heldOutCluster(issue, [issue], [stub]), P).ok).toBe(false);
  const unrelated = pr({ number: 14, title: "Fix the docs", headRefName: "docs/fix" });
  expect(heldOutEligible(unrelated, heldOutCluster(unrelated, [unrelated, branch, issue], [stub]), P)).toEqual({ ok: true });
});

test("A7: a skipped record whose lineage keys are missing or truncated fails closed for a post-P PR that could share them", () => {
  const issue = pr({ number: 13, headRefName: "other/branch", closingIssues: [41] });
  const plain = pr({ number: 14, title: "Fix the docs", headRefName: "docs/fix" });
  const cut: LineageStub = { number: 8, createdAt: at(P, -60), title: "Old", baseRefName: "main", headRefName: "old/branch", closingIssues: null };
  const r = heldOutEligible(issue, heldOutCluster(issue, [issue, plain], [cut]), P);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.why).toContain("#8");
  expect(heldOutEligible(plain, heldOutCluster(plain, [issue, plain], [cut]), P)).toEqual({ ok: true });
  const blind: LineageStub = { number: 9, createdAt: null, title: null, baseRefName: null, headRefName: null, closingIssues: null };
  expect(heldOutEligible(plain, heldOutCluster(plain, [issue, plain], [blind]), P).ok).toBe(false);
});

const stub = (o: Partial<LineageStub> & { number: number }): LineageStub => ({ createdAt: at(P, 60), title: "Stub " + o.number, baseRefName: "main", headRefName: "stub/" + o.number, closingIssues: [], ...o });

test("A7 note 1: a truncated-issue stub that could close an issue a keyed stub in the cluster closes is pulled in, so a pre-P one refuses", () => {
  const x = pr({ number: 20, title: "Tidy the widget", headRefName: "shared/branch" });
  const s1 = stub({ number: 21, headRefName: "shared/branch", closingIssues: [40] });
  const s2 = stub({ number: 22, createdAt: at(P, -3600), closingIssues: null });
  const r = heldOutEligible(x, heldOutCluster(x, [x], [s1, s2]), P);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.why).toContain("#22");
  const quiet = stub({ number: 21, headRefName: "shared/branch" });
  expect(heldOutEligible(x, heldOutCluster(x, [x], [quiet, s2]), P)).toEqual({ ok: true });
});

test("A7 note 2: a stub opened after P with missing or truncated keys no longer refuses by itself; its creation time is read first", () => {
  const x = pr({ number: 20, title: "Tidy the widget", headRefName: "shared/branch", closingIssues: [40] });
  const late = stub({ number: 23, closingIssues: null });
  expect(heldOutEligible(x, heldOutCluster(x, [x], [late]), P)).toEqual({ ok: true });
  const onBranch = stub({ number: 24, headRefName: "shared/branch", closingIssues: null });
  expect(heldOutEligible(x, heldOutCluster(x, [x], [onBranch]), P)).toEqual({ ok: true });
  const blind = stub({ number: 25, title: null, baseRefName: null, headRefName: null, closingIssues: null });
  const y = pr({ number: 26, title: "Other work", headRefName: "other/work" });
  expect(heldOutEligible(x, heldOutCluster(x, [x, y], [blind]), P)).toEqual({ ok: true });
});

test("A7 note 2, other direction: a post-P stub whose missing keys could join a pre-P record still refuses, and so does an unknown creation time", () => {
  const x = pr({ number: 20, title: "Tidy the widget", headRefName: "shared/branch" });
  const old = pr({ number: 30, title: "Old work", headRefName: "old/work", closingIssues: [50], createdAt: at(P, -86400), mergedAt: at(P, -80000) });
  const bridge = stub({ number: 24, headRefName: "shared/branch", closingIssues: null });
  const r = heldOutEligible(x, heldOutCluster(x, [x, old], [bridge]), P);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.why).toContain("#30");
  const blind = stub({ number: 25, title: null, baseRefName: null, headRefName: null, closingIssues: null });
  expect(heldOutEligible(x, heldOutCluster(x, [x, old], [blind]), P).ok).toBe(false);
  const undated = stub({ number: 27, headRefName: "shared/branch", createdAt: null });
  const u = heldOutEligible(x, heldOutCluster(x, [x], [undated]), P);
  expect(u.ok).toBe(false);
  expect(!u.ok && u.why).toContain("#27");
  const early = stub({ number: 28, headRefName: "shared/branch", createdAt: at(P, -1), closingIssues: null });
  const e = heldOutEligible(x, heldOutCluster(x, [x], [early]), P);
  expect(!e.ok && e.why).toContain("opened at " + at(P, -1));
});

