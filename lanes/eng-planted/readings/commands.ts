// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep subcommands from the readings part (scores, the pilot and exposure gates, the judge, the statistics,
// the verdicts and power). The lane's cli.ts merges every part's table. Each reads JSON records the stages part writes
// and prints its lines; a stop line throws its E_EP_ code, which cli.ts prints with the code's fix and docs anchor.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EpError } from "../errors.ts";
import { FROZEN } from "../frozen.ts";
import type { Command, DryCase, GradedBuild, JudgedBundle, PlantedUnit, Reviewer, ReviewRecord } from "../types.ts";
import { analyze, type AnalysisInput } from "./analysis.ts";
import { DRY } from "./dry.ts";
import { admissionLine, admissionReading, enforce, hintedOf, interimCheck, markHard, pilotPowerInput, raiseProjection, raiseRead, raiseStep, smokeGate, startRule, supplyCheck, type Admission, type Hinted, type RaiseInput } from "./gates.ts";
import { judgeCheck, stockControl, type GoldRow } from "./judge.ts";
import { SKILL_ARMS } from "./local.ts";
import { writeStep, type StepRecord } from "../stages/local.ts";

type Args = Parameters<Command["run"]>[0];
type Io = Parameters<Command["run"]>[1];

const usage = (m: string): never => {
  throw new EpError("E_USAGE", m);
};
function readJson<T>(a: Args, flag = "--in"): T {
  const path = a.flags.get(flag) ?? usage(flag + " is required");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    return usage("can't read " + flag + " " + path + ": " + (e as Error).message);
  }
}
function num(a: Args, flag: string, fallback?: number): number {
  const v = a.flags.get(flag);
  if (v === undefined) return fallback ?? usage(flag + " is required");
  const n = Number(v);
  return Number.isFinite(n) ? n : usage(flag + " needs a number, not " + JSON.stringify(v));
}
/** With --run, writes the step record the stages part reads before its next stage (section 14). */
const recordStep = (a: Args, r: Omit<StepRecord, "at">) => void (a.flags.has("--run") && writeStep(a.flags.get("--run")!, r));
const seedOf = (a: Args, file: { seed?: number }) => (a.flags.has("--seed") ? num(a, "--seed") : (file.seed ?? usage("--seed is required: the seed minted at the build")));
const draws = (a: Args) => num(a, "--draws", FROZEN.bootstrapDraws);

/** Prints an admission's lines; a stop prints its code line through cli.ts instead. */
function finish(a: Admission, io: Io): number {
  for (const l of a.code ? a.lines.slice(0, -1) : a.lines) io.out(l);
  enforce(a);
  io.out("primary " + a.primary);
  return 0;
}

interface PilotFile {
  units: PlantedUnit[];
  builds: GradedBuild[];
  hinted?: Hinted;
  raise?: Omit<RaiseInput, "read" | "hard">;
  unforeseeable?: number;
  seed?: number;
}

interface RaiseFile {
  units: PlantedUnit[];
  builds: GradedBuild[];
  hinted?: Hinted;
  hardAdmitted?: number | null;
  seed?: number;
}

