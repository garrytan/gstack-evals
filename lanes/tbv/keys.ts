// Copyright (c) 2026 Garry Tan. MIT License.
// Key writing and auditing (prereg section 4): the key writer and two auditors through the proxy on tbv-author's lease.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.ts";
import { ask, type Deps, fencedJson, isObj, isStrs, modelOf, openRun, parseFlags, readBundle, readJsonDir, REPO_ROOT, SENDS_PER_ASK, type Worst, worstOf } from "./judge.ts";
import { judgeSend, keyWriterSend } from "./routes.ts";
import { words } from "./rule.ts";
import { BUNDLE, CATEGORIES, type Category, type Extract, type History, type Io, type ItemRun, type Judge, type Key, type KeyFact, type KeyTrap, type SendRequest } from "./types.ts";

/** Output allowances for the key writer and each auditor (not frozen by the prereg; the projection prices them). */
export const KEY_MAX_TOKENS = 16000;
export const AUDIT_MAX_TOKENS = 8000;
export const AUDIT_BRIEF = "lanes/tbv/briefs/audit-brief.md";

const numbered = (h: History) => "## History\n\nsha256: " + h.sha256 + "\n\n" + h.events.map((e) => JSON.stringify(e)).join("\n");
export const keyPrompt = (brief: string, history: History, extract: Extract) =>
  brief + "\n" + numbered(history) + "\n\n## Extractor candidates\n\n" + extract.candidates.map((c) => JSON.stringify(c)).join("\n") + "\n";
export const auditPrompt = (brief: string, key: Key, history: History) =>
  brief + "\n" + numbered(history) + "\n\n## Key\n\n" + JSON.stringify({ facts: key.facts, traps: key.traps, list: key.list, digest: key.digest }, null, 2) + "\n";

/** One JSON object, bare or as the whole of one fenced block. */
function oneObject(reply: string): Record<string, unknown> | string {
  let t = reply.trim();
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(t);
  if (fence) t = fence[1]!.trim();
  try {
    const v: unknown = JSON.parse(t);
    return isObj(v) ? v : "the reply is not one JSON object";
  } catch {
    return "the reply is not one JSON object";
  }
}

/** Checks a key writer's reply against the brief's rules; returns the key or the reason it is refused. */
export function parseKey(reply: string, history: History, extract: Extract): Key | string {
  const o = oneObject(reply);
  if (typeof o === "string") return o;
  if (o.history_sha256 !== history.sha256) return "history_sha256 does not match the history";
  const known = new Set(history.events.map((e) => e.n));
  const cites = (x: unknown): x is number[] => Array.isArray(x) && x.length > 0 && x.every((n) => Number.isInteger(n) && known.has(n as number));
  const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
  const clean = extract.stratum === "clean";
  if (!Array.isArray(o.facts)) return "facts must be a list";
  if (clean && o.facts.length) return "a clean task's key has no facts";
  if (!clean && (o.facts.length < 3 || o.facts.length > 8)) return "a key needs 3 to 8 facts, not " + o.facts.length;
  const facts: KeyFact[] = [];
  for (const [i, f] of (o.facts as unknown[]).entries()) {
    const id = "F" + (i + 1);
    if (!isObj(f) || f.id !== id) return "fact " + (i + 1) + " must have id " + id;
    if (!(CATEGORIES as readonly unknown[]).includes(f.category)) return "fact " + id + " has a category outside the list";
    if (!text(f.statement)) return "fact " + id + " has no statement";
    if (!cites(f.events)) return "fact " + id + " must cite events the history holds";
    if (typeof f.critical !== "boolean") return "fact " + id + " needs a boolean critical flag";
    facts.push({ id, category: f.category as Category, statement: f.statement, events: f.events, critical: f.critical });
  }
  if (!Array.isArray(o.traps) || o.traps.length > 4) return "traps must be a list of up to 4";
  const traps: KeyTrap[] = [];
  for (const [i, t] of (o.traps as unknown[]).entries()) {
    const id = "T" + (i + 1);
    if (!isObj(t) || (t.id !== undefined && t.id !== id)) return "trap " + (i + 1) + " must have id " + id + " or none";
    if (!text(t.claim) || !text(t.why_false)) return "trap " + id + " needs a claim and why_false";
    if (!cites(t.events)) return "trap " + id + " must cite events the history holds";
    traps.push({ id, claim: t.claim, why_false: t.why_false, events: t.events });
  }
  const list = o.list;
  if (list !== null && !(Array.isArray(list) && list.every((x) => isObj(x) && text(x.name) && typeof x.state === "string"))) return "list must be null or items with a name and a state";
  if (!text(o.digest) || words(o.digest) > 1500) return "the digest must hold 1 to 1,500 words";
  return {
    schema: "tbv-key.v1",
    task: history.task,
    history_sha256: history.sha256,
    facts,
    traps,
    list: list === null ? null : (list as Array<{ name: string; state: string }>).map((x) => ({ name: x.name, state: x.state })),
    digest: o.digest,
    audits: [],
    dropped: [],
  };
}

