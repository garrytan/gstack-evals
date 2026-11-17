// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals day-one: the day-one usefulness eval (prereg wiki/plans/2026-11-17-geva-546-day-one-usefulness-prereg).
// - units: checks a units dir and prints the units digest the prereg names.
// - stage: one launch of one stage (base, review, build, check) on its ledger item, on the Docker rig (run.ts).
// - judge: the plan judge on a packet list, through the product-value meter on the judge item (judge.ts).
// - gold: the judge's agreement with the gold labels and the controls.
// - read: the readings over the check stages' rows (analysis.ts).
// - dryrun: the keyless dry run (dryrun.ts).
// - fixtures: the keyless checker fixtures, placeholder and reference app, on Docker (fixtures.ts).
// - voice-check: the keyless Codex voice route in the trial image against a stub provider (voicecheck.ts).
// Every refusal is E_USAGE with a fix line, before anything is built or spent.
import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { stackKind } from "../../src/arms/stacks.ts";
import { parseStackRef } from "../../src/skill-eval/cli/arms.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { dockerRig } from "../../src/skill-eval/cli/run-host.ts";
import type { ArmSpec } from "../../src/types.ts";
import { openMeter } from "../product-value/meter.ts";
import { read, type ScoredBuild } from "./analysis.ts";
import { nodeVolume } from "./app.ts";
import { runDryrun } from "./dryrun.ts";
import { runFixtures } from "./fixtures.ts";
import { GSTACK_ARMS, GSTACK_PINS, MODELS, PLAN_ARMS, UNIT_SETS, type PlanArm } from "./frozen.ts";
import { controls, goldAgreement, JUDGE_EFFORT, JUDGE_MAX_TOKENS, labelPacket, packets, type Label } from "./judge.ts";
import { DAYONE_RUN, itemOf } from "./ledger.ts";
import { runStage, type Row, type Stage } from "./run.ts";
import { loadUnit, taskChecks, unitsDigest, type Unit } from "./units.ts";
import { runVoiceCheck } from "./voicecheck.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (t: string) => void;
  err: (t: string) => void;
}
class Usage extends Error {}
const refuse = (why: string): never => {
  throw new Usage(why);
};

const HELP = [
  "gstack-evals day-one units --units-dir <dir> --units <id>...",
  "gstack-evals day-one stage --stage base|review|build|check --tag <name> --units-dir <dir> --units <id>... --reps <n>... --arms <arm>...",
  "    --out <dir> --receipts <new dir> --item <item> --spend-cap <usd> [--voice-cap <usd>] [--owner-item <item> --owner-spend-cap <usd>]",
  "    [--parallel <n>] [--ledger <path>] [--record <dir>] [--policy <file>]",
  "gstack-evals day-one judge --units-dir <dir> --packets <file.json> --out <dir> --item <item> --spend-cap <usd> [--ledger <path>] [--record <dir>]",
  "gstack-evals day-one gold --labels <labels.ndjson> --gold <gold.ndjson>",
  "gstack-evals day-one read --out <dir> --units-dir <dir> --tag <check tag>... --arms <arm>...",
  "gstack-evals day-one dryrun",
  "gstack-evals day-one fixtures",
  "gstack-evals day-one voice-check --image <trial image>",
  "Arms: " + PLAN_ARMS.join(", ") + ". Every frozen text, limit and model is in lanes/day-one/frozen.ts.",
].join("\n");

const LIST = new Set(["--units", "--reps", "--arms", "--tag"]);
function parse(argv: readonly string[]): Map<string, string[]> {
  const f = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) refuse("unexpected argument " + JSON.stringify(a));
    const vals: string[] = [];
    while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) vals.push(argv[++i]!);
    if (!vals.length) refuse(a + " needs a value");
    if (!LIST.has(a) && vals.length > 1) refuse(a + " takes one value");
    if (f.has(a)) refuse(a + " is given twice");
    f.set(a, vals);
  }
  return f;
}
const one = (f: Map<string, string[]>, k: string): string => f.get(k)?.[0] ?? refuse("missing " + k);
const opt = (f: Map<string, string[]>, k: string): string | undefined => f.get(k)?.[0];
const usd = (v: string, k: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) refuse(k + " is not a dollar amount");
  return Math.round(n * 1_000_000);
};

