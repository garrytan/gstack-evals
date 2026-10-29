import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, bootstrap, loadJobs, markdown, skillOpensFromMessages, type SessionRow, type Trial } from "../analysis/analyze.ts";

const mk = (task: string, model: string, arm: string, pass: boolean, extra: Partial<Trial> = {}): Trial => ({
  task, model, arm, trialName: `${task}-${model}-${arm}`, outcome: pass ? "pass" : "fail", reason: "graded", noReward: false, modelResponded: true, costUsd: 1, attempts: 1, requests: 3, refused: 0, skillOpens: [], budgetStop: false, agentTimeout: false, wallS: 1, ...extra,
});

// A Harbor job directory with one trial per spec, as the runner leaves it.
function job(specs: { name: string; reward?: number; exc?: string; evaluator?: Record<string, string>; agent?: Record<string, string> }[]) {
  const dir = mkdtempSync(join(tmpdir(), "laneb-analysis-"));
  for (const s of specs) {
    const d = join(dir, s.name);
    mkdirSync(join(d, "agent"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: "/w/run/tasks/" + s.name.split("__")[0] }, agent: { kwargs: { arm: "none", upstream_model: "opus" } } }));
    writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: s.name, verifier_result: s.reward === undefined ? null : { rewards: { reward: s.reward } }, exception_info: s.exc ? { exception_type: s.exc, exception_message: "x" } : null }));
    for (const [f, body] of Object.entries(s.agent ?? {})) writeFileSync(join(d, "agent", f), body);
    if (s.evaluator) {
      mkdirSync(join(d, "evaluator"));
      for (const [f, body] of Object.entries(s.evaluator)) writeFileSync(join(d, "evaluator", f), body);
    }
  }
  return dir;
}
const row = (trial: string, id: string, spent: number, ok: number, extra: Partial<SessionRow> = {}): SessionRow => ({ id, trial: trial + "__env", spent_micros: spent, ok_responses: ok, requests: ok, refused: 0, refused_budget: 0, opened_at: "2026-10-28T00:00:0" + id.slice(-1) + "Z", closed_at: "2026-10-28T01:00:00Z", ...extra });
const msg = (content: unknown[]) => JSON.stringify({ type: "AssistantMessage", content });

