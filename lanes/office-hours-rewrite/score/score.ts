// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's scorer (prereg section 5, section 7's builder right call, section 8's failure table,
// section 10's guardrail counts and section 11's compliance checks; pre-run change 1's delivered-replies rule). It joins
// session rows, the production judge's labels and the label maps into ScoredSession rows. The rules:
// - R1 (mechanical): at least one of the key's decisive fact ids appears in the revealed list of a founder reply the
//   adviser received before the first closing message (a turn marked delivered). A reply the closing message replaced and
//   a draw the checks rejected never count.
// - R2 and R3 (judged): the decision and action cells of the session's block from frozen.JUDGE_FOR[model] at medium
//   effort, through the label map. An unlabelled cell is null.
// - R = R1 and R2 and R3: 0 when any part is 0, else null when any part is null, else 1. Builder briefs score the builder
//   right call the same way against the builder key.
// - Section 8: missing and contaminated sessions score null everywhere; a safety stop, a refusal and no block after two
//   closing messages score R2 = R3 = R = 0, with R1 read from the log; the reply cap changes nothing here.
// - Detectors: exposure on skill arms, kept-whole on builder briefs in skill arms, compliance on every session with a
//   transcript; G2 questions and G3 delivered founder replies on every session.
import { readFileSync } from "node:fs";
import { JUDGE_EFFORT, JUDGE_FOR } from "../frozen.ts";
import type { Key, ScoredSession, SessionRow, Turn } from "../types.ts";
import { compliance, delivered, exposure, founderReplies, keptWhole, loadCompliance, loadMarkers, questionsAsked, type ComplianceMarkers, type ComplianceReport, type Markers } from "./detect.ts";
import type { JudgedLabel } from "./judge.ts";
import { sessionKey, type Brief, type PacketMap } from "./packets.ts";

type Bit = 0 | 1 | null;

/** ScoredSession with compliance's two descriptive checks from pre-run change 1 item 4f. */
export interface Scored extends ScoredSession {
  compliance: ComplianceReport | null;
}

export const r1 = (turns: readonly Turn[], key: Pick<Key, "decisive">): 0 | 1 => (delivered(turns).some((t) => t.revealed.some((f) => key.decisive.includes(f))) ? 1 : 0);

export const combine = (bits: readonly Bit[]): Bit => (bits.includes(0) ? 0 : bits.includes(null) ? null : 1);

const bit = (v: boolean | null | undefined): Bit => (v == null ? null : v ? 1 : 0);
const fail = (msg: string): never => {
  throw new Error("E_OHR_SCORE_INPUT " + msg);
};

/** The production label of each session block, by session key, from the label maps. */
function sessionLabels(maps: readonly PacketMap[], labels: readonly JudgedLabel[]): Map<string, JudgedLabel | null> {
  const where = new Map<string, { key: string; judge: string }>();
  const out = new Map<string, JudgedLabel | null>();
  for (const m of maps) {
    if (m.kind !== "label") fail("a " + m.kind + " map holds no production labels");
    for (const p of Object.values(m.packets))
      for (const [block, ref] of Object.entries(p.blocks)) {
        if (ref.kind !== "session") continue;
        const key = sessionKey(ref.session);
        if (out.has(key)) fail("session " + key + " sits in two label packets");
        where.set(p.id + "|" + block, { key, judge: JUDGE_FOR[ref.session.model] });
        out.set(key, null);
      }
  }
  for (const l of labels) {
    const w = where.get(l.packet + "|" + l.block);
    if (!w) continue;
    if (l.judge !== w.judge || l.effort !== JUDGE_EFFORT) fail("session " + w.key + " needs its label from " + w.judge + " at " + JUDGE_EFFORT + " effort; got " + l.judge + " at " + l.effort);
    if (out.get(w.key)) fail("two labels for session " + w.key);
    out.set(w.key, l);
  }
  return out;
}

export function scoreSessions(o: { rows: readonly SessionRow[]; briefs: ReadonlyMap<string, Brief>; maps: readonly PacketMap[]; labels: readonly JudgedLabel[]; markers?: Partial<Record<"current" | "new", Markers>>; compliance?: ComplianceMarkers; read?: (path: string) => string }): Scored[] {
  const labelOf = sessionLabels(o.maps, o.labels);
  const read = o.read ?? ((p: string) => readFileSync(p, "utf8"));
  const c = o.compliance ?? loadCompliance();
  const markersFor = (arm: "current" | "new") => o.markers?.[arm] ?? loadMarkers(arm);
  return o.rows.map((r) => {
    const brief = o.briefs.get(r.brief) ?? fail("row names brief " + r.brief + ", which is not in the briefs");
    const key = sessionKey(r);
    let R1: Bit = null, R2: Bit = null, R3: Bit = null;
    if (r.end === "block") {
      if (r.block?.kind !== "block") fail("session " + key + " ended with a block but carries none");
      if (!labelOf.has(key)) fail("session " + key + " has a block but no label packet");
      const l = labelOf.get(key);
      R1 = r1(r.founder_turns, brief.key);
      R2 = bit(l?.decision);
      R3 = bit(l?.action);
    } else if (r.end === "safety-stop" || r.end === "refusal" || r.end === "no-block") {
      R1 = r1(r.founder_turns, brief.key);
      R2 = 0;
      R3 = 0;
    }
    const scoredBits = r.end === "missing" || r.end === "contaminated";
    const text = r.transcript === null ? null : read(r.transcript);
    const skill = r.arm === "none" ? null : r.arm;
    const block = r.block?.kind === "block" ? r.block.block : null;
    return {
      stage: r.stage,
      brief: r.brief,
      model: r.model,
      arm: r.arm,
      kind: brief.meta.kind,
      cluster: brief.meta.cluster,
      set: brief.meta.set,
      traction: brief.key.traction,
      end: r.end,
      R1,
      R2,
      R3,
      R: scoredBits ? null : combine([R1, R2, R3]),
      exposure: skill && text !== null ? exposure({ transcript: text, stateRoot: r.state_root, sessionKind: r.session_kind, turns: r.founder_turns, markers: markersFor(skill) }) : null,
      kept_whole: skill && text !== null && brief.meta.kind === "builder" ? keptWhole({ transcript: text, stateRoot: r.state_root, founderDone: r.founder_done, markers: markersFor(skill) }) : null,
      compliance: text === null ? null : compliance({ transcript: text, stateRoot: r.state_root, block, arm: r.arm, kind: brief.meta.kind, markers: skill ? markersFor(skill) : null, c }),
      founder_replies: founderReplies(r.founder_turns),
      questions: text === null ? 0 : questionsAsked(text, r.closings),
      usd: r.usd,
      sim_usd: r.sim_usd,
    };
  });
}

/** Stock rows in production label packets that their judge credited on either cell, and those left unlabelled. */
export function stockCredits(maps: readonly PacketMap[], labels: readonly JudgedLabel[]): { rows: number; credited: number; unlabelled: number } {
  const stock = new Set(maps.flatMap((m) => Object.values(m.packets).flatMap((p) => Object.entries(p.blocks).filter(([, r]) => r.kind === "stock").map(([b]) => p.id + "|" + b))));
  const seen = labels.filter((l) => stock.has(l.packet + "|" + l.block));
  return { rows: stock.size, credited: seen.filter((l) => l.decision === true || l.action === true).length, unlabelled: seen.filter((l) => l.decision !== true && l.action !== true && (l.decision === null || l.action === null)).length };
}
