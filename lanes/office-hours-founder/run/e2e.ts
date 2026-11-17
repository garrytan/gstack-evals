// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's paid path end to end, keyless, on this machine with Docker (the Captain's requirement
// after a stop where supply was counted outside the frozen sandbox). It drives two hand-written fixture founders through
// the real path: a temporary ledger with an item per paid line (runs and simulator), the real Docker rig with the real arm
// images (none, lens and office-hours at the gstack pin) and the real proxy container, a stub model server on this host
// behind that proxy through the proxy's test-only upstream override, the session loop (run.ts runSchedule) with a
// stub-backed simulator spending through the product-value meter on the simulator item, the parser and the rows.
//   fx-answer, none          the stub answers at once with a block.
//   fx-answer, office-hours  the stub reads the skill's phase-2a file, asks two questions, then writes a block.
//   fx-never, none           the stub never writes a block, so the closing message goes after the 20th founder reply.
//   fx-never, lens (pitch)   the pitch-only cell's limit of 0: the closing message is the first founder message.
// Every key variable is removed from this process before anything starts; the only key-shaped values are placeholders
// the proxy container and the simulator's meter hand the stub. It prints one PASS or FAIL line per check. The real
// simulator, packets and scorer come in later through the founder and after options.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { sse, type Block } from "../../../quick/laneb/runner/fake_upstream.ts";
import { parseStackRef } from "../../../src/skill-eval/cli/arms.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { dockerRig, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { stackKind } from "../../../src/arms/stacks.ts";
import { readJournalLines } from "../../../src/trial/review/cost.ts";
import type { ArmSpec } from "../../../src/types.ts";
import { openMeter, type CallRequest, type CallResult } from "../../product-value/meter.ts";
import { CLOSING, DENIED_TOOLS, FIRST_LINE, GSTACK, MODEL_KEYS } from "../frozen.ts";
import type { ManifestEntry, Sheet, UnitMeta } from "../types.ts";
import { meterSlot, PRE_SMOKE, runSchedule, type RunDeps, type RunResult } from "./run.ts";
import { readRows, rowProblems } from "./rows.ts";
import type { FounderTurnFn, PersonSheet } from "./session.ts";

export interface Check {
  check: string;
  ok: boolean;
  detail: string;
}

type Call = (req: CallRequest) => Promise<CallResult>;

export interface E2eOptions {
  keep?: boolean;
  /** The simulator; the stub-backed founder below unless the parent wires the real one. */
  founder?: FounderTurnFn<PersonSheet, Call>;
  /** The scorer's exposure read. The end to end runs the smoke cell, which has no interim stop. */
  exposed?: RunDeps<Call>["exposed"];
  /** Post-row steps (packets, scoring) with their own checks. */
  after?: (o: { run: RunResult; out: string; unitsDir: string }) => Promise<Check[]>;
  log?: (line: string) => void;
}

const D = 1_000_000;
const FENCE = "\u0060\u0060\u0060";
const PHASE_2A = "office-hours/sections/phase-2a-startup-diagnostic.md";
const UNITS: Record<string, { opening: string; sheet: Sheet }> = {
  "fx-answer": {
    opening: "I'm building Plotline, a booking page that lets community gardens hand out watering shifts to volunteers. Two gardens in my town use a shared spreadsheet today and keep missing shifts in the summer.",
    sheet: { persona: "A first-time founder who runs a volunteer group and writes simple web apps on weekends.", facts: [
      { id: "f1", text: "Both garden leads told me they would pay ten dollars a month if missed shifts went away.", reveal_when: "Asked who would pay or what it is worth.", kind: "payment" },
      { id: "f2", text: "The east garden lost a whole bed of tomatoes last July when nobody watered for four days.", reveal_when: "Asked what goes wrong today.", kind: "status-quo" },
      { id: "f3", text: "I already text reminders by hand to eleven volunteers every Sunday night.", reveal_when: "Asked what they have tried.", kind: "attempt" },
    ] },
  },
  "fx-never": {
    opening: "I want to build Tallyroom, a sensor kit that counts free seats in campus study halls and shows them on a phone map.",
    sheet: { persona: "A graduate student who has built two hardware prototypes in a campus lab.", facts: [
      { id: "g1", text: "The library staff asked me twice for a seat count they could put on their front page.", reveal_when: "Asked who wants it.", kind: "demand" },
      { id: "g2", text: "My first prototype ran for three weeks on one battery in the east reading room.", reveal_when: "Asked what they have built.", kind: "attempt" },
    ] },
  },
};
const BLOCK = "Here is my advice.\n\n" + FENCE + "first-move\n" + JSON.stringify({ first_move: "Sell Plotline's shift reminders to the two garden leads for ten dollars a month, by hand first.", next_action: "Ask both garden leads to pay for July this week.", other_moves: ["Build the full booking page first."], doubt: "That volunteers will open the page at all." }) + "\n" + FENCE;

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const KEY_VAR = /(^|_)(API_)?KEY$|_TOKEN$|SECRET|PASSWORD/;

