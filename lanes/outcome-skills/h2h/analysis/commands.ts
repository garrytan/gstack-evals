// Copyright (c) 2026 Garry Tan. MIT License.
// h2h analyze, readout, ledger-dryrun and power-table: plan sections 9 to 11 and 13 to 15.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlags, type Command } from "../cli.ts";
import { h2hFail, readPrereg } from "../prereg.ts";
import type { H2hScore, H2hSession, H2hUnit, Stage, UnitClass, UnitKind } from "../types.ts";
import { analyze, report } from "./analyze.ts";
import { ledgerDryRun } from "./ledger-dryrun.ts";
import { powerTable } from "./power.ts";
import { readKey, readout, seal } from "./readout.ts";

const fail = (m: string): never => h2hFail("E_H2H_ANALYSIS_INPUT", m);
function parse(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(path + " is not readable JSON: " + (e as Error).message);
  }
}

/** Records of one schema from a JSON file (a list, a single record, or an object holding a records, sessions or scores
 *  list), a JSONL file, or every .json file below a directory that holds that schema. */
export function readRecords<T>(path: string, schema: string): T[] {
  if (!existsSync(path)) fail(path + " does not exist");
  if (statSync(path).isDirectory()) {
    const out: T[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d).sort()) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith(".json")) {
          const j = parse(p) as { schema?: string };
          if (j?.schema === schema) out.push(j as T);
        }
      }
    };
    walk(path);
    return out;
  }
  const text = readFileSync(path, "utf8");
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    j = text.split("\n").filter((l) => l.trim()).map((l, k) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        return fail(path + " line " + (k + 1) + " is not JSON: " + (e as Error).message);
      }
    });
  }
  const o = j as Record<string, unknown>;
  const list = Array.isArray(j) ? j : Array.isArray(o.records) ? o.records : Array.isArray(o.sessions) ? o.sessions : Array.isArray(o.scores) ? o.scores : [j];
  for (const r of list as { schema?: string }[]) if (r?.schema !== schema) fail(path + " holds a record that is not " + schema);
  return list as T[];
}

interface Drawn { id: string; repo: string; month: string; entry?: string; position: number; stage: string; language?: string; licence?: string; image_digest?: string; digest?: string; kind?: string; class?: string }
/** Units from h2h draw outputs (an h2h-draw.v1 walk, a B draw with b1 and b2 walks, or a list), with language, licence and
 *  digest filled from frame files by id. */
export function readAnalysisUnits(paths: readonly string[], frames: readonly string[]): H2hUnit[] {
  const frame = new Map<string, Record<string, unknown>>();
  for (const f of frames) for (const u of ((parse(f) as { units?: Record<string, unknown>[] }).units ?? fail(f + " has no units list"))) frame.set(String(u.id), u);
  const out: H2hUnit[] = [];
  const take = (units: Drawn[], kind: UnitKind | undefined) => {
    for (const u of units) {
      const k = (u.kind ?? kind ?? (u.class === "O" ? "O" : undefined)) as UnitKind | undefined;
      if (k !== "O" && k !== "B1" && k !== "B2") fail("unit " + u.id + " has no kind (O, B1 or B2)");
      const fr = frame.get(u.id) ?? {};
      const cls: UnitClass = k === "O" ? "O" : "B";
      const entry = u.entry ?? (fr.entry as string | undefined) ?? (cls === "B" ? "bug" : undefined);
      if (entry !== "bug" && entry !== "feature") fail("unit " + u.id + " has no bug or feature entry");
      out.push({
        id: u.id, class: cls, kind: k!, repo: u.repo ?? String(fr.repo ?? ""), month: u.month ?? String(fr.month ?? ""), language: u.language ?? String(fr.language ?? "unknown"),
        entry: entry as H2hUnit["entry"], image_digest: u.image_digest ?? u.digest ?? String(fr.digest ?? fr.image_digest ?? ""), licence: u.licence ?? String(fr.licence ?? ""),
        position: u.position, stage: u.stage as H2hUnit["stage"],
      });
    }
  };
  for (const p of paths) {
    const j = parse(p) as Record<string, unknown>;
    if (Array.isArray(j)) take(j as Drawn[], undefined);
    else if (j.schema === "h2h-draw.v1") take(j.units as Drawn[], j.kind as UnitKind);
    else if (j.b1 && typeof j.b1 === "object") for (const w of [j.b1, j.b2].filter(Boolean) as { kind: UnitKind; units: Drawn[] }[]) take(w.units, w.kind);
    else fail(p + " is not a draw output or a units list");
  }
  for (const u of out) if (!u.repo) fail("unit " + u.id + " has no repository (pass its frame with --frame)");
  return out;
}

