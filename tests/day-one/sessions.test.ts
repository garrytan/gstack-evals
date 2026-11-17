import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELS } from "../../lanes/day-one/frozen.ts";
import { DAYONE_RUN } from "../../lanes/day-one/ledger.ts";
import { attemptOutcome, launchSession } from "../../lanes/day-one/sessions.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;

/** A rig that binds slots and meters nothing; the sessions below never start a container. */
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

/** One session whose transcript holds the given tool calls, through launchSession with a stub driver and trial. */
async function session(dir: string, arm: string, calls: { name: string; input: Record<string, string> }[]) {
  const d = join(dir, arm);
  mkdirSync(d, { recursive: true });
  const transcript = calls.map((c, i) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "c" + i, name: c.name, input: c.input }] } }) + "\n").join("");
  const trial = async () => {
    mkdirSync(join(d, "host"), { recursive: true });
    writeFileSync(join(d, "host", "transcript.ndjson"), transcript);
    mkdirSync(join(d, "out"), { recursive: true });
    return { record: { termination: { kind: "completed" } } };
  };
  return launchSession(
    { rig: stubRig(), policy, docker: "docker", runId: DAYONE_RUN, arm, cell: "u-r1-" + arm, rep: 1, attempt: 1, model: arm === "check" ? MODELS.checker : MODELS.planner, dir: d, seed: null, prompt: "p", minutes: 1, turns: 1, allowanceMicros: 1e6, nextUser: async () => ({ end: true }) },
    { driver: (() => ({ env: {} })) as never, trial: trial as never },
  );
}

describe("the gstack-read check (prereg section 8)", () => {
  test("marks N, D and R planning sessions, and never a build or check session that only names gstack while it reads an /autoplan plan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "day-one-reads-"));
    try {
      const calls: { name: string; input: Record<string, string> }[] = [
        { name: "Read", input: { file_path: "/work/app/plan.md" } },
        { name: "Bash", input: { command: "grep -n 'gstack-autoplan' plan.md" } },
      ];
      for (const arm of ["n", "d", "r"]) {
        const read = await session(dir, arm, calls);
        expect(read.gstack_reads).toEqual(["Bash grep -n 'gstack-autoplan' plan.md"]);
        expect(attemptOutcome(read, null).state).toBe("contaminated");
      }
      for (const arm of ["build", "check"]) {
        const read = await session(dir, arm, calls);
        expect(read.gstack_reads).toEqual([]);
        expect(attemptOutcome(read, null).state).not.toBe("contaminated");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
