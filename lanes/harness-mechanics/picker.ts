// Copyright (c) 2026 Garry Tan. MIT License.
// Unit 7's bo2 picker (prereg section 7). Attempt A is a task's none session and attempt B its plain-2 session. An empty
// diff loses to a non-empty one and two empty diffs ship empty; otherwise one call goes to the other frontier family
// (GPT-6.1 Sol picks for Opus, Opus 5.5 for Sol and particle-1) with the issue text and both diffs, each cut at 40,000
// characters, in the order a coin seeded by HM.seed and the task id sets. score.ts pickShip reads the reply. The call goes
// through the decision-routing metering proxy on a slot bound with the task's markers (leak.ts), and each call reserves
// its worst case on the item's Lane B ledger and settles at its metered cost (LaneBReservations). pickRun is "hm pick".
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HmRowIn } from "./analyze.ts";
import { custodyBind, journalCheck, taskCustody, type Custody } from "./leak.ts";
import { CAPS_USD, HM, MODELS, type ModelKey } from "./pins.ts";
import { pickShip } from "./score.ts";
import { Ledger } from "../../quick/laneb/runner/ledger.ts";
import { MeteringProxy, type BindRequest } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

export const PICKER_CUT = 40_000;
type AB = "A" | "B";
export type Attempt = { diff: string; pass: boolean };
export type PickTask = { task: string; model: string; trial: string; issue: string; a: Attempt; b: Attempt };
export type Pick = { task: string; model: string; trial: string; order: [AB, AB]; called: boolean; cuts: number; parsed: boolean | null; ships: AB; bo2_pass: boolean; pass2: boolean; cost_usd: number; picker: string | null };
export type PickRequest = { provider: "openai" | "anthropic"; model: string; prompt: string };
export type PickSend = (r: PickRequest) => Promise<{ reply: string; cost_usd: number }>;

export function pickerModel(mk: ModelKey): { provider: "openai" | "anthropic"; model: string } {
  return mk === "opus" ? { provider: "openai", model: MODELS.sol.id } : { provider: "anthropic", model: MODELS.opus.id };
}

/** The seeded coin: the low bit of sha256(seed:task) puts B first when set. */
export function coinOrder(task: string, seed: number = HM.seed): [AB, AB] {
  return createHash("sha256").update(seed + ":" + task).digest()[0]! & 1 ? ["B", "A"] : ["A", "B"];
}

export const cutDiff = (diff: string) => ({ text: diff.slice(0, PICKER_CUT), cut: diff.length > PICKER_CUT });

/** Section 7's rules before any call: an empty diff loses to a non-empty one; two empty diffs ship A, which is empty; null needs the picker. */
export function deterministicShip(a: string, b: string): AB | null {
  const ea = !a.trim(), eb = !b.trim();
  return ea && eb ? "A" : ea ? "B" : eb ? "A" : null;
}

export function pickerPrompt(issue: string, one: string, two: string): string {
  return "Two patches try to fix the same issue. Read the issue and both unified diffs, and choose the patch more likely to fix it. Do not run anything.\n\n## Issue\n\n" +
    issue + "\n\n## Patch 1\n\n" + one + "\n\n## Patch 2\n\n" + two + "\n\nEnd your reply with one final line: PATCH 1 or PATCH 2.";
}

export async function pickTask(t: PickTask, mk: ModelKey, send: PickSend): Promise<Pick> {
  const order = coinOrder(t.task), at = (k: AB) => (k === "A" ? t.a : t.b);
  const base = { task: t.task, model: t.model, trial: t.trial, order, pass2: t.a.pass || t.b.pass };
  const det = deterministicShip(t.a.diff, t.b.diff);
  if (det) return { ...base, called: false, cuts: 0, parsed: null, ships: det, bo2_pass: at(det).pass, cost_usd: 0, picker: null };
  const [one, two] = order.map((k) => cutDiff(at(k).diff)) as [ReturnType<typeof cutDiff>, ReturnType<typeof cutDiff>];
  const pm = pickerModel(mk), r = await send({ ...pm, prompt: pickerPrompt(t.issue, one.text, two.text) }), p = pickShip(r.reply, order);
  return { ...base, called: true, cuts: Number(one.cut) + Number(two.cut), parsed: p.parsed, ships: p.ships, bo2_pass: at(p.ships).pass, cost_usd: r.cost_usd, picker: pm.provider + ":" + pm.model };
}

/** One picker call on its own slot: bind with the task's custody, post, unbind, and read the slot's metered cost from finalize. A refusal throws with the proxy's code, so a canary hit stops the run with DR_CUSTODY_HIT. */
export function proxySend(proxy: MeteringProxy, cell: BindRequest["cell"], allowanceMicros: number, custody: Custody): PickSend {
  return async (r) => {
    const b = proxy.bind(custodyBind(cell, [r.provider + ":" + r.model], allowanceMicros, custody));
    const messages = [{ role: "user", content: r.prompt }];
    let res: Response, json: any;
    try {
      res = await fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + (r.provider === "openai" ? "/openai/v1/chat/completions" : "/anthropic/v1/messages"), {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + b.token }, body: JSON.stringify({ model: r.model, messages }),
      });
      json = await res.json().catch(() => ({}));
    } finally {
      proxy.unbind(b.slot);
    }
    const meter = await proxy.finalize(b.meter_id);
    if (!res.ok) throw new Error((json?.code ?? "E_HM_PICKER") + ": picker: the metering proxy answered " + res.status + " for " + cell.task);
    const reply = r.provider === "openai" ? String(json?.choices?.[0]?.message?.content ?? "") : (json?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("");
    return { reply, cost_usd: meter.micros / 1_000_000 };
  };
}

