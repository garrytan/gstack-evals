// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the lane's entry files load: src/cli.ts reaches lanes/office-hours-founder/cli.ts by a path string, so this test imports it and e2e-score.ts directly, and the pregate maps both to it; fails_when=either file stops loading, the of help loses a subcommand, or the pregate stops running this test when they change.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main, SUBCOMMANDS } from "../../lanes/office-hours-founder/cli.ts";
import { FIXTURE_KEYS, scoreE2e } from "../../lanes/office-hours-founder/e2e-score.ts";

const REPO = join(import.meta.dir, "..", "..");

describe("the lane's entry files", () => {
  test("cli.ts loads and its help lists every subcommand", async () => {
    const out: string[] = [];
    expect(await main(["--help"], { out: (t) => out.push(t), err: () => {} }, {})).toBe(0);
    for (const name of ["run", "rows", "e2e", "dryrun", "audit", "stage1", "stage2"]) expect(Object.keys(SUBCOMMANDS)).toContain(name);
    for (const name of Object.keys(SUBCOMMANDS)) expect(out.join("\n")).toContain("  " + name + " ");
  });

  test("e2e-score.ts loads with its scoring step and the two fixture keys", () => {
    expect(typeof scoreE2e).toBe("function");
    expect(Object.keys(FIXTURE_KEYS).sort()).toEqual(["fx-answer", "fx-never"]);
  });

  test("the pregate runs this test when either file changes", () => {
    const deps = (JSON.parse(readFileSync(join(REPO, ".gstack", "pregate.json"), "utf8")) as { dependencies: Record<string, string[]> }).dependencies;
    for (const file of ["lanes/office-hours-founder/cli.ts", "lanes/office-hours-founder/e2e-score.ts"]) expect(deps[file]).toContain("tests/of/cli.test.ts");
  });
});
