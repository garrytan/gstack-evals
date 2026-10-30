// --mirror (U10): a copy of a run's verdict and receipts that is safe to publish. It copies only the top-level records
// in MIRROR_FILES (verdict.json, calibration.json, run.json, progress.json and the cells, adjudication and usersim
// journals) and nothing under runs/, judge/, calibration/ or proxy/, where the transcripts, work dirs, homes and the
// proxy journal live. Each JSON value is scrubbed before it is written:
// - A key on SCRUB_KEYS loses its value (an array becomes [], anything else null): transcript text, machine paths, and
//   meter, lease and container ids.
// - In every other string, the out dir and each root the caller names become <out> or <path>, any other absolute path
//   becomes <path> (an API route under /v1/ stays), and a meter id becomes <meter>.
// - A journal line that does not parse is dropped, not copied.
// A mirror directory that resolves to the out directory, through a symlink or not, is refused, and a record the run did
// not write is removed from a reused mirror directory, so a mirror never overwrites its source or mixes two runs.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** A mirror directory that resolves to the out directory; the CLI prints it as E_USAGE. */
export class MirrorAliasError extends Error {}

export const MIRROR_FILES = ["verdict.json", "calibration.json", "run.json", "progress.json", "cells.ndjson", "adjudication.ndjson", "usersim.ndjson"] as const;

/** Keys whose values a mirror drops, and what each holds. */
export const SCRUB_KEYS: Readonly<Record<string, string>> = {
  turns: "transcript text",
  dir: "a machine path",
  ledger: "a machine path",
  ledger_record: "a machine path",
  trace: "a machine path",
  journal: "a machine path",
  recovery: "the proxy container and its journal path",
  proxy_container: "a container id",
  meter_id: "a meter id",
  lease_id: "a lease id",
};

const METER_ID = /\bm_[0-9a-f]{24}\b/g;
const MACHINE_PATH = /(?<![\w.~>-])(?:~\/[^\s"'`,;)<>]*|\/(?!v1\/)[\w.@+-][^\s"'`,;)<>]*)/g;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The path with every symlink in its longest existing prefix resolved, so two names for one directory compare equal. */
export function canonical(path: string): string {
  const p = resolve(path);
  if (existsSync(p)) return realpathSync(p);
  return dirname(p) === p ? p : join(canonical(dirname(p)), basename(p));
}

/** Replaces the out dir, the named roots, other machine paths and meter ids in one string. */
function scrubText(text: string, roots: readonly [string, string][]): string {
  let t = text;
  for (const [root, mark] of roots) t = t.replace(new RegExp(escaped(root) + "(?![\\w.@+-])", "g"), mark);
  return t.replace(METER_ID, "<meter>").replace(MACHINE_PATH, "<path>");
}

function scrubValue(value: unknown, roots: readonly [string, string][]): unknown {
  if (typeof value === "string") return scrubText(value, roots);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, roots));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [scrubText(k, roots), k in SCRUB_KEYS ? (Array.isArray(v) ? [] : null) : scrubValue(v, roots)]));
}

/** Writes the scrubbed records from out into dest and returns the paths written; dest is created only when out holds a record. */
export function mirrorRun(out: string, dest: string, roots: readonly string[] = []): string[] {
  if (canonical(dest) === canonical(out)) throw new MirrorAliasError("the mirror directory " + dest + " is the out directory " + out);
  const marks: [string, string][] = [...new Set([resolve(out), canonical(out)])].map((p) => [p, "<out>"]);
  for (const r of roots) for (const p of new Set([resolve(r), canonical(r)])) if (p !== "/" && !marks.some(([m]) => m === p)) marks.push([p, "<path>"]);
  marks.sort((a, b) => b[0].length - a[0].length);
  const written: string[] = [];
  for (const name of MIRROR_FILES) {
    const src = join(out, name);
    if (!existsSync(src)) {
      rmSync(join(dest, name), { force: true });
      continue;
    }
    const text = readFileSync(src, "utf8");
    let body: string;
    if (name.endsWith(".ndjson")) {
      body = text.split("\n").flatMap((line) => {
        if (!line.trim()) return [];
        try {
          return [JSON.stringify(scrubValue(JSON.parse(line), marks))];
        } catch {
          return [];
        }
      }).map((l) => l + "\n").join("");
    } else {
      try {
        body = JSON.stringify(scrubValue(JSON.parse(text), marks), null, 2) + "\n";
      } catch {
        continue;
      }
    }
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, name), body);
    written.push(join(dest, name));
  }
  return written;
}
