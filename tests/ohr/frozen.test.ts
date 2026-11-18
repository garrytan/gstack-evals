// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's frozen strings, checked byte for byte against the preregistration and its pre-run changes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPS, CHANGE_1, CLOSING, LENS_LINE, PINS, PREREG, SEED, SIM_ADDED_RULES, SKILL_PREFIX, firstMessage } from "../../lanes/office-hours-rewrite/frozen.ts";

const root = join(import.meta.dir, "..", "..");
const prereg = readFileSync(join(root, PREREG), "utf8");
const change1 = readFileSync(join(root, CHANGE_1), "utf8");

describe("frozen values match the posts", () => {
  test("first messages", () => {
    expect(change1).toContain("```text\n" + LENS_LINE + "\n```");
    expect(change1).toContain("```text\n" + SKILL_PREFIX + LENS_LINE + "\n```");
    expect(prereg).toContain('none gets "' + LENS_LINE + '"');
    expect(firstMessage("none", "  Hi.\n")).toBe(LENS_LINE + "\n\nHi.");
    expect(firstMessage("new", "Hi.")).toBe("/office-hours " + LENS_LINE + "\n\nHi.");
    expect(firstMessage("current", "Hi.")).toBe(firstMessage("new", "Hi."));
  });
  test("closing message", () => {
    expect(change1).toContain("```text\n" + CLOSING + "\n```");
    expect(CLOSING.split("\n").slice(1).join(" ")).toBe("DECISION: what I should do. NEXT ACTION: one thing, who and by when. WHY: up to three facts from our talk.");
    expect(prereg).toContain('"DECISION: what I should do. NEXT ACTION: one thing, who and by when. WHY: up to three facts from our talk."');
  });
  test("the simulator's added rules", () => {
    for (const rule of SIM_ADDED_RULES) expect(prereg).toContain("   - " + rule + "\n");
  });
  test("the current pin and its file hashes", () => {
    const pin = PINS.current!;
    expect(change1).toContain("garrytan/gstack " + pin.sha);
    const tsv = readFileSync(join(root, CHANGE_1, "..", "pin-current.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
    const rows = Object.fromEntries(tsv.map((r) => [r[0], r[2]]));
    const { VERSION: _v, ...files } = rows;
    expect(files).toEqual({ ...pin.files });
    expect(change1).toContain("| VERSION | " + pin.version + " |");
    expect(PINS.new).toBeNull();
  });
  test("caps and seed", () => {
    for (const [name, cap] of [["1 Authoring", CAPS.authoring], ["2 Simulator audit", CAPS.simulator_audit], ["3 Stage 1", CAPS.stage1], ["4 Judge check", CAPS.judge_check], ["5 Stage 2, Opus and Sol", CAPS.stage2], ["6 Stage 2, particle-1", CAPS.stage2_particle], ["7 Hosts", CAPS.hosts]] as const)
      expect(change1).toContain("| " + name + " | $" + cap.toLocaleString("en-US") + " |");
    expect(change1).toContain("seed " + SEED);
  });
});
