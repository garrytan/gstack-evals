// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the run command's refusals before anything is built or spent: units or out inside the repo, a receipts sink missing, existing or inside the repo, a gstack other than the pin, any upstream override, a model, arm, cell or repair the prereg does not name, and an out dir that exists without --resume; fails_when=a launch with any of these gets past planning; why_new=the run area's cli; seam=planRun; no_claim=the rig's own install check of the gstack VERSION, which runs only on Docker
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GSTACK } from "../../../lanes/office-hours-founder/frozen.ts";
import { planRun } from "../../../lanes/office-hours-founder/run/cli.ts";

const root = mkdtempSync(join(tmpdir(), "of-cli-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const units = join(root, "units");
mkdirSync(units);
const env = { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: join(root, "receipts") };
const base = ["--cell", "smoke", "--units-dir", units, "--out", join(root, "out"), "--item", "of-smoke", "--spend-cap", "40", "--sim-item", "of-smoke-sim", "--sim-spend-cap", "5"];
const swap = (flag: string, value: string) => base.map((v, i) => (base[i - 1] === flag ? value : v));

describe("planRun", () => {
  test("a launch with every value in order plans", () => {
    const p = planRun([...base, "--gstack", GSTACK.repo + "@" + GSTACK.sha, "--models", "opus", "--parallel", "2"], env);
    expect(p.input).toMatchObject({ cell: "smoke", models: ["opus"], arms: ["none", "lens", "office-hours"], repairs: [], cap: 40_000_000, simCap: 5_000_000, parallel: 2 });
    expect(p.resume).toBe(false);
  });

  const refusals: [string, string[], Record<string, string | undefined>, RegExp][] = [
    ["a missing flag", base.slice(2), env, /needs --cell/],
    ["an unknown cell", swap("--cell", "stage3"), env, /--cell takes/],
    ["an upstream override", [...base, "--upstream", "http://127.0.0.1:1"], env, /--upstream/],
    ["units inside the repo", swap("--units-dir", join(import.meta.dir, "fixtures")), env, /inside the repo/],
    ["out inside the repo", swap("--out", join(import.meta.dir, "out")), env, /inside the repo/],
    ["out that exists without --resume", swap("--out", units), env, /pass --resume/],
    ["an unknown model", [...base, "--models", "haiku"], env, /not a model the prereg names/],
    ["an unknown arm", [...base, "--arms", "placebo"], env, /not an arm the prereg names/],
    ["an unknown repair", [...base, "--repairs", "limit-40"], env, /not a repair the prereg names/],
    ["a gstack other than the pin", [...base, "--gstack", GSTACK.repo + "@" + "0".repeat(40)], env, /the prereg pins/],
    ["no ephemeral sink", base, {}, /GSTACK_EVALS_EPHEMERAL=1/],
    ["an ephemeral launch with no sink", base, { GSTACK_EVALS_EPHEMERAL: "1" }, /GSTACK_EVALS_RECEIPTS/],
    ["a sink that already exists", base, { ...env, GSTACK_EVALS_RECEIPTS: units }, /already exists/],
    ["a sink inside the repo", base, { ...env, GSTACK_EVALS_RECEIPTS: join(import.meta.dir, "receipts") }, /inside the repo/],
    ["a zero cap", swap("--spend-cap", "0"), env, /positive number of dollars/],
  ];
  for (const [name, argv, e, why] of refusals) test("refuses " + name, () => expect(() => planRun(argv, e)).toThrow(why));

  test("--resume takes an out dir that exists", () => {
    expect(planRun([...swap("--out", units), "--resume"], env).resume).toBe(true);
  });
});
