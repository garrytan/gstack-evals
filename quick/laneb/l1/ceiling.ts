// L1 ceiling check and final read (the L1 superseding preregistration, section 9). Keyless: it reads the Lane B ledger file
// the launches share, a crew file the operator writes from each L1 thread's Capy counter (credits and tokens; the repo never
// calls a Capy API) and the plan of L1 items. Money is summed in integer micro-dollars; a thread's dollars are credits / 1000.
//
// The sum: every L1 ledger item's settled and reserved spend (an item not yet done counts at the larger of that and its cap,
// so the caps of every planned item still to run are in it); the credits / 1000 of every L1 thread and of the Captain's
// booked L1 turns; and a holdback. The holdback is the larger of the crew line's unspent remainder ($400 less crew spend, never
// below zero) and the sum over open and planned L1 threads (crew and run-work lines alike) of each one's unspent token stop at
// the measured L1 dollars per token so far, plus the Captain line's unspent remainder ($40) and each leftover model's run-work
// remainder ($15) while that model is pending. check refuses a launch whose sum passes $2,000, and a launch while any item,
// the launch's own included, holds open reservations (items and the parts of one item launch one at a time). final gives the all-in figure before the results post and the largest token stop the post
// thread can have so that figure, the holds still open and the stop at the measured rate stay at or under $2,000.
import { existsSync, readFileSync } from "node:fs";
import { readRows, totals, type Row } from "../runner/ledger.ts";

export const CEILING_USD = 2000;
export const CREW_LINE_USD = 400;
export const CAPTAIN_LINE_USD = 40;
export const RUN_WORK_LINE_USD = 15;
/** Section 9's planning rate, used only until any L1 thread has a token reading. */
export const PLANNING_USD_PER_MTOK = 0.45;
const M = 1_000_000;

export class UsageError extends Error {}

export type CrewThread = { code: string; line: "crew" | "sol" | "particle"; credits: number; tokens: number; token_stop: number | null; status: "open" | "planned" | "done" };
export type Crew = { as_of: string; threads: CrewThread[]; captain_credits: number };
export type PlanItem = { item: string; cap_usd: number; status: "planned" | "open" | "done" };
export type Plan = { items: PlanItem[]; leftover: { sol: "pending" | "done" | "refused"; particle: "pending" | "done" | "refused" } };

const micros = (usd: number) => Math.round(usd * M);
const amount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const usd = (m: number) => (m / M).toFixed(2);

