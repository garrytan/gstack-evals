// Copyright (c) 2026 Garry Tan. MIT License.
// The post key for the review-models pilot: what the judge, the labellers, the contamination reader and the readout need
// to know about each pilot unit and each validation-batch unit, built keylessly from the supply's draw and gate records (src/trial/review/supply/,
// SUPPLY.md) and the full clones the unit build used. Per unit:
// - P bug units: the suite's evidence for the bug, the fix commit's diff against its parent, markers (the unit's PR, the
//   fix PR, the fix commit), cluster by PR and the suite group as stratum;
// - B units: the advisory's summary and details as evidence, the fix's diff (parent to fix), markers (the fix commit, the
//   advisory and CVE ids, and the fix PR when the frame names one), cluster by repository;
// - the decoy: no bug, markers for its PR only;
// - every unit: its diff's added plus deleted lines against the merge-base, and an opaque label from random bytes.
// The fix diff leaves out lockfiles and built or minified files, as the visibility read does with built files. The key
// names fixes and BICs beside their units, so it is an answer key: write it outside the repository, beside the gate
// records in the Captain drive's handoffs/GEVA-590/supply/.
import { randomBytes } from "node:crypto";
import { bUnitRef, type BRecord } from "../../../src/trial/review/supply/b-units.ts";
import type { Draw, DrawnUnit } from "../../../src/trial/review/supply/draw.ts";
import type { PRecord } from "../../../src/trial/review/supply/p-units.ts";
import { rmFail } from "../score/frozen.ts";
import type { KeyUnit, PostKey } from "./pilot.ts";

export interface KeySources {
  /** The patch from one commit to another in the repository's full clone, lockfiles and built files left out. */
  diff(repo: string, from: string, to: string): string;
  /** Added plus deleted lines of git diff base...head. */
  diffLines(repo: string, base: string, head: string): number;
  /** An advisory's summary and details, or null when it cannot be read. */
  advisory(ghsa: string): { summary: string; details: string } | null;
}

export const mintLabel = (): string => "u_" + randomBytes(4).toString("hex");

const PR_REF = /^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:#|\/pull\/|\/issues\/)(\d+)\/?$/i;

export function buildKey(draw: Draw, p: readonly PRecord[], b: readonly BRecord[], src: KeySources, label: () => string = mintLabel): PostKey {
  const pById = new Map(p.map((r) => [r.id, r]));
  const bById = new Map(b.filter((r) => r.szz?.bic).map((r) => [bUnitRef(r).id, r]));
  const labels = new Set<string>();
  const fresh = () => {
    let l: string;
    do l = label();
    while (labels.has(l));
    labels.add(l);
    return l;
  };
  const unit = (d: DrawnUnit): KeyUnit => {
    if (d.pool === "B") {
      const r = bById.get(d.id) ?? rmFail("E_RM_POST_INPUT", "B unit " + d.id + " has no gate record with a BIC");
      const bic = r.szz!.bic!;
      const adv = src.advisory(r.ghsa) ?? rmFail("E_RM_POST_INPUT", r.ghsa + ": the advisory cannot be read");
      const ref = r.fix.kind === "pull" && /^\d+$/.test(r.fix.ref ?? "") ? [r.fix.ref, r.repo, r.fix.ref] : PR_REF.exec(r.fix.ref ?? "");
      return { unit: d.id, label: fresh(), pool: "B", cluster: r.repo, diff_lines: src.diffLines(r.repo, bic + "^", bic), bug: { evidence: ("Advisory " + r.ghsa + ": " + adv.summary.trim() + "\n\n" + adv.details.trim()).trim(), fix_diff: src.diff(r.repo, r.fix.parent, r.fix.commit) }, markers: { unit: d.id, prs: ref ? [ref[1] + "#" + ref[2]] : [], commits: [r.fix.commit], ids: [r.ghsa, ...r.cves] } };
    }
    const r = pById.get(d.id) ?? rmFail("E_RM_POST_INPUT", "unit " + d.id + " has no gate record");
    const pr = r.repo + "#" + r.pr;
    const base = { unit: d.id, label: fresh(), cluster: pr, diff_lines: src.diffLines(r.repo, r.base, r.head) };
    if (r.decoy) return { ...base, pool: "decoy", bug: null, markers: { unit: d.id, prs: [pr], commits: [], ids: [] } };
    const fix = r.fix ?? rmFail("E_RM_POST_INPUT", "P unit " + d.id + " has no fix commit");
    return { ...base, pool: "P", stratum: r.group, bug: { evidence: r.evidence, fix_diff: src.diff(r.repo, fix.commit + "^", fix.commit) }, markers: { unit: d.id, prs: [...new Set([pr, r.repo + "#" + fix.pr])], commits: [fix.commit], ids: [] } };
  };
  const pilot = [...draw.pilot.p, ...draw.pilot.b, draw.pilot.decoy].map(unit);
  const validation = (draw.validation ?? []).map(unit);
  return { schema: "rm-post-key.v1", pilot, validation, counted: { p: draw.counted.filter((u) => u.pool === "P").length, b: draw.counted.filter((u) => u.pool === "B").length, decoys: draw.decoys.length } };
}
