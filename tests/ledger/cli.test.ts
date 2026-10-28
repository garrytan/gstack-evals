import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli.ts";
import { ledgerCli } from "../../src/runner/ledger/cli.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A scratch home with a record, a local ledger and a fake gstack-approvals that logs each call and exits with FAKE_EXIT. */
function world(exit = 0, stderr = "") {
  const dir = mkdtempSync(join(tmpdir(), "ledger-cli-"));
  dirs.push(dir);
  const bin = join(dir, "gstack-approvals");
  writeFileSync(bin, "#!/bin/sh\nprintf '%s\\n' \"$@\" >> " + JSON.stringify(join(dir, "calls.log")) + "\necho 'last' >> " + JSON.stringify(join(dir, "calls.log")) + "\nprintf '%s\\n' " + JSON.stringify(stderr) + " >&2\nexit " + exit + "\n", { mode: 0o755 });
  const env = { GSTACK_EVALS_APPROVALS_BIN: bin, GSTACK_EVALS_LEDGER_RECORD: join(dir, "record"), GSTACK_EVALS_LEDGER: join(dir, "ledger.sqlite"), PATH: "" };
  const cli = async (...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await ledgerCli(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, env);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const calls = () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").split("last\n").filter(Boolean) : []);
  return { dir, bin, env, cli, calls };
}

const everyLine = (text: string, code: string) => text.split("\n").every((line) => line.startsWith(code + " "));

describe("gstack-evals ledger init and raise", () => {
  test("the quick looks' approval rows fit: several quotes, each with its words, who said them and the source", async () => {
    const w = world();
    // lanea-quick: two quotes, one speaker, one source.
    const a = await w.cli("init", "--cap", "130", "--item", "lanea-quick", "--words", "Rec", "--words", "It should be fast like this week", "--by", "Garry Tan", "--source", "gate 1 of plan v3.2; relayed by GSTA-2");
    expect(a).toMatchObject({ code: 0, err: "" });
    expect(a.out).toContain("APPROVED: item=lanea-quick cap=$130.00 approval=1");
    // laneb-quick and replay-quick: two quotes, each with its own context.
    const b = await w.cli("init", "--cap", "190", "--item", "laneb-quick", "--words", "Rec", "--source", "gate 1 of the v1 plan, approving the $500 first cap", "--words", "It should be fast like this week", "--source", "2026-10-28 message moving the quick looks up", "--by", "Garry Tan", "--json");
    expect(JSON.parse(b.out)).toMatchObject({ item: "laneb-quick", cap_micros: 190_000_000, quotes: [{ words: "Rec", by: "Garry Tan", source: "gate 1 of the v1 plan, approving the $500 first cap" }, { words: "It should be fast like this week", source: "2026-10-28 message moving the quick looks up" }] });
    expect(w.calls().length).toBe(4);
    expect(w.calls()[0]).toContain("add\n--ask\nApprove a gstack-evals spend cap of $130.00 for line item lanea-quick\n--words\nRec\n--by\nGarry Tan\n--scope\ngstack-evals line item lanea-quick in the approval record ");
    expect((await w.cli("raise", "--cap", "150", "--item", "lanea-quick", "--words", "raise ok", "--by", "Garry Tan", "--source", "gate 2", "--branch", "main")).code).toBe(0);
    expect(w.calls()[4]).toContain("Raise the gstack-evals spend cap for line item lanea-quick to $150.00");
    expect(w.calls()[4]).toContain("--branch\nmain\n");
    const status = await w.cli("status", "--item", "lanea-quick");
    expect(status.out).toContain("ITEM: lanea-quick cap=$150.00 committed=$0.00 left=$150.00 run=- leases=0 open=-");
    expect(status.out).toContain('  words: "raise ok" by Garry Tan (gate 2)');
  });

  test("a gstack-approvals failure is E_APPROVAL_RECORD with its path, exit and code, and nothing is recorded", async () => {
    const w = world(3, "gstack-approvals add: no branch (detached HEAD); fix: pass --branch (APPROVAL_RECORD_NO_BRANCH)");
    const r = await w.cli("init", "--cap", "60", "--item", "replay-quick", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    expect(r.code).toBe(2);
    expect(everyLine(r.err, "E_APPROVAL_RECORD")).toBe(true);
    expect(r.err).toContain(w.bin + " exited 3 (APPROVAL_RECORD_NO_BRANCH)");
    expect(readItem(w.env.GSTACK_EVALS_LEDGER_RECORD, "replay-quick").approvals).toEqual([]);
    rmSync(w.bin);
    const missing = await w.cli("init", "--cap", "60", "--item", "replay-quick", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    expect(missing.err).toContain("E_APPROVAL_RECORD gstack-approvals not found");
    expect(missing.err).toContain("install gstack: git clone");
  });

  test("usage mistakes are E_USAGE: no words, a --by count that fits neither rule, an unknown flag", async () => {
    const w = world();
    for (const argv of [
      ["init", "--cap", "1", "--item", "x"],
      ["init", "--cap", "1", "--item", "x", "--words", "a", "--words", "b", "--words", "c", "--by", "G", "--by", "H", "--source", "s"],
      ["init", "--cap", "1", "--item", "x", "--words", "a", "--by", "G", "--source", "s", "--approved-by", "G"],
      ["init", "--cap", "1.0000001", "--item", "x", "--words", "a", "--by", "G", "--source", "s"],
      ["frobnicate"],
    ]) {
      const r = await w.cli(...argv);
      expect(r.code).toBe(2);
      expect(everyLine(r.err, "E_USAGE")).toBe(true);
    }
    expect(w.calls()).toEqual([]);
  });
});

describe("gstack-evals ledger lease, settle, reconcile and status", () => {
  test("a lease without an approval prints an escalation; with one, the run leases, spends and settles", async () => {
    const w = world();
    const missing = await w.cli("lease", "--item", "lanea-quick", "--run", "run-1");
    expect(missing.code).toBe(2);
    expect(everyLine(missing.err, "E_LEDGER_MISSING")).toBe(true);
    expect(missing.err).toContain("a human must approve a cap");
    await w.cli("init", "--cap", "130", "--item", "lanea-quick", "--words", "Rec", "--by", "Garry Tan", "--source", "gate 1");
    const lease = JSON.parse((await w.cli("lease", "--item", "lanea-quick", "--run", "run-1", "--amount", "20", "--json")).out);
    expect(lease).toMatchObject({ line_item: "lanea-quick", run_id: "run-1", reserved_micros: 20_000_000, state: "open" });
    expect((await w.cli("lease", "--item", "lanea-quick", "--run", "run-2")).err).toStartWith("E_ITEM_BOUND ");
    const local = LocalLedger.open(w.env.GSTACK_EVALS_LEDGER);
    const r = await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: { run_id: "run-1", arm: "after", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m" }, max_micros: 2_000_000 });
    if (!r.ok) throw new Error(r.message);
    await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: 1_234_567, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } });
    const settled = await w.cli("settle", "--lease", lease.lease_id);
    expect(settled.out).toStartWith("SETTLED: " + lease.lease_id + " spent=$1.234567 unknown=$0.00 (0 calls)");
    expect((await w.cli("settle", "--lease", lease.lease_id)).code).toBe(0);
    expect((await w.cli("status")).out).toContain("ITEM: lanea-quick cap=$130.00 committed=$1.234567 left=$128.765433 run=run-1 leases=1 open=-");
  });

  test("a lost machine: the owner reconciles from a provider usage export, and the export's sha256 is recorded", async () => {
    const w = world();
    await w.cli("init", "--cap", "10", "--item", "replay-quick", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    const lease = JSON.parse((await w.cli("lease", "--item", "replay-quick", "--run", "run-1", "--json")).out);
    rmSync(w.env.GSTACK_EVALS_LEDGER);
    expect((await w.cli("settle", "--lease", lease.lease_id)).err).toStartWith("E_LEASE_UNSETTLED ");
    const usage = join(w.dir, "usage.csv");
    writeFileSync(usage, "date,cost\n2026-10-28,3.10\n");
    const r = await w.cli("reconcile", "--lease", lease.lease_id, "--spent", "3.10", "--words", "settle it at the export", "--by", "Garry", "--source", usage);
    expect(r.out).toMatch(/^RECONCILED: replay-quick\.0001\.[0-9a-f]{6} spent=\$3\.10 source=.* sha256=[0-9a-f]{64}$/);
    expect((await w.cli("lease", "--item", "replay-quick", "--run", "run-1", "--json")).out).toContain('"reserved_micros": 6900000');
  });

  test("the sealed workflow's round trip through the CLI: export, hold, settle to an artifact, import", async () => {
    const thread = world();
    const workflow = world();
    await thread.cli("init", "--cap", "50", "--item", "sealed-run-1", "--words", "Rec", "--by", "Garry", "--source", "gate 3");
    const exported = join(thread.dir, "lease.json");
    const lease = JSON.parse((await thread.cli("lease", "--item", "sealed-run-1", "--run", "sealed-1", "--amount", "5", "--machine", "workflow:sealed", "--export", exported, "--json")).out);
    expect((await workflow.cli("lease", "--from", exported)).out).toStartWith("LEASE_HELD: " + lease.lease_id + " amount=$5.00");
    const artifact = join(workflow.dir, "settle.json");
    const out = await workflow.cli("settle", "--lease", lease.lease_id, "--artifact", artifact);
    expect(out.out).toContain("artifact=" + artifact);
    expect(existsSync(workflow.env.GSTACK_EVALS_LEDGER_RECORD)).toBe(false);
    expect((await thread.cli("settle", "--from", artifact)).out).toStartWith("SETTLED: " + lease.lease_id + " spent=$0.00");
    expect((await thread.cli("status", "--json")).out).toContain('"committed_micros": 0');
  });

  test("the dispatcher runs the ledger command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-dispatch-"));
    dirs.push(dir);
    const err: string[] = [];
    const code = await run(["ledger", "status", "--ledger-record", join(dir, "record"), "--ledger", join(dir, "l.sqlite")], { out: () => {}, err: (s) => err.push(s) });
    expect({ code, err }).toEqual({ code: 0, err: [] });
  });
});
