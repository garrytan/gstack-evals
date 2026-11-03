// GEVA-203 (panel v3 C1): the Claude Code adapter's follow-up and preflight options. The keyless describe drives the real
// pinned Agent SDK 0.3.314 against the stub CLI's script mode (fixtures/stub-cli.cjs); the real-CLI describe drives CLI
// 2.1.314 behind the real metering proxy and a fake upstream, also keyless.
import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ALLOWANCE_SPENT, claudeCodeDriver, type ClaudeCodeOptions } from "../../src/adapters/claude-code/driver.ts";
import type { StepResult } from "../../src/trial/sandbox.ts";
import type { Termination } from "../../src/types.ts";
import { HAS_CLAUDE_CLI, harness, type Harness, type Script } from "./harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const MODEL = "claude-haiku-5-5";
const STUB = join(import.meta.dir, "fixtures", "stub-cli.cjs");
const PROMPT = "Review plan.md for problems.";
const FOLLOW = 'List every problem you found in plan.md.\n\nEnd your reply with one fenced block whose info string is plan-findings. Each object has these fields:\n- "severity": Critical, High, Medium or Low\n- "line": the line number in plan.md, or null';
const FOLLOW_UP = { text: FOLLOW, maxTurns: 5, timeoutMs: 10_000 };
const BLOCK = "Findings.\n\n" + "\x60\x60\x60plan-findings\n[]\n\x60\x60\x60";
const text = (t: string) => [{ type: "text" as const, text: t }];
const NOT_SENT = { sent: false, model_turns: 0 };

type Entry = Record<string, unknown>;
type Opts = Partial<Pick<ClaudeCodeOptions, "maxTurns" | "capStops" | "followUp" | "preflight" | "backgroundWaitMs" | "freeform" | "entry" | "codex">>;

/** One session on the real SDK with the stub CLI: STUB_SCRIPT answers each user message unless env names another mode. */
async function stub(script: Entry[] | null, o: Opts, run: { timeoutMs?: number; env?: Record<string, string>; exec?: (command: string, ms: number) => StepResult } = {}) {
  const out = mkdtempSync(join(tmpdir(), "two-turn-"));
  const file = join(out, "record.ndjson");
  const execs: { command: string; ms: number }[] = [];
  let spawned = 0;
  const session = {
    exec: (command: string, ms: number) => {
      execs.push({ command, ms });
      return run.exec?.(command, ms) ?? { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
    },
    spawn: (argv: string[], e: Record<string, string>) => {
      if (argv[0] === "true") return spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] });
      spawned++;
      return spawn(process.execPath, [STUB, ...argv.slice(1)], { env: { ...e, PATH: process.env.PATH ?? "", STUB_RECORD: file, ...(script ? { STUB_MODE: "script", STUB_SCRIPT: JSON.stringify(script) } : {}), ...run.env }, stdio: ["pipe", "pipe", "pipe"] });
    },
    stop: () => {},
  };
  const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" }, skill: null, out, ...o });
  const started = performance.now();
  const outcome = await driver.run(session as never, { id: "t", prompt: PROMPT }, run.timeoutMs ?? 20_000);
  const elapsed = performance.now() - started;
  const record = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const read = (f: string) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8") : "");
  return { outcome, elapsed, spawned, execs, processes: record.filter((r) => r.argv).length, users: record.filter((r) => r.type === "user").map((r) => r.message.content), probes: record.filter((r) => r.probe).map((r) => r.probe), log: read("cli-stderr.log") };
}