/** The metering proxy's ReservationLedger on the item's Lane B ledger: a reserve holds the call's worst case under the item's cap (CAP_STOP past it), a spent outcome settles it, and an unknown one stays open at its full amount. */
export class LaneBReservations implements ReservationLedger {
  private held = new Map<string, Reservation>();
  constructor(private ledger: Ledger, private prefix: string) {}
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const id = this.prefix + ":" + r.idempotency_key, prior = this.held.get(id);
    if (prior) return { ok: true, reservation: prior };
    const got = this.ledger.reserve(id, r.max_micros, { cell: r.cell, lease_id: r.lease_id });
    if (!got.ok) return { ok: false, code: got.reason === "cap" ? "CAP_STOP" : "E_RESERVE_CONFLICT", message: "picker reserve " + id + ": " + got.reason };
    const reservation: Reservation = { reservation_id: id, ...r, state: "reserved", spent_micros: null, usage: null };
    this.held.set(id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.held.get(id);
    if (!r) return { ok: false, code: "E_INTERNAL", message: "picker settle: no reservation " + id };
    if (outcome.kind === "unknown") return { ok: true, reservation: Object.assign(r, { state: "unknown" as const }) };
    const s = this.ledger.settle(id, outcome.spent_micros, { usage: outcome.usage });
    if (!s.ok && s.reason !== "already settled") return { ok: false, code: "E_SETTLE_CONFLICT", message: "picker settle " + id + ": " + s.reason };
    return { ok: true, reservation: Object.assign(r, { state: "settled" as const, spent_micros: outcome.spent_micros, usage: outcome.usage }) };
  }
}

/** bo2_pass, picker_parsed and picker_cost_usd on each none row that has a pick for its model, task and trial; other rows unchanged. */
export function pickerColumns(rows: HmRowIn[], picks: Pick[]): HmRowIn[] {
  const by = new Map(picks.map((p) => [p.model + "|" + p.task + "|" + p.trial, p]));
  return rows.map((r) => {
    const p = r.arm === "none" ? by.get(r.model + "|" + r.task + "|" + r.trial) : undefined;
    return p ? { ...r, bo2_pass: p.bo2_pass, picker_parsed: p.parsed, picker_cost_usd: p.cost_usd } : r;
  });
}

type PickConfig = { item: string; model: ModelKey; tasks_dir: string; pristine_dir: string; custody_dir: string; tasks: { task: string; trial: string; a: { diff_file: string; pass: boolean }; b: { diff_file: string; pass: boolean } }[] };

/** hm pick <config.json> --ledger <item ledger.jsonl> --out <dir>: runs on the awake host beside the item's ledger, with the provider keys in its own env only. */
export async function pickRun(argv: string[]): Promise<number> {
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const cfgPath = argv[0], ledgerPath = flag("--ledger"), out = flag("--out");
  if (!cfgPath || !ledgerPath || !out) { console.error("E_USAGE: hm pick <config.json> --ledger <jsonl> --out <dir>"); return 2; }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as PickConfig;
  if (!Object.hasOwn(CAPS_USD, cfg.item) || !Object.hasOwn(MODELS, cfg.model)) { console.error("E_HM_PICKER: pick: unknown item " + cfg.item + " or model " + cfg.model); return 2; }
  mkdirSync(out, { recursive: true });
  const picksPath = join(out, "picks.jsonl"), journal = join(out, "journal.ndjson");
  const done = new Set(existsSync(picksPath) ? readFileSync(picksPath, "utf8").split("\n").filter(Boolean).map((l) => { const p = JSON.parse(l) as Pick; return p.task + "|" + p.trial; }) : []);
  const proxy = new MeteringProxy({ ledger: new LaneBReservations(new Ledger(ledgerPath, cfg.item), "picker"), leaseId: "hm-picker-" + cfg.item, host: "127.0.0.1", managementSocket: join(out, "m.sock"),
    managementToken: randomBytes(24).toString("hex"), journal, retry: { attempts: 3, elapsed_ms: 300_000 }, allowanceCode: "DR_ALLOWANCE_STOP" });
  proxy.start();
  try {
    for (const t of cfg.tasks) {
      if (done.has(t.task + "|" + t.trial)) continue;
      const custody = taskCustody(join(cfg.tasks_dir, t.task), JSON.parse(readFileSync(join(cfg.pristine_dir, t.task + ".json"), "utf8")), join(cfg.custody_dir, t.task));
      const pm = pickerModel(cfg.model), allowance = Math.round(MODELS[pm.provider === "openai" ? "sol" : "opus"].allowanceUsd * 1_000_000);
      const cell = { run_id: "hm-picker-" + cfg.item, arm: "picker", task: t.task, model: pm.model, trial: Number(t.trial), attempt: 1 };
      const p = await pickTask({ task: t.task, model: MODELS[cfg.model].id, trial: t.trial, issue: readFileSync(join(cfg.tasks_dir, t.task, "instruction.md"), "utf8"),
        a: { diff: readFileSync(t.a.diff_file, "utf8"), pass: t.a.pass }, b: { diff: readFileSync(t.b.diff_file, "utf8"), pass: t.b.pass } }, cfg.model, proxySend(proxy, cell, allowance, custody));
      appendFileSync(picksPath, JSON.stringify(p) + "\n");
      console.log("PICK " + t.task + " trial " + t.trial + " order " + p.order.join(",") + " ships " + p.ships + " parsed " + p.parsed + " cuts " + p.cuts + " cost " + p.cost_usd.toFixed(4));
    }
  } catch (e) {
    console.error(String((e as Error).message ?? e));
    return 2;
  } finally {
    proxy.stop();
    const j = journalCheck(journal);
    console.log("PICKER LEAK " + (j.pass ? "pass" : "FAIL") + ": " + j.detail);
  }
  return journalCheck(journal).pass ? 0 : 2;
}
