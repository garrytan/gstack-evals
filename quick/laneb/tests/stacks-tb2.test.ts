import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadJobs, readSessionRows } from "../analysis/analyze.ts";
import { ideaWins, PAIRS, RESAMPLES, SEED, stacksContrasts } from "../analysis/stacks-tb2.ts";

const TASKS = ["t1", "t2", "t3", "t4", "t5", "t6"];
type Spec = { task: string; model: string; arm: string; reward?: number; responded?: boolean };

// A Harbor job folder and its proxy session rows, one trial per spec, as the runner leaves them.
function run(specs: Spec[]) {
  const dir = mkdtempSync(join(tmpdir(), "stacks-tb2-"));
  const job = join(dir, "job");
  const rows: string[] = [];
  specs.forEach((s, i) => {
    const name = `${s.task}__${i}`;
    mkdirSync(join(job, name, "agent"), { recursive: true });
    writeFileSync(join(job, name, "config.json"), JSON.stringify({ task: { path: "/w/run/tasks/" + s.task }, agent: { kwargs: { arm: s.arm, upstream_model: s.model } } }));
    writeFileSync(join(job, name, "result.json"), JSON.stringify({ trial_name: name, verifier_result: s.reward === undefined ? null : { rewards: { reward: s.reward } }, exception_info: s.reward === undefined ? { exception_type: "VerifierTimeoutError", exception_message: "x" } : null }));
    rows.push(JSON.stringify({ id: `s${i}`, trial: name + "__env", spent_micros: 1000, ok_responses: s.responded === false ? 0 : 2, requests: 2, refused: 0, refused_budget: 0, opened_at: "2026-11-01T00:00:00Z" }));
  });
  writeFileSync(join(dir, "proxy-sessions.jsonl"), rows.join("\n") + "\n");
  return { job, sessions: join(dir, "proxy-sessions.jsonl"), dir };
}

const cell = (model: string, arm: string, pass: (task: string) => boolean): Spec[] => TASKS.map((task) => ({ task, model, arm, reward: pass(task) ? 1 : 0 }));
const half = (task: string) => ["t1", "t2", "t3"].includes(task);
const specs: Spec[] = [
  ...cell("opus", "none", half),
  ...cell("opus", "gstack", () => false),
  ...cell("opus", "pstack", () => true),
  ...cell("haiku", "none", half),
  ...cell("haiku", "gstack", (t) => t === "t1").filter((s) => s.task !== "t6"),
  { task: "t6", model: "haiku", arm: "gstack" },
  { task: "t6", model: "haiku", arm: "gstack", responded: false },
  ...cell("haiku", "placebo", () => true),
  ...cell("haiku", "pstack", () => true),
  ...cell("haiku", "pstack-placebo", () => true),
];

describe("stacks round 1 TB2 contrasts", () => {
  const r = run(specs);
  const trials = loadJobs([r.job], readSessionRows([r.sessions]));
  const zero = stacksContrasts(trials, { models: ["opus", "haiku"], reference: "opus", noReward: "zero" });
  const get = (rep: typeof zero, model: string, contrast: string) => rep.rows.find((x) => x.model === model && x.contrast === contrast);

  test("the frozen pairs, seed and resamples", () => {
    expect(PAIRS).toEqual([["pstack", "gstack"], ["pstack", "pstack-placebo"], ["gstack", "none"]]);
    expect(SEED).toBe(20261031);
    expect(RESAMPLES).toBe(10000);
  });

  test("gstack minus none is reported for every model with both cells, beside pstack minus gstack", () => {
    expect(zero.rows.map((x) => `${x.model} ${x.contrast}`)).toEqual(["opus pstack - gstack", "opus gstack - none", "haiku pstack - gstack", "haiku pstack - pstack-placebo", "haiku gstack - none"]);
    expect(get(zero, "opus", "gstack - none")!.diff).toBeCloseTo(-0.5);
    expect(get(zero, "haiku", "gstack - none")).toMatchObject({ tasks: 6 });
    expect(get(zero, "haiku", "gstack - none")!.diff).toBeCloseTo(-2 / 6);
  });

  test("pstack wins on the reference against gstack alone, and on a cheap rung only past its placebo too", () => {
    expect(get(zero, "opus", "pstack - gstack")!.lo).toBeGreaterThan(0);
    expect(get(zero, "haiku", "pstack - gstack")!.lo).toBeGreaterThan(0);
    expect(get(zero, "haiku", "pstack - pstack-placebo")!.diff).toBe(0);
    expect(zero.wins).toEqual([{ model: "opus", pstackWins: true }, { model: "haiku", pstackWins: false }]);
  });

  test("a trial with no reward after a model response scores 0, the drop reading removes it, and infra leaves both", () => {
    const t6 = trials.filter((t) => t.task === "t6" && t.model === "haiku" && t.arm === "gstack");
    expect(t6.map((t) => [t.outcome, t.noReward]).sort()).toEqual([["fail", true], ["infra", false]]);
    const drop = stacksContrasts(trials, { models: ["opus", "haiku"], reference: "opus", noReward: "drop" });
    expect(get(drop, "haiku", "gstack - none")).toMatchObject({ tasks: 5 });
    expect(get(drop, "haiku", "gstack - none")!.diff).toBeCloseTo(-2 / 5);
  });

  test("idea-card wins count tasks pstack passed twice and gstack never, beside a seeded within-task swap null", () => {
    const extra = [...cell("haiku", "pstack", () => true), ...cell("haiku", "pstack", (t) => t !== "t2")];
    const r2 = run([...specs, ...extra]);
    const more = loadJobs([r2.job], readSessionRows([r2.sessions]));
    const haiku = ideaWins(more, "haiku");
    expect(haiku).toMatchObject({ tasks: 6, wins: 5, won: ["t2", "t3", "t4", "t5", "t6"], nullP95: 4, aboveNull: true });
    expect(haiku.nullMean).toBeCloseTo(2.5, 1);
    expect(ideaWins(more, "haiku")).toEqual(haiku);
    expect(ideaWins(trials, "opus")).toMatchObject({ tasks: 6, wins: 0 });
  });

  test("the intervals are reproducible", () => {
    const again = stacksContrasts(trials, { models: ["opus", "haiku"], reference: "opus", noReward: "zero" });
    expect(again).toEqual(zero);
  });

  test("the CLI prints both readings for every task set and refuses a config without sessions", () => {
    const cfg = join(r.dir, "config.json");
    writeFileSync(cfg, JSON.stringify({ models: ["opus", "haiku"], reference: "opus", jobs: [r.job], sessions: [r.sessions], subsets: { first: ["t1", "t2"] } }));
    const ok = Bun.spawnSync(["bun", join(import.meta.dir, "../analysis/stacks-tb2.ts"), cfg]);
    const out = ok.stdout.toString();
    expect(ok.exitCode).toBe(0);
    expect(out.match(/^## /gm)!.length).toBe(4);
    expect(out).toContain("| haiku | gstack - none | 6 | -33 [");
    expect(out).toContain("| opus | yes |");
    writeFileSync(cfg, JSON.stringify({ models: ["opus"], reference: "opus", jobs: [r.job], sessions: [] }));
    const bad = Bun.spawnSync(["bun", join(import.meta.dir, "../analysis/stacks-tb2.ts"), cfg]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr.toString()).toStartWith("E_USAGE");
  });
});
