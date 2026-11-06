// R3's route check (R3 amendment, section 6.2): a model's first paid step on its own R3a item, before its screen. It
// follows Run D's route check (runner/route-check.sh and runner/route-verdict.ts at tag laneb-discovery-3-runner): sessions
// on the runner's smoke task through the real metering proxy and the item's real ledger, each judged from its own trial.
// Each session runs as a one-task Harbor JobConfig from grid.ts, in the model's R3a arm and cell (cells.r3.json, the $4
// allowance, claude-code-preset), so the route check runs the agent exactly as the screen does. Two parts, in order:
//   smoke  arm none. Passes when Harbor exits 0 and a tool call got its result back (route-verdict.ts's smoke rule).
//   told   arm gstack, told /investigate. Passes when Harbor exits 0, the proxy's body-load probe recorded /investigate's
//          expansion in the session's first request, and a model response reached the agent. R3 tells the skill by slash
//          command, so its body reaches the model as a user message; this is what Run D's listing check is for its
//          untold design.
// A part that fails on the route's side is retried once. A trial whose files can't be read is such a failure, with the
// read error as its reason: bad JSON, the wrong shape, a file missing or of the wrong type inside the trial dir (ENOENT,
// ENOTDIR, EISDIR), or an error code not named below. A model whose part fails twice leaves R3a: the record says which part failed and why, with
// each session's Harbor exit and the proxy's evidence (its session row, with the cache-read tokens it metered, and any cap
// stop), and screen.ts refuses the model's screen. A failure on our side is not a try (Captain ruling A1): a local proxy
// or ledger service that died, a session interrupted by SIGINT or SIGTERM, a session cut short by a machine sleep or a
// kill, a cap stop the proxy latched, the check itself failing during a session, or a read of the trial failing on our
// machine (EACCES, EIO, EMFILE, ENFILE, ENOMEM or ENOSPC; the record names the code). The check then ends incomplete: the
// verdict stays null, the session's spend stays on the ledger, the screen refuses to bind, and the record names the
// cause. The Captain decides on a rerun, and only --rerun runs past an incomplete record. A signal while no session runs
// (the services still coming up, or between sessions) spends nothing and counts no try, so it doesn't mark the record
// incomplete: the record lists it under interruptions with the session it came before, and a plain rerun starts that
// session. On SIGINT or SIGTERM the check sends the signal to Harbor's process group (SIGKILL 30 s later), closes the
// proxy's sessions so they settle, stops the services it started (freeing their ports) and lists any reserve still open
// in the record. The record (<LEDGER>.route.json) is written before each session starts and replaced by a
// rename, and a passed or dropped record ends the route check: a rerun spends nothing. The whole check holds an exclusive
// lock on <LEDGER>.route.lock, so a second route check on the item is refused. A pass covers only the proxy config it ran
// with: the record keeps its sha256, a rerun under another PROXY_CONFIG is refused, and screen.ts refuses a pass whose
// config isn't the one its parts run with.
// Sessions reserve their allowance on the item under its route prefix (r3a-sol-route/) and settle at metered cost. At the
// end, open route reserves are reconciled from the proxy's sessions file, as launch.sh does, so the screen's bind sees
// settled rows only.
//   bun quick/laneb/r3/route-check.ts [--model gpt-6.1-sol | --item r3a4-sol] [--rerun]
// --item r3a4-sol runs R3 amendment 4's fresh route check on its own item, at cells.r3a4.json's allowance. --item r3b4-sol
// runs R3 amendment 5's (section 5) on r3b4-sol, the same way, with its told session in the told arm at gstack 699a41cb
// (ARM_MANIFESTS defaults to arms/manifests/r3b for it). --item l1-route-sol runs L1's (Amendment E) on its own item: the
// smoke session on L1's none arm and the told one on L1's after arm (tar=after), at cells.l1.json's Sol cell with its turn
// ceiling (ARM_MANIFESTS defaults to arms/manifests/l1, ARMS holds none and after).
// Env: LEDGER (the item's jsonl ledger, approved at the item's cap), ARMS (a directory with none.tar and gstack.tar, or
// .tar.gz, matching ARM_MANIFESTS, default arms/manifests/r3), the route's provider key (OPENROUTER_API_KEY for Sol; only
// the proxy sees it), OUT (the work dir, default ~/.capy/work/r3-route-check/<item>), PROXY_CONFIG (default
// config/proxy.json; the record keeps its sha256), LEDGER_PORT (default the model's own, 9912 for Sol), PROXY_DATA_PORT and
// PROXY_CONTROL_PORT (8787, 8788). A port something already answers on is refused before the services start, and so is a
// ledger service that exits early or serves another ledger, so a session can't reserve on another run's item. Harbor's own
// retries are off (max_retries 0): each try is one session, and the record counts every session.
// Every phase is public here (Capy cloud kernels cannot run Harbor's egress sidecar), as in Run D's route check.
// Exit codes: 0 passed, 1 dropped or any other error, 2 usage, 4 no verdict yet (incomplete, or interrupted while no
// session ran).
import { appendFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { dlopen, FFIType } from "bun:ffi";
import { readSessionRows, sessionsByTrial } from "../analysis/analyze.ts";
import { armSpec, jobConfig } from "../runner/grid.ts";
import { fromMicros, Ledger, readRows, reconcile, totals } from "../runner/ledger.ts";
import { loadR3Trial } from "./exposure.ts";
import { A4, itemCheck, portTaken, R3_ARMS, R3A, R3A4, readRoute, routeRecordPath, SOL, type R3aModel, type RouteGate, type RouteVerdict } from "./screen.ts";
import { R3B4 } from "./r3b.ts";
import { L1_ROUTE } from "../l1/l1.ts";

// An item the route check runs on: R3's models, or L1's l1-route-sol with its own cells file and the arm of each part.
type RouteItem = RouteGate & Pick<R3aModel, "ledgerPort" | "a4" | "armManifests"> & { cells?: string; routeArms?: Record<(typeof PARTS)[number]["kind"], string> };

const LANEB = resolve(import.meta.dir, "..");
const RUNNER = join(LANEB, "runner");
export const PARTS = [
  { kind: "smoke", arm: R3_ARMS.none },
  { kind: "told", arm: R3_ARMS.gstack },
] as const;
export const TRIES = 2;
// Harbor gets no credential: every variable named like a key, token, secret or password stays with the proxy.
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;
const LOCK_EX = 2, LOCK_NB = 4;

export type RouteSession = {
  kind: "smoke" | "told"; try: number; job: string; started_at: string; finished_at: string | null; harbor_exit: number | null;
  trial: string | null; tool_results: number; model_responded: boolean; body_loaded: boolean | null; proxy_session: Record<string, unknown> | null;
  proxy_cap_stop: string | null; pass: boolean; reasons: string[];
  // Why the session failed on our side (A1), so it is not a try; null for a session judged on the route's side.
  infra: string | null;
};
export type RouteRecord = RouteVerdict & {
  proxy_config_sha256: string; incomplete: string | null; sessions: RouteSession[]; reruns?: { at: string; after: string }[]; open_route_reserves?: string[];
  interruptions?: { at: string; signal: string; before: string }[];
};

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// route-verdict.ts's smoke rule: the tool calls whose result came back.
export function toolResults(msgs: any[]): number {
  return msgs.filter((m) => m.type === "UserMessage" && Array.isArray(m.content)).flatMap((m) => m.content).filter((b: any) => b?.tool_use_id).length;
}

const OUR_READ_ERRORS = new Set(["EACCES", "EIO", "EMFILE", "ENFILE", "ENOMEM", "ENOSPC"]);

// One session's route-side verdict from its Harbor exit, its job directory and the proxy's session rows. A trial whose
// files can't be read fails with the read error as its reason; a read that fails on our machine (OUR_READ_ERRORS) throws
// instead, so the check ends incomplete and counts no try (A1). loadR3Trial reads a JSON file it can't read as missing,
// so judge reads config.json and result.json once itself, the error surfacing here, and hands loadR3Trial their bytes.
// laneb-summary.json gives only wall_s, which no verdict reads, so judge doesn't read it. Only ENOENT and ENOTDIR mean
// absent: a stat that fails for another reason is an error, not a missing file. main reads the proxy's sessions file the
// same way, so an error there ends the check incomplete instead of judging a told part with no rows.
const ifThere = <T>(read: () => T): T | null => {
  try {
    return read();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes((e as { code?: string }).code ?? "")) return null;
    throw e;
  }
};

