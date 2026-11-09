// Copyright (c) 2026 Garry Tan. MIT License.
// hm fit --out <dir> [--only <task>]: the task-fit probe, a measurement for the Captain that changes no list. For each task
// in the screened lists (HM_SCREENED at HM_SCREENED_SHA256; scored, then calibration) it runs d1-checks' per-task routine
// (d1.ts d1Rig): the image FROM the pinned task image with task-setup.Dockerfile, the prose tar, the edit rule with
// selection counted through the arm's load and selectLanes, CHECKS_TRUST and /verify's loop. The container gets no
// network: a session's agent phase reaches only the metering proxy, and the probe makes no model call. A row records the
// selection counts and every CHECK line. When tests read FAIL, the edit is reverted and the same selected test files run
// with the env's pytest on the pristine tree (up to 900 s), so a FAIL at the base commit is confirmed or not. Rows append
// to <dir>/fit.jsonl as they land and a rerun resumes from it; a refused pull or a failed build is a row. Each task's
// containers and images are removed after its row. <dir>/fit.md sums the rows per repository and per split.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { d1Rig, EDIT_LINE, EDIT_RULE, loopResult, type Rig } from "./d1.ts";
import { bundleLists, screenedFromEnv } from "./pins.ts";
import { imageRef, pool } from "./screen.ts";

export const FIT = { baseTimeoutSec: 900 };
export type FitTask = { task: string; split: "scored" | "calibration" };
type Base = { result: "pass" } | { result: "fail"; failed: number; errors: number; summary: string } | { result: "timeout" };
export type FitRow = FitTask & { repo: string; tests_selection?: { first: number; picked: number; file: string } | "too_broad"; edited?: string | null; checks?: { name: string; verdict: string }[]; base_fail?: Base; error?: string };

export function fitTasks(only?: string): FitTask[] {
  const l = screenedFromEnv(bundleLists());
  const all = [...l.scored.map((task) => ({ task, split: "scored" as const })), ...l.calibration.map((task) => ({ task, split: "calibration" as const }))];
  if (only === undefined) return all;
  const one = all.filter((t) => t.task === only);
  if (!one.length) throw new Error("E_USAGE hm fit --only " + only + ": not in the screened lists");
  return one;
}

// pytest's exit at base: 0 passes, a kill at the time limit is a timeout, anything else fails with the summary's failed
// and error counts.
export function baseResult(code: number | null, out: string): Base {
  if (code === null) return { result: "timeout" };
  if (code === 0) return { result: "pass" };
  const summary = (out.trim().split("\n").at(-1) ?? "").slice(0, 200);
  return { result: "fail", failed: Number(/(\d+) failed/.exec(summary)?.[1] ?? 0), errors: Number(/(\d+) errors?\b/.exec(summary)?.[1] ?? 0), summary };
}

function probeTask(r: Rig, t: string, ref: string, tag: string): Omit<FitRow, keyof FitTask | "repo"> {
  const { c, py, inEnv, pick } = r.prepare(t, ref, tag);
  if (!inEnv) return { error: "pytest " + (py || "missing") + ", not under " + r.s.envDir };
  const tests_selection = pick.first && pick.edit ? { first: pick.first.selected, picked: pick.edit.selected, file: pick.edit.file } : ("too_broad" as const);
  const edited = pick.edit?.file ?? pick.first?.file ?? null;
  if (!edited) return { tests_selection, edited, error: "no tracked module that a test_<name>.py names" };
  if (!pick.edit) r.exec(c, "echo '" + EDIT_LINE + "' >> '" + edited + "'");
  const tr = r.exec(c, r.trust, 300);
  if (tr.code !== 0) return { tests_selection, edited, error: "trust exited " + tr.code + ": " + r.last(tr.err) };
  const checks = loopResult(r.exec(c, r.loop, 1800).out).checks.map((x) => ({ name: x.split(" ")[0]!, verdict: x.split(" ")[1]! }));
  if (!checks.some((k) => k.name === "tests" && k.verdict === "FAIL")) return { tests_selection, edited, checks };
  const files = [...r.exec(c, r.probe('"refused" in l ? "" : selectLanes(l.ctx).localTests.map((x) => "HM_TEST " + x).join("\\n")')).out.matchAll(/^HM_TEST (\S+)$/gm)].map((m) => "'" + m[1] + "'");
  const base = r.exec(c, "git checkout -q -- '" + edited + "' && " + py + " -q --color=no -p no:cacheprovider " + files.join(" "), FIT.baseTimeoutSec);
  return { tests_selection, edited, checks, base_fail: baseResult(base.code, base.out) };
}

