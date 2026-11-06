// The CEO stage 2 scorer post (wiki/plans/2026-11-06-geva-348-ceo-scorer-stage-2): its keyless dry run, then one direct
// check per fix the post makes. Each runs the scorer at SCORER the way the post's dry run does: the attachment copied to a
// temp dir as ceo-rule.ts, run with bun and GSTACK_EVALS_SCORER set to this checkout, with no key in the environment.
// Point SCORER at wiki/plans/2026-11-05-geva-300-ceo-stop-label-amendment/ceo-rule.ts.txt to see every check fail first.
// Every unit, review and cost here is synthetic.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const POST = join(ROOT, "wiki/plans/2026-11-06-geva-348-ceo-scorer-stage-2");
const SCORER = join(POST, "ceo-rule.ts.txt");
const DIR = mkdtempSync(join(tmpdir(), "ceo-scorer-stage2-"));
copyFileSync(SCORER, join(DIR, "ceo-rule.ts"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER)_API_KEY$/.test(k))) as Record<string, string>;
let n = 0;
const run = (cmd: string, data: unknown, proj?: string) => {
  const f = join(DIR, "case-" + ++n + ".json");
  writeFileSync(f, JSON.stringify(data));
  const args = [join(DIR, "ceo-rule.ts"), cmd, f];
  if (proj !== undefined) { writeFileSync(f + ".txt", proj); args.push(f + ".txt", createHash("sha256").update(proj).digest("hex")); }
  const r = spawnSync("bun", args, { encoding: "utf8", env: { ...KEYLESS, GSTACK_EVALS_SCORER: ROOT } });
  return { status: r.status, out: r.stdout.split("\n"), err: (r.stderr.split("\n").find((l) => l.startsWith("error: ")) ?? "").slice(7) };
};
const line = (out: string[], prefix: string) => out.find((l) => l.startsWith(prefix));

const W = (k: number) => Array(k).fill("word").join(" ");
const agree = (l: string) => ({ sol: l, opus: l, sonnet: l, rem: null });
const BPT: Record<string, number> = { opus: 2.83, sol: 5.67, particle: 5.09 };
let rid = 0;
const row = (unit: string, arm: string, model: string, pass: number, isHit: boolean, extra: Record<string, unknown> = {}) => ({
  id: "r" + ++rid, unit, arm, model, pass, status: "scored", exposed: arm === "none" || arm === "lens" ? null : true,
  labels: [agree(isHit ? "D" : "none"), agree("R1"), agree("none")], issues: [W(28), W(35), W(40)], words: [28, 35, 41], fixes: [W(28), W(35), W(40)], fix_words: [28, 35, 41],
  leak: { sol: false, opus: false }, forecast: 50, usd: 0.2, termination: "completed", meter: null, ...extra,
});
const unitsOf = (nc: number, nh: number) => [...Array(nc)].map((_, i) => ({ id: "c" + i, kind: "changed", strict: "2026-09-12", category: "scope", role: "outside", remedy: false, remedy_kind: null, decoy: null, second_order: false })).concat([...Array(nh)].map((_, i) => ({ id: "h" + i, kind: "held", strict: "2026-07-10", category: "held", role: "outside", remedy: false, remedy_kind: null, decoy: null, second_order: false })));
const stockOf = (units: any[]) => units.filter((u) => u.kind === "changed").flatMap((u) => ["A", "B"].map((r) => ({ unit: u.id, row: r, labels: [agree("none"), agree("R1"), agree("none")] })));
const orderOf = (nc: number, nh: number) => { const o: any[] = []; let c = 0, h = 0; while (c < nc || h < nh) { for (let k = 0; k < 3 && c < nc; k++) o.push({ id: "c" + c++, kind: "changed" }); if (h < nh) o.push({ id: "h" + h++, kind: "held" }); } return o; };

