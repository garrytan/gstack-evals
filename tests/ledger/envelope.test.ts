import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerCli } from "../../src/runner/ledger/cli.ts";
import { admitLease, envelopeStatus, recordCrew, recordProgram } from "../../src/runner/ledger/envelope.ts";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { LedgerError, readItem, type LeaseFile } from "../../src/runner/ledger/record.ts";
import type { CellAttempt } from "../../src/types.ts";

const LEDGER = join(import.meta.dir, "../../src/runner/ledger");
const D = 1_000_000;
const SKILLS = ["plan-eng-review", "plan-devex-review", "autoplan", "devex-review", "plan-design-review", "design-review"];
const [PE, PDX, AP, DX, PDR, DR] = SKILLS as [string, string, string, string, string, string];
const quote = { words: "Approved with every recommendation", by: "Project owner", source: "gate_rev 2 of the outcome-per-skill plan" };
const usage = { input: 10, output: 5, reasoning: 0, cache_read: 0, cache_write: 0 };
const cell = (n: number): CellAttempt => ({ run_id: "run", arm: "told", task: "t", model: "claude-opus-5-5", trial: n, attempt: 1, meter_id: "m" });

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "envelope-"));
  dirs.push(d);
  return d;
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof LedgerError) return error.code;
    throw error;
  }
  return "ok";
}

/** A record holding wave 1's envelope: $10,000 for the program, $2,000 for each of six skills, $1 per 1,000 credits. */
function world() {
  const dir = scratch();
  const record = join(dir, "record");
  recordProgram(record, { program: "wave1", cap_micros: 10_000 * D, skill_cap_micros: 2_000 * D, skills: SKILLS, credit_rate_micros: D, quotes: [quote] });
  return { dir, record, local: LocalLedger.open(join(dir, "machine-a.sqlite")) };
}

const stage = (record: string, item: string, skills: string[], cap: number) => recordApproval(record, { action: "init", item, cap_micros: cap, quotes: [quote], admission: "warn", program: "wave1", skills });
const lease = (record: string, local: LocalLedger | null, item: string, amount: number, now?: Date) => openLease(record, local, { item, run_id: "run-" + item, amount_micros: amount, requireAdmission: () => null, now });

/** A stage that reserved amount, spent spent through one metered call and settled. */
async function spend(w: { record: string; local: LocalLedger }, item: string, skills: string[], amount: number, spent = amount) {
  stage(w.record, item, skills, amount);
  const l = lease(w.record, w.local, item, amount);
  if (spent > 0) {
    const r = await w.local.reserve({ idempotency_key: item, lease_id: l.lease_id, cell: cell(1), max_micros: spent });
    if (!r.ok) throw new Error(r.code + " " + r.message);
    await w.local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: spent, usage });
  }
  settleLease(w.record, w.local, l.lease_id);
  return l;
}

/** $8,000 settled: four skills at their whole $2,000. */
async function eightThousand(w: { record: string; local: LocalLedger }) {
  for (const s of [PE, PDX, AP, DX]) await spend(w, "done-" + s, [s], 2_000 * D);
}

const leaseFile = (item: string, amount: number, expires: Date, now: Date): LeaseFile => ({ schema: 1, kind: "lease", item, seq: 1, lease_id: item + ".0001.abcdef", run_id: "run-" + item, machine_id: "m-test", reserved_micros: amount, expires_at: expires.toISOString(), created_at: now.toISOString() });

/** Runs one bun script per argument list, all starting at the same moment; returns each one's stdout and exit. */
async function spawnAll(source: string, argvs: string[][]) {
  const script = join(scratch(), "racer.ts");
  writeFileSync(script, source.replaceAll("LEDGER", LEDGER));
  const start = String(Date.now() + 500);
  const procs = argvs.map((argv) => Bun.spawn([process.execPath, script, start, ...argv], { stdout: "pipe", stderr: "pipe" }));
  return Promise.all(procs.map(async (p) => ({ out: (await new Response(p.stdout).text()).trim(), exit: await p.exited, signal: p.signalCode })));
}

