// Copyright (c) 2026 Garry Tan. MIT License.
// The task-fit screen (section 3), keyless: gstack-checks detect at the pin inside each scored and then calibration task's
// pristine container. A task whose detect prints CHECKS: none, or whose image can't run, is replaced by the first spare in
// spare.txt's order whose repository has fewer than SCREEN.perRepo tasks in that split and whose detect lists a check; the
// replacement takes the replaced task's position, scored replacements draw first, and a split with no fitting spare runs
// short. Writes screened.txt (the lines plans.ts reads) with its sha256, and prints every replacement, a short split's count
// and the digests of the judge subset, the judge pilot and drop step 3's first 180 recomputed from the screened lists.
// A detect that exits 3 for want of a pregate context (no origin/<base> ref in the container) is neither: the screen
// writes no lists and stops with E_HM_SCREEN, since every task would read the same. Each task's detect result is appended
// to <out>/detect.jsonl as it lands, and a rerun with the same --out reuses the rows made under the same task-setup sha256.
//   bun lanes/harness-mechanics/cli.ts screen --out <dir>           here, with Docker (HM_GSTACK: the pin's checkout)
//   bun lanes/harness-mechanics/cli.ts screen-vm start|finish <work>  the same on one Ubicloud VM, leased on the vms ledger
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Ledger, readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { loadRebenchPool, materializeRebench, R3A4_POOL_FILE, R3A4_POOL_SHA256 } from "../../quick/laneb/runner/materialize.ts";
import { taskSetupLines } from "../../quick/laneb/runner/prepare-run.ts";
import { itemTotals } from "./money.ts";
import { bundleLists, CAPS_USD, HM, REPO, SCREEN, sha256, TASK_SETUP, taskSetup, UBI_RUNNER, type Lists } from "./pins.ts";

export type Detect = { status: "check" | "none" | "broken" | "no-context"; detail: string; env?: boolean };
type Task = { task_id: string; repo: string; image: string; image_digest: string };
export function pool(): Map<string, Task> {
  const d = JSON.parse(readFileSync(join(REPO, "quick/laneb/tasks/swerebench-r3a4.json"), "utf8"));
  return new Map((d.tasks as Task[]).map((t) => [t.task_id, t]));
}
export const imageRef = (t: Task) => t.image.replace(/:[^:/]+$/, "") + "@" + t.image_digest;

// A task's trial environment directory, written as L1's prepare-run.ts writes it under the hm profile: materializeRebench
// from the SWEREBENCH export (the pinned Harbor's, as Stage 1 sets it) with Lane B's runtime stages, runtime-copy.Dockerfile
// and the task setup. Dry-run steps d1-checks and d2-session-path and the build check build this directory, so their
// images are the trials' own, WORKDIR included. Returns <dest>/environment.
export function trialEnvironment(task: string, dest: string): string {
  const lane = join(REPO, "quick/laneb"), runner = join(lane, "runner");
  const root = process.env.SWEREBENCH ?? join(process.env.HOME ?? "", ".capy/work/ref/swe-rebench-leaderboard");
  const t = loadRebenchPool(join(lane, R3A4_POOL_FILE), R3A4_POOL_SHA256).find((x) => x.task_id === task);
  if (!t) throw new Error("E_USAGE " + task + " is not a swerebench-r3a4 pool task");
  if (!existsSync(join(root, task))) throw new Error("E_USAGE " + task + " is not in the SWE-rebench export at " + root + "; set SWEREBENCH to the pinned Harbor's export");
  const runtimeCopy = readFileSync(join(runner, "runtime-copy.Dockerfile"), "utf8") + taskSetupLines({ TASK_SETUP: TASK_SETUP.file, TASK_SETUP_SHA256: TASK_SETUP.sha256 });
  materializeRebench(root, t, dest, { runtimeStages: readFileSync(join(runner, "runtime-stages.Dockerfile"), "utf8"), runtimeCopy, network: "allowlist" });
  return join(dest, "environment");
}
export const sortedDigest = (xs: string[]) => sha256([...xs].sort().join("\n") + "\n");

export function classifyDetect(code: number | null, out: string, err: string): Detect {
  const first = (s: string) => s.trim().split("\n")[0] ?? "";
  if (code === 0 && /^CHECKS: none/m.test(out)) return { status: "none", detail: first(out) };
  if (code === 0 && /^(CHECK |CHECKS: tests only)/m.test(out)) return { status: "check", detail: first(out) };
  if (code === 3 && /no pregate context/.test(err)) return { status: "no-context", detail: first(err).slice(0, 200) };
  return { status: "broken", detail: "detect exited " + code + ": " + (first(err) || first(out)).slice(0, 200) };
}

