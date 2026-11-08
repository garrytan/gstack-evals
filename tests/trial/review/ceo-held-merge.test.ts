// The CEO stage 2 results post (wiki/board/2026-11-08-geva-402-ceo-stage-2-results): merge.ts, which joins the Opus held
// completion's readings to stage 2's. Each case runs the attachment the way the post does: copied to a temp dir as
// merge.ts and run with bun, with no key in the environment; compare runs the post's fixed ceo-rule.ts the same way.
// The fixture mirrors the run's shape: 48 changed and 28 held units; on Opus, the none, standalone and lens cells of held
// units 0 to 2 ran in stage 2 (the stopped part, 9 rows) and those of held units 3 to 27 read incomplete (75 rows); the
// completion's readings hold those 75 as scored rows and every other planned row as gap. Everything here is synthetic.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const POST = join(ROOT, "wiki/board/2026-11-08-geva-402-ceo-stage-2-results");
const DIR = mkdtempSync(join(tmpdir(), "ceo-held-merge-"));
copyFileSync(join(POST, "merge.ts.txt"), join(DIR, "merge.ts"));
copyFileSync(join(POST, "ceo-rule.ts.txt"), join(DIR, "ceo-rule.ts"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER)_API_KEY$/.test(k))) as Record<string, string>;
const bun = (args: string[]) => {
  const r = spawnSync("bun", args, { encoding: "utf8", env: { ...KEYLESS, GSTACK_EVALS_SCORER: ROOT } });
  return { status: r.status, out: r.stdout, err: r.stderr.split("\n").find((l) => l.startsWith("E_MERGE")) ?? "" };
};

const NC = 48, NH = 28, FAM = { opus: ["enforced", "standalone"], sol: ["enforced", "standalone"], particle: ["enforced", "standalone"] };
const W = (k: number) => Array(k).fill("word").join(" ");
const agree = (l: string) => ({ sol: l, opus: l, sonnet: l, rem: null });
const id = (kind: string, i: number) => "acme/cmp#" + kind[0] + String(i).padStart(2, "0") + "@0f1e2d";
const units = [...Array(NC)].map((_, i) => ({ id: id("changed", i), kind: "changed", strict: "2026-09-12", category: "scope", role: "outside", remedy: false, remedy_kind: null, decoy: null, second_order: false }))
  .concat([...Array(NH)].map((_, i) => ({ id: id("held", i), kind: "held", strict: null as any, category: "scope", role: "outside", remedy: false, remedy_kind: null, decoy: null, second_order: false })));
