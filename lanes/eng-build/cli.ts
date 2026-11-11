// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals eb: the eng-review build read (prereg 2026-11-11-geva-522-eng-review-build-read-prereg). Every error line
// on stderr starts with its reason code. The unit builder, verifier, review bundle and arm table plug their own
// subcommands into SUBCOMMANDS when they land.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { analyze } from "./analysis.ts";
import { dryRun } from "./dryrun.ts";
import { wiredSeams } from "./dryrun-seams.ts";
import { EbError, fail } from "./errors.ts";
import { SIZE } from "./frozen.ts";
import { exposureGate, gateState, pilotLine, pilotReading } from "./gates.ts";
import { ITEMS, reproject, type Design, type Measured } from "./ledger.ts";
import { containUnit } from "./contain.ts";
import { removeCoverageImages } from "./coverage.ts";
import { buildLauncher, noteLauncher, reviewLauncher } from "./launch.ts";
import { bundleFor, buildUnits, paidItem, readUnits, runBuilds, runReviews, screenAll, underLease, unitGrader, writeNotes, type BuiltUnit, type ReviewUnit } from "./pipeline.ts";
import { main as recountMain } from "./recount.ts";
import { liveRouteCalls, probeRoutes, ROUTES } from "./routes.ts";
import { screenCandidate, type Candidate } from "./screen.ts";
import type { Arm, BuildUnit, GradedBuild, Reviewer, ReviewRecord } from "./types.ts";
import { buildUnit, type UnitSpec } from "./unit.ts";

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

const ARMS: readonly Arm[] = ["none", "plain", "precut", "engphase", "candidate"];
const armOf = (a: Args): Arm => {
  const arm = need(a, "--arm") as Arm;
  if (!ARMS.includes(arm)) fail("E_USAGE", "--arm is one of " + ARMS.join(", "));
  return arm;
};
/** --arm as a comma list: every arm of one launch runs under its one lease. */
const armsOf = (a: Args): Arm[] => {
  const arms = need(a, "--arm").split(",") as Arm[];
  const bad = arms.filter((x) => !ARMS.includes(x));
  if (bad.length || new Set(arms).size !== arms.length) fail("E_USAGE", "--arm takes arms from " + ARMS.join(", ") + ", each once, joined by commas");
  return arms;
};
const repsOf = (a: Args): number[] => {
  const reps = need(a, "--reps").split(",").map(Number);
  if (!reps.length || reps.some((r) => !Number.isSafeInteger(r) || r < 1)) fail("E_USAGE", "--reps takes rep numbers from 1, joined by commas");
  return reps;
};
const paid = (stage: "notes" | "review" | "build", a: Args) => paidItem(stage, { item: a.flags.get("--item"), capUsd: a.flags.get("--cap-usd"), record: a.flags.get("--ledger-record"), ledger: a.flags.get("--ledger") });
const logTo = (io: Io) => (l: string) => (/^E_[A-Z_]+ /.test(l) ? io.err : io.out)(l);
const PAID = "--item <item> --cap-usd <usd> --ledger-record <dir> --ledger <file>";

/** Joins each spec with the unit buildUnits wrote for it, dropping specs whose unit did not qualify or did not pass the
 * containment gates (units.json lists the units that did both). */
const builtUnits = (a: Args): BuiltUnit[] => {
  const units = readUnits(need(a, "--units"));
  const listed = join(need(a, "--units"), "units.json");
  const passed = existsSync(listed) ? new Set(json<{ id: string }[]>(listed).map((u) => u.id)) : null;
  return json<{ spec: UnitSpec; repo: string }[]>(need(a, "--specs")).flatMap(({ spec, repo }) => {
    const u = passed === null || passed.has(spec.id) ? units.get(spec.id) : undefined;
    return u ? [{ dir: u.dir, repo, spec, unit: u.unit }] : [];
  });
};

