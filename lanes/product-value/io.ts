// Copyright (c) 2026 Garry Tan. MIT License.
// Shared input and output for the product-value scoring commands (prereg 2026-11-08-geva-403): the error type the pv
// entry maps to reason codes, a flag parser, the four-paths alias guard owed from #273's merge script, the rule that
// every sealed output lands outside the repository, and the readers for units, keys and rows.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import type { Key, Row, UnitMeta } from "./types.ts";

export class PvError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}

export type Spec = Record<string, "one" | "many" | "flag">;
export interface Args {
  one: Record<string, string>;
  many: Record<string, string[]>;
  flag: Set<string>;
}

/** Parses --name value pairs against spec; an unknown flag, a missing value or a repeated single flag is E_USAGE. */
export function parseArgs(argv: readonly string[], spec: Spec, usage: string): Args {
  const out: Args = { one: {}, many: {}, flag: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const name = a.startsWith("--") ? a.slice(2) : "";
    const kind = spec[name];
    if (!kind) throw new PvError("E_USAGE", "unknown argument " + JSON.stringify(a) + "; usage: " + usage);
    if (kind === "flag") {
      out.flag.add(name);
      continue;
    }
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) throw new PvError("E_USAGE", "--" + name + " needs a value; usage: " + usage);
    if (kind === "many") out.many[name] = [...(out.many[name] ?? []), v];
    else if (name in out.one) throw new PvError("E_USAGE", "--" + name + " is given twice; usage: " + usage);
    else out.one[name] = v;
  }
  return out;
}

export function need(a: Args, names: readonly string[], usage: string): void {
  const missing = names.filter((n) => !(n in a.one) && !(n in a.many));
  if (missing.length) throw new PvError("E_USAGE", "missing " + missing.map((m) => "--" + m).join(", ") + "; usage: " + usage);
}

/** The real path of p, or of its nearest existing parent joined with the rest when p does not exist yet. */
export function realOf(p: string): string {
  const abs = resolve(p);
  if (existsSync(abs)) return realpathSync(abs);
  const rest: string[] = [];
  let dir = abs;
  while (!existsSync(dir)) {
    rest.unshift(basename(dir));
    dir = dirname(dir);
  }
  return join(realpathSync(dir), ...rest);
}

/**
 * The four-paths alias guard (#273's merge script did not check that its four paths differ, so an output that named
 * an input overwrote it and still printed OK). Every pv command that takes several run, rows, label or output paths
 * refuses two that resolve to the same real file or directory.
 */
export function refuseAliases(paths: ReadonlyArray<readonly [string, string]>): void {
  const seen = new Map<string, string>();
  for (const [flag, p] of paths) {
    const real = realOf(p);
    const prior = seen.get(real);
    if (prior !== undefined) throw new PvError("E_USAGE", prior + " and " + flag + " resolve to the same path " + real + "; pass distinct files and directories, so no output overwrites an input");
    seen.set(real, flag);
  }
}

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

/** Sealed outputs (packets, maps, labels, scores) go outside the repository checkout. */
export function refuseInRepo(flag: string, p: string): void {
  const real = realOf(p), root = realOf(REPO_ROOT);
  if (real === root || real.startsWith(root + sep)) throw new PvError("E_USAGE", flag + " " + p + " is inside the repository; sealed outputs go outside it (section 18), for example under /dev/shm or the Captain drive's custody folder");
}

export function readJson<T>(path: string, what: string): T {
  if (!existsSync(path)) throw new PvError("E_USAGE", what + " " + path + " does not exist");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    throw new PvError("E_USAGE", what + " " + path + " is not JSON: " + (e as Error).message);
  }
}

/** Reads a JSON array or newline-delimited JSON. */
export function readRecords<T>(path: string, what: string): T[] {
  if (!existsSync(path)) throw new PvError("E_USAGE", what + " " + path + " does not exist");
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  try {
    if (text.startsWith("[")) return JSON.parse(text) as T[];
    return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
  } catch (e) {
    throw new PvError("E_USAGE", what + " " + path + " is neither a JSON array nor JSON lines: " + (e as Error).message);
  }
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 1) + "\n", { mode: 0o600 });
}

export function writeLines(path: string, records: readonly unknown[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""), { mode: 0o600 });
}

const ROW_ENDS = new Set(["block", "no-block", "missing", "contaminated"]);

