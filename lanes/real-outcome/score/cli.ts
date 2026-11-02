// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals real score: score one trial, run the paired analysis, and run the power simulation (plan
// wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan, section 12 step 6; lanes/real-outcome/score/README.md).
// Keyless: nothing here calls a model.
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CODES, docAnchor, type ReasonCode } from "../../../src/errors/codes.ts";
import { TaskError } from "../task/format.ts";
import { analyze, readConfig, renderMarkdown } from "./analysis.ts";
import { scoreTrial } from "./grade.ts";
import { DEFAULT_TAXONOMY, EVIDENCE_SCHEMA, readTaxonomy, ScoreError, type TrialEvidence } from "./outcome.ts";
import { CEILING_GRID, EIGHT_GRID, grid, gridTable, interim, interimLines, MAIN_GRID, MIN_SIMS, repo, repoTable } from "./power.ts";

export const HELP = `Usage: gstack-evals real score <command> [options]

  trial <evaluator dir> --task <task dir> --model <id> [--arm <name>] [--runs <n>] [--seed <n>] [--work <dir>]
        [--out <trial-score.json>]
      Score one trial: grade the shipped head from shipped.bundle, a held draft, the turn-1 tree and the final tree
      with the task's hidden tests in Docker, run the destructive and check-gaming detectors and the no-gstack exposure
      check, and write the evidence (default <evaluator dir>/trial-score.json). --runs sets verifier runs per tree
      (default 1).
  analyze --config <config.json> [--taxonomy <taxonomy.json>] [--out <analysis.json>] [--md <report.md>] <trial-score.json or dir>...
      Classify every trial and run the paired analysis: the primary in the fixed order with the interim boundary, the
      truncation guard, the cut rule, the secondaries and the ship-replay family (each its own Holm family) and the
      turn-1 attribution. Models, arms and the frozen task order come from the config. Prints the report.
  power [--sims <n>] [--table main|eight|ceiling|interim|repo|all]
      The keyless power simulation behind the plan's power.md, at --sims simulations per point (default 5000), with
      each point's Monte Carlo error.
`;

function fail(code: ReasonCode, message: string): number {
  const info = CODES[code];
  console.error([code + " " + message, code + " fix: " + info.fix, code + " docs: " + docAnchor(code)].join("\n"));
  return info.exit ?? 2;
}

const evidenceFiles = (paths: string[]): string[] =>
  paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("trial-score.json")).sort().map((f) => join(p, f)) : [p]));

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "trial") {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { task: { type: "string" }, model: { type: "string" }, arm: { type: "string" }, runs: { type: "string", default: "1" }, seed: { type: "string", default: "1" }, work: { type: "string" }, out: { type: "string" } } });
      if (positionals.length !== 1 || !values.task || !values.model) return fail("E_USAGE", "real score trial needs one evaluator dir, --task and --model");
      const e = scoreTrial({ evaluatorDir: positionals[0], taskDir: values.task, model: values.model, arm: values.arm, runs: Number(values.runs), seed: Number(values.seed), work: values.work ?? mkdtempSync(join(tmpdir(), "real-score-")) });
      const out = values.out ?? join(positionals[0], "trial-score.json");
      writeFileSync(out, JSON.stringify(e, null, 2) + "\n");
      console.log(out + ": " + e.trial + " " + e.arm + " shipment " + (e.shipment?.status ?? "none") + (e.infra_reason ? " (infra: " + e.infra_reason + ")" : ""));
      return 0;
    }
    if (cmd === "analyze") {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { config: { type: "string" }, taxonomy: { type: "string" }, out: { type: "string" }, md: { type: "string" } } });
      if (!values.config || !positionals.length) return fail("E_USAGE", "real score analyze needs --config and at least one trial-score.json or directory");
      const cfg = readConfig(JSON.parse(readFileSync(values.config, "utf8")));
      const taxonomy = values.taxonomy ? readTaxonomy(JSON.parse(readFileSync(values.taxonomy, "utf8"))) : DEFAULT_TAXONOMY;
      const evidence = evidenceFiles(positionals).map((f) => {
        const e = JSON.parse(readFileSync(f, "utf8")) as TrialEvidence;
        if (e.schema !== EVIDENCE_SCHEMA) throw new ScoreError("E_REAL_SCORE_INPUT", f + " is not a " + EVIDENCE_SCHEMA + " record");
        return e;
      });
      const a = analyze(evidence, cfg, taxonomy);
      if (values.out) writeFileSync(values.out, JSON.stringify(a, null, 2) + "\n");
      const md = renderMarkdown(a);
      if (values.md) writeFileSync(values.md, md);
      console.log(md);
      return 0;
    }
    if (cmd === "power") {
      const { values } = parseArgs({ args: rest, options: { sims: { type: "string", default: String(MIN_SIMS) }, table: { type: "string", default: "main" } } });
      const sims = Number(values.sims);
      if (!Number.isSafeInteger(sims) || sims < 1) return fail("E_USAGE", "--sims must be a positive whole number");
      const t = values.table;
      if (!["main", "eight", "ceiling", "interim", "repo", "all"].includes(t)) return fail("E_USAGE", "--table must be main, eight, ceiling, interim, repo or all");
      const show = (name: string) => t === name || t === "all";
      if (sims < MIN_SIMS) console.log("note: " + sims + " simulations per point is below B6's minimum of " + MIN_SIMS + "; use it only to reproduce power.md's own runs");
      if (show("main")) console.log(gridTable(grid({ ...MAIN_GRID, sims }), true).join("\n"));
      if (show("eight")) console.log(gridTable(grid({ ...EIGHT_GRID, sims }), true).join("\n"));
      if (show("ceiling")) console.log(gridTable(grid({ ...CEILING_GRID, sims }), true).join("\n"));
      if (show("interim")) {
        const rows = interim(sims);
        console.log(interimLines(rows).join("\n") + "\nMonte Carlo standard error per share is at most " + (100 * Math.max(...rows.flatMap((r) => Object.values(r.se)))).toFixed(2) + " points at " + sims + " simulations.");
      }
      if (show("repo")) console.log(repoTable(repo(sims)).join("\n"));
      return 0;
    }
    if (cmd === undefined || cmd === "--help" || cmd === "-h") {
      console.log(HELP);
      return cmd === undefined ? 2 : 0;
    }
    return fail("E_USAGE", "unknown real score command " + JSON.stringify(cmd) + "; gstack-evals real score --help lists them");
  } catch (e) {
    if (e instanceof ScoreError || e instanceof TaskError) return fail(e.code, e.message);
    throw e;
  }
}
