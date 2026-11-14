// Value: protects=the fidelity audit and arm-guess commands: the draw over real launch rows, both auditors through the metered client on a ledger item, the cache-proof resend of an unreadable answer, the outcome stage1 reads, and the arm-guess tally.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { armGuess, audit, RESEND } from "../../lanes/office-hours-founder/audit.ts";
import { normalizeBlock } from "../../lanes/office-hours-founder/parse.ts";
import type { ArmId } from "../../lanes/office-hours-founder/types.ts";
import { ENV, ledgerWith, tmp } from "../pv/fixtures.ts";

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

/** A launch dir with sessions of founder turns, each with a transcript of one question per reply, and a units dir. */
function launch(dir: string, sessions: { arm: ArmId; turns: number; stage?: 1 | 2; block?: boolean }[]) {
  const units = join(dir, "units");
  mkdirSync(join(units, "u1"), { recursive: true });
  writeFileSync(join(units, "u1", "sheet.json"), JSON.stringify({ persona: "A courier.", facts: [{ id: "f1", text: "Two shops pay.", reveal_when: "Asked who pays.", kind: "payment" }] }));
  writeFileSync(join(units, "u1", "opening.md"), "I plan routes for laundry pickups.\n");
  const out = join(dir, "launch");
  mkdirSync(out, { recursive: true });
  const lines = sessions.map((s, i) => {
    const stage = s.stage ?? 1;
    const t = join(out, "t" + i + ".ndjson");
    writeFileSync(t, Array.from({ length: s.turns + 1 }, (_, k) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Question " + k + " for session " + i + "?" }] } }) + "\n" + JSON.stringify({ type: "result", subtype: "success" })).join("\n") + "\n");
    const row = { stage, kind: "arm", unit: "u1", model: "opus", arm: s.arm, pass: i + 1, end: s.block ? "block" : "no-block", code: s.block ? null : "E_OF_NO_BLOCK", block: s.block ? normalizeBlock({ first_move: "Sell route sheets to laundry owners.", next_action: "Call three owners.", other_moves: [], doubt: "" }) : null, lenient: null, founder_turns: Array.from({ length: s.turns }, (_, k) => ({ turn: k + 1, reply: "Reply " + (k + 1) + ".", revealed: k === 0 ? ["f1"] : [], rules: [1], attempts: 1 })), closing_sent: false, replies: s.turns + 1, exposure: null, questions: null, pushes: null, first_recommendation_reply: null, web: 0, gstack_reads: [], named_source: null, usd: 0, sim_usd: 0, attempts: 1, repairs: [] };
    return JSON.stringify({ id: ["arm", "opus", s.arm, "u1", "p" + (i + 1)].join("/"), cell: stage === 1 ? "stage1" : "stage2", row, why: "", transcript: t, state_root: null, attempts: [{ attempt: 1, outcome: row.end, why: "", usd: 0, sim_usd: 0, contained: [] }] });
  });
  writeFileSync(join(out, "rows.ndjson"), lines.join("\n") + "\n");
  return { units, out };
}

/** Astra on the Responses API and Opus on Messages, each answering from the prompt. */
function upstream(answer: (who: "astra" | "opus", prompt: string) => string, prompts: string[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    prompts.push(prompt);
    if (String(url).includes("anthropic")) return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: answer("opus", prompt) }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return Response.json({ id: "r", object: "response", model: "gpt-6-astra", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: answer("astra", prompt) }] }], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 120 } });
  }) as typeof fetch;
}

const withFetch = async <T>(f: typeof fetch, run: () => Promise<T>): Promise<T> => {
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
};