describe("program and skill ceilings", () => {
  test("a stage that lands exactly on the $10,000 program ceiling is admitted; one micro-dollar more is refused", async () => {
    const w = world();
    await eightThousand(w);
    await spend(w, "done-pdr", [PDR], 800 * D);
    stage(w.record, "dr-a", [DR], 1_300 * D);
    expect(codeOf(() => lease(w.record, w.local, "dr-a", 1_200 * D + 1))).toBe("ENVELOPE_PROGRAM_STOP");
    expect(readItem(w.record, "dr-a").leases).toEqual([]);
    expect(envelopeStatus(w.record, "wave1").total).toMatchObject({ settled_micros: 8_800 * D, open_micros: 0, pending_micros: 0, committed_micros: 8_800 * D, left_micros: 1_200 * D });
    expect(codeOf(() => lease(w.record, w.local, "dr-a", 1_200 * D))).toBe("ok");
    const at = envelopeStatus(w.record, "wave1");
    expect(at.total).toMatchObject({ cap_micros: 10_000 * D, settled_micros: 8_800 * D, open_micros: 1_200 * D, committed_micros: 10_000 * D, left_micros: 0 });
    expect(at.skills[DR]).toMatchObject({ cap_micros: 2_000 * D, open_micros: 1_200 * D, left_micros: 800 * D });
    stage(w.record, "dr-b", [DR], D);
    expect(codeOf(() => lease(w.record, w.local, "dr-b", 1))).toBe("ENVELOPE_PROGRAM_STOP");
  });

  test("a stage that lands exactly on a skill's $2,000 ceiling is admitted; one micro-dollar more is refused", async () => {
    const w = world();
    await spend(w, "done-pdr", [PDR], 800 * D);
    stage(w.record, "pdr-a", [PDR], 1_500 * D);
    let message = "";
    try {
      lease(w.record, w.local, "pdr-a", 1_200 * D + 1);
    } catch (error) {
      expect((error as LedgerError).code).toBe("ENVELOPE_SKILL_STOP");
      message = (error as Error).message;
    }
    expect(message).toContain(PDR);
    expect(message).toContain("$2000.00");
    expect(codeOf(() => lease(w.record, w.local, "pdr-a", 1_200 * D))).toBe("ok");
    const s = envelopeStatus(w.record, "wave1");
    expect(s.skills[PDR]).toMatchObject({ settled_micros: 800 * D, open_micros: 1_200 * D, committed_micros: 2_000 * D, left_micros: 0 });
    expect(s.total).toMatchObject({ committed_micros: 2_000 * D, left_micros: 8_000 * D });
  });

  test("a stage shared by two skills splits evenly, and either skill's line can refuse it", async () => {
    const w = world();
    await spend(w, "done-pe", [PE], 1_800 * D);
    stage(w.record, "g-screen", [PE, AP], 500 * D);
    expect(codeOf(() => lease(w.record, w.local, "g-screen", 400 * D + 2))).toBe("ENVELOPE_SKILL_STOP");
    expect(codeOf(() => lease(w.record, w.local, "g-screen", 400 * D))).toBe("ok");
    const s = envelopeStatus(w.record, "wave1");
    expect(s.skills[PE]).toMatchObject({ committed_micros: 2_000 * D, left_micros: 0 });
    expect(s.skills[AP]).toMatchObject({ open_micros: 200 * D, committed_micros: 200 * D });
    expect(s.total.committed_micros).toBe(2_200 * D);
  });

  test("an odd micro-dollar of a shared stage goes to the first skill named, so the lines add up to the program", async () => {
    const w = world();
    await spend(w, "g-odd", [PE, AP], 3, 3);
    const s = envelopeStatus(w.record, "wave1");
    expect([s.skills[PE]!.settled_micros, s.skills[AP]!.settled_micros, s.total.settled_micros]).toEqual([2, 1, 3]);
  });
});