// One task: pull by digest (a refusal for Docker Hub's limit waits out the window and spends no retry), run detect from the
// workdir with the pin's checkout and this Bun mounted read-only and no network, then remove the image. Detect runs after
// D1's two lines from task-setup.Dockerfile (the origin RUN, then the PATH), so the screen sees what every arm sees, and
// env records whether the task's conda env directory exists (descriptive; it changes no replacement rule).
export function dockerDetect(ref: string, o: { docker: string; gstack: string; log: (l: string) => void }): Detect {
  const sh = (args: string[], timeout?: number) => { const p = Bun.spawnSync([o.docker, ...args], { stdout: "pipe", stderr: "pipe", timeout }); return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }; };
  for (;;) {
    const p = sh(["pull", "-q", ref]);
    if (p.code === 0) break;
    if (!/toomanyrequests|rate limit/i.test(p.err)) return { status: "broken", detail: "pull failed: " + p.err.trim().split("\n").at(-1)!.slice(0, 200) };
    o.log("SCREEN wait Docker Hub's pull limit for " + ref);
    Bun.sleepSync(Number(process.env.HM_PULL_WAIT_SEC ?? SCREEN.pullWaitSec) * 1000);
  }
  const s = taskSetup();
  const script = s.run + " && export PATH=" + s.path + " && { { " + s.envDirs.map((d) => "[ -d " + d + " ]").join(" || ") + "; } && echo HM_ENV yes || echo HM_ENV no; } >&2 && exec /opt/hm-bun --no-env-file --config=/dev/null /opt/hm-gstack/bin/gstack-checks detect";
  const r = sh(["run", "--rm", "--network", "none", "--entrypoint", "", "-v", o.gstack + ":/opt/hm-gstack:ro", "-v", process.execPath + ":/opt/hm-bun:ro", "-w", SCREEN.workdir, ref, "sh", "-c", script], SCREEN.detectTimeoutSec * 1000);
  sh(["rmi", ref]);
  const env = /^HM_ENV (yes|no)$/m.exec(r.err);
  return { ...classifyDetect(r.code, r.out, r.err.replace(/^HM_ENV (yes|no)\n/m, "")), ...(env ? { env: env[1] === "yes" } : {}) };
}

export type Replacement = { split: "scored" | "calibration"; position: number; replaced: string; why: string; by: string | null };
export function screenLists(l: Lists, repoOf: (t: string) => string, detect: (t: string) => Detect) {
  const seen = new Map<string, Detect>(), d = (t: string) => { if (!seen.has(t)) seen.set(t, detect(t)); return seen.get(t)!; };
  const used = new Set<string>(), replacements: Replacement[] = [], out = { scored: [] as string[], calibration: [] as string[] };
  for (const split of ["scored", "calibration"] as const) {
    const keep: (string | null)[] = l[split].map((t) => (d(t).status === "check" ? t : null));
    const blind = l[split].filter((t) => d(t).status === "no-context");
    if (blind.length) return { blind, seen, replacements, ...out };
    keep.forEach((x, i) => {
      if (x) return;
      const count = (repo: string) => keep.filter((y) => y && repoOf(y) === repo).length;
      const by = l.spare.find((s) => !used.has(s) && count(repoOf(s)) < SCREEN.perRepo && d(s).status === "check") ?? null;
      if (by) { used.add(by); keep[i] = by; }
      replacements.push({ split, position: i + 1, replaced: l[split][i]!, why: d(l[split][i]!).status + ": " + d(l[split][i]!).detail, by });
    });
    out[split] = keep.filter((x): x is string => x !== null);
  }
  return { blind: [] as string[], seen, replacements, ...out };
}

