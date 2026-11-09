// Copyright (c) 2026 Garry Tan. MIT License.
// review-units --plan devex (prereg wiki/plans/2026-11-09-geva-417-devex-review-intentions-prereg, sections 5, 6 and
// 10; section 15 rules 4 and 7): the command half of the devex lens (devex.ts). It reads a units directory
// (lanes/devex/types.ts's layout), checks every unit folder, builds each arm's tree in a scratch dir and asserts its
// mount, and prints every frozen setting. --dry-run writes nothing under --out and spends nothing. A paid run first
// needs GSTACK_EVALS_DX_PIN to name a checkout at DX_GSTACK.sha holding bin/gstack-session-kind (dxPinProblem), and
// never uses the dry run's stand-in. It then runs one stage 1 frozen run (--run s1-none, s1-smoke or s1-resmoke;
// lanes/devex/leases.ts): the flags must name that run's own arms, models, passes and units (dxPlan), the pin's session
// kinds must match each gstack arm, its one lease opens on the item (openRun: projection plus a tenth plus the in-flight
// reserve), the Docker rig meters on that lease, the session loop (lanes/devex/run/session.ts) runs its sessions in plan
// order at most --parallel at once and writes one row per planned session to <out>/rows.ndjson, and the lease settles at
// the end, printing what settled. A stage 2 run id is refused: its loop is not built at this commit. Whatever it cannot
// do refuses with E_USAGE before anything is built or spent, and every refusal ends with a fix line.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { frozenRuns, openRun } from "../../../lanes/devex/leases.ts";
import { dxPlan, isStage1Run, MAX_PARALLEL, NONE_PASSES, runDxSessions, STAGE1_RUNS, stage1Open, type DxRunResult, type DxTree } from "../../../lanes/devex/run/session.ts";
import { hostDriver } from "../../adapters/host.ts";
import { stackKind } from "../../arms/stacks.ts";
import { rigAdmission } from "../../rig/admission.ts";
import { settleLease } from "../../runner/ledger/ledger.ts";
import { openLocalLedger } from "../../runner/ledger/local.ts";
import { readItem } from "../../runner/ledger/record.ts";
import { ledgerPath, recordPath } from "../../runner/ledger/paths.ts";
import { dockerRig, type HostRig } from "../../skill-eval/cli/run-host.ts";
import type { ResolvedArms } from "../../skill-eval/cli/arms.ts";
import type { ArmSpec } from "../../types.ts";
import { volatilePathProblem } from "../durable.ts";
import { DX_PARSER_SHA256 } from "../../../lanes/devex/run/parse.ts";
import { DX_FINISH, DX_REC_USER_SHA256 } from "../../../lanes/devex/run/persona.ts";
import { REPAIR_NAME, STOP_HOOK_MAX, type Repair } from "../../../lanes/devex/run/stophook.ts";
import { MODEL_STRINGS, type ArmId } from "../../../lanes/devex/types.ts";
import { insideRepo } from "../../../lanes/review-noloss/suite.ts";
import { parseStackRef } from "../../skill-eval/cli/arms.ts";
import { HOST_PROVIDERS } from "../../skill-eval/cli/call.ts";
import { DEFAULT_POLICY, loadPolicy, providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { buildDxTree, DX_ARMS, DX_AUTOPLAN_GATE, DX_COMMON_SHA256, DX_GSTACK, DX_LENS, DX_MOUNTS, DX_PROMPT_SHA256, DX_SYSTEM_PROMPT, DX_TEMPLATE_SHA256, dxArmEnv, dxLimits, dxPinProblem, dxPrompt, dxSessionKind, dxSessionKindProblem, dxTaskId, dxUnitProblems, dxUnitsDigest, isDxArm } from "./devex.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const REPAIRS: Readonly<Record<string, Repair>> = { "stop-hook": "stop hook", "gstack-stop-gate": "gstack stop gate", "double-limits": "double limits" };

export const DX_HELP = [
  "gstack-evals review-units --plan devex --units-dir <dir> --units <id>...|all --arms <spec>... --models <id>... --out <dir>",
  "    [--passes <n>] [--repair <arm>=stop-hook|gstack-stop-gate | --repair double-limits]... [--policy <file>] [--dry-run]",
  "    [--run s1-none|s1-smoke|s1-resmoke] [--parallel <1-8>] [--ledger <path>] [--record <path>] [--control <file>]",
  "",
  "Arms: none, lens, plan-devex-review=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha + " and autoplan=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha + " (VERSION " + DX_GSTACK.version + ").",
  "Models: " + Object.values(MODEL_STRINGS).join(", ") + ".",
  "Frozen per lens: the claude-code-preset system prompt; $" + dxLimits(false).usd + ", " + dxLimits(false).turns + " turns and " + dxLimits(false).minutes + " minutes a session (doubled on every arm",
  "and model only under --repair double-limits); CLAUDE_CODE_DISABLE_1M_CONTEXT=1 and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every arm;",
  "GSTACK_SESSION_KIND=unattended for plan-devex-review and interactive for autoplan; plan-tune state pinned empty in the gstack",
  "arms; WebSearch and WebFetch denied; the reviewer subagent on the cell's model; mounts " + DX_MOUNTS.repo + " and " + DX_MOUNTS.plan + " only.",
  "--repair names smoke rule 5's one repair: plan-devex-review=stop-hook (with an enforced procedure), autoplan=gstack-stop-gate",
  "(with gstack's stop gate), or double-limits for every arm. --dry-run checks and prints everything and spends nothing.",
  "A paid run needs GSTACK_EVALS_DX_PIN and --run, one stage 1 frozen run on its own ledger lease: s1-none (16 units, 3 passes),",
  "s1-smoke (units 1 to 10 in draw order) or s1-resmoke (the repaired arms). It writes one row per planned session to",
  "<out>/rows.ndjson and settles the lease at the end. --control names the file a stop the Captain records mid-run goes in",
  "(<out>/control.ndjson by default). Stage 2 runs are not built at this commit.",
].join("\n");

const VALUE = new Set(["--plan", "--units-dir", "--passes", "--out", "--policy", "--run", "--parallel", "--ledger", "--record", "--control"]);
const LIST = new Set(["--units", "--arms", "--models", "--repair"]);
const BOOL = new Set(["--dry-run"]);
class Usage extends Error {}
const refuse = (why: string, fix: string): never => {
  throw new Usage(why + "\n  fix: " + fix);
};
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const usd = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);

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
    } else refuse("unknown argument " + JSON.stringify(a) + " for --plan devex, which freezes the system prompt, limits, session kinds, env and mounts", "leave it out; see gstack-evals review-units --plan devex --help");
  }
  return flags;
}

