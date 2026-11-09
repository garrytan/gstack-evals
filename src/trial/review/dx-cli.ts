// Copyright (c) 2026 Garry Tan. MIT License.
// review-units --plan devex (prereg wiki/plans/2026-11-09-geva-417-devex-review-intentions-prereg, sections 5, 6 and
// 10; section 15 rules 4 and 7): the command half of the devex lens (devex.ts). It reads a units directory
// (lanes/devex/types.ts's layout), checks every unit folder, builds each arm's tree in a scratch dir and asserts its
// mount, and prints every frozen setting. --dry-run writes nothing under --out and spends nothing. A paid run refuses
// with E_USAGE until the review run loop can seed a session at /work (section 5 mounts /work/repo and /work/plan.md,
// and run.ts seeds each trial at /work/<task id>). Whatever it cannot do refuses with E_USAGE before anything is built
// or spent, and every refusal ends with a fix line.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DX_PARSER_SHA256 } from "../../../lanes/devex/run/parse.ts";
import { DX_FINISH, DX_REC_USER_SHA256 } from "../../../lanes/devex/run/persona.ts";
import { REPAIR_NAME, STOP_HOOK_MAX, type Repair } from "../../../lanes/devex/run/stophook.ts";
import { MODEL_STRINGS, type ArmId } from "../../../lanes/devex/types.ts";
import { insideRepo } from "../../../lanes/review-noloss/suite.ts";
import { parseStackRef } from "../../skill-eval/cli/arms.ts";
import { HOST_PROVIDERS } from "../../skill-eval/cli/call.ts";
import { DEFAULT_POLICY, loadPolicy, providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { buildDxTree, DX_ARMS, DX_AUTOPLAN_GATE, DX_COMMON_SHA256, DX_GSTACK, DX_LENS, DX_MOUNTS, DX_SYSTEM_PROMPT, DX_TEMPLATE_SHA256, dxArmEnv, dxLimits, dxPrompt, dxTaskId, dxUnitProblems, dxUnitsDigest, isDxArm } from "./devex.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const REPAIRS: Readonly<Record<string, Repair>> = { "stop-hook": "stop hook", "gstack-stop-gate": "gstack stop gate", "double-limits": "double limits" };

export const DX_HELP = [
  "gstack-evals review-units --plan devex --units-dir <dir> --units <id>...|all --arms <spec>... --models <id>... --out <dir>",
  "    [--passes <n>] [--repair <arm>=stop-hook|gstack-stop-gate | --repair double-limits]... [--policy <file>] [--dry-run]",
  "",
  "Arms: none, lens, plan-devex-review=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha + " and autoplan=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha + " (VERSION " + DX_GSTACK.version + ").",
  "Models: " + Object.values(MODEL_STRINGS).join(", ") + ".",
  "Frozen per lens: the claude-code-preset system prompt; $" + dxLimits(false).usd + ", " + dxLimits(false).turns + " turns and " + dxLimits(false).minutes + " minutes a session (doubled on every arm",
  "and model only under --repair double-limits); CLAUDE_CODE_DISABLE_1M_CONTEXT=1 and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every arm;",
  "GSTACK_SESSION_KIND=unattended for plan-devex-review and interactive for autoplan; plan-tune state pinned empty in the gstack",
  "arms; WebSearch and WebFetch denied; the reviewer subagent on the cell's model; mounts " + DX_MOUNTS.repo + " and " + DX_MOUNTS.plan + " only.",
  "--repair names smoke rule 5's one repair: plan-devex-review=stop-hook (with an enforced procedure), autoplan=gstack-stop-gate",
  "(with gstack's stop gate), or double-limits for every arm. A paid run is not built yet; --dry-run checks and prints everything.",
].join("\n");

const VALUE = new Set(["--plan", "--units-dir", "--passes", "--out", "--policy"]);
const LIST = new Set(["--units", "--arms", "--models", "--repair"]);
const BOOL = new Set(["--dry-run"]);
class Usage extends Error {}
const refuse = (why: string, fix: string): never => {
  throw new Usage(why + "\n  fix: " + fix);
};
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

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
    return dxUnits(argv, io, env);
  } catch (e) {
    if (e instanceof Usage) {
      io.err("E_USAGE review-units: " + e.message);
      return 2;
    }
    io.err("E_INTERNAL review-units: " + (e as Error).message);
    return 2;
  }
}

function dxUnits(argv: string[], io: Io, _env: Env): number {
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
  if (!flags.has("--dry-run")) refuse("the devex session loop is not built: section 5 mounts /work/repo and /work/plan.md, and the review run loop seeds each trial at /work/<task id>", "run --dry-run; a paid run waits for the run loop to seed a devex tree at /work");
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
