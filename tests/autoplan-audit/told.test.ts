// Copyright (c) 2026 Garry Tan. MIT License.
// Custody cleanup when a run ended early: leftovers from an earlier run are removed before the opening.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { custody } from "../../lanes/autoplan-audit/told.ts";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const setup = () => {
  const shm = mkdtempSync("/dev/shm/ar-told-test-");
  made.push(shm);
  const sums = join(shm, "SHA256SUMS");
  writeFileSync(sums, "");
  return { shm, sums, log: join(shm, "CUSTODY.md") };
};

describe("custody cleanup", () => {
  test("a custody directory an earlier run left behind is removed and logged before the opening", () => {
    const { shm, sums, log } = setup();
    const left = join(shm, "ar-custody-earlier");
    mkdirSync(join(left, "told"), { recursive: true });
    writeFileSync(join(left, "told", "record.json"), "{}");
    mkdirSync(join(shm, "other"));
    custody({ files: [], sums, log, identity: Buffer.from("x"), shm, sweep: [] }, () => 0);
    expect({ left: existsSync(left), other: existsSync(join(shm, "other")), logged: readFileSync(log, "utf8").includes("incident: removed a leftover custody directory") }).toEqual({ left: false, other: true, logged: true });
  });

  test("a leftover is removed even when a digest check then stops the opening", () => {
    const { shm, sums, log } = setup();
    const left = join(shm, "ar-custody-earlier");
    mkdirSync(left);
    const rec = join(shm, "a.age");
    writeFileSync(rec, "not the listed bytes");
    writeFileSync(sums, "0".repeat(64) + "  a.age\n");
    const code = (() => {
      try {
        custody({ files: [rec], sums, log, identity: Buffer.from("x"), shm, sweep: [] }, () => 0);
        return null;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    })();
    expect({ code, left: existsSync(left) }).toEqual({ code: "E_AR_CUSTODY", left: false });
  });

  test("a clean opening logs no incident", () => {
    const { shm, sums, log } = setup();
    custody({ files: [], sums, log, identity: Buffer.from("x"), shm, sweep: [] }, () => 0);
    expect(readFileSync(log, "utf8").includes("incident")).toBe(false);
  });
});
