// Copyright (c) 2026 Garry Tan. MIT License.
// The product-value eval's two procedure detectors (prereg 2026-11-08-geva-403, section 5), built from the strings the
// pinned gstack (GSTACK_PV_PIN, garrytan/gstack 23f9d07, VERSION 1.98.0.0) prints and writes. Each reads one session's
// record in the style of ceo-exposure.ts: the main agent's own text and its own tool calls with their results. A call
// whose result is an error, carries a tool_use_error tag or is absent did not happen. Subagent records, injected skill
// bodies and tool results never count as the main agent's own words. Every check is reported, and failed names the
// first that did not pass.
//
// plan-ceo-review:
// - handoff: a successful own Bash call whose command names gstack-ceo-mode-handoff and whose result holds the line the
//   pinned bin/gstack-ceo-mode-handoff prints ("Mode: <MODE>; approved decisions: ..." or "Auto-decided review mode
//   \u2192 <MODE> (your preference). Change with /plan-tune. Approved decisions: ..."), when the command does not itself
//   hold that line (so an echo of it never counts). The session's mode is the last such line's mode, since a mode change
//   repeats the handoff.
// - proposal: only in SCOPE EXPANSION or SELECTIVE EXPANSION; at least one 0F proposal with its effort and impact.
// - section_9 and section_10: the main agent's own text, or the text of its own successful Write, Edit or MultiEdit
//   calls, names the section (Deployment & Rollout, Long-Term Trajectory) or at least two of its named checks
//   (feature flags, rollout order, rollback plan; phase 2, platform potential, reversibility).
// - load (secondary, never part of exposed): the handoff ran, and sections/review-sections.md was read by a successful
//   Read or a simple cat, head, sed -n or nl Bash read with a non-empty result.
// A proposal is a sighting in that own text with an effort and an impact. A table counts when its header names a
//   proposal-like column (proposal, addition, expansion, candidate, opportunity, idea) and an Effort column; each row is a
//   sighting, its impact from an Impact column or an impact label in the row. Outside tables, text splits at headings;
//   a heading's section with one effort marker is one sighting titled by the heading, and a section with more splits
//   into list items and paragraphs, then lines. An effort marker is "Effort: M" or "M effort" with S, M, L or XL; an
//   impact is "Impact: <text>" or "high impact" and its kin. Sightings merge by their lowercased title words. A
//   proposal's status is the last explicit status a sighting of it states (pending, deferred, skipped or rejected,
//   accepted or approved, checked in that order), else pending, since an unattended session leaves every approval gate
//   pending.
// - Smoke rule 2's reading (expansion_in_block): a block change carries a proposal when it shares at least half of the
//   proposal title's content words, and at least two of them (or all, for a one-word title). Content words are
//   lowercased runs of letters and digits, longer than two characters, outside a fixed stop list, with one trailing s
//   dropped from words longer than three letters that do not end in ss.
//
// office-hours:
// - design_doc: the session's copy of its gstack state root (host/gstack-state/, which every product-value launch copies
//   out before its work dir goes) holds a non-empty regular file projects/<slug>/<name> whose name matches *-design-*.md,
//   the path the pinned office-hours/sections/design-and-handoff.md writes. The state root is seeded fresh for each
//   session, so any such file is this session's.
// - premises and approaches: that doc holds a "Premises" and an "Approaches Considered" heading.
// - premises_overlap: the Premises section's body (to the next heading at its level or above) shares at least three
//   distinct three-word sequences with brief.md, both read as lowercased runs of letters and digits.
//   A session is exposed when one design doc passes all four.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ceoMode, type CeoMode } from "../../src/trial/review/plan.ts";
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { ownUses, ownWords, skillFileRead } from "../aftermath/exposure.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";
import { pvTranscriptParse } from "./parse.ts";

/** sha256 of this file; rows.json records it. */
export const PV_EXPOSURE_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

