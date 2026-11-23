// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals cso: the /cso real-advisory eval's commands (plan sections 3, 12 and 15.7). units builds the unit list
// through the drops and gates (section 3) after verifying and scanning every arm's installed home; draw takes positions;
// rerun runs one arm on a unit list under a spend cap, and its --dry-run opens and settles one ledger lease per frozen item
// on a temporary ledger and runs nothing; preflight is the no-model check for the VM (a unit build on the first
// candidates, every arm's containment and the read audit of each home). Every refusal prints its reason code first.
import { JUDGE_COMMANDS } from "./cli-judge.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode } from "../../../src/errors/codes.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { machineId, openLease, recordApproval, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { MICROS_PER_USD } from "../../../src/runner/ledger/money.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { HOME_CHECKED } from "../statemachines/image.ts";
import { everyCellDrops, verifyArm, type CsoArmRecord } from "./arms.ts";
import { CsoError, csoFail, loadCsoPrereg, type CsoPrereg } from "./prereg.ts";
import { csoRunner } from "./rerunner.ts";
import { armRuns, csoLimits } from "./sessions.ts";
import type { CsoArm, CsoModel, UnitRecord } from "./types.ts";
import { csoCandidates, cveIds, readAdvisory, repoAdvisoriesFromDb, unitAffected, type FetchText } from "./units/advisory.ts";
import { assertSupply, buildUnits, type UnitInput } from "./units/build.ts";
import { draw, drawPlan, stage2Order, type Raise } from "./units/draw.ts";

export type Command = (argv: string[]) => Promise<number>;
export const ARMS: readonly CsoArm[] = ["none", "cso", "untold"];
export const MODELS: readonly CsoModel[] = ["opus", "particle", "sol"];
/** Process exit codes by reason code; every other refusal exits 2. */
export const EXIT: Record<string, number> = { E_CSO_RERUN_PRECONDITION: 3, E_CSO_RERUN_UNWIRED: 3, E_CSO_SUPPLY: 3, E_CSO_CAP_STOP: 10 };

/** Flags as a reader: one value per flag (repeatable ones collected), --help printing help. */
export function flags(argv: string[], one: readonly string[], bools: readonly string[], help: string, many: readonly string[] = []) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(help);
    return null;
  }
  const v = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (bools.includes(k)) v.set(k, ["1"]);
    else if (one.includes(k) || many.includes(k)) {
      const x = argv[++i];
      if (x === undefined || x.startsWith("--")) csoFail("E_USAGE", k + " needs a value\n" + help);
      if (one.includes(k) && v.has(k)) csoFail("E_USAGE", k + " given twice");
      v.set(k, [...(v.get(k) ?? []), x!]);
    } else csoFail("E_USAGE", "unknown option " + JSON.stringify(k) + "\n" + help);
  }
  return { has: (k: string) => v.has(k), one: (k: string) => v.get(k)?.[0], all: (k: string) => v.get(k) ?? [], need: (k: string) => v.get(k)?.[0] ?? csoFail("E_USAGE", "missing " + k + "\n" + help) };
}

/** Unit ids from a units file: a list of ids or records, a draw file, or a unit build file. */
export function readUnitIds(path: string): string[] {
  if (!existsSync(path)) csoFail("E_CSO_RERUN_PRECONDITION", "--units " + path + " does not exist");
  let j: unknown;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return csoFail("E_CSO_RERUN_PRECONDITION", "--units " + path + " is not readable JSON: " + (e as Error).message);
  }
  const list = (Array.isArray(j) ? j : (j as { units?: unknown[] }).units) ?? [];
  const ids = list.map((u) => (typeof u === "string" ? u : (u as { unit?: unknown })?.unit)).filter((u): u is string => typeof u === "string");
  if (!ids.length || ids.length !== list.length) csoFail("E_CSO_RERUN_PRECONDITION", "--units " + path + " holds no list of unit ids or records");
  return ids;
}

export interface Check { name: string; ok: boolean; detail: string }

