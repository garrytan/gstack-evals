import { describe, expect, test } from "bun:test";
import { judgeCalibration, quotes, sentinelFor, type ProbeRun } from "../../src/adapters/calibration.ts";
import type { AgentOutcome } from "../../src/trial/trial.ts";

const outcome = (text: string, opened: boolean | null): AgentOutcome => ({ turns: [text], termination: { kind: "completed" }, opened, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null });
const skillRun = (arm: string, text: string): ProbeRun => ({ probe: { check: "skill", arm, interactive: false, task: { id: "calibration-skill-" + arm, prompt: "" } }, outcome: outcome(text, true), calls: [] });

describe("calibration's sentinel match", () => {
  // Value: protects=an arm whose name extends another's (before2, the noise floor's default copy of before) quotes only its own sentinel, so the default arm set passes calibration and a cross-arm quote still fails; fails_when=before2's sentinel counts as a quote of before's, so every default real-host run stops with CALIBRATION_SKILL; why_new=Capy's review of #67; seam=quotes, judgeCalibration; no_claim=a model session, which tests/adapters/run-host.test.ts covers
  test("before2's sentinel is not a quote of before's, and a quote of another arm still fails", () => {
    const nonce = "n0nce42";
    const sentinels = { before: sentinelFor(nonce, "before"), before2: sentinelFor(nonce, "before2"), after: sentinelFor(nonce, "after") };
    expect([quotes(sentinels.before2, sentinels.before), quotes(sentinels.before2, sentinels.before2), quotes(sentinels.before + ".", sentinels.before)]).toEqual([false, true, true]);
    const own = Object.keys(sentinels).map((arm) => skillRun(arm, sentinels[arm as keyof typeof sentinels]));
    const ok = judgeCalibration({ host: "claude", model: "m", nonce, sentinels, runs: own, egress: null, usersim: false });
    expect([ok.failures, ok.result.skill]).toEqual([[], true]);
    const crossed = judgeCalibration({ host: "claude", model: "m", nonce, sentinels, runs: [skillRun("before", sentinels.before2)], egress: null, usersim: false });
    expect(crossed.failures.map((f) => f.code + " " + f.message)).toEqual(["CALIBRATION_SKILL arm before on claude, model m: the answer did not quote this arm's sentinel; read: nothing"]);
  });
});
