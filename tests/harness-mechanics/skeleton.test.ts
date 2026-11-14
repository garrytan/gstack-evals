// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics skeleton, keyless: the bundle at its digests, the caps, the plans' session counts, the arm specs,
// the seeded arm order, the closing line in grid.ts and prompt_builder.py, prepare on fixture inputs, and the dry run.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRow, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { armSpec, CLOSING_LINES } from "../../quick/laneb/runner/grid.ts";
import { plannedCells, seeded } from "../../quick/laneb/l1/l1.ts";
import { ARMS, BUNDLE, bundleLists, CAPS_USD, capsTotalUsd, CLOSING, ledgerCapsUsd, frontMatterDigests, HM, loadBundle, MODELS, readScreened, REPO, sha256, STAGE4_SOL, unscreenedText } from "../../lanes/harness-mechanics/pins.ts";
import { itemPlan, ITEMS } from "../../lanes/harness-mechanics/plans.ts";
import { STEPS } from "../../lanes/harness-mechanics/dryrun.ts";
import { approve, markDone, plannedLine, type Item } from "../../lanes/harness-mechanics/money.ts";
import { Ledger, readRows } from "../../quick/laneb/runner/ledger.ts";

const CLI = join(REPO, "lanes/harness-mechanics/cli.ts");
const lists = bundleLists();
const run = (args: string[], env: Record<string, string> = {}) => Bun.spawnSync([process.execPath, CLI, ...args], { env: { ...process.env, ...env }, cwd: REPO });
// Item ledgers holding the settled spend of every item before Stage 4, as their ledgers read after D15, each with its done
// row unless named in open.
const SETTLED: [Item, number][] = [
  ["stage1-opus", 28.60473], ["stage1-opus-r2", 33.006068], ["stage1-sol", 0.03853], ["stage1-sol-run", 76.280659], ["stage1-p1", 35.314094],
  ["stage2-replay", 1.911582], ["stage2-replay-2", 9.058483], ["stage2-replay-3", 13.818316],
  ["stage3-pilot", 0.612939], ["stage3-pilot-2", 11.98629], ["stage3-pilot-3", 26.910177], ["stage3-pilot-4", 26.887274], ["vms", 7.503203],
];
function pilotLedgers(open: Item[] = []) {
  const d = mkdtempSync(join(tmpdir(), "hm-ledgers-"));
  for (const [i, usd] of SETTLED) {
    const path = join(d, i + ".jsonl");
    approve(path, i, CAPS_USD[i], "the Captain");
    const l = new Ledger(path, i);
    l.reserve(i + "/p/s", toMicros(usd)); l.settle(i + "/p/s", toMicros(usd));
    if (!open.includes(i)) markDone(path, i);
  }
  return d;
}
const readLedgers = (d: string) => Object.fromEntries(SETTLED.map(([i]) => [i, readRows(join(d, i + ".jsonl"))]));

