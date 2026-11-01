// Copyright (c) 2026 Garry Tan. MIT License.
// B1 mining on the calc fixture repository: the exposure window, K2 and K3, SZZ and revert K1 pairs, eligibility, the
// gstack-family rule, sampling and the per-repository cap. Keyless; git only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../lanes/real-outcome/mine/cli.ts";
import { classifyPath, isProtectedPath, TEST_PATTERNS } from "../../lanes/real-outcome/mine/paths.ts";
import { earliestExposure, windowVerdict } from "../../lanes/real-outcome/mine/exposure.ts";
import { parsePrPage } from "../../lanes/real-outcome/mine/fetch.ts";
import { mineRepo, type Candidate, type MineResult } from "../../lanes/real-outcome/mine/mine.ts";
import { familyOf, inspectTree, sampleRepos, type RepoCandidate } from "../../lanes/real-outcome/mine/sample.ts";
import { selectPanel } from "../../lanes/real-outcome/mine/select.ts";
import { buildRepo, calcCommits, calcMeta, tempDir } from "./fixture.ts";

const WINDOW = { start: "2026-07-01", strict_start: "2026-10-01", mined_at: "2026-10-31" };
let tmp: ReturnType<typeof tempDir>;
let sha: Record<string, string>;
let result: MineResult;
const byChange = (kind: string, change: string): Candidate => result.candidates.find((c) => c.kind === kind && c.change === sha[change])!;

beforeAll(() => {
  tmp = tempDir("real-mine-");
  sha = buildRepo(join(tmp.dir, "calc"), calcCommits());
  result = mineRepo({ repoDir: join(tmp.dir, "calc"), repo: "fixture/calc", branch: "main", meta: calcMeta(sha), window: WINDOW });
});
afterAll(() => tmp.cleanup());

