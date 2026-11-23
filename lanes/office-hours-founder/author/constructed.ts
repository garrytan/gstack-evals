// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's constructed units (prereg section 3): one draw position through the author call and
// steps 2 to 6, and a calibration unit's second skin for the twin check. The order of checks, each bound to the digest
// of the unit's current files:
//   mentioned (a unit whose key marks both W items mentioned has no primary item and drops before any check is paid),
//   vocabulary screen, unanimous key, give-away, blind audit, recognition probe, generic screen, the primary rule
//   (at least one W item neither mentioned nor generic) and the type labels.
// A failure at the vocabulary screen or the audit sends the unit back to its author with a fixed note naming the failed
// checks, and a recognition hit sends it back with the frozen probe line; every other failure drops it at once. A unit
// gets at most one rewrite in all: the rewrite voids every earlier result and the unit reruns every check in order.
// A second skin passes the same checks with no rewrite; one that fails leaves its pair out of the twin check.
import type { AuthorFamily, UnitMeta } from "../types.ts";
import { audit, genericScreen, notGivenAway, probe, typeLabels, unanimous, validate, ask, type Deps } from "./checks.ts";
import { modelOf, otherFamily, type Draw } from "./draws.ts";
import { digestOf, unitFrom, type UnitFiles } from "./files.ts";
import { AUDIT_CHECKS, INDUSTRIES, PROBE_REWRITE, REWRITE_NOTE, authorPrompt, rewritePrompt, twinPrompt, unitText } from "./prompts.ts";
import { screenVocabulary } from "./screens.ts";

export interface CheckEntry {
  step: string;
  digest: string;
  ok: boolean;
  detail: string;
  /** True once a rewrite replaced the files this result read. */
  void: boolean;
}

export interface Outcome {
  id: string;
  status: "pass" | "drop";
  /** The step that dropped the unit, or null when it passed. */
  step: string | null;
  reason: string;
  files: UnitFiles | null;
  /** Every UnitMeta field but the set, which the set fill assigns. */
  meta: Omit<UnitMeta, "set"> | null;
  /** What the checks recorded, written into key.json beside the author's items. */
  record: Record<string, unknown>;
  checks: CheckEntry[];
  rewrites: number;
}

/** A failed check: drop at once (note null) or go back to the writer with the note. */
type Verdict = { ok: true; meta: Pick<UnitMeta, "type" | "founder_stage" | "primary" | "mentioned" | "generic" | "digest">; record: Record<string, unknown> } | { ok: false; step: string; reason: string; note: string | null };

/** Runs steps 2 to 6 on a constructed unit's current files, logging each result against their digest. */
export async function checkConstructed(id: string, u: UnitFiles, author: AuthorFamily, industry: string, deps: Deps, log: CheckEntry[]): Promise<Verdict> {
  const digest = digestOf(u);
  const entry = (step: string, ok: boolean, detail: string) => log.push({ step, digest, ok, detail, void: false });
  const fail = (step: string, reason: string, note: string | null): Verdict => (entry(step, false, reason), { ok: false, step, reason, note });

  if (u.key.mentioned.length === 2) return fail("mentioned", "the key marks both W items mentioned, so no primary item can remain", null);
  const vocab = screenVocabulary(deps.screen, u);
  if (!vocab.pass) return fail("vocabulary", "barred words: " + vocab.hits.join("; "), REWRITE_NOTE + "\n- vocabulary screen: these word sequences or terms may not appear: " + vocab.hits.join("; "));
  entry("vocabulary", true, "no barred sequence or term");

  const full = await validate(id, u, "unanimous", deps);
  if (Object.values(full).includes(null)) return fail("unanimous", "a validator gave no block or an unlabelled W cell after one retry", null);
  if (!unanimous(u, full)) return fail("unanimous", "not unanimous", null);
  entry("unanimous", true, "all three credited on every open W item");
  const pitch = await validate(id, u, "give-away", deps);
  if (Object.values(pitch).includes(null)) return fail("give-away", "a validator gave no block or an unlabelled W cell after one retry", null);
  if (!notGivenAway(u, pitch)) return fail("give-away", "given away", null);
  entry("give-away", true, "no validator credited from the pitch alone");

  const a = await audit(id, u, author, deps);
  if (a.failed.length) return fail("audit", "failed checks " + a.failed.join(", "), REWRITE_NOTE + a.failed.map((k) => "\n- (" + k + ") " + AUDIT_CHECKS[k]).join(""));
  entry("audit", true, "both auditors pass (a) to (e)");

  const p = await probe(id, u, null, deps);
  if (p.hit) return fail("probe", "a model under test or the simulator named a matching company", PROBE_REWRITE.replace("<industry>", industry));
  entry("probe", true, "no counted guess");

  const g = await genericScreen(id, u, deps);
  const primary = (["customer", "wedge"] as const).filter((i) => !u.key.mentioned.includes(i) && !g.generic.includes(i));
  entry("generic", true, "generic: " + (g.generic.join(", ") || "none") + "; unlabelled cells: " + g.unlabelled);
  if (!primary.length) return fail("primary", "no W item is left primary after the mentioned flag and the generic screen", null);

  const t = await typeLabels(id, u, deps);
  if (!t.type) return fail("type", "no type label after Argon's settling call", null);
  entry("type", true, t.type);
  return {
    ok: true,
    meta: { type: t.type, founder_stage: t.stage, primary, mentioned: u.key.mentioned, generic: g.generic, digest },
    record: { validators: { unanimous: full, give_away: pitch }, audit: a.by, probe: p.records, generic_unlabelled: g.unlabelled, type_votes: t.votes },
  };
}