export async function dxMain(argv: string[], io: Io, env: Env): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(DX_HELP);
    return 0;
  }
  try {
    return await dxUnits(argv, io, env);
  } catch (e) {
    if (e instanceof Usage) {
      io.err("E_USAGE review-units: " + e.message);
      return 2;
    }
    const message = (e as Error).message;
    io.err(/^E_[A-Z_]+[: ]/.test(message) ? message : "E_INTERNAL review-units: " + message);
    return 2;
  }
}

async function dxUnits(argv: string[], io: Io, env: Env): Promise<number> {
  const flags = parseArgs(argv);
  const one = (f: string) => flags.get(f)?.[0] ?? null;
  for (const f of ["--units-dir", "--units", "--arms", "--models", "--out"]) if (!flags.has(f)) refuse("--plan devex needs " + f, "pass " + f + "; see --help");
  const unitsDir = resolve(one("--units-dir")!);
  if (!existsSync(unitsDir)) refuse("--units-dir " + unitsDir + " does not exist", "pass the units directory");
  if (insideRepo(unitsDir)) refuse("--units-dir " + unitsDir + " is inside the repo, and units, keys and alias maps stay sealed outside it", "decrypt the units under the custody rules outside this checkout and pass that dir");
  const refs = flags.get("--units")!;
  const unitIds = refs.length === 1 && refs[0] === "all" ? readdirSync(unitsDir).filter((n) => existsSync(join(unitsDir, n, "unit.json"))).sort() : refs;
  if (!unitIds.length) refuse("--units all finds no unit folder with a unit.json under " + unitsDir, "pass the units directory");
  if (new Set(unitIds).size !== unitIds.length) refuse("--units names a unit twice", "name each unit once");
  const problems = unitIds.flatMap((id) => dxUnitProblems(unitsDir, id));
  if (problems.length) refuse("units that cannot run:\n  " + problems.join("\n  "), "repair the unit folders, or leave those units out");
  const policyFile = one("--policy") ?? DEFAULT_POLICY;
  const policy = loadPolicy(policyFile);
  if ("problem" in policy) refuse("--policy " + policyFile + ": " + policy.problem, "pass a readable policy file");
  const models = flags.get("--models")!;
  const known = Object.values(MODEL_STRINGS);
  for (const m of models) {
    if (!known.includes(m)) refuse("--models: " + m + " is not a model under test; the prereg names " + known.join(", "), "run only those models, by those strings");
    const provider = providerOf(policy as LoadedPolicy, m);
    if (!provider || !HOST_PROVIDERS.claude.includes(provider)) refuse("--models: " + m + " has no Claude Code route in the policy", "pass a policy that routes it through anthropic or openrouter");
  }
  if (new Set(models).size !== models.length) refuse("--models names a model twice", "name each model once");
  const arms: ArmId[] = flags.get("--arms")!.map((s) => {
    const at = s.indexOf("=");
    const name = at > 0 ? s.slice(0, at) : s;
    if (!isDxArm(name)) return refuse("--arms " + JSON.stringify(s) + ": the devex lens runs none, lens, plan-devex-review and autoplan", "run only those arms, by those names");
    if (!DX_ARMS[name].gstack) {
      if (at > 0) refuse("--arms " + name + " runs no gstack, so it takes no stack", "pass " + name + " alone");
      return name;
    }
    const stack = at > 0 ? parseStackRef(s.slice(at + 1)) : "no stack given";
    if (typeof stack === "string") return refuse("--arms " + name + ": " + stack, "pass " + name + "=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha);
    if (stack.repo !== DX_GSTACK.repo || stack.sha !== DX_GSTACK.sha || stack.path) refuse("--arms " + name + " runs " + stack.repo + "@" + stack.sha + ", and the prereg pins " + DX_GSTACK.repo + "@" + DX_GSTACK.sha + " (VERSION " + DX_GSTACK.version + ") whole", "pass " + name + "=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha);
    return name;
  });
  if (new Set(arms).size !== arms.length) refuse("--arms names an arm twice", "name each arm once");
  const repairs = new Map<ArmId | "all", Repair>();
  for (const r of flags.get("--repair") ?? []) {
    if (r === "double-limits") {
      repairs.set("all", "double limits");
      continue;
    }
    const [arm, kind] = r.split("=");
    const repair = kind ? REPAIRS[kind] : undefined;
    if (!(arm === "plan-devex-review" && repair === "stop hook") && !(arm === "autoplan" && repair === "gstack stop gate")) refuse("--repair " + JSON.stringify(r) + ": smoke rule 5 gives plan-devex-review the Stop hook and autoplan gstack's stop gate, one each", "pass plan-devex-review=stop-hook, autoplan=gstack-stop-gate or double-limits");
    repairs.set(arm as ArmId, repair!);
  }
  const passes = Number(one("--passes") ?? "1");
  if (!Number.isSafeInteger(passes) || passes < 1 || passes > 3) refuse("--passes must be a whole number from 1 to 3", "pass --passes 1 to 3");
  const out = resolve(one("--out")!);
  if (insideRepo(out)) refuse("a devex run holds review text, and --out " + out + " is inside the repo", "pass an --out outside the repo");
  if (!flags.has("--dry-run")) {
    const pin = dxPinProblem(env.GSTACK_EVALS_DX_PIN, env.PATH);
    if (pin) refuse("a paid run records each session's kind from the pinned checkout's own bin/gstack-session-kind: " + pin, "set GSTACK_EVALS_DX_PIN to a checkout of " + DX_GSTACK.repo + " at " + DX_GSTACK.sha + ", or run --dry-run");
    return await dxPaid({ flags, unitsDir, unitIds, all: refs.length === 1 && refs[0] === "all", arms, models, passes, repairs, out, policy: policy as LoadedPolicy, env, io });
  }
  for (const f of ["--run", "--parallel", "--ledger", "--record", "--control"]) if (flags.has(f)) refuse(f + " is a paid run's flag, and --dry-run spends nothing", "leave out " + f + " with --dry-run");
  const limits = dxLimits(repairs.has("all"));
  const digest = dxUnitsDigest(unitsDir, unitIds);
  io.out("review-units dry run: nothing is built under --out, written or spent");
  io.out("plan lens " + DX_LENS + "; template sha256 " + DX_TEMPLATE_SHA256 + "; common line sha256 " + DX_COMMON_SHA256 + "; parser sha256 " + DX_PARSER_SHA256 + "; rec user sha256 " + DX_REC_USER_SHA256);
  io.out("units dir " + unitsDir + " (" + unitIds.length + " units, " + digest.files + " files, sha256 " + digest.sha256 + ")");
  const scratch = mkdtempSync(join(tmpdir(), "dx-mounts-"));
  const bad: string[] = [];
  try {
    for (const id of unitIds) {
      const seen: string[] = [];
      for (const shape of ["plain", "autoplan"] as const) {
        if (shape === "autoplan" && !arms.includes("autoplan")) continue;
        const tree = buildDxTree(unitsDir, id, shape === "autoplan" ? "autoplan" : "none", join(scratch, shape, dxTaskId(id)));
        bad.push(...tree.problems);
        seen.push((shape === "autoplan" ? "autoplan sees the wrapped plan.md" : "every other arm sees plan.md") + " and repo/ (" + tree.files.filter((f) => f.startsWith("repo/")).length + " files)" + (tree.problems.length ? " BAD" : ""));
      }
      io.out("  " + id + "  task " + dxTaskId(id) + "  " + seen.join("; "));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (bad.length) {
    io.err("E_USAGE review-units: a unit tree is not a devex mount:\n  " + bad.join("\n  ") + "\n  fix: repair the unit folders; key.json and alias.json are never mounted");
    return 2;
  }
  io.out("mounts: ok; every session sees " + DX_MOUNTS.repo + " and " + DX_MOUNTS.plan + " only; key.json, alias.json and unit.json are never mounted");
  for (const a of arms) {
    const spec = DX_ARMS[a];
    const repair = repairs.get(a) ?? repairs.get("all") ?? "none";
    io.out("arm " + a + " (" + (spec.gstack ? DX_GSTACK.repo + "@" + DX_GSTACK.sha + ", GSTACK_SESSION_KIND=" + spec.session_kind + ", plan-tune state empty" : "no gstack install, no skills folder, no drive mount") + "; repair " + (REPAIR_NAME[repair] ?? repair) + (repair === "stop hook" ? ", at most " + STOP_HOOK_MAX + " blocks" : repair === "gstack stop gate" ? ", " + DX_AUTOPLAN_GATE.settings : "") + "): prompt sha256 " + sha256(dxPrompt(a)) + ", env " + Object.entries(dxArmEnv(a)).map(([k, v]) => k + "=" + v).join(" "));
  }
  io.out("models: " + models.map((m) => m + " (" + providerOf(policy as LoadedPolicy, m) + ")").join(", ") + "; passes " + passes + "; sessions " + unitIds.length * passes * arms.length * models.length);
  io.out("every arm: system prompt " + DX_SYSTEM_PROMPT + "; $" + limits.usd + ", " + limits.turns + " turns, " + limits.minutes + " minutes a session; WebSearch and WebFetch denied; the reviewer subagent on the cell's model; the rec persona answers every question, and a session with no block and no limit stop gets " + JSON.stringify(DX_FINISH) + " once");
  io.out("out " + out);
  return 0;
}

/** The paid stage 1 run: the frozen run's plan, its one lease, the Docker rig on that lease and the session loop. */
async function dxPaid(p: { flags: Map<string, string[]>; unitsDir: string; unitIds: string[]; all: boolean; arms: ArmId[]; models: string[]; passes: number; repairs: Map<ArmId | "all", Repair>; out: string; policy: LoadedPolicy; env: Env; io: Io }): Promise<number> {
  const one = (f: string) => p.flags.get(f)?.[0] ?? null;
  const run = one("--run");
  if (run === null) refuse("a paid run names its frozen run, and the devex session loop is not built for a run that names none; it runs the stage 1 runs " + STAGE1_RUNS.join(", "), "pass --run s1-none, s1-smoke or s1-resmoke, or run --dry-run");
  const frozen = frozenRuns().find((r) => r.id === run);
  if (frozen?.item === "dx-s2-runs") refuse("--run " + run + " is a stage 2 run, and the devex session loop is not built for stage 2 at this commit: stage 2 needs stage 1's readings, the DX scope rate and the interim exposure check wired to its model-pass leases", "run a stage 1 run (s1-none, s1-smoke or s1-resmoke)");
  if (!frozen || !isStage1Run(run!)) return refuse("--run " + run + " names no stage 1 frozen run", "pass --run s1-none, s1-smoke or s1-resmoke");
  const parallel = Number(one("--parallel") ?? "1");
  if (!Number.isSafeInteger(parallel) || parallel < 1 || parallel > MAX_PARALLEL) refuse("--parallel must be a whole number from 1 to " + MAX_PARALLEL + ", the most sessions the lease's in-flight reserve holds", "pass --parallel 1 to " + MAX_PARALLEL);
  const known = Object.values(MODEL_STRINGS);
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (!same(p.models, known)) refuse(run + " runs on every model under test, and --models names " + p.models.join(", "), "pass --models " + known.join(" "));
  const doubled = p.repairs.has("all");
  const armRepairs = new Map([...p.repairs].filter((e): e is [ArmId, Repair] => e[0] !== "all"));
  if (run === "s1-none") {
    if (!same(p.arms, ["none"])) refuse("s1-none runs arms none only, and --arms names " + p.arms.join(", "), "pass --arms none");
    if (p.passes !== NONE_PASSES) refuse("s1-none runs " + NONE_PASSES + " passes, and --passes is " + p.passes, "pass --passes " + NONE_PASSES);
  } else {
    if (p.all) refuse(run + " takes the calibration units in draw order, and --units all lists the folders sorted", "name the calibration units with --units in draw order");
    if (p.passes !== 1) refuse(run + " is its own smoke pass, and --passes is " + p.passes, "leave out --passes");
  }
  if (run === "s1-smoke" && !same(p.arms, ["lens", "plan-devex-review", "autoplan"])) refuse("s1-smoke runs arms lens, plan-devex-review and autoplan, and --arms names " + p.arms.join(", "), "pass --arms lens plan-devex-review=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha + " autoplan=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha);
  if (run !== "s1-resmoke" && p.repairs.size) refuse(run + " takes no --repair: smoke rule 5's one repair follows the smoke and reruns as s1-resmoke", "leave out --repair, or run --run s1-resmoke");
  if (run === "s1-resmoke") for (const a of p.arms) if (!armRepairs.has(a) && !doubled) refuse("s1-resmoke reruns a repaired arm, and arm " + a + " needs its repair", "pass --repair " + (a === "autoplan" ? "autoplan=gstack-stop-gate" : a === "plan-devex-review" ? "plan-devex-review=stop-hook" : "double-limits") + ", or leave the arm out");
  const plan = dxPlan(run!, p.unitIds, p.arms);
  if ("problem" in plan) return refuse(plan.problem, "name the units the frozen run needs, in draw order");
  if (existsSync(p.out)) refuse(p.out + " exists, and every launch uses an out dir that does not exist before it (start rule 7)", "pass a new --out");
  const volatile = volatilePathProblem(p.out);
  if (volatile) throw new Error("E_RECEIPTS_VOLATILE " + volatile);
  const pin = p.env.GSTACK_EVALS_DX_PIN!;
  for (const a of p.arms.filter((x) => DX_ARMS[x].gstack)) {
    const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: p.out, LANG: "C.UTF-8", TERM: "dumb", ...hostDriver({ host: "claude", model: MODEL_STRINGS.opus, provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:1", slot: "session-kind-check", token: "" }, interactive: true, skill: null, out: p.out, sessionKind: DX_ARMS[a].session_kind!, disable1mContext: true }).env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" };
    const kind = dxSessionKind(pin, a, env);
    const problem = kind.problem ?? dxSessionKindProblem(a, kind);
    if (problem) throw new Error("E_SESSION_KIND_PIN: arm " + a + ": " + problem + "\n  fix: run with GSTACK_EVALS_DX_PIN naming the pinned checkout " + DX_GSTACK.sha);
  }
  mkdirSync(p.out, { recursive: true });
  const trees: Record<string, DxTree> = {};
  const bad: string[] = [];
  for (const id of [...new Set(plan.sessions.map((s) => s.unit))]) {
    const task = dxTaskId(id);
    const plain = buildDxTree(p.unitsDir, id, "none", join(p.out, "units", task, "plain"));
    const wrapped = plan.sessions.some((s) => s.unit === id && s.arm === "autoplan") ? buildDxTree(p.unitsDir, id, "autoplan", join(p.out, "units", task, "autoplan")) : null;
    bad.push(...plain.problems, ...(wrapped?.problems ?? []));
    trees[id] = { task, plain: join(p.out, "units", task, "plain"), autoplan: wrapped ? join(p.out, "units", task, "autoplan") : null };
  }
  if (bad.length) refuse("a unit tree is not a devex mount:\n  " + bad.join("\n  "), "repair the unit folders; key.json and alias.json are never mounted");
  const tasks = join(p.out, "fixtures", "tasks.json");
  mkdirSync(dirname(tasks), { recursive: true });
  writeFileSync(tasks, "[]\n");
  const ledger = ledgerPath(one("--ledger") ?? undefined, p.env);
  const record = recordPath(one("--record") ?? undefined, p.env);
  const local = openLocalLedger(ledger);
  const open = stage1Open(run!, p.arms, readItem(record.path, frozen.item).leases.length);
  if ("problem" in open) return refuse(open.problem, open.fix);
  const leased = frozenRuns(open.design).find((r) => r.id === run)!;
  const opened = openRun(record.path, local, { run: run!, design: open.design, opened: open.opened, mdd: () => Number.POSITIVE_INFINITY, requireAdmission: rigAdmission({ proof: "trial" }) });
  if (!opened.admission.ok || !opened.lease_id) {
    p.io.err("CAP_STOP review-units: run " + run + " on " + frozen.item + " is not admitted: " + (opened.admission.ok ? "no lease opened" : opened.admission.stop) + "\n  fix: the run stops for the Captain; nothing was spent");
    return 2;
  }
  const lease = opened.lease_id;
  const leaseMicros = opened.admission.lease_micros;
  p.io.out("lease " + lease + " opened on " + frozen.item + " for " + run + ": " + usd(leaseMicros) + " (projection " + usd(leased.projection_micros) + " plus a tenth plus the in-flight reserve)");
  const specs: ArmSpec[] = p.arms.map((a) => {
    if (!DX_ARMS[a].gstack) return { name: a, kind: "bare" };
    const stack = parseStackRef(DX_GSTACK.repo + "@" + DX_GSTACK.sha) as Exclude<ReturnType<typeof parseStackRef>, string>;
    return { name: a, kind: "stack", stack, install: { ...stackKind(stack)?.install } };
  });
  const skills = Object.fromEntries(p.arms.flatMap((a) => (DX_ARMS[a].skill ? [[a, DX_ARMS[a].skill!]] : [])));
  writeFileSync(join(p.out, "run.json"), JSON.stringify({ run_id: frozen.run_id, frozen_run: run, item: frozen.item, lease_id: lease, lease_micros: leaseMicros, sessions: plan.sessions.length, arms: p.arms, models: p.models, passes: p.passes, parallel, limits: dxLimits(doubled), repairs: Object.fromEntries([...p.repairs].map(([k, v]) => [k, { repair: v, name: REPAIR_NAME[v] }])), prompts: Object.fromEntries(p.arms.map((a) => [a, { sha256: DX_PROMPT_SHA256[a], env: dxArmEnv(a) }])), template_sha256: DX_TEMPLATE_SHA256, parser_sha256: DX_PARSER_SHA256, rec_user_sha256: DX_REC_USER_SHA256, gstack: DX_GSTACK, units: dxUnitsDigest(p.unitsDir, p.unitIds), sink: { out: p.out, existed: false, checked_at: new Date().toISOString() } }, null, 2) + "\n");
  let live: DxRunResult | null = null;
  let settled: ReturnType<DxRunResult["settle"]> | null = null;
  let rig: HostRig;
  const call = { host: "claude" as const, arms: { arms: specs, base: null, skill: null, notes: [] } as ResolvedArms, tasks, out: { path: p.out, rule: "--out" }, ledger, record, item: frozen.item, runId: frozen.run_id, models: p.models, policy: p.policy };
  try {
    rig = dockerRig(call, { env: p.env, skill: null, skills, nonce: randomBytes(6).toString("hex"), cap: leaseMicros, voice: false, lease: { id: lease, local, settle: () => (settled = live ? live.settle() : { close: settleLease(record.path, local, lease), released: [], paused: [] }).close } });
  } catch (e) {
    settleLease(record.path, local, lease);
    throw e;
  }
  try {
    live = await runDxSessions({ run: run!, runId: frozen.run_id, sessions: plan.sessions, trees, rig, ledger: local, record: record.path, lease, policy: p.policy, out: p.out, parallel, doubled, repairs: armRepairs, pin, control: one("--control") ? resolve(one("--control")!) : join(p.out, "control.ndjson"), log: (l) => p.io.err(l) });
  } finally {
    const closed = await rig.close();
    const s = settled as ReturnType<DxRunResult["settle"]> | null;
    if (s?.paused.length) p.io.out("lease " + lease + " left open for the Captain: " + s.paused.join("; "));
    else p.io.out("lease " + lease + " settled: " + usd(closed.committed) + " committed, " + closed.unknown + " unknown calls" + (s ? ", " + s.released.length + " unrun sessions released" : ""));
  }
  if (live!.error) throw live!.error;
  const rows = live!.rows;
  const ends = rows.reduce<Record<string, number>>((m, r) => ((m[r.end] = (m[r.end] ?? 0) + 1), m), {});
  p.io.out("rows " + rows.length + " of " + plan.sessions.length + " planned in " + join(p.out, "rows.ndjson") + ": " + Object.entries(ends).map(([k, v]) => k + " " + v).join(", "));
  return (settled as ReturnType<DxRunResult["settle"]> | null)?.paused.length || live!.batch.haltedBy() ? 2 : 0;
}
