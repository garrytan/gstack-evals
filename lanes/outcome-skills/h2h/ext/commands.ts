// Copyright (c) 2026 Garry Tan. MIT License.
// The extension's commands: x-run (one part's stage of sessions, ext/runner.ts), x-analyze (section 9), x-look (part S's
// interim look, section 11), x-ledger-dryrun (section 14) and x-power-table (section 13). The h2h dispatcher wires them
// through "./ext/commands.ts" in COMMAND_MODULES; running this file directly works too.
import { join } from "node:path";
import { parseFlags, refusal, type Command } from "../cli.ts";
import { h2hFail } from "../prereg.ts";
import { readAnalysisUnits, readRecords } from "../analysis/commands.ts";
import type { H2hScore, Stage } from "../types.ts";
import { analyzeExt, reportExt, type ExtScore, type ExtSession, type ExtTests } from "./analysis.ts";
import { extLedgerDryRun } from "./items.ts";
import { interimLook, lookLines } from "./look.ts";
import { extPowerText } from "./power.ts";
import { PARTS, type Part } from "./prereg.ts";
import { extPreflight, runExtStage } from "./runner.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** The head-to-head's published session data, whose score records give particle-1's gap to Opus. */
export const OPUS_DATA = join(import.meta.dir, "..", "..", "..", "..", "wiki", "board", "2026-11-19-geva-540-skill-pack-h2h-session-data");
const INPUT_FLAGS = ["--units", "--frame", "--sessions", "--scores", "--tests"];
const inputs = (f: NonNullable<ReturnType<typeof parseFlags>>) => {
  for (const k of ["--units", "--sessions", "--scores", "--tests"]) if (!f.all(k).length) h2hFail("E_USAGE", "--units, --sessions, --scores and --tests are each required");
  return {
    units: readAnalysisUnits(f.all("--units"), f.all("--frame")),
    sessions: f.all("--sessions").flatMap((p) => readRecords<ExtSession>(p, "h2h-session.v1")),
    scores: f.all("--scores").flatMap((p) => readRecords<ExtScore>(p, "h2h-score.v1")),
    tests: f.all("--tests").flatMap((p) => readRecords<ExtTests>(p, "h2hx-tests.v1")),
  };
};

const ANALYZE_HELP = `Usage: gstack-evals h2h x-analyze --part S|P|L --units <units> --sessions <file|dir> --scores <file|dir> --tests <file|dir> --out <analysis.json> [--frame <frame>] [--stage stage2] [--run-as-published <arms>] [--opus <session data dir>]
Section 9 for one part: the primary family (Holm over 10 for S, 12 for P), the sentence family's three co-primaries with
Holm over the three and the reading, tests added per arm with the recount beside the frozen rule, the secondaries, and
for part P the gap to the published Opus rows (--opus, the head-to-head's session data by default). The analysis JSON
goes to --out (a new file); the table prints.`;
const analyzeCmd: Command = async (argv) => {
  const f = parseFlags(argv, [...INPUT_FLAGS, "--part", "--out", "--stage", "--run-as-published", "--opus"], [], ANALYZE_HELP, INPUT_FLAGS);
  if (!f) return 0;
  const part = f.need("--part") as Part;
  if (!PARTS.includes(part)) h2hFail("E_USAGE", "--part is S, P or L");
  const stage = (f.one("--stage") ?? "stage2") as Stage;
  if (!["stage0", "stage1", "stage2"].includes(stage)) h2hFail("E_USAGE", "--stage is stage0, stage1 or stage2");
  const out = f.need("--out");
  if (existsSync(out)) h2hFail("E_USAGE", out + " already exists; the analysis is written to a new file");
  const opus = part === "P" ? { scores: readRecords<H2hScore>(join(f.one("--opus") ?? OPUS_DATA, "score-records.jsonl"), "h2h-score.v1") } : undefined;
  const a = analyzeExt(part, { ...inputs(f), stage, runAsPublished: (f.one("--run-as-published") ?? "").split(",").filter(Boolean) }, { opus });
  writeFileSync(out, JSON.stringify(a, null, 2) + "\n", { flag: "wx" });
  for (const l of reportExt(a)) console.log(l);
  return 0;
};

