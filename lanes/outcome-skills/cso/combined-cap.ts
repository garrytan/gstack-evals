// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-589 change 3: the counted run's check that programs cso3 and cso3b together stay inside the Captain's $170, before
// each session. It adds the committed spend of the programs named (from the ledger record), the run's own spend so far
// with its running sessions' allowances, the room held for later work such as counted judging, and the next session's
// allowance. Exit 0 admits the next session; exit 10 is a cap stop.
import { envelopeStatus } from "../../../src/runner/ledger/envelope.ts";
import { recordPath } from "../../../src/runner/ledger/paths.ts";

const D = 1_000_000;

export function combinedAdmit(partsMicros: number[], nextMicros: number, capMicros: number): { ok: boolean; total_micros: number } {
  const total = partsMicros.reduce((a, b) => a + b, 0) + nextMicros;
  return { ok: total <= capMicros, total_micros: total };
}

export function combinedCheck(record: string, o: { programs: string[]; spent_usd: number; reserve_usd: number; next_usd: number; cap_usd: number }): { ok: boolean; line: string } {
  const committed = o.programs.map((p) => envelopeStatus(record, p).total.committed_micros);
  const r = combinedAdmit([...committed, Math.round(o.spent_usd * D), Math.round(o.reserve_usd * D)], Math.round(o.next_usd * D), Math.round(o.cap_usd * D));
  const usd = (m: number) => "$" + (m / D).toFixed(6);
  const held = o.programs.map((p, i) => p + " " + usd(committed[i]!)).join(" + ") + " + run " + usd(Math.round(o.spent_usd * D)) + " + reserve " + usd(Math.round(o.reserve_usd * D));
  return { ok: r.ok, line: (r.ok ? "COMBINED: admit " : "COMBINED_STOP ") + held + " + next " + usd(Math.round(o.next_usd * D)) + " = " + usd(r.total_micros) + (r.ok ? " <= $" : " > $") + o.cap_usd.toFixed(2) };
}

export function main(argv: string[]): number {
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (k: string) => Number(get(k) ?? "0");
  const o = { programs: (get("--programs") ?? "").split(",").filter(Boolean), spent_usd: num("--spent"), reserve_usd: num("--reserve"), next_usd: num("--next"), cap_usd: num("--cap") };
  if (!(o.cap_usd > 0) || !o.programs.length || [o.spent_usd, o.reserve_usd, o.next_usd].some((v) => !(v >= 0))) {
    console.error("E_USAGE usage: bun lanes/outcome-skills/cso/combined-cap.ts --cap <usd> --programs <a,b> --next <usd> [--spent <usd>] [--reserve <usd>] [--ledger-record <dir>]");
    return 2;
  }
  const r = combinedCheck(recordPath(get("--ledger-record")).path, o);
  (r.ok ? console.log : console.error)(r.line);
  return r.ok ? 0 : 10;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