export function screen(outDir: string, detect: (t: string) => Detect, l: Lists = bundleLists()) {
  const p = pool(), repoOf = (t: string) => p.get(t)?.repo ?? (() => { throw new Error("E_HM_INPUT " + t + " is not in swerebench-r3a4.json"); })();
  mkdirSync(outDir, { recursive: true });
  const cacheFile = join(outDir, "detect.jsonl");
  const rows = existsSync(cacheFile) ? readFileSync(cacheFile, "utf8").split("\n").filter(Boolean).flatMap((x) => { try { return [JSON.parse(x)]; } catch { return []; } }) : [];
  const cached = new Map<string, Detect>(rows.filter((x) => x.setup === TASK_SETUP.sha256).map(({ task_id, setup: _setup, ...d }) => [task_id, d as Detect]));
  const r = screenLists(l, repoOf, (t) => {
    const hit = cached.get(t);
    if (hit) return hit;
    const d = detect(t);
    appendFileSync(cacheFile, JSON.stringify({ task_id: t, setup: TASK_SETUP.sha256, ...d }) + "\n");
    return d;
  });
  writeFileSync(join(outDir, "detect.json"), JSON.stringify(Object.fromEntries(r.seen), null, 2) + "\n");
  if (r.blind.length) throw new Error("E_HM_SCREEN detect found no pregate context in " + r.blind.length + " tasks (first " + r.blind[0] + ": " + r.seen.get(r.blind[0]!)!.detail + "); no lists written");
  const text = [...r.scored.map((x) => "scored " + x), ...r.calibration.map((x) => "calibration " + x)].join("\n") + "\n";
  writeFileSync(join(outDir, "screened.txt"), text);
  const lines = [
    ...r.replacements.map((x) => "SCREEN replace " + x.split + " " + x.position + " " + x.replaced + " (" + x.why + ") -> " + (x.by ?? "none: no spare fits")),
    ...(["scored", "calibration"] as const).filter((s) => r[s].length < l[s].length).map((s) => "SCREEN short " + s + " " + r[s].length + " of " + l[s].length),
    "SCREEN screened.txt sha256 " + sha256(text) + " (scored " + r.scored.length + ", calibration " + r.calibration.length + ", " + r.replacements.length + " replaced)",
    "SCREEN judge-subset " + Math.min(HM.splits.judgeSubset, r.scored.length) + " sorted sha256 " + sortedDigest(r.scored.slice(0, HM.splits.judgeSubset)),
    "SCREEN judge-pilot " + Math.min(HM.splits.judgePilot, r.calibration.length) + " sorted sha256 " + sortedDigest(r.calibration.slice(0, HM.splits.judgePilot)),
    "SCREEN drop3-first-" + SCREEN.dropScored + " " + Math.min(SCREEN.dropScored, r.scored.length) + " sorted sha256 " + sortedDigest(r.scored.slice(0, SCREEN.dropScored)),
  ];
  writeFileSync(join(outDir, "screen.txt"), lines.join("\n") + "\n");
  return { lines, sha256: sha256(text), ...r };
}

// The pin's checkout the detect runs from: HM_GSTACK at gstackPin.
export function gstackAtPin(): string {
  const g = resolve(process.env.HM_GSTACK ?? "");
  if (!process.env.HM_GSTACK || !existsSync(join(g, "bin/gstack-checks"))) throw new Error("E_USAGE hm screen: set HM_GSTACK to a gstack checkout at the pin");
  const head = Bun.spawnSync(["git", "-C", g, "rev-parse", "HEAD"]).stdout.toString().trim();
  if (head !== HM.gstackPin) throw new Error("E_HM_PIN hm screen: HM_GSTACK is at " + (head || "no commit") + ", not the pin " + HM.gstackPin);
  return g;
}

export function screenCommand(outDir: string, log: (l: string) => void = console.log) {
  const g = gstackAtPin(), p = pool(), docker = process.env.HM_DOCKER ?? "docker";
  return screen(outDir, (t) => { const d = dockerDetect(imageRef(p.get(t)!), { docker, gstack: g, log }); log("SCREEN detect " + t + " " + d.status); return d; });
}

