// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals of author and of real: the authoring area's paid commands (prereg section 3, start rules 10 and 12, and
// section 15). Both open one metered client on one ledger item (the ledger keeps one open lease per item, so the
// production labeller runs through the same meter as the writers, validators, auditors and probes) and print counts and
// digests only; every unit, note, page, Names line, reply and journal stays under --units, outside the repository.
// - of author: the constructed pipeline. --pilot runs the 4-unit pilot and prints its supply projection; without it the
//   run goes on to the quotas or the cap, the pilot's units joining. A pilot on its own ledger item leases --spend-cap
//   and projects against --authoring-cap, the full run's cap. --ceiling is R61's harder redraw. --twins (with --resume)
//   rebuilds a finished run from its sealed outcome log and makes only the second-skin calls the twin rule still owes.
// - of real: the real stratum from a frame file that maps each of the 40 frozen queries to its first 10 result URLs,
//   through the two-check terms gate and the serial miner (plain GETs, one at a time, user agent gstack-evals).
// --gstack must be a checkout at the pin: HEAD b6155921a564ba9ec2470fd2cb3894c05e2c2d13, VERSION 1.98.0.0 and the
// phase-2a file the vocabulary screen pins. Argon's replies must come from Google Vertex; any other provider, or a pin
// drift on Sol or particle-1, stops the command with E_OF_PROVIDER_DRIFT. --resume reuses --units, its run id and its
// reply cache, so settled calls replay at no cost; the spend of earlier launches carries forward in run.json.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { newRunId } from "../../../src/skill-eval/cli/call.ts";
import { need, parseArgs } from "../../product-value/io.ts";
import { versionTap, type Caller as JudgeCaller } from "../../product-value/judge.ts";
import { MeterError, MODELS, openMeter, sha256 } from "../../product-value/meter.ts";
import { insideRepo } from "../../review-noloss/suite.ts";
import { GSTACK } from "../frozen.ts";
import { powerMdd, python3, type Python } from "../read/projection.ts";
import { PASSES } from "../read/stage2.ts";
import { labeller } from "../score/judge.ts";
import { VERTEX } from "../sim/founder.ts";
import type { Deps } from "./checks.ts";
import type { Outcome } from "./constructed.ts";
import { AuthorError, openSink, type Caller } from "./files.ts";
import { QUERIES, RESULTS_PER_QUERY } from "./prompts.ts";
import { AGENT, authorReal, type Fetch } from "./real.ts";
import { authorConstructed, topUpTwins, writeConstructed, writeReal } from "./run.ts";
import { loadForcingQuestions, vocabulary } from "./screens.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Env = Record<string, string | undefined>;

/** What tests replace: the providers' fetch behind the meter, the web fetch, the gstack check and python for power.py. */
export interface Wire {
  upstream?: typeof fetch;
  web?: Fetch;
  gstack?: (dir: string) => string[];
  python?: Python;
  today?: string;
}

const AUTHOR_USAGE = "gstack-evals of author --units <dir> --gstack <checkout> --item <ledger item> --spend-cap <usd> [--pilot [--authoring-cap <usd>]] [--ceiling] [--resume [--twins]] [--concurrency <n>] [--record <dir>] [--ledger <path>]";
const REAL_USAGE = "gstack-evals of real --units <dir> --frame <json> --gstack <checkout> --item <ledger item> --spend-cap <usd> [--resume] [--record <dir>] [--ledger <path>]";

/** The planning design for the supply stop's MDD: Opus at its passes, control rate 0.25, ICC 0.5, shuffled-key credit 0.05 (section 12, part F). */
export const PLANNING = { p0: 0.25, rho: 0.5, s: 0.05 } as const;
export const mddAt = (python: Python) => (n: number): number | null => (n < 2 ? null : powerMdd([{ ...PLANNING, n, passes: PASSES.opus }], python)[0]!.guard);

/** Refuses a checkout off the pin and returns the six forcing questions its phase-2a file holds. */
export function checkGstack(dir: string): string[] {
  const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() ?? "";
  if (head !== GSTACK.sha) throw new AuthorError("E_USAGE", "--gstack " + dir + " is at " + (head || "no git HEAD") + ", not the pin " + GSTACK.sha);
  const file = join(dir, "VERSION");
  const version = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (version !== GSTACK.version) throw new AuthorError("E_USAGE", "--gstack " + dir + " has VERSION " + (version || "none") + ", not " + GSTACK.version);
  return loadForcingQuestions(dir);
}

