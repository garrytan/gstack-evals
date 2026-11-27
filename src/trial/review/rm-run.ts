// gstack-evals rm-run: the review-models eval's pilot path (plan 2026-11-24-geva-590-review-models-prereg, Pilots and
// sections 3, 8 and 11, as pre-run changes 1 and 2 amend them), from a drawn and built unit set to the pilot's 55 review
// sessions with metered receipts. Nothing here calls a model.
//
//   items      records every ledger line item the path needs, each with its cap and the recorded words, quoted from the
//              Captain's approvals file and the pre-run changes; it refuses any quote it cannot find there verbatim.
//              Items with no recorded words are listed and left unrecorded. --path raises the items a later path changes.
//   pilot-plan from the draw and the build: the pilot's 11 unit ids and the cell items file (each cell's own item, its
//              lease and its per-review allowance, and the retry reserve), read against the ledger record.
//   pilot      runs review-units on that plan: rmArgs()'s five cells, the prebuilt units, the order seed, one lease per
//              cell, the retry reserve, the voice's web_search removal and the reader map.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerCli } from "../../runner/ledger/cli.ts";
import { ledgerStatus } from "../../runner/ledger/ledger.ts";
import { recordPath } from "../../runner/ledger/paths.ts";
import type { CellItems } from "./cell-rigs.ts";
import { main as reviewUnits } from "./cli.ts";
import { RM_CELLS, RM_READER_MAP, rmArgs, type RmCell } from "./rm-cells.ts";
import { armId } from "./run.ts";
import type { Draw } from "./supply/draw.ts";
import { loadUnitRepos } from "./unit-repos.ts";
import { requireLive, requireOpen } from "../../../lanes/review-models/score/opening.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** Section 3's order seed. */
export const ORDER_SEED = 1795598571;
/** The Pilots table's supply column: units build, run and parse at 5 at once. */
export const PILOT_PARALLEL = 5;
/** Section 11's per-review cap by cell (main reviewer cap plus voice cap): each session's allowance. */
/** The prereg's per-review cap per cell, which the validation items' caps are multiples of. */
export const REVIEW_CAP_USD: Readonly<Record<RmCell["id"], number>> = { OS: 10.5, OA: 19.5, FS: 27, FA: 36, N: 1 };
/** Each cell's per-session allowance: its per-review cap, except N's $3 (Captain ruling D, 2026-11-25 01:00Z), since one Opus call's worst case is about $1. Item caps do not change with it. */
export const SESSION_ALLOWANCE_USD: Readonly<Record<RmCell["id"], number>> = { ...REVIEW_CAP_USD, N: 3 };
/** The Pilots table's pilot cap by arm. */
export const PILOT_CAP_USD: Readonly<Record<RmCell["id"], number>> = { OS: 120, OA: 224, FS: 310, FA: 414, N: 11 };
/** The per-arm counted budgets the approvals file records. */
export const COUNTED_CAP_USD: Readonly<Record<RmCell["id"], number>> = { OS: 1208, OA: 2243, FS: 3105, FA: 4140, N: 115 };
/** The retry reserve's recorded caps: if Fable leaves, and on the full path. */
export const RETRY_CAP_USD = { fable_leaves: 295, full: 987 } as const;
/** Validation reviews per arm: change 2's full path (10) and its Fable-leaves and Sol-only sets (17). */
export const VALIDATION_UNITS = { full: 10, fable_leaves: 17 } as const;
export const RETRY_RUN_ID = "geva590-retry";
/** The pilot line's envelope (Captain, 2026-11-25 01:00Z): the five pilot items' leases admitted together under $1,034. */
export const PILOT_PROGRAM = "geva590-pilot";
export const PILOT_ENVELOPE_USD = 1034;
/** Each skill line is one arm's pilot item, so its ceiling is the largest pilot item cap and never binds tighter than the item. */
export const PILOT_SKILL_CAP_USD = Math.max(...Object.values(PILOT_CAP_USD));
export const PILOT_REVIEWS = 11;
/** The install and test every pilot unit runs (Captain ruling E): no-ops, so the unit image check is the history and clean-tree check. */
export const NO_OP = "true";

