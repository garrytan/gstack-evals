// Copyright (c) 2026 Garry Tan. MIT License.
// pv dryrun (prereg 2026-11-08-geva-403, section 17 item 4): a keyless dry run that drives every frozen rule of the
// scoring side on both sides of its edge, with the values item 4 names, runs the 1,000-run twin simulations, and opens
// and settles one ledger lease per stage 1 item on a temporary ledger. It prints one PASS or FAIL line per rule and
// exits 1 on any FAIL. Rules whose inputs come from the run side (the parser and lenient parse, the infrastructure
// retry, web refusal and contamination, the mounts, the exposure detectors) are driven here through types.ts's Row
// with synthetic rows; the run side's own checks plug in through RUN_SIDE_HOOK, a module that exports
// runSideChecks(), and the dry run fails until that module exists.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import type { Io } from "./cli.ts";
import { promoteReserve, PvError, unitProblem, type LoadedUnit, type Normalize } from "./io.ts";
import { labelPacket, openJudge, type CallLog, type Caller } from "./judge.ts";
import { primaryOf, screenKey } from "./author/generic.ts";
import { buildLabelPackets, type LabelRecord, type PacketFile } from "./packets.ts";
import { admission, admittedUnits, ceilingFlag, contrast, cutoffEnd, designMdd, interimStop, ittSwitch, judgeScore, leakReading, loadCutoffs, parsePower, primaries, readingRule, signSplit, smokeRules, stockReading, twinCheck, twinDecide, untestedReasons, verdict, type CheckCell, type ReadingInput, type SmokeSession, type TwinPair } from "./rules.ts";
import { scoreReviews, type Review, type StockCredit } from "./score.ts";
import { derangeByGroup, maxMatching, r4, resplitDraws, SEED, seededRandom } from "./stats.ts";
import type { ArmId, Key, KeyItem, ModelId, Row, UnitMeta } from "./types.ts";

/** Where the run side's own dry-run checks plug in: a module exporting runSideChecks(). */
export const RUN_SIDE_HOOK = "run-checks.ts";
export const RUN_SIDE_RULES = ["the plan-changes parser, the one lenient parse and the normalizer", "an infrastructure failure gets one retry under its named reason", "WebSearch and WebFetch are refused, and a successful web result marks the session contaminated", "per-family mounts: plan.md or brief.md with context/, key.json absent", "the plan-ceo-review and office-hours exposure detectors, including a session whose expansions stayed pending"];

/** Stage 1 items and caps in dollars (approvals, "Item caps", 2026-11-08): run items, judge items and the taste render. */
export const STAGE1_ITEMS: Readonly<Record<string, number>> = {
  "pv-s1-plan-smoke-opus-ceo": 16, "pv-s1-plan-smoke-opus-lens": 5, "pv-s1-plan-smoke-sol-ceo": 13, "pv-s1-plan-smoke-particle-ceo": 1,
  "pv-s1-plan-opus-none": 22, "pv-s1-plan-sol-none": 14, "pv-s1-plan-particle-none": 2,
  "pv-s1-brief-smoke-opus-oh": 17, "pv-s1-brief-smoke-opus-lens": 5, "pv-s1-brief-smoke-sol-oh": 13, "pv-s1-brief-smoke-particle-oh": 1,
  "pv-s1-brief-opus-none": 22, "pv-s1-brief-sol-none": 14, "pv-s1-brief-particle-none": 2,
  "pv-s1-plan-labels": 42, "pv-s1-plan-check": 72, "pv-s1-brief-labels": 42, "pv-s1-brief-check": 72, "pv-o1-render": 3,
};
export const APPROVALS = join(homedir(), ".capy", "drive", "captain-gstack-evals", "approvals", "2026-11-08-product-value-eval-line.md");

interface Line {
  rule: string;
  pass: boolean;
  detail: string;
}

const identity: Normalize = (xs) => xs.slice(0, 5).map((s) => s.replace(/\s+/g, " ").trim());

const meta = (id: string, over: Partial<UnitMeta> = {}): UnitMeta => ({ id, set: "comparison", source: "public", source_kind: "plan", type: "other", plan_date: "2026-08-01", rank: 1, ...over });
const item = (id: string, over: Partial<KeyItem> = {}): KeyItem => ({ id, kind: "U", statement: "People needed tag-" + id + " in real use.", evidence: [], outside_users: 2, mentioned: false, generic: false, foreseeable: "yes", ...over });
const unitsOf = (metas: UnitMeta[], keys: Record<string, Key> = {}): Map<string, LoadedUnit> => new Map(metas.map((m) => [m.id, { meta: m, key: keys[m.id] ?? null, dir: "/nonexistent/" + m.id }]));

function rv(unit: string, arm: ArmId, pass: number, A: number | null, over: Partial<Review> = {}): Review {
  return { unit, family: "plan", model: "opus", arm, pass, session: unit + "-" + arm + "-" + pass, status: A === null ? "missing" : "scored", A, shuffled: 0, specificity: A, A_R: null, A_generic: null, A_mentioned: null, A_U: null, A_E: null, A_plan: null, A_foreseeable: null, precision: null, multi: null, words: 60, items: 5, cut: 0, exposed: arm === "skill" ? true : null, mode: null, ...over };
}

/** A fake judge: anticipated when a change carries the item's tag word; it can skip or flip cells for the edge cases. */
export function fakeAnswer(prompt: string, o: { flip?: boolean; skip?: number } = {}): string {
  const items = [...prompt.matchAll(/^\[(\w+)\] .*?(tag-[\w-]+)/gm)].map((m) => ({ id: m[1]!, tag: m[2]! }));
  const lists = prompt.split(/^List (\w+)$/m).slice(1);
  const labels = [];
  for (let i = 0; i < lists.length; i += 2) {
    const id = lists[i]!;
    const changes = lists[i + 1]!.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, ""));
    for (const it of items) {
      const hit = changes.map((c, k) => (c.includes(it.tag) ? k + 1 : 0)).filter(Boolean);
      const anticipated = o.flip ? !hit.length : hit.length > 0;
      labels.push({ list: id, item: it.id, anticipated, changes: anticipated ? (hit.length ? hit : [1]) : [] });
    }
  }
  return JSON.stringify({ labels: labels.slice(o.skip ?? 0) });
}

