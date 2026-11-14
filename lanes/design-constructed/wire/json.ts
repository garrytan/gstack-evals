// Copyright (c) 2026 Garry Tan. MIT License.
// The wiring's file format: JSON with Maps and Sets kept as tagged entries, so area types that hold a Map (label cells,
// unit maps) round-trip through a sealed file unchanged.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fail } from "../errors.ts";

const replacer = (_k: string, v: unknown) => (v instanceof Map ? { $map: [...v.entries()] } : v instanceof Set ? { $set: [...v] } : v);
const reviver = (_k: string, v: unknown) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "$map" && Array.isArray(o.$map)) return new Map(o.$map as [unknown, unknown][]);
    if (keys.length === 1 && keys[0] === "$set" && Array.isArray(o.$set)) return new Set(o.$set);
  }
  return v;
};

export const toJson = (v: unknown): string => JSON.stringify(v, replacer, 2) + "\n";
export const fromJson = <T>(text: string): T => JSON.parse(text, reviver) as T;

/** Reads a wiring JSON file, or refuses with E_USAGE naming the flag it came from. */
export function readJson<T>(path: string, what: string): T {
  if (!existsSync(path)) fail("E_USAGE", what + " " + path + " does not exist");
  try {
    return fromJson<T>(readFileSync(path, "utf8"));
  } catch (e) {
    return fail("E_USAGE", what + " " + path + " is not JSON: " + (e as Error).message);
  }
}

export const writeJson = (path: string, v: unknown): void => writeFileSync(path, toJson(v));
