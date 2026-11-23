// Copyright (c) 2026 Garry Tan. MIT License.
// The calibration pin (pin --calibration): the N calibration batch needs a pin file and its sha256 before any band is
// tuned. It records questions.json's sha256 and the frozen rules with no bands, under a key a routed cell does not read,
// so a routed session refuses it (session.py compares questions_sha256 only).

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/decision-routing/tune/pin-cli.ts";
import { J_FIXED, ruleDigests } from "../../lanes/decision-routing/tune/pin.ts";
import { SAFETY_PATTERNS } from "../../lanes/decision-routing/labels/safety.ts";

const QUESTIONS = join(import.meta.dir, "../../lanes/decision-routing/agent/dr_agent/questions.json");
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

test("pin --calibration writes the questions sha256 and the frozen rules with no bands, and its sha256 beside it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dr-calpin-"));
  try {
    const out = join(dir, "pin.json");
    expect(await main(["--calibration", "--questions", QUESTIONS, "--out", out])).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(readFileSync(out + ".sha256", "utf8").trim()).toBe(sha(text));
    const pin = JSON.parse(text);
    expect(pin).toEqual({ v: 1, stage: "calibration", calibration_questions_sha256: sha(readFileSync(QUESTIONS)), ...ruleDigests(), safety_patterns: SAFETY_PATTERNS, particle_max_tokens: 8000, j_fixed: J_FIXED });
    expect("questions_sha256" in pin || "jev" in pin).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pin without --tuned or --calibration is a usage error", async () => {
  expect(await main(["--questions", QUESTIONS, "--out", "/nonexistent/pin.json"])).toBe(2);
});
