// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's frozen strings, checked byte for byte against the preregistration and its pre-run changes.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIEF_ALLOWANCE, CAPS, CHANGE_1, CHANGE_2, CLOSING, DROPPED_SLOTS, LENS_LINE, PILOT, PINS, PREREG, PREREG_1, PROJECTION, QUOTA, REUSED_SLOTS, REVEAL_NOTE, SEED, SIM_ADDED_RULES, SIM_RULES_FILES, SIM_RULES_SHA256, SKILL_PREFIX, TOP_UP_BOUND, attemptLine, firstMessage } from "../../lanes/office-hours-rewrite/frozen.ts";

const root = join(import.meta.dir, "..", "..");
const prereg = readFileSync(join(root, PREREG_1), "utf8");
const change1 = readFileSync(join(root, CHANGE_1), "utf8");
const change2 = readFileSync(join(root, CHANGE_2), "utf8");
const pinTable = (file: string): Record<string, { bytes: number; sha256: string }> => Object.fromEntries(readFileSync(join(root, CHANGE_2, "..", "..", file), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t")).map((r) => [r[0], { bytes: Number(r[1]), sha256: r[2] }]));

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
  test("the simulator's rules files and the guard's notes", () => {
    for (const kind of ["founder", "builder"] as const) {
      const text = readFileSync(join(root, CHANGE_1, "..", SIM_RULES_FILES[kind]), "utf8");
      expect(createHash("sha256").update(text).digest("hex")).toBe(SIM_RULES_SHA256[kind]);
      expect(change1).toContain(SIM_RULES_SHA256[kind] + "  " + SIM_RULES_FILES[kind]);
      SIM_ADDED_RULES.forEach((rule, i) => expect(text).toContain("\n" + (11 + i) + ". " + rule + "\n"));
    }
    expect(change1).toContain('"' + REVEAL_NOTE + '"');
    expect(change1).toContain('"' + attemptLine(0).replace("0", "N") + '"');
  });
  test("the current pin and its file hashes", () => {
    const pin = PINS.current!;
    expect(change1).toContain("garrytan/gstack " + pin.sha);
    const tsv = readFileSync(join(root, CHANGE_1, "..", "pin-current.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
    const rows = Object.fromEntries(tsv.map((r) => [r[0], r[2]]));
    const { VERSION: _v, ...files } = rows;
    const added = /bin\/gstack-design-doc-find at the current pin: 2648 bytes, sha256 ([0-9a-f]{64})/.exec(change2);
    expect(added).not.toBeNull();
    expect({ ...files, "bin/gstack-design-doc-find": added![1] } as Record<string, string>).toEqual({ ...pin.files });
    expect(change1).toContain("| VERSION | " + pin.version + " |");
    expect(pin.version_sha256).toBe(rows.VERSION!);
  });
  test("the new pin, its file hashes and its byte counts", () => {
    const pin = PINS.new!;
    expect(change2).toContain("garrytan/gstack " + pin.sha);
    expect(change2).toContain("| VERSION | " + pin.version + " |");
    const table = pinTable("2026-11-18-geva-553-office-hours-rewrite-pre-run-change-2/pin-new.tsv");
    const { VERSION: version, ...files } = table;
    expect(pin.version_sha256).toBe((version as { sha256: string }).sha256);
    expect(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, (v as { sha256: string }).sha256]))).toEqual({ ...pin.files });
    expect(Object.keys(pin.files).sort()).toEqual([...Object.keys(PINS.current!.files), "office-hours/sections/landscape.md", "office-hours/sections/landscape.md.tmpl", "office-hours/sections/phase-2c-pivot-discovery.md", "office-hours/sections/phase-2c-pivot-discovery.md.tmpl"].sort());
    for (const [path, v] of Object.entries(files)) if (path.startsWith("office-hours/") && !path.endsWith(".json")) expect(change2).toContain("| " + path + " | " + v.bytes + " |");
    expect(change2).toContain("returns " + PINS.current!.sha + ", the current pin");
  });
  test("seed", () => {
    expect(change1).toContain("seed " + SEED);
  });
});

describe("the second attempt's frozen values (its sections 3 to 7)", () => {
  test("the prereg path moves to the second attempt and the first attempt's stays named", () => {
    expect(PREREG).toBe("wiki/plans/2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg/README.md");
    expect(PREREG_1).toBe("wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/README.md");
  });
  test("section 7's item caps", () => {
    expect({ ...CAPS }).toEqual({ authoring: 409, simulator_audit: 40, stage1: 220, judge_check: 123, stage2: 1406, stage2_particle: 130, hosts: 19 });
    expect(Object.values(CAPS).reduce((t, c) => t + c, 0)).toBe(2347);
  });
  test("section 3 item 1's quotas: four skins, 96 briefs from 28 pair slots and 40 unpaired slots", () => {
    expect({ ...QUOTA }).toEqual({ skins: 4, founder: 56, builder: 24, calibration: 8, reserve: 8, pairs: 28, unpaired: 40 });
    expect(2 * QUOTA.pairs + QUOTA.unpaired).toBe(QUOTA.founder + QUOTA.builder + QUOTA.calibration + QUOTA.reserve);
  });
  test("section 4's dropped and reused slots", () => {
    expect([...DROPPED_SLOTS]).toEqual(["com1-T1", "com1-T2", "com1-T3", "com1-T4", "com1-T5", "com1-T6", "com1-T7", "com5-T8"]);
    expect([...REUSED_SLOTS]).toEqual(["cal0-research", "com2-T4", "com2-T6", "com3-T2", "com3-T3", "com4-T6", "com5-T5", "com4-T7", "com5-T7", "com2-fun", "com2-open-source", "com3-open-source", "com5-fun"]);
    expect(REUSED_SLOTS.filter((s) => DROPPED_SLOTS.includes(s))).toEqual([]);
  });
  test("sections 5.3 and 5.4: the bound and the pilot", () => {
    expect(TOP_UP_BOUND).toBe(3);
    expect({ ...PILOT }).toEqual({ pair_slots: 2, first_twins: 3, unpaired_drafts: 8 });
  });
  test("section 5.5's projection inputs, the first attempt's counts exactly as sizing.py Part D lists them", () => {
    expect(PROJECTION.quantile).toBe(0.95);
    expect({ ...PROJECTION.usd }).toEqual({ first: 0.887, second: 0.093, unpaired: 0.545 });
    expect([PROJECTION.held, BRIEF_ALLOWANCE]).toEqual([8, 3.5]);
    expect(JSON.parse(JSON.stringify(PROJECTION.attempt1))).toEqual({
      first: [10, 15],
      partners: { T1: [0, 1], T2: [1, 1], T3: [1, 1], T4: [0, 2], T5: [1, 1], T6: [1, 2] },
      matched_draws: [5, 4],
      unpaired: { T7: [2, 41], T8: [0, 0], builder: [5, 41] },
    });
  });
});