/** Each frozen split the ids touch must be whole in dir and read back its digest. */
function sealedProblems(dir: string, ids: readonly string[]): string[] {
  const p: string[] = [];
  for (const [name, s] of Object.entries(UNIT_SETS)) {
    if (!ids.some((id) => (s.labels as readonly string[]).includes(id))) continue;
    const absent = s.labels.filter((l) => !existsSync(join(dir, l)));
    if (absent.length) {
      p.push("the " + name + " split is not whole in " + dir + " (missing " + absent.join(", ") + ")");
      continue;
    }
    const d = unitsDigest(dir, s.labels);
    if (d.sha256 !== s.digest) p.push("the " + name + " split reads digest " + d.sha256 + ", not the frozen " + s.digest);
  }
  const loose = ids.filter((id) => !Object.values(UNIT_SETS).some((s) => (s.labels as readonly string[]).includes(id)));
  if (loose.length) p.push("not in a frozen split: " + loose.join(", "));
  return p;
}

function units(dir: string, ids: readonly string[]): Unit[] {
  const out: Unit[] = [];
  const problems: string[] = sealedProblems(dir, ids);
  for (const id of ids) {
    const r = loadUnit(dir, id);
    if ("problems" in r) problems.push(...r.problems);
    else out.push(r.unit);
  }
  if (problems.length) refuse(problems.join("; "));
  return out;
}

function armSpec(arm: PlanArm | "build" | "check"): ArmSpec {
  if (arm === "build" || arm === "check" || !GSTACK_ARMS.includes(arm)) return { name: arm, kind: "bare" };
  const pin = GSTACK_PINS[arm as "a" | "s-full" | "s-dayone"];
  if (!pin.sha) refuse("arm " + arm + " has no pinned gstack commit yet; it runs once GSTACK_PINS names one by a dated plan change");
  const stack = parseStackRef(pin.repo + "@" + pin.sha);
  if (typeof stack === "string") return refuse(stack);
  return { name: arm, kind: "stack", stack, install: { ...stackKind(stack)?.install } };
}

