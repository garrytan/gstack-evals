// The ceo-outcome exposure detectors' pin (src/trial/review/ceo-exposure.ts) against a checkout of gstack 699a41cb. It
// runs when OUTCOME_GSTACK_PIN names that checkout, as autoplan.test.ts's check does, and lives here rather than under
// tests/trial because the Docker tier (stage m1b) runs tests/trial and counts any skipped case as red.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GSTACK_CEO_PIN } from "../../src/trial/review/ceo-exposure.ts";
import * as G from "../trial/review/fixtures/ceo-exposure/gstack-699.ts";

describe("the pinned gstack files", () => {
  const pin = process.env.OUTCOME_GSTACK_PIN;
  test.skipIf(!pin)("with OUTCOME_GSTACK_PIN set: each pinned file hashes to its digest and holds every vendored line", () => {
    for (const [f, sha] of Object.entries(GSTACK_CEO_PIN.files)) expect(createHash("sha256").update(readFileSync(join(pin!, f))).digest("hex")).toBe(sha);
    for (const group of [G.HANDOFF_BIN, G.CEO_ONLY, G.REVIEW_SECTIONS, G.SKILL, G.CAPTURED_AUTO_HANDOFF] as Record<string, string>[]) {
      const text = readFileSync(join(pin!, group.file!), "utf8");
      for (const [k, line] of Object.entries(group)) if (k !== "file") expect(text.includes(group.file!.endsWith(".json") ? JSON.stringify(line).slice(1, -1) : line)).toBe(true);
    }
  });
});
