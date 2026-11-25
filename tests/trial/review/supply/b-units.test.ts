// Value: protects=B units come one per repository in a seeded order fixed by the draw seed, SZZ and gates 1, 2 and 4 run
// end to end on a git history, and the unit is the BIC as a PR on its own parent built by unit.ts with its history check
// and gate 4; fails_when=the order changes between runs, a pre-July fix passes, or a built unit carries the fix or an
// instruction file; why_new=GEVA-590 section 2 and section 10 item 3; seam=bOrder, checkB with a local remote and stubs,
// bUnitRef, buildChecked; no_claim=real advisory repositories or GitHub
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bOrder, bUnitRef, buildChecked, checkB, DRAW_SEED, seededShuffle } from "../../../../src/trial/review/supply/b-units.ts";
import { commitAll, git, tree } from "../../../cli/helpers.ts";

const adv = (ghsa: string, repo: string, published = "2026-08-01") => ({ ghsa, repo, published, advisory_path: "a/" + ghsa + ".json", ecosystem: "npm", fix: { kind: "commit", ref: "x", commit: "c", parent: "p" } });

describe("the B order", () => {
  test("seeded, one advisory per repository, only from the cutoff", () => {
    expect(seededShuffle([1, 2, 3, 4, 5], DRAW_SEED)).toEqual(seededShuffle([1, 2, 3, 4, 5], DRAW_SEED));
    expect(seededShuffle([1, 2, 3, 4, 5], DRAW_SEED).sort()).toEqual([1, 2, 3, 4, 5]);
    const frame = { schema: "h2h-b2-frame.v1", advisories: [adv("GHSA-b", "o/x"), adv("GHSA-a", "o/x"), adv("GHSA-c", "o/y"), adv("GHSA-d", "o/z", "2026-06-30"), adv("GHSA-e", "o/w")] };
    const order = bOrder(frame);
    expect(order.map((a) => a.repo).sort()).toEqual(["o/w", "o/x", "o/y"]);
    expect(bOrder({ ...frame, advisories: [...frame.advisories].reverse() }).map((a) => a.ghsa)).toEqual(order.map((a) => a.ghsa));
    expect(() => bOrder({ schema: "other", advisories: [] })).toThrow("E_RMS_INPUT");
  });
});

function history(fixDate: string, extra: Record<string, string> = {}) {
  const root = tree({ "src/app.ts": ["start();", "check(input);", "run();", ""].join("\n"), ...extra });
  commitAll(root, "initial");
  writeFileSync(join(root, "src/app.ts"), ["start();", "trust(input);", "skip(input);", "run();", ""].join("\n"));
  git(root, "commit", "-q", "-am", "simplify input handling");
  const bic = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "src/app.ts"), ["start();", "check(input);", "run();", ""].join("\n"));
  git(root, "commit", "-q", "-am", "fix GHSA-test-test-test", "--date=" + fixDate);
  const fix = git(root, "rev-parse", "HEAD");
  git(root, "config", "uploadpack.allowFilter", "true");
  git(root, "config", "uploadpack.allowAnySHA1InWant", "true");
  return { root, bic, fix, parent: bic };
}

const advisoryOf = (h: ReturnType<typeof history>) => ({ ghsa: "GHSA-test-test-test", repo: "o/app", published: "2026-08-01", advisory_path: "p.json", ecosystem: "npm", fix: { kind: "pull", ref: "12", commit: h.fix, parent: h.parent } });

describe("the unit build under pre-run change 2", () => {
  test("strips executable config, records hashes and what it stripped, and still passes the history check", () => {
    const h = history("2026-08-03T00:00:00Z", { ".claude/settings.json": JSON.stringify({ hooks: { Stop: [] }, permissions: { allow: ["Bash"] }, model: "x" }), ".mcp.json": "{}", "AGENTS.md": "a\n" });
    const dest = join(mkdtempSync(join(tmpdir(), "rms-unit-")), "u");
    const built = buildChecked({ unit: { id: "o/app#0@" + h.bic.slice(0, 12), repo: "o/app", pr: 0, head: h.bic, base: h.bic + "^" }, source: h.root, dest, needles: { strings: ["GHSA-test-test-test"], fix: h.fix } });
    expect(built.problems).toEqual([]);
    expect(Object.keys(built.instructions.files)).toEqual([".claude/settings.json", ".mcp.json", "AGENTS.md"]);
    expect(built.instructions.strip.map((s) => [s.path, s.action, s.keys])).toEqual([[".claude/settings.json", "keys", ["hooks", "permissions"]], [".mcp.json", "removed", []]]);
    expect(built.instructions.flags).toMatchObject({ agents_md: true, settings: true, mcp_json: true, claude_md: false });
    expect(JSON.parse(readFileSync(join(dest, ".claude/settings.json"), "utf8"))).toEqual({ model: "x" });
    expect(existsSync(join(dest, ".mcp.json"))).toBe(false);
  }, 60_000);

  test("a settings file that is not JSON refuses the unit", () => {
    const h = history("2026-08-03T00:00:00Z", { ".claude/settings.local.json": "{ nope" });
    const dest = join(mkdtempSync(join(tmpdir(), "rms-unit-")), "u");
    const built = buildChecked({ unit: { id: "o/app#0@" + h.bic.slice(0, 12), repo: "o/app", pr: 0, head: h.bic, base: h.bic + "^" }, source: h.root, dest, needles: { strings: [], fix: h.fix } });
    expect(built.problems).toEqual([".claude/settings.local.json is not a JSON object, so its executable settings cannot be stripped"]);
  }, 60_000);
});