/** One auditor's reply: one fenced tbv-audit block, one ruling per fact in the key's order, and the missing list. */
export function parseAudit(reply: string, key: Key): { rejected: string[]; missing: string[] } | string {
  const b = fencedJson(reply, "tbv-audit");
  if (typeof b === "string") return b;
  const o = b.v;
  if (!isObj(o) || !Array.isArray(o.facts)) return "the tbv-audit block needs a facts list";
  if (o.facts.length !== key.facts.length) return "label count: " + o.facts.length + " rulings for " + key.facts.length + " facts";
  const rejected: string[] = [];
  for (const [i, f] of (o.facts as unknown[]).entries()) {
    const id = key.facts[i]!.id;
    if (!isObj(f) || f.id !== id) return "ruling " + (i + 1) + " is not " + id;
    if (f.verdict !== "accept" && f.verdict !== "reject") return "fact " + id + " needs verdict accept or reject";
    if (typeof f.reason !== "string") return "fact " + id + " needs a reason";
    if (f.verdict === "reject") rejected.push(id);
  }
  if (!isStrs(o.missing)) return "missing must be a list of strings";
  return { rejected, missing: o.missing };
}

export interface Audit {
  auditor: Judge;
  rejected: string[];
  missing: string[];
  responseIds: string[];
}
/** A fact either auditor rejects drops; under 3 facts the task drops; a clean task needs both auditors to find nothing missing. */
export function settleKey(key: Key, audits: Audit[], clean: boolean): { key: Key; drop: string | null } {
  const rejected = new Set(audits.flatMap((a) => a.rejected));
  const out: Key = {
    ...key,
    facts: key.facts.filter((f) => !rejected.has(f.id)),
    audits: audits.map((a) => ({ auditor: a.auditor, rejected: a.rejected, missing: a.missing, responseIds: a.responseIds })),
    dropped: key.facts.filter((f) => rejected.has(f.id)).map((f) => f.id),
  };
  if (clean) return { key: out, drop: audits.some((a) => a.missing.length) ? "an auditor found something material missing from a clean task's key" : null };
  return { key: out, drop: out.facts.length < 3 ? "fewer than 3 facts left after the audit" : null };
}