async function stage(f: Map<string, string[]>, io: Io, env: Env): Promise<number> {
  const st = one(f, "--stage") as Stage;
  if (!["base", "review", "build", "check"].includes(st)) refuse("--stage is base, review, build or check");
  const arms = (f.get("--arms") ?? refuse("missing --arms")) as PlanArm[];
  for (const a of arms) if (!PLAN_ARMS.includes(a)) refuse("--arms: " + a + " is not an arm (" + PLAN_ARMS.join(", ") + ")");
  const unitsDir = resolve(one(f, "--units-dir"));
  const us = units(unitsDir, f.get("--units") ?? refuse("missing --units"));
  const reps = (f.get("--reps") ?? refuse("missing --reps")).map(Number);
  if (reps.some((r) => !Number.isInteger(r) || r < 1)) refuse("--reps are whole numbers from 1");
  const out = resolve(one(f, "--out"));
  const receipts = resolve(one(f, "--receipts"));
  if (existsSync(receipts)) refuse("--receipts " + receipts + " exists; give a sink that does not exist yet");
  const item = one(f, "--item");
  itemOf(item);
  const planning = st === "base" || st === "review";
  const ownerItem = opt(f, "--owner-item");
  if (planning && !ownerItem) refuse("a planning stage needs --owner-item and --owner-spend-cap");
  const policy = loadPolicy(opt(f, "--policy") ?? DEFAULT_POLICY);
  if ("problem" in policy) return refuse("--policy: " + policy.problem);
  const ledger = ledgerPath(opt(f, "--ledger"), env);
  const record = recordPath(opt(f, "--record"), env);
  const rigArms: (PlanArm | "build" | "check")[] = st === "build" ? ["build"] : st === "check" ? ["check"] : st === "base" ? ["n"] : arms.filter((a) => a !== "n");
  const specs = rigArms.map(armSpec);
  const model = st === "check" ? MODELS.checker : MODELS.planner;
  mkdirSync(join(out, "fixtures"), { recursive: true });
  writeFileSync(join(out, "fixtures", "tasks.json"), "[]\n");
  const volume = st === "build" || st === "check" ? nodeVolume(env.GSTACK_EVALS_DOCKER_BIN || "docker").volume : null;
  const meter = planning ? await openMeter({ item: ownerItem!, runId: DAYONE_RUN, out: join(out, "owner-meter"), cacheDir: join(out, "owner-cache"), maxOutputTokens: 1200, amountMicros: usd(one(f, "--owner-spend-cap"), "--owner-spend-cap"), record: record.path, ledger: ledger.path, env }) : null;
  try {
    const r = await runStage(
      {
        stage: st,
        tag: (f.get("--tag") ?? refuse("missing --tag"))[0]!,
        units: us,
        reps,
        arms,
        out,
        runId: DAYONE_RUN,
        cap: usd(one(f, "--spend-cap"), "--spend-cap"),
        ownerCap: planning ? usd(one(f, "--owner-spend-cap"), "--owner-spend-cap") : 0,
        voiceCap: opt(f, "--voice-cap") ? usd(opt(f, "--voice-cap")!, "--voice-cap") : 0,
        parallel: Number(opt(f, "--parallel") ?? "1"),
        policy: policy as LoadedPolicy,
        ledger: ledger.path,
        docker: env.GSTACK_EVALS_DOCKER_BIN || "docker",
        scratch: join(out, "scratch"),
        nodeVolume: volume,
        log: (l) => io.err(l),
      },
      {
        openRig: () => dockerRig({ host: "claude", arms: { arms: specs, base: null, skill: null, notes: [] }, tasks: join(out, "fixtures", "tasks.json"), out: { path: out, rule: "--out" }, ledger, record, item, runId: DAYONE_RUN, models: [model], policy: policy as LoadedPolicy }, { env, skill: null, skills: Object.fromEntries(specs.filter((s) => s.kind === "stack").map((s) => [s.name, "autoplan"])), nonce: randomBytes(6).toString("hex"), cap: usd(one(f, "--spend-cap"), "--spend-cap"), voice: false }),
        ...(meter ? { ownerMeter: meter } : {}),
      },
    );
    io.out(st + "-" + r.manifest_sha256.slice(0, 12) + ": " + r.rows.length + " cells ended, " + r.unrun.length + " unrun, $" + (r.spent_micros / 1e6).toFixed(2) + " on the item ($" + (r.voice_micros / 1e6).toFixed(2) + " voice), $" + (r.owner_micros / 1e6).toFixed(2) + " responder");
    for (const s of r.stops) io.err(s.code + " day-one stage: " + s.message);
    return r.stops.length ? 2 : 0;
  } finally {
    await meter?.close();
    cpSync(out, receipts, { recursive: true, filter: (src) => !lstatSync(src).isSocket() && !src.includes("/scratch") });
  }
}

/** The judge's packet list: [{key, unit, plan}] with plan a file path; a category 2 unit's checks come from its list. */
async function judge(f: Map<string, string[]>, io: Io, env: Env): Promise<number> {
  const unitsDir = resolve(one(f, "--units-dir"));
  const list = JSON.parse(readFileSync(one(f, "--packets"), "utf8")) as { key: string; unit: string; plan: string }[];
  const byUnit = new Map(units(unitsDir, [...new Set(list.map((p) => p.unit))]).map((u) => [u.id, u]));
  const plans = list.map((p) => {
    const u = byUnit.get(p.unit)!;
    return { key: p.key, brief: u.brief, plan: readFileSync(p.plan, "utf8"), checks: u.checks ?? taskChecks(u.list!) };
  });
  const out = resolve(one(f, "--out"));
  mkdirSync(out, { recursive: true });
  const { packets: ps, keys } = packets(plans);
  writeFileSync(join(out, "keys.json"), JSON.stringify(keys, null, 2) + "\n");
  const item = one(f, "--item");
  itemOf(item);
  const meter = await openMeter({ item, runId: DAYONE_RUN, out: join(out, "meter"), cacheDir: join(out, "cache"), maxOutputTokens: JUDGE_MAX_TOKENS, amountMicros: usd(one(f, "--spend-cap"), "--spend-cap"), record: recordPath(opt(f, "--record"), env).path, ledger: ledgerPath(opt(f, "--ledger"), env).path, env });
  try {
    for (const p of ps) {
      const r = await labelPacket(p, async (o) => ({ text: (await meter.call({ model: MODELS.judge, prompt: o.prompt, maxTokens: JUDGE_MAX_TOKENS, effort: JUDGE_EFFORT, label: o.label })).text }));
      appendFileSync(join(out, "labels.ndjson"), JSON.stringify({ key: keys[p.label], label: p.label, ...r }) + "\n");
      if (r.missing.length) io.err("E_DAYONE_JUDGE day-one judge: " + keys[p.label] + ": no label for " + r.missing.join(", "));
    }
    io.out("judged " + ps.length + " packets, $" + (meter.spent() / 1e6).toFixed(2));
    return 0;
  } finally {
    await meter.close();
  }
}

