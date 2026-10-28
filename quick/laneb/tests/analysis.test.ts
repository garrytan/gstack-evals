import { describe, expect, test } from "bun:test";
import { analyze, bootstrap, skillOpensFromMessages, type Trial } from "../analysis/analyze.ts";

const mk = (task: string, model: string, arm: string, pass: boolean, extra: Partial<Trial> = {}): Trial => ({
  task, model, arm, trialName: `${task}-${model}-${arm}`, outcome: pass ? "pass" : "fail", reason: "graded", costUsd: 1, requests: 3, refused: 0, skillOpens: [], budgetStop: false, agentTimeout: false, wallS: 1, ...extra,
});

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
});
