// gstack-evals review-units: runs review units as Lane A trials (src/trial/review/README.md). It builds each unit's
// repository and tree from local source clones, builds the Docker rig (arm images, the lease with its rig admission, the
// trial network and the metering proxy) and runs runReviewUnits. --dry-run prints the plan and writes nothing. Whatever
// it cannot do refuses with E_USAGE before anything is built or spent.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadSuite, resolveUnit, type Unit } from "../../../lanes/review-noloss/suite.ts";
import { ledgerPath, recordPath } from "../../runner/ledger/paths.ts";
import { recipeHash, recipeInputs } from "../../rig/recipe.ts";
import { stackKind } from "../../arms/stacks.ts";
import { parseStackRef, type ResolvedArms } from "../../skill-eval/cli/arms.ts";
import type { ArmSpec } from "../../types.ts";
import { HOST_PROVIDERS, newRunId } from "../../skill-eval/cli/call.ts";
import { allowanceMicros, SESSION_ALLOWANCE } from "../../skill-eval/cli/dry-run.ts";
import { DEFAULT_POLICY, loadPolicy, providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { adapterSha256, dockerRig } from "../../skill-eval/cli/run-host.ts";
import { dirTreeSha256 } from "../cache.ts";
import { volatilePathProblem } from "../durable.ts";
import { checkImagePin, stateRoot } from "../image.ts";
import { PARSER_SHA256 } from "./findings.ts";
import { readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewArm } from "./run.ts";
import { TOLD_PREFIX, TOLD_SHA256, toldArmOf, toldSkill } from "./told.ts";
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
].join("\n");