describe("concurrent reservations", () => {
  test("plan v3's test: $8,000 settled and two $1,200 stages admitted at the same moment, exactly one is admitted", async () => {
    const source = String.raw`
import { openLease } from "LEDGER/ledger.ts";
const [start, record, item] = process.argv.slice(2);
await Bun.sleep(Math.max(0, Number(start) - Date.now()));
try { openLease(record, null, { item, run_id: "run-" + item, amount_micros: 1200000000, requireAdmission: () => null }); console.log("ok"); } catch (error) { console.log(error.code ?? error.message); }
`;
    for (let round = 0; round < 4; round++) {
      const w = world();
      await eightThousand(w);
      stage(w.record, "pdr-a", [PDR], 1_200 * D);
      stage(w.record, "dr-a", [DR], 1_200 * D);
      const results = (await spawnAll(source, [[w.record, "pdr-a"], [w.record, "dr-a"]])).map((r) => r.out);
      expect(results.sort()).toEqual(["ENVELOPE_PROGRAM_STOP", "ok"]);
      expect(readItem(w.record, "pdr-a").leases.length + readItem(w.record, "dr-a").leases.length).toBe(1);
      expect(envelopeStatus(w.record, "wave1").total).toMatchObject({ settled_micros: 8_000 * D, open_micros: 1_200 * D, committed_micros: 9_200 * D });
    }
  });

  test("six stages racing for room that holds one: one lease, five refusals, and the program stays inside its ceiling", async () => {
    const w = world();
    await eightThousand(w);
    const items = ["a", "b", "c", "d", "e", "f"].map((x) => "stage-" + x);
    items.forEach((item, i) => stage(w.record, item, [i % 2 ? DR : PDR], 1_200 * D));
    const source = String.raw`
import { openLease } from "LEDGER/ledger.ts";
const [start, record, item] = process.argv.slice(2);
await Bun.sleep(Math.max(0, Number(start) - Date.now()));
try { openLease(record, null, { item, run_id: "run-" + item, amount_micros: 1200000000, requireAdmission: () => null }); console.log("ok"); } catch (error) { console.log(error.code ?? error.message); }
`;
    const results = (await spawnAll(source, items.map((item) => [w.record, item]))).map((r) => r.out);
    expect(results.filter((r) => r === "ok").length).toBe(1);
    expect(results.filter((r) => r !== "ok").every((r) => r === "ENVELOPE_PROGRAM_STOP")).toBe(true);
    expect(items.reduce((n, item) => n + readItem(w.record, item).leases.length, 0)).toBe(1);
    expect(envelopeStatus(w.record, "wave1").total.committed_micros).toBe(9_200 * D);
  });

  test("a check that passed but lost its slot to a concurrent admission is checked again against it and refused", async () => {
    const w = world();
    await eightThousand(w);
    stage(w.record, "pdr-a", [PDR], 1_200 * D);
    stage(w.record, "dr-a", [DR], 1_200 * D);
    const now = new Date();
    let inner = "";
    let checks = 0;
    const outer = codeOf(() =>
      admitLease(w.record, readItem(w.record, "pdr-a"), leaseFile("pdr-a", 1_200 * D, new Date(now.getTime() + 3_600_000), now), {
        afterCheck: () => {
          if (checks++ === 0) inner = codeOf(() => lease(w.record, null, "dr-a", 1_200 * D));
        },
      }),
    );
    expect([inner, outer, checks]).toEqual(["ok", "ENVELOPE_PROGRAM_STOP", 1]);
    expect(envelopeStatus(w.record, "wave1").total).toMatchObject({ open_micros: 1_200 * D, pending_micros: 0, committed_micros: 9_200 * D });
  });
});