const COLS = ["tasks", "TOO_BROAD", "lint ENV", "typecheck ENV", "tests FAIL", "FAIL at base", "errors"];
const has = (r: FitRow, name: string, verdict: string) => !!r.checks?.some((k) => k.name === name && k.verdict === verdict);
const counts = (rs: FitRow[]) => [rs.length, rs.filter((r) => r.tests_selection === "too_broad").length, rs.filter((r) => has(r, "lint", "ENV")).length, rs.filter((r) => has(r, "typecheck", "ENV")).length, rs.filter((r) => has(r, "tests", "FAIL")).length, rs.filter((r) => r.base_fail?.result === "fail").length, rs.filter((r) => r.error).length];
function table(key: string, rows: FitRow[], of: (r: FitRow) => string): string[] {
  const groups = new Map<string, FitRow[]>();
  for (const r of rows) groups.set(of(r), [...(groups.get(of(r)) ?? []), r]);
  return ["| " + key + " | " + COLS.join(" | ") + " |", "|---" + "|---".repeat(COLS.length) + "|", ...[...groups].map(([k, rs]) => "| " + k + " | " + counts(rs).join(" | ") + " |")];
}
const rowText = (r: FitRow) => r.error ? "error: " + r.error : [typeof r.tests_selection === "object" ? "selects " + r.tests_selection.picked + " (" + r.tests_selection.file + "; first module " + r.tests_selection.first + ")" : "too_broad (" + r.edited + ")", (r.checks ?? []).map((k) => k.name + " " + k.verdict).join(", ") || "no CHECK line", ...(r.base_fail ? ["at base " + r.base_fail.result + ("failed" in r.base_fail ? " " + r.base_fail.failed + " failed, " + r.base_fail.errors + " errors (" + r.base_fail.summary + ")" : "")] : [])].join("; ");

export function fitSummary(rows: FitRow[]): string {
  const L = ["# Task-fit probe", "", rows.length + " tasks. Edit rule: " + EDIT_RULE + ". FAIL at base means the same selected test files fail on the pristine tree with the env's pytest.", "", "## Per repository", "", ...table("repository", rows, (r) => r.repo), "", "## Per split", "", ...table("split", rows, (r) => r.split), "", "## Tasks", ""];
  for (const repo of [...new Set(rows.map((r) => r.repo))]) L.push("### " + repo, "", ...rows.filter((r) => r.repo === repo).map((r) => "- " + r.task + " (" + r.split + "): " + rowText(r)), "");
  return L.join("\n");
}

// The probe over tasks, in order, resuming from <out>/fit.jsonl. gstackDir stands in for HM_GSTACK in tests only.
export function fit(out: string, tasks: FitTask[], gstackDir?: string): FitRow[] {
  mkdirSync(out, { recursive: true });
  const file = join(out, "fit.jsonl"), p = pool(), want = new Set(tasks.map((t) => t.task));
  const rows = (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as FitRow) : []).filter((r) => want.has(r.task));
  const done = new Set(rows.map((r) => r.task)), todo = tasks.filter((t) => !done.has(t.task));
  if (todo.length) {
    const r = d1Rig(gstackDir);
    if ("problem" in r) throw new Error("E_HM_FIT " + r.problem);
    for (const t of todo) {
      const row: FitRow = { ...t, repo: p.get(t.task)?.repo ?? "unknown" };
      try {
        Object.assign(row, probeTask(r, t.task, imageRef(p.get(t.task)!), "hm-fit-" + (tasks.indexOf(t) + 1)));
      } catch (e) {
        row.error = String((e as Error).message ?? e).split("\n")[0];
      } finally {
        r.clean();
      }
      appendFileSync(file, JSON.stringify(row) + "\n");
      appendFileSync(join(out, "fit-log.txt"), r.log.splice(0).join("\n") + "\n");
      rows.push(row);
    }
  }
  const ordered = tasks.map((t) => rows.find((r) => r.task === t.task)!);
  writeFileSync(join(out, "fit.md"), fitSummary(ordered));
  return ordered;
}
