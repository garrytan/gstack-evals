// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's dry-run seams (prereg sections 2, 3, 4, 8, 12 and 13; pre-run change 1, items 1, 4a, 4b, 4c and 5;
// pre-run change 2). Each drives one frozen rule through the area's real code on both sides of its edge with planted
// cases, keyless and fast: the arms and their pin checks (host tree, container tree, a null pin), the arm env, the
// first messages, Sol's Codex exec (its skill mention, the duplicate fix, the settings and question capture), the
// closing loop (done, the 20-reply cap, two closing messages, delivered replies only), section 8's
// failure table through runLaunch with a scripted launch, safety stops and SESSION_KIND from transcripts, the manifest
// (order, adjacency, byte-for-byte relaunch, the reserve rule), the cap lines with one lease per line on a temporary
// ledger, the cap stop and its relaunch refusal, and T8 seeding. The fixture briefs are invented and never eval briefs.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeEnv } from "../../../src/adapters/claude-code/driver.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { openLease, recordApproval, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import type { Termination } from "../../../src/types.ts";
import { workRepo } from "../../office-hours-founder/run/contain.ts";
import { ARMS, CLOSING, CODEX_LAYOUT_FIX, CODEX_SETTINGS, CODEX_SKILL_PREFIX, CONTAINER_HOME, FOUNDER_REPLIES, GSTACK_REPO, LENS_LINE, PINS, SKILL_PREFIX, type Pin } from "../frozen.ts";
import { ASYNC_QUESTION, codexQuestions } from "../../../src/adapters/codex/driver.ts";
import { codexTranscript, solArgv } from "./codex.ts";
import { parseBlock } from "../score/block.ts";
import type { SimOutcome } from "../sim/founder.ts";
import type { BriefMeta, ManifestEntry, PriorSession, Seam, SessionRow } from "../types.ts";
import { capProblem, comparisonSet, entryId, LEDGER_LINES, loadBriefs, makeManifest, type LaunchName } from "./manifest.ts";
import { armEnvProblems, armSpecs, containerPinProblems, nullPinProblem, pinProblems, type Pins } from "./pins.ts";
import { ALLOWANCES, runLaunch, type Launch, type RunResult, type SimTurnFn } from "./run.ts";
import { offPin, reportsPin } from "../pinned.ts";
import { readRows } from "./rows.ts";
import { priorEntries, seedPrior } from "./seed.ts";
import { attemptOutcome, closingLoop, delivered, firstMessage, safetyStop, sessionKindOf, type AttemptRead, type LoopState } from "./session.ts";

const D = 1_000_000;
const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
export const BLOCK = "My advice.\n\nDECISION: Sell the reminder service to the two garden leads before you raise.\nNEXT ACTION: You ask both leads to prepay July by Friday.\nWHY: Two leads asked; nobody pays yet.";
const TALK = ["Tell me more about the gardens?"];
export const PRIOR: PriorSession = { date: "2026-10-20", assignment: "Ask the three gardens to prepay a month.", test: "Two of three prepay by November 1.", test_date: "2026-11-01", condition: "if fewer than two prepay, change direction" };
export const DAY = "2026-11-18";

/** Writes a fixture brief folder. */
function brief(dir: string, m: Partial<BriefMeta> & Pick<BriefMeta, "id" | "kind" | "set" | "draw">): BriefMeta {
  const meta: BriefMeta = { type: m.kind === "builder" ? "hackathon" : "T7", skin: 0, cluster: m.id, author: "sol", twin_of: null, traction: false, anti_pattern: null, industry: "fixture", pilot: false, digest: "declared", ...m };
  mkdirSync(join(dir, meta.id), { recursive: true });
  writeFileSync(join(dir, meta.id, "opening.md"), "  I run a scheduling page for a rowing club, brief " + meta.id + ". What should I do next?\n");
  writeFileSync(join(dir, meta.id, "sheet.json"), JSON.stringify({ persona: "A club volunteer.", facts: [{ id: "f1", text: "Six members asked for it.", reveal_when: "Asked who wants it.", kind: "demand" }, { id: "f9", text: "Nobody has paid.", reveal_when: "Asked who pays.", kind: "payment" }] }));
  writeFileSync(join(dir, meta.id, "key.json"), JSON.stringify({ call: "c", actions: ["a"], decisive: ["f9"], twin: meta.twin_of, traction: false, wrong_call: null }));
  writeFileSync(join(dir, meta.id, "brief.json"), JSON.stringify(meta));
  if (meta.type === "T8") writeFileSync(join(dir, meta.id, "prior.json"), JSON.stringify(PRIOR));
  return meta;
}

/** A set's fixture briefs: pairs, unpaired founders and builders, numbered from draw. */
function group(dir: string, set: BriefMeta["set"], o: { pairs: number; founders: number; builders: number; t8?: boolean }, draw = 0): BriefMeta[] {
  const out: BriefMeta[] = [];
  const id = (k: string) => set.slice(0, 3) + "-" + k + "-" + String(draw).padStart(3, "0");
  for (let i = 0; i < o.pairs; i++) {
    const a = id("p" + i + "a"), b = id("p" + i + "b");
    out.push(brief(dir, { id: a, kind: "founder", set, draw: ++draw, type: "T1", twin_of: b }), brief(dir, { id: b, kind: "founder", set, draw: ++draw, type: "T1", twin_of: a }));
  }
  for (let i = 0; i < o.founders; i++) out.push(brief(dir, { id: id("u" + i), kind: "founder", set, draw: ++draw, type: o.t8 && i === 0 ? "T8" : "T7" }));
  for (let i = 0; i < o.builders; i++) out.push(brief(dir, { id: id("b" + i), kind: "builder", set, draw: ++draw }));
  return out;
}

/** A briefs dir with 8 calibration briefs (a T8 among them), the second attempt's 80 comparison briefs and 8 reserves. */
export function fixtureBriefs(): string {
  const dir = mkdtempSync(join(tmpdir(), "ohr-briefs-"));
  group(dir, "calibration", { pairs: 2, founders: 2, builders: 2, t8: true });
  group(dir, "comparison", { pairs: 24, founders: 8, builders: 24 }, 100);
  group(dir, "reserve", { pairs: 2, founders: 2, builders: 2 }, 300);
  return dir;
}

export interface ScriptedAttempt {
  replies?: string[][];
  termination?: Termination;
  gstack_reads?: string[];
  contained?: string[] | null;
  pin?: string[] | null;
  safety?: string | null;
  session_kind?: string | null;
  off_pin?: string[];
  overflow?: boolean;
  micros?: number;
}