describe("settling and crashes", () => {
  test("settling moves the metered amount to settled spend and releases the rest of the reservation", async () => {
    const w = world();
    stage(w.record, "pdr-a", [PDR], 1_200 * D);
    const l = lease(w.record, w.local, "pdr-a", 1_200 * D);
    const a = await w.local.reserve({ idempotency_key: "k1", lease_id: l.lease_id, cell: cell(1), max_micros: 500 * D });
    const b = await w.local.reserve({ idempotency_key: "k2", lease_id: l.lease_id, cell: cell(2), max_micros: 40 * D });
    if (!a.ok || !b.ok) throw new Error("reserve failed");
    await w.local.settle(a.reservation.reservation_id, { kind: "spent", spent_micros: 300 * D, usage });
    await w.local.settle(b.reservation.reservation_id, { kind: "unknown" });
    stage(w.record, "pdr-b", [PDR], 1_700 * D);
    expect(codeOf(() => lease(w.record, w.local, "pdr-b", 1_660 * D))).toBe("ENVELOPE_SKILL_STOP");
    expect(envelopeStatus(w.record, "wave1").skills[PDR]).toMatchObject({ settled_micros: 0, open_micros: 1_200 * D, committed_micros: 1_200 * D });
    settleLease(w.record, w.local, l.lease_id);
    expect(envelopeStatus(w.record, "wave1").skills[PDR]).toMatchObject({ settled_micros: 340 * D, open_micros: 0, committed_micros: 340 * D, left_micros: 1_660 * D });
    expect(codeOf(() => lease(w.record, w.local, "pdr-b", 1_660 * D))).toBe("ok");
    expect(envelopeStatus(w.record, "wave1").skills[PDR]!.left_micros).toBe(0);
  });

  test("a stage that crashes between reserve and settle stays counted in full, past its expiry, until it is settled", async () => {
    const w = world();
    stage(w.record, "pdr-a", [PDR], 1_200 * D);
    const db = join(w.dir, "crashing.sqlite");
    const source = String.raw`
import { openLease } from "LEDGER/ledger.ts";
import { LocalLedger } from "LEDGER/local.ts";
const [start, record, db] = process.argv.slice(2);
const local = LocalLedger.open(db);
const l = openLease(record, local, { item: "pdr-a", run_id: "run-pdr-a", amount_micros: 1200000000, ttl_ms: 60000, requireAdmission: () => null });
const r = await local.reserve({ idempotency_key: "k1", lease_id: l.lease_id, cell: { run_id: "run", arm: "told", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m" }, max_micros: 300000000 });
if (!r.ok) throw new Error(r.code);
process.kill(process.pid, "SIGKILL");
`;
    const [crashed] = await spawnAll(source, [[w.record, db]]);
    expect(crashed!.signal).toBe("SIGKILL");
    const [held] = readItem(w.record, "pdr-a").leases;
    expect(held!.close).toBeNull();
    const later = new Date(Date.parse(held!.lease.expires_at) + 86_400_000);
    expect(envelopeStatus(w.record, "wave1", later).skills[PDR]).toMatchObject({ open_micros: 1_200 * D, committed_micros: 1_200 * D, left_micros: 800 * D });
    stage(w.record, "pdr-b", [PDR], 1_700 * D);
    expect(codeOf(() => lease(w.record, w.local, "pdr-b", 1_700 * D, later))).toBe("ENVELOPE_SKILL_STOP");
    const survivor = LocalLedger.open(db);
    expect(settleLease(w.record, survivor, held!.lease.lease_id)).toMatchObject({ spent_micros: 0, unknown_micros: 300 * D, unknown_calls: 1 });
    expect(envelopeStatus(w.record, "wave1").skills[PDR]).toMatchObject({ settled_micros: 300 * D, open_micros: 0, left_micros: 1_700 * D });
    expect(codeOf(() => lease(w.record, w.local, "pdr-b", 1_700 * D))).toBe("ok");
  });

  test("an admission whose lease was never written stays counted until that lease could no longer spend", async () => {
    const w = world();
    stage(w.record, "pdr-a", [PDR], 1_200 * D);
    stage(w.record, "pdr-b", [PDR], 1_700 * D);
    const now = new Date();
    const expires = new Date(now.getTime() + 3_600_000);
    admitLease(w.record, readItem(w.record, "pdr-a"), leaseFile("pdr-a", 1_200 * D, expires, now), { now });
    expect(readItem(w.record, "pdr-a").leases).toEqual([]);
    expect(envelopeStatus(w.record, "wave1", now).skills[PDR]).toMatchObject({ pending_micros: 1_200 * D, committed_micros: 1_200 * D });
    expect(codeOf(() => lease(w.record, w.local, "pdr-a", 1_200 * D, now))).toBe("E_LEASE_UNSETTLED");
    expect(codeOf(() => lease(w.record, w.local, "pdr-b", 1_700 * D, now))).toBe("ENVELOPE_SKILL_STOP");
    expect(envelopeStatus(w.record, "wave1", expires).skills[PDR]).toMatchObject({ pending_micros: 0, committed_micros: 0 });
    expect(codeOf(() => lease(w.record, w.local, "pdr-b", 1_700 * D, expires))).toBe("ok");
  });

  test("a lease the envelope refuses writes nothing, so no paid call can spend against it", async () => {
    const w = world();
    await spend(w, "done-pdr", [PDR], 2_000 * D);
    stage(w.record, "pdr-a", [PDR], 100 * D);
    expect(codeOf(() => lease(w.record, w.local, "pdr-a", 100 * D))).toBe("ENVELOPE_SKILL_STOP");
    expect(readItem(w.record, "pdr-a").leases).toEqual([]);
    expect(envelopeStatus(w.record, "wave1").entries).toBe(2);
    expect(await w.local.reserve({ idempotency_key: "k", lease_id: "pdr-a.0001.000000", cell: cell(1), max_micros: 1 })).toMatchObject({ ok: false, code: "E_LEDGER_MISSING" });
  });
});

