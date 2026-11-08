// The CEO stage 2 results post (wiki/board/2026-11-08-geva-402-ceo-stage-2-results): compare's cluster fix. Stage 2's
// unit ids hold "#" themselves (ceo-o/cmp#N@sha), and the stage 2 scorer cut each review key (unit + "#" + pass) at its
// first "#", so every pair of a contrast fell in one cluster and printed degenerate. The fix clusters each pair on its
// review's unit, as the prereg's section 11 says, and refuses a contrast whose cluster count isn't its unit count.
// Each case runs a scorer copy the way the stage 2 run did: copied to a temp dir, run with bun and GSTACK_EVALS_SCORER set
// to this checkout, with no key in the environment. FROZEN is the copy stage 2 ran; point FIXED at it to see the "#" cases
// fail first. Every unit, review and cost here is synthetic.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const FROZEN = join(ROOT, "wiki/plans/2026-11-06-geva-348-ceo-scorer-stage-2/ceo-rule.ts.txt");
const FIXED = join(ROOT, "wiki/board/2026-11-08-geva-402-ceo-stage-2-results/ceo-rule.ts.txt");
const DIR = mkdtempSync(join(tmpdir(), "ceo-compare-cluster-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

// The fixed copy with the frozen cluster key put back, to show the count check refuses it.
const fixed = readFileSync(FIXED, "utf8");
const SCORERS = { frozen: readFileSync(FROZEN, "utf8"), fixed, reverted: fixed.replaceAll("cluster: none.get(k)!.unit", 'cluster: k.split("#")[0]!') };
for (const [name, src] of Object.entries(SCORERS)) writeFileSync(join(DIR, name + ".ts"), src);

const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER)_API_KEY$/.test(k))) as Record<string, string>;
let n = 0;
const compare = (scorer: keyof typeof SCORERS, d: any, proj: string) => {
  const f = join(DIR, "case-" + ++n + ".json");
  writeFileSync(f, JSON.stringify(d));
  writeFileSync(f + ".txt", proj);
  const r = spawnSync("bun", [join(DIR, scorer + ".ts"), "compare", f, f + ".txt", createHash("sha256").update(proj).digest("hex")], { encoding: "utf8", env: { ...KEYLESS, GSTACK_EVALS_SCORER: ROOT } });
  return { status: r.status, out: r.stdout, err: (r.stderr.split("\n").find((l) => l.startsWith("error: ")) ?? "").slice(7) };
};