/** One lease opened and settled per frozen item on a temporary ledger, at prereg.json's caps. */
export function ledgerDryRun(p: CsoPrereg, dir = mkdtempSync(join(tmpdir(), "cso-ledger-dryrun-"))): { dir: string; checks: Check[] } {
  mkdirSync(dir, { recursive: true });
  const items = Object.entries(p.items);
  const total = items.reduce((n, [, i]) => n + i.cap, 0);
  const quote = { words: "dry-run fixture words on a temporary ledger, not an approval", by: "cso-ledger-dryrun", source: "lanes/outcome-skills/cso/cli.ts" };
  const record = join(dir, "record");
  recordProgram(record, { program: "cso", cap_micros: total * MICROS_PER_USD, skill_cap_micros: total * MICROS_PER_USD, skills: ["cso"], credit_rate_micros: MICROS_PER_USD, quotes: [quote] });
  const local = LocalLedger.open(join(dir, "ledger.sqlite"));
  const machine = machineId();
  const checks: Check[] = [];
  for (const [item, def] of items) {
    recordApproval(record, { action: "init", item, cap_micros: def.cap * MICROS_PER_USD, quotes: [quote], admission: "required", program: "cso", skills: ["cso"] });
    settleLease(record, local, openLease(record, local, { item, run_id: "cso-dryrun", machine_id: machine, requireAdmission: () => null }).lease_id);
    const it = readItem(record, item);
    checks.push({ name: "ledger lease " + item, ok: it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null && it.cap_micros === def.cap * MICROS_PER_USD, detail: "cap $" + def.cap + ", leases " + it.leases.length + ", spent " + it.leases[0]?.close?.spent_micros + " micros" });
  }
  return { dir, checks };
}

const RERUN_HELP = "Usage: gstack-evals cso rerun --arm <none|cso|untold> --model <opus|particle|sol> --units <file> --spend-cap <usd> [--allowance <usd>] [--dry-run]\nRuns one arm on every unit in the file under the spend cap. --allowance is the session allowance: prereg.json's for the\nmodel by default, or exactly twice it after stage 1's doubling rule (section 4). --dry-run checks the arm, model and units,\nprints the most the run could spend at the session allowance, opens and settles one ledger lease per frozen item on a\ntemporary ledger, and runs nothing. Exits: 0 done, 2 usage, 3 refused precondition, 10 cap stop.";

/** The session runner rerun drives (rerunner.ts csoRunner); preflight refuses before the first session. */
export interface CsoRunner {
  preflight?(o: { arm: CsoArm; model: CsoModel }): void;
  run(o: { arm: CsoArm; model: CsoModel; unit: string; allowance_usd: number; cap_left_usd: number }): Promise<{ cost_usd: number }>;
}

export async function rerun(argv: string[], runner: CsoRunner | null = null): Promise<number> {
  const f = flags(argv, ["--arm", "--model", "--units", "--spend-cap", "--allowance"], ["--dry-run"], RERUN_HELP);
  if (!f) return 0;
  const arm = f.need("--arm") as CsoArm, model = f.need("--model") as CsoModel;
  if (!ARMS.includes(arm)) csoFail("E_USAGE", "--arm " + JSON.stringify(arm) + " is not one of " + ARMS.join(", "));
  if (!MODELS.includes(model)) csoFail("E_USAGE", "--model " + JSON.stringify(model) + " is not one of " + MODELS.join(", "));
  const cap = Number(f.need("--spend-cap"));
  if (!Number.isFinite(cap) || cap <= 0) csoFail("E_USAGE", "--spend-cap must be a positive number of dollars");
  const p = loadCsoPrereg();
  if (!(["stage0", "stage1", "stage2", "rerun-pilot", "rerun"] as const).some((s) => armRuns(arm, model, s, p))) csoFail("E_CSO_RERUN_PRECONDITION", "arm " + arm + " does not run on " + model + " in any stage");
  const ids = readUnitIds(f.need("--units"));
  const given = f.has("--allowance") ? Number(f.one("--allowance")) : undefined;
  if (given !== undefined && !(Number.isFinite(given) && given > 0)) csoFail("E_USAGE", "--allowance must be a positive number of dollars");
  const allowance = csoLimits(model, p, given).allowance_usd;
  if (f.has("--dry-run")) {
    console.log("rerun dry run: arm " + arm + " on " + model + ", " + ids.length + " units; at most $" + (ids.length * allowance).toFixed(2) + " if every session spent its $" + allowance + " allowance, against a spend cap of $" + cap.toFixed(2));
    if (ids.length * allowance > cap) console.log("a real run stops before the session whose allowance would pass the cap (exit 10)");
    const d = ledgerDryRun(p);
    for (const c of d.checks) console.log((c.ok ? "PASS " : "FAIL ") + c.name + ": " + c.detail);
    console.log("temporary ledger " + d.dir + "; nothing ran");
    return d.checks.every((c) => c.ok) ? 0 : 1;
  }
  if (!runner) return csoFail("E_CSO_RERUN_UNWIRED", "no session runner is wired into gstack-evals cso rerun yet; --dry-run checks the plumbing");
  runner.preflight?.({ arm, model });
  let spent = 0;
  for (const unit of ids) {
    if (spent + allowance > cap) csoFail("E_CSO_CAP_STOP", "spent $" + spent.toFixed(2) + " of $" + cap.toFixed(2) + "; the next session (" + unit + ") could spend its $" + allowance + " allowance");
    spent += (await runner.run({ arm, model, unit, allowance_usd: allowance, cap_left_usd: cap - spent })).cost_usd;
  }
  console.log("rerun done: " + ids.length + " sessions, $" + spent.toFixed(2) + " of $" + cap.toFixed(2));
  return 0;
}

