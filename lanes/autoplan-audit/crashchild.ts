// Copyright (c) 2026 Garry Tan. MIT License.
// The dry run's crash child: it opens the metered client on a temporary ledger with a stub provider, asks one request
// through the request journal and exits with status 137 at the named point (after send, after settlement, before or
// after the cache write), so the parent can relaunch and check the reconciliation. Only the dry run starts it.
import { Journal, ask, type Crash } from "./journal.ts";
import { openMeter } from "./meter.ts";
import { parseVote } from "./judge.ts";
import { DRY_ENV, reply, stubUpstream } from "./fixtures.ts";

const [sink, record, ledger, item, point, cell, status] = process.argv.slice(2) as [string, string, string, string, Crash | "none", string, string];
const die = (): never => process.exit(137);
const meter = await openMeter({ item, runId: item, out: sink, maxOutputTokens: 16_000, record, ledger, env: DRY_ENV, fetch: stubUpstream(() => {
  if (point === "after-send") die();
  return Number(status) === 200 ? reply("LANDED", "the plan states it") : { status: Number(status) };
}) });
const j = new Journal(sink + "/journal", point === "none" || point === "after-send" ? undefined : { at: point, cell, exit: die });
j.reconcile();
const r = await ask(j, meter.call, { model: "opus", prompt: "The plan states it. One packet.", maxTokens: 8000, effort: "medium", label: cell }, (t) => parseVote(t, "the plan states it"));
await meter.close();
console.log(JSON.stringify({ label: r.label, missing: r.missing, cached: r.cached }));