// Stage 2 at 48 changed and 16 held units: Opus at 2 passes with lens, Sol and particle-1 at 1, held units at 1. none hits
// changed units 0 to 19, standalone 0 to 24, enforced 0 to 29, lens 0 to 19. ids are "c07" and "h03", or with hash set,
// "acme/cmp#c07@0f1e2d" as stage 2's ids are built, which sort in the same order. The projection text names the last ids,
// so its sha256 differs between the two forms, and projSha masks it.
const NC = 48, NH = 16, FAM = { opus: ["enforced", "standalone"], sol: ["enforced", "standalone"], particle: ["enforced", "standalone"] };
const W = (k: number) => Array(k).fill("word").join(" ");
const agree = (l: string) => ({ sol: l, opus: l, sonnet: l, rem: null });
function stage2(hash: boolean) {
  const id = (kind: string, i: number) => (hash ? "acme/cmp#" : "") + kind[0] + String(i).padStart(2, "0") + (hash ? "@0f1e2d" : "");
  const units = [...Array(NC)].map((_, i) => ({ id: id("changed", i), kind: "changed", strict: "2026-09-12", category: "scope", role: "outside", remedy: false, remedy_kind: null, decoy: null, second_order: false }))
    .concat([...Array(NH)].map((_, i) => ({ id: id("held", i), kind: "held", strict: null, category: "scope", role: "outside", remedy: false, remedy_kind: null, decoy: null, second_order: false }) as any));
  const order: any[] = [];
  for (let c = 0, h = 0; c < NC || h < NH; ) { for (let k = 0; k < 3 && c < NC; k++) order.push({ id: id("changed", c++), kind: "changed" }); if (h < NH) order.push({ id: id("held", h++), kind: "held" }); }
  const passes: Record<string, number> = { opus: 2, sol: 1, particle: 1 }, top: Record<string, number> = { none: 20, standalone: 25, enforced: 30, lens: 20 };
  const reviews: any[] = [];
  let rid = 0;
  for (const m of ["opus", "sol", "particle"]) for (const a of ["none", ...FAM[m as keyof typeof FAM], ...(m === "opus" ? ["lens"] : [])]) units.forEach((u, i) => {
    for (let p = 1; p <= (u.kind === "changed" ? passes[m]! : 1); p++) reviews.push({
      id: "r" + ++rid, unit: u.id, arm: a, model: m, pass: p, status: "scored", exposed: a === "none" || a === "lens" ? null : true,
      labels: [agree(u.kind === "changed" && i < top[a]! ? "D" : "none"), agree("R1"), agree("none")], issues: [W(28), W(35), W(40)], words: [28, 35, 41], fixes: [W(28), W(35), W(40)], fix_words: [28, 35, 41],
      leak: { sol: false, opus: false }, forecast: 50, usd: 0.2, termination: "completed", meter: null,
    });
  });
  const stock = units.filter((u) => u.kind === "changed").flatMap((u) => ["A", "B"].map((row) => ({ unit: u.id, row, labels: [agree("none"), agree("R1"), agree("none")] })));
  const proj = "Primary: hit@3 (stage 1 HEADROOM); G_R form norem\nProjection: PASS at 'as planned'; record these caps; cells: none:opus, enforced:opus, standalone:opus, lens:opus, none:sol, enforced:sol, standalone:sol, none:particle, enforced:particle, standalone:particle; held passes 1; 1 pass on sol, particle; units: changed " + NC + " of " + NC + ", last " + id("changed", NC - 1) + "; held " + NH + " of " + NH + ", last " + id("held", NH - 1) + "\n";
  return { d: { stage: 2, units, reviews, stock, family: FAM, passes, held_passes: 1, lens: true, order }, proj };
}
const primaries = (out: string) => out.split("\n").filter((l) => /^  (enforced|standalone) - none: /.test(l));
const plain = stage2(false), hashed = stage2(true);
const projSha = (out: string) => out.replace(/sha256 [0-9a-f]{64} matches/, "sha256 <projection> matches");
const unhash = (out: string) => projSha(out).replace(/acme\/cmp#([ch]\d\d)@0f1e2d/g, "$1");

describe("unit ids that hold '#', as stage 2's do", () => {
  test("the frozen scorer puts every pair in one cluster: all six primaries print degenerate, with the MDD below grid", () => {
    const r = compare("frozen", hashed.d, hashed.proj);
    expect(r.status).toBe(0);
    expect(primaries(r.out).length).toBe(6);
    for (const l of primaries(r.out)) expect(l).toMatch(/95% CI n\/a, p 1\.000 \(degenerate\), Holm p 1\.000, .*not distinguished \(below grid: MDD at least 0\.\d\d\)$/);
  });
  test("the fixed scorer clusters on the unit: every primary has a 95% CI and a sign-flip p, with the MDD at the 48-unit row", () => {
    const r = compare("fixed", hashed.d, hashed.proj);
    expect(r.status).toBe(0);
    expect(primaries(r.out).length).toBe(6);
    for (const l of primaries(r.out)) {
      expect(l).toMatch(/95% CI \[-?\d\.\d{3}, -?\d\.\d{3}\], p \d\.\d{3} \((exact|monte-carlo)-sign-flip\)/);
      expect(l).not.toContain("below grid");
    }
  });
  test("the fixed scorer prints for '#' ids exactly what it prints for the same units with plain ids", () => {
    const h = compare("fixed", hashed.d, hashed.proj), p = compare("fixed", plain.d, plain.proj);
    expect([h.status, p.status]).toEqual([0, 0]);
    expect(unhash(h.out)).toBe(projSha(p.out));
  });
  test("the count check refuses the fixed scorer with the frozen cluster key put back", () => {
    expect(SCORERS.reverted).not.toBe(SCORERS.fixed);
    const r = compare("reverted", hashed.d, hashed.proj);
    expect(r.status).not.toBe(0);
    expect(r.err).toBe("E_USAGE compare: a contrast's 96 pairs fall in 1 cluster for 48 units; each pair must cluster on its unit");
  });
});

describe("plain unit ids, with no '#'", () => {
  test("the frozen and fixed scorers print the same lines, each primary with a CI", () => {
    const f = compare("frozen", plain.d, plain.proj), x = compare("fixed", plain.d, plain.proj);
    expect([f.status, x.status]).toEqual([0, 0]);
    expect(x.out).toBe(f.out);
    for (const l of primaries(x.out)) expect(l).not.toContain("degenerate");
  });
  test("the count check passes them, even with the frozen cluster key put back", () => {
    const r = compare("reverted", plain.d, plain.proj);
    expect(r.status).toBe(0);
    expect(r.out).toBe(compare("fixed", plain.d, plain.proj).out);
  });
});
