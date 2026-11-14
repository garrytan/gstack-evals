// Copyright (c) 2026 Garry Tan. MIT License.
// dc gatecheck and dc author: the planted units through every model-judged gate (start rule 6, dc-gate-check), then
// the authoring steps (dc-authoring-1 to -3): the pilot and its cost stop, units by draw position, 2x versions and
// second skins. Base apps come from apps.json: each kept base app's checkout and the design and screen files the
// author bundle shows. Every model call goes through the metered model caller on the step's item.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { authorBundle } from "../author/bundle.ts";
import { draw, drawsUpTo } from "../author/draws.ts";
import { enforceGateCheck, type PlantedName, type PlantedUnit } from "../author/gatecheck.ts";
import { funnelTable, wrongWayLine, type UnitOutcome } from "../author/pipeline.ts";
import { runPilot, runPosition, type PilotReport } from "../author/run.ts";
import type { BaseAppView, Deps } from "../author/seams.ts";
import { fillSets, setRecord, type Member } from "../author/sets.ts";
import { sourceTwins, type CalibrationUnit } from "../author/twins.ts";
import { digestOf, type UnitFiles } from "../author/unit.ts";
import { run2x, type X2Outcome } from "../author/x2.ts";
import { fail } from "../errors.ts";
import { listFiles, readText } from "../frame/tree.ts";
import type { AnyModel, AuthorFamily, ChangeKind, ItemClass, LedgerItemId } from "../types.ts";
import { authorCaller, blockParser, build, spendReader, termsGuard, type ModelProvider } from "../wire.ts";
import { readJson, writeJson } from "./json.ts";
import { nodeDropRule } from "./recipes.ts";
import { closeAll, need, oneOf, start, termsFrom, underStops, type Args, type Io, type RowEnv, type Row } from "./start.ts";

/** One kept base app as apps.json gives it, in frame order: its checkout at the pin and the files the bundle shows. */
export interface AppEntry {
  label: string;
  /** The base app's checkout at its pin (the frame's kept clone). */
  dir: string;
  designFiles: string[];
  routeFiles: string[];
}

/** A base app view over a checkout: every regular file outside .git and node_modules, read as text. */
export function appViewOf(e: AppEntry, root: string): BaseAppView {
  const dir = resolve(root, e.dir);
  if (!existsSync(dir)) fail("E_USAGE", "base app " + e.label + "'s folder " + dir + " does not exist");
  const tree = listFiles(dir);
  const tracked = new Set(tree);
  const readme = ["README.md", "readme.md", "Readme.md", "README"].map((p) => (tracked.has(p) ? readText(dir, p) : null)).find((t) => t !== null) ?? "";
  return { label: e.label, readme, tree, read: (p) => (tracked.has(p) ? readText(dir, p) : null), designFiles: e.designFiles, routeFiles: e.routeFiles };
}

export function appsFrom(a: Args, usage: string): BaseAppView[] {
  const file = resolve(need(a, "--apps", usage));
  const entries = readJson<AppEntry[]>(file, "--apps");
  if (!Array.isArray(entries) || !entries.length) fail("E_USAGE", "--apps holds no base apps");
  return entries.map((e) => appViewOf(e, join(file, "..")));
}

/** A launch's author deps: the metered caller on the item, the frozen parse, the pinned vocabulary, the authoring date. */
function deps(env: RowEnv, a: Args, item: LedgerItemId, models: ModelProvider, controller: Parameters<typeof termsGuard>[0], log: (l: string) => void): Deps {
  return { call: authorCaller(models, item, termsGuard(controller, termsFrom(a), log)), parseBlock: blockParser, vocabulary: env.vocabulary(need(a, "--gstack", "... --gstack <gstack checkout at the pin>")), today: env.now().toISOString().slice(0, 10) };
}

/** Every model the authoring steps call: the two author families, Opus and Astra (audits, validators, labels). */
const AUTHOR_MODELS: readonly AnyModel[] = ["sol", "argon", "opus", "astra"];

/** A record a later row reads: refused under its start rule when missing or failed. */
const recorded = (dir: string | undefined, file: string, ok: (v: any) => boolean, rule: string, what: string) => (): [string, string] | null => {
  if (!dir) return [rule, what + " (none given)"];
  const p = join(resolve(dir), file);
  if (!existsSync(p)) return [rule, what + " (" + p + " is missing)"];
  return ok(readJson<any>(p, file)) ? null : [rule, what + " (" + p + " does not record a pass)"];
};

