// L1's launcher (wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000, sections 3, 6, 9 and 10, build unit U1).
// One item per run (pilot-opus, f1-opus, tb2-opus). Each item's parts run one after another as detached launches of one
// bound run, each part's controller (runner/launch.sh with its ledger service and tunnel) on an awake host: a dedicated
// Ubicloud standard-2 VM that this launcher names, pins and reserves on the item's own ledger. The item's single ledger
// file and its .bound live on that host while the run is up. The waiting agent attaches on a timer.
//
// Agent side (run in this order; see l1/README.md):
//   bun quick/laneb/l1/l1.ts prepare <work> --item <item>    prepare-run per part, plan.json (no host, no spend)
//   bun quick/laneb/l1/l1.ts host-up <work>                  reserve the host's hours, start and bootstrap it, move the ledger onto it
//   bun quick/laneb/l1/l1.ts launch <work> --part <part>     bind the run on the first launch, start the part's controller detached
//   bun quick/laneb/l1/l1.ts attach <work>                   one look: mirror the ledger, pull finished parts, print NEXT
//   bun quick/laneb/l1/l1.ts relaunch <work> --part <part>   once per part, after a loss: the cells that never started
//   bun quick/laneb/l1/l1.ts recover <work>                  after the host is lost: rebuild the ledger from the mirror
//   bun quick/laneb/l1/l1.ts host-down <work>                bring the ledger home, destroy the host, settle its hours
// Host side (called over ssh by the commands above): host-status, host-bind, host-salvage, host-digest.
// Only tests set L1_PREPARE_RUN, L1_HOST_LEDGER_PORT, L1_UNREACHABLE_MINUTES and the L1_*_SEC waits.
// Exit codes: 0 ok; 2 usage; 3 refused (state forbids the step); 4 the item stops incomplete; 5 the host is lost;
// 9 the ledger refused the host's reserve (cap stop, no host); 1 any other error. Stderr lines start with a registered code
// (src/errors/codes.ts): E_USAGE for a bad call or a refusal ("E_USAGE refused: ..."), CAP_STOP for the host's refused
// reserve, E_INTERNAL for anything else.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { rng } from "../analysis/analyze.ts";
import { appendRow, fromMicros, Ledger, readRows, reconcile, toMicros, totals, type Row } from "../runner/ledger.ts";

const LANEB = resolve(import.meta.dir, "..");
const REPO = resolve(LANEB, "../..");
export const BUNDLE = "wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000";
export const L1 = {
  model: "claude-opus-5-5",
  seed: 20261102,
  concurrent: 6,
  fParts: { file: BUNDLE + "/f-parts.txt", sha256: "507e4a070b8c2ad6f4e4aec99a626e0f3e06b91b9ad5219e5de08249d73eb98b" },
  pilot: { file: BUNDLE + "/pilot-tasks.txt", sha256: "fa85bf9cc38a3455a6436f2ec29262ba457a71d7e91e46cc4aedbe4a69ff9381" },
  smoke: ["BerriAI__litellm-16275", "containers__ramalama-2487", "unit8co__darts-2985"],
  tb2Tasks: 37,
  // Part VMs: launch.sh's blocks at the prereg's rate (section 9), and the part TTL the prereg sets.
  vm: { usdPerHour: "0.60", reserveHours: "4", ttlHours: 16 },
  // The awake host: Ubicloud standard-2 (list $41.89 a month, about $0.057 an hour), reserved at $0.08 an hour for its
  // whole TTL before it starts. TTL = (parts + 1) x 18 h + 24 h: every part and one relaunch at the part TTL plus 2 h.
  host: { size: "standard-2", usdPerHour: 0.08, launchHours: 18, slackHours: 24, ledgerPort: "9911", root: "l1" },
  armManifests: "arms/manifests/l1",
  bundleWaitSec: 600,
  unreachable: { tries: 3, minutes: 10 },
};

// The seven arms (prereg section 4): a label each, on one of four tars, all on Claude Code's own system prompt. Told arms
// open the prompt with "/investigate ". No arm sets a procedure line or a GSTACK_* variable. Every arm runs on
// laneb_hooks.LanebHooksAgent (gstack_hooks=copy), which copies the hook state and transcripts out after the session closes and
// writes evaluator/l1-evidence.json; it changes nothing in the session.
export const ARM_SPECS: Record<string, string> = {
  none: "none:system_prompt=claude-code-preset:gstack_hooks=copy",
  "before-u": "before-u:tar=before:system_prompt=claude-code-preset:gstack_hooks=copy",
  "after-u": "after-u:tar=after:system_prompt=claude-code-preset:gstack_hooks=copy",
  "off-u": "off-u:tar=off:system_prompt=claude-code-preset:gstack_hooks=copy",
  "before-t": "before-t:tar=before:told=investigate:system_prompt=claude-code-preset:gstack_hooks=copy",
  "after-t": "after-t:tar=after:told=investigate:system_prompt=claude-code-preset:gstack_hooks=copy",
  "off-t": "off-t:tar=off:told=investigate:system_prompt=claude-code-preset:gstack_hooks=copy",
};
const SEVEN = ["none", "before-u", "after-u", "before-t", "after-t", "off-u", "off-t"];
const FIVE = ["none", "before-u", "after-u", "before-t", "after-t"];

export type ItemDef = { capUsd: number; taskSet: "swerebench-r3a4" | "tb2"; cells: string; allowanceUsd: number };
export const ITEMS: Record<string, ItemDef> = {
  "pilot-opus": { capUsd: 80, taskSet: "swerebench-r3a4", cells: "cells.l1.json", allowanceUsd: 5 },
  "f1-opus": { capUsd: 680, taskSet: "swerebench-r3a4", cells: "cells.l1.json", allowanceUsd: 5 },
  "tb2-opus": { capUsd: 180, taskSet: "tb2", cells: "cells.l1-tb2.json", allowanceUsd: 2.5 },
};

export type Rect = { tasks: string[]; arms: string[]; attempts: number };
export type PartPlan = { name: string; prefix: string; rects: Rect[]; relaunch_of?: string };
export type Plan = { item: string; run_id: string; cap_usd: number; model: string; task_set: string; cells: string; seed: number; concurrent: number; parts: PartPlan[]; inputs: Record<string, string>; git_head: string; host_ttl_hours: number };

class Refused extends Error {}
const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
const refuse = (m: string): never => { throw new Refused(m); };
export const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const sha256File = (p: string) => sha256(readFileSync(p));
const nowSec = () => Math.floor(Date.now() / 1000);
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const writeJsonAtomic = (p: string, v: unknown) => { writeJson(p + ".tmp", v); renameSync(p + ".tmp", p); };

// "<part> <task>" lines, as f-parts.txt writes them.
export function readParts(text: string): Map<string, string[]> {
  const parts = new Map<string, string[]>();
  for (const line of text.split("\n").filter((l) => l.trim())) {
    const m = /^(\S+) (\S+)$/.exec(line.trim());
    if (!m) usage("a parts line is not '<part> <task>': " + line);
    parts.set(m![1]!, [...(parts.get(m![1]!) ?? []), m![2]!]);
  }
  const all = [...parts.values()].flat();
  if (new Set(all).size !== all.length) usage("a parts file names a task twice");
  return parts;
}

// The interleaved order of one batch (prereg section 3, #169 section 3): one stream from seed 20261102 shuffles each
// rectangle's tasks, then its arms, rectangle by rectangle. Harbor runs a job's trials attempt by attempt, task by task,
// agent by agent, so every task's arms run together and the shuffle fixes both orders.
export function seeded(rects: Rect[], seed = L1.seed): Rect[] {
  const r = rng(seed);
  const shuffle = (xs: string[]) => {
    const left = [...xs].sort(), out: string[] = [];
    while (left.length) out.push(left.splice(Math.floor(r() * left.length), 1)[0]!);
    return out;
  };
  return rects.map((x) => ({ tasks: shuffle(x.tasks), arms: shuffle(x.arms), attempts: x.attempts }));
}

export const prefixOf = (item: string, part: string) => item + "/" + part + "/";
export const hostTtlHours = (parts: number) => (parts + 1) * L1.host.launchHours + L1.host.slackHours;

// Each item's parts, from the frozen inputs.
export function itemParts(item: string, input: { fParts?: string; pilot?: string; tb2Parts?: string }): PartPlan[] {
  const part = (name: string, rects: Rect[]): PartPlan => ({ name, prefix: prefixOf(item, name), rects: seeded(rects) });
  if (item === "pilot-opus") {
    const pilot = (input.pilot ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (pilot.length !== 10 || new Set(pilot).size !== 10) usage("the pilot list must hold 10 distinct tasks");
    if (!L1.smoke.every((t) => pilot.includes(t))) usage("every smoke task must be a pilot task");
    return [part("pilot", [{ tasks: pilot, arms: ["before-u", "before-t"], attempts: 1 }, { tasks: [...L1.smoke], arms: ["after-u", "after-t", "off-u", "off-t"], attempts: 1 }])];
  }
  if (item === "f1-opus") {
    const parts = readParts(input.fParts ?? "");
    if ([...parts.keys()].join() !== "1,2,3,4" || [...parts.values()].some((t) => t.length !== 20)) usage("F1 needs parts 1 to 4 of 20 tasks each");
    return [...parts].map(([k, tasks]) => part("f1-" + k, [{ tasks, arms: SEVEN, attempts: 1 }]));
  }
  if (item === "tb2-opus") {
    const parts = readParts(input.tb2Parts ?? "");
    const n = [...parts.values()].flat().length;
    if ([...parts.keys()].join() !== "1,2" || n !== L1.tb2Tasks || [...parts.values()].some((t) => !t.length)) usage("the TB2 twin needs parts 1 and 2 holding its " + L1.tb2Tasks + " tasks");
    return [...parts].map(([k, tasks]) => part("tb2-" + k, [{ tasks, arms: FIVE, attempts: 2 }]));
  }
  return usage("unknown item " + item + "; one of " + Object.keys(ITEMS).join(", "));
}

// Planned cells of a part: "<task>\t<arm>" with the replicates each holds.
export const cellKey = (task: string, arm: string) => task + "\t" + arm;
export function plannedCells(part: { rects: Rect[] }): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of part.rects) for (const t of x.tasks) for (const a of x.arms) out.set(cellKey(t, a), (out.get(cellKey(t, a)) ?? 0) + x.attempts);
  return out;
}

// prepare-run writes one job over the union of a part's tasks and arms; each rectangle becomes its own Harbor job, in
// order (job.json, job-2.json, ...), which vm-run.sh runs one after another on the part's VM.
export function splitJobs(job: any, rects: Rect[]) {
  return rects.map((x, i) => {
    const tasks = x.tasks.map((t) => job.tasks.find((e: any) => basename(e.path) === t) ?? usage("task " + t + " is not in job.json"));
    const agents = x.arms.map((a) => job.agents.find((e: any) => e.kwargs?.arm === a) ?? usage("arm " + a + " is not in job.json"));
    return { ...job, job_name: i === 0 ? job.job_name : job.job_name + "-" + (i + 1), n_attempts: x.attempts, tasks, agents };
  });
}
export const jobFile = (i: number) => (i === 0 ? "job.json" : "job-" + (i + 1) + ".json");

// --- Evidence: which cells started, and why a part ended -------------------------------------------------------------

