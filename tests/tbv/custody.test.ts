// Copyright (c) 2026 Garry Tan. MIT License.
// tbv custody: the plaintext root on tmpfs, the leftover check, and sealing through a configured command (a stub here).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leftover, openVault, plaintextRoot, seal, unseal } from "../../lanes/tbv/custody.ts";
import { TbvError } from "../../lanes/tbv/errors.ts";
import { cleanup, tmp } from "./drive-fixture.ts";

afterAll(cleanup);
const MOUNTS = "sysfs /sys sysfs rw 0 0\n/dev/root / ext4 rw 0 0\ntmpfs /dev/shm tmpfs rw,nosuid 0 0\n";
const SEAL = "printf 'STUB-SEALED\\n'; base64 -w0";
const UNSEAL = "tail -n +2 | base64 -d";
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof TbvError ? e.code : String(e);
  }
  return "no error";
};

describe("plaintext root", () => {
  test("held-out plaintext must sit on tmpfs", () => {
    expect(plaintextRoot("/dev/shm/tbv-run", { devPlaintext: false, held: true, mounts: MOUNTS })).toBe("/dev/shm/tbv-run");
    expect(code(() => plaintextRoot("/var/tbv-run", { devPlaintext: false, held: true, mounts: MOUNTS }))).toBe("E_TBV_CUSTODY");
    expect(code(() => plaintextRoot("/dev/shmx/run", { devPlaintext: false, held: false, mounts: MOUNTS }))).toBe("E_TBV_CUSTODY");
  });

  test("--dev-plaintext allows a disk root for dev data, and is refused for held-out input or with an unseal command", () => {
    expect(plaintextRoot("/var/tbv-run", { devPlaintext: true, held: false, mounts: MOUNTS })).toBe("/var/tbv-run");
    expect(code(() => plaintextRoot("/var/tbv-run", { devPlaintext: true, held: true, mounts: MOUNTS }))).toBe("E_TBV_CUSTODY");
    expect(code(() => plaintextRoot("/dev/shm/tbv-run", { devPlaintext: true, held: false, unsealCmd: UNSEAL, mounts: MOUNTS }))).toBe("E_TBV_CUSTODY");
  });

  test("the real /proc/mounts is read by default", () => {
    const shm = readFileSync("/proc/mounts", "utf8").split("\n").some((l) => l.split(" ")[1] === "/dev/shm" && l.split(" ")[2] === "tmpfs");
    if (shm) expect(plaintextRoot("/dev/shm/tbv-x", { devPlaintext: false, held: true })).toBe("/dev/shm/tbv-x");
    expect(code(() => plaintextRoot(tmp(), { devPlaintext: false, held: true }))).toBe("E_TBV_CUSTODY");
  });
});

describe("leftover check", () => {
  test("a dead run's plaintext is deleted and the deletion is logged", () => {
    const dir = join(tmp(), "plain");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "reading.json"), "{}");
    const logs: string[] = [];
    expect(leftover(dir, (t) => logs.push(t))).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain(dir);
    expect(leftover(dir, (t) => logs.push(t))).toBe(false);
    expect(logs.length).toBe(1);
  });
});

describe("sealing", () => {
  test("seal writes only the command's output, and unseal returns the plaintext", () => {
    const d = tmp();
    seal(SEAL, "secret reading text", join(d, "r.sealed"));
    const body = readFileSync(join(d, "r.sealed"), "utf8");
    expect(body.startsWith("STUB-SEALED")).toBe(true);
    expect(body).not.toContain("secret reading text");
    expect(unseal(UNSEAL, join(d, "r.sealed"))).toBe("secret reading text");
  });

  test("a failing seal command is refused and leaves no file", () => {
    const d = tmp();
    expect(code(() => seal("exit 3", "x", join(d, "r.sealed")))).toBe("E_TBV_CUSTODY");
    expect(readdirSync(d)).toEqual([]);
    expect(code(() => unseal("exit 4", join(d, "missing")))).toBe("E_TBV_CUSTODY");
  });

  test("a vault keeps plaintext in its root and sealed copies in the durable directory", () => {
    const d = tmp();
    const v = openVault({ root: join(d, "plain"), durable: join(d, "sealed"), sealCmd: SEAL, unsealCmd: UNSEAL });
    v.put("reading-a.json", '{"a":1}');
    v.put("start-a.json", '{"s":1}');
    expect(readFileSync(join(d, "plain", "reading-a.json"), "utf8")).toBe('{"a":1}');
    expect(readdirSync(join(d, "sealed")).sort()).toEqual(["reading-a.json.sealed", "start-a.json.sealed"]);
    expect(Object.fromEntries(v.all())).toEqual({ "reading-a.json": '{"a":1}', "start-a.json": '{"s":1}' });
  });
});
