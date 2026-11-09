// Copyright (c) 2026 Garry Tan. MIT License.
// review-units --plan eng-review: the command half of the eng-review lens (prereg 2026-11-08-geva-405). It reads a
// units directory (lanes/eng-review/types.ts's layout), resolves the three gstack pins from a fresh clone and checks
// each VERSION and the candidate's two digests, renders each unit's eng phase opening (lanes/eng-review/render.ts),
// builds the unit trees, checks the receipts sink is new, builds the Docker rig and runs er-run.ts's loop.
//
// - Frozen and refused if given: the system prompt, turn cap, timeout, allowance, session kind and web tools. The only
//   choices are units, arms, models, passes, --parallel, --enforce and where the run writes.
// - The clone: --gstack <dir> names one; otherwise the command clones https://github.com/garrytan/gstack into a new temp
//   dir. A clone missing a pin, a wrong VERSION or a wrong candidate digest refuses the run, and the installed trees are
//   checked again after the rig builds them.
// - The cap: --spend-cap is the lease this launch opens on --item. It is refused when it is larger than the item's
//   recorded cap less its committed spend, before anything is built (openLease refuses it too).
// - --dry-run builds every unit tree and opening in a scratch dir, asserts the mounts, prints each prompt's sha256, the
//   settings, the routes and the admission rule, and writes nothing under --out.
// - A run copies run.json, units.json, sessions.ndjson, stops.json and each attempt's trial.json, transcript, session
//   clock, opening record, gstack state root and plan-coverage folder to the receipts sink.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderEngPhase } from "../../../lanes/eng-review/render.ts";
import { ER_PARSER_SHA256 } from "../../../lanes/eng-review/parse.ts";
import { ARMS, type ArmId } from "../../../lanes/eng-review/types.ts";
import { insideRepo } from "../../../lanes/review-noloss/suite.ts";
import { chatPrice, openRouterRouting } from "../../runner/pricing/prices.ts";
import { readItem } from "../../runner/ledger/record.ts";
import { ledgerPath, recordPath } from "../../runner/ledger/paths.ts";
import { recipeHash, recipeInputs } from "../../rig/recipe.ts";
import { parseStackRef, type ResolvedArms } from "../../skill-eval/cli/arms.ts";
import { HOST_PROVIDERS, newRunId } from "../../skill-eval/cli/call.ts";
import { DEFAULT_POLICY, loadPolicy, providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { adapterSha256, dockerRig } from "../../skill-eval/cli/run-host.ts";
import type { ArmSpec } from "../../types.ts";
import { copyToSink, receiptsSink, volatilePathProblem } from "../durable.ts";
import { checkImagePin, stateRoot } from "../image.ts";
import { buildErTree, clonePinProblems, ER_ADMISSION_RULE, ER_ALLOWANCE_MICROS, ER_GSTACK_URL, ER_LENS, ER_MAX_TURNS, ER_MODELS, ER_PINS, ER_REC_USER_SHA256, ER_REPO, ER_SEED, ER_SKILL, ER_SYSTEM_PROMPT, ER_TEMPLATE_SHA256, ER_TIMEOUT_S, erCellId, erOrder, erPrompt, erTaskId, erUnitProblems, erUnitsDigest, installPinProblems, isSkillArm, safeGit, type ErSkillArm } from "./eng-review.ts";
import { erJournal, erStopsFile, runErUnits, type ErUnit } from "./er-run.ts";
import { gstackDir } from "./plan.ts";
import { sessionDir } from "./run.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const ER_HELP = [
  "gstack-evals review-units --plan eng-review --units-dir <dir> --units <id>...|all --arms <arm>... --models <id>... --out <dir>",
  "    [--passes <n>] [--parallel <n>] [--enforce precut|engphase|candidate] [--gstack <clone>] [--item <ledger item> --spend-cap <usd>]",
  "    [--ledger <path>] [--record <dir>] [--policy <file>] [--resume] [--dry-run]",
  "",
  "Arms: none, lens, precut (plan-eng-review at " + ER_PINS.precut.sha.slice(0, 9) + "), engphase (autoplan's Phase 3 at " + ER_PINS.engphase.sha.slice(0, 9) + "),",
  "candidate (/plan-coverage at " + ER_PINS.candidate.sha.slice(0, 9) + "). Models: " + Object.keys(ER_MODELS).join(", ") + ".",
  "Frozen for every arm and model: the " + ER_SYSTEM_PROMPT + " system prompt, " + ER_MAX_TURNS + " turns, " + ER_TIMEOUT_S / 60 + " minutes, a $" + ER_ALLOWANCE_MICROS / 1e6 + " allowance per attempt,",
  "a 200,000-token window, bundled skills off, WebSearch and WebFetch denied, GSTACK_SESSION_KIND=unattended on skill arms,",
  "one retry per arm stop or infrastructure failure. Admission: " + ER_ADMISSION_RULE + ".",
  "--enforce <arm> turns on smoke rule 2's Stop hook for that arm. A run needs GSTACK_EVALS_EPHEMERAL=1 and a",
  "GSTACK_EVALS_RECEIPTS sink that does not exist yet.",
].join("\n");

