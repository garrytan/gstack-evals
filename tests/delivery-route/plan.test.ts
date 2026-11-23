// Copyright (c) 2026 Garry Tan. MIT License.
// The delivery route lane's frozen plan and money (lanes/delivery-route/pins.ts, plans.ts, money.ts), its arm tars
// (arms.ts), the session table (table.ts) and a keyless prepare through L1's launcher.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plannedCells, type Plan } from "../../quick/laneb/l1/l1.ts";
import { appendRow, readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { check, wrappers } from "../../lanes/delivery-route/arms.ts";
import { approve, capOf, launchGuard, markDone, needsRerun } from "../../lanes/delivery-route/money.ts";
import { guardParts } from "../../lanes/delivery-route/cli.ts";
import { ARM_NAMES, ARMS, CAPS_USD, CLOSING, drawnTasks, ITEM_NAMES, loadBundle, REPO, SMOKE_TASKS, sha256 } from "../../lanes/delivery-route/pins.ts";
import { B1_PROFILE, itemPlan } from "../../lanes/delivery-route/plans.ts";
import { b1Row, safetyStop, stepsSeen } from "../../lanes/delivery-route/table.ts";

const CLI = join(REPO, "lanes/delivery-route/cli.ts");
const run = (args: string[], env: Record<string, string> = {}) => Bun.spawnSync([process.execPath, CLI, ...args], { env: { ...process.env, ...env }, cwd: REPO });
const draw = drawnTasks(loadBundle());

describe("plan", () => {
  test("60 run tasks from 60 repositories and the two smoke tasks, as draw.txt prints them", () => {
    const text = (xs: string[]) => [...xs].sort().join("\n") + "\n";
    expect(sha256(text(draw.run))).toBe("7f29de150b2b416732958535c3d90614bcb47b5a30ede2d85d3d74242e4ced55");
    expect(draw.smoke).toEqual(SMOKE_TASKS);
  });
  test("each main item runs every run task in all four arms, a task's arms in one part; the smoke runs a part per model", () => {
    for (const i of ["b1-opus", "b1-sol", "b1-p1"] as const) {
      const p = itemPlan(i, draw.run);
      expect([p.parts.length, p.sessions]).toEqual([3, 240]);
      const cells = p.parts.flatMap((x) => [...plannedCells(x).keys()]);
      expect(new Set(cells).size).toBe(240);
      for (const x of p.parts) for (const r of x.rects) expect([...r.arms].sort()).toEqual([...ARM_NAMES].sort());
    }
    const s = itemPlan("b1-smoke", draw.run);
    expect(s.parts.map((x) => [x.name, x.model, x.cells])).toEqual([["smoke-opus", "claude-opus-5-5", "cells.l1.json"], ["smoke-sol", "gpt-6.1-sol", "cells.hm-sol-s4.json"], ["smoke-p1", "particle-1", "cells.hm-p1.json"]]);
    expect(s.sessions).toBe(24);
  });
  test("each recorded cap is the cap formula's", () => {
    for (const i of ITEM_NAMES) expect(capOf(i, itemPlan(i, draw.run).parts).cap).toBe(CAPS_USD[i]);
  });
  test("the smoke's host ships OpenRouter's key beside Anthropic's, and a main item's ships none", () => {
    const plan = (i: (typeof ITEM_NAMES)[number]) => ({ item: i, model: B1_PROFILE.items[i]!.model, parts: itemPlan(i, draw.run).parts }) as unknown as Plan;
    expect(B1_PROFILE.proxyKeys!(plan("b1-smoke"))).toEqual(["OPENROUTER_API_KEY"]);
    for (const i of ["b1-opus", "b1-sol", "b1-p1"] as const) expect(B1_PROFILE.proxyKeys!(plan(i))).toEqual([]);
  });
  test("every typed arm opens with /prove-it, every arm ends with the closing line, and no arm runs gstack-checks", () => {
    for (const a of ARM_NAMES) {
      expect(ARMS[a].spec.includes(":told=prove-it")).toBe(ARMS[a].typed);
      expect(ARMS[a].spec.endsWith(":closing_line=" + CLOSING.key)).toBe(true);
      expect(ARMS[a].spec.includes("checks_trust")).toBe(false);
    }
  });
});

describe("arms", () => {
  test("the step text is the same bytes in every treated arm, and the last bytes of each", () => {
    const w = wrappers();
    expect([w.steps_bytes, w.steps_sha256]).toEqual([203, "47bfc31f877aef8938dfabc4984a759eaaa1f8f7588a408c542199bde6e34557"]);
    expect(Object.values(w.arms).map((a) => [a.bytes, a.before, a.after])).toEqual([[819, 616, 0], [9343, 9140, 0], [353, 150, 0]]);
  });
  test("the tars rebuild byte for byte against the committed manifests", () => {
    const r = check();
    expect(r.lines.filter((l) => l.startsWith("PROBLEM"))).toEqual([]);
    expect(r.pass).toBe(true);
  });
});

describe("money", () => {
  const d = () => mkdtempSync(join(tmpdir(), "b1-money-"));
  test("approve writes only the recorded cap, once", () => {
    const f = join(d(), "b1-opus.jsonl");
    expect(() => approve(f, "b1-opus", 171, "test")).toThrow(/recorded cap is \$170/);
    approve(f, "b1-opus", 170, "test");
    expect(readRows(f)[0]).toMatchObject({ kind: "approval", item: "b1-opus", usd_micros: toMicros(170) });
    expect(() => approve(f, "b1-opus", 170, "test")).toThrow(/already holds rows/);
  });
  test("the guard passes a fresh item and refuses one whose all-in passes the stop or which is done", () => {
    const opus = itemPlan("b1-opus", draw.run).parts;
    expect(launchGuard("b1-opus", {}, { "b1-opus": { parts: opus, finished: [] } }, { as_of: "t", usd: 50 }).ok).toBe(true);
    const far = launchGuard("b1-opus", {}, { "b1-opus": { parts: opus, finished: [] } }, { as_of: "t", usd: 600 });
    expect([far.ok, far.why.some((w) => w.includes("passes the $930.00 stop"))]).toEqual([false, true]);
    const f = join(d(), "b1-opus.jsonl");
    approve(f, "b1-opus", 170, "test");
    appendRow(f, { ts: "t", item: "b1-opus", kind: "note", id: "done", usd_micros: 0 });
    expect(launchGuard("b1-opus", { "b1-opus": readRows(f) }, {}, { as_of: "t", usd: 0 }).why[0]).toMatch(/marked done/);
  });
  test("done refuses while a reservation is open and refuses a second done", () => {
    const f = join(d(), "b1-opus.jsonl");
    approve(f, "b1-opus", 170, "test");
    appendRow(f, { ts: "t", item: "b1-opus", kind: "reserve", id: "s1", usd_micros: toMicros(5) });
    expect(() => markDone(f, "b1-opus")).toThrow(/open reservations/);
    appendRow(f, { ts: "t", item: "b1-opus", kind: "settle", id: "s1", usd_micros: toMicros(3) });
    markDone(f, "b1-opus");
    expect(() => markDone(f, "b1-opus")).toThrow(/marked done already/);
  });
  test("the guard refuses an item whose spend plus its parts left passes its own cap, and passes it once no part is left", () => {
    const f = join(d(), "b1-opus.jsonl"), opus = itemPlan("b1-opus", draw.run).parts;
    approve(f, "b1-opus", 170, "test");
    appendRow(f, { ts: "t", item: "b1-opus", kind: "reserve", id: "s1", usd_micros: toMicros(160) });
    appendRow(f, { ts: "t", item: "b1-opus", kind: "settle", id: "s1", usd_micros: toMicros(160) });
    const over = launchGuard("b1-opus", { "b1-opus": readRows(f) }, { "b1-opus": { parts: opus, finished: [] } }, { as_of: "t", usd: 0 });
    expect([over.ok, over.why.some((w) => w.includes("passes its cap $170.00"))]).toEqual([false, true]);
    expect(launchGuard("b1-opus", { "b1-opus": readRows(f) }, { "b1-opus": { parts: opus, finished: opus.map((p) => p.name) } }, { as_of: "t", usd: 0 }).ok).toBe(true);
  });
  test("a relaunch is projected before it starts: with $150 settled, relaunching the last part projects $216.40 and refuses", () => {
    const f = join(d(), "b1-opus.jsonl"), work = d(), opus = itemPlan("b1-opus", draw.run).parts, last = opus.at(-1)!.name;
    approve(f, "b1-opus", 170, "test");
    appendRow(f, { ts: "t", item: "b1-opus", kind: "reserve", id: "s1", usd_micros: toMicros(150) });
    appendRow(f, { ts: "t", item: "b1-opus", kind: "settle", id: "s1", usd_micros: toMicros(150) });
    for (const p of opus) writeFileSync(join(work, p.name + ".result.json"), "{}");
    const g = (parts: ReturnType<typeof guardParts>) => launchGuard("b1-opus", { "b1-opus": readRows(f) }, { "b1-opus": parts }, { as_of: "t", usd: 0 });
    const done = g(guardParts(work, opus)), relaunch = g(guardParts(work, opus, last));
    expect([done.ok, relaunch.ok, relaunch.why.some((w) => w.includes("$216.40"))]).toEqual([true, false, true]);
    mkdirSync(join(work, last + "-relaunch"));
    writeFileSync(join(work, last + "-relaunch", "l1-part.json"), JSON.stringify({ ...opus.at(-1)!, name: last + "-relaunch", relaunch_of: last }));
    expect(g(guardParts(work, opus)).ok).toBe(false);
    writeFileSync(join(work, last + "-relaunch.result.json"), "{}");
    expect(g(guardParts(work, opus)).ok).toBe(true);
  });
});

describe("table", () => {
  const job = mkdtempSync(join(tmpdir(), "b1-table-"));
  let n = 0;
  const trial = (o: { arm?: string; reward: number | null; ok?: number; exc?: string; transcript?: string[] }) => {
    const name = "t1__" + ++n, dir = join(job, name);
    mkdirSync(join(dir, "evaluator", "claude-projects", "-testbed"), { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: o.arm ?? "command", upstream_model: "claude-opus-5-5" } }, task: { path: "tasks/t1" } }));
    writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, ...(o.reward === null ? {} : { verifier_result: { rewards: { reward: o.reward } } }), ...(o.exc ? { exception_info: { exception_type: o.exc } } : {}) }));
    writeFileSync(join(dir, "evaluator", "sdk-messages.jsonl"), "");
    writeFileSync(join(dir, "evaluator", "claude-projects", "-testbed", "s.jsonl"), (o.transcript ?? []).join("\n") + "\n");
    return () => b1Row(dir, { part: "b1-1", sessions: new Map([[name, [{ ok_responses: o.ok ?? 3, refused_budget: 0, spent_micros: 250_000 } as any]]]), home: "/root" });
  };
  test("graded, infra and cap stop as the harness mechanics eval reads them; only infra reruns", () => {
    const g = trial({ reward: 1 })()!, z = trial({ reward: null })()!, q = trial({ reward: 0, ok: 0 })()!, c = trial({ reward: null, exc: "LedgerCapStop" })()!;
    expect([g.outcome, g.pass, g.cost_usd, needsRerun(g)]).toEqual(["graded", true, 0.25, false]);
    expect([z.outcome, needsRerun(z)]).toEqual(["infra", true]);
    expect([q.outcome, q.reason, needsRerun(q)]).toEqual(["infra", "no model response reached the agent", true]);
    expect([c.outcome, needsRerun(c)]).toEqual(["cap_stop", false]);
  });
  test("an arm outside B1 is refused", () => {
    expect(trial({ arm: "verify-prose", reward: 1 })).toThrow(/not one of none, described, gstack-shaped, command/);
  });
  test("steps seen and safety stops read from the transcript", () => {
    const steps = readFileSync(join(REPO, "lanes/delivery-route/arms/steps.md"), "utf8");
    expect(stepsSeen(JSON.stringify({ type: "user", message: { content: [{ type: "text", text: steps + "\n\nARGUMENTS: x" }] } }))).toBe(true);
    expect(stepsSeen(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: steps }] } }))).toBe(false);
    expect(safetyStop(JSON.stringify({ type: "assistant", message: { stop_reason: "refusal", content: [] } }))).toBe(true);
    expect(safetyStop(JSON.stringify({ type: "assistant", isApiErrorMessage: true, message: { content: [{ type: "text", text: "API Error: 400 content_filter" }] } }))).toBe(true);
    expect(safetyStop(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "the content filter module" }] } }))).toBe(false);
  });
});

