// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals eb: the eng-review build read (prereg 2026-11-11-geva-522-eng-review-build-read-prereg). Every error line
// on stderr starts with its reason code. The unit builder, verifier, review bundle and arm table plug their own
// subcommands into SUBCOMMANDS when they land.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { analyze } from "./analysis.ts";
import { dryRun } from "./dryrun.ts";
import { wiredSeams } from "./dryrun-seams.ts";
import { EbError, fail } from "./errors.ts";
import { SIZE } from "./frozen.ts";
import { exposureGate, gateState, pilotLine, pilotReading } from "./gates.ts";
import { ITEMS, reproject, type Design, type Measured } from "./ledger.ts";
import { liveRouteCalls, probeRoutes, ROUTES } from "./routes.ts";
import type { Arm, BuildUnit, GradedBuild, Reviewer, ReviewRecord } from "./types.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

type Run = (args: Args, io: Io) => Promise<number> | number;
type Args = { flags: Map<string, string>; bools: Set<string>; rest: string[] };

function parse(argv: string[], bools: string[]): Args {
  const flags = new Map<string, string>();
  const on = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) rest.push(a);
    else if (bools.includes(a)) on.add(a);
    else {
      const v = argv[++i];
      if (v === undefined) fail("E_USAGE", a + " needs a value");
      flags.set(a, v!);
    }
  }
  return { flags, bools: on, rest };
}

const need = (a: Args, flag: string): string => a.flags.get(flag) ?? fail("E_USAGE", "missing " + flag);
const json = <T>(path: string): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    return fail("E_USAGE", path + ": " + (e as Error).message);
  }
};
const seed = (a: Args) => {
  const s = Number(need(a, "--seed"));
  if (!Number.isSafeInteger(s) || s < 0) fail("E_USAGE", "--seed takes the whole number minted at the build");
  return s;
};
const reviewerOf = (a: Args): Reviewer => {
  const r = a.flags.get("--reviewer") ?? "opus";
  if (r !== "opus" && r !== "sol" && r !== "particle") fail("E_USAGE", "--reviewer is opus, sol or particle");
  return r as Reviewer;
};
const plannedFor = (units: number): Record<Arm, number> => ({ none: units * SIZE.kNone, plain: units * SIZE.k, precut: units * SIZE.k, engphase: units * SIZE.k, candidate: units * SIZE.k });

const pilot: Run = (a, io) => {
  const r = pilotReading(json<BuildUnit[]>(need(a, "--units")), json<GradedBuild[]>(need(a, "--builds")), seed(a));
  const d = pilotLine(r);
  if (d.code) {
    io.err(d.code + " " + d.message);
    return 2;
  }
  io.out(d.message);
  return 0;
};

const gate: Run = (a, io) => {
  const g = exposureGate(json<ReviewRecord[]>(need(a, "--smoke")));
  for (const x of g.arms) io.out("gate " + x.arm + " on " + x.reviewer + ": exposed " + x.exposed + " of " + x.sessions + ", needs " + x.need + ", " + (x.passed ? "through" : "out"));
  io.out("pooled membership: " + (g.members.join(", ") || "none"));
  for (const l of g.lines) io.err(l);
  return g.stop ? 2 : 0;
};

const analyzeCmd: Run = (a, io) => {
  const units = json<BuildUnit[]>(need(a, "--units"));
  const reviewer = reviewerOf(a);
  const reviews = json<ReviewRecord[]>(need(a, "--reviews"));
  const g = gateState(exposureGate(json<ReviewRecord[]>(need(a, "--smoke"))), reviewer, reviews);
  const result = analyze({ units, builds: json<GradedBuild[]>(need(a, "--builds")), reviews, reviewer, gate: g, headroom: a.bools.has("--headroom"), planned: a.flags.has("--planned") ? json<Record<Arm, number>>(a.flags.get("--planned")!) : plannedFor(units.length), seed: seed(a) });
  for (const l of result.lines) io.out(l);
  if (a.flags.has("--out")) writeFileSync(a.flags.get("--out")!, JSON.stringify(result, null, 1) + "\n");
  return 0;
};

const reprojectCmd: Run = (a, io) => {
  const power = json<{ mdd: Record<string, number | null> }>(need(a, "--mdd"));
  const r = reproject({
    measured: json<Measured>(need(a, "--measured")),
    caps: json<{ reviews: number; builds: number }>(need(a, "--caps")),
    mdd: (d: Design) => power.mdd[d.units + "x" + d.k] ?? fail("E_USAGE", need(a, "--mdd") + " has no pooled MDD for " + d.units + "x" + d.k + "; run power.py --fit with --json"),
  });
  for (const l of r.lines) (l.startsWith("E_EB_") ? io.err : io.out)(l);
  return r.stop ? 2 : 0;
};