/** Writes and audits one key per history, each call on its own slot; kept keys go to out/<task>.json, drops to out/drops.json. */
export async function writeKeys(o: { histories: History[]; extracts: Extract[]; out: string; keyBrief: string; auditBrief: string; run: ItemRun; keyWriterSend?: typeof keyWriterSend; judgeSend?: typeof judgeSend; worst?: Worst }) {
  const writer = o.keyWriterSend ?? keyWriterSend;
  const auditor = o.judgeSend ?? judgeSend;
  const worst = o.worst ?? worstOf;
  const extracts = new Map(o.extracts.map((x) => [x.task, x]));
  const kept: Key[] = [];
  const dropped: Array<{ task: string; reason: string }> = [];
  mkdirSync(o.out, { recursive: true });
  const drop = (task: string, reason: string) => {
    dropped.push({ task, reason });
    writeFileSync(join(o.out, "drops.json"), JSON.stringify(dropped, null, 2) + "\n");
  };
  for (const h of o.histories) {
    const x = extracts.get(h.task) ?? fail("E_TBV_INPUT", "no extract for task " + h.task);
    if (x.history_sha256 !== h.sha256) fail("E_TBV_INPUT", "the extract for task " + h.task + " was made from another history");
    const base = randomBytes(8).toString("hex");
    const call = async <T>(role: string, build: () => SendRequest, max: number, parse: (t: string) => T | string) => {
      const req = build();
      const slot = o.run.slot(base + "-" + role, [modelOf(req)], SENDS_PER_ASK * worst(req, max));
      try {
        return await ask(slot, build, parse);
      } finally {
        await slot.close();
      }
    };
    const prompt = keyPrompt(o.keyBrief, h, x);
    const w = await call("writer", () => writer(prompt, KEY_MAX_TOKENS), KEY_MAX_TOKENS, (t) => parseKey(t, h, x));
    if (!w.ok) {
      drop(h.task, "key refused: " + w.reason);
      continue;
    }
    const ap = auditPrompt(o.auditBrief, w.value, h);
    const audits: Audit[] = [];
    let failed = "";
    for (const who of ["opus", "sol"] as const) {
      const r = await call(who, () => auditor(who, ap, AUDIT_MAX_TOKENS), AUDIT_MAX_TOKENS, (t) => parseAudit(t, w.value));
      if (!r.ok) {
        failed = who + " audit failed: " + r.reason;
        break;
      }
      audits.push({ auditor: who, ...r.value, responseIds: r.responseIds });
    }
    if (failed) {
      drop(h.task, failed);
      continue;
    }
    const s = settleKey(w.value, audits, x.stratum === "clean");
    if (s.drop) {
      drop(h.task, s.drop);
      continue;
    }
    writeFileSync(join(o.out, h.task + ".json"), JSON.stringify(s.key, null, 2) + "\n");
    kept.push(s.key);
  }
  return { kept, dropped };
}

/** tbv keys --histories DIR --extracts DIR --out DIR --item ID --run-id ID --record DIR --ledger FILE */
export async function run(argv: string[], io: Io, deps: Deps = {}): Promise<number> {
  const a = parseFlags(argv.slice(1), ["histories", "extracts", "out", "item", "run-id", "record", "ledger"]);
  const histories = readJsonDir<History>(a.histories!, "tbv-history.v1");
  const extracts = readJsonDir<Extract>(a.extracts!, "tbv-extract.v1");
  const byTask = new Map(extracts.map((x) => [x.task, x]));
  for (const h of histories) {
    const x = byTask.get(h.task) ?? fail("E_TBV_INPUT", "no extract for task " + h.task);
    if (x.history_sha256 !== h.sha256) fail("E_TBV_INPUT", "the extract for task " + h.task + " was made from another history");
  }
  if (existsSync(a.out!) && readdirSync(a.out!).length) fail("E_TBV_INPUT", a.out + " is not empty; write keys into a new directory");
  const keyBrief = readBundle(BUNDLE.keyBrief);
  const auditBrief = readFileSync(join(REPO_ROOT, AUDIT_BRIEF), "utf8");
  const runner = await openRun(a, deps);
  let r: Awaited<ReturnType<typeof writeKeys>>;
  try {
    r = await writeKeys({ histories, extracts, out: a.out!, keyBrief, auditBrief, run: runner, keyWriterSend: deps.keyWriterSend, judgeSend: deps.judgeSend, worst: deps.worst });
  } finally {
    await runner.close();
  }
  io.out("keys: " + r.kept.length + " kept, " + r.dropped.length + " dropped");
  return 0;
}