describe("analysis", () => {
  test("skill opens come from the Skill tool and from reading a SKILL.md", () => {
    const lines = [
      JSON.stringify({ type: "AssistantMessage", content: [{ name: "Skill", input: { skill: "investigate" } }] }),
      JSON.stringify({ type: "AssistantMessage", content: [{ name: "Read", input: { file_path: "/root/.claude/skills/review/SKILL.md" } }] }),
      JSON.stringify({ type: "AssistantMessage", content: [{ name: "Bash", input: { command: "cat /root/.claude/skills/qa/SKILL.md" } }] }),
      JSON.stringify({ type: "AssistantMessage", content: [{ name: "Bash", input: { command: "ls /root/.claude/skills" } }] }),
    ];
    expect(skillOpensFromMessages(lines)).toEqual(["investigate", "review", "qa"]);
  });

  test("bootstrap is seeded and brackets the point estimate", () => {
    const tasks = ["a", "b", "c", "d"];
    const v: Record<string, number> = { a: 1, b: 0, c: 1, d: 1 };
    const one = bootstrap(tasks, (s) => s.reduce((x, k) => x + v[k], 0) / s.length, { b: 2000, seed: 7 });
    const two = bootstrap(tasks, (s) => s.reduce((x, k) => x + v[k], 0) / s.length, { b: 2000, seed: 7 });
    expect(one).toEqual(two);
    expect(one.point).toBe(0.75);
    expect(one.lo).toBeLessThanOrEqual(0.75);
    expect(one.hi).toBe(1);
  });

  test("pass rates, paired contrasts, gap share, and infra exclusion", () => {
    const trials: Trial[] = [];
    const tasks = ["t1", "t2", "t3", "t4"];
    tasks.forEach((t, i) => {
      trials.push(mk(t, "opus", "none", i < 3), mk(t, "opus", "gstack", i < 3), mk(t, "opus", "placebo", i < 3));
      trials.push(mk(t, "haiku", "none", i < 1), mk(t, "haiku", "gstack", i < 2, { skillOpens: ["investigate"] }), mk(t, "haiku", "placebo", i < 1));
    });
    trials.push(mk("t1", "haiku", "none", true, { outcome: "infra", reason: "boom" }));
    const rep = analyze(trials, { models: ["opus", "haiku"], arms: ["none", "gstack", "placebo"], reference: "opus", b: 500 });
    const haikuG = rep.passRates.find((r) => r.model === "haiku" && r.arm === "gstack")!;
    expect(haikuG.rate).toBe(0.5);
    expect(haikuG.skillOpenRate).toBe(1);
    expect(haikuG.costPerSuccess).toBe(2);
    const c = rep.contrasts.find((x) => x.model === "haiku" && x.contrast === "gstack - none")!;
    expect(c.diff).toBe(0.25);
    const g = rep.gap.find((x) => x.model === "haiku")!;
    expect(g.share).toBeCloseTo(0.5);
    expect(rep.infra).toHaveLength(1);
  });

  test("a paid trial without a verifier reward scores 0; infra needs no model response at all", () => {
    const dir = job([
      { name: "a__1", exc: "VerifierTimeoutError" },
      { name: "b__1", exc: "RewardFileNotFoundError" },
      { name: "c__1", exc: "LanebInfraError" },
      { name: "d__1", exc: "RuntimeError", evaluator: { "sdk-messages.jsonl": msg([{ type: "text", text: "hi" }]) + "\n" } },
      { name: "e__1", exc: "RuntimeError" },
      // Extended by gstack /ship Step 7 (test coverage audit) for #25, pass 1.
      // Value: protects=a reward that is not a finite number counts as no reward, so the model-response rule decides;
      //   fails_when=the Number.isFinite guard goes, and NaN grades as a plain fail (paid) or turns infra into a fail;
      //   why_new=every other fixture has a numeric reward or none; seam=none; no_claim=none beyond protects
      { name: "f__1", reward: "n/a" as any },
      { name: "g__1", reward: "n/a" as any },
    ]);
    const trials = loadJobs([dir], [row("a__1", "s-1", 2_000_000, 4), row("b__1", "s-2", 500_000, 1), row("c__1", "s-3", 0, 0), row("f__1", "s-4", 300_000, 1)]);
    const by = Object.fromEntries(trials.map((t) => [t.trialName, t]));
    expect(by["a__1"]).toMatchObject({ outcome: "fail", noReward: true, costUsd: 2 });
    expect(by["a__1"].reason).toContain("VerifierTimeoutError");
    expect(by["b__1"]).toMatchObject({ outcome: "fail", noReward: true });
    expect(by["c__1"]).toMatchObject({ outcome: "infra", noReward: false, costUsd: 0 });
    expect(by["d__1"]).toMatchObject({ outcome: "fail", noReward: true, costUsd: null });
    expect(by["e__1"]).toMatchObject({ outcome: "infra", costUsd: null });
    expect(by["f__1"]).toMatchObject({ outcome: "fail", noReward: true, costUsd: 0.3 });
    expect(by["g__1"]).toMatchObject({ outcome: "infra", noReward: false, reason: "no verifier reward and no model response" });
  });

  test("cost comes from the proxy's session rows, sums retried attempts, and is never read from agent/", () => {
    const dir = job([
      { name: "a__1", reward: 1, agent: { "laneb-summary.json": JSON.stringify({ session: { spent_micros: 0, refused_budget: 0 } }) } },
      { name: "b__1", reward: 0 },
      { name: "c__1", reward: 1 },
    ]);
    const trials = loadJobs([dir], [row("a__1", "s-1", 2_500_000, 3), row("b__1", "s-2", 100_000, 0), row("b__1", "s-3", 900_000, 2, { refused_budget: 1 })]);
    const by = Object.fromEntries(trials.map((t) => [t.trialName, t]));
    expect(by["a__1"].costUsd).toBe(2.5);
    expect(by["b__1"]).toMatchObject({ outcome: "fail", costUsd: 1, attempts: 2, budgetStop: true, reason: "session budget stop, graded" });
    expect(by["c__1"]).toMatchObject({ outcome: "pass", costUsd: null, attempts: 0 });
    const rep = analyze(trials, { models: ["opus"], arms: ["none"], reference: "opus", b: 100 });
    expect(rep.passRates[0]).toMatchObject({ costUsd: null, costMissing: 1, costPerSuccess: null });
    expect(rep.costMissing.map((t) => t.trial)).toEqual(["c__1"]);
  });

  test("skill opens come from evaluator/ when it exists, and from agent/ only for older runs, flagged", () => {
    const opened = msg([{ name: "Skill", input: { skill: "investigate" } }]) + "\n";
    const forged = msg([{ name: "Skill", input: { skill: "forged" } }]) + "\n";
    const dir = job([
      { name: "a__1", reward: 1, evaluator: { "sdk-messages.jsonl": opened }, agent: { "sdk-messages.jsonl": forged } },
      { name: "b__1", reward: 1, agent: { "sdk-messages.jsonl": opened } },
    ]);
    const by = Object.fromEntries(loadJobs([dir], [row("a__1", "s-1", 1, 1), row("b__1", "s-2", 1, 1)]).map((t) => [t.trialName, t]));
    expect(by["a__1"].skillOpens).toEqual(["investigate"]);
    expect(by["a__1"].reason).toBe("graded");
    expect(by["b__1"].skillOpens).toEqual(["investigate"]);
    expect(by["b__1"].reason).toContain("evidence read from agent/");
  });

  test("the dropped alternative removes paid trials without a reward instead of scoring them 0", () => {
    const trials = [mk("t1", "opus", "none", true), mk("t2", "opus", "none", false, { noReward: true, reason: "VerifierTimeoutError, scored 0" })];
    const zero = analyze(trials, { models: ["opus"], arms: ["none"], reference: "opus", b: 100 });
    const drop = analyze(trials, { models: ["opus"], arms: ["none"], reference: "opus", b: 100, noReward: "drop" });
    expect(zero.passRates[0]).toMatchObject({ rate: 0.5, trials: 2, noReward: 1 });
    expect(drop.passRates[0]).toMatchObject({ rate: 1, trials: 1, noReward: 0 });
    expect(drop.noReward).toHaveLength(1);
    expect(drop.noRewardPolicy).toBe("drop");
  });

  // Generated by gstack /ship Step 7 (test coverage audit), pass 2.
  // Value: protects=gap share is undefined (NaN, no defined resamples) when Opus none does not beat the model's none,
  //   and the markdown prints n/a; fails_when=the denom > 0 guard is dropped and a negative gap yields a finite share;
  //   why_new=the test above has a positive gap only; seam=none; no_claim=none beyond protects
  test("gap share is undefined when Opus none does not beat the model's none, and markdown prints n/a", () => {
    const trials: Trial[] = [];
    ["t1", "t2", "t3", "t4"].forEach((t, i) => {
      trials.push(mk(t, "opus", "none", i < 1), mk(t, "opus", "gstack", i < 1));
      trials.push(mk(t, "haiku", "none", i < 2), mk(t, "haiku", "gstack", i < 3));
    });
    const rep = analyze(trials, { models: ["opus", "haiku"], arms: ["none", "gstack"], reference: "opus", b: 500 });
    const g = rep.gap.find((x) => x.model === "haiku")!;
    expect(g.opusNone).toBe(0.25);
    expect(g.modelNone).toBe(0.5);
    expect(Number.isNaN(g.share)).toBe(true);
    expect(g.definedShare).toBe(0);
    expect(markdown(rep).split("\n")).toContain("| haiku | 4 | 25% | 50% | 75% | n/a [n/a, n/a] | 0% |");
  });
});
