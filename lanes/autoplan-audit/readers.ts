// Copyright (c) 2026 Garry Tan. MIT License.
// Sections 5.1 to 5.4: the X-1, X-2, X-3 and GATE-1 readers over parsed records. Each returns per-run or per-phase
// rows with counts only; verdict.ts turns them into readings. Nothing here returns record text.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { contentWords, overlap } from "./diff.ts";
import { blocks, present, tables } from "./detect.ts";
import type { Matrix } from "./matrix.ts";
import type { Decision, Phase, RunRecord } from "./records.ts";
import { answered } from "./records.ts";
import { accepted, unitsOf, wordCount, type Unit } from "./units.ts";

/** CEO and Eng always; Design and DX when the record's scope says so and the plan is not docs-only. */
export function applicable(r: RunRecord): Phase[] {
  const s = r.run?.scope ?? {};
  if (r.kind === "full" && Array.isArray(r.run?.phase_order)) return r.run.phase_order.filter((p: string) => ["ceo", "design", "dx", "eng"].includes(p));
  return ["ceo", "eng", ...(s.ui && !s.docs_only ? (["design"] as const) : []), ...(s.dx && !s.docs_only ? (["dx"] as const) : [])];
}

const LENS: Record<Phase, RegExp> = { ceo: /\b(ceo|strategy)\b/i, design: /\bdesign\b/i, dx: /\b(dx|developer experience)\b/i, eng: /\b(eng|engineering)\b/i };
const PROMPT_LENS: Record<Phase, RegExp> = { ceo: /^#{2,4}\s+CEO lens\b/im, design: /^#{2,4}\s+Design lens\b/im, dx: /^#{2,4}\s+DX lens\b/im, eng: /^#{2,4}\s+Eng lens\b/im };

/** The bound native result a phase used: the file run.json names, else the highest attempt. */
export function boundNative(r: RunRecord, phase: Phase): string | null {
  const named = r.run?.phases?.[phase]?.native?.output;
  const base = typeof named === "string" ? named.split("/").pop()! : null;
  if (base && r.bound.has(base)) return r.bound.get(base)!;
  const files = [...r.bound.keys()].filter((f) => f.startsWith(phase + "-native.a")).sort((a, b) => Number(/a(\d+)/.exec(b)![1]) - Number(/a(\d+)/.exec(a)![1]));
  return files.length ? r.bound.get(files[0]!)! : null;
}

/** The parts of a lean result labelled for one lens: each heading section (to the next heading of its level or higher) and each bold label's text. */
export function lensPart(md: string, phase: Phase): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[i]!);
    if (h && LENS[phase].test(h[2]!)) {
      let j = i + 1;
      while (j < lines.length && !(/^(#{1,6})\s/.exec(lines[j]!) && /^(#{1,6})\s/.exec(lines[j]!)![1]!.length <= h[1]!.length)) j++;
      out.push(lines.slice(i, j).join("\n"));
    }
  }
  for (const b of blocks(md)) if (b.kind === "label" && LENS[phase].test(b.label)) out.push(b.body);
  return out.join("\n\n");
}

function firstGateAt(r: RunRecord): number | null {
  const times = [r.run?.gate?.written_at, ...(Array.isArray(r.run?.history) ? r.run.history.map((h: any) => h?.previous?.written_at ?? (h?.event === "reopened" ? h?.at : null)) : [])].filter((t) => typeof t === "string").map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t));
  return times.length ? Math.min(...times) : null;
}

export interface X1Row {
  run: string;
  kind: RunRecord["kind"];
  delivery: boolean | null;
  completion: boolean | null;
  /** Runner records: the runner refuses an answer before a gate exists, so no record row can show a question; unobservable. */
  silence: "by construction" | "unobservable";
  reopens: number;
}

