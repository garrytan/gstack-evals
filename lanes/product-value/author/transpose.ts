// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals pv transpose (prereg section 4, transposed units): a transposed unit invents the product, never the
// outcome. Every key item maps one to one to a real event in a source history.
//   pv transpose scan    --work <dir> --item pv-auth-inspiration        rank the owner's thread titles for histories
//                                                                       where a plan is followed by what happened
//   pv transpose assess  --work <dir> --item pv-auth-inspiration --ids  read each fetched source in custody: is it a
//                                                                       usable history, and if so its plan, the product
//                                                                       before it and its aftermath events
//   pv transpose assess-multi --work <dir> --item pv-auth-inspiration --ids   the same for a long owner-seat
//                                                                       conversation that can hold several histories
//   pv transpose author  --work <dir> --item <authoring item> --ids <src:type,...>   summaries (the sealed summary
//                         prompt; a rejected summary is rewritten once with the check's notes), the in-custody Opus
//                         check, T1, a copy sweep of T1's files against the source, T2, the Astra check (pv-auth-checks, summaries only),
//                         the traceability check, the recognition probe (pv-auth-checks), both audits, the unit files
// Sources are the owner's own Capy threads (fetched into <work>/src by the parent with Capy's thread tools) or public
// records; raw source text never leaves custody, and every call that sees it is an Anthropic call. The work dir must
// sit on tmpfs; stdout carries counts and verdicts only.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import { openMeter, pool, sha256, type Meter } from "../meter.ts";
import type { Key, KeyItem, ProjectType, UnitMeta } from "../types.ts";
import * as P from "./prompts.ts";
import { AuthorError, ask, fence, flag, labelled, pinnedHead, put, rankPrimary, readJson } from "./run.ts";

/** sha256 of the sealed summary prompt (section 4: written into the sealed authoring bundle, digest committed before any summary). */
export const SUMMARY_PROMPT_SHA256 = "920a0623b02b7885e9c35255677b636bacc2c7826196f97910d336b33a2293ef";

const SCAN = "Below are the titles of a product owner's working threads with an AI coding agent, one per line as code | project | title. We need source histories for a research unit: a thread where a plan or design for a product change was written and then followed by what actually happened (the owner's or users' feedback after the first version, bug reports that reveal new needs, corrections, follow-on features, or a staged rollout). Prefer threads about building or changing a product people use (an app, a site, a service, a tool's user-facing feature) over threads about evaluations, merges, reviews, infrastructure chores or reports. Pick up to 40 threads, most promising first.\n\nOutput one fenced json block holding {\"pick\": [\"<code>\"]} and nothing else.";

const ASSESS = "Below is the transcript of one working thread between a product owner and an AI coding agent. Decide whether it holds a usable source history: a plan or design for a product change, written before the change was built, followed by real aftermath events. Aftermath events are what happened after the first version reached its users: a need, use, environment or misunderstanding the owner or users raised (kind U), a capability added afterwards that extends the feature (kind E), or how the change actually reached users when that differs from the plan, such as what the first version left out or how it was gated (kind R). Bug fixes with no new need behind them, chores and internal refactors are not events.\n\nIf it is usable, copy the plan verbatim as it was first written (only the plan, at most 1,500 words), describe the product as it stood before the plan from material dated before it (at most 400 words), and list every aftermath event in order (at most 10), each with its kind, a verbatim excerpt of at most 120 words and its date. Also list the names that identify the product or project (product, project, company and repository names, domains), and the product's type: consumer, server (server-side data or enterprise), mobile or other (developer tools and the rest).\n\nOutput one fenced json block holding {\"usable\": true | false, \"why\": \"...\", \"plan\": \"...\", \"before\": \"...\", \"events\": [{\"kind\": \"U\" | \"E\" | \"R\", \"excerpt\": \"...\", \"date\": \"...\"}], \"names\": [\"...\"], \"type\": \"consumer\" | \"server\" | \"mobile\" | \"other\"} and nothing else.";

