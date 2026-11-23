// Copyright (c) 2026 Garry Tan. MIT License.
// One draft of the office-hours rewrite eval's authoring (prereg section 3, "Authoring and validation", "Unanimous key",
// "Give-away screen" and "Twins"): the author call for a slot and role, then the checks in order, each bound to the
// digest of the brief's current files:
//   the twin check (a second twin only: the partner's opening, one hidden decisive fact apart), the vocabulary screen,
//   the unanimous key, the give-away screen (unpaired briefs only; twins pass it by construction), the blind audit, the
//   recognition probe and the generic screen.
// A vocabulary hit or an audit failure goes back to the author with the fixed note and the failed checks, and a
// recognition hit with the frozen probe line; every other failure drops the draft at once. A brief gets one rewrite in
// all: the rewrite voids every earlier result and the brief reruns every check in order. Both twins and any top-up twin
// are written by the pair's author family. Every prompt ends with the draft's reference line, so no two drafts send the
// same request and the meter's reply cache can never answer one draft with another's reply.
import type { CheckEntry } from "../../office-hours-founder/author/constructed.ts";
import { ask } from "../../office-hours-founder/author/checks.ts";
import type { AuthorFamily, BuilderGoal, FounderType } from "../types.ts";
import { audit, briefText, genericScreen, notGivenAway, probe, unanimous, validate, type Deps } from "./checks.ts";
import { modelOf, type Slot } from "./draws.ts";
import { digestOf, fileNames, readBrief, twinProblem, type BriefFiles, type ReadSpec, type Role } from "./files.ts";
import { ANTI_PATTERNS, AUDIT_CHECKS, PROBE_REWRITE, REWRITE_NOTE, SKINS, builderPrompt, pairPrompt, rewritePrompt, twinPrompt, unpairedPrompt } from "./prompts.ts";
import { screenVocabulary } from "./screens.ts";

export type { CheckEntry };

export interface Outcome {
  /** The brief id: d<draw> for an unpaired brief, d<draw>a and d<draw>b for a pair's twins. */
  id: string;
  slot: string;
  role: Role;
  draw: number;
  /** A second twin's draft number for its partner: 1, then 2 and up for top-ups. 1 otherwise. */
  attempt: number;
  author: AuthorFamily;
  pilot: boolean;
  status: "pass" | "drop";
  step: string | null;
  reason: string;
  files: BriefFiles | null;
  /** A first twin's opposite call, which its second twin's key must make. */
  twin_call: string | null;
  digest: string | null;
  checks: CheckEntry[];
  rewrites: number;
  record: Record<string, unknown>;
}

export const surfaceOf = (id: string | null): string | null => (id ? ANTI_PATTERNS.find((a) => a.id === id)!.surface : null);
export const refLine = (ref: string): string => "\n\nBrief reference: " + ref + ".";

/** The partner a second twin is written against. */
export interface Partner {
  id: string;
  files: BriefFiles;
  twin_call: string;
}

const promptFor = (slot: Slot, role: Role, partner: Partner | null): string => {
  const skin = SKINS[slot.skinIndex]!;
  if (role === "second") return twinPrompt(slot.type as FounderType, slot.side, partner!.files.opening, partner!.files.sheet, partner!.files.key.decisive, partner!.twin_call);
  if (slot.kind === "builder") return builderPrompt(slot.type as BuilderGoal, skin);
  if (role === "first") return pairPrompt(slot.type as FounderType, slot.side, skin, surfaceOf(slot.anti_pattern)!);
  return unpairedPrompt(slot.type as FounderType, skin, surfaceOf(slot.anti_pattern)!);
};
/** Every author prompt a slot's first draft sends, without its reference line: what the pilot's frozen-inputs digest reads. */
export const firstPrompt = (slot: Slot): string => promptFor(slot, slot.kind === "pair" ? "first" : "unpaired", null);

type Verdict = { ok: true; record: Record<string, unknown> } | { ok: false; step: string; reason: string; note: string | null };

