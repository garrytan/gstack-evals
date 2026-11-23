// Copyright (c) 2026 Garry Tan. MIT License.
// The rebuild of parts S and P's units (post section 5, "Rebuilt images"): the head-to-head's runner and its registry are
// gone, so each unit in su-units.json is built again from its frozen recipe (the state machines conversion of its
// MultiLang row for O, the breadth recipe of its advisory for B2, at the same commits) and passes the base plan's oracle
// again (3 base runs fail and 3 fixed runs pass on the same tests, the oracle's own stability rule) and containment before
// any session uses it. A rebuilt payload file (fix.patch, test.patch, issue.md, parser.py) whose digest differs from the
// original's, where a surviving record holds it, is not the same unit. A unit that fails any of these drops for every arm
// of both parts and is listed with its code (E_H2HX_UNITS_RECIPE, E_H2HX_UNITS_ORACLE, E_H2HX_UNITS_CONTAIN). An
// infrastructure fault is never a drop: the unit stays pending and the next call retries it, keeping every settled unit.
// The record holds the old digest the head-to-head recorded and the new one beside it. rebuildUnits takes its steps as
// functions, so it is tested with stubs; realRebuildDeps wires the harness's own conversion, oracle and containment.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { containImage } from "../../statemachines/contain.ts";
import { buildSessionImage } from "../../statemachines/image.ts";
import { oracleUnit, treeVolume, type Pacer } from "../../statemachines/oracle.ts";
import { readRows, toCandidate, type MlRow } from "../../statemachines/source.ts";
import { readUnit, writeUnit } from "../../statemachines/unit.ts";
import type { BuilderHost } from "../breadth/build.ts";
import { buildB, findCandidate, oracleB, prepareB } from "../breadth/oracle-b.ts";
import type { ImageStore } from "../breadth/store.ts";
import { h2hFail } from "../prereg.ts";
import { PAYLOAD_FILES, type RecipeB2, type RecipeO, type SuUnit, type SuUnits } from "./units.ts";

export interface Converted { dir: string; files: Record<string, string>; image?: string | null }
export interface OracleReading { verdict: string; detail: string; base_runs: number; fixed_runs: number; image: string | null }
export interface ContainReading { ok: boolean; findings: string[] }
export interface RebuildDeps {
  /** Writes the unit dir from its recipe; a recipe that does not build or convert answers drop with its reason. */
  convert(u: SuUnit): Promise<Converted | { drop: string }>;
  oracle(dir: string, u: SuUnit): Promise<OracleReading>;
  contain(dir: string, u: SuUnit): Promise<ContainReading>;
}
export type RebuildVerdict = "usable" | "dropped" | "pending";
export interface RebuiltUnit {
  id: string; kind: SuUnit["kind"]; stage: SuUnit["stage"]; verdict: RebuildVerdict; code?: string; reason?: string;
  old_digest: string | null; new_digest: string | null; files_checked: string[];
  oracle?: { verdict: string; base_runs: number; fixed_runs: number; detail: string }; contain_ok?: boolean;
}
export interface RebuildRecord { schema: "h2hx-rebuild.v1"; su_units_sha256: string; units: RebuiltUnit[]; usable: string[]; dropped: { id: string; code: string; reason: string }[]; pending: string[] }