const ASSESS_MULTI = "Below is a long conversation between a product owner (OWNER) and the coding agent that runs the product's crew (AGENT), over days or weeks. Find every usable source history in it. A usable history is a plan or design for one product change, written or relayed before the change was built (the owner's brief, an approved plan, or a plan the agent relayed for approval), followed by real aftermath events after that change reached its users, who here include the owner using the product. Aftermath events are: a need, use, environment or misunderstanding the owner or users raised about the shipped change (kind U); a capability added afterwards that extends it (kind E); or how the change actually reached users when that differs from the plan, such as what the first version left out or how it was gated (kind R). Bug fixes with no new need behind them, chores, process and crew management, and internal refactors are not events.\n\nReturn up to 6 histories, the richest first, each about a different change. For each, copy the plan verbatim as first written or relayed (only the plan, at most 1,500 words), describe the product as it stood before the plan from material dated before it (at most 400 words), and list every aftermath event in order (at most 10), each with its kind, a verbatim excerpt of at most 120 words and its date. Also list the names that identify the product or project (product, project, company and repository names, domains, people), and the product's type: consumer, server (server-side data or enterprise), mobile or other (developer tools and the rest).\n\nOutput one fenced json block holding {\"histories\": [{\"why\": \"...\", \"plan\": \"...\", \"plan_date\": \"...\", \"before\": \"...\", \"events\": [{\"kind\": \"U\" | \"E\" | \"R\", \"excerpt\": \"...\", \"date\": \"...\"}], \"names\": [\"...\"], \"type\": \"consumer\" | \"server\" | \"mobile\" | \"other\"}]} and nothing else. Return {\"histories\": []} when there is none.";

const SWEEP = "Below are a source plan, the source product before it, and three files written from them for a new, invented product. Edit the three files so that: no sentence copies or closely mirrors a sentence of the source, in wording or in sentence structure; no name or number from the source remains; and brief.md holds no part of the plan's design (no solution, approach, feature list, interface, setting, flag, rollout or scope decision). Change nothing else: keep every decision, commitment and omission of plan.md, and keep each file's length.";

const CHECK = "Compare each summary below with its raw event. A summary passes when it says what happened faithfully, adds nothing, keeps the event's kind, and holds no name of a person, product, project, company, domain, repository or file, no secret or credential, no identifying number and no personal data.\n\nOutput one fenced json block holding {\"checks\": [{\"event\": <n>, \"verdict\": \"pass\" | \"reject\", \"note\": \"...\"}]} and nothing else.";

const ASTRA = "Each key item below was written for a new, invented product (described by the three input files) to re-skin one event from another product's history; the event is given only as a scrubbed summary. For each item check: (1) follows: it is the same kind of need, use, environment or capability as its event, translated into the new product's domain, and adds nothing the event lacks; (2) named: plan.md, brief.md or context/project.md already names the item's need.\n\nOutput one fenced json block holding {\"items\": [{\"event\": <n>, \"follows\": true | false, \"named\": true | false, \"note\": \"...\"}]} and nothing else.";

const TRACE = "Below are a source history (a plan, the product before it, aftermath events and the names that identify it) and a research unit made from it: three input files for a new, invented product and one key item per event. Check: (1) each key item maps to its own source event one to one; (2) the unit's files copy no sentence, name or number from the source and name nothing that identifies the source product, project, company or people.\n\nOutput one fenced json block holding {\"items\": [{\"event\": <n>, \"maps\": true | false}], \"leaks\": [\"<each copied sentence, name or number, quoted>\"]} and nothing else.";

const AUDIT_IN = "You audit one research unit's inputs. The unit re-skins a source plan as a new, invented product. You see the source plan, the source product before it, and the three input files. Report every problem, each with its file and a short quote:\n1. The inputs copy a sentence, name or number from the source, or name anything that identifies it.\n2. brief.md holds part of the proposed design (a solution, approach, feature list, interface, setting, flag, rollout or scope decision from the plan).\n3. plan.md adds a decision the source plan doesn't make, or leaves out one it does make, or changes its kinds of commitments and omissions.\n4. context/project.md describes the plan's own design, or anything after the plan.\nPass only when there are no problems. Output one fenced json block holding {\"verdict\": \"pass\" | \"fail\", \"problems\": [{\"file\": \"plan.md\" | \"brief.md\" | \"context/project.md\", \"check\": 1, \"quote\": \"...\", \"fix\": \"...\"}]} and nothing else.";

const AUDIT_KEY = "You audit one research unit's answer key. The unit re-skins another product's history as a new, invented product. You see the source events as scrubbed summaries, the three input files and the key, one item per event. Check every item: (1) it re-skins its own event, the same kind of need, use, environment or capability, and adds nothing; (2) it is an observed fact of at most 30 words, not advice; (3) mentioned is true exactly when an input file already names its need; (4) it duplicates no other item.\n\nOutput one fenced json block holding {\"verdict\": \"pass\" | \"fail\", \"items\": [{\"event\": <n>, \"verdict\": \"keep\" | \"fix\" | \"drop\", \"note\": \"...\"}]} and nothing else. Pass only when every item is keep.";

