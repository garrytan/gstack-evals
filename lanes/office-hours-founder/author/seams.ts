// Copyright (c) 2026 Garry Tan. MIT License.
// The authoring area's dry-run seams (prereg start rule 7): each drives one frozen rule on one side of its edge through
// the area's real code, on invented fixtures with a scripted caller and labeller, so the lane's dry run prints PASS or
// FAIL per edge with no model call.
import type { CallRequest } from "../../product-value/meter.ts";
import type { Seam } from "../types.ts";
import { probe, type Deps } from "./checks.ts";
import { runConstructed, type Outcome } from "./constructed.ts";
import { schedule } from "./draws.ts";
import type { UnitFiles } from "./files.ts";
import { FIXTURE, FIXTURE_ASKS, REAL_FILES, REAL_PAGE, REAL_NOTES, blockReply, happy, stubCaller, wordLabeller } from "./fixtures.ts";
import { NAMED_TERMS, PROBE_REWRITE } from "./prompts.ts";
import { readNotes, runReal, termsGate, type Fetch, type Notes, type Page } from "./real.ts";
import { copyCheck, namesIn, screenVocabulary, vocabulary } from "./screens.ts";
import { projectSupply } from "./sets.ts";

type Route = (req: CallRequest) => string | null | undefined;
const screen = vocabulary(FIXTURE_ASKS);
const DRAW = schedule(2);

/** Deps over the fixture: happy answers unless over returns a string or null (a failed call). */
function deps(u: UnitFiles = FIXTURE, over: Route = () => undefined, label = wordLabeller(), real = false) {
  const route = happy(u, real);
  const call = stubCaller((req) => {
    const o = over(req);
    return o === undefined ? route(req) : o;
  });
  return { call, label, screen } satisfies Deps;
}
const withKey = (k: Partial<UnitFiles["key"]>): UnitFiles => ({ ...FIXTURE, key: { ...FIXTURE.key, ...k } });
const passed = (o: Outcome, step: string) => o.checks.some((c) => c.step === step && c.ok && !c.void);
const say = (ok: boolean, o: Outcome | string) => ({ ok, detail: typeof o === "string" ? o : o.status + (o.step ? " at " + o.step + ": " + o.reason : "") + ", rewrites " + o.rewrites });
const constructed = (d: ReturnType<typeof deps>, k = 0) => runConstructed(DRAW[k]!, d, { ceiling: false });

const NOTES = readNotes(REAL_NOTES) as Notes;
const PAGES: Page[] = [{ url: "https://fixture.invalid/story", date: "2026-11-12", status: 200, sha256: "", html: REAL_PAGE, text: REAL_PAGE, founder_account: true }];
const realDeps = (over: Route = () => undefined) => deps(REAL_FILES, over, wordLabeller(), true);
const siteFetch = (pages: Record<string, { status: number; text: string }>): Fetch => async (url) => pages[new URL(url).pathname] ?? { status: 404, text: "" };

