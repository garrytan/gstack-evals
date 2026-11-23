// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 5's labels to outcomes and section 10's miss anatomy. A hit needs all four rules: location, class, same
// defect and grounding. Code holds the parts it can check: location needs a cited fix file that exists at the parent,
// and either a cited range of at most wide_range_lines lines within line_window lines of a pre-fix hunk in that file,
// or a cited function or a cited path with no range that the judge places in the vulnerable code (a wider range alone
// never counts); grounding needs one cited location that resolves in the tree. can't tell on any rule is not a hit.
// Only the first first_k findings count. A hit, or a full match to a known open advisory, is supported.
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { CsoArm, CsoModel, CsoStage, SessionRecord, UnitRecord } from "../types.ts";
import type { Finding, FindingLabels, Validity } from "../judge/schema.ts";
import { citationState, phantoms, resolvePath, textCitations, type Citation, type Phantoms, type TreeIndex } from "./checks.ts";
import { normalizePath, type ScoredText } from "./text.ts";

/** What the judge pipeline returns for one session. A gap string names a judge gap (section 7). */
export interface Judged { findings: Finding[] | { gap: string }; labels: FindingLabels[] | { gap: string } | null }

/** One counted finding's outcome. */
export interface FindingOutcome { location: boolean; class: boolean; same_defect: boolean; grounding: boolean; hit: boolean; hit_cant_tell: boolean; file_level: boolean; known: string | null; validity: Validity; by_handle: boolean }

/** The score record for one session (an extension the scorer owns; types.ts has no score shape). */
export interface CsoScore {
  schema: "cso-score.v1";
  unit: string; repo: string; arm: CsoArm; model: CsoModel; stage: CsoStage;
  /** null, "session" for a session gap, or "judge" for a judge gap. Gaps score nothing. */
  gap: null | "session" | "judge";
  gap_reason: string | null;
  end: SessionRecord["end"];
  named: boolean | null;
  /** The delivery measure: a hit among counted findings from the final message. */
  named_final: boolean | null;
  file_level: boolean | null;
  findings_total: number | null;
  counted: number | null;
  over_k: boolean | null;
  hits: number | null;
  known_real: number | null;
  supported: number | null;
  unsupported: number | null;
  cant_tell: number | null;
  hit_cant_tell: number | null;
  by_handle: number | null;
  phantoms: Phantoms;
  findings: FindingOutcome[];
  cost_usd: number;
}

interface Rules { first_k: number; line_window: number; wide_range_lines: number }
export function scoringRules(p: CsoPrereg): Rules {
  const s = p.scoring as Partial<Rules>;
  for (const k of ["first_k", "line_window", "wide_range_lines"] as const) if (!Number.isInteger(s[k])) csoFail("E_CSO_SCORE_INPUT", "prereg.json scoring." + k + " is missing");
  return s as Rules;
}

/** The unit's fix files that exist at the parent: the files of its pre-fix hunks found in the audited tree. */
export const fixFiles = (u: Pick<UnitRecord, "hunks">, tree: TreeIndex): string[] => [...new Set(u.hunks.map((h) => h.file))].filter((f) => tree.files.has(f));

/** Whether a citation's range points into a pre-fix hunk of its file by the line rule. */
export function lineRoute(c: Citation, file: string, u: Pick<UnitRecord, "hunks">, r: Rules): boolean {
  if (c.start === null) return false;
  const end = c.end ?? c.start;
  if (end - c.start + 1 > r.wide_range_lines) return false;
  return u.hunks.some((h) => h.file === file && c.start! <= h.end + r.line_window && end >= h.start - r.line_window);
}

