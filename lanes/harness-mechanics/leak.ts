// Copyright (c) 2026 Garry Tan. MIT License.
// Unit 7's leak scan (prereg section 3, reusing the decision-routing build's custody: its section 2 "Leak scan"). Every
// picker and judgment-hook request goes through the decision-routing metering proxy (src/runner/proxy/metering-proxy.ts,
// unchanged) on a slot bound with the task's runner-only markers and its planted canary. A body carrying the canary is
// refused DR_CUSTODY_HIT and stops the run; a hidden test name or a path absent from the pristine image is journaled as a
// marker_hit and the call goes on, since a correct agent can write those. journalCheck reads the proxy journal after a
// run. "dryrun <out>" is dry-run step 7's leak half: three bodies through a proxy on a fake upstream.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { plantCanary, taskMarkers, type Pristine } from "../decision-routing/labels/markers.ts";
import { MeteringProxy, type BindRequest } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

export type Custody = { markers: string[]; canary: string };
export type JournalCheck = { pass: boolean; custody_hits: number; marker_hits: number; detail: string };

/** A task's markers (markers.ts taskMarkers) and its canary, planted on first use in canaryDir, a runner-only directory. */
export function taskCustody(taskDir: string, pristine: Pristine, canaryDir: string): Custody {
  const canary = plantCanary(canaryDir);
  return { markers: taskMarkers(taskDir, pristine, canary), canary };
}

/** The bind for one picker task's or one judge session's slot: its models are its deciders, so the canary stop applies to them. */
export function custodyBind(cell: BindRequest["cell"], models: string[], allowanceMicros: number, c: Custody): BindRequest {
  if (!c.markers.includes(c.canary)) throw new Error("E_HM_CUSTODY: leak scan: the canary is not among the task's markers");
  return { cell, models, deciders: models, allowance_micros: allowanceMicros, forbidden_markers: c.markers, canary: c.canary };
}

/** The post-run check: any DR_CUSTODY_HIT refusal fails it; marker_hit lines are counted and reported. A missing journal fails. */
export function journalCheck(path: string): JournalCheck {
  if (!existsSync(path)) return { pass: false, custody_hits: 0, marker_hits: 0, detail: "no proxy journal at " + path };
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind?: string; code?: string });
  const custody_hits = lines.filter((l) => l.kind === "refusal" && l.code === "DR_CUSTODY_HIT").length;
  const marker_hits = lines.filter((l) => l.kind === "marker_hit").length;
  return { pass: custody_hits === 0, custody_hits, marker_hits, detail: custody_hits + " custody hit(s), " + marker_hits + " marker hit(s) logged" };
}

class MemLedger implements ReservationLedger {
  private held = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + (this.held.size + 1), ...r, state: "reserved", spent_micros: null, usage: null };
    this.held.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.held.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

/** Dry-run step 7, leak half: a canary body is refused DR_CUSTODY_HIT and not forwarded, a hidden test name is logged and forwarded, a clean body passes. */
export async function leakDryrun(out: string): Promise<{ pass: boolean; detail: string }> {
  mkdirSync(join(out, "leak", "task", "tests"), { recursive: true });
  const name = "test_hidden_regression_case", forwarded: string[] = [];
  writeFileSync(join(out, "leak", "task", "tests", "test.patch"), "diff --git a/tests/test_calc.py b/tests/test_calc.py\n+def " + name + "():\n");
  const c = taskCustody(join(out, "leak", "task"), { files: [], testNames: [] }, join(out, "leak", "custody"));
  const journal = join(out, "leak", "journal.ndjson");
  const proxy = new MeteringProxy({
    ledger: new MemLedger(), leaseId: "hm-dryrun-leak", host: "127.0.0.1", managementSocket: join(out, "leak", "m.sock"), managementToken: "hm-dryrun-management-token",
    journal, retry: { attempts: 1, elapsed_ms: 60_000 }, env: { ANTHROPIC_API_KEY: "sk-ant-hm-dryrun-0000" }, sleep: async () => {}, allowanceCode: "DR_ALLOWANCE_STOP",
    fetch: async (_url, init) => { forwarded.push(String(init.body ?? "")); return Response.json({ id: "m", content: [{ type: "text", text: "PATCH 1" }], usage: { input_tokens: 100, output_tokens: 5 } }); },
  });
  proxy.start();
  try {
    const cell = { run_id: "hm-dryrun", arm: "picker", task: "leak", model: "claude-opus-5-5", trial: 1, attempt: 1 };
    const b = proxy.bind(custodyBind(cell, ["anthropic:claude-opus-5-5"], 1_000_000, c));
    const post = (content: string) => fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + b.token }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content }] }) });
    const hit = await post("diff carrying " + c.canary), hitCode = ((await hit.json()) as { code?: string }).code;
    const logged = (await post("my diff adds def " + name + "()")).status, clean = (await post("a clean issue")).status;
    const j = journalCheck(journal), ok = hit.status === 403 && hitCode === "DR_CUSTODY_HIT" && forwarded.length === 2 && logged === 200 && clean === 200 && j.custody_hits === 1 && j.marker_hits === 1;
    return { pass: ok, detail: "canary body " + hit.status + " " + hitCode + ", hidden test name " + logged + " and logged, clean body " + clean + "; journal: " + j.detail };
  } finally {
    proxy.stop();
  }
}

if (import.meta.main) {
  const [cmd, out] = process.argv.slice(2);
  if (cmd !== "dryrun" || !out) { console.error("E_USAGE: leak.ts dryrun <out>"); process.exit(2); }
  const r = await leakDryrun(out);
  console.log(JSON.stringify(r));
  process.exit(r.pass ? 0 : 1);
}
