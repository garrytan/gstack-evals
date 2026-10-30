import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Decoy, loadCatalog, type ReplayCase, scorableAsClean } from "../../lanes/review-replay/catalog/catalog.ts";

const LANE = join(import.meta.dir, "../../lanes/review-replay");
const PUBLIC = join(LANE, "catalog/public");
const SEED = "gstack-3516-ship-hook-actor-negation-guard";
const seed = (): ReplayCase => JSON.parse(readFileSync(join(PUBLIC, SEED + ".json"), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "replay-catalog-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function catalogOf(files: Record<string, unknown>): string {
  const dir = join(tmp, "c" + n++);
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
  return dir;
}
const audit = (verdict: "clean" | "holds-defect") => ({ later_fix_checked: true as const, later_fix: null, verdict, by: "U14", at: "2026-11-05", method: "searched later commits touching the range's files" });

describe("lanes/review-replay/catalog", () => {
  test("the public seeds validate and match GSTA-131's panel cases 1 and 2", () => {
    const { cases, problems } = loadCatalog(PUBLIC);
    expect(problems).toEqual([]);
    const panel = JSON.parse(readFileSync(join(LANE, "panel/panel-cases.json"), "utf8"));
    for (const p of panel) {
      const c = cases.find((x) => x.pr === p.pr)!;
      expect([c.reviewed_head, c.merge_base, c.fix.commit, c.defect.file, c.defect.line]).toEqual([p.reviewed_head, p.merge_base, p.fix_commit, p.finding.path, p.finding.line]);
      expect(c.visibility).toBe("public");
      expect(c.decoys.map((d) => [d.kind, d.range.to, d.audit])).toEqual([["fix-commit", p.fix_commit, null]]);
      expect(c.decoys.some(scorableAsClean)).toBe(false);
    }
    expect(cases).toHaveLength(panel.length);
  });

  test("a decoy is scorable as clean only when its audit says clean", () => {
    const d: Decoy = seed().decoys[0]!;
    expect(scorableAsClean({ ...d, audit: null })).toBe(false);
    expect(scorableAsClean({ ...d, audit: audit("holds-defect") })).toBe(false);
    expect(scorableAsClean({ ...d, audit: audit("clean") })).toBe(true);
  });

  test("a decoy that holds a defect is refused and named as a defect case", () => {
    const c = seed();
    c.decoys = [{ ...c.decoys[0]!, audit: { ...audit("holds-defect"), later_fix: { ref: "garrytan/gstack#2959", fixed: "a restore failure killed the server" } } }];
    const { cases, problems } = loadCatalog(catalogOf({ [SEED + ".json"]: c }));
    expect(cases).toEqual([]);
    expect(problems.map((p) => p.message).join("\n")).toContain("make it a defect case");
  });

  test("the schema refuses a missing field, a short sha and an audit that did not check for a later fix", () => {
    const missing = seed() as Partial<ReplayCase>;
    delete missing.credit;
    const short = { ...seed(), reviewed_head: "3712b79" };
    const unchecked = seed();
    unchecked.decoys = [{ ...unchecked.decoys[0]!, audit: { ...audit("clean"), later_fix_checked: false } as never }];
    for (const [bad, want] of [[missing, "credit"], [short, "/reviewed_head"], [unchecked, "/decoys/0/audit"]] as const) {
      const { cases, problems } = loadCatalog(catalogOf({ [SEED + ".json"]: bad }));
      expect(cases).toEqual([]);
      expect(problems.map((p) => p.message).join("\n")).toContain(want);
    }
  });

  test("a specialist role needs its checklist", () => {
    const c = seed();
    c.roles = [{ role: "specialist" }];
    expect(loadCatalog(catalogOf({ [SEED + ".json"]: c })).problems.length).toBeGreaterThan(0);
  });

  test("a sealed case is refused in the repo tree and loads from outside it", () => {
    const c = { ...seed(), visibility: "sealed" };
    const dir = catalogOf({ [SEED + ".json"]: c });
    const inRepo = loadCatalog(dir, tmp);
    expect(inRepo.cases).toEqual([]);
    expect(inRepo.problems[0]!.message).toContain("sealed case is in the repo tree");
    expect(loadCatalog(dir, join(tmp, "elsewhere")).problems).toEqual([]);
  });

  test("a duplicate id and a file not named after its id are refused", () => {
    const { cases, problems } = loadCatalog(catalogOf({ [SEED + ".json"]: seed(), "zz-copy.json": seed() }));
    expect(cases.map((c) => c.id)).toEqual([SEED]);
    const messages = problems.filter((p) => p.file === "zz-copy.json").map((p) => p.message).join("\n");
    expect(messages).toContain("duplicate id " + SEED);
    expect(messages).toContain("must be named " + SEED + ".json");
  });
});
