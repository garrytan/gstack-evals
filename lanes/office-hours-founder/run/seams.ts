// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's dry-run seams (start rule 7). Each drives one frozen rule on one side of its edge through the area's real
// code: section 6's C1 rows and the one-retry limit through runSchedule with a scripted launch, the closing message at the
// founder-reply limit and the pitch-only cell's limit of 0 through founderLoop, an allowance refusal before and after
// spend reaches the allowance, a refusal on the simulator's allowance, a session the ledger never admitted, and the
// manifest frozen before the first stage 2 lease. The tool refusal runs the driver through the real pinned Agent SDK and
// Claude Code CLI against a stub upstream (SKIP when the CLI is not installed). The container seams start real agent
// containers on a real trial network and probe them, so they run only under GSTACK_EVALS_DOCKER=1 and return a SKIP
// line otherwise, which the dry run counts as a failure, never a pass.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeDriver } from "../../../src/adapters/claude-code/driver.ts";
import { createTrialNetwork, removeTrialNetwork } from "../../../src/trial/proxy.ts";
import { checkImagePin, stateRoot } from "../../../src/trial/image.ts";
import { dockerSandbox } from "../../../src/trial/sandbox.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import type { Termination } from "../../../src/types.ts";
import { CLOSING, DENIED_TOOLS, FOUNDER_REPLIES } from "../frozen.ts";
import type { ManifestEntry, Seam, UnitMeta } from "../types.ts";
import { departures, probe } from "./contain.ts";
import { cellEntries, freezeManifest } from "./manifest.ts";
import { PRE_SMOKE, runSchedule, type Launch, type RunResult } from "./run.ts";
import { founderLimit, founderLoop, type FounderResult } from "./session.ts";

export const DOCKER_GATE = "GSTACK_EVALS_DOCKER=1";
const D = 1_000_000;
const tick = "\u0060\u0060\u0060";
export const BLOCK_REPLY = "My advice.\n\n" + tick + "first-move\n" + JSON.stringify({ first_move: "Sell the reminder service to the two garden leads first.", next_action: "Ask both leads to pay this week.", other_moves: [], doubt: "Volunteer uptake." }) + "\n" + tick;

/** One scripted attempt: the replies the arm gives (each its texts), then how the attempt ends and what its audit found. An unscripted attempt answers with a block. */
export interface ScriptedAttempt {
  replies?: string[][];
  termination?: Termination;
  web?: number;
  gstack_reads?: string[];
  contained?: string[] | null;
  overflow?: boolean;
  micros?: number;
}

/** A scripted launch: each attempt feeds its replies through the session's real founder loop, then reports its end. */
export const scriptedLaunch = (scripts: Map<string, ScriptedAttempt[]>, calls: string[] = []): Launch => async (o) => {
  const id = o.entry.unit + "/" + o.entry.arm + "/a" + o.attempt;
  calls.push(id);
  const a = scripts.get(o.entry.unit + "/" + o.entry.arm)?.[o.attempt - 1] ?? { replies: [[BLOCK_REPLY]] };
  let ended: Termination = { kind: "completed" };
  for (const texts of a.replies ?? []) {
    const next = await o.nextUser(texts);
    if ("stop" in next) {
      ended = next.stop;
      break;
    }
    if ("end" in next) break;
  }
  return { termination: a.termination ?? ended, web: a.web ?? 0, gstack_reads: a.gstack_reads ?? [], contained: a.contained === undefined ? [] : a.contained, overflow: a.overflow ?? false, micros: a.micros ?? 0 };
};

