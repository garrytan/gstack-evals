// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dc pins: the keyless probe plan and the pin record (start rule 9). `pins plan --dir <new dir>` writes
// plan.json and prints the shell lines the Captain runs at the go; `pins record --dir <dir> --run <id> --commit <sha>
// --out <file>` parses what the plan fetched into the run's one pin record. Neither calls anything. The lane's cli.ts
// row calls pinsCommand once the CLI wiring adds it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { pinRecord, probePlan, probeScript, readProbe, termsRecordsOf, writePinRecord, type PinRecord, type ProbePlan } from "./pin.ts";

export interface PinsArgs {
  flags: Map<string, string>;
  rest: string[];
}

const need = (a: PinsArgs, f: string) => a.flags.get(f) ?? fail("E_USAGE", "pins " + (a.rest[0] ?? "") + " needs " + f);

export function pinsCommand(a: PinsArgs, io: { out: (t: string) => void }, now: () => Date = () => new Date()): number {
  const sub = a.rest[0];
  if (sub === "plan") {
    const dir = need(a, "--dir");
    if (existsSync(dir)) fail("E_USAGE", "pins plan writes into a directory that doesn't exist yet; " + dir + " exists");
    const plan = probePlan(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
    for (const l of probeScript(plan)) io.out(l);
    return 0;
  }
  if (sub === "record") {
    const dir = need(a, "--dir");
    const file = join(dir, "plan.json");
    if (!existsSync(file)) fail("E_USAGE", "no plan.json in " + dir + "; run pins plan first");
    const plan = JSON.parse(readFileSync(file, "utf8")) as ProbePlan;
    const rec = pinRecord({ runId: need(a, "--run"), commit: need(a, "--commit"), dated: a.flags.get("--dated") ?? now().toISOString(), reads: readProbe(plan) });
    writePinRecord(need(a, "--out"), rec);
    for (const r of rec.routes) io.out(r.model.padEnd(9) + r.provider + ":" + r.id + "  served by " + (r.served ?? "nobody") + (r.problems.length ? "  PROBLEM " + r.problems.join("; ") : ""));
    io.out(rec.ok ? "pins: every route pinned" : "pins: STOP for the Captain, " + rec.routes.filter((r) => r.problems.length).length + " route(s) unpinned");
    return rec.ok ? 0 : 1;
  }
  if (sub === "terms") {
    const rec = JSON.parse(readFileSync(need(a, "--pin"), "utf8")) as PinRecord;
    const out = need(a, "--out");
    if (existsSync(out)) fail("E_USAGE", "pins terms writes a new file; " + out + " exists");
    if (!rec.ok) fail("E_USAGE", "the pin record for run " + rec.runId + " has problems; no terms file is written until the Captain decides");
    const terms = termsRecordsOf(rec);
    writeFileSync(out, JSON.stringify(terms, null, 2) + "\n", { flag: "wx" });
    for (const t of terms) io.out("terms: " + t.model + " served by " + t.provider + ", dated " + t.dated + ", terms " + t.termsDigest.slice(0, 12));
    return 0;
  }
  return fail("E_USAGE", "pins takes plan, record or terms");
}
