// gstack-evals review-units: runs review units as Lane A trials (src/trial/review/README.md). It builds each unit's
// repository and tree from local source clones, builds the Docker rig (arm images, the lease with its rig admission, the
// trial network and the metering proxy) and runs runReviewUnits. --dry-run prints the plan and writes nothing. Whatever
// it cannot do refuses with E_USAGE before anything is built or spent.
import { randomBytes } from "node:crypto";
import { BACKGROUND_WAIT_MS, MAX_TURNS, SYSTEM_PROMPTS, type SystemPrompt } from "../../adapters/claude-code/driver.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ceoSuiteBinding, insideRepo, loadSuite, readsSealedRoot, resolveUnit, type Unit } from "../../../lanes/review-noloss/suite.ts";
import { ledgerPath, recordPath } from "../../runner/ledger/paths.ts";
import { recipeHash, recipeInputs } from "../../rig/recipe.ts";
import { stackKind } from "../../arms/stacks.ts";
import { parseStackRef, type ResolvedArms } from "../../skill-eval/cli/arms.ts";
import type { ArmSpec } from "../../types.ts";
import { HOST_PROVIDERS, newRunId } from "../../skill-eval/cli/call.ts";
import { allowanceMicros, SESSION_ALLOWANCE } from "../../skill-eval/cli/dry-run.ts";
import { DEFAULT_POLICY, loadPolicy, modelProblem, providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { adapterSha256, dockerRig } from "../../skill-eval/cli/run-host.ts";
import { dirTreeSha256 } from "../cache.ts";
import { volatilePathProblem } from "../durable.ts";
import { checkImagePin, stateRoot } from "../image.ts";
import { PARSER_SHA256 } from "./findings.ts";
import { ARM_ID, armId, readReviewJournal, runReviewUnits, sealedSinkProblem, type PreparedUnit, type ReviewArm } from "./run.ts";
import { GSTACK_AUTO, gstackAutoProblem, isPlanLens, PLAN_ASK, PLAN_LENSES, PLAN_PARSER_SHA256, PLAN_SEVERITY_MAP, planSkill, REC_USER_SHA256, TOLD_PLAN_SHA256, type PlanArm, type PlanLens } from "./plan.ts";
import { planArmFor, planNoPrefixProblem, planPrefixProblem, planToldLine, prefixControlProblem } from "./plan-told.ts";
import { loadReaderMap } from "./readers.ts";
import { CEO_LENS, CEO_PARSER_SHA256, CEO_SEVERITY_MAP, CEO_TEMPLATE_SHA256, ceoArmLine, type CeoArm } from "./ceo-outcome.ts";
import { CEO_RUN_PLAN_ARM, forcedPrefixOk, isCeoRunArm } from "./ceo-arms.ts";
import { ENFORCED_ARM, GATE_CONFIG } from "./skill-gates.ts";
import { PV_LENS } from "./product-value.ts";
import { pvMain } from "./pv-cli.ts";
import { ER_LENS } from "./eng-review.ts";
import { erMain } from "./er-cli.ts";
import { TOLD_COMMANDS, TOLD_PREFIX, TOLD_SHA256, toldArmOf, toldSkill } from "./told.ts";
import { buildUnitRepo, buildUnitTree, DEFAULT_BRANCHES, DEFAULT_INSTALL, historyProblems, UnitError, unitTaskId, type UnitRepo } from "./unit.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const REVIEW_UNITS_HELP = [
  "gstack-evals review-units --suite <id|path> --units <unit ref>...|all --arms <spec>... --models <id>... --out <dir>",
  "    --source <owner/repo>=<clone>... [--passes <n>] [--item <ledger item> --spend-cap <usd>] [--ledger <path>] [--record <dir>]",
  "    [--base-branch <owner/repo>=<name>]... [--install <owner/repo>=<command>]... [--test <owner/repo>=<command>]...",
  "    [--parallel <n>] [--timeout <s>] [--allowance <usd>] [--severity-map <file>] [--policy <file>] [--date YYYY-MM-DD]",
  "    [--resume] [--repair <note>] [--dry-run]",
  "    [--plan <lens> [--arm-models <arm>=<model>[,<model>]...]] [--sealed-root <dir>]",
  "    [--system-prompt <arm>=sdk-default|claude-code-preset]... [--told-prefix <arm>=<file>]... [--render <arm>=interactive|unattended]...",
  "    [--max-turns <n>] [--session-kind unattended | --arm-session-kind <arm>=unattended...] [--cap-stops] [--reader-map <file>] [--background-wait <s>]",
  "",
  "--plan ceo runs plan units (a plan suite): arms none, lens, placebo, gstack=<repo>@<sha>, gstack-<suffix>=<repo>@<sha> (a second",
  "gstack arm, which needs a --told-prefix) and gstack-auto=<repo>@<sha>, each with its plan line and the frozen plan output",
  "block, the rec user, no second model, and no install or test step. --arm-models limits an arm to some of --models.",
  "--plan ceo-outcome runs a ceo-outcome suite under the frozen ceo-outcome block (src/trial/review/ceo-outcome.ts): arms none,",
  "lens, gstack-auto=<repo>@<sha>, gstack-forced=<repo>@<sha> (CEO v2's forced line, from the lens) and gstack-enforced=<repo>@<sha>",
  "(the stage 2 amendment's hook-enforced arm: gstack-forced's prompt, the /plan-ceo-review gate on, its record in trial.json's gate), one follow-up turn,",
  "cap stops always on, gaps listed in arm.json rather than stopping the arm, stops.json for a cap stop, and an --out outside the repo.",
  "--sealed-root names the directory outside the repo that holds a sealed suite.",
  "--plan product-value runs the product-value eval's units (src/trial/review/pv-cli.ts); see review-units --plan product-value --help.",
  "--plan eng-review runs the plan-eng-review intentions eval's units (src/trial/review/er-cli.ts); see review-units --plan eng-review --help.",
  "",
  "--system-prompt sets an arm's system prompt: sdk-default (no system prompt option, the default) or claude-code-preset.",
  "--told-prefix gives a code arm's told command the text of a file (one line that opens with the arm's own command, or for a",
  "gstack arm with /ship) in place of the frozen one, and the arm installs the skill that command names. With --plan only a gstack arm takes one: the file's line opens with the lens's command, and the arm's",
  "line becomes that line, a space and \"" + PLAN_ASK + "\". --render serves a gstack stack arm from",
  "its own gstack-modules render of that session kind; on code units only an arm told /review takes one. --max-turns caps each session's model turns (default " + MAX_TURNS + ").",
  "--session-kind unattended sets GSTACK_SESSION_KIND=unattended in every arm's agent env, none included; left out, no arm",
  "gets one. --arm-session-kind sets it for one arm only (repeat it per arm), keyed per arm and recorded in run.json; it can't",
  "run beside --session-kind.",
  "",
  "--allowance caps each session's spend in dollars (default: 1.6M input and 32k output tokens at the model's price).",
  "--cap-stops, code units only, records a code session that the turn cap or the allowance ends as turn_cap or",
  "allowance_stop, scored on the findings it wrote before the stop; left out, both caps keep today's records.",
  "--reader-map writes each code session's readers (the subagents it",
  "launched, named through a map pinned to one gstack commit, such as src/trial/review/reader-maps/gstack-77fe28c39796.json)",
  "to cost.tsv as reader:<name> rows; every gstack arm must run the map's commit and be told /review. run.json records the allowance and the map",
  "when they are set.",
  "",
  "--background-wait bounds how long, in all, a session may sit idle after a turn ends with background work it started still",
  "out (a background Agent or Bash task, or a ScheduleWakeup set while nothing ran), default " + BACKGROUND_WAIT_MS / 1000 + " s. The CLI",
  "takes a turn when that work lands; at the deadline, or at the session timeout while the session sits idle on that work,",
  "the session ends as a missing cell, E_BACKGROUND_DEADLINE, which is a coverage gap, never the arm finding nothing. A",
  "completed session that waited and whose last turn has no json block is scored from its latest turn with a findings",
  "block. run.json records the wait.",
].join("\n");