const PROBE = "The product plan below may be based on a real project or product. If you can tell which real project or product it is based on, name it in one line. If you cannot, answer unknown.";

const INPUTS = ["plan.md", "brief.md", "context/project.md"];

function src(work: string, id: string): string {
  const p = join(work, "src", id + ".md");
  if (!existsSync(p)) throw new AuthorError("E_USAGE", "no fetched source " + p);
  return readFileSync(p, "utf8");
}

async function scan(work: string, item: string, io: Io): Promise<number> {
  const threads = readJson(join(work, "threads.json"));
  const lines = threads.map((t: any) => (t.code ?? t.id) + " | " + (t.project?.code ?? "-") + " | " + (t.title ?? "")).join("\n");
  const log = (uid: string, stage: string, data: Record<string, unknown>) => put(join(work, "scan-log.json"), { uid, stage, ...data });
  const m = await openMeter({ item, runId: item, out: join(process.env.HOME!, ".capy/work/pv/journals", item), cacheDir: join(work, "cache"), maxOutputTokens: 32000 });
  try {
    const r = await ask({ log }, m, "scan", "scan", "opus", SCAN + fence("Threads", lines), 4000, "medium", true);
    put(join(work, "scan.json"), r);
    io.out("pv transpose scan: " + (r?.pick ?? []).length + " threads picked");
  } finally {
    const c = await m.close();
    io.out("spent " + (c.spent_micros / 1e6).toFixed(4) + " USD on " + item);
  }
  return 0;
}

async function assess(work: string, item: string, ids: string[], io: Io): Promise<number> {
  const logs: any[] = [];
  const log = (uid: string, stage: string, data: Record<string, unknown>) => logs.push({ uid, stage, ...data });
  const m = await openMeter({ item, runId: item, out: join(process.env.HOME!, ".capy/work/pv/journals", item), cacheDir: join(work, "cache"), maxOutputTokens: 32000 });
  let usable = 0;
  try {
    await pool(3, ids.map((id) => async () => {
      if (existsSync(join(work, "assess", id + ".json"))) return;
      const text = src(work, id);
      const r = await ask({ log }, m, id, "assess", "opus", ASSESS + fence("Transcript", text), 12000, "medium", true);
      put(join(work, "assess", id + ".json"), r);
    }));
  } finally {
    const c = await m.close();
    put(join(work, "assess-log-" + Date.now() + ".json"), logs);
    for (const id of ids) {
      const p = join(work, "assess", id + ".json");
      const a = existsSync(p) ? readJson(p) : null;
      if (a?.usable) usable++;
      io.out(id + " " + (a ? (a.usable ? "usable, " + (a.events ?? []).length + " events, type " + a.type : "not usable") : "not assessed"));
    }
    io.out("pv transpose assess: " + usable + " usable; spent " + (c.spent_micros / 1e6).toFixed(4) + " USD on " + item);
  }
  return 0;
}

/** A long owner-seat conversation can hold several histories; each becomes assess/<src>~h<n>.json, read by author like a single-thread one. */
async function assessMulti(work: string, item: string, ids: string[], io: Io): Promise<number> {
  const logs: any[] = [];
  const log = (uid: string, stage: string, data: Record<string, unknown>) => logs.push({ uid, stage, ...data });
  const m = await openMeter({ item, runId: item, out: join(process.env.HOME!, ".capy/work/pv/journals", item), cacheDir: join(work, "cache"), maxOutputTokens: 32000 });
  const found: Record<string, number> = {};
  try {
    await pool(2, ids.map((id) => async () => {
      const done = join(work, "assess", id + ".multi.json");
      if (!existsSync(done)) put(done, await ask({ log }, m, id, "assess-multi", "opus", ASSESS_MULTI + fence("Conversation", src(work, id)), 30000, "medium", true));
      const hs = (readJson(done)?.histories ?? []).filter((h: any) => typeof h?.plan === "string" && Array.isArray(h.events) && h.events.length);
      hs.forEach((h: any, i: number) => put(join(work, "assess", id + "~h" + (i + 1) + ".json"), { usable: true, ...h }));
      found[id] = hs.length;
    }));
  } finally {
    const c = await m.close();
    put(join(work, "assess-log-" + Date.now() + ".json"), logs);
    for (const id of ids) io.out(id + " " + (id in found ? found[id] + " histories" : "not assessed"));
    io.out("pv transpose assess-multi: spent " + (c.spent_micros / 1e6).toFixed(4) + " USD on " + item);
  }
  return 0;
}