/** A fixture units dir of n calibration units with neutral invented sheets; never eval units. */
export function fixtureUnits(dir: string, n: number, set: UnitMeta["set"] = "calibration"): string[] {
  const ids = Array.from({ length: n }, (_, i) => "fixture-" + set + "-" + (i + 1));
  for (const [i, id] of ids.entries()) {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "opening.md"), "I am building a scheduling page for a small rowing club, number " + (i + 1) + ".\n");
    writeFileSync(join(dir, id, "sheet.json"), JSON.stringify({ persona: "A club volunteer.", facts: [{ id: "f1", text: "Six members asked for it.", reveal_when: "Asked who wants it.", kind: "demand" }, { id: "f2", text: "We use a paper sheet.", reveal_when: "Asked what they do today.", kind: "status-quo" }] }));
    const meta: UnitMeta = { id, stratum: set === "real" ? "real" : "constructed", set, draw: i + 1, author: "sol", shape: "s1", type: "other", industry: "fixture", primary: ["customer"], mentioned: [], generic: [], founder_stage: "pre-product", digest: "d" + i };
    writeFileSync(join(dir, id, "unit.json"), JSON.stringify(meta));
  }
  return ids;
}

/** A simulator that replies to every turn, or fails as given. */
export const fixtureFounder = (fail?: FounderResult) => async (): Promise<FounderResult> => fail ?? { kind: "reply", reply: "Six members asked for it.", revealed: ["f1"], rules: [3], attempts: 1 };

/** runSchedule on fixture units with a scripted launch, a stand-in rig and the stand-in simulator. */
export async function scriptedRun(o: { entries: (ids: string[]) => ManifestEntry[]; scripts: Map<string, ScriptedAttempt[]>; units?: number; founder?: FounderResult; cap?: number; openRig?: (out: string) => void; out?: string }): Promise<{ run: RunResult; calls: string[]; out: string; ids: string[] }> {
  const root = mkdtempSync(join(tmpdir(), "of-run-seam-"));
  const ids = fixtureUnits(join(root, "units"), o.units ?? 2);
  const out = o.out ?? join(root, "out");
  const calls: string[] = [];
  const rig = { recovery: null, close: async () => ({ committed: 0, unknown: 0, lease_id: null }) } as unknown as HostRig;
  const run = await runSchedule({ cell: "stage1", unitsDir: join(root, "units"), out, runId: "seam", models: ["opus"], arms: ["none", "lens", "office-hours"], repairs: [], allowances: PRE_SMOKE, cap: o.cap ?? 1000 * D, simCap: 1000 * D, parallel: 1, policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, ledger: null, docker: "docker", log: () => {}, entries: o.entries(ids) }, {
    openRig: () => (o.openRig?.(out), rig),
    simSlot: () => ({ call: null, spent: () => 0 }),
    founderTurn: fixtureFounder(o.founder),
    launch: scriptedLaunch(o.scripts, calls),
  });
  return { run, calls, out, ids };
}

const one = (arm: ManifestEntry["arm"] = "none", kind: ManifestEntry["kind"] = "arm") => (ids: string[]): ManifestEntry[] => [{ stage: 1, kind, unit: ids[0]!, model: "opus", arm, pass: 1 }];
const NO_BLOCK = ["Tell me more about the club?"];

/** A seam on one session: its scripted attempts, and the end, code and attempt count it must score. */
const c1 = (name: string, attempts: ScriptedAttempt[], want: { end: string; code: string | null; attempts: number }, arm: ManifestEntry["arm"] = "none", founder?: FounderResult): Seam => ({
  name,
  run: async () => {
    const { run, calls } = await scriptedRun({ entries: one(arm), scripts: new Map([["fixture-calibration-1/" + arm, attempts]]), founder });
    const r = run.rows[0]?.row;
    const ok = r?.end === want.end && r.code === want.code && r.attempts === want.attempts && calls.length === want.attempts;
    return { ok, detail: r ? r.end + " " + (r.code ?? "no code") + ", " + r.attempts + " attempt(s), " + calls.length + " launch(es)" : "no row; stops " + run.stops.map((s) => s.code).join(", ") };
  },
});

const turnCap: ScriptedAttempt = { replies: [NO_BLOCK], termination: { kind: "turn_cap" } };
const upstream: ScriptedAttempt = { replies: [NO_BLOCK], termination: { kind: "missing", code: "UPSTREAM" } };
const block: ScriptedAttempt = { replies: [[BLOCK_REPLY]] };
const allowanceStop = (micros: number): ScriptedAttempt => ({ replies: [NO_BLOCK], termination: { kind: "allowance_stop" }, micros });