const VALUE = new Set(["--suite", "--passes", "--out", "--ledger", "--record", "--item", "--spend-cap", "--repair", "--parallel", "--timeout", "--allowance", "--severity-map", "--policy", "--date", "--plan", "--sealed-root", "--max-turns", "--session-kind", "--reader-map", "--background-wait"]);
const LIST = new Set(["--units", "--arms", "--models", "--source", "--base-branch", "--install", "--test", "--arm-models", "--system-prompt", "--told-prefix", "--render", "--arm-session-kind"]);
const BOOL = new Set(["--resume", "--dry-run", "--cap-stops"]);

class Usage extends Error {}

function parseArgs(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (BOOL.has(a)) flags.set(a, []);
    else if (VALUE.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Usage(a + " needs a value");
      if (flags.has(a)) throw new Usage(a + " is given twice");
      flags.set(a, [v]);
    } else if (LIST.has(a)) {
      const vals: string[] = [];
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) vals.push(argv[++i]!);
      if (!vals.length) throw new Usage(a + " needs at least one value");
      flags.set(a, [...(flags.get(a) ?? []), ...vals]);
    } else throw new Usage("unknown argument " + JSON.stringify(a));
  }
  return flags;
}

const pairs = (flag: string, values: readonly string[] = []): Map<string, string> =>
  new Map(values.map((v) => {
    const at = v.indexOf("=");
    if (at <= 0 || at === v.length - 1) throw new Usage(flag + " takes <owner/repo>=<value>, not " + JSON.stringify(v));
    return [v.slice(0, at), v.slice(at + 1)];
  }));

const usd = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);

export async function main(argv: string[], io: Io = { out: console.log, err: console.error }, env: Env = process.env): Promise<number> {
  if (argv.some((a, i) => a === "--plan" && argv[i + 1] === PV_LENS)) return pvMain(argv, io, env);
  if (argv.some((a, i) => a === "--plan" && argv[i + 1] === ER_LENS)) return erMain(argv, io, env);
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(REVIEW_UNITS_HELP);
    return 0;
  }
  try {
    return await reviewUnits(argv, io, env);
  } catch (e) {
    if (e instanceof Usage) {
      io.err("E_USAGE review-units: " + e.message);
      io.err(REVIEW_UNITS_HELP);
      return 2;
    }
    const message = (e as Error).message;
    const code = (e as { code?: unknown }).code;
    io.err(/^E_[A-Z_]+[: ]/.test(message) ? message : (typeof code === "string" && /^E_[A-Z_]+$/.test(code) ? code : "E_INTERNAL") + " review-units: " + message);
    return 2;
  }
}