const order: any[] = [];
for (let c = 0, h = 0; c < NC || h < NH; ) { for (let k = 0; k < 3 && c < NC; k++) order.push({ id: id("changed", c++), kind: "changed" }); if (h < NH) order.push({ id: id("held", h++), kind: "held" }); }
const passes: Record<string, number> = { opus: 2, sol: 1, particle: 1 };
const inCell = (r: any) => r.model === "opus" && ["none", "standalone", "lens"].includes(r.arm) && r.unit.includes("#h") && r.pass === 1;
const late = (r: any) => inCell(r) && Number(r.unit.slice(10, 12)) >= 3;
const empty = { exposed: null, labels: [], issues: [], words: [], fixes: [], fix_words: [], leak: { sol: false, opus: false }, forecast: null, wall_s: null, meter: null };
function readings(which: "stage2" | "completion") {
  const reviews: any[] = [];
  for (const m of ["opus", "sol", "particle"]) for (const a of ["none", ...FAM[m as keyof typeof FAM], ...(m === "opus" ? ["lens"] : [])]) units.forEach((u, i) => {
    for (let p = 1; p <= (u.kind === "changed" ? passes[m]! : 1); p++) {
      const r: any = { id: "ceo:" + a + ":" + m + ":" + u.id + ":" + p, unit: u.id, arm: a, model: m, pass: p, smoke: false, status: "scored", exposed: a === "none" || a === "lens" ? null : true,
        labels: [agree(u.kind === "changed" && i < (a === "enforced" ? 30 : 20) ? "D" : "none"), agree("R1"), agree("none")], issues: [W(28), W(35), W(40)], words: [28, 35, 41], fixes: [W(28), W(35), W(40)], fix_words: [28, 35, 41],
        leak: { sol: false, opus: false }, forecast: u.kind === "held" ? 20 : 40, usd: 0.2, wall_s: 600, termination: "completed", meter: null };
      if (which === "stage2" && late(r)) Object.assign(r, empty, { status: "incomplete", usd: 0, termination: "cap_stop" });
      if (which === "completion" && !late(r)) Object.assign(r, empty, { status: "gap", usd: 0, termination: null });
      if (which === "completion" && late(r)) Object.assign(r, { forecast: 80, usd: 0.25 });
      reviews.push(r);
    }
  });
  const stock = units.filter((u) => u.kind === "changed").flatMap((u) => ["A", "B"].map((row) => ({ unit: u.id, row, labels: [agree(which === "stage2" ? "none" : "R2"), agree("R1"), agree("none")] })));
  return { stage: 2, order, suite: { file: "suite.json", sha256: "a".repeat(64), catalogs_sha256: "b".repeat(64) }, exposure_sha256: "c".repeat(64), units, reviews, stock, family: FAM, passes, held_passes: 1, lens: true };
}
let n = 0;
const files = (s: any = readings("stage2"), c: any = readings("completion")) => {
  const d = join(DIR, "case-" + ++n);
  const f = { s: d + "-stage2.json", c: d + "-completion.json", j: d + "-joined.json", v: d + "-view.json" };
  writeFileSync(f.s, JSON.stringify(s));
  writeFileSync(f.c, JSON.stringify(c));
  return f;
};
const merge = (mode: string, f: { s: string; c: string; j: string; v: string }) => bun([join(DIR, "merge.ts"), mode, f.s, f.c, f.j, f.v]);
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const proj = "Primary: hit@3 (stage 1 HEADROOM); G_R form norem\nProjection: PASS at 'as planned'; record these caps; cells: none:opus, enforced:opus, standalone:opus, lens:opus, none:sol, enforced:sol, standalone:sol, none:particle, enforced:particle, standalone:particle; held passes 1; 1 pass on sol, particle; units: changed " + NC + " of " + NC + ", last " + id("changed", NC - 1) + "; held " + NH + " of " + NH + ", last " + id("held", NH - 1) + "\n";
const compare = (file: string) => {
  writeFileSync(file + ".txt", proj);
  return bun([join(DIR, "ceo-rule.ts"), "compare", file, file + ".txt", createHash("sha256").update(proj).digest("hex")]);
};

describe("a join of the inputs as the run left them", () => {
  const f = files(), S = readings("stage2"), C = readings("completion");
  const b = merge("build", f);
  test("build writes both files and checks them, and verify passes them again", () => {
    expect([b.status, b.err]).toEqual([0, ""]);
    expect(b.out).toContain("merge build: OK");
    expect(b.out).toContain("completion: 75 scored rows on stage 2's 75 incomplete sessions, usd sum 18.750000; 877 gap rows left out");
    const v = merge("verify", f);
    expect([v.status, v.err]).toEqual([0, ""]);
  });
  test("the joined file takes the completion's 75 scored rows for stage 2's incomplete ones and keeps everything else, stock included, from stage 2", () => {
    const J = read(f.j);
    expect(J.stock).toEqual(S.stock);
    expect({ ...J, reviews: null }).toEqual({ ...S, reviews: null });
    J.reviews.forEach((r: any, i: number) => expect(r).toEqual(late(r) ? C.reviews[i] : S.reviews[i]));
    expect(J.reviews.filter((r: any) => r.status === "incomplete").length).toBe(0);
  });
  test("the completion view takes all 84 rows of the three held cells from the completion, so the stopped part's 9 read as its gap rows", () => {
    const V = read(f.v);
    expect({ ...V, reviews: null }).toEqual({ ...S, reviews: null });
    V.reviews.forEach((r: any, i: number) => expect(r).toEqual(inCell(r) ? C.reviews[i] : S.reviews[i]));
    expect(V.reviews.filter((r: any) => inCell(r) && r.status === "gap").length).toBe(9);
  });
  test("compare reads stage 2 as run, the joined file and the completion view, with the same primaries and the held forecasts each holds", () => {
    const runs = [f.s, f.j, f.v].map(compare);
    for (const r of runs) expect(r.status).toBe(0);
    const prim = (o: string) => o.split("\n").filter((l) => / - none: |^Model /.test(l)).join("\n");
    expect(prim(runs[1]!.out)).toBe(prim(runs[0]!.out));
    expect(prim(runs[2]!.out)).toBe(prim(runs[0]!.out));
    const brier = (o: string, c: string) => o.split("\n").find((l) => l.startsWith("  " + c + ": "))!.match(/Brier (\d\.\d{3})/)![1];
    expect([brier(runs[0]!.out, "none:opus"), brier(runs[1]!.out, "none:opus"), brier(runs[2]!.out, "none:opus")]).toEqual(["0.175", "0.147", "0.135"]);
  });
});

