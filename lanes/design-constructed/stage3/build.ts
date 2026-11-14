// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's build arms and build runs (2026-11-09 section 11 "Build arms", "The sandbox (I1)" and "Failures", kept by the
// 2026-11-14 prereg section 11). Six arms per unit, 1 trial each, all by Opus 5.5 in Claude Code with no gstack, under
// $15, 250 turns and 120 minutes. Each build runs in its own VM; its tree is then checked in a second, offline VM with
// the unit's base-app recipe, where the controller's reads run. Every VM is audited, and a hit stops stage 3.
import { BUILD_PROMPT, GENERIC_LOOK_BLOCK, STAGE3 } from "../frozen.ts";
import { fail } from "../errors.ts";
import { routeUrl, setupSteps } from "../recipes/qualify.ts";
import type { Recipe } from "../recipes/recipe.ts";
import type { Arm } from "../types.ts";
import { AUDIT_DIR, sandboxed, SESSION_MARK, type ExecResult, type SandboxDeps, type SandboxTally, type Vm, type VmSpec } from "./sandbox.ts";
import type { AgentRun, BuildAgent, BuildReader, BuildReads, ReadsContext, SubRef } from "./seams.ts";

export type BuildArm = "no-review" | Arm | "generic-look";
export const REVIEW_ARMS: readonly Arm[] = ["none", "lens", "plan-design-review", "autoplan"];
/** Build order within a unit. */
export const BUILD_ARMS: readonly BuildArm[] = ["no-review", ...REVIEW_ARMS, "generic-look"];
/** The build session's environment: Claude Code's bundled skills off in every arm, and no gstack anywhere (BT, as D did). */
export const BUILD_ENV: Readonly<Record<string, string>> = { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };

/** The frozen prompt, then the block. plan.md alone gets the prompt with no block (BT: the prompt as frozen). */
export const buildPrompt = (block: string | null): string => (block ? BUILD_PROMPT + "\n\n" + block : BUILD_PROMPT);

/**
 * The block each arm builds from. A review arm takes its Opus block from stage 2 pass 1, or pass 2 when pass 1 has none,
 * rendered by the score area; with no block on either pass it doesn't build on the unit.
 */
export function armBlock(arm: BuildArm, opusBlock: (arm: Arm) => string | null): { builds: boolean; block: string | null } {
  if (arm === "no-review") return { builds: true, block: null };
  if (arm === "generic-look") return { builds: true, block: GENERIC_LOOK_BLOCK };
  const block = opusBlock(arm);
  return block ? { builds: true, block } : { builds: false, block: null };
}

export const WORK = "/work";
export const REPO = WORK + "/repo";
/** The packed tree, in the audit's own folder so the /work scan never reads it as the session's. */
export const OUT_TAR = AUDIT_DIR + "/out.tar";

export interface BuildInput {
  label: string;
  /** The unit's exported repository as a tar (the base app at its pin with the unit's evidence files). */
  tree: () => Promise<Uint8Array>;
  plan: string;
  prompt: string;
  /** The admitted sub-reservation the build's sessions run on (its round, or its oracle build). */
  sub: SubRef;
}

export interface BuildDeps {
  sandbox: SandboxDeps;
  agent: BuildAgent;
  /** The build VM's spec: the proxy and the named mirrors. */
  buildSpec: (label: string) => VmSpec;
  /** The check VM's spec: the named mirrors only. */
  checkSpec: (label: string) => VmSpec;
  reader: BuildReader;
  /** Where each build and check VM's dropped connections are tallied; selectUnits and runStage3 set it. */
  tally?: SandboxTally[];
}

const must = (r: ExecResult, what: string) => {
  if (r.exit !== 0) throw new Error(what + " exited " + r.exit);
};

const auditStop = (label: string, a: { kind: string; reasons: string[] }) =>
  fail("E_DC_SANDBOX_AUDIT", label + ": the VM's audit " + (a.kind === "breach" ? "found " : "could not collect its evidence: ") + a.reasons.join("; ") + ". Stage 3 stops for the Captain");

interface Attempt {
  agent: AgentRun | null;
  tree: Uint8Array | null;
  error: string | null;
}

/** One build session in its own VM: the tree in /work/repo, plan.md beside it, the agent, then the tree packed. */
async function attempt(input: BuildInput, d: BuildDeps, label: string): Promise<Attempt> {
  const seen: { agent: AgentRun | null } = { agent: null };
  const run = await sandboxed(d.sandbox, d.buildSpec(label), async (vm: Vm) => {
    const b = d.sandbox.backend;
    await b.write(vm, WORK + "/repo.tar", await input.tree());
    must(await b.exec(vm, "mkdir -p " + REPO + " && tar -xf " + WORK + "/repo.tar -C " + REPO + " && rm " + WORK + "/repo.tar && chown -R run " + WORK, { user: "root" }), "unpacking the tree");
    await b.write(vm, WORK + "/plan.md", input.plan);
    must(await b.exec(vm, "touch " + SESSION_MARK, { user: "root" }), "the session's start marker");
    seen.agent = await d.agent(vm, { prompt: input.prompt, limits: STAGE3.build, env: BUILD_ENV, sub: input.sub });
    must(await b.exec(vm, "tar -C " + REPO + " -cf " + OUT_TAR + " .", { user: "root" }), "packing the tree");
    return b.read(vm, OUT_TAR);
  });
  d.tally?.push({ label, blocked: run.blocked });
  if (!run.audit.ok) auditStop(label, run.audit);
  return { agent: seen.agent, tree: run.value, error: run.error };
}

