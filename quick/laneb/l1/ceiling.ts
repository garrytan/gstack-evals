// L1 ceiling check and final read (the L1 superseding preregistration, section 9). Keyless: it reads the Lane B ledger file
// the launches share, a crew file the operator writes from each L1 thread's Capy counter (credits and tokens; the repo never
// calls a Capy API) and the plan of L1 items. Money is summed in integer micro-dollars; a thread's dollars are credits / 1000.
//
// The sum: every L1 ledger item's settled and reserved spend (an item not yet done counts at the larger of that and its cap,
// so the caps of every planned item still to run are in it); the credits / 1000 of every L1 thread and of the Captain's
// booked L1 turns; and a holdback. The holdback is the larger of the crew line's unspent remainder ($700 less crew spend, never
// below zero) and the sum over open and planned L1 threads (crew and run-work lines alike) of each one's unspent token stop at
// the measured L1 dollars per token so far, plus the Captain line's unspent remainder ($40) and each leftover model's run-work
// remainder ($15) while that model is pending. check refuses a launch whose sum passes L1's line, a launch while any item,
// the launch's own included, holds open reservations (items and the parts of one item launch one at a time), and a launch
// whose plan item runs after another item that is not done yet. final gives the all-in figure before the results post and the largest token stop the post
// thread can have so that figure, the holds still open and the stop at the measured rate stay at or under the line.
// f1-sol, f1-sol-offu and f1-p1 run four parts one after another, so a done mark set between parts would leave the parts still
// to run out of the sum: each counts as done only with its run's finished-run record (--work <its work dir>: a result for every
// part and every prepared relaunch, a relaunch record for every part that ended with a loss and no cap stop, and every host the
// run brought up gone, the last by host-down with its hours settled), and until then at the larger of its spend and its cap.
// L1's line is $3,300 all-in: the prereg's $2,000, raised by the project owner so particle-1 can run after Sol (Amendment E).
// The plan file carries it as ceiling_usd, and the command line refuses a plan at any other line.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readRows, totals, type Row } from "../runner/ledger.ts";

export const CEILING_USD = 3300;
export const CREW_LINE_USD = 700;
export const CAPTAIN_LINE_USD = 40;
export const RUN_WORK_LINE_USD = 15;
/** Section 9's planning rate, used only until any L1 thread has a token reading. */
export const PLANNING_USD_PER_MTOK = 0.45;
export const RUN_RECORD_ITEMS = ["f1-sol", "f1-sol-offu", "f1-p1"];
const M = 1_000_000;

export class UsageError extends Error {}

export type CrewThread = { code: string; line: "crew" | "sol" | "particle"; credits: number; tokens: number; token_stop: number | null; status: "open" | "planned" | "done" };
export type Crew = { as_of: string; threads: CrewThread[]; captain_credits: number };
// after: the plan item that must be done before this one launches (Amendment E's order: Sol's items, then particle-1's).
export type PlanItem = { item: string; cap_usd: number; status: "planned" | "open" | "done"; after?: string };
export type Plan = { ceiling_usd?: number; items: PlanItem[]; leftover: { sol: "pending" | "done" | "refused"; particle: "pending" | "done" | "refused" } };

const micros = (usd: number) => Math.round(usd * M);
const amount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const usd = (m: number) => (m / M).toFixed(2);

// voided: the ledgers of runs voided before any session ran (Amendment D's pilot-opus run 92231acce642809f). Their settled and
// open reserved spend counts in the sum; they place no item and never count against an item's cap.
// finished: the items of RUN_RECORD_ITEMS whose finished-run record holds (finishedRun).
export function tally(ledgerRows: Row[], crew: Crew, plan: Plan, exclude: string | null = null, voided: Row[][] = [], finished: string[] = []) {
  if (!Array.isArray(plan?.items) || !plan.leftover) throw new UsageError("E_USAGE l1 ceiling: the plan needs items [{item, cap_usd, status}] and leftover {sol, particle}");
  if (!Array.isArray(crew?.threads) || typeof crew.captain_credits !== "number") throw new UsageError("E_USAGE l1 ceiling: the crew file needs threads [{code, line, credits, tokens, token_stop, status}] and captain_credits");
  if (!amount(crew.captain_credits)) throw new UsageError("E_USAGE l1 ceiling: captain_credits must be a number of at least 0");
  for (const t of crew.threads) {
    if (!["crew", "sol", "particle"].includes(t?.line)) throw new UsageError("E_USAGE l1 ceiling: thread " + t?.code + " has line " + JSON.stringify(t?.line) + ", not crew, sol or particle");
    if (!["open", "planned", "done"].includes(t.status)) throw new UsageError("E_USAGE l1 ceiling: thread " + t.code + " has status " + JSON.stringify(t.status) + ", not open, planned or done");
    if (!amount(t.credits) || !amount(t.tokens)) throw new UsageError("E_USAGE l1 ceiling: thread " + t.code + " needs credits and tokens, each a number of at least 0");
  }
  for (const p of plan.items) if (typeof p?.item !== "string" || !amount(p.cap_usd) || !["planned", "open", "done"].includes(p.status)) throw new UsageError("E_USAGE l1 ceiling: plan item " + JSON.stringify(p?.item) + " needs cap_usd, a number of at least 0, and status planned, open or done");
  for (const p of plan.items) if (p.after !== undefined && (typeof p.after !== "string" || p.after === p.item || !plan.items.some((q) => q.item === p.after))) throw new UsageError("E_USAGE l1 ceiling: plan item " + p.item + " runs after " + p.after + ", which is not another item of the plan");
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
    const unproven = p.status === "done" && RUN_RECORD_ITEMS.includes(p.item) && !finished.includes(p.item);
    return { ...p, settled: t.settledMicros, reserved: t.openReservedMicros, open_ids: t.openIds.length, unproven, counted: p.status === "done" && !unproven ? spent : Math.max(cap, spent) };
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
  const voidedSpent = voided.reduce((x, rows) => { const v = totals(rows); return x + v.settledMicros + v.openReservedMicros; }, 0);
  const spentTotal = itemsTotal + voidedSpent + allCredits + captainSpent;
  return { items, itemsTotal, voidedSpent, crewSpent, solSpent, particleSpent, captainSpent, perToken, stops, crewHold, captainHold, runWorkHold, holdback: crewHold + captainHold + runWorkHold, spentTotal, total: spentTotal + crewHold + captainHold + runWorkHold };
}