const outcomeLine = (o: { unitId: string; status: string; step: string | null; reason: string }) => "unit " + o.unitId + ": " + o.status + (o.step ? " at " + o.step : "") + " (" + o.reason + ")";
const funnelLines = (outcomes: readonly UnitOutcome[]) =>
  funnelTable(outcomes).map((r) => "funnel " + r.step + ": " + r.passed + " of " + r.units + " units; " + (Object.entries(r.byClass) as [ItemClass, { reached: number; removed: number; tieDecided: number }][]).map(([c, x]) => c + " " + x.reached + "/-" + x.removed + (x.tieDecided ? "/tie " + x.tieDecided : "")).join(" "));

/** planted.json: the eight planted units, written and sealed by the build thread; app is an index into apps.json. */
export interface PlantedEntry {
  name: PlantedName;
  unitId: string;
  files: UnitFiles;
  app: number;
  author: AuthorFamily;
  kind: ChangeKind;
  plantedClass: ItemClass | null;
}

export const gatecheckRow: Row = async (a, io, env) => {
  const usage = "gatecheck --units <planted.json> --apps <apps.json> --gstack <gstack checkout at the pin> --terms <terms.json> --screen <recipes sink> --out <new sink folder>";
  const apps = appsFrom(a, usage);
  const planted = readJson<PlantedEntry[]>(resolve(need(a, "--units", usage)), "--units");
  const sink = need(a, "--out", usage);
  need(a, "--gstack", usage);
  const units: PlantedUnit[] = planted.map((p) => {
    const app = apps[p.app] ?? fail("E_USAGE", "planted unit " + p.name + " names base app " + p.app + ", outside apps.json");
    return { name: p.name, unitId: p.unitId, files: p.files, app, author: p.author, bundle: authorBundle(app, p.kind).text, plantedClass: p.plantedClass };
  });
  const launch = await start({ row: "gatecheck", sink, items: ["dc-gate-check"], models: AUTHOR_MODELS, terms: termsFrom(a), rules: [nodeDropRule(a.flags.get("--screen"))], record: { planted: units.length } }, env);
  for (const l of launch.lines) io.out(l);
  const models = await build(env.providers, "model", "gatecheck");
  try {
    const d = deps(env, a, "dc-gate-check", models, launch.ledger.controller, io.out);
    const r = await underStops(launch.ledger, {}, () => enforceGateCheck(units, d), () => writeJson(join(launch.sink, "result.json"), { ok: false }));
    for (const x of r.results) io.out("gate " + x.name + " " + x.expectation.gate + " " + x.expectation.is + ": " + (x.ok ? "as expected" : "WRONG") + " (" + x.detail + ")");
    writeJson(join(launch.sink, "readings.json"), r.readings);
    writeJson(join(launch.sink, "result.json"), { ok: true, results: r.results.length });
    await launch.ledger.controller.settleItem("dc-gate-check");
    io.out("gatecheck: every gate gave the expected verdict on " + units.length + " planted units");
    return 0;
  } finally {
    await closeAll(models, launch.ledger);
  }
};

const STEPS = ["pilot", "units", "2x", "twins"] as const;
const STEP_ITEMS: Record<(typeof STEPS)[number], readonly LedgerItemId[]> = { pilot: ["dc-authoring-1"], units: ["dc-authoring-1", "dc-authoring-2"], "2x": ["dc-authoring-1", "dc-authoring-3"], twins: ["dc-authoring-1"] };

/** A passing unit from an earlier author launch, with its draw. */
const passed = (file: string, n: number) =>
  readJson<UnitOutcome[]>(join(resolve(file), "outcomes.json"), "--units outcomes.json")
    .filter((o) => o.status === "pass" && o.files)
    .map((o) => {
      const position = Number(/^u(\d+)$/.exec(o.unitId)?.[1] ?? NaN);
      if (!Number.isInteger(position)) fail("E_USAGE", "unit " + o.unitId + " is not a drawn position");
      return { o, d: draw(position, n) };
    });