export function judge(kind: RouteSession["kind"], harborExit: number, jobDir: string, sessionRows: any[], proxyConfig: any) {
  const bySession = sessionsByTrial(sessionRows);
  let trial: ReturnType<typeof loadR3Trial> = null, toolCount = 0, unreadable: string | null = null;
  try {
    for (const t of ifThere(() => readdirSync(jobDir)) ?? []) {
      const dir = join(jobDir, t);
      const config = ifThere(() => readFileSync(join(dir, "config.json"), "utf8"));
      if (config === null) continue;
      trial = loadR3Trial(dir, bySession, proxyConfig, { config, result: ifThere(() => readFileSync(join(dir, "result.json"), "utf8")) });
      const text = ifThere(() => readFileSync(join(dir, "evaluator", "sdk-messages.jsonl"), "utf8"));
      toolCount = toolResults(text !== null ? text.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
      break;
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code && OUR_READ_ERRORS.has(code)) throw new Error(`${code} reading the trial: ${(e as Error).message}`);
    trial = null;
    unreadable = String((e as Error).message ?? e);
  }
  const row = trial ? (bySession.get(trial.trial) ?? []).at(-1) ?? null : null;
  const out = {
    trial: trial?.trial ?? null, tool_results: toolCount, model_responded: trial?.model_responded ?? false, body_loaded: trial?.body_loaded ?? null,
    proxy_session: row && { model: (row as any).model, requests: row.requests, ok_responses: row.ok_responses, refused: row.refused, refused_budget: row.refused_budget, close_reason: (row as any).close_reason ?? null, spent_usd: fromMicros(row.spent_micros), cache_read_tokens: (row as any).usage?.cache_read_input_tokens ?? null, cmd_names: (row as any).cmd_names ?? null },
  };
  const reasons: string[] = [];
  if (harborExit !== 0) reasons.push(`Harbor exited ${harborExit}`);
  if (unreadable) reasons.push(`the trial's files could not be read: ${unreadable}`);
  else if (!trial) reasons.push("no trial directory with a readable config.json");
  if (trial && kind === "smoke" && out.tool_results === 0) reasons.push("no tool call got its result back");
  if (trial && kind === "told" && !out.body_loaded) reasons.push(`the proxy's body-load probe did not record /investigate's expansion in the first request (cmd_names ${JSON.stringify(out.proxy_session?.cmd_names ?? null)})`);
  if (trial && kind === "told" && !out.model_responded) reasons.push(`no model response reached the agent (${out.proxy_session ? `${out.proxy_session.requests} requests, ${out.proxy_session.refused} refused, ${out.proxy_session.ok_responses} ok` : "no proxy session row"})`);
  return { ...out, pass: reasons.length === 0, reasons };
}

// The next session to run, or the verdict. Only a finished session judged on the route's side is a try (A1).
export function next(rec: RouteRecord): { kind: RouteSession["kind"]; try: number } | { verdict: "pass" | "drop"; reason: string } {
  const done: string[] = [];
  for (const { kind } of PARTS) {
    const tries = rec.sessions.filter((s) => s.kind === kind && s.finished_at !== null && !s.infra);
    const passed = tries.find((s) => s.pass);
    if (passed) { done.push(`${kind} passed on try ${passed.try}`); continue; }
    if (tries.length >= TRIES) return { verdict: "drop", reason: `the ${kind} part failed twice: ${tries.map((s) => `try ${s.try}: ${s.reasons.join("; ")}`).join(" | ")}` };
    return { kind, try: tries.length + 1 };
  }
  return { verdict: "pass", reason: done.join(", ") };
}

// The whole check holds an exclusive flock(2) on <LEDGER>.route.lock, taken before it reads the record, so a second route
// check on the item is refused. The kernel drops the lock when the process ends, however it ends.
function lock(ledger: string) {
  const libc = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
  const path = ledger + ".route.lock";
  if (libc.symbols.flock(openSync(path, "a", 0o600), LOCK_EX | LOCK_NB) !== 0) throw new Error(`E_USAGE another route check holds ${path}; this one ran nothing`);
}

type Proc = { exitCode: number | null; signalCode: string | null };
const ended = (p: Proc) => (p.exitCode !== null ? String(p.exitCode) : p.signalCode);

async function waitUp(urls: string[], procs: Record<string, Proc>, stopped: () => boolean) {
  for (let i = 0; i < 80 && !stopped(); i++) {
    const gone = Object.entries(procs).find(([, p]) => ended(p) !== null);
    if (gone) throw new Error(`the ${gone[0]} exited ${ended(gone[1])} before it was up (see its log in OUT); no session ran`);
    const ok = await Promise.all(urls.map((u) => fetch(u).then((r) => r.ok, () => false)));
    if (ok.every(Boolean)) return;
    await Bun.sleep(250);
  }
  if (!stopped()) throw new Error(`not up after 20 s: ${urls.join(", ")}`);
}

async function main(argv: string[]): Promise<number> {
  const rerun = argv.includes("--rerun");
  const args = argv.filter((a) => a !== "--rerun");
  const modelId = args.length === 0 ? SOL : args.length === 2 && args[0] === "--model" ? args[1]! : "";
  const m: RouteItem | undefined = args.length === 2 && args[0] === "--item" ? R3A4[args[1]!] ?? R3B4[args[1]!] ?? (args[1] === L1_ROUTE.item ? L1_ROUTE : undefined) : R3A[modelId];
  const routeModels = Object.values(R3A).filter((x) => x.routePrefix !== null).map((x) => x.id);
  if (!m) throw new Error(`E_USAGE usage: bun quick/laneb/r3/route-check.ts [--model ${routeModels.join("|")} | --item r3a4-sol|r3b4-sol|l1-route-sol] [--rerun]`);
  if (m.routePrefix === null) throw new Error(`E_USAGE ${m.id} has no route check in R3a (route-checked models: ${routeModels.join(", ")})`);
  const leg = m.leg ?? "R3a";
  const prefix = m.routePrefix;
  const ledger = process.env.LEDGER;
  if (!ledger) throw new Error(`E_USAGE set LEDGER to ${m.item}'s jsonl ledger`);
  const armsDir = process.env.ARMS;
  if (!armsDir) throw new Error("E_USAGE set ARMS to the directory holding the none and gstack arm tars (#109's, handoffs/GSTA-30/arms)");
  const proxyPath = resolve(process.env.PROXY_CONFIG ?? join(LANEB, "config/proxy.json"));
  const proxyConfig = JSON.parse(readFileSync(proxyPath, "utf8"));
  const keyEnv = proxyConfig.routes[proxyConfig.models[m.id]?.route]?.key_env;
  if (!keyEnv) throw new Error(`${proxyPath} has no route for ${m.id}`);
  if (!process.env[keyEnv]) throw new Error(`E_USAGE set ${keyEnv}, the key for ${m.id}'s route (only the proxy sees it)`);
  if (!Bun.which("harbor")) throw new Error("E_USAGE harbor is not on PATH; no session ran");
  const cellsFile = m.cells ?? (m.a4 ? A4.cells : "cells.r3.json");
  const cells = JSON.parse(readFileSync(join(LANEB, "config", cellsFile), "utf8"));
  const cell = cells.models.find((c: any) => c.id === m.id);
  if (!cell) throw new Error(`config/${cellsFile} has no cell for ${m.id}`);

  lock(ledger);
  itemCheck(ledger, m);
  if (existsSync(ledger + ".bound")) throw new Error(`${m.item} is already bound to its screen (${ledger}.bound); the route check comes first`);
  const recPath = routeRecordPath(ledger);
  const prior = readRoute(ledger) as RouteRecord | null;
  if (prior && (prior.model !== m.id || prior.item !== m.item)) throw new Error(`${recPath} is for ${prior.model} on ${prior.item}, not ${m.id} on ${m.item}`);
  if (prior?.verdict === "pass") { console.log(`route check: ${m.id} already passed on ${m.item} (${prior.reason}); nothing to run`); return 0; }
  if (prior?.verdict === "drop") { console.log(`route check: ${m.id} dropped out of ${leg}: ${prior.reason}`); return 1; }
  const configSha = sha256(proxyPath);
  if (prior && prior.proxy_config_sha256 !== configSha) throw new Error(`E_USAGE PROXY_CONFIG ${proxyPath} has sha256 ${configSha}, but this record's sessions ran with ${prior.proxy_config_sha256}; no session ran`);
  const rec: RouteRecord = prior ?? { item: m.item, model: m.id, verdict: null, reason: null, incomplete: null, proxy_config_sha256: configSha, sessions: [] };
  const save = () => {
    writeFileSync(recPath + ".tmp", JSON.stringify(rec, null, 2) + "\n");
    renameSync(recPath + ".tmp", recPath);
  };
  const incomplete = () => `route check: ${m.id} is incomplete on ${m.item}: ${rec.incomplete}; the Captain decides on a rerun (route-check.ts --rerun)`;
  for (const s of rec.sessions) {
    if (s.finished_at !== null || s.infra) continue;
    s.infra = "the session did not finish: the route check stopped during it (a machine sleep or a kill)";
    rec.incomplete ??= `${s.kind} try ${s.try}: ${s.infra}`;
  }
  if (rec.incomplete) {
    if (!rerun) { save(); console.log(incomplete()); return 4; }
    (rec.reruns ??= []).push({ at: new Date().toISOString(), after: rec.incomplete });
    rec.incomplete = null;
  }

  const out = resolve(process.env.OUT ?? join(process.env.HOME ?? "", ".capy/work/r3-route-check", m.item));
  mkdirSync(join(out, "arms"), { recursive: true });
  const manifests = resolve(process.env.ARM_MANIFESTS ?? join(LANEB, m.armManifests ?? "arms/manifests/r3"));
  // An arm runs on its own tar, or on the one tar= names (L1's after-t runs after.tar), as prepare-run stages it.
  const partArm = (kind: RouteSession["kind"]) => m.routeArms?.[kind] ?? PARTS.find((p) => p.kind === kind)!.arm;
  const arms = Object.fromEntries(PARTS.map(({ kind }) => {
    const { name, tar_name } = armSpec(partArm(kind));
    const file = tar_name ?? name;
    const want = JSON.parse(readFileSync(join(manifests, file + ".json"), "utf8")).tar.sha256 as string;
    let tar = join(armsDir, file + ".tar");
    if (!existsSync(tar)) {
      const gz = join(armsDir, file + ".tar.gz");
      if (!existsSync(gz)) throw new Error(`E_USAGE ${armsDir} has no ${file}.tar or ${file}.tar.gz`);
      tar = join(out, "arms", file + ".tar");
      if (Bun.spawnSync(["sh", "-c", 'gzip -dc "$1" > "$2"', "sh", gz, tar]).exitCode !== 0) throw new Error(`gunzip of ${gz} failed`);
    }
    const got = sha256(tar);
    if (got !== want) throw new Error(`arm ${name}: tar sha256 ${got} is not the preregistered ${want} (${manifests}/${file}.json); no session ran`);
    return [name, { tar, sha256: want }];
  }));
  const task = join(out, "tasks", "smoke-task");
  cpSync(join(RUNNER, "smoke-task"), task, { recursive: true });
  writeFileSync(join(task, "task.toml"), readFileSync(join(task, "task.toml"), "utf8").replace(/^network_mode = .*$/gm, 'network_mode = "public"'));
  const gw = Bun.spawnSync(["docker", "network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"]).stdout.toString().trim();
  if (!gw) throw new Error("docker gave no bridge gateway");
  const lport = process.env.LEDGER_PORT ?? m.ledgerPort, dport = process.env.PROXY_DATA_PORT ?? "8787", cport = process.env.PROXY_CONTROL_PORT ?? "8788";
  if (new Set([lport, dport, cport]).size !== 3) throw new Error(`E_USAGE LEDGER_PORT ${lport}, PROXY_DATA_PORT ${dport} and PROXY_CONTROL_PORT ${cport} must be three different ports; no session ran`);
  const taken = [["127.0.0.1", lport], ["127.0.0.1", cport], [gw, dport]].filter(([h, p]) => portTaken(h!, p!)).map(([h, p]) => `${h}:${p}`);
  if (taken.length) throw new Error(`E_USAGE something already answers on ${taken.join(", ")} (another run's ledger service or proxy?); set LEDGER_PORT, PROXY_DATA_PORT or PROXY_CONTROL_PORT to a free port; no session ran`);
  const control = `http://127.0.0.1:${cport}`, ledgerUrl = `http://127.0.0.1:${lport}`;
  const sessionsFile = join(out, "proxy-sessions.jsonl");
  // From here a SIGINT or SIGTERM stops the check: during a session it ends incomplete, and otherwise the record lists the
  // interruption. Harbor and the services run in their own process groups, so a terminal's Ctrl-C reaches only this
  // process, which signals Harbor's group, lets the proxy settle its sessions and stops them.
  let interrupted: string | null = null;
  const caught = () => interrupted;
  let harbor: ReturnType<typeof Bun.spawn> | null = null;
  const killHarbor = (sig: NodeJS.Signals) => { try { if (harbor) process.kill(-harbor.pid, sig); } catch {} };
  const stop = (sig: NodeJS.Signals) => {
    if (interrupted) return;
    interrupted = sig;
    killHarbor(sig);
    setTimeout(() => killHarbor("SIGKILL"), 30_000);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const ledgerSvc = Bun.spawn([process.execPath, join(RUNNER, "ledger.ts"), "serve", "--path", ledger, "--item", m.item, "--port", lport], { stdout: "pipe", stderr: "pipe", detached: true });
  const proxy = Bun.spawn([process.execPath, join(RUNNER, "proxy.ts"), "--config", proxyPath, "--data-host", gw, "--data-port", dport, "--control-port", cport,
    "--log", join(out, "proxy-requests.jsonl"), "--sessions", sessionsFile, "--ledger-url", ledgerUrl, "--ledger-prefix", prefix], { stdout: "pipe", stderr: "pipe", detached: true });
  // Each service's log gets its whole stdout and stderr once both streams end; the check waits for it before it exits.
  const logs = ([[ledgerSvc, "ledger-service.log"], [proxy, "proxy.log"]] as const).map(([p, name]) =>
    Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]).then(([o, e]) => appendFileSync(join(out, name), o + e)));
  // Why a service this check started is down, or null.
  const down = async () => {
    for (const [name, p, url] of [["ledger service", ledgerSvc, ledgerUrl + "/status"], ["proxy", proxy, control + "/healthz"]] as const) {
      const up = ended(p) === null && (await fetch(url, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false));
      if (!up) return `the ${name} is down (${ended(p) === null ? "it stopped answering" : `it exited ${ended(p)}`})`;
    }
    return null;
  };
  const harborEnv: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !SECRET.test(k)) as [string, string][]);
  Object.assign(harborEnv, { ANTHROPIC_API_KEY: "placeholder-not-a-key", PYTHONPATH: join(RUNNER, "agent") });
  let verdict: { verdict: "pass" | "drop"; reason: string } | null = null;
  let current: RouteSession | null = null;
  let stoppedBefore: string | null = null;
  try {
    await waitUp([control + "/healthz", ledgerUrl + "/status"], { "ledger service": ledgerSvc, proxy }, () => caught() !== null);
    if (caught() === null) {
      const served = await fetch(ledgerUrl + "/status").then((r) => r.json());
      if (!Bun.deepEquals(served, JSON.parse(JSON.stringify(totals(readRows(ledger)))))) throw new Error(`the ledger service on port ${lport} does not serve ${ledger}; no session ran`);
    }
    while (!rec.incomplete) {
      const step = next(rec);
      if ("verdict" in step) { verdict = step; break; }
      const before = caught() ? null : await down();
      if (before) { rec.incomplete = before; break; }
      if (caught()) {
        stoppedBefore = `${step.kind} try ${step.try}`;
        (rec.interruptions ??= []).push({ at: new Date().toISOString(), signal: caught()!, before: stoppedBefore });
        break;
      }
      const { kind, try: n } = step;
      const job = `route-${m.id}-${kind}-${n}-${Date.now()}`;
      const spec = armSpec(partArm(kind));
      const config = jobConfig({
        job_name: job, tasks_dir: join(out, "tasks"), tasks: ["smoke-task"], models: [cell], arms: [{ ...spec, ...arms[spec.name]! }], attempts: 1, n_concurrent: 1,
        agent_dir: join(RUNNER, "agent"), runner_dir: RUNNER, base_url: `http://${gw}:${dport}`, max_output_tokens: cells.max_output_tokens,
        verifier_timeout_multiplier: cells.verifier_timeout_multiplier, repo_dir: "/testbed", ...(cells.sdk_max_turns ? { sdk_max_turns: cells.sdk_max_turns } : {}),
      });
      config.retry.max_retries = 0;
      if (cport !== "8788") for (const a of config.agents) Object.assign(a.kwargs, { control_url: control });
      writeFileSync(join(out, job + ".json"), JSON.stringify(config, null, 2) + "\n");
      const s: RouteSession = { kind, try: n, job, started_at: new Date().toISOString(), finished_at: null, harbor_exit: null, trial: null, tool_results: 0, model_responded: false, body_loaded: null, proxy_session: null, proxy_cap_stop: null, pass: false, reasons: [], infra: null };
      rec.sessions.push(s);
      current = s;
      save();
      const h = Bun.spawn(["harbor", "run", "-y", "-c", join(out, job + ".json")], { cwd: out, env: harborEnv, stdout: "pipe", stderr: "pipe", detached: true });
      harbor = h;
      const [hout, herr] = await Promise.all([new Response(h.stdout).text(), new Response(h.stderr).text()]);
      appendFileSync(join(out, job + ".log"), hout + herr);
      const exit = await h.exited;
      harbor = null;
      let capStop: string | null = null;
      let infra = caught() ? `interrupted by ${caught()}` : await down();
      if (!infra) {
        const t = await fetch(control + "/totals", { signal: AbortSignal.timeout(10_000) }).then((r) => r.json() as Promise<any>, () => null);
        capStop = t?.cap_stop ?? null;
        infra = !t ? "the proxy is down (its /totals did not answer)" : capStop ? `the proxy latched a cap stop: ${capStop}` : null;
      }
      const rows = ifThere(() => readSessionRows([sessionsFile])) ?? [];
      Object.assign(s, judge(kind, exit, join(out, "jobs", job), rows, proxyConfig), { harbor_exit: exit, finished_at: new Date().toISOString(), proxy_cap_stop: capStop, infra });
      if (infra) rec.incomplete = `${kind} try ${n}: ${infra}`;
      save();
      console.log(`route-check ${m.id} ${kind} try ${n}: ${infra ? `INCOMPLETE (${infra})` : s.pass ? "PASS" : "FAIL"} (Harbor ${exit}; tool results ${s.tool_results}; ${kind === "told" ? `body loaded ${s.body_loaded}; ` : ""}model responded ${s.model_responded}${s.reasons.length ? "; " + s.reasons.join("; ") : ""})`);
    }
  } catch (e) {
    if (!current || current.finished_at !== null) throw e;
    Object.assign(current, { finished_at: new Date().toISOString(), infra: `the route check failed during the session: ${String((e as Error).message ?? e)}` });
    rec.incomplete = `${current.kind} try ${current.try}: ${current.infra}`;
  } finally {
    await fetch(control + "/close-all", { method: "POST", signal: AbortSignal.timeout(120_000) }).catch(() => undefined);
    proxy.kill();
    ledgerSvc.kill();
    await Promise.all([proxy.exited, ledgerSvc.exited, ...logs]);
    if (existsSync(sessionsFile)) reconcile(new Ledger(ledger, m.item), readRows(sessionsFile) as any[], prefix);
    rec.open_route_reserves = totals(readRows(ledger)).openIds.filter((id) => id.startsWith(prefix));
    save();
  }
  const t = totals(readRows(ledger));
  console.log(`${m.item}: settled $${fromMicros(t.settledMicros).toFixed(2)} of $${fromMicros(t.capMicros)}, open route reserves ${rec.open_route_reserves.length}`);
  if (!verdict) {
    console.log(rec.incomplete ? incomplete() : `route check: ${m.id} was interrupted by ${caught()} on ${m.item} before ${stoppedBefore} started: no session was running, so it spent nothing and counted no try; a plain rerun starts ${stoppedBefore}`);
    return 4;
  }
  rec.verdict = verdict.verdict;
  rec.reason = verdict.reason;
  save();
  if (verdict.verdict === "pass") { console.log(`route check: ${m.id} passed on ${m.item} (${verdict.reason})`); return 0; }
  console.log(`route check: ${m.id} dropped out of ${leg}: ${verdict.reason}`);
  return 1;
}

if (import.meta.main) {
  try {
    process.exit(await main(Bun.argv.slice(2)));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    console.error(msg.startsWith("E_USAGE") ? msg : `E_INTERNAL ${msg}`);
    process.exit(msg.startsWith("E_USAGE") ? 2 : 1);
  }
}