export function check(ledgerRows: Row[], crew: Crew, plan: Plan, launch: string, voided: Row[][] = [], finished: string[] = []) {
  const t = tally(ledgerRows, crew, plan, null, voided, finished);
  const item = t.items.find((i) => i.item === launch);
  if (!item || item.status === "done") throw new UsageError("E_USAGE l1 ceiling: " + launch + " is not a planned or open item of the plan");
  const busy = t.items.filter((i) => i.open_ids > 0).map((i) => i.item);
  const over = t.total > micros(CEILING_USD);
  const early = item.after !== undefined && t.items.find((i) => i.item === item.after)!.status !== "done" ? item.after : null;
  const ok = !over && !busy.length && !early;
  const why = early ? launch + " runs only after " + early + " is done (Amendment E): mark " + early + " done once every part has finished and host-down has settled, then run this check again" : over ? "the sum $" + usd(t.total) + " with " + launch + "'s cap passes $" + usd(micros(CEILING_USD)) : busy.length ? busy.join(", ") + " still holds open reservations: items launch one at a time; after a part's VM is confirmed gone, settle each of its open reserves at its full reserved amount (bun quick/laneb/runner/ledger.ts settle --detail <the dead VM>), then run this check for its one relaunch" : "the sum $" + usd(t.total) + " with " + launch + "'s cap is at or under $" + usd(micros(CEILING_USD));
  return { ok, launch, why, tally: t };
}

export function finalRead(ledgerRows: Row[], crew: Crew, plan: Plan, post: string, voided: Row[][] = [], finished: string[] = []) {
  const t = tally(ledgerRows, crew, plan, post, voided, finished);
  if (t.perToken === 0) throw new UsageError("E_USAGE l1 ceiling: the crew file holds tokens but no credits, so there is no measured rate to size the post thread's stop");
  const holds = t.captainHold + t.runWorkHold + t.stops;
  const room = micros(CEILING_USD) - t.spentTotal - holds;
  const maxStop = room > 0 ? Math.floor(room / t.perToken) : 0;
  return { post, all_in: t.spentTotal, holds, room, max_post_token_stop: maxStop, open_items: t.items.filter((i) => i.status !== "done" || i.unproven).map((i) => i.item), tally: t };
}