export const COMMANDS: Record<string, Command> = {
  pilot: {
    summary: "the admission pilot's lines on plain builds (section 7); a first ceiling prints the content raise's projection",
    usage: "--in <pilot.json> [--seed <n>] [--draws <n>] [--power-json <out>] [--run <dir>]",
    bools: [],
    run: (a, io) => {
      const f = readJson<PilotFile>(a);
      const units = f.units.filter((u) => u.pilot && u.set === "comparison");
      const reading = admissionReading(units, f.builds, f.hinted ?? hintedOf(f.units), seedOf(a, f), draws(a));
      let adm = admissionLine(reading, { afterRaise: false });
      if (adm.code === "E_EP_RAISE") {
        if (!f.raise) usage("the pilot reads a first ceiling; add raise {authored, admitted, unused, perCandidateUsd, perReadUsd} to --in so the projection prints");
        const marked = markHard(units, f.builds, adm.ceiling);
        adm = raiseStep(adm, raiseProjection({ ...f.raise!, read: marked.filter((u) => u.hard !== null).length, hard: marked.filter((u) => u.hard === true).length }));
      }
      const out = a.flags.get("--power-json");
      if (out) {
        writeFileSync(out, JSON.stringify(pilotPowerInput(units, f.builds, f.unforeseeable ?? 0)) + "\n");
        io.out("power input written; re-print the MDD with: uv run -q --with numpy==2.5.4 python lanes/eng-planted/readings/power.py --fit " + out);
      }
      recordStep(a, { step: "admission", ok: adm.code === null, detail: adm.code ? adm.message : "primary " + adm.primary });
      return finish(adm, io);
    },
  },
  raise: {
    summary: "the content raise's read on its hard units' plain builds (section 7), and the hard supply once authored",
    usage: "--in <raise.json> [--seed <n>] [--draws <n>]",
    bools: [],
    run: (a, io) => {
      const f = readJson<RaiseFile>(a);
      return finish(raiseRead(admissionReading(f.units, f.builds, f.hinted ?? hintedOf(f.units), seedOf(a, f), draws(a)), f.hardAdmitted ?? null), io);
    },
  },
  exposure: {
    summary: "the exposure smoke (5 of 6 Opus, 2 of 3 Sol or particle-1) and the interim stop after 24 non-gap sessions (section 6)",
    usage: "--in <sessions.json> [--reviewer opus|sol|particle] [--run <dir>]",
    bools: [],
    run: (a, io) => {
      const f = readJson<{ smoke: ReviewRecord[]; reviews?: ReviewRecord[] }>(a);
      const reviewer = (a.flags.get("--reviewer") ?? "opus") as Reviewer;
      if (!["opus", "sol", "particle"].includes(reviewer)) usage("--reviewer is opus, sol or particle");
      if (a.flags.has("--run") && reviewer !== "opus") usage("--run records the run's exposure gate, which reads the Opus smoke");
      const gate = smokeGate(f.smoke, reviewer);
      for (const l of gate.lines) io.out(l);
      recordStep(a, { step: "exposure-gate", ok: gate.through.length > 0, detail: gate.message || gate.lines.join("; "), arms: gate.through });
      const stops = f.reviews ? SKILL_ARMS.map((arm) => interimCheck(arm, reviewer, f.reviews!)) : [];
      for (const s of stops) if (s.share !== null) io.out("interim " + (s.code ? "stop" : "goes") + ": exposed " + s.share.toFixed(3) + (s.message ? "; " + s.message : ""));
      enforce(gate);
      for (const s of stops) enforce(s);
      return 0;
    },
  },
  start: {
    summary: "the start rule: a re-printed MDD past 0.12 waits for the Captain (section 10)",
    usage: "--mdd <x> [--run <dir>]",
    bools: [],
    run: (a, io) => {
      const d = startRule(num(a, "--mdd"));
      recordStep(a, { step: "start-rule", ok: d.code === null, detail: d.message });
      if (!d.code) io.out(d.message);
      enforce(d);
      return 0;
    },
  },
  admitted: {
    summary: "short supply: under 40 admitted comparison units stops (sections 3 and 9)",
    usage: "--admitted <n>",
    bools: [],
    run: (a, io) => {
      const d = supplyCheck(num(a, "--admitted"));
      if (!d.code) io.out(d.message);
      enforce(d);
      return 0;
    },
  },
  analyze: {
    summary: "the readout: verdicts, decision rows, the Holm headline, secondaries, strata and descriptives (sections 5, 9 and 11)",
    usage: "--in <analysis.json> [--seed <n>] [--draws <n>]",
    bools: [],
    run: (a, io) => {
      const f = readJson<AnalysisInput>(a);
      for (const l of analyze({ ...f, seed: seedOf(a, f), draws: draws(a) }).lines) io.out(l);
      return 0;
    },
  },
  kappa: {
    summary: "the judge check: kappa against gold, sensitivity, specificity and the stock control (sections 5 and 8)",
    usage: "--in <gold.json> [--revision <n>]",
    bools: [],
    run: (a, io) => {
      const f = readJson<{ gold: GoldRow[]; bundles?: JudgedBundle[] }>(a);
      const check = judgeCheck(f.gold);
      for (const l of check.code ? check.lines.slice(0, -1) : check.lines) io.out(l);
      enforce(check);
      if (!f.bundles) return 0;
      const stock = stockControl(f.bundles, num(a, "--revision", 0));
      for (const l of stock.code ? stock.lines.slice(0, -1) : stock.lines) io.out(l);
      enforce(stock);
      return stock.action === "revise" ? 1 : 0;
    },
  },
  power: {
    summary: "power.py, the MDD simulation of section 10 (uv and numpy 2.5.4); with no flags the frozen table",
    usage: "[--rows 64x3[:avoid|catch]] [--n <n> --k <k> ...] [--fit <pilot.json>] [--json]",
    bools: ["--json"],
    run: (a, io) => {
      const argv = [...[...a.flags].flatMap(([k, v]) => [k, v]), ...a.bools, ...a.rest];
      const r = spawnSync("uv", ["run", "-q", "--with", "numpy==2.5.4", "python", join(import.meta.dir, "power.py"), ...argv], { encoding: "utf8", timeout: 3_600_000 });
      if (r.status !== 0) usage("power.py failed: " + (r.error?.message ?? (r.stderr ?? "").trim().split("\n").pop()));
      for (const l of r.stdout.trimEnd().split("\n")) io.out(l);
      return 0;
    },
  },
};

/** This part's keyless dry-run cases; lanes/eng-planted/dryrun.ts runs every part's. */
export const DRY_CASES: DryCase[] = DRY;
