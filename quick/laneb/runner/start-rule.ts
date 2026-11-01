// The start rule of GEVA-106's preregistration (section 8), checked before each batch launches.
// The run's settled spend, plus its open reserves, plus 1.4 times the projected cost of the trials not
// yet finished in this batch and in every batch of the run still running, must be at most the run's cap.
// Spend comes from the run's ledger file; the projection is the frozen per-trial table below.
//
//   bun runner/start-rule.ts check --run <discovery-r1|texttax-r1> --ledger <jsonl> --batch <spec> [--batch <spec> ...] [--note]
//   bun runner/start-rule.ts plan --run <discovery-r1|texttax-r1>
//
// A batch spec is a model id for a batch with every trial still to run, or model:arm=n+arm=n for the
// trials it has left. List the batch about to launch and every batch of the run still running.
// --note appends the inputs and the verdict to the ledger as a note row. check exits 1 when the rule fails.
// plan walks the run's planned order from an empty ledger, each earlier group settled at its projection.
import { appendFileSync, closeSync, fsyncSync, openSync } from "node:fs";
import { fromMicros, readRows, toMicros, totals, type Totals } from "./ledger.ts";

const TASKS = 37;
const MARGIN = 1.4;

// Projected spend per trial in dollars (section 8): model, then arm.
export const PROJECTION: Record<string, Record<string, number>> = {
  "claude-opus-5-5": { none: 0.145, gstack: 0.16, "gstack-rewritten": 0.16, placebo: 0.16 },
  "claude-sonnet-5-5": { none: 0.052, gstack: 0.058, "gstack-rewritten": 0.058, placebo: 0.058 },
  "claude-haiku-5-5": { none: 0.009, gstack: 0.01, "gstack-rewritten": 0.01, placebo: 0.01, "placebo-short": 0.012 },
  "particle-1": { none: 0.072, gstack: 0.078, "gstack-rewritten": 0.078, placebo: 0.078, "placebo-short": 0.078 },
  "deepseek-v4.1-flash-1017": { none: 0.062, "placebo-short": 0.065, placebo: 0.068 },
  "gpt-6.1-sol": { none: 0.15, gstack: 0.15, "gstack-rewritten": 0.15, placebo: 0.15 },
};
// Run T prices placebo from #109 and quick look 3, not the untold figure, so its placebo column differs from Run D's.
const RUN_T_PLACEBO: Record<string, number> = { "claude-haiku-5-5": 0.013, "particle-1": 0.088, "deepseek-v4.1-flash-1017": 0.068 };

export type RunSpec = { item: string; cap: number; arms: string[]; replicates: Record<string, number>; order: string[][]; price: (model: string, arm: string) => number };

export const RUNS: Record<string, RunSpec> = {
  "discovery-r1": {
    item: "discovery-r1", cap: 100, arms: ["none", "gstack", "gstack-rewritten", "placebo"],
    replicates: { "claude-haiku-5-5": 1, "particle-1": 1, "claude-sonnet-5-5": 1, "claude-opus-5-5": 1, "gpt-6.1-sol": 1 },
    order: [["claude-haiku-5-5", "particle-1", "claude-sonnet-5-5"], ["claude-opus-5-5"], ["gpt-6.1-sol"]],
    price: (model, arm) => PROJECTION[model]![arm]!,
  },
  "texttax-r1": {
    item: "texttax-r1", cap: 75, arms: ["none", "placebo-short", "placebo"],
    replicates: { "particle-1": 5, "claude-haiku-5-5": 5, "deepseek-v4.1-flash-1017": 2 },
    order: [["particle-1", "claude-haiku-5-5"], ["deepseek-v4.1-flash-1017"]],
    price: (model, arm) => (arm === "placebo" ? RUN_T_PLACEBO[model]! : PROJECTION[model]![arm]!),
  },
};

export type Batch = { model: string; remaining: Record<string, number> };