// An f1-sol, f1-sol-offu or f1-p1 work dir's finished-run record, from what l1.ts writes there: plan.json's parts, a
// <part>.result.json for each part and each prepared relaunch (<part>-relaunch/l1-part.json), a <part>.relaunch.json for each
// planned part whose result holds a loss and no cap stop (the one relaunch it owes; a relaunch's own loss owes none), and
// host/hosts.jsonl, where every host that came up is
// gone (a host-down whose hours settled, a failed host-up confirmed down, or a host recover rebuilt) and the last row is a
// host-down whose hours settled.
export function finishedRun(work: string): { item: string; finished: boolean } {
  if (!existsSync(join(work, "plan.json"))) throw new UsageError("E_USAGE l1 ceiling: --work " + work + " has no plan.json");
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (!RUN_RECORD_ITEMS.includes(plan?.item) || !Array.isArray(plan.parts)) throw new UsageError("E_USAGE l1 ceiling: --work takes the work dir of f1-sol, f1-sol-offu or f1-p1, not " + work);
  const parts = plan.parts.flatMap((p: { name: string }) => [p.name, ...(existsSync(join(work, p.name + "-relaunch", "l1-part.json")) ? [p.name + "-relaunch"] : [])]);
  const owed = plan.parts.some((p: { name: string }) => {
    const r = join(work, p.name + ".result.json");
    if (!existsSync(r)) return false;
    const result = JSON.parse(readFileSync(r, "utf8"));
    return result?.loss?.length > 0 && !result.cap_stop?.length && !existsSync(join(work, p.name + ".relaunch.json"));
  });
  const hostsPath = join(work, "host/hosts.jsonl");
  const hosts = existsSync(hostsPath) ? readFileSync(hostsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const gone = (n: unknown) => hosts.some((h) => h.n === n && (h.event === "lost" || (h.event === "down" && (h.settled === true || h.down_confirmed === true))));
  const ups = hosts.filter((h) => h.event === "up"), last = hosts.at(-1);
  const finished = parts.every((p: string) => existsSync(join(work, p + ".result.json"))) && !owed && ups.length > 0 && ups.every((h) => gone(h.n)) && last?.event === "down" && last.settled === true;
  return { item: plan.item, finished };
}

export function render(r: ReturnType<typeof check>): string {
  const t = r.tally;
  const lines = t.items.map((i) => "  " + i.item + " " + i.status + ": settled $" + usd(i.settled) + ", reserved $" + usd(i.reserved) + ", cap $" + usd(micros(i.cap_usd)) + ", counted $" + usd(i.counted) + (i.unproven ? " (done with no finished-run record from --work, so at its cap)" : ""));
  return [
    "CEILING " + (r.ok ? "PASS" : "REFUSE") + " " + r.launch + ": " + r.why,
    ...lines,
    ...(t.voidedSpent ? ["  voided runs: $" + usd(t.voidedSpent)] : []),
    "  crew $" + usd(t.crewSpent) + ", Sol run work $" + usd(t.solSpent) + ", particle-1 run work $" + usd(t.particleSpent) + ", Captain $" + usd(t.captainSpent),
    "  holdback $" + usd(t.holdback) + " = crew $" + usd(t.crewHold) + " (unspent stops $" + usd(t.stops) + " at $" + (t.perToken).toFixed(3) + " per million tokens) + Captain $" + usd(t.captainHold) + " + run work $" + usd(t.runWorkHold),
  ].join("\n");
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const cmd = argv[0];
  const flag = (name: string) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));
  try {
    const ledgers = flag("--ledger"), voids = flag("--void-ledger"), works = flag("--work"), crewPath = flag("--crew")[0], planPath = flag("--plan")[0];
    if ((cmd !== "check" && cmd !== "final") || !ledgers.length || !crewPath || !planPath) throw new UsageError("E_USAGE usage: bun quick/laneb/l1/ceiling.ts check|final --ledger <ledger.jsonl> [--ledger ...] [--void-ledger <ledger.jsonl> ...] [--work <f1-sol, f1-sol-offu or f1-p1 work dir> ...] --crew <crew.json> --plan <plan.json> (--launch <item> | --post <thread>)");
    for (const p of [...ledgers, ...voids]) if (!existsSync(p)) throw new UsageError("E_USAGE l1 ceiling: no ledger at " + p);
    if (voids.some((p) => ledgers.some((q) => resolve(q) === resolve(p)))) throw new UsageError("E_USAGE l1 ceiling: a ledger can't be both an item's ledger and a voided run's");
    const rows = ledgers.flatMap((p) => readRows(p)), voided = voids.map((p) => readRows(p));
    const runs = works.map((w) => finishedRun(resolve(w)));
    for (const r of runs) if (runs.filter((x) => x.item === r.item).length > 1) throw new UsageError("E_USAGE l1 ceiling: two --work dirs for " + r.item);
    const finished = runs.filter((r) => r.finished).map((r) => r.item);
    const crew = JSON.parse(readFileSync(crewPath, "utf8")) as Crew;
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
    if (plan?.ceiling_usd === undefined) throw new UsageError("E_USAGE l1 ceiling: the plan has no ceiling_usd; L1's line is $" + CEILING_USD + " (Amendment E)");
    if (plan.ceiling_usd !== CEILING_USD) throw new UsageError("E_USAGE l1 ceiling: the plan's line is $" + plan.ceiling_usd + ", but L1's line is $" + CEILING_USD + " (Amendment E)");
    if (cmd === "check") {
      const launch = flag("--launch")[0];
      if (!launch) throw new UsageError("E_USAGE l1 ceiling: check needs --launch <item>");
      const r = check(rows, crew, plan, launch, voided, finished);
      console.log(render(r));
      process.exit(r.ok ? 0 : 1);
    }
    const post = flag("--post")[0];
    if (!post) throw new UsageError("E_USAGE l1 ceiling: final needs --post <thread>");
    const f = finalRead(rows, crew, plan, post, voided, finished);
    console.log("FINAL all-in $" + usd(f.all_in) + ", holds $" + usd(f.holds) + ", room $" + usd(Math.max(0, f.room)) + ": the post thread " + post + " can have a token stop of at most " + f.max_post_token_stop + (f.open_items.length ? "; items not done" + (f.tally.items.some((i) => i.unproven) ? ", or done with no finished-run record," : ",") + " counted at their caps: " + f.open_items.join(", ") : ""));
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : "E_USAGE l1 ceiling: " + String(e));
    process.exit(2);
  }
}