export interface BuildRun {
  /** completed or own-limit: measured as it stands; missing: a failure outside the agent twice. */
  end: "completed" | "own-limit" | "missing";
  attempts: number;
  /** Why the one retry ran. */
  retried: "own-limit" | "infra" | null;
  tree: Uint8Array | null;
  /** Spend over every attempt; null when any attempt's spend is unknown. */
  spentUsd: number | null;
}

const infra = (a: Attempt) => a.error !== null || a.agent === null || a.agent.end === "infra" || a.tree === null;

/**
 * A build with its one retry: a build that stops on its own limit gets one fresh retry, measured as it stands; a failure
 * outside the agent gets one J1 retry after reconcile, then the build is missing. No build gets a third session.
 */
export async function runBuild(input: BuildInput, d: BuildDeps, reconcile: () => Promise<void>): Promise<BuildRun> {
  const first = await attempt(input, d, input.label);
  const spend = (xs: Attempt[]) => (xs.some((x) => x.agent?.spentUsd === null || x.agent?.spentUsd === undefined) ? null : xs.reduce((n, x) => n + x.agent!.spentUsd!, 0));
  if (!infra(first) && first.agent!.end === "completed") return { end: "completed", attempts: 1, retried: null, tree: first.tree, spentUsd: spend([first]) };
  const why = infra(first) ? "infra" : "own-limit";
  if (why === "infra") await reconcile();
  const second = await attempt(input, d, input.label + " retry");
  const both = [first, second];
  if (infra(second)) return { end: "missing", attempts: 2, retried: why, tree: null, spentUsd: spend(both) };
  return { end: second.agent!.end === "completed" ? "completed" : "own-limit", attempts: 2, retried: why, tree: second.tree, spentUsd: spend(both) };
}

export interface CheckRun {
  /** Measure 1: the tree installs and starts with the recipe and serves every route. Null when the check went missing. */
  serves: boolean | null;
  failedStep: string | null;
  reads: BuildReads | null;
}

/** Every route's HTTP status from inside the VM, one line each. */
export const routeStatusCommand = (recipe: Recipe, routes: readonly string[]) =>
  routes.map((r) => "printf '%s\\n' \"$(curl -s -o /dev/null -m 30 -w '%{http_code}' '" + routeUrl(recipe.baseUrl, r).replace(/'/g, "") + "')\"").join(" && ");

/** Reads the status lines: every route must answer below 400. */
export function servesEvery(stdout: string, routes: readonly string[]): boolean {
  const codes = stdout.split("\n").filter(Boolean).map(Number);
  return codes.length === routes.length && codes.every((c) => Number.isInteger(c) && c >= 100 && c < 400);
}

async function checkOnce(tree: Uint8Array, recipe: Recipe, ctx: ReadsContext, d: BuildDeps, label: string) {
  const run = await sandboxed(d.sandbox, d.checkSpec(label), async (vm: Vm): Promise<CheckRun> => {
    const b = d.sandbox.backend;
    await b.write(vm, WORK + "/app.tar", tree);
    for (const s of setupSteps(recipe)) {
      const r = await b.exec(vm, s.command, { user: s.user, timeoutMs: s.minutes * 60_000 });
      if (r.exit !== 0) return { serves: false, failedStep: s.step, reads: null };
    }
    const st = await b.exec(vm, routeStatusCommand(recipe, ctx.routes), { user: "run" });
    if (st.exit !== 0 || !servesEvery(st.stdout, ctx.routes)) return { serves: false, failedStep: "routes", reads: null };
    return { serves: true, failedStep: null, reads: await d.reader(vm, ctx) };
  });
  d.tally?.push({ label, blocked: run.blocked });
  if (!run.audit.ok) auditStop(label, run.audit);
  return run;
}

/** The check run, with one retry when it fails outside the build (the VM, a preamble step, a reader crash), then missing. */
export async function checkBuild(tree: Uint8Array, recipe: Recipe, ctx: ReadsContext, d: BuildDeps, label: string): Promise<CheckRun> {
  for (const l of [label, label + " retry"]) {
    const r = await checkOnce(tree, recipe, ctx, d, l);
    if (r.value) return r.value;
  }
  return { serves: null, failedStep: "check run failed outside the build, twice", reads: null };
}