/** Each attempt feeds its replies through the session's real closing loop, then reports its end. Unscripted: one talk reply, then the block. */
export const scriptedLaunch = (scripts: Map<string, ScriptedAttempt[]>, calls: string[] = []): Launch => async (o) => {
  calls.push(entryId(o.entry) + "/a" + o.attempt);
  const a = scripts.get(o.entry.brief + "/" + o.entry.arm)?.[o.attempt - 1] ?? { replies: [TALK, [BLOCK]] };
  let ended: Termination = { kind: "completed" };
  for (const texts of a.replies ?? []) {
    const next = await o.nextUser(texts);
    if ("stop" in next) {
      ended = next.stop;
      break;
    }
    if ("end" in next) break;
  }
  return { termination: a.termination ?? ended, gstack_reads: a.gstack_reads ?? [], contained: a.contained === undefined ? [] : a.contained, pin: a.pin === undefined ? [] : a.pin, overflow: a.overflow ?? false, safety: a.safety ?? null, session_kind: a.session_kind === undefined ? (o.entry.arm === "none" ? null : "interactive") : a.session_kind, off_pin: a.off_pin ?? [], micros: a.micros ?? 0 };
};

const reply = (o: Partial<Extract<SimOutcome, { kind: "reply" }>> = {}): SimOutcome => ({ kind: "reply", reply: "Six members asked for it.", revealed: ["f1"], rules: [3], done: false, attempts: 1, rejected: [], requests: [], ...o });
/** A simulator that answers every turn with outs in order, then the last one again. */
export const fixtureSim = (outs: SimOutcome[] = [reply()]): SimTurnFn & { calls: () => number } => {
  let i = 0;
  return Object.assign(async () => outs[Math.min(i++, outs.length - 1)]!, { calls: () => i });
};

/** runLaunch on the fixture briefs with a scripted launch and a stand-in rig. */
export async function scriptedRun(o: { launch?: LaunchName; scripts?: Map<string, ScriptedAttempt[]>; only?: (e: ManifestEntry) => boolean; sim?: SimTurnFn; pins?: Pins; cap?: number; simCap?: number; out?: string; briefs?: string; ledger?: string; buildCommit?: string; dropped?: string[]; tree?: string[]; day?: string; arms?: ManifestEntry["arm"][]; opened?: () => void }): Promise<{ run: RunResult; calls: string[]; out: string; briefs: string }> {
  const briefs = o.briefs ?? fixtureBriefs();
  const out = o.out ?? join(mkdtempSync(join(tmpdir(), "ohr-run-")), "out");
  const calls: string[] = [];
  const rig = { recovery: null, arms: {}, close: async () => ({ committed: 0, unknown: 0, lease_id: null }) } as unknown as HostRig;
  const inner = scriptedLaunch(o.scripts ?? new Map(), calls);
  const launch: Launch = async (x) => (o.only && !o.only(x.entry) ? { termination: { kind: "missing", code: "E_LEDGER_UNAVAILABLE" }, gstack_reads: [], contained: [], pin: [], overflow: false, safety: null, session_kind: null, off_pin: [], micros: 0 } : inner(x));
  const run = await runLaunch({ launch: o.launch ?? "stage1", briefsDir: briefs, out, runId: "seam", models: ["opus"], arms: o.arms ?? [...ARMS], pins: o.pins ?? PINS, buildCommit: o.buildCommit ?? "b".repeat(40), dropped: o.dropped ?? [], allowances: ALLOWANCES, cap: o.cap ?? 100 * D, simCap: o.simCap ?? 50 * D, parallel: 1, policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, docker: "docker", day: o.day ?? DAY, ledger: o.ledger ?? null, log: () => {} }, {
    openRig: () => (o.opened?.(), rig),
    simSlot: () => ({ call: async () => ({ kind: "text", text: "" }), spent: () => 0 }),
    simTurn: o.sim ?? fixtureSim(),
    parse: parseBlock,
    launch,
    treeProblems: () => o.tree ?? [],
  });
  return { run, calls, out, briefs };
}

const firstCal = (briefs: string) => loadBriefs(briefs).filter((b) => b.set === "calibration").sort((a, b) => a.draw - b.draw)[0]!.id;

/** One stage 1 session on the first calibration brief: its scripted attempts, and the end, code and attempts it must score. */
const end = (name: string, attempts: ScriptedAttempt[], want: { end: SessionRow["end"]; code: string | null; attempts: number }, arm: ManifestEntry["arm"] = "none", sim?: SimOutcome[]): Seam => ({
  name,
  run: async () => {
    const briefs = fixtureBriefs();
    const id = firstCal(briefs);
    const { run, calls } = await scriptedRun({ briefs, scripts: new Map([[id + "/" + arm, attempts]]), only: (e) => e.brief === id && e.arm === arm, ...(sim ? { sim: fixtureSim(sim) } : {}) });
    const r = run.rows.find((l) => l.row.brief === id && l.row.arm === arm)?.row;
    const ok = r?.end === want.end && r.code === want.code && r.attempts === want.attempts && calls.length === want.attempts;
    return { ok, detail: r ? r.end + " " + (r.code ?? "no code") + ", " + r.attempts + " attempt(s), " + calls.length + " launch(es)" : "no row; stops " + run.stops.map((s) => s.code).join(", ") };
  },
});

/** Drives a closing loop: n adviser replies with the given simulator outcomes. */
async function loopWith(replies: string[][], sim: SimOutcome[] = [reply()], safety?: () => string | null): Promise<{ state: LoopState; last: Awaited<ReturnType<ReturnType<typeof closingLoop>["nextUser"]>>; sim: number }> {
  const s = fixtureSim(sim);
  const loop = closingLoop({ parse: parseBlock, founder: () => s(null as never), ...(safety ? { safety } : {}) });
  let last: Awaited<ReturnType<typeof loop.nextUser>> = { end: true };
  for (const r of replies) last = await loop.nextUser(r);
  return { state: loop.state, last, sim: s.calls() };
}

/** A tree on disk holding a pin's files, and the pin of that tree. */
function fakePin(): { dir: string; pin: Pin } {
  const dir = mkdtempSync(join(tmpdir(), "ohr-pin-"));
  const files: Record<string, string> = {};
  for (const f of ["office-hours/SKILL.md", "bin/gstack-session-kind"]) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "content of " + f + "\n");
    files[f] = sha256("content of " + f + "\n");
  }
  writeFileSync(join(dir, "VERSION"), "1.100.0.0\n");
  return { dir, pin: { sha: "f".repeat(40), version: "1.100.0.0", version_sha256: sha256("1.100.0.0\n"), files } };
}

const tx = (...m: object[]) => m.map((x) => JSON.stringify(x)).join("\n") + "\n";