const routes: Run = async (a, io) => {
  if (!a.bools.has("--live")) {
    for (const r of ROUTES) io.out("route " + r.name + ": " + r.model + " on " + r.item + " (" + r.use + ")");
    io.out("add --live --out <dir> --cache <dir> to send one real call per route through each item's lease");
    return 0;
  }
  const live = liveRouteCalls({ out: need(a, "--out"), cacheDir: need(a, "--cache"), record: a.flags.get("--ledger-record"), ledger: a.flags.get("--ledger") });
  try {
    const r = await probeRoutes(live.call);
    for (const l of r.lines) (l.includes(": FAIL") ? io.err : io.out)(l);
    return r.ok ? 0 : 2;
  } finally {
    await live.close();
  }
};

const items: Run = (_a, io) => {
  for (const i of ITEMS) io.out(i.item + ": " + i.row + "; projection $" + i.projectionUsd + ", plan cap $" + i.capUsd + (i.conditional ? " (conditional)" : ""));
  return 0;
};

const dryrun: Run = async (a, io) => {
  const part = a.flags.get("--part") ?? "all";
  if (part !== "own" && part !== "all") fail("E_USAGE", "--part is own or all");
  const wired = part === "all" ? wiredSeams() : null;
  let r: Awaited<ReturnType<typeof dryRun>>;
  try {
    r = await dryRun({ part: part as "own" | "all", ...(wired ? { seams: wired.seams } : {}) });
  } finally {
    wired?.close();
  }
  for (const l of r.lines) (l.startsWith("FAIL") || l.startsWith("SKIP") ? io.err : io.out)(l);
  if (!r.ok) {
    const failed = r.failed.length ? r.failed.length + " case(s) failed: " + r.failed.join(", ") : "no case failed";
    io.err("E_EB_DRYRUN_FAIL " + failed + (r.skipped.length ? "; " + r.skipped.length + " seam(s) skipped, never a pass: " + r.skipped.join(", ") : ""));
    return 2;
  }
  io.out("dry run: " + r.lines.length + " cases, every line matches");
  return 0;
};

const power: Run = (a, io) => {
  const r = spawnSync("python3", [join(import.meta.dir, "power.py"), ...a.rest], { encoding: "utf8" });
  if (r.stdout) io.out(r.stdout.trimEnd());
  if (r.status !== 0) io.err("E_USAGE power.py exited " + (r.status ?? r.signal) + (r.stderr ? ": " + r.stderr.trim().split("\n").at(-1) : ""));
  return r.status === 0 ? 0 : 2;
};

export const SUBCOMMANDS: Record<string, { run: Run; bools: string[]; usage: string; summary: string }> = {
  pilot: { run: pilot, bools: [], usage: "--units <json> --builds <json> --seed <n>", summary: "the headroom pilot's stop lines in order (reach, floor, ceiling, else HEADROOM)" },
  gate: { run: gate, bools: [], usage: "--smoke <reviews json>", summary: "the exposure gate and the pooled primary's membership" },
  analyze: { run: analyzeCmd, bools: ["--headroom"], usage: "--units <json> --builds <json> --reviews <json> --smoke <json> --seed <n> [--reviewer opus|sol|particle] [--headroom] [--planned <json>] [--out <json>]", summary: "the frozen readings: pooled primary, fixed sequence, Holm, verdicts, secondaries, strata, MDDs" },
  reproject: { run: reprojectCmd, bools: [], usage: "--measured <json> --caps <json> --mdd <power.py --fit --json output>", summary: "the money re-projection with the frozen cut order and the 0.12 MDD stop" },
  routes: { run: routes, bools: ["--live"], usage: "[--live --out <dir> --cache <dir> [--ledger-record <dir>] [--ledger <file>]]", summary: "the live probe of every model route, one call each on its first stage's item" },
  items: { run: items, bools: [], usage: "", summary: "the ledger line items, one per row of the money table" },
  dryrun: { run: dryrun, bools: [], usage: "[--part own|all]", summary: "the keyless dry run of every frozen rule; all fails until every seam is wired" },
  power: { run: power, bools: [], usage: "[power.py arguments]", summary: "the parametric MDD simulation (power.py)" },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals eb <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(10) + v.summary + (v.usage ? "\n" + " ".repeat(12) + v.usage : ""))].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals eb: unknown command " + JSON.stringify(sub) + "; gstack-evals eb --help lists them"));
    return 2;
  }
  try {
    return await entry.run(parse(rest, entry.bools), io);
  } catch (e) {
    if (!(e instanceof EbError)) throw e;
    io.err(lines(e.code, "gstack-evals eb " + sub + ": " + e.message));
    return CODES[e.code].exit ?? 2;
  }
}
