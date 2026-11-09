// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's keyless dry run (prereg 2026-11-09-geva-417 section 15 rule 4): it runs every part's checks, each
// line driving one frozen rule on both sides of its edge on fixtures, and the lease lines that open and settle one
// ledger lease per frozen run on a temporary ledger. A part whose checks.ts is not built yet is one FAIL line. It
// exits 0 only when every line passes. No key is read, no model is called and no host other than localhost is used.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "./cli.ts";
import type { DryCheck, PartChecks } from "./types.ts";

export interface Part {
  name: string;
  /** Absolute path of the module that exports checks(). */
  path: string;
}

/** Every part's checks module, in build order. */
export const PARTS: readonly Part[] = [
  { name: "mine", path: join(import.meta.dir, "mine", "checks.ts") },
  { name: "author", path: join(import.meta.dir, "author", "checks.ts") },
  { name: "run", path: join(import.meta.dir, "run", "checks.ts") },
  { name: "session", path: join(import.meta.dir, "run", "session-checks.ts") },
  { name: "score", path: join(import.meta.dir, "score", "checks.ts") },
  { name: "stage3", path: join(import.meta.dir, "stage3", "checks.ts") },
  { name: "leases", path: join(import.meta.dir, "leases.ts") },
];

export interface Line extends DryCheck {
  part: string;
}

/** Runs one part's checks; a missing module, a module with no checks() and a throw are each one FAIL line. */
export async function partLines(part: Part): Promise<Line[]> {
  if (!existsSync(part.path)) return [{ part: part.name, rule: "part not built", pass: false, detail: part.path.slice(part.path.lastIndexOf("lanes/")) + " does not exist yet" }];
  try {
    const mod = (await import(part.path)) as { checks?: PartChecks };
    if (typeof mod.checks !== "function") return [{ part: part.name, rule: "part exports no checks()", pass: false }];
    const lines = await mod.checks();
    if (!Array.isArray(lines) || lines.length === 0) return [{ part: part.name, rule: "part's checks() returned no line", pass: false }];
    return lines.map((l) => ({ part: part.name, rule: String(l.rule), pass: l.pass === true, ...(l.detail ? { detail: String(l.detail) } : {}) }));
  } catch (e) {
    return [{ part: part.name, rule: "part's checks threw", pass: false, detail: ((e as Error).message ?? String(e)).split("\n")[0] }];
  }
}

/** Every part's lines, one part at a time so no two temporary ledgers or fixture trees race. */
export async function dryRun(parts: readonly Part[] = PARTS): Promise<Line[]> {
  const out: Line[] = [];
  for (const p of parts) out.push(...(await partLines(p)));
  return out;
}

export const format = (l: Line) => (l.pass ? "PASS " : "FAIL ") + l.part + ": " + l.rule + (l.detail ? " (" + l.detail + ")" : "");

const USAGE = "gstack-evals dx dryrun [--part <" + PARTS.map((p) => p.name).join("|") + ">]";

export async function run(argv: string[], io: Io): Promise<number> {
  let only: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      io.out(USAGE);
      return 0;
    }
    if (a === "--part" && PARTS.some((p) => p.name === argv[i + 1])) only = argv[++i];
    else throw Object.assign(new Error("unknown or malformed argument " + JSON.stringify(a) + "; usage: " + USAGE), { code: "E_USAGE" });
  }
  const lines = await dryRun(PARTS.filter((p) => only === undefined || p.name === only));
  for (const l of lines) io.out(format(l));
  const failed = lines.filter((l) => !l.pass).length;
  io.out("dx dryrun: " + (lines.length - failed) + " PASS, " + failed + " FAIL");
  return failed ? 1 : 0;
}