/** The read audit of one installed home (section 4): the clean room holds no gstack path and no Capy drive path; a
 *  gstack home holds no Capy drive path. Returns the paths that break it. */
export function homeAudit(arm: CsoArm, home: string): string[] {
  const bad: string[] = [];
  for (const rel of HOME_CHECKED) {
    if (!existsSync(join(home, rel))) continue;
    if (rel === ".capy" || arm === "none") bad.push(rel);
  }
  return bad;
}

const homesOf = (list: string[]): Partial<Record<CsoArm, string>> => {
  const out: Partial<Record<CsoArm, string>> = {};
  for (const x of list) {
    const [a, dir] = [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)];
    if (!ARMS.includes(a as CsoArm) || !dir) csoFail("E_USAGE", "--home takes <arm>=<dir> with an arm of " + ARMS.join(", "));
    out[a as CsoArm] = dir;
  }
  if (!out.none || !out.cso) csoFail("E_USAGE", "--home none=<dir> and --home cso=<dir> are both needed (untold shares cso's home)");
  return out;
};

/** Units, arms and drops, shared by units and preflight. */
async function buildFromFlags(p: CsoPrereg, o: { work: string; homes: Partial<Record<CsoArm, string>>; need: number; db?: string; get?: FetchText }) {
  const cands = csoCandidates(p);
  const inputs: UnitInput[] = [];
  for (const c of cands) inputs.push({ c, advisory: await readAdvisory(p, c.row, o.work, o.get) });
  const units = { ids: inputs.map((i) => ({ unit: i.c.unit, ghsa: i.c.row.ghsa, cves: cveIds(i.advisory), fix_commit: i.c.row.fix.commit })), affected: inputs.map((i) => unitAffected(i.c.unit, i.advisory)) };
  const arms: CsoArmRecord[] = [];
  mkdirSync(join(o.work, "arms"), { recursive: true });
  for (const [arm, dir] of Object.entries(o.homes) as [CsoArm, string][]) {
    const bad = homeAudit(arm, dir);
    if (bad.length) csoFail("E_CSO_ARM", arm + "'s home fails the read audit: " + bad.join(", "));
    const rec = verifyArm(arm, dir, p, units);
    writeFileSync(join(o.work, "arms", arm + ".json"), JSON.stringify(rec, null, 1) + "\n");
    arms.push(rec);
  }
  const drops = everyCellDrops(arms);
  const res = buildUnits(inputs, { p, work: o.work, need: o.need, installDrops: drops, ...(o.db ? { repoAdvisories: repoAdvisoriesFromDb(o.db, [...new Set(cands.map((c) => c.row.repo))]) } : {}) });
  return { res, arms, drops };
}

const UNITS_HELP = "Usage: gstack-evals cso units --work <dir> --home none=<dir> --home cso=<dir> [--home untold=<dir>] [--db <advisory-database checkout>] [--need <n>]\nVerifies and scans every arm's installed home, then builds units through section 3's drops and gates until --need usable\nunits (default the plan's supply, 134). Without --need, a list that runs out refuses with E_CSO_SUPPLY and the count.";
async function units(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--need", "--db"], [], UNITS_HELP, ["--home"]);
  if (!f) return 0;
  const p = loadCsoPrereg();
  const need = f.has("--need") ? Number(f.one("--need")) : drawPlan(p).supply;
  if (!Number.isInteger(need) || need < 1) csoFail("E_USAGE", "--need must be a positive whole number");
  const { res, drops } = await buildFromFlags(p, { work: f.need("--work"), homes: homesOf(f.all("--home")), need, db: f.one("--db") });
  console.log("units: " + res.filled + " usable of " + need + " needed; " + res.gates.filter((g) => !g.usable).length + " dropped; every-cell drops " + drops.id.length + " by id, " + drops.dep.length + " by dependency");
  if (!f.has("--need")) assertSupply(res);
  return 0;
}