// Stage 1: 16 changed and 4 held units, Opus none at 3 passes with 20 hits of 48, Sol and particle-1 none at 2, and the
// smoke rerun (smoke_round 2: enforced and standalone on c0 and c1) unless round is 1.
type S1 = { round?: 1 | 2; usd?: Record<string, number>; slow?: string[]; unexposed?: string[]; stop?: string[]; meter?: Record<string, Record<string, unknown>> };
function stage1(o: S1 = {}) {
  rid = 0;
  const units = unitsOf(16, 4), reviews: any[] = [];
  let k = 0;
  for (let p = 1; p <= 3; p++) for (const u of units) reviews.push(row(u.id, "none", "opus", p, u.kind === "changed" && k++ < 20));
  for (const m of ["sol", "particle"]) for (let p = 1; p <= 2; p++) for (const u of units) reviews.push(row(u.id, "none", m, p, false, { usd: 0.05 }));
  const round = o.round ?? 2;
  for (const m of ["opus", "sol", "particle"]) for (const a of round === 2 ? ["enforced", "standalone"] : ["autoplan-ceo", "standalone"]) ["c0", "c1"].forEach((u, i) => {
    const key = a + ":" + m;
    reviews.push(row(u, a, m, 1, false, { smoke: true, labels: [], exposed: !(o.unexposed ?? []).includes(key), wall_s: (o.slow ?? []).includes(key) && i === 0 ? 2400 : 900, usd: o.usd?.[key] ?? (m === "particle" ? 0.1 : 0.3), termination: (o.stop ?? []).includes(key) && i === 0 ? "allowance_stop" : "completed",
      meter: round === 2 ? { peak_inflight_usd: 0.5 + i, peak_inflight_calls: 1, largest_prompt: 60000 + i, bytes_per_token: BPT[m], cache_write: ["5m"], ...(o.meter?.[key] ?? {}) } : null }));
  });
  return { stage: 1, units, reviews, stock: stockOf(units), ...(round === 2 ? { smoke_round: 2 } : {}) };
}
const proj = (s1: S1 = {}, o: Record<string, unknown> = {}) => ({ envelope: 839.93, stage1_judges: 2.79, allowance: { opus: 7.04, sol: 10, particle: 0.5 }, order: orderOf(62, 21), untested: [], ...o, stage1: stage1(s1) });

// Stage 2 at shape B: 62 changed and 21 held units, Opus at 2 passes, Sol and particle-1 at 1, held units at 1.
const FAM = { opus: ["enforced", "standalone"], sol: ["enforced", "standalone"], particle: ["enforced", "standalone"] };
function stage2(fam: Record<string, string[]> = FAM, nc = 62, nh = 21) {
  rid = 0;
  const units = unitsOf(nc, nh), reviews: any[] = [], passes: Record<string, number> = { opus: 2, sol: 1, particle: 1 };
  for (const m of ["opus", "sol", "particle"]) for (const a of ["none", ...fam[m]!, ...(m === "opus" ? ["lens"] : [])]) for (const u of units) for (let p = 1; p <= (u.kind === "changed" ? passes[m]! : 1); p++)
    reviews.push(row(u.id, a, m, p, u.kind === "changed" && Number(u.id.slice(1)) < (a === "enforced" ? 30 : 20)));
  return { stage: 2, units, reviews, stock: stockOf(units), family: fam, passes, held_passes: 1, lens: true, order: orderOf(nc, nh) };
}
const passLine = (d: any, units = "; units: changed 62 of 62, last c61; held 21 of 21, last h20") =>
  "Primary: hit@3 (stage 1 HEADROOM); G_R form norem\nProjection: PASS at 'as planned'; record these caps; cells: " + ["opus", "sol", "particle"].flatMap((m) => ["none:" + m, ...d.family[m].map((a: string) => a + ":" + m), ...(m === "opus" ? ["lens:opus"] : [])]).join(", ") + "; held passes 1; 1 pass on sol, particle" + units + "\n";

describe("the post's dry run", () => {
  test("drives every rule on the scorer and closes with FAIL 0", () => {
    const B = join(DIR, "bundle");
    for (const p of ["2026-11-04-geva-285-ceo-outcome-prereg", "2026-11-05-geva-289-ceo-rule-guards-amendment", "2026-11-05-geva-295-ceo-ladder-amendment", "2026-11-05-geva-300-ceo-stop-label-amendment"]) cpSync(join(ROOT, "wiki/plans", p), B, { recursive: true });
    copyFileSync(join(ROOT, "wiki/plans/2026-11-06-geva-345-ceo-stage-2-amendment/stage2-sizing.txt"), join(B, "stage2-sizing.txt"));
    copyFileSync(join(POST, "dryrun.ts.txt"), join(B, "dryrun.ts"));
    copyFileSync(SCORER, join(B, "ceo-rule.ts"));
    for (const f of readdirSync(B)) if (/^(README\.md|dryrun\.txt|dryrun-merged\.txt|ceo-rule\.ts\.txt|dryrun\.ts\.txt)$/.test(f)) rmSync(join(B, f));
    spawnSync("bun", [join(B, "dryrun.ts"), ROOT, join(DIR, "scratch")], { encoding: "utf8", env: KEYLESS, maxBuffer: 1 << 26 });
    const closing = readFileSync(join(B, "dryrun.txt"), "utf8").trim().split("\n").pop();
    expect(closing).toMatch(/^PASS \d+, FAIL 0$/);
  }, 1_200_000);
});