export function x1(r: RunRecord): X1Row {
  const reopens = Array.isArray(r.run?.history) ? r.run.history.filter((h: any) => h?.event === "reopened").length : 0;
  const base = { run: r.id, kind: r.kind, silence: "by construction" as const, reopens };
  if (!r.run) return { ...base, delivery: null, completion: null };
  const lenses = applicable(r);
  const gateAt = firstGateAt(r);
  const closed = (p: Phase) => {
    const t = Date.parse(String(r.run.phases?.[p]?.closed_at ?? ""));
    return Number.isNaN(t) ? null : t;
  };
  if (r.kind === "lean") {
    const prompt = r.prompts.get("eng-native-prompt.md") ?? [...r.prompts.entries()].find(([f]) => f.startsWith("eng-native-prompt"))?.[1];
    const delivery = prompt === undefined ? null : lenses.every((p) => PROMPT_LENS[p].test(prompt));
    const bound = boundNative(r, "eng");
    const at = closed("eng");
    if (bound === null || at === null || gateAt === null) return { ...base, delivery, completion: null };
    const labelled = (p: Phase) => {
      const bs = blocks(bound);
      return bs.some((b) => b.kind !== "table" && LENS[p].test(b.label) && (wordCount(b.body.replace(/[|#*_\x60-]/g, " ")) >= 30 || tables(b.body).some((t) => t.length >= 1)));
    };
    return { ...base, delivery, completion: at <= gateAt && lenses.every(labelled) };
  }
  if (gateAt === null) return { ...base, delivery: null, completion: null };
  const times = lenses.map((p) => (r.run.phases?.[p]?.native?.status === "completed" && boundNative(r, p) !== null ? closed(p) : null));
  const ordered = times.every((t, i) => t !== null && t <= gateAt && (i === 0 || t >= times[i - 1]!));
  return { ...base, delivery: null, completion: ordered };
}

export interface X2Row {
  run: string;
  kind: RunRecord["kind"];
  present: number;
  strictPresent: number;
  applicable: number;
  missing: number;
  excludedConsensus: number;
  share: number | null;
  strictShare: number | null;
  checklist: number | null;
}

export function x2(r: RunRecord, m: Matrix): X2Row {
  const phases = applicable(r);
  const rel = r.run ? m.forVersion(String(r.run.gstack_version ?? "")) : null;
  let presentN = 0, strictN = 0, applicableN = 0, missing = 0, excluded = 0;
  for (const p of phases) {
    const cells = rel ? rel.cells[p] : [];
    const n = rel ? cells.length : 0;
    if (!rel) {
      missing += 1;
      continue;
    }
    const native = r.kind === "lean" ? boundNative(r, "eng") : boundNative(r, p);
    const boundTexts = r.kind === "lean" ? (native === null ? [] : [native]) : [...r.bound.entries()].filter(([f]) => f.startsWith(p + "-")).map(([, t]) => t);
    const lost = native === null || r.reviewRecord === null;
    const consensus = [...r.consensus.entries()].filter(([f]) => f.startsWith(p + "-consensus") && f.endsWith(".md")).map(([, t]) => t);
    const searched = [...boundTexts, ...(r.kind === "full" ? consensus : []), r.reviewRecord ?? ""].join("\n\n");
    const part = r.kind === "lean" ? (p === "eng" ? lensPart(native ?? "", "eng") || native || "" : lensPart(native ?? "", p)) : boundTexts.join("\n\n");
    for (const cell of cells) {
      if (r.kind === "lean" && cell === "consensus") {
        excluded++;
        continue;
      }
      if (lost) {
        missing++;
        continue;
      }
      applicableN++;
      const input = { phase: p, cell, searched, part, files: r.files, hasConsensusFile: consensus.some((t) => t.trim().length > 0), dims: rel.dims, ceoSections: rel.ceoSections, ui: Boolean(r.run?.scope?.ui) };
      if (present(input, false)) presentN++;
      if (present(input, true)) strictN++;
    }
    void n;
  }
  return { run: r.id, kind: r.kind, present: presentN, strictPresent: strictN, applicable: applicableN, missing, excludedConsensus: excluded, share: applicableN ? presentN / applicableN : null, strictShare: applicableN ? strictN / applicableN : null, checklist: r.kind === "lean" ? checklistShare(r) : null };
}

/** Secondary X-2 reading on lean runs: the checklist bullets the reviewer received, less the outputs a subagent can't produce, each present when 60% of its content words sit in one paragraph of the result. */
export function checklistShare(r: RunRecord): number | null {
  const prompt = r.prompts.get("eng-native-prompt.md");
  const bound = boundNative(r, "eng");
  if (!prompt || bound === null) return null;
  const at = prompt.search(/^##\s+Checklist\b/im);
  if (at < 0) return null;
  const items = prompt.slice(at).split("\n").filter((l) => /^\s*[-*]\s+\S/.test(l) && !/review log|next[- ]skill|handoff|learnings/i.test(l));
  if (!items.length) return null;
  const paras = bound.split(/\n\s*\n/);
  const hit = items.filter((l) => {
    const t = new Set(contentWords(l));
    return t.size > 0 && paras.some((p) => overlap(t, p) >= 0.6);
  }).length;
  return hit / items.length;
}

const family = (model: unknown): string | null => {
  if (typeof model !== "string" || !model) return null;
  if (model.includes("/")) return model.split("/")[0]!.toLowerCase();
  return /claude|opus|sonnet|haiku/i.test(model) ? "anthropic" : /gpt|o\d/i.test(model) ? "openai" : /gemini/i.test(model) ? "google" : model.toLowerCase();
};

export interface X3Row {
  run: string;
  kind: RunRecord["kind"];
  phase: Phase;
  ran: boolean;
  crossFamily: boolean | null;
  /** Without a completed outside voice: recorded unavailable, disabled, skipped or failed, and the consensus not marked confirmed. */
  honest: boolean | null;
  outsideFindings: number;
  newByGstack: number;
  newMechanical: number;
}

export function x3(r: RunRecord): X3Row[] {
  if (!r.run || !answered(r)) return [];
  const out: X3Row[] = [];
  for (const p of r.kind === "lean" ? (["eng"] as Phase[]) : applicable(r)) {
    const ph = r.run.phases?.[p] ?? {};
    const ran = ph.outside?.status === "completed";
    const nat = family(ph.native?.model ?? r.run.native_model);
    const outF = family(ph.outside?.model ?? r.run.outside_model);
    const c = ph.consensus ?? {};
    const confirmed = c.coverage === "both" || (typeof c.confirmed === "number" && c.confirmed > 0) || c.confirmed === true;
    const fs = (r.findings ?? []).filter((f) => f.phase === p);
    const outside = fs.filter((f) => f.voice === "outside");
    const natives = fs.filter((f) => f.voice === "native").map((f) => new Set(contentWords((f.title ?? "") + " " + (f.resolution ?? ""))));
    const jac = (a: Set<string>, b: Set<string>) => (a.size + b.size ? [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size : 0);
    out.push({
      run: r.id,
      kind: r.kind,
      phase: p,
      ran,
      crossFamily: ran ? (nat !== null && outF !== null ? nat !== outF : null) : null,
      honest: ran ? null : ["unavailable", "disabled", "skipped", "failed"].includes(String(ph.outside?.status)) && !confirmed,
      outsideFindings: outside.length,
      newByGstack: outside.filter((f) => f.reconciliation === "new").length,
      newMechanical: outside.filter((f) => {
        const w = new Set(contentWords((f.title ?? "") + " " + (f.resolution ?? "")));
        return Math.max(0, ...natives.map((n) => jac(w, n))) < 0.3;
      }).length,
    });
  }
  return out;
}

/** X-3's lean design reading: every readable lean record has its outside voice disabled. */
export const leanByDesign = (records: readonly RunRecord[]): boolean => {
  const lean = records.filter((r) => r.kind === "lean" && r.run);
  return lean.length > 0 && lean.every((r) => r.run.outside_enabled === false || r.run.phases?.eng?.outside?.status === "disabled");
};

/** Accepted plan changes whose originating finding is an outside-only finding (X-3's added share). */
export const outsideOnlyAccepted = (units: Unit[]): number => units.filter((u) => accepted(u) && u.finding?.voice === "outside" && u.finding.reconciliation === "new").length;

// ---- GATE-1 ----

export interface ApprovalDoc {
  file: string;
  text: string;
  /** The owner's words: a person (not an agent or thread code) is named as the one who said them. */
  ownerWords: boolean;
  /** A Captain decision under a written standing rule. */
  standing: boolean;
}

const AGENT = /^(captain\s+)?([A-Z]{2,5}-\d+|jam_|agent:)/i;

export function readApprovals(dir: string): { docs: ApprovalDoc[]; unreadable: number } {
  const docs: ApprovalDoc[] = [];
  let unreadable = 0;
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".jsonl")) {
        for (const line of readFileSync(p, "utf8").split("\n").filter((l) => l.trim())) {
          try {
            const x = JSON.parse(line);
            const by = String(x.by ?? "");
            const words = String(x.words ?? "");
            const standing = x.outcome === "standing" || /standing (rule|acceptance)|CREW\.md/i.test(String(x.source ?? "") + " " + words);
            docs.push({ file: relative(dir, p), text: [x.ask, x.source, x.words, x.scope].map((v) => String(v ?? "")).join("\n"), ownerWords: words.trim().length > 0 && by.trim().length > 0 && !AGENT.test(by.trim()), standing: standing && AGENT.test(by.trim()) });
          } catch {
            unreadable++;
          }
        }
      } else if (name.endsWith(".md")) {
        const text = readFileSync(p, "utf8");
        const standing = /standing (rule|acceptance)/i.test(text);
        docs.push({ file: relative(dir, p), text, ownerWords: !standing, standing });
      }
    }
  };
  walk(dir);
  return { docs, unreadable };
}

export type Attribution = "recorded" | "corroborated" | "delegated" | "missing";

const revMarker = (rev: number) => new RegExp("(?:\\b(?:gate[_ ]?rev(?:ision)?|revision|rev|gate)\\s*[:=#]?\\s*" + rev + "\\b|\\br" + rev + "\\b)", "i");

/** Approvals records bound to one gate revision: they name the run id and either the revision or one of its rec hashes. */
export function boundApprovals(docs: readonly ApprovalDoc[], run: string, rev: number, recHashes: readonly string[]): ApprovalDoc[] {
  return docs.filter((d) => d.text.includes(run) && (recHashes.some((h) => h && d.text.includes(h)) || revMarker(rev).test(d.text)));
}

const ownerRow = (d: Decision) => (typeof d.owner_reply === "string" && d.owner_reply.trim().length > 0) || d.answered_by === "human";
const agentRow = (d: Decision) => /^agent:/.test(String(d.answered_by ?? "")) || d.answered_role === "agent";

export function attribution(r: RunRecord, rev: number, docs: readonly ApprovalDoc[]): Attribution {
  return attributionOf(r, rev, docs).attribution;
}

/** The attribution of one revision, and whether any approvals record is bound to it (a bound record rules out a violation). */
export function attributionOf(r: RunRecord, rev: number, docs: readonly ApprovalDoc[]): { attribution: Attribution; bound: boolean } {
  const rows = (r.decisions ?? []).filter((d) => d.gate_rev === rev && d.answered_at);
  const gateOwner = r.run?.gate?.gate_rev === rev && typeof r.run?.gate?.owner_reply === "string" && r.run.gate.owner_reply.trim().length > 0;
  const bound = boundApprovals(docs, r.id, rev, rows.map((d) => d.rec_hash ?? "").filter(Boolean));
  if (rows.some(ownerRow) || gateOwner) return { attribution: "recorded", bound: bound.length > 0 };
  if (bound.some((d) => d.ownerWords)) return { attribution: "corroborated", bound: true };
  if (bound.some((d) => d.standing)) return { attribution: "delegated", bound: true };
  return { attribution: "missing", bound: bound.length > 0 };
}

export interface Gate1Run {
  run: string;
  kind: RunRecord["kind"];
  readable: boolean;
  violation: boolean;
  answered: boolean;
  revisions: Array<{ rev: number; attribution: Attribution; changed: boolean | null; items: number; changedItems: number }>;
  ucItems: number;
  ucKept: number;
  ucViolations: number;
  ucMissing: number;
  autoRec: number;
  reversed: number;
  reopens: number;
}

/** The revisions an unchanged carry reaches back to: same options and recommendation, each answered. */
function carriedRevs(row: Decision, byId: Map<string, Decision>): number[] {
  const revs = [row.gate_rev];
  let cur = row;
  while (cur.carried_from && byId.has(cur.carried_from)) {
    const prev = byId.get(cur.carried_from)!;
    if (JSON.stringify(prev.options) !== JSON.stringify(cur.options) || prev.recommended !== cur.recommended || !prev.answered_at) break;
    revs.push(prev.gate_rev);
    cur = prev;
  }
  return revs;
}

export function gate1(r: RunRecord, docs: readonly ApprovalDoc[]): Gate1Run {
  const reopens = Array.isArray(r.run?.history) ? r.run.history.filter((h: any) => h?.event === "reopened").length : 0;
  const base = { run: r.id, kind: r.kind, revisions: [], ucItems: 0, ucKept: 0, ucViolations: 0, ucMissing: 0, autoRec: 0, reversed: 0, reopens };
  const status = String(r.run?.status ?? "");
  const anyBound = docs.some((d) => d.text.includes(r.id) && (/(rec_hash|gate_rev|revision|\br\d+\b)/i.test(d.text) || (r.decisions ?? []).some((x) => x.rec_hash && d.text.includes(x.rec_hash))));
  const lostFile = r.decisions === null && (r.unreadable.includes("decisions.jsonl") || ["complete", "approved"].includes(status));
  if (!r.run || lostFile) return { ...base, readable: false, violation: false, answered: false };
  if (r.decisions === null) return { ...base, readable: true, violation: false, answered: anyBound };
  const rowsAnswered = r.decisions.some((d) => d.answered_at);
  const isAnswered = rowsAnswered || anyBound;
  const violation = ["complete", "approved"].includes(status) && !isAnswered;
  if (!rowsAnswered) return { ...base, readable: true, violation, answered: isAnswered };
  const revs = [...new Set(r.decisions.filter((d) => d.answered_at).map((d) => d.gate_rev))].sort((a, b) => a - b);
  const of = new Map(revs.map((rev) => [rev, attributionOf(r, rev, docs)]));
  const attr = new Map([...of].map(([rev, a]) => [rev, a.attribution]));
  const overrides = Array.isArray(r.run.gate?.overrides) ? r.run.gate.overrides.length : 0;
  const revisions = revs.map((rev) => {
    const rows = r.decisions!.filter((d) => d.gate_rev === rev && d.answered_at);
    const changedRow = (d: Decision) => (d.reply !== undefined && d.reply !== "rec") || d.status === "overridden" || (d.chosen !== undefined && d.recommended !== undefined && d.chosen !== d.recommended);
    const owner = attr.get(rev) === "recorded" || attr.get(rev) === "corroborated";
    return { rev, attribution: attr.get(rev)!, changed: owner ? rows.some(changedRow) || (r.run.gate?.gate_rev === rev && overrides > 0) : null, items: owner ? rows.length : 0, changedItems: owner ? rows.filter(changedRow).length : 0 };
  });
  const byId = new Map(r.decisions!.map((d) => [d.id, d]));
  const units = unitsOf(r) ?? [];
  let ucItems = 0, ucKept = 0, ucViolations = 0, ucMissing = 0, autoRec = 0, reversed = 0;
  for (const u of units) {
    const latest = [...u.rows].sort((a, b) => b.gate_rev - a.gate_rev)[0]!;
    const prev = latest.carried_from ? byId.get(latest.carried_from) : undefined;
    const changedOpen = !latest.answered_at && prev !== undefined && (JSON.stringify(prev.options) !== JSON.stringify(latest.options) || prev.recommended !== latest.recommended);
    if (u.userChallenge && changedOpen) {
      ucItems++;
      ucMissing++;
    } else if (u.userChallenge && u.last) {
      ucItems++;
      const revsBack = carriedRevs(u.last, byId);
      const a = revsBack.map((rev) => attr.get(rev) ?? "missing");
      const standingRow = u.last.owner_mode === "standing" || /standing rule/i.test(String(u.last.answer_words ?? ""));
      if (a.some((x) => x !== "missing") || standingRow) ucKept++;
      else if (agentRow(u.last) && !ownerRow(u.last) && !revsBack.some((rev) => of.get(rev)?.bound)) ucViolations++;
      else ucMissing++;
    }
    const rows = [...u.rows].filter((d) => d.answered_at).sort((a, b) => a.gate_rev - b.gate_rev);
    rows.forEach((d, i) => {
      if (d.kind === "auto" && d.chosen !== undefined && d.chosen === d.recommended) {
        autoRec++;
        if (rows.slice(i + 1).some((later) => later.gate_rev > d.gate_rev && later.chosen !== d.chosen)) reversed++;
      }
    });
  }
  return { ...base, readable: true, violation, answered: true, revisions, ucItems, ucKept, ucViolations, ucMissing, autoRec, reversed };
}
