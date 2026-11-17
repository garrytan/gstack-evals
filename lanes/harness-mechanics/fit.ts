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
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Ledger, readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { ARMS_DIR, manifestOf } from "./arms.ts";
import { d1Rig, EDIT_LINE, EDIT_RULE, loopResult, type Rig } from "./d1.ts";
import { itemTotals } from "./money.ts";
import { bundleLists, CAPS_USD, REPO, screenedFromEnv, sha256 } from "./pins.ts";
import { gstackAtPin, imageRef, pool, ubi, vmEnv } from "./screen.ts";

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

// GEVA-504's seven fit classes, read from a row: what /verify's own loop printed after the probe's edit. A CHECK line
// counts only at PASS or FAIL. A row that stopped on anything else (a pull, a build, a base timeout) has no class.
export const FIT_CLASSES = [
  { code: "S1", name: "tests PASS on the probe edit" },
  { code: "S2", name: "tests FAIL, already failing at base" },
  { code: "S3", name: "tests FAIL, base passes" },
  { code: "S4", name: "tests ran no test, lint or typecheck gives PASS/FAIL" },
  { code: "S5", name: "no check gives PASS/FAIL" },
  { code: "U1", name: "unmeasured: no tracked module a test_<name>.py names" },
  { code: "U2", name: "unmeasured: no pytest in the testbed env" },
] as const;
export type FitClass = (typeof FIT_CLASSES)[number]["code"];
export function fitClass(r: FitRow): FitClass | null {
  if (r.error?.startsWith("no tracked module")) return "U1";
  if (r.error?.startsWith("pytest ")) return "U2";
  if (r.error || !r.checks) return null;
  const verdict = (name: string) => r.checks!.find((k) => k.name === name)?.verdict ?? "";
  if (verdict("tests") === "PASS") return "S1";
  if (verdict("tests") === "FAIL") return r.base_fail?.result === "fail" ? "S2" : r.base_fail?.result === "pass" ? "S3" : null;
  return ["lint", "typecheck"].some((n) => ["PASS", "FAIL"].includes(verdict(n))) ? "S4" : "S5";
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
  if (!inEnv) return { error: "pytest " + (py || "missing") + ", not under " + r.s.envDirs.join(" or ") };
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
  const L = ["# Task-fit probe", "", rows.length + " tasks. Edit rule: " + EDIT_RULE + ". FAIL at base means the same selected test files fail on the pristine tree with the env's pytest.", "", "## Per repository", "", ...table("repository", rows, (r) => r.repo), "", "## Per split", "", ...table("split", rows, (r) => r.split), "", "## Per class", "", ...table("class", rows, (r) => fitClass(r) ?? "no class"), "", "## Tasks", ""];
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
        Object.assign(row, probeTask(r, t.task, imageRef(p.get(t.task)!), (process.env.HM_FIT_TAG ?? "hm-fit") + "-" + (tasks.indexOf(t) + 1)));
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

// hm fit-vm start|status|finish <work> (the Captain's B): the probe on one Ubicloud VM under the pinned ubi-runner.sh
// (UBI_RUNNER, UBI_OWNER), leased on the vms ledger (LEDGER) for FIT_VM.hours. FIT_VM.workers workers take tasks from one
// queue, calibration first; each task is its own `hm fit --only` run with the worker's HM_FIT_TAG and its own out dir, and
// a refused pull waits out Docker Hub's limit and retries. status pulls the rows so far; finish pulls them once every
// worker is done, destroys the VM and settles the lease. Both merge the rows into <work>/fit.jsonl in queue order and,
// once every calibration task's row holds a class, write <work>/calibration.jsonl and print its sha256.
export const FIT_VM = { size: "standard-16", hours: 4, usdPerHour: 0.6, workers: 8, pullTries: 4, pullWaitSec: 900 } as const;
const FR = "hm-fit";
// One worker: tasks from the shared queue until it is empty. A worker with no Docker access re-runs itself once under the
// docker group (bootstrap's group change doesn't reach a reused SSH session). A task that leaves no row goes to norow.txt.
export const workerScript = () => [
  "#!/usr/bin/env bash",
  'k=$1; S="$(readlink -f "$0")"; R="${HM_FIT_ROOT:-$HOME/' + FR + '}"; cd "$R/gstack-evals" || exit 1',
  'if ! docker info >/dev/null 2>&1; then [ -n "$HM_FIT_SG" ] && { echo "worker $k: no Docker access" >> "$R/norow.txt"; exit 1; }; exec sg docker -c "HM_FIT_SG=1 bash \'$S\' $k"; fi',
  'export PATH="$HOME/.bun/bin:$PATH" HM_GSTACK="$R/gstack" ARMS="$R/arms" HM_SCREENED="$R/lists/screened.txt" HM_SCREENED_SHA256="$(cat "$R/lists/sha256")" HM_FIT_TAG="hm-fit-w$k"',
  "while t=$(flock \"$R/queue.lock\" sh -c 'head -n 1 \"$0\"; sed -i 1d \"$0\"' \"$R/queue.txt\"); [ -n \"$t\" ]; do",
  "  for try in $(seq 1 " + FIT_VM.pullTries + "); do",
  '    rm -rf "$R/out/$t"',
  '    bun lanes/harness-mechanics/cli.ts fit --out "$R/out/$t" --only "$t" >> "$R/w$k.log" 2>&1',
  '    [ -s "$R/out/$t/fit.jsonl" ] || { echo "$t" >> "$R/norow.txt"; break; }',
  '    grep -q "pull failed" "$R/out/$t/fit.jsonl" || break',
  "    sleep " + FIT_VM.pullWaitSec,
  "  done",
  "done",
].join("\n") + "\n";

/** The rows so far in queue order, and the calibration rows once each holds a class. */
export function fitMerge(work: string, queue: FitTask[]): { rows: FitRow[]; calibration: string | null } {
  const rows = queue.flatMap((t) => { const f = join(work, "out", t.task, "fit.jsonl"); const l = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).at(-1) : undefined; return l ? [JSON.parse(l) as FitRow] : []; });
  writeFileSync(join(work, "fit.jsonl"), rows.map((r) => JSON.stringify(r) + "\n").join(""));
  const cal = queue.filter((t) => t.split === "calibration").map((t) => rows.find((r) => r.task === t.task));
  if (!cal.every((r) => r && fitClass(r) !== null)) return { rows, calibration: null };
  const text = cal.map((r) => JSON.stringify(r) + "\n").join("");
  writeFileSync(join(work, "calibration.jsonl"), text);
  return { rows, calibration: sha256(text) };
}

