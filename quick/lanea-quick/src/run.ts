import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, chmodSync, cpSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BASE_IMAGE, GSTACK_REPO, LIMITS, MODELS, SUITES, WORK, imageTag, lineItem, type ArmName } from "./config.ts";
import { loadResults, readStages } from "./analyze.ts";
import { serveFake } from "./fake-upstream.ts";
import type { Task } from "./grade.ts";
import { Ledger, lockLedger, Reserver } from "./ledger.ts";
import { MeteringProxy } from "./proxy.ts";
import { runSession, type SessionResult } from "./session.ts";
import { failedAttempts, planStage, STAGES, type Cell } from "./plan.ts";

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

async function sh(cmd: string): Promise<string> {
  const p = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`${cmd}: ${err}`);
  return out;
}

interface Prepared {
  suites: Record<string, { tasks: Task[]; ext: any; digests: Record<string, string>; full: string; seed: string }>;
  sizes: Record<string, Record<string, number>>;
  images: Record<string, string>;
}

async function prepare(): Promise<Prepared> {
  const out: Prepared = { suites: {}, sizes: {}, images: {} };
  for (const [name, s] of Object.entries(SUITES)) {
    const full = join(WORK, "tasks", name, "full");
    const seed = join(WORK, "tasks", name, "seed");
    rmSync(join(WORK, "tasks", name), { recursive: true, force: true });
    mkdirSync(full, { recursive: true });
    const depth = s.tasksDir.split("/").length;
    await sh(`git -C "${GSTACK_REPO}" archive ${s.tasksSha} ${s.tasksDir} | tar -x -C "${full}" --strip-components=${depth}`);
    cpSync(full, seed, { recursive: true });
    for (const f of readdirSync(seed)) if (/^tasks.*\.json$/.test(f)) rmSync(join(seed, f));
    const digests: Record<string, string> = {};
    for (const f of readdirSync(full).sort()) digests[f] = sha256(readFileSync(join(full, f)));
    const tasks = JSON.parse(readFileSync(join(full, "tasks.json"), "utf8")) as Task[];
    const ext = existsSync(join(full, "tasks.ext.json")) ? JSON.parse(readFileSync(join(full, "tasks.ext.json"), "utf8")) : { tasks: {} };
    const extraPath = join(import.meta.dir, "..", "tasks", `${name}.extra.json`);
    if (existsSync(extraPath)) {
      const extraExt = join(import.meta.dir, "..", "tasks", `${name}.extra.ext.json`);
      digests[`extra:${name}.extra.json`] = sha256(readFileSync(extraPath));
      digests[`extra:${name}.extra.ext.json`] = sha256(readFileSync(extraExt));
      tasks.push(...(JSON.parse(readFileSync(extraPath, "utf8")) as Task[]));
      Object.assign(ext.tasks, JSON.parse(readFileSync(extraExt, "utf8")).tasks);
      const ids = tasks.map((t) => t.id);
      if (new Set(ids).size !== ids.length) throw new Error(`E_TASKS: duplicate task ids in ${name}`);
    }
    out.suites[name] = { tasks, ext, digests, full, seed };
    for (const arm of ["before", "after", "none"] as ArmName[]) {
      const tag = imageTag(name, arm);
      out.images[tag] = (await sh(`docker image inspect --format '{{.Id}}' ${tag}`)).trim();
      const listing = await sh(`docker run --rm --entrypoint sh ${tag} -c 'cd ~/.claude/skills && find -L . -name "*.md" -type f -printf "%P\\t%s\\n"'`);
      const sizes: Record<string, number> = {};
      const direct: Record<string, boolean> = {};
      for (const line of listing.split("\n")) {
        const [p, n] = line.split("\t");
        if (!p || !n) continue;
        const key = p.replace(/^gstack\//, "");
        const isDirect = !p.startsWith("gstack/");
        if (sizes[key] === undefined || (isDirect && !direct[key])) {
          sizes[key] = Number(n);
          direct[key] = isDirect;
        }
      }
      out.sizes[tag] = sizes;
    }
  }
  out.images[BASE_IMAGE] = (await sh(`docker image inspect --format '{{.Id}}' ${BASE_IMAGE}`)).trim();
  writeFileSync(join(WORK, "prepared.json"), JSON.stringify(out, null, 2));
  return out;
}

function loadPrepared(): Prepared {
  return JSON.parse(readFileSync(join(WORK, "prepared.json"), "utf8"));
}

const cellId = (c: Cell) => `${c.suite}.${c.model.replace("claude-", "")}.${c.task.id}.${c.arm}.t${c.trial}`;
const cellDir = (root: string, c: Cell) => join(root, c.suite, c.model, c.task.id, c.arm, `t${c.trial}`);

interface RunOpts {
  fake: boolean;
  out: string;
  ledgerPath: string;
  cap: number;
  item: string;
  parallel: number;
  prereg: string;
}

// Sessions run on image ids, not mutable tags. A paid run refuses an id that images.json does not pin.
export async function resolveImages(tags: string[], fake: boolean): Promise<Record<string, string>> {
  const pinned = JSON.parse(readFileSync(join(import.meta.dir, "..", "images.json"), "utf8")).images as Record<string, string>;
  const ids: Record<string, string> = {};
  for (const tag of tags) {
    ids[tag] = (await sh(`docker image inspect --format '{{.Id}}' ${tag}`)).trim();
    if (!fake && ids[tag] !== pinned[tag]) throw new Error(`E_IMAGE: ${tag} is ${ids[tag]}, images.json pins ${pinned[tag] ?? "nothing"}`);
  }
  return ids;
}

// Everything that can fail without spending runs before the locks. The locks cover the ledger, WORK (task copies and
// container names) and the results tree, and are released however the run ends.
async function execute(cells: Cell[], opts: RunOpts, stage: string): Promise<{ results: SessionResult[]; capStop: string | null }> {
  await import("@anthropic-ai/claude-agent-sdk");
  if (!opts.fake && !process.env.ANTHROPIC_API_KEY) throw new Error("E_KEY_MISSING: ANTHROPIC_API_KEY is not set");
  const prep = loadPrepared();
  const images = await resolveImages([BASE_IMAGE, ...new Set(cells.map((c) => imageTag(c.suite, c.arm)))], opts.fake);
  const releases: (() => void)[] = [];
  try {
    for (const path of new Set([resolve(opts.ledgerPath), resolve(WORK, "runner"), resolve(opts.out, "runner")])) releases.push(lockLedger(path));
    return await runCells(cells, opts, stage, prep, images);
  } finally {
    for (const release of releases.reverse()) release();
  }
}

async function runCells(cells: Cell[], opts: RunOpts, stage: string, prep: Prepared, images: Record<string, string>): Promise<{ results: SessionResult[]; capStop: string | null }> {
  const hostname = "172.17.0.1";
  let fake: ReturnType<typeof serveFake> | null = null;
  let upstream = "https://api.anthropic.com";
  if (opts.fake) {
    fake = serveFake(hostname, 0, () => "office-hours", join(opts.out, "fake-upstream.jsonl"));
    upstream = `http://${hostname}:${fake.port}`;
  }
  const key = opts.fake ? () => "fake-key" : () => process.env.ANTHROPIC_API_KEY ?? "";
  const proxy = new MeteringProxy({ hostname, port: 0, upstream, upstreamKey: key });
  const ledger = new Ledger(opts.ledgerPath, opts.cap, opts.item, join(opts.out, "ledger-mirror.jsonl"), opts.fake);
  if (opts.fake) ledger.approve({ words: ["keyless fake run, no spend"], by: "lanea-quick test", source: "none" });
  ledger.assertOpen();
  ledger.settleStale("reserved by a runner that stopped before settling; charged at the full reservation");
  const fakeExe = join(WORK, "bin", "claude");
  mkdirSync(join(WORK, "bin"), { recursive: true });
  writeFileSync(fakeExe, "#!/bin/sh\necho 'placeholder: sessions run claude inside docker' >&2\nexit 1\n");
  chmodSync(fakeExe, 0o755);
  const uid = (await sh("id -u")).trim() + ":" + (await sh("id -g")).trim();
  const results: SessionResult[] = [];
  const started = new Date();
  const stageFile = join(opts.out, "stages", `${stage}.${started.getTime()}.json`);
  const unique = <T>(xs: T[]) => [...new Set(xs)];
  const planned = { stage, suite: STAGES[stage]!.suite, models: unique(cells.map((c) => c.model)), tasks: unique(cells.map((c) => c.task.id)), arms: unique(cells.map((c) => c.arm)), trials: unique(cells.map((c) => c.trial)), planned: cells.length, prereg: opts.prereg, fake: opts.fake, started: started.toISOString() };
  mkdirSync(join(opts.out, "stages"), { recursive: true });
  const writeStage = (extra: Record<string, unknown>) => writeFileSync(stageFile, JSON.stringify({ ...planned, ...extra }, null, 2) + "\n");
  writeStage({ status: "running" });
  const reserver = new Reserver(ledger);
  let failure: unknown = null;
  let next = 0;
  const queue = [...cells];
  const worker = async () => {
    while (!reserver.stopped && !failure && next < queue.length) {
      const c = queue[next++]!;
      const dir = cellDir(opts.out, c);
      const done = join(dir, "result.json");
      if (existsSync(done)) {
        const prev = JSON.parse(readFileSync(done, "utf8")) as SessionResult;
        if (prev.status !== "infra_error" || failedAttempts(dir) >= 1) {
          results.push(prev);
          continue;
        }
        renameSync(dir, `${dir}.failed-${failedAttempts(dir) + 1}`);
      } else if (existsSync(dir)) {
        const prior = failedAttempts(dir);
        renameSync(dir, `${dir}.failed-${prior + 1}`);
        if (prior >= 1) continue;
      }
      const id = cellId(c);
      const spec = MODELS[c.model]!;
      const reservation = `${id}.${Date.now()}`;
      if (!(await reserver.reserve(reservation, opts.fake ? 0 : spec.reserveUsd, { session: id, model: c.model, prereg: opts.prereg, fake: opts.fake }))) {
        if (reserver.stopped) writeStage({ status: "running", cap_stop: reserver.stopped });
        return;
      }
      const s = SUITES[c.suite]!;
      const tag = imageTag(c.suite, c.arm);
      const ps = prep.suites[c.suite]!;
      const r = await runSession(
        {
          id,
          suite: c.suite,
          skill: s.skill,
          task: c.task,
          script: ps.ext?.tasks?.[c.task.id]?.user,
          arm: c.arm,
          model: c.model,
          trial: c.trial,
          image: images[tag]!,
          checkImage: images[BASE_IMAGE]!,
          seedDir: ps.seed,
          fixturesDir: ps.full,
          outDir: dir,
          sizes: prep.sizes[tag] ?? {},
          ceilingUsd: opts.fake && process.env.LANEA_FAKE_CEILING ? Number(process.env.LANEA_FAKE_CEILING) : spec.sessionCeilingUsd,
          hardLimitUsd: spec.reserveUsd,
          fakeExecutable: fakeExe,
          agentUid: uid,
        },
        proxy,
      );
      reserver.settle(reservation, opts.fake ? 0 : r.cost_usd, { session: id, usage: r.usage, measured_usd: r.cost_usd, requests: r.requests, sdk_reported_usd: r.sdk.total_cost_usd, status: r.status, fake: opts.fake });
      if (r.cost_usd > spec.reserveUsd + 1e-9) {
        reserver.stop(`STOP: reason=reservation_exceeded session=${id} spent=${r.cost_usd.toFixed(4)} reserved=${spec.reserveUsd}`);
        writeStage({ status: "running", cap_stop: reserver.stopped });
      }
      if (r.status === "infra_error" && failedAttempts(dir) === 0) {
        queue.splice(next, 0, c);
        console.log(`${new Date().toISOString()} ${id} infra_error, rerun queued once: ${r.errors.join(" | ").slice(0, 200)}`);
      } else results.push(r);
      const t = ledger.totals();
      console.log(`${new Date().toISOString()} ${id} ${r.status} pass=${r.pass} opened=${r.opened} $${r.cost_usd.toFixed(4)} spent=$${t.settled.toFixed(2)} open=$${t.open.toFixed(2)} [${results.length}/${cells.length}]`);
    }
  };
  await Promise.all(
    Array.from({ length: opts.parallel }, () =>
      worker().catch((e) => {
        failure ??= e;
        reserver.halt();
      }),
    ),
  );
  proxy.stop();
  fake?.stop(true);
  try {
    ledger.settleStale("runner error before settling; charged at the full reservation");
  } catch (e) {
    failure ??= e;
  }
  if (failure) throw failure;
  const capStop = reserver.stopped;
  if (capStop) console.log(capStop);
  writeStage({ status: "done", finished: results.length, cap_stop: capStop, ended: new Date().toISOString() });
  return { results, capStop };
}

function meanCost(out: string, model: string, suite: string): number | null {
  const costs: number[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== "work" && !e.name.includes(".failed-")) walk(join(d, e.name));
      else if (e.name === "result.json") {
        const r = JSON.parse(readFileSync(join(d, e.name), "utf8")) as SessionResult;
        if (r.model === model) costs.push(r.cost_usd);
      }
    }
  };
  walk(join(out, suite));
  return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      fake: { type: "boolean", default: false },
      out: { type: "string" },
      ledger: { type: "string" },
      parallel: { type: "string" },
      models: { type: "string" },
      tasks: { type: "string" },
      trials: { type: "string" },
      stage: { type: "string" },
      prereg: { type: "string", default: "" },
      arms: { type: "string" },
      words: { type: "string", multiple: true },
      by: { type: "string" },
      source: { type: "string" },
    },
  });
  const cmd = positionals[0];
  if (cmd === "prepare") {
    const release = lockLedger(join(WORK, "runner"));
    try {
      const p = await prepare();
      console.log(JSON.stringify({ digests: Object.fromEntries(Object.entries(p.suites).map(([k, v]) => [k, v.digests])), images: p.images }, null, 2));
    } finally {
      release();
    }
    return;
  }
  const li = lineItem();
  if (cmd === "approve") {
    const ledger = new Ledger(values.ledger ?? li.ledger, li.cap, li.item);
    ledger.approve({ words: values.words!, by: values.by!, source: values.source! });
    console.log(JSON.stringify(ledger.totals()));
    return;
  }
  const out = values.out ?? join(WORK, values.fake ? "runs-fake" : "runs");
  mkdirSync(out, { recursive: true });
  const opts: RunOpts = {
    fake: values.fake!,
    out,
    ledgerPath: values.ledger ?? (values.fake ? join(out, "ledger-fake.jsonl") : li.ledger),
    cap: li.cap,
    item: li.item,
    parallel: Number(values.parallel ?? LIMITS.parallel),
    prereg: values.prereg!,
  };
  if (opts.fake && relative(resolve(out), resolve(opts.ledgerPath)).startsWith("..")) throw new Error("E_LEDGER_FAKE: a --fake run keeps its ledger under --out, never on a paid ledger");
  const prep = loadPrepared();
  const models = values.models?.split(",");
  const trials = (values.trials ?? "1,2,3").split(",").map(Number);
  if (cmd === "run") {
    if (!opts.fake && !/^[0-9a-f]{40}$/.test(opts.prereg)) throw new Error("E_PREREG: pass --prereg <full sha of the pushed prereg commit>");
    const stage = values.stage ?? "S1";
    const unknown = (models ?? []).filter((m) => !MODELS[m]);
    if (unknown.length) throw new Error(`E_TASKS: unknown model ${unknown.join(", ")}`);
    let tasks = prep.suites[STAGES[stage]!.suite]!.tasks;
    if (values.tasks) tasks = tasks.filter((t) => values.tasks!.split(",").includes(t.id));
    let cells = planStage(stage, tasks, trials, models);
    if (values.arms) cells = cells.filter((c) => values.arms!.split(",").includes(c.arm));
    if (!cells.length) throw new Error(`E_TASKS: no cells in ${stage} match --models, --tasks, --trials and --arms`);
    const stops = Object.entries(readStages(opts.out, loadResults(opts.out)).stops).flatMap(([k, labels]) => labels.filter((l) => /^(CAP_STOP|RESERVATION_EXCEEDED) /.test(l)).map((l) => `${l} (${k})`));
    if (stops.length) throw new Error(`E_STAGE_STOPPED: ${stops.join(", ")}; a stop ends the run, so nothing more runs into ${opts.out}`);
    const r = await execute(cells, opts, stage);
    process.exit(r.capStop ? 2 : 0);
  }
  if (cmd === "project") {
    const stage = values.stage ?? "S2";
    const st = STAGES[stage]!;
    const tasks = prep.suites[st.suite]!.tasks;
    const ledger = new Ledger(opts.ledgerPath, opts.cap, opts.item);
    const mean = (m: string, s: string) => meanCost(out, m, s);
    const perSession = (m: string): number | null => {
      if (st.suite === "office-hours") return mean(m, "office-hours");
      const direct = mean(m, "learn");
      if (direct !== null) return direct;
      const oh = mean(m, "office-hours");
      const hOh = mean("claude-haiku-5-5", "office-hours");
      const hLearn = mean("claude-haiku-5-5", "learn");
      return oh !== null && hOh && hLearn !== null ? (oh * hLearn) / hOh : null;
    };
    const perModel = Object.fromEntries(st.models.map((m) => [m, { sessions_per_trial: planStage(stage, tasks, [1], [m]).length, projected_usd_per_session: perSession(m) }]));
    const perTrial = Object.values(perModel).reduce((s, x) => (s === null || x.projected_usd_per_session === null ? null : s + x.sessions_per_trial * x.projected_usd_per_session * 1.25), 0 as number | null);
    const t = ledger.totals();
    const trialsThatFit = perTrial === null ? null : Math.max(0, Math.min(3, Math.floor(t.remaining / perTrial)));
    console.log(JSON.stringify({ stage, per_model: perModel, projected_usd_per_trial: perTrial, trials_that_fit: trialsThatFit, ledger: { settled: t.settled, open: t.open, remaining: t.remaining } }, null, 2));
    return;
  }
  throw new Error(`usage: run.ts prepare | approve --words <w>... --by <who> --source <ref> | run --stage S0|S1|S2|S3 [--fake] [--prereg <sha>] | project --stage S2|S3`);
}

if (import.meta.main) await main();