describe("of audit", () => {
  test("24 founder turns are all audited by both auditors on one lease, and a clean audit passes", async () => {
    const dir = tmp();
    const { units, out } = launch(dir, [{ arm: "none", turns: 6 }, { arm: "office-hours", turns: 6 }, { arm: "none", turns: 6 }, { arm: "lens", turns: 6 }]);
    const { record, ledger } = ledgerWith(dir, ["of-s1-audit"]);
    const prompts: string[] = [];
    const c = io();
    const code = await withFetch(upstream(() => '{"marked": []}', prompts), () => audit(["--stage", "1", "--launch", out, "--units", units, "--item", "of-s1-audit", "--spend-cap", "20", "--out", join(dir, "res", "audit.json"), "--record", record, "--ledger", ledger], c.io, ENV));
    expect(code).toBe(0);
    const res = JSON.parse(readFileSync(join(dir, "res", "audit.json"), "utf8"));
    expect(res).toMatchObject({ read: "pass", audited: 24, failing: 0 });
    expect(prompts.length).toBe(48);
    expect(prompts.every((p) => p.includes("Reply ") && p.includes("Question "))).toBe(true);
  });

  test("an unreadable answer is resent once with the fixed line, so the cache can't answer it", async () => {
    const dir = tmp();
    const { units, out } = launch(dir, [{ arm: "none", turns: 10 }, { arm: "office-hours", turns: 10 }]);
    const { record, ledger } = ledgerWith(dir, ["of-s1-audit"]);
    const prompts: string[] = [];
    const code = await withFetch(upstream((who, p) => (who === "astra" && !p.endsWith(RESEND) ? "not json" : '{"marked": []}'), prompts), () => audit(["--stage", "1", "--launch", out, "--units", units, "--item", "of-s1-audit", "--spend-cap", "20", "--out", join(dir, "audit.json"), "--record", record, "--ledger", ledger], io().io, ENV));
    expect(code).toBe(0);
    expect(prompts.filter((p) => p.endsWith(RESEND)).length).toBe(20);
    expect(JSON.parse(readFileSync(join(dir, "audit.json"), "utf8"))).toMatchObject({ read: "pass", unreadable: { astra: 0, opus: 0 } });
  });

  test("three turns both auditors mark fail stage 1 and ask for the one repair; fewer than 20 turns read NO READ with no call", async () => {
    const dir = tmp();
    const { units, out } = launch(dir, [{ arm: "none", turns: 10 }, { arm: "office-hours", turns: 10 }]);
    const { record, ledger } = ledgerWith(dir, ["of-s1-audit"]);
    const c = io();
    await withFetch(upstream((_, p) => (/Reply [123]\./.test(p) && !/Reply 1[0-9]/.test(p) ? '{"marked": ["V2"]}' : '{"marked": []}'), []), () => audit(["--stage", "1", "--launch", out, "--units", units, "--item", "of-s1-audit", "--spend-cap", "20", "--out", join(dir, "audit.json"), "--record", record, "--ledger", ledger], c.io, ENV));
    const res = JSON.parse(readFileSync(join(dir, "audit.json"), "utf8"));
    expect(res.read).toBe("repair");
    expect(res.failing).toBeGreaterThanOrEqual(3);
    expect(c.err.join("\n")).toContain("E_OF_SIM_AUDIT");
    const dir2 = tmp();
    const small = launch(dir2, [{ arm: "none", turns: 9 }, { arm: "office-hours", turns: 9 }]);
    const prompts: string[] = [];
    const c2 = io();
    await withFetch(upstream(() => '{"marked": []}', prompts), () => audit(["--stage", "1", "--launch", small.out, "--units", small.units, "--item", "x", "--spend-cap", "1", "--out", join(dir2, "audit.json")], c2.io, ENV));
    expect(JSON.parse(readFileSync(join(dir2, "audit.json"), "utf8")).read).toBe("no-read");
    expect(prompts.length).toBe(0);
    expect(c2.err.join("\n")).toContain("E_OF_NO_READ");
  });

  test("an out path inside the repo is refused", async () => {
    await expect(audit(["--stage", "1", "--launch", "/tmp/x", "--units", "/tmp/u", "--item", "i", "--spend-cap", "1", "--out", join(import.meta.dir, "audit.json")], io().io, ENV)).rejects.toThrow(/inside the repo/);
  });
});

describe("of arm-guess", () => {
  test("Astra's guesses on stage 2 blocks are tallied against the arms, by letter", async () => {
    const dir = tmp();
    const { out } = launch(dir, [{ arm: "none", turns: 1, stage: 2, block: true }, { arm: "lens", turns: 1, stage: 2, block: true }, { arm: "office-hours", turns: 1, stage: 2, block: true }]);
    const { record, ledger } = ledgerWith(dir, ["of-s2-labels"]);
    const prompts: string[] = [];
    const c = io();
    await withFetch(upstream(() => '{"setup": "A"}', prompts), () => armGuess(["--launch", out, "--item", "of-s2-labels", "--spend-cap", "5", "--out", join(dir, "g.json"), "--record", record, "--ledger", ledger], c.io, ENV));
    const g = JSON.parse(readFileSync(join(dir, "g.json"), "utf8"));
    expect(g).toMatchObject({ asked: 3, correct: 1, unreadable: 0 });
    expect(prompts.every((p) => p.endsWith("First move: Sell route sheets to laundry owners.\nNext action: Call three owners.\nOther moves weighed: (none)\nDoubt: (none)"))).toBe(true);
    expect(c.out.join("\n")).toContain("1/3 correct");
  });
});