describe("pins", () => {
  test("every attachment loads at its front-matter sha256, and a changed byte is refused", () => {
    const b = loadBundle();
    expect(b.digests.size).toBe(11);
    expect(b.digests.get("scored.txt")).toBe("6fd25fe96cacf7ddd64696dd67ba088d618427bc7e8006f1061c5c1c63b99306");
    const fake = mkdtempSync(join(tmpdir(), "hm-bundle-"));
    mkdirSync(join(fake, BUNDLE), { recursive: true });
    for (const f of ["README.md", ...b.digests.keys()]) writeFileSync(join(fake, BUNDLE, f), readFileSync(join(REPO, BUNDLE, f)));
    expect(() => loadBundle(fake)).not.toThrow();
    writeFileSync(join(fake, BUNDLE, "spare.txt"), readFileSync(join(REPO, BUNDLE, "spare.txt"), "utf8") + "x\n");
    expect(() => loadBundle(fake)).toThrow("E_HM_INPUT " + BUNDLE + "/spare.txt hashes to");
    expect(() => frontMatterDigests("no front matter")).toThrow("E_HM_INPUT");
  });

  test("the lists keep their shuffled order, and the judge lists are the first tasks of their splits", () => {
    expect([lists.scored.length, lists.calibration.length, lists.spare.length, lists.judgeSubset.length, lists.judgePilot.length]).toEqual([200, 40, 96, 60, 12]);
    expect(lists.scored.slice(0, 2)).toEqual(["hdmf-dev__hdmf-1374", "getmoto__moto-9350"]);
    expect(lists.judgeSubset).toEqual(lists.scored.slice(0, 60));
    expect(lists.judgePilot).toEqual(lists.calibration.slice(0, 12));
  });

  test("the caps sum to 3,544.387061 with D15's Stage 4 caps and crew cap (3,074.387061 before it), the planned line counts every item before Stage 4 at its settled and fits under 3,000, and each model's allowance is section 22's or its deviation's", () => {
    expect(ledgerCapsUsd()).toBe(2494.387061);
    expect(capsTotalUsd()).toBe(3544.387061);
    const p = plannedLine(readLedgers(pilotLedgers()));
    expect(p.items.filter((i) => i.done).map((i) => [i.item, i.counted])).toEqual(SETTLED.map(([i, usd]) => [i, toMicros(usd)]));
    expect(p.total).toBe(toMicros(2881.932345));
    expect(p.total).toBeLessThan(toMicros(HM.lineUsd));
    expect(p.fits).toBe(true);
    expect([MODELS.opus.allowanceUsd, MODELS.sol.allowanceUsd, MODELS.p1.allowanceUsd]).toEqual([5, 6, 2]);
    for (const m of [...Object.values(MODELS), { ...MODELS.sol, ...STAGE4_SOL }]) {
      const c = JSON.parse(readFileSync(join(REPO, "quick/laneb/config", m.cells), "utf8"));
      expect(c.models).toEqual([expect.objectContaining({ id: m.id, session_cap_usd: m.allowanceUsd })]);
      expect(c.sdk_max_turns).toBe(HM.turns);
    }
    expect([ITEMS["stage4-sol"]!.cells, ITEMS["stage4-sol"]!.allowanceUsd]).toEqual(["cells.hm-sol-s4.json", 10]);
    expect([ITEMS["stage3-pilot-4"]!.allowanceUsd, ITEMS["stage1-sol-run"]!.allowanceUsd, ITEMS["stage4-opus"]!.allowanceUsd]).toEqual([5, 6, 5]);
    const read = (f: string) => { const c = JSON.parse(readFileSync(join(REPO, "quick/laneb/config", f), "utf8")); delete c.note; c.models[0].session_cap_usd = 0; return c; };
    expect(read(STAGE4_SOL.cells)).toEqual(read(MODELS.sol.cells));
  });

  test("an open item counts at its cap in the planned line: stage3-pilot-3 before its done row, and stage4-sol with no ledger", () => {
    const counted = (open: Item[]) => Object.fromEntries(plannedLine(readLedgers(pilotLedgers(open))).items.map((i) => [i.item, i.counted]));
    expect(counted(["stage3-pilot-3"])["stage3-pilot-3"]).toBe(toMicros(94.387061));
    expect(counted([])["stage3-pilot-3"]).toBe(toMicros(26.910177));
    expect(counted([])["stage4-sol"]).toBe(toMicros(690));
    expect(plannedLine(readLedgers(pilotLedgers(["stage3-pilot-3"]))).total).toBe(toMicros(2949.409229));
    const none = plannedLine({});
    expect([none.total, none.fits]).toEqual([toMicros(3544.387061), false]);
  });

  test("the screened lists are checked by sha256 and must come from their split or the spares", () => {
    const text = unscreenedText(lists);
    expect(readScreened(text, sha256(text), lists).scored).toEqual(lists.scored);
    expect(() => readScreened(text, "0".repeat(64), lists)).toThrow("E_HM_INPUT the screened lists hash to");
    const swapped = text.replace("scored " + lists.scored[0], "scored " + lists.spare[0]);
    expect(readScreened(swapped, sha256(swapped), lists).scored[0]).toBe(lists.spare[0]);
    const bad = text.replace("scored " + lists.scored[0], "scored " + lists.calibration[0]);
    expect(() => readScreened(bad, sha256(bad), lists)).toThrow("E_HM_INPUT");
  });
});