export const APPROVALS_FILE = "approvals/2026-11-24-review-models-eval.md";
const CHANGE_1 = "wiki/plans/2026-11-24-geva-590-review-models-pre-run-change-1/README.md";
const CHANGE_2 = "wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-2.md";
const PREREG = "wiki/plans/2026-11-24-geva-590-review-models-prereg/README.md";
const CHANGE_9 = "wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-9.md";

/** A recorded quote and the document it must appear in verbatim: the approvals file (in the Captain drive) or a repo file. */
export interface RmQuote {
  words: string;
  by: string;
  source: string;
  in: "approvals" | string;
}

const garry: RmQuote = { words: "do it", by: "Garry Tan", source: APPROVALS_FILE + " (gstack-evals Captain drive): Garry, 2026-11-24, in the gstack-evals Captain thread, answering A1 (the staged design) and C1 ($25 per extra caught bug)", in: "approvals" };
const captain = (words: string, section: string): RmQuote => ({ words, by: "gstack-evals Captain (GEVA-2)", source: APPROVALS_FILE + " (gstack-evals Captain drive), " + section, in: "approvals" });
const doc = (words: string, file: string, by: string): RmQuote => ({ words, by, source: file, in: file });
const CAPS = "2026-11-24, caps (GEVA-590; prereg #450 at 149b608, dated pre-run change 1)";
const RULINGS = "2026-11-24 23:55Z, Captain rulings for dated change 2";
const ITEMS_0100 = "2026-11-25 01:00Z, Captain approval of four ledger items and dated change 3 rulings";

export const QUOTES = {
  garry,
  pilot: captain("Pilot: central $557, cap $1,034 (11 units, every arm).", CAPS),
  pilotTable: doc("Budget below is each arm's counted cap; the pilot cap is at most a tenth of it.", PREREG, "GEVA-590 preregistration, approved by the gstack-evals Captain"),
  pilotUnchanged: doc("Each arm's pilot cap is unchanged.", CHANGE_1, "GEVA-590 pre-run change 1, ruled by the gstack-evals Captain (GSTA-2)"),
  validation: captain("Validation batch: if Fable leaves, central $276, cap $472; on the full path, central $459, cap $853.", CAPS),
  validationFull: captain("full path: +$51 central, +$94 cap, for $947 cap;", RULINGS + ", B"),
  validationFable: captain("if Fable leaves: +$36 central, +$62 cap, for $527 cap;", RULINGS + ", B"),
  validationSol: captain("Sol-only set: $655 cap.", RULINGS + ", B"),
  validationPerArm: doc("Its validation-batch cap is 9 or 15 times its per-review cap.", CHANGE_1, "GEVA-590 pre-run change 1, ruled by the gstack-evals Captain (GSTA-2)"),
  validationGrows: doc("The validation batch grows by one unit per arm, so the judge check reaches 100 bug-unit labels.", CHANGE_2, "GEVA-590 pre-run change 2, ruled by the gstack-evals Captain (GEVA-2)"),
  counted: captain("Per-arm counted budgets: OS $1,208, OA $2,243, FS $3,105, FA $4,140, N $115.", CAPS),
  fullGated: captain("The full path ($8,067 central, $14,878 cap) is still gated on Garry.", CAPS),
  retry: captain("C1: the caps stay as recorded. The retry reserve after the move is $987 cap on the full path (9.1% of counted spend) and $295 if Fable leaves (8.3%).", RULINGS + ", 2026-11-25 00:10Z"),
  items: captain("Approved by the gstack-evals Captain, 2026-11-25, inside the recorded all-in caps.", ITEMS_0100),
  labels: doc("The labels item drops from $650 to $80.", CHANGE_9, "gstack-evals Captain (GEVA-2)"),
  envelope: captain("A pilot-line envelope stop at $1,034 is required on top of the per-arm item caps.", ITEMS_0100),
  retryRule: captain("If the reserve runs out during the run, reruns stop and come to me, never touching an arm's counted budget, and any unit left un-rerun is reported as an infrastructure miss.", RULINGS + ", 2026-11-25 00:10Z"),
} as const;

