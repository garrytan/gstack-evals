// review-units --plan product-value (src/trial/review/README.md, Product-value units): the command half of the
// product-value lens. It reads a units directory (lanes/product-value/types.ts's layout), builds each unit's family tree
// (product-value.ts), checks the receipts sink is fresh (the #248 ruling), builds the Docker rig and runs runReviewUnits
// with plan.lens product-value. --dry-run builds every unit's plan and brief trees in a scratch dir, asserts both mounts,
// prints each arm's prompt sha256 and writes nothing under --out. Whatever it cannot do refuses with E_USAGE before
// anything is built or spent, and every refusal ends with a fix line.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Family } from "../../../lanes/product-value/types.ts";
import { PV_PARSER_SHA256 } from "../../../lanes/product-value/parse.ts";
import { insideRepo } from "../../../lanes/review-noloss/suite.ts";
import { ledgerPath, recordPath } from "../../runner/ledger/paths.ts";
import { recipeHash, recipeInputs } from "../../rig/recipe.ts";
import { stackKind } from "../../arms/stacks.ts";
import { parseStackRef, type ResolvedArms } from "../../skill-eval/cli/arms.ts";
import { HOST_PROVIDERS, newRunId } from "../../skill-eval/cli/call.ts";
import { DEFAULT_POLICY, loadPolicy, providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { adapterSha256, dockerRig } from "../../skill-eval/cli/run-host.ts";
import type { ArmSpec } from "../../types.ts";
import { receiptsSink, volatilePathProblem } from "../durable.ts";
import { checkImagePin, stateRoot } from "../image.ts";
import { ARM_ID, armId, readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewArm } from "./run.ts";
import { REC_USER_SHA256 } from "./plan.ts";
import { buildPvTree, PV_ARMS, PV_BRIEF_REC_USER_SHA256, PV_GATE_ARM, PV_GSTACK, PV_LENS, PV_MAX_TURNS, PV_MODELS, PV_SEVERITY_MAP, PV_SYSTEM_PROMPT, PV_TEMPLATE_SHA256, PV_TIMEOUT_S, pvArm, pvPrompt, pvTaskId, pvUnitProblems, pvUnitsDigest } from "./product-value.ts";
import { GATE_CONFIG } from "./skill-gates.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const PV_HELP = [
  "gstack-evals review-units --plan product-value --family plan|brief --units-dir <dir> --units <id>...|all --arms <spec>...",
  "    --models <id>... --allowance <usd> --out <dir> [--passes <n>] [--parallel 1] [--pv-fallback-sentence]",
  "    [--item <ledger item> --spend-cap <usd>] [--ledger <path>] [--record <dir>] [--policy <file>] [--date YYYY-MM-DD]",
  "    [--resume] [--repair <note>] [--dry-run]",
  "",
  "Plan family arms: none, lens, plan-ceo-review=garrytan/gstack@" + PV_GSTACK.sha + " and its gate variant",
  PV_GATE_ARM + "=garrytan/gstack@" + PV_GSTACK.sha + " (smoke rule 3). Brief family arms: none, lens, office-hours=garrytan/gstack@" + PV_GSTACK.sha + ".",
  "--pv-fallback-sentence (plan family only, smoke rule 2) puts the frozen sentence after the first line of every plan arm.",
  "Frozen per lens: the claude-code-preset system prompt, " + PV_MAX_TURNS + " turns, a " + PV_TIMEOUT_S + " s timeout, one session at a time,",
  "GSTACK_SESSION_KIND=unattended on the gstack arm, a 200,000-token window, web tools denied, cap stops on and one retry",
  "per infrastructure failure. A run needs GSTACK_EVALS_EPHEMERAL=1 and a GSTACK_EVALS_RECEIPTS sink that does not exist yet.",
].join("\n");

const VALUE = new Set(["--plan", "--family", "--units-dir", "--passes", "--out", "--ledger", "--record", "--item", "--spend-cap", "--repair", "--parallel", "--allowance", "--policy", "--date"]);
const LIST = new Set(["--units", "--arms", "--models"]);
const BOOL = new Set(["--resume", "--dry-run", "--pv-fallback-sentence"]);
class Usage extends Error {}
const refuse = (why: string, fix: string): never => {
  throw new Usage(why + "\n  fix: " + fix);
};