const VALUE = new Set(["--suite", "--passes", "--out", "--ledger", "--record", "--item", "--spend-cap", "--repair", "--parallel", "--timeout", "--allowance", "--severity-map", "--policy", "--date"]);
const LIST = new Set(["--units", "--arms", "--models", "--source", "--base-branch", "--install", "--test"]);
const BOOL = new Set(["--resume", "--dry-run"]);

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
    io.err(/^E_[A-Z_]+[: ]/.test(message) ? message : "E_INTERNAL review-units: " + message);
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
    loaded = loadSuite(one("--suite")!);
  } catch (e) {
    throw new Usage((e as Error).message);
  }
  const { suite } = loaded;
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
  }
  const specs: ArmSpec[] = flags.get("--arms")!.map((s) => {
    if (s === "none") return { name: "none", kind: "bare" };
    const at = s.indexOf("=");
    if (at <= 0 || !/^[a-z][a-z0-9_-]*$/.test(s.slice(0, at))) throw new Usage("--arms takes none or <name>=<repo>@<sha>[:<subtree>], not " + JSON.stringify(s));
    const stack = parseStackRef(s.slice(at + 1));
    if (typeof stack === "string") throw new Usage("--arms " + s.slice(0, at) + ": " + stack);
    return { name: s.slice(0, at), kind: "stack", stack, install: { ...stackKind(stack)?.install } };
  });
  if (new Set(specs.map((a) => a.name)).size !== specs.length) throw new Usage("--arms names an arm twice");
  const arms: ReviewArm[] = specs.map((a) => {
    const told = toldArmOf(a);
    if (!told) throw new Usage("arm " + a.name + " (" + a.kind + "): review units run none, gstack, pstack and tstack arms only");
    return { name: a.name, told };
  });
  const skills = [...new Set(arms.map((a) => toldSkill(a.told)).filter((s): s is string => s !== null))];
  if (skills.length > 1) throw new Usage("these arms need different told skills (" + skills.join(", ") + "), and the rig's arm installer takes one target skill for every arm (src/arms/install.ts); run one stack per invocation, each with its own --out");
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
  let severityMap: Record<string, unknown> | undefined;
  const mapFile = one("--severity-map");
  if (mapFile) {
    try {
      severityMap = JSON.parse(readFileSync(mapFile, "utf8"));
    } catch (e) {
      throw new Usage("--severity-map " + mapFile + ": " + (e as Error).message);
    }
  }
  const out = resolve(one("--out")!);
  const perSession = (m: string) => allowance ?? allowanceMicros({ policy: policy as LoadedPolicy }, m, SESSION_ALLOWANCE) ?? 0;
  const sessions = units.length * arms.length * models.length * passes;
  if (dry) {
    io.out("review-units dry run: nothing is built, written or spent");
    io.out("suite " + suite.id + " (sha256 " + loaded.sha256 + ")");
    io.out("told template sha256 " + TOLD_SHA256 + "; parser sha256 " + PARSER_SHA256);
    io.out("units (" + units.length + "):");
    for (const u of units) io.out("  " + u.id + "  task " + unitTaskId(u) + "  base branch " + (branches.get(u.repo) ?? DEFAULT_BRANCHES[u.repo]) + "  source " + sources.get(u.repo) + "  install " + JSON.stringify(installs.get(u.repo) ?? DEFAULT_INSTALL) + "  test " + JSON.stringify(tests.get(u.repo) ?? "bun test"));
    io.out("arms: " + arms.map((a) => a.name + " (told " + a.told + (TOLD_PREFIX[a.told] ? ", " + JSON.stringify(TOLD_PREFIX[a.told]) : "") + ")").join(", "));
    io.out("models: " + models.join(", ") + "; passes " + passes + "; sessions " + sessions);
    io.out("worst case at the allowance: " + usd(models.reduce((s, m) => s + perSession(m) * units.length * arms.length * passes, 0)) + "; spend cap " + (cap === null ? "none" : usd(cap)));
    io.out("out " + out + (resume ? " (resume)" : ""));
    return 0;
  }
  const item = one("--item");
  if (item === null || cap === null) throw new Usage("a run needs a ledger line item (--item) and --spend-cap");
  const volatile = volatilePathProblem(out);
  if (volatile) throw new Error("E_RECEIPTS_VOLATILE " + volatile);
  if (existsSync(out) && !resume) throw new Usage(out + " exists; pass --resume to continue that run, or a new --out");

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
      const built = buildUnitTree({ repo, task, dest: tree, image: pin.pin.tag, test: tests.get(u.repo) ?? "bun test", ...(installs.has(u.repo) ? { install: installs.get(u.repo)! } : {}), scratch: join(out, "units", ".scratch"), retain: join(state, "retained"), docker });
      rmSync(repo.dir, { recursive: true, force: true });
      if (built.problems.length) throw new UnitError("E_UNIT_IMAGE", built.problems.map((p) => u.id + ": " + p));
      const check = { install: built.install.command, test: built.test.command, passed: built.test.passed };
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
  const runId = newRunId("review-units");
  const tasks = join(out, "fixtures", "tasks.json");
  writeFileSync(tasks, "[]\n");
  const resolved: ResolvedArms = { arms: specs, base: null, skill: skills[0] ? { name: skills[0], source: "the told command" } : null, notes: [] };
  const call = { host: "claude" as const, arms: resolved, tasks, out: { path: out, rule: "--out" }, ledger: ledgerPath(one("--ledger") ?? undefined, env), record: recordPath(one("--record") ?? undefined, env), item, runId, models, policy: policy as LoadedPolicy };
  const rig = dockerRig(call, { env, skill: skills[0] ?? null, nonce: randomBytes(6).toString("hex"), cap });
  let run: Awaited<ReturnType<typeof runReviewUnits>>;
  try {
    run = await runReviewUnits({ host: "claude", suite: { id: suite.id, sha256: loaded.sha256 }, units: prepared, arms, models, passes, parallel, timeoutS, cap, allowanceMicros: allowance, runId, out, date, policy: policy as LoadedPolicy, keyBase: { image_digest: rig.imageDigest, recipe: recipeHash(recipeInputs()), host_version: null, adapter_sha256: adapterSha256("claude"), isolation: "docker" }, journal: rig.recovery?.journal ?? null, reuse: resume ? readReviewJournal(out) : new Map(), repair: flags.has("--repair"), ...(severityMap ? { severityMap } : {}), env }, rig, (line) => io.err(line));
  } finally {
    const closed = await rig.close();
    io.out("lease " + closed.lease_id + " settled: " + usd(closed.committed) + " committed, " + closed.unknown + " unknown calls");
  }
  for (const s of run.stale) io.err(s.code + " " + s.message + "\n  fix: " + s.fix);
  for (const [id, counts] of Object.entries(run.outcomes)) io.out(id + ": " + Object.entries(counts).map(([k, v]) => k + " " + v).join(", "));
  io.out("spent " + usd(run.spent) + "; arms under " + join(out, "arms"));
  return run.stops.length ? 2 : 0;
}