/** A sealed path: refused inside the repo; --units is created fresh unless --resume, which needs it to exist. */
function sealed(flag: string, p: string): string {
  const abs = resolve(p);
  if (insideRepo(abs)) throw new AuthorError("E_USAGE", flag + " " + abs + " is inside the repo, and sealed material stays outside it");
  return abs;
}
function unitsDir(p: string, resume: boolean): string {
  const abs = sealed("--units", p);
  if (!resume) return openSink(abs);
  if (!existsSync(abs)) throw new AuthorError("E_USAGE", "--resume needs an existing --units, and " + abs + " does not exist");
  return abs;
}

const dollars = (v: string): number => {
  const n = Math.round(Number(v) * 1_000_000);
  if (!(n > 0)) throw new AuthorError("E_USAGE", "--spend-cap must be a positive number of dollars");
  return n;
};

/** The frame file: every frozen query, and only those, each with at most 10 http(s) result URLs. */
export function readFrame(path: string): Record<string, string[]> {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new AuthorError("E_USAGE", "--frame " + path + " is not readable JSON: " + (e as Error).message);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new AuthorError("E_USAGE", "--frame holds one JSON object mapping each query to its result URLs");
  const frame = v as Record<string, unknown>;
  const unknown = Object.keys(frame).filter((q) => !QUERIES.includes(q));
  if (unknown.length) throw new AuthorError("E_USAGE", "--frame holds " + unknown.length + " queries the prereg does not freeze");
  const missing = QUERIES.filter((q) => !(q in frame));
  if (missing.length) throw new AuthorError("E_USAGE", "--frame lacks " + missing.length + " of the 40 frozen queries");
  for (const [k, q] of QUERIES.entries()) {
    const urls = frame[q];
    if (!Array.isArray(urls) || !urls.every((u) => typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u))) throw new AuthorError("E_USAGE", "--frame query " + (k + 1) + " needs a list of http(s) URLs");
    if (urls.length > RESULTS_PER_QUERY) throw new AuthorError("E_USAGE", "--frame query " + (k + 1) + " has " + urls.length + " results, more than the first " + RESULTS_PER_QUERY);
  }
  return frame as Record<string, string[]>;
}

/** A plain GET with our user agent; a network failure reads as status 0, which the gate counts as unreadable. */
export const httpsGet: Fetch = async (url) => {
  try {
    const r = await fetch(url, { headers: { "user-agent": AGENT }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    return { status: r.status, text: await r.text() };
  } catch {
    return { status: 0, text: "" };
  }
};

/**
 * One metered client for the whole command: the area's Caller with the strict Argon check, the production labeller's
 * judge Caller over the same meter (with each reply's model version), the spend so far in dollars, and close.
 */
async function openWire(o: { units: string; item: string; cap: number; record?: string; ledger?: string; env: Env; io: Io; upstream?: typeof fetch; label: string }) {
  const runFile = join(o.units, "run.json");
  const prior = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string; spent_micros: number }) : null;
  const runId = prior?.run_id ?? newRunId(o.label);
  const before = prior?.spent_micros ?? 0;
  const vdir = join(o.units, "cache", "versions");
  mkdirSync(vdir, { recursive: true, mode: 0o700 });
  writeFileSync(runFile, JSON.stringify({ run_id: runId, spent_micros: before }) + "\n");
  const meter = await openMeter({ item: o.item, runId, out: join(o.units, "meter"), cacheDir: join(o.units, "cache"), maxOutputTokens: 32_000, amountMicros: o.cap, record: o.record, ledger: o.ledger, env: o.env, fetch: versionTap(o.upstream ?? fetch, vdir), warn: (code, m) => o.io.err(code + " " + m) });
  const call: Caller = async (req) => {
    let res;
    try {
      res = await meter.call(req);
    } catch (e) {
      if (e instanceof MeterError && e.code === "E_PV_PROVIDER_DRIFT") throw new AuthorError("E_OF_PROVIDER_DRIFT", e.message.replace(/^E_PV_PROVIDER_DRIFT /, ""));
      throw e;
    }
    if (req.model === "gemini" && res.text !== null && !VERTEX.test(res.served_by ?? "")) throw new AuthorError("E_OF_PROVIDER_DRIFT", MODELS.gemini.id + " was served by " + (res.served_by ?? "an unnamed provider") + ", not Google Vertex; stop Argon's items and ask the Captain");
    return res;
  };
  const judge: JudgeCaller = async (c) => {
    const r = await call({ model: c.judge, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label });
    const v = join(vdir, sha256(MODELS[c.judge].id + "\n" + c.prompt) + ".version");
    return { text: r.text, model_id: MODELS[c.judge].provider + ":" + MODELS[c.judge].id, version: existsSync(v) ? readFileSync(v, "utf8") : null, problem: r.problem };
  };
  return {
    call,
    judge,
    spent: () => (before + meter.spent()) / 1e6,
    async close(cmd: string) {
      const c = await meter.close();
      writeFileSync(runFile, JSON.stringify({ run_id: runId, spent_micros: before + c.spent_micros }) + "\n");
      o.io.out(cmd + ": settled " + (c.spent_micros / 1e6).toFixed(4) + " dollars on " + o.item + (c.unknown_micros ? ", " + (c.unknown_micros / 1e6).toFixed(4) + " unknown" : "") + "; " + ((before + c.spent_micros) / 1e6).toFixed(4) + " across this run's launches");
    },
  };
}