describe("crew model use", () => {
  test("crew use is recorded against the skill's line at the program's credit rate, once per thread at its latest reading", () => {
    const w = world();
    const warnings: string[] = [];
    const warn = (code: string) => warnings.push(code);
    expect(recordCrew(w.record, { program: "wave1", thread: "GEVA-300", credits_micros: 40_000 * D, skills: [PE, AP], source: "thread counter" }, warn)).toMatchObject({ kind: "crew", spent_micros: 40 * D });
    let s = envelopeStatus(w.record, "wave1");
    expect([s.skills[PE]!.settled_micros, s.skills[AP]!.settled_micros, s.total.settled_micros]).toEqual([20 * D, 20 * D, 40 * D]);
    recordCrew(w.record, { program: "wave1", thread: "GEVA-300", credits_micros: 50_000 * D, skills: [PE, AP], source: "thread counter, later" });
    expect(recordCrew(w.record, { program: "wave1", thread: "GEVA-300", credits_micros: 50_000 * D, skills: [PE, AP], source: "the same reading again" }).seq).toBe(3);
    s = envelopeStatus(w.record, "wave1");
    expect([s.skills[PE]!.settled_micros, s.total.settled_micros, s.entries]).toEqual([25 * D, 50 * D, 3]);
    expect(codeOf(() => recordCrew(w.record, { program: "wave1", thread: "GEVA-300", credits_micros: 45_000 * D, skills: [PE, AP], source: "an older reading" }))).toBe("E_USAGE");
    expect(codeOf(() => recordCrew(w.record, { program: "wave1", thread: "GEVA-300", credits_micros: 60_000 * D, skills: [PE], source: "another split" }))).toBe("E_USAGE");
    expect(codeOf(() => recordCrew(w.record, { program: "wave1", thread: "GEVA-301", credits_micros: D, skills: ["ship"], source: "x" }))).toBe("E_USAGE");
    recordCrew(w.record, { program: "wave1", thread: "GEVA-225", credits_micros: 130_480_200, skills: [], source: "the plan's own thread" });
    s = envelopeStatus(w.record, "wave1");
    expect([s.overhead_micros, s.total.settled_micros, s.skills[PE]!.settled_micros]).toEqual([130_481, 50 * D + 130_481, 25 * D]);
    expect(warnings).toEqual([]);
  });

  test("crew use past a ceiling is still recorded, with ENVELOPE_OVER, and the skill's next stage is refused", async () => {
    const w = world();
    await spend(w, "done-pe", [PE], 1_990 * D);
    const warnings: string[] = [];
    recordCrew(w.record, { program: "wave1", thread: "GEVA-300", credits_micros: 20_000 * D, skills: [PE], source: "thread counter" }, (code, message) => warnings.push(code + " " + message));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toStartWith("ENVELOPE_OVER ");
    expect(warnings[0]).toContain(PE);
    expect(envelopeStatus(w.record, "wave1").skills[PE]).toMatchObject({ settled_micros: 2_010 * D, left_micros: -10 * D });
    stage(w.record, "pe-a", [PE], D);
    expect(codeOf(() => lease(w.record, w.local, "pe-a", 1))).toBe("ENVELOPE_SKILL_STOP");
  });

  test("a survivor's re-size reserves only stages not yet spent, and settled shared spend keeps its split (M2)", async () => {
    const w = world();
    await spend(w, "g-shared", [PE, AP], 1_000 * D);
    await spend(w, "g-survivor", [PE], 600 * D);
    const s = envelopeStatus(w.record, "wave1");
    expect([s.skills[PE]!.settled_micros, s.skills[AP]!.settled_micros, s.total.settled_micros]).toEqual([1_100 * D, 500 * D, 1_600 * D]);
    expect(codeOf(() => lease(w.record, w.local, "g-shared", 1))).toBe("CAP_STOP");
  });
});