const DRAW_HELP = "Usage: gstack-evals cso draw --work <dir> --n2 <n> [--raise floor|ceiling]\nReads work/units/*.json and writes work/draw-<n2>.json by section 3's positions, with stage 2's session order seeded\nby order_seed (section 12).";
async function drawCmd(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--n2", "--raise"], [], DRAW_HELP);
  if (!f) return 0;
  const work = f.need("--work");
  const dir = join(work, "units");
  if (!existsSync(dir)) csoFail("E_CSO_DRAW", dir + " does not exist; run cso units first");
  const recs = readdirSync(dir).filter((x) => x.endsWith(".json")).map((x) => JSON.parse(readFileSync(join(dir, x), "utf8")) as UnitRecord);
  const p = loadCsoPrereg();
  const d = draw(drawPlan(p), recs, Number(f.need("--n2")), (f.one("--raise") as Raise | undefined) ?? null);
  const out = join(work, "draw-" + d.n2 + (d.raise ? "-" + d.raise : "") + ".json");
  writeFileSync(out, JSON.stringify({ ...d, order: stage2Order(d, p.order_seed) }, null, 1) + "\n", { flag: "wx" });
  console.log("draw: " + d.units.length + " positions written to " + out);
  return 0;
}

const PREFLIGHT_HELP = "Usage: gstack-evals cso preflight --work <dir> --home none=<dir> --home cso=<dir> [--home untold=<dir>] [--need <n>]\nThe no-model VM preflight: every arm's home verified against its pin, its read audit and containment scans, then a unit\nbuild on the first candidates until --need usable units (default 2). Makes no model call and spends nothing.";
async function preflight(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--need"], [], PREFLIGHT_HELP, ["--home"]);
  if (!f) return 0;
  const p = loadCsoPrereg();
  const { res, arms, drops } = await buildFromFlags(p, { work: f.need("--work"), homes: homesOf(f.all("--home")), need: Number(f.one("--need") ?? 2) });
  for (const a of arms) console.log("PASS arm " + a.arm + ": tree " + a.home_tree_sha256.slice(0, 12) + ", read audit clean, " + a.contain_ids.dropped.length + " id drops, " + a.contain_deps.dropped.length + " dependency drops");
  console.log((res.filled ? "PASS" : "FAIL") + " unit build: " + res.filled + " usable; every-cell drops " + drops.id.length + " by id, " + drops.dep.length + " by dependency");
  return res.filled ? 0 : 1;
}

export const COMMANDS: Record<string, Command> = { units, draw: drawCmd, rerun: (a) => rerun(a, csoRunner()), preflight, ...JUDGE_COMMANDS };

/** A refusal as lines that each start with the code, then its fix and docs anchor. */
export function refusal(e: unknown): { code: string; text: string } {
  const message = e instanceof Error ? e.message : String(e);
  const code = e instanceof CsoError ? e.code : (message.match(/^(E_[A-Z0-9_]+)\b/)?.[1] ?? "E_INTERNAL");
  const body = message.startsWith(code) ? message.slice(code.length).trim() : message;
  const tail = isReasonCode(code) ? ["fix: " + CODES[code].fix, "docs: " + docAnchor(code)] : [];
  return { code, text: [...body.split("\n"), ...tail].map((l) => code + " " + l).join("\n") };
}

export async function main(argv: string[]): Promise<number> {
  try {
    const [sub, ...rest] = argv;
    if (sub === undefined || sub === "--help" || sub === "-h") {
      console.log("Usage: gstack-evals cso <command> [options]\nCommands: " + Object.keys(COMMANDS).sort().join(", ") + "\nEach command takes --help. Plan: wiki/plans/2026-11-19-geva-561-cso-advisories-prereg/README.md.");
      return sub === undefined ? 2 : 0;
    }
    const fn = COMMANDS[sub] ?? csoFail("E_USAGE", "unknown cso command " + JSON.stringify(sub) + "; gstack-evals cso --help lists them");
    return await fn(rest);
  } catch (e) {
    const r = refusal(e);
    console.error(r.text);
    return EXIT[r.code] ?? 2;
  }
}
