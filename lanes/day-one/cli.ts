// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals day-one: the day-one usefulness eval (prereg wiki/plans/2026-11-17-geva-546-day-one-usefulness-prereg).
// - units: checks a units dir and prints the units digest the prereg names.
// - stage: one launch of one stage (base, review, build, check) on its ledger item, on the Docker rig (run.ts).
// - judge: the plan judge on a packet list, through the product-value meter on the judge item (judge.ts).
// - gold: the judge's agreement with the gold labels and the controls.
// - controls: the judge's stock and volume controls over a judge run made with --controls.
// - read: the readings over the check stages' rows (analysis.ts), "not counted" until the checker validation and the
//   fixtures with the real checker have passing receipts.
// - validate draw / validate score: the checker validation (R78): a seeded, blinded draw of builds for hand labelling,
//   then kappa on done against the checker's verdicts, written to <out>/validation.json.
// - probe: the fidelity probe's frozen questions to the responder on practice profiles.
// - dryrun: the keyless dry run (dryrun.ts).
// - fixtures: the keyless checker fixtures, placeholder and reference app, on Docker (fixtures.ts); fixtures-real: the
//   same apps through the real checker's session on day1-smoke, written to <out>/fixtures-real.json.
// - voice-check: the keyless Codex voice route in the trial image against a stub provider (voicecheck.ts).
// Every refusal is E_USAGE with a fix line, before anything is built or spent. Every path that holds sealed plaintext
// (units, a stage's out and receipts, the judge's out, the validation's draw and labels, the probe's out) must sit on a
// RAM-backed mount (section 16).
import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { stackKind } from "../../src/arms/stacks.ts";
import { parseStackRef } from "../../src/skill-eval/cli/arms.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { dockerRig } from "../../src/skill-eval/cli/run-host.ts";
import type { ArmSpec } from "../../src/types.ts";
import { openMeter, type Meter } from "../product-value/meter.ts";
import { kappa, seededRandom, shuffle } from "../product-value/stats.ts";
import { read, type ScoredBuild } from "./analysis.ts";
import { nodeVolume, PREFILLED_BYTES } from "./app.ts";
import { runDryrun } from "./dryrun.ts";
import { FIXTURES_RECEIPT, runFixtures, runRealFixtures } from "./fixtures.ts";
import { GSTACK_ARMS, GSTACK_PINS, LIMITS, MODELS, PLAN_ARMS, PROBE_QUESTIONS, SEED, UNIT_SETS, VALIDATION, type PlanArm } from "./frozen.ts";
import { controls, goldAgreement, JUDGE_EFFORT, JUDGE_MAX_TOKENS, labelPacket, packets, padded, stockPlan, type Label } from "./judge.ts";
import { DAYONE_RUN, itemOf, leaseAmount } from "./ledger.ts";
import { ownerPrompt, splitSource } from "./owner.ts";
import { buildDir, runStage, TAG, type Row, type Stage } from "./run.ts";
import { copySamples, loadUnit, taskChecks, unitsDigest, type Unit } from "./units.ts";
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

/** The --tag values; each names a stage dir under the sealed --out, so it is lowercase letters, digits and hyphens. */
const tagsOf = (f: Map<string, string[]>): string[] => {
  const tags = f.get("--tag") ?? refuse("missing --tag");
  for (const t of tags) if (!TAG.test(t)) refuse("--tag " + JSON.stringify(t) + " is not lowercase letters, digits and hyphens");
  return tags;
};

