// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3 and 15.1: every unit gate on a known-good and a known-bad planted unit, the strip, the answer key's
// insert-only anchors, the drops before the draw, the supply check and the draw by position.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { B2Row } from "../../lanes/outcome-skills/h2h/breadth/b2.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { csoCandidates, cweFamilies, readAdvisory, repoAdvisoriesFromDb, unitAffected, type AdvisoryJson, type Candidate } from "../../lanes/outcome-skills/cso/units/advisory.ts";
import { assertSupply, buildUnits, isCommentLine, sessionTree, type UnitInput } from "../../lanes/outcome-skills/cso/units/build.ts";
import { draw, drawPlan } from "../../lanes/outcome-skills/cso/units/draw.ts";

const p = loadCsoPrereg();
const tmp = (n: string) => mkdtempSync(join(tmpdir(), "cso-units-" + n + "-"));
const g = (d: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: d, encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
};
const put = (root: string, files: Record<string, string | Buffer | null>) => {
  for (const [f, c] of Object.entries(files)) {
    const at = join(root, f);
    if (c === null) spawnSync("rm", ["-rf", at]);
    else {
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, c);
    }
  }
};
const SRC = "export function check(x) {\n  const y = x.trim();\n  return y;\n}\n";
const BASE = { "src/a.ts": SRC, "test/a.test.ts": "test('a', () => {});\n", "package.json": "{}\n" };