export type RmPath = "fable-leaves" | "sol-only" | "full";

/** One line item: its cap now, raises by path, and its quotes. */
export interface RmItem {
  item: string;
  what: string;
  cap_usd: number;
  quotes: RmQuote[];
  raises?: Partial<Record<RmPath, { cap_usd: number; quotes: RmQuote[] }>>;
  /** The envelope program the item joins at init, with its one skill line (the arm). */
  program?: { name: string; skill: string };
  /** Leased only after the Captain's go (the validation batch and the counted run). */
  after_go: boolean;
}

const lower = (id: string) => id.toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every line item the pilot path needs, then the validation batch and the counted run, created now and leased only after
 * the Captain's go. Each starts at the lowest cap any recorded path gives it and is raised when a path is taken.
 */
export function rmItems(): RmItem[] {
  const items: RmItem[] = [
    { item: "geva590-visibility", what: "Supply: B visibility reads (section 11)", cap_usd: 60, quotes: [QUOTES.items], after_go: false },
    ...RM_CELLS.map((c): RmItem => ({ item: "geva590-pilot-" + lower(c.id), what: "pilot, arm " + c.id + " (11 reviews, $" + SESSION_ALLOWANCE_USD[c.id] + " per session)", cap_usd: PILOT_CAP_USD[c.id], quotes: [garry, QUOTES.pilot, QUOTES.pilotTable, QUOTES.pilotUnchanged], program: { name: PILOT_PROGRAM, skill: armId(c.arm, c.model) }, after_go: false })),
    { item: "geva590-retry", what: "retry reserve (section 8's one rerun; pilot, validation and counted reruns)", cap_usd: RETRY_CAP_USD.fable_leaves, quotes: [garry, QUOTES.retry, QUOTES.retryRule], raises: { full: { cap_usd: RETRY_CAP_USD.full, quotes: [garry, QUOTES.retry, QUOTES.fullGated] } }, after_go: false },
    { item: "geva590-probes", what: "Codex model probes (section 11)", cap_usd: 40, quotes: [QUOTES.items], after_go: false },
    { item: "geva590-judge", what: "judge: Carbon on all reviews (section 11; change 1 adds the validation batch's)", cap_usd: 70, quotes: [QUOTES.items], raises: { full: { cap_usd: 100, quotes: [QUOTES.items, QUOTES.fullGated] } }, after_go: false },
    { item: "geva590-labels", what: "the judge check's labels by Grok 4.7, with Kimi K3.1 Pro as its fallback, and the contamination second read (section 11; changes 3 and 9)", cap_usd: 80, quotes: [QUOTES.items, QUOTES.labels], after_go: false },
    ...RM_CELLS.map((c): RmItem => {
      const full = round2(VALIDATION_UNITS.full * REVIEW_CAP_USD[c.id]);
      const more = round2(VALIDATION_UNITS.fable_leaves * REVIEW_CAP_USD[c.id]);
      const raises: RmItem["raises"] = {};
      if (c.id === "OS" || c.id === "OA" || c.id === "N") raises["fable-leaves"] = { cap_usd: more, quotes: [garry, QUOTES.validation, QUOTES.validationFable, QUOTES.validationGrows] };
      if (c.id === "OS" || c.id === "FS" || c.id === "N") raises["sol-only"] = { cap_usd: more, quotes: [garry, QUOTES.validationSol, QUOTES.validationGrows, QUOTES.fullGated] };
      return { item: "geva590-validation-" + lower(c.id), what: "validation batch, arm " + c.id + " (" + VALIDATION_UNITS.full + " reviews on the full path, " + VALIDATION_UNITS.fable_leaves + " on a three-arm set)", cap_usd: full, quotes: [garry, QUOTES.validation, QUOTES.validationFull, QUOTES.validationPerArm, QUOTES.validationGrows], raises, after_go: true };
    }),
    ...RM_CELLS.map((c): RmItem => ({ item: "geva590-counted-" + lower(c.id), what: "counted run, arm " + c.id, cap_usd: COUNTED_CAP_USD[c.id], quotes: c.model === "claude-fable-5-2" ? [garry, QUOTES.counted, QUOTES.fullGated] : [garry, QUOTES.counted], after_go: true })),
  ];
  return items;
}