/** The closing seams: a loop at limit with n founder replies already given. */
async function closingAt(limit: number, founderReplies: number): Promise<{ closing: boolean; simCalls: number }> {
  let simCalls = 0;
  const loop = founderLoop(limit, async () => (simCalls++, { kind: "reply", reply: "ok", revealed: [], rules: [], attempts: 1 }));
  let last: Awaited<ReturnType<typeof loop.nextUser>> = { end: true };
  for (let i = 0; i <= founderReplies; i++) last = await loop.nextUser(NO_BLOCK);
  return { closing: "reply" in last && last.reply === CLOSING, simCalls };
}

const pure: Seam[] = [
  c1("C1 block: a reply that holds a block ends the session as block", [{ replies: [NO_BLOCK, [BLOCK_REPLY]] }], { end: "block", code: null, attempts: 1 }),
  c1("C1 no block: the reply to the closing message holds no block, scored no-block", [{ replies: Array.from({ length: FOUNDER_REPLIES + 2 }, () => NO_BLOCK) }], { end: "no-block", code: "E_OF_NO_BLOCK", attempts: 1 }),
  c1("C1 arm stop: the turn limit on the first attempt and on its retry scores arm-stop", [turnCap, turnCap], { end: "arm-stop", code: "E_OF_ARM_STOP", attempts: 2 }),
  c1("C1 arm stop: the turn limit, then a block on the retry, scores block", [turnCap, block], { end: "block", code: null, attempts: 2 }),
  c1("C1 arm stop: 120 minutes twice scores arm-stop", [{ termination: { kind: "timeout" } }, { termination: { kind: "timeout" } }], { end: "arm-stop", code: "E_OF_ARM_STOP", attempts: 2 }),
  c1("C1 arm stop: context overflow twice scores arm-stop", [{ ...upstream, overflow: true }, { ...upstream, overflow: true }], { end: "arm-stop", code: "E_OF_ARM_STOP", attempts: 2 }),
  c1("C1 arm stop: an allowance refusal before spend reaches the allowance (worst case does not fit) scores arm-stop", [allowanceStop(2.9 * D), allowanceStop(2.9 * D)], { end: "arm-stop", code: "E_OF_ARM_STOP", attempts: 2 }),
  c1("C1 arm stop: an allowance refusal after spend reaches the allowance scores arm-stop", [allowanceStop(3 * D), allowanceStop(3 * D)], { end: "arm-stop", code: "E_OF_ARM_STOP", attempts: 2 }),
  c1("C1 infrastructure: a provider failure on the first attempt and on its retry is missing", [upstream, upstream], { end: "missing", code: "E_OF_INFRA_MISSING", attempts: 2 }),
  c1("C1 infrastructure: a provider failure, then a block on the retry, scores block", [upstream, block], { end: "block", code: null, attempts: 2 }),
  c1("one retry in all: an infrastructure failure, then an arm stop on the retry, scores arm-stop with no third attempt", [upstream, turnCap, block], { end: "arm-stop", code: "E_OF_ARM_STOP", attempts: 2 }),
  c1("one retry in all: an arm stop, then an infrastructure failure on the retry, is missing with no third attempt", [turnCap, upstream, block], { end: "missing", code: "E_OF_INFRA_MISSING", attempts: 2 }),
  c1("C1 never admitted: a session the ledger never admitted is missing at once, never retried", [{ termination: { kind: "missing", code: "E_LEDGER_UNAVAILABLE" } }, block], { end: "missing", code: "E_OF_INFRA_MISSING", attempts: 1 }),
  c1("C1 simulator allowance: a refusal on the simulator's allowance is missing, never retried", [{ replies: [NO_BLOCK] }, block], { end: "missing", code: "E_OF_INFRA_MISSING", attempts: 1 }, "none", { kind: "call-failed", reason: "allowance", detail: "E_ALLOWANCE: the session's simulator allowance" }),
  c1("C1 simulator checks: a turn that fails its checks twice is missing", [{ replies: [NO_BLOCK] }, block], { end: "missing", code: "E_OF_SIM_TURN", attempts: 1 }, "none", { kind: "check-failed", checks: ["json"], attempts: 2 }),
  c1("C1 simulator provider: a simulator provider failure twice is missing after one retry", [{ replies: [NO_BLOCK] }, { replies: [NO_BLOCK] }], { end: "missing", code: "E_OF_INFRA_MISSING", attempts: 2 }, "none", { kind: "call-failed", reason: "provider", detail: "UPSTREAM" }),
  c1("C1 web: a successful web result makes the session contaminated, block or not", [{ replies: [[BLOCK_REPLY]], web: 1 }], { end: "contaminated", code: "E_OF_WEB_CONTAMINATED", attempts: 1 }),
  c1("C1 gstack read: a none session that read a gstack file is gstack-read", [{ replies: [[BLOCK_REPLY]], gstack_reads: ["Read .claude/skills/gstack/office-hours/SKILL.md"] }], { end: "gstack-read", code: "E_OF_GSTACK_READ", attempts: 1 }),
  c1("C1 gstack read: an office-hours session that reads its own skill is not", [{ replies: [[BLOCK_REPLY]], gstack_reads: [] }], { end: "block", code: null, attempts: 1 }, "office-hours"),
  {
    name: "C1 cap stop: a ledger cap stop leaves an incomplete run, never retried, with the rest unrun",
    run: async () => {
      const { run, calls } = await scriptedRun({ entries: (ids) => ids.map((unit) => ({ stage: 1, kind: "arm", unit, model: "opus", arm: "none", pass: 1 })), units: 5, scripts: new Map([["fixture-calibration-1/none", [{ termination: { kind: "cap_stop" } }, block]]]) });
      const ok = run.rows.length === 0 && calls.length >= 1 && calls.filter((c) => c.startsWith("fixture-calibration-1/")).length === 1 && run.stops.some((s) => s.code === "CAP_STOP") && run.unrun.length === 5;
      return { ok, detail: run.rows.length + " rows, " + calls.length + " launches, stops " + run.stops.map((s) => s.code).join(", ") + ", " + run.unrun.length + " unrun" };
    },
  },
  ...[0, 1].map((short): Seam => ({
    name: short ? "admission: a round whose worst case is one micro-dollar over what is left starts no session" : "admission: a round whose worst case exactly fits what is left runs",
    run: async () => {
      const { run, calls } = await scriptedRun({ entries: (ids) => ids.map((unit) => ({ stage: 1, kind: "arm", unit, model: "opus", arm: "none", pass: 1 })), units: 4, cap: 2 * 4 * 3 * D - short, scripts: new Map() });
      const ok = short ? calls.length === 0 && run.stops[0]?.code === "CAP_STOP" && run.unrun.length === 4 : calls.length === 4 && run.stops.length === 0;
      return { ok, detail: calls.length + " launches against a cap of " + (2 * 4 * 3 * D - short) + " micros (4 sessions at twice $3), " + run.unrun.length + " unrun" };
    },
  })),
  {
    name: "closing message: after the 20th founder reply the closing message goes instead of the simulator",
    run: async () => {
      const r = await closingAt(founderLimit("arm", []), FOUNDER_REPLIES);
      return { ok: r.closing && r.simCalls === FOUNDER_REPLIES, detail: r.simCalls + " simulator calls, then " + (r.closing ? "the closing message" : "no closing message") };
    },
  },
  {
    name: "closing message: after the 19th founder reply the simulator still answers",
    run: async () => {
      const r = await closingAt(founderLimit("arm", []), FOUNDER_REPLIES - 1);
      return { ok: !r.closing && r.simCalls === FOUNDER_REPLIES, detail: r.simCalls + " simulator calls, " + (r.closing ? "the closing message" : "a founder reply") + " last" };
    },
  },
  {
    name: "closing message: under the limit repair the 30th founder reply is the last",
    run: async () => {
      const r = await closingAt(founderLimit("arm", ["limit-30"]), 30);
      return { ok: r.closing && r.simCalls === 30, detail: r.simCalls + " simulator calls, then " + (r.closing ? "the closing message" : "no closing message") };
    },
  },
  {
    name: "pitch-only cell: the limit is 0, the closing message is the first founder message and the simulator never answers",
    run: async () => {
      const { run } = await scriptedRun({ entries: one("office-hours", "pitch"), scripts: new Map([["fixture-calibration-1/office-hours", [{ replies: [NO_BLOCK, NO_BLOCK, NO_BLOCK] }]]]), founder: { kind: "check-failed", checks: ["the simulator was called"], attempts: 2 } });
      const r = run.rows[0]?.row;
      return { ok: founderLimit("pitch", ["limit-30"]) === 0 && r?.end === "no-block" && r.closing_sent && r.replies === 2 && r.founder_turns.length === 0, detail: r ? r.end + ", " + r.replies + " replies, " + r.founder_turns.length + " founder turns" : "no row" };
    },
  },
  {
    name: "manifest: the stage 2 manifest is frozen with its digest before the first lease",
    run: async () => {
      let seen = "";
      const { run } = await scriptedRun({ units: 2, entries: (ids) => ids.map((unit) => ({ stage: 2, kind: "arm", unit, model: "opus", arm: "none", pass: 1 })), scripts: new Map(), openRig: (out) => (seen = existsSync(join(out, "manifest.json")) ? (JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { sha256: string }).sha256 : "") });
      return { ok: seen !== "" && seen === run.manifest_sha256, detail: seen ? "manifest " + seen.slice(0, 12) + " on disk when the rig opened" : "no manifest when the rig opened" };
    },
  },
  {
    name: "manifest: a launch whose schedule differs from the frozen manifest is refused before any lease",
    run: async () => {
      const root = mkdtempSync(join(tmpdir(), "of-run-seam-"));
      const out = join(root, "out");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "manifest.json"), JSON.stringify({ sha256: "0".repeat(64), manifest: { schema: 1, cell: "stage2", models: [], arms: [], repairs: [], units: {}, entries: [] } }));
      let opened = false;
      try {
        await scriptedRun({ out, entries: (ids) => [{ stage: 2, kind: "arm", unit: ids[0]!, model: "opus", arm: "none", pass: 1 }], scripts: new Map(), openRig: () => (opened = true) });
        return { ok: false, detail: "the launch ran" };
      } catch (e) {
        return { ok: !opened && /E_USAGE/.test((e as Error).message), detail: (opened ? "the rig opened; " : "no rig; ") + (e as Error).message.slice(0, 120) };
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "manifest: stage 2 schedules 768 sessions in rounds of 4 units with all three arms on one model and pass",
    run: () => {
      const root = mkdtempSync(join(tmpdir(), "of-run-seam-"));
      fixtureUnits(root, 64, "comparison");
      const units = (JSON.parse("[]") as UnitMeta[]).concat(...Array.from({ length: 64 }, (_, i) => JSON.parse(readFileSync(join(root, "fixture-comparison-" + (i + 1), "unit.json"), "utf8")) as UnitMeta));
      const entries = cellEntries("stage2", units);
      const frozen = freezeManifest(join(root, "m.json"), { schema: 1, cell: "stage2", models: ["opus", "sol", "particle"], arms: ["none", "lens", "office-hours"], repairs: [], units: {}, entries });
      rmSync(root, { recursive: true, force: true });
      return { ok: entries.length === 64 * 3 * 4 && "sha256" in frozen, detail: entries.length + " sessions" };
    },
  },
];