describe("envelope and membership records", () => {
  test("the program's envelope is recorded once with the owner's words; a retry returns it and a change is refused", () => {
    const w = world();
    const p = { program: "wave1", cap_micros: 10_000 * D, skill_cap_micros: 2_000 * D, skills: SKILLS, credit_rate_micros: D, quotes: [quote] };
    expect(recordProgram(w.record, p)).toMatchObject({ kind: "program", seq: 1, cap_micros: 10_000 * D });
    expect(codeOf(() => recordProgram(w.record, { ...p, cap_micros: 12_000 * D }))).toBe("E_USAGE");
    const fresh = join(scratch(), "record");
    expect(codeOf(() => recordProgram(fresh, { ...p, quotes: [] }))).toBe("E_USAGE");
    expect(codeOf(() => recordProgram(fresh, { ...p, skills: [PE, PE] }))).toBe("E_USAGE");
    expect(codeOf(() => recordProgram(fresh, { ...p, skill_cap_micros: 0 }))).toBe("E_USAGE");
    expect(codeOf(() => recordProgram(fresh, p, () => { throw new LedgerError("E_APPROVAL_RECORD", "mirror down"); }))).toBe("E_APPROVAL_RECORD");
    expect(existsSync(join(fresh, "programs"))).toBe(false);
    expect(codeOf(() => envelopeStatus(fresh, "wave1"))).toBe("E_ENVELOPE_MISSING");
  });

  test("an item joins one program's skills at init, and raise cannot move it", () => {
    const w = world();
    const init = (item: string, program: string, skills: string[]) => codeOf(() => recordApproval(w.record, { action: "init", item, cap_micros: D, quotes: [quote], admission: "warn", program, skills }));
    expect(init("x1", "wave2", [PE])).toBe("E_ENVELOPE_MISSING");
    expect(init("x2", "wave1", ["ship"])).toBe("E_USAGE");
    expect(init("x3", "wave1", [])).toBe("E_USAGE");
    expect(init("x4", "wave1", [PE, PE])).toBe("E_USAGE");
    expect(init("x5", "wave1", [PE, AP])).toBe("ok");
    expect(init("x5", "wave1", [PE, AP])).toBe("ok");
    expect(init("x5", "wave1", [PE])).toBe("E_USAGE");
    expect(codeOf(() => recordApproval(w.record, { action: "raise", item: "x5", cap_micros: 2 * D, quotes: [quote], program: "wave1", skills: [PE] }))).toBe("E_USAGE");
    expect(codeOf(() => recordApproval(w.record, { action: "raise", item: "x5", cap_micros: 2 * D, quotes: [quote] }))).toBe("ok");
    expect(readItem(w.record, "x5")).toMatchObject({ program: "wave1", skills: [PE, AP], cap_micros: 2 * D });
    expect(envelopeStatus(w.record, "wave1").items).toEqual(["x5"]);
  });

  test("an item outside any program leases as before, and the envelope does not count it", () => {
    const w = world();
    recordApproval(w.record, { action: "init", item: "other-lane", cap_micros: 50_000 * D, quotes: [quote], admission: "warn" });
    expect(codeOf(() => openLease(w.record, w.local, { item: "other-lane", run_id: "r", requireAdmission: () => null }))).toBe("ok");
    expect(envelopeStatus(w.record, "wave1").total.committed_micros).toBe(0);
  });
});