/** Quotes that a document does not hold verbatim; docs maps "approvals" and each repo path to its text. */
export function missingQuotes(items: readonly RmItem[], docs: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const all = items.flatMap((i) => [...i.quotes, ...Object.values(i.raises ?? {}).flatMap((r) => r!.quotes)]);
  for (const q of new Set(all)) {
    const text = docs.get(q.in);
    const flat = (s: string) => s.replace(/\s+/g, " ");
    if (text === undefined) out.push(JSON.stringify(q.words) + ": " + q.in + " was not read");
    else if (!flat(text).includes(flat(q.words))) out.push(JSON.stringify(q.words) + " is not in " + q.in);
  }
  return out;
}

const quoteArgs = (quotes: readonly RmQuote[]) => quotes.flatMap((q) => ["--words", q.words, "--source", q.source, "--by", q.by]);

const VALUED = ["--approvals", "--path", "--ledger", "--ledger-record", "--branch", "--draw", "--unit-repos", "--out", "--plan", "--upstream", "--date"];
const BOOLS = ["--dry-run"];

function parse(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (BOOLS.includes(k)) m.set(k, "");
    else if (VALUED.includes(k) && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) m.set(k, argv[++i]!);
    else throw new Error("E_USAGE rm-run: unknown or empty option " + JSON.stringify(k) + "; gstack-evals rm-run --help lists them");
  }
  return m;
}

const HELP = [
  "gstack-evals rm-run <subcommand>: the review-models eval's pilot path (GEVA-590). Nothing here calls a model.",
  "",
  "  items --approvals <file> --ledger-record <dir> [--path fable-leaves|sol-only|full] [--branch <name>] [--dry-run]",
  "      records the pilot line's envelope (" + PILOT_PROGRAM + ", $" + PILOT_ENVELOPE_USD + ") and each line item with its cap and recorded words",
  "      (admission required; the five pilot items join the envelope, one arm per skill line), after checking every quote",
  "      is in the approvals file or the pre-run changes verbatim. --path raises the items that path changes (the",
  "      validation batch, the retry reserve, the judge). The record must sit on the run host's local disk: the ledger",
  "      refuses a FUSE mount such as the Capy drive.",
  "  pilot-plan --draw <draw.json> --unit-repos <build dir> --ledger-record <dir> --out <dir>",
  "      writes <out>/pilot-units.txt (the 5 P, 5 B and the decoy, by id) and <out>/cell-items.json (each arm's pilot item,",
  "      its lease of min(what is left, 11 sessions at its allowance) and its per-session allowance, and the retry",
  "      reserve) from the ledger record.",
  "  pilot --plan <dir> --unit-repos <build dir> --ledger-record <dir> --out <dir> [--upstream <url>] [--ledger <path>] [--date YYYY-MM-DD] [--dry-run]",
  "      runs review-units on the plan: every pilot unit once in all five cells. Install and test are no-ops for every",
  "      unit (Captain ruling E); a unit that fails the history and clean-tree check is refused for every arm and",
  "      listed in <out>/refused.json.",
  "  e2e --out <new dir>",
  "      the pilot path end to end, keyless, with Docker: two toy units, every cell, a temporary ledger, the real proxy and",
  "      a stub upstream on this host (src/trial/review/rm-e2e.ts). Prints a PASS or FAIL line per check.",
].join("\n");

