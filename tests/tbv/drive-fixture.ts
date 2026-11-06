// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic fixtures for the tbv driver tests: invented histories, a fake request builder, and a scripted provider stub
// that sits behind the real metering proxy. Nothing here is real session text.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { ARM_MODELS, type Arm, type BuildInput, type BuiltRequest, type Family, type History, type Shape, type Turn, type Turns } from "../../lanes/tbv/types.ts";

export const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value-for-tbv-tests", OPENAI_API_KEY: "fake-openai-value-for-tbv-tests", OPENROUTER_API_KEY: "fake-openrouter-value-for-tbv-tests" };
export const QUOTE = { words: "Approve the keyless tbv test cap", by: "test", source: "tests/tbv/drive-fixture.ts" };
export const TURNS: Turns = { report: "I'm back. Where do things stand?", d1: "Show me the full list, one item per line.", d2: "Expand item 3 of your summary.", followup: "Please answer in text." };

const dirs: string[] = [];
export const tmp = (prefix = "tbv-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
export const cleanup = () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
};

export function history(task: string, family: Family = "investigate"): History {
  return {
    schema: "tbv-history.v1",
    source: "A",
    task,
    cluster: "c-" + task,
    family,
    events: [
      { n: 1, kind: "user-text", text: "Fix the parser in the widget repo." },
      { n: 2, kind: "assistant-text", text: "I ran the unit tests; two failed in test_widget_parse." },
    ],
    sha256: "0".repeat(64),
    side: { files: [], resolved: null, patch: null },
  };
}

export const shape = (arm: Arm): Shape => ({ schema: "tbv-shape.v1", arm, pin: arm === "none" ? null : "pin0", claude_code: "2.1.312", system: [{ type: "text", text: "You are a coding agent (" + arm + ")." }], tools: [], max_tokens: 4000, sha256: "1".repeat(64) });

/** The fake builder: the task and arm in the first user message, one user message per turn, the replies between them. A task named wide asks D1 for more output than the proxy's cap, so the proxy refuses it (E_ALLOWANCE). */
export function fakeBuild(input: BuildInput): BuiltRequest {
  const seq: Turn[] = [...input.prior.map((p) => p.turn), input.turn];
  const messages: Array<Record<string, unknown>> = [];
  seq.forEach((t, i) => {
    const head = i === 0 ? "TASK " + input.history.task + " ARM " + input.arm + "\n" + input.history.events.map((e) => ("text" in e ? e.text : "")).join("\n") + "\n" : "";
    messages.push({ role: "user", content: [{ type: "text", text: head + "TURN " + t + ": " + input.turns[t], ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}) }] });
    if (i < input.prior.length) messages.push({ role: "assistant", content: input.prior[i]!.reply.content });
  });
  const body = { model: ARM_MODELS[input.model].id, max_tokens: input.history.task.includes("wide") && input.turn === "d1" ? 999_999 : 4000, system: input.shape.system, messages };
  return { provider: ARM_MODELS[input.model].provider, route: "/v1/messages", body, estTokens: Math.ceil(JSON.stringify(body).length / 3), sha256: "2".repeat(64) };
}

/** What the stub saw in one arm request. */
export interface Call {
  task: string;
  arm: string;
  model: string;
  turn: Turn;
  /** Sends so far with this task, arm, model and turn, this one included. */
  n: number;
  url: string;
  body: any;
  at: number;
}
export type Script = (c: Call) => Response | Promise<Response>;

let seq = 0;
export function sse(o: { text?: string; tool?: boolean; stop?: string; id?: string; usage?: boolean; final?: boolean; input?: number; cacheRead?: number; output?: number }): Response {
  const events: Array<Record<string, unknown>> = [{ type: "message_start", message: { id: o.id ?? "gen-" + ++seq, type: "message", role: "assistant", content: [], usage: { input_tokens: o.input ?? 900, cache_read_input_tokens: o.cacheRead ?? 0, cache_creation_input_tokens: 0, output_tokens: 1 } } }];
  if (o.text) events.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: o.text } }, { type: "content_block_stop", index: 0 });
  if (o.tool) events.push({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "Bash", input: {} } }, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } }, { type: "content_block_stop", index: 1 });
  if (o.final !== false) {
    events.push({ type: "message_delta", delta: { stop_reason: o.stop ?? "end_turn" }, ...(o.usage === false ? {} : { usage: { output_tokens: o.output ?? 120 } }) });
    events.push({ type: "message_stop" });
  }
  return new Response(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
}
export const text = (t = "Two tests fail in test_widget_parse; the fix is not verified.") => sse({ text: t });
export const status = (code: number, body: unknown = { type: "error", error: { type: "api_error", message: "stub" } }) => Response.json(body, { status: code });

/** A provider stub: arm requests go to the script; GET generation records go to records. */
export function stub(script: Script, records: (id: string) => Response = () => new Response("{}", { status: 404 })) {
  const calls: Call[] = [];
  const gets: string[] = [];
  const counts = new Map<string, number>();
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    if ((init.method ?? "GET") === "GET") {
      gets.push(url);
      return records(new URL(url).searchParams.get("id") ?? "");
    }
    const body = JSON.parse(String(init.body));
    const first = JSON.stringify(body.messages?.[0] ?? "");
    const last = JSON.stringify(body.messages?.at(-1) ?? "");
    const m = /TASK (\S+) ARM (\S+)/.exec(first);
    const turn = (/TURN (report|followup|d1|d2):/.exec(last)?.[1] ?? "report") as Turn;
    const key = [m?.[1], m?.[2], body.model, turn].join("|");
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const call: Call = { task: m?.[1] ?? "", arm: m?.[2] ?? "", model: body.model, turn, n, url, body, at: calls.length };
    calls.push(call);
    return script(call);
  };
  return { fetch, calls, gets };
}

/** A temp ledger record with one approved item (admission warn, so the direct-proof check only warns). */
export function ledgerDir(item: string, capUsd: number) {
  const root = tmp("tbv-ledger-");
  const record = join(root, "record");
  mkdirSync(record, { recursive: true });
  recordApproval(record, { action: "init", item, cap_micros: Math.round(capUsd * 1e6), quotes: [QUOTE], admission: "warn" });
  return { root, record, ledger: join(root, "ledger.sqlite"), out: join(root, "out"), plain: join(root, "plain") };
}

/** A fake clock: sleep advances it at once. */
export function clock(start = 1_800_000_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps };
}