export const seams: Seam[] = [
  {
    name: "author alternation: draw position 1 is written by Sol",
    run: async () => {
      const d = deps();
      await constructed(d, 0);
      return say(DRAW[0]!.author === "sol" && d.call.calls[0]!.model === "sol", "draw 1 author " + DRAW[0]!.author + ", first call to " + d.call.calls[0]!.model);
    },
  },
  {
    name: "author alternation: draw position 2 is written by Argon",
    run: async () => {
      const d = deps();
      await constructed(d, 1);
      return say(DRAW[1]!.author === "argon" && d.call.calls[0]!.model === "gemini", "draw 2 author " + DRAW[1]!.author + ", first call to " + d.call.calls[0]!.model);
    },
  },
  {
    name: "vocabulary screen: four shared words pass",
    run: () => {
      const r = screenVocabulary(screen, { opening: FIXTURE.opening + " Which neighbor would lend a hand?" });
      return say(r.pass, "hits: " + (r.hits.join("; ") || "none"));
    },
  },
  {
    name: "vocabulary screen: five shared words fail",
    run: () => {
      const r = screenVocabulary(screen, { opening: FIXTURE.opening + " Which neighbor would lend you a hand?" });
      return say(!r.pass, "hits: " + (r.hits.join("; ") || "none"));
    },
  },
  ...NAMED_TERMS.map((term): Seam => ({
    name: "vocabulary screen: the named term " + term + " fails",
    run: () => {
      const u = { sheet: { ...FIXTURE.sheet, facts: [{ ...FIXTURE.sheet.facts[0]!, text: "We talked about " + term.toUpperCase() + " last week." }] } };
      const r = screenVocabulary(screen, u);
      return say(!r.pass && r.files.includes("sheet.json"), "hits: " + (r.hits.join("; ") || "none"));
    },
  })),
  {
    name: "unanimous key: 3 of 3 credited on the open item, with the wedge mentioned, passes",
    run: async () => {
      const u = withKey({ mentioned: ["wedge"] });
      const o = await constructed(deps(u, (req) => (/:unanimous:/.test(req.label) ? blockReply("Sell an inventory app to " + u.key.customer + ".") : undefined)));
      return say(passed(o, "unanimous") && o.status === "pass", o);
    },
  },
  {
    name: "unanimous key: 2 of 3 credited drops the unit as not unanimous",
    run: async () => {
      const o = await constructed(deps(FIXTURE, undefined, wordLabeller((judge, id) => (judge === "astra" && id === "opus" ? { customer: false } : undefined))));
      return say(o.status === "drop" && o.reason === "not unanimous", o);
    },
  },
  {
    name: "give-away: no validator credited from the pitch passes",
    run: async () => {
      const o = await constructed(deps());
      return say(passed(o, "give-away"), o);
    },
  },
  {
    name: "give-away: one validator credited from the pitch drops the unit",
    run: async () => {
      const o = await constructed(deps(FIXTURE, (req) => (/:give-away:sol:/.test(req.label) ? blockReply("Sell software to " + FIXTURE.key.customer + ".") : undefined)));
      return say(o.status === "drop" && o.reason === "given away", o);
    },
  },
  {
    name: "copy check: five shared words pass",
    run: () => {
      const r = copyCheck({ opening: "The two route setters exported weekly." }, ["two route setters exported the hold inventory"], []);
      return say(r.pass, "hits: " + (r.hits.join("; ") || "none"));
    },
  },
  {
    name: "copy check: six shared words fail",
    run: () => {
      const r = copyCheck({ opening: "Then two route setters exported the hold weekly." }, ["two route setters exported the hold inventory"], []);
      return say(!r.pass, "hits: " + (r.hits.join("; ") || "none"));
    },
  },
  {
    name: "copy check: a word from the Names line fails",
    run: () => {
      const r = copyCheck({ opening: "We named our ledger after a river." }, [], NOTES.names);
      return say(!r.pass && r.hits.includes("ledger"), "hits: " + (r.hits.join("; ") || "none"));
    },
  },
  {
    name: "recognition probe, constructed: both judges name the same company, a hit",
    run: async () => {
      const r = await probe("c1", FIXTURE, null, deps(FIXTURE, (req) => (/:probe:sol:opening:judge:/.test(req.label) ? '{"matches": ["Acme Turf"]}' : undefined)));
      return say(r.hit, r.records.filter((x) => x.counted).length + " counted");
    },
  },
  {
    name: "recognition probe, constructed: one judge alone is a miss",
    run: async () => {
      const r = await probe("c1", FIXTURE, null, deps(FIXTURE, (req) => (/:probe:sol:opening:judge:opus/.test(req.label) ? '{"matches": ["Acme Turf"]}' : undefined)));
      return say(!r.hit, r.records.filter((x) => x.counted).length + " counted");
    },
  },
  {
    name: "recognition probe: Astra's counted guess prints and decides nothing",
    run: async () => {
      const r = await probe("c1", FIXTURE, null, deps(FIXTURE, (req) => (/:probe:astra:full:judge:/.test(req.label) ? '{"matches": ["Acme Turf"]}' : undefined)));
      return say(!r.hit && r.records.some((x) => x.model === "astra" && x.counted), "hit " + r.hit);
    },
  },
  {
    name: "recognition probe, real: a guess naming a Names-line entry is a hit",
    run: async () => {
      const r = await probe("r1", REAL_FILES, NOTES.names, realDeps((req) => (/:probe:particle:full:\d$/.test(req.label) ? "Perhaps fernwick labs." : undefined)));
      return say(r.hit && r.records.some((x) => x.by === "name"), "hit " + r.hit);
    },
  },
  {
    name: "recognition probe, real: both judges identify the source, a hit",
    run: async () => {
      const r = await probe("r1", REAL_FILES, NOTES.names, realDeps((req) => (/:probe:gemini:opening:judge:/.test(req.label) ? '{"identifies": true}' : undefined)));
      return say(r.hit && r.records.some((x) => x.by === "judges"), "hit " + r.hit);
    },
  },
  {
    name: "recognition probe, real: one judge alone is a miss",
    run: async () => {
      const r = await probe("r1", REAL_FILES, NOTES.names, realDeps((req) => (/:probe:gemini:opening:judge:astra/.test(req.label) ? '{"identifies": true}' : undefined)));
      return say(!r.hit, "hit " + r.hit);
    },
  },
  {
    name: "recognition probe: a first hit sends the unit back with the frozen line, a second hit drops it",
    run: async () => {
      const d = deps(FIXTURE, (req) => (/:probe:opus:opening:judge:/.test(req.label) ? '{"matches": ["Acme Turf"]}' : undefined));
      const o = await constructed(d);
      const line = PROBE_REWRITE.replace("<industry>", DRAW[0]!.industry);
      const sentBack = d.call.calls.some((c) => /:rewrite:/.test(c.label) && c.prompt.endsWith(line));
      return say(sentBack && o.status === "drop" && o.step === "probe" && o.rewrites === 1, o);
    },
  },
  {
    name: "name scan, real stratum: session text that names the source is caught",
    run: () => {
      const hits = namesIn("You could copy what FERNWICK LABS did early on.", NOTES.names);
      return say(hits.includes("Fernwick Labs"), "hits: " + (hits.join("; ") || "none"));
    },
  },
  {
    name: "name scan, real stratum: session text with no Names entry passes",
    run: () => {
      const hits = namesIn("Sell the stock list export to the kiln technician first.", NOTES.names);
      return say(hits.length === 0, "hits: " + (hits.join("; ") || "none"));
    },
  },
  {
    name: "terms gate: robots.txt allows and the terms allow, so the page is fetched",
    run: async () => {
      const g = await termsGate("https://fixture.invalid", ["https://fixture.invalid/story"], siteFetch({ "/robots.txt": { status: 200, text: "User-agent: *\nDisallow: /admin" }, "/terms": { status: 200, text: "<p>Be kind in the comments.</p>" } }), "2026-11-12");
      return say(g.fetch.length === 1, g.reason);
    },
  },
  {
    name: "terms gate: robots.txt allows but the terms forbid scraping, so the page is refused",
    run: async () => {
      const g = await termsGate("https://fixture.invalid", ["https://fixture.invalid/story"], siteFetch({ "/robots.txt": { status: 200, text: "User-agent: *\nAllow: /" }, "/terms": { status: 200, text: "<p>You may not scrape or crawl this site.</p>" } }), "2026-11-12");
      return say(g.pages[0]!.allowed && g.fetch.length === 0 && g.terms.kind === "automated reading", g.reason + "; clause: " + g.terms.clause);
    },
  },
  {
    name: "terms gate: a terms page that cannot be read counts as forbidding",
    run: async () => {
      const g = await termsGate("https://fixture.invalid", ["https://fixture.invalid/story"], siteFetch({ "/robots.txt": { status: 200, text: "User-agent: *\nAllow: /" }, "/terms": { status: 503, text: "" } }), "2026-11-12");
      return say(g.fetch.length === 0 && g.terms.kind === "unreadable", g.reason);
    },
  },
  {
    name: "real-history unit with 1 key fact left on its sheet drops at once",
    run: async () => {
      const o = await runReal("r1", 1, PAGES, realDeps((req) => (/:trace/.test(req.label) ? JSON.stringify({ t1: "pass", t2: "pass", t3: "pass", t4: "pass", t5: "pass", pointing: ["F2"], opening_date: "2014", first_sale_date: "2015", industry: "pottery studios" }) : undefined)));
      return say(o.status === "drop" && o.step === "key-facts" && o.rewrites === 0, o);
    },
  },
  {
    name: "real-history unit with 2 key facts left on its sheet goes on",
    run: async () => {
      const o = await runReal("r1", 1, PAGES, realDeps());
      return say(passed(o, "trace") && o.status === "pass", o);
    },
  },
  {
    name: "forced validator answer with no block: retried once, then the unit drops",
    run: async () => {
      const d = deps(FIXTURE, (req) => (/:unanimous:opus:/.test(req.label) ? "I need to know more first." : undefined));
      const o = await constructed(d);
      const tries = d.call.calls.filter((c) => /:unanimous:opus:/.test(c.label)).length;
      return say(o.status === "drop" && o.step === "unanimous" && tries === 2, o);
    },
  },
  {
    name: "forced validator answer with no block: a block on the retry keeps the unit",
    run: async () => {
      const d = deps(FIXTURE, (req) => (/:unanimous:opus:1$/.test(req.label) ? "I need to know more first." : undefined));
      const o = await constructed(d);
      const tokens = d.call.calls.filter((c) => /:unanimous:opus:/.test(c.label)).map((c) => c.maxTokens);
      return say(o.status === "pass" && tokens.length === 2 && tokens[1] === 2 * tokens[0]!, o);
    },
  },
  {
    name: "a rewrite voids every earlier check result and reruns them all",
    run: async () => {
      let first = true;
      const dirty = { ...FIXTURE, opening: FIXTURE.opening + " Which neighbor would lend you a hand?\n" };
      const o = await constructed(deps(FIXTURE, (req) => (/:author:/.test(req.label) && first ? ((first = false), happy(dirty)(req)) : undefined)));
      const old = o.checks.filter((c) => c.digest !== o.meta?.digest);
      return say(o.status === "pass" && o.rewrites === 1 && old.length > 0 && old.every((c) => c.void) && passed(o, "vocabulary") && passed(o, "type"), o);
    },
  },
  {
    name: "blind audit: an alternative that shares the key's customer fails",
    run: async () => {
      const d = deps(withKey({ alternative: { customer: FIXTURE.key.customer, wedge: "a quarterly council report generator" } }));
      const o = await constructed(d);
      const first = o.checks.find((c) => c.step === "audit");
      return say(o.status === "drop" && o.step === "audit" && !!first && !first.ok && /b/.test(first.detail), o);
    },
  },
  {
    name: "blind audit: an alternative with its own customer and wedge passes",
    run: async () => {
      const o = await constructed(deps());
      return say(passed(o, "audit"), o);
    },
  },
  {
    name: "mentioned flag: a key with both W items mentioned drops before any validator call",
    run: async () => {
      const d = deps(withKey({ mentioned: ["customer", "wedge"] }));
      const o = await constructed(d);
      return say(o.status === "drop" && o.step === "mentioned" && !d.call.calls.some((c) => /:unanimous:/.test(c.label)), o);
    },
  },
  {
    name: "mentioned flag: the mentioned customer and a generic wedge leave no primary item",
    run: async () => {
      const u = withKey({ mentioned: ["customer"] });
      const o = await constructed(deps(u, (req) => (/:unanimous:/.test(req.label) ? blockReply("Sell " + u.key.wedge + " first.") : undefined), wordLabeller((_, id) => (id === "row2" ? { wedge: true } : undefined))));
      return say(o.status === "drop" && o.step === "primary", o);
    },
  },
  {
    name: "mentioned flag: the mentioned customer leaves the wedge as the one primary item",
    run: async () => {
      const u = withKey({ mentioned: ["customer"] });
      const o = await constructed(deps(u, (req) => (/:unanimous:/.test(req.label) ? blockReply("Sell " + u.key.wedge + " first.") : undefined)));
      return say(o.status === "pass" && o.meta?.primary.join() === "wedge", o);
    },
  },
  {
    name: "pilot supply stop: a projection exactly at the cap goes on",
    run: () => {
      const p = projectSupply({ spent: 4, passing: 4, cap: 94, mdd: () => 0.1 });
      return say(p.fits, "projected " + p.projected + " against cap " + p.cap);
    },
  },
  {
    name: "pilot supply stop: a projection past the cap raises E_OF_SUPPLY_SHORT with the fillable count and its MDD",
    run: () => {
      try {
        projectSupply({ spent: 4, passing: 4, cap: 93, mdd: (n) => n / 1000 });
        return say(false, "no stop");
      } catch (e) {
        const m = (e as Error).message;
        return say(m.startsWith("E_OF_SUPPLY_SHORT") && m.includes("63 comparison units") && m.includes("MDD 0.063"), m);
      }
    },
  },
];