const VALUE = new Set(["--plan", "--units-dir", "--passes", "--out", "--ledger", "--record", "--item", "--spend-cap", "--parallel", "--policy", "--gstack", "--enforce"]);
const LIST = new Set(["--units", "--arms", "--models"]);
const BOOL = new Set(["--resume", "--dry-run"]);
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
    } else refuse("unknown argument " + JSON.stringify(a) + " for --plan eng-review, which freezes the system prompt, turn cap, timeout, allowance, session kind and web tools", "leave it out; see gstack-evals review-units --plan eng-review --help");
  }
  return flags;
}

const usd = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);

export async function erMain(argv: string[], io: Io, env: Env): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(ER_HELP);
    return 0;
  }
  try {
    return await erUnits(argv, io, env);
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

/** A clone of garrytan/gstack: the one given, or a fresh one in a new temp dir. */
function gstackClone(given: string | null): { dir: string; fresh: boolean } {
  if (given) return { dir: resolve(given), fresh: false };
  const dir = mkdtempSync(join(tmpdir(), "er-gstack-"));
  const r = safeGit(tmpdir(), ["clone", "--quiet", "--no-checkout", ER_GSTACK_URL, dir]);
  if (r.status !== 0) refuse("could not clone " + ER_GSTACK_URL + ": " + r.stderr.trim(), "check the network, or pass --gstack <a fresh clone>");
  return { dir, fresh: true };
}

/** Renders one unit's eng phase opening from a worktree at the pin. */
function opening(clone: string, unitsDir: string, id: string, out: string): NonNullable<ErUnit["opening"]> {
  const wt = join(out, "gstack");
  if (!existsSync(wt)) {
    const r = safeGit(clone, ["worktree", "add", "--quiet", "--detach", wt, ER_PINS.engphase.sha]);
    if (r.status !== 0) refuse("could not check out " + ER_PINS.engphase.sha + ": " + r.stderr.trim(), "pass a full clone of " + ER_REPO);
  }
  const o = renderEngPhase({ gstack: wt, plan: readFileSync(join(unitsDir, id, "plan.md"), "utf8"), out: join(out, id) });
  return { text: o.text, sha256: o.sha256, mounts: o.files.map((f) => ({ host: f.host, path: f.mount })), methodology: o.methodology, readRanges: o.readRanges };
}

async function erUnits(argv: string[], io: Io, env: Env): Promise<number> {
  const flags = parseArgs(argv);
  const one = (f: string) => flags.get(f)?.[0] ?? null;
  for (const f of ["--units-dir", "--units", "--arms", "--models", "--out"]) if (!flags.has(f)) refuse("--plan eng-review needs " + f, "pass " + f + "; see --help");
  const dry = flags.has("--dry-run");
  const resume = flags.has("--resume");
  const unitsDir = resolve(one("--units-dir")!);
  if (!existsSync(unitsDir)) refuse("--units-dir " + unitsDir + " does not exist", "pass the units directory");
  if (insideRepo(unitsDir)) refuse("--units-dir " + unitsDir + " is inside the repo, and units and keys stay sealed outside it", "decrypt the units under the custody rules outside this checkout and pass that dir");
  const refs = flags.get("--units")!;
  const unitIds = refs.length === 1 && refs[0] === "all" ? readdirSync(unitsDir).filter((n) => existsSync(join(unitsDir, n, "unit.json"))).sort() : refs;
  if (!unitIds.length) refuse("--units all finds no unit folder with a unit.json under " + unitsDir, "pass the units directory");
  if (new Set(unitIds).size !== unitIds.length) refuse("--units names a unit twice", "name each unit once");
  const problems = unitIds.flatMap((id) => erUnitProblems(unitsDir, id));
  if (problems.length) refuse("units that cannot run:\n  " + problems.join("\n  "), "repair the unit folders, or leave those units out");
  const arms = flags.get("--arms")! as ArmId[];
  for (const a of arms) if (!ARMS.includes(a)) refuse("--arms " + JSON.stringify(a) + ": the eng-review arms are " + ARMS.join(", "), "run only those arms, by those names");
  if (new Set(arms).size !== arms.length) refuse("--arms names an arm twice", "name each arm once");
  const enforce = one("--enforce") as ErSkillArm | null;
  if (enforce !== null && (!isSkillArm(enforce) || !arms.includes(enforce))) refuse("--enforce " + JSON.stringify(enforce) + " names no skill arm of this run", "pass --enforce precut, engphase or candidate with that arm in --arms");
  const policyFile = one("--policy") ?? DEFAULT_POLICY;
  const policy = loadPolicy(policyFile);
  if ("problem" in policy) refuse("--policy " + policyFile + ": " + policy.problem, "pass a readable policy file");
  const models = flags.get("--models")!;
  for (const m of models) {
    if (!Object.hasOwn(ER_MODELS, m)) refuse("--models: " + m + " is not a model under test; the prereg names " + Object.keys(ER_MODELS).join(", "), "run only those models, by those policy keys");
    const provider = providerOf(policy as LoadedPolicy, m);
    if (!provider || !HOST_PROVIDERS.claude.includes(provider)) refuse("--models: " + m + " has no Claude Code route in the policy", "pass a policy that routes it through anthropic or openrouter");
  }
  if (new Set(models).size !== models.length) refuse("--models names a model twice", "name each model once");
  const parallel = Number(one("--parallel") ?? "1");
  if (!Number.isSafeInteger(parallel) || parallel < 1 || parallel > 16) refuse("--parallel must be a whole number from 1 to 16", "pass --parallel 1 to 16");
  const passes = Number(one("--passes") ?? "1");
  if (!Number.isSafeInteger(passes) || passes < 1 || passes > 20) refuse("--passes must be a whole number from 1 to 20", "pass --passes 1 to 20");
  const capFlag = one("--spend-cap");
  const cap = capFlag === null ? null : Math.round(Number(capFlag) * 1_000_000);
  if (cap !== null && !(cap > 0)) refuse("--spend-cap must be a positive number of dollars", "pass the item's cap");
  const out = resolve(one("--out")!);
  if (insideRepo(out)) refuse("an eng-review run holds review text, and --out " + out + " is inside the repo", "pass an --out outside the repo");
  const routes = models.map((m) => {
    const provider = providerOf(policy as LoadedPolicy, m)!;
    const price = provider === "openrouter" ? chatPrice("openrouter:" + m) : undefined;
    if (provider === "openrouter" && !price?.providers?.length) refuse("--models: " + m + " routes through OpenRouter with no pinned provider in the price table", "pin its serving provider in src/runner/pricing/prices.ts");
    return { model: m, provider, routing: price ? openRouterRouting(price) : null };
  });
  const clone = gstackClone(one("--gstack"));
  const pins = clonePinProblems(clone.dir);
  if (pins.length) refuse("the gstack clone " + clone.dir + " does not hold the frozen pins:\n  " + pins.join("\n  "), "pass a fresh clone of " + ER_GSTACK_URL);
  const digest = erUnitsDigest(unitsDir, unitIds);
  const order = erOrder(unitIds, arms, models, passes);
  const settings = { arms, models, passes, enforce, max_turns: ER_MAX_TURNS, timeout_s: ER_TIMEOUT_S, allowance_usd: ER_ALLOWANCE_MICROS / 1e6, system_prompt: ER_SYSTEM_PROMPT, seed: ER_SEED, units_sha256: digest };

  if (dry) {
    const scratch = mkdtempSync(join(tmpdir(), "er-mounts-"));
    try {
      io.out("review-units dry run: nothing is built under --out, written or spent");
      io.out("plan lens " + ER_LENS + "; template sha256 " + ER_TEMPLATE_SHA256 + "; parser sha256 " + ER_PARSER_SHA256 + "; rec user sha256 " + ER_REC_USER_SHA256);
      io.out("gstack clone " + clone.dir + (clone.fresh ? " (fresh)" : "") + ": " + Object.entries(ER_PINS).map(([a, p]) => a + " " + p.sha + " VERSION " + p.version).join("; ") + "; candidate digests ok");
      io.out("units dir " + unitsDir + " (" + unitIds.length + " units, sha256 " + digest + ")");
      const bad: string[] = [];
      for (const id of unitIds) {
        const tree = buildErTree(unitsDir, id, join(scratch, "trees", erTaskId(id)));
        bad.push(...tree.problems);
        const o = arms.includes("engphase") ? opening(clone.dir, unitsDir, id, join(scratch, "openings")) : null;
        io.out("  " + id + "  task " + erTaskId(id) + "  sees /work/plan.md and /work/repo (one commit)" + (tree.problems.length ? " BAD" : "") + (o ? "; eng phase opening sha256 " + o.sha256 + ", prompt sha256 " + sha(erPrompt("engphase", o.text)) + ", read-only " + o.mounts.map((m) => m.path).join(", ") : ""));
      }
      if (bad.length) refuse("a unit tree is not an eng-review mount:\n  " + bad.join("\n  "), "repair the unit folders; key.json and unit.json are never mounted");
      io.out("mounts: ok; every session sees /work/plan.md and /work/repo only, skill arms add /work/.gstack-home, the eng phase arm adds its rendered inputs read-only; key.json is never mounted and repo/ holds one commit");
      for (const a of arms) io.out("arm " + a + " (" + (isSkillArm(a) ? ER_REPO + "@" + ER_PINS[a].sha + ", default install, unattended" + (enforce === a ? ", Stop hook on" : "") : "no gstack install, no skills folder, no drive mount, no state root") + ")" + (a === "engphase" ? ": prompt per unit, above" : ": prompt sha256 " + sha(erPrompt(a))));
      for (const r of routes) io.out("model " + r.model + " via " + r.provider + (r.routing ? " " + JSON.stringify(r.routing) : ""));
      io.out("every arm: system prompt " + ER_SYSTEM_PROMPT + "; max turns " + ER_MAX_TURNS + "; timeout " + ER_TIMEOUT_S + " s; allowance " + usd(ER_ALLOWANCE_MICROS) + " per attempt; CLAUDE_CODE_DISABLE_1M_CONTEXT=1; CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1; WebSearch and WebFetch denied; network only through the metering proxy");
      io.out("order: seed " + ER_SEED + ", " + order.length + " sessions, each unit's cells interleaved; parallel " + parallel);
      io.out("admission: " + ER_ADMISSION_RULE + "; spend cap " + (cap === null ? "none" : usd(cap)));
      io.out("out " + out + (resume ? " (resume)" : ""));
      return 0;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      if (clone.fresh) rmSync(clone.dir, { recursive: true, force: true });
    }
  }
  const item = one("--item");
  if (item === null || cap === null) refuse("a run needs a ledger line item (--item) and --spend-cap", "pass the item and the cap the Captain recorded");
  const record = recordPath(one("--record") ?? undefined, env);
  const state = readItem(record.path, item!);
  if (state.cap_micros === null) refuse("line item " + item + " has no recorded cap", "record the item's cap first");
  const left = state.cap_micros! - state.committed_micros;
  if (cap! > left) refuse("--spend-cap " + usd(cap!) + " is larger than item " + item + "'s remaining recorded cap (" + usd(left) + " of " + usd(state.cap_micros!) + ")", "pass --spend-cap " + (left / 1e6).toFixed(2) + " or less");
  const sink = receiptsSink(env);
  if ("problem" in sink) refuse(sink.problem, "set GSTACK_EVALS_RECEIPTS to a new directory outside the repo");
  if (!("sink" in sink) || !sink.sink) return refuse("every eng-review launch uses a receipts sink that does not exist before it (section 16, rule 7), and GSTACK_EVALS_EPHEMERAL=1 is not set", "set GSTACK_EVALS_EPHEMERAL=1 and GSTACK_EVALS_RECEIPTS to a path that does not exist yet");
  if (existsSync(sink.sink)) refuse("the receipts sink " + sink.sink + " already exists, and every launch, a resume included, uses a sink that does not exist before it", "set GSTACK_EVALS_RECEIPTS to a new path for this launch");
  if (insideRepo(sink.sink)) refuse("the receipts sink " + sink.sink + " is inside the repo", "set GSTACK_EVALS_RECEIPTS outside the repo");
  const volatile = volatilePathProblem(out);
  if (volatile) throw new Error("E_RECEIPTS_VOLATILE " + volatile);
  const runFile = join(out, "run.json");
  const prior = resume && existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string; er: typeof settings; launches: unknown[] }) : null;
  if (existsSync(out) && !prior) refuse(out + " exists", "pass --resume to continue that run, or a new --out");
  if (prior && JSON.stringify(prior.er) !== JSON.stringify(settings)) refuse("run " + prior.run_id + " ran with " + JSON.stringify(prior.er) + ", and this resume gives " + JSON.stringify(settings), "resume with the run's own settings, or start a new run in a new --out");
  const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const pin = checkImagePin({ state: stateRoot(env), docker });
  if (!pin.ok) throw new Error(pin.code + " " + pin.message);
  const units: ErUnit[] = [];
  const bad: string[] = [];
  for (const id of unitIds) {
    const task = erTaskId(id);
    const tree = buildErTree(unitsDir, id, join(out, "units", task, "tree"));
    bad.push(...tree.problems);
    units.push({ id, task, tree: join(out, "units", task, "tree"), tree_sha256: tree.tree_sha256, opening: arms.includes("engphase") ? opening(clone.dir, unitsDir, id, join(out, "openings")) : null });
  }
  if (bad.length) refuse("a unit tree is not an eng-review mount:\n  " + bad.join("\n  "), "repair the unit folders; key.json and unit.json are never mounted");
  const runId = prior?.run_id ?? newRunId("review-units");
  const launch = { sink: sink.sink, existed: false, checked_at: new Date().toISOString(), resume, cap_usd: cap! / 1e6, item };
  writeFileSync(runFile, JSON.stringify({ run_id: runId, er: settings, launches: [...(prior?.launches ?? []), launch] }, null, 2) + "\n");
  writeFileSync(join(out, "units.json"), JSON.stringify({ schema_version: 1, lens: ER_LENS, units_dir: unitsDir, units_sha256: digest, template_sha256: ER_TEMPLATE_SHA256, parser_sha256: ER_PARSER_SHA256, rec_user_sha256: ER_REC_USER_SHA256, pins: ER_PINS, er: settings, admission: ER_ADMISSION_RULE, units: units.map((u) => ({ id: u.id, task: u.task, tree_sha256: u.tree_sha256, opening_sha256: u.opening?.sha256 ?? null })), prompts: Object.fromEntries(arms.filter((a) => a !== "engphase").map((a) => [a, sha(erPrompt(a))])), order: order.map(erCellId) }, null, 2) + "\n");
  const tasks = join(out, "fixtures", "tasks.json");
  mkdirSync(join(out, "fixtures"), { recursive: true });
  writeFileSync(tasks, "[]\n");
  const specs: ArmSpec[] = arms.map((a) => {
    if (!isSkillArm(a)) return { name: a, kind: "bare" };
    const stack = parseStackRef(ER_REPO + "@" + ER_PINS[a].sha);
    if (typeof stack === "string") return refuse("arm " + a + ": " + stack, "report this");
    return { name: a, kind: "stack", stack, install: {} };
  });
  const resolved: ResolvedArms = { arms: specs, base: null, skill: null, notes: [] };
  const call = { host: "claude" as const, arms: resolved, tasks, out: { path: out, rule: "--out" }, ledger: ledgerPath(one("--ledger") ?? undefined, env), record, item: item!, runId, models, policy: policy as LoadedPolicy };
  const skills = Object.fromEntries(arms.flatMap((a) => (ER_SKILL[a] ? [[a, ER_SKILL[a]!]] : [])));
  const rig = dockerRig(call, { env, skill: null, skills, nonce: randomBytes(6).toString("hex"), cap: cap!, voice: false });
  let code = 0;
  try {
    const installs = arms.filter(isSkillArm).flatMap((a) => installPinProblems(a, gstackDir(rig.arms[a]!), rig.arms[a]!.layers?.find((l) => l.dest === "")?.src ?? null));
    if (installs.length) throw new Error("E_USAGE: the installed arms do not match the frozen pins:\n  " + installs.join("\n  ") + "\n  fix: rebuild the arms from the pinned commits");
    const run = await runErUnits({ units, arms, models, passes, parallel, cap: cap!, out, runId, policy: policy as LoadedPolicy, enforce, keyBase: { image_digest: rig.imageDigest, recipe: recipeHash(recipeInputs()), adapter_sha256: adapterSha256("claude") } }, rig, (line) => io.err(line));
    const counts: Record<string, number> = {};
    for (const e of run.entries) counts[e.end_state + (e.arm_stop ? " (arm stop)" : "")] = (counts[e.end_state + (e.arm_stop ? " (arm stop)" : "")] ?? 0) + 1;
    io.out("sessions: " + Object.entries(counts).map(([k, v]) => k + " " + v).join(", ") + "; cap-stopped or unstarted " + run.stopped.length);
    io.out("spent " + usd(run.spent_usd * 1e6) + " this launch; carried " + usd(run.carried_usd * 1e6) + " from reused and earlier cap-stopped cells");
    code = run.stops.length ? 2 : 0;
  } finally {
    const closed = await rig.close();
    io.out("lease " + closed.lease_id + " settled: " + usd(closed.committed) + " committed, " + closed.unknown + " unknown calls");
    const attempts = order.flatMap((c) => [1, 2].map((a) => join(sessionDir(out, c.model, c.arm, erTaskId(c.unit), c.pass), "a" + a)));
    const files = [runFile, join(out, "units.json"), erJournal(out), erStopsFile(out), ...attempts.flatMap((d) => [join(d, "trial.json"), ...["transcript.ndjson", "session.json", "er-opening.json", "gstack-state", "plan-coverage"].map((f) => join(d, "host", f))])];
    copyToSink(out, files, sink.sink);
    io.out("receipts copied to " + sink.sink);
    if (clone.fresh) rmSync(clone.dir, { recursive: true, force: true });
  }
  return code;
}

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
