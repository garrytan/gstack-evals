// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx author (prereg 2026-11-09-geva-417, sections 3, 4 and 11): the key funnel past the free screen on named
// units, under custody, every model call through the shared metered client on the authoring item's lease.
//   dx author --units <dir> --work <dir> --item <authoring item> --ids <id,id,...> [--now <iso>]
// --units holds one folder per unit as the miner and unit builder hand it over: funnel.json (the funnel's input and
// draw_digest) and alias.json (the forward alias map). --work receives each unit's sealed outcome, plan.md and key.json.
// Both sit outside the repository. The command refuses to spend without an approved ledger item (the meter's lease) and
// refuses a unit whose window has not closed. Stdout carries stages, counts and spend, never text.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { openMeter, type Meter, type MeterOptions } from "../../aftermath/meter.ts";
import { pinnedHead } from "../../product-value/author/run.ts";
import type { Io } from "../cli.ts";
import { genericScreen } from "../score/score.ts";
import type { AliasMap } from "../types.ts";
import { aliasText } from "../unit/alias.ts";
import { authorUnit, DxError, missRead, type FunnelResult, type FunnelUnit, type MissRead } from "./funnel.ts";
import { genericVia, meterCaller } from "./generic.ts";

export type UnitFile = FunnelUnit & { draw_digest: string };
export type Outcome = Omit<FunnelResult, "key">;

export const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const real = (p: string) => {
  let q = resolve(p);
  while (!existsSync(q) && dirname(q) !== q) q = dirname(q);
  return realpathSync(q) + resolve(p).slice(q.length);
};

/** Sealed material (plans, keys, alias maps) goes only under a directory the caller names, never in the repository. */
export function refuseInRepo(name: string, p: string): void {
  const r = real(p), root = realpathSync(REPO_ROOT);
  if (r === root || r.startsWith(root + sep)) throw new DxError("E_USAGE", name + " " + p + " is inside the repository; sealed authoring material goes outside it");
}

export const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
export const put = (p: string, data: unknown) => {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
};

export interface Authoring {
  meter: Meter;
  units: string;
  work: string;
  now: string;
  log: (unit: string, stage: string, data: Record<string, unknown>) => void;
}

/** Opens the authoring item's lease; the meter refuses an item with no approved cap (E_LEDGER_MISSING) before any call. */
export async function openAuthoring(argv: string[], usage: string, over: Partial<MeterOptions> = {}): Promise<Authoring> {
  const units = flag(argv, "--units"), work = flag(argv, "--work"), item = flag(argv, "--item");
  if (!units || !work || !item) throw new DxError("E_USAGE", usage);
  refuseInRepo("--units", units);
  refuseInRepo("--work", work);
  const head = over.fetch ? "fake" : pinnedHead();
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const logFile = join(work, "author-log.jsonl");
  const log = (unit: string, stage: string, data: Record<string, unknown>) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), head, item, unit, stage, ...data }) + "\n");
  const meter = await openMeter({ item, runId: item, out: join(work, "journal"), cacheDir: join(work, "cache"), maxOutputTokens: 32_000, driftCode: "E_DX_PROVIDER_DRIFT", onDrift: "throw", arm: "dx", warn: (c, m) => log("-", "warn", { code: c, message: m.slice(0, 200) }), ...over });
  return { meter, units, work, now: flag(argv, "--now") ?? new Date().toISOString(), log };
}

export function loadUnit(units: string, id: string): { unit: UnitFile; alias: AliasMap } {
  const f = join(units, id, "funnel.json");
  if (!existsSync(f)) throw new DxError("E_USAGE", "no unit " + id + " under --units (funnel.json)");
  return { unit: readJson<UnitFile>(f), alias: readJson<AliasMap>(join(units, id, "alias.json")) };
}

/** Every unit under --units, as the set walk needs it: id, draw digest, release and window close. */
export function listUnits(units: string): Array<{ id: string; draw_digest: string; release_at: string; window_to: string }> {
  return readdirSync(units)
    .filter((id) => existsSync(join(units, id, "funnel.json")))
    .map((id) => {
      const u = readJson<UnitFile>(join(units, id, "funnel.json"));
      return { id, draw_digest: u.draw_digest, release_at: u.release_at, window_to: u.window.to };
    });
}

const closed = (u: { window: { to: string } }, now: string) => Date.parse(u.window.to) <= Date.parse(now);

/** One unit through the funnel, resumable: a unit with an outcome on disk is never authored again. */
export async function authorOne(a: Authoring, id: string, limitMicros?: number): Promise<Outcome> {
  const dir = join(a.work, "units", id);
  if (existsSync(join(dir, "outcome.json"))) return readJson<Outcome>(join(dir, "outcome.json"));
  const { unit, alias } = loadUnit(a.units, id);
  if (!closed(unit, a.now)) throw new DxError("E_USAGE", id + ": its window closes " + unit.window.to + "; no key is read before its window closes");
  const r = await authorUnit(unit, { meter: a.meter, alias: (t) => aliasText(t, alias), genericScreen: genericVia(meterCaller(a.meter), genericScreen), log: a.log, ...(limitMicros === undefined ? {} : { limitMicros: a.meter.spent() + limitMicros }) });
  if (r.plan !== null) put(join(dir, "plan.md"), r.plan);
  if (r.key !== null) put(join(dir, "key.json"), r.key);
  const { key: _key, ...outcome } = r;
  put(join(dir, "outcome.json"), outcome);
  return outcome;
}

/** The miss sample's key read on one dropped unit, resumable. */
export async function missOne(a: Authoring, id: string): Promise<MissRead> {
  const f = join(a.work, "units", id, "miss.json");
  if (existsSync(f)) return readJson<MissRead>(f);
  const { unit, alias } = loadUnit(a.units, id);
  const r = await missRead(unit, { meter: a.meter, alias: (t) => aliasText(t, alias), genericScreen: async (k) => k, log: a.log });
  put(f, r);
  return r;
}

const USAGE = "dx author --units <dir> --work <dir> --item <authoring item> --ids <id,id,...> [--now <iso>]";

export async function run(argv: string[], io: Io, over: Partial<MeterOptions> = {}): Promise<number> {
  const ids = (flag(argv, "--ids") ?? "").split(",").filter(Boolean);
  if (!ids.length) throw new DxError("E_USAGE", USAGE);
  const a = await openAuthoring(argv, USAGE, over);
  const out: Outcome[] = [];
  try {
    for (const id of ids) out.push(await authorOne(a, id));
  } finally {
    const c = await a.meter.close();
    io.out("dx author: spent " + (c.spent_micros / 1e6).toFixed(4) + " USD on this lease");
  }
  for (const o of out) io.out(o.id + " " + o.stage + " dropped_items=" + o.dropped_items + " spent=" + (o.spent_micros / 1e6).toFixed(4));
  return 0;
}