describe("section 3.4: the allowance trip check", () => {
  const sol = { "enforced:sol": 0.3, "standalone:sol": 0.3 };
  test("Sol at --allowance 3.52 with $0.60 committed trips at 85k prompt tokens and refuses PASS", () => {
    const r = run("projection", proj({ usd: sol }, { allowance: { opus: 7.04, sol: 3.52, particle: 0.5 } }));
    expect(line(r.out, "  trip check ceo-o-cmp-sol-p: ")).toMatch(/allowance \$3\.52, committed \$0\.60 .*trips at 85k prompt tokens -> TRIPS under 200k$/);
    expect(line(r.out, "Projection: ")).toStartWith("Projection: REFUSED, the allowance trip check fails on ceo-o-cmp-sol-p, ceo-o-cmp-sol-e;");
  });
  test("at $10.00 it holds and passes", () => {
    const r = run("projection", proj({ usd: sol }));
    expect(line(r.out, "  trip check ceo-o-cmp-sol-p: ")).toMatch(/trips at 314k prompt tokens -> holds$/);
    expect(line(r.out, "Projection: ")).toStartWith("Projection: PASS at 'as planned'");
  });
});

describe("section 8: rule 5 on the smoke rerun", () => {
  test("a session past 1800 s leaves its cell untested; on enforced Opus stage 2 doesn't start", () => {
    expect(line(run("headroom", stage1({ slow: ["standalone:sol"] })).out, "Stage 2: ")).toBe("Stage 2: may start after the projection and all-in checks; untested arms: standalone:sol");
    expect(line(run("headroom", stage1({ slow: ["enforced:opus"] })).out, "Stage 2: ")).toBe("Stage 2: does not start; enforced failed rule 5 on Opus (a smoke session past 1800 s), to the Captain");
  });
  test("any other failure fails the gate", () => {
    expect(line(run("headroom", stage1({ unexposed: ["standalone:particle"] })).out, "Stage 2: ")).toBe("Stage 2: does not start; the smoke rerun fails its gate on standalone:particle (unit c0 not exposed), to the Captain");
    expect(run("projection", proj({ unexposed: ["enforced:sol"] })).err).toBe("E_USAGE the smoke rerun fails its gate on enforced:sol (unit c0 not exposed); stage 2 does not start");
  });
  test("stage 1's smoke (smoke_round 1) stays readable and waits on the rerun", () => {
    const r = run("headroom", stage1({ round: 1 }));
    expect(line(r.out, "Smoke autoplan-ceo on opus: ")).toEndWith("-> admitted");
    expect(line(r.out, "Stage 2: ")).toBe("Stage 2: waits on the smoke rerun; these readings carry stage 1's smoke (smoke_round 1), and rule 5 reads the rerun's (smoke_round 2)");
    expect(run("projection", proj({ round: 1 })).err).toStartWith("E_USAGE projection reads the smoke rerun");
  });
});

describe("sections 3.5 and 3.6: the enforced arm in stage 2's family", () => {
  test("a stage 2 family that names autoplan-ceo is refused", () => {
    const d: any = stage2();
    d.family = { ...FAM, opus: ["autoplan-ceo", "standalone"] };
    for (const r of d.reviews) if (r.arm === "enforced" && r.model === "opus") r.arm = "autoplan-ceo";
    expect(run("compare", d, passLine(stage2())).err).toStartWith("E_USAGE stage 2 family names autoplan-ceo on opus;");
  });
  test("a family that leaves out enforced on a model whose PASS line runs it is refused", () => {
    const d: any = stage2({ ...FAM, sol: ["standalone"] });
    expect(run("compare", d, passLine(stage2())).err).toBe("E_USAGE stage 2 readings differ from the projection's PASS line on the sol family: readings standalone, PASS line enforced, standalone");
    expect(run("compare", d, passLine(d)).status).toBe(0);
  });
});

describe("section 3.5: the PASS line's units and compare's unit check", () => {
  test("projection's PASS line names the counts and the cut point", () => {
    expect(line(run("projection", proj()).out, "Projection: ")).toEndWith("; held passes 1; 1 pass on sol, particle; units: changed 62 of 62, last c61; held 21 of 21, last h20");
  });
  test("compare refuses readings whose units aren't the first n changed and h held of the seeded order", () => {
    const d: any = stage2();
    d.order = orderOf(64, 22);
    const cutLine = passLine(d, "; units: changed 62 of 64, last c61; held 21 of 22, last h20");
    expect(run("compare", d, cutLine).status).toBe(0);
    for (const u of d.units) if (u.id === "c0") u.id = "c63";
    for (const r of d.reviews) if (r.unit === "c0") r.unit = "c63";
    for (const s of d.stock) if (s.unit === "c0") s.unit = "c63";
    expect(run("compare", d, cutLine).err).toBe("E_USAGE stage 2 readings' units must be exactly the first 62 changed and 21 held units of the seeded order; first unit outside them: c63 (changed)");
  });
});

