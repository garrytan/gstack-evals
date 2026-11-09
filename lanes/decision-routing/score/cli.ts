// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing score: per creative model, Primary A (R against N), Primary B (R against P) and P against
// N in Primary A's form with no verdict; stops per cell and kind; S10 acting rates.
//   score --trials <dir>... --journal <file>... --prices <prices.json> --planned <planned.json> --admission <admission.json> [--labels <labels.jsonl>...] [--json <out>]
// planned.json: {"tasks": [task ids]}. admission.json: written by admit; contrasts["R-N"] and ["R-P"] carry admitted.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actingRates } from "./acting.ts";
import { primaryA, primaryB, printA, printB } from "./primary.ts";
import { loadPrices, readJournal, readTrial, type SessionOutcome } from "./session.ts";

const flag = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flags = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

/** Every Harbor trial directory (its result.json names a task_name; a job's does not) at most three levels under root. */
export function trialDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    const result = join(dir, "result.json");
    if (existsSync(result) && typeof JSON.parse(readFileSync(result, "utf8")).task_name === "string") { out.push(dir); return; }
    if (depth >= 3) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name), depth + 1);
  };
  walk(root, 0);
  return out.sort();
}

const jsonl = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

export async function main(argv: string[]): Promise<number> {
  const roots = flags(argv, "--trials"), journals = flags(argv, "--journal"), prices = flag(argv, "--prices"), planned = flag(argv, "--planned"), admission = flag(argv, "--admission");
  if (!roots.length || !journals.length || !prices || !planned || !admission) {
    console.error("E_USAGE score --trials <dir>... --journal <file>... --prices <prices.json> --planned <planned.json> --admission <admission.json> [--labels <labels.jsonl>...] [--json <out>]");
    return 2;
  }
  const ctx = { calls: readJournal(journals), prices: loadPrices(prices) };
  const dirs = roots.flatMap(trialDirs);
  const sessions: SessionOutcome[] = dirs.map((d) => readTrial(d, ctx));
  const tasks: string[] = JSON.parse(readFileSync(planned, "utf8")).tasks;
  const adm = JSON.parse(readFileSync(admission, "utf8"));
  const admitted = (c: string) => adm.contrasts?.[c]?.admitted === true;
  const lines: string[] = ["prices dated " + ctx.prices.date + "; " + sessions.length + " sessions, " + sessions.filter((s) => s.status === "missing").length + " missing"];
  const report: Record<string, unknown> = {};
  for (const model of ["opus", "sol"] as const) {
    const cell = (c: string) => sessions.filter((s) => s.model === model && s.cell === c);
    const a = primaryA({ treatment: cell("R"), control: cell("N"), planned: tasks, admitted: admitted("R-N"), model });
    const b = primaryB({ treatment: cell("R"), control: cell("P"), planned: tasks, admitted: admitted("R-P"), model });
    const pn = primaryA({ treatment: cell("P"), control: cell("N"), planned: tasks, admitted: false, model }, false);
    report[model] = { primary_a: a, primary_b: b, p_vs_n: pn };
    lines.push("", "== " + model + " ==", "Primary A, R against N" + (admitted("R-N") ? "" : " (non-inferiority kept out by admission)"), ...printA(a), "", "Primary B, R against P" + (admitted("R-P") ? "" : " (non-inferiority kept out by admission)"), ...printB(b), "", "P against N (no verdict)", ...printA(pn, "P minus N", false));
  }
  const stops = new Map<string, number>();
  for (const s of sessions) { const k = s.model + " " + s.cell + " " + (s.status === "missing" ? "missing: " + s.reason : s.exit_status); stops.set(k, (stops.get(k) ?? 0) + 1); }
  lines.push("", "stops and outcomes per cell:", ...[...stops.entries()].sort().map(([k, v]) => "  " + k + ": " + v));
  const labels = new Map<string, unknown>(flags(argv, "--labels").flatMap(jsonl).map((l: any) => [l.decision_id, l.label]));
  const decisions = dirs.flatMap((d) => jsonl(join(d, "agent", "dr", "decisions.jsonl")));
  const summaries = dirs.flatMap((d) => { const p = join(d, "agent", "dr", "dr-summary.json"); return existsSync(p) ? [JSON.parse(readFileSync(p, "utf8"))] : []; });
  const acting = actingRates(decisions, summaries, labels);
  report.acting = acting;
  lines.push("", "S10 acting rates:", ...acting.rows.map((r) => "  " + r.cell + " " + r.type + ": n " + r.n + ", layers " + JSON.stringify(r.by_layer) + ", no-answers " + r.no_answers + ", retries " + r.retries + ", wrong acts " + r.wrong_acts + " of " + r.labelled_acts + (r.type === "relevant" ? ", fix files dropped " + r.fix_dropped + " of " + r.fix_hits : "")), ...acting.cells.map((c) => "  " + c.cell + ": " + c.sessions + " sessions, decider questions per session " + c.decider_questions_per_session.toFixed(2) + ", blocked commands " + c.blocked_commands));
  console.log(lines.join("\n"));
  const out = flag(argv, "--json");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  return 0;
}