/** One writer call whose reply must hold all three files in shape. */
const write = (deps: Deps, family: AuthorFamily, prompt: string, label: string) =>
  ask(deps.call, { model: modelOf(family), prompt, maxTokens: 16000, effort: "high", label }, (t) => {
    const u = unitFrom(t, { constructed: true });
    return typeof u === "string" ? u : (u as UnitFiles);
  });

/** One draw position, end to end. The CEILING variant writes under the harder prompt, with ids that start with h. */
export async function runConstructed(draw: Draw, deps: Deps, o: { ceiling: boolean }): Promise<Outcome> {
  const id = (o.ceiling ? "h" : "c") + draw.draw;
  const prompt = authorPrompt(draw.shape, draw.type, draw.industry, o.ceiling);
  const checks: CheckEntry[] = [];
  let rewrites = 0;
  const drop = (step: string, reason: string, files: UnitFiles | null): Outcome => ({ id, status: "drop", step, reason, files, meta: null, record: {}, checks, rewrites });
  let u = await write(deps, draw.author, prompt, id + ":author");
  if (typeof u === "string") return drop("author", u, null);
  for (;;) {
    const v = await checkConstructed(id, u, draw.author, draw.industry, deps, checks);
    if (v.ok) return { id, status: "pass", step: null, reason: "passed", files: u, meta: { id, stratum: "constructed", draw: draw.draw, author: draw.author, shape: draw.shape, industry: draw.industry, ...v.meta }, record: v.record, checks, rewrites };
    if (!v.note || rewrites) return drop(v.step, v.reason, u);
    rewrites = 1;
    for (const c of checks) c.void = true;
    const again = await write(deps, draw.author, rewritePrompt(prompt, unitText(u.opening, u.sheet, u.key), v.note), id + ":rewrite");
    if (typeof again === "string") return drop("author", again, u);
    u = again;
  }
}

/** The next industry in the frozen order, after the first skin's. */
export const nextIndustry = (industry: string): string => INDUSTRIES[(INDUSTRIES.indexOf(industry) + 1) % INDUSTRIES.length]!;

/**
 * A calibration unit's second skin: the author family that did not write it translates the three files into the next
 * industry with the twin note. The skin must keep the first skin's fact ids and key facts, then pass steps 2 to 6 with no
 * rewrite.
 */
export async function runTwin(first: Outcome, deps: Deps): Promise<Outcome> {
  const m = first.meta!, f = first.files!;
  const id = first.id + "t";
  const family = otherFamily(m.author);
  const industry = nextIndustry(m.industry);
  const checks: CheckEntry[] = [];
  const drop = (step: string, reason: string, files: UnitFiles | null): Outcome => ({ id, status: "drop", step, reason, files, meta: null, record: {}, checks, rewrites: 0 });
  const u = await write(deps, family, twinPrompt(industry, f.opening, f.sheet, f.key), id + ":twin");
  if (typeof u === "string") return drop("author", u, null);
  const ids = (s: UnitFiles) => s.sheet.facts.map((x) => x.id).sort().join(" ");
  if (ids(u) !== ids(f) || [...u.key.key_facts].sort().join(" ") !== [...f.key.key_facts].sort().join(" ")) return drop("twin", "the second skin changed the fact ids or the key facts", u);
  const v = await checkConstructed(id, u, family, industry, deps, checks);
  if (!v.ok) return drop(v.step, v.reason, u);
  return { id, status: "pass", step: null, reason: "passed", files: u, meta: { id, stratum: "constructed", draw: m.draw, author: family, shape: m.shape, industry, twin_of: first.id, ...v.meta }, record: v.record, checks, rewrites: 0 };
}
