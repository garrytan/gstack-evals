// Copyright (c) 2026 Garry Tan. MIT License.
// The readings part's keyless dry-run cases (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg, section 13).
// Each case drives a frozen rule on synthetic fixtures through the real code (scores, the bootstrap, the gates, the
// verdicts, the analysis, the judge with a stub call, power.py) and checks its outcome on both sides of the line.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { DryCase, GradedBuild, PlantedUnit, ReviewRecord } from "../types.ts";
import { analyze, type AnalysisInput } from "./analysis.ts";
import { fxBuild, fxReview, fxUnit, fxWorld, type FxBuild } from "./fixtures.ts";
import { admissionLine, admissionReading, finalUntested, hardOf, interimCheck, interimStops, raiseProjection, raiseRead, raiseStep, smokeGate, startRule, supplyCheck, type Hinted } from "./gates.ts";
import { bundleText, goldSet, judgeBundle, judgeCheck, stockControl, type GoldCandidate, type GoldPool, type GoldRow, type JudgeCall } from "./judge.ts";
import { catchScore, score } from "./score.ts";

const SEED = 20261115;
const ok = (cond: boolean, detail: string) => ({ ok: cond, detail });

/** The plain pilot of n units with P planted and F functional cases, each unit's builds from per(i). */
function pilot(n: number, P: number, F: number, per: (i: number) => FxBuild[], hinted: Hinted = { passed: 20, screened: 20 }) {
  const units = Array.from({ length: n }, (_, i) => fxUnit(i, P, F, { pilot: true }));
  const builds = units.flatMap((u, i) => per(i).map((b, rep) => fxBuild(u, "plain", rep + 1, { pilot: true, ...b })));
  return admissionReading(units, builds, hinted, SEED);
}
const two = (b: FxBuild, c: [boolean, boolean]): FxBuild[] => [
  { ...b, catch: c[0] },
  { ...b, catch: c[1] },
];
const read = (a: ReturnType<typeof admissionLine>) => a.line + (a.code ? " " + a.code : "") + (a.primary ? " primary " + a.primary : "");
const inBandWorld = (n = 20, F = 1, fn?: number) => pilot(n, 2, F, (i) => two({ pass: 1, fn }, [i < n * 0.4, i < n * 0.4]));
const ceilingWorld = (n: number, good: number) => pilot(n, 1, 1, (i) => two({ pass: i < good ? 1 : 0 }, [i < good, i < good]));
const lowerWorld = (x: number) => pilot(20, 100, 1, () => Array.from({ length: 100 }, (_, k) => ({ pass: x, catch: k < x })));

const verdictOf = (w: AnalysisInput) => {
  const a = analyze(w);
  return { a, s: a.arms.standalone, e: a.arms.engphase };
};
const helps = (fnDrop = 0): AnalysisInput => fxWorld(20, 1, 100, { standalone: () => ({ pass: 1, fn: 100 - fnDrop }), engphase: () => ({ pass: 0 }) });

function stubJudge(answers: string[], seen: string[]): JudgeCall {
  return async (_role, prompt) => {
    seen.push(prompt);
    return answers.shift() ?? "NONE";
  };
}

function goldRows(tp: number, fp: number, fn: number, tn: number): GoldRow[] {
  const rows: GoldRow[] = [];
  const add = (j: boolean, g: boolean, n: number) => {
    for (let i = 0; i < n; i++) rows.push({ key: "g" + rows.length, unit: "u" + rows.length, source: (["plain", "engphase", "standalone", "plan"] as const)[rows.length % 4]!, judge: j, labels: [g, g], settled: null });
  };
  add(true, true, tp);
  add(true, false, fp);
  add(false, true, fn);
  add(false, false, tn);
  return rows;
}