// A cell has started once the item's ledger accepted a reserve for one of its sessions: the proxy reserves a session's
// cap before its first model request, and an open the ledger never accepted reached no model. A trial is named
// "<task[:32] less trailing _ and ->__<7 chars>", and its session's trial "<that>__env"; jobs/*/<trial>/config.json maps a
// trial to its task exactly. Without it, a trial whose 32-character stem fits more than one planned task counts as
// started for each of them, so a doubtful cell is never relaunched.
export type SessionRef = { trial: string; arm: string };
export function sessionRefs(ledgerRows: Row[], prefix: string, proxyRows: any[] = []): SessionRef[] {
  const out: SessionRef[] = [];
  for (const r of ledgerRows) {
    if (r.kind !== "reserve" || !r.id.startsWith(prefix) || /^vm(-\d+)?$/.test(r.id.slice(prefix.length))) continue;
    out.push({ trial: String(r.trial ?? ""), arm: String(r.arm ?? "") });
  }
  for (const s of proxyRows) out.push({ trial: String(s.trial ?? ""), arm: String(s.meta?.arm ?? "") });
  return out;
}
export const trialName = (sessionTrial: string) => sessionTrial.replace(/__env$/, "");
const stem = (task: string) => task.slice(0, 32).replace(/[_-]+$/, "");

export function startedCells(part: { rects: Rect[] }, refs: SessionRef[], trialTasks: Map<string, string> = new Map()) {
  const planned = plannedCells(part);
  const tasks = [...new Set(part.rects.flatMap((x) => x.tasks))];
  const trials = new Map<string, Set<string>>();
  const strays: SessionRef[] = [];
  for (const ref of refs) {
    const name = trialName(ref.trial);
    const exact = trialTasks.get(name);
    const candidates = exact ? [exact] : tasks.filter((t) => stem(t) === name.replace(/__[A-Za-z0-9]{7}$/, ""));
    const keys = candidates.map((t) => cellKey(t, ref.arm)).filter((k) => planned.has(k));
    if (!keys.length) strays.push(ref);
    for (const k of keys) trials.set(k, (trials.get(k) ?? new Set()).add(name));
  }
  const neverStarted: { task: string; arm: string; replicates: number }[] = [];
  for (const [k, n] of planned) {
    const left = n - Math.min(n, trials.get(k)?.size ?? 0);
    if (left > 0) { const [task, arm] = k.split("\t") as [string, string]; neverStarted.push({ task, arm, replicates: left }); }
  }
  return { started: trials, neverStarted, strays };
}

// The relaunch's rectangles: never-started cells grouped by (replicates, set of arms), each group's tasks together.
export function relaunchRects(cells: { task: string; arm: string; replicates: number }[]): Rect[] {
  const byTask = new Map<string, Map<string, number>>();
  for (const c of cells) byTask.set(c.task, (byTask.get(c.task) ?? new Map()).set(c.arm, c.replicates));
  const groups = new Map<string, Rect>();
  for (const [task, arms] of [...byTask].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const k of new Set(arms.values())) {
      const set = [...arms].filter(([, n]) => n === k).map(([a]) => a).sort();
      const key = k + "|" + set.join(",");
      const g = groups.get(key) ?? { tasks: [], arms: set, attempts: k };
      g.tasks.push(task);
      groups.set(key, g);
    }
  }
  return seeded([...groups.values()]);
}

// Trial name -> task, from a pulled jobs dir (each trial dir's config.json).
export function trialTasksFrom(jobsDir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(jobsDir)) return out;
  for (const job of readdirSync(jobsDir)) {
    const dir = join(jobsDir, job);
    if (!statSync(dir).isDirectory()) continue;
    for (const t of readdirSync(dir)) {
      const cfg = join(dir, t, "config.json");
      if (!existsSync(cfg)) continue;
      try {
        const c = readJson(cfg);
        const task = String(c.task?.path ?? "").split("/").filter(Boolean).at(-1);
        if (task) out.set(String(c.trial_name ?? t), task);
      } catch {}
    }
  }
  return out;
}

const readJsonl = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

// Why a launch ended. A cap stop (a refused reserve, the batch cap, a refused VM block) ends the item incomplete and is
// never relaunched. A loss is the prereg's section 6 case: the part VM died or was reaped (its results could not be
// pulled), the controller was lost, or the ledger service was (a reserve that failed rather than being refused, or the
// tunnel dropping under vm-run.sh). Anything else that leaves cells unstarted is not a loss, and those cells are infra.
// vm-run.sh's exit 4 (the ledger service unreachable before any trial) is neither: the prereg does not class it, so it
// stops the item until Amendment C does (unclassified). When a part's results were never pulled, a cap stop the item's
// ledger made possible counts as one (capStopPossible). So it does after the host was lost, since launch.sh's record of a
// refused VM block (vm-cap-stop) lived on the host; a VM block ($2.40) is under each item's session cap, so the check covers it.
// After a lost host, recover's check counts every rebuilt reserve (sessions, VM block, host) as open before any rebuilt
// settle, since rebuilt rows carry no times, and overstating the overlap can only turn a relaunch into a cap stop, never the reverse.
export function classify(dir: string, launchExit: number | null, extra: { controllerLost?: boolean; hostLost?: boolean; ledger?: { rows: Row[]; since: string; sessionCapUsd: number } } = {}) {
  const out = join(dir, "pulled/out");
  const read = (f: string) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8") : null);
  const capStop: string[] = [];
  const loss: string[] = [];
  if (launchExit === 9) capStop.push("the ledger refused the part VM's first block");
  const vmStop = existsSync(join(dir, "vm-cap-stop")) ? readFileSync(join(dir, "vm-cap-stop"), "utf8").trim() : null;
  if (vmStop) (/refused/.test(vmStop) ? capStop : loss).push("VM block: " + vmStop);
  for (const f of ["cap-stop.json", "proxy-status-end.json"]) {
    try { const s = JSON.parse(read(f) ?? "null"); if (s?.cap_stop) capStop.push(f + ": " + s.cap_stop); } catch { if (read(f) !== null) capStop.push(f + " is unreadable, so a cap stop can't be ruled out"); }
  }
  const log = readJsonl(join(out, "proxy-requests.jsonl"));
  if (log.some((e) => e.event === "cap_stop")) capStop.push("the proxy latched a cap stop");
  const failed = log.filter((e) => e.event === "reserve_failed");
  if (failed.length) loss.push(failed.length + " session opens found the ledger service unreachable");
  const vmExit = read("vm-run.exit")?.trim() ?? null;
  if (launchExit === 7) loss.push("the part's results could not be pulled: its VM died, was reaped or stopped answering");
  if (launchExit === 129 || vmExit === "129") loss.push("the controller's connection to the part VM dropped (vm-run.sh got HUP)");
  if (extra.controllerLost) loss.push("the controller was lost before it recorded an exit");
  if (extra.hostLost) loss.push("the awake host was lost");
  const pulled = existsSync(join(out, "vm-run.exit")) && existsSync(join(dir, "pulled/jobs"));
  if ((!pulled || extra.hostLost) && extra.ledger && capStopPossible(extra.ledger.rows, extra.ledger.since, toMicros(extra.ledger.sessionCapUsd))) capStop.push((pulled ? "the awake host was lost with launch.sh's record of any refused VM block" : "the part's results were not pulled") + ", and the item's ledger came within one session cap ($" + extra.ledger.sessionCapUsd + ") of its cap while the part ran, so a cap stop can't be ruled out");
  const unclassified: string[] = [];
  if (vmExit === "4" && !existsSync(join(out, "harbor.log"))) unclassified.push("vm-run.sh exited 4: the ledger service did not answer through the tunnel before any trial started. The prereg does not class this ending, so the item stops until Amendment C does");
  return { launch_exit: launchExit, vm_run_exit: vmExit, pulled, cap_stop: capStop, loss, unclassified };
}

// A refused session reserve (a cap stop) leaves no ledger row: the proxy's record of it lives on the part VM. When that is
// lost, the ledger still shows whether a refusal could have happened: at some point since the part launched, the item had
// less than one session cap of headroom under its cap.
export function capStopPossible(rows: Row[], since: string, sessionCapMicros: number) {
  const first = rows.findIndex((r) => String(r.ts) >= since);
  for (let i = first < 0 ? rows.length - 1 : Math.max(0, first - 1); i < rows.length; i++) {
    const t = totals(rows.slice(0, i + 1));
    if (t.capMicros > 0 && t.settledMicros + t.openReservedMicros + sessionCapMicros > t.capMicros) return true;
  }
  return false;
}

// --- Ledger arithmetic shared by the host's hours, salvage and recovery ----------------------------------------------

// launch.sh's vm_settle, for any block series: open blocks <id>, <id>-2, ... settle in order at usd - (i - 1) x block,
// floored at 0 and capped at the block except the last, which takes any overrun.
export function blockShares(openIds: string[], id: string, blockUsd: number, usd: number) {
  const idx = (x: string) => (x === id ? 1 : x.startsWith(id + "-") && /^\d+$/.test(x.slice(id.length + 1)) ? Number(x.slice(id.length + 1)) : 0);
  const ids = openIds.filter((x) => idx(x) > 0).sort((a, b) => idx(a) - idx(b));
  const n = Math.max(1, ...ids.map(idx));
  return ids.map((x) => {
    const i = idx(x);
    let s = usd - (i - 1) * blockUsd;
    if (s < 0) s = 0;
    if (i < n && s > blockUsd) s = blockUsd;
    return { id: x, usd: Math.round(s * 1e6) / 1e6 };
  });
}

// Rebuilds the rows a lost host held after the agent's last mirror, from facts that outlived it: every closed session
// in the part's pulled proxy-sessions.jsonl gets its reserve (at the session cap, as the proxy reserved it) and its
// settle; a session that opened and has no closed record keeps its reserve open at the session cap; the part VM's blocks are topped up to its hours and settled; the host's blocks settle at the host's hours.
// Recovery rows bypass the cap check on purpose: they record spend already made. Every row carries recovered: true.
export function restoreRows(rows: Row[], o: { item: string; prefix?: string; sessions?: any[]; open?: any[]; vm?: { id: string; hours: number }; hostId: string; hostHours: number; at: string }): Row[] {
  const add: Row[] = [];
  const row = (kind: Row["kind"], id: string, micros: number, meta: Record<string, unknown> = {}) => add.push({ ...meta, ts: o.at, item: o.item, kind, id, usd_micros: micros, recovered: true });
  const has = (kind: string, id: string) => [...rows, ...add].some((r) => r.kind === kind && r.id === id);
  for (const s of o.sessions ?? []) {
    if (!s.closed_at || !Number.isInteger(s.spent_micros) || !o.prefix) continue;
    const id = o.prefix + s.id;
    if (!has("reserve", id)) row("reserve", id, Number.isInteger(s.cap_micros) ? s.cap_micros : s.spent_micros, { trial: s.trial, model: s.model, ...(s.meta ?? {}) });
    if (!has("settle", id)) row("settle", id, s.spent_micros, { trial: s.trial, reserved_micros: s.cap_micros });
  }
  for (const e of o.open ?? []) {
    if (!o.prefix || !Number.isInteger(e.cap_micros) || has("reserve", o.prefix + e.session)) continue;
    row("reserve", o.prefix + e.session, e.cap_micros, { trial: e.trial, model: e.model, kind_detail: "a session that opened and has no closed record: its reserve stays open at the session cap" });
  }
  const settleSeries = (id: string, blockUsd: number, usd: number, detail: string) => {
    const reserved = [...rows, ...add].filter((r) => r.kind === "reserve" && (r.id === id || r.id.startsWith(id + "-")));
    let n = Math.max(0, ...reserved.map((r) => (r.id === id ? 1 : Number(r.id.slice(id.length + 1)) || 0)));
    while (n * blockUsd < usd || n === 0) { n++; if (!has("reserve", n === 1 ? id : id + "-" + n)) row("reserve", n === 1 ? id : id + "-" + n, toMicros(blockUsd), { kind_detail: detail + ", recovery block " + n }); }
    const t = totals([...rows, ...add]);
    for (const s of blockShares(t.openIds, id, blockUsd, usd)) row("settle", s.id, toMicros(s.usd), { kind_detail: detail });
  };
  if (o.vm && o.prefix) settleSeries(o.vm.id, Number(L1.vm.usdPerHour) * Number(L1.vm.reserveHours), Number(L1.vm.usdPerHour) * o.vm.hours, "VM hours: " + o.vm.hours.toFixed(6) + " h at $" + L1.vm.usdPerHour + "/h, after the host was lost");
  const hostReserve = [...rows, ...add].find((r) => r.kind === "reserve" && r.id === o.hostId);
  if (hostReserve && !has("settle", o.hostId)) row("settle", o.hostId, toMicros(L1.host.usdPerHour * o.hostHours), { kind_detail: "awake host hours: " + o.hostHours.toFixed(6) + " h at $" + L1.host.usdPerHour + "/h, until it was confirmed gone" });
  return add;
}

