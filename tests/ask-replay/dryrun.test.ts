import { describe, expect, test } from "bun:test";
import { dryRun } from "../../lanes/ask-replay/dryrun.ts";
import { FIXTURE_GSTACK } from "../../lanes/ask-replay/fixtures.ts";

describe("the keyless dry run (section 13)", () => {
  test("every check passes on the synthetic set with the stand-in gstack text", async () => {
    const lines = await dryRun({ gstack: FIXTURE_GSTACK });
    const failed = lines.filter((l) => l.state !== "PASS").map((l) => l.name + ": " + l.detail);
    expect(failed).toEqual([]);
    expect(lines.length).toBeGreaterThanOrEqual(19);
  }, 60_000);
});
