// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-589 change 3: the counted run's check that programs cso3 and cso3b together stay inside the Captain's $170, read
// from the ledger record before each session. Exit 0 admits the next session; exit 10 is a cap stop.
import { envelopeStatus } from "../../../src/runner/ledger/envelope.ts";
import { recordPath } from "../../../src/runner/ledger/paths.ts";

const D = 1_000_000;

export function combinedAdmit(committedMicros: number[], nextMicros: number, capMicros: number): { ok: boolean; total_micros: number } {
  const total = committedMicros.reduce((a, b) => a + b, 0) + nextMicros;
  return { ok: total <= capMicros, total_micros: total };
}

export function combinedCheck(record: string, programs: string[], nextUsd: number, capUsd: number): { ok: boolean; line: string } {
  const committed = programs.map((p) => envelopeStatus(record, p).total.committed_micros);
  const r = combinedAdmit(committed, Math.round(nextUsd * D), Math.round(capUsd * D));
  const held = programs.map((p, i) => p + " $" + (committed[i]! / D).toFixed(6)).join(" + ");
  return { ok: r.ok, line: (r.ok ? "COMBINED: admit " : "COMBINED_STOP ") + held + " + next $" + nextUsd.toFixed(2) + " = $" + (r.total_micros / D).toFixed(6) + (r.ok ? " <= $" : " > $") + capUsd.toFixed(2) };
}

export function main(argv: string[]): number {
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cap = Number(get("--cap")), next = Number(get("--next")), programs = (get("--programs") ?? "").split(",").filter(Boolean);
  if (!(cap > 0) || !(next >= 0) || !programs.length) {
    console.error("E_USAGE usage: bun lanes/outcome-skills/cso/combined-cap.ts --cap <usd> --next <usd> --programs <a,b>");
    return 2;
  }
  const r = combinedCheck(recordPath(get("--ledger-record")).path, programs, next, cap);
  (r.ok ? console.log : console.error)(r.line);
  return r.ok ? 0 : 10;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
