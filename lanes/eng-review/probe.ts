// Copyright (c) 2026 Garry Tan. MIT License.
// er probe (prereg 2026-11-08-geva-405, section 11): the descriptive recognition probe. "ask" sends Opus 5.5, with no
// gstack and no lens, one call per calibration unit through the metered client on a named ledger item, asking what
// changed in the project in the 60 days after the merge. "tally" reads the production judge's labels of the replies
// and names the recognized units. Build-time choices: the call carries the repository's owner/name, the merge date and
// plan.md, and no reasoning effort (the none arm's default); the reply is a JSON object of at most 8 changes, normalized
// like a checks list and labelled as a list by Astra (the production judge of Opus lists) with the production brief
// against the unit's primary items (packets --kind recognition); an unreadable reply is resent once and then counts as
// an empty list (unread). A unit is recognized when the judge credits the reply with at least one primary item; one with
// an unlabelled primary cell and no credit reads unread, never not recognized.
import { join } from "node:path";
import type { Io } from "./cli.ts";
import { need, parseArgs, PvError, readJson, readRecords, refuseAliases, refuseInRepo, writeJson } from "../product-value/io.ts";
import { lastJson, RESEND_NOTE } from "../product-value/judge.ts";
import { loadPrompt, openErJudge, type Caller } from "./judge.ts";
import type { LabelRecord, PacketMap } from "./packets.ts";
import { loadUnits, readPlan, type LoadedUnit } from "./units.ts";
import { isDrawn } from "./types.ts";

export const probeInput = (u: LoadedUnit): string => "PROJECT\n" + u.meta.repo + "\n\nMERGED\n" + u.meta.merged_at.slice(0, 10) + "\n\nPLAN\n" + readPlan(u).trim();

export interface ProbeReply {
  changes: string[];
  model_id: string;
  version: string | null;
  unread: boolean;
}

export async function askUnit(u: LoadedUnit, call: Caller): Promise<ProbeReply> {
  const base = loadPrompt("recognition").replace("{{PACKET}}", probeInput(u));
  let last: ProbeReply = { changes: [], model_id: "", version: null, unread: true };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await call({ judge: "opus", prompt: attempt === 1 ? base : base + RESEND_NOTE, effort: "", maxTokens: 4_000, label: "probe:" + u.meta.id + ":" + attempt });
    const v = r.text === null ? null : lastJson(r.text);
    const ok = v && Array.isArray(v.changes) && v.changes.every((c: unknown) => typeof c === "string");
    last = { changes: ok ? v.changes.slice(0, 8) : [], model_id: r.model_id, version: r.version, unread: !ok };
    if (ok) break;
  }
  return last;
}

export interface Tally {
  recognized: string[];
  not: string[];
  unread: string[];
}

/** Recognized: the production judge credits the reply with a primary item; unread: an unlabelled cell and no credit. */
export function tally(map: PacketMap, labels: readonly LabelRecord[], replies?: Record<string, { unread: boolean }>): Tally {
  const out: Tally = { recognized: [], not: [], unread: [] };
  for (const meta of Object.values(map.packets).filter((m) => m.role === "recognition").sort((a, b) => (a.unit < b.unit ? -1 : 1))) {
    const mine = labels.filter((l) => l.packet === meta.id && l.judge === meta.judges[0]);
    const cells = Object.keys(meta.lists).flatMap((l) => Object.keys(meta.items).map((i) => mine.find((x) => x.list === l && x.item === i)?.label ?? null));
    if (cells.some((c) => c?.anticipated)) out.recognized.push(meta.unit);
    else if (cells.some((c) => c === null) || replies?.[meta.unit]?.unread) out.unread.push(meta.unit);
    else out.not.push(meta.unit);
  }
  return out;
}

const USAGE = "gstack-evals er probe ask --units <dir> --item <ledger item> --run-id <id> --out <replies.json> --cache <dir> [--run <dir>] [--record <dir>] [--ledger <path>]\n  gstack-evals er probe tally --map <recognition map.json> --labels <labels.ndjson> --replies <replies.json> --out <recognized.json>";

export async function run(argv: string[], io: Io, o: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "tally") {
    const a = parseArgs(rest, { map: "one", labels: "many", replies: "one", out: "one" }, USAGE);
    need(a, ["map", "labels", "replies", "out"], USAGE);
    refuseAliases([["--map", a.one.map!], ["--replies", a.one.replies!], ["--out", a.one.out!], ...a.many.labels!.map((p) => ["--labels", p] as [string, string])]);
    refuseInRepo("--out", a.one.out!);
    const t = tally(readJson<PacketMap>(a.one.map!, "recognition map"), a.many.labels!.flatMap((p) => readRecords<LabelRecord>(p, "labels file")), readJson<{ units: Record<string, { unread: boolean }> }>(a.one.replies!, "probe replies").units);
    writeJson(a.one.out!, { version: 1, ...t });
    io.out("er probe tally: " + t.recognized.length + " recognized, " + t.not.length + " not, " + t.unread.length + " unread; written to " + a.one.out);
    return 0;
  }
  if (sub !== "ask") throw new PvError("E_USAGE", "er probe takes ask or tally; usage: " + USAGE);
  const a = parseArgs(rest, { units: "one", item: "one", "run-id": "one", out: "one", cache: "one", run: "one", record: "one", ledger: "one" }, USAGE);
  need(a, ["units", "item", "run-id", "out", "cache"], USAGE);
  const runDir = a.one.run ?? join(a.one.cache!, "..", "probe-run");
  const paths: Array<[string, string]> = [["--units", a.one.units!], ["--out", a.one.out!], ["--cache", a.one.cache!], ["--run", runDir]];
  for (const f of ["record", "ledger"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  for (const [f, p] of paths.slice(1, 4)) refuseInRepo(f, p);
  const units = [...loadUnits(a.one.units!, { keys: false }).values()].filter((u) => isDrawn(u.meta, "calibration"));
  if (!units.length) throw new PvError("E_USAGE", "no drawn calibration unit under " + a.one.units + "; the probe runs on the calibration slice, once er sets calibration --write has drawn it");
  const judge = await openErJudge({ item: a.one.item!, runId: a.one["run-id"]!, out: runDir, cacheDir: a.one.cache!, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch, io });
  const replies: Record<string, ProbeReply> = {};
  try {
    for (const u of units) replies[u.meta.id] = await askUnit(u, judge.call);
  } finally {
    await judge.close();
  }
  writeJson(a.one.out!, { version: 1, units: replies });
  const unread = Object.values(replies).filter((r) => r.unread).length;
  io.out("er probe ask: " + units.length + " calls, " + unread + " unread replies; written to " + a.one.out);
  if (unread) io.err("E_ER_LABEL_MISSING " + unread + " probe replies stayed unreadable after one resend; they count as empty lists");
  return 0;
}