export function parseBatch(run: RunSpec, spec: string): Batch {
  const [model, rest] = spec.split(":");
  const reps = run.replicates[model!];
  if (!reps) throw new Error(`E_USAGE model ${model} has no batch in ${run.item}`);
  if (!rest) return { model: model!, remaining: Object.fromEntries(run.arms.map((a) => [a, TASKS * reps])) };
  const remaining: Record<string, number> = {};
  for (const part of rest.split("+")) {
    const [arm, n] = part.split("=");
    if (!run.arms.includes(arm!) || !/^\d+$/.test(n ?? "") || Number(n) > TASKS * reps) throw new Error(`E_USAGE bad batch part ${part} in ${spec}`);
    remaining[arm!] = Number(n);
  }
  return { model: model!, remaining };
}

export const batchMicros = (run: RunSpec, b: Batch) => Object.entries(b.remaining).reduce((s, [arm, n]) => s + n * toMicros(run.price(b.model, arm)), 0);

export function startRule(run: RunSpec, status: Totals, batches: Batch[]) {
  const projectedMicros = batches.reduce((s, b) => s + batchMicros(run, b), 0);
  const boundMicros = status.settledMicros + status.openReservedMicros + Math.ceil(projectedMicros * MARGIN);
  return {
    run: run.item, cap_usd: run.cap, settled_usd: fromMicros(status.settledMicros), open_reserved_usd: fromMicros(status.openReservedMicros),
    batches: batches.map((b) => ({ model: b.model, remaining: b.remaining, projected_usd: fromMicros(batchMicros(run, b)) })),
    projected_usd: fromMicros(projectedMicros), margin: MARGIN, bound_usd: fromMicros(boundMicros), pass: boundMicros <= toMicros(run.cap),
  };
}

export function plan(run: RunSpec) {
  let settled = 0;
  const steps = [];
  for (const group of run.order) {
    const running: Batch[] = [];
    for (const model of group) {
      running.push(parseBatch(run, model));
      steps.push({ launch: model, ...startRule(run, { capMicros: toMicros(run.cap), settledMicros: settled, openReservedMicros: 0, openIds: [] }, running) });
    }
    settled += running.reduce((s, b) => s + batchMicros(run, b), 0);
  }
  return { steps, total_projected_usd: fromMicros(settled) };
}

export function appendNote(path: string, item: string, verdict: ReturnType<typeof startRule>) {
  const ts = new Date().toISOString();
  appendFileSync(path, JSON.stringify({ ts, item, kind: "note", id: "start-rule-" + ts, usd_micros: 0, start_rule: verdict }) + "\n");
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

if (import.meta.main) {
  const [cmd, ...argv] = Bun.argv.slice(2);
  const opt = (name: string) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]!] : []));
  const run = RUNS[opt("--run")[0] ?? ""];
  if (!run || (cmd !== "check" && cmd !== "plan")) {
    console.error("E_USAGE usage: start-rule.ts check --run <discovery-r1|texttax-r1> --ledger <jsonl> --batch <spec> ... [--note] | plan --run <name>");
    process.exit(2);
  }
  if (cmd === "plan") {
    const p = plan(run);
    for (const s of p.steps) console.log(`${s.run} launch ${s.launch}: settled $${s.settled_usd.toFixed(2)} + 1.4 x $${s.projected_usd.toFixed(2)} = $${s.bound_usd.toFixed(2)} vs cap $${s.cap_usd} -> ${s.pass ? "PASS" : "FAIL"}`);
    console.log(`${run.item} projected total $${p.total_projected_usd.toFixed(2)}`);
    process.exit(p.steps.every((s) => s.pass) ? 0 : 1);
  }
  const ledger = opt("--ledger")[0];
  if (!ledger || !opt("--batch").length) {
    console.error("E_USAGE check needs --ledger and at least one --batch");
    process.exit(2);
  }
  const rows = readRows(ledger);
  if (rows.find((r) => r.kind === "approval")?.item !== run.item) throw new Error(`E_USAGE ${ledger} is not the ${run.item} ledger`);
  const verdict = startRule(run, totals(rows), opt("--batch").map((s) => parseBatch(run, s)));
  console.log(JSON.stringify(verdict));
  if (argv.includes("--note")) appendNote(ledger, run.item, verdict);
  process.exit(verdict.pass ? 0 : 1);
}
