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
// A part that fails is retried once. A model whose part fails twice leaves R3a: the record says which part failed and
// why, with each session's Harbor exit and the proxy's evidence (its session row and any cap stop), and screen.ts refuses
// the model's screen. The record (<LEDGER>.route.json) is written before each session starts, so a session cut short
// counts as a failed one, and a passed or dropped record ends the route check: a rerun spends nothing.
// Sessions reserve their allowance on the item under its route prefix (r3a-sol-route/) and settle at metered cost. At the
// end, open route reserves are reconciled from the proxy's sessions file, as launch.sh does, so the screen's bind sees
// settled rows only.
//   bun quick/laneb/r3/route-check.ts [--model gpt-6.1-sol]
// Env: LEDGER (the item's jsonl ledger, approved at the item's cap), ARMS (a directory with none.tar and gstack.tar, or
// .tar.gz, matching ARM_MANIFESTS, default arms/manifests/r3), the route's provider key (OPENROUTER_API_KEY for Sol; only
// the proxy sees it), OUT (the work dir, default ~/.capy/work/r3-route-check/<item>), PROXY_CONFIG (default
// config/proxy.json; the record keeps its sha256), LEDGER_PORT (default the model's own, 9912 for Sol), PROXY_DATA_PORT and
// PROXY_CONTROL_PORT (8787, 8788). A port something already answers on is refused before the services start, and so is a
// ledger service that exits early or serves another ledger, so a session can't reserve on another run's item. Harbor's own
// retries are off (max_retries 0): each try is one session, and the record counts every session.
// Every phase is public here (Capy cloud kernels cannot run Harbor's egress sidecar), as in Run D's route check.
// Exit codes: 0 passed, 1 dropped or any other error, 2 usage.
import { appendFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { readSessionRows, sessionsByTrial } from "../analysis/analyze.ts";
import { armSpec, jobConfig } from "../runner/grid.ts";
import { fromMicros, Ledger, readRows, reconcile, totals } from "../runner/ledger.ts";
import { loadR3Trial } from "./exposure.ts";
import { itemCheck, portTaken, R3_ARMS, R3A, readRoute, routeRecordPath, SOL, type R3aModel, type RouteVerdict } from "./screen.ts";

const LANEB = resolve(import.meta.dir, "..");
const RUNNER = join(LANEB, "runner");
export const PARTS = [
  { kind: "smoke", arm: R3_ARMS.none },
  { kind: "told", arm: R3_ARMS.gstack },
] as const;
export const TRIES = 2;
// Harbor gets no credential: every variable named like a key, token, secret or password stays with the proxy.
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

export type RouteSession = {
  kind: "smoke" | "told"; try: number; job: string; started_at: string; finished_at: string | null; harbor_exit: number | null;
  trial: string | null; tool_results: number; model_responded: boolean; body_loaded: boolean | null; proxy_session: Record<string, unknown> | null;
  proxy_cap_stop: string | null; pass: boolean; reasons: string[];
};
export type RouteRecord = RouteVerdict & { proxy_config_sha256: string; sessions: RouteSession[]; open_route_reserves?: string[] };

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// route-verdict.ts's smoke rule: the tool calls whose result came back.
export function toolResults(msgs: any[]): number {
  return msgs.filter((m) => m.type === "UserMessage" && Array.isArray(m.content)).flatMap((m) => m.content).filter((b: any) => b?.tool_use_id).length;
}

// One session's verdict from its Harbor exit, its job directory and the proxy's session rows.
export function judge(kind: RouteSession["kind"], harborExit: number, jobDir: string, sessionRows: any[], proxyConfig: any, capStop: string | null) {
  const dir = existsSync(jobDir) ? readdirSync(jobDir).map((t) => join(jobDir, t)).find((d) => existsSync(join(d, "config.json"))) : undefined;
  const bySession = sessionsByTrial(sessionRows);
  const trial = dir ? loadR3Trial(dir, bySession, proxyConfig) : null;
  const msgsPath = dir ? join(dir, "evaluator", "sdk-messages.jsonl") : "";
  const msgs = msgsPath && existsSync(msgsPath) ? readFileSync(msgsPath, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
  const row = trial ? (bySession.get(trial.trial) ?? []).at(-1) ?? null : null;
  const out = {
    trial: trial?.trial ?? null, tool_results: toolResults(msgs), model_responded: trial?.model_responded ?? false, body_loaded: trial?.body_loaded ?? null,
    proxy_session: row && { model: (row as any).model, requests: row.requests, ok_responses: row.ok_responses, refused: row.refused, refused_budget: row.refused_budget, close_reason: (row as any).close_reason ?? null, spent_usd: fromMicros(row.spent_micros), cmd_names: (row as any).cmd_names ?? null },
    proxy_cap_stop: capStop,
  };
  const reasons: string[] = [];
  if (harborExit !== 0) reasons.push(`Harbor exited ${harborExit}`);
  if (!trial) reasons.push("no trial directory with a readable config.json");
  if (capStop) reasons.push(`the proxy latched a cap stop: ${capStop}`);
  if (trial && kind === "smoke" && out.tool_results === 0) reasons.push("no tool call got its result back");
  if (trial && kind === "told" && !out.body_loaded) reasons.push(`the proxy's body-load probe did not record /investigate's expansion in the first request (cmd_names ${JSON.stringify(out.proxy_session?.cmd_names ?? null)})`);
  if (trial && kind === "told" && !out.model_responded) reasons.push(`no model response reached the agent (${out.proxy_session ? `${out.proxy_session.requests} requests, ${out.proxy_session.refused} refused, ${out.proxy_session.ok_responses} ok` : "no proxy session row"})`);
  return { ...out, pass: reasons.length === 0, reasons };
}

// The next session to run, or the verdict. A session that started and never finished counts as a failed one.
export function next(rec: RouteRecord): { kind: RouteSession["kind"]; try: number } | { verdict: "pass" | "drop"; reason: string } {
  for (const s of rec.sessions) if (s.finished_at === null && !s.reasons.length) s.reasons.push("the session did not finish (cut short)");
  const done: string[] = [];
  for (const { kind } of PARTS) {
    const tries = rec.sessions.filter((s) => s.kind === kind);
    const passed = tries.find((s) => s.pass && s.finished_at !== null);
    if (passed) { done.push(`${kind} passed on try ${passed.try}`); continue; }
    if (tries.length >= TRIES) return { verdict: "drop", reason: `the ${kind} part failed twice: ${tries.map((s) => `try ${s.try}: ${s.reasons.join("; ")}`).join(" | ")}` };
    return { kind, try: tries.length + 1 };
  }
  return { verdict: "pass", reason: done.join(", ") };
}

async function waitUp(urls: string[], procs: Record<string, { exitCode: number | null }>) {
  for (let i = 0; i < 80; i++) {
    const gone = Object.entries(procs).find(([, p]) => p.exitCode !== null);
    if (gone) throw new Error(`the ${gone[0]} exited ${gone[1].exitCode} before it was up (see its log in OUT); no session ran`);
    const ok = await Promise.all(urls.map((u) => fetch(u).then((r) => r.ok, () => false)));
    if (ok.every(Boolean)) return;
    await Bun.sleep(250);
  }
  throw new Error(`not up after 20 s: ${urls.join(", ")}`);
}

async function main(argv: string[]): Promise<number> {
  const modelId = argv.length === 0 ? SOL : argv.length === 2 && argv[0] === "--model" ? argv[1]! : "";
  const m: R3aModel | undefined = R3A[modelId];
  const routeModels = Object.values(R3A).filter((x) => x.routePrefix !== null).map((x) => x.id);
  if (!m) throw new Error(`E_USAGE usage: bun quick/laneb/r3/route-check.ts [--model ${routeModels.join("|")}]`);
  if (m.routePrefix === null) throw new Error(`E_USAGE ${m.id} has no route check in R3a (route-checked models: ${routeModels.join(", ")})`);
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
  const cells = JSON.parse(readFileSync(join(LANEB, "config/cells.r3.json"), "utf8"));
  const cell = cells.models.find((c: any) => c.id === m.id);
  if (!cell) throw new Error(`config/cells.r3.json has no cell for ${m.id}`);

  itemCheck(ledger, m);
  if (existsSync(ledger + ".bound")) throw new Error(`${m.item} is already bound to its screen (${ledger}.bound); the route check comes first`);
  const recPath = routeRecordPath(ledger);
  const prior = readRoute(ledger) as RouteRecord | null;
  if (prior && (prior.model !== m.id || prior.item !== m.item)) throw new Error(`${recPath} is for ${prior.model} on ${prior.item}, not ${m.id} on ${m.item}`);
  if (prior?.verdict === "pass") { console.log(`route check: ${m.id} already passed on ${m.item} (${prior.reason}); nothing to run`); return 0; }
  if (prior?.verdict === "drop") { console.log(`route check: ${m.id} dropped out of R3a: ${prior.reason}`); return 1; }
  const rec: RouteRecord = prior ?? { item: m.item, model: m.id, verdict: null, reason: null, proxy_config_sha256: sha256(proxyPath), sessions: [] };
  const save = () => writeFileSync(recPath, JSON.stringify(rec, null, 2) + "\n");

  const out = resolve(process.env.OUT ?? join(process.env.HOME ?? "", ".capy/work/r3-route-check", m.item));
  mkdirSync(join(out, "arms"), { recursive: true });
  const manifests = resolve(process.env.ARM_MANIFESTS ?? join(LANEB, "arms/manifests/r3"));
  const arms = Object.fromEntries(PARTS.map(({ arm }) => {
    const name = armSpec(arm).name;
    const want = JSON.parse(readFileSync(join(manifests, name + ".json"), "utf8")).tar.sha256 as string;
    let tar = join(armsDir, name + ".tar");
    if (!existsSync(tar)) {
      const gz = join(armsDir, name + ".tar.gz");
      if (!existsSync(gz)) throw new Error(`E_USAGE ${armsDir} has no ${name}.tar or ${name}.tar.gz`);
      tar = join(out, "arms", name + ".tar");
      if (Bun.spawnSync(["sh", "-c", 'gzip -dc "$1" > "$2"', "sh", gz, tar]).exitCode !== 0) throw new Error(`gunzip of ${gz} failed`);
    }
    const got = sha256(tar);
    if (got !== want) throw new Error(`arm ${name}: tar sha256 ${got} is not the preregistered ${want} (${manifests}/${name}.json); no session ran`);
    return [name, { tar, sha256: want }];
  }));
  const task = join(out, "tasks", "smoke-task");
  cpSync(join(RUNNER, "smoke-task"), task, { recursive: true });
  writeFileSync(join(task, "task.toml"), readFileSync(join(task, "task.toml"), "utf8").replace(/^network_mode = .*$/gm, 'network_mode = "public"'));
  const gw = Bun.spawnSync(["docker", "network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"]).stdout.toString().trim();
  if (!gw) throw new Error("docker gave no bridge gateway");
  const lport = process.env.LEDGER_PORT ?? m.ledgerPort, dport = process.env.PROXY_DATA_PORT ?? "8787", cport = process.env.PROXY_CONTROL_PORT ?? "8788";
  const taken = [["127.0.0.1", lport], ["127.0.0.1", cport], [gw, dport]].filter(([h, p]) => portTaken(h!, p!)).map(([h, p]) => `${h}:${p}`);
  if (taken.length) throw new Error(`E_USAGE something already answers on ${taken.join(", ")} (another run's ledger service or proxy?); set LEDGER_PORT, PROXY_DATA_PORT or PROXY_CONTROL_PORT to a free port; no session ran`);
  const control = `http://127.0.0.1:${cport}`;
  const sessionsFile = join(out, "proxy-sessions.jsonl");
  const log = (name: string) => { const w = createWriteStream(join(out, name), { flags: "a" }); return w; };
  const ledgerSvc = Bun.spawn([process.execPath, join(RUNNER, "ledger.ts"), "serve", "--path", ledger, "--item", m.item, "--port", lport], { stdout: "pipe", stderr: "pipe" });
  const proxy = Bun.spawn([process.execPath, join(RUNNER, "proxy.ts"), "--config", proxyPath, "--data-host", gw, "--data-port", dport, "--control-port", cport,
    "--log", join(out, "proxy-requests.jsonl"), "--sessions", sessionsFile, "--ledger-url", `http://127.0.0.1:${lport}`, "--ledger-prefix", prefix], { stdout: "pipe", stderr: "pipe" });
  for (const [p, name] of [[ledgerSvc, "ledger-service.log"], [proxy, "proxy.log"]] as const) { const w = log(name); Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]).then(([o, e]) => { w.write(o); w.end(e); }); }
  const harborEnv: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !SECRET.test(k)) as [string, string][]);
  Object.assign(harborEnv, { ANTHROPIC_API_KEY: "placeholder-not-a-key", PYTHONPATH: join(RUNNER, "agent") });
  let verdict: ReturnType<typeof next>;
  try {
    await waitUp([control + "/healthz", `http://127.0.0.1:${lport}/status`], { "ledger service": ledgerSvc, proxy });
    const served = await fetch(`http://127.0.0.1:${lport}/status`).then((r) => r.json());
    if (!Bun.deepEquals(served, JSON.parse(JSON.stringify(totals(readRows(ledger)))))) throw new Error(`the ledger service on port ${lport} does not serve ${ledger}; no session ran`);
    while (!("verdict" in (verdict = next(rec)))) {
      const { kind, try: n } = verdict;
      const job = `route-${m.id}-${kind}-${n}-${Date.now()}`;
      const part = PARTS.find((p) => p.kind === kind)!;
      const spec = armSpec(part.arm);
      const config = jobConfig({
        job_name: job, tasks_dir: join(out, "tasks"), tasks: ["smoke-task"], models: [cell], arms: [{ ...spec, ...arms[spec.name]! }], attempts: 1, n_concurrent: 1,
        agent_dir: join(RUNNER, "agent"), runner_dir: RUNNER, base_url: `http://${gw}:${dport}`, max_output_tokens: cells.max_output_tokens,
        verifier_timeout_multiplier: cells.verifier_timeout_multiplier, repo_dir: "/testbed",
      });
      config.retry.max_retries = 0;
      if (cport !== "8788") for (const a of config.agents) Object.assign(a.kwargs, { control_url: control });
      writeFileSync(join(out, job + ".json"), JSON.stringify(config, null, 2) + "\n");
      const s: RouteSession = { kind, try: n, job, started_at: new Date().toISOString(), finished_at: null, harbor_exit: null, trial: null, tool_results: 0, model_responded: false, body_loaded: null, proxy_session: null, proxy_cap_stop: null, pass: false, reasons: [] };
      rec.sessions.push(s);
      save();
      const h = Bun.spawn(["harbor", "run", "-y", "-c", join(out, job + ".json")], { cwd: out, env: harborEnv, stdout: "pipe", stderr: "pipe" });
      const [hout, herr] = await Promise.all([new Response(h.stdout).text(), new Response(h.stderr).text()]);
      appendFileSync(join(out, job + ".log"), hout + herr);
      const exit = await h.exited;
      const capStop = await fetch(control + "/totals").then((r) => r.json() as Promise<any>).then((t) => t.cap_stop ?? null, () => "proxy status unreadable");
      const rows = existsSync(sessionsFile) ? readSessionRows([sessionsFile]) : [];
      Object.assign(s, judge(kind, exit, join(out, "jobs", job), rows, proxyConfig, capStop), { harbor_exit: exit, finished_at: new Date().toISOString() });
      save();
      console.log(`route-check ${m.id} ${kind} try ${n}: ${s.pass ? "PASS" : "FAIL"} (Harbor ${exit}; tool results ${s.tool_results}; ${kind === "told" ? `body loaded ${s.body_loaded}; ` : ""}model responded ${s.model_responded}${s.reasons.length ? "; " + s.reasons.join("; ") : ""})`);
    }
  } finally {
    await fetch(control + "/close-all", { method: "POST" }).catch(() => undefined);
    proxy.kill();
    ledgerSvc.kill();
    await Promise.all([proxy.exited, ledgerSvc.exited]);
    if (existsSync(sessionsFile)) reconcile(new Ledger(ledger, m.item), readRows(sessionsFile) as any[], prefix);
    rec.open_route_reserves = totals(readRows(ledger)).openIds.filter((id) => id.startsWith(prefix));
    save();
  }
  rec.verdict = verdict.verdict;
  rec.reason = verdict.reason;
  save();
  const t = totals(readRows(ledger));
  console.log(`${m.item}: settled $${fromMicros(t.settledMicros).toFixed(2)} of $${fromMicros(t.capMicros)}, open route reserves ${rec.open_route_reserves.length}`);
  if (verdict.verdict === "pass") { console.log(`route check: ${m.id} passed on ${m.item} (${verdict.reason})`); return 0; }
  console.log(`route check: ${m.id} dropped out of R3a: ${verdict.reason}`);
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