async function items(f: Map<string, string>, io: Io, env: Env): Promise<number> {
  const approvals = f.get("--approvals") ?? null;
  if (!approvals) throw new Error("E_USAGE rm-run items: pass --approvals <file>, the Captain's approvals/2026-11-24-review-models-eval.md");
  const path = (f.get("--path") ?? null) as RmPath | null;
  if (path !== null && !["fable-leaves", "sol-only", "full"].includes(path)) throw new Error("E_USAGE rm-run items: --path takes fable-leaves, sol-only or full");
  const all = rmItems();
  const docs = new Map<string, string>([["approvals", readFileSync(approvals, "utf8")]]);
  for (const file of new Set(all.flatMap((i) => [...i.quotes, ...Object.values(i.raises ?? {}).flatMap((r) => r!.quotes)]).map((q) => q.in).filter((x) => x !== "approvals"))) docs.set(file, readFileSync(join(REPO, file), "utf8"));
  const missing = missingQuotes(all, docs);
  if (missing.length) {
    io.err("E_RM_RUN rm-run items: " + missing.length + " quote" + (missing.length === 1 ? " is" : "s are") + " not in the record verbatim, so nothing was recorded:\n  " + missing.join("\n  "));
    return 2;
  }
  const record = recordPath(f.get("--ledger-record"), env).path;
  const status = new Map(existsSync(record) ? ledgerStatus(record).map((s) => [s.item, s]) : []);
  const ledger = (argv: string[]) => ledgerCli([...argv, "--ledger-record", record, ...(f.has("--branch") ? ["--branch", f.get("--branch")!] : [])], io, env);
  let failed = 0;
  const envelope = ["envelope", "--program", PILOT_PROGRAM, "--cap", String(PILOT_ENVELOPE_USD), "--skill-cap", String(PILOT_SKILL_CAP_USD), "--skills", RM_CELLS.map((c) => armId(c.arm, c.model)).join(","), "--credit-rate", "1", ...quoteArgs([QUOTES.envelope])];
  if (f.has("--dry-run")) io.out("WOULD gstack-evals ledger " + envelope.map((a) => (/^[\w./$,-]+$/.test(a) ? a : JSON.stringify(a))).join(" "));
  else if ((await ledger(envelope)) !== 0) return 2;
  else io.out("ENVELOPE " + PILOT_PROGRAM + " $" + PILOT_ENVELOPE_USD + " (each arm's line $" + PILOT_SKILL_CAP_USD + ")");
  for (const it of all) {
    const raise = path ? it.raises?.[path] : undefined;
    const steps: { action: "init" | "raise"; cap: number; quotes: RmQuote[] }[] = [];
    const have = status.get(it.item)?.cap_micros ?? null;
    if (have === null) steps.push({ action: "init", cap: it.cap_usd, quotes: it.quotes });
    if (raise && (have ?? Math.round(it.cap_usd * 1e6)) < Math.round(raise.cap_usd * 1e6)) steps.push({ action: "raise", cap: raise.cap_usd, quotes: raise.quotes });
    if (!steps.length) io.out("HELD " + it.item + " $" + ((have ?? 0) / 1e6).toFixed(2) + (it.after_go ? " (leased only after the Captain's go)" : ""));
    for (const s of steps) {
      const argv = [s.action, "--cap", String(s.cap), "--item", it.item, ...(s.action === "init" ? ["--admission", "required", ...(it.program ? ["--program", it.program.name, "--skills", it.program.skill] : [])] : []), ...quoteArgs(s.quotes)];
      if (f.has("--dry-run")) {
        io.out("WOULD gstack-evals ledger " + argv.map((a) => (/^[\w./$,-]+$/.test(a) ? a : JSON.stringify(a))).join(" "));
        continue;
      }
      const code = await ledger(argv);
      if (code !== 0) failed++;
      else io.out((s.action === "init" ? "INIT " : "RAISE ") + it.item + " $" + s.cap + (it.after_go ? " (leased only after the Captain's go)" : ""));
    }
  }
  return failed ? 2 : 0;
}

