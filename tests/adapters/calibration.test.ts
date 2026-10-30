import { describe, expect, test } from "bun:test";
import { CONFIG_EXPECTED, judgeCalibration, quotes, sentinelFor, type ProbeRun } from "../../src/adapters/calibration.ts";
import { seedConfig } from "../../src/trial/state-root.ts";
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

describe("calibration's config check", () => {
  // Value: protects=a gstack base arm calibrates only when gstack-skill-start prints the seeded proactive value, the seeded routing decline and the session kind, through a shell call that succeeded, so a base whose preamble would offer CLAUDE.md routing rules (and append them, which fails /learn's export check) stops before any trial; fails_when=a missing or false ROUTING_DECLINED line passes, or the seed stops writing routing_declined; why_new=GSTA-41's U11 brief (gstack 1.91.333.0's routing injection, GSTA-37's open item 1); seam=judgeCalibration and seedConfig; no_claim=that every gstack version prints the line
  test("ROUTING_DECLINED must print true beside PROACTIVE and SESSION_KIND", () => {
    const configRun = (text: string): ProbeRun => ({ probe: { check: "config", arm: "before", interactive: false, task: { id: "calibration-config", prompt: "" } }, outcome: outcome(text, null), calls: [{ id: "c1", tool: "Bash", input: { command: "~/.claude/skills/gstack/bin/gstack-skill-start --skill learn 2>&1 | grep -E '^(PROACTIVE|ROUTING_DECLINED|SESSION_KIND):'" }, ok: true, subagent: false }] });
    const judge = (text: string) => judgeCalibration({ host: "claude", model: "m", nonce: "n0nce42", sentinels: {}, runs: [configRun(text)], egress: null, usersim: false });
    expect(seedConfig("core").routing_declined).toBe(CONFIG_EXPECTED.routing_declined);
    const ok = judge("PROACTIVE: core\nROUTING_DECLINED: true\nSESSION_KIND: interactive");
    expect([ok.failures, ok.result.config]).toEqual([[], true]);
    for (const text of ["PROACTIVE: core\nROUTING_DECLINED: false\nSESSION_KIND: interactive", "PROACTIVE: core\nSESSION_KIND: interactive"]) {
      const bad = judge(text);
      expect([bad.result.config, bad.failures.map((f) => f.code)]).toEqual([false, ["CALIBRATION_CONFIG"]]);
      expect(bad.failures[0]!.message).toContain("ROUTING_DECLINED");
    }
  });
});
