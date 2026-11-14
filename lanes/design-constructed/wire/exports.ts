// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless rows that write a paid row's inputs in the layout WIRING.md gives (wiring items 7 and 12):
//   exports --in <exports.json> --out <new folder>      each unit's export folder: repo/ (run/export.ts exportUnit, its
//                                                        evidence files included), plan.md, context/ and c2.json, C2's
//                                                        input for every container (the manifest's commit, tree, branch
//                                                        and digest, the expected tree and the sealed files' sha256)
//   stage3inputs --units <units.json> --recipes <recipes.json> --oracles <oracles.json> --routes <routes.json> --out <stage3.json>
//                                                        the stage3 row's --candidates, each oracle list rendered by
//                                                        score/parse.ts renderList
// The --terms file comes from gstack-evals dc pins terms (paid/cli.ts). Nothing here reads a key or calls anything.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../errors.ts";
import type { Recipe } from "../recipes/recipe.ts";
import type { C2Expect } from "../run/contain.ts";
import { exportUnit, manifestDigest, type BaseRecord, type ExportSource } from "../run/export.ts";
import { renderList } from "../score/parse.ts";
import type { ChangeList, Unit } from "../types.ts";
import { readJson, writeJson } from "./json.ts";
import { need, type Row } from "./start.ts";
import type { Stage3Input } from "./stage3.ts";

/** One unit's export as exports.json names it; every path is on this machine. */
export interface ExportInput {
  unit: string;
  source: ExportSource;
  base: BaseRecord;
  /** Each evidence file at its path in the export, read from file. */
  evidence: Array<{ path: string; file: string }>;
  plan: string;
  /** The folder mounted as context/. */
  context: string;
  /** Files no mount may hold the bytes of (the unit's key.json and unit.json among them). */
  sealed: string[];
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const exportsRow: Row = (a, io) => {
  const usage = "exports --in <exports.json> --out <new folder>";
  const inputs = readJson<ExportInput[]>(resolve(need(a, "--in", usage)), "--in");
  const out = resolve(need(a, "--out", usage));
  if (existsSync(out)) fail("E_USAGE", "--out " + out + " exists already; the exports are written into a new folder");
  if (!Array.isArray(inputs) || !inputs.length) fail("E_USAGE", "--in names no unit");
  const ids = new Set<string>();
  for (const u of inputs) {
    if (!UNIT_ID.test(u.unit ?? "") || ids.has(u.unit)) fail("E_USAGE", "--in names unit " + JSON.stringify(u.unit) + " twice or with a name that isn't a plain folder name");
    ids.add(u.unit);
    for (const f of [u.plan, u.context, ...u.sealed, ...u.evidence.map((e) => e.file)]) if (!existsSync(f)) fail("E_USAGE", "unit " + u.unit + ": " + f + " does not exist");
    if (!u.sealed.length) fail("E_USAGE", "unit " + u.unit + " names no sealed file, so C2 couldn't check a mount against the key");
  }
  mkdirSync(out, { recursive: true });
  const index: Array<{ unit: string; manifest: string; tree: string; digest: string }> = [];
  for (const u of inputs) {
    const dir = join(out, u.unit);
    mkdirSync(dir);
    const r = exportUnit({ source: u.source, expect: u.base, evidence: u.evidence.map((e) => ({ path: e.path, text: readFileSync(e.file, "utf8") })), out: join(dir, "repo") });
    cpSync(u.plan, join(dir, "plan.md"));
    cpSync(u.context, join(dir, "context"), { recursive: true, verbatimSymlinks: true });
    const c2: C2Expect = { manifest: { commit: r.manifest.commit, tree: r.manifest.tree, branch: r.manifest.branch, digest: r.manifest.digest }, expectedTree: r.expectedTree, sealedSha256: u.sealed.map((f) => sha256(readFileSync(f))) };
    writeJson(join(dir, "c2.json"), c2);
    index.push({ unit: u.unit, manifest: manifestDigest(r.manifest), tree: r.manifest.tree, digest: r.manifest.digest });
    io.out("exports: " + u.unit + " tree " + r.manifest.tree + ", manifest " + manifestDigest(r.manifest).slice(0, 12) + ", " + r.manifest.removed.length + " path(s) stripped, " + r.manifest.evidence.length + " evidence file(s)");
  }
  writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
  io.out("exports: " + index.length + " unit(s) in " + out);
  return 0;
};

export const stage3InputsRow: Row = (a, io) => {
  const usage = "stage3inputs --units <units.json> --recipes <recipes.json> --oracles <oracles.json> --routes <routes.json> --out <stage3.json>";
  const units = readJson<Unit[]>(resolve(need(a, "--units", usage)), "--units");
  const recipes = readJson<Record<string, Recipe>>(resolve(need(a, "--recipes", usage)), "--recipes");
  const oracles = readJson<Record<string, ChangeList>>(resolve(need(a, "--oracles", usage)), "--oracles");
  const routes = readJson<Record<string, string>>(resolve(need(a, "--routes", usage)), "--routes");
  const out = resolve(need(a, "--out", usage));
  if (existsSync(out)) fail("E_USAGE", "--out " + out + " exists already");
  if (!units.length) fail("E_USAGE", "--units names no unit");
  const rows: Stage3Input[] = units.map((unit) => {
    const recipe = recipes[unit.baseApp] ?? fail("E_USAGE", "unit " + unit.id + "'s base app " + unit.baseApp + " has no kept recipe in --recipes");
    const oracle = oracles[unit.id] ?? fail("E_USAGE", "unit " + unit.id + " has no oracle list in --oracles");
    if (oracle.source !== "oracle") fail("E_USAGE", "unit " + unit.id + "'s list in --oracles is a " + oracle.source + " list, not its oracle list");
    const changed = routes[unit.id] ?? fail("E_USAGE", "unit " + unit.id + " names no changed screen's route in --routes");
    return { unit, oracleBlock: renderList(oracle.changes), recipe, routes: recipe.routes.includes(changed) ? [...recipe.routes] : [...recipe.routes, changed] };
  });
  writeJson(out, rows);
  io.out("stage3inputs: " + rows.length + " candidate(s) in " + out);
  return 0;
};
