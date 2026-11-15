// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ask-replay dryrun (prereg section 13): the keyless dry run. It drives every frozen rule end to end on the
// synthetic set with a scripted stub model (SEND, FOLD, DROP, unparsable, safety stop, upstream error, missing repeats
// field, unknown row id, reask reason), opens and settles one spend lease per frozen spend item on a temporary ledger,
// resumes a killed shard and shows no call counted twice, and runs custody on a throwaway age identity. It prints one
// PASS or FAIL line per check and exits 1 on any FAIL. The pin check reads the three gstack files from a clone; the
// tests run the same checks with a stand-in gstack text and no pin line.
import { mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, mkdirSync, closeSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { buildFrom } from "./build.ts";
import { chainStats, clusters, proxyLinks, s1Match } from "./chains.ts";
import { custody, gone, keygen, plainStore, readIdentity, readRecords, seal, sealedStore, writeSums } from "./custody.ts";
import { buildFixture, DECISION_FIXTURES, FIXTURE_GSTACK, Killed, labelSend, stubSend, type StubReply } from "./fixtures.ts";
import { AskError, FROZEN } from "./frozen.ts";
import { ledgerRows, sendCheck } from "./ledger.ts";
import { classify, parseReply } from "./parse.ts";
import { itemTexts, scanPublic, redact, emptyCount } from "./privacy.ts";
import { buildPrompt, CAPABILITY, gstackLines, HARNESS, LEDGER_ADDENDUM, loadGstack, ORDER, type GstackText } from "./prompt.ts";
import { finalRecords, ledgerClient, runShard, sampleId, schedule, upstreamRedraw, type CallKey, type ShardOptions } from "./run.ts";
import { auditDraw, drawCounts, pilotDraw } from "./draws.ts";
import { CODEBOOK, checkCodebook, labelJob, labelReadout, labelSamples } from "./label.ts";
import { decide, readout, sampleScore } from "./score.ts";
import { admitChance, halfWidth, mdd } from "./stats.ts";
import { generate } from "./synthetic/generator.ts";
import { outcomeOf, type AskItem, type LabelReply, type Outcome, type Sample, type SampleRecord } from "./types.ts";

export interface Line {
  name: string;
  state: "PASS" | "FAIL";
  detail: string;
}

type Check = { name: string; run: () => Promise<string | true> | string | true };

const SYNTH = join(import.meta.dir, "synthetic", "items.jsonl");
const r1 = (x: number) => Math.round(x * 1000) / 10;

function lease(dir: string, item: string, cap = 50_000_000) {
  const record = join(dir, "record");
  const path = ledgerPath(join(dir, "ledger.sqlite"), {});
  recordApproval(record, { action: "init", item, cap_micros: cap, quotes: [{ words: "dry run on a temporary ledger, not an approval", by: "ask-replay dryrun", source: "prereg section 13" }], admission: "warn" });
  const local = openLocalLedger(path);
  const leaseId = openLease(record, local, { item, run_id: item }).lease_id;
  return { record, local, leaseId };
}

/** The scripted run on the synthetic set: every reply path through the real driver on a temporary ledger. */
async function scriptedRun(items: AskItem[]): Promise<string | true> {
  const dir = mkdtempSync(join(tmpdir(), "ask-dry-run-"));
  try {
    const byId = new Map(items.map((i) => [i.item, i]));
    const dups = items.filter((i) => i.label === "DUPLICATE" && s1Match(i));
    const answered = dups.find((i) => s1Match(i)!.next_owner)!;
    const open = dups.find((i) => !s1Match(i)!.next_owner)!;
    const rowOf = (i: AskItem) => ledgerRows(i).find((r) => r.order === s1Match(i)!.order)!.id;
    const dec = items.filter((i) => i.label === "DECISION");
    const [p, q] = [dec[0]!, dec[1]!];
    const chosen = [answered, open, p, q, ...items.filter((i) => i.label === "PERMISSION_FOR_DEFAULT").slice(0, 1)];
    const upstreamOnce = new Set<string>();
    const script = (s: Sample, key: { attempt: number }): StubReply => {
      const it = byId.get(s.item)!;
      if (it === answered && s.arm === "c") return { action: "SEND", repeats: rowOf(it) };
      if (it === answered && s.arm === "d") return { action: "send", repeats: rowOf(it), reask_reason: "the launch date moved since the answer" };
      if (it === open && s.arm === "c") return { action: "SEND", repeats: rowOf(it) };
      if (it === open && s.arm === "d") return { action: "FOLD", repeats: rowOf(it), reask_reason: "   " };
      if (it === p && s.arm === "a") return key.attempt === 1 ? { raw: "unparsable" } : { action: "SEND", wrap: true };
      if (it === p && s.arm === "b") return { raw: "unparsable" };
      if (it === p && s.arm === "c") return { action: "SEND" };
      if (it === p && s.arm === "d") return { action: "DROP", repeats: "q-000000000000" };
      if (it === q && s.arm === "a") return { raw: "safety" };
      if (it === q && s.arm === "b") return upstreamOnce.has("redraw") ? { action: "SEND" } : { raw: "upstream" };
      return { action: it.label === "DECISION" ? "SEND" : "fold", repeats: "new" };
    };
    const calls: string[] = [];
    const { local, leaseId, record } = lease(dir, FROZEN.spend_items.I1!);
    const send = stubSend(script, calls);
    const samples = schedule(chosen, "opus", 1, 7);
    const store = plainStore(join(dir, "replies"));
    const o: ShardOptions = { items: byId, samples, gstack: FIXTURE_GSTACK, client: ledgerClient({ local, leaseId, runId: FROZEN.spend_items.I1!, maxOutputTokens: FROZEN.output_cap.tokens, send }), store, out: join(dir, "out"), maxOutputTokens: FROZEN.output_cap.tokens, sleep: async () => {}, concurrency: 1 };
    const res = await runShard(o);
    upstreamOnce.add("redraw");
    const re = await upstreamRedraw(o);
    const recs = store.read();
    const get = (it: AskItem, arm: string, id = it.item + "." + arm + ".opus.1") => recs.get(id)!;
    const want: Array<[string, boolean]> = [
      ["answered row named on SEND becomes DROP", get(answered, "c").final_action === "DROP" && get(answered, "c").gate === "drop_answered"],
      ["answered row with a reask reason keeps SEND (lowercase action read)", get(answered, "d").final_action === "SEND" && get(answered, "d").gate === "reask_kept"],
      ["open row named on SEND becomes FOLD", get(open, "c").final_action === "FOLD" && get(open, "c").gate === "fold_open"],
      ["whitespace reask reason on an open-row FOLD keeps FOLD", get(open, "d").final_action === "FOLD" && !get(open, "d").reask_reason],
      ["unparsable then parsed from prose: two attempts", get(p, "a").attempts === 2 && get(p, "a").final_action === "SEND" && !get(p, "a").missing],
      ["unparsable twice is MISSING parse", get(p, "b").missing === "parse" && get(p, "b").attempts === 2],
      ["missing repeats field counts as new", get(p, "c").repeats === "missing_field" && get(p, "c").final_action === "SEND"],
      ["unknown row id counts as new", get(p, "d").repeats === "unknown_id" && get(p, "d").final_action === "DROP"],
      ["safety stop is its own MISSING kind, not retried", get(q, "a").missing === "safety" && get(q, "a").attempts === 1],
      ["upstream: three retries then UPSTREAM", get(q, "b").missing === "upstream" && get(q, "b").attempts === 4],
      ["end-of-run pass redraws UPSTREAM samples only", re.redrawn === 1 && recs.get(q.item + ".b.opus.1~u")?.final_action === "SEND" && finalRecords(recs).length === samples.length],
      ["every sample sealed once", res.ran === samples.length && recs.size === samples.length + 1],
    ];
    const close = settleLease(record, local, leaseId);
    local.close();
    const bad = want.filter(([, ok]) => !ok).map(([n]) => n);
    if (close.spent_micros <= 0) bad.push("the lease settled with no spend");
    return bad.length ? bad.join("; ") : true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Replicates in sequence: at full concurrency on a temporary ledger, replicate 2 of a cell starts only after replicate 1 is sealed (an UPSTREAM MISSING included), cells run in parallel, and every Anthropic body ends its system prefix and its user content in a cache breakpoint. */
async function replicateOrder(items: AskItem[]): Promise<string | true> {
  const dir = mkdtempSync(join(tmpdir(), "ask-dry-order-"));
  try {
    const byId = new Map(items.map((i) => [i.item, i]));
    const events: string[] = [];
    const bodies: Array<Record<string, any>> = [];
    let live = 0;
    let peak = 0;
    const base = stubSend((s) => (s.arm === "b" && s.replicate === 1 ? { raw: "upstream" } : { action: "SEND", repeats: "new" }));
    const send = async (s: Sample, key: CallKey, body: Record<string, unknown>) => {
      events.push("start " + s.id);
      bodies.push(body);
      peak = Math.max(peak, ++live);
      await new Promise((r) => setTimeout(r, 1 + ((s.replicate * 7 + s.arm.charCodeAt(0)) % 5)));
      live--;
      return base(s, key);
    };
    const { local, leaseId, record } = lease(dir, FROZEN.spend_items.I6!);
    const samples = schedule(items.slice(0, 6), "opus", FROZEN.replicates.k, 11);
    const plain = plainStore(join(dir, "replies"));
    const store = { has: (id: string) => plain.has(id), write: (id: string, r: SampleRecord) => (events.push("seal " + id), plain.write(id, r)) };
    await runShard({ items: byId, samples, gstack: FIXTURE_GSTACK, client: ledgerClient({ local, leaseId, runId: FROZEN.spend_items.I6!, maxOutputTokens: FROZEN.output_cap.tokens, send }), store, out: join(dir, "out"), maxOutputTokens: FROZEN.output_cap.tokens, sleep: async () => {}, concurrency: FROZEN.shards.concurrency });
    settleLease(record, local, leaseId);
    local.close();
    const late = samples.filter((s) => s.replicate > 1 && events.indexOf("start " + s.id) < events.indexOf("seal " + sampleId(s.item, s.arm, s.model, s.replicate - 1)));
    if (late.length) return late.length + " replicates started before the replicate before them was sealed";
    if (!samples.some((s) => s.replicate > 1)) return "no cell had a second replicate";
    if (peak < 2) return "cells did not run in parallel";
    const cached = bodies.every((b) => b.system?.[0]?.cache_control?.type === "ephemeral" && b.messages?.[0]?.content?.[0]?.cache_control?.type === "ephemeral");
    return cached ? true : "an Anthropic body lacks a cache breakpoint";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The labeller calls: audit on Opus and Astra and linking on Opus through the driver on temporary ledgers, then the label readout. */
async function labelCheck(items: AskItem[]): Promise<string | true> {
  const dir = mkdtempSync(join(tmpdir(), "ask-dry-label-"));
  try {
    checkCodebook();
    const byId = new Map(items.map((i) => [i.item, i]));
    const flip = items.find((i) => i.label === "DUPLICATE")!;
    const bodies: Array<Record<string, any>> = [];
    const script = (s: Sample) => {
      const it = byId.get(s.item)!;
      const rows = ledgerRows(it);
      const m = s1Match(it);
      return { class: s.model === "astra" && it === flip ? "DECISION" : it.label, repeats_of: it.label === "DUPLICATE" && m ? rows.findIndex((r) => r.order === m.order) + 1 : null, answer_judgement: rows.flatMap((r, i) => (r.status === "answered" ? [{ row: i + 1, answers: "yes" as const }] : [])) } as Partial<LabelReply>;
    };
    const store = plainStore(join(dir, "labels"));
    for (const [kind, model] of [["audit", "opus"], ["audit", "astra"], ["link", "opus"]] as const) {
      const sub = join(dir, kind + "-" + model);
      mkdirSync(sub);
      const spend = FROZEN.spend_items[FROZEN.labelling.kinds[kind].spend_item]!;
      const { local, leaseId, record } = lease(sub, spend);
      await runShard({ items: byId, samples: labelSamples(items, kind, model), gstack: null, client: ledgerClient({ local, leaseId, runId: spend, maxOutputTokens: FROZEN.output_cap.tokens, send: labelSend(script, [], bodies) }), store, out: join(sub, "out"), maxOutputTokens: FROZEN.output_cap.tokens, sleep: async () => {}, job: labelJob });
      settleLease(record, local, leaseId);
      local.close();
    }
    const r = labelReadout(items, finalRecords(store.read()));
    const dupLinks = items.filter((i) => i.label === "DUPLICATE" && s1Match(i)).length;
    const bad: string[] = [];
    if (!bodies.every((b) => JSON.stringify(b).includes(JSON.stringify(CODEBOOK).slice(1, 200)) && !items.some((i) => JSON.stringify(b).includes(i.item)))) bad.push("a labeller body lacks the codebook or names an item id");
    if (r.summary.audited !== items.length || !r.summary.kappa || r.summary.kappa.labellers.opus.pooled !== 1 || r.summary.kappa.labellers.astra.duplicate === 1) bad.push("kappa " + JSON.stringify(r.summary.kappa));
    if (r.links?.length !== dupLinks || r.summary.links.astra_agreement !== 1) bad.push("links " + JSON.stringify(r.summary.links));
    if (r.summary.answer_judgement.judged_answer_share !== 1 || r.views[0]?.items.length !== items.length - 1) bad.push("judgements or views");
    return bad.length ? bad.join("; ") : true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function resumeCheck(items: AskItem[]): Promise<string | true> {
  const dir = mkdtempSync(join(tmpdir(), "ask-dry-resume-"));
  try {
    const byId = new Map(items.map((i) => [i.item, i]));
    const samples = schedule(items.slice(0, 2), "sol", 1, 11);
    const { local, leaseId, record } = lease(dir, FROZEN.spend_items.I7!);
    const calls: string[] = [];
    let n = 0;
    const killAt = 5;
    const send = stubSend(() => (++n === killAt ? { raw: "kill" } : { action: "SEND", repeats: "new" }), calls);
    const store = plainStore(join(dir, "replies"));
    const o: ShardOptions = { items: byId, samples, gstack: FIXTURE_GSTACK, client: ledgerClient({ local, leaseId, runId: FROZEN.spend_items.I7!, maxOutputTokens: FROZEN.output_cap.tokens, send }), store, out: join(dir, "out"), maxOutputTokens: FROZEN.output_cap.tokens, sleep: async () => {}, concurrency: 1 };
    let killed = false;
    try {
      await runShard(o);
    } catch (e) {
      killed = e instanceof Killed;
    }
    const warned: string[] = [];
    const res = await runShard({ ...o, warn: (c) => warned.push(c) });
    const meters = local.meters(leaseId);
    const keys = [...meters.keys()];
    const unknown = [...meters.values()].filter((m) => m.unknown_calls > 0).length;
    const bad: string[] = [];
    if (!killed) bad.push("the first shard was not killed");
    if (res.skipped !== killAt - 1) bad.push("the resumed shard skipped " + res.skipped + " sealed samples, not " + (killAt - 1));
    if (Object.values(res.redrawn).reduce((a, b) => a + b, 0) !== 1) bad.push("redraws were not exactly one");
    if (!warned.includes("E_ASK_RESUME")) bad.push("no E_ASK_RESUME warning");
    if (new Set(calls).size !== calls.length) bad.push("a call key was sent twice");
    if (keys.length !== calls.length) bad.push(keys.length + " ledger reservations for " + calls.length + " calls");
    if (unknown !== 1) bad.push(unknown + " reservations settled unknown, not 1");
    if (store.read().size !== samples.length) bad.push("not every sample sealed after the resume");
    settleLease(record, local, leaseId);
    local.close();
    return bad.length ? bad.join("; ") : true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function capCheck(items: AskItem[]): Promise<string | true> {
  const dir = mkdtempSync(join(tmpdir(), "ask-dry-cap-"));
  try {
    const { local, leaseId, record } = lease(dir, FROZEN.spend_items.I6!, 1000);
    const samples = schedule(items.slice(0, 1), "opus", 1, 3);
    const o: ShardOptions = { items: new Map(items.map((i) => [i.item, i])), samples, gstack: FIXTURE_GSTACK, client: ledgerClient({ local, leaseId, runId: FROZEN.spend_items.I6!, maxOutputTokens: FROZEN.output_cap.tokens, send: stubSend(() => ({ action: "SEND" })) }), store: plainStore(join(dir, "replies")), out: join(dir, "out"), maxOutputTokens: FROZEN.output_cap.tokens, sleep: async () => {}, concurrency: 1 };
    const res = await runShard(o);
    settleLease(record, local, leaseId);
    local.close();
    return res.stopped === "cap" && res.ran === 0 ? true : "the shard did not stop on the cap (" + res.stopped + ")";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function leaseCheck(): string | true {
  const dir = mkdtempSync(join(tmpdir(), "ask-dry-ledger-"));
  try {
    const failed: string[] = [];
    const items = Object.values(FROZEN.spend_items);
    for (const item of items) {
      try {
        const { local, leaseId, record } = lease(dir, item);
        try {
          settleLease(record, local, leaseId);
        } finally {
          local.close();
        }
      } catch (e) {
        failed.push(item + " (" + (e as Error).message.split("\n")[0] + ")");
      }
    }
    const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite"), {}));
    let code = "";
    try {
      openLease(join(dir, "record"), local, { item: FROZEN.spend_items.I6!, run_id: "another-run" });
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    } finally {
      local.close();
    }
    if (code !== "E_ITEM_BOUND") failed.push("a second run was not refused (" + (code || "no refusal") + ")");
    return failed.length ? failed.join("; ") : true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function custodyCheck(): Promise<string | true> {
  const shm = mkdtempSync(join("/dev/shm", "ask-dry-shm-"));
  const dir = mkdtempSync(join(tmpdir(), "ask-dry-custody-"));
  try {
    const { identity, recipient } = keygen();
    const plain = join(shm, "items.jsonl");
    writeFileSync(plain, '{"probe":1}\n');
    const sums = join(dir, "SHA256SUMS");
    const sealed = seal(plain, recipient, { sums });
    const bad: string[] = [];
    if (!gone(plain)) bad.push("the plaintext stayed after sealing");
    mkdirSync(join(shm, "ask-custody-leftover"), { recursive: true });
    const log = join(dir, "CUSTODY.md");
    let seen = "";
    let during = false;
    await custody({ files: [sealed.path], sums, log, identity, shm, sweep: [dir] }, async (d) => {
      await new Promise((r) => setTimeout(r, 20));
      seen = readFileSync(join(d, "items.jsonl"), "utf8");
      during = existsSync(d);
    });
    if (seen !== '{"probe":1}\n') bad.push("the decrypted text did not match");
    if (!during) bad.push("the directory was gone before the async reader finished");
    const text = readFileSync(log, "utf8");
    if (!/incident: removed a leftover/.test(text)) bad.push("the leftover was not swept and logged");
    if (!/identity removed \(test ! -e passed\)/.test(text) || !/test ! -e passed\), sweep/.test(text)) bad.push("the teardown proof lines are missing");
    if (existsSync(join(shm, "ask-custody-leftover"))) bad.push("the leftover is still on disk");
    const store = sealedStore(join(dir, "replies"), recipient);
    store.write("x.a.opus.1", { probe: true } as unknown as SampleRecord);
    const rs = writeSums(join(dir, "replies"));
    const back = await custody({ files: [join(dir, "replies", "x.a.opus.1.ask.json.age")], sums: rs, log, identity, shm, sweep: [dir] }, (d) => readRecords(d));
    if (!(back.get("x.a.opus.1") as unknown as { probe?: boolean })?.probe) bad.push("a sealed reply did not round-trip");
    const empty = join(dir, "empty");
    writeFileSync(empty, "");
    const fd = openSync(empty, "r");
    let code = "";
    try {
      readIdentity(fd);
    } catch (e) {
      code = e instanceof AskError ? e.code : "";
    } finally {
      closeSync(fd);
    }
    if (code !== "E_ASK_IDENTITY") bad.push("an empty identity was not refused");
    return bad.length ? bad.join("; ") : true;
  } finally {
    rmSync(shm, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Scripted outcomes on the whole synthetic set: (b) sends every needless item, (c) and (d) fold them, every arm sends must-asks. */
function scriptedOutcomes(items: AskItem[]): Outcome[] {
  const out: Outcome[] = [];
  for (const model of ["opus", "sol"] as const) for (const it of items) for (const arm of ["a", "b", "c", "d"] as const) for (const replicate of [1, 2]) {
    const needless = it.label !== "DECISION";
    const action = !needless ? "SEND" : arm === "a" || arm === "b" ? "SEND" : "FOLD";
    out.push({ item: it.item, arm, model, replicate, missing: null, agent_action: action, final_action: action, repeats: arm === "c" || arm === "d" ? "new" : "not_asked", reask_reason: false, gate: "none", reason: "scripted" });
  }
  return out;
}

export function checks(o: { gstack: GstackText | null; clone?: string }): Check[] {
  const g = generate();
  const items = g.items;
  const gstack = o.gstack ?? FIXTURE_GSTACK;
  const list: Check[] = [];
  if (o.clone !== undefined) list.push({ name: "gstack pins: the three files at " + FROZEN.gstack.commit.slice(0, 7) + " match frozen.json's sha256", run: () => (loadGstack(o.clone!), true) });
  list.push(
    { name: "synthetic set: the generator reproduces items.jsonl (60 items: 35 DECISION, 20 DUPLICATE, 3 PERMISSION_FOR_DEFAULT, 2 OBSERVABLE)", run: () => {
      const c = g.counts.per_class;
      if (!existsSync(SYNTH)) return "items.jsonl is missing";
      if (readFileSync(SYNTH, "utf8") !== g.jsonl) return "items.jsonl differs from the generator";
      if (FROZEN.synthetic.sha256 !== g.sha256) return "frozen.json synthetic.sha256 differs";
      return c.DECISION === 35 && c.DUPLICATE === 20 && c.PERMISSION_FOR_DEFAULT === 3 && c.OBSERVABLE === 2 ? true : "class mix " + JSON.stringify(c);
    } },
    { name: "synthetic set: no secret or contact hits, issue keys, thread codes or dollar figures", run: () => {
      const c = emptyCount();
      for (const t of items.flatMap(itemTexts)) redact(t, c);
      const s = scanPublic(g.jsonl);
      return c.hits === 0 && s.codes === 0 && s.dollars === 0 ? true : "scan " + c.hits + ", codes " + s.codes + ", dollars " + s.dollars;
    } },
    { name: "prompts: every arm on every synthetic item keeps the frozen component order", run: () => {
      for (const it of items) for (const arm of ["a", "b", "c", "d"] as const) {
        const names = buildPrompt(it, arm, gstack).components.map((c) => c.name);
        const want = ORDER.filter((n) => (n !== "arm" || arm !== "a") && (n !== "ledger" || arm === "c" || arm === "d"));
        if (names.join() !== want.join()) return "arm " + arm + ": " + names.join(",");
      }
      return true;
    } },
    { name: "prompts: no label, item id, thread code or after_reply text in any prompt", run: () => {
      for (const it of items) for (const arm of ["a", "b", "c", "d"] as const) {
        const p = buildPrompt(it, arm, gstack);
        if (/DECISION|DUPLICATE|PERMISSION_FOR_DEFAULT|OBSERVABLE/.test(p.user)) return "a label in arm " + arm;
        if ((p.system + p.user).includes(it.item) || new RegExp("\\b" + it.thread + "\\b").test(p.user)) return "an item id or thread code in arm " + arm;
        if (it.after_reply && !it.conversation.some((m) => m.text === it.after_reply!.text) && p.user.includes(it.after_reply.text)) return "after_reply in arm " + arm;
      }
      return true;
    } },
    { name: "prompts: harness, capability and arm a hold no gstack line of 40+ characters and no gstack token", run: () => {
      const p = buildPrompt(items[0]!, "a", gstack);
      const text = HARNESS + "\n" + CAPABILITY + "\n" + p.system;
      return gstackLines(text, gstack) === 0 && !/gstack/i.test(text) ? true : "arm a text holds gstack prose";
    } },
    { name: "prompts: arm d is arm a plus exactly arm c's ledger parts, and arm c is arm b plus the same parts", run: () => {
      for (const it of items) {
        const a = buildPrompt(it, "a", gstack).components;
        const b = buildPrompt(it, "b", gstack).components;
        const c = buildPrompt(it, "c", gstack).components;
        const d = buildPrompt(it, "d", gstack).components;
        const ledgerPart = c.find((x) => x.name === "ledger")!;
        const without = (xs: typeof a) => xs.filter((x) => x.name !== "ledger" && x.name !== "arm");
        if (JSON.stringify(without(d)) !== JSON.stringify(without(a)) || d.find((x) => x.name === "arm")!.text !== LEDGER_ADDENDUM || JSON.stringify(d.find((x) => x.name === "ledger")) !== JSON.stringify(ledgerPart)) return "arm d differs from a plus the ledger parts";
        if (JSON.stringify(without(c)) !== JSON.stringify(without(b)) || c.find((x) => x.name === "arm")!.text !== b.find((x) => x.name === "arm")!.text + "\n\n" + LEDGER_ADDENDUM) return "arm c differs from b plus the ledger parts";
      }
      return true;
    } },
    { name: "ledger: K1 status and every send-time rule on scripted replies", run: () => {
      const it = items.find((i) => i.earlier_asks.some((e) => e.next_owner) && i.earlier_asks.some((e) => !e.next_owner));
      if (!it) return "no synthetic item has both an open and an answered row";
      const rows = ledgerRows(it);
      const ans = rows.find((r) => r.status === "answered")!;
      const opn = rows.find((r) => r.status === "open")!;
      const cases: Array<[string, ReturnType<typeof sendCheck>, string, string]> = [
        ["SEND on answered", sendCheck({ action: "SEND", reason: "", repeats: ans.id }, rows), "DROP", "drop_answered"],
        ["FOLD on answered", sendCheck({ action: "FOLD", reason: "", repeats: ans.id }, rows), "DROP", "drop_answered"],
        ["whitespace reask", sendCheck({ action: "SEND", reason: "", repeats: ans.id, reask_reason: " \n " }, rows), "DROP", "drop_answered"],
        ["reask reason", sendCheck({ action: "SEND", reason: "", repeats: ans.id, reask_reason: "new facts" }, rows), "SEND", "reask_kept"],
        ["SEND on open", sendCheck({ action: "SEND", reason: "", repeats: opn.id }, rows), "FOLD", "fold_open"],
        ["DROP on answered", sendCheck({ action: "DROP", reason: "", repeats: ans.id }, rows), "DROP", "none"],
        ["missing field", sendCheck({ action: "SEND", reason: "" }, rows), "SEND", "none"],
        ["unknown id", sendCheck({ action: "SEND", reason: "", repeats: "q-ffffffffffff" }, rows), "SEND", "none"],
      ];
      const bad = cases.filter(([, r, act, gate]) => r.final_action !== act || r.gate !== gate).map(([n]) => n);
      return bad.length ? bad.join(", ") : true;
    } },
    { name: "parse: whole JSON, the last valid object in prose, case-insensitive action, and each provider's safety stop", run: () => {
      const ok = parseReply('{"action":"fold","reason":"x"}')?.action === "FOLD" && parseReply('Thinking {"action":"SEND"} then {"action":"DROP","reason":"y"} done')?.action === "DROP" && parseReply('{"action":"maybe"}') === null;
      const safe = classify("anthropic", { status: 200, body: { stop_reason: "refusal", content: [] } }).kind === "safety" && classify("openai", { status: 200, body: { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] } }).kind === "safety" && classify("openrouter", { status: 200, body: { choices: [{ finish_reason: "content_filter", message: { content: "" } }] } }).kind === "safety";
      const up = classify("openai", { status: 503, body: {} }).kind === "upstream" && classify("openai", null).kind === "upstream";
      return ok && safe && up ? true : "parse " + ok + ", safety " + safe + ", upstream " + up;
    } },
    { name: "run: the scripted stub through the driver on a temporary ledger, every reply path", run: () => scriptedRun(items) },
    { name: "labels: the codebook pin, Opus and Astra audit labels and Opus links through the driver on temporary ledgers, kappa, chains from the links, answer judgements and the label views", run: () => labelCheck(items) },
    { name: "run: each cell's replicates run in sequence (replicate 2 starts after replicate 1 is sealed), cells in parallel, and Anthropic requests cache the system prefix and the user content", run: () => replicateOrder(items) },
    { name: "draws: the pilot takes 16 must-ask and 24 needless by class and thread, the label audit 40 must-ask, 40 duplicates and every permission and observable item, and a seed redraws the same set", run: () => {
      const pool = Array.from({ length: 7 }, (_, n) => items.map((it) => ({ ...it, item: it.item + "-" + n }))).flat();
      const p = drawCounts(pilotDraw(pool, 3));
      const a = drawCounts(auditDraw(pool, 3));
      if (p.items !== 40 || p.per_class.DECISION !== 16) return "pilot " + JSON.stringify(p.per_class);
      if (a.per_class.DECISION !== 40 || a.per_class.DUPLICATE !== 40 || a.per_class.PERMISSION_FOR_DEFAULT !== 21 || a.per_class.OBSERVABLE !== 14) return "audit " + JSON.stringify(a.per_class);
      return JSON.stringify(pilotDraw([...pool].reverse(), 3)) === JSON.stringify(pilotDraw(pool, 3)) && JSON.stringify(auditDraw([...pool].reverse(), 3)) === JSON.stringify(auditDraw(pool, 3)) ? true : "the same seed drew a different set";
    } },
    { name: "ledger leases: one lease opens and settles on each frozen spend item, and an item that served one run refuses a second (E_ITEM_BOUND)", run: leaseCheck },
    { name: "resume: a killed shard resumes with sealed samples skipped, the open call settled unknown and redrawn once, no call counted twice", run: () => resumeCheck(items) },
    { name: "cap: a spend cap stop ends the shard as incomplete (E_ASK_CAP)", run: () => capCheck(items) },
    { name: "custody: seal and open on a throwaway age identity with an async reader, leftover swept, teardown proved, empty identity refused", run: custodyCheck },
    { name: "score: each decision row on interval fixtures, including (a) clearly better, (c) clearly worse, a cut with a failed guard and the trim half", run: () => {
      const bad = Object.entries(DECISION_FIXTURES).filter(([, f]) => { const d = decide({ opus: f.opus, sol: f.sol }); return d.row !== f.row || d.cut_candidate !== f.cut_candidate; }).map(([n]) => n);
      return bad.length ? bad.join(", ") : true;
    } },
    { name: "score: both codings and the MISSING bounds on fixed samples", run: () => {
      const dupA = { label: "DUPLICATE" as const, answered_dup: true };
      const dupO = { label: "DUPLICATE" as const, answered_dup: false };
      const must = { label: "DECISION" as const, answered_dup: null };
      const s = (info: typeof dupA | typeof dupO | typeof must, a: "SEND" | "FOLD" | "DROP", c: "primary" | "secondary") => sampleScore(info, { missing: null, final_action: a }, c);
      const ok = s(dupA, "FOLD", "primary") === 0 && s(dupA, "FOLD", "secondary") === 1 && s(dupO, "FOLD", "secondary") === 0 && s(must, "FOLD", "primary") === 1 && s(must, "FOLD", "secondary") === 0 && s(must, "DROP", "secondary") === 1 && sampleScore(must, { missing: "parse", final_action: null }, "primary") === null;
      return ok ? true : "a coding rule did not hold";
    } },
    { name: "stats: planned detectable differences of 8.3 and 8.9 points, the 3.4-point half-width, and the pilot bar at about 9% and 54%", run: () => {
      const v = [r1(mdd(0.35, 140)), r1(mdd(0.35, 121)), r1(halfWidth(0.25, 206)), Math.round(admitChance(0.1, 24, 5) * 100), Math.round(admitChance(0.2, 24, 5) * 100)];
      return v.join() === "8.3,8.9,3.4,9,54" ? true : v.join();
    } },
    { name: "chains: the proxy linker links every synthetic duplicate and S1 runs on every draft", run: () => {
      const links = proxyLinks(items);
      const st = chainStats(items, clusters(items, links));
      return links.length === 20 && st.clusters < items.length ? true : links.length + " links, " + st.clusters + " clusters";
    } },
    { name: "score: the full readout on scripted outcomes for the synthetic set reads row 1, build and trim", run: () => {
      const r = readout(items, scriptedOutcomes(items), { links: proxyLinks(items), seed: 20261115, draws: 2000 });
      return r.decision.row === "build and trim" ? true : "row " + r.decision.row;
    } },
    { name: "build: fixture pages, audit and rules into items, with the scan's placeholder and counts", run: () => {
      const b = buildFrom(buildFixture());
      const c = b.counts;
      const bad: string[] = [];
      if (c.items !== 3 || c.dropped.unreadable !== 1 || c.not_ask_rows !== 1) bad.push("item counts " + JSON.stringify([c.items, c.dropped, c.not_ask_rows]));
      if (c.scan.hits !== 3) bad.push("scan hits " + c.scan.hits);
      if (c.rules.placed !== 1 || c.rules.dropped !== 1) bad.push("rules " + JSON.stringify(c.rules));
      if (b.items.some((i) => JSON.stringify(i).includes("never read"))) bad.push("a note reached an item");
      if (!b.items[1]!.draft.includes("[redacted]")) bad.push("the planted key was not replaced");
      if (b.items[2]!.earlier_asks.length !== 2 || b.items[2]!.earlier_asks[1]!.next_owner !== null) bad.push("earlier asks");
      const v = buildFrom({ ...buildFixture(), variant: true });
      if (v.counts.crew_messages === 0) bad.push("the variant bundle has no crew message");
      return bad.length ? bad.join("; ") : true;
    } },
  );
  return list;
}

export async function dryRun(o: { gstack: GstackText | null; clone?: string }): Promise<Line[]> {
  const out: Line[] = [];
  for (const c of checks(o)) {
    try {
      const r = await c.run();
      out.push({ name: c.name, state: r === true ? "PASS" : "FAIL", detail: r === true ? "" : r });
    } catch (e) {
      out.push({ name: c.name, state: "FAIL", detail: "threw " + (e as Error).message.split("\n")[0] });
    }
  }
  return out;
}

export async function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): Promise<number> {
  let clone = join(process.env.HOME ?? "", ".local/share/gstack");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--gstack" && argv[i + 1]) clone = argv[++i]!;
    else throw new AskError("E_USAGE", "usage: gstack-evals ask-replay dryrun [--gstack <clone>]");
  }
  let gstack: GstackText | null = null;
  try {
    gstack = loadGstack(clone);
  } catch {}
  const lines = await dryRun({ gstack, clone });
  for (const l of lines) io.out(l.state + " " + l.name + (l.detail ? " (" + l.detail + ")" : ""));
  const fails = lines.filter((l) => l.state === "FAIL").length;
  io.out("ask-replay dryrun: " + (lines.length - fails) + " PASS, " + fails + " FAIL");
  if (fails) io.err("E_ASK_DRYRUN_FAIL ask-replay dryrun: " + fails + " checks failed");
  return fails ? 1 : 0;
}