export function tally(ledgerRows: Row[], crew: Crew, plan: Plan, exclude: string | null = null) {
  if (!Array.isArray(plan?.items) || !plan.leftover) throw new UsageError("E_USAGE l1 ceiling: the plan needs items [{item, cap_usd, status}] and leftover {sol, particle}");
  if (!Array.isArray(crew?.threads) || typeof crew.captain_credits !== "number") throw new UsageError("E_USAGE l1 ceiling: the crew file needs threads [{code, line, credits, tokens, token_stop, status}] and captain_credits");
  if (!amount(crew.captain_credits)) throw new UsageError("E_USAGE l1 ceiling: captain_credits must be a number of at least 0");
  for (const t of crew.threads) {
    if (!["crew", "sol", "particle"].includes(t?.line)) throw new UsageError("E_USAGE l1 ceiling: thread " + t?.code + " has line " + JSON.stringify(t?.line) + ", not crew, sol or particle");
    if (!["open", "planned", "done"].includes(t.status)) throw new UsageError("E_USAGE l1 ceiling: thread " + t.code + " has status " + JSON.stringify(t.status) + ", not open, planned or done");
    if (!amount(t.credits) || !amount(t.tokens)) throw new UsageError("E_USAGE l1 ceiling: thread " + t.code + " needs credits and tokens, each a number of at least 0");
  }
  for (const p of plan.items) if (typeof p?.item !== "string" || !amount(p.cap_usd) || !["planned", "open", "done"].includes(p.status)) throw new UsageError("E_USAGE l1 ceiling: plan item " + JSON.stringify(p?.item) + " needs cap_usd, a number of at least 0, and status planned, open or done");
  for (const k of ["sol", "particle"] as const) if (!["pending", "done", "refused"].includes(plan.leftover[k])) throw new UsageError("E_USAGE l1 ceiling: leftover." + k + " is " + JSON.stringify(plan.leftover[k]) + ", not pending, done or refused");
  const byItem = new Map<string, Row[]>();
  for (const r of ledgerRows) byItem.set(r.item, [...(byItem.get(r.item) ?? []), r]);
  for (const item of byItem.keys()) if (!plan.items.some((p) => p.item === item)) throw new UsageError("E_USAGE l1 ceiling: ledger item " + item + " is not in the plan, so the check can't place it");
  const items = plan.items.map((p) => {
    const rows = byItem.get(p.item) ?? [];
    const t = rows.length ? totals(rows) : { capMicros: null as number | null, settledMicros: 0, openReservedMicros: 0, openIds: [] as string[] };
    const cap = micros(p.cap_usd);
    if (t.capMicros !== null && t.capMicros !== cap) throw new UsageError("E_USAGE l1 ceiling: item " + p.item + " has cap $" + usd(cap) + " in the plan and $" + usd(t.capMicros) + " in the ledger");
    const spent = t.settledMicros + t.openReservedMicros;
    return { ...p, settled: t.settledMicros, reserved: t.openReservedMicros, open_ids: t.openIds.length, counted: p.status === "done" ? spent : Math.max(cap, spent) };
  });
  const credits = (line: CrewThread["line"]) => micros(crew.threads.filter((t) => t.line === line).reduce((x, t) => x + t.credits, 0) / 1000);
  const crewSpent = credits("crew"), solSpent = credits("sol"), particleSpent = credits("particle");
  const captainSpent = micros(crew.captain_credits / 1000);
  const tokens = crew.threads.reduce((x, t) => x + t.tokens, 0);
  const allCredits = crewSpent + solSpent + particleSpent;
  const perToken = tokens > 0 ? allCredits / tokens : PLANNING_USD_PER_MTOK;
  const openThreads = crew.threads.filter((t) => t.status !== "done" && t.code !== exclude);
  for (const t of openThreads) if (!amount(t.token_stop)) throw new UsageError("E_USAGE l1 ceiling: open thread " + t.code + " has no token_stop");
  for (const i of items) if (i.status === "done" && !byItem.has(i.item)) throw new UsageError("E_USAGE l1 ceiling: item " + i.item + " is done but has no ledger rows, so its spend can't be counted");
  if (perToken === 0 && openThreads.some((t) => t.token_stop! > t.tokens)) throw new UsageError("E_USAGE l1 ceiling: the crew file holds tokens but no credits, so there is no measured rate to hold the open stops at");
  const stops = Math.round(openThreads.reduce((x, t) => x + Math.max(0, t.token_stop! - t.tokens), 0) * perToken);
  const crewHold = Math.max(Math.max(0, micros(CREW_LINE_USD) - crewSpent), stops);
  const captainHold = Math.max(0, micros(CAPTAIN_LINE_USD) - captainSpent);
  const runWorkHold = (plan.leftover.sol === "pending" ? Math.max(0, micros(RUN_WORK_LINE_USD) - solSpent) : 0) + (plan.leftover.particle === "pending" ? Math.max(0, micros(RUN_WORK_LINE_USD) - particleSpent) : 0);
  const itemsTotal = items.reduce((x, i) => x + i.counted, 0);
  const spentTotal = itemsTotal + allCredits + captainSpent;
  return { items, itemsTotal, crewSpent, solSpent, particleSpent, captainSpent, perToken, stops, crewHold, captainHold, runWorkHold, holdback: crewHold + captainHold + runWorkHold, spentTotal, total: spentTotal + crewHold + captainHold + runWorkHold };
}

