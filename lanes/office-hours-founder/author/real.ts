// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's real-history stratum (prereg section 3, "Real histories", and section 15), descriptive
// and never pooled into the primary:
// - frame: the 40 frozen queries through one injected search function, the first 10 results each, with the left-out
//   hosts dropped; the remaining results are grouped by site, and one site is one source.
// - termsGate: robots.txt and the site's terms page as two separate checks, before any page fetch. A page is fetched only
//   when robots.txt allows its path and the terms hold no clause that forbids automated reading, keeping a copy or
//   sending text to an outside model; a terms page that cannot be read counts as forbidding. Each decision is logged with
//   its date and the clause or rule it matched.
// - mineSource: the keyless miner, one request at a time through a serial fetch, at most 3 pages a source, each page's
//   URL, retrieval date and sha256 recorded. Pages are read as text with scripts and styles cut out; nothing fetched runs.
//   A page enters the frame only when Sol answers that it is a first-person account by a founder on the company's own
//   site or a founder's personal site.
// - runReal: the source notes (Sol), T1 (Sol or Argon by the source's draw position) and T2 (the other), then the copy
//   check, traceability (Opus; fewer than 2 key facts left on the sheet drops at once), the audit with the foreseeable
//   rating (Opus and the family that did not write T1), the vocabulary screen, the recognition probe, the generic screen,
//   the primary rule and the type labels. A failure at the copy check, traceability, the audit or the vocabulary screen
//   is rewritten once from T1, or from T2 when only the key failed; a recognition hit goes back to T1 with the frozen line.
// - the fame tercile from Wikipedia's pageviews and each model's stated cutoff, from the product-value eval's cutoffs.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEED } from "../frozen.ts";
import type { AuthorFamily, UnitMeta } from "../types.ts";
import { ask, genericScreen, probe, typeLabels, type Deps } from "./checks.ts";
import type { CheckEntry, Outcome } from "./constructed.ts";
import { authorOf, modelOf, otherFamily } from "./draws.ts";
import { AuthorError, digestOf, jsonObject, keyJson, sha256, unitFrom, type UnitFiles } from "./files.ts";
import {
  KEY_REAL_AUDIT_CHECKS, KEY_TRACE_CHECKS, NOTES_PROMPT, PAGES_PER_SOURCE, PROBE_REWRITE, QUERIES, REAL_AUDIT_CHECKS, RESULTS_PER_QUERY, REWRITE_NOTE, T1_PROMPT, T2_PROMPT, TRACE_CHECKS, EXCLUDED_HOSTS,
  fence, founderPagePrompt, realAuditPrompt, rewritePrompt, tracePrompt, unitText, type RealAuditCheck, type TraceCheck,
} from "./prompts.ts";
import { copyCheck, screenVocabulary } from "./screens.ts";

export type Fetch = (url: string) => Promise<{ status: number; text: string }>;
export type Search = (query: string) => Promise<{ url: string }[]>;

/** The agent token the gate reads robots.txt groups for. */
export const AGENT = "gstack-evals";
/** Where the gate looks for a site's terms, in order. */
export const TERMS_PATHS = ["/terms", "/terms-of-service", "/terms-of-use", "/tos", "/legal/terms", "/legal"];

/** One request at a time: every call waits for the one before it to settle. */
export function serial(fetch: Fetch): Fetch {
  let tail: Promise<unknown> = Promise.resolve();
  return (url) => {
    const next = tail.then(() => fetch(url), () => fetch(url));
    tail = next.catch(() => undefined);
    return next;
  };
}

/** A page's readable text: scripts, styles and tags removed, common entities decoded, whitespace collapsed. */
export const htmlToText = (html: string): string =>
  html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/\s+/g, " ").trim();

export const hostOf = (url: string): string => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
export const excluded = (url: string): boolean => EXCLUDED_HOSTS.some((h) => hostOf(url) === h || hostOf(url).endsWith("." + h));

/** The frame's raw results and its candidate sources: each site's result URLs, deduplicated, in query and rank order. */
export async function frame(search: Search): Promise<{ results: { query: string; urls: string[] }[]; sources: Map<string, string[]> }> {
  const results: { query: string; urls: string[] }[] = [];
  const sources = new Map<string, string[]>();
  for (const query of QUERIES) {
    const urls = (await search(query)).slice(0, RESULTS_PER_QUERY).map((r) => r.url);
    results.push({ query, urls });
    for (const url of urls) {
      if (!/^https?:/i.test(url) || excluded(url)) continue;
      const origin = new URL(url).origin;
      const list = sources.get(origin) ?? [];
      if (!list.includes(url)) list.push(url);
      sources.set(origin, list);
    }
  }
  return { results, sources };
}

