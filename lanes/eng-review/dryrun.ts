// Copyright (c) 2026 Garry Tan. MIT License.
// er dryrun (prereg 2026-11-08-geva-405, section 16 item 4): a keyless dry run that drives every frozen scoring-side rule
// on both sides of its edge, with synthetic units, rows, labels and a fake upstream, and opens and settles one ledger
// lease per item on a temporary ledger. It prints one PASS or FAIL line per case and a total, and exits 1 on any FAIL.
// The run side's rules (the mounts, web refusal, session limits, detectors, the Stop hook, the eng phase renderer, the
// candidate install, the supply stop) plug in through run-checks.ts's runSideChecks(); until that module exists the dry
// run prints one FAIL line for it. Build-time choices: items and caps come from the approvals file's markdown table rows
// under a heading containing "Item caps", whose first cell is an item id matching er-[a-z0-9-]+ and whose "Cap" column
// holds $N; until that section exists the ledger part prints one FAIL line naming it. An item whose id names labels,
// check, judge, pairwise, generic or probe opens its lease through the metered judge client with a fake upstream and
// labels one packet; every other item opens and settles a plain lease.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import type { Io } from "./cli.ts";
import { PvError } from "../product-value/io.ts";
import { fakeUpstream } from "../product-value/dryrun.ts";
import { maxMatching, r4 } from "../product-value/stats.ts";
import { primaryOf, screenKey } from "./author/generic.ts";
import { labelPacket, openErJudge, type Caller } from "./judge.ts";
import { buildLabelPackets, derangeUnits, isAnchor, type LabelRecord, type PacketFile, type PacketMeta } from "./packets.ts";
import { normalizeEngPlan, parseEngPlan } from "./parse.ts";
import { admission, anchorWeight, contrast, holmFamily, interimDecide, interimStop, judgeScore, leakReading, loadCutoffs, pairwiseStockUntested, projection, readingRule, smokeArm, stockReading, untestedReasons, verdict, type Actuals, type CheckCell, type ReadingInput } from "./rules.ts";
import { scoreReviews, type Review, type StockCredit } from "./score.ts";
import type { ArmId, Key, KeyItem, Label, ModelId, Row, UnitMeta } from "./types.ts";
import type { LoadedUnit } from "./units.ts";

export const RUN_SIDE_HOOK = "run-checks.ts";
export const RUN_SIDE_RULES = ["refusal of WebSearch and WebFetch and a web-contaminated session", "the mounts with key.json absent and no later git history", "each session limit", "each detector on its exposed and unexposed fixtures, a candidate run ending Status: no-plan included", "the eng phase renderer on a plan.md without its headings", "the Stop hook's two blocks and its release", "the candidate's install at its pinned commit with both digests", "the supply stop"];
export const APPROVALS = join(homedir(), ".capy", "drive", "captain-gstack-evals", "approvals", "2026-11-08-plan-eng-review-intentions-line.md");

interface Line {
  rule: string;
  pass: boolean;
  detail: string;
}

export const meta = (id: string, over: Partial<UnitMeta> = {}): UnitMeta => ({ id, set: "comparison", type: "devtools", repo: "example/" + id, licence: "MIT", copyleft: false, language: "TypeScript", merge_sha: "m", base_sha: "b", pr: 1, merged_at: "2026-08-10T00:00:00Z", exposed_at: "2026-08-02T00:00:00Z", wave: 1, window_closes: "2026-10-09", source_files: 3, source_added: 50, rank: 1, ...over });
export const item = (id: string, over: Partial<KeyItem> = {}): KeyItem => ({ id, kind: "B", b_source: "fix", statement: "The importer failed on tag-" + id + " (src/import.ts).", file: "src/import.ts", evidence: [], dated: "2026-09-01", sites: [{ file: "src/import.ts", function: "readRows" }], mentioned: false, generic: false, foreseeable: { opus: "yes", sol: "maybe" }, ...over });
export const keyOf = (unit: string, items: KeyItem[], primary = items.map((i) => i.id)): Key => ({ unit, items, primary, own: [{ id: "o1", statement: "The team tested tag-own." }], touched: { files: ["src/import.ts"], functions: [{ file: "src/import.ts", name: "readRows" }] }, diffstat: [{ file: "src/import.ts", added: 40, deleted: 2 }] });
export const unitsOf = (specs: Array<{ meta: UnitMeta; key: Key | null }>): Map<string, LoadedUnit> => new Map(specs.map((s) => [s.meta.id, { meta: s.meta, key: s.key, dir: "/nonexistent/" + s.meta.id }]));
export function row(over: Partial<Row> & { unit: string; session: string }): Row {
  const checks = over.checks === undefined ? ["Unit test for tag-a"] : over.checks;
  return { arm: "none", model: "opus", pass: 1, end: checks ? "block" : "no-block", arm_stop: false, paths: checks ? ["src/import.ts readRows"] : null, checks, words: 10, items: 2, cut: 0, check_words: 4, exposed: null, loaded: null, enforced: false, blocks: 0, spend_micros: 100_000, ...over };
}
export function rv(unit: string, arm: ArmId, pass: number, A: number | null, over: Partial<Review> = {}): Review {
  return { unit, model: "opus", arm, pass, session: unit + "-" + arm + "-" + pass, status: A === null ? "missing" : "scored", arm_stop: false, A, A_sens: A, shuffled: 0, specificity: A, A_B: null, A_T: null, A_C: null, path_hit: null, A_own: null, A_mentioned: null, A_generic: null, A_foreseeable: null, precision: null, code_share: null, credited: null, site_paths: null, site_checks: null, map_files: null, map_functions: null, mix: null, words: 60, check_words: 40, items: 8, cut: 0, exposed: arm === "none" || arm === "lens" ? null : true, enforced: false, spend_micros: null, ...over };
}