// What a lost host's running part left about its sessions: the closed records (proxy-sessions.jsonl rows with a final
// spend), and every session it opened (a session_open in proxy-requests.jsonl, or a session reserve on the mirror) that has
// none. An unreadable line in either file counts as missing, since it could be either.
function sessionRecords(out: string, prefix: string, mirror: Row[]) {
  const lines = (f: string) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8").split("\n").map((l, i) => [l, i + 1] as const).filter(([l]) => l.trim()) : []);
  const closed: any[] = [], missing: string[] = [], opened = new Map<string, any>();
  for (const [l, n] of lines("proxy-sessions.jsonl")) { try { const s = JSON.parse(l); if (s.closed_at && Number.isInteger(s.spent_micros)) closed.push(s); } catch { missing.push("proxy-sessions.jsonl line " + n + " is unreadable"); } }
  for (const [l, n] of lines("proxy-requests.jsonl")) { try { const e = JSON.parse(l); if (e.event === "session_open") opened.set(String(e.session), e); } catch { missing.push("proxy-requests.jsonl line " + n + " is unreadable"); } }
  for (const r of mirror) {
    const id = r.id.slice(prefix.length);
    if (r.kind === "reserve" && r.id.startsWith(prefix) && !/^vm(-\d+)?$/.test(id) && !opened.has(id)) opened.set(id, { session: id, trial: r.trial });
  }
  const done = new Set(closed.map((s) => String(s.id)));
  const open = [...opened.values()].filter((e) => !done.has(String(e.session)));
  missing.push(...open.map((e) => "session " + e.session + " (" + (e.trial ?? "no trial") + ") opened and has no closed record"));
  return { closed, open, missing };
}

// The item's ledger before its run binds: the approval row at the item's cap, and no reserve or settle rows but the
// awake hosts' (host-<n>).
export function itemCheck(rows: Row[], item: string) {
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== item) refuse("the ledger has no approval row for " + item);
  if (approval!.usd_micros !== toMicros(ITEMS[item]!.capUsd)) refuse(item + "'s cap on the ledger is $" + fromMicros(approval!.usd_micros) + ", not the $" + ITEMS[item]!.capUsd + " approvals/ records");
  if (rows.filter((r) => r.kind === "approval").length > 1) refuse(item + " holds a cap raise; L1 has no raises (prereg section 9)");
  const used = rows.filter((r) => (r.kind === "reserve" || r.kind === "settle") && !/^host-\d+$/.test(r.id));
  if (used.length) refuse(item + " already holds " + used.length + " reserve or settle rows; an item serves one run");
}

// The agent's mirror of the host's ledger only ever grows: a new copy must start with the old one byte for byte.
export function extendsMirror(old: Buffer | null, next: Buffer) {
  if (old && (next.length < old.length || !next.subarray(0, old.length).equals(old))) throw new Error("the host's ledger is not an append-only extension of the agent's mirror; nothing was overwritten");
}

// --- Host side ------------------------------------------------------------------------------------------------------

function hostEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(root, "host.env"), "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]!] = m[2]!; }
  return env;
}
const alive = (pid: number, needle: string) => { try { return readFileSync("/proc/" + pid + "/cmdline", "utf8").split("\0").join(" ").includes(needle); } catch { return false; } };
// A part's controller is alive while any process in host.sh's session is: host.sh leads its own session (setsid -f), so
// a launch.sh, or a ubi-runner call it made, that outlives host.sh still counts. launch.sh starts the ledger service and
// the batch's tunnel in sessions of their own, so they don't count; salvage stops them.
function controllerAlive(pid: number, part: string) {
  if (alive(pid, "host.sh run " + part + " ")) return true;
  return readdirSync("/proc").some((p) => {
    if (!/^\d+$/.test(p) || p === String(pid)) return false;
    let stat = "";
    try { stat = readFileSync("/proc/" + p + "/stat", "utf8"); } catch { return false; }
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[3] === String(pid);
  });
}
// The VMs whose recovery bundles in dir were written at or after sinceMs and that no one claims: a part VM that came up
// before anything recorded its name.
function unclaimedBundles(dir: string, claimed: Set<string>, sinceMs: number) {
  if (!existsSync(dir)) return [];
  const since = Math.floor(sinceMs / 1000) * 1000;
  return readdirSync(dir).filter((f) => f.endsWith(".bundle")).map((f) => f.slice(0, -".bundle".length)).filter((vm) => !claimed.has(vm) && statSync(join(dir, vm + ".bundle")).mtimeMs >= since);
}
export function portTaken(port: string) {
  return Bun.spawnSync(["bash", "-c", 'exec 3<>"/dev/tcp/127.0.0.1/$1"', "bash", port], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

// A pulled tree's files, each one's path and size in path order: host-down checks the copy at home against the host's.
export function treeDigest(dir: string) {
  const lines: string[] = [];
  const walk = (d: string, rel: string) => { for (const f of existsSync(d) ? readdirSync(d).sort() : []) { const p = join(d, f), st = statSync(p); if (st.isDirectory()) walk(p, rel + f + "/"); else lines.push(rel + f + "\t" + st.size); } };
  walk(dir, "");
  return { files: lines.length, sha256: sha256(lines.join("\n")) };
}

export function hostStatus(root: string) {
  const env = hostEnv(root);
  const ledger = env.LEDGER!;
  const work = join(root, "work");
  const parts: Record<string, unknown> = {};
  for (const f of existsSync(work) ? readdirSync(work) : []) {
    const m = /^(.+)\.controller\.json$/.exec(f);
    if (!m) continue;
    const part = m[1]!, c = readJson(join(work, f));
    const exitFile = join(work, part + ".launch-exit");
    const log = existsSync(join(work, part + ".controller.log")) ? readFileSync(join(work, part + ".controller.log"), "utf8") : "";
    const launchExit = existsSync(exitFile) ? Number(readFileSync(exitFile, "utf8").trim()) : null;
    const lock = join(work, part + ".salvage.lock"), failed = join(work, part + ".salvage-failed.json");
    parts[part] = { pid: c.pid, started_at: c.started_at, alive: launchExit === null && controllerAlive(c.pid, part), launch_exit: launchExit,
      vm: /^vm: (\S+)$/m.exec(log)?.[1] ?? null, pulled: existsSync(join(work, part, "pulled/out/vm-run.exit")), salvage: existsSync(join(work, part + ".salvage.json")) ? readJson(join(work, part + ".salvage.json")) : null,
      salvage_failed: existsSync(failed) ? readJson(failed) : null, salvaging: existsSync(lock) && alive(Number(readFileSync(lock, "utf8").trim()), "host-salvage "),
      vm_cap_stop: existsSync(join(work, part, "vm-cap-stop")) ? readFileSync(join(work, part, "vm-cap-stop"), "utf8").trim() : null };
  }
  const bytes = existsSync(ledger) ? readFileSync(ledger) : Buffer.alloc(0);
  return { now: nowSec(), item: env.ITEM, ledger: { path: ledger, sha256: sha256(bytes), bytes: bytes.length }, bound: existsSync(ledger + ".bound") ? readJson(ledger + ".bound") : null, parts, port_open: portTaken(env.LEDGER_PORT ?? L1.host.ledgerPort) };
}

function hostBind(root: string, runId: string, work: string) {
  const env = hostEnv(root);
  itemCheck(readRows(env.LEDGER!), env.ITEM!);
  try {
    writeFileSync(env.LEDGER + ".bound", JSON.stringify({ item: env.ITEM, run_id: runId, work, at: new Date().toISOString() }) + "\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const b = readJson(env.LEDGER + ".bound");
    if (b.run_id !== runId) refuse(env.ITEM + " is already bound to run " + b.run_id + " (" + b.work + "); an item serves one run");
  }
}

function secretsEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const f = join(process.env.HOME ?? "", ".l1-secrets");
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]!] = m[2]!; }
  return env;
}

// After a controller died on a live host (no launch-exit): what launch.sh would have done at its end. Stop the part's
// batch, wait for vm-run.sh to close every session, pull and count the results, stop the leftover tunnel and ledger
// service, settle sessions from the pulled rows, destroy the VM and settle its blocks at its hours since the controller
// started. A VM that won't answer is destroyed and its blocks settle the same way; its open session reserves stay open.
function hostSalvage(root: string, part: string, prefix: string) {
  const env = hostEnv(root), work = join(root, "work"), dir = join(work, part);
  const hs = hostStatus(root), st = hs.parts[part] as any;
  if (!st) refuse(part + " was never launched on this host");
  if (st.alive) refuse(part + "'s controller is still running");
  if (st.launch_exit !== null && st.launch_exit !== 7) refuse(part + "'s controller recorded exit " + st.launch_exit + "; nothing to salvage");
  const others = new Set(Object.entries(hs.parts).filter(([k]) => k !== part).map(([, s]: any) => s.vm).filter(Boolean));
  const candidates = st.vm ? [] : unclaimedBundles(join(root, "recovery", ownerTag(env.UBI_OWNER)), others, Number(st.started_at) * 1000);
  if (candidates.length > 1) refuse(part + "'s VM is unknown: " + candidates.join(", ") + " all have unclaimed recovery bundles from after its controller started");
  const vm: string | null = st.vm ?? candidates[0] ?? null;
  const ubiEnv = { ...process.env, ...secretsEnv(), UBI_OWNER: env.UBI_OWNER!, UBI_RUNNER_STATE: join(root, "ubi-state"), UBI_RECOVERY_DIR: join(root, "recovery") };
  const S = join(root, "bin/ubi-runner.sh");
  const ubi = (args: string[]) => { const p = Bun.spawnSync([S, ...args], { env: ubiEnv, stdout: "pipe", stderr: "pipe" }); return { code: p.exitCode ?? 1, out: p.stdout.toString() }; };
  const record: Record<string, unknown> = { part, at: new Date().toISOString(), vm };
  let pulled = false;
  if (vm) pulled = stopAndPull(ubi, vm, dir);
  record.pulled = pulled;
  const port = env.LEDGER_PORT ?? L1.host.ledgerPort;
  Bun.spawnSync(["pkill", "-f", "--", "-R 127.0.0.1:9911:127.0.0.1:" + port + " "]);
  Bun.spawnSync(["pkill", "-f", "--", "ledger.ts serve --path " + env.LEDGER + " --item " + env.ITEM + " --port " + port]);
  for (let i = 0; i < 150 && portTaken(port); i++) Bun.sleepSync(200);
  if (portTaken(port)) refuse("the ledger port " + port + " is still held after the leftover ledger service was stopped; run salvage again");
  const ledger = new Ledger(env.LEDGER!, env.ITEM!);
  if (pulled) record.reconcile = reconcile(ledger, readRows(join(dir, "pulled/out/proxy-sessions.jsonl")) as any[], prefix);
  if (vm) record.vm_down = ubi(["down", vm]).code === 0;
  if (vm && !record.vm_down) refuse("VM " + vm + " could not be destroyed; its blocks stay open. Run relaunch again to salvage again");
  const hours = (nowSec() - Number(st.started_at)) / 3600;
  const block = Number(env.VM_USD_PER_HOUR) * Number(env.VM_RESERVE_HOURS);
  const shares = blockShares(ledger.status().openIds, prefix + "vm", block, Number(env.VM_USD_PER_HOUR) * hours);
  for (const s of shares) ledger.settle(s.id, toMicros(s.usd), { kind_detail: "VM hours: " + hours.toFixed(6) + " h at $" + env.VM_USD_PER_HOUR + "/h, settled by salvage " + (st.launch_exit === 7 ? "of the VM launch.sh kept (exit 7)" : "after the controller was lost") });
  record.vm_hours = hours;
  record.vm_settles = shares;
  writeJsonAtomic(join(work, part + ".salvage.json"), record);
  console.log(JSON.stringify(record));
}

