import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath, remoteMount } from "../../src/runner/ledger/paths.ts";
import type { LedgerError } from "../../src/runner/ledger/record.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "ledger-paths-"));
  dirs.push(d);
  return d;
};

describe("tier paths", () => {
  test("flag, then variable, then the default, each with its rule; Capy keeps the local ledger under ~/.capy/work", () => {
    const home = scratch();
    expect(ledgerPath("/x/l.sqlite", {}, home)).toEqual({ path: "/x/l.sqlite", rule: "--ledger" });
    expect(ledgerPath(undefined, { GSTACK_EVALS_LEDGER: "/y/l.sqlite" }, home).rule).toBe("GSTACK_EVALS_LEDGER");
    expect(ledgerPath(undefined, { XDG_STATE_HOME: "/s" }, home).path).toBe("/s/gstack-evals/ledger.sqlite");
    expect(ledgerPath(undefined, {}, home).path).toBe(join(home, ".local/state/gstack-evals/ledger.sqlite"));
    mkdirSync(join(home, ".capy", "work"), { recursive: true });
    expect(ledgerPath(undefined, {}, home).path).toBe(join(home, ".capy/work/gstack-evals/ledger.sqlite"));
    expect(recordPath(undefined, { GSTACK_EVALS_LEDGER_RECORD: "/d/rec" }, home)).toEqual({ path: "/d/rec", rule: "GSTACK_EVALS_LEDGER_RECORD" });
    expect(recordPath(undefined, {}, home).path).toBe(join(home, ".local/state/gstack-evals/record"));
    expect(ledgerPath(undefined, {}, home).path.startsWith(tmpdir() + "/gstack-evals")).toBe(false);
  });

  test("only the local ledger is refused on a network or FUSE mount (E_LEDGER_PATH)", () => {
    const dir = realpathSync(scratch());
    const mounts = [{ point: "/", type: "ext4" }, { point: dir, type: "fuse.capydrive" }];
    expect(remoteMount(join(dir, "nested", "ledger.sqlite"), mounts)).toBe("fuse.capydrive");
    expect(remoteMount(join(dir, "x"), [{ point: "/", type: "ext4" }, { point: dir, type: "nfs4" }])).toBe("nfs4");
    expect(remoteMount(join(dir, "x"), [{ point: "/", type: "ext4" }])).toBeNull();
    let code = "";
    try {
      openLocalLedger({ path: join(dir, "ledger.sqlite"), rule: "--ledger" }, mounts);
    } catch (error) {
      code = (error as LedgerError).code;
      expect((error as Error).message).toContain("the default here is ");
    }
    expect(code).toBe("E_LEDGER_PATH");
    openLocalLedger({ path: join(dir, "ledger.sqlite"), rule: "--ledger" }, [{ point: "/", type: "ext4" }]).close();
  });

  test("a local ledger SQLite cannot open on a local disk is E_LEDGER_PATH too", () => {
    const dir = scratch();
    writeFileSync(join(dir, "plain-file"), "");
    let code = "";
    try {
      openLocalLedger({ path: join(dir, "plain-file", "ledger.sqlite"), rule: "--ledger" }, [{ point: "/", type: "ext4" }]);
    } catch (error) {
      code = (error as LedgerError).code;
      expect((error as Error).message).toContain("cannot be used");
    }
    expect(code).toBe("E_LEDGER_PATH");
  });
});