const screen: Run = (a, io) => {
  const r = screenAll({ candidates: json<Candidate[]>(need(a, "--candidates")), repo: need(a, "--repo"), work: need(a, "--work"), screen: screenCandidate, log: logTo(io) });
  if (a.flags.has("--out")) writeFileSync(a.flags.get("--out")!, JSON.stringify(r, null, 1) + "\n");
  io.out("screen: " + r.filter((x) => x.qualifies).length + " of " + r.length + " candidates qualify");
  return 0;
};

const units: Run = async (a, io) => {
  const trees = need(a, "--repos");
  const kept = await buildUnits({ specs: json<{ spec: UnitSpec; repo: string }[]>(need(a, "--specs")), out: need(a, "--out"), work: need(a, "--work"), labels: need(a, "--labels"), seed: seed(a), build: buildUnit, log: logTo(io), gate: (u) => containUnit({ dir: u.dir, repo: u.repo, spec: u.spec, trees }) });
  writeFileSync(join(need(a, "--out"), "units.json"), JSON.stringify(kept.map((k) => k.unit), null, 1) + "\n");
  io.out("units: " + kept.length + " built and qualifying");
  return 0;
};

const notes: Run = async (a, io) => {
  const p = paid("notes", a);
  const list = builtUnits(a);
  const r = await underLease(p, noteLauncher({ out: join(need(a, "--out"), "meter"), cacheDir: need(a, "--cache") }), (call) => writeNotes({ units: list, out: need(a, "--out"), call, log: logTo(io) }));
  io.out("notes: " + r.written.length + " written, " + r.refused.length + " refused by the audit");
  return r.refused.length ? 2 : 0;
};

const recount: Run = (a) => recountMain([...[...a.flags].flatMap(([k, v]) => [k, v]), ...a.bools, ...a.rest]);

const review: Run = async (a, io) => {
  const arms = armsOf(a);
  if (arms.includes("none")) fail("E_USAGE", "the none arm runs no review session");
  const p = paid("review", a);
  const reviewer = reviewerOf(a);
  const reps = repsOf(a);
  const out = need(a, "--out");
  const list = json<ReviewUnit[]>(need(a, "--review-units"));
  const skill = arms as Exclude<Arm, "none">[];
  await underLease(p, reviewLauncher({ arms: skill, reviewer, out, env: process.env, log: logTo(io), ...(a.flags.has("--policy") ? { policy: a.flags.get("--policy")! } : {}) }), async (session) => {
    for (const arm of skill) {
      const recs = await runReviews({ units: list, arm, reviewer, reps, out, session, log: logTo(io) });
      io.out("review " + arm + " on " + reviewer + ": " + recs.length + " sessions, " + recs.filter((r) => r.outcome === "upstream_gap" || r.outcome === "infra_gap").length + " gaps, $" + recs.reduce((s, r) => s + r.costUsd, 0).toFixed(2));
    }
  });
  return 0;
};

const bundle: Run = (a, io) => {
  const arm = armOf(a);
  if (arm === "none") fail("E_USAGE", "the none arm has no review bundle");
  const read = (f: string) => (a.flags.has(f) ? readFileSync(a.flags.get(f)!, "utf8") : null);
  const b = bundleFor(arm as Exclude<Arm, "none">, { plan: read("--plan"), transcript: read("--transcript") ?? "", stateRoot: a.flags.get("--state-root") ?? null, coverage: a.flags.get("--coverage") ?? null }, need(a, "--out"));
  io.out("bundle: " + b.parts.join(", ") + "; " + b.words + " words" + (b.truncated ? ", cut from " + b.fullWords : ""));
  return 0;
};

const readRecords = (dir: string): ReviewRecord[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => json<ReviewRecord>(join(dir, f))) : []);

