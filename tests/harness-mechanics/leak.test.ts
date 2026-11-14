// Copyright (c) 2026 Garry Tan. MIT License.
// Unit 7's leak scan: per-task runner-only markers, the slot bind fields and the post-run journal check, on the
// decision-routing metering proxy with a fake upstream.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { custodyBind, journalCheck, leakDryrun, taskCustody } from "../../lanes/harness-mechanics/leak.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const WORK = join(process.env.HOME!, ".capy/work/hm/unit7/test-tmp");
let dirs: string[] = [], stops: Array<() => void> = [];
afterEach(() => { stops.forEach((s) => s()); stops = []; dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = []; });
const temp = () => { mkdirSync(WORK, { recursive: true }); const d = mkdtempSync(join(WORK, "leak-")); dirs.push(d); return d; };
const HIDDEN = "test_hidden_regression_case";
function taskDir(root: string) {
  const t = join(root, "task");
  mkdirSync(join(t, "tests"), { recursive: true }); mkdirSync(join(t, "solution"), { recursive: true });
  writeFileSync(join(t, "tests", "test.patch"), "diff --git a/tests/test_calc.py b/tests/test_calc.py\n--- a/tests/test_calc.py\n+++ b/tests/test_calc.py\n@@ -1 +1,3 @@\n+def " + HIDDEN + "():\n+    assert add(1, 2) == 3\n");
  writeFileSync(join(t, "solution", "fix.patch"), "diff --git a/calc.py b/calc.py\n-    return a - b\n+    return a + b\n");
  writeFileSync(join(t, "instruction.md"), "add() returns the difference of its arguments.\n");
  return t;
}
const cell = { run_id: "hm-stage1", arm: "picker", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 };

function proxyWorld(dir: string, reply: string, ledger: ReservationLedger = new MemLedger()) {
  const bodies: string[] = [];
  const proxy = new MeteringProxy({
    ledger, leaseId: "hm-stage1-opus.0001", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789",
    journal: join(dir, "journal.ndjson"), retry: { attempts: 1, elapsed_ms: 60_000 }, env: { ANTHROPIC_API_KEY: "sk-ant-hm-0123456789", OPENAI_API_KEY: "sk-oa-hm-0123456789" },
    sleep: async () => {}, allowanceCode: "DR_ALLOWANCE_STOP",
    fetch: async (url, init) => {
      bodies.push(String(init.body ?? ""));
      return String(url).includes("openai") ? Response.json({ id: "c", choices: [{ message: { role: "assistant", content: reply } }], usage: { prompt_tokens: 1000, completion_tokens: 50 } })
        : Response.json({ id: "m", content: [{ type: "text", text: reply }], usage: { input_tokens: 1000, output_tokens: 50 } });
    },
  });
  proxy.start();
  return { proxy, bodies, journal: join(dir, "journal.ndjson") };
}
class MemLedger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + (this.reservations.size + 1), ...r, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.reservations.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

const post = (port: number, b: { slot: string; token: string }, content: string) =>
  fetch("http://127.0.0.1:" + port + "/" + b.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + b.token },
    body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content }] }) });

describe("taskCustody", () => {
  test("builds the canary first and the hidden test name, and keeps the planted canary across calls", () => {
    const root = temp(), t = taskDir(root), c = taskCustody(t, { files: ["calc.py", "tests/test_calc.py"], testNames: [] }, join(root, "custody", "t1"));
    expect(c.canary).toMatch(/^DRCANARY-[0-9a-f]{32}$/);
    expect(c.markers[0]).toBe(c.canary);
    expect(c.markers).toContain(HIDDEN);
    expect(taskCustody(t, { files: [], testNames: [] }, join(root, "custody", "t1")).canary).toBe(c.canary);
  });
  test("leaves out a test name the pristine repo already has", () => {
    const root = temp(), c = taskCustody(taskDir(root), { files: [], testNames: [HIDDEN] }, join(root, "c"));
    expect(c.markers).not.toContain(HIDDEN);
    expect(c.markers).toHaveLength(1);
  });
});

describe("custodyBind", () => {
  test("puts the task's markers, its canary and the deciders on the bind", () => {
    const b = custodyBind(cell, ["anthropic:claude-opus-5-5"], 2_000_000, { markers: ["DRCANARY-" + "a".repeat(32), HIDDEN], canary: "DRCANARY-" + "a".repeat(32) });
    expect(b).toEqual({ cell, models: ["anthropic:claude-opus-5-5"], deciders: ["anthropic:claude-opus-5-5"], allowance_micros: 2_000_000, forbidden_markers: ["DRCANARY-" + "a".repeat(32), HIDDEN], canary: "DRCANARY-" + "a".repeat(32) });
  });
  test("refuses custody whose canary is not among its markers", () => {
    expect(() => custodyBind(cell, ["anthropic:claude-opus-5-5"], 1, { markers: [HIDDEN], canary: "DRCANARY-" + "b".repeat(32) })).toThrow(/E_HM_CUSTODY/);
  });
});

describe("leak scan on the metering proxy", () => {
  test("a body carrying the canary is refused DR_CUSTODY_HIT, not forwarded, and the journal check fails", async () => {
    const root = temp(), c = taskCustody(taskDir(root), { files: [], testNames: [] }, join(root, "c")), w = proxyWorld(root, "PATCH 1");
    stops.push(() => w.proxy.stop());
    const b = w.proxy.bind(custodyBind(cell, ["anthropic:claude-opus-5-5"], 2_000_000, c));
    const res = await post(w.proxy.port, b, "issue text and " + c.canary);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("DR_CUSTODY_HIT");
    expect(w.bodies).toHaveLength(0);
    expect(journalCheck(w.journal)).toMatchObject({ pass: false, custody_hits: 1 });
  });
  test("a hidden test name is journaled as a marker hit and the call goes on; the check passes and counts it", async () => {
    const root = temp(), c = taskCustody(taskDir(root), { files: [], testNames: [] }, join(root, "c")), w = proxyWorld(root, "PATCH 1");
    stops.push(() => w.proxy.stop());
    const b = w.proxy.bind(custodyBind(cell, ["anthropic:claude-opus-5-5"], 2_000_000, c));
    expect((await post(w.proxy.port, b, "my diff adds def " + HIDDEN + "()")).status).toBe(200);
    expect(w.bodies).toHaveLength(1);
    expect(journalCheck(w.journal)).toMatchObject({ pass: true, custody_hits: 0, marker_hits: 1 });
  });
  test("a clean body passes with no hits", async () => {
    const root = temp(), c = taskCustody(taskDir(root), { files: [], testNames: [] }, join(root, "c")), w = proxyWorld(root, "PATCH 1");
    stops.push(() => w.proxy.stop());
    const b = w.proxy.bind(custodyBind(cell, ["anthropic:claude-opus-5-5"], 2_000_000, c));
    expect((await post(w.proxy.port, b, "a clean issue")).status).toBe(200);
    expect(journalCheck(w.journal)).toMatchObject({ pass: true, custody_hits: 0, marker_hits: 0 });
  });
  test("a missing journal fails the check", () => {
    expect(journalCheck(join(temp(), "none.ndjson")).pass).toBe(false);
  });
});

describe("dry-run step 7, leak half", () => {
  test("the canary body is refused, the hidden test name is logged and forwarded, the clean body passes", async () => {
    const r = await leakDryrun(temp());
    expect(r.pass).toBe(true);
    expect(r.detail).toContain("canary body 403 DR_CUSTODY_HIT");
  });
});