/** The gstack commit the detectors were built from, and the files they read strings from, by sha256. */
export const GSTACK_PV_PIN = {
  repo: "garrytan/gstack",
  sha: "23f9d07ce9e802ac148a8a353228f201655fc5b8",
  version: "1.98.0.0",
  files: {
    "plan-ceo-review/SKILL.md": "46b7e0cfa8ede8204a416f40a482555e3325bba710594169307fbc25d709dd4f",
    "plan-ceo-review/sections/review-sections.md": "e97c0d4010f401d49c67919163a93f0f29d8cfe00eb6f478f160b71dd697d190",
    "bin/gstack-ceo-mode-handoff": "530ade6ed08c2795779f4c828855d5ab509158e006313d955036dca53f61b1f1",
    "office-hours/SKILL.md": "3567c8d98afa05e526f7dcf7157f4d52812a238aa9b821f8f7c9381311939b88",
    "office-hours/sections/design-and-handoff.md": "8dffced80c38f8c689cc96196bf43771f4674f23a79932feb522618655c72068",
  } as Record<string, string>,
};

type Rec = Record<string, any>;

export { ownWords };

const MODE_ALT = "SCOPE EXPANSION|SELECTIVE EXPANSION|HOLD SCOPE|SCOPE REDUCTION";
const HANDOFF_LINE = new RegExp("^(?:Mode: (" + MODE_ALT + "); approved decisions: .*|Auto-decided review mode \u2192 (" + MODE_ALT + ") \\(your preference\\)\\. Change with /plan-tune\\. Approved decisions: .*|Auto-selected review mode \u2192 (" + MODE_ALT + ") \\(CEO-only run: Step 0E's rule\\)\\. Approved decisions: .*)$", "gm");

/** The modes the session's successful handoff calls printed, in order. */
export function handoffModes(transcript: string): CeoMode[] {
  return ownUses(transcript).flatMap((u) => {
    const command = typeof u.input.command === "string" ? u.input.command : "";
    if (u.name !== "Bash" || !u.ok || !/gstack-ceo-mode-handoff/.test(command)) return [];
    return [...u.result.matchAll(HANDOFF_LINE)].filter((m) => !command.includes(m[0])).map((m) => (m[1] ?? m[2] ?? m[3]) as CeoMode);
  });
}

const reviewSectionsRead = (transcript: string): boolean => skillFileRead(transcript, "plan-ceo-review/sections/review-sections.md");

const twoOf = (s: string, checks: RegExp[]) => checks.filter((c) => c.test(s)).length >= 2;
/** Section 9 (Deployment & Rollout Review) by its name or two of feature flags, rollout order and rollback plan. */
export const section9 = (s: string): boolean => /deployment\s*(?:&|&amp;|and)\s*rollout/i.test(s) || twoOf(s, [/feature[ -]flags?\b/i, /rollout order/i, /rollback plan/i]);
/** Section 10 (Long-Term Trajectory Review) by its name or two of phase 2, platform potential and reversibility. */
export const section10 = (s: string): boolean => /long[ -]term trajectory/i.test(s) || twoOf(s, [/\bphase (?:2|two)\b/i, /platform potential/i, /\breversibility\b/i]);

export type Effort = "S" | "M" | "L" | "XL";
export type ProposalStatus = "accepted" | "deferred" | "skipped" | "pending";
export interface Proposal {
  title: string;
  effort: Effort;
  impact: string;
  status: ProposalStatus;
  /** Whether a change in the session's block carries it (smoke rule 2's reading); false without a block. */
  in_block: boolean;
}