const HELP = [
  "gstack-evals day-one units --units-dir <dir> --units <id>...",
  "gstack-evals day-one stage --stage base|review|build|check --tag <name> --units-dir <dir> --units <id>... --reps <n>... --arms <arm>...",
  "    --out <dir> --receipts <new dir> --item <item> --spend-cap <usd> [--voice-cap <usd>] [--owner-item <item> --owner-spend-cap <usd>]",
  "    [--owner-channel on|dropped] [--parallel <n>] [--ledger <path>] [--record <dir>] [--policy <file>]",
  "gstack-evals day-one judge --units-dir <dir> --packets <file.json> --out <dir> --item <item> --spend-cap <usd> [--controls] [--ledger <path>] [--record <dir>]",
  "gstack-evals day-one controls --units-dir <dir> --labels <labels.ndjson>",
  "gstack-evals day-one gold --labels <labels.ndjson> --gold <gold.ndjson>",
  "gstack-evals day-one read --out <dir> --units-dir <dir> --tag <check tag>... --arms <arm>... [--validation-receipt <file>] [--fixtures-receipt <file>]",
  "gstack-evals day-one validate draw --out <dir> --units-dir <dir> --tag <check tag>... --dest <new dir> --key <file> [--count <n>]",
  "gstack-evals day-one validate score --out <dir> --tag <check tag>... --key <file> --labels <hand labels.ndjson>",
  "gstack-evals day-one probe --units-dir <dir> --units <id>... --count <n> --out <dir> --item <item> --spend-cap <usd> [--ledger <path>] [--record <dir>]",
  "gstack-evals day-one dryrun",
  "gstack-evals day-one fixtures",
  "gstack-evals day-one fixtures-real --out <dir> --item <item> --spend-cap <usd> [--ledger <path>] [--record <dir>] [--policy <file>]",
  "gstack-evals day-one voice-check --image <trial image>",
  "Arms: " + PLAN_ARMS.join(", ") + ". Every frozen text, limit and model is in lanes/day-one/frozen.ts.",
].join("\n");

const LIST = new Set(["--units", "--reps", "--arms", "--tag"]);
const SWITCH = new Set(["--controls"]);
function parse(argv: readonly string[]): Map<string, string[]> {
  const f = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) refuse("unexpected argument " + JSON.stringify(a));
    if (SWITCH.has(a)) {
      f.set(a, ["on"]);
      continue;
    }
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

