// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureRow } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { toCandidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import { readUnit, writeUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";

const D = "sha256:" + "c".repeat(64);
const cand = (row = fixtureRow()) => ({ ...toCandidate("rust", row), image_digest: D });

describe("sm-unit.v1", () => {
  test("writes, reads and digests a unit dir with Harbor's run copy", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "sm-unit-")), "u");
    const u = writeUnit(dir, cand(), fixtureRow());
    expect(u.image.ref).toBe("example/widget-7@" + D);
    expect(u.fix).toMatchObject({ files: ["src/counter.rs"], added_lines_30: 1 });
    expect(readUnit(dir).id).toBe(u.id);
    expect(Bun.file(join(dir, "harbor/environment/Dockerfile")).size).toBeGreaterThan(0);
    expect(() => writeUnit(dir, cand(), fixtureRow())).toThrow(/^E_SM_UNIT .*exists/);
    writeFileSync(join(dir, "fix.patch"), "tampered");
    expect(() => readUnit(dir)).toThrow(/^E_SM_UNIT .*fix\.patch/);
  });

  test("refuses rows that break the format", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sm-unit-"));
    const bad = (over: object, re: RegExp) => expect(() => writeUnit(join(tmp, String(Math.random())), cand(fixtureRow(over)), fixtureRow(over))).toThrow(re);
    bad({ FAIL_TO_PASS: [] }, /^E_SM_UNIT .*FAIL_TO_PASS/);
    bad({ PASS_TO_PASS: [""] }, /^E_SM_UNIT .*PASS_TO_PASS/);
    bad({ base_commit: "abc" }, /^E_SM_UNIT .*40 hex/);
    bad({ log_parser: "print(1)" }, /^E_SM_UNIT .*parser/);
    bad({ patch: "nope" }, /^E_SM_UNIT .*git diffs/);
    expect(() => writeUnit(join(tmp, "x"), { ...cand(), image_digest: null }, fixtureRow())).toThrow(/^E_SM_UNIT .*digest/);
  });
});
