// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's frozen strings, checked byte for byte against the preregistration and its pre-run changes.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPS, CHANGE_1, CHANGE_2, CLOSING, LENS_LINE, PINS, PREREG, REVEAL_NOTE, SEED, SIM_ADDED_RULES, SIM_RULES_FILES, SIM_RULES_SHA256, SKILL_PREFIX, attemptLine, firstMessage } from "../../lanes/office-hours-rewrite/frozen.ts";

const root = join(import.meta.dir, "..", "..");
const prereg = readFileSync(join(root, PREREG), "utf8");
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
  });
  test("the new pin, its file hashes and its byte counts", () => {
    const pin = PINS.new!;
    expect(change2).toContain("garrytan/gstack " + pin.sha);
    expect(change2).toContain("| VERSION | " + pin.version + " |");
    const table = pinTable("2026-11-18-geva-553-office-hours-rewrite-pre-run-change-2/pin-new.tsv");
    const { VERSION: _v, ...files } = table;
    expect(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, (v as { sha256: string }).sha256]))).toEqual({ ...pin.files });
    expect(Object.keys(pin.files).sort()).toEqual([...Object.keys(PINS.current!.files), "office-hours/sections/landscape.md", "office-hours/sections/landscape.md.tmpl", "office-hours/sections/phase-2c-pivot-discovery.md", "office-hours/sections/phase-2c-pivot-discovery.md.tmpl"].sort());
    for (const [path, v] of Object.entries(files)) if (path.startsWith("office-hours/") && !path.endsWith(".json")) expect(change2).toContain("| " + path + " | " + v.bytes + " |");
    expect(change2).toContain("returns " + PINS.current!.sha + ", the current pin");
  });
  test("caps and seed", () => {
    for (const [name, cap] of [["1 Authoring", CAPS.authoring], ["2 Simulator audit", CAPS.simulator_audit], ["3 Stage 1", CAPS.stage1], ["4 Judge check", CAPS.judge_check], ["5 Stage 2, Opus and Sol", CAPS.stage2], ["6 Stage 2, particle-1", CAPS.stage2_particle], ["7 Hosts", CAPS.hosts]] as const)
      expect(change1).toContain("| " + name + " | $" + cap.toLocaleString("en-US") + " |");
    expect(change1).toContain("seed " + SEED);
  });
});