export const authorRow: Row = async (a, io: Io, env) => {
  const usage = "author --step pilot|units|2x|twins --item <ledger item> --apps <apps.json> --gstack <gstack checkout> --terms <terms.json> --gate <gatecheck sink> --screen <recipes sink> [--pilot <pilot sink>] [--from N --to M] [--units <author sink>] --out <new sink folder>";
  const step = oneOf(a, "--step", STEPS, usage);
  const item = oneOf(a, "--item", STEP_ITEMS[step], usage);
  const apps = appsFrom(a, usage);
  const sink = need(a, "--out", usage);
  need(a, "--gstack", usage);
  const range = step === "units" ? [Number(need(a, "--from", usage)), Number(need(a, "--to", usage))] : null;
  if (range && !(Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0]! >= 1 && range[1]! >= range[0]!)) fail("E_USAGE", "--from and --to are draw positions from 1, --from at most --to");
  const prior = step === "2x" || step === "twins" ? passed(need(a, "--units", usage), apps.length) : [];
  const rules = [recorded(a.flags.get("--gate"), "result.json", (v) => v?.ok === true, "6", "authoring starts only after the gate check passed on every planted unit")];
  if (step !== "pilot") rules.push(recorded(a.flags.get("--pilot"), "pilot.json", (v) => v?.cost?.stop === false, "7", "authoring past the pilot follows a pilot under $10 a passing unit"));
  rules.push(nodeDropRule(a.flags.get("--screen")));
  const launch = await start({ row: "author " + step, sink, items: [item], models: AUTHOR_MODELS, terms: termsFrom(a), rules, record: { step, item, range } }, env);
  for (const l of launch.lines) io.out(l);
  const models = await build(env.providers, "model", "author");
  try {
    const d = deps(env, a, item, models, launch.ledger.controller, io.out);
    const read = spendReader(launch.ledger.controller);
    return await underStops(launch.ledger, {}, async () => {
      if (step === "pilot") {
        const sinkReport = (r: PilotReport) => {
          writeJson(join(launch.sink, "outcomes.json"), r.outcomes);
          writeJson(join(launch.sink, "pilot.json"), { cost: r.cost, kinds: r.kinds });
          for (const o of r.outcomes) io.out(outcomeLine(o));
          for (const l of funnelLines(r.outcomes)) io.out(l);
          for (const k of r.kinds) io.out("kind " + k.kind + ": " + k.passed + " of " + k.attempts + " pass");
          io.out("pilot cost: $" + r.cost.committedUsd + " committed for " + r.cost.passing + " passing units, $" + r.cost.perPassingUsd + " each");
        };
        await runPilot(apps, d, read, sinkReport);
        return 0;
      }
      if (step === "units") {
        const outcomes: UnitOutcome[] = [];
        for (const dr of drawsUpTo(range![1]!, apps.length).slice(range![0]! - 1)) {
          const o = await runPosition(dr, apps, d);
          outcomes.push(o);
          io.out(outcomeLine(o));
        }
        writeJson(join(launch.sink, "outcomes.json"), outcomes);
        for (const l of funnelLines(outcomes)) io.out(l);
        io.out("units: " + outcomes.filter((o) => o.status === "pass").length + " of " + outcomes.length + " pass");
        io.out(wrongWayLine(outcomes));
        return 0;
      }
      if (step === "2x") {
        const outs: X2Outcome[] = [];
        for (const { o, d: dr } of prior) {
          const app = apps[dr.app]!;
          const x = await run2x({ unitId: o.unitId + "-2x", app, author: dr.author, bundle: authorBundle(app, dr.kind).text, base: o.files!, primary: o.primary }, d);
          outs.push(x);
          io.out(outcomeLine(x));
        }
        writeJson(join(launch.sink, "outcomes-2x.json"), outs);
        io.out("2x: " + outs.filter((x) => x.status === "pass").length + " pass, " + outs.filter((x) => x.status === "left").length + " leave the 2x read, " + outs.filter((x) => x.status === "drop").length + " drop, of " + outs.length);
        return 0;
      }
      const members: Member[] = prior.map(({ o, d: dr }) => ({ id: o.unitId, position: dr.position, app: dr.app, kind: dr.kind, author: dr.author, digest: digestOf(o.files!) }));
      const sets = fillSets(members);
      const byId = new Map(prior.map((p) => [p.o.unitId, p]));
      const calibration: CalibrationUnit[] = sets.calibration.map((m) => ({ unitId: m.id, position: m.position, app: m.app, kind: m.kind, author: m.author, files: byId.get(m.id)!.o.files! }));
      const t = await sourceTwins(calibration, apps, d);
      writeJson(join(launch.sink, "sets.json"), { calibration: setRecord(sets.calibration), comparison: setRecord(sets.comparison), reserve: setRecord(sets.reserve) });
      writeJson(join(launch.sink, "twins.json"), t);
      for (const p of t.pairs) io.out("twin " + p.first + " -> " + p.second + ": " + p.status + (p.step ? " at " + p.step : "") + " (" + p.reason + ")");
      io.out("twins: " + t.passing + " passing pairs of " + t.tried + " tried; " + (t.admission === "runs" ? "the twin check runs" : "fewer than 6, to the Captain"));
      return t.admission === "runs" ? 0 : 2;
    });
  } finally {
    await closeAll(models, launch.ledger);
  }
};