/** One counted finding's outcome from its labels and the code checks. */
export function findingOutcome(f: Finding, l: FindingLabels, u: UnitRecord, s: Pick<SessionRecord, "helper">, tree: TreeIndex, r: Rules): FindingOutcome {
  const fixes = new Set(fixFiles(u, tree));
  const cites = f.citations.map((c) => {
    const path = normalizePath(c.path, s.helper);
    const n = path === null ? null : { ...c, path };
    return { raw: c, n, at: n ? citationState(n, tree) : null };
  });
  const resolved = cites.filter((c) => c.at && (c.at.state === "resolved" || c.at.state === "phantom_line") && c.at.path);
  const onFix = resolved.filter((c) => c.at!.state === "resolved" && fixes.has(c.at!.path!));
  const location = onFix.some((c) => lineRoute(c.n!, c.at!.path!, u, r)) || (l.location === "yes" && onFix.some((c) => c.n!.symbol !== null || c.n!.start === null));
  const grounding = l.grounding === "yes" && cites.some((c) => c.at?.state === "resolved");
  const cls = l.class === "yes", same = l.same_defect === "yes";
  const hit = location && cls && same && grounding;
  const hit_cant_tell = !hit && [l.location, l.class, l.same_defect, l.grounding].includes("cant_tell");
  let known: string | null = null;
  const k = l.known;
  const adv = k ? u.known_open.find((a) => a.ghsa.toLowerCase() === k.ghsa.toLowerCase()) : undefined;
  if (k && adv && k.location === "yes" && k.class === "yes" && k.same_defect === "yes" && k.grounding === "yes" && resolved.some((c) => c.at!.state === "resolved" && adv.files.includes(c.at!.path!))) known = adv.ghsa;
  const handled = s.helper.handles;
  return {
    location, class: cls, same_defect: same, grounding, hit, hit_cant_tell, file_level: onFix.length > 0 && cls, known,
    validity: hit || known ? "supported" : l.validity, by_handle: cites.some((c) => /@cso-path\/\//.test(c.raw.path) || Object.values(handled).includes(c.raw.path)),
  };
}

/** One session's score. A session gap or a judge gap scores nothing; a session with no assistant text is not named. */
export function scoreSession(u: UnitRecord, s: SessionRecord, st: ScoredText, j: Judged | null, tree: TreeIndex, p: CsoPrereg): CsoScore {
  if (s.unit !== u.unit) csoFail("E_CSO_SCORE_INPUT", "session for " + s.unit + " scored against unit " + u.unit);
  const r = scoringRules(p);
  const base: CsoScore = {
    schema: "cso-score.v1", unit: u.unit, repo: u.repo, arm: s.arm, model: s.model, stage: s.stage, gap: null, gap_reason: null, end: s.end,
    named: null, named_final: null, file_level: null, findings_total: null, counted: null, over_k: null, hits: null, known_real: null, supported: null, unsupported: null, cant_tell: null, hit_cant_tell: null, by_handle: null,
    phantoms: phantoms(st.plain, tree), findings: [], cost_usd: s.cost_usd,
  };
  if (s.end === "gap") return { ...base, gap: "session", gap_reason: s.reason ?? "session gap" };
  const zero = { named: false, named_final: false, file_level: false, findings_total: 0, counted: 0, over_k: false, hits: 0, known_real: 0, supported: 0, unsupported: 0, cant_tell: 0, hit_cant_tell: 0, by_handle: 0 };
  if (st.empty) return { ...base, ...zero };
  if (!j) return csoFail("E_CSO_SCORE_INPUT", u.unit + " " + s.arm + " has assistant text but no judge result");
  if (!Array.isArray(j.findings)) return { ...base, gap: "judge", gap_reason: j.findings.gap };
  const counted = j.findings.slice(0, r.first_k);
  if (!counted.length) return { ...base, ...zero };
  if (!j.labels || !Array.isArray(j.labels)) return { ...base, gap: "judge", gap_reason: j.labels ? j.labels.gap : "no pass B labels" };
  if (j.labels.length !== counted.length) csoFail("E_CSO_SCORE_INPUT", u.unit + " " + s.arm + ": " + j.labels.length + " labels for " + counted.length + " counted findings");
  const labels = j.labels;
  const fo = counted.map((f, i) => findingOutcome(f, labels[i]!, u, s, tree, r));
  const n = (f: (o: FindingOutcome) => boolean) => fo.filter(f).length;
  return {
    ...base, findings: fo, named: fo.some((o) => o.hit), named_final: fo.some((o, i) => o.hit && counted[i]!.source === "final"), file_level: fo.some((o) => o.file_level),
    findings_total: j.findings.length, counted: counted.length, over_k: j.findings.length > r.first_k, hits: n((o) => o.hit), known_real: n((o) => o.hit || o.known !== null),
    supported: n((o) => o.validity === "supported"), unsupported: n((o) => o.validity === "unsupported"), cant_tell: n((o) => o.validity === "cant_tell"), hit_cant_tell: n((o) => o.hit_cant_tell), by_handle: n((o) => o.by_handle),
  };
}

/** Pooled precision over a cell's scored sessions: hits (or known-real matches) over counted findings. */
export function pooledPrecision(scores: readonly CsoScore[], what: "hits" | "known_real"): { num: number; den: number; rate: number | null } {
  const ok = scores.filter((s) => s.gap === null && s.counted !== null);
  const num = ok.reduce((a, s) => a + (s[what] ?? 0), 0), den = ok.reduce((a, s) => a + s.counted!, 0);
  return { num, den, rate: den ? num / den : null };
}

export type Miss = "safety_stop" | "limit_tooling_or_not_assessed" | "never_opened_fix_file" | "opened_not_named" | "other_flaw_or_class" | "outside_first_k" | "unclassified";

/** Section 10's miss anatomy for a session that did not name its unit's advisory while the other arm did, by code from
 *  SessionRecord.opened and the scored text, first matching cause in the plan's order. */
export function missAnatomy(u: UnitRecord, s: SessionRecord, st: ScoredText, findings: readonly Finding[] | null, tree: TreeIndex, p: CsoPrereg): Miss {
  const r = scoringRules(p);
  const fixes = new Set(fixFiles(u, tree));
  if (s.end === "safety_stop") return "safety_stop";
  if (s.end.startsWith("limit_") || s.exposure.tooling_errors > 0 || s.exposure.completeness === "not_assessed") return "limit_tooling_or_not_assessed";
  const opens = (o: string) => {
    const at = normalizePath(o.replace(/^\.\//, ""), s.helper) ?? "";
    if (fixes.has(at) || !/[*?]/.test(at)) return fixes.has(at);
    const glob = new RegExp("^" + at.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");
    return [...fixes].some((f) => glob.test(f));
  };
  if (!s.opened.some(opens)) return "never_opened_fix_file";
  const onFix = (c: Citation) => {
    const path = normalizePath(c.path, s.helper);
    const at = path === null ? null : resolvePath(path, tree);
    return at !== null && fixes.has(at) ? at : null;
  };
  if (!textCitations(st.plain, tree).citations.some((c) => onFix(c) !== null)) return "opened_not_named";
  const fs = findings ?? [];
  if (fs.slice(0, r.first_k).some((f) => f.citations.some((c) => onFix(c) !== null))) return "other_flaw_or_class";
  if (fs.slice(r.first_k).some((f) => f.citations.some((c) => {
    const at = onFix(c);
    return at !== null && (lineRoute(c, at, u, r) || c.symbol !== null);
  }))) return "outside_first_k";
  return "unclassified";
}
