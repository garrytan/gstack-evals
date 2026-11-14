// Copyright (c) 2026 Garry Tan. MIT License.
// dc stage3: stage 3 after stage 2's Opus pass 1 (prereg section 11). The comparison units come in draw order with
// their oracle blocks and their base apps' recipes; each unit's exported repository and plan.md sit under --exports,
// and stage 2's rows give each review arm's Opus block (pass 1, or pass 2 when pass 1 has none). selectUnits runs the
// authoring, the audit and the two oracle builds per unit; when 8 or more qualify, runStage3 runs the six build arms
// 2 at a time, checks every tree in its own offline VM and runs DES-4. Everything runs on stage 3's pieces, the VM
// provider and the money and hosts seams, under the frozen stop scopes. Stage 3's pieces are built first, so on the
// controller host the row refuses there (PD-31) before the VM provider reads a key.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../errors.ts";
import { SAFE_ENV, safeArgs } from "../frame/git.ts";
import type { Recipe } from "../recipes/recipe.ts";
import { renderList } from "../score/parse.ts";
import type { ReviewRow } from "../score/types.ts";
import type { BuildDeps } from "../stage3/build.ts";
import { runStage3 } from "../stage3/run.ts";
import { selectUnits, type Stage3Candidate } from "../stage3/units.ts";
import type { Arm, Unit } from "../types.ts";
import { build, hostsSeam, moneySeam } from "../wire.ts";
import { readJson, writeJson } from "./json.ts";
import { closeAll, need, start, termsFrom, underStops, type Row } from "./start.ts";

/** One comparison unit as the stage3 row reads it; its plan.md and repo/ sit under --exports in a folder named for it. */
export interface Stage3Input {
  unit: Unit;
  /** The oracle list, rendered by the score area. */
  oracleBlock: string;
  /** The base app's kept recipe. */
  recipe: Recipe;
  /** The recipe's routes and the changed screen's route. */
  routes: string[];
}

const STAGE3_ITEMS = ["dc-stage3-authoring", "dc-stage3-builds", "dc-stage3-reads"] as const;

/** The review arm's Opus block for a unit: stage 2 pass 1, or pass 2 when pass 1 has none (section 11), rendered. */
export function opusBlockOf(rows: readonly ReviewRow[]): (unit: string, arm: Arm) => string | null {
  return (unit, arm) => {
    const of = (pass: number) => rows.find((r) => r.stage === 2 && r.model === "opus" && r.unit === unit && r.kind === arm && r.pass === pass && r.list !== null);
    const row = of(1) ?? of(2);
    return row ? renderList(row.list!) : null;
  };
}

function treeOf(repo: string): () => Promise<Uint8Array> {
  return async () => {
    const r = spawnSync("git", safeArgs(["archive", "--format=tar", "HEAD"], []), { cwd: repo, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", ...SAFE_ENV }, maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error("git archive failed in " + repo);
    return new Uint8Array(r.stdout);
  };
}

export const stage3Row: Row = async (a, io, env) => {
  const usage = "stage3 --candidates <stage3.json> --exports <folder of exported units> --rows <stage 2 rows.json> --terms <terms.json> --out <new sink folder>";
  const inputs = readJson<Stage3Input[]>(resolve(need(a, "--candidates", usage)), "--candidates");
  const exports = resolve(need(a, "--exports", usage));
  const rows = readJson<ReviewRow[]>(resolve(need(a, "--rows", usage)), "--rows");
  const sink = need(a, "--out", usage);
  const terms = termsFrom(a);
  if (!inputs.length) fail("E_USAGE", "--candidates names no unit");
  for (const c of inputs) for (const f of ["plan.md", "repo"]) if (!existsSync(join(exports, c.unit.id, f))) fail("E_USAGE", "--exports has no " + f + " for " + c.unit.id);
  const noPass1 = inputs.filter((c) => !rows.some((r) => r.stage === 2 && r.model === "opus" && r.pass === 1 && r.unit === c.unit.id)).map((c) => c.unit.id);
  const launch = await start(
    {
      row: "stage3",
      sink,
      items: [...STAGE3_ITEMS, "dc-hosts"],
      models: ["opus", "sol", "astra", "argon"],
      terms,
      scope: { stage: "stage3" },
      rules: [() => (noPass1.length ? ["7", "stage 3 runs after stage 2's Opus pass 1, and --rows has no Opus pass 1 row for " + noPass1.join(", ")] : null)],
      record: { candidates: inputs.length },
    },
    env,
  );
  for (const l of launch.lines) io.out(l);
  const pieces = await build(env.providers, "stage3", "stage3");
  const vm = await build(env.providers, "vm", "stage3");
  try {
    const builds: BuildDeps = { sandbox: { backend: vm.backend, hosts: hostsSeam(launch.ledger, vm.priceMicrosPerHour, "stage3"), now: vm.now }, agent: pieces.buildAgent, buildSpec: (l) => vm.spec("build", l), checkSpec: (l) => vm.spec("check", l), reader: pieces.buildReader };
    const money = moneySeam(launch.ledger);
    const candidates: Stage3Candidate[] = inputs.map((c) => ({ unit: c.unit, plan: readFileSync(join(exports, c.unit.id, "plan.md"), "utf8"), oracleBlock: c.oracleBlock, recipe: c.recipe, routes: c.routes, tree: treeOf(join(exports, c.unit.id, "repo")) }));
    const sel = await underStops(launch.ledger, { stage: 3 }, () => selectUnits(candidates, { builds, money, authoring: pieces.stage3Authoring }));
    writeJson(join(launch.sink, "selection.json"), { tried: sel.tried, units: sel.units.map((u) => ({ unit: u.candidate.unit.id, validation: u.validation, authored: u.authored })), skippedBaseApp: sel.skippedBaseApp, runs: sel.runs, capStop: sel.capStop });
    io.out("stage 3 selection: " + sel.tried.length + " tried, " + sel.units.length + " qualify, " + sel.skippedBaseApp.length + " skipped for a base app already used" + (sel.capStop ? "; cap stop on " + sel.capStop.item + ": " + sel.capStop.why : ""));
    if (!sel.runs) {
      io.out("stage 3: " + sel.units.length + " units qualify, under the minimum; stage 3 doesn't run");
      return sel.capStop ? 2 : 0;
    }
    const r = await underStops(launch.ledger, { stage: 3 }, () => runStage3(sel, { builds, money, opusBlock: opusBlockOf(rows), judge: pieces.pairwise, baseAppOf: Object.fromEntries(sel.units.map((u) => [u.candidate.unit.id, u.candidate.unit.baseApp])) }));
    writeJson(join(launch.sink, "builds.json"), r.builds);
    writeJson(join(launch.sink, "pairs.json"), r.pairs);
    writeJson(join(launch.sink, "readout.json"), { paired: r.paired, keep: r.keep, instrument: r.instrument, capStop: r.capStop });
    for (const l of r.lines) io.out(l);
    for (const item of STAGE3_ITEMS) await launch.ledger.controller.settleItem(item);
    return r.capStop ? 2 : 0;
  } finally {
    await closeAll(vm, pieces, launch.ledger);
  }
};
