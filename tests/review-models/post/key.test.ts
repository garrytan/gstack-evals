// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the post key carries each pilot unit's pool, cluster, evidence, fix diff, markers and diff size from the
// supply's draw and gate records, under fresh opaque labels; fails_when=a B unit's advisory or CVE ids, a P unit's fix PR or
// a decoy's lack of a bug go missing, or two units share a label; why_new=GEVA-590 section 4's judge inputs and section 5's
// markers for the pilot; seam=buildKey with stub git and advisory readers; no_claim=that real clones hold every commit
import { describe, expect, test } from "bun:test";
import { buildKey, type KeySources } from "../../../lanes/review-models/post/key.ts";
import { readKey } from "../../../lanes/review-models/post/pilot.ts";
import type { Draw } from "../../../src/trial/review/supply/draw.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIC = "b".repeat(40), FIX = "f".repeat(40), PFIX = "c".repeat(40);
const p: any[] = [
  { id: "acme/app#12", repo: "acme/app", pr: 12, head: "1".repeat(40), base: "2".repeat(40), group: "S2-openai", rank: 97, decoy: false, ran: false, evidence: "Reviewer: the loop never ends.", paths: [], cases: [], fix: { commit: PFIX, pr: 15, dates: null }, head_dates: null, disclosure: {}, gates: { g1: "ok", g4: "ok" } },
  { id: "acme/docs#3", repo: "acme/docs", pr: 3, head: "3".repeat(40), base: "4".repeat(40), group: "N", rank: null, decoy: true, ran: false, evidence: "", paths: [], cases: [], fix: null, head_dates: null, disclosure: {}, gates: { g1: "ok", g4: "ok" } },
];
const b: any[] = [{ position: 4, ghsa: "GHSA-1111-2222-3333", repo: "acme/vault", ecosystem: "npm", published: "2026-08-01", fix: { kind: "pr", ref: "https://github.com/acme/vault/pull/88", commit: FIX, parent: "e".repeat(40) }, cves: ["CVE-2026-4242"], source_files: 1, szz: { bic: BIC, bic_lines: 3, blamed_lines: 4 }, shape: null, bic_dates: null, fix_dates: null, disclosure: {}, gates: {} }];
const unit = (id: string, pool: "P" | "B" | "decoy", repo: string) => ({ id, pool, repo, flags: null });
const draw = { schema: "rm-draw.v1", draw_seed: 1872089902, pilot: { p: [unit("acme/app#12", "P", "acme/app")], b: [unit("acme/vault#0@" + BIC.slice(0, 12), "B", "acme/vault")], decoy: unit("acme/docs#3", "decoy", "acme/docs") }, validation: [], counted: [unit("x#1", "P", "x"), unit("x#2", "P", "x"), unit("y#0@1", "B", "y")], decoys: [unit("z#1", "decoy", "z")], capped: [] } as unknown as Draw;
const calls: string[] = [];
const src: KeySources = {
  diff: (repo, from, to) => (calls.push("diff " + repo + " " + from.slice(0, 4) + " " + to.slice(0, 4)), "--- a/x\n+++ b/x\n"),
  diffLines: (repo, base, head) => (calls.push("lines " + repo + " " + base.slice(0, 4) + " " + head.slice(0, 4)), 42),
  advisory: (ghsa) => (ghsa === "GHSA-1111-2222-3333" ? { summary: "Token check uses ==", details: "Compare in constant time." } : null),
};

describe("the post key (keyless)", () => {
  test("pilot units carry their bug, markers and cluster; the counted set's shares come from the draw", () => {
    let n = 0;
    const k = buildKey(draw, p, b, src, () => "u_" + ++n);
    expect(k.counted).toEqual({ p: 2, b: 1, decoys: 1 });
    expect(k.pilot.map((u) => [u.label, u.pool, u.cluster, u.diff_lines])).toEqual([["u_1", "P", "acme/app#12", 42], ["u_2", "B", "acme/vault", 42], ["u_3", "decoy", "acme/docs#3", 42]]);
    expect(k.pilot[0]!.markers).toEqual({ unit: "acme/app#12", prs: ["acme/app#12", "acme/app#15"], commits: [PFIX], ids: [] });
    expect(k.pilot[0]!.stratum).toBe("S2-openai");
    expect(k.pilot[1]!.markers).toEqual({ unit: "acme/vault#0@" + BIC.slice(0, 12), prs: ["acme/vault#88"], commits: [FIX], ids: ["GHSA-1111-2222-3333", "CVE-2026-4242"] });
    expect(k.pilot[1]!.bug!.evidence).toBe("Advisory GHSA-1111-2222-3333: Token check uses ==\n\nCompare in constant time.");
    expect(k.pilot[2]!.bug).toBeNull();
    expect(calls).toContain("diff acme/app cccc cccc");
    expect(calls).toContain("diff acme/vault eeee ffff");
    expect(calls).toContain("lines acme/vault bbbb bbbb");
    const path = join(mkdtempSync(join(tmpdir(), "rm-key-")), "key.json");
    writeFileSync(path, JSON.stringify(k));
    expect(readKey(path).pilot.length).toBe(3);
  });
  test("labels never repeat, and an unreadable advisory refuses", () => {
    const seq = ["u_a", "u_a", "u_b", "u_c"];
    expect(new Set(buildKey(draw, p, b, src, () => seq.shift()!).pilot.map((u) => u.label)).size).toBe(3);
    expect(() => buildKey(draw, p, b, { ...src, advisory: () => null })).toThrow(/E_RM_POST_INPUT GHSA-1111-2222-3333: the advisory cannot be read/);
  });
});
