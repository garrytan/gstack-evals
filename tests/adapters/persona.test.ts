import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeDriver, unapprovedAsks } from "../../src/adapters/claude-code/driver.ts";
import { judgeRequest } from "../../src/adapters/judge.ts";
import { personaAnswer, personaPrompt, type PersonaAnswer } from "../../src/usersim/persona.ts";
import { NON_APPROVING } from "../../src/usersim/sim.ts";
import type { AgentSession } from "../../src/trial/sandbox.ts";

type Msg = Record<string, any>;
const init: Msg = { type: "system", subtype: "init", model: "m", tools: [], skills: [] };
const said = (text: string): Msg => ({ type: "assistant", message: { content: [{ type: "text", text }] }, parent_tool_use_id: null });
const done: Msg = { type: "result", subtype: "success", num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } };
const ASK = { questions: [{ question: "Which approach should we take?", header: "Approach", options: [{ label: "Approach A", description: "" }, { label: "Approach B", description: "the smaller change" }] }] };
const askUse: Msg = { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_q", name: "AskUserQuestion", input: ASK }] }, parent_tool_use_id: null };
const answered = (text: string, error = false): Msg => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_q", content: text, is_error: error }] }, parent_tool_use_id: null });

/** A stand-in for the Agent SDK's query: each user message the driver sends gets the next scripted turn; a turn may call the driver's options first. */
function stub(turns: ((options: Msg) => Promise<Msg[]>)[], sent: string[]) {
  return ({ prompt, options }: { prompt: AsyncIterable<Msg>; options: Msg }) => (async function* () {
    yield init;
    let i = 0;
    for await (const m of prompt) {
      sent.push(String(m.message.content));
      const turn = turns[i++];
      if (!turn) return;
      yield* await turn(options);
    }
  })();
}

const QUESTION = "Before I start: what's the strongest evidence you have that someone actually wants this?";
const drive = async (turns: ((options: Msg) => Promise<Msg[]>)[], o: { freeform?: (persona: string, question: string) => Promise<PersonaAnswer>; replies?: Record<string, string>; timeoutMs?: number } = {}) => {
  const out = mkdtempSync(join(tmpdir(), "gse-persona-"));
  const sent: string[] = [];
  const driver = claudeCodeDriver({ model: "claude-haiku-5-5", provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" }, entry: { user: { persona: "A dentist-software founder in a hurry.", ...(o.replies ? { replies: o.replies } : {}) } }, skill: null, out, query: stub(turns, sent) as never, ...(o.freeform ? { freeform: o.freeform } : {}) });
  const outcome = await driver.run({} as AgentSession, { id: "t", prompt: "Say hello." }, o.timeoutMs ?? 30_000);
  const events = readFileSync(join(out, "usersim.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { outcome, sent, events };
};

describe("the persona's free-form source in the Claude Code adapter", () => {
  // Value: protects=a question the sidecar does not answer goes to the persona's source with the persona and the question, and its answer is the next user message; an answer that approves a gated effect still goes out as the fixed non-approving reply (#64's binding); a source that cannot answer ends the cell with its termination instead of a fallback; fails_when=the persona answer is dropped, a free-form approval reaches the agent, or a usersim cap stop is counted as an outcome; why_new=GST-273 (U10b wires the free-form model); seam=claudeCodeDriver's freeform option over a stand-in SDK; no_claim=the real CLI and the usersim slot (tests/adapters/run-host.test.ts)
  test("a free-form answer goes in as the next user message, under the binding rules, the clock stops while it is pending, and a failed source ends the cell", async () => {
    const asked: string[][] = [];
    const answer = (text: string) => async (persona: string, question: string): Promise<PersonaAnswer> => {
      asked.push([persona, question]);
      return { text };
    };
    const ok = await drive([async () => [said(QUESTION), done], async () => [said("FINAL: noted."), done]], { freeform: answer("Three dentists paid a deposit.") });
    expect(ok.outcome.termination).toEqual({ kind: "completed" });
    expect(ok.sent).toEqual(["Say hello.", "Three dentists paid a deposit."]);
    expect(asked[0]).toEqual(["A dentist-software founder in a hurry.", QUESTION]);
    expect(ok.events.find((e) => e.kind === "prose")).toMatchObject({ source: "freeform", reply: "Three dentists paid a deposit.", approves: false });

    const grant = await drive([async () => [said("Shall I push the branch now?"), done], async () => [said("FINAL: ok."), done]], { freeform: answer("Yes, push it.") });
    expect(grant.sent[1]).toBe(NON_APPROVING);

    // gstack-timing-ok: the answer takes twice the session's limit, so a running clock would end the cell as a timeout; the stand-in session's own work takes milliseconds
    const slow = await drive([async () => [said(QUESTION), done], async () => [said("FINAL: noted."), done]], { timeoutMs: 1_000, freeform: async () => (await Bun.sleep(2_000), { text: "Three dentists paid a deposit." }) });
    expect(slow.outcome.termination).toEqual({ kind: "completed" });

    const capped = await drive([async () => [said(QUESTION), done], async () => [said("FINAL: never sent."), done]], { freeform: async () => ({ stop: { kind: "cap_stop" } }) });
    expect(capped.outcome.termination).toEqual({ kind: "cap_stop" });
    expect(capped.sent).toEqual(["Say hello."]);
  });

  // Value: protects=an AskUserQuestion's free-form prompt carries its options, so the persona can pick one, and the answer still lands as the tool's answer; fails_when=the options are dropped from what the source sees; why_new=GST-273; seam=UserSim.answerAsk via canUseTool; no_claim=none beyond protects
  test("an AskUserQuestion's options reach the free-form source", async () => {
    const asked: string[] = [];
    let answers: unknown = null;
    await drive([async (options) => {
      const r = await options.canUseTool("AskUserQuestion", ASK, { toolUseID: "toolu_q" });
      answers = r.updatedInput.answers;
      return [askUse, answered("answered"), said("FINAL: B."), done];
    }], { freeform: async (_p, q) => (asked.push(q), { text: "Approach B, please." }) });
    expect(asked).toEqual(["Which approach should we take?\n- Approach A\n- Approach B: the smaller change"]);
    expect(answers).toEqual({ "Which approach should we take?": "Approach B, please." });
  });
});

describe("the approval path's backstop", () => {
  // Value: protects=the PreToolUse hook the adapter registers answers ask for every tool, and an AskUserQuestion answered without canUseTool voids the cell as E_APPROVAL_BYPASS, while one canUseTool answered, or one whose result is an error, does not; fails_when=a question answered outside the simulator counts as an outcome, or the hook lets a call skip canUseTool; why_new=GST-273 (U10b: allow rules can approve before canUseTool); seam=claudeCodeDriver's hooks option and unapprovedAsks over a stand-in SDK; no_claim=the real CLI's ordering (tests/adapters/claude-code.test.ts)
  test("an answer the simulator never gave ends the cell as E_APPROVAL_BYPASS", async () => {
    let decision: unknown = null;
    const bypass = await drive([async (options) => {
      decision = await options.hooks.PreToolUse[0].hooks[0]({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, tool_use_id: "toolu_b" }, "toolu_b", { signal: new AbortController().signal });
      return [askUse, answered("User chose Approach A."), said("FINAL: A."), done];
    }], { replies: { approach: "Approach B" } });
    expect(decision).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } });
    expect(bypass.outcome.termination).toEqual({ kind: "missing", code: "E_APPROVAL_BYPASS" });
    const routed = await drive([async (options) => {
      await options.canUseTool("AskUserQuestion", ASK, { toolUseID: "toolu_q" });
      return [askUse, answered("User chose Approach B."), said("FINAL: B."), done];
    }], { replies: { approach: "Approach B" } });
    expect(routed.outcome.termination).toEqual({ kind: "completed" });
    expect(unapprovedAsks([askUse, answered("bad input", true)], new Set())).toEqual([]);
    expect(unapprovedAsks([askUse, answered("x")], new Set(["toolu_q"]))).toEqual([]);
    expect(unapprovedAsks([askUse, answered("x")], new Set())).toEqual(["toolu_q"]);
    expect(unapprovedAsks([askUse, answered("PreToolUse:AskUserQuestion hook error: the user chose A", true)], new Set(), new Set(["toolu_q"]))).toEqual(["toolu_q"]);
  });
});

describe("persona pieces", () => {
  // Value: protects=the usersim request names the policy's model and a small output cap in each provider's field, the prompt carries the persona and the question, and a failed request maps to the cell's termination (a timeout or crash is E_USERSIM, never an arm failure); fails_when=the cap goes unset (the proxy would reserve its 32,768-token cap), the persona is dropped, or a usersim failure counts against the arm; why_new=GST-273; seam=judgeRequest, personaPrompt, personaAnswer; no_claim=none beyond protects
  test("request shape, prompt and termination mapping", () => {
    expect(judgeRequest("openai", "gpt-6-luna", "q", 1024)).toEqual({ model: "gpt-6-luna", input: [{ role: "user", content: "q" }], store: false, max_output_tokens: 1024 });
    expect(judgeRequest("anthropic", "claude-haiku-5-5", "q", 1024)).toMatchObject({ max_tokens: 1024 });
    expect(judgeRequest("openrouter", "x/y", "q", 1024)).toMatchObject({ max_tokens: 1024 });
    expect(judgeRequest("anthropic", "claude-haiku-5-5", "q")).toEqual({ model: "claude-haiku-5-5", messages: [{ role: "user", content: "q" }] });
    const p = personaPrompt(" A founder. ", "Which plan?");
    expect(p).toContain("<persona>\nA founder.\n</persona>");
    expect(p).toContain("<question>\nWhich plan?\n</question>");
    expect(personaAnswer({ kind: "completed" }, " Plan B. ")).toEqual({ text: "Plan B." });
    expect(personaAnswer({ kind: "completed" }, "  ")).toEqual({ text: null });
    expect(personaAnswer({ kind: "cap_stop" }, undefined)).toEqual({ stop: { kind: "cap_stop" } });
    expect(personaAnswer({ kind: "missing", code: "E_ALLOWANCE" }, undefined)).toEqual({ stop: { kind: "missing", code: "E_ALLOWANCE" } });
    expect(personaAnswer({ kind: "timeout" }, undefined)).toEqual({ stop: { kind: "missing", code: "E_USERSIM" } });
    expect(personaAnswer({ kind: "arm_failure", failure: "harness_crash" }, undefined)).toEqual({ stop: { kind: "missing", code: "E_USERSIM" } });
  });
});
