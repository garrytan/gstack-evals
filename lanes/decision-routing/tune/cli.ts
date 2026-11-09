// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing tune: bands from labelled calibration decisions (labels join output) and the
// question-rewrite plan. Prints ECE and labelled counts per type and every band.
//   tune --labelled <labelled.jsonl>... [--rewritten <type,type>] [--out <tuned.json>] [--plan <rewrite-plan.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { rewritePlan, tune, type LabelledDecision } from "./tune.ts";

const flag = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flags = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

export async function main(argv: string[]): Promise<number> {
  const files = flags(argv, "--labelled");
  if (!files.length) { console.error("E_USAGE tune --labelled <labelled.jsonl>... [--rewritten <type,type>] [--out <tuned.json>] [--plan <rewrite-plan.json>]"); return 2; }
  const rows: LabelledDecision[] = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)));
  const t = tune(rows);
  const plan = rewritePlan(rows, (flag(argv, "--rewritten") ?? "").split(",").filter(Boolean));
  console.log([
    ...Object.keys(t.n_labelled).map((k) => "jev " + k + ": " + t.n_labelled[k] + " labelled, ECE " + (t.ece[k] === null ? "none (under 100)" : t.ece[k]!.toFixed(3))),
    "bands: " + JSON.stringify({ jev: t.jev, particle_guess: t.particle_guess, particle_noguess: t.particle_noguess }),
    plan.types.length ? "rewrite once: " + plan.types.map((x) => x.type + " (Jev right on " + (100 * x.accuracy).toFixed(1) + "% of " + x.n + ")").join(", ") + "; " + plan.states.length + " states to re-answer by " + plan.deciders.join(", ") : "no question rewrite: every type at or above 80%",
  ].join("\n"));
  const out = flag(argv, "--out"), planOut = flag(argv, "--plan");
  if (out) writeFileSync(out, JSON.stringify(t, null, 2) + "\n");
  if (planOut) writeFileSync(planOut, JSON.stringify(plan, null, 2) + "\n");
  return 0;
}