/** Whether path, or its nearest existing parent, sits on a RAM-backed mount (tmpfs or ramfs). */
function onTmpfs(path: string): boolean {
  let p = resolve(path);
  while (!existsSync(p)) p = dirname(p);
  const real = realpathSync(p);
  let mounts: { at: string; type: string }[];
  try {
    mounts = readFileSync("/proc/mounts", "utf8").split("\n").map((l) => l.split(" ")).filter((x) => x.length > 2).map((x) => ({ at: x[1]!.replace(/\\040/g, " "), type: x[2]! }));
  } catch {
    return false;
  }
  const m = mounts.filter((x) => x.at === "/" || real === x.at || real.startsWith(x.at + "/")).sort((a, b) => b.at.length - a.at.length)[0];
  return !!m && (m.type === "tmpfs" || m.type === "ramfs");
}
/** A path that holds sealed plaintext: refused unless it is on a RAM-backed mount (section 16). */
const sealedPath = (path: string, flag: string): string => {
  const p = resolve(path);
  if (!onTmpfs(p)) refuse(flag + " " + p + " is not on a RAM-backed mount; sealed plaintext lives only under /dev/shm (section 16): put it there, seal what you keep with age and wipe the rest");
  return p;
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

/** The Docker rig for one launch on one item: the lease, the record and the arms' installs. */
function rigFor(f: Map<string, string[]>, env: Env, o: { out: string; item: string; specs: ArmSpec[]; model: string; policy: LoadedPolicy; cap: number }) {
  const ledger = ledgerPath(opt(f, "--ledger"), env);
  const record = recordPath(opt(f, "--record"), env);
  mkdirSync(join(o.out, "fixtures"), { recursive: true });
  writeFileSync(join(o.out, "fixtures", "tasks.json"), "[]\n");
  const lease = leaseAmount(record.path, o.item, o.cap);
  const open = () => dockerRig({ host: "claude", arms: { arms: o.specs, base: null, skill: null, notes: [] }, tasks: join(o.out, "fixtures", "tasks.json"), out: { path: o.out, rule: "--out" }, ledger, record, item: o.item, runId: DAYONE_RUN, models: [o.model], policy: o.policy }, { env, skill: null, skills: Object.fromEntries(o.specs.filter((s) => s.kind === "stack").map((s) => [s.name, "autoplan"])), nonce: randomBytes(6).toString("hex"), cap: lease, voice: false });
  return { ledger, record, open, lease };
}

const policyOf = (f: Map<string, string[]>): LoadedPolicy => {
  const policy = loadPolicy(opt(f, "--policy") ?? DEFAULT_POLICY);
  if ("problem" in policy) return refuse("--policy: " + policy.problem);
  return policy as LoadedPolicy;
};

async function stage(f: Map<string, string[]>, io: Io, env: Env): Promise<number> {
  const parallel = Number(opt(f, "--parallel") ?? "1");
  if (!Number.isInteger(parallel) || parallel < 1) refuse("--parallel is a whole number from 1");
  const st = one(f, "--stage") as Stage;
  if (!["base", "review", "build", "check"].includes(st)) refuse("--stage is base, review, build or check");
  const arms = (f.get("--arms") ?? refuse("missing --arms")) as PlanArm[];
  for (const a of arms) if (!PLAN_ARMS.includes(a)) refuse("--arms: " + a + " is not an arm (" + PLAN_ARMS.join(", ") + ")");
  const channel = opt(f, "--owner-channel") ?? "on";
  if (channel !== "on" && channel !== "dropped") refuse("--owner-channel is on or dropped");
  const unitsDir = sealedPath(one(f, "--units-dir"), "--units-dir");
  const tag = tagsOf(f)[0]!;
  const us = units(unitsDir, f.get("--units") ?? refuse("missing --units"));
  const reps = (f.get("--reps") ?? refuse("missing --reps")).map(Number);
  if (reps.some((r) => !Number.isInteger(r) || r < 1)) refuse("--reps are whole numbers from 1");
  const out = sealedPath(one(f, "--out"), "--out");
  const receipts = sealedPath(one(f, "--receipts"), "--receipts");
  if (existsSync(receipts)) refuse("--receipts " + receipts + " exists; give a sink that does not exist yet");
  const item = one(f, "--item");
  itemOf(item);
  const planning = st === "base" || st === "review";
  const ownerItem = opt(f, "--owner-item");
  const withOwner = planning && channel === "on";
  if (withOwner && !ownerItem) refuse("a planning stage with the owner channel on needs --owner-item and --owner-spend-cap");
  const ownerCap = withOwner ? usd(one(f, "--owner-spend-cap"), "--owner-spend-cap") : 0;
  const policy = policyOf(f);
  const cap = usd(one(f, "--spend-cap"), "--spend-cap");
  const rigArms: (PlanArm | "build" | "check")[] = st === "build" ? ["build"] : st === "check" ? ["check"] : st === "base" ? ["n"] : arms.filter((a) => a !== "n");
  const specs = rigArms.map(armSpec);
  const rig = rigFor(f, env, { out, item, specs, model: st === "check" ? MODELS.checker : MODELS.planner, policy, cap });
  const volume = st === "build" || st === "check" ? nodeVolume(env.GSTACK_EVALS_DOCKER_BIN || "docker").volume : null;
  const owner = withOwner ? await openOwnerMeter({ item: ownerItem!, capMicros: ownerCap, out, record: rig.record.path, ledger: rig.ledger.path, env }) : null;
  try {
    const r = await runStage(
      {
        stage: st,
        tag,
        units: us,
        reps,
        arms,
        out,
        runId: DAYONE_RUN,
        cap,
        lease: rig.lease,
        ownerCap,
        ownerLease: owner?.lease ?? 0,
        voiceCap: opt(f, "--voice-cap") ? usd(opt(f, "--voice-cap")!, "--voice-cap") : 0,
        parallel,
        ownerChannel: channel === "on",
        policy,
        ledger: rig.ledger.path,
        docker: env.GSTACK_EVALS_DOCKER_BIN || "docker",
        scratch: join(out, "scratch"),
        nodeVolume: volume,
        log: (l) => io.err(l),
      },
      { openRig: rig.open, ...(owner ? { ownerMeter: owner.meter } : {}) },
    );
    io.out(st + "-" + r.manifest_sha256.slice(0, 12) + ": " + r.rows.length + " cells ended, " + r.unrun.length + " unrun, $" + (r.spent_micros / 1e6).toFixed(2) + " on the item ($" + (r.voice_micros / 1e6).toFixed(2) + " voice), $" + (r.owner_micros / 1e6).toFixed(2) + " responder");
    for (const s of r.stops) io.err(s.code + " day-one stage: " + s.message);
    return r.stops.length ? 2 : 0;
  } finally {
    await owner?.meter.close();
    cpSync(out, receipts, { recursive: true, filter: (src) => !lstatSync(src).isSocket() && !src.includes("/scratch") });
  }
}

/** The responder's meter for a planning stage and the micro-dollars its lease holds: the --owner-spend-cap, or the owner item's balance when less is left, so a resume asks only for what remains, as the stage's own lease does. The balance is read after the meter settles this run's stale lease from a crashed launch. */
export async function openOwnerMeter(o: { item: string; capMicros: number; out: string; record: string; ledger: string; env: Env }): Promise<{ meter: Meter; lease: number }> {
  let lease = 0;
  const meter = await openMeter({ item: o.item, runId: DAYONE_RUN, out: join(o.out, "owner-meter"), cacheDir: join(o.out, "owner-cache"), maxOutputTokens: 1200, amountMicros: () => (lease = leaseAmount(o.record, o.item, o.capMicros)), record: o.record, ledger: o.ledger, env: o.env });
  return { meter, lease };
}

/** The fixtures with the real checker (the smoke's step), on the smoke's item. */
async function fixturesReal(f: Map<string, string[]>, io: Io, env: Env): Promise<number> {
  const out = resolve(one(f, "--out"));
  const item = one(f, "--item");
  itemOf(item);
  const cap = usd(one(f, "--spend-cap"), "--spend-cap");
  const need = 2 * 2 * LIMITS.check.usd * 1_000_000;
  if (cap < need) refuse("--spend-cap must cover twice the checker's allowance for each of the 2 apps' 2 attempts ($" + need / 1e6 + ")");
  const policy = policyOf(f);
  const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const rigOf = rigFor(f, env, { out, item, specs: [armSpec("check")], model: MODELS.checker, policy, cap });
  const volume = nodeVolume(docker).volume;
  const rig = await rigOf.open();
  try {
    const r = await runRealFixtures({ rig, policy, docker, runId: DAYONE_RUN, out, volume, log: (l) => io.out(l) });
    io.out("fixtures with the real checker: " + (r.passed ? "passed" : "failed") + ", $" + (r.spent_micros / 1e6).toFixed(2) + "; receipt " + join(out, FIXTURES_RECEIPT));
    if (!r.passed) io.err("E_DAYONE_FIXTURE day-one fixtures-real: a fixture missed its bar with the real checker; the wave stops for the Captain");
    return r.passed ? 0 : 2;
  } finally {
    await rig.close();
  }
}

/** The judge's packet list: [{key, unit, plan}] with plan a file path; a category 2 unit's checks come from its list. With --controls, the stock plan goes to every unit (key stock|<unit>) and each listed plan goes again with the stock plan appended (key padded|<key>). */
async function judge(f: Map<string, string[]>, io: Io, env: Env): Promise<number> {
  const unitsDir = sealedPath(one(f, "--units-dir"), "--units-dir");
  const list = JSON.parse(readFileSync(one(f, "--packets"), "utf8")) as { key: string; unit: string; plan: string }[];
  const byUnit = new Map(units(unitsDir, [...new Set(list.map((p) => p.unit))]).map((u) => [u.id, u]));
  const checksOf = (u: Unit) => u.checks ?? taskChecks(u.list!);
  const plans = list.map((p) => {
    const u = byUnit.get(p.unit)!;
    return { key: p.key, brief: u.brief, plan: readFileSync(p.plan, "utf8"), checks: checksOf(u) };
  });
  if (f.has("--controls")) {
    const stock = stockPlan();
    plans.push(...[...byUnit.values()].map((u) => ({ key: "stock|" + u.id, brief: u.brief, plan: stock, checks: checksOf(u) })), ...plans.map((p) => ({ ...p, key: "padded|" + p.key, plan: padded(p.plan) })));
  }
  const out = sealedPath(one(f, "--out"), "--out");
  mkdirSync(out, { recursive: true });
  const { packets: ps, keys } = packets(plans);
  writeFileSync(join(out, "keys.json"), JSON.stringify(keys, null, 2) + "\n");
  const item = one(f, "--item");
  itemOf(item);
  const meter = await openMeter({ item, runId: DAYONE_RUN, out: join(out, "meter"), cacheDir: join(out, "cache"), maxOutputTokens: JUDGE_MAX_TOKENS, amountMicros: usd(one(f, "--spend-cap"), "--spend-cap"), record: recordPath(opt(f, "--record"), env).path, ledger: ledgerPath(opt(f, "--ledger"), env).path, env });
  let short = 0;
  try {
    for (const p of ps) {
      const r = await labelPacket(p, async (o) => ({ text: (await meter.call({ model: MODELS.judge, prompt: o.prompt, maxTokens: JUDGE_MAX_TOKENS, effort: JUDGE_EFFORT, label: o.label })).text }));
      appendFileSync(join(out, "labels.ndjson"), JSON.stringify({ key: keys[p.label], label: p.label, ...r }) + "\n");
      if (r.missing.length) {
        short++;
        io.err("E_DAYONE_JUDGE day-one judge: " + keys[p.label] + ": no label for " + r.missing.join(", "));
      }
    }
    io.out("judged " + ps.length + " packets, $" + (meter.spent() / 1e6).toFixed(2) + (short ? ", " + short + " with cells left unlabelled" : ""));
    return short ? 2 : 0;
  } finally {
    await meter.close();
  }
}

const readNd = (p: string): any[] => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

function gold(f: Map<string, string[]>, io: Io): number {
  const flat = (rows: any[]) => new Map<string, Label>(rows.flatMap((r) => (r.labels as Label[]).map((l) => [r.key + "|" + l.id, l] as const)));
  const j = readNd(sealedPath(one(f, "--labels"), "--labels"));
  const g = readNd(sealedPath(one(f, "--gold"), "--gold"));
  const a = goldAgreement(flat(j), flat(g));
  io.out(JSON.stringify(a));
  if (!a.admitted) io.err("E_DAYONE_GOLD day-one gold: " + a.pairs + " pairs, kappa covered " + a.covered + ", usable " + a.usable + "; no judge number counts");
  return a.admitted ? 0 : 2;
}

/** The rows of the named check stages, and the units and replicates their manifests name. */
function checkRows(out: string, tags: readonly string[]): { rows: Row[]; selected: Set<string> } {
  const selected = new Set<string>();
  const rows = tags.flatMap((t) => {
    const dir = join(out, "check-" + t);
    if (!existsSync(join(dir, "manifest.json"))) refuse("--tag " + t + ": no check stage manifest at " + join(dir, "manifest.json"));
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { units: string[]; reps: number[] };
    for (const u of m.units) for (const r of m.reps) selected.add(u + "/r" + r);
    return existsSync(join(dir, "rows.ndjson")) ? (readNd(join(dir, "rows.ndjson")) as Row[]) : [];
  });
  return { rows, selected };
}

const stageRows = (out: string, prefixes: readonly string[]): Row[] => readdirSync(out).filter((d) => prefixes.some((p) => d.startsWith(p))).flatMap((d) => (existsSync(join(out, d, "rows.ndjson")) ? (readNd(join(out, d, "rows.ndjson")) as Row[]) : []));

function readings(f: Map<string, string[]>, io: Io): number {
  const out = sealedPath(one(f, "--out"), "--out");
  const unitsDir = sealedPath(one(f, "--units-dir"), "--units-dir");
  const arms = (f.get("--arms") ?? refuse("missing --arms")) as PlanArm[];
  const { rows, selected } = checkRows(out, tagsOf(f));
  const planRows = stageRows(out, ["base-", "review-"]);
  const buildRows = stageRows(out, ["build-"]);
  const same = (a: Row, b: Row) => a.cell.unit === b.cell.unit && a.cell.rep === b.cell.rep && a.cell.arm === b.cell.arm;
  const unitOf = new Map<string, Unit>();
  const builds: ScoredBuild[] = [];
  for (const pr of planRows) {
    if (pr.cell.stage === "base" && !arms.includes("n")) continue;
    if (!selected.has(pr.cell.unit + "/r" + pr.cell.rep)) continue;
    const loaded = unitOf.has(pr.cell.unit) ? null : loadUnit(unitsDir, pr.cell.unit);
    const u = unitOf.get(pr.cell.unit) ?? (loaded && "unit" in loaded ? loaded.unit : null);
    if (!u || u.category !== 2 || !arms.includes(pr.cell.arm)) continue;
    unitOf.set(u.id, u);
    const c = rows.find((r) => same(r, pr));
    const b = buildRows.find((r) => same(r, pr));
    const cost = [pr.usd, pr.voice_usd, pr.owner_usd, b?.usd ?? 0, c?.usd ?? 0].reduce((s, x) => s + (x ?? 0), 0);
    builds.push({
      unit: u.id,
      rep: pr.cell.rep,
      arm: pr.cell.arm,
      done: c?.check?.score.done ?? null,
      empty_plan: pr.plan?.words === 0,
      contaminated: pr.state === "contaminated",
      implied: [...u.list!.tasks].sort((a, b) => a.rank - b.rank).map((t) => t.from === "implied"),
      obvious: u.list!.obvious,
      exposed: pr.exposure ? pr.exposure.exposed : null,
      voice: pr.exposure ? pr.exposure.voice : null,
      plan_words: pr.plan?.words ?? null,
      answers: pr.owner ? { ...pr.owner.counts } : null,
      usd: Math.round(cost * 100) / 100,
      prefilled: c?.check ? (c.check.app_writes ?? []).some((w) => w.change === "changed" && w.bytes_before > PREFILLED_BYTES) : null,
      started: c?.check ? c.check.started : null,
    });
  }
  const receipt = (flag: string, name: string) => {
    const p = resolve(opt(f, flag) ?? join(out, name));
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  };
  const blocked: string[] = [];
  if (receipt("--validation-receipt", "validation.json")?.admitted !== true) blocked.push("the checker validation (section 6) has no passing receipt");
  if (receipt("--fixtures-receipt", FIXTURES_RECEIPT)?.passed !== true) blocked.push("the fixtures with the real checker have no passing receipt");
  io.out(JSON.stringify(read(builds, arms, blocked), null, 2));
  return 0;
}

/** The judge's controls over a --controls run's labels. */
function controlsCmd(f: Map<string, string[]>, io: Io): number {
  const unitsDir = sealedPath(one(f, "--units-dir"), "--units-dir");
  const rows = readNd(sealedPath(one(f, "--labels"), "--labels")) as { key: string; labels: Label[] }[];
  const byKey = new Map(rows.map((r) => [r.key, r.labels]));
  const stockRows = rows.filter((r) => r.key.startsWith("stock|"));
  const c = controls({
    stock: stockRows.map((r) => {
      const loaded = loadUnit(unitsDir, r.key.slice(6));
      if ("problems" in loaded) return refuse(r.key + ": " + loaded.problems.join("; "));
      return { checks: loaded.unit.checks ?? taskChecks(loaded.unit.list!), labels: r.labels };
    }),
    volume: rows.filter((r) => r.key.startsWith("padded|")).map((r) => ({ base: byKey.get(r.key.slice(7)) ?? [], padded: r.labels })),
  });
  io.out(JSON.stringify(c));
  if (!c.passed) io.err("E_DAYONE_CONTROLS day-one controls: the stock plan is covered on " + c.stock_primary_covered + " of " + c.stock_primary_checks + " primary checks (at most " + c.stock_allowed + "), volume agreement " + c.volume_agreement + "; no judge number counts");
  return c.passed ? 0 : 2;
}

/** The checker validation's draw: a seeded order of the scored builds, the first VALIDATION.per_arm of each of N, D, R and A first, then the rest in order, S builds included; the checker is validated on N, D, R and A builds and applied unchanged to S builds; each drawn build is copied under a random label with its samples and tasks, and the key goes to its own file. */
function validateDraw(f: Map<string, string[]>, io: Io): number {
  const out = sealedPath(one(f, "--out"), "--out");
  const unitsDir = sealedPath(one(f, "--units-dir"), "--units-dir");
  const dest = sealedPath(one(f, "--dest"), "--dest");
  const keyFile = sealedPath(one(f, "--key"), "--key");
  if (existsSync(dest) || existsSync(keyFile)) refuse("--dest and --key must not exist yet; a draw is written once");
  const count = Number(opt(f, "--count") ?? String(VALIDATION.builds));
  if (!Number.isInteger(count) || count < 1) refuse("--count is a whole number from 1");
  const { rows } = checkRows(out, tagsOf(f));
  const scored = rows.filter((r) => r.state === "scored" && r.check?.started && r.check.parse?.kind === "ok").sort((a, b) => a.id.localeCompare(b.id));
  const order = shuffle(scored, seededRandom(SEED));
  const arms = [...new Set(order.map((r) => r.cell.arm))].sort();
  const firsts = new Set(["n", "d", "r", "a"].flatMap((a) => order.filter((r) => r.cell.arm === a).slice(0, VALIDATION.per_arm).map((r) => r.id)));
  const drawn = [...order.filter((r) => firsts.has(r.id)), ...order.filter((r) => !firsts.has(r.id))].slice(0, count);
  const key: Record<string, { row: string; unit: string; rep: number; arm: PlanArm }> = {};
  let verdicts = 0;
  for (const r of drawn) {
    let label = randomBytes(4).toString("hex");
    while (key[label]) label = randomBytes(4).toString("hex");
    key[label] = { row: r.id, unit: r.cell.unit, rep: r.cell.rep, arm: r.cell.arm };
    const loaded = loadUnit(unitsDir, r.cell.unit);
    if ("problems" in loaded) return refuse(r.cell.unit + ": " + loaded.problems.join("; "));
    const u = loaded.unit;
    cpSync(join(buildDir(out, r.cell.unit, r.cell.rep, r.cell.arm), "tree"), join(dest, label, "app"), { recursive: true, verbatimSymlinks: true });
    copySamples(u, join(dest, label, "samples"));
    const tasks = [...u.list!.tasks].sort((a, b) => a.rank - b.rank).map((t) => ({ id: t.id, task: t.task, success: t.success, data: t.data }));
    writeFileSync(join(dest, label, "tasks.json"), JSON.stringify(tasks, null, 2) + "\n");
    verdicts += tasks.length;
  }
  writeFileSync(keyFile, JSON.stringify(key, null, 2) + "\n");
  const perArm = Object.fromEntries(arms.map((a) => [a, drawn.filter((r) => r.cell.arm === a).length]));
  io.out("drew " + drawn.length + " of " + scored.length + " scored builds (" + Object.entries(perArm).map(([a, n]) => a + " " + n).join(", ") + "), " + verdicts + " tasks; label each task done or not done by hand, blind, into an ndjson of {label, tasks: [{id, done}]}");
  if (verdicts < VALIDATION.verdicts) io.err("E_DAYONE_VALIDATION day-one validate: " + verdicts + " task verdicts, under " + VALIDATION.verdicts + "; draw again with a larger --count into a new --dest and --key");
  return 0;
}

/** The checker validation's score: kappa on done between the hand labels and the checker's verdicts on the drawn builds. */
function validateScore(f: Map<string, string[]>, io: Io): number {
  const out = sealedPath(one(f, "--out"), "--out");
  const tags = tagsOf(f);
  const key = JSON.parse(readFileSync(sealedPath(one(f, "--key"), "--key"), "utf8")) as Record<string, { row: string; arm: PlanArm }>;
  const labels = readNd(sealedPath(one(f, "--labels"), "--labels")) as { label: string; tasks: { id: string; done: boolean }[] }[];
  const { rows } = checkRows(out, tags);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pairs: [boolean, boolean][] = [];
  const perArm: Record<string, number> = {};
  const seen = new Set<string>();
  for (const l of labels) {
    if (seen.has(l.label)) refuse("label " + l.label + " appears twice in the labels file");
    seen.add(l.label);
    const k = key[l.label] ?? refuse("label " + l.label + " is not in the key");
    const parse = byId.get(k.row)?.check?.parse;
    if (parse?.kind !== "ok") return refuse("the checker's verdicts for " + l.label + " are missing or unparsable");
    perArm[k.arm] = (perArm[k.arm] ?? 0) + 1;
    const ids = new Set(l.tasks.map((t) => t.id));
    if (ids.size !== parse.tasks.length || parse.tasks.some((t) => !ids.has(t.id))) refuse(l.label + ": the labels list " + ids.size + " task ids, not exactly the build's " + parse.tasks.length + " tasks");
    const counted = new Map<string, boolean>();
    for (const t of l.tasks) {
      const v = parse.tasks.find((x) => x.id === t.id) ?? refuse(l.label + ": the checker has no verdict for " + t.id);
      if (typeof t.done !== "boolean") refuse(l.label + ": task " + t.id + " has no boolean done");
      if (counted.has(t.id)) {
        if (counted.get(t.id) !== t.done) refuse(l.label + ": task " + t.id + " is labelled both done and not done");
        continue;
      }
      counted.set(t.id, t.done);
      pairs.push([v.done, t.done]);
    }
  }
  const unlabelled = Object.keys(key).filter((l) => !seen.has(l));
  if (unlabelled.length) refuse(unlabelled.length + " drawn builds have no labels (" + unlabelled.join(", ") + "); label every build in the key");
  const k = kappa(pairs);
  const armsShort = ["n", "d", "r", "a"].filter((a) => (perArm[a] ?? 0) < VALIDATION.per_arm);
  const admitted = pairs.length >= VALIDATION.verdicts && k !== null && k >= VALIDATION.kappa && armsShort.length === 0;
  const receipt = { schema: "day-one.validation.v1", builds: labels.length, per_arm: perArm, pairs: pairs.length, kappa: k, admitted };
  writeFileSync(join(out, "validation.json"), JSON.stringify(receipt, null, 2) + "\n");
  io.out(JSON.stringify(receipt));
  if (!admitted) io.err("E_DAYONE_VALIDATION day-one validate: " + pairs.length + " verdicts, kappa " + k + (armsShort.length ? ", under " + VALIDATION.per_arm + " builds for " + armsShort.join(", ") : "") + "; no category 2 number counts");
  return admitted ? 0 : 2;
}

/** The fidelity probe: the frozen questions, one request each, on practice profiles in turn; one transcript per count. */
async function probe(f: Map<string, string[]>, io: Io, env: Env): Promise<number> {
  const unitsDir = sealedPath(one(f, "--units-dir"), "--units-dir");
  const us = units(unitsDir, f.get("--units") ?? refuse("missing --units"));
  const count = Number(one(f, "--count"));
  if (!Number.isInteger(count) || count < 1 || count > 10) refuse("--count is a whole number from 1 to 10");
  const out = sealedPath(one(f, "--out"), "--out");
  mkdirSync(out, { recursive: true });
  const item = one(f, "--item");
  itemOf(item);
  const amount = usd(one(f, "--spend-cap"), "--spend-cap");
  return probeTranscripts({ us, count, out, io, open: () => openMeter({ item, runId: DAYONE_RUN, out: join(out, "meter"), cacheDir: join(out, "cache"), maxOutputTokens: 1200, amountMicros: amount, record: recordPath(opt(f, "--record"), env).path, ledger: ledgerPath(opt(f, "--ledger"), env).path, env }) });
}

/** The probe's transcripts, all on the one meter open() leases, so --spend-cap bounds the whole probe. */
export async function probeTranscripts(o: { us: readonly Pick<Unit, "id" | "profile">[]; count: number; out: string; io: Io; open: () => Promise<Meter> }): Promise<number> {
  const { us, count, out, io } = o;
  const meter = await o.open();
  try {
    for (let i = 0; i < count; i++) {
      const u = us[i % us.length]!;
      const turns = [];
      for (const [n, q] of PROBE_QUESTIONS.entries()) {
        const r = await meter.call({ model: MODELS.owner, prompt: ownerPrompt(u.profile, q), maxTokens: 1024, effort: "low", label: "probe/" + i + "/" + (n + 1) });
        if (r.text === null) {
          io.err("E_DAYONE_OWNER day-one probe: transcript " + i + " question " + (n + 1) + ": " + (r.problem ?? "status " + r.status));
          return 2;
        }
        turns.push({ n: n + 1, question: q, ...splitSource(r.text), gate: false });
      }
      appendFileSync(join(out, "probe.ndjson"), JSON.stringify({ transcript: i, unit: u.id, turns }) + "\n");
    }
  } finally {
    await meter.close();
  }
  io.out("probe: " + count + " transcripts of " + PROBE_QUESTIONS.length + " questions in " + join(out, "probe.ndjson"));
  return 0;
}

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }, env: Env = process.env): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(HELP);
    return sub ? 0 : 2;
  }
  try {
    const verb = sub === "validate" ? rest[0] : undefined;
    const f = sub === "dryrun" ? new Map() : parse(sub === "validate" ? rest.slice(1) : rest);
    if (sub === "units") {
      const dir = sealedPath(one(f, "--units-dir"), "--units-dir");
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
    if (sub === "controls") return controlsCmd(f, io);
    if (sub === "validate") return verb === "draw" ? validateDraw(f, io) : verb === "score" ? validateScore(f, io) : refuse("validate takes draw or score");
    if (sub === "probe") return await probe(f, io, env);
    if (sub === "fixtures-real") return await fixturesReal(f, io, env);
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
