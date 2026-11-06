// Copyright (c) 2026 Garry Tan. MIT License.
// The climb compare: a climb's readings hold only principle rows, so compare --base joins tbv-dev-base's none and current
// rows. Every guard on the join has a refusal twin. Synthetic records only.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Any, line, reading, RULE, task } from "./rule-helpers.ts";

const DIR = mkdtempSync(join(tmpdir(), "tbv-climb-test-"));
const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD)_API_KEY$/.test(k))) as Record<string, string>;
let n = 0;
const put = (data: unknown) => { const f = join(DIR, "f" + ++n + ".json"); writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };
function compare(climb: Any, split: string, base?: Any | string) {
  const args = [RULE, "compare", put(climb), "--split", put(split)];
  if (base !== undefined) args.push("--base", typeof base === "string" && base.startsWith("/") ? base : put(base));
  const r = spawnSync("bun", args, { encoding: "utf8", env: KEYLESS });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const TASKS = [...[...Array(12)].map((_, i) => task("a" + i, "A", ["long", "short", "other"][i % 3]!, 4)), ...[...Array(6)].map((_, i) => task("b" + i, "B", ["long", "short", "other"][i % 3]!, 4))];
const SPLIT = JSON.stringify({ schema: "tbv-split.v1", stage: "dev", tasks: TASKS, controlTaskIds: [] });
const SHA = createHash("sha256").update(SPLIT).digest("hex");
const plan = (models: string[], passes = 2, capyPasses = 2, skillArms = ["none", "current"]) => ({ models, passes: Object.fromEntries(models.map((m) => [m, passes])), capyPasses, skillArms, taskIds: TASKS.map((t) => t.id), controlTaskIds: [], manifestSha256: SHA });
const B = TASKS.filter((t) => t.source === "B");
/** tbv-dev-base's readings: none and current on Opus and Sol, capy current and lens on Opus, two passes; agree marks the double reads' agreement. */
function devBase(o: { agree?: boolean; extra?: Any[]; passes?: number; models?: string[] } = {}) {
  const models = o.models ?? ["opus", "sol"];
  const passes = o.passes ?? 2;
  const rows: Any[] = [];
  TASKS.forEach((t, i) => {
    for (const m of models) for (const arm of ["none", "current"]) for (let p = 1; p <= passes; p++) rows.push(reading(t, arm, m, p, arm === "none" ? 0.25 : 0.5, { second: i % 3 === 0 && p === 1 }));
    if (models.includes("opus")) for (let p = 1; p <= passes; p++) rows.push(reading(t, "lens", "opus", p, 0.5));
  });
  for (const t of B) if (models.includes("opus")) for (let p = 1; p <= passes; p++) rows.push(reading(t, "current", "opus", p, 0.5, { family: "capy", exposed: true }));
  if (o.agree === false) for (const r of rows) if (r.second) r.second.facts = r.facts.map((f: Any) => ({ in: !f.in, any: !f.any }));
  return { stage: "dev", tasks: TASKS, readings: [...rows, ...(o.extra ?? [])], plan: plan(models, passes, 2, ["none", "current", "lens"]) };
}
/** One climb round's readings: principle on Opus on every task and capy principle on the source B tasks, two passes. */
function climb(o: { agree?: boolean; extra?: Any[] } = {}) {
  const rows: Any[] = [];
  TASKS.forEach((t, i) => { for (let p = 1; p <= 2; p++) rows.push(reading(t, "principle", "opus", p, 0.75, { second: i % 3 === 1 && p === 1 })); });
  for (const t of B) for (let p = 1; p <= 2; p++) rows.push(reading(t, "principle", "opus", p, 0.75, { family: "capy", exposed: true }));
  if (o.agree === false) for (const r of rows) if (r.second) r.second.facts = r.facts.map((f: Any) => ({ in: !f.in, any: !f.any }));
  return { stage: "dev", tasks: TASKS, readings: [...rows, ...(o.extra ?? [])], plan: plan(["opus"], 2, 2, ["current", "principle"]) };
}

describe("compare --base: the climb's join with tbv-dev-base", () => {
  test("a climb compares principle with dev-base's none and current, per family, and names the base it joined", () => {
    const r = compare(climb(), SPLIT, devBase());
    expect(r.status).toBe(0);
    expect(line(r.out, /^skill layer opus principle - none:/)).toContain("18 tasks");
    expect(line(r.out, /^skill layer opus principle - current:/)).toContain("coverage 1.000");
    expect(line(r.out, /^capy opus principle - none:/)).toContain("6 tasks");
    expect(line(r.out, /^capy opus principle - current:/)).toContain("6 tasks");
    expect(line(r.out, /^base: /)).toMatch(/^base: \d+ rows \(none and current on opus\) from .*sha256 [0-9a-f]{64}$/);
    expect(r.out).not.toContain("secondary lens:opus");
    expect(r.out).not.toContain("skill layer sol");
  });

  test("without --base, a dev readings file with principle rows and no none rows refuses; a full dev file still runs", () => {
    const r = compare(climb(), SPLIT);
    expect(r.status).toBe(2);
    expect(r.err).toContain("--base");
    const full = devBase();
    full.readings.push(...climb().readings);
    full.plan = plan(["opus", "sol"], 2, 2, ["none", "current", "principle"]);
    expect(compare(full, SPLIT).status).toBe(0);
  });

  test("agreement reads the climb's own double reads: dev-base's agreeing reads cannot hide a climb's disagreement, and the reverse", () => {
    const bad = compare(climb({ agree: false }), SPLIT, devBase({ agree: true }));
    expect(bad.status).toBe(0);
    expect(bad.out).toContain("JUDGE FAIL");
    const good = compare(climb({ agree: true }), SPLIT, devBase({ agree: false }));
    expect(good.status).toBe(0);
    expect(good.out).not.toContain("JUDGE FAIL");
    expect(line(good.out, /^skill layer opus principle - none:/)).not.toBe("");
  });

  test("stop and harness counts read the climb's own rows", () => {
    const stop = (rows: Any[], status: string) => Object.assign(rows.find((r) => r.task === "a1" && r.pass === 2 && r.model === "opus" && r.family !== "capy")!, { status, facts: [], responseIds: [] });
    const b = devBase();
    stop(b.readings.filter((r: Any) => r.arm === "none"), "outage");
    stop(b.readings.filter((r: Any) => r.arm === "current"), "harness");
    const quiet = compare(climb(), SPLIT, b);
    expect(line(quiet.out, /^size drops:/)).toContain("outage stops: 0");
    expect(quiet.out).not.toContain("harness failures");
    const c = climb();
    stop(c.readings, "outage");
    expect(line(compare(c, SPLIT, devBase()).out, /^size drops:/)).toContain("outage stops: 1");
  });

  test("refusal twins: --base outside stage dev, a climb file with none rows, a base with principle rows", () => {
    const heldSplit = SPLIT.replace('"dev"', '"held"');
    const held = { ...climb(), stage: "held", plan: { ...climb().plan, manifestSha256: createHash("sha256").update(heldSplit).digest("hex") } };
    expect(compare(held, heldSplit, devBase()).err).toContain("--base joins a climb's dev readings");
    const withNone = climb({ extra: [reading(TASKS[0], "none", "opus", 1, 0.25)] });
    expect(compare(withNone, SPLIT, devBase()).err).toContain("principle");
    const base = devBase({ extra: [reading(TASKS[0], "principle", "opus", 1, 0.75)] });
    expect(compare(climb(), SPLIT, base).err).toContain("principle");
  });

  test("refusal twins: a base from another split, another stage, missing the climb's model, or with other passes", () => {
    const other = devBase();
    other.plan.manifestSha256 = "0".repeat(64);
    expect(compare(climb(), SPLIT, other).err).toContain("sha256");
    expect(compare(climb(), SPLIT, { ...devBase(), stage: "hr" }).err).toMatch(/stage/);
    expect(compare(climb(), SPLIT, devBase({ models: ["sol"] })).err).toContain("opus");
    expect(compare(climb(), SPLIT, devBase({ passes: 1 })).err).toContain("passes");
    const capy = devBase();
    capy.plan.capyPasses = 3;
    expect(compare(climb(), SPLIT, capy).err).toContain("capy");
  });

  test("refusal twins: a response id shared across the two files, and a base that is not a readings file", () => {
    const c = climb(), b = devBase();
    b.readings.find((r: Any) => r.arm === "none" && r.model === "opus")!.responseIds = [...c.readings[0].responseIds];
    expect(compare(c, SPLIT, b).err).toContain("response id");
    expect(compare(climb(), SPLIT, "not json").err).toContain("JSON");
    expect(compare(climb(), SPLIT, "/nonexistent/base.json").err).toContain("cannot read");
  });
});