const nameHit = (text: string, names: string[]) => names.filter((n) => n && n.length >= 3).some((n) => text.toLowerCase().includes(n.toLowerCase()));

async function authorOne(ctx: { log: any; author: Meter; checks: Meter }, work: string, id: string, type: ProjectType, set: UnitMeta["set"], summaryPrompt: string): Promise<string | null> {
  const a = readJson(join(work, "assess", id + ".json"));
  if (!a?.usable) return "source not usable";
  const uid = "pv-t" + sha256("20261108\n" + id + "\n" + type).slice(0, 9);
  const dir = join(work, "units", uid);
  const events = (a.events ?? []).slice(0, 10).map((e: any, i: number) => ({ n: i + 1, kind: e.kind, excerpt: String(e.excerpt ?? ""), date: e.date ?? null }));
  if (!events.some((e: any) => e.kind === "U" || e.kind === "E")) return "no U or E event";
  const names: string[] = (a.names ?? []).map(String);
  put(join(dir, "source.json"), { id, type, events: events.length });
  const raw = events.map((e: any) => "Event " + e.n + " (kind " + e.kind + (e.date ? ", " + e.date : "") + "): " + e.excerpt).join("\n\n");
  let summaries: any[] = [];
  let rejected = "";
  for (let round = 1; round <= 2; round++) {
    const s = await ask(ctx, ctx.author, uid, "summary-" + round, "opus", summaryPrompt + fence("Events", raw) + (rejected ? fence("A checker rejected some earlier summaries; write every summary again and fix these", rejected) : ""), 6000, "medium", true);
    summaries = (s?.summaries ?? []).filter((x: any) => Number.isInteger(x?.event) && typeof x.summary === "string");
    if (summaries.length !== events.length) {
      if (round === 2) return "summaries do not cover every event";
      continue;
    }
    const c = await ask(ctx, ctx.author, uid, "check-" + round, "opus", CHECK + fence("Raw events", raw) + fence("Summaries", summaries.map((x) => "Event " + x.event + ": " + x.summary).join("\n")), 6000, "high", true);
    put(join(dir, "check-" + round + ".json"), c);
    if ((c?.checks ?? []).length === events.length && c.checks.every((x: any) => x.verdict === "pass")) break;
    if (round === 2) return "the in-custody check rejected the summaries twice";
    rejected = (c?.checks ?? []).filter((x: any) => x.verdict !== "pass").map((x: any) => "Event " + x.event + ": " + x.note).join("\n") || "(the check did not cover every event)";
  }
  summaries = summaries.map((x) => ({ ...x, kind: events[x.event - 1]?.kind }));
  put(join(dir, "summaries.json"), summaries);
  const t1 = labelled(await ask(ctx, ctx.author, uid, "t1", "opus", P.T1.replace("TYPE", P.TYPE_WORDS[type]!) + fence("Source plan", a.plan) + fence("The source product before the plan", a.before) + "\n\n" + P.T1_FORMAT, 12000, "medium", false));
  if (!t1["plan.md"] || !t1["brief.md"] || !t1["context/project.md"]) return "T1 did not return three files";
  const swept = labelled(await ask(ctx, ctx.author, uid, "sweep", "opus", SWEEP + fence("Source plan", a.plan) + fence("The source product before the plan", a.before) + INPUTS.map((f) => fence("File " + f, t1[f]!)).join("") + "\n\n" + P.T1_FORMAT, 12000, "medium", false));
  for (const f of INPUTS) put(join(dir, "unit", f), (swept["plan.md"] && swept["brief.md"] && swept["context/project.md"] ? swept : t1)[f]!);
  const inputsText = () => INPUTS.map((f) => fence("Input file " + f, readFileSync(join(dir, "unit", f), "utf8"))).join("");
  for (let round = 1; round <= 2; round++) {
    const au = await ask(ctx, ctx.author, uid, "audit-in-" + round, "opus", AUDIT_IN + fence("Source plan", a.plan) + fence("The source product before the plan", a.before) + inputsText(), 8000, "high", true);
    put(join(dir, "audit-in-" + round + ".json"), au);
    const probs = Array.isArray(au?.problems) ? au.problems : [];
    if (au?.verdict === "pass" && !probs.length) break;
    if (round === 2) return "input audit failed twice";
    for (const f of INPUTS) {
      const pf = probs.filter((p: any) => p.file === f);
      if (pf.length) put(join(dir, "unit", f), (await ask(ctx, ctx.author, uid, "fix-" + f.replace(/\W/g, ""), "opus", P.FIX + fence("Problems", pf.map((p: any) => "- " + p.quote + ": " + p.fix).join("\n")) + fence("File " + f, readFileSync(join(dir, "unit", f), "utf8")), 8000, "medium", false)).trim() + "\n");
    }
  }
  const sumText = summaries.map((x) => "Event " + x.event + ": " + x.summary).join("\n");
  let t2 = await ask(ctx, ctx.author, uid, "t2", "opus", P.T2 + fence("Aftermath events", sumText) + inputsText() + "\n\n" + P.T2_FORMAT, 6000, "medium", true);
  let items = (t2?.items ?? []).filter((x: any) => Number.isInteger(x?.event) && typeof x.statement === "string");
  if (items.length !== events.length) return "T2 did not write one item per event";
  for (let round = 1; round <= 2; round++) {
    const au = await ask(ctx, ctx.author, uid, "audit-key-" + round, "opus", AUDIT_KEY + fence("Source events (scrubbed summaries)", sumText) + inputsText() + fence("The key", JSON.stringify(items, null, 2)), 8000, "high", true);
    put(join(dir, "audit-key-" + round + ".json"), au);
    if (au?.verdict === "pass") break;
    if (round === 2) return "key audit failed twice";
    t2 = await ask(ctx, ctx.author, uid, "t2-fix", "opus", P.T2 + fence("Aftermath events", sumText) + inputsText() + fence("Your earlier items", JSON.stringify(items, null, 2)) + fence("An auditor's notes; apply them", JSON.stringify(au, null, 2)) + "\n\n" + P.T2_FORMAT, 6000, "medium", true);
    items = (t2?.items ?? []).filter((x: any) => Number.isInteger(x?.event) && typeof x.statement === "string");
    if (items.length !== events.length) return "T2 did not write one item per event after the fix";
  }
  const astra = await ask(ctx, ctx.checks, uid, "astra-check", "astra", ASTRA + fence("Source events (scrubbed summaries)", sumText) + inputsText() + fence("Key items", items.map((x: any) => "Event " + x.event + ": " + x.statement + (x.mentioned ? " (marked mentioned)" : "")).join("\n")), 8000, "medium", true);
  put(join(dir, "astra-check.json"), astra);
  const verdict = new Map<number, any>((astra?.items ?? []).map((x: any) => [Number(x.event), x]));
  if (verdict.size !== events.length) return "the Astra check did not cover every item";
  const traceIt = (round: number) => ask(ctx, ctx.author, uid, "trace-" + round, "opus", TRACE + fence("Source plan", a.plan) + fence("Source product before", a.before) + fence("Source events", raw) + fence("Source names", names.join(", ")) + inputsText() + fence("Key items", items.map((x: any) => "Event " + x.event + ": " + x.statement).join("\n")), 6000, "high", true);
  const leaked = (t: any) => (t?.leaks ?? []).length > 0 || nameHit(INPUTS.map((f) => readFileSync(join(dir, "unit", f), "utf8")).join("\n"), names);
  let trace = await traceIt(1);
  put(join(dir, "trace-1.json"), trace);
  if (leaked(trace)) {
    const quotes = [...(trace?.leaks ?? []).map(String), ...names.filter((n) => n.length >= 3)];
    for (const f of INPUTS) {
      const text = readFileSync(join(dir, "unit", f), "utf8");
      const hit = quotes.filter((q) => q && text.toLowerCase().includes(q.toLowerCase()));
      if (hit.length) put(join(dir, "unit", f), (await ask(ctx, ctx.author, uid, "fix-leak-" + f.replace(/\W/g, ""), "opus", P.FIX + fence("Problems", hit.map((q) => "- " + q + ": copied from the source; replace it with wording of the new product's own").join("\n")) + fence("File " + f, text), 8000, "medium", false)).trim() + "\n");
    }
    trace = await traceIt(2);
    put(join(dir, "trace-2.json"), trace);
    if (leaked(trace)) return "the traceability check found source material in the unit twice";
  }
  if ((trace?.items ?? []).some((x: any) => x.maps === false)) return "a key item does not map to its event";
  const probeText = PROBE + inputsText();
  for (const model of ["astra", "opus", "sol", "particle"] as const) {
    const r = await ask(ctx, ctx.checks, uid, "probe-" + model, model, probeText, 1000, model === "particle" ? null : "low", false);
    put(join(dir, "probe-" + model + ".txt"), r);
    if (nameHit(r, names)) return "the recognition probe named the source (" + model + ")";
  }
  const keyItems: KeyItem[] = items
    .filter((x: any) => verdict.get(Number(x.event))?.follows !== false)
    .map((x: any) => ({ id: "k" + x.event, kind: events[x.event - 1].kind, statement: x.statement, evidence: ["event " + x.event], outside_users: 0, mentioned: x.mentioned === true || verdict.get(Number(x.event))?.named === true, generic: false, foreseeable: "maybe" }));
  const key: Key = { unit: uid, items: keyItems, primary: rankPrimary(uid, keyItems), commitments: [] };
  put(join(dir, "unit/key.json"), key);
  if (!key.primary.length) return "no primary item";
  const meta: UnitMeta = { id: uid, set, source: "transposed", source_kind: "transposed", inspiration: id.startsWith("public:") ? "public" : "capy", type, plan_date: id.startsWith("public:") ? (a.plan_date ?? new Date().toISOString()) : new Date().toISOString(), rank: 0 };
  put(join(dir, "unit/unit.json"), meta);
  return null;
}

