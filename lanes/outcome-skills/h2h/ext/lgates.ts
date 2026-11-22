// Copyright (c) 2026 Garry Tan. MIT License.
// Part L's gates (post section 5), in the base walk's order: the exclusion list (on the repository and on the name GitHub
// gives it today), the permissive licence list with its second read, the harness screen (state machines screenOne
// without its feature drop), the told-mode screen, the oracle (3 base runs fail and 3 fixed runs pass), the object-level
// containment check, and containment over every part L arm's home. Pools 1 and 2 are o-frame.json rows, which passed the
// exclusion, licence, harness and told gates when that frame was frozen, so those four answer ok from the frame for them.
// Pool 3 is converted from its Harbor packages by the state machines SWE-rebench part, and its candidates, row texts and
// licence reads come in as inputs. The object-level check is statemachines/contain.ts's (post section 3): every ref at
// the base or an ancestor, no commit object past the base, no alternates or other object store, no nested .git, and no
// hidden test name or marker outside the repository. A gate with no input for a unit answers pending, which stops the
// walk there (E_H2HX_UNITS_PENDING); a drop carries the base walk's code where the base gate had one.
import type { ContainResult } from "../../statemachines/contain.ts";
import { screenOne } from "../../statemachines/screen.ts";
import type { Candidate } from "../../statemachines/source.ts";
import { toldScreen } from "../../pfchecks/told.ts";
import type { Gate, GateResult } from "../ordinary/draw.ts";
import { excludedBy, licenceVerdict, type LicenceRead, type RowText } from "../ordinary/frame.ts";
import type { H2hPrereg } from "../prereg.ts";
import { ORACLE_RUNS } from "./rebuild.ts";
import type { LUnit } from "./lframe.ts";

export const L_GATES = ["exclusion", "licence", "harness_screen", "told", "oracle", "contain", "homes"] as const;
export interface Reading { ok: boolean; findings: string[] }
export interface OracleResult { verdict: string; base_runs: number; fixed_runs: number; from: string }
export interface LGateInputs {
  /** Pool 3's licence reads (l-licences.json, the o-licences.json shape). */
  licences?: LicenceRead;
  /** Pool 3's candidates and row texts from the SWE-rebench conversion. */
  candidates?: ReadonlyMap<string, Candidate>;
  rows?: ReadonlyMap<string, RowText>;
  oracle?: Readonly<Record<string, OracleResult>>;
  contain?: Readonly<Record<string, Reading>>;
  homes?: Readonly<Record<string, Reading>>;
}

const ok: GateResult = { ok: true };
const pending = (why: string): GateResult => ({ pending: true, why });
const drop = (code: string, reason: string): GateResult => ({ ok: false, code, reason });

/** A statemachines ContainResult as a reading: the failed checks with their finding counts. */
export const containReading = (r: ContainResult): Reading => ({ ok: r.ok, findings: Object.entries(r.checks).filter(([, c]) => !c.ok).map(([k, c]) => k + " (" + c.findings.length + ")") });

/** The gates over the frame's units, in L_GATES order. */
export function lGates(units: ReadonlyMap<string, LUnit>, p: Pick<H2hPrereg, "exclusion" | "licences">, i: LGateInputs): Gate[] {
  const unit = (id: string) => units.get(id) ?? { id, pool: 3 as const, repo: "", month: "", language: "", entry: null, licence: null, source: "" };
  const fromFrame = (id: string) => unit(id).pool !== 3;
  const reading = (name: string, code: string, m: Readonly<Record<string, Reading>> | undefined) => (id: string): GateResult => {
    const r = m?.[id];
    if (!r) return pending("no " + name + " reading");
    return r.ok ? ok : drop(code, name + " failed: " + r.findings.slice(0, 5).join(", "));
  };
  return [
    { name: "exclusion", check: (id) => {
      const u = unit(id);
      const ex = excludedBy(u.repo, p.exclusion) ?? excludedBy(i.licences?.repos[u.repo]?.name_with_owner ?? "", p.exclusion);
      return ex ? drop("E_H2H_O_EXCLUDED", ex) : ok;
    } },
    { name: "licence", check: (id) => {
      const u = unit(id);
      if (fromFrame(id)) return u.licence ? ok : drop("E_H2H_O_NOT_PERMISSIVE", "no licence in o-frame.json");
      if (!i.licences?.repos[u.repo]) return pending("no licence read for " + u.repo);
      try {
        const v = licenceVerdict(u.repo, i.licences, p.licences);
        return v.ok ? ok : drop("E_H2H_O_NOT_PERMISSIVE", v.rule);
      } catch (e) {
        return pending((e as Error).message);
      }
    } },
    { name: "harness_screen", check: (id) => {
      if (fromFrame(id)) return ok;
      const c = i.candidates?.get(id);
      if (!c) return pending("no SWE-rebench conversion");
      const s = screenOne({ ...c, image_digest: c.image_digest ?? "sha256:" + "0".repeat(64), feature_screen: false });
      if (s) return drop(s.code, s.rule);
      return c.image_digest ? ok : drop("E_SM_INELIGIBLE", "image_digest: " + (c.image_error ?? "no pinned digest"));
    } },
    { name: "told", check: (id) => {
      if (fromFrame(id)) return ok;
      const r = i.rows?.get(id);
      if (!r) return pending("no row text");
      const t = toldScreen(r.problem_statement ?? null, r.patch);
      return t ? drop("E_H2H_O_TOLD", t.rule) : ok;
    } },
    { name: "oracle", check: (id) => {
      const r = i.oracle?.[id];
      if (!r) return pending("no oracle verdict");
      if (r.verdict !== "kept") return drop("E_H2HX_UNITS_ORACLE", r.verdict + " (" + r.from + ")");
      return r.base_runs === ORACLE_RUNS && r.fixed_runs === ORACLE_RUNS ? ok : drop("E_H2HX_UNITS_ORACLE", "ran " + r.base_runs + " base and " + r.fixed_runs + " fixed runs (" + r.from + ")");
    } },
    { name: "contain", check: reading("object-level containment", "E_H2HX_UNITS_CONTAIN", i.contain) },
    { name: "homes", check: reading("containment over part L's homes", "E_H2HX_UNITS_CONTAIN", i.homes) },
  ];
}