/** The tool refusal on the real pinned SDK and CLI against a stub upstream: the denied tools never reach a request. */
async function toolSeam(deny: boolean): Promise<{ ok: boolean; detail: string }> {
  const { HAS_CLAUDE_CLI, harness } = await import("../../../tests/adapters/harness.ts");
  if (!HAS_CLAUDE_CLI) return { ok: false, detail: "SKIP needs the pinned Claude Code CLI under node_modules (bun install)" };
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const h = harness(() => [{ type: "text", text: BLOCK_REPLY }]);
  try {
    const b = h.bind("claude-opus-5-5");
    const d = claudeCodeDriver({ model: "claude-opus-5-5", provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: b.slot, token: b.token }, skill: null, out: join(h.dir, "host"), query: query as never, ...(deny ? { denyAsk: true, nextUser: async () => ({ end: true as const }) } : {}) });
    await d.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), d.env!), { id: "t", prompt: "Go." }, 120_000);
    const tools = h.upstream.filter((u) => (u.body.tools ?? []).some((t: { name: string }) => t.name === "Bash")).map((u) => (u.body.tools as { name: string }[]).map((t) => t.name));
    const denied = [...new Set(tools.flat().filter((t) => (DENIED_TOOLS as readonly string[]).includes(t)))];
    return deny ? { ok: tools.length > 0 && denied.length === 0, detail: tools.length + " requests, denied tools present: " + (denied.join(", ") || "none") } : { ok: denied.join() === "AskUserQuestion", detail: "without denyAsk the request carries " + (denied.join(", ") || "none") };
  } finally {
    h.close();
  }
}