describe("paths", () => {
  test("classes source, tests, lockfiles, manifests, release files and vendored code", () => {
    expect(classifyPath("calc/ops.py")).toBe("source");
    expect(classifyPath("tests/test_ops.py")).toBe("test");
    expect(classifyPath("pkg/kv_test.go")).toBe("test");
    expect(classifyPath("src/a.spec.ts")).toBe("test");
    expect(classifyPath("pkg/testdata/in.json")).toBe("test");
    expect(classifyPath("conftest.py")).toBe("test");
    expect(classifyPath("uv.lock")).toBe("lockfile");
    expect(classifyPath("go.sum")).toBe("lockfile");
    expect(classifyPath("requirements-dev.txt")).toBe("manifest");
    expect(classifyPath("CHANGELOG.md")).toBe("release");
    expect(classifyPath("node_modules/x/index.js")).toBe("vendored");
    expect(classifyPath("docs/guide.md")).toBe("other");
    expect(isProtectedPath("sitecustomize.py")).toBe(true);
    expect(isProtectedPath("go.work")).toBe(true);
    expect(isProtectedPath("calc/ops.py")).toBe(false);
  });

  test("the test patterns are plain POSIX ERE, so prepare.sh's grep -E reads them the same way", () => {
    for (const p of TEST_PATTERNS) expect(p).not.toMatch(/\\[dwsbDWSB]|\(\?|\{\d*,?\d*\}\?/);
  });
});

describe("exposure window", () => {
  test("uses the earliest exposure and refuses an incomplete one", () => {
    const e = earliestExposure([{ source: "pr", ref: "#1", at: "2026-07-05T00:00:00Z" }, { source: "issue", ref: "#2", at: "2026-06-29T00:00:00Z" }], []);
    expect(e.source).toBe("issue");
    expect(windowVerdict(e, "2026-07-10T00:00:00Z", WINDOW).reasons).toEqual(["exposed_before_window"]);
    const late = earliestExposure([{ source: "commit", ref: "x", at: "2026-10-02T00:00:00Z" }], ["issue #9"]);
    expect(windowVerdict(late, "2026-10-03T00:00:00Z", WINDOW)).toEqual({ stratum: null, reasons: ["exposure_incomplete"] });
    const strict = earliestExposure([{ source: "commit", ref: "x", at: "2026-10-02T00:00:00Z" }], []);
    expect(windowVerdict(strict, "2026-10-03T00:00:00Z", WINDOW).stratum).toBe("strict");
  });

  test("a change merged in the window but exposed before it is not eligible", () => {
    const c3 = byChange("K3", "c3");
    expect(c3.reasons).toContain("exposed_before_window");
    expect(c3.exposure).toMatchObject({ source: "pr", ref: "#11" });
    expect(result.candidates.some((c) => c.change === sha.c2)).toBe(false);
  });

  test("a direct push that closes an issue the metadata lacks is incomplete", () => {
    const c18 = byChange("K2", "c18");
    expect(c18.reasons).toContain("exposure_incomplete");
    expect(c18.exposure.missing).toEqual(["issue #26"]);
  });

  test("a pull request whose closing issues or commits were cut off is incomplete", () => {
    const meta = calcMeta(sha);
    meta.prs.find((p) => p.number === 12)!.truncated = true;
    const cut = mineRepo({ repoDir: join(tmp.dir, "calc"), repo: "fixture/calc", branch: "main", meta, window: WINDOW });
    expect(cut.candidates.some((c) => c.kind === "K1" && c.change === sha.c4)).toBe(false);
    const c4 = cut.candidates.find((c) => c.kind === "K3" && c.change === sha.c4)!;
    expect(c4).toMatchObject({ eligible: false, stratum: null });
    expect(c4.reasons).toContain("exposure_incomplete");
    expect(c4.exposure.missing).toEqual(["pull request #12 has more closing issues or commits than the metadata holds"]);
  });

  test("an as-of run ignores every change merged after the mining date", () => {
    const early = mineRepo({ repoDir: join(tmp.dir, "calc"), repo: "fixture/calc", branch: "main", meta: calcMeta(sha), window: { ...WINDOW, mined_at: "2026-07-31" } });
    expect(early.candidates.map((c) => [c.kind, c.change])).toEqual([
      ["K3", sha.c3],
      ["K3", sha.c4],
    ]);
    expect(early.candidates.find((c) => c.change === sha.c4)).toMatchObject({ eligible: true, stratum: "window" });
  });
});

describe("K2 and K3", () => {
  test("an issue-closing change is K2 and dates from its issue", () => {
    const c5 = byChange("K2", "c5");
    expect(c5).toMatchObject({ eligible: true, stratum: "window", pr: 15, issues: [16], base: sha.c4 });
    expect(c5.exposure).toMatchObject({ source: "issue", ref: "#16", at: "2026-07-25T00:00:00.000Z" });
    expect(c5.size).toEqual({ source_files: 2, source_added: 5, test_files: 1 });
  });

  test("a merge commit is one change with its branch's commits", () => {
    const c9 = byChange("K3", "c9");
    expect(c9).toMatchObject({ eligible: true, pr: 18, base: sha.c8 });
    expect(c9.source_files.sort()).toEqual(["calc/ops.py", "calc/stats.py"]);
  });

  test("the strict stratum starts 2026-10-01", () => {
    expect(byChange("K3", "c15")).toMatchObject({ eligible: true, stratum: "strict" });
  });

  test("size, dependency, revert and K1 rules drop the right changes", () => {
    expect(byChange("K3", "c16").reasons).toEqual(["below_size"]);
    expect(byChange("K2", "c17").reasons).toEqual(["below_size"]);
    expect(byChange("K2", "c6").reasons).toEqual(["below_size"]);
    expect(byChange("K3", "c7").reasons).toEqual(["below_size", "dependency_change"]);
    expect(byChange("K3", "c13").reasons).toEqual(["reverted"]);
    expect(byChange("K3", "c4").reasons).toEqual(["superseded_by_k1"]);
    expect(byChange("K3", "c10").reasons).toEqual(["reverted", "superseded_by_k1"]);
  });

  test("docs-only changes and product reverts are skipped with a reason", () => {
    expect(result.skipped).toContainEqual({ change: sha.c8, reasons: ["no_source_and_tests"] });
    expect(result.skipped).toContainEqual({ change: sha.c14, reasons: ["revert_not_defect"] });
  });
});

describe("K1 pairs", () => {
  test("SZZ pairs a fix with the in-window change its edited lines blame to", () => {
    const k1 = result.candidates.filter((c) => c.kind === "K1" && c.k1_source === "szz");
    expect(k1).toHaveLength(1);
    expect(k1[0]).toMatchObject({ change: sha.c4, fix: sha.c6, base: sha.c3, blamed_lines: 1, eligible: true, stratum: "window", escaped_test_files: ["tests/test_percent.py"], test_files: ["tests/test_ops.py"] });
  });

  test("a fix whose lines blame to code from before the window pairs nothing", () => {
    expect(result.candidates.some((c) => c.kind === "K1" && c.fix === sha.c17)).toBe(false);
  });

  test("a revert that cites a defect pairs the reverted change with its re-land", () => {
    const k1 = result.candidates.filter((c) => c.kind === "K1" && c.k1_source === "revert");
    expect(k1).toHaveLength(1);
    expect(k1[0]).toMatchObject({ change: sha.c10, fix: sha.c12, revert: sha.c11, eligible: true, escaped_test_files: ["tests/test_rounding.py"] });
  });

  test("counts add up", () => {
    expect(result.counts).toMatchObject({ K1: 2, K1_eligible: 2, K2_eligible: 1, K3_eligible: 3 });
  });
});

describe("gstack family, sampling and the panel", () => {
  test("gstack is the dev pool and other garrytan repositories are a labelled stratum", () => {
    expect(familyOf("garrytan/gstack")).toBe("gstack-dev");
    expect(familyOf("garrytan/gbrain")).toBe("gstack-shipped");
    expect(familyOf("honojs/hono")).toBe("none");
    const dev = mineRepo({ repoDir: join(tmp.dir, "calc"), repo: "garrytan/gstack", branch: "main", meta: calcMeta(sha), window: WINDOW });
    expect(dev.candidates.every((c) => !c.eligible && c.reasons.includes("gstack_dev_pool"))).toBe(true);
  });

  test("a repository whose package ships in the runtime layer is excluded", () => {
    const r = mineRepo({ repoDir: join(tmp.dir, "calc"), repo: "fixture/calc", branch: "main", meta: calcMeta(sha), window: WINDOW, excludedPackages: ["calc-fixture"] });
    expect(r.candidates.every((c) => c.reasons.includes("runtime_package"))).toBe(true);
  });

  test("sampling keeps permissive, active, tested repositories with a lockfile and no Claude project config", () => {
    const ins = inspectTree(["pyproject.toml", "uv.lock", "tests/test_a.py"], (p) => (p === "pyproject.toml" ? '[project]\nname = "a"\n[tool.pytest.ini_options]\n' : ""));
    expect(ins).toMatchObject({ runner: "pytest", lockfiles: ["uv.lock"], has_tests: true, package_names: ["a"], claude_config: [] });
    const base: RepoCandidate = { full_name: "a/ok", language: "Python", license: "MIT", archived: false, fork: false, pushed_at: "2026-10-30T00:00:00Z", default_branch: "main", window_commits: 50, inspection: ins };
    const cands: RepoCandidate[] = [
      base,
      { ...base, full_name: "a/gpl", license: "GPL-3.0" },
      { ...base, full_name: "a/old", pushed_at: "2026-08-01T00:00:00Z" },
      { ...base, full_name: "a/nolock", inspection: { ...ins, lockfiles: [] } },
      { ...base, full_name: "a/claude", inspection: { ...ins, claude_config: [".claude/settings.json"] } },
      { ...base, full_name: "a/java", language: "Java" },
      { ...base, full_name: "garrytan/gstack" },
    ];
    const s = sampleRepos(cands, { mined_at: "2026-10-31" });
    expect(s.kept.map((k) => k.full_name)).toEqual(["a/ok"]);
    expect(s.dev_pool.map((k) => k.full_name)).toEqual(["garrytan/gstack"]);
    expect(Object.fromEntries(s.dropped.map((d) => [d.full_name, d.reasons]))).toEqual({ "a/claude": ["claude_config"], "a/gpl": ["licence"], "a/java": ["language"], "a/nolock": ["no_lockfile"], "a/old": ["inactive"] });
    expect(s.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sampleRepos([...cands].reverse(), { mined_at: "2026-10-31" }).digest).toBe(s.digest);
  });

  test("the panel keeps at most 3 per repository, K1 first, and never two tasks that share a change", () => {
    const panel = selectPanel(result.candidates, "seed-1");
    expect(panel.selected).toHaveLength(3);
    expect(panel.selected.filter((c) => c.kind === "K1")).toHaveLength(2);
    expect(panel.held).toContainEqual({ id: byChange("K3", "c12").id, reason: "shares_change" });
    expect(selectPanel([...result.candidates].reverse(), "seed-1").selected.map((c) => c.id)).toEqual(panel.selected.map((c) => c.id));
  });
});

describe("fetch and the CLI", () => {
  test("parses a GraphQL page of merged pull requests", () => {
    const page = parsePrPage({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ number: 3, title: "t", body: "b", createdAt: "2026-07-02T00:00:00Z", mergedAt: "2026-07-03T00:00:00Z", updatedAt: "2026-07-03T00:00:00Z", mergeCommit: { oid: "a".repeat(40) }, labels: { nodes: [{ name: "bug" }] }, closingIssuesReferences: { totalCount: 1, nodes: [{ number: 2, title: "i", createdAt: "2026-07-01T00:00:00Z", labels: { nodes: [] } }] }, commits: { totalCount: 101, nodes: [{ commit: { oid: "b".repeat(40), authoredDate: "2026-06-30T00:00:00Z", committedDate: "2026-07-02T00:00:00Z" } }] } }] } } } });
    expect(page.next).toBe("c1");
    expect(page.prs[0]).toMatchObject({ number: 3, merge_commit: "a".repeat(40), closing_issues: [2], labels: ["bug"], commits: [{ sha: "b".repeat(40), authored_at: "2026-06-30T00:00:00Z" }], truncated: true });
    expect(page.issues).toEqual([{ number: 2, title: "i", created_at: "2026-07-01T00:00:00Z", labels: [] }]);
  });

  test("real mine repo writes the same result, and refuses a shallow clone", async () => {
    const meta = join(tmp.dir, "meta.json");
    const out = join(tmp.dir, "mine.json");
    writeFileSync(meta, JSON.stringify(calcMeta(sha)));
    expect(await main(["repo", "--repo-dir", join(tmp.dir, "calc"), "--repo", "fixture/calc", "--branch", "main", "--meta", meta, "--mined-at", "2026-10-31", "--out", out])).toBe(0);
    expect((JSON.parse(readFileSync(out, "utf8")) as MineResult).counts).toEqual(result.counts);
    buildRepo(join(tmp.dir, "deep"), calcCommits().slice(0, 3));
    const { git } = await import("../../lanes/real-outcome/mine/git.ts");
    git(tmp.dir, ["clone", "-q", "--depth", "1", "file://" + join(tmp.dir, "deep"), join(tmp.dir, "shallow")]);
    expect(await main(["repo", "--repo-dir", join(tmp.dir, "shallow"), "--repo", "fixture/calc", "--mined-at", "2026-10-31"])).toBe(2);
    expect(await main(["repo", "--repo", "x"])).toBe(2);
  });
});
