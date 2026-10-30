import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli.ts";
import { CODES } from "../../src/errors/codes.ts";
import { ledgerCli } from "../../src/runner/ledger/cli.ts";
import { machineId } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { admitThisCheckout } from "../rig/helpers.ts";

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
    const a = await w.cli("init", "--cap", "130", "--item", "lanea-quick", "--admission", "required", "--words", "Rec", "--words", "It should be fast like this week", "--by", "Garry Tan", "--source", "gate 1 of plan v3.2; relayed by GSTA-2");
    expect(a).toMatchObject({ code: 0, err: "" });
    expect(a.out).toContain("APPROVED: item=lanea-quick cap=$130.00 admission=required approval=1");
    // laneb-quick and replay-quick: two quotes, each with its own context.
    const b = await w.cli("init", "--cap", "190", "--item", "laneb-quick", "--admission", "warn", "--words", "Rec", "--source", "gate 1 of the v1 plan, approving the $500 first cap", "--words", "It should be fast like this week", "--source", "2026-10-28 message moving the quick looks up", "--by", "Garry Tan", "--json");
    expect(JSON.parse(b.out)).toMatchObject({ item: "laneb-quick", cap_micros: 190_000_000, quotes: [{ words: "Rec", by: "Garry Tan", source: "gate 1 of the v1 plan, approving the $500 first cap" }, { words: "It should be fast like this week", source: "2026-10-28 message moving the quick looks up" }] });
    expect(w.calls().length).toBe(4);
    expect(w.calls()[0]).toContain("add\n--ask\nApprove a gstack-evals spend cap of $130.00 for line item lanea-quick\n--words\nRec\n--by\nGarry Tan\n--scope\ngstack-evals line item lanea-quick in the approval record ");
    expect((await w.cli("raise", "--cap", "150", "--item", "lanea-quick", "--words", "raise ok", "--by", "Garry Tan", "--source", "gate 2", "--branch", "main")).code).toBe(0);
    expect(w.calls()[4]).toContain("Raise the gstack-evals spend cap for line item lanea-quick to $150.00");
    expect(w.calls()[4]).toContain("--branch\nmain\n");
    const status = await w.cli("status", "--item", "lanea-quick");
    expect(status.out).toContain("ITEM: lanea-quick cap=$150.00 admission=required committed=$0.00 left=$150.00 run=- leases=0 open=-");
    expect(status.out).toContain('  words: "raise ok" by Garry Tan (gate 2)');
  });

  test("a gstack-approvals failure is E_APPROVAL_RECORD with its path, exit and code, and nothing is recorded", async () => {
    const w = world(3, "gstack-approvals add: no branch (detached HEAD); fix: pass --branch (APPROVAL_RECORD_NO_BRANCH)");
    const r = await w.cli("init", "--cap", "60", "--item", "replay-quick", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    expect(r.code).toBe(2);
    expect(everyLine(r.err, "E_APPROVAL_RECORD")).toBe(true);
    expect(r.err).toContain(w.bin + " exited 3 (APPROVAL_RECORD_NO_BRANCH)");
    expect(readItem(w.env.GSTACK_EVALS_LEDGER_RECORD, "replay-quick").approvals).toEqual([]);
    rmSync(w.bin);
    const missing = await w.cli("init", "--cap", "60", "--item", "replay-quick", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    expect(missing.err).toContain("E_APPROVAL_RECORD gstack-approvals not found");
    expect(missing.err).toContain("install gstack: git clone");
  });

  test("usage mistakes are E_USAGE: no words, a --by count that fits neither rule, an unknown flag", async () => {
    const w = world();
    for (const argv of [
      ["init", "--cap", "1", "--item", "x"],
      ["init", "--cap", "1", "--item", "x", "--admission", "warn", "--words", "a", "--words", "b", "--words", "c", "--by", "G", "--by", "H", "--source", "s"],
      ["init", "--cap", "1", "--item", "x", "--admission", "warn", "--words", "a", "--by", "G", "--source", "s", "--approved-by", "G"],
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
    const missing = await w.cli("lease", "--item", "diet-quick", "--run", "run-1");
    expect(missing.code).toBe(2);
    expect(everyLine(missing.err, "E_LEDGER_MISSING")).toBe(true);
    expect(missing.err).toContain("a human must approve a cap");
    await w.cli("init", "--cap", "130", "--item", "diet-quick", "--admission", "warn", "--words", "Rec", "--by", "Garry Tan", "--source", "gate 1");
    const lease = JSON.parse((await w.cli("lease", "--item", "diet-quick", "--run", "run-1", "--amount", "20", "--json")).out);
    expect(lease).toMatchObject({ line_item: "diet-quick", run_id: "run-1", reserved_micros: 20_000_000, state: "open" });
    expect((await w.cli("lease", "--item", "diet-quick", "--run", "run-2")).err).toStartWith("E_ITEM_BOUND ");
    const local = LocalLedger.open(w.env.GSTACK_EVALS_LEDGER);
    const r = await local.reserve({ idempotency_key: "k1", lease_id: lease.lease_id, cell: { run_id: "run-1", arm: "after", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m" }, max_micros: 2_000_000 });
    if (!r.ok) throw new Error(r.message);
    await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: 1_234_567, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } });
    const settled = await w.cli("settle", "--lease", lease.lease_id);
    expect(settled.out).toStartWith("SETTLED: " + lease.lease_id + " spent=$1.234567 unknown=$0.00 (0 calls)");
    expect((await w.cli("settle", "--lease", lease.lease_id)).code).toBe(0);
    expect((await w.cli("status")).out).toContain("ITEM: diet-quick cap=$130.00 admission=warn committed=$1.234567 left=$128.765433 run=run-1 leases=1 open=-");
  });

  test("a lost machine: the owner reconciles from a provider usage export, and the export's sha256 is recorded", async () => {
    const w = world();
    await w.cli("init", "--cap", "10", "--item", "replay-quick", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    const lease = JSON.parse((await w.cli("lease", "--item", "replay-quick", "--run", "run-1", "--ttl", "0.0001", "--json")).out);
    rmSync(w.env.GSTACK_EVALS_LEDGER);
    // gstack-timing-ok: waits past the lease's 360 ms expiry; a slower machine only leaves it further expired
    await Bun.sleep(400);
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
    await thread.cli("init", "--cap", "50", "--item", "sealed-run-1", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 3");
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

  test("a sealed workflow that spent above its lease settles and imports at the real spend, with LEASE_OVERSPENT on stderr", async () => {
    const thread = world();
    const workflow = world();
    await thread.cli("init", "--cap", "50", "--item", "sealed-run-2", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 3");
    const exported = join(thread.dir, "lease.json");
    const lease = JSON.parse((await thread.cli("lease", "--item", "sealed-run-2", "--run", "sealed-2", "--amount", "1", "--machine", "workflow:sealed", "--export", exported, "--json")).out);
    expect((await workflow.cli("lease", "--from", exported)).code).toBe(0);
    const held = LocalLedger.open(workflow.env.GSTACK_EVALS_LEDGER);
    const r = await held.reserve({ idempotency_key: "w1", lease_id: lease.lease_id, cell: { run_id: "sealed-2", arm: "after", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1, meter_id: "m-1" }, max_micros: 900_000 });
    if (!r.ok) throw new Error(r.message);
    await held.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: 1_200_000, usage: { input: 10, output: 5, reasoning: 0, cache_read: 0, cache_write: 0 } });
    held.close();
    const artifact = join(workflow.dir, "settle.json");
    const staged = await workflow.cli("settle", "--lease", lease.lease_id, "--artifact", artifact);
    expect(staged.code).toBe(0);
    expect(everyLine(staged.err, "LEASE_OVERSPENT")).toBe(true);
    const imported = await thread.cli("settle", "--from", artifact);
    expect(imported.code).toBe(0);
    expect(imported.out).toStartWith("SETTLED: " + lease.lease_id + " spent=$1.20");
    expect(everyLine(imported.err, "LEASE_OVERSPENT")).toBe(true);
    expect(imported.err).toContain("closes at $1.20, above the $1.00 it reserved");
  });

  test("the dispatcher runs the ledger command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-dispatch-"));
    dirs.push(dir);
    const err: string[] = [];
    const code = await run(["ledger", "status", "--ledger-record", join(dir, "record"), "--ledger", join(dir, "l.sqlite")], { out: () => {}, err: (s) => err.push(s) });
    expect({ code, err }).toEqual({ code: 0, err: [] });
  });
});

describe("admission (GSTA-8, decision 3)", () => {
  test("init needs an explicit --admission, and raise cannot change it", async () => {
    const w = world();
    expect((await w.cli("init", "--cap", "5", "--item", "x", "--words", "Rec", "--by", "G", "--source", "s")).err).toStartWith("E_USAGE init needs --admission");
    expect((await w.cli("init", "--cap", "5", "--item", "x", "--admission", "maybe", "--words", "Rec", "--by", "G", "--source", "s")).err).toStartWith("E_USAGE --admission is required or warn");
    await w.cli("init", "--cap", "5", "--item", "x", "--admission", "required", "--words", "Rec", "--by", "G", "--source", "s");
    expect((await w.cli("raise", "--cap", "6", "--item", "x", "--admission", "warn", "--words", "Rec", "--by", "G", "--source", "s")).err).toStartWith("E_USAGE gstack-evals ledger raise does not take --admission");
    expect(JSON.parse(readFileSync(join(w.env.GSTACK_EVALS_LEDGER_RECORD, "items", "x", "approval-0001.json"), "utf8"))).toMatchObject({ item: "x", admission: "required" });
  });

  test("a required item's lease is refused with E_RIG_UNPROVEN until a matching admission record exists for its slot", async () => {
    const w = world();
    await w.cli("init", "--cap", "20", "--item", "u11-lanea", "--admission", "required", "--words", "Rec", "--by", "Garry Tan", "--source", "gate 1");
    const refused = await w.cli("lease", "--item", "u11-lanea", "--run", "run-1");
    expect(refused.code).toBe(2);
    expect(everyLine(refused.err, "E_RIG_UNPROVEN")).toBe(true);
    expect(refused.err).toContain("admission-0001.json");
    const dir = join(w.env.GSTACK_EVALS_LEDGER_RECORD, "items", "u11-lanea");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "admission-0001.json"), JSON.stringify({ item: "u11-lanea", seq: 1, run_id: "run-2", machine_id: machineId() }));
    expect((await w.cli("lease", "--item", "u11-lanea", "--run", "run-1")).err).toStartWith("E_RIG_UNPROVEN ");
    expect(readItem(w.env.GSTACK_EVALS_LEDGER_RECORD, "u11-lanea")).toMatchObject({ leases: [], run_id: null });
    writeFileSync(join(dir, "admission-0001.json"), JSON.stringify({ item: "u11-lanea", seq: 1, run_id: "run-1", machine_id: machineId(), proof: "U20 fills this" }));
    expect((await w.cli("lease", "--item", "u11-lanea", "--run", "run-1")).err).toStartWith("E_RIG_UNPROVEN ");
    rmSync(join(dir, "admission-0001.json"));
    admitThisCheckout(w.env.GSTACK_EVALS_LEDGER_RECORD, { item: "u11-lanea", proof: "direct", run_id: "run-1" });
    expect(await w.cli("lease", "--item", "u11-lanea", "--run", "run-1")).toMatchObject({ code: 0, err: "" });
  });

  test("a warn item leases with a RIG_UNPROVEN warning", async () => {
    const w = world();
    await w.cli("init", "--cap", "20", "--item", "my-diet", "--admission", "warn", "--words", "ok", "--by", "a caller", "--source", "their own budget");
    const r = await w.cli("lease", "--item", "my-diet", "--run", "run-1", "--json");
    expect(r.code).toBe(0);
    expect(r.err).toStartWith("RIG_UNPROVEN line item my-diet leased without admission: no admission record at ");
    expect(JSON.parse(r.out).warnings).toEqual([r.err]);
  });
});