describe("checkB", () => {
  test("SZZ finds the BIC; gates 1, 2 and 4 pass; the unit builds on the BIC's parent with no history past it", () => {
    const h = history("2026-08-03T00:00:00Z");
    const work = mkdtempSync(join(tmpdir(), "rms-b-"));
    const prs: string[] = [];
    const github = (repo: string, pr: number) => (prs.push(repo + "#" + pr), { created_at: "2026-08-02T00:00:00Z", commits: [], comments: {} });
    const rec = checkB(advisoryOf(h), 0, { work, github, advisory: () => ({ aliases: ["CVE-2026-9999", "GO-1"], published: "2026-08-01T00:00:00Z" }), url: () => "file://" + h.root });
    expect(rec.error).toBeUndefined();
    expect(rec.szz).toMatchObject({ basis: "deleted", bic: h.bic, blamed_lines: 2, bic_lines: 2 });
    expect(rec.shape).toEqual({ parents: 1, files: 1, lines: 3, source_lines: 3 });
    expect(rec.cves).toEqual(["CVE-2026-9999"]);
    expect(rec.gates).toEqual({ g1: "ok", g2: "ok", g4: "ok" });
    expect(prs).toEqual(["o/app#12"]);
    const unit = bUnitRef(rec);
    expect(unit).toEqual({ id: "o/app#0@" + h.bic.slice(0, 12), repo: "o/app", pr: 0, head: h.bic, base: h.bic + "^" });
    const dest = join(mkdtempSync(join(tmpdir(), "rms-unit-")), "u");
    const built = buildChecked({ unit, source: h.root, dest, needles: { strings: [rec.ghsa, ...rec.cves], fix: h.fix } });
    expect(built.problems).toEqual([]);
    expect(built.instructions.files).toEqual({});
    expect(built.repo.ancestry.count).toBe(2);
    expect(git(dest, "diff", "--name-only", built.repo.base_branch + "...HEAD")).toBe("src/app.ts");
  }, 60_000);

  test("a fix authored before July fails gate 1 and skips gate 4; a tree with CLAUDE.md passes gate 4 with its flags", () => {
    const early = history("2026-06-20T00:00:00Z");
    const work = mkdtempSync(join(tmpdir(), "rms-b-"));
    const github = () => ({ created_at: "2026-08-02T00:00:00Z", commits: [], comments: {} });
    const a = checkB(advisoryOf(early), 0, { work, github, advisory: () => ({}), url: () => "file://" + early.root });
    expect(a.gates.g1).toMatchObject({ fail: expect.stringContaining("author date 2026-06-20") });
    expect(a.gates.g2).toBe("ok");
    expect(a.gates.g4).toBeUndefined();
    const instr = history("2026-08-03T00:00:00Z", { "CLAUDE.md": "x\n" });
    const b = checkB(advisoryOf(instr), 0, { work: mkdtempSync(join(tmpdir(), "rms-b-")), github, advisory: () => ({}), url: () => "file://" + instr.root });
    expect(b.gates.g4).toBe("ok");
    expect(b.instructions).toMatchObject({ flags: { claude_md: true, root_claude_md: true, settings: false }, changed_by_unit: [], strip: [] });
    const late = history("2026-08-03T00:00:00Z");
    const opened = checkB(advisoryOf(late), 0, { work: mkdtempSync(join(tmpdir(), "rms-b-")), github: () => ({ created_at: "2026-06-01T00:00:00Z", commits: [], comments: {} }), advisory: () => ({}), url: () => "file://" + late.root });
    expect(opened.gates.g1).toEqual({ fail: "the fix PR's opening 2026-06-01T00:00:00Z is before 2026-07-01" });
  }, 60_000);
});