async function reviewUnits(argv: string[], io: Io, env: Env): Promise<number> {
  const flags = parseArgs(argv);
  const one = (f: string) => flags.get(f)?.[0] ?? null;
  for (const f of ["--suite", "--units", "--arms", "--models", "--out"]) if (!flags.has(f)) throw new Usage("needs " + f);
  const dry = flags.has("--dry-run");
  const resume = flags.has("--resume");
  let loaded: ReturnType<typeof loadSuite>;
  try {
    loaded = loadSuite(one("--suite")!, { sealedRoot: one("--sealed-root") });
  } catch (e) {
    throw new Usage((e as Error).message);
  }
  const { suite } = loaded;
  const planFlag = one("--plan");
  if (planFlag !== null && !isPlanLens(planFlag) && planFlag !== CEO_LENS) throw new Usage("--plan takes a lens: " + [...Object.keys(PLAN_LENSES), CEO_LENS, PV_LENS, ER_LENS].join(", "));
  const ceo = planFlag === CEO_LENS;
  const lens: PlanLens | null = ceo ? "ceo" : (planFlag as PlanLens | null);
  if (ceo && suite.kind !== "ceo-outcome") throw new Usage("--plan ceo-outcome needs a ceo-outcome suite, and suite " + suite.id + " is " + suite.kind + "\n  fix: pass a ceo-outcome suite with --suite, or another --plan for this one");
  if (!ceo && suite.kind === "ceo-outcome") throw new Usage("suite " + suite.id + " is a ceo-outcome suite; pass --plan ceo-outcome\n  fix: rerun with --plan ceo-outcome");
  if (!ceo && (suite.kind === "plan") !== (lens !== null)) throw new Usage(lens ? "--plan needs a plan suite, and suite " + suite.id + " is " + suite.kind : "suite " + suite.id + " is a plan suite; pass --plan <lens>");
  if (flags.has("--arm-models") && !lens) throw new Usage("--arm-models runs with --plan");
  const refs = flags.get("--units")!;
  const units: Unit[] = refs.length === 1 && refs[0] === "all" ? [...suite.units] : refs.map((ref) => {
    const r = resolveUnit(suite, ref);
    if (!r.unit) throw new Usage("--units: " + r.problem);
    return r.unit;
  });
  if (new Set(units.map((u) => u.id)).size !== units.length) throw new Usage("--units names a unit twice");
  const policyFile = one("--policy") ?? DEFAULT_POLICY;
  const policy = loadPolicy(policyFile);
  if ("problem" in policy) throw new Usage("--policy " + policyFile + ": " + policy.problem);
  const models = flags.get("--models")!;
  for (const m of models) {
    const provider = providerOf(policy as LoadedPolicy, m);
    if (!provider || !HOST_PROVIDERS.claude.includes(provider)) throw new Usage("--models: " + m + " has no Claude Code route in the policy (anthropic or openrouter)");
    const problem = (policy as LoadedPolicy).policy.models[m]?.smoke_only ? modelProblem(policy as LoadedPolicy, m, "subject", { smoke: false, item: one("--item") }) : null;
    if (problem) throw new Usage("--models: " + problem);
  }
  const specs: ArmSpec[] = flags.get("--arms")!.map((s) => {
    if (s === "none") return { name: "none", kind: "bare" };
    if (lens && s === "lens") return { name: "lens", kind: "bare" };
    if (lens && s === "placebo") return { name: "placebo", kind: "placebo", of: "gstack" };
    const at = s.indexOf("=");
    if (at <= 0 || !/^[a-z][a-z0-9_-]*$/.test(s.slice(0, at))) throw new Usage("--arms takes none or <name>=<repo>@<sha>[:<subtree>], not " + JSON.stringify(s));
    const stack = parseStackRef(s.slice(at + 1));
    if (typeof stack === "string") throw new Usage("--arms " + s.slice(0, at) + ": " + stack);
    return { name: s.slice(0, at), kind: "stack", stack, install: { ...stackKind(stack)?.install } };
  });
  if (new Set(specs.map((a) => a.name)).size !== specs.length) throw new Usage("--arms names an arm twice");
  const perArm = (flag: string, values: readonly string[] | null): Map<string, string> => {
    const m = new Map<string, string>();
    for (const v of flags.get(flag) ?? []) {
      const at = v.indexOf("=");
      const arm = v.slice(0, at);
      const value = v.slice(at + 1);
      if (at <= 0 || !value) throw new Usage(flag + " takes <arm>=<value>, not " + JSON.stringify(v));
      if (!specs.some((a) => a.name === arm)) throw new Usage(flag + " names arm " + arm + ", which --arms does not run");
      if (m.has(arm)) throw new Usage(flag + " names arm " + arm + " twice");
      if (values && !values.includes(value)) throw new Usage(flag + " gives arm " + arm + " " + JSON.stringify(value) + "; it takes " + values.join(" or "));
      m.set(arm, value);
    }
    return m;
  };
  const systemPrompts = perArm("--system-prompt", SYSTEM_PROMPTS);
  const renders = perArm("--render", ["interactive", "unattended"]);
  for (const name of renders.keys()) {
    const spec = specs.find((a) => a.name === name)!;
    if (spec.kind !== "stack" || toldArmOf(spec) !== "gstack") throw new Usage("--render names arm " + name + ", which is not a gstack stack arm (<name>=<gstack repo>@<sha>)");
  }
  const prefixes = new Map([...perArm("--told-prefix", null)].map(([arm, file]) => {
    try {
      return [arm, readFileSync(file, "utf8").replace(/\n$/, "")] as const;
    } catch (e) {
      throw new Usage("--told-prefix " + arm + ": " + (e as Error).message);
    }
  }));
  const maxTurns = Number(one("--max-turns") ?? MAX_TURNS);
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) throw new Usage("--max-turns must be a whole number from 1");
  const sessionKind = one("--session-kind");
  if (sessionKind !== null && sessionKind !== "unattended") throw new Usage("--session-kind takes unattended; leave it out for no session kind");
  const armKinds = perArm("--arm-session-kind", ["unattended"]);
  if (armKinds.size && sessionKind !== null) throw new Usage("--arm-session-kind sets one arm's session kind, and --session-kind sets every arm's; pass one of them\n  fix: name each arm that runs unattended with --arm-session-kind, and leave out --session-kind");
  const backgroundWaitS = Number(one("--background-wait") ?? BACKGROUND_WAIT_MS / 1000);
  if (!Number.isSafeInteger(backgroundWaitS) || backgroundWaitS < 1) throw new Usage("--background-wait must be whole seconds, at least 1");
  const arms: ReviewArm[] = specs.map((a) => {
    if (ceo) {
      const plan = planArmFor(a);
      if (!isCeoRunArm(a.name) || plan !== CEO_RUN_PLAN_ARM[a.name]) throw new Usage("arm " + a.name + " (" + a.kind + "): --plan ceo-outcome runs arms none, lens, gstack-auto and gstack-forced, and the stage 2 arm gstack-enforced (gstack-auto=<gstack repo>@<sha>, gstack-forced=<gstack repo>@<sha>, gstack-enforced=<gstack repo>@<sha>)\n  fix: run only those five arms, by those names");
      const prefix = prefixes.get(a.name);
      if (prefix !== undefined && !forcedPrefixOk(a.name, prefix)) throw new Usage("--told-prefix " + a.name + ": the ceo-outcome lens takes its line from the lens, and only gstack-forced's and gstack-enforced's is CEO v2's forced line\n  fix: leave out --told-prefix");
      return { name: a.name, told: plan, ...(systemPrompts.has(a.name) ? { systemPrompt: systemPrompts.get(a.name) as SystemPrompt } : {}), ...(prefix !== undefined ? { toldPrefix: prefix } : {}) };
    }
    if (lens) {
      const plan = planArmFor(a);
      if (!plan) throw new Usage("arm " + a.name + " (" + a.kind + "): plan units run none, lens, placebo, gstack=<gstack repo>@<sha>, gstack-<suffix>=<gstack repo>@<sha> and gstack-auto=<gstack repo>@<sha>");
      const prefix = prefixes.get(a.name);
      const refused = prefix === undefined ? null : planPrefixProblem(plan, lens, prefix);
      if (refused) throw new Usage("--told-prefix " + a.name + ": " + refused);
      const lone = planNoPrefixProblem(a.name, plan, prefix);
      if (lone) throw new Usage(lone);
      if (plan === "gstack-auto" && GSTACK_AUTO.min_version === null) throw new Usage("arm gstack-auto: " + gstackAutoProblem(null));
      return { name: a.name, told: plan, ...(systemPrompts.has(a.name) ? { systemPrompt: systemPrompts.get(a.name) as SystemPrompt } : {}), ...(prefix !== undefined ? { toldPrefix: prefix } : {}) };
    }
    const told = toldArmOf(a);
    if (!told) throw new Usage("arm " + a.name + " (" + a.kind + "): review units run none, gstack, pstack and tstack arms only");
    const prefix = prefixes.get(a.name);
    if (prefix !== undefined) {
      if (told === "none") throw new Usage("arm " + a.name + " runs no told command, so it takes no --told-prefix");
      const control = prefixControlProblem(prefix);
      if (control) throw new Usage("--told-prefix " + a.name + ": " + control);
      if (!/^\/\S+( [^\n]*)?$/.test(prefix)) throw new Usage("--told-prefix " + a.name + ": the prefix must be one line that opens with the arm's command, such as " + JSON.stringify(TOLD_PREFIX[told]));
      if (!TOLD_COMMANDS[told].includes(prefix.split(" ")[0]!)) throw new Usage("--told-prefix " + a.name + " opens with " + prefix.split(" ")[0] + ", but the arm's told command opens with " + TOLD_COMMANDS[told].join(" or "));
    }
    const command = (prefix ?? TOLD_PREFIX[told]).split(" ")[0];
    if (renders.has(a.name) && command !== "/review") throw new Usage("--render names arm " + a.name + ", whose told prefix opens with " + command + "; the install checks a render's start line only in the review and investigate skills, so --render takes only an arm told /review");
    return { name: a.name, told, ...(systemPrompts.has(a.name) ? { systemPrompt: systemPrompts.get(a.name) as SystemPrompt } : {}), ...(prefix !== undefined ? { toldPrefix: prefix } : {}) };
  });
  for (const a of arms) if (armKinds.has(a.name)) a.sessionKind = "unattended";
  const mapFile = one("--reader-map");
  const readerMap = mapFile === null ? null : loadReaderMap(mapFile);
  if (readerMap && "problem" in readerMap) throw new Usage("--reader-map " + mapFile + ": " + readerMap.problem);
  if (readerMap && lens) throw new Usage("--reader-map runs on code units, not with --plan");
  const capStops = flags.has("--cap-stops");
  if (capStops && lens) throw new Usage("--cap-stops runs on code units, not with --plan");
  if (readerMap && "map" in readerMap) for (const a of specs) {
    if (a.kind !== "stack" || toldArmOf(a) !== "gstack") continue;
    const command = (prefixes.get(a.name) ?? TOLD_PREFIX.gstack).split(" ")[0];
    if (command !== "/review") throw new Usage("--reader-map " + mapFile + " names /review's readers, and arm " + a.name + "'s told prefix opens with " + command + ", so cost.tsv would misname its readers; leave out --reader-map for that arm's run");
    const pin = readerMap.map.gstack;
    if (a.stack.repo !== pin.repo || a.stack.sha !== pin.sha) throw new Usage("--reader-map " + mapFile + " is pinned to " + pin.repo + "@" + pin.sha + ", and arm " + a.name + " runs " + a.stack.repo + "@" + a.stack.sha + "; use a map for that commit");
  }
  if (lens && specs.some((a) => a.kind === "placebo") && !specs.some((a) => a.name === "gstack")) throw new Usage("the placebo arm is generated from the gstack arm, so --arms needs gstack=<repo>@<sha> too");
  if (lens && specs.some((a) => a.kind === "placebo") && prefixes.has("gstack")) throw new Usage("the placebo arm runs the gstack arm's default line, so arm gstack takes no --told-prefix beside it; give the forced line to a gstack-<suffix> arm");
  const armModels = new Map<string, string[]>();
  for (const v of flags.get("--arm-models") ?? []) {
    const at = v.indexOf("=");
    const arm = v.slice(0, at);
    const list = v.slice(at + 1).split(",").filter(Boolean);
    if (at <= 0 || !list.length) throw new Usage("--arm-models takes <arm>=<model>[,<model>], not " + JSON.stringify(v));
    if (!arms.some((a) => a.name === arm)) throw new Usage("--arm-models names arm " + arm + ", which --arms does not run");
    if (armModels.has(arm)) throw new Usage("--arm-models names arm " + arm + " twice");
    for (const m of list) if (!models.includes(m)) throw new Usage("--arm-models gives arm " + arm + " model " + m + ", which --models does not run");
    armModels.set(arm, list);
  }
  const modelsOf = (arm: string) => armModels.get(arm) ?? models;
  const ids = new Map<string, string>();
  for (const a of arms) for (const m of modelsOf(a.name)) {
    const id = armId(a.name, m);
    if (!ARM_ID.test(id)) throw new Usage("arm id " + JSON.stringify(id) + " (arm " + a.name + ", model " + m + ") does not match " + ARM_ID + "; use a shorter arm name");
    const pair = a.name + " on " + m;
    if (ids.has(id)) throw new Usage("arm id " + JSON.stringify(id) + " names both " + ids.get(id) + " and " + pair + "; rename an arm or drop one of the models");
    ids.set(id, pair);
  }
  const skills = Object.fromEntries(arms.flatMap((a) => {
    const skill = lens ? planSkill(a.told as Parameters<typeof planSkill>[0], lens) : toldSkill(a.told as Parameters<typeof toldSkill>[0], a.toldPrefix);
    return skill ? [[a.name, skill]] : [];
  }));
  const passes = Number(one("--passes") ?? "1");
  if (!Number.isSafeInteger(passes) || passes < 1 || passes > 20) throw new Usage("--passes must be a whole number from 1 to 20");
  const parallel = Number(one("--parallel") ?? "4");
  if (!Number.isSafeInteger(parallel) || parallel < 1) throw new Usage("--parallel must be a whole number from 1");
  const timeoutS = Number(one("--timeout") ?? "3600");
  if (!Number.isSafeInteger(timeoutS) || timeoutS < 60) throw new Usage("--timeout must be whole seconds, at least 60");
  const allowanceFlag = one("--allowance");
  const allowance = allowanceFlag === null ? null : Math.round(Number(allowanceFlag) * 1_000_000);
  if (allowance !== null && !(allowance > 0)) throw new Usage("--allowance must be a positive number of dollars");
  const capFlag = one("--spend-cap");
  const cap = capFlag === null ? null : Math.round(Number(capFlag) * 1_000_000);
  if (cap !== null && !(cap > 0)) throw new Usage("--spend-cap must be a positive number of dollars");
  const date = one("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Usage("--date must be YYYY-MM-DD");
  const sources = pairs("--source", flags.get("--source"));
  const branches = pairs("--base-branch", flags.get("--base-branch"));
  const installs = pairs("--install", flags.get("--install"));
  const tests = pairs("--test", flags.get("--test"));
  for (const repo of new Set(units.map((u) => u.repo))) {
    if (!sources.has(repo)) throw new Usage("no --source for " + repo + "; name a full local clone as " + repo + "=<path>");
    if (!branches.has(repo) && !DEFAULT_BRANCHES[repo]) throw new Usage("no base branch is known for " + repo + "; pass --base-branch " + repo + "=<name>");
  }
  let severityMap: Record<string, unknown> | undefined = lens ? Object.fromEntries(arms.map((a) => [a.name, ceo ? CEO_SEVERITY_MAP : PLAN_SEVERITY_MAP])) : undefined;
  const severityFile = one("--severity-map");
  if (severityFile) {
    try {
      severityMap = JSON.parse(readFileSync(severityFile, "utf8"));
    } catch (e) {
      throw new Usage("--severity-map " + severityFile + ": " + (e as Error).message);
    }
  }
  const out = resolve(one("--out")!);
  if (ceo && insideRepo(out)) throw new Usage("a ceo-outcome run holds review text, and --out " + out + " is inside the repo\n  fix: pass an --out outside the repo");
  const sealedCatalogs = !suite.sealed && readsSealedRoot(suite);
  if ((suite.sealed || sealedCatalogs) && insideRepo(out)) throw new Usage("suite " + suite.id + (suite.sealed ? " is sealed" : " reads catalogs under the sealed root") + ", and --out " + out + " is inside the repo; write sealed runs outside it");
  const sealedSink = sealedSinkProblem({ id: suite.id, sealed: suite.sealed, sealedCatalogs }, env);
  if (sealedSink) throw new Usage(sealedSink);
  const runFile = join(out, "run.json");
  const allowanceUsd = allowance === null ? null : allowance / 1_000_000;
  const mapPin = readerMap && "map" in readerMap ? { file: mapFile!, sha256: readerMap.sha256, gstack: readerMap.map.gstack } : null;
  const prior = resume && existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string; max_turns?: number; session_kind?: string | null; allowance_usd?: number; reader_map?: { sha256: string }; background_wait_s?: number; arm_session_kinds?: Record<string, string> }) : null;
  const priorWait = prior?.background_wait_s ?? BACKGROUND_WAIT_MS / 1000;
  if (prior && ((prior.max_turns ?? MAX_TURNS) !== maxTurns || (prior.session_kind ?? null) !== sessionKind || (prior.allowance_usd ?? null) !== allowanceUsd || (prior.reader_map?.sha256 ?? null) !== (mapPin?.sha256 ?? null) || priorWait !== backgroundWaitS)) {
    const waits = prior.background_wait_s !== undefined || backgroundWaitS !== BACKGROUND_WAIT_MS / 1000;
    const r2 = prior.allowance_usd !== undefined || prior.reader_map !== undefined || allowanceUsd !== null || mapPin !== null;
    const was = r2 ? "max turns " + (prior.max_turns ?? MAX_TURNS) + ", session kind " + (prior.session_kind ?? "not set") + ", allowance " + (prior.allowance_usd === undefined ? "default" : "$" + prior.allowance_usd) + " and reader map " + (prior.reader_map?.sha256 ?? "none") : "max turns " + (prior.max_turns ?? MAX_TURNS) + " and session kind " + (prior.session_kind ?? "not set");
    const now = r2 ? maxTurns + ", " + (sessionKind ?? "not set") + ", " + (allowanceUsd === null ? "default" : "$" + allowanceUsd) + " and " + (mapPin?.sha256 ?? "none") : maxTurns + " and " + (sessionKind ?? "not set");
    io.err("E_CACHE_STALE review-units: run " + prior.run_id + " ran with " + was + (waits ? "; background wait " + priorWait + " s" : "") + ", and this resume gives " + now + (waits ? "; " + backgroundWaitS + " s" : "") + "\n  fix: resume with the run's own --max-turns, --session-kind, --allowance, --reader-map and --background-wait, or start a new run in a new --out");
    return 2;
  }
  const kindsNow = JSON.stringify(Object.fromEntries([...armKinds].sort()));
  const kindsWas = JSON.stringify(Object.fromEntries(Object.entries(prior?.arm_session_kinds ?? {}).sort()));
  if (prior && kindsWas !== kindsNow) {
    io.err("E_CACHE_STALE review-units: run " + prior.run_id + " ran with arm session kinds " + kindsWas + ", and this resume gives " + kindsNow + "\n  fix: resume with the run's own --arm-session-kind flags, or start a new run in a new --out");
    return 2;
  }
  const perSession = (m: string) => allowance ?? allowanceMicros({ policy: policy as LoadedPolicy }, m, SESSION_ALLOWANCE) ?? 0;
  const sessions = units.length * passes * arms.reduce((s, a) => s + modelsOf(a.name).length, 0);
  if (dry) {
    io.out("review-units dry run: nothing is built, written or spent");
    io.out("suite " + suite.id + " (sha256 " + loaded.sha256 + ")");
    io.out(ceo ? "plan lens " + CEO_LENS + "; ceo-outcome template sha256 " + CEO_TEMPLATE_SHA256 + "; ceo parser sha256 " + CEO_PARSER_SHA256 + "; rec user sha256 " + REC_USER_SHA256 + "; cap stops on; one follow-up turn; every arm's agent env sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1 (a 200,000-token window)" : lens ? "plan lens " + lens + "; told plan template sha256 " + TOLD_PLAN_SHA256 + "; plan parser sha256 " + PLAN_PARSER_SHA256 + "; rec user sha256 " + REC_USER_SHA256 : "told template sha256 " + TOLD_SHA256 + "; parser sha256 " + PARSER_SHA256);
    io.out("units (" + units.length + "):");
    for (const u of units) io.out("  " + u.id + "  task " + unitTaskId(u) + "  base branch " + (branches.get(u.repo) ?? DEFAULT_BRANCHES[u.repo]) + "  source " + sources.get(u.repo) + (lens ? "  plan unit: no install or test" : "  install " + JSON.stringify(installs.get(u.repo) ?? DEFAULT_INSTALL) + "  test " + JSON.stringify(tests.get(u.repo) ?? "bun test")));
    io.out("arms: " + arms.map((a) => a.name + (lens ? " (" + JSON.stringify(ceo ? ceoArmLine(a.name as CeoArm) : planToldLine(a.told as PlanArm, lens, a.toldPrefix)) + " on " + modelsOf(a.name).join(", ") + ")" : " (told " + a.told + ((a.toldPrefix ?? TOLD_PREFIX[a.told as keyof typeof TOLD_PREFIX]) ? ", " + JSON.stringify(a.toldPrefix ?? TOLD_PREFIX[a.told as keyof typeof TOLD_PREFIX]) : "") + ")") + (a.systemPrompt ? " system prompt " + a.systemPrompt : "") + (renders.has(a.name) ? " render " + renders.get(a.name) : "")).join(", "));
    io.out("models: " + models.map((m) => m + " (" + providerOf(policy as LoadedPolicy, m) + ")").join(", ") + "; passes " + passes + "; sessions " + sessions);
    if (armKinds.size) io.out("arm session kinds: " + arms.map((a) => a.name + " " + (a.sessionKind ?? "not set")).join(", "));
    if (maxTurns !== MAX_TURNS || sessionKind) io.out("max turns " + maxTurns + "; session kind " + (sessionKind ?? "not set"));
    io.out("background wait " + backgroundWaitS + " s: a session idle with background work it started still out ends at that deadline as a missing cell, E_BACKGROUND_DEADLINE");
    if (capStops) io.out("cap stops: a code session the turn cap or the allowance ends is recorded as turn_cap or allowance_stop and scored on the findings it wrote before the stop");
    if (mapPin) io.out("reader map " + mapPin.file + " (sha256 " + mapPin.sha256 + ", gstack " + mapPin.gstack.repo + "@" + mapPin.gstack.sha + ")");
    io.out("worst case at the allowance: " + usd(arms.reduce((s, a) => s + modelsOf(a.name).reduce((t, m) => t + perSession(m) * units.length * passes, 0), 0)) + "; spend cap " + (cap === null ? "none" : usd(cap)));
    io.out("out " + out + (resume ? " (resume)" : ""));
    return 0;
  }
  const item = one("--item");
  if (item === null || cap === null) throw new Usage("a run needs a ledger line item (--item) and --spend-cap");
  const volatile = volatilePathProblem(out);
  if (volatile) throw new Error("E_RECEIPTS_VOLATILE " + volatile);
  if (existsSync(out) && !resume) throw new Usage(out + " exists; pass --resume to continue that run, or a new --out");
  let bound: ReturnType<typeof ceoSuiteBinding> | null = null;
  try {
    bound = ceo ? ceoSuiteBinding(suite) : null;
  } catch (e) {
    throw new Usage((e as Error).message + "; a ceo-outcome run records its units dir's digest, so ceo rows can bind --units to it\n  fix: pass --sealed-root <dir>, the root whose units dir holds every unit's key.json and plan.md");
  }

  const state = stateRoot(env);
  const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const pin = checkImagePin({ state, docker });
  if (!pin.ok) throw new Error(pin.code + " " + pin.message);
  const prepared: PreparedUnit[] = [];
  const problems: string[] = [];
  for (const u of units) {
    const task = unitTaskId(u);
    const root = join(out, "units", task);
    const tree = join(root, "tree");
    try {
      if (resume && existsSync(join(root, "unit.json")) && existsSync(tree)) {
        const kept = JSON.parse(readFileSync(join(root, "unit.json"), "utf8")) as { repo: UnitRepo; check: PreparedUnit["check"]; retained: PreparedUnit["retained"] };
        const hp = historyProblems(tree, kept.repo);
        if (hp.length) throw new UnitError("E_UNIT_REPO", hp.map((p) => u.id + ": " + p));
        prepared.push({ unit: u, task, base_branch: kept.repo.base_branch, merge_base: kept.repo.merge_base, tree, tree_sha256: dirTreeSha256(tree), instructions: kept.repo.instructions, retained: kept.retained, check: kept.check });
        continue;
      }
      rmSync(root, { recursive: true, force: true });
      const repo = buildUnitRepo({ unit: u, source: sources.get(u.repo)!, dest: join(root, "repo"), ...(branches.has(u.repo) ? { baseBranch: branches.get(u.repo)! } : {}) });
      const hp = historyProblems(repo.dir, repo);
      if (hp.length) throw new UnitError("E_UNIT_REPO", hp.map((p) => u.id + ": " + p));
      const built = buildUnitTree({ repo, task, dest: tree, image: pin.pin.tag, test: lens ? null : (tests.get(u.repo) ?? "bun test"), ...(lens ? { install: null } : installs.has(u.repo) ? { install: installs.get(u.repo)! } : {}), scratch: join(out, "units", ".scratch"), retain: join(state, "retained"), docker });
      rmSync(repo.dir, { recursive: true, force: true });
      if (built.problems.length) throw new UnitError("E_UNIT_IMAGE", built.problems.map((p) => u.id + ": " + p));
      const check = built.install && built.test ? { install: built.install.command, test: built.test.command, passed: built.test.passed } : null;
      writeFileSync(join(root, "unit.json"), JSON.stringify({ repo, check, retained: built.retained }, null, 2) + "\n");
      prepared.push({ unit: u, task, base_branch: repo.base_branch, merge_base: repo.merge_base, tree, tree_sha256: built.tree_sha256, instructions: repo.instructions, retained: built.retained, check });
    } catch (e) {
      if (!(e instanceof UnitError)) throw e;
      problems.push(...e.problems.map((p) => e.code + " " + p));
    }
  }
  if (problems.length) {
    for (const p of problems) io.err(p);
    return 2;
  }
  const tasks = join(out, "fixtures", "tasks.json");
  mkdirSync(dirname(tasks), { recursive: true });
  writeFileSync(tasks, "[]\n");
  const runId = prior?.run_id ?? newRunId("review-units");
  writeFileSync(runFile, JSON.stringify({ run_id: runId, max_turns: maxTurns, session_kind: sessionKind, ...(armKinds.size ? { arm_session_kinds: Object.fromEntries([...armKinds].sort()) } : {}), background_wait_s: backgroundWaitS, ...(allowanceUsd !== null ? { allowance_usd: allowanceUsd } : {}), ...(mapPin ? { reader_map: { sha256: mapPin.sha256, gstack: mapPin.gstack } } : {}) }, null, 2) + "\n");
  const served = specs.map((a): ArmSpec => (a.kind === "stack" && renders.has(a.name) ? { ...a, render: renders.get(a.name) as "interactive" | "unattended" } : a));
  const resolved: ResolvedArms = { arms: [...served.filter((a) => a.kind !== "placebo"), ...served.filter((a) => a.kind === "placebo")], base: null, skill: null, notes: [] };
  const call = { host: "claude" as const, arms: resolved, tasks, out: { path: out, rule: "--out" }, ledger: ledgerPath(one("--ledger") ?? undefined, env), record: recordPath(one("--record") ?? undefined, env), item, runId, models, policy: policy as LoadedPolicy };
  const rig = dockerRig(call, { env, skill: null, skills, nonce: randomBytes(6).toString("hex"), cap, ...(lens ? { voice: false } : {}), ...(ceo && specs.some((a) => a.name === ENFORCED_ARM) ? { gstackConfig: { [ENFORCED_ARM]: GATE_CONFIG } } : {}) });
  let run: Awaited<ReturnType<typeof runReviewUnits>>;
  try {
    run = await runReviewUnits({ host: "claude", suite: { id: suite.id, sha256: loaded.sha256, sealed: suite.sealed, sealedCatalogs, ...(bound ?? {}) }, units: prepared, arms, models, passes, parallel, timeoutS, cap, allowanceMicros: allowance, runId, out, date, policy: policy as LoadedPolicy, keyBase: { image_digest: rig.imageDigest, recipe: recipeHash(recipeInputs()), host_version: null, adapter_sha256: adapterSha256("claude"), isolation: "docker" }, journal: rig.recovery?.journal ?? null, reuse: resume ? readReviewJournal(out) : new Map(), repair: flags.has("--repair"), ...(severityMap ? { severityMap } : {}), ...(lens ? { plan: { lens: ceo ? CEO_LENS : lens } } : {}), ...(armModels.size ? { armModels: Object.fromEntries(armModels) } : {}), maxTurns, backgroundWaitS, ...(sessionKind ? { sessionKind: "unattended" as const } : {}), ...(readerMap && "map" in readerMap ? { readers: { map: readerMap.map, sha256: readerMap.sha256 } } : {}), ...(capStops ? { capStops: true } : {}), env }, rig, (line) => io.err(line));
  } finally {
    const closed = await rig.close();
    io.out("lease " + closed.lease_id + " settled: " + usd(closed.committed) + " committed, " + closed.unknown + " unknown calls");
  }
  for (const s of run.stale) io.err(s.code + " " + s.message + "\n  fix: " + s.fix);
  for (const [id, counts] of Object.entries(run.outcomes)) io.out(id + ": " + Object.entries(counts).map(([k, v]) => k + " " + v).join(", "));
  io.out("spent " + usd(run.spent) + "; arms under " + join(out, "arms"));
  return run.stops.length ? 2 : 0;
}