describe("cli", () => {
  test("plan prints 720 counted sessions and every cap at its formula", () => {
    const r = run(["plan"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("counted sessions 720 (60 tasks x 4 arms x 3 models), caps sum $560, all-in stop $930");
  });
  test("prepare writes plan.json and b1.json for b1-opus from the frozen draw, keylessly, through L1's prepare", () => {
    const d = mkdtempSync(join(tmpdir(), "b1-prep-"));
    const ledger = join(d, "b1-opus.jsonl");
    appendRow(ledger, { ts: "t", item: "b1-opus", kind: "approval", id: "approval", usd_micros: toMicros(170) } as any);
    const fake = join(d, "fake-prepare-run.ts");
    writeFileSync(fake, [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'const [dir, job, model, arms] = Bun.argv.slice(2);',
      'const tasks = process.env.TASKS!.split(",");',
      'for (const t of tasks) { mkdirSync(dir + "/tasks/" + t, { recursive: true }); writeFileSync(dir + "/tasks/" + t + "/instruction.md", "fix it\\n"); }',
      'writeFileSync(dir + "/job.json", JSON.stringify({ job_name: job, tasks: tasks.map((t) => ({ path: "/run/tasks/" + t })), agents: arms.split(",").map((a) => ({ kwargs: { arm: a.split(":")[0] } })) }));',
      'writeFileSync(dir + "/args.json", JSON.stringify({ model, arms, cells: process.env.CELLS, manifests: process.env.ARM_MANIFESTS, setup: process.env.TASK_SETUP_SHA256 }));',
    ].join("\n"));
    const work = join(d, "work");
    const r = run(["prepare", work, "--item", "b1-opus"], { LEDGER: ledger, ARMS: d, L1_PREPARE_RUN: fake });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
    expect(plan).toMatchObject({ item: "b1-opus", cap_usd: 170, model: "claude-opus-5-5", cells: "cells.l1.json", seed: 2104467713, concurrent: 6 });
    expect(plan.parts.map((p: any) => p.name)).toEqual(["b1-1", "b1-2", "b1-3"]);
    expect(plan.inputs["tasks.txt"]).toBe(loadBundle().digests.get("tasks.txt"));
    const args = JSON.parse(readFileSync(join(work, "b1-1", "args.json"), "utf8"));
    expect(args).toMatchObject({ model: "claude-opus-5-5", cells: "cells.l1.json", manifests: "arms/manifests/b1", setup: "f8d45b73aab99354418a2a0a1d6c23e519582ed41fabe99fcca0970704feda7d" });
    expect(args.arms.split(",").map((a: string) => a.split(":")[0]).sort()).toEqual([...ARM_NAMES].sort());
    expect(JSON.parse(readFileSync(join(work, "b1.json"), "utf8"))).toMatchObject({ item: "b1-opus", sessions: 240 });
  });
});
