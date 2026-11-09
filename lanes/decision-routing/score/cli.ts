// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing score: per creative model, Primary A (R against N), Primary B (R against P) and P against
// N in Primary A's form with no verdict; stops per cell and kind; reruns and missing per cell (prereg line 206); 5xx calls
// settled at $0 with their shadow reservations; calls with an unknown outcome, charged at their reservation; calls
// without usage that the proxy booked above $0, charged at that booked charge; cells whose
// decider failures pass 5% (DR_CELL_DEGRADED, beside the verdicts they touch); test-pass labels dropped because the
// command is not a bare runner; sessions that hit the image's base env; S10 acting rates.
//   score --trials <dir>... --journal <file>... --prices <prices.json> --planned <planned.json> --admission <admission.json> [--labels <labels.jsonl>...] [--json <out>]
// planned.json: {"tasks": [task ids]}. admission.json: written by admit; contrasts["R-N"] and ["R-P"] carry admitted.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOT_BARE_RUNNER } from "../labels/runner-exit.ts";
import { actingRates, deciderFailures, type FailureRow } from "./acting.ts";
import { primaryA, primaryB, printA, printB } from "./primary.ts";
import { infraAttempts, loadPrices, readJournal, readTrial, rerunRows, type SessionOutcome } from "./session.ts";

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
  const gone = [...roots, ...journals, prices, planned, admission, ...flags(argv, "--labels")].find((p) => !existsSync(p));
  if (gone) { console.error("E_USAGE no such file or directory: " + gone); return 2; }
  const ctx = { calls: readJournal(journals), prices: loadPrices(prices) };
  const dirs = roots.flatMap(trialDirs);
  const sessions: SessionOutcome[] = dirs.map((d) => readTrial(d, ctx));
  const tasks: string[] = JSON.parse(readFileSync(planned, "utf8")).tasks;
  const adm = JSON.parse(readFileSync(admission, "utf8"));
  const admitted = (c: string) => adm.contrasts?.[c]?.admitted === true;
  const lines: string[] = ["prices dated " + ctx.prices.date + "; " + sessions.length + " sessions, " + sessions.filter((s) => s.status === "missing").length + " missing"];
  const report: Record<string, unknown> = {};
  const decisions = dirs.flatMap((d) => jsonl(join(d, "agent", "dr", "decisions.jsonl")));
  const failures = deciderFailures(decisions);
  report.decider_failures = failures;
  for (const model of ["opus", "sol"] as const) {
    const cell = (c: string) => sessions.filter((s) => s.model === model && s.cell === c);
    const degraded = (cells: string[]) => failures.filter((f) => f.model === model && f.degraded && cells.includes(f.cell));
    const marks = (rows: FailureRow[]) => rows.map((f) => "DR_CELL_DEGRADED cell " + f.cell + ": " + f.failed + " of " + f.decisions + " decisions (" + (100 * f.share).toFixed(1) + "%) had a decider call fail after its retry, over 5%; a null here reads FIX-METHOD on infrastructure");
    const degA = degraded(["R", "N"]), degB = degraded(["R", "P"]);
    const tag = (rows: FailureRow[]) => rows.map((f) => ({ code: "DR_CELL_DEGRADED", null_reads: "FIX-METHOD on infrastructure", ...f }));
    const a = primaryA({ treatment: cell("R"), control: cell("N"), planned: tasks, admitted: admitted("R-N"), model });
    const b = primaryB({ treatment: cell("R"), control: cell("P"), planned: tasks, admitted: admitted("R-P"), model });
    const pn = primaryA({ treatment: cell("P"), control: cell("N"), planned: tasks, admitted: false, model }, false);
    report[model] = { primary_a: a, primary_b: b, p_vs_n: pn, degraded: { "R-N": tag(degA), "R-P": tag(degB) } };
    lines.push("", "== " + model + " ==", "Primary A, R against N" + (admitted("R-N") ? "" : " (non-inferiority kept out by admission)"), ...printA(a), ...marks(degA), "", "Primary B, R against P" + (admitted("R-P") ? "" : " (non-inferiority kept out by admission)"), ...printB(b), ...marks(degB), "", "P against N (no verdict)", ...printA(pn, "P minus N", false));
  }
  const stops = new Map<string, number>();
  for (const s of sessions) { const k = s.model + " " + s.cell + " " + (s.status === "missing" ? "missing: " + s.reason : s.exit_status); stops.set(k, (stops.get(k) ?? 0) + 1); }
  lines.push("", "stops and outcomes per cell:", ...[...stops.entries()].sort().map(([k, v]) => "  " + k + ": " + v));
  const attempts = roots.flatMap(infraAttempts);
  const reruns = rerunRows(attempts, sessions);
  report.reruns = reruns;
  lines.push("", "reruns and missing per cell (prereg line 206; a kept first attempt is never scored):", ...reruns.map((r) => "  " + r.model + " " + r.cell + ": reruns " + r.reruns + " (rerun graded " + r.rerun_graded + ", rerun missing " + r.rerun_missing + "), missing " + r.missing));
  lines.push("", "decisions with a decider call that failed after its retry, per cell (prereg line 207; over 5% marks the cell DR_CELL_DEGRADED):", ...(failures.length ? failures.map((f) => "  " + f.model + " " + f.cell + ": " + f.failed + " of " + f.decisions + " (" + (100 * f.share).toFixed(1) + "%)" + (f.degraded ? ", DR_CELL_DEGRADED" : "")) : ["  none"]));
  const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const owner = new Map<string, string>();
  const baseEnv = new Map<string, { sessions: number; hit: number }>();
  for (const d of dirs) {
    const s = read(join(d, "agent", "dr", "dr-summary.json"));
    if (!s) continue;
    const k = s.model + " " + s.cell, m = read(join(d, "agent", "dr", "meter.json"))?.meter_id, t = join(d, "agent", "dr", "trajectory.json");
    if (typeof m === "string") owner.set(m, k);
    if (!existsSync(t)) continue;
    const b = baseEnv.get(k) ?? { sessions: 0, hit: 0 };
    b.sessions++;
    if (/No module named|conda activate testbed/.test(readFileSync(t, "utf8"))) b.hit++;
    baseEnv.set(k, b);
  }
  for (const a of attempts) if (a.meter_id) owner.set(a.meter_id, a.model + " " + a.cell);
  const unknown = new Map<string, { count: number; reserved_micros: number }>();
  const booked = new Map<string, { count: number; booked_micros: number }>();
  for (const [meter, calls] of ctx.calls) {
    for (const c of calls) {
      if (c.booked_micros !== undefined) {
        const k = owner.get(meter) ?? "no session", b = booked.get(k) ?? { count: 0, booked_micros: 0 };
        b.count++;
        b.booked_micros += c.booked_micros;
        booked.set(k, b);
      }
      if (c.reserved_micros === undefined) continue;
      const k = owner.get(meter) ?? "no session", u = unknown.get(k) ?? { count: 0, reserved_micros: 0 };
      u.count++;
      u.reserved_micros += c.reserved_micros;
      unknown.set(k, u);
    }
  }
  report.unknown_calls = Object.fromEntries(unknown);
  report.booked_no_usage_calls = Object.fromEntries(booked);
  const free = new Map<string, { count: number; shadow_micros: number }>();
  for (const l of journals.flatMap(jsonl)) {
    if (l.kind !== "outcome" || l.no_usage_5xx !== true) continue;
    const k = owner.get(l.meter_id) ?? "no session", f = free.get(k) ?? { count: 0, shadow_micros: 0 };
    f.count++;
    f.shadow_micros += l.shadow_micros ?? 0;
    free.set(k, f);
  }
  report.no_usage_5xx = Object.fromEntries(free);
  report.base_env = Object.fromEntries(baseEnv);
  lines.push("", "5xx calls without usage settled at $0 (shadow: the reservations they would have charged):", ...(free.size ? [...free.entries()].sort().map(([k, f]) => "  " + k + ": " + f.count + ", shadow $" + (f.shadow_micros / 1e6).toFixed(2)) : ["  none"]));
  lines.push("", "calls with an unknown outcome (no usage came back), charged at their full reservation:", ...(unknown.size ? [...unknown.entries()].sort().map(([k, u]) => "  " + k + ": " + u.count + ", reserved $" + (u.reserved_micros / 1e6).toFixed(2)) : ["  none"]));
  lines.push("", "calls without usage that the proxy booked above $0, charged at that booked charge:", ...(booked.size ? [...booked.entries()].sort().map(([k, b]) => "  " + k + ": " + b.count + ", booked $" + (b.booked_micros / 1e6).toFixed(2)) : ["  none"]));
  lines.push("", "sessions that hit the image's base env (No module named, or the agent ran conda activate testbed):", ...[...baseEnv.entries()].sort().map(([k, b]) => "  " + k + ": " + b.hit + " of " + b.sessions));
  const labelRows = flags(argv, "--labels").flatMap(jsonl);
  const labels = new Map<string, unknown>(labelRows.map((l: any) => [l.decision_id, l.label]));
  const notRunner = new Set(labelRows.filter((l: any) => l.missing === NOT_BARE_RUNNER).map((l: any) => l.decision_id));
  const drops = new Map<string, number>();
  for (const d of decisions) if (notRunner.has(d.decision_id)) { const k = d.model + " " + d.cell + " " + d.acting_layer; drops.set(k, (drops.get(k) ?? 0) + 1); }
  report.label_drops_not_bare_runner = Object.fromEntries(drops);
  lines.push("", "test-pass labels dropped because the command is not a bare runner (lanes/decision-routing/README.md), per model, cell and acting layer:", ...(drops.size ? [...drops.entries()].sort().map(([k, v]) => "  " + k + ": " + v) : ["  none"]));
  const summaries = dirs.flatMap((d) => { const p = join(d, "agent", "dr", "dr-summary.json"); return existsSync(p) ? [JSON.parse(readFileSync(p, "utf8"))] : []; });
  const acting = actingRates(decisions, summaries, labels);
  report.acting = acting;
  lines.push("", "S10 acting rates:", ...acting.rows.map((r) => "  " + r.cell + " " + r.type + ": n " + r.n + ", layers " + JSON.stringify(r.by_layer) + ", no-answers " + r.no_answers + ", retries " + r.retries + ", wrong acts " + r.wrong_acts + " of " + r.labelled_acts + ", unknown acts dropped " + r.unknown_acts + (r.type === "relevant" ? ", fix files dropped " + r.fix_dropped + " of " + r.fix_hits : "")), ...acting.cells.map((c) => "  " + c.cell + ": " + c.sessions + " sessions, decider questions per session " + c.decider_questions_per_session.toFixed(2) + ", blocked commands " + c.blocked_commands));
  console.log(lines.join("\n"));
  const out = flag(argv, "--json");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  return 0;
}