describe("gstack-evals ledger envelope, crew and status --program", () => {
  test("the CLI records the envelope, joins items, refuses a stage past a ceiling with its code and prints the lines", async () => {
    const dir = scratch();
    const bin = join(dir, "gstack-approvals");
    writeFileSync(bin, "#!/bin/sh\nprintf '%s\\n' \"$@\" >> " + JSON.stringify(join(dir, "calls.log")) + "\nexit 0\n", { mode: 0o755 });
    const env = { GSTACK_EVALS_APPROVALS_BIN: bin, GSTACK_EVALS_LEDGER_RECORD: join(dir, "record"), GSTACK_EVALS_LEDGER: join(dir, "ledger.sqlite"), PATH: "" };
    const cli = async (...argv: string[]) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await ledgerCli(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, env);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const words = ["--words", "Approved with every recommendation", "--by", "Project owner", "--source", "gate_rev 2"];
    const env1 = await cli("envelope", "--program", "wave1", "--cap", "10000", "--skill-cap", "2000", "--skills", SKILLS.join(","), "--credit-rate", "1", ...words);
    expect(env1).toMatchObject({ code: 0, err: "" });
    expect(env1.out).toStartWith("ENVELOPE: program=wave1 cap=$10000.00 skill_cap=$2000.00 skills=" + SKILLS.join(",") + " credit_rate=$1.00 per 1000 credits");
    expect(readFileSync(join(dir, "calls.log"), "utf8")).toContain("Approve a gstack-evals program envelope of $10000.00 for program wave1, with $2000.00 for each of its 6 skills");
    expect((await cli("init", "--cap", "2500", "--item", "g-admission", "--admission", "warn", "--program", "wave1", "--skills", PE + "," + AP, ...words)).code).toBe(0);
    expect((await cli("init", "--cap", "10", "--item", "x", "--admission", "warn", "--skills", PE, ...words)).err).toStartWith("E_USAGE ");
    const refused = await cli("lease", "--item", "g-admission", "--run", "run-g", "--amount", "2500");
    expect(refused.code).toBe(2);
    expect(refused.err.split("\n").filter((l) => !l.startsWith("RIG_UNPROVEN ")).every((l) => l.startsWith("ENVELOPE_SKILL_STOP "))).toBe(true);
    expect((await cli("lease", "--item", "g-admission", "--run", "run-g", "--amount", "1200")).code).toBe(0);
    const crew = await cli("crew", "--program", "wave1", "--thread", "GEVA-261", "--credits", "30000", "--skills", SKILLS.join(","), "--source", "thread counter at READY");
    expect(crew).toMatchObject({ code: 0, err: "" });
    expect(crew.out).toStartWith("CREW: program=wave1 thread=GEVA-261 credits=30000 spent=$30.00 skills=" + SKILLS.join(","));
    expect((await cli("crew", "--program", "wave1", "--thread", "GEVA-225", "--credits", "52000", "--overhead", "--source", "the plan's threads")).code).toBe(0);
    expect((await cli("crew", "--program", "wave1", "--thread", "GEVA-1", "--credits", "1", "--source", "x")).err).toStartWith("E_USAGE ");
    const status = await cli("status", "--program", "wave1");
    expect(status.out).toContain("ENVELOPE: program=wave1 cap=$10000.00 committed=$1282.00 settled=$82.00 open=$1200.00 pending=$0.00 left=$8718.00");
    expect(status.out).toContain("SKILL: plan-eng-review cap=$2000.00 committed=$605.00 settled=$5.00 open=$600.00 pending=$0.00 left=$1395.00");
    expect(status.out).toContain("OVERHEAD: settled=$52.00");
    expect(JSON.parse((await cli("status", "--program", "wave1", "--json")).out)).toMatchObject({ total: { committed_micros: 1_282 * D }, items: ["g-admission"] });
  });
});
