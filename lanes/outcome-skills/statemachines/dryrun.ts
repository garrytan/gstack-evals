// Copyright (c) 2026 Garry Tan. MIT License.
// The family SM dry run (the post's section 18): it reads a config of real units and cases, runs the cases in order
// through the module's own CLI (score first, score followon), checks each record against the case's expected fields,
// prints one PASS or FAIL line per case and stops at the first miss. Unit ids, digests and planted patches live in the
// config, outside the repo. It ends DRYRUN: ok when every case passed. No key, no paid call.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BIN = join(import.meta.dir, "../../../bin/gstack-evals");
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;

export interface DryrunCase {
  name: string;
  kind: "first" | "followon";
  unit: string;
  /** The change to score; omitted for the base tree, which scores with --run-empty. */
  patch?: string;
  cell?: string;
  /** followon only: the tree, the first stage's patch on it and the tree's start set. */
  tree?: string;
  tree_patch?: string;
  start?: string;
  /** Dotted paths into the record and the values they must hold, compared as JSON. */
  expect: Record<string, unknown>;
}
export interface DryrunConfig { schema: "sm-dryrun-config.v1"; units: Record<string, { dir: string; image_digest: string }>; cases: DryrunCase[] }

const at = (v: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), v);

/** The expected fields a record misses, as "path: got X, want Y" lines; empty when it holds every one. */
export function misses(record: unknown, expect: Record<string, unknown>): string[] {
  return Object.entries(expect).flatMap(([p, want]) => (JSON.stringify(at(record, p)) === JSON.stringify(want) ? [] : [p + ": got " + JSON.stringify(at(record, p)) + ", want " + JSON.stringify(want)]));
}

/** The CLI arguments that score one case into out. */
export function caseArgs(c: DryrunCase, unitDir: string, out: string): string[] {
  const cell = ["--cell", c.cell ?? c.name];
  if (c.kind === "first") return ["outcome", "sm", "score", "first", "--unit", unitDir, ...(c.patch ? ["--patch", c.patch, ...cell] : ["--patch", "/dev/null", ...cell, "--run-empty"]), "--out", out];
  if (!c.tree || !c.start || !c.patch) throw new Error("E_USAGE followon case " + c.name + " needs tree, start and patch");
  return ["outcome", "sm", "score", "followon", "--unit", unitDir, "--tree", c.tree, ...(c.tree_patch ? ["--tree-patch", c.tree_patch] : []), "--start", c.start, "--patch", c.patch, ...cell, "--out", out];
}

/** Runs the config's cases in order from the named one; returns 0 when every case passed, 1 at the first miss. */
export function dryrun(cfg: DryrunConfig, outDir: string, o: { from?: string; run?: (args: string[]) => { status: number; out: string }; log?: (line: string) => void } = {}): number {
  const log = o.log ?? ((l: string) => console.log(l));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k)));
  const run = o.run ?? ((args: string[]) => {
    const r = spawnSync(BIN, args, { encoding: "utf8", env, maxBuffer: 1 << 28 });
    return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  });
  if (cfg.schema !== "sm-dryrun-config.v1") throw new Error("E_USAGE the config's schema is not sm-dryrun-config.v1");
  const start = o.from ? cfg.cases.findIndex((c) => c.name === o.from) : 0;
  if (start < 0) throw new Error("E_USAGE no case named " + o.from);
  mkdirSync(outDir, { recursive: true });
  for (const c of cfg.cases.slice(start)) {
    const u = cfg.units[c.unit] ?? (() => { throw new Error("E_USAGE case " + c.name + " names unit " + c.unit + ", which the config does not hold"); })();
    const out = join(outDir, c.name + ".json");
    if (existsSync(out)) throw new Error("E_USAGE " + out + " exists; a dry run writes each record once");
    const r = run(caseArgs(c, u.dir, out));
    const miss = r.status !== 0 || !existsSync(out) ? ["exit " + r.status + ": " + r.out.trim().split("\n").slice(-2).join(" | ")] : misses(JSON.parse(readFileSync(out, "utf8")), c.expect);
    log((miss.length ? "FAIL " : "PASS ") + c.name + ": " + (miss.length ? miss.join("; ") : Object.entries(c.expect).map(([p, v]) => p + "=" + JSON.stringify(v)).join(" ")));
    if (miss.length) return 1;
  }
  log("DRYRUN: ok");
  return 0;
}
