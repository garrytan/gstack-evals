// Copyright (c) 2026 Garry Tan. MIT License.
// The family SM dry run (dryrun.ts): keyless, the expected-field check, the CLI arguments per case kind and the stop at
// the first miss, with a stand-in runner. Gated (GSTACK_EVALS_DOCKER=1 and GSTACK_EVALS_SM_DRYRUN_CONFIG naming a config
// of real units outside the repo), the real dry run must end DRYRUN: ok.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseArgs, dryrun, misses, type DryrunConfig } from "../../lanes/outcome-skills/statemachines/dryrun.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const cfg = (): DryrunConfig => ({
  schema: "sm-dryrun-config.v1",
  units: { u: { dir: "/units/acme__widget-1", image_digest: "sha256:" + "0".repeat(64) } },
  cases: [
    { name: "fix", kind: "first", unit: "u", patch: "/p/fix.patch", expect: { "strict.outcome": "clean_fix", "adapted.outcome": "clean_fix" } },
    { name: "base", kind: "first", unit: "u", expect: { "strict.outcome": "no_fix" } },
    { name: "after", kind: "first", unit: "u", patch: "/p/x.patch", expect: { "strict.outcome": "no_fix" } },
  ],
});

describe("sm dryrun", () => {
  test("misses names each expected field the record does not hold", () => {
    const rec = { strict: { outcome: "clean_fix" }, adapted: { outcome: "fix_broke", fell_back_to_strict: null } };
    expect(misses(rec, { "strict.outcome": "clean_fix" })).toEqual([]);
    expect(misses(rec, { "adapted.outcome": "clean_fix", "adapted.fell_back_to_strict": null })).toEqual(['adapted.outcome: got "fix_broke", want "clean_fix"']);
    expect(misses(rec, { "strict.gap.kind": "x" })).toHaveLength(1);
  });
  test("a base case scores the empty change with --run-empty; a follow-on case names its tree and start set", () => {
    expect(caseArgs(cfg().cases[1]!, "/units/a", "/o/base.json")).toEqual(["outcome", "sm", "score", "first", "--unit", "/units/a", "--patch", "/dev/null", "--cell", "base", "--run-empty", "--out", "/o/base.json"]);
    expect(caseArgs({ name: "f", kind: "followon", unit: "u", tree: "A1", tree_patch: "/p/a1.patch", start: "/p/start.json", patch: "/p/f.patch", expect: {} }, "/units/a", "/o/f.json")).toEqual(["outcome", "sm", "score", "followon", "--unit", "/units/a", "--tree", "A1", "--tree-patch", "/p/a1.patch", "--start", "/p/start.json", "--patch", "/p/f.patch", "--cell", "f", "--out", "/o/f.json"]);
    expect(() => caseArgs({ name: "f", kind: "followon", unit: "u", expect: {} }, "/u", "/o")).toThrow("E_USAGE");
    expect(caseArgs({ name: "c", kind: "contain", unit: "u", expect: { ok: true } }, "/units/a", "/o/c.json")).toEqual(["outcome", "sm", "contain", "--unit", "/units/a", "--out", "/o/c.json"]);
  });
  test("cases run in order, one line each, and the run stops at the first miss", () => {
    const d = mkdtempSync(join(tmpdir(), "sm-dryrun-"));
    roots.push(d);
    const lines: string[] = [];
    const ran: string[] = [];
    const run = (args: string[]) => {
      const out = args[args.indexOf("--out") + 1]!;
      ran.push(out);
      writeFileSync(out, JSON.stringify({ strict: { outcome: out.endsWith("fix.json") ? "clean_fix" : "fix_broke" }, adapted: { outcome: "clean_fix" } }));
      return { status: 0, out: "" };
    };
    expect(dryrun(cfg(), join(d, "a"), { run, log: (l) => lines.push(l) })).toBe(1);
    expect(ran).toHaveLength(2);
    expect(lines[0]).toStartWith("PASS fix:");
    expect(lines[1]).toStartWith("FAIL base: strict.outcome");
    expect(lines.some((l) => l.startsWith("DRYRUN"))).toBe(false);
    const ok = (args: string[]) => (writeFileSync(args[args.indexOf("--out") + 1]!, JSON.stringify({ strict: { outcome: args.includes("/p/fix.patch") ? "clean_fix" : "no_fix" }, adapted: { outcome: "clean_fix" } })), { status: 0, out: "" });
    lines.length = 0;
    expect(dryrun(cfg(), join(d, "b"), { run: ok, log: (l) => lines.push(l) })).toBe(0);
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toBe("DRYRUN: ok");
    expect(() => dryrun(cfg(), join(d, "b"), { run: ok, log: () => {} })).toThrow("exists");
    lines.length = 0;
    expect(dryrun(cfg(), join(d, "c"), { from: "after", run: ok, log: (l) => lines.push(l) })).toBe(0);
    expect(lines).toEqual(['PASS after: strict.outcome="no_fix"', "DRYRUN: ok"]);
    expect(dryrun(cfg(), join(d, "e"), { run: () => ({ status: 2, out: "E_SM_UNIT no rebuild rule flag" }), log: (l) => lines.push(l) })).toBe(1);
    expect(lines.at(-1)).toContain("exit 2: E_SM_UNIT");
  });
  // Value: protects=a planted-leak control in the dry run: sm contain exits 2 (E_SM_CONTAIN) after writing its record, so a contain case reads the record whatever the exit; fails_when=a contain case expecting ok false fails on the exit alone, or one with no record passes; why_new=Capy's review of #318; seam=dryrun.ts dryrun; no_claim=the check itself (sm-predata's containment tests)
  test("a contain case reads its record even when sm contain exits 2, and fails with no record", () => {
    const d = mkdtempSync(join(tmpdir(), "sm-dryrun-"));
    roots.push(d);
    const c: DryrunConfig = { schema: "sm-dryrun-config.v1", units: { u: { dir: "/units/u", image_digest: "sha256:" + "a".repeat(64) } }, cases: [{ name: "leak", kind: "contain", unit: "u", expect: { ok: false } }] };
    const lines: string[] = [];
    const planted = (args: string[]) => (writeFileSync(args[args.indexOf("--out") + 1]!, JSON.stringify({ schema: "sm-contain.v1", unit: "u", ok: false })), { status: 2, out: "E_SM_CONTAIN u (first image) fails" });
    expect(dryrun(c, join(d, "a"), { run: planted, log: (l) => lines.push(l) })).toBe(0);
    expect(lines).toEqual(["PASS leak: ok=false", "DRYRUN: ok"]);
    lines.length = 0;
    expect(dryrun(c, join(d, "b"), { run: () => ({ status: 2, out: "E_SM_CONTAIN the check did not run" }), log: (l) => lines.push(l) })).toBe(1);
    expect(lines.at(-1)).toContain("FAIL leak: exit 2: E_SM_CONTAIN the check did not run");
  });
});

const gated = process.env.GSTACK_EVALS_DOCKER === "1" && !!process.env.GSTACK_EVALS_SM_DRYRUN_CONFIG;
test.skipIf(!gated)("the real dry run on its config's units ends DRYRUN: ok", async () => {
  const { readFileSync } = await import("node:fs");
  const d = mkdtempSync(join(tmpdir(), "sm-dryrun-real-"));
  roots.push(d);
  const lines: string[] = [];
  expect(dryrun(JSON.parse(readFileSync(process.env.GSTACK_EVALS_SM_DRYRUN_CONFIG!, "utf8")), d, { log: (l) => (lines.push(l), console.log(l)) })).toBe(0);
  expect(lines.at(-1)).toBe("DRYRUN: ok");
}, 6 * 3600_000);