export const ORACLE_RUNS = 3;
/** Oracle and harness codes that name an infrastructure fault, which leaves a unit pending rather than dropped. */
export const INFRA = /^E_(SM_INFRA_GAP|SM_PULL|H2H_B_STORE|INFRA_FAILURE)\b/;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Rebuilds every unit in su (or only the ids given), keeping each unit a previous record already settled. */
export async function rebuildUnits(su: SuUnits, deps: RebuildDeps, o: { only?: readonly string[]; previous?: RebuildRecord } = {}): Promise<RebuildRecord> {
  const suSha = sha(JSON.stringify(su));
  if (o.previous && o.previous.su_units_sha256 !== suSha) h2hFail("E_H2HX_UNITS_INPUT", "the previous rebuild record was made from another su-units.json");
  const only = o.only ? new Set(o.only) : null;
  if (only) for (const id of only) if (!su.units.some((u) => u.id === id)) h2hFail("E_H2HX_UNITS_INPUT", id + " is not a unit of su-units.json");
  const prev = new Map((o.previous?.units ?? []).map((u) => [u.id, u]));
  const out: RebuiltUnit[] = [];
  for (const u of su.units) {
    const settled = prev.get(u.id);
    if (settled && settled.verdict !== "pending") {
      out.push(settled);
      continue;
    }
    if (only && !only.has(u.id)) {
      out.push(settled ?? { id: u.id, kind: u.kind, stage: u.stage, verdict: "pending", reason: "not rebuilt yet", old_digest: u.old.image_digest, new_digest: null, files_checked: [] });
      continue;
    }
    out.push(await rebuildOne(u, deps));
  }
  return {
    schema: "h2hx-rebuild.v1", su_units_sha256: suSha, units: out,
    usable: out.filter((u) => u.verdict === "usable").map((u) => u.id),
    dropped: out.filter((u) => u.verdict === "dropped").map((u) => ({ id: u.id, code: u.code!, reason: u.reason! })),
    pending: out.filter((u) => u.verdict === "pending").map((u) => u.id),
  };
}

async function rebuildOne(u: SuUnit, deps: RebuildDeps): Promise<RebuiltUnit> {
  const r: RebuiltUnit = { id: u.id, kind: u.kind, stage: u.stage, verdict: "pending", old_digest: u.old.image_digest, new_digest: null, files_checked: [] };
  const drop = (code: string, reason: string) => Object.assign(r, { verdict: "dropped" as const, code, reason });
  try {
    const c = await deps.convert(u);
    if ("drop" in c) return drop("E_H2HX_UNITS_RECIPE", "the recipe did not rebuild: " + c.drop);
    r.new_digest = c.image ?? null;
    for (const f of PAYLOAD_FILES) {
      const want = u.old.files[f];
      if (!want) continue;
      r.files_checked.push(f);
      if (c.files[f] !== want) return drop("E_H2HX_UNITS_RECIPE", f + " rebuilt as " + (c.files[f] ?? "missing") + ", not the original " + want);
    }
    const o = await deps.oracle(c.dir, u);
    r.oracle = { verdict: o.verdict, base_runs: o.base_runs, fixed_runs: o.fixed_runs, detail: o.detail.slice(0, 600) };
    r.new_digest = c.image ?? o.image ?? null;
    if (INFRA.test(o.verdict)) return Object.assign(r, { reason: "oracle infrastructure fault " + o.verdict });
    if (o.verdict !== "kept") return drop("E_H2HX_UNITS_ORACLE", "the oracle's verdict is " + o.verdict);
    if (o.base_runs !== ORACLE_RUNS || o.fixed_runs !== ORACLE_RUNS) return drop("E_H2HX_UNITS_ORACLE", "the oracle ran " + o.base_runs + " base and " + o.fixed_runs + " fixed runs, not " + ORACLE_RUNS + " and " + ORACLE_RUNS);
    const k = await deps.contain(c.dir, u);
    r.contain_ok = k.ok;
    if (!k.ok) return drop("E_H2HX_UNITS_CONTAIN", "containment failed: " + k.findings.slice(0, 5).join(", "));
    return Object.assign(r, { verdict: "usable" as const });
  } catch (e) {
    return Object.assign(r, { reason: "infrastructure fault, retried on the next call: " + (e as Error).message.slice(0, 400) });
  }
}

/** The units of su a stage may use after the rebuild, in su's order: usable ones only. A dropped unit is gone for every
 *  arm of both parts; a unit with no settled verdict refuses (E_H2HX_UNITS_PENDING). */