function parseArgs(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (BOOL.has(a)) flags.set(a, []);
    else if (VALUE.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) refuse(a + " needs a value", "give " + a + " its value");
      if (flags.has(a)) refuse(a + " is given twice", "give " + a + " once");
      flags.set(a, [v!]);
    } else if (LIST.has(a)) {
      const vals: string[] = [];
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) vals.push(argv[++i]!);
      if (!vals.length) refuse(a + " needs at least one value", "give " + a + " its values");
      flags.set(a, [...(flags.get(a) ?? []), ...vals]);
    } else refuse("unknown argument " + JSON.stringify(a) + " for --plan product-value, which freezes the system prompt, turn cap, timeout, session kind and allowance rule", "leave it out; see gstack-evals review-units --plan product-value --help");
  }
  return flags;
}

const usd = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

export async function pvMain(argv: string[], io: Io, env: Env): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(PV_HELP);
    return 0;
  }
  try {
    return await pvUnits(argv, io, env);
  } catch (e) {
    if (e instanceof Usage) {
      io.err("E_USAGE review-units: " + e.message);
      return 2;
    }
    const message = (e as Error).message;
    const code = (e as { code?: unknown }).code;
    io.err(/^E_[A-Z_]+[: ]/.test(message) ? message : (typeof code === "string" && /^E_[A-Z_]+$/.test(code) ? code : "E_INTERNAL") + " review-units: " + message);
    return 2;
  }
}