/** A fake judge for the brief: a cell is anticipated (and path-hit) when a check carries the item's tag word. */
export function fakeAnswer(prompt: string, o: { flip?: boolean; skip?: number; second?: boolean } = {}): string {
  const items = [...prompt.matchAll(/^\[(\w+)\] .*?(tag-[\w-]+)/gm)].map((m) => ({ id: m[1]!, tag: m[2]! }));
  const parts = prompt.split(/^List (\w+)$/m).slice(1);
  const labels = [];
  for (let i = 0; i < parts.length; i += 2) {
    const checks = parts[i + 1]!.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, ""));
    for (const it of items) {
      const hit = checks.map((c, k) => (c.includes(it.tag) ? k + 1 : 0)).filter(Boolean);
      const anticipated = o.flip ? !hit.length : hit.length > 0;
      const idx = anticipated ? (hit.length ? hit : [1]) : [];
      labels.push({ list: parts[i]!, item: it.id, anticipated, checks: idx, path_hit: anticipated, path_checks: idx, credit: anticipated ? "check" : null });
    }
  }
  return JSON.stringify({ labels: labels.slice(o.skip ?? 0) });
}

const label = (over: Partial<Label> = {}): Label => ({ anticipated: false, checks: [], path_hit: false, path_checks: [], credit: null, ...over });
const yes = (checks: number[]): Label => label({ anticipated: true, checks, path_hit: true, path_checks: checks, credit: "check" });

/** Builds one stage 2 production packet for a block row on unit u (with a second unit for the derangement) and scores it under labels. */
function scoreWith(items: KeyItem[], checks: string[], labelOf: (item: string) => Label | null, rowOver: Partial<Row> = {}): Review[] {
  const units = unitsOf([{ meta: meta("u1"), key: keyOf("u1", items) }, { meta: meta("u2"), key: keyOf("u2", [item("z")]) }]);
  const rows = [row({ unit: "u1", session: "s1", checks, ...rowOver })];
  const built = buildLabelPackets({ stage: 1, seed: 1, units, rows });
  const labels: LabelRecord[] = [];
  for (const m of Object.values(built.map.packets))
    for (const [lid, lref] of Object.entries(m.lists))
      for (const [iid, iref] of Object.entries(m.items)) labels.push({ packet: m.id, judge: "astra", model_id: "openai:gpt-6-astra", version: "v", effort: "medium", prompt_sha256: "", packet_sha256: "", list: lid, item: iid, label: lref.kind === "arm" && m.role === "production" ? labelOf(iref.item) : label() });
  return scoreReviews({ units, rows, map: built.map, labels });
}

