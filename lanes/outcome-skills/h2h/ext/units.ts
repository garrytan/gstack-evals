// Copyright (c) 2026 Garry Tan. MIT License.
// Parts S and P's units (post section 5): the head-to-head's 100 O and 60 B2 stage 2 units and its 12 O and 12 B2 stage 1
// units, identified from the records that survived its runner. Stage 2 units and their draw positions come from the
// published session data's units.json. Stage 1 units are the units in the opened stage 1 outcomes; each takes the frozen
// stage 1 position its place in the frozen seeded order gives it (O: o-order.json; B2: the seeded order of b2-frame.json's
// primary rows under the base draw_seed, positions 6, 12, ..., 72 since B2 filled every B stage 1 slot). Every position is
// checked against the order: positions rise with the order, so a unit out of place refuses. Each unit carries its recipe
// inputs (the MultiLang row's revision, base commit and image for O; the advisory row and fix commits for B2) and the
// digests the original unit dir's files had, where a surviving record holds them, so a rebuild can show it rebuilt the
// same unit. su-units.json is that list, frozen in the post bundle.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MULTILANG } from "../../statemachines/source.ts";
import { ADVISORY_DB, type B2Row } from "../breadth/b2.ts";
import { ECOSYSTEM_LANG } from "../breadth/frame.ts";
import { candidateOf } from "../breadth/oracle-b.ts";
import { b2AloneStage1, seededOrder } from "../ordinary/draw.ts";
import { h2hFail, type H2hPrereg } from "../prereg.ts";
import type { Entry } from "../types.ts";
import { EXT_PREREG_PATH } from "./prereg.ts";

export const SU_UNITS_SCHEMA = "h2hx-su-units.v1";
export const SU_UNITS_PATH = join(EXT_PREREG_PATH, "..", "su-units.json");
/** The payload files a rebuild writes from its recipe; unit.json and oracle-ids.json carry oracle results and differ. */
export const PAYLOAD_FILES = ["fix.patch", "test.patch", "issue.md", "parser.py"] as const;

export interface RecipeO { kind: "sm-multilang"; dataset: string; revision: string; instance_id: string; language: string; base_commit: string; docker_image: string; image_digest: string; created_at: string }
export interface RecipeB2 { kind: "breadth-b2"; advisory_db: string; ghsa: string; advisory_path: string; repo: string; ecosystem: string; fix: B2Row["fix"] }
export interface SuUnit {
  id: string; kind: "O" | "B2"; stage: "stage1" | "stage2"; position: number; repo: string; month: string; language: string; entry: Entry; licence: string;
  recipe: RecipeO | RecipeB2;
  /** image_digest: the digest the head-to-head recorded (O: the MultiLang image it pulled; B2: the image its store held, now
   *  destroyed; null when no surviving record holds it). files: the original unit dir's file digests, from files_from. */
  old: { image_digest: string | null; files: Record<string, string>; files_from: string | null };
}
export interface SuUnits { schema: typeof SU_UNITS_SCHEMA; base: string; sources: Record<string, string>; counts: Record<string, number>; units: SuUnit[] }

/** A published units.json row (the head-to-head's session data). */
export interface PublishedUnit { id: string; kind: string; repo: string; month: string; language: string; entry: Entry; image_digest: string; licence: string; position: number; stage: string }
export interface MlRecipeRow { instance_id: string; base_commit: string; docker_image: string; created_at: string }
export interface OFrameRow { id: string; repo: string; month: string; language: string; entry: Entry; licence: string; digest: string }

export interface SuInputs {
  prereg: H2hPrereg;
  published: readonly PublishedUnit[];
  oFrame: readonly OFrameRow[];
  oOrder: readonly string[];
  b2Rows: readonly B2Row[];
  /** The opened stage 1 outcomes' unit ids, O and B2 together. */
  stage1: readonly string[];
  /** MultiLang rows at the pinned revision, by instance id. */
  rows: ReadonlyMap<string, MlRecipeRow>;
  /** Original file digests by unit id, with the record they came from. */
  files: ReadonlyMap<string, { files: Record<string, string>; from: string }>;
  sources: Record<string, string>;
}

