// Copyright (c) 2026 Garry Tan. MIT License.
// Unit files for the office-hours founder eval's authoring (prereg section 3, "Unit files", and section 15): reading a
// writer's reply into opening.md, sheet.json and key.json, the shape checks each file must pass, the digest every check
// result binds, and the custody sink. The sink refuses a path inside the repository and a path that already exists
// (start rule 10), so units, notes, pages and Names lines land only in a fresh directory outside the checkout.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { realOf, REPO_ROOT } from "../../product-value/io.ts";
import type { CallRequest, CallResult } from "../../product-value/meter.ts";
import type { FactKind, Key, Sheet, UnitMeta, WItem } from "../types.ts";

export class AuthorError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}

/** Every model call goes through this injected function (the product-value meter's shape), so tests make none. */
export type Caller = (req: CallRequest) => Promise<CallResult>;

export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

export interface UnitFiles {
  opening: string;
  sheet: Sheet;
  key: Key;
}

export const KINDS: readonly FactKind[] = ["demand", "payment", "user", "status-quo", "attempt", "reaction", "channel", "constraint", "other"];
export const W_ITEMS: readonly WItem[] = ["customer", "wedge"];

const fenceOpen = (line: string) => /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);

/** The name of the file a line opens, when the line is a heading for it or a fence labelled with it. */
function headerOf(line: string, names: readonly string[]): string | null {
  const bare = line.replace(/^[\s#>*_`~\-\d.]+/, "").replace(/[\s*_`:()]+$/, "").trim().toLowerCase();
  return names.find((n) => bare === n) ?? null;
}

/**
 * Reads the named files out of a writer's reply. A file starts at a line that names it (a heading, a bold line or a fence
 * labelled with it) and runs to the next such line; when its section holds a fence, the file is that fence's body.
 * A reply that is one JSON object keyed by the file names is read directly.
 */
export function readFiles(reply: string, names: readonly string[]): Record<string, string> | string {
  const whole = jsonObject(reply);
  if (whole && names.every((n) => Object.hasOwn(whole, n))) return Object.fromEntries(names.map((n) => [n, typeof whole[n] === "string" ? (whole[n] as string) : JSON.stringify(whole[n])]));
  const lines = reply.split("\n");
  const starts: { name: string; at: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const name = headerOf(lines[i]!, names);
    if (name && !starts.some((s) => s.name === name)) starts.push({ name, at: i });
  }
  starts.sort((a, b) => a.at - b.at);
  const out: Record<string, string> = {};
  for (const [k, s] of starts.entries()) {
    const end = starts[k + 1]?.at ?? lines.length;
    const section = fenceOpen(lines[s.at]!) ? lines.slice(s.at, end) : lines.slice(s.at + 1, end);
    const open = section.findIndex((l) => fenceOpen(l));
    if (open < 0) {
      out[s.name] = section.join("\n").trim();
      continue;
    }
    const mark = fenceOpen(section[open]!)![1]!;
    const close = section.findIndex((l, j) => j > open && l.trim().startsWith(mark) && l.trim().replace(/[`~]/g, "") === "");
    out[s.name] = section.slice(open + 1, close < 0 ? section.length : close).join("\n").trim();
  }
  const missing = names.filter((n) => !out[n]);
  return missing.length ? "the reply holds no " + missing.join(" or ") : out;
}

/** The first JSON object in a reply: the whole reply, a fenced body, or the text from its first { to its last }. */
export function jsonObject(text: string): Record<string, unknown> | null {
  const tries = [text.trim(), ...[...text.matchAll(/(?:`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:`{3,}|~{3,})/g)].map((m) => m[1]!), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {}
  }
  return null;
}

const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** Sheet shape: a persona and facts with unique ids, text, reveal_when and a listed kind; 10 to 16 facts on a constructed unit, 1 to 16 on a real one. */
export function sheetProblem(v: unknown, constructed: boolean): string | null {
  const s = v as Sheet;
  if (!s || typeof s !== "object" || !str(s.persona) || !Array.isArray(s.facts)) return "sheet.json needs a persona and a facts list";
  const [lo, hi] = constructed ? [10, 16] : [1, 16];
  if (s.facts.length < lo || s.facts.length > hi) return "sheet.json holds " + s.facts.length + " facts, outside " + lo + " to " + hi;
  const ids = new Set<string>();
  for (const f of s.facts) {
    if (!f || !str(f.id) || !str(f.text) || !str(f.reveal_when) || !KINDS.includes(f.kind)) return "a fact lacks an id, text, reveal_when or a listed kind";
    if (ids.has(f.id)) return "fact id " + f.id + " repeats";
    ids.add(f.id);
  }
  return null;
}

/** Key shape. A constructed key names 4 to 6 key facts, all on the sheet, and an alternative; traceability counts a real key's key facts. */
export function keyProblem(v: unknown, sheet: Sheet, constructed: boolean): string | null {
  const k = v as Key;
  if (!k || typeof k !== "object" || !str(k.customer) || !str(k.wedge) || !str(k.first_move) || !str(k.pivot)) return "key.json needs customer, wedge, first_move and pivot";
  if (!Array.isArray(k.key_facts) || !k.key_facts.every(str)) return "key.json needs key_facts as a list of ids";
  if (!Array.isArray(k.mentioned) || !k.mentioned.every((m) => W_ITEMS.includes(m))) return "key.json's mentioned may list only customer and wedge";
  if (!constructed) return null;
  if (k.key_facts.length < 4 || k.key_facts.length > 6) return "key.json names " + k.key_facts.length + " key facts, outside 4 to 6";
  const ids = new Set(sheet.facts.map((f) => f.id));
  if (!k.key_facts.every((id) => ids.has(id))) return "a key fact is not on the sheet";
  if (!k.alternative || !str(k.alternative.customer) || !str(k.alternative.wedge)) return "key.json needs an alternative customer and wedge";
  return null;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return jsonObject(text);
  }
};

/** Reads a writer's reply into the files it owes (all three, or some of them over a base) and checks their shapes. A string is the problem. */
export function unitFrom(reply: string, o: { constructed: boolean; names?: readonly string[]; base?: Partial<UnitFiles> }): Partial<UnitFiles> | string {
  const files = readFiles(reply, o.names ?? ["opening.md", "sheet.json", "key.json"]);
  if (typeof files === "string") return files;
  const out: Partial<UnitFiles> = { ...o.base };
  if (files["opening.md"] !== undefined) out.opening = files["opening.md"].trim() + "\n";
  if (files["sheet.json"] !== undefined) {
    const sheet = parseJson(files["sheet.json"]);
    const p = sheetProblem(sheet, o.constructed);
    if (p) return p;
    out.sheet = sheet as Sheet;
  }
  if (files["key.json"] !== undefined) {
    const key = parseJson(files["key.json"]) as Key;
    const p = keyProblem(key, out.sheet!, o.constructed);
    if (p) return p;
    out.key = { customer: key.customer, wedge: key.wedge, first_move: key.first_move, pivot: key.pivot, key_facts: key.key_facts, mentioned: key.mentioned, ...(o.constructed ? { alternative: { customer: key.alternative!.customer, wedge: key.alternative!.wedge } } : {}) };
  }
  return out;
}

export const sheetJson = (s: Sheet): string => JSON.stringify(s, null, 2) + "\n";
export const keyJson = (k: unknown): string => JSON.stringify(k, null, 2) + "\n";

/** sha256 over the unit's current opening.md, sheet.json and key.json, as written: every check result binds it. */
export const digestOf = (u: UnitFiles): string => sha256(u.opening + "\0" + sheetJson(u.sheet) + "\0" + keyJson(u.key));

/** Opens a custody sink: a directory outside the repository that does not exist yet. */
export function openSink(dir: string): string {
  const real = realOf(dir), root = realOf(REPO_ROOT);
  if (real === root || real.startsWith(root + sep)) throw new AuthorError("E_USAGE", dir + " is inside the repository; units, notes, pages and Names lines go only to a custody directory outside it (section 15)");
  if (existsSync(real)) throw new AuthorError("E_USAGE", dir + " already exists; every launch uses a sink directory that does not exist before it (start rule 10)");
  mkdirSync(real, { recursive: true });
  return real;
}

/** Writes one file under an open sink. */
export function writeSealed(sink: string, rel: string, data: string | Buffer): void {
  const path = join(sink, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** Writes one unit in types.ts's layout. key.json carries the author's items plus what the checks recorded beside them. */
export function writeUnit(sink: string, files: UnitFiles, meta: UnitMeta, record: Record<string, unknown>): void {
  writeSealed(sink, join("units", meta.id, "opening.md"), files.opening);
  writeSealed(sink, join("units", meta.id, "sheet.json"), sheetJson(files.sheet));
  writeSealed(sink, join("units", meta.id, "key.json"), keyJson({ ...files.key, ...record }));
  writeSealed(sink, join("units", meta.id, "unit.json"), keyJson(meta));
}