// Stops a part VM's batch, waits for vm-run.sh to close every session, then pulls out/ and jobs/ into <dir>/pulled: up to 3
// tries, each checked by comparing the VM's file count with the copy's. salvage on the host and recover on the agent share it.
function stopAndPull(ubi: (args: string[]) => { code: number; out: string }, vm: string, dir: string): boolean {
  if (ubi(["ssh", vm, "touch work/run/STOP"]).code !== 0) return false;
  const deadline = Date.now() + Number(process.env.L1_SALVAGE_WAIT_SEC ?? 1800) * 1000;
  while (Date.now() < deadline && ubi(["ssh", vm, "test -f work/run/out/vm-run.exit"]).code !== 0) Bun.sleepSync(Number(process.env.L1_POLL_SEC ?? 20) * 1000);
  for (let i = 0; i < 3; i++) {
    mkdirSync(join(dir, "pulled"), { recursive: true });
    const remote = ubi(["ssh", vm, "cd work/run && find out jobs -type f | wc -l"]).out.trim();
    if (ubi(["ssh", vm, "test -f work/run/out/vm-run.exit"]).code === 0 && ubi(["pull", vm, "work/run/out", join(dir, "pulled")]).code === 0 && ubi(["pull", vm, "work/run/jobs", join(dir, "pulled")]).code === 0
      && remote === Bun.spawnSync(["bash", "-c", "cd \"$1\" && find out jobs -type f | wc -l", "bash", join(dir, "pulled")]).stdout.toString().trim()) return true;
  }
  return false;
}

// relaunch starts host-salvage detached on the host and polls host-status, so no ssh call outlives ubi-runner's idle
// watchdog. One salvage runs at a time; a failure is written to <part>.salvage-failed.json for the poll to read.
function hostSalvageRecorded(root: string, part: string, prefix: string) {
  const work = join(root, "work"), lock = join(work, part + ".salvage.lock");
  try { writeFileSync(lock, String(process.pid), { flag: "wx" }); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const pid = Number(readFileSync(lock, "utf8").trim());
    if (alive(pid, "host-salvage ")) refuse(part + "'s salvage is already running (pid " + pid + ")");
    writeFileSync(lock, String(process.pid));
  }
  try { hostSalvage(root, part, prefix); }
  catch (e) { writeJsonAtomic(join(work, part + ".salvage-failed.json"), { part, at: new Date().toISOString(), error: (e as Error).message }); throw e; }
  finally { rmSync(lock, { force: true }); }
}

// --- Agent side -----------------------------------------------------------------------------------------------------