const build: Run = async (a, io) => {
  const arms = armsOf(a);
  const p = paid("build", a);
  const reviewer = arms.includes("none") ? null : reviewerOf(a);
  const unitsDir = need(a, "--units");
  const all = readUnits(unitsDir);
  const notesDir = need(a, "--notes");
  const list = [...all.values()].map(({ unit }) => {
    const f = join(notesDir, unit.id.replace(/[^A-Za-z0-9._-]/g, "_") + ".md");
    return { unit, note: existsSync(f) ? readFileSync(f, "utf8") : fail("E_USAGE", "unit " + unit.id + " has no statement note in " + notesDir) };
  });
  const reps = repsOf(a);
  const out = need(a, "--out");
  const reviews = reviewer === null ? [] : readRecords(join(need(a, "--reviews"), "records"));
  const launcher = buildLauncher({ arm: arms, units: all, repos: need(a, "--repos"), plans: need(a, "--plans"), bundles: reviewer === null ? null : join(need(a, "--reviews"), "bundles"), out, host: need(a, "--host"), envelopeHost: need(a, "--envelope-host"), sidecar: need(a, "--sidecar"), forbidden: [unitsDir, join(homedir(), ".capy", "drive")], planned: list.length * reps.length * arms.length });
  const grader = unitGrader({ dirs: new Map([...all].map(([id, u]) => [id, u.dir])), work: need(a, "--work"), log: logTo(io) });
  try {
    await underLease(p, launcher, async (session) => {
      for (const arm of arms) {
        const done = await runBuilds({ units: list, arm, reviewer, reps, pilot: a.bools.has("--pilot"), reviews, out, session, grader, log: logTo(io) });
        writeFileSync(join(out, "builds-" + arm + (reviewer ? "-" + reviewer : "") + ".json"), JSON.stringify(done, null, 1) + "\n");
        io.out("build " + arm + (reviewer ? " on " + reviewer : "") + ": " + done.length + " cells, $" + done.reduce((s, b) => s + b.costUsd, 0).toFixed(2));
      }
    });
  } finally {
    removeCoverageImages();
  }
  return 0;
};

const grade: Run = async (a, io) => {
  const dir = need(a, "--unit");
  const units = readUnits(join(dir, ".."));
  const u = [...units.values()].find((x) => x.dir === dir) ?? fail("E_USAGE", dir + " is not a built unit folder");
  const runs = a.flags.has("--runs") ? Number(a.flags.get("--runs")) : 3;
  try {
    const r = await unitGrader({ dirs: new Map([[u.unit.id, dir]]), work: need(a, "--work"), runs, log: logTo(io) })({ unit: u.unit, tree: need(a, "--tree") });
    io.out(JSON.stringify(r));
  } finally {
    removeCoverageImages();
  }
  return 0;
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
  screen: { run: screen, bools: [], usage: "--candidates <json> --repo <dir> --work <dir> [--out <json>]", summary: "screen candidate merges for a live aftermath case (Docker, no model call)" },
  units: { run: units, bools: [], usage: "--specs <json> --out <dir> --work <dir> --labels <file> --seed <n> --repos <dir>", summary: "build units from their specs and keep the ones that qualify and pass the containment gates on their build trees in --repos (Docker, no model call)" },
  notes: { run: notes, bools: [], usage: "--specs <json> --units <dir> --out <dir> --cache <dir> " + PAID, summary: "write and audit each unit's statement note (paid: eb-build-units)" },
  recount: { run: recount, bools: [], usage: "[recount.ts arguments]", summary: "the clean-unit recount, counts only" },
  review: { run: review, bools: [], usage: "--review-units <json> --arm <arm> --reviewer opus|sol|particle --reps 1,2,3 --out <dir> [--policy <file>] " + PAID, summary: "run the review sessions for one arm and reviewer, and their bundles (paid)" },
  bundle: { run: bundle, bools: [], usage: "--arm <arm> --out <review dir> [--plan <file>] [--transcript <file>] [--state-root <dir>] [--coverage <dir>]", summary: "assemble one review bundle; a resume refuses other bytes" },
  build: { run: build, bools: ["--pilot"], usage: "--units <dir> --notes <dir> --repos <dir> --plans <dir> --reviews <review out> --arm <arm> [--reviewer r] --reps 1,2,3 --out <dir> --work <dir> --host <ip> --envelope-host <id> --sidecar <url> [--pilot] " + PAID, summary: "run and grade the build sessions for one arm (paid)" },
  grade: { run: grade, bools: [], usage: "--unit <dir> --tree <dir holding final.patch> --work <dir> [--runs n]", summary: "grade one build tree on its unit's functional and aftermath sets (Docker)" },
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
