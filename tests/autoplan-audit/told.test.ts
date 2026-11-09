// Copyright (c) 2026 Garry Tan. MIT License.
// Custody cleanup when a run ends early: leftovers from an earlier run are removed before the opening, and a signal
// still leaves no decrypted directory on /dev/shm.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { custody } from "../../lanes/autoplan-audit/told.ts";

const told = join(import.meta.dir, "../../lanes/autoplan-audit/told.ts");
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

  test("a clean opening logs no incident", () => {
    const { shm, sums, log } = setup();
    custody({ files: [], sums, log, identity: Buffer.from("x"), shm, sweep: [] }, () => 0);
    expect(readFileSync(log, "utf8").includes("incident")).toBe(false);
  });

  test("a SIGTERM during custody leaves no decrypted directory and logs an incident", () => {
    const { shm, sums, log } = setup();
    const seen = join(shm, "seen");
    const child = join(shm, "child.ts");
    writeFileSync(
      child,
      `import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { custody } from ${JSON.stringify(told)};
custody({ files: [], sums: ${JSON.stringify(sums)}, log: ${JSON.stringify(log)}, identity: Buffer.from("x"), shm: ${JSON.stringify(shm)}, sweep: [] }, (dec) => {
  writeFileSync(${JSON.stringify(seen)}, dec);
  process.kill(process.pid, "SIGTERM");
  spawnSync("sleep", ["1"]);
  return 0;
});
setTimeout(() => {}, 2000);
`,
    );
    spawnSync(process.execPath, [child], { encoding: "utf8", timeout: 20_000 });
    const dec = readFileSync(seen, "utf8");
    expect({ dir: existsSync(join(dec, "..")), incident: readFileSync(log, "utf8").includes("incident: SIGTERM") }).toEqual({ dir: false, incident: true });
  });
});