export const DRY: DryCase[] = [
  {
    name: "admission: avoid 0.15 with catch 0.02 picks avoid alone",
    run: () => {
      const a = admissionLine(pilot(25, 20, 1, (i) => two({ pass: 3 }, [i === 0, false])), { afterRaise: false });
      return ok(a.line === "HEADROOM" && a.primary === "avoid", read(a));
    },
  },
  {
    name: "admission: avoid 0.95 with catch 0.60 picks catch alone",
    run: () => {
      const a = admissionLine(pilot(25, 20, 1, (i) => two({ pass: 19 }, [i < 15, i < 15])), { afterRaise: false });
      return ok(a.line === "HEADROOM" && a.primary === "catch", read(a));
    },
  },
  {
    name: "admission: avoid 0.90 with catch 0.05 stops as a split",
    run: () => {
      const a = admissionLine(pilot(20, 10, 1, (i) => two({ pass: 9 }, [i < 2, false])), { afterRaise: false });
      return ok(a.code === "E_EP_COMPONENTS_SPLIT", read(a));
    },
  },
  {
    name: "admission: both components in band read the composite",
    run: () => {
      const a = admissionLine(inBandWorld(), { afterRaise: false });
      return ok(a.line === "HEADROOM" && a.primary === "composite", read(a));
    },
  },
  {
    name: "pilot reach: 0.59 stops on the instrument, 0.60 passes",
    run: () => {
      const at = (x: number) => admissionLine(pilot(20, 2, 98, (i) => two({ pass: 1, fn: x, fnFail: "no_result" }, [i < 8, i < 8])), { afterRaise: false });
      const lo = at(57);
      const hi = at(58);
      return ok(lo.code === "E_EP_INSTRUMENT" && hi.line === "HEADROOM", "reach 0.59: " + read(lo) + "; reach 0.60: " + read(hi));
    },
  },
  {
    name: "pilot hinted builds: 0.59 stops on the instrument, 0.60 passes",
    run: () => {
      const lo = admissionLine({ ...inBandWorld(), hinted: { passed: 59, screened: 100 } }, { afterRaise: false });
      const hi = admissionLine({ ...inBandWorld(), hinted: { passed: 60, screened: 100 } }, { afterRaise: false });
      return ok(lo.code === "E_EP_INSTRUMENT" && hi.line === "HEADROOM", read(lo) + "; " + read(hi));
    },
  },
  {
    name: "pilot floor: 0.09 stops with the functional share first, 0.10 passes",
    run: () => {
      const at = (x: number, fn = 1) => admissionLine(pilot(50, 100, 1, (i) => two({ pass: x, fn }, [i < x, false])), { afterRaise: false });
      const lo = at(9);
      const hi = at(10);
      const setup = at(9, 0);
      const good = lo.code === "E_EP_FLOOR" && lo.message.startsWith("functional share 1.000") && lo.message.endsWith("FIX-METHOD on task fit") && setup.message.endsWith("FIX-METHOD on the build setup") && hi.line === "HEADROOM" && hi.primary === "composite";
      return ok(good, "0.09: " + read(lo) + "; 0.10: " + read(hi) + "; functional 0: " + setup.message.slice(-30));
    },
  },
  {
    name: "pilot ceiling: 0.76 reads the content raise, 0.75 passes",
    run: () => {
      const lo = admissionLine(ceilingWorld(20, 15), { afterRaise: false });
      const hi = admissionLine(ceilingWorld(25, 19), { afterRaise: false });
      return ok(lo.line === "HEADROOM" && hi.code === "E_EP_RAISE", "0.75: " + read(lo) + "; 0.76: " + read(hi));
    },
  },
  {
    name: "pilot lower bound: 0.66 reads the content raise, 0.65 passes",
    run: () => {
      const lo = admissionLine(lowerWorld(65), { afterRaise: false });
      const hi = admissionLine(lowerWorld(66), { afterRaise: false });
      return ok(lo.line === "HEADROOM" && hi.code === "E_EP_RAISE", "0.65: " + read(lo) + " (" + lo.lines[1] + "); 0.66: " + read(hi));
    },
  },
  {
    name: "content raise: hard units, the projection, short supply and the raise's read",
    run: () => {
      const u = (i: number, o: Partial<PlantedUnit> = {}) => fxUnit(i, 1, 1, o);
      const none = (x: PlantedUnit, pass: number, c: boolean): GradedBuild => fxBuild(x, "none", 1, { pass, catch: c });
      const hard = [hardOf(u(0), [none(u(0), 0, true)], ["avoid"]), hardOf(u(1), [none(u(1), 1, false)], ["avoid"]), hardOf(u(2), [none(u(2), 1, false)], ["catch"]), hardOf(u(3, { foresee: ["no", "no"] }), [none(u(3), 0, false)], ["avoid"]), hardOf(u(4), [], ["avoid"])];
      const first = admissionLine(ceilingWorld(25, 19), { afterRaise: false });
      const input = { read: 20, hard: 8, authored: 30, admitted: 20, unused: 200, perCandidateUsd: 6, perReadUsd: 3.5 };
      const go = raiseStep(first, raiseProjection(input));
      const short = raiseStep(first, raiseProjection({ ...input, unused: 100 }));
      const still = raiseRead(ceilingWorld(16, 13), null);
      const band = raiseRead(inBandWorld(16), 40);
      const few = raiseRead(inBandWorld(16), 39);
      const good = JSON.stringify(hard) === "[true,false,true,false,null]" && go.code === "E_EP_RAISE" && go.message.includes("61 hard units") && go.message.includes("cap $") && short.code === "E_EP_CEILING" && still.code === "E_EP_CEILING" && band.line === "HEADROOM" && few.code === "E_EP_CEILING";
      return ok(good, "hard " + JSON.stringify(hard) + "; first ceiling " + go.code + " (" + go.message.slice(go.message.indexOf("raise projection")) + "); 34 projected " + short.code + "; still at the ceiling " + still.code + "; in band " + band.line + "; 39 hard " + few.code);
    },
  },
  {
    name: "exposure smoke: 4 of 6 fails, 5 of 6 passes, a gap counts against the arm",
    run: () => {
      const s = (arm: "standalone" | "engphase", exp: Array<boolean | "gap">, reviewer: "opus" | "sol" = "opus") => exp.map((e, i) => fxReview("c" + i, arm, 1, e === true, e === "gap" ? "upstream_gap" : "completed", reviewer));
      const one = smokeGate([...s("standalone", [true, true, true, true, "gap", false]), ...s("engphase", [true, true, true, true, true, "gap"])], "opus");
      const both = smokeGate([...s("standalone", [true, true, true, true, true, false]), ...s("engphase", [true, true, true, true, true, true])], "opus");
      const sol = smokeGate([...s("standalone", [true, true, "gap"], "sol"), ...s("engphase", [true, "gap", false], "sol")], "sol");
      const good = one.code === "E_EP_EXPOSURE_GATE" && one.through.join() === "engphase" && both.code === null && sol.through.join() === "standalone";
      return ok(good, "4 of 6: " + one.code + " through " + one.through.join() + "; 5 of 6: " + (both.code ?? "through") + "; Sol 2 of 3 and 1 of 3: through " + sol.through.join());
    },
  },
  {
    name: "interim exposure: 0.69 stops, 0.70 goes, over the first 24 non-gap sessions",
    run: () => {
      const sessions = (exposed: number): ReviewRecord[] => {
        const rs: ReviewRecord[] = [];
        for (let i = 0; i < 24; i++) {
          if (i % 4 === 0) rs.push(fxReview("g" + i, "standalone", 1, true, "infra_gap"));
          rs.push(fxReview("u" + i, "standalone", 1, i < exposed));
        }
        return [...rs, ...Array.from({ length: 10 }, (_, i) => fxReview("late" + i, "standalone", 1, false))];
      };
      const lo = interimCheck("standalone", "opus", sessions(16));
      const hi = interimCheck("standalone", "opus", sessions(17));
      const good = interimStops(0.69) && !interimStops(0.7) && lo.code === "E_EP_EXPOSURE_STOP" && !hi.stop && finalUntested(0.79) && !finalUntested(0.8);
      return ok(good, "0.69 stops " + interimStops(0.69) + ", 0.70 stops " + interimStops(0.7) + "; 16 of 24 " + (lo.code ?? "goes") + ", 17 of 24 " + (hi.code ?? "goes") + "; final 0.79 untested " + finalUntested(0.79) + ", 0.80 untested " + finalUntested(0.8));
    },
  },
  {
    name: "start rule: a re-printed MDD of 0.12 runs, 0.121 waits for the Captain",
    run: () => {
      const a = startRule(0.12);
      const b = startRule(0.121);
      return ok(a.code === null && b.code === "E_EP_START_RULE", "0.12 " + (a.code ?? "runs") + ", 0.121 " + b.code);
    },
  },
  {
    name: "short supply: 39 admitted units stop, 40 run",
    run: () => {
      const a = supplyCheck(39);
      const b = supplyCheck(40);
      return ok(a.code === "E_EP_SUPPLY_SHORT" && b.code === null, "39 " + a.code + ", 40 " + (b.code ?? "runs") + " (" + b.message + ")");
    },
  },
  {
    name: "KEEP: the functional bound at -0.09 keeps, at -0.10 and -0.11 it does not",
    run: () => {
      const v = [9, 10, 11].map((x) => verdictOf(helps(x)).s);
      const good = v[0]!.verdict === "KEEP" && v[1]!.verdict === "helps without KEEP" && v[2]!.verdict === "helps without KEEP" && v[1]!.row.includes("costs the rest of the change");
      return ok(good, v.map((s, i) => ["-0.09", "-0.10", "-0.11"][i] + ": " + s.verdict + " (functional lower bound " + s.functional?.lo.toFixed(3) + ")").join("; "));
    },
  },
  {
    name: "precedence: untested (exposure 0.75) over KEEP, the reach guard over helps, coverage, admission",
    run: () => {
      const exposure = verdictOf(fxWorld(20, 1, 100, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 0 }) }, { exposed: (i) => i % 4 !== 0 })).s;
      const reach = verdictOf(fxWorld(20, 1, 100, { standalone: () => ({ pass: 1, fn: 0, fnFail: "no_result" }), engphase: () => ({ pass: 0 }) })).s;
      const short = helps();
      short.builds = short.builds.filter((b) => !(b.arm === "standalone" && b.rep === 3 && Number(b.unit.slice(1)) < 7));
      const coverage = verdictOf(short).s;
      const adm = verdictOf({ ...helps(), admitted: false }).s;
      const good = exposure.verdict === "untested" && exposure.why.startsWith("exposure 0.75") && reach.verdict === "untested" && reach.why.startsWith("reach guard") && coverage.verdict === "untested" && coverage.why.startsWith("coverage 0.88") && adm.verdict === "untested" && adm.row.startsWith("No skill reading; FIX-METHOD on task fit");
      return ok(good, [exposure, reach, coverage, adm].map((s) => s.verdict + " (" + s.why + ")").join("; "));
    },
  },
  {
    name: "verdict words: hurts, no measurable difference and not shown",
    run: () => {
      const hurts = verdictOf(fxWorld(20, 1, 1, { plain: () => ({ pass: 1 }), standalone: () => ({ pass: 0 }), engphase: () => ({ pass: 1 }) })).s;
      const none = verdictOf(fxWorld(20, 1, 1, { standalone: () => ({ pass: 0 }), engphase: () => ({ pass: 0 }) })).s;
      const shown = verdictOf(fxWorld(4, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 0 }) })).s;
      const good = hurts.verdict === "hurts" && hurts.r48 === "FIX-METHOD" && none.verdict === "no measurable difference" && shown.verdict === "not shown" && shown.r48 === "FIX-METHOD";
      return ok(good, "hurts: " + hurts.verdict + "; equal: " + none.verdict + "; 4 repos all better (p " + shown.reading?.p.toFixed(3) + "): " + shown.verdict);
    },
  },
  {
    name: "stock line: matches when the arm helps and minus stock sits below +0.05, else not distinguished",
    run: () => {
      const m = verdictOf(fxWorld(20, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 0 }), stock: () => ({ pass: 1 }) })).s;
      const n = verdictOf(fxWorld(20, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 0 }), stock: () => ({ pass: 0 }) })).s;
      return ok(m.stock === "matches" && n.stock === "not distinguished", "stock as good: " + m.stock + "; stock no better than plain: " + n.stock);
    },
  },
  {
    name: "stock control: stock credit with plan-only credit is a plan leak, without it a rubric fault",
    run: () => {
      const b = (unit: string, source: "stock" | "plan", named: boolean) => ({ unit, source, words: 100, quotes: named ? ["q"] : [], named, sections: [] });
      const leak = stockControl([b("u1", "stock", true), b("u1", "plan", true), b("u2", "stock", false), b("u2", "plan", false)], 0);
      const fault = stockControl([b("u1", "stock", true), b("u1", "plan", false)], 0);
      const again = stockControl([b("u1", "stock", true), b("u1", "plan", false)], 1);
      const good = leak.action === "ok" && leak.leaks.join() === "u1" && fault.action === "revise" && again.action === "unreported" && again.code === "E_EP_JUDGE_CHECK";
      return ok(good, "with plan credit: " + leak.action + " (leaks " + leak.leaks.join() + "); without: " + fault.action + "; after the revision: " + again.action + " " + again.code);
    },
  },
  {
    name: "Holm: the public headline differs from a per-arm verdict",
    run: () => {
      const { a, s, e } = verdictOf(fxWorld(6, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 1 }) }));
      const good = s.verdict === "KEEP" && e.verdict === "KEEP" && s.headline.verdict === "not shown" && a.lines.some((l) => l.startsWith("arm standalone public headline") && l.includes("adjusted p 0.0625"));
      return ok(good, "per arm (p " + s.reading?.p.toFixed(4) + "): standalone " + s.verdict + ", engphase " + e.verdict + "; Holm headline (adjusted " + s.holm?.adjusted.toFixed(4) + "): standalone " + s.headline.verdict + ", engphase " + e.headline.verdict);
    },
  },
  {
    name: "explicit invocation: every skill-arm result line names it with the exposure counts",
    run: () => {
      const w = fxWorld(20, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 0 }) });
      w.reviews = w.reviews.map((r, i) => (r.arm === "standalone" && i % 20 === 1 ? { ...r, outcome: "upstream_gap" as const } : r));
      const a = analyze(w);
      const lines = a.lines.filter((l) => /^arm (standalone|engphase)(: | public headline)/.test(l));
      const c = a.arms.standalone.exposure;
      const good = lines.length === 4 && lines.every((l) => l.includes("measured given an explicit invocation") && /sessions exposed \d+, unexposed \d+, gaps \d+/.test(l)) && lines[0]!.includes("sessions exposed " + c.exposed + ", unexposed " + c.unexposed + ", gaps " + c.gaps) && c.gaps > 0;
      return ok(good, lines.length + " result lines; standalone exposed " + c.exposed + ", unexposed " + c.unexposed + ", gaps " + c.gaps);
    },
  },
  {
    name: "standalone minus eng phase: a direction only when the interval excludes zero",
    run: () => {
      const better = verdictOf(helps()).a.pair;
      const same = verdictOf(fxWorld(20, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 1 }) })).a.pair;
      return ok(better === "standalone better" && same.startsWith("no measurable difference"), better + "; " + same);
    },
  },
  {
    name: "catch and gaps: a dropped transplant scores 0 in the primary and drops from the sensitivity read; a gap drops or scores 0",
    run: () => {
      const u = fxUnit(0, 2, 1);
      const b = fxBuild(u, "plain", 1, { pass: 2, catch: null });
      const w = fxWorld(20, 1, 1, { standalone: (i, rep) => ({ pass: 1, outcome: i < 5 && rep === 1 ? "infra_gap" : "completed" }), engphase: () => ({ pass: 0 }) });
      const s = analyze(w).arms.standalone;
      const good = catchScore(b) === 0 && catchScore(b, "sensitivity") === null && score(b, u, "composite") === 0.5 && score(b, u, "composite", "sensitivity") === null && s.reading?.units === 20 && s.zero !== null && s.zero.estimate < s.reading.estimate;
      return ok(good, "primary " + score(b, u, "composite") + ", sensitivity " + score(b, u, "composite", "sensitivity") + "; gaps left out " + s.reading?.estimate.toFixed(3) + ", gaps as 0 " + s.zero?.estimate.toFixed(3));
    },
  },
  {
    name: "judge: two blind calls, names stripped, the item cap and verbatim quotes",
    run: async () => {
      const seen: string[] = [];
      const files = [
        { path: "plan.md", text: "# Plan\nThe parser reads a config file.\n## Failure modes\nWhen the file is empty, return the defaults." },
        { path: "review/plan-eng-review-notes.md", text: "gstack /plan-eng-review notes: test that an empty file yields defaults." },
      ];
      const quotes = JSON.stringify(["When the file is empty, return the defaults.", "an invented condition", ...Array.from({ length: 12 }, (_, i) => "extra " + i)]);
      const r = await judgeBundle({ unit: "u1", source: "standalone", files, hint: "An empty config file must yield the defaults." }, stubJudge([quotes, "MATCH 1"], seen));
      const good = seen.length === 2 && !/plan-eng-review|gstack/.test(seen[0]!) && !seen[0]!.includes("empty config file must yield") && seen[1]!.includes("empty config file must yield") && !seen[1]!.includes("The parser reads") && r.named && r.over === 2 && r.dropped === 11 && r.sections.join() === "failure modes";
      return ok(good, "calls " + seen.length + ", named " + r.named + ", quotes kept " + r.quotes.length + ", dropped " + r.dropped + ", over the cap " + r.over + ", section " + r.sections.join());
    },
  },
  {
    name: "judge bundle cap: 12,500 words are cut to 12,000",
    run: () => {
      const t = bundleText([{ path: "plan.md", text: "word ".repeat(9000) }, { path: "review/review.md", text: "more ".repeat(3500) }]);
      const content = t.text.split("\n").filter((l) => !l.startsWith("=== file: ")).join(" ").split(/\s+/).filter(Boolean).length;
      return ok(t.truncated && t.words === 12000 && content === 12000 && t.text.includes("=== file: review/review.md ==="), "words " + t.words + " (counted " + content + "), truncated " + t.truncated);
    },
  },
  {
    name: "judge gold set: 48 bundles balanced by arm, enriched toward 40% likely positives",
    run: () => {
      const cand = (pool: GoldPool, i: number, hit: boolean): GoldCandidate => ({ key: pool + i, unit: "u" + i, source: pool === "smoke" ? (i % 2 ? "standalone" : "engphase") : pool, bundle: { unit: "u" + i, source: "plain", hint: "negative timeout closes the socket", files: [{ path: "plan.md", text: hit ? "A negative timeout closes the socket." : "Read the file." }] } });
      const pools = { smoke: [], standalone: [], engphase: [], plain: [], stock: [], plan: [] } as Record<GoldPool, GoldCandidate[]>;
      for (const p of Object.keys(pools) as GoldPool[]) for (let i = 0; i < 40; i++) pools[p].push(cand(p, i, p !== "stock" && p !== "plan" && p !== "smoke" && i >= 20));
      const g = goldSet(pools);
      const per = (s: string) => g.picked.filter((c) => c.source === s).length;
      const good = g.picked.length === 48 && g.short.length === 0 && g.proxy >= 0.3 && g.proxy <= 0.5 && per("plain") === 12 && per("stock") === 2 && per("plan") === 2;
      return ok(good, "picked " + g.picked.length + ", proxy " + g.proxy.toFixed(3) + ", plain " + per("plain") + ", standalone " + per("standalone") + ", engphase " + per("engphase") + ", stock " + per("stock") + ", plan " + per("plan"));
    },
  },
  {
    name: "judge check: kappa 0.59 fails, 0.60 passes",
    run: () => {
      const lo = judgeCheck(goldRows(80, 20, 21, 79));
      const hi = judgeCheck(goldRows(20, 5, 5, 20));
      return ok(lo.code === "E_EP_JUDGE_CHECK" && hi.pass, "kappa " + lo.kappa?.toFixed(3) + ": " + lo.code + "; kappa " + hi.kappa?.toFixed(3) + ": " + (hi.pass ? "passes" : hi.code));
    },
  },
  {
    name: "power.py: the 64x3 row reads 0.10 to 0.11 (needs uv and numpy 2.5.4)",
    run: () => {
      const r = spawnSync("uv", ["run", "-q", "--with", "numpy==2.5.4", "python", join(import.meta.dir, "power.py"), "--rows", "64x3"], { encoding: "utf8", timeout: 600_000 });
      const line = (r.stdout ?? "").split("\n").find((l) => /^64x3 +composite +MDD/.test(l)) ?? "";
      return ok(r.status === 0 && line.includes("MDD 0.10 to 0.11"), line || "power.py did not run: " + (r.error?.message ?? r.stderr?.slice(0, 200)));
    },
  },
];