describe("plans", () => {
  const plan = (i: string) => itemPlan(i, lists);
  test("Stage 1: 160 sessions and 40 picker calls per model, 480 and 120 in all, in parts of 20 tasks", () => {
    const s1 = ["stage1-opus", "stage1-sol", "stage1-p1"].map(plan);
    for (const p of s1) {
      expect([p.sessions, p.picker_calls]).toEqual([160, 40]);
      expect(p.parts.map((x) => [x.name, [...plannedCells(x).values()].length])).toEqual([["s1-1", 80], ["s1-2", 80]]);
    }
    expect(s1.reduce((a, p) => a + p.sessions, 0)).toBe(480);
    expect(s1.reduce((a, p) => a + p.picker_calls, 0)).toBe(120);
  });

  test("Stage 3: the smoke part's 2 sessions on calibration task 13, then 72 pilot sessions, one part per model on the 12 pilot tasks and the two judge arms", () => {
    const p = plan("stage3-pilot");
    expect([p.sessions, p.picker_calls]).toEqual([74, 0]);
    expect(p.parts.map((x) => [x.name, x.model, x.cells, x.prefix])).toEqual([["smoke-opus", "claude-opus-5-5", "cells.l1.json", "stage3-pilot/smoke-opus/"], ["pilot-opus", "claude-opus-5-5", "cells.l1.json", "stage3-pilot/pilot-opus/"], ["pilot-sol", "gpt-6.1-sol", "cells.hm-sol.json", "stage3-pilot/pilot-sol/"], ["pilot-p1", "particle-1", "cells.hm-p1.json", "stage3-pilot/pilot-p1/"]]);
    const [smoke, ...pilots] = p.parts;
    expect(smoke!.rects).toEqual([{ tasks: [lists.calibration[12]!], arms: expect.arrayContaining(["judge-jev", "judge-p1"]), attempts: 1 }]);
    expect(lists.judgePilot).not.toContain(lists.calibration[12]);
    expect([...plannedCells(smoke!).values()].reduce((a, b) => a + b, 0)).toBe(2);
    for (const x of pilots) expect(new Set(x.rects.flatMap((r) => r.tasks))).toEqual(new Set(lists.judgePilot));
    const bad = { ...lists, calibration: [...lists.calibration.slice(0, 12), lists.calibration[0]!, ...lists.calibration.slice(13)] };
    expect(() => itemPlan("stage3-pilot", bad)).toThrow("E_HM_INPUT stage3-pilot's smoke task must be calibration task 13");
  });

  test("stage3-pilot-2 (D11) has stage3-pilot's plan under its own ledger prefix: the same parts, tasks and arms", () => {
    const a = plan("stage3-pilot"), b = plan("stage3-pilot-2");
    expect([b.sessions, b.picker_calls]).toEqual([74, 0]);
    expect(b.parts.map((x) => [x.name, x.model, x.cells, x.rects])).toEqual(a.parts.map((x) => [x.name, x.model, x.cells, x.rects]));
    expect(b.parts.map((x) => x.prefix)).toEqual(["stage3-pilot-2/smoke-opus/", "stage3-pilot-2/pilot-opus/", "stage3-pilot-2/pilot-sol/", "stage3-pilot-2/pilot-p1/"]);
  });

  test("stage3-pilot-3 (D12) has stage3-pilot's plan under its own ledger prefix: the smoke part first, then all three pilot parts", () => {
    const a = plan("stage3-pilot"), c = plan("stage3-pilot-3");
    expect([c.sessions, c.picker_calls]).toEqual([74, 0]);
    expect(c.parts.map((x) => [x.name, x.model, x.cells, x.rects])).toEqual(a.parts.map((x) => [x.name, x.model, x.cells, x.rects]));
    expect(c.parts.map((x) => x.prefix)).toEqual(["stage3-pilot-3/smoke-opus/", "stage3-pilot-3/pilot-opus/", "stage3-pilot-3/pilot-sol/", "stage3-pilot-3/pilot-p1/"]);
  });

  test("stage3-pilot-4 (D14) has stage3-pilot's plan under its own ledger prefix: the smoke part first, then all three pilot parts", () => {
    const a = plan("stage3-pilot"), d = plan("stage3-pilot-4");
    expect([d.sessions, d.picker_calls]).toEqual([74, 0]);
    expect(d.parts.map((x) => [x.name, x.model, x.cells, x.rects])).toEqual(a.parts.map((x) => [x.name, x.model, x.cells, x.rects]));
    expect(d.parts.map((x) => x.prefix)).toEqual(["stage3-pilot-4/smoke-opus/", "stage3-pilot-4/pilot-opus/", "stage3-pilot-4/pilot-sol/", "stage3-pilot-4/pilot-p1/"]);
  });

  test("Stage 4: 920 sessions and 200 picker calls per model, 2,760 in all; the judge arms only on the first 60 scored tasks", () => {
    const s4 = ["stage4-opus", "stage4-sol", "stage4-p1"].map(plan);
    for (const p of s4) {
      expect([p.sessions, p.picker_calls, p.parts.length]).toEqual([920, 200, 10]);
      const judged = new Set(p.parts.flatMap((x) => x.rects.filter((r) => r.arms.includes("judge-jev")).flatMap((r) => r.tasks)));
      expect(judged).toEqual(new Set(lists.judgeSubset));
      expect(Math.max(...p.parts.map((x) => [...plannedCells(x).values()].length))).toBe(120);
    }
    expect(s4.reduce((a, p) => a + p.sessions, 0)).toBe(2760);
  });

  test("every task's arms sit in one part, in the order L1's seeded() gives at seed 20261148, the same on every call", () => {
    for (const i of Object.keys(ITEMS)) {
      const a = itemPlan(i, lists), b = itemPlan(i, lists);
      expect(a).toEqual(b);
      const where = new Map<string, string>();
      for (const x of a.parts) for (const r of x.rects) for (const t of r.tasks) {
        const k = (x.model ?? "") + t;
        expect(where.get(k) ?? x.name).toBe(x.name);
        where.set(k, x.name);
      }
    }
    const p = itemPlan("stage1-opus", lists).parts[0]!;
    expect(p.rects).toEqual(seeded([{ tasks: lists.calibration.slice(0, 20), arms: ["none", "plain-2", "verify-prose", "verify-hook"], attempts: 1 }], 20261148));
  });
});