const plain = (s: string) => s.replace(/\*\*|__|`/g, "");
const EFFORT = /\b(?:[Ee]ffort|EFFORT)\b\s*[:=(|\-\u2013\u2014]?\s*\(?(XL|S|M|L)\b|\b(XL|S|M|L)\b\)?[\s-]+(?:[Ee]ffort|EFFORT)\b/;
const IMPACT = /\b(?:[Ii]mpact|IMPACT)\b\s*[:=|\-\u2013\u2014]\s*(\S[^\n|]*)|\b((?:high|medium|low|major|minor|large|small|big|huge)[\s-]+(?:user[\s-]+)?impact)\b/i;
const effortOf = (s: string): Effort | null => {
  const m = EFFORT.exec(plain(s));
  return m ? ((m[1] ?? m[2]) as Effort) : null;
};
const impactOf = (s: string): string | null => {
  const m = IMPACT.exec(plain(s));
  const v = (m?.[1] ?? m?.[2] ?? "").trim();
  return v && !/^[-\u2013\u2014]+$/.test(v) ? v : null;
};
const effortCount = (s: string) => plain(s).split("\n").reduce((n, l) => n + (l.match(new RegExp(EFFORT.source, "g"))?.length ?? 0), 0);

/** An explicit status a sighting states, checked pending, deferred, skipped, accepted; null when it states none. */
export function statusOf(s: string): ProposalStatus | null {
  if (/\b(?:pending|unresolved|awaiting (?:approval|a decision)|needs approval)\b/i.test(s)) return "pending";
  if (/\bdeferred\b/i.test(s)) return "deferred";
  if (/\b(?:skipped|rejected)\b/i.test(s)) return "skipped";
  if (/\b(?:accepted|approved|added to (?:this plan's |the )?scope)\b/i.test(s)) return "accepted";
  return null;
}

const LIST = /^ {0,3}(?:[-*+\u2022]|\d{1,3}[.)])\s+/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** A sighting's title: a bold lead, else the first line up to its first separator or label. */
function leadTitle(chunk: string): string {
  const first = chunk.split("\n").find((l) => l.trim()) ?? "";
  const line = first.replace(LIST, "").trim();
  const bold = /^(?:\*\*|__)(.+?)(?:\*\*|__)/.exec(line);
  const head = bold ? bold[1]! : plain(line).split(/\s[\u2014\u2013-]\s|:\s|\.\s|\s\(|\b(?:[Ee]ffort|[Ii]mpact|[Rr]isk)\b/)[0]!;
  return head.replace(/[\s.:;,\u2014\u2013-]+$/, "").trim();
}

type Sighting = { title: string; effort: Effort | null; impact: string | null; status: ProposalStatus | null };

/** The sightings in one piece of own text: table rows first, then heading sections, list items and lines. */
export function sightings(source: string): Sighting[] {
  const lines = source.split("\n");
  const out: Sighting[] = [];
  const rest: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i]!.includes("|") && i + 1 < lines.length && SEPARATOR.test(lines[i + 1]!) && lines[i + 1]!.includes("-"))) {
      rest.push(lines[i]!);
      continue;
    }
    const head = cells(lines[i]!).map((c) => plain(c).toLowerCase());
    const col = (re: RegExp) => head.findIndex((c) => re.test(c));
    const [p, e, im, d] = [col(/proposal|addition|expansion|candidate|opportunit|idea/), col(/effort/), col(/impact/), col(/decision|status|disposition/)];
    let j = i + 2;
    for (; j < lines.length && lines[j]!.includes("|"); j++) {
      if (p < 0 || e < 0) continue;
      const row = cells(lines[j]!);
      const title = plain(row[p] ?? "").trim();
      if (!title) continue;
      const others = row.filter((_, k) => k !== p).join(" | ");
      out.push({ title, effort: effortOf("effort " + (row[e] ?? "")), impact: im >= 0 ? (row[im]?.trim() && !/^[-\u2013\u2014]+$/.test(row[im]!.trim()) ? row[im]!.trim() : null) : impactOf(others), status: statusOf(d >= 0 ? (row[d] ?? "") : others) });
    }
    i = j - 1;
    rest.push("");
  }
  const sections: { title: string | null; body: string[] }[] = [{ title: null, body: [] }];
  for (const l of rest) {
    const h = HEADING.exec(l);
    if (h) sections.push({ title: plain(h[2]!).replace(/^(?:\(?\d{1,3}[.):]\s*)+/, "").trim(), body: [] });
    else sections.at(-1)!.body.push(l);
  }
  const sight = (title: string, chunk: string) => out.push({ title, effort: effortOf(chunk), impact: impactOf(chunk), status: statusOf(chunk) });
  for (const s of sections) {
    const body = s.body.join("\n");
    const n = effortCount(body);
    if (n === 0) continue;
    if (n === 1) {
      sight(s.title || leadTitle(body), body);
      continue;
    }
    const items: string[][] = [];
    let blank = true;
    for (const l of s.body) {
      if (!l.trim()) {
        blank = true;
        continue;
      }
      if (LIST.test(l) || (blank && !/^\s/.test(l)) || !items.length) items.push([l]);
      else items.at(-1)!.push(l);
      blank = false;
    }
    for (const item of items) {
      const chunk = item.join("\n");
      const m = effortCount(chunk);
      if (m === 1) sight(leadTitle(chunk), chunk);
      else if (m > 1) for (const l of item) if (effortCount(l) === 1) sight(leadTitle(l), l);
    }
  }
  return out;
}

const STOP = new Set("about above after again all also and any are because been before being both but can could does each either for from has have here how into its just let lets make makes more most new not now only other our out over plan same should some such than that the their them then there these they this those through too under until very was were what when where which while who why will with without would you your add adds adding allow allows support supports feature features user users team".split(" "));
/** A text's content words for smoke rule 2's match. */
export function contentWords(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
}
/** Whether a block change carries a proposal: it shares at least half the title's content words, and at least two (or all of a one-word title). */
export function carries(change: string, title: string): boolean {
  const t = contentWords(title);
  if (!t.size) return false;
  const c = contentWords(change);
  const shared = [...t].filter((w) => c.has(w)).length;
  return shared >= Math.max(Math.min(2, t.size), Math.ceil(t.size / 2));
}

/** The session's proposals: every sighting with an effort and an impact, merged by title words, with its status. */
export function proposalsOf(transcript: string, changes: readonly string[] | null): Proposal[] {
  const merged = new Map<string, { title: string; effort: Effort | null; impact: string | null; status: ProposalStatus | null; counted: boolean }>();
  for (const s of ownWords(transcript).flatMap(sightings)) {
    const key = (s.title.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");
    if (!key) continue;
    const p = merged.get(key) ?? { title: s.title, effort: null, impact: null, status: null, counted: false };
    p.effort ??= s.effort;
    p.impact ??= s.impact;
    p.status = s.status ?? p.status;
    p.counted ||= !!(s.effort && s.impact);
    merged.set(key, p);
  }
  return [...merged.values()].filter((p) => p.counted).map((p) => ({ title: p.title, effort: p.effort!, impact: p.impact!, status: p.status ?? "pending", in_block: (changes ?? []).some((c) => carries(c, p.title)) }));
}

export interface CeoReviewExposure {
  detector: "plan-ceo-review";
  exposed: boolean;
  failed: string | null;
  /** proposal is null when the mode is not an expansion mode, where the check does not apply. */
  checks: { handoff: boolean; proposal: boolean | null; section_9: boolean; section_10: boolean };
  load: { handoff: boolean; review_sections_read: boolean };
  mode: CeoMode | null;
  proposals: Proposal[];
  pending: number;
  /** Smoke rule 2: whether the session's block carries a 0F or 0G proposal; null without a block. */
  expansion_in_block: boolean | null;
}

const verdict = <C extends Record<string, boolean | null>>(checks: C) => ({ exposed: Object.values(checks).every((v) => v !== false), failed: Object.entries(checks).find(([, v]) => v === false)?.[0] ?? null });

/** plan-ceo-review's detector over one session's transcript.ndjson text. */
export function ceoReviewExposure(transcript: string): CeoReviewExposure {
  const modes = handoffModes(transcript);
  const mode = modes.at(-1) ?? null;
  const parse = pvTranscriptParse(transcript);
  const changes = parse.kind === "changes" ? parse.changes : null;
  const proposals = proposalsOf(transcript, changes);
  const said = ownWords(transcript).join("\n");
  const expansion = mode === "SCOPE EXPANSION" || mode === "SELECTIVE EXPANSION";
  const checks = { handoff: modes.length > 0, proposal: expansion ? proposals.length > 0 : null, section_9: section9(said), section_10: section10(said) };
  return { detector: "plan-ceo-review", ...verdict(checks), checks, load: { handoff: modes.length > 0, review_sections_read: reviewSectionsRead(transcript) }, mode: mode ?? ceoMode(mainAgentTexts(transcript)), proposals, pending: proposals.filter((p) => p.status === "pending").length, expansion_in_block: changes === null ? null : proposals.some((p) => p.in_block) };
}

export interface OfficeHoursExposure {
  detector: "office-hours";
  exposed: boolean;
  failed: string | null;
  checks: { design_doc: boolean; premises: boolean; approaches: boolean; premises_overlap: boolean };
  /** Each design doc found, relative to the state root copy. */
  docs: string[];
  /** The best doc's count of shared three-word sequences between its Premises section and brief.md. */
  overlap: number;
}

/** Three-word sequences of a text's lowercased runs of letters and digits. */
export function trigrams(s: string): Set<string> {
  const w = s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(w.slice(2).map((_, i) => w[i] + " " + w[i + 1] + " " + w[i + 2]));
}

/** The body under the first heading named name, to the next heading at its level or above; null when there is none. */
export function sectionBody(doc: string, name: string): string | null {
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => HEADING.exec(l)?.[2]?.trim().toLowerCase() === name.toLowerCase());
  if (at < 0) return null;
  const level = HEADING.exec(lines[at]!)![1]!.length;
  const end = lines.findIndex((l, i) => i > at && (HEADING.exec(l)?.[1]?.length ?? 7) <= level);
  return lines.slice(at + 1, end < 0 ? undefined : end).join("\n");
}

/** The design docs under a state root copy: projects/<slug>/*-design-*.md, non-empty regular files. */
export function designDocs(stateRoot: string): string[] {
  const list = (d: string) => {
    try {
      return readdirSync(d);
    } catch {
      return [];
    }
  };
  return list(join(stateRoot, "projects")).flatMap((slug) => {
    const dir = join(stateRoot, "projects", slug);
    if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
    return list(dir).filter((n) => /-design-.*\.md$/.test(n) && (lstatSync(join(dir, n), { throwIfNoEntry: false })?.isFile() ?? false) && lstatSync(join(dir, n)).size > 0).map((n) => join("projects", slug, n));
  });
}

/** office-hours' detector over a session's state root copy (null when there is none) and the unit's brief.md text. */
export function officeHoursExposure(stateRoot: string | null, brief: string): OfficeHoursExposure {
  const docs = stateRoot ? designDocs(stateRoot) : [];
  const want = trigrams(brief);
  const reads = docs.map((d) => {
    const doc = readFileSync(join(stateRoot!, d), "utf8");
    const premises = sectionBody(doc, "Premises");
    const overlap = premises === null ? 0 : [...trigrams(premises)].filter((t) => want.has(t)).length;
    return { checks: { design_doc: true, premises: premises !== null, approaches: sectionBody(doc, "Approaches Considered") !== null, premises_overlap: overlap >= 3 }, overlap };
  });
  const score = (r: (typeof reads)[number]) => Object.values(r.checks).filter(Boolean).length * 1000 + r.overlap;
  const best = reads.sort((a, b) => score(b) - score(a))[0] ?? { checks: { design_doc: false, premises: false, approaches: false, premises_overlap: false }, overlap: 0 };
  return { detector: "office-hours", ...verdict(best.checks), checks: best.checks, docs, overlap: best.overlap };
}

/** The detector for a skill arm's session dir: host/transcript.ndjson, host/gstack-state/ and, for office-hours, brief.md's text. */
export function sessionExposure(sessionDir: string, skill: "plan-ceo-review" | "office-hours", brief: string | null): CeoReviewExposure | OfficeHoursExposure | null {
  if (skill === "office-hours") return officeHoursExposure(lstatSync(join(sessionDir, "host", "gstack-state"), { throwIfNoEntry: false })?.isDirectory() ? join(sessionDir, "host", "gstack-state") : null, brief ?? "");
  try {
    return ceoReviewExposure(readFileSync(join(sessionDir, "host", "transcript.ndjson"), "utf8"));
  } catch {
    return null;
  }
}

const HELP = "gstack-evals pv exposure --session <session dir> --skill plan-ceo-review|office-hours [--brief <brief.md>]\n  Prints the detector's checks for one review-units product-value session (its host/transcript.ndjson and host/gstack-state/).";

export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(HELP);
    return 0;
  }
  const session = get("--session");
  const skill = get("--skill");
  const briefFile = get("--brief");
  const refuse = (why: string, fix: string) => {
    io.err("E_USAGE pv exposure: " + why + "\nE_USAGE fix: " + fix);
    return 2;
  };
  if (!session || (skill !== "plan-ceo-review" && skill !== "office-hours")) return refuse("needs --session <dir> and --skill plan-ceo-review or office-hours", "run gstack-evals pv exposure --help");
  if (skill === "office-hours" && !briefFile) return refuse("office-hours reads the unit's brief.md for the Premises check", "pass --brief <units dir>/<unit>/brief.md");
  let brief: string | null = null;
  try {
    brief = briefFile ? readFileSync(briefFile, "utf8") : null;
  } catch (e) {
    return refuse("cannot read " + briefFile + ": " + (e as Error).message, "pass the unit's brief.md");
  }
  const result = sessionExposure(session, skill, brief);
  if (!result) return refuse(session + "/host/transcript.ndjson cannot be read", "pass a session dir from a review-units product-value run");
  io.out(JSON.stringify({ exposure_sha256: PV_EXPOSURE_SHA256, ...result }, null, 2));
  return 0;
}