function runner() {
  const path = process.env.UBI_RUNNER ?? "", want = process.env.UBI_RUNNER_SHA256 ?? "";
  if (!path || !existsSync(path)) usage("set UBI_RUNNER to the pinned ubi-runner.sh copy");
  if (!/^[0-9a-f]{64}$/.test(want)) usage("set UBI_RUNNER_SHA256 to the sha256 recorded for that copy");
  const got = sha256File(path);
  if (got !== want) usage("UBI_RUNNER " + path + " has sha256 " + got + ", not the recorded " + want);
  if (!/^[a-z]/.test(ownerTag())) usage("set UBI_OWNER to the run thread's code");
  if (!process.env.UBI_RECOVERY_DIR) usage("set UBI_RECOVERY_DIR to a durable folder (on Capy, a private drive folder); the host and every part VM need a recovery bundle there");
  return path;
}
function ubi(args: string[], o: { input?: string; env?: Record<string, string> } = {}) {
  const p = Bun.spawnSync([runner(), ...args], { env: { ...process.env, ...o.env } as Record<string, string>, stdin: o.input === undefined ? "ignore" : Buffer.from(o.input), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
}
const must = (r: { code: number; out: string; err: string }, what: string) => { if (r.code !== 0) throw new Error(what + " failed (exit " + r.code + "): " + r.err.trim().split("\n").slice(-3).join(" | ")); return r.out; };
const H = L1.host.root;
const remoteL1 = (host: string, cmd: string) => ubi(["ssh", host, "export PATH=\"$HOME/.bun/bin:$PATH\"; " + cmd]);

const hostsFile = (work: string) => join(work, "host/hosts.jsonl");
function hosts(work: string): any[] { return readJsonl(hostsFile(work)); }
export function currentHost(work: string): any | null {
  const rows = hosts(work);
  const up = rows.filter((r) => r.event === "up").at(-1);
  if (!up || rows.some((r) => r.n === up.n && (r.event === "down" || r.event === "lost"))) return null;
  return up;
}
// A host-up that failed and whose host could not be destroyed: the host stays current until host-down confirms it gone.
const cleanupPending = (work: string, host: any) => hosts(work).some((r) => r.n === host.n && r.event === "down_failed");
function usableHost(work: string, missing: string) {
  const host = currentHost(work) ?? refuse(missing);
  if (cleanupPending(work, host)) refuse("host-up failed on " + host.name + " and its cleanup is pending; run host-down");
  return host;
}
const recordHost = (work: string, row: Record<string, unknown>) => { mkdirSync(join(work, "host"), { recursive: true }); appendFileSync(hostsFile(work), JSON.stringify({ ...row, ts: new Date().toISOString() }) + "\n"); };
const readPlan = (work: string): Plan => { if (!existsSync(join(work, "plan.json"))) usage(work + " has no plan.json; run prepare first"); return readJson(join(work, "plan.json")); };
const mirrorPath = (work: string) => join(work, "host/ledger.jsonl");
const ownerTag = (owner = process.env.UBI_OWNER ?? "") => owner.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
const bundlePath = (vm: string) => join(process.env.UBI_RECOVERY_DIR ?? "", ownerTag(), vm + ".bundle");
const pointerPath = (ledger: string) => ledger + ".host.json";
// The relaunch evidence (Amendment C's dead-part procedure), one JSON line per event in <work>/relaunch-evidence.jsonl: each
// part VM confirmed gone with the part's records not pulled, with the part's session reserves still open (they never settle
// on their own), and each part's one relaunch.
const evidencePath = (work: string) => join(work, "relaunch-evidence.jsonl");
function recordVmDeath(work: string, part: string, prefix: string, vm: string, how: string, openIds: string[]) {
  if (readJsonl(evidencePath(work)).some((e) => e.event === "vm_death" && e.part === part && e.vm === vm)) return;
  const open = openIds.filter((id) => id.startsWith(prefix) && !/^vm(-\d+)?$/.test(id.slice(prefix.length)));
  appendFileSync(evidencePath(work), JSON.stringify({ event: "vm_death", part, vm, confirmed_by: how, open_reserves: open, at: new Date().toISOString() }) + "\n");
}
const noRecord = (part: string, host: any) => part + " ended at launch.sh's exit 7 with its VM kept and no salvage, and host " + host.name + " has no record of it, so its VM can't be stopped, pulled or settled from here; it goes to the Captain";

function ledgerEnv() {
  const p = process.env.LEDGER ?? "";
  if (!p) usage("set LEDGER to the item's ledger file (the single file this run uses)");
  return resolve(p);
}

function prepare(work: string, item: string) {
  const def = ITEMS[item] ?? usage("unknown item " + item);
  if (existsSync(join(work, "plan.json"))) refuse(work + " already holds a plan");
  const ledger = ledgerEnv();
  if (existsSync(pointerPath(ledger)) || existsSync(ledger + ".bound")) refuse(ledger + " is on a host or bound to a run already");
  itemCheck(readRows(ledger), item);
  const arms = process.env.ARMS ?? usage("set ARMS to the directory holding the none, before, after and off arm tars");
  const inputs: Record<string, string> = {};
  const frozen = (f: { file: string; sha256: string }) => { const text = readFileSync(join(REPO, f.file), "utf8"); if (sha256(text) !== f.sha256) usage(f.file + " does not hash to the prereg's " + f.sha256); inputs[basename(f.file)] = f.sha256; return text; };
  let tb2Parts: string | undefined;
  if (item === "tb2-opus") {
    const f = process.env.TB2_PARTS ?? "", want = process.env.TB2_PARTS_SHA256 ?? "";
    if (!f || !/^[0-9a-f]{64}$/.test(want)) usage("set TB2_PARTS to the twin's split file and TB2_PARTS_SHA256 to the digest Amendment C pins for it");
    tb2Parts = readFileSync(f, "utf8");
    if (sha256(tb2Parts) !== want) usage(f + " does not hash to TB2_PARTS_SHA256");
    inputs["tb2-parts"] = want;
  }
  const parts = itemParts(item, { fParts: item === "f1-opus" ? frozen(L1.fParts) : undefined, pilot: item === "pilot-opus" ? frozen(L1.pilot) : undefined, tb2Parts });
  mkdirSync(work, { recursive: true });
  for (const p of parts) preparePart(work, p, def, arms);
  for (const tar of ["none", "before", "after", "off"]) { const m = join(LANEB, L1.armManifests, tar + ".json"); if (existsSync(m)) inputs["arm:" + tar] = sha256File(m); }
  const git = (args: string[]) => Bun.spawnSync(["git", "-C", REPO, ...args]).stdout.toString().trim();
  const plan: Plan = { item, run_id: randomBytes(8).toString("hex"), cap_usd: def.capUsd, model: L1.model, task_set: def.taskSet, cells: def.cells, seed: L1.seed, concurrent: L1.concurrent, parts, inputs, git_head: git(["rev-parse", "HEAD"]), host_ttl_hours: hostTtlHours(parts.length) };
  writeJson(join(work, "plan.json"), plan);
  console.log("prepared " + work + ": " + item + ", " + parts.map((p) => p.name + " (" + [...plannedCells(p).values()].reduce((a, b) => a + b, 0) + " sessions)").join(", ") + "; run " + plan.run_id + ", unbound");
}

function preparePart(work: string, p: PartPlan, def: ItemDef, arms: string) {
  const dir = join(work, p.name);
  const tasks = [...new Set(p.rects.flatMap((x) => x.tasks))];
  const labels = [...new Set(p.rects.flatMap((x) => x.arms))];
  const env = { ...process.env, TASK_SET: def.taskSet, CELLS: def.cells, ARM_MANIFESTS: L1.armManifests, TASKS: tasks.join(",") };
  const attempts = String(Math.max(...p.rects.map((x) => x.attempts)));
  const r = Bun.spawnSync([process.execPath, process.env.L1_PREPARE_RUN ?? join(LANEB, "runner/prepare-run.ts"), dir, p.name.replace(/[^a-z0-9-]/g, "-"), L1.model, labels.map((a) => ARM_SPECS[a]!).join(","), arms, attempts, String(L1.concurrent)], { env: env as Record<string, string>, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error("prepare-run for " + p.name + " exited " + r.exitCode);
  const jobs = splitJobs(readJson(join(dir, "job.json")), p.rects);
  jobs.forEach((j, i) => writeJson(join(dir, jobFile(i)), j));
  writeFileSync(join(dir, "STOP_ON_CAP"), "");
  writeJson(join(dir, "l1-part.json"), p);
}

function mirror(work: string, host: any) {
  const tmp = mkdtempSync(join(tmpdir(), "l1-mirror-"));
  try {
    must(ubi(["pull", host.name, H + "/ledger", tmp]), "pulling the host's ledger");
    const plan = readPlan(work);
    const next = readFileSync(join(tmp, "ledger", plan.item + ".jsonl"));
    const old = existsSync(mirrorPath(work)) ? readFileSync(mirrorPath(work)) : null;
    extendsMirror(old, next);
    writeFileSync(mirrorPath(work) + ".tmp", next);
    renameSync(mirrorPath(work) + ".tmp", mirrorPath(work));
    const bound = join(tmp, "ledger", plan.item + ".jsonl.bound");
    if (existsSync(bound)) copyFileSync(bound, join(work, "host/bound.json"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

function copyBundles(host: any) {
  const tmp = mkdtempSync(join(tmpdir(), "l1-bundles-"));
  try {
    must(ubi(["pull", host.name, H + "/recovery", tmp]), "pulling the part VMs' recovery bundles");
    const src = join(tmp, "recovery");
    if (!existsSync(src)) return 0;
    let n = 0;
    for (const owner of readdirSync(src)) for (const b of readdirSync(join(src, owner))) {
      const dest = join(process.env.UBI_RECOVERY_DIR!, owner, b);
      if (existsSync(dest)) continue;
      mkdirSync(join(process.env.UBI_RECOVERY_DIR!, owner), { recursive: true });
      copyFileSync(join(src, owner, b), dest);
      n++;
    }
    return n;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

function status(host: any): any {
  const r = remoteL1(host.name, "bun " + H + "/laneb/l1/l1.ts host-status " + H);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.out.trim().split("\n").at(-1)!); } catch { return null; }
}

function hostUp(work: string) {
  const plan = readPlan(work);
  refuseEnded(work, plan);
  if (currentHost(work)) refuse("host " + currentHost(work).name + " is already up for " + work);
  const ledger = ledgerEnv();
  if (existsSync(pointerPath(ledger))) refuse(ledger + " is on a host already (" + pointerPath(ledger) + ")");
  const rows = readRows(ledger);
  const bound = existsSync(ledger + ".bound") ? readJson(ledger + ".bound") : null;
  if (bound && bound.run_id !== plan.run_id) refuse(plan.item + " is bound to run " + bound.run_id + ", not " + plan.run_id);
  if (!bound) itemCheck(rows, plan.item);
  if (!process.env.UBICLOUD_API_KEY && !process.env.UBICLOUD_API_TOKEN) usage("set UBICLOUD_API_KEY");
  if (!process.env.ANTHROPIC_API_KEY) usage("set ANTHROPIC_API_KEY; the host passes it to each part VM's metering proxy");
  if (process.env.UBI_RECOVERY_KEY) refuse("UBI_RECOVERY_KEY is set, but the host seals part-VM recovery bundles with UBICLOUD_API_KEY, so recover could not open them; unset it");
  runner();
  const n = new Set(hosts(work).map((r) => r.n)).size + 1;
  mkdirSync(join(work, "host"), { recursive: true });
  writeJson(join(work, "host/pointer"), { ledger });
  const ttl = plan.host_ttl_hours;
  const id = "host-" + n, usd = Math.round(ttl * L1.host.usdPerHour * 1e6) / 1e6;
  const res = new Ledger(ledger, plan.item).reserve(id, toMicros(usd), { kind_detail: "awake host hours: " + ttl + " h TTL at $" + L1.host.usdPerHour + "/h (" + L1.host.size + ")" });
  if (!res.ok || res.existing) { console.error("CAP_STOP the ledger refused the awake host's reserve of $" + usd + " for " + plan.item + "; no host started (cap stop)"); process.exit(9); }
  const upAt = nowSec();
  const up = ubi(["up", "-s", L1.host.size], { env: { UBI_TTL_HOURS: String(ttl), UBI_COUNTED: "1" } });
  const name = up.code === 0 ? up.out.trim().split("\n").at(-1)! : "";
  const fail = (e: unknown) => {
    const down = name ? ubi(["down", name]).code === 0 : true;
    const hours = (nowSec() - upAt) / 3600;
    if (down) new Ledger(ledger, plan.item).settle(id, toMicros(L1.host.usdPerHour * hours), { kind_detail: "awake host hours: " + hours.toFixed(6) + " h; host-up failed" });
    recordHost(work, { event: down ? "down" : "down_failed", n, name, failed: String(e).slice(0, 300), down_confirmed: down, hours });
    throw e;
  };
  if (!name) fail(new Error("ubi-runner up failed: " + up.err.trim().split("\n").slice(-3).join(" | ")));
  recordHost(work, { event: "up", n, name, up_at: upAt, ttl_hours: ttl, reserve_id: id, reserve_usd: usd, runner_sha256: process.env.UBI_RUNNER_SHA256, size: L1.host.size });
  try {
    must(ubi(["sync", name, LANEB, H + "/laneb"]), "syncing quick/laneb to the host");
    const bin = mkdtempSync(join(tmpdir(), "l1-bin-"));
    copyFileSync(runner(), join(bin, "ubi-runner.sh"));
    must(ubi(["sync", name, bin, H + "/bin"]), "syncing the pinned ubi-runner");
    rmSync(bin, { recursive: true, force: true });
    const shaOut = must(remoteL1(name, "bash " + H + "/laneb/l1/host-bootstrap.sh >&2 && chmod +x " + H + "/bin/ubi-runner.sh && sha256sum " + H + "/bin/ubi-runner.sh"), "bootstrapping the host");
    if (!shaOut.includes(process.env.UBI_RUNNER_SHA256!)) throw new Error("the host's ubi-runner copy does not hash to UBI_RUNNER_SHA256");
    const secrets = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "UBICLOUD_API_KEY"].map((k) => k + "=" + (process.env[k] ?? (k === "UBICLOUD_API_KEY" ? process.env.UBICLOUD_API_TOKEN ?? "" : ""))).join("\n") + "\n";
    must(ubi(["ssh", name, "umask 077; cat > ~/.l1-secrets"], { input: secrets }), "writing the host's secrets file");
    const hostEnvText = ["ITEM=" + plan.item, "LEDGER=$HOME/" + H + "/ledger/" + plan.item + ".jsonl", "LEDGER_PORT=" + (process.env.L1_HOST_LEDGER_PORT ?? L1.host.ledgerPort), "CAP_USD=" + plan.cap_usd, "VM_USD_PER_HOUR=" + L1.vm.usdPerHour, "VM_RESERVE_HOURS=" + L1.vm.reserveHours, "UBI_TTL_HOURS=" + L1.vm.ttlHours, "UBI_OWNER=" + process.env.UBI_OWNER].join("\n") + "\n";
    must(ubi(["ssh", name, "mkdir -p " + H + "/work " + H + "/recovery " + H + "/ubi-state && cat > " + H + "/host.env.in && sed \"s#\\$HOME#$HOME#\" " + H + "/host.env.in > " + H + "/host.env"], { input: hostEnvText }), "writing host.env");
    const stage = mkdtempSync(join(tmpdir(), "l1-ledger-"));
    copyFileSync(ledger, join(stage, plan.item + ".jsonl"));
    if (bound) copyFileSync(ledger + ".bound", join(stage, plan.item + ".jsonl.bound"));
    const want = sha256File(ledger);
    must(ubi(["sync", name, stage, H + "/ledger"]), "moving the ledger onto the host");
    rmSync(stage, { recursive: true, force: true });
    const got = must(remoteL1(name, "sha256sum " + H + "/ledger/" + plan.item + ".jsonl"), "checking the moved ledger");
    if (!got.startsWith(want)) throw new Error("the ledger on the host does not hash to the one moved");
    if (existsSync(mirrorPath(work))) renameSync(mirrorPath(work), mirrorPath(work) + ".before-host-" + n);
    moveFile(ledger, mirrorPath(work));
    if (bound) { copyFileSync(ledger + ".bound", join(work, "host/bound.json")); rmSync(ledger + ".bound"); }
    writeJson(pointerPath(ledger), { item: plan.item, run_id: plan.run_id, work: resolve(work), host: name, path: "~/" + H + "/ledger/" + plan.item + ".jsonl", sha256_at_move: want, moved_at: new Date().toISOString(), mirror: mirrorPath(work) });
  } catch (e) { fail(e); }
  console.log("host " + name + " is up (" + L1.host.size + ", TTL " + ttl + " h, $" + usd + " reserved as " + id + " on " + plan.item + "); the ledger lives on it now");
}

// Every part in run order, each followed by its relaunch once one is prepared.
function partState(work: string, plan: Plan) {
  const all = plan.parts.flatMap((p) => [p, ...(existsSync(join(work, p.name + "-relaunch", "l1-part.json")) ? [readJson(join(work, p.name + "-relaunch", "l1-part.json")) as PartPlan] : [])]);
  return all.map((p) => ({ part: p, launched: existsSync(join(work, p.name + ".launch.json")), result: existsSync(join(work, p.name + ".result.json")) ? readJson(join(work, p.name + ".result.json")) : null, relaunch: existsSync(join(work, p.name + ".relaunch.json")) ? readJson(join(work, p.name + ".relaunch.json")) : null }));
}

// The item has ended incomplete (prereg section 6): recover could not rebuild the ledger after the host was lost, a part
// ended at a cap stop, or a part ended in a way the prereg does not class. Nothing more starts for it; host-down is still
// allowed.
function itemEnded(work: string, plan: Plan): string | null {
  const rec = join(work, "host/recover.json");
  if (existsSync(rec) && readJson(rec).complete === false) return "the host was lost and recover could not rebuild the ledger (host/recover.json)";
  const states = partState(work, plan);
  const cap = states.find((s) => s.result?.cap_stop?.length);
  if (cap) return cap.part.name + " ended at a cap stop (" + cap.result.cap_stop[0] + "), and a cap stop is never relaunched";
  const held = states.find((s) => s.result?.unclassified?.length);
  return held ? held.part.name + " ended in a way the prereg does not class (" + held.result.unclassified[0] + "), so nothing more starts until Amendment C classes it" : null;
}
function refuseEnded(work: string, plan: Plan) {
  const ended = itemEnded(work, plan);
  if (ended) refuse(plan.item + " has ended incomplete: " + ended + ". Nothing more starts for it; it goes to the Captain");
}

function launchDir(work: string, plan: Plan, host: any, part: PartPlan) {
  const st = status(host) ?? refuse("host " + host.name + " did not answer; run attach");
  const running = Object.entries(st.parts).filter(([, s]: any) => s.alive || (s.launch_exit === null && !s.salvage));
  if (running.length) refuse(running.map(([k]) => k).join(", ") + " has a controller that has not finished; parts run one after another");
  if (st.parts[part.name]) refuse(part.name + " was launched already");
  if (st.port_open) refuse("the ledger port on " + host.name + " is held, so a ledger service is still serving; parts run one after another");
  const left = host.up_at + host.ttl_hours * 3600 - nowSec();
  if (left < L1.host.launchHours * 3600) refuse("host " + host.name + " has " + (left / 3600).toFixed(1) + " h of its TTL left, under the " + L1.host.launchHours + " h a launch needs; run host-down, then host-up");
  mirror(work, host);
  if (!st.bound) must(remoteL1(host.name, "bun " + H + "/laneb/l1/l1.ts host-bind " + H + " " + plan.run_id + " " + JSON.stringify(resolve(work))), "binding the run on the host");
  else if (st.bound.run_id !== plan.run_id) refuse(plan.item + " is bound to run " + st.bound.run_id);
  must(ubi(["sync", host.name, join(work, part.name), H + "/work/" + part.name]), "syncing " + part.name);
  const lp = join(work, part.name + ".launch.json"), at = new Date().toISOString();
  writeJson(lp, { part: part.name, prefix: part.prefix, host: host.name, at });
  const start = ubi(["ssh", host.name, "setsid -f bash " + H + "/laneb/l1/host.sh run " + part.name + " " + part.prefix + " " + plan.cap_usd + " > " + H + "/work/" + part.name + ".controller.log 2>&1 < /dev/null"]);
  if (start.code !== 0) {
    const after = status(host);
    if (after && !after.parts[part.name]) { rmSync(lp); throw new Error("starting " + part.name + "'s controller failed (exit " + start.code + "): " + start.err.trim().split("\n").slice(-3).join(" | ")); }
    if (!after) throw new Error("starting " + part.name + "'s controller exited " + start.code + " and the host did not answer after it; launch.json stays, so attach or recover treats the part as started");
  }
  const deadline = Date.now() + Number(process.env.L1_BUNDLE_WAIT_SEC ?? L1.bundleWaitSec) * 1000;
  let s: any = null;
  while (Date.now() < deadline) {
    s = status(host)?.parts?.[part.name];
    if (s?.vm) { copyBundles(host); if (existsSync(bundlePath(s.vm))) break; }
    if (s && s.launch_exit !== null) break;
    Bun.sleepSync(Number(process.env.L1_POLL_SEC ?? 10) * 1000);
  }
  if (s) writeJson(lp, { part: part.name, prefix: part.prefix, host: host.name, at, controller_started_at: s.started_at, vm: s.vm });
  mirror(work, host);
  console.log(part.name + ": controller started on " + host.name + (s?.vm ? ", part VM " + s.vm + " (recovery bundle copied)" : "; no part VM yet, attach will copy its bundle"));
}

function launch(work: string, partName: string) {
  const plan = readPlan(work);
  refuseEnded(work, plan);
  const host = usableHost(work, "no host is up; run host-up");
  let states = partState(work, plan);
  const i = states.findIndex((s) => s.part.name === partName);
  if (i < 0) usage(partName + " is not a part of " + plan.item + " (" + plan.parts.map((p) => p.name).join(", ") + ") or a prepared relaunch");
  if (states[i]!.launched) refuse(partName + " was launched already");
  // An earlier part launch.sh kept at exit 7 (a relaunch has no relaunch of its own) still holds a VM with its results:
  // salvage it and finish it again from what the salvage pulled before the next part starts.
  const kept = states.slice(0, i).filter((s) => s.result?.launch_exit === 7 && !s.result.salvage);
  if (kept.length) {
    let st = status(host) ?? refuse("host " + host.name + " did not answer; run attach");
    const orphan = kept.find((s) => !st.parts[s.part.name]);
    if (orphan) refuse(noRecord(orphan.part.name, host));
    for (const s of kept) if (!st.parts[s.part.name].salvage) st = salvageOnHost(host, s.part.name, s.part.prefix, st.parts[s.part.name], "launch");
    mirror(work, host);
    for (const s of kept) finishPart(work, host, st, s.part.name, plan);
    refuseEnded(work, plan);
    states = partState(work, plan);
  }
  for (const s of states.slice(0, i)) {
    if (!s.launched || !s.result) refuse(s.part.name + " has not finished; parts run one after another");
    if (s.result.loss.length && !s.part.relaunch_of && !s.relaunch) refuse(s.part.name + " ended with a loss (" + s.result.loss[0] + "); run relaunch for it first");
  }
  launchDir(work, plan, host, states[i]!.part);
}

function finishPart(work: string, host: any, st: any, name: string, plan: Plan) {
  const s = st.parts[name];
  const dir = join(work, name);
  if (s.pulled) must(ubi(["pull", host.name, H + "/work/" + name + "/pulled", dir]), "pulling " + name + "'s results");
  if (s.vm_cap_stop) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "vm-cap-stop"), s.vm_cap_stop + "\n"); }
  const ledger = s.launch_exit === 7 && !s.salvage ? undefined : { rows: readRows(mirrorPath(work)), since: readJson(join(work, name + ".launch.json")).at, sessionCapUsd: ITEMS[plan.item]!.allowanceUsd };
  const result = { ...classify(dir, s.launch_exit, { controllerLost: s.launch_exit === null, ledger }), salvage: s.salvage, at: new Date().toISOString() };
  writeJson(join(work, name + ".result.json"), result);
  if (s.salvage?.vm && s.salvage.vm_down && !s.salvage.pulled) recordVmDeath(work, name, readJson(join(work, name + ".launch.json")).prefix, s.salvage.vm, "ubi-runner down by the salvage on host " + host.name + ", which could not pull the part's records", totals(readRows(mirrorPath(work))).openIds);
  return result;
}

function attach(work: string) {
  const plan = readPlan(work);
  const host = currentHost(work);
  if (!host) { console.log("NEXT: " + nextWithoutHost(work, plan)); return; }
  if (cleanupPending(work, host)) { console.log("NEXT: host-down (cleanup of a failed host-up is pending)"); return; }
  const st = status(host);
  const unreachable = join(work, "host/unreachable.jsonl");
  if (!st) {
    if (ubi(["ssh", host.name, "true"]).code === 0) refuse("host " + host.name + " answers ssh but host-status failed on it, so it is not lost and no miss is counted; check ~/" + H + " on it");
    appendFileSync(unreachable, JSON.stringify({ host: host.name, at: nowSec() }) + "\n");
    const misses = readJsonl(unreachable).filter((r) => r.host === host.name);
    const span = (misses.at(-1).at - misses[0].at) / 60;
    if (misses.length >= L1.unreachable.tries && span >= Number(process.env.L1_UNREACHABLE_MINUTES ?? L1.unreachable.minutes)) { console.log("HOST_LOST: " + host.name + " has not answered " + misses.length + " times over " + span.toFixed(0) + " min. NEXT: recover"); process.exit(5); }
    console.log("host " + host.name + " did not answer (" + misses.length + " of " + L1.unreachable.tries + "); NEXT: attach again");
    return;
  }
  rmSync(unreachable, { force: true });
  mirror(work, host);
  copyBundles(host);
  const lines: string[] = [];
  for (const s of partState(work, plan)) {
    const h = st.parts[s.part.name];
    if (!h) continue;
    if (s.launched) {
      const lp = join(work, s.part.name + ".launch.json"), l = readJson(lp);
      const want = { ...l, controller_started_at: h.started_at ?? l.controller_started_at, vm: h.vm ?? l.vm };
      if (want.vm !== l.vm || want.controller_started_at !== l.controller_started_at) writeJson(lp, want);
    }
    if (h.alive) { lines.push(s.part.name + ": running (controller pid " + h.pid + ", VM " + (h.vm ?? "not up yet") + ")"); continue; }
    if (s.result) continue;
    if (h.launch_exit === null && !h.salvage) { lines.push(s.part.name + ": CONTROLLER_LOST (no exit recorded). NEXT: relaunch --part " + s.part.name + " (it salvages first)"); continue; }
    const r = finishPart(work, host, st, s.part.name, plan);
    lines.push(s.part.name + ": finished, launch exit " + r.launch_exit + (r.cap_stop.length ? "; CAP STOP: " + r.cap_stop.join("; ") : "") + (r.loss.length ? "; LOSS: " + r.loss.join("; ") : "") + (r.unclassified.length ? "; UNCLASSIFIED: " + r.unclassified.join("; ") : ""));
  }
  mirror(work, host);
  const t = totals(readRows(mirrorPath(work)));
  lines.push(plan.item + " ledger (mirror): settled $" + fromMicros(t.settledMicros).toFixed(2) + ", open reserves $" + fromMicros(t.openReservedMicros).toFixed(2) + " in " + t.openIds.length + ", cap $" + fromMicros(t.capMicros));
  lines.push("host " + host.name + ": " + ((host.up_at + host.ttl_hours * 3600 - nowSec()) / 3600).toFixed(1) + " h of TTL left");
  lines.push("NEXT: " + next(work, plan));
  console.log(lines.join("\n"));
}

// With no host up: nothing when the item has ended or every part has finished, else host-up and then the next step.
function nextWithoutHost(work: string, plan: Plan) {
  const ended = itemEnded(work, plan);
  if (ended) return "none: " + plan.item + " ended incomplete (" + ended + ") and goes to the Captain";
  const n = next(work, plan);
  return n.startsWith("host-down") ? "none: every part has finished" : "host-up, then " + n;
}

function next(work: string, plan: Plan): string {
  const states = partState(work, plan);
  for (const s of states) {
    if (!s.launched) return "launch --part " + s.part.name;
    if (!s.result) return "attach again (" + s.part.name + " is running)";
    if (s.result.cap_stop.length) return "host-down: " + s.part.name + " ended at a cap stop, so " + plan.item + " ends incomplete and goes to the Captain";
    if (s.result.unclassified?.length) return "host-down: " + s.part.name + " ended in a way the prereg does not class, so " + plan.item + " stops and goes to the Captain";
    if (s.result.loss.length && !s.part.relaunch_of && !s.relaunch) return "relaunch --part " + s.part.name;
  }
  return "host-down (every part has finished)";
}

// Salvages a lost controller's part, or a part VM launch.sh kept at exit 7: host-salvage runs detached on the host and
// this polls host-status, so no ssh call outlives ubi-runner's idle watchdog.
function salvageOnHost(host: any, partName: string, prefix: string, h: any, again: string): any {
  if (!h.salvaging) must(remoteL1(host.name, "rm -f " + H + "/work/" + partName + ".salvage-failed.json && setsid -f bun " + H + "/laneb/l1/l1.ts host-salvage " + H + " " + partName + " " + prefix + " > " + H + "/work/" + partName + ".salvage.log 2>&1 < /dev/null"), "starting " + partName + "'s salvage");
  const deadline = Date.now() + (Number(process.env.L1_SALVAGE_WAIT_SEC ?? 1800) + 600) * 1000;
  for (;;) {
    const st = status(host) ?? refuse("host " + host.name + " did not answer during " + partName + "'s salvage; run " + again + " again, which waits for it");
    const s = st.parts[partName];
    if (s.salvage) return st;
    if (s.salvage_failed && !s.salvaging) refuse(partName + "'s salvage failed: " + s.salvage_failed.error + "; run " + again + " again");
    if (Date.now() > deadline) refuse(partName + "'s salvage has not finished; run " + again + " again, which waits for it");
    Bun.sleepSync(Number(process.env.L1_POLL_SEC ?? 20) * 1000);
  }
}

function relaunch(work: string, partName: string) {
  const plan = readPlan(work);
  const part = plan.parts.find((p) => p.name === partName) ?? usage(partName + " is not a part of " + plan.item + "; a relaunch is never relaunched");
  if (existsSync(join(work, partName + ".relaunch.json")) || readJsonl(evidencePath(work)).some((e) => e.event === "relaunch" && e.part === partName)) refuse(partName + " was relaunched already; the prereg allows one relaunch");
  refuseEnded(work, plan);
  const host = usableHost(work, "no host is up; run host-up (after recover, if the host was lost)");
  let st = status(host) ?? refuse("host " + host.name + " did not answer; run attach");
  const h = st.parts[partName];
  if (h && h.alive) refuse(partName + "'s controller is still running");
  const earlier = existsSync(join(work, partName + ".result.json")) ? readJson(join(work, partName + ".result.json")) : null;
  if (!h && earlier?.launch_exit === 7 && !earlier.salvage) refuse(noRecord(partName, host));
  const salvaged = h && (h.launch_exit === null || h.launch_exit === 7);
  if (salvaged && !h.salvage) st = salvageOnHost(host, partName, part.prefix, h, "relaunch");
  mirror(work, host);
  // A result written before the salvage is stale: what the salvage pulled may hold a cap stop the first pull missed.
  const prior = existsSync(join(work, partName + ".result.json")) ? readJson(join(work, partName + ".result.json")) : null;
  if (!prior || (salvaged && !prior.salvage)) {
    if (!st.parts[partName]) refuse(partName + " was never launched on " + host.name + " and has no recorded result");
    finishPart(work, host, st, partName, plan);
  }
  const result = readJson(join(work, partName + ".result.json"));
  if (result.cap_stop.length) refuse(partName + " ended at a cap stop (" + result.cap_stop[0] + "); a cap stop is never relaunched");
  if (result.unclassified?.length) refuse(partName + " ended in a way the prereg does not class (" + result.unclassified[0] + "); it is never relaunched");
  if (!result.loss.length) refuse(partName + " ended with no loss; its unstarted cells are infra, never relaunched");
  const proxy = readJsonl(join(work, partName, "pulled/out/proxy-sessions.jsonl"));
  const refs = sessionRefs(readRows(mirrorPath(work)), part.prefix, proxy);
  const cells = startedCells(part, refs, trialTasksFrom(join(work, partName, "pulled/jobs")));
  const rects = relaunchRects(cells.neverStarted);
  const record = { part: partName, loss: result.loss, never_started: cells.neverStarted, strays: cells.strays, rects, at: new Date().toISOString() };
  const evidence = JSON.stringify({ event: "relaunch", part: partName, relaunch: rects.length ? partName + "-relaunch" : null, host: host.name, loss: result.loss, vm_deaths: readJsonl(evidencePath(work)).filter((e) => e.event === "vm_death" && e.part === partName).map((e) => e.vm), replicates: cells.neverStarted.reduce((n, c) => n + c.replicates, 0), at: record.at }) + "\n";
  if (!rects.length) { writeJson(join(work, partName + ".relaunch.json"), { ...record, launched: false }); appendFileSync(evidencePath(work), evidence); console.log(partName + ": every planned cell started; nothing to relaunch"); return; }
  const rp: PartPlan = { name: partName + "-relaunch", prefix: prefixOf(plan.item, partName + "-relaunch"), rects, relaunch_of: partName };
  preparePart(work, rp, ITEMS[plan.item]!, process.env.ARMS ?? usage("set ARMS to the arm tar directory"));
  writeJson(join(work, partName + ".relaunch.json"), { ...record, launched: true });
  appendFileSync(evidencePath(work), evidence);
  launchDir(work, plan, host, rp);
}

function recover(work: string) {
  const plan = readPlan(work);
  const host = usableHost(work, "no host is up, so none is lost");
  if (status(host)) refuse("host " + host.name + " answers; run attach");
  if (ubi(["ssh", host.name, "true"]).code === 0) refuse("host " + host.name + " answers ssh, so it is not lost and nothing is destroyed; host-status fails on it. Check ~/" + H + " on it");
  if (!existsSync(mirrorPath(work))) refuse("no ledger mirror in " + work + "; nothing to rebuild from");
  // The part VMs an earlier run of recover saw gone, each with its part: ubi-runner reports RECOVER_GONE once and drops the
  // bundle, and its down drops the VM's local state and bundle, so a rerun after a refusal or a crash learns them only from
  // this file, the VM of a part launch.json names none for included. confirmed_at is when ubi-runner down confirmed the VM
  // gone, and seen_at when recover first saw it gone. The earlier shapes named RECOVER_GONE VMs only: {vm, at} and {vms: [names]}.
  const goneFile = join(work, "host/part-vm-gone.json");
  type Gone = { part?: string; vm: string; pulled: boolean; how: string; seen_at?: number; confirmed_at?: number };
  let done: Gone[] = [];
  if (existsSync(goneFile)) {
    let seen: any;
    try { seen = readJson(goneFile); } catch { seen = null; }
    const list = seen && typeof seen === "object" ? (seen.vms ?? (typeof seen.vm === "string" ? [seen.vm] : null)) : null;
    if (!Array.isArray(list) || !list.every((d) => typeof d === "string" || (d && typeof d === "object" && typeof d.vm === "string" && typeof d.how === "string")))
      refuse("host/part-vm-gone.json in " + work + " is unreadable or has an unknown shape, so the part VMs an earlier recover saw gone can't be told; nothing was destroyed. Restore it or move it aside after checking ubi-runner list --mine, then run recover again");
    done = list.map((d: any) => (typeof d === "string" ? { vm: d, pulled: false, how: "RECOVER_GONE" } : { ...d, pulled: d.pulled === true }));
  }
  const markGone = (p: { name: string; vm: string | null; pulled: boolean }, how: string, when: { seen_at?: number; confirmed_at?: number } = {}) => {
    done = [...done.filter((d) => d.vm !== p.vm), { part: p.name, vm: p.vm!, pulled: p.pulled, how, ...when }];
    writeJsonAtomic(goneFile, { vms: done, at: nowSec() });
  };
  const states = partState(work, plan);
  const running = states.find((s) => s.launched && !s.result);
  // Every part whose VM may still run under the lost host: the running part, and each part launch.sh kept at exit 7 that no
  // salvage reached. Each one's VM is stopped, pulled and destroyed, and the part is classified again with the ledger check.
  const held = states.filter((s) => s === running || (s.launched && s.result?.launch_exit === 7 && !s.result.salvage));
  const claimed = new Set([...hosts(work).map((r) => r.name), ...states.filter((s) => s.launched).map((s) => readJson(join(work, s.part.name + ".launch.json")).vm), ...done.map((d) => d.vm)]);
  const parts = held.map((s) => {
    const l = readJson(join(work, s.part.name + ".launch.json"));
    const entry = l.vm ? undefined : done.find((d) => d.part === s.part.name);
    const found = l.vm || entry ? [] : unclaimedBundles(join(process.env.UBI_RECOVERY_DIR ?? "", ownerTag()), claimed, Date.parse(l.at));
    return { s, l, name: s.part.name as string, vm: (l.vm ?? entry?.vm ?? (found.length === 1 ? found[0] : null)) as string | null, how: null as string | null, pulled: false, missing: [] as string[] };
  });
  const picked = parts.filter((p) => !p.l.vm && p.vm).map((p) => p.vm);
  for (const p of parts) if (!p.l.vm && picked.filter((v) => v === p.vm).length > 1) p.vm = null;
  // A part VM nothing names may still be running, so the host stays until ubi-runner lists no VM of this owner that no host
  // or part names.
  const unknown = parts.filter((p) => !p.vm).map((p) => p.name).join(", ");
  if (unknown) {
    const ls = ubi(["list", "--mine"]);
    if (ls.code !== 0) refuse("the VM of " + unknown + " is unknown and ubi-runner list --mine failed (exit " + ls.code + "), so it may still be running; nothing was destroyed. Run recover again");
    const named = new Set([...claimed, ...parts.map((p) => p.vm)]);
    const strays = ls.out.split("\n").map((x) => x.trim().split(/\s+/).at(-1) ?? "").filter((n) => n && !named.has(n));
    if (strays.length) refuse("the VM of " + unknown + " is unknown, and ubi-runner lists VMs of this owner that no host or part names (" + strays.join(", ") + "), so it may still be running; nothing was destroyed. Destroy each one that is this run's with ubi-runner down <vm>, then run recover again");
  }
  const state = process.env.UBI_RUNNER_STATE ?? join(process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? "", ".local/state"), "ubi-runner");
  if (parts.some((p) => p.vm)) {
    const rec = ubi(["recover"]);
    for (const p of parts) {
      const d = done.find((x) => x.vm === p.vm);
      if (d) Object.assign(p, { how: d.how, pulled: d.pulled });
      else if (p.vm && !existsSync(join(state, p.vm)) && rec.out.split("\n").some((x) => x.trim() === "RECOVER_GONE: vm=" + p.vm)) { p.how = "RECOVER_GONE"; markGone(p, p.how, { seen_at: nowSec() }); }
    }
    const stateless = parts.find((p) => p.vm && !p.how && !existsSync(join(state, p.vm)));
    if (stateless) refuse("ubi-runner recover (exit " + rec.code + ") left no local state for part VM " + stateless.vm + ": " + (rec.err || rec.out).trim().split("\n").slice(-2).join(" | ") + "; nothing was destroyed. Fix it, then run recover again");
  }
  const down = ubi(["down", host.name]);
  if (down.code !== 0) refuse("host " + host.name + " could not be confirmed gone (ubi-runner down exit " + down.code + "); run recover again");
  const goneAt = nowSec();
  const rows = readRows(mirrorPath(work));
  const add: Row[] = [];
  const at = new Date().toISOString(), hostHours = (goneAt - host.up_at) / 3600;
  for (const p of parts) {
    const dir = join(work, p.name), prefix = p.s.part.prefix;
    let vm: { id: string; hours: number } | undefined, sessions: any[] | undefined, open: any[] | undefined;
    if (p.vm && p.how !== "RECOVER_GONE" && !done.find((d) => d.vm === p.vm)?.confirmed_at) {
      if (!p.pulled && existsSync(join(state, p.vm))) p.pulled = stopAndPull(ubi, p.vm, dir);
      p.how = "down";
      markGone(p, p.how);
      if (ubi(["down", p.vm]).code !== 0) refuse("part VM " + p.vm + " could not be confirmed gone; run recover again");
      markGone(p, p.how, { confirmed_at: nowSec() });
    }
    // A part VM's hours run to the down that confirmed it gone, or for RECOVER_GONE to when recover first saw it gone, even
    // on a rerun; a VM with neither recorded (an earlier shape of the file) is charged up to now, an upper bound.
    const gone = done.find((d) => d.vm === p.vm);
    if (p.vm) vm = { id: prefix + "vm", hours: ((gone?.confirmed_at ?? gone?.seen_at ?? nowSec()) - Number(p.l.controller_started_at ?? Date.parse(p.l.at) / 1000)) / 3600 };
    if (p.pulled) ({ closed: sessions, open, missing: p.missing } = sessionRecords(join(dir, "pulled/out"), prefix, rows));
    add.push(...restoreRows([...rows, ...add], { item: plan.item, prefix, sessions, open, vm, hostId: host.reserve_id, hostHours, at }));
    if (p.vm && !p.pulled) recordVmDeath(work, p.name, prefix, p.vm, p.how === "RECOVER_GONE" ? "ubi-runner recover reported it gone (RECOVER_GONE)" : "recover could not pull its records, and ubi-runner down confirmed it gone", totals([...rows, ...add]).openIds);
  }
  add.push(...restoreRows([...rows, ...add], { item: plan.item, hostId: host.reserve_id, hostHours, at }));
  const mirrorSha = sha256File(mirrorPath(work));
  const restored = mirrorPath(work) + ".restored";
  copyFileSync(mirrorPath(work), restored);
  for (const r of add) appendRow(restored, r);
  const from = parts.length ? parts.map((p) => p.name + " from " + (p.pulled ? "the part VM's pulled records" + (p.missing.length ? ", which miss " + p.missing.length + " session records" : "") : "nothing: the part VM's records were lost too")).join("; ") : "no running part";
  appendRow(restored, { ts: at, item: plan.item, kind: "note", id: "host-lost-" + host.n, usd_micros: 0, detail: "host " + host.name + " was lost; rows after the agent's last mirror were rebuilt: " + from });
  const ledger = resolve(readJson(join(work, "host/pointer")).ledger);
  moveFile(restored, ledger);
  if (existsSync(join(work, "host/bound.json"))) copyFileSync(join(work, "host/bound.json"), ledger + ".bound");
  rmSync(pointerPath(ledger), { force: true });
  recordHost(work, { event: "lost", n: host.n, name: host.name, down_confirmed_at: goneAt, rows_added: add.length });
  const checked = [...rows, ...add.filter((x) => x.kind === "reserve"), ...add.filter((x) => x.kind !== "reserve")];
  for (const p of parts) {
    const ledgerCheck = { rows: checked, since: p.l.at, sessionCapUsd: ITEMS[plan.item]!.allowanceUsd };
    const salvage = p.s === running ? {} : { salvage: { by: "recover", vm: p.vm, vm_gone: p.how === "RECOVER_GONE", pulled: p.pulled, vm_down: !!p.vm, at } };
    writeJson(join(work, p.name + ".result.json"), { ...classify(join(work, p.name), p.s === running ? null : 7, { hostLost: true, ledger: ledgerCheck }), ...salvage, at });
  }
  const run = parts.find((p) => p.s === running);
  // The running part's rows after the last mirror live only in its records. A kept part's rows were all on the mirror before
  // its launch.sh exited, so it ends the item only when its VM is unknown; otherwise it is a salvage like the host's.
  const complete = parts.every((p) => (p === run ? p.pulled && !p.missing.length : !!p.vm));
  writeJson(join(work, "host/recover.json"), { host: host.name, down_confirmed_at: goneAt, mirror_sha256: mirrorSha, running: running?.part.name ?? null,
    ...(run ? { part_vm: run.vm, part_vm_gone: run.how === "RECOVER_GONE", part_results_pulled: run.pulled, missing_sessions: run.missing } : {}),
    kept: parts.filter((p) => p !== run).map((p) => ({ part: p.name, vm: p.vm, vm_gone: p.how === "RECOVER_GONE", results_pulled: p.pulled, missing_sessions: p.missing })), rows_added: add.length, complete });
  if (!complete) {
    const why = parts.filter((p) => (p === run ? !p.pulled || p.missing.length : !p.vm)).map((p) => p.missing.length ? p.name + "'s records miss sessions (" + p.missing.slice(0, 5).join("; ") + (p.missing.length > 5 ? "; and " + (p.missing.length - 5) + " more in host/recover.json" : "") + ")"
      : p.how === "RECOVER_GONE" ? p.name + "'s VM " + p.vm + " was already gone (RECOVER_GONE), so its records were lost" : p.name + "'s VM records were lost or its VM is unknown").join("; ");
    console.log("STOP: host " + host.name + " was lost and " + why + "; ledger rows after the last mirror can't be fully rebuilt, so " + plan.item + " ends incomplete and goes to the Captain");
    process.exit(4);
  }
  console.log("recovered: host " + host.name + " is gone; " + add.length + " ledger rows rebuilt into " + ledger + ". NEXT: " + nextWithoutHost(work, plan));
  if (itemEnded(work, plan)) process.exit(4);
}

// The host's file list for a part's pulled results (host-digest), read before host-down destroys the host.
function hostDigest(host: any, name: string): { files: number; sha256: string } {
  const r = remoteL1(host.name, "bun " + H + "/laneb/l1/l1.ts host-digest " + H + " " + name);
  try { if (r.code === 0) return JSON.parse(r.out.trim().split("\n").at(-1)!); } catch {}
  return refuse("host " + host.name + " could not list " + name + "'s pulled results (exit " + r.code + "); the host is not destroyed. Run host-down again");
}

// Before the host goes, every part's results come home: a salvaged part is finished again from what its salvage pulled,
// and the files pulled onto the host must match the copy at home by path and size. A pull that fails, or a copy that
// still differs, refuses and keeps the host.
function bringHome(work: string, host: any, st: any, name: string, plan: Plan) {
  const h = st.parts[name], home = join(work, name, "pulled");
  const want = h.pulled ? hostDigest(host, name) : null;
  const stale = h.salvage && !readJson(join(work, name + ".result.json")).salvage;
  if (stale || (want && treeDigest(home).sha256 !== want.sha256)) {
    try { finishPart(work, host, st, name, plan); } catch (e) { refuse(name + "'s results could not be pulled home (" + (e as Error).message + "); the host is not destroyed. Run host-down again"); }
  }
  if (want && treeDigest(home).sha256 !== want.sha256) refuse(name + "'s results at home (" + treeDigest(home).files + " files) do not match the host's (" + want.files + " files); the host is not destroyed. Run host-down again");
}

function hostDown(work: string) {
  const plan = readPlan(work);
  const host = currentHost(work) ?? refuse("no host is up");
  if (cleanupPending(work, host)) {
    const ledger = resolve(readJson(join(work, "host/pointer")).ledger);
    if (ubi(["down", host.name]).code !== 0) refuse("host " + host.name + " could not be confirmed gone; its reserve " + host.reserve_id + " stays open. Run host-down again");
    const hours = (nowSec() - host.up_at) / 3600;
    const out = new Ledger(ledger, plan.item).settle(host.reserve_id, toMicros(L1.host.usdPerHour * hours), { kind_detail: "awake host hours: " + hours.toFixed(6) + " h; host-up failed, destroyed by host-down" });
    recordHost(work, { event: "down", n: host.n, name: host.name, hours, settled: out.ok });
    console.log("host " + host.name + " (a failed host-up) is gone after " + hours.toFixed(2) + " h; its hours settled on " + ledger);
    return;
  }
  let st = status(host) ?? refuse("host " + host.name + " did not answer; run attach, or recover if it is lost");
  const running = Object.entries(st.parts).filter(([, s]: any) => s.alive || (s.launch_exit === null && !s.salvage));
  if (running.length) refuse(running.map(([k]) => k).join(", ") + " has not finished");
  for (const s of partState(work, plan)) if (s.launched && !s.result) refuse(s.part.name + "'s results are not pulled yet; run attach");
  for (const [k, s] of Object.entries(st.parts) as [string, any][]) if (s.launch_exit === 7 && !s.salvage) st = salvageOnHost(host, k, readJson(join(work, k + ".launch.json")).prefix, s, "host-down");
  mirror(work, host);
  for (const s of partState(work, plan)) if (st.parts[s.part.name]) bringHome(work, host, st, s.part.name, plan);
  const vmOpen = new Ledger(mirrorPath(work), plan.item).status().openIds.filter((id: string) => /\/vm(-\d+)?$/.test(id));
  if (vmOpen.length) refuse("the VM reserves " + vmOpen.join(", ") + " are still open, so a part VM may still be running; salvage or settle them, then run host-down again");
  const ledger = resolve(readJson(join(work, "host/pointer")).ledger);
  copyFileSync(mirrorPath(work), ledger);
  if (existsSync(join(work, "host/bound.json"))) copyFileSync(join(work, "host/bound.json"), ledger + ".bound");
  const down = ubi(["down", host.name]);
  if (down.code !== 0) { rmSync(ledger, { force: true }); refuse("host " + host.name + " could not be confirmed gone; its ledger stays on it. Run host-down again"); }
  const hours = (nowSec() - host.up_at) / 3600;
  rmSync(pointerPath(ledger), { force: true });
  const out = new Ledger(ledger, plan.item).settle(host.reserve_id, toMicros(L1.host.usdPerHour * hours), { kind_detail: "awake host hours: " + hours.toFixed(6) + " h at $" + L1.host.usdPerHour + "/h" });
  recordHost(work, { event: "down", n: host.n, name: host.name, hours, settled: out.ok });
  console.log("host " + host.name + " is gone after " + hours.toFixed(2) + " h; the ledger is back at " + ledger);
}

if (import.meta.main) {
  const [cmd, a, ...rest] = Bun.argv.slice(2);
  const opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === "host-status") console.log(JSON.stringify(hostStatus(resolve(a!))));
    else if (cmd === "host-bind") hostBind(resolve(a!), rest[0]!, rest[1]!);
    else if (cmd === "host-salvage") hostSalvageRecorded(resolve(a!), rest[0]!, rest[1]!);
    else if (cmd === "host-digest") console.log(JSON.stringify(treeDigest(join(resolve(a!), "work", rest[0]!, "pulled"))));
    else {
      if (!a) usage("usage: l1.ts prepare|host-up|launch|attach|relaunch|recover|host-down <work> [--item <item>] [--part <part>]");
      const work = resolve(a!);
      if (cmd === "prepare") prepare(work, opt("item") ?? usage("prepare needs --item"));
      else if (cmd === "host-up") hostUp(work);
      else if (cmd === "launch") launch(work, opt("part") ?? usage("launch needs --part"));
      else if (cmd === "attach") attach(work);
      else if (cmd === "relaunch") relaunch(work, opt("part") ?? usage("relaunch needs --part"));
      else if (cmd === "recover") recover(work);
      else if (cmd === "host-down") hostDown(work);
      else usage("unknown command " + cmd);
    }
  } catch (e) {
    const m = (e as Error).message;
    console.error(m.startsWith("E_") ? m : (e instanceof Refused ? "E_USAGE refused: " : "E_INTERNAL ") + m);
    process.exit(m.startsWith("E_USAGE") ? 2 : e instanceof Refused ? 3 : 1);
  }
}

// A move that also works across filesystems (a drive folder and ~/.capy/work).
function moveFile(from: string, to: string) {
  copyFileSync(from, to);
  rmSync(from);
}