async function pvUnits(argv: string[], io: Io, env: Env): Promise<number> {
  const flags = parseArgs(argv);
  const one = (f: string) => flags.get(f)?.[0] ?? null;
  for (const f of ["--family", "--units-dir", "--units", "--arms", "--models", "--allowance", "--out"]) if (!flags.has(f)) refuse("--plan product-value needs " + f, "pass " + f + "; see --help");
  const family = one("--family") as Family;
  if (family !== "plan" && family !== "brief") refuse("--family takes plan or brief, not " + JSON.stringify(family), "pass --family plan or --family brief");
  const fallback = flags.has("--pv-fallback-sentence");
  if (fallback && family !== "plan") refuse("--pv-fallback-sentence is smoke rule 2's plan-family fallback, and this run is the brief family", "leave out --pv-fallback-sentence");
  const dry = flags.has("--dry-run");
  const resume = flags.has("--resume");
  const unitsDir = resolve(one("--units-dir")!);
  if (!existsSync(unitsDir)) refuse("--units-dir " + unitsDir + " does not exist", "pass the units directory");
  if (insideRepo(unitsDir)) refuse("--units-dir " + unitsDir + " is inside the repo, and units and keys stay sealed outside it", "decrypt the units under the custody rules outside this checkout and pass that dir");
  const refs = flags.get("--units")!;
  const unitIds = refs.length === 1 && refs[0] === "all" ? readdirSync(unitsDir).filter((n) => existsSync(join(unitsDir, n, "unit.json"))).sort() : refs;
  if (!unitIds.length) refuse("--units all finds no unit folder with a unit.json under " + unitsDir, "pass the units directory");
  if (new Set(unitIds).size !== unitIds.length) refuse("--units names a unit twice", "name each unit once");
  const problems = unitIds.flatMap((id) => pvUnitProblems(unitsDir, id, family));
  if (problems.length) refuse("units that cannot run in the " + family + " family:\n  " + problems.join("\n  "), "repair the unit folders, or leave those units out");
  const policyFile = one("--policy") ?? DEFAULT_POLICY;
  const policy = loadPolicy(policyFile);
  if ("problem" in policy) refuse("--policy " + policyFile + ": " + policy.problem, "pass a readable policy file");
  const models = flags.get("--models")!;
  for (const m of models) {
    if (!Object.hasOwn(PV_MODELS, m)) refuse("--models: " + m + " is not a model under test; the prereg names " + Object.keys(PV_MODELS).join(", "), "run only those models, by those policy keys");
    const provider = providerOf(policy as LoadedPolicy, m);
    if (!provider || !HOST_PROVIDERS.claude.includes(provider)) refuse("--models: " + m + " has no Claude Code route in the policy", "pass a policy that routes it through anthropic or openrouter");
  }
  if (new Set(models).size !== models.length) refuse("--models names a model twice", "name each model once");
  const specs: ArmSpec[] = flags.get("--arms")!.map((s) => {
    if (s === "none" || s === "lens") return { name: s, kind: "bare" };
    const at = s.indexOf("=");
    const name = s.slice(0, at);
    const arm = at > 0 ? pvArm(family, name) : null;
    if (!arm || arm.told !== "gstack") refuse("--arms " + JSON.stringify(s) + ": the " + family + " family runs " + Object.keys(PV_ARMS[family]).map((a) => (PV_ARMS[family][a]!.told === "gstack" ? a + "=" + PV_GSTACK.repo + "@" + PV_GSTACK.sha : a)).join(", "), "run only those arms, by those names");
    const stack = parseStackRef(s.slice(at + 1));
    if (typeof stack === "string") return refuse("--arms " + name + ": " + stack, "pass " + name + "=" + PV_GSTACK.repo + "@" + PV_GSTACK.sha);
    if (stack.repo !== PV_GSTACK.repo || stack.sha !== PV_GSTACK.sha || stack.path) refuse("--arms " + name + " runs " + stack.repo + "@" + stack.sha + (stack.path ? ":" + stack.path : "") + ", and the prereg pins " + PV_GSTACK.repo + "@" + PV_GSTACK.sha + " (VERSION " + PV_GSTACK.version + ") whole", "pass " + name + "=" + PV_GSTACK.repo + "@" + PV_GSTACK.sha);
    return { name, kind: "stack", stack, install: { ...stackKind(stack)?.install } };
  });
  if (new Set(specs.map((a) => a.name)).size !== specs.length) refuse("--arms names an arm twice", "name each arm once");
  const parallel = Number(one("--parallel") ?? "1");
  if (parallel !== 1) refuse("--parallel " + one("--parallel") + ": product-value items run one session at a time", "pass --parallel 1 or leave it out");
  const passes = Number(one("--passes") ?? "1");
  if (!Number.isSafeInteger(passes) || passes < 1 || passes > 20) refuse("--passes must be a whole number from 1 to 20", "pass --passes 1 to 20");
  const allowance = Math.round(Number(one("--allowance")) * 1_000_000);
  if (!(allowance > 0)) refuse("--allowance must be a positive number of dollars", "pass the per-arm allowance the Captain recorded, such as --allowance 4");
  const capFlag = one("--spend-cap");
  const cap = capFlag === null ? null : Math.round(Number(capFlag) * 1_000_000);
  if (cap !== null && !(cap > 0)) refuse("--spend-cap must be a positive number of dollars", "pass the item's cap");
  const date = one("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) refuse("--date must be YYYY-MM-DD", "pass --date YYYY-MM-DD");
  const out = resolve(one("--out")!);
  if (insideRepo(out)) refuse("a product-value run holds review text, and --out " + out + " is inside the repo", "pass an --out outside the repo");
  for (const a of specs) for (const m of models) if (!ARM_ID.test(armId(a.name, m))) refuse("arm id " + JSON.stringify(armId(a.name, m)) + " does not match " + ARM_ID, "use the arm names the prereg sets");
  const arms: ReviewArm[] = specs.map((a) => ({ name: a.name, told: pvArm(family, a.name)!.told, systemPrompt: PV_SYSTEM_PROMPT, ...(pvArm(family, a.name)!.told === "gstack" ? { sessionKind: "unattended" as const } : {}) }));
  const skills = Object.fromEntries(arms.flatMap((a) => (pvArm(family, a.name)!.skill ? [[a.name, pvArm(family, a.name)!.skill!]] : [])));
  const digest = pvUnitsDigest(unitsDir, unitIds);
  const suite = { id: "product-value-" + family, sha256: null, sealed: true, catalogs_sha256: digest.sha256, units_dir: unitsDir, unit_ids: [...unitIds].sort((a, b) => (a < b ? -1 : 1)) };
  const runFile = join(out, "run.json");
  const settings = { family, fallback, allowance_usd: allowance / 1_000_000, max_turns: PV_MAX_TURNS, timeout_s: PV_TIMEOUT_S, system_prompt: PV_SYSTEM_PROMPT };
  const prior = resume && existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string; pv?: typeof settings & { launches?: unknown[] } }) : null;
  if (prior && JSON.stringify({ ...prior.pv, launches: undefined }) !== JSON.stringify({ ...settings, launches: undefined })) {
    io.err("E_CACHE_STALE review-units: run " + prior.run_id + " ran with " + JSON.stringify({ ...prior.pv, launches: undefined }) + ", and this resume gives " + JSON.stringify(settings) + "\n  fix: resume with the run's own --family, --pv-fallback-sentence and --allowance, or start a new run in a new --out");
    return 2;
  }
  const sessions = unitIds.length * passes * arms.length * models.length;
  if (dry) {
    io.out("review-units dry run: nothing is built under --out, written or spent");
    io.out("plan lens " + PV_LENS + "; family " + family + (fallback ? "; fallback sentence on (smoke rule 2)" : "") + "; template sha256 " + PV_TEMPLATE_SHA256 + "; parser sha256 " + PV_PARSER_SHA256 + "; rec user sha256 " + (family === "plan" ? REC_USER_SHA256 : PV_BRIEF_REC_USER_SHA256));
    io.out("units dir " + unitsDir + " (" + unitIds.length + " units, " + digest.files + " files, sha256 " + digest.sha256 + ")");
    const scratch = mkdtempSync(join(tmpdir(), "pv-mounts-"));
    const bad: string[] = [];
    try {
      for (const id of unitIds) {
        const seen: string[] = [];
        for (const f of ["plan", "brief"] as const) {
          if (pvUnitProblems(unitsDir, id, f).length) {
            seen.push(f + " family: no " + (f === "plan" ? "plan.md" : "brief.md"));
            continue;
          }
          const tree = buildPvTree(unitsDir, id, f, join(scratch, f, pvTaskId(id)));
          bad.push(...tree.problems);
          seen.push(f + " family sees " + tree.files.filter((x) => !x.startsWith("context/")).join(", ") + " and context/ (" + tree.files.filter((x) => x.startsWith("context/")).length + " files)" + (tree.problems.length ? " BAD" : ""));
        }
        io.out("  " + id + "  task " + pvTaskId(id) + "  " + seen.join("; "));
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    if (bad.length) {
      io.err("E_USAGE review-units: a unit tree is not its family's mount:\n  " + bad.join("\n  ") + "\n  fix: repair the unit folders; key.json and unit.json are never mounted");
      return 2;
    }
    io.out("mounts: ok; plan family sees plan.md and context/ only, brief family sees brief.md and context/ only, key.json and unit.json are never mounted");
    for (const a of arms) io.out("arm " + a.name + " (" + (a.told === "gstack" ? PV_GSTACK.repo + "@" + PV_GSTACK.sha + ", unattended" + (a.name === PV_GATE_ARM ? ", gstack's opt-in gate" : "") : "no gstack install, no skills folder, no drive mount") + "): prompt sha256 " + sha256(pvPrompt(family, a.name, fallback)) + ", first line " + JSON.stringify(pvPrompt(family, a.name, fallback).split("\n\n")[0]));
    io.out("models: " + models.map((m) => m + " (" + providerOf(policy as LoadedPolicy, m) + ")").join(", ") + "; passes " + passes + "; sessions " + sessions + "; one at a time");
    io.out("every arm: system prompt " + PV_SYSTEM_PROMPT + "; max turns " + PV_MAX_TURNS + "; timeout " + PV_TIMEOUT_S + " s; CLAUDE_CODE_DISABLE_1M_CONTEXT=1; CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1; WebSearch and WebFetch denied; network only through the metering proxy");
    io.out("worst case at the allowance with one retry each: " + usd(2 * allowance * sessions) + "; allowance " + usd(allowance) + " a session; spend cap " + (cap === null ? "none" : usd(cap)));
    io.out("out " + out + (resume ? " (resume)" : ""));
    return 0;
  }
  const item = one("--item");
  if (item === null || cap === null) refuse("a run needs a ledger line item (--item) and --spend-cap", "pass the item and the cap the Captain recorded");
  const sink = receiptsSink(env);
  if ("problem" in sink) refuse(sink.problem, "set GSTACK_EVALS_RECEIPTS to a new directory outside the repo");
  if (!("sink" in sink) || !sink.sink) return refuse("every product-value launch uses a receipts sink that does not exist before it (the #248 ruling), and GSTACK_EVALS_EPHEMERAL=1 is not set", "set GSTACK_EVALS_EPHEMERAL=1 and GSTACK_EVALS_RECEIPTS to a path that does not exist yet");
  if (existsSync(sink.sink)) refuse("the receipts sink " + sink.sink + " already exists, and every launch, a resume or repair included, uses a sink that does not exist before it (the #248 ruling)", "set GSTACK_EVALS_RECEIPTS to a new path for this launch");
  if (insideRepo(sink.sink)) refuse("the receipts sink " + sink.sink + " is inside the repo, and the receipts quote review text", "set GSTACK_EVALS_RECEIPTS outside the repo");
  const volatile = volatilePathProblem(out);
  if (volatile) throw new Error("E_RECEIPTS_VOLATILE " + volatile);
  if (existsSync(out) && !resume) refuse(out + " exists", "pass --resume to continue that run, or a new --out");
  const state = stateRoot(env);
  const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const pin = checkImagePin({ state, docker });
  if (!pin.ok) throw new Error(pin.code + " " + pin.message);
  const prepared: PreparedUnit[] = [];
  const bad: string[] = [];
  for (const id of unitIds) {
    const task = pvTaskId(id);
    const tree = buildPvTree(unitsDir, id, family, join(out, "units", task, "tree"));
    bad.push(...tree.problems);
    prepared.push({ unit: { id, repo: "product-value/" + family, pr: 0, head: tree.tree_sha256, base: "" }, task, base_branch: "", merge_base: "", tree: join(out, "units", task, "tree"), tree_sha256: tree.tree_sha256, instructions: {}, check: null });
  }
  if (bad.length) refuse("a unit tree is not its family's mount:\n  " + bad.join("\n  "), "repair the unit folders; key.json and unit.json are never mounted");
  const tasks = join(out, "fixtures", "tasks.json");
  mkdirSync(dirname(tasks), { recursive: true });
  writeFileSync(tasks, "[]\n");
  const runId = prior?.run_id ?? newRunId("review-units");
  const launch = { sink: sink.sink, existed: false, checked_at: new Date().toISOString(), resume };
  writeFileSync(runFile, JSON.stringify({ run_id: runId, max_turns: PV_MAX_TURNS, session_kind: null, arm_session_kinds: Object.fromEntries(arms.filter((a) => a.sessionKind).map((a) => [a.name, "unattended"])), allowance_usd: allowance / 1_000_000, pv: { ...settings, launches: [...((prior?.pv?.launches as unknown[]) ?? []), launch] } }, null, 2) + "\n");
  const resolved: ResolvedArms = { arms: specs, base: null, skill: null, notes: [] };
  const call = { host: "claude" as const, arms: resolved, tasks, out: { path: out, rule: "--out" }, ledger: ledgerPath(one("--ledger") ?? undefined, env), record: recordPath(one("--record") ?? undefined, env), item: item!, runId, models, policy: policy as LoadedPolicy };
  const gate = specs.some((a) => a.name === PV_GATE_ARM);
  const rig = dockerRig(call, { env, skill: null, skills, nonce: randomBytes(6).toString("hex"), cap: cap!, voice: false, ...(gate ? { gstackConfig: { [PV_GATE_ARM]: GATE_CONFIG } } : {}) });
  let run: Awaited<ReturnType<typeof runReviewUnits>>;
  try {
    run = await runReviewUnits({ host: "claude", suite, units: prepared, arms, models, passes, parallel: 1, timeoutS: PV_TIMEOUT_S, cap, allowanceMicros: allowance, runId, out, date, policy: policy as LoadedPolicy, keyBase: { image_digest: rig.imageDigest, recipe: recipeHash(recipeInputs()), host_version: null, adapter_sha256: adapterSha256("claude"), isolation: "docker" }, journal: rig.recovery?.journal ?? null, reuse: resume ? readReviewJournal(out) : new Map(), repair: flags.has("--repair"), severityMap: Object.fromEntries(arms.map((a) => [a.name, PV_SEVERITY_MAP])), plan: { lens: PV_LENS }, pv: { family, fallback }, maxTurns: PV_MAX_TURNS, env }, rig, (line) => io.err(line));
  } finally {
    const closed = await rig.close();
    io.out("lease " + closed.lease_id + " settled: " + usd(closed.committed) + " committed, " + closed.unknown + " unknown calls");
  }
  for (const s of run.stale) io.err(s.code + " " + s.message + "\n  fix: " + s.fix);
  for (const [id, counts] of Object.entries(run.outcomes)) io.out(id + ": " + Object.entries(counts).map(([k, v]) => k + " " + v).join(", "));
  io.out("spent " + usd(run.spent) + "; arms under " + join(out, "arms") + "; receipts copied to " + sink.sink);
  return run.stops.length ? 2 : 0;
}
