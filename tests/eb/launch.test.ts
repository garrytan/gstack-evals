// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless test of the review launcher's pre-cleanup read (lanes/eng-build/launch.ts captureReview), wired into a real
// runTrial on a local sandbox the way reviewLauncher wires it: the work tree is removed when the trial ends, and the
// final plan and the repository edit count are already out.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { oneCommitRepo } from "../../lanes/eng-build/dryrun-pipeline.ts";
import { captureReview, type ReviewCapture } from "../../lanes/eng-build/launch.ts";
import { runTrial, type AgentDriver } from "../../src/trial/trial.ts";
import { localSandbox } from "../adapters/harness.ts";
import { tempDir } from "../real/fixture.ts";
import { buildStop, finishTrial } from "../../lanes/eng-build/launch.ts";
import { EbError } from "../../lanes/eng-build/errors.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LedgerError, readItem } from "../../src/runner/ledger/record.ts";
import { openMeter } from "../../lanes/product-value/meter.ts";

const tmp = tempDir("eb-launch-test-");
afterAll(() => tmp.cleanup());

describe("the review launcher reads the work tree before runTrial removes it", () => {
  // Value: protects=every paid review's plan and edit count; fails_when=the launcher reads plan.md or repo/ after runTrial deleted the work tree, so the record never saves and the review is paid for again on resume.
  test("the final plan.md and the edit count survive the trial's cleanup", async () => {
    const dir = join(tmp.dir, "t1");
    const seed = join(dir, "seed");
    const base = oneCommitRepo(join(dir, "base"));
    oneCommitRepo(join(seed, "repo"));
    writeFileSync(join(seed, "plan.md"), "# Plan\n");
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    const run = join(dir, "run");
    const agent: AgentDriver = {
      run: async (s) => {
        s.exec("printf '# Plan\\n\\nBetter.\\n' > plan.md && printf 'changed\\n' > repo/calc.go && printf 'new\\n' > repo/extra.go", 10_000);
        return { turns: [], termination: { kind: "completed" }, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: null, loaded_bytes: null };
      },
    };
    let captured: ReviewCapture | null = null;
    const gate = (w: string) => {
      captured = captureReview(w, base, join(run, "host"));
      return { copy_out: [], gate: { plan: captured.plan !== null, repo_edits: captured.repoEdits } };
    };
    await runTrial({ cell: { model: "m", arm: "plain", round: 1, trial: 1 }, task: { id: "u1", prompt: "Review the plan." }, tasksDir: join(dir, "fixtures"), sandbox: localSandbox(() => {}), agent, dir: run, timeoutS: 30, seed, stateRoot: false, gate });
    expect(existsSync(join(run, "work", "u1"))).toBe(false);
    expect(captured as ReviewCapture | null).toEqual({ plan: "# Plan\n\nBetter.\n", repoEdits: 2 });
    expect(readFileSync(join(run, "host", "plan.md"), "utf8")).toBe("# Plan\n\nBetter.\n");
  });
});

describe("the build launcher's cap stop", () => {
  // Value: protects=the frozen rule that a cap stop is an incomplete run; fails_when=a build attempt the cap stopped is read as an infra gap, retried and cached.
  test("a stage that ended cap_stop or halted, or a session open that met the cap, stops the stage incomplete", () => {
    const code = (f: () => void) => { try { f(); return "ok"; } catch (e) { return (e as EbError).code; } };
    expect(code(() => buildStop("c", "cap_stop", null))).toBe("E_EB_CELL_INCOMPLETE");
    expect(code(() => buildStop("c", "halted", null))).toBe("E_EB_CELL_INCOMPLETE");
    expect(code(() => buildStop("c", null, '{"event": "turns"}\n{"event": "ledger_cap_stop", "message": "409"}\n'))).toBe("E_EB_CELL_INCOMPLETE");
    expect(code(() => buildStop("c", null, '{"event": "turns"}\n'))).toBe("ok");
    expect(code(() => buildStop("c", "completed", null))).toBe("ok");
  });
});

describe("the review launcher's trial guard", () => {
  // Value: protects=the review stage's one-rerun-then-gap rule and its metered spend; fails_when=a sandbox throw escapes the session and aborts the stage with its meter never finalized.
  test("any throw finalizes the meter; a lane or ledger throw still stops, any other ends the attempt infra", async () => {
    let finals = 0;
    const finalize = async () => (finals++, { micros: 7 });
    expect(await finishTrial(async () => 1, finalize)).toEqual({ trial: 1, micros: 7 });
    expect(await finishTrial(async () => { throw new TypeError("docker could not start"); }, finalize)).toEqual({ trial: null, error: "TypeError: docker could not start", micros: 7 });
    const stops = [new EbError("E_EB_CELL_INCOMPLETE", "cap"), new LedgerError("CAP_STOP", "cap")];
    for (const e of stops) expect(await finishTrial(async () => { throw e; }, finalize).then(() => null, (x) => x)).toBe(e);
    expect(finals).toBe(4);
  });
});

describe("the note launcher's lease size", () => {
  // Value: protects=--cap-usd on the notes stage; fails_when=the meter's lease ignores the stage's cap and reserves the item's whole cap left, or a caller that passes no amount stops reserving what the cap has left.
  test("an amount caps the lease; without one the lease reserves what the item's cap has left, as before", async () => {
    const root = join(tmp.dir, "meter");
    const record = join(root, "record");
    const ledger = join(root, "ledger.sqlite");
    const quote = { words: "meter lease size test on a temporary ledger", by: "eb tests", source: "tests/eb/launch.test.ts" };
    for (const item of ["m-amount", "m-left"]) recordApproval(record, { action: "init", item, cap_micros: 5_000_000, quotes: [quote], admission: "warn" });
    const env = { GSTACK_EVALS_LEDGER_RECORD: record };
    for (const [item, amountMicros, want] of [["m-amount", 1_500_000, 1_500_000], ["m-left", undefined, 5_000_000]] as const) {
      const m = await openMeter({ item, runId: item, out: join(root, item), cacheDir: join(root, item + "-cache"), maxOutputTokens: 1000, ...(amountMicros === undefined ? {} : { amountMicros }), record, ledger, env });
      try {
        expect(readItem(record, item).leases.find((l) => l.lease.lease_id === m.leaseId)!.lease.reserved_micros).toBe(want);
      } finally {
        await m.close();
      }
    }
  });
});