/** The metering proxy's own refusal for one call, as the CLI prints it: "API Error: <status> <problem body>". */
async function refusal(o: { allowance?: number; capMicros?: number; down?: boolean }) {
  const h = harness(() => {
    if (o.down) throw new Error("connection reset");
    return text("ok");
  }, o.capMicros === undefined ? {} : { capMicros: o.capMicros });
  open.push(h);
  const b = h.proxy.bind({ cell: { run_id: "run-test", arm: "after", task: "t", model: MODEL, trial: 0, attempt: 1 }, models: ["anthropic:" + MODEL], allowance_micros: o.allowance ?? 50_000_000 });
  const res = await fetch(h.baseUrl + "/" + b.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", authorization: "Bearer " + b.token }, body: JSON.stringify({ model: MODEL, max_tokens: 1024, tools: [{ name: "Bash", input_schema: { type: "object" } }], messages: [{ role: "user", content: "hi" }] }) });
  return { apierror: "API Error: " + res.status + " " + (await res.text()), status: res.status };
}

const sh = (command: string, ms: number): StepResult => {
  const r = spawnSync("sh", ["-c", command], { timeout: ms, encoding: "utf8" });
  return { exitCode: r.status ?? 1, timedOut: r.error?.message.includes("ETIMEDOUT") ?? false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

// Value: protects=plan v3's two-turn sessions (GEVA-165 plan, sections 4 and 5; GEVA-203 contract 1): the follow-up goes in verbatim once, in the same CLI session, only after a completed first turn and after any simulator reply; every first-turn stop ends the session with no follow-up; every second-turn stop keeps its own termination with follow_up sent and the adapter's own count of main-agent model turns; the second turn's own cap binds at exactly maxTurns and its own clock replaces the session's; a refused preflight ends the session before any CLI spawn and logs why; fails_when=the follow-up goes in after a stop, twice, or before a simulator reply, the turn-2 cap fires early, late or without the CLI being about to call again, a simulator reply goes in after the cap, turn 2 inherits the session deadline, or a refused preflight still spawns the CLI; why_new=C1 adds a second scripted user message to every plan session and a clean-room check before it; seam=the driver's result, user and assistant branches and its clock, through the real Agent SDK 0.3.314 and the stub CLI's script mode; no_claim=the real CLI, which the describe below covers
describe("GEVA-203: the follow-up and preflight on the pinned Agent SDK against a stub CLI (keyless)", () => {
  test("the follow-up goes in verbatim as the second user message of the same CLI session once the first turn ends completed", async () => {
    const touched = join(mkdtempSync(join(tmpdir(), "two-turn-touch-")), "touched");
    const r = await stub([{ content: text("I read plan.md.") }, { content: text(BLOCK) }], { followUp: FOLLOW_UP, capStops: true }, { env: { STUB_TOUCH: touched, STUB_PROBE: JSON.stringify([touched]) } });
    expect(r.processes).toBe(1);
    expect(r.users).toEqual([PROMPT, FOLLOW]);
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.follow_up).toEqual({ sent: true, model_turns: 1 });
    expect(r.outcome.turns.at(-1)).toBe(BLOCK);
    expect(r.probes).toEqual([{ [touched]: false }, { [touched]: true }]);
    const plain = await stub([{ content: text("I read plan.md.") }], {});
    expect(plain.users).toEqual([PROMPT]);
    expect("follow_up" in plain.outcome).toBe(false);
  }, 60_000);

  test("a first-turn simulator reply goes in before the follow-up, and the simulator still answers in the second turn", async () => {
    const sim = { freeform: async () => ({ text: "Go with your recommendation." }), entry: { user: { persona: "p" } } as never };
    const first = await stub([{ content: text("Which option do you want?") }, { content: text("Noted.") }, { content: text(BLOCK) }], { followUp: FOLLOW_UP, ...sim });
    expect(first.users.length).toBe(3);
    expect(first.users[1]).not.toBe(FOLLOW);
    expect(first.users[2]).toBe(FOLLOW);
    expect([first.outcome.termination, first.outcome.follow_up]).toEqual([{ kind: "completed" }, { sent: true, model_turns: 1 }]);
    const second = await stub([{ content: text("I read plan.md.") }, { content: text("Which option do you want?") }, { content: text(BLOCK) }], { followUp: FOLLOW_UP, ...sim });
    expect(second.users.length).toBe(3);
    expect(second.users[1]).toBe(FOLLOW);
    expect([second.outcome.termination, second.outcome.follow_up]).toEqual([{ kind: "completed" }, { sent: true, model_turns: 2 }]);
  }, 60_000);

  test("every first-turn stop ends the session with no follow-up", async () => {
    const spent = await refusal({ allowance: 100 });
    expect(spent.apierror).toMatch(ALLOWANCE_SPENT);
    const upstream = await refusal({ down: true });
    expect(upstream.apierror).toContain("UPSTREAM");
    const capStop = await refusal({ capMicros: 1 });
    expect(capStop.apierror).toContain("CAP_STOP");
    const cases: [string, Entry[] | null, Opts, Parameters<typeof stub>[2], Termination][] = [
      ["turn cap, capStops", [{ turns: 3 }], { maxTurns: 3, capStops: true }, {}, { kind: "turn_cap" }],
      ["turn cap, no capStops", [{ turns: 3 }], { maxTurns: 3 }, {}, { kind: "completed" }],
      ["allowance stop", [spent], { capStops: true }, {}, { kind: "allowance_stop" }],
      ["UPSTREAM", [upstream], {}, {}, { kind: "missing", code: "UPSTREAM" }],
      ["ledger CAP_STOP", [capStop], {}, {}, { kind: "cap_stop" }],
      ["crash", [{ exit: 1 }], {}, {}, { kind: "arm_failure", failure: "harness_crash" }],
      ["timeout", [{ content: text("Reading."), hang: true }], {}, { timeoutMs: 1_500 }, { kind: "timeout" }],
      ["background deadline", null, { backgroundWaitMs: 500 }, { env: { STUB_MODE: "background", STUB_BG: JSON.stringify({ readers: [{ id: "r1", delay: null }] }) } }, { kind: "missing", code: "E_BACKGROUND_DEADLINE" }],
    ];
    for (const [name, script, o, run, termination] of cases) {
      const r = await stub(script, { ...o, followUp: FOLLOW_UP }, run);
      expect([name, r.outcome.termination, r.outcome.follow_up, r.users]).toEqual([name, termination, NOT_SENT, [PROMPT]]);
    }
  }, 120_000);

  test("every second-turn stop keeps its termination, with follow_up sent and the second turn's model turns counted", async () => {
    const spent = await refusal({ allowance: 100 });
    const upstream = await refusal({ down: true });
    const capStop = await refusal({ capMicros: 1 });
    const first = { content: text("I read plan.md.") };
    const cases: [string, Entry, Opts, Termination, number][] = [
      ["own turn cap at maxTurns, capStops", { turns: 10 }, { capStops: true }, { kind: "turn_cap" }, 5],
      ["own turn cap at maxTurns, no capStops", { turns: 10 }, {}, { kind: "completed" }, 5],
      ["maxTurns turns ending in text: no cap", { turns: 4, content: text(BLOCK) }, { capStops: true }, { kind: "completed" }, 5],
      ["the CLI's error_max_turns first", { turns: 3 }, { maxTurns: 3, capStops: true }, { kind: "turn_cap" }, 3],
      ["allowance stop", spent, { capStops: true }, { kind: "allowance_stop" }, 1],
      ["UPSTREAM", upstream, {}, { kind: "missing", code: "UPSTREAM" }, 1],
      ["ledger CAP_STOP", capStop, {}, { kind: "cap_stop" }, 1],
      ["crash", { exit: 1 }, {}, { kind: "arm_failure", failure: "harness_crash" }, 1],
    ];
    for (const [name, second, o, termination, turns] of cases) {
      const r = await stub([first, second], { ...o, followUp: FOLLOW_UP });
      expect([name, r.outcome.termination, r.outcome.follow_up, r.users]).toEqual([name, termination, { sent: true, model_turns: turns }, [PROMPT, FOLLOW]]);
    }
  }, 120_000);

  test("a simulator reply after the second turn's last allowed model turn ends the session at the cap with no further user message", async () => {
    const sim = { freeform: async () => ({ text: "Go with your recommendation." }), entry: { user: { persona: "p" } } as never };
    const script = [{ content: text("I read plan.md.") }, { turns: 4, content: text("Which option do you want?") }, { content: text(BLOCK) }];
    const capped = await stub(script, { followUp: FOLLOW_UP, capStops: true, ...sim });
    expect([capped.outcome.termination, capped.outcome.follow_up, capped.users]).toEqual([{ kind: "turn_cap" }, { sent: true, model_turns: 5 }, [PROMPT, FOLLOW]]);
    const plain = await stub(script, { followUp: FOLLOW_UP, ...sim });
    expect([plain.outcome.termination, plain.outcome.follow_up, plain.users]).toEqual([{ kind: "completed" }, { sent: true, model_turns: 5 }, [PROMPT, FOLLOW]]);
  }, 60_000);

  test("the second turn runs on its own clock: its own timeout while the session's is far off, and its full timeoutMs after a long first turn", async () => {
    const own = await stub([{ content: text("I read plan.md.") }, { content: text("Listing."), hang: true }], { followUp: { ...FOLLOW_UP, timeoutMs: 1_000 } }, { timeoutMs: 60_000 });
    expect([own.outcome.termination, own.outcome.follow_up]).toEqual([{ kind: "timeout" }, { sent: true, model_turns: 1 }]);
    expect(own.elapsed).toBeLessThan(10_000);
    const long = await stub([{ content: text("I read plan.md."), delay: 2_000 }, { content: text(BLOCK), delay: 2_000 }], { followUp: { ...FOLLOW_UP, timeoutMs: 4_000 } }, { timeoutMs: 3_000 });
    expect([long.outcome.termination, long.outcome.follow_up]).toEqual([{ kind: "completed" }, { sent: true, model_turns: 1 }]);
    expect(long.elapsed).toBeGreaterThan(4_000);
  }, 60_000);

  test("preflight: exit 0 runs the session; a non-zero exit or a timeout ends it as a missing cell with its code before any CLI spawn, and logs why", async () => {
    const code = "E_CLEAN_ROOM" as const;
    const ok = await stub([{ content: text("Done.") }], { preflight: { command: "true", code } }, { exec: sh });
    expect([ok.outcome.termination, ok.spawned, ok.execs]).toEqual([{ kind: "completed" }, 1, [{ command: "true", ms: 30_000 }]]);
    const refused = await stub([{ content: text("Done.") }], { preflight: { command: "echo found /home/agent/.capy; exit 3", code }, followUp: FOLLOW_UP }, { exec: sh });
    expect([refused.outcome.termination, refused.spawned, refused.outcome.model_output, refused.outcome.follow_up]).toEqual([{ kind: "missing", code }, 0, false, NOT_SENT]);
    expect(refused.log).toBe("adapter: preflight refused: found /home/agent/.capy\n");
    const slow = await stub([{ content: text("Done.") }], { preflight: { command: "sleep 5", code } }, { exec: (command, ms) => sh(command, Math.min(ms, 300)) });
    expect([slow.outcome.termination, slow.spawned, slow.log]).toEqual([{ kind: "missing", code }, 0, "adapter: preflight refused: timed out\n"]);
    const both = await stub([{ content: text("Done.") }], { codex: { provider: "openrouter", model: "openai/gpt-6.1-sol" }, preflight: { command: "true", code } });
    expect(both.execs.map((e) => e.command === "true")).toEqual([false, true]);
  }, 60_000);
});

// Value: protects=the same follow-up on CLI 2.1.314 behind the real metering proxy: it reaches the model verbatim as the next user message with turn 1 in its history, and the adapter's own turn-2 cap ends the session because the CLI's --max-turns count starts fresh at each user message (pinned below: a session cap of 2 still gives turn 2 two calls after turn 1 used two), interrupting the CLI's turn so no call follows the cap (without the interrupt the CLI made 58 more calls in the SDK's 2 s teardown grace); fails_when=the CLI drops or rewrites the follow-up, starts a new session for it, shares one --max-turns count across user messages, or the cap lets turn 2 run past maxTurns; why_new=the #101 and #106 lesson (test against the real pinned binaries); seam=CLI 2.1.314 and MeteringProxy; no_claim=a real model
describe.skipIf(!HAS_CLAUDE_CLI)("GEVA-203: the follow-up on the real CLI 2.1.314", () => {
  async function real(script: Script, o: Opts) {
    const h = harness(script);
    open.push(h);
    const b = h.bind(MODEL);
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: b.slot, token: b.token }, skill: null, out: join(h.dir, "host"), query: query as never, ...o });
    const outcome = await driver.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), driver.env!), { id: "t", prompt: PROMPT }, 120_000);
    const main = h.upstream.filter((u) => (u.body.tools ?? []).some((t: { name: string }) => t.name === "Bash"));
    const turn1 = main.filter((u) => !JSON.stringify(u.body.messages).includes("plan-findings")).length;
    return { outcome, main, turn1, turn2: main.length - turn1 };
  }

  test("the follow-up reaches the model verbatim as the next user message, with turn 1 in its history", async () => {
    let seen: string[] = [];
    const script: Script = (t) => {
      seen = t.users;
      return t.users.includes(FOLLOW) ? text(BLOCK) : text("I read plan.md.");
    };
    const r = await real(script, { followUp: FOLLOW_UP, capStops: true });
    expect([r.outcome.termination, r.outcome.follow_up, r.outcome.turns.at(-1)]).toEqual([{ kind: "completed" }, { sent: true, model_turns: 1 }, BLOCK]);
    expect([r.turn1, r.turn2]).toEqual([1, 1]);
    expect(seen.length).toBe(2);
    expect(seen[1]).toBe(FOLLOW);
    expect(JSON.stringify(r.main.at(-1)!.body.messages)).toContain("I read plan.md.");
  }, 240_000);

  test("the adapter's own cap ends turn 2 as turn_cap after exactly maxTurns model turns", async () => {
    let n = 0;
    const script: Script = (t) => (t.users.includes(FOLLOW) ? [{ type: "tool_use", id: "toolu_f" + n++, name: "Bash", input: { command: "true" } }] : text("I read plan.md."));
    const r = await real(script, { followUp: { ...FOLLOW_UP, maxTurns: 2 }, capStops: true });
    expect([r.outcome.termination, r.outcome.follow_up]).toEqual([{ kind: "turn_cap" }, { sent: true, model_turns: 2 }]);
    expect(r.turn2).toBeGreaterThanOrEqual(2);
    expect(r.turn2).toBeLessThanOrEqual(3);
  }, 240_000);

  test("CLI 2.1.314 gives each user message a fresh --max-turns count, and its error_max_turns in turn 2 is turn_cap", async () => {
    let n = 0;
    const script: Script = (t) => {
      if (t.users.includes(FOLLOW)) return [{ type: "tool_use", id: "toolu_g" + n++, name: "Bash", input: { command: "true" } }];
      return t.results.size ? text("I read plan.md.") : [{ type: "tool_use", id: "toolu_first", name: "Bash", input: { command: "true" } }];
    };
    const r = await real(script, { maxTurns: 2, followUp: FOLLOW_UP, capStops: true });
    expect([r.turn1, r.turn2]).toEqual([2, 2]);
    expect([r.outcome.termination, r.outcome.follow_up]).toEqual([{ kind: "turn_cap" }, { sent: true, model_turns: 2 }]);
  }, 240_000);

  // Value: protects=GST-1121 (Capy's medium on #166 at driver.ts:600): a turn-2 cap reached at a result while background work holds the session interrupts the CLI before it closes, and asks the simulator nothing, so no model call follows the cap; without it CLI 2.1.314 made 50 more calls after the close and 60 while the persona answered; a final answer at the cap with nothing held still ends completed; fails_when=the cap's result end closes the CLI without an interrupt, or awaits the persona while the work is held; why_new=GST-1121 item 2; seam=the driver's result branch on CLI 2.1.314 and MeteringProxy; no_claim=a real model
  test("a turn-2 cap at a result while background work is held interrupts the CLI, so no model call follows it", async () => {
    const bg = [{ type: "tool_use" as const, id: "toolu_bg", name: "Bash", input: { command: "sleep 1", run_in_background: true } }];
    const fg = [{ type: "tool_use" as const, id: "toolu_fg", name: "Bash", input: { command: "true" } }];
    const persona = { freeform: async () => (await Bun.sleep(3_000), { text: "Go with your recommendation." }), entry: { user: { persona: "p" } } as never };
    const cases = [
      ["held, lands after the close", bg, "Waiting.", {}, { kind: "turn_cap" }],
      ["held, lands while the persona answers", bg, "Which option do you want?", persona, { kind: "turn_cap" }],
      ["nothing held, a final answer", fg, BLOCK, {}, { kind: "completed" }],
    ] as const;
    for (const [name, first, last, sim, termination] of cases) {
      let n = 0;
      const script: Script = (t) => {
        if (!t.users.includes(FOLLOW)) return text("I read plan.md.");
        n++;
        return n === 1 ? [...first] : text(n === 2 ? last : "More.");
      };
      const r = await real(script, { followUp: { ...FOLLOW_UP, maxTurns: 2 }, capStops: true, backgroundWaitMs: 60_000, ...sim });
      await Bun.sleep(4_000);
      expect([name, r.outcome.termination, r.outcome.follow_up, n]).toEqual([name, termination, { sent: true, model_turns: 2 }, 2]);
    }
  }, 240_000);
});