const readNd = (p: string): any[] => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

function gold(f: Map<string, string[]>, io: Io): number {
  const flat = (rows: any[]) => new Map<string, Label>(rows.flatMap((r) => (r.labels as Label[]).map((l) => [r.key + "|" + l.id, l] as const)));
  const j = readNd(one(f, "--labels"));
  const g = readNd(one(f, "--gold"));
  const a = goldAgreement(flat(j), flat(g));
  io.out(JSON.stringify(a));
  if (!a.admitted) io.err("E_DAYONE_GOLD day-one gold: " + a.pairs + " pairs, kappa covered " + a.covered + ", usable " + a.usable + "; no judge number counts");
  return a.admitted ? 0 : 2;
}

function readings(f: Map<string, string[]>, io: Io): number {
  const out = resolve(one(f, "--out"));
  const unitsDir = resolve(one(f, "--units-dir"));
  const arms = (f.get("--arms") ?? refuse("missing --arms")) as PlanArm[];
  const rows: Row[] = (f.get("--tag") ?? refuse("missing --tag")).flatMap((t) => (existsSync(join(out, "check-" + t, "rows.ndjson")) ? readNd(join(out, "check-" + t, "rows.ndjson")) : []));
  const planRows: Row[] = readdirSync(out).filter((d) => d.startsWith("base-") || d.startsWith("review-")).flatMap((d) => (existsSync(join(out, d, "rows.ndjson")) ? readNd(join(out, d, "rows.ndjson")) : []));
  const unitOf = new Map<string, Unit>();
  const builds: ScoredBuild[] = [];
  for (const pr of planRows) {
    if (pr.cell.stage === "base" && !arms.includes("n")) continue;
    const loaded = unitOf.has(pr.cell.unit) ? null : loadUnit(unitsDir, pr.cell.unit);
    const u = unitOf.get(pr.cell.unit) ?? (loaded && "unit" in loaded ? loaded.unit : null);
    if (!u || u.category !== 2 || !arms.includes(pr.cell.arm)) continue;
    unitOf.set(u.id, u);
    const c = rows.find((r) => r.cell.unit === pr.cell.unit && r.cell.rep === pr.cell.rep && r.cell.arm === pr.cell.arm);
    builds.push({ unit: u.id, rep: pr.cell.rep, arm: pr.cell.arm, done: c?.check?.score.done ?? null, empty_plan: pr.plan?.words === 0, contaminated: pr.state === "contaminated", implied: [...u.list!.tasks].sort((a, b) => a.rank - b.rank).map((t) => t.from === "implied"), obvious: u.list!.obvious });
  }
  io.out(JSON.stringify(read(builds, arms), null, 2));
  return 0;
}

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }, env: Env = process.env): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(HELP);
    return sub ? 0 : 2;
  }
  try {
    const f = sub === "dryrun" ? new Map() : parse(rest);
    if (sub === "units") {
      const dir = resolve(one(f, "--units-dir"));
      const ids = f.get("--units") ?? refuse("missing --units");
      const us = units(dir, ids);
      const d = unitsDigest(dir, ids);
      io.out(us.length + " units, " + d.files + " files, digest " + d.sha256);
      return 0;
    }
    if (sub === "stage") return await stage(f, io, env);
    if (sub === "judge") return await judge(f, io, env);
    if (sub === "gold") return gold(f, io);
    if (sub === "read") return readings(f, io);
    if (sub === "dryrun") return await runDryrun(io);
    if (sub === "fixtures") return await runFixtures(io);
    if (sub === "voice-check") return await runVoiceCheck(io, { image: one(f, "--image") });
    return refuse("unknown subcommand " + JSON.stringify(sub));
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    io.err("E_USAGE day-one " + sub + ": " + e.message + "\nE_USAGE fix: see gstack-evals day-one --help");
    return 2;
  }
}