export function fitVm(cmd: string, work: string, log: (l: string) => void = console.log) {
  const { runner, ledger } = vmEnv(), state = join(work, "fit-vm.json"), l = new Ledger(ledger, "vms"), lease = "fit/" + basename(work);
  itemTotals(readRows(ledger), "vms");
  const all = fitTasks(), queue = [...all.filter((t) => t.split === "calibration"), ...all.filter((t) => t.split === "scored")];
  const report = (vm: string) => {
    const m = fitMerge(work, queue), cal = m.rows.filter((r) => r.split === "calibration");
    log("FIT VM " + vm + ": " + m.rows.length + " of " + queue.length + " rows, " + cal.length + " of " + queue.filter((t) => t.split === "calibration").length + " calibration (" + cal.filter((r) => fitClass(r) !== null).length + " with a class)" + (m.calibration ? "; calibration.jsonl sha256 " + m.calibration : ""));
  };
  if (cmd === "start") {
    if (existsSync(state)) throw new Error("E_USAGE refused: " + work + " already holds a fit VM (" + state + ")");
    const usd = FIT_VM.hours * FIT_VM.usdPerHour, g = gstackAtPin(), arms = join(work, "arms"), lists = join(work, "lists");
    mkdirSync(arms, { recursive: true }); mkdirSync(lists, { recursive: true });
    const tars: Record<string, string> = {};
    for (const t of ["prose", "none"]) {
      const src = join(ARMS_DIR(), t + ".tar"), want = JSON.parse(readFileSync(manifestOf(t), "utf8")).tar.sha256;
      tars[t] = sha256(readFileSync(src));
      if (tars[t] !== want) throw new Error("E_HM_PIN " + src + " has sha256 " + tars[t] + ", not its manifest's " + want);
      rmSync(join(arms, t + ".tar"), { force: true }); linkSync(src, join(arms, t + ".tar"));
    }
    writeFileSync(join(lists, "screened.txt"), readFileSync(process.env.HM_SCREENED!)); writeFileSync(join(lists, "sha256"), process.env.HM_SCREENED_SHA256!);
    writeFileSync(join(lists, "queue.txt"), queue.map((t) => t.task + "\n").join("")); writeFileSync(join(lists, "worker.sh"), workerScript());
    const res = l.reserve(lease, toMicros(usd), { kind_detail: "task-fit probe VM: " + FIT_VM.hours + " h TTL at $" + FIT_VM.usdPerHour.toFixed(2) + "/h (" + FIT_VM.size + ")" });
    if (!res.ok || res.existing) throw new Error("CAP_STOP the vms ledger refused the fit VM's lease of $" + usd.toFixed(2) + (res.ok ? " (the lease is held already)" : " (cap $" + CAPS_USD.vms + ")") + "; no VM started");
    const up = Date.now() / 1000, vm = ubi(runner, ["up", "-s", FIT_VM.size], { UBI_TTL_HOURS: String(FIT_VM.hours) }).trim().split("\n").at(-1)!;
    writeFileSync(state, JSON.stringify({ vm, up_at: up, lease }, null, 2) + "\n");
    ubi(runner, ["sync", vm, REPO, FR + "/gstack-evals"]);
    ubi(runner, ["sync", vm, g, FR + "/gstack"]);
    ubi(runner, ["sync", vm, arms, FR + "/arms"]);
    ubi(runner, ["sync", vm, lists, FR + "/lists"]);
    const got = ubi(runner, ["ssh", vm, "cd " + FR + "/arms && sha256sum prose.tar none.tar"]);
    for (const t of ["prose", "none"]) if (!got.includes(tars[t] + "  " + t + ".tar")) throw new Error("E_HM_PIN the VM's " + t + ".tar is not at " + tars[t] + "; run fit-vm finish " + work + " to destroy the VM");
    ubi(runner, ["ssh", vm, "bash " + FR + "/gstack-evals/quick/laneb/runner/vm-bootstrap.sh > " + FR + "/bootstrap.log 2>&1"]);
    ubi(runner, ["ssh", vm, "cd " + FR + " && cp lists/queue.txt queue.txt && mkdir -p out && setsid -f bash -c 'for k in $(seq 1 " + FIT_VM.workers + "); do bash lists/worker.sh $k & done; wait; echo 0 > exit' < /dev/null > /dev/null 2>&1"]);
    log("FIT VM " + vm + " started with " + FIT_VM.workers + " workers, calibration first; lease $" + usd.toFixed(2) + " on the vms ledger; run fit-vm status or finish " + work + " on a timer");
    return 0;
  }
  if (cmd === "status" || cmd === "finish") {
    if (!existsSync(state)) throw new Error("E_USAGE refused: " + work + " holds no fit VM");
    const st = JSON.parse(readFileSync(state, "utf8"));
    const done = ubi(runner, ["ssh", st.vm, "cat " + FR + "/exit 2>/dev/null || echo running"]).trim() !== "running";
    ubi(runner, ["pull", st.vm, FR + "/out", work]);
    if (cmd === "status" || !done) { report(st.vm); if (cmd === "finish") log("FIT VM " + st.vm + " still running"); return 0; }
    ubi(runner, ["pull", st.vm, FR + "/w*.log", join(work, "logs")]);
    ubi(runner, ["down", st.vm]);
    const hours = (Date.now() / 1000 - st.up_at) / 3600;
    const s = l.settle(st.lease, toMicros(hours * FIT_VM.usdPerHour), { kind_detail: "task-fit probe VM hours: " + hours.toFixed(4) + " h at $" + FIT_VM.usdPerHour.toFixed(2) + "/h" });
    if (!s.ok) throw new Error("E_INTERNAL settling the fit lease: " + s.reason);
    report(st.vm);
    writeFileSync(join(work, "fit.md"), fitSummary(fitMerge(work, queue).rows));
    log("FIT VM " + st.vm + " down after " + hours.toFixed(2) + " h; rows in " + join(work, "fit.jsonl"));
    return 0;
  }
  throw new Error("E_USAGE hm fit-vm start|status|finish <work>");
}