/** The pilot's unit ids from a draw, sorted, so the seeded order depends only on the set and the seed. */
export function pilotUnits(d: Draw): string[] {
  if (d?.schema !== "rm-draw.v1") throw new Error("E_RM_RUN the draw is not an rm-draw.v1 file");
  const ids = [...d.pilot.p, ...d.pilot.b, d.pilot.decoy].map((u) => u.id);
  if (d.pilot.p.length !== 5 || d.pilot.b.length !== 5 || new Set(ids).size !== 11) throw new Error("E_RM_RUN the draw's pilot holds " + d.pilot.p.length + " P, " + d.pilot.b.length + " B and a decoy; the plan's pilot is 5 P, 5 B and 1 decoy, all distinct");
  return ids.toSorted();
}

/** The cell items for the pilot: each cell's pilot item leased at its worst case, min(what it has left, 11 sessions at its
 *  allowance), which on fresh items is $1,034 in all, the envelope exactly; the retry reserve at what it has left. */
export function pilotCellItems(left: (item: string) => number | null): CellItems {
  const cells: CellItems["cells"] = {};
  const problems: string[] = [];
  for (const c of RM_CELLS) {
    const item = "geva590-pilot-" + lower(c.id);
    const have = left(item);
    if (have === null) problems.push(item + " has no approved cap in the record; run gstack-evals rm-run items first");
    else if (have < SESSION_ALLOWANCE_USD[c.id]) problems.push(item + " has $" + have.toFixed(2) + " left, under one session's allowance of $" + SESSION_ALLOWANCE_USD[c.id]);
    else cells[armId(c.arm, c.model)] = { item, cap_usd: round2(Math.min(have, PILOT_REVIEWS * SESSION_ALLOWANCE_USD[c.id])), allowance_usd: SESSION_ALLOWANCE_USD[c.id] };
  }
  const retry = left("geva590-retry");
  if (retry === null) problems.push("geva590-retry has no approved cap in the record; run gstack-evals rm-run items first");
  if (problems.length) throw new Error("E_RM_RUN " + problems.join("\n  "));
  return { schema: "rm-cell-items.v1", cells, retry: retry! > 0 ? { item: "geva590-retry", run_id: RETRY_RUN_ID, cap_usd: retry! } : null };
}