function attempt(o: Partial<AttemptRead>): AttemptRead {
  const loop = closingLoop({ parse: parseBlock, founder: async () => reply() }).state;
  return { termination: { kind: "completed" }, loop, gstack_reads: [], contained: [], pin: [], overflow: false, safety: null, session_kind: null, off_pin: [], micros: 0, sim_micros: 0, ...o };
}

export const seams: Seam[] = [
  // Arms and pins (section 2; change 1, item 1; change 2).
  { name: "arms: none is bare, current and new install gstack at their pins' shas", run: () => { const s = armSpecs(["none", "current", "new"]); const shas = s.map((a) => (a.kind === "stack" ? a.stack.repo + "@" + a.stack.sha : a.kind)); return { ok: shas.join() === ["bare", GSTACK_REPO + "@" + PINS.current!.sha, GSTACK_REPO + "@" + PINS.new!.sha].join(), detail: shas.join(", ") }; } },
  { name: "pins: a tree with the pin's VERSION and every pinned hash passes", run: () => { const { dir, pin } = fakePin(); const p = pinProblems(dir, pin); return { ok: p.length === 0, detail: p.join("; ") || "clean" }; } },
  { name: "pins: one changed byte in one pinned file is named", run: () => { const { dir, pin } = fakePin(); writeFileSync(join(dir, "office-hours/SKILL.md"), "content of office-hours/SKILL.md!\n"); const p = pinProblems(dir, pin); return { ok: p.length === 1 && p[0]!.startsWith("office-hours/SKILL.md hashes to"), detail: p.join("; ") }; } },
  { name: "pins: a tree whose VERSION differs fails, even with every hash right", run: () => { const { dir, pin } = fakePin(); writeFileSync(join(dir, "VERSION"), "1.100.0.1\n"); const p = pinProblems(dir, pin); return { ok: p.length === 1 && p[0]!.startsWith("VERSION"), detail: p.join("; ") }; } },
  { name: "pins: a VERSION with the pin's text but other bytes is named, on the host tree and in the container's print", run: () => { const { dir, pin } = fakePin(); writeFileSync(join(dir, "VERSION"), "1.100.0.0\r\n"); const host = pinProblems(dir, pin); const files = Object.entries(pin.files).map(([f, h]) => h + "  " + f).join("\n"); const box = containerPinProblems("VERSION 1.100.0.0\n" + sha256("1.100.0.0\r\n") + "  VERSION\n" + files, pin); const none = containerPinProblems("VERSION 1.100.0.0\n" + files, pin); return { ok: host.length === 1 && host[0]!.startsWith("VERSION hashes to") && box.length === 1 && box[0]!.startsWith("VERSION in the container hashes to") && none.length === 1 && none[0]!.includes("is missing"), detail: [...host, ...box, ...none].join("; ") }; } },
  { name: "pins: a container's printed tree matches, and a missing file there does not", run: () => { const { pin } = fakePin(); const good = "VERSION 1.100.0.0\n" + pin.version_sha256 + "  VERSION\n" + Object.entries(pin.files).map(([f, h]) => h + "  " + f).join("\n"); const bad = "VERSION 1.100.0.0\n" + pin.version_sha256 + "  VERSION\n" + Object.entries(pin.files).slice(0, 1).map(([f, h]) => h + "  " + f).join("\n") + "\nmissing bin/gstack-session-kind"; return { ok: containerPinProblems(good, pin).length === 0 && containerPinProblems(bad, pin).length === 1, detail: containerPinProblems(bad, pin).join("; ") }; } },
  { name: "pins: the frozen pins pass the null-pin check, and a null new pin refuses a manifest with a new-arm session", run: () => { const entries = [{ arm: "none" as const }, { arm: "new" as const }]; const a = nullPinProblem(entries); const b = nullPinProblem(entries, { current: PINS.current, new: null }); return { ok: a === null && (b ?? "").startsWith("E_OHR_NEW_PIN_UNSET") && nullPinProblem([{ arm: "none" }, { arm: "current" }], { current: PINS.current, new: null }) === null, detail: b ?? "" }; } },
  { name: "pins: a launch with a null pin is refused before the rig opens", run: async () => { let opened = false; let err = ""; try { await scriptedRun({ pins: { current: PINS.current, new: null }, opened: () => (opened = true) }); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_NEW_PIN_UNSET") && !opened, detail: err.slice(0, 90) }; } },
  { name: "pins: a host tree mismatch at rig open refuses the launch before any session", run: async () => { let err = ""; const out = join(mkdtempSync(join(tmpdir(), "ohr-run-")), "out"); try { await scriptedRun({ tree: ["VERSION reads 1.99.0.0"], out }); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_PIN_MISMATCH") && readRows(out).size === 0, detail: err.slice(0, 90) }; } },
  { name: "pins: a container that is not its pin halts the launch with E_OHR_PIN_MISMATCH", run: () => { const o = attemptOutcome(attempt({ pin: ["office-hours/SKILL.md in the container is missing"] }), "current"); return { ok: o.state === "halt" && o.code === "E_OHR_PIN_MISMATCH", detail: o.state }; } },
  // Arm env (section 4 step 2).
  { name: "arm env: the driver's env sets ARM_ENV and leaves every ARM_ENV_UNSET name out", run: () => { const env = claudeCodeEnv({ model: "m", provider: "anthropic", proxy: { baseUrl: "http://p", slot: "s", token: "t" }, disable1mContext: true }); const p = armEnvProblems(env); return { ok: p.length === 0, detail: p.join("; ") || "clean" }; } },
  { name: "arm env: GSTACK_SESSION_KIND in the driver's env, or CI in a container, is a departure", run: () => { const a = armEnvProblems(claudeCodeEnv({ model: "m", provider: "anthropic", proxy: { baseUrl: "http://p", slot: "s", token: "t" }, sessionKind: "interactive" })); const b = armEnvProblems(["PATH", "HOME", "CI"]); return { ok: a.join() === "GSTACK_SESSION_KIND is set" && b.join() === "CI is set", detail: a.join() + " / " + b.join() }; } },
  { name: "arm env: a departure halts the launch as a containment departure", run: () => { const o = attemptOutcome(attempt({ contained: ["arm env: CI is set"] }), "none"); return { ok: o.state === "halt" && o.code === "E_OF_LEAK", detail: o.state }; } },
  { name: "work repo: a fresh repo with one empty commit and no project instruction file", run: () => { const d = workRepo(join(mkdtempSync(join(tmpdir(), "ohr-repo-")), "repo")); const files = ["CLAUDE.md", "AGENTS.md", ".claude"].filter((f) => existsSync(join(d, f))); return { ok: files.length === 0, detail: files.join(", ") || "none" }; } },
  // First messages (section 4 step 1; change 1, item 4c).
  { name: "first message: none gets the lens line, a blank line and the trimmed opening", run: () => { const m = firstMessage("none", "  Hello there.\n"); return { ok: m === LENS_LINE + "\n\nHello there.", detail: JSON.stringify(m) }; } },
  { name: "first message: both skill arms get /office-hours before the same text", run: () => { const ok = (["current", "new"] as const).every((a) => firstMessage(a, "Hi.\n") === SKILL_PREFIX + LENS_LINE + "\n\nHi."); return { ok, detail: JSON.stringify(firstMessage("new", "Hi.")) }; } },
  { name: "first message: on Sol both skill arms get $office-hours, Codex's skill mention, before the same text, and none stays plain", run: () => { const ok = (["current", "new"] as const).every((a) => firstMessage(a, "Hi.\n", "sol") === CODEX_SKILL_PREFIX + LENS_LINE + "\n\nHi.") && firstMessage("none", "Hi.", "sol") === firstMessage("none", "Hi."); return { ok, detail: JSON.stringify(firstMessage("new", "Hi.", "sol")) }; } },
  { name: "Sol: a skill arm's exec disables the three duplicate skill copies, one [[skills.config]] entry each, and none disables nothing", run: () => { const at = (skillArm: boolean) => solArgv({ proxy: { baseUrl: "http://tap/", slot: "s", token: "t" }, home: CONTAINER_HOME, skillArm }, null).filter((a, i, all) => all[i - 1] === "-c" && a.startsWith("skills.config=")); const entries = at(true)[0]?.match(/\{path="[^"]+",enabled=false\}/g) ?? []; return { ok: entries.length === 3 && CODEX_LAYOUT_FIX.every((f) => entries.some((e) => e.includes(CONTAINER_HOME + "/.codex/" + f))) && at(false).length === 0, detail: entries.join(", ") }; } },
  { name: "Sol: every frozen Codex setting is a -c pair on the exec, the provider is the proxy slot's Responses route, retries off", run: () => { const argv = solArgv({ proxy: { baseUrl: "http://tap:8099/", slot: "s1", token: "t" }, home: CONTAINER_HOME, skillArm: false }, null); const pairs = new Map(argv.filter((_, i) => argv[i - 1] === "-c").map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] as const)); const missing = Object.entries(CODEX_SETTINGS).filter(([k, v]) => pairs.get(k) !== JSON.stringify(v)).map(([k]) => k); return { ok: missing.length === 0 && pairs.get("model_providers.gstack_evals_proxy.base_url") === '"http://tap:8099/s1/openai/v1"' && pairs.get("model_providers.gstack_evals_proxy.request_max_retries") === "0", detail: missing.join(", ") || Object.keys(CODEX_SETTINGS).length + " settings" }; } },
  { name: "Sol: a request_user_input_async question reads as the reply's assistant text and is captured, its tool call hidden", run: () => { const q = "Who has paid you so far?"; const rollout = [{ type: "session_meta", payload: { id: "th" } }, { type: "response_item", payload: { type: "function_call", call_id: "q1", name: ASYNC_QUESTION, arguments: "{}" } }, { type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", id: "q1", content: [{ type: "Text", text: q }], delivery: "async", questions: [{ title: q }] } } }, { type: "response_item", payload: { type: "function_call_output", call_id: "q1", output: '{"accepted":true}' } }, { type: "event_msg", payload: { type: "task_complete", last_agent_message: q } }].map((l) => JSON.stringify(l)).join("\n"); const t = codexTranscript(rollout).split("\n").filter(Boolean).map((l) => JSON.parse(l)); const said = t.filter((x) => x.type === "assistant").map((x) => x.message.content[0]); return { ok: said.length === 1 && said[0].type === "text" && said[0].text === q && t.at(-1).result === q && codexQuestions(rollout).length === 1, detail: JSON.stringify(said) }; } },
  // The closing loop (section 4 step 4; change 1, item 4c).
  { name: "loop: a block before any closing message does not end the session", run: async () => { const r = await loopWith([[BLOCK]]); return { ok: "reply" in r.last && r.last.reply !== CLOSING && r.state.ended === null && r.sim === 1, detail: JSON.stringify(r.last).slice(0, 60) }; } },
  { name: "loop: when the founder sets done, the closing message replaces that reply, logged as not delivered", run: async () => { const r = await loopWith([TALK, TALK], [reply(), reply({ reply: "Thanks, that helps.", done: true })]); const t = r.state.founder_turns; return { ok: "reply" in r.last && r.last.reply === CLOSING && t.length === 2 && t[0]!.delivered && !t[1]!.delivered && t[1]!.done && r.state.founder_done && r.state.closings === 1 && !r.state.transcript.some((l) => l.text === "Thanks, that helps."), detail: t.map((x) => x.delivered).join() }; } },
  { name: "loop: 19 delivered replies call the simulator again", run: async () => { const r = await loopWith(Array.from({ length: 20 }, () => TALK)); return { ok: r.sim === 20 && r.state.closings === 0, detail: r.sim + " simulator calls" }; } },
  { name: "loop: after the 20th delivered reply the closing message goes instead of the simulator", run: async () => { const r = await loopWith(Array.from({ length: 21 }, () => TALK)); return { ok: r.sim === FOUNDER_REPLIES && delivered(r.state) === 20 && "reply" in r.last && r.last.reply === CLOSING && !r.state.founder_done, detail: r.sim + " simulator calls" }; } },
  { name: "loop: a block in reply to the first closing message ends the session", run: async () => { const r = await loopWith([TALK, TALK, [BLOCK]], [reply(), reply({ done: true })]); return { ok: r.state.ended === "block" && r.state.closings === 1 && "end" in r.last, detail: String(r.state.ended) }; } },
  { name: "loop: no block goes the closing message once more, and a block then ends the session", run: async () => { const r = await loopWith([TALK, TALK, TALK, [BLOCK]], [reply(), reply({ done: true })]); return { ok: r.state.ended === "block" && r.state.closings === 2, detail: r.state.closings + " closings" }; } },
  { name: "loop: a second miss ends the session no-block after two closing messages", run: async () => { const r = await loopWith([TALK, TALK, TALK, TALK], [reply(), reply({ done: true })]); return { ok: r.state.ended === "no-block" && r.state.closings === 2 && "end" in r.last, detail: String(r.state.ended) }; } },
  { name: "loop: a decisive fact only in a replaced reply and in a rejected draw never reaches a delivered reply", run: async () => { const r = await loopWith([TALK, TALK, [BLOCK]], [reply({ rejected: [{ attempt: 1, checks: [], guard: true, reply: "x", revealed: ["f1", "f9", "f2"], request: "r" }] }), reply({ revealed: ["f9"], done: true })]); const t = r.state.founder_turns; const credited = t.filter((x) => x.delivered).some((x) => x.revealed.includes("f9")); return { ok: !credited && t[0]!.rejected_draws[0]!.revealed.includes("f9") && t[0]!.rejected_draws[0]!.checks.includes("guard") && !t[1]!.delivered && t[1]!.revealed.includes("f9"), detail: JSON.stringify(t.map((x) => [x.delivered, x.revealed])) }; } },
  { name: "loop: a guard failure stops the attempt as a simulator failure", run: async () => { const r = await loopWith([TALK], [{ kind: "guard-failed", attempts: 3, rejected: [], requests: [] }]); return { ok: "stop" in r.last && r.last.stop.kind === "missing" && r.last.stop.code === "E_OHR_SIM_GUARD" && r.state.guard_failures === 1, detail: JSON.stringify(r.last) }; } },
  { name: "loop: a simulator cap refusal is a cap stop", run: async () => { const r = await loopWith([TALK], [{ kind: "call-failed", reason: "cap", detail: "CAP_STOP", rejected: [], requests: [] }]); return { ok: "stop" in r.last && r.last.stop.kind === "cap_stop", detail: JSON.stringify(r.last) }; } },
  { name: "loop: a safety stop in the transcript stops the attempt before the simulator runs", run: async () => { const r = await loopWith([TALK], [reply()], () => "a main-agent reply with stop_reason refusal"); return { ok: "stop" in r.last && r.last.stop.kind === "missing" && r.last.stop.code === "E_OHR_SAFETY_STOP" && r.sim === 0, detail: JSON.stringify(r.last) }; } },
  // Transcript reads (section 8; A7).
  { name: "safety: Anthropic's stop_reason refusal and OpenRouter's content_filter on the main agent are safety stops", run: () => { const a = safetyStop(tx({ type: "assistant", parent_tool_use_id: null, message: { stop_reason: "refusal", content: [] } })); const b = safetyStop(tx({ type: "assistant", message: { stop_reason: "content_filter", content: [] } })); return { ok: !!a && !!b, detail: a + " / " + b }; } },
  { name: "safety: Claude Code's refusal notices are safety stops; end_turn and a subagent's refusal are not", run: () => { const a = safetyStop(tx({ type: "system", subtype: "model_refusal_no_fallback", api_refusal_category: "cyber" })); const b = safetyStop(tx({ type: "assistant", message: { stop_reason: "end_turn" } }, { type: "assistant", parent_tool_use_id: "toolu_1", message: { stop_reason: "refusal" } })); return { ok: !!a && b === null, detail: a + " / " + b }; } },
  { name: "safety: a safety stop scores safety-stop ahead of the UPSTREAM missing Claude Code's error frame gives", run: () => { const o = attemptOutcome(attempt({ termination: { kind: "missing", code: "UPSTREAM" }, safety: "a main-agent reply with stop_reason refusal" }), "current"); return { ok: o.state === "safety-stop" && "code" in o && o.code === "E_OHR_SAFETY_STOP", detail: o.state }; } },
  { name: "session kind: the first main-agent tool result's SESSION_KIND is read", run: () => { const k = sessionKindOf(tx({ type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "BRANCH: main\nSESSION_KIND: interactive\n" }] }] } }, { type: "user", message: { content: [{ type: "tool_result", content: "SESSION_KIND: headless" }] } })); return { ok: k === "interactive", detail: String(k) }; } },
  { name: "session kind: no print reads null, and a subagent's print is not the session's", run: () => { const k = sessionKindOf(tx({ type: "user", parent_tool_use_id: "toolu_1", message: { content: [{ type: "tool_result", content: "SESSION_KIND: headless" }] } })); return { ok: k === null, detail: String(k) }; } },
  // Section 8's failure table through runLaunch.
  end("end: a block after the closing message scores block", [{ replies: [TALK, TALK, [BLOCK]] }], { end: "block", code: null, attempts: 1 }, "none", [reply(), reply({ done: true })]),
  end("end: no block after two closing messages scores no-block", [{ replies: [TALK, TALK, TALK, TALK] }], { end: "no-block", code: "E_OHR_NO_BLOCK", attempts: 1 }, "none", [reply(), reply({ done: true })]),
  end("end: a none-arm gstack read scores contaminated", [{ replies: [TALK, [BLOCK]], gstack_reads: ["Read ~/.claude/skills/gstack/office-hours/SKILL.md"] }], { end: "contaminated", code: "E_OHR_GSTACK_READ", attempts: 1 }),
  end("end: a skill arm's gstack reads are not contamination", [{ replies: [TALK, TALK, [BLOCK]], gstack_reads: [] }], { end: "block", code: null, attempts: 1 }, "current", [reply(), reply({ done: true })]),
  end("end: a provider safety stop scores safety-stop with no retry", [{ replies: [TALK], termination: { kind: "missing", code: "UPSTREAM" }, safety: "a main-agent reply with stop_reason refusal" }], { end: "safety-stop", code: "E_OHR_SAFETY_STOP", attempts: 1 }),
  end("end: an upstream failure retries once and then scores missing", [{ replies: [TALK], termination: { kind: "missing", code: "UPSTREAM" } }, { replies: [TALK], termination: { kind: "missing", code: "UPSTREAM" } }], { end: "missing", code: "E_OHR_INFRA_MISSING", attempts: 2 }),
  end("end: an upstream failure whose retry ends in a block scores block", [{ replies: [TALK], termination: { kind: "missing", code: "UPSTREAM" } }, { replies: [TALK, TALK, [BLOCK]] }], { end: "block", code: null, attempts: 2 }, "none", [reply(), reply({ done: true }), reply(), reply({ done: true })]),
  end("end: a guard failure retries once and then scores missing", [{ replies: [TALK] }, { replies: [TALK] }], { end: "missing", code: "E_OHR_SIM_GUARD", attempts: 2 }, "none", [{ kind: "guard-failed", attempts: 3, rejected: [], requests: [] }]),
  end("end: a check failure retries once and then scores missing", [{ replies: [TALK] }, { replies: [TALK] }], { end: "missing", code: "E_OHR_SIM_CHECK", attempts: 2 }, "none", [{ kind: "check-failed", checks: ["json"], attempts: 3, rejected: [], requests: [] }]),
  end("end: a skill session that prints SESSION_KIND: headless retries and then scores missing", [{ replies: [TALK, TALK, [BLOCK]], session_kind: "headless" }, { replies: [TALK, TALK, [BLOCK]], session_kind: "headless" }], { end: "missing", code: "E_OHR_SESSION_KIND", attempts: 2 }, "new", [reply(), reply({ done: true })]),
  end("end: the arm's own stop retries and then scores no-block", [{ replies: [TALK], termination: { kind: "turn_cap" } }, { replies: [TALK], termination: { kind: "timeout" } }], { end: "no-block", code: "E_OHR_ARM_STOP", attempts: 2 }),
  end("end: an arm reply that names another model than the pin halts the launch and scores missing, with no retry (E_OHR_MODEL_DRIFT)", [{ replies: [TALK, TALK, [BLOCK]], off_pin: ["claude-sonnet-5-5"] }], { end: "missing", code: "E_OHR_MODEL_DRIFT", attempts: 1 }, "none", [reply(), reply({ done: true })]),
  end("end: a simulator reply that names another model than Argon halts the launch and scores missing (E_OHR_MODEL_DRIFT)", [{ replies: [TALK] }], { end: "missing", code: "E_OHR_MODEL_DRIFT", attempts: 1 }, "none", [{ kind: "call-failed", reason: "drift", detail: "E_OHR_MODEL_DRIFT the simulated person asked for google/gemini-4-argon and the reply reports google/gemini-4-hydrogen", rejected: [], requests: [] }]),
  { name: "models: offPin reads every assistant message's model, accepts the pin and its dated snapshot, and skips Claude Code's <synthetic> frames", run: () => { const t = tx({ type: "assistant", message: { model: "claude-opus-5-5", content: [] } }, { type: "assistant", message: { model: "claude-opus-5-5-20261101", content: [] } }, { type: "assistant", message: { model: "<synthetic>", content: [] } }, { type: "assistant", parent_tool_use_id: "t1", message: { model: "claude-haiku-5-5", content: [] } }, { type: "user", message: { content: [] } }); const got = offPin(t, "claude-opus-5-5"); const clean = offPin(tx({ type: "assistant", message: { model: "openai/gpt-6.1-sol-2026-10-30" } }), "openai/gpt-6.1-sol"); const nameless = offPin(tx({ type: "assistant", message: {} }), "claude-opus-5-5"); return { ok: got.join() === "claude-haiku-5-5" && clean.length === 0 && nameless.join() === "(no model)" && !reportsPin("claude-opus-5-5", "claude-opus-5-5-preview") && !reportsPin("openai/gpt-6.1-sol", "openai/gpt-6.1-sol-mini"), detail: got.join() + " | " + nameless.join() }; } },
  end("end: a session the ledger never admitted is missing with no retry", [{ termination: { kind: "missing", code: "E_LEDGER_UNAVAILABLE" } }], { end: "missing", code: "E_OHR_INFRA_MISSING", attempts: 1 }),
  { name: "end: the row records session_kind, closings, founder_done and delivered turns", run: async () => { const briefs = fixtureBriefs(); const id = firstCal(briefs); const { run } = await scriptedRun({ briefs, scripts: new Map([[id + "/current", [{ replies: [TALK, TALK, [BLOCK]] }]]]), only: (e) => e.brief === id && e.arm === "current", sim: fixtureSim([reply(), reply({ done: true })]) }); const r = run.rows.find((l) => l.row.brief === id && l.row.arm === "current")?.row; return { ok: r?.session_kind === "interactive" && r.closings === 1 && r.founder_done && r.founder_turns.map((t) => t.delivered).join() === "true,false" && r.state_root !== null, detail: JSON.stringify(r && { k: r.session_kind, c: r.closings }) }; } },
  // Cap stops and relaunch (section 13; change 1, item 4a).
  { name: "relaunch: an attempt a crash left with a marker and no row is reconciled at its ledger meter's settled and unknown spend, then retried once", run: async () => {
    const briefs = fixtureBriefs();
    const id = firstCal(briefs);
    const root = mkdtempSync(join(tmpdir(), "ohr-reconcile-"));
    const out = join(root, "out");
    const ledger = join(root, "ledger.sqlite");
    const record = join(root, "record");
    const adir = join(out, "sessions", "s1", "opus", "none", id, "a1");
    const local = openLocalLedger({ path: ledger, rule: "seam" });
    try {
      recordApproval(record, { action: "init", item: "ohr-seam-reconcile", cap_micros: 10 * D, quotes: [{ words: "dry run on a temporary ledger, not an approval", by: "ohr run seams", source: "lanes/office-hours-rewrite/run/seams.ts" }], admission: "warn" });
      const lease_id = openLease(record, local, { item: "ohr-seam-reconcile", run_id: "seam-reconcile", amount_micros: 10 * D }).lease_id;
      const cell = { run_id: "seam", arm: "none", task: "s1/opus/none/" + id, model: "opus", trial: 1, attempt: 1, meter_id: "m-crashed" };
      const paid = await local.reserve({ idempotency_key: "k-paid", lease_id, cell, max_micros: 4 * D });
      if (!paid.ok) return { ok: false, detail: paid.message };
      await local.settle(paid.reservation.reservation_id, { kind: "spent", spent_micros: 2.5 * D, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } });
      await local.reserve({ idempotency_key: "k-open", lease_id, cell, max_micros: D });
      mkdirSync(adir, { recursive: true });
      writeFileSync(join(adir, "attempt.json"), JSON.stringify({ id: "s1/opus/none/" + id, attempt: 1 }) + "\n");
      writeFileSync(join(adir, "meter.json"), JSON.stringify({ meter_id: "m-crashed", lease_id, journal: null }) + "\n");
    } finally {
      local.close();
    }
    const upstream = { termination: { kind: "missing" as const, code: "UPSTREAM" as const } };
    const { run, calls } = await scriptedRun({ briefs, out, ledger, scripts: new Map([[id + "/none", [{}, upstream]]]), only: (e) => e.brief === id && e.arm === "none" });
    const line = run.rows.find((l) => l.id === "s1/opus/none/" + id);
    const rec = existsSync(join(adir, "reconcile.json")) ? (JSON.parse(readFileSync(join(adir, "reconcile.json"), "utf8")) as { ledger_micros: number | null }) : null;
    return { ok: !!line && line.attempts.length === 2 && line.attempts[0]!.usd === 3.5 && line.row.usd === 3.5 && rec?.ledger_micros === 3.5 * D && run.spent_micros === 3.5 * D && calls.join() === "s1/opus/none/" + id + "/a2", detail: JSON.stringify({ attempts: line?.attempts.map((a) => a.usd), usd: line?.row.usd, ledger_micros: rec?.ledger_micros, spent: run.spent_micros, calls }) };
  } },
  { name: "cap: a ledger cap stop ends the launch with no row for that session, and a relaunch is refused", run: async () => { const briefs = fixtureBriefs(); const id = firstCal(briefs); const out = join(mkdtempSync(join(tmpdir(), "ohr-run-")), "out"); const { run } = await scriptedRun({ briefs, out, scripts: new Map([[id + "/none", [{ termination: { kind: "cap_stop" } }]]]) }); let err = ""; try { await scriptedRun({ briefs, out }); } catch (e) { err = (e as Error).message; } return { ok: run.stops[0]?.code === "CAP_STOP" && run.rows.length === 0 && JSON.parse(readFileSync(join(out, "stops.json"), "utf8")).stops[0].code === "CAP_STOP" && err.startsWith("E_OHR_MANIFEST") && err.includes("cap stop"), detail: err.slice(0, 90) }; } },
  { name: "cap: a round holds one attempt a session; an Opus round needs $33 of arms and $6 of simulator, and a cent less of either is a cap stop before it starts", run: async () => { const briefs = fixtureBriefs(); const id = firstCal(briefs); const one = (cap: number, simCap: number) => scriptedRun({ briefs, cap, simCap, only: (e) => e.brief === id }); const [arms, sim, fits] = await Promise.all([one(33 * D - 1, 6 * D), one(33 * D, 6 * D - 1), one(33 * D, 6 * D)]); return { ok: arms.calls.length === 0 && arms.run.stops[0]?.code === "CAP_STOP" && arms.run.stops[0]!.message.includes("one attempt a session") && sim.calls.length === 0 && sim.run.stops[0]?.code === "CAP_STOP" && fits.calls.filter((c) => c.endsWith("/a1")).length === 3, detail: [arms, sim, fits].map((r) => r.calls.length).join(", ") + "; " + (arms.run.stops[0]?.message ?? "") }; } },
  { name: "cap: a retry runs only when its allowance still fits what the launch has left; otherwise the session ends as a cap stop", run: async () => { const briefs = fixtureBriefs(); const id = firstCal(briefs); const failing = new Map([[id + "/none", [{ replies: [TALK], termination: { kind: "missing" as const, code: "UPSTREAM" as const }, micros: D }]]]); const tight = await scriptedRun({ briefs, cap: 33 * D, simCap: 6 * D, scripts: failing }); const roomy = await scriptedRun({ briefs, cap: 34 * D, simCap: 6 * D, scripts: failing }); const stop = tight.run.stops[0]; return { ok: stop?.code === "CAP_STOP" && stop.message.startsWith("s1/opus/none/" + id + ": its retry's allowances") && tight.calls.join() === "s1/opus/none/" + id + "/a1" && tight.run.rows.length === 0 && tight.run.unrun.some((u) => u.how === "stopped") && roomy.calls.slice(0, 2).join() === "s1/opus/none/" + id + "/a1,s1/opus/none/" + id + "/a2", detail: (stop?.message ?? "no stop") + " | roomy " + roomy.calls.slice(0, 3).join() }; } },
  { name: "cap: a round that fits runs", run: async () => { const { run, calls } = await scriptedRun({ cap: 2 * 3 * D + 2 * 2 * 15 * D, only: (e) => e.model === "opus" }); return { ok: calls.length >= 3, detail: calls.length + " launches, stops " + run.stops.map((s) => s.code).join() }; } },
  { name: "cap lines: caps that sum to the line's frozen cap pass, one micro-dollar more is refused", run: () => { const c = LEDGER_LINES.stage1.cap * D; return { ok: capProblem("stage1", c - 30 * D, 30 * D) === null && (capProblem("stage1", c - 30 * D, 30 * D + 1) ?? "").startsWith("E_OHR_CAP_LINE") && capProblem("stage2-particle", LEDGER_LINES.stage2_particle.cap * D, 0) === null, detail: String(capProblem("stage1", c, 1)) }; } },
  { name: "ledger: one lease opens and settles on an item for each of the five lines on a temporary ledger", run: () => { const root = mkdtempSync(join(tmpdir(), "ohr-ledger-")); const record = join(root, "record"); const local = openLocalLedger({ path: join(root, "ledger.sqlite"), rule: "seam" }); const failed: string[] = []; try { for (const [name, l] of Object.entries(LEDGER_LINES)) { const item = "ohr-seam-" + name; recordApproval(record, { action: "init", item, cap_micros: l.cap * D, quotes: [{ words: "dry run on a temporary ledger, not an approval", by: "ohr run seams", source: "lanes/office-hours-rewrite/run/seams.ts" }], admission: "warn" }); settleLease(record, local, openLease(record, local, { item, run_id: "seam-" + name, amount_micros: D }).lease_id); const it = readItem(record, item); if (it.open !== null || it.leases.length !== 1 || it.leases[0]!.close === null) failed.push(name); } } finally { local.close(); } return { ok: failed.length === 0, detail: failed.join(", ") || Object.keys(LEDGER_LINES).join(", ") }; } },
  // Manifests and order (section 12 stages 4 and 5; change 1, item 5).
  { name: "manifest: stage 1 holds the 8 calibration briefs on three arms and three models, in draw order", run: () => { const briefs = fixtureBriefs(); const m = makeManifest({ launch: "stage1", briefsDir: briefs, models: ["opus", "sol", "particle"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] }); const draws = new Map(loadBriefs(briefs).map((b) => [b.id, b.draw])); const order = m.entries.map((e) => draws.get(e.brief)!); return { ok: m.entries.length === 72 && order.every((d, i) => i === 0 || d >= order[i - 1]!), detail: m.entries.length + " entries" }; } },
  { name: "manifest: stage 2 runs every comparison brief once per arm and model with a brief's arms adjacent", run: () => { const briefs = fixtureBriefs(); const m = makeManifest({ launch: "stage2", briefsDir: briefs, models: ["opus", "sol"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] }); const groups = Array.from({ length: m.entries.length / 3 }, (_, i) => m.entries.slice(3 * i, 3 * i + 3)); const adjacent = groups.every((g) => new Set(g.map((e) => e.brief + e.model)).size === 1 && new Set(g.map((e) => e.arm)).size === 3); const p = makeManifest({ launch: "stage2-particle", briefsDir: briefs, models: ["particle"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] }); return { ok: m.entries.length === 80 * 3 * 2 && adjacent && p.entries.length === 80 * 3 && p.entries.every((e) => e.model === "particle"), detail: m.entries.length + " and " + p.entries.length }; } },
  { name: "manifest: the stage 2 order is seeded, and the same on every build", run: () => { const briefs = fixtureBriefs(); const a = makeManifest({ launch: "stage2", briefsDir: briefs, models: ["opus", "sol"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] }); const b = makeManifest({ launch: "stage2", briefsDir: briefs, models: ["opus", "sol"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] }); const sorted = [...new Set(a.entries.map((e) => e.brief))]; return { ok: JSON.stringify(a.entries) === JSON.stringify(b.entries) && JSON.stringify(sorted) !== JSON.stringify([...sorted].sort()), detail: sorted.slice(0, 3).join(", ") }; } },
  { name: "manifest: it binds both pins, both simulator rules digests, the build commit and file digests", run: () => { const briefs = fixtureBriefs(); const m = makeManifest({ launch: "stage1", briefsDir: briefs, models: ["opus"], arms: [...ARMS], pins: PINS, buildCommit: "c0ffee", dropped: [] }); return { ok: m.pins.current?.sha === PINS.current!.sha && m.pins.new?.sha === PINS.new!.sha && m.sim_rules.founder.length === 64 && m.sim_rules.builder.length === 64 && m.build_commit === "c0ffee" && Object.values(m.briefs).every((d) => /^[0-9a-f]{64}$/.test(d) && d !== "declared"), detail: Object.keys(m.briefs).length + " briefs" }; } },
  { name: "manifest: a relaunch with the same inputs matches byte for byte", run: async () => { const briefs = fixtureBriefs(); const out = join(mkdtempSync(join(tmpdir(), "ohr-run-")), "out"); await scriptedRun({ briefs, out, only: () => false }); let err = ""; try { await scriptedRun({ briefs, out, only: () => false }); } catch (e) { err = (e as Error).message; } return { ok: !err.startsWith("E_OHR_MANIFEST") || err.includes("cap stop"), detail: err.slice(0, 80) || "matched" }; } },
  { name: "manifest: a relaunch after a brief's file changed is refused", run: async () => { const briefs = fixtureBriefs(); const out = join(mkdtempSync(join(tmpdir(), "ohr-run-")), "out"); await scriptedRun({ briefs, out, only: (e) => e.arm === "none" && false }).catch(() => {}); const id = firstCal(briefs); writeFileSync(join(briefs, id, "sheet.json"), readFileSync(join(briefs, id, "sheet.json"), "utf8") + " "); let err = ""; try { await scriptedRun({ briefs, out }); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_MANIFEST"), detail: err.slice(0, 120) }; } },
  { name: "manifest: a relaunch on another build commit is refused", run: async () => { const briefs = fixtureBriefs(); const out = join(mkdtempSync(join(tmpdir(), "ohr-run-")), "out"); await scriptedRun({ briefs, out, only: () => false }).catch(() => {}); let err = ""; try { await scriptedRun({ briefs, out, buildCommit: "d".repeat(40) }); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_MANIFEST") && !err.includes("cap stop"), detail: err.slice(0, 120) }; } },
  // The reserve rule (section 3).
  { name: "reserves: a dropped unpaired founder brief takes the first unpaired founder reserve in draw order", run: () => { const b = loadBriefs(fixtureBriefs()); const drop = b.find((x) => x.set === "comparison" && x.kind === "founder" && !x.twin_of)!; const first = b.filter((x) => x.set === "reserve" && x.kind === "founder" && !x.twin_of).sort((p, q) => p.draw - q.draw)[0]!; const s = comparisonSet(b, [drop.id]); return { ok: s.ids.length === 80 && !s.ids.includes(drop.id) && s.ids.includes(first.id) && s.replaced[0]!.by.join() === first.id, detail: JSON.stringify(s.replaced) }; } },
  { name: "reserves: a dropped twin drops its pair, and a reserve pair replaces it", run: () => { const b = loadBriefs(fixtureBriefs()); const drop = b.find((x) => x.set === "comparison" && x.twin_of)!; const s = comparisonSet(b, [drop.id]); const r = s.replaced[0]!; return { ok: s.ids.length === 80 && r.dropped.length === 2 && r.by.length === 2 && !s.ids.includes(drop.twin_of!) && r.by.every((id) => b.find((x) => x.id === id)!.twin_of !== null), detail: JSON.stringify(r) }; } },
  { name: "reserves: a dropped builder brief takes a builder reserve", run: () => { const b = loadBriefs(fixtureBriefs()); const drop = b.find((x) => x.set === "comparison" && x.kind === "builder")!; const s = comparisonSet(b, [drop.id]); return { ok: b.find((x) => x.id === s.replaced[0]!.by[0])!.kind === "builder", detail: JSON.stringify(s.replaced) }; } },
  { name: "reserves: a drop with no reserve of its kind left is refused", run: () => { const b = loadBriefs(fixtureBriefs()); const drops = b.filter((x) => x.set === "comparison" && x.kind === "builder").slice(0, 3).map((x) => x.id); let err = ""; try { comparisonSet(b, drops); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_RESERVE") && comparisonSet(b, drops.slice(0, 2)).replaced.length === 2, detail: err.slice(0, 90) }; } },
  { name: "reserves: a brief that already has a stage 2 session cannot be dropped", run: () => { const b = loadBriefs(fixtureBriefs()); const drop = b.find((x) => x.set === "comparison" && x.kind === "builder")!; let err = ""; try { comparisonSet(b, [drop.id], new Set([drop.id])); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_RESERVE") && err.includes("already"), detail: err }; } },
  // T8 seeding (section 4 step 6; change 2, section 4).
  { name: "T8: a launch whose T8 test date is not two days before the session's day is refused before the rig opens", run: async () => { let opened = false; let err = ""; try { await scriptedRun({ day: "2026-11-02", opened: () => (opened = true) }); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_T8_SEED") && !opened, detail: err.slice(0, 100) }; } },
  { name: "T8: the same briefs launch when the test date is two days back", run: async () => { const { run } = await scriptedRun({ day: "2026-11-03", only: () => false }); return { ok: run.stops.length === 0 && run.rows.length === 72 / 3, detail: run.rows.length + " rows" }; } },
  { name: "T8: a T8 launch on the none arm alone needs no seed", run: async () => { const { run } = await scriptedRun({ day: "2026-11-02", arms: ["none"], only: () => false }); return { ok: run.stops.length === 0 && run.rows.length === 8, detail: run.rows.length + " rows" }; } },
  { name: "T8: the new pin's seed holds its commitment entry, the current pin's only the session entry", run: () => { const repo = workRepo(join(mkdtempSync(join(tmpdir(), "ohr-t8-")), "repo")); const f = seedPrior(repo, "new", PRIOR, DAY); const p = JSON.parse(readFileSync(f, "utf8")); return { ok: p.sessions.length === 2 && p.sessions[1].mode === "commitment" && priorEntries("current", PRIOR).length === 1 && p.sessions[0].assignment.includes(PRIOR.test), detail: p.sessions.map((s: { mode: string }) => s.mode).join() }; } },
];