const writeNew = (path: string, text: string) => {
  try {
    writeFileSync(path, text, { flag: "wx" });
  } catch (e) {
    h2hFail("E_USAGE", path + " cannot be written as a new file: " + (e as Error).message);
  }
};
const STAGES: readonly Stage[] = ["stage0", "stage1", "stage2"];
const INPUT_FLAGS = ["--units", "--frame", "--sessions", "--scores"];
const inputs = (f: NonNullable<ReturnType<typeof parseFlags>>) => {
  if (!f.all("--units").length || !f.all("--sessions").length || !f.all("--scores").length) h2hFail("E_USAGE", "--units, --sessions and --scores are each required");
  return {
    units: readAnalysisUnits(f.all("--units"), f.all("--frame")),
    sessions: f.all("--sessions").flatMap((x) => readRecords<H2hSession>(x, "h2h-session.v1")),
    scores: f.all("--scores").flatMap((x) => readRecords<H2hScore>(x, "h2h-score.v1")),
  };
};
const readCaps = (path: string | undefined) => {
  if (!path) return undefined;
  const j = parse(path) as Record<string, unknown>;
  for (const [k, v] of Object.entries(j)) if (typeof v !== "number" || !(v > 0)) fail(path + ": cap " + k + " is not a positive number of dollars");
  return j as Record<string, number>;
};

const ANALYZE_HELP = `Usage: gstack-evals h2h analyze --units <draw output> --sessions <file|dir> --scores <file|dir> --out <analysis.json> [--frame <frame>] [--stage stage2] [--run-as-published <arms>]
Section 9's analysis of one stage: the 12 contrasts with Obuchowski's clustered McNemar test, exact McNemar, Holm over
the 12, the clustered bootstrap interval (bootstrap_seed), the MDD and the row states; exposure, secondaries, strata, piece
G and the section 10 rows that fire. --units, --frame, --sessions and --scores repeat. --run-as-published names stage 0
rulings. The analysis JSON goes to --out (a new file); the table prints.`;
const analyzeCmd: Command = async (argv) => {
  const f = parseFlags(argv, [...INPUT_FLAGS, "--out", "--stage", "--run-as-published"], [], ANALYZE_HELP, INPUT_FLAGS);
  if (!f) return 0;
  const stage = (f.one("--stage") ?? "stage2") as Stage;
  if (!STAGES.includes(stage)) h2hFail("E_USAGE", "--stage is stage0, stage1 or stage2");
  const out = f.need("--out");
  const a = analyze({ ...inputs(f), stage, runAsPublished: (f.one("--run-as-published") ?? "").split(",").filter(Boolean) }, readPrereg());
  writeNew(out, JSON.stringify(a, null, 2) + "\n");
  for (const l of report(a)) console.log(l);
  return 0;
};

const READOUT_HELP = `Usage: gstack-evals h2h readout --units <draw output> --sessions <file|dir> --scores <file|dir> --key <key file> --out <sealed file> [--frame <frame>] [--caps <caps.json>] [--release <file>]
Section 11's sealed stage 1 readout. Prints only the release list and the frozen readings (FLOOR, CEILING, INFRA, COST);
every per-arm outcome goes into --out, encrypted (AES-256-GCM) with the key (32 raw bytes or 64 hex characters, mode 0600,
outside any git work tree). --out must not exist; its sha256 prints on stderr for the stage 1 run record. --caps holds the
approvals record's caps as {"item": dollars}; the post's A2 caps are the default.`;
const readoutCmd: Command = async (argv) => {
  const f = parseFlags(argv, [...INPUT_FLAGS, "--key", "--out", "--caps", "--release"], [], READOUT_HELP, INPUT_FLAGS);
  if (!f) return 0;
  const key = readKey(f.need("--key"));
  const out = f.need("--out");
  if (existsSync(out)) h2hFail("E_H2H_READOUT_OUT", out + " already exists; a sealed file is never overwritten");
  const r = readout({ ...inputs(f), caps: readCaps(f.one("--caps")) }, readPrereg());
  const text = JSON.stringify(r.release, null, 2) + "\n";
  if (f.one("--release")) writeNew(f.need("--release"), text);
  const digest = seal(r.sealed, key, out);
  process.stdout.write(text);
  console.error("sealed " + out + " sha256 " + digest);
  return 0;
};

const DRYRUN_HELP = `Usage: gstack-evals h2h ledger-dryrun [--dir <dir>] [--caps <caps.json>]
Opens and settles one lease per frozen item on a temporary ledger at the post's A2 caps (or --caps), then drives the
COST rule on fixture sessions. Spends nothing. Exits 2 with E_H2H_LEDGER_DRYRUN when a check fails.`;
const dryrunCmd: Command = async (argv) => {
  const f = parseFlags(argv, ["--dir", "--caps"], [], DRYRUN_HELP);
  if (!f) return 0;
  const r = ledgerDryRun(readPrereg(), { dir: f.one("--dir"), caps: readCaps(f.one("--caps")) });
  for (const c of r.checks) console.log((c.ok ? "PASS " : "FAIL ") + c.name + ": " + c.detail);
  const bad = r.checks.filter((c) => !c.ok);
  if (bad.length) h2hFail("E_H2H_LEDGER_DRYRUN", bad.length + " of " + r.checks.length + " checks failed on the ledger in " + r.dir);
  console.log("ledger dry run: " + r.checks.length + " checks passed in " + r.dir);
  return 0;
};

const powerCmd: Command = async (argv) => {
  const f = parseFlags(argv, [], [], "Usage: gstack-evals h2h power-table\nPrints section 13's table from the TypeScript port of power.py; it matches the bundle's power.txt byte for byte.");
  if (!f) return 0;
  process.stdout.write(powerTable());
  return 0;
};

export const commands: Record<string, Command> = { analyze: analyzeCmd, readout: readoutCmd, "ledger-dryrun": dryrunCmd, "power-table": powerCmd };