export function readRows(path: string): Row[] {
  const rows = readRecords<Row>(path, "rows file");
  rows.forEach((r, i) => {
    if (typeof r.unit !== "string" || typeof r.session !== "string" || !ROW_ENDS.has(r.end) || typeof r.pass !== "number") throw new PvError("E_USAGE", "rows file " + path + " row " + (i + 1) + " is not a Row (unit, session, pass and end are required)");
    if (r.end === "block" && !Array.isArray(r.list)) throw new PvError("E_USAGE", "rows file " + path + " row " + (i + 1) + " ends in a block but holds no list");
  });
  return rows;
}

/** Section 4 and 11: a pre-cutoff public source is never a comparison unit and never a promoted reserve. */
export function unitProblem(meta: UnitMeta): string | null {
  if (meta.pre_cutoff && meta.set === "comparison") return "unit " + meta.id + " is built from a pre-cutoff public source, which section 4 allows only for pilots, reserves and descriptive strata, never as a comparison unit or a promoted reserve";
  return null;
}

/** Promotes a reserve unit to the comparison set, refusing a pre-cutoff source. */
export function promoteReserve(meta: UnitMeta): UnitMeta {
  if (meta.set !== "reserve") throw new PvError("E_USAGE", "unit " + meta.id + " is not a reserve unit");
  const promoted: UnitMeta = { ...meta, set: "comparison" };
  const problem = unitProblem(promoted);
  if (problem) throw new PvError("E_USAGE", problem);
  return promoted;
}

/** Checks a key against section 3: primary items exist, are U or E, neither mentioned nor generic, at most 6. */
export function keyProblem(key: Key): string | null {
  const byId = new Map(key.items.map((i) => [i.id, i]));
  if (byId.size !== key.items.length) return "key " + key.unit + " repeats an item id";
  if (key.primary.length > 6) return "key " + key.unit + " holds " + key.primary.length + " primary items; section 3 keeps at most 6";
  for (const id of key.primary) {
    const it = byId.get(id);
    if (!it) return "key " + key.unit + " names primary item " + id + ", which is not among its items";
    if (it.kind === "R" || it.mentioned || it.generic) return "key " + key.unit + " lists item " + id + " as primary, but it is " + (it.kind === "R" ? "an R item" : it.mentioned ? "mentioned" : "generic");
  }
  return null;
}

export interface LoadedUnit {
  meta: UnitMeta;
  key: Key | null;
  dir: string;
}

/** Reads every unit folder under dir (unit.json, and key.json when keys is set), refusing a pre-cutoff comparison unit. */
export function loadUnits(dir: string, o: { keys: boolean }): Map<string, LoadedUnit> {
  if (!existsSync(dir)) throw new PvError("E_USAGE", "units directory " + dir + " does not exist");
  const out = new Map<string, LoadedUnit>();
  for (const name of readdirSync(dir).sort()) {
    const udir = join(dir, name);
    if (!existsSync(join(udir, "unit.json"))) continue;
    const meta = readJson<UnitMeta>(join(udir, "unit.json"), "unit file");
    if (meta.id !== name) throw new PvError("E_USAGE", "unit folder " + name + " holds unit.json for " + JSON.stringify(meta.id));
    const problem = unitProblem(meta);
    if (problem) throw new PvError("E_USAGE", problem);
    let unitKey: Key | null = null;
    if (o.keys) {
      unitKey = readJson<Key>(join(udir, "key.json"), "key file");
      const kp = unitKey.unit === name ? keyProblem(unitKey) : "key.json in " + name + " names unit " + JSON.stringify(unitKey.unit);
      if (kp) throw new PvError("E_USAGE", kp);
    }
    out.set(name, { meta, key: unitKey, dir: udir });
  }
  if (!out.size) throw new PvError("E_USAGE", "units directory " + dir + " holds no unit folders with unit.json");
  return out;
}

export type Normalize = (strings: string[]) => string[];

/** The run side's section 6 normalizer from parse.ts; stock rows and oracle lists go through it like every arm. */
export async function loadNormalize(): Promise<Normalize> {
  const path = join(import.meta.dir, "parse.ts");
  if (!existsSync(path)) throw new PvError("E_USAGE", "lanes/product-value/parse.ts is not built yet; its normalize() renders stock rows and oracle lists the way section 6 renders every list");
  const mod = (await import(path)) as { normalize?: Normalize };
  if (typeof mod.normalize !== "function") throw new PvError("E_USAGE", "lanes/product-value/parse.ts exports no normalize(strings)");
  return mod.normalize;
}