type Wired = Awaited<ReturnType<typeof openWire>>;
const depsOf = (w: Wired, asks: readonly string[]): Deps => ({ call: w.call, label: labeller(w.judge), screen: vocabulary(asks) });
const tally = (o: Record<string, number>) => Object.entries(o).map(([k, n]) => k + " " + n).join(", ") || "none";

/** gstack-evals of author. */
export async function authorCommand(argv: string[], io: Io, env: Env, wire: Wire = {}): Promise<number> {
  const a = parseArgs(argv, { units: "one", gstack: "one", item: "one", "spend-cap": "one", "authoring-cap": "one", pilot: "flag", ceiling: "flag", resume: "flag", twins: "flag", concurrency: "one", record: "one", ledger: "one" }, AUTHOR_USAGE);
  need(a, ["units", "gstack", "item", "spend-cap"], AUTHOR_USAGE);
  if (a.flag.has("pilot") && a.flag.has("ceiling")) throw new AuthorError("E_USAGE", "the CEILING redraw runs no pilot; pass --pilot or --ceiling, not both");
  if (a.flag.has("twins") && (!a.flag.has("resume") || a.flag.has("pilot"))) throw new AuthorError("E_USAGE", "--twins tops up a finished run's second skins, so it needs --resume and takes no --pilot");
  if (a.one["authoring-cap"] !== undefined && !a.flag.has("pilot")) throw new AuthorError("E_USAGE", "--authoring-cap is the cap a pilot on its own ledger item projects against; the full run's authoring cap is its --spend-cap");
  const cap = dollars(a.one["spend-cap"]!);
  const authoring = a.one["authoring-cap"] === undefined ? cap : dollars(a.one["authoring-cap"]);
  const concurrency = Number(a.one.concurrency ?? "4");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new AuthorError("E_USAGE", "--concurrency is a whole number of at least 1");
  const asks = (wire.gstack ?? checkGstack)(a.one.gstack!);
  const units = unitsDir(a.one.units!, a.flag.has("resume"));
  const dir = join(units, a.flag.has("ceiling") ? "ceiling" : "constructed");
  const logged = a.flag.has("twins") ? { log: readFileSync(join(dir, "outcomes.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Outcome), summary: JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as ReturnType<typeof writeConstructed> } : null;
  const w = await openWire({ units, item: a.one.item!, cap, record: a.one.record, ledger: a.one.ledger, env, io, upstream: wire.upstream, label: "of-author" });
  let run;
  try {
    run = logged
      ? await topUpTwins(logged.log, depsOf(w, asks), { ceiling: a.flag.has("ceiling"), projection: logged.summary.projection, digest: logged.summary.comparison.digest })
      : await authorConstructed({ ...depsOf(w, asks), spent: w.spent }, { cap: authoring / 1e6, concurrency, mdd: mddAt(wire.python ?? python3), ceiling: a.flag.has("ceiling"), pilotOnly: a.flag.has("pilot") });
  } finally {
    await w.close("of author");
  }
  const s = writeConstructed(units, run);
  const p = s.projection;
  if (p) io.out("of author: supply projection: " + p.passing + " of 4 pilot units passed at " + p.per_passing.toFixed(4) + " dollars each, failures included; " + p.projected.toFixed(4) + " projected for " + p.needed + " quota units against a cap of " + p.cap + " (" + (p.fits ? "fits" : "does not fit") + "); " + p.comparison_fillable + " comparison units can fill, MDD " + (p.mdd ?? "above 0.50") + " there");
  io.out("of author: stopped at " + s.stopped + "; " + s.drawn + " drawn, " + s.passed + " passed, " + s.rewritten + " rewritten");
  io.out("of author: drops by step: " + tally(s.drops) + "; not unanimous " + s.not_unanimous + ", given away " + s.given_away);
  io.out("of author: sets: calibration " + s.sets.calibration + ", comparison " + s.sets.comparison + ", reserve " + s.sets.reserve + "; second skins passed " + s.twins.passed + (s.twins.out_of_twin_check.length ? ", out of the twin check: " + s.twins.out_of_twin_check.join(" ") : ""));
  io.out("of author: comparison " + s.comparison.size + " units, digest " + s.comparison.digest + "; types " + tally(s.comparison.types) + "; shapes " + tally(s.comparison.shapes) + "; authors " + tally(s.comparison.authors));
  if (run.stopped === "supply") throw new AuthorError("E_OF_SUPPLY_SHORT", "the pilot projects " + p!.projected.toFixed(4) + " dollars for the quotas, past the cap of " + p!.cap + "; " + p!.comparison_fillable + " comparison units can fill, MDD " + (p!.mdd ?? "above 0.50") + " there. Authoring stops for the Captain");
  return 0;
}

/** gstack-evals of real. */
export async function realCommand(argv: string[], io: Io, env: Env, wire: Wire = {}): Promise<number> {
  const a = parseArgs(argv, { units: "one", frame: "one", gstack: "one", item: "one", "spend-cap": "one", resume: "flag", record: "one", ledger: "one" }, REAL_USAGE);
  need(a, ["units", "frame", "gstack", "item", "spend-cap"], REAL_USAGE);
  const cap = dollars(a.one["spend-cap"]!);
  const frame = readFrame(sealed("--frame", a.one.frame!));
  const asks = (wire.gstack ?? checkGstack)(a.one.gstack!);
  const units = unitsDir(a.one.units!, a.flag.has("resume"));
  io.out("of real: frame sha256 " + sha256(readFileSync(resolve(a.one.frame!))) + ", " + QUERIES.reduce((n, q) => n + frame[q]!.length, 0) + " results over 40 queries");
  const w = await openWire({ units, item: a.one.item!, cap, record: a.one.record, ledger: a.one.ledger, env, io, upstream: wire.upstream, label: "of-real" });
  let run;
  try {
    run = await authorReal({ ...depsOf(w, asks), search: async (q) => frame[q]!.map((url) => ({ url })), fetch: wire.web ?? httpsGet, today: wire.today ?? new Date().toISOString().slice(0, 10) });
  } finally {
    await w.close("of real");
  }
  const s = writeReal(units, run);
  io.out("of real: " + s.sources + " sources; gate fetched " + s.gate.fetched + ", refused " + s.gate.refused + " (terms unreadable " + s.gate.terms_unreadable + "); " + s.pages + " pages, " + s.founder_pages + " founder accounts");
  io.out("of real: " + s.authored + " authored, " + s.passed + " passed; drops by step: " + tally(s.drops) + "; fame terciles: " + tally(s.terciles));
  return 0;
}

export const commands: Record<string, { summary: string; run: (argv: string[], io: Io, env: Env) => Promise<number> }> = {
  author: { summary: "the constructed units: the 4-unit pilot (--pilot) or the run to the quotas or the cap, on one ledger item", run: (argv, io, env) => authorCommand(argv, io, env) },
  real: { summary: "the real-history stratum from a frame file: the terms gate, the miner and the writers, on one ledger item", run: (argv, io, env) => realCommand(argv, io, env) },
};
