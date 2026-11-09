// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SUBCOMMANDS, main } from "../../lanes/decision-routing/cli.ts";

describe("decision-routing lane CLI", () => {
  test("names every subcommand once", () => expect(SUBCOMMANDS.map((s) => s.name)).toEqual(["score", "admit", "pilot", "tune", "pin", "labels", "dry-run", "run"]));
  test("every subcommand's module exists, so none is reported as not built yet", () => {
    expect(SUBCOMMANDS.filter((s) => !existsSync(join(import.meta.dir, "../../lanes/decision-routing", s.module))).map((s) => s.module)).toEqual([]);
  });
  test("unknown and unbuilt subcommands exit 2 with E_USAGE; labels safety-set runs and matches its committed file", async () => {
    const errors: string[] = [];
    const logs: string[] = [];
    const err = console.error, log = console.log;
    console.error = (m: string) => errors.push(m);
    console.log = (m: string) => logs.push(m);
    try {
      expect(await main(["nope"])).toBe(2);
      expect(await main(["pilot"])).toBe(2);
      expect(await main(["labels", "safety-set"])).toBe(0);
    } finally { console.error = err; console.log = log; }
    expect(errors[0]).toStartWith("E_USAGE unknown subcommand");
    expect(errors[1]).toStartWith("E_USAGE pilot --trials");
    expect(logs.at(-1)).toContain("safety set matches its build");
  });
});

describe("lane CLIs refuse a missing input path as input, never as a defect", () => {
  const ROOT = join(import.meta.dir, "../..");
  const PRICES = "lanes/decision-routing/config/prices.json";
  const run = (args: string[]) => {
    const p = Bun.spawnSync(["bin/gstack-evals", "decision-routing", ...args], { cwd: ROOT, env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "" } });
    return { code: p.exitCode, err: p.stderr.toString() };
  };
  const cases: Array<[string, string[], string]> = [
    ["score", ["score", "--trials", "/nonexistent", "--journal", "/nonexistent.ndjson", "--prices", PRICES, "--planned", "/nonexistent.json", "--admission", "/nonexistent.json"], "/nonexistent"],
    ["score with only the planned file missing", ["score", "--trials", ROOT, "--journal", PRICES, "--prices", PRICES, "--planned", "/nonexistent-planned.json", "--admission", PRICES], "/nonexistent-planned.json"],
    ["labels join", ["labels", "join", "--decisions", "/nonexistent-decisions.jsonl", "--labels", PRICES], "/nonexistent-decisions.jsonl"],
    ["labels trial", ["labels", "trial", "/nonexistent-trial", "--task", "/nonexistent-task", "--proxy-host", "127.0.0.1", "--verifier-image", "x"], "/nonexistent-trial"],
    ["admit", ["admit", "--calibration", ROOT, "--pilot", ROOT, "--journal", "/nonexistent-journal.ndjson", "--prices", PRICES], "/nonexistent-journal.ndjson"],
    ["pilot", ["pilot", "--trials", ROOT, "--journal", "/nonexistent-journal.ndjson", "--prices", PRICES], "/nonexistent-journal.ndjson"],
  ];
  for (const [name, args, path] of cases) {
    test(name + ": exit 2 with E_USAGE naming " + path + ", no E_INTERNAL line", () => {
      const r = run(args);
      expect(r.code).toBe(2);
      expect(r.err).not.toContain("E_INTERNAL");
      expect(r.err.split("\n").find((l) => l.startsWith("E_USAGE"))).toContain(path);
    });
  }
});

