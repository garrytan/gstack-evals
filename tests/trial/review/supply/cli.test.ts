// Value: protects=rm-supply's draw and counts subcommands read gate records from files, counts writes only counts and
// digests, and errors print their reason code; fails_when=counts leaks a fix or BIC sha, or an input error escapes as an
// internal error; why_new=GEVA-590 section 10 item 3 command; seam=main with planted records; no_claim=the network
// subcommands, which the module tests cover through their functions
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../../src/trial/review/supply/cli.ts";

const P = (rank: number) => ({ id: "p" + rank, repo: "o/p" + rank, pr: rank, head: "h", base: "b", group: "S1", rank, decoy: false, ran: rank < 60, evidence: "", paths: [], cases: [], fix: { commit: "f".repeat(40), pr: rank, dates: { author: "", committer: "" } }, head_dates: null, disclosure: {}, gates: { g1: "ok", g4: "ok" } });
const D = (i: number) => ({ ...P(0), id: "n" + i, repo: "o/n" + i, rank: null, decoy: true, fix: null });
const bic = (i: number) => i.toString(16).padStart(40, "b");
const B = (position: number) => ({ position, ghsa: "GHSA-" + position, repo: "o/b" + position, ecosystem: "npm", published: "2026-08-01", fix: { kind: "commit", ref: "", commit: "c".repeat(40), parent: "p" }, cves: [], source_files: 1, szz: { basis: "deleted", blamed_lines: 2, blamed_commits: 1, bic: bic(position), bic_lines: 2 }, shape: { parents: 1, files: 1, lines: 3, source_lines: 3 }, bic_dates: null, fix_dates: null, disclosure: {}, gates: { g1: "ok", g2: "ok", g4: "ok" } });

describe("rm-supply command", () => {
  test("draw then counts on planted records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rms-cli-"));
    const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r) + "\n").join("");
    writeFileSync(join(dir, "p.jsonl"), jsonl([...Array.from({ length: 101 }, (_, i) => P(i + 1)), ...Array.from({ length: 15 }, (_, i) => D(i))]));
    const bs = Array.from({ length: 30 }, (_, i) => B(i));
    writeFileSync(join(dir, "b.jsonl"), jsonl(bs));
    writeFileSync(join(dir, "vis.json"), JSON.stringify(Object.fromEntries(bs.map((b) => [b.ghsa, { unit: "", verdicts: {}, g3: "ok" }]))));
    const f = (n: string) => join(dir, n);
    expect(await main(["draw", "--p", f("p.jsonl"), "--b", f("b.jsonl"), "--visibility", f("vis.json"), "--out", f("draw.json")])).toBe(0);
    const d = JSON.parse(readFileSync(f("draw.json"), "utf8"));
    expect([d.pilot.p.length, d.pilot.b.length, d.validation.length, d.counted.length, d.decoys.length]).toEqual([5, 5, 17, 100, 15]);
    expect(await main(["counts", "--p", f("p.jsonl"), "--b", f("b.jsonl"), "--visibility", f("vis.json"), "--draw", f("draw.json"), "--out", f("counts.json")])).toBe(0);
    const text = readFileSync(f("counts.json"), "utf8");
    const c = JSON.parse(text);
    expect(c.p.bug_units).toEqual({ units: 101, errors: 0, g1: 101, g4: 101, g1_and_g4: 101 });
    expect(c.b.gates_in_order).toEqual({ g1: 30, g1_g2: 30, g1_g2_g4: 30, g1_g2_g4_g3: 30, awaiting_read: 0 });
    expect(c.draw).toMatchObject({ counted: 100, validation: 17, decoys: 15 });
    expect(Object.keys(c.sha256)).toEqual(["p", "b", "visibility", "draw"]);
    expect(c.instruction_files_after_gate4.p_bug_units).toMatchObject({ units: 101, claude_md: 0, stripped_settings: 0 });
    expect(c.draw_instruction_files).toMatchObject({ units: 142, settings: 0 });
    for (const leak of ["f".repeat(12), "c".repeat(12), bic(3).slice(0, 12), "GHSA-"]) expect(text).not.toContain(leak);
  });

  test("usage errors print their reason code", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["nope"])).toBe(2);
    expect(await main(["draw", "--bogus", "x"])).toBe(2);
  });
});