describe("lease exports", () => {
  test("an export that cannot be written leaves no lease; an open lease can be exported again; a settled lease is never held again", async () => {
    const w = world();
    await w.cli("init", "--cap", "9", "--item", "sealed-run-2", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 3");
    const bad = await w.cli("lease", "--item", "sealed-run-2", "--run", "s-2", "--machine", "workflow:sealed", "--export", join(w.dir, "missing", "lease.json"));
    expect(bad.err).toStartWith("E_USAGE cannot write --export ");
    expect(readItem(w.env.GSTACK_EVALS_LEDGER_RECORD, "sealed-run-2").leases).toEqual([]);
    const first = join(w.dir, "lease.json");
    const lease = JSON.parse((await w.cli("lease", "--item", "sealed-run-2", "--run", "s-2", "--machine", "workflow:sealed", "--export", first, "--json")).out);
    rmSync(first);
    const again = join(w.dir, "lease-again.json");
    expect((await w.cli("lease", "--lease", lease.lease_id, "--export", again)).out).toStartWith("LEASE_EXPORTED: " + lease.lease_id);
    const workflow = world();
    await workflow.cli("lease", "--from", again);
    await workflow.cli("settle", "--lease", lease.lease_id, "--artifact", join(workflow.dir, "settle.json"));
    expect((await workflow.cli("lease", "--from", again)).err).toStartWith("E_LEASE_CLOSED ");
  });

  test("--export and --artifact never replace another file, and an output that cannot be written is E_USAGE naming the recovery", async () => {
    const w = world();
    await w.cli("init", "--cap", "9", "--item", "sealed-run-3", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 3");
    const first = join(w.dir, "lease.json");
    const lease = JSON.parse((await w.cli("lease", "--item", "sealed-run-3", "--run", "s-3", "--machine", "workflow:sealed", "--export", first, "--json")).out);
    const approval = join(w.env.GSTACK_EVALS_LEDGER_RECORD, "items", "sealed-run-3", "approval-0001.json");
    const before = readFileSync(approval, "utf8");
    const clobber = await w.cli("lease", "--lease", lease.lease_id, "--export", approval);
    expect(clobber.code).toBe(2);
    expect(clobber.err).toStartWith("E_USAGE cannot write --export " + approval + ": it already holds something else; run it again with another --export file");
    expect(readFileSync(approval, "utf8")).toBe(before);
    expect((await w.cli("lease", "--lease", lease.lease_id, "--export", first)).code).toBe(0);
    const workflow = world();
    await workflow.cli("lease", "--from", first);
    const missing = await workflow.cli("settle", "--lease", lease.lease_id, "--artifact", join(workflow.dir, "missing", "settle.json"));
    expect(missing.code).toBe(2);
    expect(everyLine(missing.err, "E_USAGE")).toBe(true);
    expect(missing.err).toContain("the lease is staged to close in this ledger; run the same settle again with another --artifact file");
    expect(CODES.E_USAGE.side_effects).toContain("settle --artifact once the close is staged in the local ledger");
    const artifact = join(workflow.dir, "settle.json");
    expect((await workflow.cli("settle", "--lease", lease.lease_id, "--artifact", artifact)).code).toBe(0);
    expect((await w.cli("settle", "--from", artifact)).out).toStartWith("SETTLED: " + lease.lease_id);
  });

  test("lease --from refuses a file that is not a lease export, a numeric expiry included, before it opens a local ledger", async () => {
    const w = world();
    const lease = { schema: 1, kind: "lease", item: "lanea", seq: 1, lease_id: "lanea.0001.abcdef", run_id: "r", machine_id: "workflow:sealed", reserved_micros: 1_000_000, expires_at: "2026-10-29T00:00:00.000Z", created_at: "2026-10-28T00:00:00.000Z" };
    for (const [name, text] of [["not-json.json", "{"], ["close.json", JSON.stringify({ ...lease, kind: "close" })], ["numeric.json", JSON.stringify({ ...lease, expires_at: 12345 })]]) {
      writeFileSync(join(w.dir, name!), text!);
      expect((await w.cli("lease", "--from", join(w.dir, name!))).err).toStartWith("E_USAGE ");
    }
    expect(existsSync(w.env.GSTACK_EVALS_LEDGER)).toBe(false);
  });
});

describe("flag values and status", () => {
  test("a flag given where a value belongs is E_USAGE and leases nothing", async () => {
    const w = world();
    await w.cli("init", "--cap", "5", "--item", "lanea-flags", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    for (const argv of [["lease", "--item", "lanea-flags", "--run", "--json"], ["lease", "--item", "lanea-flags", "--run", "--amount", "1"], ["lease", "--item", "--run", "r"]]) {
      const r = await w.cli(...argv);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/^E_USAGE --(run|item) needs a value/);
    }
    expect(readItem(w.env.GSTACK_EVALS_LEDGER_RECORD, "lanea-flags").leases).toEqual([]);
  });

  test("status --item reads only that item, so a damaged item elsewhere does not hide it", async () => {
    const w = world();
    await w.cli("init", "--cap", "5", "--item", "lanea-ok", "--admission", "warn", "--words", "Rec", "--by", "Garry", "--source", "gate 1");
    mkdirSync(join(w.env.GSTACK_EVALS_LEDGER_RECORD, "items", "broken"));
    writeFileSync(join(w.env.GSTACK_EVALS_LEDGER_RECORD, "items", "broken", "approval-0001.json"), "{");
    const one = await w.cli("status", "--item", "lanea-ok");
    expect(one.code).toBe(0);
    expect(one.out).toContain("ITEM: lanea-ok cap=$5.00");
    expect((await w.cli("status")).err).toStartWith("E_LEDGER_RECORD ");
  });
});