// The VM shape L1's tools use: the pinned ubi-runner.sh, UBI_OWNER, and a lease on the vms ledger before the VM starts.
export function vmEnv() {
  const runner = process.env.UBI_RUNNER ?? "", owner = (process.env.UBI_OWNER ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!runner || !existsSync(runner)) throw new Error("E_USAGE hm screen-vm: set UBI_RUNNER to the pinned ubi-runner.sh copy (" + UBI_RUNNER.file + ")");
  const got = sha256(readFileSync(runner));
  if (got !== UBI_RUNNER.sha256) throw new Error("E_USAGE hm screen-vm: UBI_RUNNER has sha256 " + got + ", not the pinned " + UBI_RUNNER.sha256);
  if (!/^[a-z]/.test(owner)) throw new Error("E_USAGE hm screen-vm: set UBI_OWNER to the run thread's code");
  const ledger = process.env.LEDGER ?? "";
  if (!ledger || !existsSync(ledger)) throw new Error("E_USAGE hm screen-vm: set LEDGER to the vms item's ledger");
  return { runner, ledger: resolve(ledger) };
}
export const ubi = (runner: string, args: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawnSync([runner, ...args], { env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error("E_INTERNAL ubi-runner " + args[0] + " failed (exit " + p.exitCode + "): " + p.stderr.toString().trim().split("\n").at(-1));
  return p.stdout.toString();
};
const LEASE = "screen/vm", R = "hm-screen";
const leaseUsd = () => SCREEN.vmHours * 0.6;

export function screenVm(cmd: string, work: string, log: (l: string) => void = console.log) {
  const { runner, ledger } = vmEnv(), state = join(work, "screen-vm.json");
  const l = new Ledger(ledger, "vms");
  itemTotals(readRows(ledger), "vms");
  if (cmd === "start") {
    if (existsSync(state)) throw new Error("E_USAGE refused: " + work + " already holds a screen VM (" + state + ")");
    const g = gstackAtPin();
    const res = l.reserve(LEASE, toMicros(leaseUsd()), { kind_detail: "task-fit screen VM: " + SCREEN.vmHours + " h TTL at $0.60/h (" + SCREEN.vmSize + ")" });
    if (!res.ok || res.existing) throw new Error("CAP_STOP the vms ledger refused the screen VM's lease of $" + leaseUsd() + (res.ok ? " (the lease is held already)" : " (cap $" + CAPS_USD.vms + ")") + "; no VM started");
    mkdirSync(work, { recursive: true });
    const up = Date.now() / 1000, vm = ubi(runner, ["up", "-s", SCREEN.vmSize], { UBI_TTL_HOURS: String(SCREEN.vmHours) }).trim().split("\n").at(-1)!;
    writeFileSync(state, JSON.stringify({ vm, up_at: up, lease: LEASE }, null, 2) + "\n");
    ubi(runner, ["sync", vm, REPO, R + "/gstack-evals"]);
    ubi(runner, ["sync", vm, g, R + "/gstack"]);
    ubi(runner, ["ssh", vm, "bash " + R + "/gstack-evals/quick/laneb/runner/vm-bootstrap.sh > " + R + "/bootstrap.log 2>&1"]);
    ubi(runner, ["ssh", vm, "cd " + R + "/gstack-evals && setsid -f bash -c 'export PATH=\"$HOME/.bun/bin:$PATH\" HM_GSTACK=\"$HOME/" + R + "/gstack\"; bun lanes/harness-mechanics/cli.ts screen --out \"$HOME/" + R + "/out\" > \"$HOME/" + R + "/screen.log\" 2>&1; echo $? > \"$HOME/" + R + "/exit\"' < /dev/null > /dev/null 2>&1"]);
    log("SCREEN VM " + vm + " started; lease $" + leaseUsd().toFixed(2) + " on the vms ledger; run screen-vm finish " + work + " on a timer");
    return 0;
  }
  if (cmd === "finish") {
    if (!existsSync(state)) throw new Error("E_USAGE refused: " + work + " holds no screen VM");
    const st = JSON.parse(readFileSync(state, "utf8"));
    const exit = ubi(runner, ["ssh", st.vm, "cat " + R + "/exit 2>/dev/null || echo running"]).trim();
    if (exit === "running") { log("SCREEN VM " + st.vm + " still running"); return 0; }
    ubi(runner, ["pull", st.vm, R + "/out", work]);
    ubi(runner, ["pull", st.vm, R + "/screen.log", work]);
    ubi(runner, ["down", st.vm]);
    const hours = (Date.now() / 1000 - st.up_at) / 3600;
    const s = l.settle(LEASE, toMicros(hours * 0.6), { kind_detail: "task-fit screen VM hours: " + hours.toFixed(4) + " h at $0.60/h" });
    if (!s.ok) throw new Error("E_INTERNAL settling the screen lease: " + s.reason);
    log("SCREEN VM " + st.vm + " down after " + hours.toFixed(2) + " h, screen exit " + exit + "; results under " + join(work, "out"));
    return exit === "0" ? 0 : 1;
  }
  throw new Error("E_USAGE hm screen-vm start|finish <work>");
}
