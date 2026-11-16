// Copyright (c) 2026 Garry Tan. MIT License.
// The review arms (section 4) at the restore pin: plain bare, both skill arms at the pin by digest, the opening rendered
// at the pin, and ep pin's report on a checkout at the pin when one is here.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { reviewPrompt } from "../../../lanes/eng-build/arms.ts";
import { RESTORE_PIN } from "../../../lanes/eng-planted/frozen.ts";
import { armCheckoutProblems, EB_ARM, plainArmProblems, plantedArmSpec, plantedOpening, plantedPrompt, skillPin } from "../../../lanes/eng-planted/stages/arms.ts";
import { codeOf } from "../../../lanes/eng-planted/stages/cases.ts";
import { EXTRA_READS, pinReport } from "../../../lanes/eng-planted/stages/pin.ts";

const CHECKOUT = process.env.GSTACK_EVALS_RESTORE_CHECKOUT ?? join(homedir(), ".capy", "work", "wt-restore");
const here = existsSync(join(CHECKOUT, "VERSION")) && readFileSync(join(CHECKOUT, "VERSION"), "utf8").trim() === RESTORE_PIN.version;

describe("arms", () => {
  test("plain installs nothing; the skill arms install gstack at the pin", () => {
    const pin = skillPin();
    expect(plainArmProblems(plantedArmSpec("plain", null))).toEqual([]);
    for (const arm of ["standalone", "engphase"] as const) {
      const spec = plantedArmSpec(arm, pin);
      expect(spec.name).toBe(arm);
      expect(JSON.stringify(spec)).toContain(pin.sha);
      expect(plainArmProblems(spec)).toHaveLength(1);
    }
  });
  test("standalone runs eng-build's pre-cut arm, the eng phase arm its opening, plain the common line alone", () => {
    expect(EB_ARM.standalone).toBe("precut");
    expect(plantedPrompt("standalone")).toBe(reviewPrompt("precut", null));
    expect(plantedPrompt("plain", "ignored")).toBe(reviewPrompt("plain", null));
    expect(plantedPrompt("engphase", "OPENING")).toBe(reviewPrompt("engphase", "OPENING"));
  });
  test("a checkout that is not the pin is refused before any render", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ep-nogstack-"));
    expect(armCheckoutProblems("standalone", empty, skillPin()).length).toBeGreaterThan(0);
    expect(await codeOf(() => plantedOpening({ gstack: empty, plan: "# Plan\n", out: join(empty, "out"), pin: skillPin() }))).toBe("E_USAGE");
  });
});

describe.skipIf(!here)("a checkout at the restore pin", () => {
  test("both arms' files hold their digests and detector strings", () => {
    for (const arm of ["standalone", "engphase"] as const) expect(armCheckoutProblems(arm, CHECKOUT, skillPin())).toEqual([]);
  });
  test("the eng phase opening renders at the pin from a plan with no layout", () => {
    const out = join(mkdtempSync(join(tmpdir(), "ep-open-")), "o");
    const o = plantedOpening({ gstack: CHECKOUT, plan: "# Plan\n\nImplement Parse in range.go.\n", out, pin: skillPin() });
    expect(o.text).toContain("at gstack " + RESTORE_PIN.sha.slice(0, 9) + " (VERSION " + RESTORE_PIN.version + ")");
    expect(o.readRanges.length).toBeGreaterThan(0);
    expect(o.mounts.every((m) => existsSync(m.host))).toBe(true);
  });
  test("ep pin matches RESTORE_PIN's six digests and prints the preamble as the one extra read", () => {
    const r = pinReport(CHECKOUT);
    expect(r.sha).toBe(RESTORE_PIN.sha);
    expect(r.files.filter((f) => f.state === "pinned").map((f) => f.path).sort()).toEqual(Object.keys(RESTORE_PIN.digests).sort());
    expect(r.files.filter((f) => f.state === "extra").map((f) => f.path)).toEqual([...EXTRA_READS]);
    expect(r.strings).toEqual([]);
  });
});