/** A provider-shaped upstream for the metering proxy: OpenAI Responses, Anthropic Messages and OpenRouter chat. */
export function fakeUpstream(answer: (judge: "astra" | "opus" | "gemini", prompt: string) => string): typeof fetch {
  return (async (url: any, init?: any) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    if (u.includes("anthropic")) return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5-20260922", content: [{ type: "text", text: answer("opus", prompt) }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    if (u.includes("openrouter")) return Response.json({ id: "gen-1", model: "google/gemini-4-argon-20261001", provider: "Google", choices: [{ message: { role: "assistant", content: answer("gemini", prompt) } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });
    return Response.json({ id: "resp_1", object: "response", model: "gpt-6-astra-2026-09-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: answer("astra", prompt) }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } });
  }) as typeof fetch;
}

// ---- the twin simulations (section 4, part (b)) ----

function gauss(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}
function gamma(k: number, rng: () => number): number {
  if (k < 1) return gamma(k + 1, rng) * Math.pow(1 - rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = gauss(rng), v = (1 + c * x) ** 3;
    if (v > 0 && Math.log(1 - rng()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** power.py's unit model: Beta difficulty with ICC rho, 1 or 2 items with logit sd 0.8, Bernoulli per item and pass. */
function drawUnit(p0: number, rho: number, rng: () => number): number[] {
  const s = 1 / rho - 1;
  const x = gamma(p0 * s, rng), y = gamma((1 - p0) * s, rng);
  const pu = Math.min(1 - 1e-4, Math.max(1e-4, x / (x + y || 1)));
  const m = rng() < 0.5 ? 1 : 2;
  return Array.from({ length: m }, () => 1 / (1 + Math.exp(-(Math.log(pu / (1 - pu)) + 0.8 * gauss(rng)))));
}
const passA = (q: number[], rng: () => number) => q.filter((p) => rng() < p).length / q.length;

/** The share of 1,000 simulated twin checks whose part (b) fails, with identical or unrelated twins, over 8 pairs or the count given. */
export function simulateTwins(o: { rho: number; p0: number; related: boolean; runs: number; seed: number; pairs?: number }): number {
  const rng = seededRandom(o.seed);
  const n = o.pairs ?? 8;
  let fails = 0;
  for (let run = 0; run < o.runs; run++) {
    const pairs = Array.from({ length: n }, () => {
      const q = drawUnit(o.p0, o.rho, rng);
      const t = o.related ? q : drawUnit(o.p0, o.rho, rng);
      return { a: [0, 1, 2].map(() => passA(q, rng)), b: [0, 1, 2].map(() => passA(t, rng)) };
    });
    const observed = pairs.reduce((s, p) => s + Math.abs((p.a[0]! + p.a[1]! + p.a[2]!) / 3 - (p.b[0]! + p.b[1]! + p.b[2]!) / 3), 0) / n;
    const draws = resplitDraws(pairs, { seed: SEED, draws: 10_000 });
    if (twinDecide([0, 0], observed, draws[9499]!).b_fail) fails++;
  }
  return fails / o.runs;
}

// ---- the dry run ----

export async function dryRun(o: { sims: boolean; ledger: boolean; approvals?: string; twinPairs?: number }): Promise<Line[]> {
  const nT = o.twinPairs ?? 8;
  const out: Line[] = [];
  const check = (rule: string, pass: boolean, detail = "") => out.push({ rule, pass, detail });

  // Run side: the hook.
  const hook = join(import.meta.dir, RUN_SIDE_HOOK);
  if (existsSync(hook)) {
    const mod = (await import(hook)) as { runSideChecks?: () => Promise<Array<{ rule: string; pass: boolean; detail?: string }>> };
    if (typeof mod.runSideChecks !== "function") check("run side: " + RUN_SIDE_HOOK + " exports runSideChecks()", false, "it does not");
    else for (const c of await mod.runSideChecks()) check("run side: " + c.rule, c.pass, c.detail ?? "");
  } else check("run side: " + RUN_SIDE_RULES.join("; "), false, "lanes/product-value/" + RUN_SIDE_HOOK + " is not built yet; the run side's dry-run checks plug in there");

  // Section 10: band edges and four-decimal rounding.
  const adm = (path: "pooled" | "public", a: number) => admission({ path, noneA: a, stockFail: false, astraOnOpus: true, parsed: 100, completed: 100 }).reading;
  check("admission band, pooled path: A 0.09 FLOOR, 0.10 HEADROOM, 0.60 HEADROOM, 0.61 CEILING", adm("pooled", 0.09) === "FLOOR" && adm("pooled", 0.1) === "HEADROOM" && adm("pooled", 0.6) === "HEADROOM" && adm("pooled", 0.61) === "CEILING");
  check("admission band, public-only path: A 0.50 HEADROOM, 0.51 CEILING", adm("public", 0.5) === "HEADROOM" && adm("public", 0.51) === "CEILING");
  check("four-decimal rounding at a band edge: 0.60004 reads 0.6 (HEADROOM), 0.60005 reads 0.6001 (CEILING), 0.09995 reads 0.1 (HEADROOM)", adm("pooled", 0.60004) === "HEADROOM" && adm("pooled", 0.60005) === "CEILING" && adm("pooled", 0.09995) === "HEADROOM");
  check("admission: none replies parse at 95 of 100 admit, 94 of 100 read NO READ; a failed Astra check on Opus lists reads NO READ", admission({ path: "pooled", noneA: 0.3, stockFail: false, astraOnOpus: true, parsed: 95, completed: 100 }).reading === "HEADROOM" && admission({ path: "pooled", noneA: 0.3, stockFail: false, astraOnOpus: true, parsed: 94, completed: 100 }).reading === "NO READ" && admission({ path: "pooled", noneA: 0.3, stockFail: false, astraOnOpus: false, parsed: 100, completed: 100 }).reading === "NO READ");

  // Section 7: kappa edges and the oracle half cap.
  const kcells = (agree: number, extra: boolean): CheckCell[] => {
    const cells: CheckCell[] = [];
    const wrong = 400 - agree;
    for (let i = 0; i < 200; i++) cells.push({ gold: true, judged: i >= wrong / 2, kind: "arm", list: "r" + (i % 50) });
    for (let i = 0; i < 200; i++) cells.push({ gold: false, judged: i < wrong / 2, kind: "arm", list: "r" + (i % 50) });
    if (extra) for (let i = 0; i < 100; i++) cells.push({ gold: true, judged: true, kind: "oracle", list: "o" + (i % 24) }, { gold: false, judged: false, kind: "stock", list: "s" + (i % 72) });
    return cells;
  };
  const k59 = judgeScore("opus", "astra on opus lists", kcells(318, false), { seed: SEED, minimum: 40 });
  const k60 = judgeScore("opus", "astra on opus lists", kcells(320, false), { seed: SEED, minimum: 40 });
  check("judge kappa: 0.59 fails, 0.60 passes (full kappa equals real-list kappa here)", r4(k59.kappa!) === 0.59 && !k59.pass && r4(k60.kappa!) === 0.6 && k60.pass, "kappas " + r4(k59.kappa!) + ", " + r4(k60.kappa!));
  const mixed59 = judgeScore("sol", "opus on sol lists", kcells(318, true), { seed: SEED, minimum: 40 });
  const mixed60 = judgeScore("sol", "opus on sol lists", kcells(320, true), { seed: SEED, minimum: 40 });
  const solUntested = verdict({ delta: 0.12, ci95: [0.05, 0.19], holm: 0.001, spec_ci95: [0.03, 0.15], sign_ok: true, untested: untestedReasons({ exposure: 0.9, coverage: [1, 1], stockFail: false, judgePass: mixed59.pass, leak: false }) });
  check("real-list kappa: full kappa passes while real-list kappa reads 0.59, so the judge fails and its contrasts read untested (judge); at 0.60 it passes", r4(mixed59.kappa!) >= 0.6 && r4(mixed59.kappa_real!) === 0.59 && !mixed59.pass && solUntested.verdict === "untested" && solUntested.why.includes("untested (judge)") && mixed60.pass, "full " + r4(mixed59.kappa!) + ", real " + r4(mixed59.kappa_real!));
  const capCells = (real: number): CheckCell[] => [...Array.from({ length: real }, (_, i) => ({ gold: true, judged: true, kind: "arm" as const, list: "r" + i })), ...Array.from({ length: 30 }, (_, i) => ({ gold: true, judged: true, kind: "oracle" as const, list: "o" + i })), ...Array.from({ length: 45 }, (_, i) => ({ gold: false, judged: false, kind: "arm" as const, list: "n" + i }))];
  const cap19 = judgeScore("opus", "astra on opus lists", capCells(19), { seed: SEED, minimum: 40 });
  const cap20 = judgeScore("opus", "astra on opus lists", capCells(20), { seed: SEED, minimum: 40 });
  check("oracle half cap: 19 real anticipated cells admit 19 oracle cells (38, NO READ (judge)); 20 admit 20 (40, enough)", cap19.anticipated === 38 && cap19.reading === "NO READ (judge)" && cap20.anticipated === 40 && !cap20.shortfall, cap19.anticipated + " and " + cap20.anticipated);
  const lowA = Array.from({ length: 72 }, (_, i) => i).map((i) => ({ gold: i < 11, judged: i < 11, kind: "arm" as const, list: "l" + i }));
  const fill = judgeScore("opus", "astra on opus lists", [...lowA, ...Array.from({ length: 24 }, (_, i) => ({ gold: true, judged: true, kind: "oracle" as const, list: "o" + i }))], { seed: SEED, minimum: 40 });
  const lowAdm = admission({ path: "pooled", noneA: 0.15, stockFail: false, astraOnOpus: fill.pass, parsed: 72, completed: 72 });
  check("oracle fill and NO READ (judge) on a gold shortfall, with stage 1 none A at 0.15: 11 real and 11 oracle anticipated cells, admission NO READ", fill.oracle_used === 11 && fill.reading === "NO READ (judge)" && lowAdm.reading === "NO READ", "anticipated " + fill.anticipated);
  const judgeFail = untestedReasons({ exposure: 0.9, coverage: [1, 1], stockFail: false, judgePass: false, leak: false });
  const opusStands = verdict({ delta: 0.12, ci95: [0.05, 0.19], holm: 0.001, spec_ci95: [0.03, 0.15], sign_ok: true, untested: untestedReasons({ exposure: 0.9, coverage: [1, 1], stockFail: false, judgePass: true, leak: false }) });
  check("a judge failure (Opus on Sol lists) leaves the Opus contrasts standing", judgeFail.includes("untested (judge)") && opusStands.verdict === "helps");

  // Section 8: STOCK FAIL per production judge.
  const credits = (model: ModelId, units: number, of: number): StockCredit[] => Array.from({ length: of }, (_, i) => ({ unit: "u" + i, model, row: 1, credited: i < units }));
  check("STOCK FAIL, stage 1: a row credited on 3 of 24 calibration units passes, on 4 fails", !stockReading(credits("opus", 3, 24), 24).fail && stockReading(credits("opus", 4, 24), 24).fail);
  check("STOCK FAIL, stage 2: 10 of 80 comparison units passes, 11 fails", !stockReading(credits("opus", 10, 80), 80).fail && stockReading(credits("opus", 11, 80), 80).fail);
  const split = [...credits("opus", 2, 24), ...credits("sol", 2, 24).map((c) => ({ ...c, credited: c.unit === "u2" || c.unit === "u3" }))];
  check("STOCK FAIL is counted per production judge, never as a union: 2 units under Astra and 2 others under Opus (4 in union) pass", !stockReading(split, 24).fail);

  // Section 4: the twin check.
  const tw = (lo: number, hi: number) => twinDecide([lo, hi], 0.05, 0.1);
  check("twin part (a): a 90% interval ending 0.10 from zero tracks, 0.11 from zero fails, on either side", !tw(0.1, 0.3).a_fail && tw(0.11, 0.3).a_fail && !tw(-0.3, -0.1).a_fail && tw(-0.3, -0.11).a_fail);
  check("twin part (b): a mean absolute difference at its 95th percentile tracks, just above it fails", !twinDecide([0, 0], 0.1234, 0.1234).b_fail && twinDecide([0, 0], 0.1235, 0.1234).b_fail);
  const pairsT: TwinPair[] = Array.from({ length: nT }, (_, i) => ({ unit: "p" + i, twin: "t" + i, a: [0.5, (i % 3) / 2, 0], b: [0.5, 0, ((i + 1) % 3) / 2] }));
  const tc = twinCheck(pairsT);
  check("twin check end to end on " + nT + " pairs: bootstrap 10,000 draws and 10,000 re-splits with seed 20261108; Spearman prints only", tc.pairs === nT && tc.track, "ci90 " + r4(tc.ci90[0]) + " to " + r4(tc.ci90[1]) + ", observed " + r4(tc.observed) + ", p95 " + r4(tc.p95));
  if (o.sims) {
    for (const rho of [0.5, 0.843]) {
      const same = simulateTwins({ rho, p0: 0.35, related: true, runs: 1000, seed: SEED + Math.round(rho * 1000), pairs: nT });
      const diff = simulateTwins({ rho, p0: 0.35, related: false, runs: 1000, seed: SEED + 7 + Math.round(rho * 1000), pairs: nT });
      check("twin simulation at ICC " + rho + " on " + nT + " pairs: identical twins fail part (b) in at most 0.064 of 1,000 runs", same <= 0.064, "false-fail rate " + same);
      check("twin simulation at ICC " + rho + " on " + nT + " pairs: part (b) catches unrelated twins in at least half of 1,000 runs", diff >= 0.5, "catch rate " + diff);
    }
  }
  const calib = unitsOf([...Array.from({ length: 16 }, (_, i) => meta("c" + i, { set: "calibration" })), ...Array.from({ length: nT }, (_, i) => meta("t" + i, { set: "calibration", source: "transposed", source_kind: "transposed", twin_of: "c" + i }))]);
  check("admission reads all " + (16 + nT) + " calibration units when the twins track, the 16 public ones when they don't", admittedUnits(calib, "pooled").length === 16 + nT && admittedUnits(calib, "public").length === 16);

  // Section 11: verdicts and the reading rule.
  const base: ReadingInput = { none: { verdict: "no measurable difference", ci95: [-0.03, 0.049] }, lens: { verdict: "no measurable difference", ci95: [-0.05, 0.05] }, exposure: 0.9, headroom: true, stockPass: true, judgePass: true, coverage: 0.95, ceiling: false, pairwise: null, rItems: 40 };
  const v = (ci: [number, number], holm: number, spec: [number, number] = [0.01, 0.2], sign_ok = true) => verdict({ delta: (ci[0] + ci[1]) / 2, ci95: ci, holm, spec_ci95: spec, sign_ok, untested: [] });
  check("a sign split between sources reads not shown (not consistent across sources)", v([0.02, 0.2], 0.01, [0.01, 0.2], false).verdict === "not shown" && v([0.02, 0.2], 0.01, [0.01, 0.2], false).why.includes("not consistent across sources"));
  const gain = v([0.01, 0.045], 0.01, [0.005, 0.04]);
  check("a gain whose interval excludes zero with upper bound under +0.05 reads helps and never CUT-CANDIDATE", gain.verdict === "helps" && !readingRule({ ...base, none: { verdict: gain.verdict, ci95: [0.01, 0.045] } }).cut);
  const c049 = readingRule({ ...base, none: { verdict: "no measurable difference", ci95: [-0.03, 0.049] } });
  const c050 = readingRule({ ...base, none: { verdict: "no measurable difference", ci95: [-0.03, 0.05] } });
  check("a null with upper bound 0.049 returns CUT-CANDIDATE; 0.050 does not (FIX-METHOD on power)", c049.cut && !c050.cut && c050.fix_method_power);
  check("a none arm at 0.61 carries the CEILING flag (pooled), which blocks CUT-CANDIDATE", ceilingFlag(0.61, "pooled") && !ceilingFlag(0.6, "pooled") && !readingRule({ ...base, ceiling: ceilingFlag(0.61, "pooled") }).cut);
  check("the CEILING flag on the public-only path: 0.50 no flag, 0.51 flag", !ceilingFlag(0.5, "public") && ceilingFlag(0.51, "public"));
  check("the CEILING flag from the stage 1 set or the stage 2 set blocks CUT-CANDIDATE", !readingRule({ ...base, ceiling: ceilingFlag(0.62, "pooled") || ceilingFlag(0.3, "pooled") }).cut && !readingRule({ ...base, ceiling: ceilingFlag(0.3, "pooled") || ceilingFlag(0.61, "pooled") }).cut && readingRule({ ...base, ceiling: ceilingFlag(0.3, "pooled") || ceilingFlag(0.4, "pooled") }).cut);
  const holmFail = v([0.01, 0.2], 0.06);
  check("an interval that excludes zero but fails Holm reads not shown", holmFail.verdict === "not shown" && holmFail.why.includes("Holm"));
  const hurt = v([-0.2, -0.02], 0.01, [-0.15, -0.01]);
  check("a hurts result can return CUT-CANDIDATE", hurt.verdict === "hurts" && readingRule({ ...base, none: { verdict: hurt.verdict, ci95: [-0.2, -0.02] } }).cut);
  const loss = v([-0.2, -0.02], 0.08, [-0.15, -0.01]);
  check("a loss that fails only Holm reads not shown and can return CUT-CANDIDATE", loss.verdict === "not shown" && readingRule({ ...base, none: { verdict: loss.verdict, ci95: [-0.2, -0.02] } }).cut);
  const helps = { verdict: "helps" as const, ci95: [0.06, 0.2] as [number, number] };
  check("the framing reading: skill minus lens 0.010 to 0.100 with skill minus none helping does not print it", !readingRule({ ...base, none: helps, lens: { verdict: v([0.01, 0.1], 0.01).verdict, ci95: [0.01, 0.1] } }).framing);
  check("the framing reading: skill minus lens -0.03 to 0.049 prints it, -0.03 to 0.050 does not", readingRule({ ...base, none: helps, lens: { verdict: "no measurable difference", ci95: [-0.03, 0.049] } }).framing && !readingRule({ ...base, none: helps, lens: { verdict: "no measurable difference", ci95: [-0.03, 0.05] } }).framing);
  check("KEEP needs skill minus none to read helps, and is flagged when the pairwise read shows the skill losing at equal length", readingRule({ ...base, none: helps }).keep && !readingRule(base).keep && readingRule({ ...base, none: helps, pairwise: { rate: 0.4, ci95: [0.3, 0.49] } }).keep_flag && !readingRule({ ...base, none: helps, pairwise: { rate: 0.4, ci95: [0.3, 0.5] } }).keep_flag);
  check("a null covers first version and rollout only at 30 R items", readingRule({ ...base, rItems: 30 }).rollout_covered && !readingRule({ ...base, rItems: 29 }).rollout_covered);
  check("untested: exposure 0.79 or coverage 0.89 reads untested; 0.80 and 0.90 do not", untestedReasons({ exposure: 0.79, coverage: [1, 1], stockFail: false, judgePass: true, leak: false }).length === 1 && untestedReasons({ exposure: 0.8, coverage: [0.9, 1], stockFail: false, judgePass: true, leak: false }).length === 0 && untestedReasons({ exposure: 0.8, coverage: [0.89, 1], stockFail: false, judgePass: true, leak: false }).length === 1);

  // Section 11: the inspiration and source sign rules.
  const sides = (n: number, d: number) => [...Array.from({ length: n }, (_, i) => ({ unit: "cap" + i, d })), ...Array.from({ length: 20 }, (_, i) => ({ unit: "pub" + i, d: 0.1 }))];
  const side = (u: string) => (u.startsWith("cap") ? "capy" : "public");
  check("the inspiration sign rule at 11 units a source only prints; at 12 an opposite sign reads not consistent", signSplit(sides(11, -0.1), side, ["capy", "public"], { required: true }).consistent && !signSplit(sides(11, -0.1), side, ["capy", "public"], { required: true }).applies && !signSplit(sides(12, -0.1), side, ["capy", "public"], { required: true }).consistent);
  check("an estimate of exactly 0 matches either sign", signSplit(sides(12, 0), side, ["capy", "public"], { required: true }).consistent);

  // Section 11: contrasts, the pair drop, ITT and its switch, an unscored review.
  const cu = unitsOf(Array.from({ length: 12 }, (_, i) => meta("u" + i)));
  const revs: Review[] = [];
  for (let i = 0; i < 12; i++)
    for (const pass of [1, 2]) {
      revs.push(rv("u" + i, "none", pass, 0.2), rv("u" + i, "lens", pass, 0.25), rv("u" + i, "skill", pass, 0.3 + (i % 3) * 0.05));
    }
  revs.find((r) => r.unit === "u0" && r.arm === "skill" && r.pass === 1)!.status = "missing";
  revs.find((r) => r.unit === "u0" && r.arm === "skill" && r.pass === 1)!.A = null;
  const uns = revs.find((r) => r.unit === "u1" && r.arm === "skill" && r.pass === 2)!;
  uns.status = "unscored";
  uns.A = null;
  const all = new Set([...cu.keys()]);
  const pc = contrast(revs, cu, { model: "opus", family: "plan", b: "skill", a: "none", itt: false, primary: all, transposedInPrimary: false });
  const itt = contrast(revs, cu, { model: "opus", family: "plan", b: "skill", a: "none", itt: true, primary: all, transposedInPrimary: false });
  check("the pair drop: a missing session and an unscored review each drop their unit-pass pair (22 of 24 pairs left)", pc.pairs === 22 && pc.dropped === 2 && pc.units === 12);
  check("the intention-to-treat read scores missing and unscored as 0 and keeps all 24 pairs", itt.pairs === 24 && itt.delta < pc.delta);
  check("the ITT switch: a skill-minus-none missing-rate gap of 5 points does not switch, 7.5 points does", !ittSwitch(4 / 40, 2 / 40) && ittSwitch(5 / 40, 2 / 40));
  const pr = primaries(revs, cu, { model: "opus", family: "plan", primary: all, transposedInPrimary: false });
  check("primaries: an 8.3-point missing-rate gap switches the model to the intention-to-treat read; cluster-bootstrap interval, cluster sign-flip p, Holm over the two contrasts, and the two units whose A got worse counted", pr.itt && pr.contrasts.every((c) => c.read === "itt" && c.ci95 !== null && c.holm !== null && c.holm >= c.p) && pr.contrasts[0].worse_units === 2 && pr.itt_reads === null);

  // Section 6 failures and section 8 credit, through rows and a label packet.
  const key: Key = { unit: "k1", items: [item("a"), item("b"), item("r1", { kind: "R" }), item("g1", { generic: true })], primary: ["a", "b"], commitments: ["one", "two", "three"] };
  const key2: Key = { unit: "k2", items: [item("x"), item("y")], primary: ["x", "y"], commitments: ["one", "two", "three"] };
  const kunits = unitsOf([meta("k1", { set: "calibration" }), meta("k2", { set: "calibration" })], { k1: key, k2: key2 });
  const row = (session: string, unit: string, end: Row["end"], list: string[] | null): Row => ({ unit, family: "plan", arm: "none", model: "opus", pass: Number(session.slice(-1)), end, list, words: list ? list.join(" ").split(" ").length : 0, items: list?.length ?? 0, cut: 0, exposed: null, spend_micros: 0, session });
  const rows: Row[] = [row("s1", "k1", "block", ["Serve tag-a and tag-b for users", "Serve tag-a again"]), row("s2", "k1", "no-block", null), row("s3", "k1", "missing", null), row("s4", "k1", "contaminated", null), row("s5", "k1", "block", ["Serve tag-a and tag-b at once"]), row("s6", "k2", "block", ["Plan for tag-x"])];
  const built = buildLabelPackets({ family: "plan", stage: 1, seed: SEED, units: kunits, rows, normalize: identity, oracle: { version: 1, units: { k1: { changes: ["Plan for tag-a", "Plan for tag-b"], items: ["a", "b"] }, k2: { changes: ["Plan for tag-x", "Plan for tag-y"], items: ["x", "y"] } } } });
  const labels: LabelRecord[] = [];
  for (const p of built.packets) {
    const m = built.map.packets[p.id]!;
    const parsed = JSON.parse(fakeAnswer("KEY ITEMS\n" + p.items.map((i) => "[" + i.id + "] " + i.statement).join("\n") + "\n" + p.lists.map((l) => "List " + l.id + "\n" + l.changes.map((c, k) => k + 1 + ". " + c).join("\n")).join("\n"))).labels;
    for (const l of parsed) labels.push({ packet: p.id, judge: m.judges.length > 1 ? "panel" : m.judges[0]!, model_id: "fake", version: null, effort: "medium", list: l.list, item: l.item, label: { anticipated: l.anticipated, changes: l.changes } });
  }
  const sc = scoreReviews({ units: kunits, rows, map: built.map, labels });
  const by = (s: string) => sc.find((r) => r.session === s)!;
  check("one change matching two items beside a second change matching one of them credits both (A 1)", by("s1").A === 1);
  check("one-to-one credit: one change naming two items earns one (A 0.5), and the share of changes naming more than one item prints", by("s5").A === 0.5 && by("s5").multi === 1);
  check("a no-block reply scores 0; a missing session and a web-contaminated one are missing, never 0", by("s2").status === "no-block" && by("s2").A === 0 && by("s3").status === "missing" && by("s3").A === null && by("s4").status === "missing" && by("s4").A === null);
  const prodId = Object.values(built.map.packets).find((m) => m.role === "production" && m.unit === "k1")!.id;
  const holed = labels.filter((l) => !(l.packet === prodId && built.map.packets[prodId]!.items[l.item]?.item === "a" && built.map.packets[prodId]!.lists[l.list]?.session === "s1"));
  check("a review with an unlabelled primary cell is unscored", scoreReviews({ units: kunits, rows, map: built.map, labels: holed }).find((r) => r.session === "s1")!.status === "unscored");
  check("shuffled A and the specificity score come from the shuffled-key packet beside each list", by("s1").shuffled === 0 && by("s1").specificity === 1 && Object.values(built.map.packets).some((m) => m.role === "shuffled" && m.unit === "k2" && m.lists_unit === "k1"));
  check("maximum matching beats a greedy pick: items [1,2] and [1] match 2", maxMatching([[1, 2], [1]]).size === 2 && maxMatching([[1], [1]]).size === 1);

  // Section 7: the particle-1 panel, its third vote and the union of change indices.
  const pp: PacketFile = { id: "pk", prompt: "brief", items: [{ id: "i1", statement: "People needed tag-q." }], lists: [{ id: "l1", changes: ["Do tag-q", "Do tag-q later"] }] };
  const votes: Record<string, string> = { astra: JSON.stringify({ labels: [{ list: "l1", item: "i1", anticipated: true, changes: [1] }] }), opus: JSON.stringify({ labels: [{ list: "l1", item: "i1", anticipated: false, changes: [] }] }), gemini: JSON.stringify({ labels: [{ list: "l1", item: "i1", anticipated: true, changes: [2] }] }) };
  const panelCall: Caller = async (c) => ({ text: votes[c.judge]!, model_id: c.judge, version: c.judge + "-v", problem: null });
  const recs = await labelPacket(pp, { id: "pk", role: "production", family: "plan", stage: 1, unit: "u", model: "particle", judges: ["astra", "opus"], lists: { l1: { kind: "arm", unit: "u", model: "particle", words: 6 } }, items: { i1: { unit: "u", item: "q", kind: "U" } } }, "medium", panelCall, []);
  const panel = recs.find((r) => r.judge === "panel")!;
  check("a particle-1 split is settled by Gemini's third vote, and the label takes the union of change indices from the judges that voted anticipated", panel.label?.anticipated === true && JSON.stringify(panel.label.changes) === "[1,2]" && recs.some((r) => r.judge === "gemini"));
  let geminiCalls = 0;
  const failing: Caller = async (c) => (c.judge === "gemini" ? (geminiCalls++, { text: null, model_id: "g", version: null, problem: "HTTP 500" }) : { text: votes[c.judge]!, model_id: c.judge, version: null, problem: null });
  const recs2 = await labelPacket(pp, { id: "pk", role: "production", family: "plan", stage: 1, unit: "u", model: "particle", judges: ["astra", "opus"], lists: { l1: { kind: "arm", unit: "u", model: "particle", words: 6 } }, items: { i1: { unit: "u", item: "q", kind: "U" } } }, "medium", failing, []);
  check("a Gemini tie-break that fails is retried once, then the cell stays unlabelled", geminiCalls === 2 && recs2.find((r) => r.judge === "panel")!.label === null);
  let sends = 0;
  const garbled: Caller = async (c) => (sends++, { text: sends === 1 ? "not json" : votes.astra!, model_id: c.judge, version: null, problem: null });
  const logs: CallLog[] = [];
  const recs3 = await labelPacket(pp, { id: "pk", role: "production", family: "plan", stage: 1, unit: "u", model: "opus", judges: ["astra"], lists: { l1: { kind: "arm", unit: "u", model: "opus", words: 6 } }, items: { i1: { unit: "u", item: "q", kind: "U" } } }, "medium", garbled, logs);
  check("a packet with an unparsable cell is resent once, whole", sends === 2 && logs.length === 2 && recs3[0]!.label?.anticipated === true);

  // Section 3: the generic screen and the mentioned flag.
  const gkey: Key = { unit: "g", items: [item("p1", { outside_users: 5 }), item("p2", { outside_users: 3 }), item("m1", { mentioned: true, outside_users: 9 }), item("gen", { outside_users: 7 }), item("r", { kind: "R" })], primary: [], commitments: [] };
  const genericCall: Caller = async (c) => {
    const ids = [...c.prompt.matchAll(/^\[(\w+)\] (.*)$/gm)].map((m) => ({ id: m[1]!, text: m[2]! }));
    const lists = [...c.prompt.matchAll(/^List (\w+)$/gm)].map((m) => m[1]!);
    return { text: JSON.stringify({ labels: lists.flatMap((l) => ids.map((i) => ({ list: l, item: i.id, anticipated: i.text.includes("tag-gen") && c.judge === "opus", changes: i.text.includes("tag-gen") && c.judge === "opus" ? [1] : [] }))) }), model_id: c.judge, version: null, problem: null };
  };
  const gs = await screenKey(gkey, identity, genericCall, []);
  check("the generic screen: an item one judge marks anticipated by a stock row becomes generic and leaves the primary; a mentioned item never enters it", gs.key.items.find((i) => i.id === "gen")!.generic && JSON.stringify(gs.key.primary) === JSON.stringify(["p1", "p2"]) && !primaryOf(gkey).includes("m1"));

  // Section 7: the shuffled-key derangement.
  const types: Record<string, string> = { a: "mobile", b: "mobile", c: "mobile", d: "server", e: "server", f: "consumer" };
  const dr = derangeByGroup(Object.keys(types), (u) => types[u]!, seededRandom(SEED))!;
  const fixed = [...dr].filter(([k, x]) => k === x).length;
  const sameType = [...dr].filter(([k, x]) => types[k] === types[x]).length;
  check("the shuffled-key derangement: no unit keeps its own key, and units stay inside their type where possible (a lone type joins another cycle)", fixed === 0 && new Set(dr.values()).size === 6 && sameType >= 3, sameType + " of 6 in type");

  // Section 10: smoke rules and the expansion and exposure fallbacks; section 11's interim stop.
  const ss = (n: number, f: Partial<SmokeSession>, of = 6): SmokeSession[] => Array.from({ length: of }, (_, i) => ({ model: "opus", parsed: true, exposed: true, expansion_in_block: true, ...(i < n ? f : {}) }));
  const two = ss(0, {}, 2);
  check("smoke rule 1: 5 of 6 parsable blocks pass, 4 of 6 read FIX-METHOD on the instrument", smokeRules("plan", { opus: ss(1, { parsed: false }), sol: two, particle: two }).rule1.pass && smokeRules("plan", { opus: ss(2, { parsed: false }), sol: two, particle: two }).instrument_fail);
  const r2 = smokeRules("plan", { opus: ss(3, { expansion_in_block: false }), sol: two, particle: two, rerun: ss(2, { expansion_in_block: false }) });
  const r2b = smokeRules("plan", { opus: ss(3, { expansion_in_block: false }), sol: two, particle: two, rerun: ss(3, { expansion_in_block: false }) });
  check("smoke rule 2: 4 of 6 expansion blocks pass, 3 trip the fallback sentence; a rerun at 4 passes, at 3 reads FIX-METHOD", !smokeRules("plan", { opus: ss(2, { expansion_in_block: false }), sol: two, particle: two }).rule2!.fallback && r2b.rule2!.fallback && !r2.rule2!.instrument_fail && r2b.rule2!.instrument_fail && r2b.codes.includes("E_PV_EXPOSURE_FALLBACK"));
  const r3 = smokeRules("plan", { opus: ss(2, { exposed: false }), sol: two, particle: two, gate: ss(1, { exposed: false }) });
  const r3b = smokeRules("plan", { opus: ss(2, { exposed: false }), sol: two, particle: two, gate: ss(2, { exposed: false }) });
  const r3c = smokeRules("brief", { opus: ss(2, { exposed: false }), sol: two, particle: two });
  check("smoke rule 3: 5 of 6 exposed pass; 4 runs plan-ceo-review under gstack's opt-in gate (its smoke at 5 passes, 4 fails); office-hours at 4 stops (E_PV_EXPOSURE_STOP)", !smokeRules("plan", { opus: ss(1, { exposed: false }), sol: two, particle: two }).rule3.fallback && r3.rule3.fallback === "gate" && !r3.instrument_fail && r3b.instrument_fail && r3c.rule3.fallback === "stop" && r3c.codes.includes("E_PV_EXPOSURE_STOP"));
  check("smoke rule 4: a gstack arm exposed in 0 of 2 Sol smoke sessions makes Sol's skill contrasts descriptive; 1 of 2 does not", smokeRules("plan", { opus: ss(0, {}), sol: ss(2, { exposed: false }, 2), particle: ss(1, { exposed: false }, 2) }).rule4.sol.descriptive && !smokeRules("plan", { opus: ss(0, {}), sol: ss(2, { exposed: false }, 2), particle: ss(1, { exposed: false }, 2) }).rule4.particle.descriptive);
  const stopRows = (exposed: number): Row[] => Array.from({ length: 40 }, (_, i) => ({ ...row("x" + i, "k1", "block", ["a"]), arm: "skill", exposed: i < exposed }));
  check("the interim exposure stop: 22 of the first 32 Opus skill sessions exposed (0.6875) stops, 23 (0.7188) does not", interimStop(stopRows(22)).stop && !interimStop(stopRows(23)).stop);

  // Section 11: leak exposure, with transposed units' dates; section 4: pre-cutoff sources.
  const cut = loadCutoffs();
  const leakUnits = [meta("capy1", { source: "transposed", inspiration: "capy", plan_date: "2026-10-01" }), meta("pubinsp", { source: "transposed", inspiration: "public", plan_date: "2026-05-15" }), meta("pub1", { plan_date: "2026-07-02" }), meta("pub2", { plan_date: "2026-08-02" })];
  const lo = leakReading(leakUnits, "opus", cut), ls = leakReading(leakUnits, "sol", cut), lp = leakReading(leakUnits, "particle", cut);
  check("leak dates for transposed units: a public-inspired unit keeps its source's plan date (leak-exposed for Opus, cutoff June 2026), a Capy-inspired one its authoring date", JSON.stringify(lo.exposed) === JSON.stringify(["pubinsp"]) && ls.exposed.length === 0 && cutoffEnd("2026-06") === "2026-06-30");
  check("leak exposure reads untested above a quarter of a model's units: 1 of 4 does not, 2 of 7 does; a model with no published cutoff runs with that limit stated", !lo.untested && leakReading([...leakUnits, meta("old", { plan_date: "2026-06-01" }), meta("p5"), meta("p6")], "opus", cut).untested && !lp.stated);
  let refused = 0;
  if (unitProblem(meta("pc", { pre_cutoff: true, set: "comparison" }))) refused++;
  try {
    promoteReserve(meta("pr", { pre_cutoff: true, set: "reserve" }));
  } catch (e) {
    if (e instanceof PvError) refused++;
  }
  check("a pre-cutoff public source is refused as a comparison unit and as a promoted reserve", refused === 2 && unitProblem(meta("ok", { pre_cutoff: true, set: "reserve" })) === null);

  // Section 12: the MDD.
  const power = parsePower(readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-403-product-value-prereg/power.txt"), "utf8"));
  const tie = designMdd(power, { meanItems: 1.25, n: 80, passes: 2 });
  const larger = designMdd(power, { meanItems: 1.5, n: 80, passes: 2, stage1: 0.14 });
  const smaller = designMdd(power, { meanItems: 1.5, n: 80, passes: 2, stage1: 0.05 });
  check("the MDD tie rule: mean items 1.25 sits between the 1 and 1-2 rows and takes the larger MDD (0.13); 1.5 reads 0.11", tie.mdd === 0.13 && tie.mix.length === 2 && designMdd(power, { meanItems: 1.5, n: 80, passes: 2 }).mdd === 0.11, "tie " + tie.mdd);
  check("the larger-MDD rule: a stage 1 re-estimate of 0.14 governs over the table's 0.11; 0.05 does not", larger.mdd === 0.14 && larger.source === "stage 1" && smaller.mdd === 0.11);

  // Section 13 and the lesson of GEVA-96: one lease per stage 1 item on a temporary ledger.
  if (o.ledger) out.push(...(await ledgerLeases(o.approvals ?? APPROVALS)));
  return out;
}

/** Reads the approved stage 1 caps when the approvals file is present, and checks them against STAGE1_ITEMS. */
export function approvedCaps(path: string): { caps: Record<string, number>; source: string; drift: string[] } {
  if (!existsSync(path)) return { caps: { ...STAGE1_ITEMS }, source: "the frozen list in dryrun.ts (the approvals file is not on this machine)", drift: [] };
  const text = readFileSync(path, "utf8");
  const section = text.slice(text.indexOf("## Item caps"));
  const caps: Record<string, number> = {};
  for (const m of section.matchAll(/(pv-[a-z0-9-]+) \$(\d+)/g)) if (m[1]! in STAGE1_ITEMS) caps[m[1]!] = Number(m[2]);
  const drift = Object.keys(STAGE1_ITEMS).filter((k) => caps[k] !== STAGE1_ITEMS[k]);
  return { caps, source: path, drift };
}

async function ledgerLeases(approvals: string): Promise<Line[]> {
  const out: Line[] = [];
  const dir = mkdtempSync(join(tmpdir(), "pv-dryrun-ledger-"));
  try {
    const { caps, source, drift } = approvedCaps(approvals);
    out.push({ rule: "stage 1 items and caps match the approvals (" + source + ")", pass: drift.length === 0, detail: drift.length ? "differs on " + drift.join(", ") : "" });
    const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
    const quote = { words: "dry run on a temporary ledger", by: "pv dryrun", source: "section 17 item 4" };
    for (const [name, dollars] of Object.entries(caps)) recordApproval(record, { action: "init", item: name, cap_micros: dollars * 1_000_000, quotes: [quote], admission: "warn" });
    const env = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };
    const settled: string[] = [];
    const failed: string[] = [];
    const io: Io = { out: () => {}, err: () => {} };
    for (const name of Object.keys(caps)) {
      try {
        if (name.endsWith("-labels") || name.endsWith("-check")) {
          const j = await openJudge({ item: name, runId: name, out: join(dir, "runs", name), cacheDir: join(dir, "cache", name), record, ledger, env, fetch: fakeUpstream((_, prompt) => fakeAnswer(prompt)), io });
          const p: PacketFile = { id: "dry", prompt: name.endsWith("-check") ? "audit" : "brief", items: [{ id: "i1", statement: "People needed tag-z." }], lists: [{ id: "l1", changes: ["Ship tag-z"] }] };
          const recs = await labelPacket(p, { id: "dry", role: name.endsWith("-check") ? "check" : "production", family: "plan", stage: 1, unit: "u", model: "opus", judges: name.endsWith("-check") ? ["astra", "opus"] : ["astra"], lists: { l1: { kind: "arm", unit: "u", model: "opus", words: 2 } }, items: { i1: { unit: "u", item: "z", kind: "U" } } }, name.endsWith("-check") ? "max" : "medium", j.call, []);
          await j.close();
          if (recs.some((r) => r.label?.anticipated !== true || !r.version)) throw new Error("the metered judge call returned no label or no version");
        } else {
          const local = openLocalLedger(ledgerPath(ledger, env));
          try {
            const lease = openLease(record, local, { item: name, run_id: name });
            settleLease(record, local, lease.lease_id);
          } finally {
            local.close();
          }
        }
        settled.push(name);
      } catch (e) {
        failed.push(name + " (" + (e as Error).message.split("\n")[0] + ")");
      }
    }
    out.push({ rule: "one ledger lease per stage 1 item opens and settles on a temporary ledger (" + Object.keys(caps).length + " items; judge items through the metered judge client with a fake upstream)", pass: failed.length === 0 && settled.length === Object.keys(caps).length, detail: failed.join("; ") });
    const local = openLocalLedger(ledgerPath(ledger, env));
    let bound = false;
    try {
      openLease(record, local, { item: "pv-s1-plan-opus-none", run_id: "another-run" });
    } catch (e) {
      bound = (e as { code?: string }).code === "E_ITEM_BOUND";
    } finally {
      local.close();
    }
    out.push({ rule: "an item that served one run refuses a second run (E_ITEM_BOUND), so each frozen run needs its own item", pass: bound, detail: "" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

const USAGE = "gstack-evals pv dryrun [--no-sims] [--no-ledger] [--approvals <path>] [--twin-pairs <n>]";

export async function run(argv: string[], io: Io): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  let approvals: string | undefined;
  let twinPairs: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--approvals") approvals = argv[++i];
    else if (a === "--twin-pairs") {
      twinPairs = Number(argv[++i]);
      if (!Number.isSafeInteger(twinPairs) || twinPairs < 2 || twinPairs > 8) throw new PvError("E_USAGE", "--twin-pairs takes a whole number of pairs from 2 to 8; usage: " + USAGE);
    } else if (a !== "--no-sims" && a !== "--no-ledger") throw new PvError("E_USAGE", "unknown argument " + JSON.stringify(a) + "; usage: " + USAGE);
  }
  if (flags.has("--approvals") && !approvals) throw new PvError("E_USAGE", "--approvals needs a path; usage: " + USAGE);
  const lines = await dryRun({ sims: !flags.has("--no-sims"), ledger: !flags.has("--no-ledger"), approvals, twinPairs });
  for (const l of lines) io.out((l.pass ? "PASS " : "FAIL ") + l.rule + (l.detail ? " (" + l.detail + ")" : ""));
  const failed = lines.filter((l) => !l.pass).length;
  io.out("pv dryrun: " + (lines.length - failed) + " PASS, " + failed + " FAIL");
  return failed ? 1 : 0;
}