function pilotPlan(f: Map<string, string>, io: Io, env: Env): number {
  const need = (k: string) => f.get(k) ?? (() => { throw new Error("E_USAGE rm-run pilot-plan: pass " + k); })();
  need("--ledger-record");
  const ids = pilotUnits(JSON.parse(readFileSync(need("--draw"), "utf8")));
  const built = loadUnitRepos(need("--unit-repos"), ids);
  const record = recordPath(f.get("--ledger-record"), env).path;
  const status = new Map(existsSync(record) ? ledgerStatus(record).map((s) => [s.item, s]) : []);
  const items = pilotCellItems((item) => (status.get(item)?.cap_micros ? status.get(item)!.left_micros / 1e6 : null));
  const out = need("--out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "pilot-units.txt"), ids.join("\n") + "\n");
  writeFileSync(join(out, "cell-items.json"), JSON.stringify(items, null, 2) + "\n");
  io.out("pilot plan: " + ids.length + " units from " + need("--unit-repos") + " (units.json sha256 " + built.sha256 + "); cell items in " + join(out, "cell-items.json"));
  for (const [id, c] of Object.entries(items.cells)) io.out("  " + id + ": " + c.item + ", lease $" + c.cap_usd.toFixed(2) + ", allowance $" + c.allowance_usd);
  io.out("  retry: " + (items.retry ? items.retry.item + " under run " + items.retry.run_id + ", lease $" + items.retry.cap_usd.toFixed(2) : "none left; nothing reruns"));
  return 0;
}

/** The review-units argv the pilot runs: install and test are no-ops for every repo (Captain ruling E, 2026-11-25 01:00Z). */
export function pilotArgv(o: { plan: string; unitRepos: string; out: string; record: string; upstream?: string | null; ledger?: string | null; date?: string | null; dryRun?: boolean }): string[] {
  const ids = readFileSync(join(o.plan, "pilot-units.txt"), "utf8").split("\n").filter(Boolean);
  const repos = [...new Set(ids.map((id) => id.split("#")[0]!))].toSorted();
  return [
    ...rmArgs(),
    "--unit-repos", o.unitRepos, "--units", ...ids, "--install", ...repos.map((r) => r + "=" + NO_OP), "--test", ...repos.map((r) => r + "=" + NO_OP),
    "--order-seed", String(ORDER_SEED), "--cell-items", join(o.plan, "cell-items.json"),
    "--remove-voice-web-search", "--reader-map", join(REPO, "src", "trial", "review", "reader-maps", RM_READER_MAP),
    "--parallel", String(PILOT_PARALLEL), "--out", o.out, "--record", o.record,
    ...(o.upstream ? ["--upstream", o.upstream] : []), ...(o.ledger ? ["--ledger", o.ledger] : []), ...(o.date ? ["--date", o.date] : []),
    ...(o.dryRun ? ["--dry-run"] : []),
  ];
}

export async function main(argv: string[], io: Io = { out: console.log, err: console.error }, env: Env = process.env): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(HELP);
    return sub ? 0 : 2;
  }
  try {
    if (sub === "pilot-plan" || sub === "e2e" || (sub === "pilot" && !rest.includes("--dry-run"))) requireLive("rm-run " + sub);
    const f = parse(rest);
    if (sub === "items") return await items(f, io, env);
    if (sub === "pilot-plan") return pilotPlan(f, io, env);
    if (sub === "e2e") {
      if (!f.has("--out")) throw new Error("E_USAGE rm-run e2e: pass --out <new dir>, outside /tmp and the repository");
      const { rmE2e } = await import("./rm-e2e.ts");
      const r = await rmE2e({ out: f.get("--out")!, log: io.out });
      if (r.skipped) {
        io.out("SKIP rm-run e2e: " + r.skipped);
        return 0;
      }
      const failed = r.checks.filter((c) => !c.ok).length;
      io.out(failed ? "rm-run e2e: " + failed + " of " + r.checks.length + " checks failed" : "rm-run e2e: all " + r.checks.length + " checks passed");
      return failed ? 1 : 0;
    }
    if (sub === "pilot") {
      for (const k of ["--plan", "--unit-repos", "--ledger-record", "--out"]) if (!f.has(k)) throw new Error("E_USAGE rm-run pilot: pass " + k);
      if (!f.has("--dry-run")) requireOpen("pilot", "rm-run pilot");
      const args = pilotArgv({ plan: f.get("--plan")!, unitRepos: f.get("--unit-repos")!, out: f.get("--out")!, record: f.get("--ledger-record")!, upstream: f.get("--upstream") ?? null, ledger: f.get("--ledger") ?? null, date: f.get("--date") ?? null, dryRun: f.has("--dry-run") });
      io.out("review-units " + args.join(" "));
      return await reviewUnits(args, io, env);
    }
    throw new Error("E_USAGE rm-run: unknown subcommand " + JSON.stringify(sub) + "; gstack-evals rm-run --help lists them");
  } catch (e) {
    const m = (e as Error).message;
    io.err(/^E_[A-Z_]+ /.test(m) ? m : "E_RM_RUN rm-run: " + m);
    return 2;
  }
}