export function check(ledgerRows: Row[], crew: Crew, plan: Plan, launch: string) {
  const t = tally(ledgerRows, crew, plan);
  const item = t.items.find((i) => i.item === launch);
  if (!item || item.status === "done") throw new UsageError("E_USAGE l1 ceiling: " + launch + " is not a planned or open item of the plan");
  const busy = t.items.filter((i) => i.open_ids > 0).map((i) => i.item);
  const over = t.total > micros(CEILING_USD);
  const ok = !over && !busy.length;
  const why = over ? "the sum $" + usd(t.total) + " with " + launch + "'s cap passes $" + usd(micros(CEILING_USD)) : busy.length ? busy.join(", ") + " still holds open reservations: items launch one at a time" : "the sum $" + usd(t.total) + " with " + launch + "'s cap is at or under $" + usd(micros(CEILING_USD));
  return { ok, launch, why, tally: t };
}

export function finalRead(ledgerRows: Row[], crew: Crew, plan: Plan, post: string) {
  const t = tally(ledgerRows, crew, plan, post);
  if (t.perToken === 0) throw new UsageError("E_USAGE l1 ceiling: the crew file holds tokens but no credits, so there is no measured rate to size the post thread's stop");
  const holds = t.captainHold + t.runWorkHold + t.stops;
  const room = micros(CEILING_USD) - t.spentTotal - holds;
  const maxStop = room > 0 ? Math.floor(room / t.perToken) : 0;
  return { post, all_in: t.spentTotal, holds, room, max_post_token_stop: maxStop, open_items: t.items.filter((i) => i.status !== "done").map((i) => i.item), tally: t };
}

export function render(r: ReturnType<typeof check>): string {
  const t = r.tally;
  const lines = t.items.map((i) => "  " + i.item + " " + i.status + ": settled $" + usd(i.settled) + ", reserved $" + usd(i.reserved) + ", cap $" + usd(micros(i.cap_usd)) + ", counted $" + usd(i.counted));
  return [
    "CEILING " + (r.ok ? "PASS" : "REFUSE") + " " + r.launch + ": " + r.why,
    ...lines,
    "  crew $" + usd(t.crewSpent) + ", Sol run work $" + usd(t.solSpent) + ", particle-1 run work $" + usd(t.particleSpent) + ", Captain $" + usd(t.captainSpent),
    "  holdback $" + usd(t.holdback) + " = crew $" + usd(t.crewHold) + " (unspent stops $" + usd(t.stops) + " at $" + (t.perToken).toFixed(3) + " per million tokens) + Captain $" + usd(t.captainHold) + " + run work $" + usd(t.runWorkHold),
  ].join("\n");
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const cmd = argv[0];
  const flag = (name: string) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));
  try {
    const ledgers = flag("--ledger"), crewPath = flag("--crew")[0], planPath = flag("--plan")[0];
    if ((cmd !== "check" && cmd !== "final") || !ledgers.length || !crewPath || !planPath) throw new UsageError("E_USAGE usage: bun quick/laneb/l1/ceiling.ts check|final --ledger <ledger.jsonl> [--ledger ...] --crew <crew.json> --plan <plan.json> (--launch <item> | --post <thread>)");
    for (const p of ledgers) if (!existsSync(p)) throw new UsageError("E_USAGE l1 ceiling: no ledger at " + p);
    const rows = ledgers.flatMap((p) => readRows(p));
    const crew = JSON.parse(readFileSync(crewPath, "utf8")) as Crew;
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
    if (cmd === "check") {
      const launch = flag("--launch")[0];
      if (!launch) throw new UsageError("E_USAGE l1 ceiling: check needs --launch <item>");
      const r = check(rows, crew, plan, launch);
      console.log(render(r));
      process.exit(r.ok ? 0 : 1);
    }
    const post = flag("--post")[0];
    if (!post) throw new UsageError("E_USAGE l1 ceiling: final needs --post <thread>");
    const f = finalRead(rows, crew, plan, post);
    console.log("FINAL all-in $" + usd(f.all_in) + ", holds $" + usd(f.holds) + ", room $" + usd(Math.max(0, f.room)) + ": the post thread " + post + " can have a token stop of at most " + f.max_post_token_stop + (f.open_items.length ? "; items not done, counted at their caps: " + f.open_items.join(", ") : ""));
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : "E_USAGE l1 ceiling: " + String(e));
    process.exit(2);
  }
}
