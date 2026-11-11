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
