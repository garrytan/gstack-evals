// Copyright (c) 2026 Garry Tan. MIT License.
// #292 review E1: the score pairs only planned tasks. A trials root that holds a session on a task outside planned.json
// (a parent results directory, say) refuses the score with E_USAGE naming the off-plan tasks, instead of pairing them.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/decision-routing/score/cli.ts";

const FIX = join(import.meta.dir, "fixtures", "review-fixes");
const PRICES = join(import.meta.dir, "../../lanes/decision-routing/config/prices.json");
const JOURNAL = join(FIX, "journal.R-opus-alpha-1.ndjson");
const tmp = mkdtempSync(join(tmpdir(), "dr-offplan-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function trial(root: string, name: string, task: string): void {
  const t = join(root, "trials", name), dr = join(t, "agent", "dr");
  mkdirSync(dr, { recursive: true });
  mkdirSync(join(t, "verifier"));
  writeFileSync(join(t, "result.json"), JSON.stringify({ task_name: task, trial_name: name }) + "\n");
  writeFileSync(join(t, "verifier", "reward.txt"), "1\n");
  writeFileSync(join(dr, "dr-summary.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(FIX, "dr-summary.R-opus-alpha-1.json"), "utf8")), session: name }));
  cpSync(join(FIX, "meter.R-opus-alpha-1.json"), join(dr, "meter.json"));
}

async function score(name: string, trials: Array<[string, string]>): Promise<{ code: number; out: string; err: string }> {
  const root = join(tmp, name);
  for (const [n, task] of trials) trial(root, n, task);
  writeFileSync(join(root, "planned.json"), JSON.stringify({ tasks: ["dryrun__alpha-1"] }));
  writeFileSync(join(root, "admission.json"), JSON.stringify({ contrasts: {} }));
  const out: string[] = [], err: string[] = [];
  const log = console.log, error = console.error;
  console.log = (m: string) => out.push(m);
  console.error = (m: string) => err.push(m);
  try {
    const code = await main(["--trials", join(root, "trials"), "--journal", JOURNAL, "--prices", PRICES, "--planned", join(root, "planned.json"), "--admission", join(root, "admission.json")]);
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally { console.log = log; console.error = error; }
}

describe("score refuses sessions on tasks outside planned.json", () => {
  test("planned sessions plus one off-plan session: exit 2, E_USAGE naming the off-plan task only", async () => {
    const r = await score("mixed", [["R-opus-alpha-1", "dryrun__alpha-1"], ["R-opus-zeta-9", "dryrun__zeta-9"]]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toStartWith("E_USAGE");
    expect(r.err).toContain("dryrun__zeta-9");
    expect(r.err).not.toContain("dryrun__alpha-1");
  });
  test("planned sessions only: scores as before", async () => {
    const r = await score("planned", [["R-opus-alpha-1", "dryrun__alpha-1"]]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out.split("\n")[0]).toContain("1 sessions, 0 missing");
  });
});