export async function run(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  const work = flag(rest, "--work"), item = flag(rest, "--item");
  if (!work || !item) throw new AuthorError("E_USAGE", "pv transpose scan|assess|author --work <tmpfs dir> --item <item> [--ids ...]");
  pinnedHead();
  const ids = (flag(rest, "--ids") ?? "").split(",").filter(Boolean);
  if (sub === "scan") return scan(work, item, io);
  if (sub === "assess") return assess(work, item, ids, io);
  if (sub === "assess-multi") return assessMulti(work, item, ids, io);
  if (sub !== "author") throw new AuthorError("E_USAGE", "pv transpose scan|assess|author");
  const promptFile = flag(rest, "--summary-prompt");
  if (!promptFile) throw new AuthorError("E_USAGE", "pv transpose author needs --summary-prompt <sealed prompt file on tmpfs>");
  const summaryPrompt = readFileSync(promptFile, "utf8");
  if (sha256(summaryPrompt) !== SUMMARY_PROMPT_SHA256) throw new AuthorError("E_USAGE", "the summary prompt's sha256 is not the committed one");
  const set = (flag(rest, "--set") ?? "pilot") as UnitMeta["set"];
  const logFile = join(work, "transpose-log.jsonl");
  const head = pinnedHead();
  const log = (uid: string, stage: string, data: Record<string, unknown>) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), head, item, uid, stage, ...data }) + "\n");
  const journals = join(process.env.HOME!, ".capy/work/pv/journals");
  const author = await openMeter({ item, runId: item, out: join(journals, item), cacheDir: join(work, "cache"), maxOutputTokens: 32000 });
  const checks = await openMeter({ item: "pv-auth-checks", runId: "pv-auth-checks", out: join(journals, "pv-auth-checks"), cacheDir: join(work, "cache"), maxOutputTokens: 32000 });
  const results: string[] = [];
  try {
    await pool(2, ids.map((spec) => async () => {
      const [id, type] = spec.split("@") as [string, ProjectType];
      try {
        const why = await authorOne({ log, author, checks }, work, id, type, set, summaryPrompt);
        results.push(id + "@" + type + " " + (why ? "dropped (" + why + ")" : "passed"));
        log(id, why ? "drop" : "pass", why ? { reason: why } : {});
      } catch (e) {
        results.push(id + "@" + type + " error (" + ((e as AuthorError).code ?? "E_INTERNAL") + ")");
        log(id, "error", { message: String((e as Error).message).slice(0, 300) });
      }
    }));
  } finally {
    const a = await author.close();
    const c = await checks.close();
    io.out("pv transpose author: spent " + (a.spent_micros / 1e6).toFixed(4) + " USD on " + item + " and " + (c.spent_micros / 1e6).toFixed(4) + " USD on pv-auth-checks");
  }
  for (const r of results) io.out(r);
  return 0;
}