export function usableSuUnits(su: SuUnits, rec: RebuildRecord, stage?: SuUnit["stage"]): SuUnit[] {
  if (rec.su_units_sha256 !== sha(JSON.stringify(su))) h2hFail("E_H2HX_UNITS_INPUT", "the rebuild record was made from another su-units.json");
  const want = su.units.filter((u) => !stage || u.stage === stage);
  const by = new Map(rec.units.map((u) => [u.id, u]));
  const open = want.filter((u) => (by.get(u.id)?.verdict ?? "pending") === "pending");
  if (open.length) h2hFail("E_H2HX_UNITS_PENDING", open.length + " units have no rebuild verdict yet: " + open.slice(0, 5).map((u) => u.id).join(", "));
  return want.filter((u) => by.get(u.id)!.verdict === "usable");
}

const runsOf = (dir: string) => {
  const runs = readUnit(dir).oracle?.runs ?? [];
  return { base_runs: runs.filter((x) => x.tree === "base").length, fixed_runs: runs.filter((x) => x.tree === "fixed").length, image: readUnit(dir).image.runtime_id };
};

/** The harness's own steps: O by the state machines conversion (writeUnit of the pinned MultiLang row) and its oracle at 3
 *  and 3 runs; B2 by the breadth recipe (buildB, the image store, prepareB) and oracleB, which runs 3 and 3 for B2; both
 *  then build the session image and run the object-level containment check (containImage). cache is the MultiLang cache
 *  (sm source fetch), b2Frame the base bundle's b2-frame.json, work the dir unit dirs and build records go under. */
export function realRebuildDeps(o: { work: string; cache: string; b2Frame: string; store: ImageStore; pacer: Pacer; host?: BuilderHost }): RebuildDeps {
  let rows: Map<string, { lang: Parameters<typeof toCandidate>[0]; row: MlRow }> | null = null;
  const rowOf = (id: string) => (rows ??= new Map(readRows(o.cache).map((r) => [r.row.instance_id, r]))).get(id);
  return {
    async convert(u) {
      if (u.kind === "O") {
        const rc = u.recipe as RecipeO;
        const r = rowOf(rc.instance_id);
        if (!r) return { drop: "no MultiLang row " + rc.instance_id + " at revision " + rc.revision };
        if (r.row.base_commit !== rc.base_commit || r.row.docker_image !== rc.docker_image) return { drop: "the MultiLang row's base commit or image is not the recipe's" };
        const dir = join(o.work, "units", u.id);
        const w = writeUnit(dir, { ...toCandidate(r.lang, r.row), image_digest: rc.image_digest }, r.row);
        return { dir, files: w.files, image: null };
      }
      const rc = u.recipe as RecipeB2;
      const c = findCandidate(o.b2Frame, u.id);
      if (c.fix.commit !== rc.fix.commit || c.fix.parent !== rc.fix.parent) return { drop: "b2-frame.json's fix commits are not the recipe's" };
      const build = buildB({ c, work: o.work, host: o.host });
      if (build.verdict !== "built") return { drop: build.verdict + " " + (build.rule ?? "") };
      const stored = o.store.push(build.tag!);
      const prep = await prepareB({ c, work: o.work, ref: stored.ref, store: o.store, build, host: o.host });
      if (prep.verdict !== "ready" || !prep.unit_dir) return { drop: prep.verdict + " " + (prep.rule ?? "") };
      return { dir: prep.unit_dir, files: readUnit(prep.unit_dir).files, image: stored.digest };
    },
    async oracle(dir, u) {
      const v = u.kind === "O" ? await oracleUnit(dir, o.pacer, { runs: ORACLE_RUNS }) : await oracleB(dir, o.store, o.pacer);
      return { verdict: v.verdict, detail: v.detail, ...runsOf(dir) };
    },
    async contain(dir) {
      const unit = readUnit(dir);
      const r = containImage(buildSessionImage(unit, { volume: treeVolume(unit.id), stage: "first" }), unit, dir);
      return { ok: r.ok, findings: Object.entries(r.checks).filter(([, c]) => !c.ok).map(([k, c]) => k + ": " + c.findings.length) };
    },
  };
}
