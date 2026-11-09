// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { SUBCOMMANDS, main } from "../../lanes/decision-routing/cli.ts";

describe("decision-routing lane CLI", () => {
  test("names every subcommand once", () => expect(SUBCOMMANDS.map((s) => s.name)).toEqual(["score", "admit", "tune", "pin", "labels", "dry-run", "run"]));
  test("unknown and unbuilt subcommands exit 2 with E_USAGE; labels safety-set runs and matches its committed file", async () => {
    const errors: string[] = [];
    const logs: string[] = [];
    const err = console.error, log = console.log;
    console.error = (m: string) => errors.push(m);
    console.log = (m: string) => logs.push(m);
    try {
      expect(await main(["nope"])).toBe(2);
      expect(await main(["labels", "safety-set"])).toBe(0);
    } finally { console.error = err; console.log = log; }
    expect(errors[0]).toStartWith("E_USAGE unknown subcommand");
    expect(logs.at(-1)).toContain("safety set matches its build");
  });
});