/** A planted repository: a parent commit and a fix commit dated fixDate, served over file:// for partial fetches. */
function plant(parentFiles: Record<string, string | Buffer>, fixFiles: Record<string, string | null>, fixDate = "2026-08-01T12:00:00Z") {
  const root = tmp("repo");
  writeFileSync(join(root, ".gstack-test-fixture"), "");
  const dir = join(root, "r");
  mkdirSync(dir);
  g(dir, ["init", "-q"]);
  g(dir, ["config", "uploadpack.allowFilter", "true"]);
  g(dir, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
  put(dir, { "old.ts": "export const old = 1;\n" });
  g(dir, ["add", "-A", "-f"]);
  g(dir, ["commit", "-q", "-m", "older"], { GIT_COMMITTER_DATE: "2026-05-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-05-01T00:00:00Z" });
  const older = g(dir, ["rev-parse", "HEAD"]);
  put(dir, parentFiles);
  g(dir, ["add", "-A", "-f"]);
  g(dir, ["commit", "-q", "-m", "parent"], { GIT_COMMITTER_DATE: "2026-06-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-06-01T00:00:00Z" });
  const parent = g(dir, ["rev-parse", "HEAD"]);
  put(dir, { "test/a.test.ts": "test('a fixed', () => {});\n", ...fixFiles });
  g(dir, ["add", "-A", "-f"]);
  g(dir, ["commit", "-q", "-m", "fix"], { GIT_COMMITTER_DATE: fixDate, GIT_AUTHOR_DATE: fixDate });
  const fix = g(dir, ["rev-parse", "HEAD"]);
  put(dir, { "later.ts": "export const later = 1;\n" });
  g(dir, ["add", "-A"]);
  g(dir, ["commit", "-q", "-m", "later"], { GIT_COMMITTER_DATE: "2026-09-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-09-01T00:00:00Z" });
  const later = g(dir, ["rev-parse", "HEAD"]);
  return { url: "file://" + dir, parent, fix, older, later };
}

const GHSA = ["GHSA-2345-6789-cfgh", "GHSA-3456-789c-fghj", "GHSA-4567-89cf-ghjm", "GHSA-5678-9cfg-hjmp", "GHSA-6789-cfgh-jmpq", "GHSA-789c-fghj-mpqr", "GHSA-89cf-ghjm-pqrv", "GHSA-9cfg-hjmp-qrvw", "GHSA-cfgh-jmpq-rvwx", "GHSA-fghj-mpqr-vwx2", "GHSA-ghjm-pqrv-wx23", "GHSA-hjmp-qrvw-x234"];
let n = 0;
function unit(repo: string, r: { parent: string; fix: string }, o: { ghsa?: string; cwes?: string[]; cves?: string[]; part?: "part1" | "part2" } = {}): UnitInput & { url: string } {
  const ghsa = o.ghsa ?? GHSA[n++ % GHSA.length]!;
  const row: B2Row = { ghsa, advisory_path: "advisories/x/" + ghsa + ".json", repo, published: "2026-08-02", month: "2026-08", window: "primary", ecosystem: "npm", licence: "MIT", second_read_pending: false, licence_from: "graphql", fix: { kind: "commit", ref: r.fix, commit: r.fix, parent: r.parent }, fix_refs: 1, files: { test: 1, source: 1, total: 2 } };
  const c: Candidate = { unit: (repo.replace("/", "__") + "-" + ghsa).toLowerCase(), part: o.part ?? "part1", index: n, row };
  const advisory: AdvisoryJson = { id: ghsa, aliases: o.cves ?? [], summary: "s " + ghsa, details: "d", database_specific: { cwe_ids: o.cwes ?? ["CWE-79"] } };
  return { c, advisory, url: (r as { url?: string }).url ?? "" };
}
function run(inputs: Array<UnitInput & { url: string }>, extra: Partial<Parameters<typeof buildUnits>[1]> = {}) {
  const urls = new Map(inputs.map((i) => [i.c.row.repo, i.url]));
  const work = tmp("work");
  return { work, res: buildUnits(inputs, { p, work, need: inputs.length, remote: (repo) => urls.get(repo)!, namedDrops: [], ...extra }) };
}
const gate = (res: ReturnType<typeof buildUnits>, u: { c: Candidate }) => res.gates.find((x) => x.unit === u.c.unit)!;

describe("cso units: candidates and advisories", () => {
  test("the frozen order joins every prereg id to its b2-frame row, part 1 first", () => {
    const c = csoCandidates(p);
    expect(c.length).toBe(p.units.part1_h2h.length + p.units.part2_added.length);
    expect(c[0]!.unit).toBe(p.units.part1_h2h[0]!);
    expect(c[p.units.part1_h2h.length]!.part).toBe("part2");
    expect(c.every((x) => x.row.fix.commit.length === 40)).toBe(true);
  });
  test("a frame whose sha256 is not the pin refuses", () => {
    const d = tmp("frame");
    const f = join(d, "b2-frame.json");
    cpSync(join(import.meta.dir, "..", "..", String(p.pins.frame.file)), f);
    writeFileSync(f, readFileSync(f, "utf8") + " ");
    expect(() => csoCandidates(p, f)).toThrow(/^E_CSO_UNIT_FRAME /);
  });
  test("the advisory comes from the pinned commit through a fake transport, cached, and a bad reply refuses", async () => {
    const row = unit("o/x", { parent: "a".repeat(40), fix: "b".repeat(40) }).c.row;
    const work = tmp("adv");
    const urls: string[] = [];
    const a = await readAdvisory(p, row, work, async (u) => (urls.push(u), { status: 200, text: JSON.stringify({ id: row.ghsa, database_specific: { cwe_ids: ["CWE-22"] } }) }));
    expect(urls[0]).toBe("https://raw.githubusercontent.com/github/advisory-database/a91f5a514f4697f0303f547c9b50a12eb07fa70f/" + row.advisory_path);
    expect(a.id).toBe(row.ghsa);
    await readAdvisory(p, row, work, async () => { throw new Error("no second fetch"); });
    await expect(readAdvisory(p, row, tmp("adv"), async () => ({ status: 404, text: "" }))).rejects.toThrow(/^E_CSO_ADVISORY /);
    await expect(readAdvisory(p, row, tmp("adv"), async () => ({ status: 200, text: JSON.stringify({ id: "GHSA-other" }) }))).rejects.toThrow(/^E_CSO_ADVISORY /);
  });
  test("CWE families come from the frozen map, a CWE in two families gets both, and an unmapped CWE gets none", () => {
    expect(cweFamilies(p, ["CWE-79"])).toEqual(["xss"]);
    expect(cweFamilies(p, ["CWE-776"])).toEqual(["xml-entities", "denial-of-service"]);
    expect(cweFamilies(p, ["CWE-20"])).toEqual([]);
    expect(unitAffected("u", { id: "x", affected: [{ package: { ecosystem: "npm", name: "a" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.2.0" }] }] }] }).affected[0]!.ranges).toEqual([[{ introduced: "0" }, { fixed: "1.2.0" }]]);
  });
});

describe("cso units: the repository's other advisories", () => {
  test("a checkout's reviewed advisories by repository: a commit reference names the fix, a pull reference alone names none, withdrawn ones are skipped", () => {
    const db = tmp("db");
    const adv = (id: string, refs: string[], extra: Record<string, unknown> = {}) => {
      const d = join(db, "advisories/github-reviewed/2026/08", id);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, id + ".json"), JSON.stringify({ id, summary: "s " + id, references: refs.map((url) => ({ type: "WEB", url })), ...extra }));
    };
    adv("GHSA-aaaa-aaaa-aaaa", ["https://github.com/Org/Repo/pull/12", "https://github.com/Org/Repo/commit/" + "c".repeat(40)]);
    adv("GHSA-bbbb-bbbb-bbbb", ["https://github.com/org/repo/pull/13"]);
    adv("GHSA-cccc-cccc-cccc", ["https://github.com/org/repo/commit/" + "d".repeat(40)], { withdrawn: "2026-09-01T00:00:00Z" });
    adv("GHSA-dddd-dddd-dddd", ["https://github.com/other/repo/commit/" + "e".repeat(40)]);
    const look = repoAdvisoriesFromDb(db, ["org/repo"]);
    expect(look("ORG/repo").sort((a, b) => (a.ghsa < b.ghsa ? -1 : 1))).toEqual([{ ghsa: "GHSA-aaaa-aaaa-aaaa", summary: "s GHSA-aaaa-aaaa-aaaa", fix_commit: "c".repeat(40) }, { ghsa: "GHSA-bbbb-bbbb-bbbb", summary: "s GHSA-bbbb-bbbb-bbbb", fix_commit: null }]);
    expect(look("other/repo")).toEqual([]);
  });
});

describe("cso units: the six gates on planted units", () => {
  test("a unit obeying every rule passes every gate and gets its record", () => {
    const r = plant({ ...BASE, Dockerfile: "FROM scratch\n" }, { "src/a.ts": SRC.replace("x.trim()", "String(x).trim()") });
    const u = unit("good/repo", r, { cves: ["CVE-2026-1234"] });
    const { work, res } = run([u]);
    expect(gate(res, u)).toEqual({ unit: u.c.unit, part: "part1", index: u.c.index, usable: true, position: 1 });
    const rec = res.units[0]!;
    expect(rec.fix_files).toEqual(["src/a.ts"]);
    expect(rec.hunks).toEqual([{ file: "src/a.ts", start: 2, end: 2, insert_only: false, text: "  const y = x.trim();" }]);
    expect(rec.cwe_families).toEqual(["xss"]);
    expect(rec.kind).toBe("service");
    expect(rec.source_files).toBe(2);
    expect(rec.cves).toEqual(["CVE-2026-1234"]);
    expect(JSON.parse(readFileSync(join(work, "units", u.c.unit + ".json"), "utf8")).position).toBe(1);
  });
  test("gate 1: a fix committed before 2026-07-01 drops; one on 2026-07-01 passes", () => {
    const bad = unit("date/bad", plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") }, "2026-06-30T23:59:59Z"));
    const ok = unit("date/ok", plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") }, "2026-07-01T00:00:00Z"));
    const { res } = run([bad, ok]);
    expect(gate(res, bad)).toMatchObject({ usable: false, gate: "fix_commit_date", code: "E_CSO_DROP_FIX_DATE" });
    expect(gate(res, ok)).toMatchObject({ usable: true, position: 1 });
  });
  test("gate 2: a fix commit the remote lacks, or a frame parent that is not the first parent, drops", () => {
    const r = plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") });
    const missing = unit("fetch/missing", { ...r, fix: "f".repeat(40) });
    const wrong = unit("fetch/wrong", { ...r, parent: r.older });
    const { res } = run([missing, wrong]);
    expect(gate(res, missing)).toMatchObject({ usable: false, gate: "fetch", code: "E_CSO_DROP_FETCH" });
    expect(gate(res, wrong)).toMatchObject({ usable: false, gate: "fetch" });
    expect((gate(res, wrong) as { reason: string }).reason).toContain("first parent");
  });
  test("gate 3: a second advisory with the same fix commit drops; the first keeps its position", () => {
    const r = plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") });
    const first = unit("same/fix", r), second = unit("same/fix", r);
    const { res } = run([first, second]);
    expect(gate(res, first)).toMatchObject({ usable: true, position: 1 });
    expect(gate(res, second)).toMatchObject({ usable: false, gate: "same_fix", code: "E_CSO_DROP_SAME_FIX" });
  });
  test("gate 4: an advisory with no CWE id drops", () => {
    const u = unit("cwe/none", plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") }), { cwes: [] });
    expect(gate(run([u]).res, u)).toMatchObject({ usable: false, gate: "cwe", code: "E_CSO_DROP_CWE" });
  });
  test("gate 5: a fix that only adds files drops", () => {
    const u = unit("key/adds", plant(BASE, { "src/new.ts": "export const guard = (x) => x;\n" }));
    const g5 = gate(run([u]).res, u);
    expect(g5).toMatchObject({ usable: false, gate: "answer_key", code: "E_CSO_DROP_ANSWER_KEY" });
    expect((g5 as { reason: string }).reason).toContain("exists at the parent");
  });
  test("gate 5: a fix whose only source changes are whitespace, a blank line and a comment drops", () => {
    const src = "// check input\nexport function check(x) {\n  const y = x.trim();\n  return y;\n}\n";
    const u = unit("key/cosmetic", plant({ ...BASE, "src/a.ts": src }, { "src/a.ts": "// check the input value\nexport function check(x) {\n\n    const y = x.trim();\n  /* safe */\n  return y;\n}\n" }));
    const g5 = gate(run([u]).res, u);
    expect(g5).toMatchObject({ usable: false, gate: "answer_key" });
    expect((g5 as { reason: string }).reason).toContain("whitespace");
  });
  test("gate 5: a fix that only inserts a missing check is kept with its anchor lines, one line at each file edge", () => {
    const fixed = "import { ok } from './ok';\nexport function check(x) {\n  if (!ok(x)) throw new Error('bad');\n  const y = x.trim();\n  return y;\n}\nexport default check;\n";
    const u = unit("key/insert", plant(BASE, { "src/a.ts": fixed }));
    const { res } = run([u]);
    expect(gate(res, u)).toMatchObject({ usable: true });
    expect(res.units[0]!.hunks).toEqual([
      { file: "src/a.ts", start: 1, end: 1, insert_only: true, added: ["import { ok } from './ok';"], text: "export function check(x) {" },
      { file: "src/a.ts", start: 1, end: 2, insert_only: true, added: ["  if (!ok(x)) throw new Error('bad');"], text: "export function check(x) {\n  const y = x.trim();" },
      { file: "src/a.ts", start: 4, end: 4, insert_only: true, added: ["export default check;"], text: "}" },
    ]);
  });
  test("gate 6: a planted GHSA id in a file drops, in any case", () => {
    const u = unit("contain/file", plant({ ...BASE, "docs/notes.md": "see ghsa-2345-6789-CFGH\n" }, { "src/a.ts": SRC.replace("trim", "trimEnd") }), { ghsa: "GHSA-2345-6789-cfgh" });
    const g6 = gate(run([u]).res, u);
    expect(g6).toMatchObject({ usable: false, gate: "containment", code: "E_CSO_DROP_CONTAINMENT" });
    expect((g6 as { reason: string }).reason).toContain("docs/notes.md");
  });
  test("gate 6: a planted later object in a vendored git store drops; the plain tree with no store passes", () => {
    const store = tmp("store");
    g(store, ["init", "-q", "--bare", "m.git"]);
    const m = join(store, "m.git");
    const tree = spawnSync("git", ["--git-dir", m, "mktree"], { input: "", encoding: "utf8" }).stdout.trim();
    const later = g(store, ["--git-dir", m, "commit-tree", tree, "-m", "later fix for GHSA-3456-789c-fghj"]);
    g(store, ["--git-dir", m, "update-ref", "refs/heads/main", later]);
    expect(readFileSync(join(m, "refs/heads/main"), "utf8").trim()).toBe(later);
    const files: Record<string, string | Buffer> = { ...BASE };
    const walk = (d: string, rel: string) => {
      for (const e of spawnSync("ls", ["-A", d], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)) {
        const abs = join(d, e);
        if (spawnSync("test", ["-d", abs]).status === 0) walk(abs, rel + "/" + e);
        else files["vendor/m.git" + rel + "/" + e] = readFileSync(abs);
      }
    };
    walk(m, "");
    const bad = unit("contain/object", plant(files, { "src/a.ts": SRC.replace("trim", "trimEnd") }), { ghsa: "GHSA-3456-789c-fghj" });
    const ok = unit("contain/clean", plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") }), { ghsa: "GHSA-3456-789c-fghj" });
    const { res } = run([bad, ok]);
    expect(gate(res, bad)).toMatchObject({ usable: false, gate: "containment" });
    expect((gate(res, bad) as { reason: string }).reason).toContain("at git vendor/m.git");
    expect(gate(res, ok)).toMatchObject({ usable: true, position: 1 });
  });
  test("gate 6: a session tree whose vendored git store git cannot read drops with its own code, and the build goes on", () => {
    const store = { "vendor/broken/HEAD": "ref: refs/heads/main\n", "vendor/broken/refs/heads/main": "a".repeat(40) + "\n", ["vendor/broken/objects/ab/" + "c".repeat(38)]: "not a zlib stream\n" };
    const bad = unit("contain/unreadable", plant({ ...BASE, ...store }, { "src/a.ts": SRC.replace("trim", "trimEnd") }));
    const ok = unit("contain/readable", plant(BASE, { "src/a.ts": SRC.replace("trim", "trimStart") }));
    const { work, res } = run([bad, ok]);
    expect(gate(res, bad)).toMatchObject({ usable: false, gate: "containment", code: "E_CSO_DROP_SCAN" });
    expect((gate(res, bad) as { reason: string }).reason).toContain("git cat-file vendor/broken");
    expect(existsSync(join(work, "trees", bad.c.unit))).toBe(false);
    expect(gate(res, ok)).toMatchObject({ usable: true, position: 1 });
  });
  test("gate 6: a CVE id of the advisory in a file drops, and a longer CVE id that runs on does not", () => {
    const bad = unit("contain/cve", plant({ ...BASE, "SECURITY.md": "CVE-2026-4321 fixed\n" }, { "src/a.ts": SRC.replace("trim", "trimEnd") }), { cves: ["CVE-2026-4321"] });
    const ok = unit("contain/cve-long", plant({ ...BASE, "SECURITY.md": "CVE-2026-43210 fixed\n" }, { "src/a.ts": SRC.replace("trim", "trimStart") }), { cves: ["CVE-2026-4321"] });
    const { res } = run([bad, ok]);
    expect(gate(res, bad)).toMatchObject({ usable: false, gate: "containment" });
    expect(gate(res, ok)).toMatchObject({ usable: true, position: 1 });
  });
});

describe("cso units: the session tree and the record", () => {
  test("the strip removes memory files, .claude dirs and nothing else, and the tree is one commit with no history", () => {
    const r = plant({ ...BASE, "CLAUDE.md": "x", "pkg/CLAUDE.local.md": "x", "pkg/deep/AGENTS.md": "x", ".claude/settings.json": "{}", "pkg/.claude/agents/a.md": "x", "pkg/claude.ts": "export {};\n" }, { "src/a.ts": SRC.replace("trim", "trimEnd") });
    const u = unit("strip/repo", r);
    const { work, res } = run([u]);
    expect(res.stripped[u.c.unit]).toEqual([".claude", "CLAUDE.md", "pkg/.claude", "pkg/CLAUDE.local.md", "pkg/deep/AGENTS.md"]);
    const tree = join(work, "trees", u.c.unit);
    expect(existsSync(join(tree, "pkg/claude.ts"))).toBe(true);
    expect(existsSync(join(tree, "CLAUDE.md"))).toBe(false);
    expect(g(tree, ["rev-list", "--count", "HEAD"])).toBe("1");
    expect(g(tree, ["status", "--porcelain"])).toBe("");
    expect(res.units[0]!.kind).toBe("library");
    expect(res.units[0]!.tree_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  test("known open advisories: a fix after the audited commit stays, one already in its history goes, one with no fix commit stays", () => {
    const r = plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd"), "src/b.ts": "export const b = 1;\n" });
    const u = unit("open/repo", r);
    const { res } = run([u], { repoAdvisories: () => [
      { ghsa: u.c.row.ghsa, summary: "self", fix_commit: r.fix },
      { ghsa: "GHSA-later", summary: "later", fix_commit: r.later },
      { ghsa: "GHSA-older", summary: "older", fix_commit: r.older },
      { ghsa: "GHSA-nofix", summary: "pull only", fix_commit: null },
    ] });
    expect(res.units[0]!.known_open).toEqual([{ ghsa: "GHSA-later", summary: "later", files: ["later.ts"] }, { ghsa: "GHSA-nofix", summary: "pull only", files: [] }]);
  });
  test("comment lines by language", () => {
    expect(isCommentLine("ts", "  // x")).toBe(true);
    expect(isCommentLine("ts", " * x")).toBe(true);
    expect(isCommentLine("ts", "x = 1; // y")).toBe(false);
    expect(isCommentLine("python", "# x")).toBe(true);
    expect(isCommentLine("go", "return nil")).toBe(false);
  });
});

describe("cso units: drops before the draw and the supply check", () => {
  test("named drops, install id hits and install dep hits drop with their own codes and take no position", () => {
    const r = plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") });
    const a = unit("pre/a", r), b = unit("pre/b", r), c = unit("pre/c", r), d = unit("pre/d", r);
    const { res } = run([a, b, c, d], { namedDrops: [{ unit: a.c.unit, line: "bun.lock x@2, fixed in 1" }], installDrops: { id: [b.c.unit], dep: [c.c.unit] } });
    expect(gate(res, a)).toMatchObject({ usable: false, gate: "install_dep", code: "E_CSO_DROP_INSTALL_DEP" });
    expect(gate(res, b)).toMatchObject({ usable: false, gate: "install_id", code: "E_CSO_DROP_INSTALL_ID" });
    expect(gate(res, c)).toMatchObject({ usable: false, gate: "install_dep" });
    expect(gate(res, d)).toMatchObject({ usable: true, position: 1 });
  });
  test("the build stops at need, and the supply check refuses with the count when the list runs out", () => {
    const r1 = plant(BASE, { "src/a.ts": SRC.replace("trim", "trimEnd") });
    const r2 = plant({ ...BASE, "src/b.ts": "export const b = 2;\n" }, { "src/a.ts": SRC.replace("trim", "trimStart") });
    const urls = new Map([["sup/a", r1.url], ["sup/b", r2.url]]);
    const ins = [unit("sup/a", r1), unit("sup/b", r2)];
    const one = buildUnits(ins, { p, work: tmp("w"), need: 1, remote: (x) => urls.get(x)!, namedDrops: [] });
    expect(one.gates.length).toBe(1);
    expect(() => assertSupply(one)).not.toThrow();
    const short = buildUnits(ins, { p, work: tmp("w"), need: 134, remote: (x) => urls.get(x)!, namedDrops: [] });
    expect(() => assertSupply(short)).toThrow("E_CSO_SUPPLY the candidate list ran out at 2 usable units; the plan needs 134");
  });
});

describe("cso units: the draw by position", () => {
  const plan = drawPlan(p);
  const units = Array.from({ length: 134 }, (_, i) => ({ unit: "u" + (i + 1), position: i + 1, source_files: i % 2 ? 500 : 100 }));
  test("the frozen numbers come from prereg.json and sum to the 134 the plan states", () => {
    expect(plan).toMatchObject({ stage0: [1, 2], repilot: 12, n2_min: 48, n2_max: 100, n2_step: 4, reserve: 8, size_split: 300, supply: 134 });
  });
  test("stage 0, stage 1, stage 2 from 3 upward skipping both, and 8 reserves", () => {
    const d = draw(plan, units, 60);
    const of = (role: string) => d.units.filter((u) => u.role === role).map((u) => u.position);
    expect(of("stage0")).toEqual([1, 2]);
    expect(of("stage1")).toEqual(p.units.positions.stage1 as number[]);
    const s2 = of("stage2");
    expect(s2.length).toBe(60);
    expect(s2.slice(0, 6)).toEqual([3, 4, 5, 6, 8, 9]);
    expect(s2.some((x) => (p.units.positions.stage1 as number[]).includes(x))).toBe(false);
    const after = units.map((u) => u.position).filter((x) => x > s2[59]! && !(p.units.positions.stage1 as number[]).includes(x)).slice(0, 8);
    expect(of("reserve")).toEqual(after);
    expect(of("reserve").length).toBe(8);
  });
  test("a floor raise re-pilots on the first 12 unused small repositories and stage 2 skips them", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ unit: "u" + (i + 1), position: i + 1, source_files: i % 2 ? 500 : 100 }));
    const d = draw(plan, many, 48, "floor");
    const rp = d.units.filter((u) => u.role === "repilot").map((u) => u.position);
    expect(rp).toEqual([3, 5, 9, 11, 13, 15, 19, 21, 23, 25, 29, 31]);
    const s2 = d.units.filter((u) => u.role === "stage2");
    expect(s2.every((u) => u.position % 2 === 1 && !rp.includes(u.position))).toBe(true);
  });
  test("n2 outside the rule, or more than the build filled, refuses", () => {
    expect(() => draw(plan, units, 50)).toThrow(/^E_CSO_DRAW /);
    expect(() => draw(plan, units, 104)).toThrow(/^E_CSO_DRAW /);
    expect(() => draw(plan, units.slice(0, 70), 60)).toThrow(/^E_CSO_DRAW /);
    expect(draw(plan, units, 100).units.length).toBe(134 - 12);
  });
});