describe("arms and the closing line", () => {
  test("the six arm specs parse, end on hm-status and claude-code-preset, and the gstack arms are told verify", () => {
    for (const [name, a] of Object.entries(ARMS)) {
      const s = armSpec(a.spec);
      expect(s).toMatchObject({ name, system_prompt: "claude-code-preset", gstack_hooks: "copy", closing_line: "hm-status" });
      expect(s.tar_name ?? s.name).toBe(a.tar);
      expect(s.told).toBe(name === "none" || name === "plain-2" ? undefined : "verify");
    }
  });

  test("hm-status is one text in pins.ts, grid.ts and prompt_builder.py, byte for byte", () => {
    const py = Bun.spawnSync(["python3", "-c", "import json, prompt_builder as p; print(json.dumps(p.CLOSING_LINES))"], { env: { ...process.env, PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
    expect(py.exitCode).toBe(0);
    const fromPy = JSON.parse(py.stdout.toString());
    expect(Buffer.from(fromPy[CLOSING.key]).equals(Buffer.from(CLOSING.text))).toBe(true);
    expect(Buffer.from((CLOSING_LINES as Record<string, string>)[CLOSING.key]!).equals(Buffer.from(CLOSING.text))).toBe(true);
    expect(CLOSING.text).toBe("When you finish, end your final message with one line: STATUS: FIXED or STATUS: NOT FIXED.");
  });
});

describe("cli", () => {
  test("prepare writes plan.json and hm.json for stage1-opus from fixture inputs, keylessly, through L1's prepare", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-prep-"));
    const ledger = join(d, "stage1-opus.jsonl");
    appendRow(ledger, { ts: "t", item: "stage1-opus", kind: "approval", id: "approval", usd_micros: toMicros(150) } as any);
    const screened = join(d, "screened.txt");
    writeFileSync(screened, unscreenedText(lists));
    const fake = join(d, "fake-prepare-run.ts");
    writeFileSync(fake, [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'const [dir, job, model, arms] = Bun.argv.slice(2);',
      'const tasks = process.env.TASKS!.split(",");',
      'for (const t of tasks) { mkdirSync(dir + "/tasks/" + t, { recursive: true }); writeFileSync(dir + "/tasks/" + t + "/instruction.md", "fix it\\n"); }',
      'writeFileSync(dir + "/job.json", JSON.stringify({ job_name: job, tasks: tasks.map((t) => ({ path: "/run/tasks/" + t })), agents: arms.split(",").map((a) => ({ kwargs: { arm: a.split(":")[0] } })) }));',
      'writeFileSync(dir + "/args.json", JSON.stringify({ model, arms, cells: process.env.CELLS, manifests: process.env.ARM_MANIFESTS }));',
    ].join("\n"));
    const work = join(d, "work");
    const r = run(["prepare", work, "--item", "stage1-opus"], { LEDGER: ledger, ARMS: d, L1_PREPARE_RUN: fake, HM_SCREENED: screened, HM_SCREENED_SHA256: sha256(readFileSync(screened)) });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
    expect(plan).toMatchObject({ item: "stage1-opus", cap_usd: 150, model: "claude-opus-5-5", cells: "cells.l1.json", seed: 20261148, concurrent: 6, host_ttl_hours: 78 });
    expect(plan.parts.map((p: any) => p.name)).toEqual(["s1-1", "s1-2"]);
    expect(plan.inputs["scored.txt"]).toBe(loadBundle().digests.get("scored.txt"));
    expect(plan.inputs.screened).toBe(sha256(readFileSync(screened)));
    const args = JSON.parse(readFileSync(join(work, "s1-1", "args.json"), "utf8"));
    expect(args).toMatchObject({ model: "claude-opus-5-5", cells: "cells.l1.json", manifests: "arms/manifests/hm" });
    expect(args.arms.split(",").every((a: string) => a.endsWith(":closing_line=hm-status"))).toBe(true);
    expect(JSON.parse(readFileSync(join(work, "hm.json"), "utf8"))).toMatchObject({ item: "stage1-opus", sessions: 160, picker_calls: 40 });
    const again = run(["prepare", join(d, "w2"), "--item", "stage1-opus"], { LEDGER: ledger, ARMS: d, L1_PREPARE_RUN: fake, HM_SCREENED: screened, HM_SCREENED_SHA256: "0".repeat(64) });
    expect(again.exitCode).toBe(2);
    expect(again.stderr.toString()).toStartWith("E_HM_INPUT");
  });

  test("dryrun prints every step name, passes the skeleton, fails the steps not built and fails closed without Docker", () => {
    const out = mkdtempSync(join(tmpdir(), "hm-dry-"));
    const bin = mkdtempSync(join(tmpdir(), "hm-nodocker-"));
    writeFileSync(join(bin, "docker"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const r = run(["dryrun", "--out", out], { HM_GSTACK: "", HM_LEDGERS: pilotLedgers(), PATH: bin + ":" + process.env.PATH });
    const lines = r.stdout.toString().trim().split("\n");
    expect(lines.map((l) => l.split(" ")[1])).toEqual([...STEPS.map((s) => s.name), "FAIL"]);
    for (const n of ["1-arm-tars", "2-verify-hook"]) expect(lines.some((l) => l.startsWith("DRYRUN " + n + " FAIL "))).toBe(true);
    expect(lines.some((l) => l.startsWith("DRYRUN 7-leak-scan-env PASS ") && l.includes("canary body 403 DR_CUSTODY_HIT"))).toBe(true);
    for (const n of ["1-arm-tars", "2-verify-hook"]) expect(lines.find((l) => l.startsWith("DRYRUN " + n + " FAIL "))).toMatch(/Docker/);
    expect(lines.find((l) => l.startsWith("DRYRUN 5-judgment-hooks FAIL "))).toMatch(/container did not start/);
    for (const n of ["6-ledger", "leases-per-item", "reserve-mechanics"]) expect(lines.some((l) => l.startsWith("DRYRUN " + n + " PASS "))).toBe(true);
    for (const n of ["3-matcher-probes", "stop-hook-loadline", "matcher-72", "probes-189"]) expect(lines.some((l) => l.startsWith("DRYRUN " + n + " FAIL E_HM_PIN set HM_GSTACK"))).toBe(true);
    expect(lines[0]).toStartWith("DRYRUN skeleton PASS");
    expect(lines[0]).toContain("planned 2881.932345 under the 3000 line");
    expect(lines[0]).toContain("stage1-sol 160, stage1-sol-run 160, stage1-p1 160");
    expect(lines.at(-1)).toBe("DRYRUN: FAIL");
    expect(r.exitCode).toBe(1);
    expect(readFileSync(join(out, "dryrun.txt"), "utf8").trim().split("\n")).toEqual(lines);
    for (const n of ["8-analysis", "verdict-tables", "h1-amendment"]) expect(lines.some((l) => l.startsWith("DRYRUN " + n + " PASS "))).toBe(true);
  }, 300_000);

  test("the skeleton step reads HM_LEDGERS and fails when the planned line passes 3,000", () => {
    const step = STEPS.find((s) => s.name === "skeleton")!, was = process.env.HM_LEDGERS;
    try {
      delete process.env.HM_LEDGERS;
      expect(step.run!("")).toEqual({ pass: false, detail: "planned 3544.387061 is over the 3000 line; set HM_LEDGERS to the folder of item ledgers (<item>.jsonl)" });
      process.env.HM_LEDGERS = pilotLedgers(["stage3-pilot-3"]);
      const r = step.run!("");
      expect(r.pass).toBe(true);
      expect(r.detail).toContain("planned 2949.409229 under the 3000 line");
    } finally {
      if (was === undefined) delete process.env.HM_LEDGERS; else process.env.HM_LEDGERS = was;
    }
  });

  test("report needs a table, a config and an out dir", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-rep-"));
    writeFileSync(join(d, "t.jsonl"), "");
    const r = run(["report", join(d, "t.jsonl"), "--stage", "stage1", "--out", d]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toStartWith("E_USAGE");
  });
});