const fail = (why: string): never => h2hFail("E_H2HX_UNITS_INPUT", why);

/** Positions follow the order: every unit's index in the order rises with its position. */
function checkPositions(kind: string, order: readonly string[], placed: { id: string; position: number }[]): void {
  const at = new Map(order.map((id, i) => [id, i]));
  const sorted = [...placed].sort((a, b) => a.position - b.position);
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]!;
    if (!at.has(u.id)) fail(kind + " unit " + u.id + " is not in the frozen order");
    if (i && (sorted[i - 1]!.position === u.position || at.get(sorted[i - 1]!.id)! >= at.get(u.id)!)) fail(kind + " unit " + u.id + " at position " + u.position + " does not follow " + sorted[i - 1]!.id + " in the frozen order");
  }
}

/** The units of parts S and P from the surviving records, refused unless every count and position checks. */
export function suUnitsFrom(o: SuInputs): SuUnits {
  const p = o.prereg;
  const oFrame = new Map(o.oFrame.map((u) => [u.id, u]));
  const b2 = new Map(o.b2Rows.map((r) => [candidateOf("B2", r).id, r]));
  const b2Order = seededOrder(o.b2Rows.filter((r) => r.window === "primary").map((r) => { const c = candidateOf("B2", r); return { id: c.id, repo: c.repo, month: c.month }; }), p.draw_seed).map((u) => u.id);
  const seen = new Set<string>();
  for (const id of [...o.published.map((u) => u.id), ...o.stage1]) {
    if (seen.has(id)) fail("unit " + id + " is listed twice across stage 1 and stage 2");
    seen.add(id);
  }
  const s2 = { O: o.published.filter((u) => u.kind === "O" && u.stage === "stage2"), B2: o.published.filter((u) => u.kind === "B2" && u.stage === "stage2") };
  if (s2.O.length !== p.classes.O.n || s2.B2.length !== p.classes.B.n || s2.O.length + s2.B2.length !== o.published.length) fail("the published units.json holds " + s2.O.length + " O and " + s2.B2.length + " B2 stage 2 units of " + o.published.length + ", not " + p.classes.O.n + " and " + p.classes.B.n);
  const s1O = o.stage1.filter((id) => oFrame.has(id)), s1B = o.stage1.filter((id) => b2.has(id));
  if (s1O.length + s1B.length !== o.stage1.length) fail("stage 1 unit " + o.stage1.find((id) => !oFrame.has(id) && !b2.has(id)) + " is in neither frozen frame");
  const oPos = (p.classes.O as { stage1_positions?: number[] }).stage1_positions ?? fail("the base prereg.json has no O stage 1 positions");
  const bPos = b2AloneStage1((p.classes.B as { stage1_positions?: { B2?: number[] } }).stage1_positions?.B2 ?? fail("the base prereg.json has no B2 stage 1 positions"), p.classes.B.stage1);
  if (s1O.length !== oPos.length || s1B.length !== bPos.length) fail("the stage 1 outcomes hold " + s1O.length + " O and " + s1B.length + " B2 units, not " + oPos.length + " and " + bPos.length);
  const byOrder = (order: readonly string[]) => (a: string, b: string) => order.indexOf(a) - order.indexOf(b);
  const placedO = [...s2.O.map((u) => ({ id: u.id, position: u.position })), ...[...s1O].sort(byOrder(o.oOrder)).map((id, i) => ({ id, position: oPos[i]! }))];
  const placedB = [...s2.B2.map((u) => ({ id: u.id, position: u.position })), ...[...s1B].sort(byOrder(b2Order)).map((id, i) => ({ id, position: bPos[i]! }))];
  checkPositions("O", o.oOrder, placedO);
  checkPositions("B2", b2Order, placedB);
  const pub = new Map(o.published.map((u) => [u.id, u]));
  const oldFiles = (id: string) => { const f = o.files.get(id); return { files: f?.files ?? {}, files_from: f?.from ?? null }; };
  const units: SuUnit[] = [];
  for (const { id, position } of placedO) {
    const f = oFrame.get(id) ?? fail("O unit " + id + " is not in o-frame.json");
    const row = o.rows.get(id) ?? fail("O unit " + id + " has no MultiLang row at revision " + MULTILANG.revision);
    const u = pub.get(id);
    if (u && (u.repo !== f.repo || u.language !== f.language || u.entry !== f.entry || u.licence !== f.licence || u.image_digest !== f.digest)) fail("O unit " + id + " differs between units.json and o-frame.json");
    units.push({ id, kind: "O", stage: u ? "stage2" : "stage1", position, repo: f.repo, month: f.month, language: f.language, entry: f.entry, licence: f.licence,
      recipe: { kind: "sm-multilang", dataset: MULTILANG.dataset, revision: MULTILANG.revision, instance_id: row.instance_id, language: f.language, base_commit: row.base_commit, docker_image: row.docker_image, image_digest: f.digest, created_at: row.created_at },
      old: { image_digest: f.digest, ...oldFiles(id) } });
  }
  for (const { id, position } of placedB) {
    const r = b2.get(id) ?? fail("B2 unit " + id + " is not in b2-frame.json");
    const c = candidateOf("B2", r);
    const u = pub.get(id);
    if (!r.licence) fail("B2 unit " + id + " has no licence in b2-frame.json");
    units.push({ id, kind: "B2", stage: u ? "stage2" : "stage1", position, repo: c.repo, month: c.month, language: u?.language ?? c.ecosystems.map((e) => ECOSYSTEM_LANG[e] ?? e).join("+"), entry: "bug", licence: r.licence!,
      recipe: { kind: "breadth-b2", advisory_db: ADVISORY_DB.commit, ghsa: r.ghsa, advisory_path: r.advisory_path, repo: r.repo, ecosystem: r.ecosystem, fix: r.fix },
      old: { image_digest: u?.image_digest ?? null, ...oldFiles(id) } });
  }
  units.sort((a, b) => (a.kind === b.kind ? (a.stage === b.stage ? a.position - b.position : a.stage < b.stage ? -1 : 1) : a.kind === "O" ? -1 : 1));
  const count = (k: string, s: string) => units.filter((u) => u.kind === k && u.stage === s).length;
  return { schema: SU_UNITS_SCHEMA, base: p.post, sources: o.sources, counts: { O_stage2: count("O", "stage2"), B2_stage2: count("B2", "stage2"), O_stage1: count("O", "stage1"), B2_stage1: count("B2", "stage1"), with_file_digests: units.filter((u) => Object.keys(u.old.files).length).length }, units };
}

/** Reads su-units.json, refusing another schema, a repeated unit or a unit without its recipe. */
export function readSuUnits(path: string = SU_UNITS_PATH): SuUnits {
  if (!existsSync(path)) fail(path + " does not exist; parts S and P's units are frozen in the post bundle's su-units.json");
  let j: SuUnits;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(path + " is not JSON: " + (e as Error).message);
  }
  if (j.schema !== SU_UNITS_SCHEMA || !Array.isArray(j.units)) fail(path + " is not an " + SU_UNITS_SCHEMA + " file");
  const ids = new Set<string>();
  for (const u of j.units) {
    if (ids.has(u.id)) fail(path + " lists " + u.id + " twice");
    ids.add(u.id);
    if (!u.recipe || (u.kind === "O" ? u.recipe.kind !== "sm-multilang" : u.recipe.kind !== "breadth-b2")) fail(path + ": " + u.id + " has no " + u.kind + " recipe");
  }
  return j;
}