/** The rules of the robots.txt group for our agent, or of the * group when none names it. */
export function robotsRules(text: string, agent: string): { allow: boolean; path: string }[] {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let open = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, "").trim());
    if (!m) continue;
    const field = m[1]!.toLowerCase(), value = m[2]!.trim();
    if (field === "user-agent") {
      if (!open) groups.push({ agents: [], rules: [] });
      groups.at(-1)!.agents.push(value.toLowerCase());
      open = true;
      continue;
    }
    open = false;
    if (groups.length && (field === "allow" || field === "disallow") && value) groups.at(-1)!.rules.push({ allow: field === "allow", path: value });
  }
  const own = groups.filter((g) => g.agents.includes(agent.toLowerCase()));
  return (own.length ? own : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
}

/** The longest matching rule decides, and Allow wins a tie; * and a closing $ work as in robots.txt. */
export function robotsAllows(rules: readonly { allow: boolean; path: string }[], path: string): { allowed: boolean; rule: string } {
  let best: { allow: boolean; path: string } | null = null;
  for (const r of rules) {
    const re = new RegExp("^" + r.path.replace(/[.+?^\${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? { allowed: best.allow, rule: (best.allow ? "Allow: " : "Disallow: ") + best.path } : { allowed: true, rule: "no rule matches" };
}

const PROHIBIT = /\b(not|never|prohibit\w*|forbid\w*|restrict\w*|without (?:our |the )?(?:prior |express )?(?:written )?(?:permission|consent|authori[sz]ation))\b/i;
/** The kinds of use a terms clause may forbid, each with the words that name it. */
export const TERMS_TARGETS: readonly (readonly [string, RegExp])[] = [
  ["automated reading", /\b(scrap\w*|crawl\w*|spider\w*|robots?|bots?|automated|data[- ]mining|harvest\w*|systematic\w*)\b/i],
  ["keeping a copy", /\b(cop(?:y|ies|ying)|reproduc\w*|download\w*|stor(?:e|ing|age)|archiv\w*|retain\w*)\b/i],
  ["sending text to an outside model", /\b(artificial intelligence|machine[- ]learning|large language models?|LLMs?|AI|generative|train(?:ing)? (?:a |any )?(?:models?|algorithms?|systems?))\b/i],
];

/** The first sentence of the terms that forbids one of the target uses: a prohibition word and a target word together. */
export function forbiddingClause(terms: string): { kind: string; clause: string } | null {
  for (const s of terms.split(/(?<=[.!?;])\s+|\n+/)) {
    if (!PROHIBIT.test(s)) continue;
    const hit = TERMS_TARGETS.find(([, re]) => re.test(s));
    if (hit) return { kind: hit[0], clause: s.trim() };
  }
  return null;
}

export interface GateDecision {
  origin: string;
  date: string;
  robots: { status: number; rules: number };
  pages: { url: string; allowed: boolean; rule: string }[];
  terms: { url: string | null; status: number | null; kind: string | null; clause: string | null };
  /** The page URLs the miner may fetch. */
  fetch: string[];
  reason: string;
}

/**
 * The two-check terms gate for one site, before any page fetch. robots.txt: a 404 or 410 allows every path, any other
 * failure allows none. Terms: the first of TERMS_PATHS that answers 200 with text; none counts as forbidding.
 */
export async function termsGate(origin: string, urls: readonly string[], fetch: Fetch, date: string): Promise<GateDecision> {
  const robots = await fetch(origin + "/robots.txt");
  const rules = robots.status === 200 ? robotsRules(robots.text, AGENT) : [];
  const pages = urls.map((url) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (robots.status === 200) return { url, ...robotsAllows(rules, path) };
    return robots.status === 404 || robots.status === 410 ? { url, allowed: true, rule: "no robots.txt" } : { url, allowed: false, rule: "robots.txt unreadable, status " + robots.status };
  });
  const base = { origin, date, robots: { status: robots.status, rules: rules.length }, pages };
  let status: number | null = null;
  for (const p of TERMS_PATHS) {
    const res = await fetch(origin + p);
    status = res.status;
    const text = res.status === 200 ? htmlToText(res.text) : "";
    if (!text) continue;
    const f = forbiddingClause(text);
    if (f) return { ...base, terms: { url: origin + p, status, ...f }, fetch: [], reason: "the terms forbid " + f.kind };
    const allowed = pages.filter((x) => x.allowed).map((x) => x.url);
    return { ...base, terms: { url: origin + p, status, kind: null, clause: null }, fetch: allowed, reason: allowed.length ? "robots.txt allows and the terms forbid nothing" : "robots.txt disallows every page" };
  }
  return { ...base, terms: { url: null, status, kind: "unreadable", clause: null }, fetch: [], reason: "no terms page could be read, which counts as forbidding" };
}

export interface Page {
  url: string;
  date: string;
  status: number;
  sha256: string;
  html: string;
  text: string;
  founder_account: boolean;
}

/** Gates and mines one source: at most 3 pages, each tested as a founder's first-person account. */
export async function mineSource(origin: string, urls: readonly string[], fetch: Fetch, call: Deps["call"], date: string, id: string): Promise<{ gate: GateDecision; pages: Page[] }> {
  const gate = await termsGate(origin, urls.slice(0, PAGES_PER_SOURCE), fetch, date);
  const pages: Page[] = [];
  for (const url of gate.fetch) {
    const res = await fetch(url);
    const text = htmlToText(res.text);
    const verdict = res.status === 200 && text
      ? await ask(call, { model: "sol", prompt: founderPagePrompt(url, text), maxTokens: 1000, effort: null, label: id + ":founder:" + pages.length }, (t) => {
          const o = jsonObject(t);
          return typeof o?.founder_account === "boolean" ? { yes: o.founder_account } : "no founder_account field";
        })
      : null;
    pages.push({ url, date, status: res.status, sha256: sha256(res.text), html: res.text, text, founder_account: typeof verdict === "object" && !!verdict?.yes });
  }
  return { gate, pages };
}

export type Notes = { a: string; b: string; names: string[] };

/** The source-note writer's reply: INELIGIBLE with its reason, or Note A, Note B and the Names line split into entries. */
export function readNotes(text: string): { ineligible: string } | Notes | string {
  const t = text.trim();
  if (/^\W*INELIGIBLE\b/.test(t)) return { ineligible: t.replace(/^\W*INELIGIBLE\W*/, "").trim() };
  const lines = t.split("\n");
  const ia = lines.findIndex((l) => /^\W*note a\b/i.test(l)), ib = lines.findIndex((l) => /^\W*note b\b/i.test(l));
  const iNames = lines.findLastIndex((l) => /^\W*names\b/i.test(l));
  if (ia < 0 || ib <= ia || iNames <= ib) return "the notes lack Note A, Note B or a Names line after them";
  const names = [lines[iNames]!.replace(/^\W*names\W*/i, ""), ...lines.slice(iNames + 1)].join(",").split(/[,;]|\s(?:and|&)\s/).map((x) => x.replace(/[*_]/g, "").trim()).filter(Boolean);
  if (!names.length) return "the Names line is empty";
  return { a: lines.slice(ia + 1, ib).join("\n").trim(), b: lines.slice(ib + 1, iNames).join("\n").trim(), names };
}

type Verdict =
  | { ok: true; meta: Pick<UnitMeta, "type" | "founder_stage" | "primary" | "mentioned" | "generic" | "digest" | "industry" | "source_dates">; record: Record<string, unknown> }
  | { ok: false; step: string; reason: string; note: string | null; from: "t1" | "t2" };

type Trace = { failed: TraceCheck[]; pointing: string[]; opening_date: string; first_sale_date: string; industry: string };
type Rated = { failed: RealAuditCheck[]; foreseeable: Record<"customer" | "wedge", string> | null };

/** Steps 5 to 8 on a real-history unit's current files, logged against their digest. */
export async function checkReal(id: string, u: UnitFiles, notes: Notes, pages: readonly string[], t1: AuthorFamily, deps: Deps, log: CheckEntry[]): Promise<Verdict> {
  const digest = digestOf(u);
  const entry = (step: string, ok: boolean, detail: string) => log.push({ step, digest, ok, detail, void: false });
  const fail = (step: string, reason: string, note: string | null, from: "t1" | "t2"): Verdict => (entry(step, false, reason), { ok: false, step, reason, note, from });
  const fromOf = (keyOnly: boolean) => (keyOnly ? "t2" : "t1");

  if (u.key.mentioned.length === 2) return fail("mentioned", "the key marks both W items mentioned, so no primary item can remain", null, "t1");
  const copy = copyCheck(u, [...pages, notes.a, notes.b], notes.names);
  if (!copy.pass) return fail("copy", copy.hits.length + " copied words or sequences", REWRITE_NOTE + "\n- copy check: these words or word sequences come from the source and may not appear: " + copy.hits.join("; "), fromOf(copy.files.every((f) => f === "key.json")));
  entry("copy", true, "no shared 6-word sequence and no Names word");

  const traceChecks = Object.keys(TRACE_CHECKS) as TraceCheck[];
  const tr = await ask<Trace>(deps.call, { model: "opus", prompt: tracePrompt(notes.a, notes.b, unitText(u.opening, u.sheet, u.key)), maxTokens: 8000, effort: "high", label: id + ":trace" }, (t) => {
    const o = jsonObject(t);
    if (!o || !traceChecks.every((k) => o[k] === "pass" || o[k] === "fail") || !Array.isArray(o.pointing)) return "the trace reply lacks a pass or fail on every check, or the pointing list";
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return { failed: traceChecks.filter((k) => o[k] === "fail"), pointing: o.pointing.filter((p): p is string => typeof p === "string"), opening_date: s(o.opening_date), first_sale_date: s(o.first_sale_date), industry: s(o.industry) };
  });
  if (typeof tr === "string") return fail("trace", "traceability unreadable after one retry", REWRITE_NOTE + traceChecks.map((k) => "\n- " + TRACE_CHECKS[k]).join(""), "t1");
  const onSheet = new Set(u.sheet.facts.map((f) => f.id));
  const left = u.key.key_facts.filter((k) => onSheet.has(k) && tr.pointing.includes(k)).length;
  if (left < 2) return fail("key-facts", left + " key facts left on the sheet", null, "t1");
  if (tr.failed.length) return fail("trace", "failed " + tr.failed.join(", "), REWRITE_NOTE + tr.failed.map((k) => "\n- " + TRACE_CHECKS[k]).join(""), fromOf(tr.failed.every((k) => KEY_TRACE_CHECKS.includes(k))));
  entry("trace", true, left + " key facts left on the sheet");

  const auditChecks = Object.keys(REAL_AUDIT_CHECKS) as RealAuditCheck[];
  const auditors = ["opus", modelOf(otherFamily(t1))] as const;
  const rated = await Promise.all(auditors.map((m) => ask<Rated>(deps.call, { model: m, prompt: realAuditPrompt(unitText(u.opening, u.sheet, u.key)), maxTokens: 8000, effort: "high", label: id + ":audit:" + m }, (t) => {
    const o = jsonObject(t);
    const f = o?.foreseeable as Record<string, unknown> | undefined;
    const ok = (v: unknown) => v === "yes" || v === "maybe" || v === "no";
    if (!o || !auditChecks.every((k) => o[k] === "pass" || o[k] === "fail") || !f || !ok(f.customer) || !ok(f.wedge)) return "the audit reply lacks a pass or fail on every check, or the foreseeable rating";
    return { failed: auditChecks.filter((k) => o[k] === "fail"), foreseeable: { customer: f.customer as string, wedge: f.wedge as string } };
  })));
  const by: Rated[] = rated.map((r) => (typeof r === "string" ? { failed: auditChecks, foreseeable: null } : r));
  const record: Record<string, unknown> = { trace: tr, audit: Object.fromEntries(auditors.map((m, k) => [m, by[k]])) };
  if (by.every((r) => r.foreseeable?.customer === "no" && r.foreseeable.wedge === "no")) return fail("foreseeable", "both auditors rate every W item unforeseeable", null, "t1");
  const failed = auditChecks.filter((c) => by.some((r) => r.failed.includes(c)));
  if (failed.length) return fail("audit", "failed " + failed.join(", "), REWRITE_NOTE + failed.map((k) => "\n- " + REAL_AUDIT_CHECKS[k]).join(""), fromOf(failed.every((k) => KEY_REAL_AUDIT_CHECKS.includes(k))));
  entry("audit", true, "both auditors pass");

  const vocab = screenVocabulary(deps.screen, u);
  if (!vocab.pass) return fail("vocabulary", "barred words: " + vocab.hits.join("; "), REWRITE_NOTE + "\n- vocabulary screen: these word sequences or terms may not appear: " + vocab.hits.join("; "), fromOf(vocab.files.every((f) => f === "key.json")));
  entry("vocabulary", true, "no barred sequence or term");

  const industry = tr.industry || "unknown";
  const p = await probe(id, u, notes.names, deps);
  if (p.hit) return fail("probe", "a model under test or the simulator identified the source", PROBE_REWRITE.replace("<industry>", industry), "t1");
  entry("probe", true, "no counted guess");

  const g = await genericScreen(id, u, deps);
  const primary = (["customer", "wedge"] as const).filter((i) => !u.key.mentioned.includes(i) && !g.generic.includes(i));
  entry("generic", true, "generic: " + (g.generic.join(", ") || "none") + "; unlabelled cells: " + g.unlabelled);
  if (!primary.length) return fail("primary", "no W item is left primary after the mentioned flag and the generic screen", null, "t1");

  const t = await typeLabels(id, u, deps);
  if (!t.type) return fail("type", "no type label after Argon's settling call", null, "t1");
  entry("type", true, t.type);
  return {
    ok: true,
    meta: { type: t.type, founder_stage: t.stage, primary, mentioned: u.key.mentioned, generic: g.generic, digest, industry, source_dates: { opening: tr.opening_date, first_sale: tr.first_sale_date } },
    record: { ...record, probe: p.records, generic_unlabelled: g.unlabelled, type_votes: t.votes },
  };
}

export type RealOutcome = Outcome & { notes: Notes | null };

/** One real source from its founder pages to a passing unit or a drop. */
export async function runReal(id: string, draw: number, pages: readonly Page[], deps: Deps): Promise<RealOutcome> {
  const t1 = authorOf(draw), t2 = otherFamily(t1);
  const checks: CheckEntry[] = [];
  let rewrites = 0;
  let notes: Notes | null = null;
  const drop = (step: string, reason: string, files: UnitFiles | null): RealOutcome => ({ id, status: "drop", step, reason, files, meta: null, record: {}, checks, rewrites, notes });
  const n = await ask(deps.call, { model: "sol", prompt: NOTES_PROMPT + "\n\n" + pages.map((p) => fence(p.url, p.text)).join("\n\n"), maxTokens: 16000, effort: "high", label: id + ":notes" }, readNotes);
  if (typeof n === "string") return drop("notes", n, null);
  if ("ineligible" in n) return drop("ineligible", n.ineligible || "ineligible", null);
  notes = n;
  const t1Prompt = T1_PROMPT + "\n\n" + fence("Note A", n.a);
  const t2Prompt = (u: Partial<UnitFiles>) => T2_PROMPT + "\n\n" + fence("Note B", n.b) + "\n\n" + unitText(u.opening!, u.sheet!);
  const writeT2 = (base: Partial<UnitFiles>, prompt: string, label: string) => ask(deps.call, { model: modelOf(t2), prompt, maxTokens: 8000, effort: "high", label }, (t) => {
    const u = unitFrom(t, { constructed: false, names: ["key.json"], base });
    return typeof u === "string" ? u : (u as UnitFiles);
  });
  const fromT1 = async (prompt: string, label: string): Promise<UnitFiles | string> => {
    const s = await ask(deps.call, { model: modelOf(t1), prompt, maxTokens: 16000, effort: "high", label: label + ":t1" }, (t) => unitFrom(t, { constructed: false, names: ["opening.md", "sheet.json"] }));
    return typeof s === "string" ? s : writeT2(s, t2Prompt(s), label + ":t2");
  };
  const first = await fromT1(t1Prompt, id);
  if (typeof first === "string") return drop("writer", first, null);
  let u: UnitFiles = first;
  for (;;) {
    const v = await checkReal(id, u, n, pages.map((p) => p.text), t1, deps, checks);
    if (v.ok) return { id, status: "pass", step: null, reason: "passed", files: u, meta: { id, stratum: "real", draw, author: t1, shape: null, ...v.meta }, record: v.record, checks, rewrites, notes };
    if (!v.note || rewrites) return drop(v.step, v.reason, u);
    rewrites = 1;
    for (const c of checks) c.void = true;
    const again: UnitFiles | string = v.from === "t2" ? await writeT2(u, rewritePrompt(t2Prompt(u), fence("key.json", keyJson(u.key).trim()), v.note), id + ":rewrite:t2") : await fromT1(rewritePrompt(t1Prompt, unitText(u.opening, u.sheet), v.note), id + ":rewrite");
    if (typeof again === "string") return drop("writer", again, u);
    u = again;
  }
}

/** Wikipedia pageviews for the source company's article over 2025-10-01 to 2026-09-30, or null when it has no article. */
export async function pageviews(company: string, fetch: Fetch): Promise<number | null> {
  const url = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/" + encodeURIComponent(company.trim().replace(/ /g, "_")) + "/monthly/20251001/20260930";
  const res = await fetch(url);
  if (res.status === 404) return null;
  const items = res.status === 200 ? jsonObject(res.text)?.items : undefined;
  if (!Array.isArray(items)) throw new AuthorError("E_USAGE", "the pageviews API answered " + res.status + " for a source company; rerun the fame step");
  return items.reduce((s: number, i: { views?: unknown }) => s + (typeof i.views === "number" ? i.views : 0), 0);
}

/** Fame terciles by rank over every passing real unit: units with no article rank lowest and always take tercile 1. */
export function terciles(views: readonly { id: string; views: number | null }[]): Map<string, 1 | 2 | 3> {
  const ranked = [...views].sort((a, b) => (a.views ?? -1) - (b.views ?? -1));
  return new Map(ranked.map((v, k) => [v.id, v.views === null ? 1 : ((1 + Math.floor((3 * k) / ranked.length)) as 1 | 2 | 3)]));
}

export const CUTOFFS_PATH = join(import.meta.dir, "..", "..", "product-value", "cutoffs.json");

/** Each model's stated cutoff (the product-value eval's cutoffs.json) against a source's first sale; a year alone reads as its December. */
export function cutoffMarks(firstSale: string, file = CUTOFFS_PATH): Record<string, "predates" | "after" | "unknown"> {
  const models = (JSON.parse(readFileSync(file, "utf8")) as { models: Record<string, { cutoff: string | null }> }).models;
  const d = /\b((?:19|20)\d{2})(?:-(\d{2}))?/.exec(firstSale);
  return Object.fromEntries(Object.entries(models).map(([m, v]) => [m, !d || !v.cutoff ? "unknown" : d[1] + "-" + (d[2] ?? "12") <= v.cutoff.slice(0, 7) ? "predates" : "after"]));
}

export interface RealRun {
  results: { query: string; urls: string[] }[];
  gates: GateDecision[];
  sources: { id: string; origin: string; draw: number; pages: Page[] }[];
  outcomes: RealOutcome[];
  fame: Record<string, { views: number | null; tercile: 1 | 2 | 3 }>;
  cutoffs: Record<string, Record<string, string>>;
}

/** The whole stratum: the frame, then each site in seeded order (sha256 of the seed and its origin), then fame and cutoffs. */
export async function authorReal(deps: Deps & { search: Search; fetch: Fetch; today: string }): Promise<RealRun> {
  const fetch = serial(deps.fetch);
  const fr = await frame(deps.search);
  const origins = [...fr.sources.keys()].sort((a, b) => (sha256(SEED + "\n" + a) < sha256(SEED + "\n" + b) ? -1 : 1));
  const run: RealRun = { results: fr.results, gates: [], sources: [], outcomes: [], fame: {}, cutoffs: {} };
  for (const [k, origin] of origins.entries()) {
    const id = "r" + (k + 1);
    const mined = await mineSource(origin, fr.sources.get(origin)!, fetch, deps.call, deps.today, id);
    run.gates.push(mined.gate);
    run.sources.push({ id, origin, draw: k + 1, pages: mined.pages });
    const founder = mined.pages.filter((p) => p.founder_account);
    if (founder.length) run.outcomes.push(await runReal(id, k + 1, founder, deps));
  }
  const passed = run.outcomes.filter((o) => o.status === "pass");
  const views: { id: string; views: number | null }[] = [];
  for (const o of passed) views.push({ id: o.id, views: await pageviews(o.notes!.names[0]!, fetch) });
  const t = terciles(views);
  for (const o of passed) {
    o.meta!.fame_tercile = t.get(o.id)!;
    run.fame[o.id] = { views: views.find((v) => v.id === o.id)!.views, tercile: t.get(o.id)! };
    run.cutoffs[o.id] = cutoffMarks(o.meta!.source_dates!.first_sale);
  }
  return run;
}