describe("tampered inputs and outputs", () => {
  test("verify refuses a joined row with one field changed, a dropped row and a view whose stock is the completion's", () => {
    const f = files();
    expect(merge("build", f).status).toBe(0);
    const J = read(f.j);
    J.reviews[5].usd += 0.01;
    writeFileSync(f.j, JSON.stringify(J));
    expect(merge("verify", f).err).toBe("E_MERGE the joined file's row 6 differs from its source row");
    J.reviews[5].usd -= 0.01;
    J.reviews.pop();
    writeFileSync(f.j, JSON.stringify(J));
    expect(merge("verify", f).err).toStartWith("E_MERGE the joined file holds ");
    expect(merge("build", f).status).toBe(0);
    const V = read(f.v);
    V.stock = readings("completion").stock;
    writeFileSync(f.v, JSON.stringify(V));
    expect(merge("verify", f).err).toBe("E_MERGE the completion view differs from stage 2 on stock");
  });
  test("verify refuses a number JSON can't hold, and an output whose reviews aren't an array, without printing what it holds", () => {
    const f = files();
    expect(merge("build", f).status).toBe(0);
    const raw = readFileSync(f.j, "utf8");
    writeFileSync(f.j, raw.replace('"meter": null', '"meter": 1e400'));
    expect(merge("verify", f).err).toBe("E_MERGE a number in the joined file is not finite");
    writeFileSync(f.j, JSON.stringify({ ...JSON.parse(raw), reviews: { length: "SYNTHETIC_MARKER" } }));
    const r = merge("verify", f);
    expect(r.err).toBe("E_MERGE the joined file's reviews are not an array");
    expect(r.out + r.err).not.toContain("SYNTHETIC_MARKER");
  });
  test("build refuses a completion with a scored row outside stage 2's incomplete sessions", () => {
    for (const pick of [(r: any) => r.model === "sol" && r.unit.includes("#h"), (r: any) => inCell(r) && !late(r)]) {
      const C = readings("completion");
      C.reviews.find(pick)!.status = "scored";
      expect(merge("build", files(undefined, C)).err).toBe("E_MERGE the completion's rows other than gap are not 75 scored rows on stage 2's 75 incomplete sessions");
    }
  });
  test("build refuses inputs that bind different suites, or a stage 2 file with an incomplete row outside Opus's held cells", () => {
    const C = readings("completion");
    C.suite.sha256 = "d".repeat(64);
    expect(merge("build", files(undefined, C)).err).toBe("E_MERGE the two files differ on suite");
    const S = readings("stage2");
    Object.assign(S.reviews.find((r: any) => r.model === "sol")!, empty, { status: "incomplete", usd: 0, termination: "cap_stop" });
    expect(merge("build", files(S)).err).toBe("E_MERGE stage 2's incomplete rows are not 75 rows inside Opus's none, standalone and lens held cells");
  });
});