/** The checks after the author call, logged against the brief's current digest. */
export async function checkBrief(id: string, b: BriefFiles, c: { role: Role; author: AuthorFamily; contrast: string; surface: string | null; industry: string }, deps: Deps, log: CheckEntry[]): Promise<Verdict> {
  const digest = digestOf(b);
  const entry = (step: string, ok: boolean, detail: string) => log.push({ step, digest, ok, detail, void: false });
  const fail = (step: string, reason: string, note: string | null): Verdict => (entry(step, false, reason), { ok: false, step, reason, note });

  const vocab = screenVocabulary(deps.screen, b);
  if (!vocab.pass) return fail("vocabulary", "barred words: " + vocab.hits.join("; "), REWRITE_NOTE + "\n- vocabulary screen: these word sequences or terms may not appear: " + vocab.hits.join("; "));
  entry("vocabulary", true, "no barred sequence or term");

  const full = await validate(id, b, c.contrast, "unanimous", deps);
  if (Object.values(full).includes(null)) return fail("unanimous", "a validator gave no block or an unlabelled cell after one retry", null);
  if (!unanimous(full)) return fail("unanimous", "not unanimous", null);
  entry("unanimous", true, "all three made the key's call and named an acceptable action");

  let opening: Awaited<ReturnType<typeof validate>> | null = null;
  if (c.role === "unpaired") {
    opening = await validate(id, b, c.contrast, "give-away", deps);
    if (Object.values(opening).includes(null)) return fail("give-away", "a validator gave no block or an unlabelled cell after one retry", null);
    if (!notGivenAway(opening)) return fail("give-away", "given away", null);
    entry("give-away", true, "no validator made the key's call from the opening alone");
  }

  const a = await audit(id, b, c.author, c.contrast, c.surface, deps);
  if (a.failed.length) return fail("audit", "failed checks " + a.failed.join(", "), REWRITE_NOTE + a.failed.map((k) => "\n- (" + k + ") " + AUDIT_CHECKS[k]).join(""));
  entry("audit", true, "both auditors pass (a) to (f)");

  const p = await probe(id, b, deps);
  if (p.hit) return fail("probe", "a model under test or the simulator named a matching company", PROBE_REWRITE.replace("<industry>", c.industry));
  entry("probe", true, "no counted guess");

  const g = await genericScreen(id, b, c.contrast, deps);
  if (g.generic) return fail("generic", "a stock row was credited: " + g.credited.join("; "), null);
  entry("generic", true, "no stock row credited; unlabelled cells: " + g.unlabelled);
  return { ok: true, record: { validators: { unanimous: full, opening_only: opening }, audit: a.by, probe: p.records, generic_unlabelled: g.unlabelled } };
}

/** A draft's brief id: d<draw> for an unpaired brief, d<draw>a for a first twin, and its partner's id ending in b for a second twin. */
export const draftId = (role: Role, draw: number, partner: Pick<Partner, "id"> | null): string => (role === "second" ? partner!.id.replace(/a$/, "b") : "d" + draw + (role === "first" ? "a" : ""));

/** One draft for a slot and role, end to end. A second twin is written against its partner. */
export async function runDraft(slot: Slot, role: Role, o: { draw: number; attempt: number; author: AuthorFamily; pilot: boolean; partner: Partner | null }, deps: Deps): Promise<Outcome> {
  const id = draftId(role, o.draw, o.partner);
  const ref = id + (o.attempt > 1 ? "." + o.attempt : "");
  const spec: ReadSpec = { role, goal: slot.kind === "builder" ? (slot.type as BuilderGoal) : null, prior: slot.type === "T8", twin: role === "first" ? id.replace(/a$/, "b") : role === "second" ? o.partner!.id : null, opening: o.partner?.files.opening };
  const prompt = promptFor(slot, role, o.partner) + refLine(ref);
  const checks: CheckEntry[] = [];
  let rewrites = 0;
  const base = { id, slot: slot.slot, role, draw: o.draw, attempt: o.attempt, author: o.author, pilot: o.pilot, checks };
  const drop = (step: string, reason: string, files: BriefFiles | null, twinCall: string | null): Outcome => ({ ...base, status: "drop", step, reason, files, twin_call: twinCall, digest: files ? digestOf(files) : null, rewrites, record: {} });
  const write = (p: string, label: string) => ask(deps.call, { model: modelOf(o.author), prompt: p, maxTokens: 16000, effort: "high", label }, (t) => readBrief(t, spec));
  let got = await write(prompt, ref + ":author");
  if (typeof got === "string") return drop("author", got, null, null);
  for (;;) {
    const { files, twinCall } = got;
    if (role === "second") {
      const t = twinProblem(o.partner!.files, files);
      if (t) {
        checks.push({ step: "twin", digest: digestOf(files), ok: false, detail: t, void: false });
        return drop("twin", t, files, null);
      }
    }
    const contrast = role === "first" ? twinCall! : role === "second" ? o.partner!.files.key.call : files.key.wrong_call!;
    const v = await checkBrief(id, files, { role, author: o.author, contrast, surface: surfaceOf(slot.anti_pattern), industry: slot.industry }, deps, checks);
    if (v.ok) return { ...base, status: "pass", step: null, reason: "passed", files, twin_call: twinCall, digest: digestOf(files), rewrites, record: v.record };
    if (!v.note || rewrites) return drop(v.step, v.reason, files, twinCall);
    rewrites = 1;
    for (const c of checks) c.void = true;
    const again = await write(rewritePrompt(prompt, briefText(files, fileNames(spec)), v.note), ref + ":rewrite");
    if (typeof again === "string") return drop("author", again, files, twinCall);
    got = again;
  }
}