export function approvedItems(path: string): { items: Record<string, number> | null; detail: string } {
  if (!existsSync(path)) return { items: null, detail: "the approvals file " + path + " is not on this machine" };
  const lines = readFileSync(path, "utf8").split("\n");
  const at = lines.findIndex((l) => /^#{1,6}\s.*Item caps/i.test(l));
  if (at < 0) return { items: null, detail: "the approvals file has no section whose heading contains \"Item caps\"; the Captain records each item's cap there" };
  const items: Record<string, number> = {};
  let capCol = -1;
  for (const l of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    if (!l.trim().startsWith("|")) continue;
    const cells = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const cap = cells.findIndex((c) => /^cap$/i.test(c.replace(/\*/g, "")));
    if (cap >= 0) capCol = cap;
    const m = /^`?(er-[a-z0-9-]+)`?$/.exec(cells[0] ?? "");
    const dollars = capCol >= 0 ? /\$\s*([\d,]+(?:\.\d+)?)/.exec(cells[capCol] ?? "") : null;
    if (m && dollars) items[m[1]!] = Number(dollars[1]!.replace(/,/g, ""));
  }
  return Object.keys(items).length ? { items, detail: path } : { items: null, detail: "the \"Item caps\" section holds no er- item row with a $ cap" };
}

const JUDGE_ITEM = /labels|check|judge|pairwise|generic|probe/;

async function ledgerLeases(approvals: string): Promise<Line[]> {
  const { items, detail } = approvedItems(approvals);
  if (!items) return [{ rule: "one ledger lease per item opens and settles on a temporary ledger", pass: false, detail }];
  const dir = mkdtempSync(join(tmpdir(), "er-dryrun-ledger-"));
  const out: Line[] = [];
  try {
    const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
    const quote = { words: "dry run on a temporary ledger", by: "er dryrun", source: "section 16 item 4" };
    for (const [name, dollars] of Object.entries(items)) recordApproval(record, { action: "init", item: name, cap_micros: dollars * 1_000_000, quotes: [quote], admission: "warn" });
    const env = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };
    const failed: string[] = [];
    const io: Io = { out: () => {}, err: () => {} };
    for (const name of Object.keys(items)) {
      try {
        if (JUDGE_ITEM.test(name)) {
          const j = await openErJudge({ item: name, runId: name, out: join(dir, "runs", name), cacheDir: join(dir, "cache", name), record, ledger, env, fetch: fakeUpstream((_, p) => fakeAnswer(p)), io });
          const p: PacketFile = { id: "dry", prompt: "brief", items: [{ id: "i1", statement: "The importer failed on tag-z." }], lists: [{ id: "l1", checks: ["Unit test for tag-z"] }] };
          const recs = await labelPacket(p, { id: "dry", role: "production", stage: 1, unit: "u", model: "opus", pass: 1, judges: ["astra"], lists: { l1: { kind: "arm", unit: "u", model: "opus", pass: 1, words: 4 } }, items: { i1: { unit: "u", item: "z", kind: "B" } } }, "medium", j.call, []);
          await j.close();
          if (recs.some((r) => r.label?.anticipated !== true || !r.version)) throw new Error("the metered judge call returned no label or no version");
        } else {
          const local = openLocalLedger(ledgerPath(ledger, env));
          try {
            settleLease(record, local, openLease(record, local, { item: name, run_id: name }).lease_id);
          } finally {
            local.close();
          }
        }
      } catch (e) {
        failed.push(name + " (" + (e as Error).message.split("\n")[0] + ")");
      }
    }
    out.push({ rule: "one ledger lease per item opens and settles on a temporary ledger (" + Object.keys(items).length + " items from " + detail + ")", pass: !failed.length, detail: failed.join("; ") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

async function driftCase(): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "er-dryrun-drift-"));
  try {
    const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
    recordApproval(record, { action: "init", item: "er-dry-drift", cap_micros: 5_000_000, quotes: [{ words: "dry run", by: "er dryrun", source: "section 16 item 4" }], admission: "warn" });
    const env = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };
    const base = fakeUpstream((_, p) => fakeAnswer(p));
    const drifted = (async (url: any, init?: any) => {
      const res = await base(url, init);
      if (!String(url).includes("openrouter")) return res;
      const body = (await res.json()) as Record<string, unknown>;
      return Response.json({ ...body, provider: "SomeOtherHost" });
    }) as typeof fetch;
    const j = await openErJudge({ item: "er-dry-drift", runId: "drift", out: join(dir, "run"), cacheDir: join(dir, "cache"), record, ledger, env, fetch: drifted, io: { out: () => {}, err: () => {} } });
    let code = "";
    try {
      await j.call({ judge: "gemini", prompt: "x", effort: "medium", maxTokens: 100, label: "drift" });
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    await j.close();
    return code === "E_ER_PROVIDER_DRIFT";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const reading = (over: Partial<ReadingInput> = {}): ReadingInput => ({ none: { verdict: "no measurable difference", ci95: [-0.03, 0.049] }, lens: { verdict: "no measurable difference", ci95: [-0.03, 0.08] }, lensNone: { verdict: "no measurable difference" }, exposure: 0.9, headroom: true, stockPass: true, judgePass: true, coverage: 0.95, pairwise: null, stage3: null, ...over });
const judge = (kappa: number, over = {}) => ({ pass: kappa >= 0.6, shortfall: false, short_anticipated: false, kappa, ...over });
const cell = (gold: boolean, judged: boolean, o: { anchor?: boolean; list?: string } = {}): CheckCell => ({ gold, judged, anchor: o.anchor ?? false, real: !o.anchor, list: o.list ?? "l" + Math.random(), stratum: "none/B" });
const credits = (model: ModelId, units: number, n: number, row = 1): StockCredit[] => Array.from({ length: n }, (_, i) => ({ unit: "u" + i, model, pass: 1, row, credited: i < units }));

export async function dryRun(o: { ledger: boolean; approvals?: string }): Promise<Line[]> {
  const out: Line[] = [];
  const check = (rule: string, pass: boolean, detail = "") => out.push({ rule, pass, detail });
  const hook = join(import.meta.dir, RUN_SIDE_HOOK);
  if (existsSync(hook)) {
    const mod = (await import(hook)) as { runSideChecks?: () => Promise<Array<{ rule: string; pass: boolean; detail?: string }>> };
    if (typeof mod.runSideChecks !== "function") check("run side: " + RUN_SIDE_HOOK + " exports runSideChecks()", false, "it does not");
    else for (const c of await mod.runSideChecks()) check("run side: " + c.rule, c.pass, c.detail ?? "");
  } else check("run side: " + RUN_SIDE_RULES.join("; "), false, "lanes/eng-review/" + RUN_SIDE_HOOK + " is not built yet; the run side's dry-run checks plug in there");

  const fence = (b: string, l = "eng-plan") => "\u0060\u0060\u0060" + l + "\n" + b + "\n\u0060\u0060\u0060";
  const strict = parseEngPlan([fence(JSON.stringify({ paths: ["a"], checks: ["b"] }))]);
  const lenient = parseEngPlan([fence('{"paths": ["a",], "checks": ["b",],}', "json")]);
  const none = parseEngPlan(["no block here"]);
  const n = normalizeEngPlan(["**src/a.ts** load"], ["1. " + Array.from({ length: 45 }, (_, i) => "w" + i).join(" ")]);
  check("normalization and the lenient parse: strict block, lenient label and commas, no block, markdown stripped and a 45-word check cut at 40", strict.kind === "block" && strict.lenient === null && lenient.kind === "block" && JSON.stringify(lenient.lenient) === JSON.stringify(["label", "commas"]) && none.kind === "no-block" && n.paths[0] === "src/a.ts load" && n.checks[0]!.split(" ").length === 40 && n.cut === 1);

  const adm = (A: number, lower: number, j = judge(0.7)) => admission({ noneA: A, lower, stockFail: false, judge: j, parsed: 48, completed: 48 }).reading;
  check("A band: 0.09 reads FLOOR, 0.10 HEADROOM, 0.75 HEADROOM, 0.76 CEILING", adm(0.09, 0.05) === "FLOOR" && adm(0.1, 0.05) === "HEADROOM" && adm(0.75, 0.6) === "HEADROOM" && adm(0.76, 0.6) === "CEILING");
  check("the lower bound at 0.65 reads HEADROOM, at 0.66 CEILING", adm(0.7, 0.65) === "HEADROOM" && adm(0.7, 0.66) === "CEILING");
  check("an Opus judge kappa of 0.59 reads NO READ, 0.60 doesn't", adm(0.3, 0.2, judge(0.59)) === "NO READ" && adm(0.3, 0.2, judge(0.6)) === "HEADROOM");
  check("an Opus judge short of anticipated gold cells with A under 0.10 reads NO READ, never FLOOR", adm(0.05, 0.01, judge(0.9, { pass: false, shortfall: true, short_anticipated: true })) === "NO READ");
  check("the parse rate: 46 of 48 Opus none replies (95.8%) pass, 45 of 48 (93.8%) read NO READ", admission({ noneA: 0.3, lower: 0.2, stockFail: false, judge: judge(0.7), parsed: 46, completed: 48 }).reading === "HEADROOM" && admission({ noneA: 0.3, lower: 0.2, stockFail: false, judge: judge(0.7), parsed: 45, completed: 48 }).reading === "NO READ");

  check("stock, stage 1: a row credited on 2 of 16 calibration units passes, on 3 fails", !stockReading(credits("opus", 2, 16), 16).fail.opus && stockReading(credits("opus", 3, 16), 16).fail.opus);
  check("stock, stage 2: 7 of 56 comparison units passes, 8 fails", !stockReading(credits("opus", 7, 56), 56).fail.opus && stockReading(credits("opus", 8, 56), 56).fail.opus);
  const solFail = stockReading(credits("sol", 3, 16), 16);
  check("a stock fail on Opus lists in stage 1 ends the eval; on Sol lists it makes only Sol's contrasts untested (stock)", admission({ noneA: 0.3, lower: 0.2, stockFail: stockReading(credits("opus", 3, 16), 16).fail.opus, judge: judge(0.7), parsed: 48, completed: 48 }).reading === "STOCK FAIL" && solFail.fail.sol && !solFail.fail.opus && untestedReasons({ exposure: 0.9, coverage: [1], stockFail: solFail.fail.sol, judgePass: true, leak: false }).includes("untested (stock)"));
  const r3 = credits("opus", 3, 16, 3);
  check("stock row 3 is labelled as a list and counts toward STOCK FAIL, but never as a judge-check anchor", stockReading(r3, 16).fail.opus && !isAnchor({ kind: "stock", unit: "u", model: "opus", pass: 1, stock: 3, words: 1 }) && isAnchor({ kind: "stock", unit: "u", model: "opus", pass: 1, stock: 1, words: 1 }));
  const pw = (share: number) => pairwiseStockUntested([{ model: "opus", contrast: "stock-none", judge: "astra", n: 100, wins: share * 100, losses: 0, ties: 0, unread: 0, raw: null, win_share: share, length_controlled: null, ci95: null }]);
  check("the pairwise stock block at 20% of its pairs passes, at 21% flags the pairwise read untested (stock)", !pw(0.2) && pw(0.21));
  check("coverage at 0.89 reads untested, at 0.90 doesn't", untestedReasons({ exposure: 0.9, coverage: [0.89], stockFail: false, judgePass: true, leak: false }).length === 1 && untestedReasons({ exposure: 0.9, coverage: [0.9], stockFail: false, judgePass: true, leak: false }).length === 0);
  check("exposure at 0.79 reads untested, at 0.80 doesn't", untestedReasons({ exposure: 0.79, coverage: [1], stockFail: false, judgePass: true, leak: false }).length === 1 && untestedReasons({ exposure: 0.8, coverage: [1], stockFail: false, judgePass: true, leak: false }).length === 0);
  const sess = (k: number) => Array.from({ length: 24 }, (_, i) => row({ unit: "u" + i, session: "x" + i, arm: "precut", exposed: i < k }));
  check("the interim stop after 24 sessions: 0.69 stops, 0.70 runs; 16 of 24 exposed stops, 17 of 24 runs; 23 sessions never stop", interimDecide(24, 0.69) && !interimDecide(24, 0.7) && interimStop(sess(16), "precut").stop && !interimStop(sess(17), "precut").stop && !interimDecide(23, 0.1));
  const smoke = (parsed: number, exposed: number, enforced: Row[] = []) => smokeArm("precut", [...Array.from({ length: 6 }, (_, i) => row({ unit: "u" + i, session: "s" + i, arm: "precut", checks: i < parsed ? ["c"] : null, exposed: i < exposed })), ...enforced]);
  const enf = (k: number) => Array.from({ length: 6 }, (_, i) => row({ unit: "u" + i, session: "e" + i, arm: "precut", enforced: true, exposed: i < k }));
  check("smoke parse at 4 of 6 is FIX-METHOD, at 5 passes", smoke(4, 6).instrument_fail && !smoke(5, 6).instrument_fail);
  check("smoke exposure at 4 of 6 falls back to the Stop hook (E_ER_EXPOSURE_FALLBACK) and passes on an enforced 5 of 6, fails on 4 of 6; 5 of 6 needs no fallback", smoke(6, 4).codes.includes("E_ER_EXPOSURE_FALLBACK") && smoke(6, 4, enf(5)).enforced_procedure && !smoke(6, 4, enf(5)).instrument_fail && smoke(6, 4, enf(4)).instrument_fail && !smoke(6, 5).rule2.fallback);
  const sol0 = smokeArm("precut", [row({ unit: "u", session: "a", arm: "precut", model: "sol", exposed: false }), row({ unit: "u", session: "b", arm: "precut", model: "sol", exposed: false })]);
  const sol1 = smokeArm("precut", [row({ unit: "u", session: "a", arm: "precut", model: "sol", exposed: true }), row({ unit: "u", session: "b", arm: "precut", model: "sol", exposed: false })]);
  check("smoke rule 3: a skill arm exposed in 0 of 2 Sol sessions is descriptive, in 1 of 2 is not", sol0.rule3.sol.descriptive && !sol1.rule3.sol.descriptive);
  const cut = loadCutoffs();
  const metas = (k: number) => Array.from({ length: 16 }, (_, i) => meta("u" + i, { exposed_at: i < k ? "2026-04-20T00:00:00Z" : "2026-07-15T00:00:00Z" }));
  check("leak: 4 of 16 units leak-exposed (a quarter) leaves Sol tested, 5 of 16 reads untested (leak); Opus's June cutoff exposes none in the window; particle-1 states none", !leakReading(metas(4), "sol", cut).untested && leakReading(metas(5), "sol", cut).untested && leakReading(metas(16), "opus", cut).exposed.length === 16 && leakReading(metas(0), "opus", cut).exposed.length === 0 && !leakReading(metas(16), "particle", cut).stated);
  const act: Actuals = { spent: 900, crew: 300, authoring: 600, judges_spent: 150, remaining_other: 300, label_packet: { opus: 0.36, sol: 0.14, particle: 0.5 }, pairwise_call: { opus: 0.08, sol: 0.035 } };
  const proj = (m: number) => projection({ stage1: [rv("a", "none", 1, 0.2), rv("a", "none", 2, 0.4), rv("b", "none", 1, 0.3), rv("b", "none", 2, 0.1)], rows: [], meanPrimary: 1.5, units: 56, actuals: act, mdd: () => m });
  check("the projection's Opus MDD at 0.12 passes start rule 5, at 0.13 flags it", !proj(0.12).opus_over && proj(0.13).opus_over);
  check("the projection cuts in the frozen order until the line fits", (() => { const p = projection({ stage1: [], rows: [], meanPrimary: 1.5, units: 56, actuals: { ...act, crew: 900 }, mdd: () => 0.1 }); return p.steps.map((s) => s.cut).join("|").startsWith("none|stage 3 down to 16 units|Sol's lens cells"); })());

  const v = (ci: [number, number], p: number, spec: [number, number] | null = [0.01, 0.1], untested: string[] = []) => verdict({ ci95: ci, p, spec_ci95: spec, untested }).verdict;
  check("an interval that excludes zero but fails Holm reads not shown", v([0.02, 0.1], 0.06) === "not shown");
  check("a specificity difference in differences that excludes zero reads helps; one that includes zero reads not shown", v([0.02, 0.1], 0.01, [0.01, 0.05]) === "helps" && v([0.02, 0.1], 0.01, [-0.01, 0.05]) === "not shown");
  const holm = holmFamily({ precut: 0.01, engphase: 0.02, candidate: null });
  check("Holm with a dropped arm entered at p = 1", r4(holm.precut!) === 0.03 && r4(holm.engphase!) === 0.04 && holm.candidate === 1);
  const cutAt = (ub: number, over: Partial<ReadingInput> = {}) => readingRule(reading({ none: { verdict: "no measurable difference", ci95: [-0.03, ub] }, ...over }));
  check("CUT-CANDIDATE at an upper bound of 0.049, FIX-METHOD on power at 0.050", cutAt(0.049).cut && !cutAt(0.05).cut && cutAt(0.05).fix_method_power);
  check("trim-to-lens at a skill-minus-lens upper bound of 0.049, not at 0.050", readingRule(reading({ lens: { verdict: "no measurable difference", ci95: [-0.02, 0.049] } })).trim && !readingRule(reading({ lens: { verdict: "no measurable difference", ci95: [-0.02, 0.05] } })).trim);
  const fr = readingRule(reading({ none: { verdict: "helps", ci95: [0.3, 0.5] }, lens: { verdict: "helps", ci95: [0.15, 0.35] }, lensNone: { verdict: "helps" } }));
  check("the framing reading on none 0.20, lens 0.35 and skill 0.60 reads framing carries part", fr.framing === "carries part" && fr.keep);
  check("a skill-minus-lens upper bound of 0.049 with skill minus none helping reads framing carries it", readingRule(reading({ none: { verdict: "helps", ci95: [0.1, 0.3] }, lens: { verdict: "no measurable difference", ci95: [-0.02, 0.049] } })).framing === "carries it");
  const small = verdict({ ci95: [0.01, 0.04], p: 0.01, spec_ci95: [0.005, 0.03], untested: [] }).verdict;
  check("an interval of [0.01, 0.04] that passes Holm and specificity reads helps and never CUT-CANDIDATE", small === "helps" && !readingRule(reading({ none: { verdict: small, ci95: [0.01, 0.04] } })).cut);
  const neg = verdict({ ci95: [-0.1, -0.01], p: 0.2, spec_ci95: null, untested: [] }).verdict;
  check("a negative interval that fails Holm with its upper bound under +0.05 reads CUT-CANDIDATE when the other conditions hold, and not when exposure is short", neg === "not shown" && readingRule(reading({ none: { verdict: neg, ci95: [-0.1, -0.01] } })).cut && !readingRule(reading({ none: { verdict: neg, ci95: [-0.1, -0.01] }, exposure: 0.79 })).cut);
  check("a null at upper bound 0.049 reads CUT-CANDIDATE when the other conditions hold", cutAt(0.049).cut && !cutAt(0.049, { headroom: false }).cut && !cutAt(0.049, { judgePass: false }).cut && !cutAt(0.049, { coverage: 0.89 }).cut);
  check("a leak-untested contrast with its upper bound under +0.05 doesn't read CUT-CANDIDATE", !cutAt(0.03, { none: { verdict: verdict({ ci95: [-0.02, 0.03], p: 0.5, spec_ci95: null, untested: untestedReasons({ exposure: 0.9, coverage: [1], stockFail: false, judgePass: true, leak: true }) }).verdict, ci95: [-0.02, 0.03] } }).cut);
  check("a KEEP is flagged when the length-controlled pairwise rate is under 0.5 with its interval under 0.5, not when the pairwise read is untested (stock)", readingRule(reading({ none: { verdict: "helps", ci95: [0.1, 0.2] }, pairwise: { rate: 0.4, ci95: [0.3, 0.49], untested: false } })).keep_flag && !readingRule(reading({ none: { verdict: "helps", ci95: [0.1, 0.2] }, pairwise: { rate: 0.4, ci95: [0.3, 0.49], untested: true } })).keep_flag);

  const two = [item("a"), item("b")];
  const viaSecond = scoreWith(two, ["Unit test for tag-x", "Unit test for tag-a"], (i) => (i === "a" ? yes([1, 2]) : label()));
  check("a check credited only through the judge's second index for an item earns it", viaSecond[0]!.A === 0.5);
  const oneTwo = scoreWith(two, ["Test tag-a and tag-b", "Test tag-a"], (i) => (i === "a" ? yes([1, 2]) : yes([1])));
  const greedy = scoreWith(two, ["Test tag-a and tag-b"], (i) => (i === "a" ? yes([1]) : yes([1])));
  check("one check matching two items beside a second check matching one of them earns both; one check alone earns one", oneTwo[0]!.A === 1 && greedy[0]!.A === 0.5 && maxMatching([[0, 1], [0]]).size === 2);
  const nb = scoreWith(two, [], () => label(), { checks: null, end: "no-block" });
  const stop = scoreWith(two, [], () => label(), { checks: null, end: "no-block", arm_stop: true });
  const prov = scoreWith(two, [], () => label(), { checks: null, end: "missing" });
  const web = scoreWith(two, [], () => label(), { checks: null, end: "contaminated" });
  check("a no-block reply scores 0; an arm stop after its retry scores 0 beside a provider error left missing; a web-contaminated session is missing", nb[0]!.A === 0 && nb[0]!.status === "no-block" && stop[0]!.A === 0 && prov[0]!.status === "missing" && prov[0]!.A === null && web[0]!.status === "missing");
  check("the missing-instead-of-0 sensitivity read treats the arm stop as missing and keeps a plain no-block at 0", stop[0]!.A_sens === null && nb[0]!.A_sens === 0);
  const unl = scoreWith(two, ["Test tag-a"], (i) => (i === "a" ? yes([1]) : null));
  check("an unlabelled primary cell leaves the review unscored (missing), never 0", unl[0]!.status === "unscored" && unl[0]!.A === null);

  const revs: Review[] = [];
  for (let u = 0; u < 12; u++) {
    revs.push(rv("u" + u, "none", 1, 0.2, { specificity: 0.1 }), rv("u" + u, "precut", 1, 0.2 + 0.1 + (u % 3) * 0.02, { specificity: 0.1 + 0.1 + (u % 3) * 0.02 }));
    revs.push(rv("u" + u, "engphase", 1, 0.2 + 0.1 + (u % 3) * 0.02, { specificity: 0.1 + (u % 2 ? 0.05 : -0.05) }));
  }
  const us = new Set(revs.map((r) => r.unit));
  const c1 = contrast(revs, { model: "opus", b: "precut", a: "none", units: us });
  const c2 = contrast(revs, { model: "opus", b: "engphase", a: "none", units: us });
  check("the specificity difference in differences: one that excludes zero and one that doesn't", c1.specificity!.ci95![0] > 0 && c2.specificity!.ci95![0] <= 0 && c2.specificity!.ci95![1] >= 0 && c1.units === 12);
  const cells = (ant: number, not: number, lists = 80): CheckCell[] => [...Array.from({ length: ant }, (_, i) => cell(true, true, { list: "a" + (i % lists) })), ...Array.from({ length: not }, (_, i) => cell(false, false, { list: "n" + (i % lists) }))];
  check("a gold-cell shortfall: 39 anticipated reads short, 40 passes; 38 distinct lists reads short", judgeScore("opus", "j", cells(39, 40), { minimum: 40 }).shortfall && !judgeScore("opus", "j", cells(40, 40), { minimum: 40 }).shortfall && judgeScore("opus", "j", cells(40, 40, 19), { minimum: 40 }).shortfall);
  const solShort = judgeScore("sol", "opus on sol lists", cells(10, 40), { minimum: 40 });
  check("a failed Sol judge leaves Opus running: admission reads HEADROOM on the Opus judge alone and only Sol reads untested (judge)", !solShort.pass && adm(0.3, 0.2) === "HEADROOM" && untestedReasons({ exposure: 0.9, coverage: [1], stockFail: false, judgePass: solShort.pass, leak: false }).includes("untested (judge)"));
  const anchored = [...cells(10, 10), ...Array.from({ length: 40 }, () => cell(false, true, { anchor: true, list: "s" }))];
  const js = judgeScore("opus", "j", anchored, { minimum: 0 });
  check("the anchor weighting: 40 anchor cells beside 20 real ones carry a quarter of the weight, and a quarter or less keeps weight 1", r4(anchorWeight(40, 20) * 40 / (anchorWeight(40, 20) * 40 + 20)) === 0.25 && anchorWeight(5, 15) === 1 && js.kappa !== js.unweighted.kappa);
  check("the provider-drift stop: a Gemini reply served by another provider stops with E_ER_PROVIDER_DRIFT", await driftCase());
  const p: PacketFile = { id: "pp", prompt: "brief", items: [{ id: "i1", statement: "The importer failed on tag-q." }], lists: [{ id: "l1", checks: ["Unit test for tag-q"] }] };
  const pm: PacketMeta = { id: "pp", role: "production", stage: 2, unit: "u", model: "particle", pass: 1, judges: ["astra", "opus"], lists: { l1: { kind: "arm", unit: "u", model: "particle", pass: 1, words: 4 } }, items: { i1: { unit: "u", item: "q", kind: "B" } } };
  const panel = (gem: boolean) => labelPacket(p, pm, "medium", (async (c: Parameters<Caller>[0]) => ({ text: fakeAnswer(c.prompt, { flip: c.judge === "opus" || (c.judge === "gemini" && !gem) }), model_id: c.judge, version: "v", problem: null })) as Caller, []).then((rs) => rs.find((r) => r.judge === "panel")!.label!.anticipated);
  check("a particle-1 split settled by the third vote: Gemini's yes makes the cell anticipated, its no makes it not", (await panel(true)) && !(await panel(false)));
  const k0 = keyOf("u", [item("r", { b_source: "revert" }), item("t", { kind: "T" }), item("c", { kind: "C" }), item("f"), item("m", { mentioned: true }), item("g", { generic: true })]);
  const ord = primaryOf(k0);
  const screened = await screenKey(keyOf("u", [item("a"), item("b", { statement: "Later the project added a test for tag-gen." })]), (async (c: Parameters<Caller>[0]) => ({ text: fakeAnswer(c.prompt.replace(/Unit tests for every new function/, "Unit tests for tag-gen")), model_id: c.judge, version: "v", problem: null })) as Caller, []);
  check("the generic screen and the mentioned flag: mentioned and generic items leave the primary, B (revert before fix) then C then T; an item stock row 1 anticipates turns generic", ord.join(",") === "r,f,c,t" && screened.generic === 1 && screened.key.primary.join() === "a");
  const der = derangeUnits([{ id: "a", repo: "x", type: "mobile", language: "Swift" }, { id: "b", repo: "x", type: "mobile", language: "Swift" }, { id: "c", repo: "y", type: "server", language: "Go" }, { id: "d", repo: "z", type: "server", language: "Go" }, { id: "e", repo: "w", type: "server", language: "Rust" }], () => 0.3)!;
  check("the shuffled-key derangement: no unit keeps its own key, same repository first, then same type", [...der].every(([k, v]) => k !== v) && der.get("a") === "b" && der.get("b") === "a" && ["c", "d", "e"].every((u) => ["c", "d", "e"].includes(der.get(u)!)));
  if (o.ledger) out.push(...(await ledgerLeases(o.approvals ?? APPROVALS)));
  return out;
}

const USAGE = "gstack-evals er dryrun [--no-ledger] [--approvals <path>]";

export async function run(argv: string[], io: Io): Promise<number> {
  let approvals: string | undefined;
  let ledger = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--no-ledger") ledger = false;
    else if (argv[i] === "--approvals" && argv[i + 1] && !argv[i + 1]!.startsWith("--")) approvals = argv[++i];
    else throw new PvError("E_USAGE", "unknown argument " + JSON.stringify(argv[i]) + "; usage: " + USAGE);
  }
  const lines = await dryRun({ ledger, approvals });
  for (const l of lines) io.out((l.pass ? "PASS " : "FAIL ") + l.rule + (l.detail ? " (" + l.detail + ")" : ""));
  const failed = lines.filter((l) => !l.pass).length;
  io.out("er dryrun: " + (lines.length - failed) + " PASS, " + failed + " FAIL");
  return failed ? 1 : 0;
}