const cli: Seam[] = [
  { name: "tools: WebSearch, WebFetch and AskUserQuestion never reach a request on the real CLI", run: () => toolSeam(true) },
  { name: "tools: without the option AskUserQuestion reaches the request, so the check above can fail", run: () => toolSeam(false) },
];

/** A real agent container on a real trial network, probed. */
async function containerSeam(env: Record<string, string | undefined>, leaky: boolean): Promise<{ ok: boolean; detail: string }> {
  if (env.GSTACK_EVALS_DOCKER !== "1") return { ok: false, detail: "SKIP needs Docker: set " + DOCKER_GATE + " to start and probe a real agent container" };
  const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const pin = checkImagePin({ state: stateRoot(env), docker });
  if (!pin.ok) return { ok: false, detail: pin.code + " " + pin.message };
  const root = mkdtempSync(join(tmpdir(), "of-run-seam-"));
  const net = createTrialNetwork(docker);
  const sandbox = dockerSandbox({ trialImage: pin.pin.tag, docker });
  const work = join(root, "work");
  mkdirSync(work, { recursive: true });
  mkdirSync(join(root, "extra"), { recursive: true });
  const session = sandbox.agent("idea", { work, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: sandbox.homePath(root), ANTHROPIC_AUTH_TOKEN: "slot-bearer", ...(leaky ? { FIXTURE_API_KEY: "not-a-key" } : {}) }, network: leaky ? "bridge" : net.name, ...(leaky ? { mounts: [{ host: join(root, "extra"), path: "/extra" }] } : {}) });
  try {
    const p = probe(session, docker, [sandbox.workPath(work, "idea"), sandbox.homePath(root)]);
    if (!p) return { ok: false, detail: "the probe could not run" };
    const found = departures(p);
    return leaky ? { ok: p.keys.includes("FIXTURE_API_KEY") && p.mounts.includes("/extra") && p.egress.open, detail: "flagged: " + found.join("; ") } : { ok: found.length === 0, detail: found.length ? found.join("; ") : "no key name, no mount but the work dir, egress closed (" + p.egress.detail + ")" };
  } finally {
    session.stop();
    removeTrialNetwork(net, docker);
    rmSync(root, { recursive: true, force: true });
  }
}

/** Every seam of the run area; the container seams return SKIP without GSTACK_EVALS_DOCKER=1. */
export function runSeams(env: Record<string, string | undefined> = process.env): Seam[] {
  return [...pure, ...cli,
    { name: "containment: an agent container holds no key name, no mount but the work dir and HOME, and no egress but the proxy", run: () => containerSeam(env, false) },
    { name: "containment: a container with a key name, an extra mount and open egress is flagged on all three", run: () => containerSeam(env, true) },
  ];
}

export const seams: Seam[] = runSeams();
