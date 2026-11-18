// Value: protects=the keyless Docker end to end: it skips honestly where Docker does not answer, and with GSTACK_OHR_E2E=1 every check passes on the real rig.
import { expect, test } from "bun:test";
import { runE2e } from "../../../lanes/office-hours-rewrite/run/e2e.ts";

test("without Docker the end to end prints SKIP and runs nothing", async () => {
  const before = process.env.GSTACK_EVALS_DOCKER_BIN;
  process.env.GSTACK_EVALS_DOCKER_BIN = "false";
  try {
    const r = await runE2e();
    expect(r).toMatchObject({ skipped: true, checks: [], dir: null });
  } finally {
    if (before === undefined) delete process.env.GSTACK_EVALS_DOCKER_BIN;
    else process.env.GSTACK_EVALS_DOCKER_BIN = before;
  }
});

test.if(process.env.GSTACK_OHR_E2E === "1")("the end to end passes every check on the Docker rig", async () => {
  const r = await runE2e();
  expect(r.skipped).toBe(false);
  expect(r.checks.filter((c) => !c.ok)).toEqual([]);
}, 1_800_000);
