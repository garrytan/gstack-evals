// Copyright (c) 2026 Garry Tan. MIT License.
// review-units --plan product-value: the dry run (both mounts asserted, each arm's prompt sha256) and the CLI's refusals.
// Keyless: a dry run builds nothing under --out and spends nothing.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { main } from "../../src/trial/review/cli.ts";
import { PV_GSTACK, pvPrompt } from "../../src/trial/review/product-value.ts";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const dir = () => {
  const d = mkdtempSync(join(homedir(), ".gstack-evals-pv-cli-test-"));
  roots.push(d);
  return d;
};
const units = (extra: (u: string) => void = () => {}) => {
  const d = dir();
  const u = join(d, "unit-a");
  mkdirSync(join(u, "context"), { recursive: true });
  writeFileSync(join(u, "unit.json"), JSON.stringify({ id: "unit-a" }));
  writeFileSync(join(u, "key.json"), "{}");
  writeFileSync(join(u, "plan.md"), "# Plan\n");
  writeFileSync(join(u, "brief.md"), "A brief.\n");
  writeFileSync(join(u, "context", "a.md"), "ctx\n");
  extra(u);
  return d;
};
const PIN = "=" + PV_GSTACK.repo + "@" + PV_GSTACK.sha;
const go = async (family: string, arms: string[], o: { unitsDir?: string; out?: string; extra?: string[] } = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const sink = join(dir(), "sink");
  const code = await main(["--plan", "product-value", "--family", family, "--units-dir", o.unitsDir ?? units(), "--units", "unit-a", "--arms", ...arms, "--models", "claude-opus-5-5", "--allowance", "4", "--out", o.out ?? join(dir(), "out"), ...(o.extra ?? []), "--dry-run"], { out: (t) => out.push(t), err: (t) => err.push(t) }, { ...process.env, GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: sink });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

describe("the product-value dry run", () => {
  test("asserts both mounts and prints each arm's prompt sha256, for each family", async () => {
    const plan = await go("plan", ["none", "lens", "plan-ceo-review" + PIN]);
    expect([plan.code, plan.err]).toEqual([0, ""]);
    expect(plan.out).toContain("mounts: ok; plan family sees plan.md and context/ only, brief family sees brief.md and context/ only, key.json and unit.json are never mounted");
    for (const arm of ["none", "lens", "plan-ceo-review"]) expect(plan.out).toContain("arm " + arm + " (");
    for (const arm of ["none", "lens", "plan-ceo-review"]) expect(plan.out).toContain("prompt sha256 " + sha256(pvPrompt("plan", arm, false)));
    const brief = await go("brief", ["none", "lens", "office-hours" + PIN]);
    expect([brief.code, brief.err]).toEqual([0, ""]);
    for (const arm of ["none", "lens", "office-hours"]) expect(brief.out).toContain("prompt sha256 " + sha256(pvPrompt("brief", arm, false)));
    const fallback = await go("plan", ["none"], { extra: ["--pv-fallback-sentence"] });
    expect(fallback.out).toContain("prompt sha256 " + sha256(pvPrompt("plan", "none", true)));
  });

  test("refuses the fallback sentence on the brief family, an arm from the other family, a bad mount and an out inside the repo", async () => {
    const cases = [
      await go("brief", ["none"], { extra: ["--pv-fallback-sentence"] }),
      await go("plan", ["office-hours" + PIN]),
      await go("plan", ["none"], { unitsDir: units((u) => symlinkSync("/etc/hostname", join(u, "context", "link.md"))) }),
      await go("plan", ["none"], { unitsDir: units((u) => removeTree(join(u, "context"))) }),
      await go("plan", ["none"], { out: join(REPO_ROOT, "pv-out") }),
    ];
    for (const c of cases) expect([c.code, c.err.split(/[: ]/)[0]]).toEqual([2, "E_USAGE"]);
    for (const c of cases) expect(c.err).toContain("fix: ");
    expect([cases[1]!.err.includes("office-hours"), cases[2]!.err.includes("symlink"), cases[3]!.err.includes("context/"), cases[4]!.err.includes("inside the repo")]).toEqual([true, true, true, true]);
  });
});
