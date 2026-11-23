import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureUnit } from "../../lanes/day-one/dryrun.ts";
import { MODELS } from "../../lanes/day-one/frozen.ts";
import { DAYONE_RUN } from "../../lanes/day-one/ledger.ts";
import { runStage, type StageInput } from "../../lanes/day-one/run.ts";
import { attemptOutcome, launchSession, settle, type AttemptRead, type LaunchInput } from "../../lanes/day-one/sessions.ts";
import { loadUnit, type Unit } from "../../lanes/day-one/units.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;

const stubRig = (): HostRig => {
  let n = 0;
  return {
    baseUrl: "http://proxy",
    network: "none",
    imageDigest: null,
    bind: async () => ({ slot: "s" + ++n, token: "t" + n, meter_id: "m" + n }) as never,
    finalize: async () => ({ micros: 0, requests: 0, refused: 0 }) as never,
    arms: {},
    sandbox: () => ({ homePath: () => "/home/agent", workPath: () => "/work/app", agent: () => { throw new Error("no container starts here"); } }) as never,
    judgeSandbox: () => ({}) as never,
    egress: () => ({ open: false, detail: "" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
};

const withDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "day-one-hold-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Value: protects=section 7, item B, of the first pin change: every planning session, whatever its arm, stays open while background work it started still runs, up to its own time limit, and builds and checks still end at their first reply; fails_when=an arm's planning session ends at its first result with work still out, the hold outlasts the session's minutes, or a build or check holds; why_new=the day-one smoke, where an A session ran its second-model review in the background and the session ended with it still running; seam=runStage's launch input and launchSession's driver options; no_claim=the driver's hold itself, which tests/adapters/claude-code.test.ts covers
describe("the background hold", () => {
  test("a held session gets the driver's background wait at its own time limit, and any other session gets none", async () =>
    withDir(async (dir) => {
      const seen: Record<string, unknown>[] = [];
      const driver = ((o: Record<string, unknown>) => (seen.push(o), { env: {} })) as never;
      const trial = (async () => ({ record: { termination: { kind: "completed" } } })) as never;
      const cases: [string, boolean][] = [["n", true], ["a", true], ["build", false], ["check", false]];
      for (const [arm, hold] of cases) {
        const d = join(dir, arm);
        mkdirSync(d, { recursive: true });
        await launchSession({ rig: stubRig(), policy, docker: "docker", runId: DAYONE_RUN, arm, cell: "u-r1-" + arm, rep: 1, attempt: 1, model: arm === "check" ? MODELS.checker : MODELS.planner, dir: d, seed: null, prompt: "p", minutes: 25, turns: 1, allowanceMicros: 1e6, nextUser: async () => ({ end: true }), ...(hold ? { hold: true as const } : {}) }, { driver, trial });
      }
      expect(seen.map((o) => o.backgroundWaitMs)).toEqual([25 * 60_000, 25 * 60_000, undefined, undefined]);
    }));

  test("every planning session holds, for every arm, and builds do not", async () =>
    withDir(async (dir) => {
      fixtureUnit(join(dir, "units"), "aaaaaa", 2);
      const u = (loadUnit(join(dir, "units"), "aaaaaa") as { unit: Unit }).unit;
      const seen: [string, boolean][] = [];
      const launch = async (l: LaunchInput): Promise<AttemptRead> => {
        seen.push([l.arm, l.hold === true]);
        const out = join(l.dir, "out");
        mkdirSync(out, { recursive: true });
        if (l.arm === "build") writeFileSync(join(out, "start.sh"), "node server.js\n");
        else writeFileSync(join(out, "plan.md"), "# Plan by " + l.arm + "\n");
        return { termination: { kind: "completed" }, web: 0, gstack_reads: [], contained: [], micros: 1e6, voice: l.gstack ? { micros: 0, requests: 0, refused: 0 } : null, out };
      };
      const meter = { leaseId: "owner", spent: () => 0, close: async () => ({ spent_micros: 0, unknown_micros: 0 }), call: async () => ({ text: "On weekends.\nSOURCE: profile", status: 200, micros: 1000, cached: false, problem: null, served_by: "openai" }) };
      const input = (stage: StageInput["stage"], arms: StageInput["arms"]): StageInput => ({ stage, tag: "t", units: [u], reps: [1], arms, out: join(dir, "out"), runId: DAYONE_RUN, cap: 1000e6, ownerCap: 10e6, voiceCap: 1000e6, parallel: 1, ownerChannel: true, policy, ledger: null, docker: "docker", scratch: join(dir, "scratch"), nodeVolume: null, log: () => {} });
      for (const [stage, arms] of [["base", ["n"]], ["review", ["d", "r", "a"]], ["build", ["n"]]] as const) {
        const r = await runStage(input(stage, [...arms]), { openRig: stubRig, ownerMeter: meter as never, launch });
        expect([stage, r.stops]).toEqual([stage, []]);
      }
      expect(seen).toEqual([["n", true], ["d", true], ["r", true], ["a", true], ["build", false]]);
    }));
});

// Value: protects=section 7, item B, of the first pin change as the follow-up changed it: a held session that reaches its time limit with background work still out gets the one retry every retryable failure gets, and on the retry it is a gap row that names its cause; fails_when=the deadline reads as an upstream failure, is a gap with no retry, or scores as the arm's plan; why_new=the day-one results review, which found that held timeouts became gaps with no retry and could fall unevenly by arm; seam=attemptOutcome and settle; no_claim=which work held the session, which the driver's session_end records
describe("a held session that reaches its time limit", () => {
  test("retries once, then is a missing row, E_DAYONE_BACKGROUND, with its cause", () => {
    const read = { web: 0, gstack_reads: [], contained: [], micros: 0, voice: null, out: null };
    const why = "background work the session started still ran at its time limit";
    const o = attemptOutcome({ ...read, termination: { kind: "missing", code: "E_BACKGROUND_DEADLINE" } }, null);
    expect(o).toEqual({ state: "retry", why, code: "E_DAYONE_BACKGROUND" });
    expect(settle(o, 1)).toEqual(o);
    expect(settle(o, 2)).toEqual({ state: "missing", code: "E_DAYONE_BACKGROUND", why: why + ", on the retry" });
    expect(attemptOutcome({ ...read, contained: null, termination: { kind: "missing", code: "E_BACKGROUND_DEADLINE" } }, null)).toEqual(o);
    expect(settle({ state: "retry", why: "an upstream failure" }, 2)).toEqual({ state: "missing", code: "E_DAYONE_GAP", why: "an upstream failure, on the retry" });
  });
});