const LOOK_HELP = `Usage: gstack-evals h2h x-look --units <units> --sessions <file|dir> --scores <file|dir> --tests <file|dir> [--frame <frame>] [--cap-stop]
Part S's one interim look at half its units in the extension's run order. Prints only crossed or not crossed per deciding
contrast and the stop decision (efficacy, gaps, cap or continue). --cap-stop records a ledger cap stop on h2hx-s-main.`;
const lookCmd: Command = async (argv) => {
  const f = parseFlags(argv, INPUT_FLAGS, ["--cap-stop"], LOOK_HELP, INPUT_FLAGS);
  if (!f) return 0;
  for (const l of lookLines(interimLook({ ...inputs(f), stage: "stage2" }, { capStop: f.has("--cap-stop") }))) console.log(l);
  return 0;
};

const DRYRUN_HELP = `Usage: gstack-evals h2h x-ledger-dryrun [--dir <dir>] [--caps <caps.json>]
Opens and settles one lease per item of the extension's prereg.json on a temporary ledger at its caps (or --caps, as
{"item": dollars}), checks A2's cap rule and the approved total, and drives the pilot cap rule. Spends nothing.`;
const dryrunCmd: Command = async (argv) => {
  const f = parseFlags(argv, ["--dir", "--caps"], [], DRYRUN_HELP);
  if (!f) return 0;
  const caps = f.one("--caps") ? (JSON.parse(readFileSync(f.need("--caps"), "utf8")) as Record<string, number>) : undefined;
  const r = extLedgerDryRun({ dir: f.one("--dir"), caps });
  for (const c of r.checks) console.log((c.ok ? "PASS " : "FAIL ") + c.name + ": " + c.detail);
  const bad = r.checks.filter((c) => !c.ok);
  if (bad.length) h2hFail("E_H2H_LEDGER_DRYRUN", bad.length + " of " + r.checks.length + " checks failed on the ledger in " + r.dir);
  console.log("ledger dry run: " + r.checks.length + " checks passed in " + r.dir);
  return 0;
};

const RUN_HELP = `Usage: gstack-evals h2h x-run --part S|P|L --stage stage0|stage1|stage2 --units <units> --out <dir> [--frame <frame>] [--allowance <usd>]
Runs one part's stage on the running outcome driver: plans the stage's units from prereg.json's order_seed, then runs,
scores and writes the tests-added record of each session in order under --out (one dir per session; a relaunch keeps the
sessions already written). The driver, its proxy, the unit dirs and the homes come from the environment (ext/runner.ts).
--allowance is the part's session allowance, or exactly twice it after the doubling rule.`;
const runCmd: Command = async (argv) => {
  const f = parseFlags(argv, ["--part", "--stage", "--units", "--frame", "--out", "--allowance"], [], RUN_HELP, ["--units", "--frame"]);
  if (!f) return 0;
  const part = f.need("--part") as Part;
  if (!PARTS.includes(part)) h2hFail("E_USAGE", "--part is S, P or L");
  const stage = f.need("--stage") as Stage;
  if (!["stage0", "stage1", "stage2"].includes(stage)) h2hFail("E_USAGE", "--stage is stage0, stage1 or stage2");
  if (!f.all("--units").length) h2hFail("E_USAGE", "--units is required\n" + RUN_HELP);
  const allowance = f.one("--allowance") === undefined ? undefined : Number(f.one("--allowance"));
  if (allowance !== undefined && !(allowance > 0)) h2hFail("E_USAGE", "--allowance is a dollar amount above 0");
  const units = readAnalysisUnits(f.all("--units"), f.all("--frame")).filter((u) => u.stage === stage);
  const why = await extPreflight(part, units);
  if (why) h2hFail("E_H2HX_RUN", why + "; nothing was opened");
  const r = await runExtStage({ part, stage, units, out: f.need("--out"), allowance });
  console.log("x-run part " + part + " " + stage + ": " + r.plan.sessions.length + " sessions planned, " + r.ran + " run, " + r.kept + " kept from an earlier launch");
  return 0;
};

const powerCmd: Command = async (argv) => {
  const f = parseFlags(argv, [], [], "Usage: gstack-evals h2h x-power-table\nPrints section 13's table and the no-harm pass rates; it matches the extension bundle's power.txt byte for byte.");
  if (!f) return 0;
  process.stdout.write(extPowerText());
  return 0;
};

export const commands: Record<string, Command> = { "x-run": runCmd, "x-analyze": analyzeCmd, "x-look": lookCmd, "x-ledger-dryrun": dryrunCmd, "x-power-table": powerCmd };

if (import.meta.main) {
  const [sub, ...rest] = process.argv.slice(2);
  try {
    const fn = commands[sub ?? ""] ?? h2hFail("E_USAGE", "commands: " + Object.keys(commands).join(", "));
    process.exit(await fn(rest));
  } catch (e) {
    const r = refusal(e);
    console.error(r.text);
    process.exit(2);
  }
}
