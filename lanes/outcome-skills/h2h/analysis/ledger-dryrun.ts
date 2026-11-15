// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless ledger dry run (plan section 15): one lease opened and settled per frozen item on a temporary ledger, at the
// A2 table's caps or an approvals-record override, then the COST rule driven on fixture sessions: planning prices give the
// post's total, a 95th percentile above half the allowance doubles it and prices allowance stops at the doubled amount,
// and a program above the approved total gets the largest frozen n cut that fits. Nothing here spends.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../../../src/runner/ledger/envelope.ts";
import { machineId, openLease, recordApproval, settleLease } from "../../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../../src/runner/ledger/local.ts";
import { MICROS_PER_USD } from "../../../../src/runner/ledger/money.ts";
import { readItem } from "../../../../src/runner/ledger/record.ts";
import { ITEMS } from "../items.ts";
import type { H2hPrereg } from "../prereg.ts";
import { planningPrice } from "../rerun.ts";
import { PIECE_G_ARMS, PRIMARY_ARMS, type H2hArm, type H2hSession, type SessionEnd, type UnitClass } from "../types.ts";
import { postCaps, reprice } from "./cost.ts";

export interface Check { name: string; ok: boolean; detail: string }

const fixture = (arm: H2hArm, cls: UnitClass, usd: number, end: SessionEnd = "completed") => ({ s: { arm, cost_usd: usd, end } as H2hSession, cls });
/** One stage 1 session per arm and class at planning prices, scaled. */
const planned = (scale: number) => [
  ...PRIMARY_ARMS.flatMap((a) => [fixture(a, "O", scale * planningPrice(a, "O")), fixture(a, "B", scale * planningPrice(a, "B"))]),
  ...PIECE_G_ARMS.map((a) => fixture(a, "O", scale * planningPrice(a, "O"))), fixture("gstack-qa", "B", scale * planningPrice("gstack-qa", "B")),
];

export function ledgerDryRun(p: H2hPrereg, o: { dir?: string; caps?: Record<string, number> } = {}): { dir: string; checks: Check[] } {
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), "h2h-ledger-dryrun-"));
  mkdirSync(dir, { recursive: true });
  const checks: Check[] = [];
  const rule = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const post = postCaps();
  const caps = { ...post.caps, ...(o.caps ?? {}) };
  const total = Object.values(caps).reduce((a, x) => a + x, 0);
  const quote = { words: "dry-run fixture words on a temporary ledger, not an approval", by: "h2h-ledger-dryrun", source: "lanes/outcome-skills/h2h/analysis/ledger-dryrun.ts" };
  const record = join(dir, "record");
  recordProgram(record, { program: "h2h", cap_micros: total * MICROS_PER_USD, skill_cap_micros: total * MICROS_PER_USD, skills: ["h2h"], credit_rate_micros: MICROS_PER_USD, quotes: [quote] });
  const local = LocalLedger.open(join(dir, "ledger.sqlite"));
  const machine = machineId();
  for (const item of Object.keys(ITEMS)) {
    recordApproval(record, { action: "init", item, cap_micros: caps[item]! * MICROS_PER_USD, quotes: [quote], admission: "required", program: "h2h", skills: ["h2h"] });
    settleLease(record, local, openLease(record, local, { item, run_id: "h2h-dryrun", machine_id: machine, requireAdmission: () => null }).lease_id);
    const it = readItem(record, item);
    rule("ledger lease " + item, it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null && it.cap_micros === caps[item]! * MICROS_PER_USD, "cap $" + caps[item] + ", leases " + it.leases.length + ", spent " + it.leases[0]?.close?.spent_micros + " micros");
  }
  rule("caps add to the approved total", total === post.total, "$" + total + " against the A2 table's $" + post.total);

  const flat = reprice(p, planned(1), { caps });
  rule("COST at planning prices gives the post's caps", !flat.above && flat.caps["h2h-opus"] === post.caps["h2h-opus"] && flat.caps["h2h-qa"] === post.caps["h2h-qa"] && flat.caps["h2h-pony"] === post.caps["h2h-pony"] && flat.total_at_caps === post.total, "opus $" + flat.caps["h2h-opus"] + ", qa $" + flat.caps["h2h-qa"] + ", pony $" + flat.caps["h2h-pony"] + ", total $" + flat.total_at_caps);

  const half = p.limits.allowance_usd / 2;
  const hot = reprice(p, [...planned(1), fixture("gsd", "O", half + 0.5), fixture("gsd", "O", p.limits.allowance_usd, "limit_allowance")], { caps });
  const gsdO = hot.costs["gsd"]?.["O"];
  rule("a 95th percentile above half the allowance doubles it and prices allowance stops at the doubled amount", hot.doubled && hot.allowance_usd === 2 * p.limits.allowance_usd && gsdO?.allowance_stops === 1 && Math.abs(gsdO.mean! - (planningPrice("gsd", "O") + half + 0.5 + 2 * p.limits.allowance_usd) / 3) < 1e-9, "max p95 " + hot.max_p95?.arm + " $" + hot.max_p95?.usd.toFixed(2) + ", allowance $" + hot.allowance_usd + ", gsd O mean $" + gsdO?.mean?.toFixed(2));

  const dear = reprice(p, planned(3), { caps });
  const cut = dear.n_cut;
  rule("a program above the approved total gets the frozen n cut that fits", dear.above && !!cut && cut.total_at_caps <= post.total && cut.n_O < p.classes.O.n && cut.n_B === Math.floor(cut.factor * p.classes.B.n + 1e-9), cut ? "total $" + dear.total_at_caps + " above $" + post.total + "; factor " + cut.factor.toFixed(4) + " gives O " + cut.n_O + ", B " + cut.n_B + ", /qa " + cut.n_qa + " at $" + cut.total_at_caps : "no cut fits");
  return { dir, checks };
}