/** Founder replies the stub simulator sent, by reply text, with the ids it said it revealed. */
const SIM_REPLY = /FOUNDER-REPLY (\d+)/g;
/** Where the real simulator's system text puts the sheet (src/persona-sim/sim.ts renderSystem). */
const SHEET = "The sheet:\n";

export async function runE2e(o: E2eOptions = {}): Promise<{ checks: Check[]; dir: string }> {
  const log = o.log ?? ((l: string) => console.error(l));
  for (const k of Object.keys(process.env)) if (KEY_VAR.test(k)) delete process.env[k];
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ check: name, ok, detail });
    console.log((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  mkdirSync(join(homedir(), ".capy", "work"), { recursive: true });
  const W = mkdtempSync(join(homedir(), ".capy", "work", "of-e2e-"));
  const unitsDir = join(W, "units");
  let draw = 0;
  for (const [id, u] of Object.entries(UNITS)) {
    mkdirSync(join(unitsDir, id), { recursive: true });
    writeFileSync(join(unitsDir, id, "opening.md"), u.opening + "\n");
    writeFileSync(join(unitsDir, id, "sheet.json"), JSON.stringify(u.sheet, null, 2) + "\n");
    const meta: UnitMeta = { id, stratum: "constructed", set: "calibration", draw: ++draw, author: "sol", shape: "s1", type: "other", industry: "fixture", primary: ["customer"], mentioned: [], generic: [], founder_stage: "pre-product", digest: sha256(u.opening + JSON.stringify(u.sheet)) };
    writeFileSync(join(unitsDir, id, "unit.json"), JSON.stringify(meta, null, 2) + "\n");
  }
  const entries: ManifestEntry[] = [
    { stage: 1, kind: "arm", unit: "fx-answer", model: "opus", arm: "none", pass: 1 },
    { stage: 1, kind: "arm", unit: "fx-answer", model: "opus", arm: "office-hours", pass: 1 },
    { stage: 1, kind: "arm", unit: "fx-never", model: "opus", arm: "none", pass: 1 },
    { stage: 2, kind: "pitch", unit: "fx-never", model: "opus", arm: "lens", pass: 1 },
  ];

  let phase2a = "";
  const main: { tools: string[]; text: string }[] = [];
  let viaProxy = 0;
  const revealedBy = new Map<string, string[]>();
  const founderText = (body: any): string => JSON.stringify(body.messages ?? []);
  const script = (body: any): Block[] => {
    const text = founderText(body);
    const founders = new Set([...text.matchAll(SIM_REPLY)].map((m) => m[1])).size;
    if (text.includes("Tallyroom")) return [{ type: "text", text: "What else can you tell me about the study halls?" }];
    if (!text.includes("/office-hours")) return [{ type: "text", text: BLOCK }];
    if (!text.includes("toolu_of_e2e_read")) return [{ type: "tool_use", id: "toolu_of_e2e_read", name: "Read", input: { file_path: phase2a } }];
    if (founders === 0) return [{ type: "text", text: "Q1: Who has asked you for this most directly?" }];
    if (founders === 1) return [{ type: "text", text: "Q2: What do the gardens do today when a shift is missed?" }];
    return [{ type: "text", text: BLOCK }];
  };
  const stub = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return Response.json({});
      const body = (await req.json()) as any;
      if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      if (path.endsWith("/chat/completions")) {
        const system = body.messages[0]?.role === "system" ? String(body.messages[0].content) : null;
        const sheetText = system ? system.slice(system.indexOf(SHEET) + SHEET.length, system.lastIndexOf("}") + 1) : "";
        const asked = system
          ? { facts: (JSON.parse(sheetText) as { facts: { id: string; text: string }[] }).facts, n: body.messages.filter((m: any) => m.role === "assistant").length + 1 }
          : ((a: { sheet: PersonSheet; transcript: { role: string }[] }) => ({ facts: a.sheet.facts, n: a.transcript.filter((l) => l.role === "person").length + 1 }))(JSON.parse(body.messages[0].content));
        const n = asked.n;
        const fact = asked.facts[n % asked.facts.length]!;
        const reply = "FOUNDER-REPLY " + n + ": " + fact.text;
        revealedBy.set(reply, [fact.id]);
        return Response.json({ id: "gen-of-e2e", provider: "google-vertex", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ reply, revealed: [fact.id], rules: [3] }) }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 } });
      }
      viaProxy++;
      const tools = Array.isArray(body.tools) ? body.tools.map((t: any) => t.name ?? t.type) : [];
      const blocks: Block[] = tools.includes("Bash") ? script(body) : [{ type: "text", text: "ok" }];
      if (tools.includes("Bash")) main.push({ tools, text: founderText(body) });
      if (body.stream) return new Response(sse(body.model, blocks), { headers: { "content-type": "text/event-stream" } });
      return Response.json({ id: "msg_of_e2e", type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    },
  });
  const founder: FounderTurnFn<PersonSheet, Call> = o.founder ?? (async ({ sheet, transcript, call }) => {
    const r = await call({ model: "gemini", prompt: JSON.stringify({ sheet, transcript }), maxTokens: 1200, effort: "medium", label: "founder" });
    if (r.text === null) return /^E_ALLOWANCE/.test(r.problem ?? "") ? { kind: "call-failed", reason: "allowance", detail: r.problem! } : { kind: "call-failed", reason: "provider", detail: r.problem ?? "no text" };
    const j = JSON.parse(r.text) as { reply: string; revealed: string[]; rules: number[] };
    return { kind: "reply", reply: j.reply, revealed: j.revealed, rules: j.rules, attempts: 1 };
  });

  const record = join(W, "record");
  const ledger = join(W, "ledger.sqlite");
  const quote = { words: "keyless end-to-end run on a temporary ledger, not an approval", by: "of e2e", source: "lanes/office-hours-founder/run/e2e.ts" };
  const items = { runs: "of-e2e-runs", sim: "of-e2e-sim" };
  for (const item of Object.values(items)) recordApproval(record, { action: "init", item, cap_micros: 120 * D, quotes: [quote], admission: "warn" });
  const env: Record<string, string | undefined> = { ...process.env, ANTHROPIC_API_KEY: "stub-not-a-key" };
  const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
  const runId = "of-e2e-" + randomBytes(4).toString("hex");
  const out = join(W, "out");
  mkdirSync(join(W, "fixtures"), { recursive: true });
  writeFileSync(join(W, "fixtures", "tasks.json"), "[]\n");
  const stack = parseStackRef(GSTACK.repo + "@" + GSTACK.sha);
  if (typeof stack === "string") throw new Error("E_INTERNAL " + stack);
  const arms: ArmSpec[] = [{ name: "none", kind: "bare" }, { name: "lens", kind: "bare" }, { name: "office-hours", kind: "stack", stack, install: { ...stackKind(stack)?.install } }];
  const meter = await openMeter({ item: items.sim, runId, out: join(W, "sim-meter"), cacheDir: join(W, "sim-cache"), maxOutputTokens: 1200, amountMicros: 20 * D, record, ledger, env: { OPENROUTER_API_KEY: "stub-not-a-key" }, fetch: ((url: string | URL | Request, init?: RequestInit) => fetch(String(url).replace(/^https:\/\/openrouter\.ai\/api/, "http://127.0.0.1:" + stub.port), init)) as typeof fetch });
  const rigSeen: { egress: { open: boolean; detail: string } | null; journal: string } = { egress: null, journal: "" };
  let run: RunResult | null = null;
  try {
    run = await runSchedule({ cell: "smoke", unitsDir, out, runId, models: ["opus"], arms: ["none", "lens", "office-hours"], repairs: [], allowances: PRE_SMOKE, cap: 100 * D, simCap: 20 * D, parallel: 1, policy, ledger, docker: env.GSTACK_EVALS_DOCKER_BIN || "docker", log, entries }, {
      openRig: (): HostRig => {
        const rig = dockerRig({ host: "claude", arms: { arms, base: null, skill: null, notes: [] }, tasks: join(W, "fixtures", "tasks.json"), out: { path: out, rule: "--out" }, ledger: ledgerPath(ledger, {}), record: recordPath(record, {}), item: items.runs, runId, models: [MODEL_KEYS.opus], policy }, { env, skill: null, skills: { "office-hours": "office-hours" }, nonce: randomBytes(6).toString("hex"), cap: 100 * D, voice: false, upstream: "http://host.docker.internal:" + stub.port });
        const install = rig.arms["office-hours"]!;
        phase2a = posix.join(rig.sandbox("office-hours", false, MODEL_KEYS.opus).homePath(""), posix.dirname(posix.dirname(install.gstack ?? "")), PHASE_2A);
        rigSeen.egress = rig.egress();
        rigSeen.journal = rig.recovery?.journal ?? "";
        return rig;
      },
      simSlot: meterSlot(meter),
      founderTurn: founder,
      exposed: o.exposed ?? (() => null),
    });
  } finally {
    await meter.close();
    stub.stop(true);
  }
  const rows = readRows(out);
  const row = (id: string) => rows.get(id)?.row;
  const answerNone = row("arm/opus/none/fx-answer/p1");
  const answerOh = row("arm/opus/office-hours/fx-answer/p1");
  const never = row("arm/opus/none/fx-never/p1");
  const pitch = row("pitch/opus/lens/fx-never/p1");
  const lines = [...rows.values()];
  const probes = lines.flatMap((l) => l.attempts.map((a) => a.contained));
  check("the run ended with no stop", run!.stops.length === 0 && run!.unrun.length === 0, run!.stops.map((s) => s.code + " " + s.message).join("; ") || "4 sessions, no stop");
  check("no key in any container's env, no mount but the work dir and HOME", probes.length === 4 && probes.every((p) => p !== null && p.length === 0), probes.map((p) => (p === null ? "probe did not run" : p.length ? p.join(", ") : "clean")).join("; "));
  const egress = rigSeen.egress;
  check("the egress probe is closed", egress !== null && !egress.open && probes.every((p) => p !== null), egress ? egress.detail : "no probe");
  const denied = main.filter((m) => DENIED_TOOLS.some((t) => m.tools.includes(t)));
  check("WebSearch, WebFetch and AskUserQuestion are absent from every request the stub saw", main.length > 0 && denied.length === 0 && main.every((m) => m.tools.includes("Read")), main.length + " main-agent requests, " + denied.length + " with a denied tool");
  for (const [name, item] of Object.entries(items)) {
    const it = readItem(record, item);
    check("one lease opened and settled on the " + name + " item", it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null, it.leases.length + " opened, " + it.leases.filter((l) => l.close !== null).length + " settled, spent " + (it.leases[0]?.close?.spent_micros ?? "?") + " micros");
  }
  const jl = rigSeen.journal && existsSync(rigSeen.journal) ? readJournalLines(rigSeen.journal) : [];
  const meters = lines.map((l) => JSON.parse(readFileSync(join(out, "sessions", l.id, "a1", "meter.json"), "utf8")).meter_id as string);
  const outcomes = jl.filter((l: any) => l.kind === "outcome");
  check("the proxy journal shows every call", meters.every((m) => outcomes.some((l: any) => l.meter_id === m)) && outcomes.length === viaProxy, outcomes.length + " outcomes journaled, " + viaProxy + " calls reached the stub through the proxy");
  check("fx-answer on none ended on its first reply's block", answerNone?.end === "block" && answerNone.replies === 1 && answerNone.founder_turns.length === 0, answerNone ? answerNone.end + " after " + answerNone.replies + " replies" : "no row");
  const ohText = main.filter((m) => m.text.includes("/office-hours") && m.text.includes("toolu_of_e2e_read")).at(0)?.text ?? "";
  check("fx-answer on office-hours read phase-2a, asked two questions, then ended on its block", answerOh?.end === "block" && answerOh.replies === 3 && answerOh.founder_turns.length === 2 && ohText.includes("toolu_of_e2e_read") && !/"is_error":true/.test(ohText.slice(ohText.indexOf("toolu_of_e2e_read"))), answerOh ? answerOh.end + " after " + answerOh.replies + " replies and " + answerOh.founder_turns.length + " founder turns" : "no row");
  const closingAt = (m: string) => m.indexOf(JSON.stringify(CLOSING).slice(1, -1));
  const neverMain = main.filter((m) => m.text.includes("Tallyroom") && m.text.includes(FIRST_LINE.none)).at(-1)?.text ?? "";
  check("fx-never on none: the closing message went after the 20th founder reply and its reply ended the session", never?.end === "no-block" && never.closing_sent && never.founder_turns.length === 20 && never.replies === 22 && closingAt(neverMain) > neverMain.indexOf("FOUNDER-REPLY 20"), never ? never.end + ", " + never.founder_turns.length + " founder turns, " + never.replies + " replies" : "no row");
  check("fx-never pitch-only on lens: the closing message was the first founder message", pitch?.end === "no-block" && pitch.closing_sent && pitch.founder_turns.length === 0 && pitch.replies === 2, pitch ? pitch.end + ", " + pitch.replies + " replies" : "no row");
  const turns = [answerOh, never].flatMap((r) => r?.founder_turns ?? []);
  check("the founder turns carry the stub's revealed ids", turns.length === 22 && turns.every((t) => JSON.stringify(t.revealed) === JSON.stringify(revealedBy.get(t.reply))), turns.length + " founder turns");
  const stateRoot = rows.get("arm/opus/office-hours/fx-answer/p1")?.state_root ?? "";
  check("the office-hours state root was copied out", existsSync(join(stateRoot, "config.yaml")), stateRoot);
  const problems = lines.flatMap((l) => rowProblems(l));
  check("the rows parse", lines.length === 4 && problems.length === 0, lines.length + " rows" + (problems.length ? ": " + problems.join("; ") : ""));
  if (o.after) checks.push(...(await o.after({ run: run!, out, unitsDir })));
  if (!o.keep) rmSync(W, { recursive: true, force: true });
  return { checks, dir: W };
}