describe("section 3.5: allin on the table's lines", () => {
  const lines = { crew_spent: 469.61, crew_rest: 282, crew_reserve: 30, stage1_settled: 17.6, smoke_caps: 72, authoring: 275.93, runner_hosts: 12.93, run_caps: { "ceo-o-cmp-opus-p": 199, "ceo-o-cmp-opus-e": 203, "ceo-o-cmp-sol-p": 152, "ceo-o-cmp-sol-e": 186, "ceo-o-cmp-particle-p": 10, "ceo-o-cmp-particle-e": 12 }, judges: 70 };
  test("the table sums to $1,992.07 and passes, the judges one shared line", () => {
    const r = run("allin", { lines });
    expect(line(r.out, "All-in: ")).toBe("All-in: PASS ($7.93 to spare)");
    expect(r.out.join("\n")).toContain("stage 2 judges, one shared cap $70.00");
  });
  test("a missing line and a sum over $2,000 are refused", () => {
    const { judges, ...rest } = lines;
    void judges;
    expect(run("allin", { lines: rest }).err).toBe("E_USAGE allin's lines miss judges");
    expect(line(run("allin", { lines: { ...lines, crew_spent: 480 } }).out, "All-in: ")).toStartWith("All-in: REFUSED, $2002.46 passes $2000.00");
  });
});

describe("section 3.5 and carried note G: the MDD from stage2-sizing.txt's grid", () => {
  test("62 changed units read the grid's 48 row: 0.13 at 2 passes on Opus, 0.19 at 1 pass on Sol", () => {
    const r = run("compare", stage2(), passLine(stage2()));
    expect(line(r.out, "Leak drops: ")).toEndWith("MDD at Holm's first step for this n 0.13");
    expect(r.out.filter((l) => /^  standalone - none: .*not distinguished \(MDD 0\.(13|19)\)$/.test(l)).length).toBe(3);
  });
  test("below the 36-unit row compare prints the 36 row's value as a floor", () => {
    const d: any = stage2(FAM, 36, 12);
    for (const r of d.reviews) if (r.arm === "standalone" && r.model === "opus" && r.unit === "c35") { r.status = "gap"; r.labels = []; r.issues = []; r.words = []; r.fixes = []; r.fix_words = []; }
    const r = run("compare", d, passLine(d, "; units: changed 36 of 36, last c35; held 12 of 12, last h11"));
    expect(r.out.find((l) => l.startsWith("  standalone - none: "))).toMatch(/not distinguished \(below grid: MDD at least 0\.18\)$/);
  });
});

describe("carried notes F, I and the secondaries", () => {
  test("F and I: projection prints each smoke session's peak in-flight reservation and each smoke item's E_ALLOWANCE stops", () => {
    const r = run("projection", proj({ stop: ["enforced:sol"], meter: { "standalone:opus": { peak_inflight_usd: 3.61, peak_inflight_calls: 2 } } }));
    expect(line(r.out, "  smoke ceo-o-sm2-opus-p: ")).toBe("  smoke ceo-o-sm2-opus-p: peak in-flight reservation $3.61 (2 calls) on c0, $3.61 (2 calls) on c1; largest prompt 60000 on c0, 60001 on c1; E_ALLOWANCE stops 0 of 2 (decides nothing)");
    expect(line(r.out, "  smoke ceo-o-sm2-sol-e: ")).toEndWith("E_ALLOWANCE stops 1 of 2 (decides nothing)");
    expect(line(r.out, "Projection: ")).toStartWith("Projection: PASS at 'as planned'");
  });
  test("I and the secondaries: compare prints E_ALLOWANCE stops per cell, enforced - standalone, lens - none and enforced - lens", () => {
    const d: any = stage2();
    d.reviews.find((r: any) => r.arm === "enforced" && r.model === "sol").termination = "allowance_stop";
    const r = run("compare", d, passLine(d));
    expect(r.out).toContain("    E_ALLOWANCE stops enforced:sol: 1 of 83 sessions (decides nothing)");
    expect(line(r.out, "  opus enforced - standalone (the gate and the pin difference): ")).toBeDefined();
    expect(line(r.out, "  opus lens - none: ")).toBeDefined();
    expect(line(r.out, "  opus enforced - lens: ")).toBeDefined();
    expect(r.out.join("\n")).not.toContain("autoplan-ceo");
  });
});
