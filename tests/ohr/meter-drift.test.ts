// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the meter's provider-drift stop and its empty-reply bound (pre-run change 5): only a reply that carries an answer can show which provider served it, so an empty, error or cut-off reply is a failed call, an answer from another provider or from an unnamed one still stops the command, and empty replies stop the run at three in a row or past 1% of its calls; fails_when=a timed-out or error reply stops a run as a provider drift, an answer with missing or wrong provenance is counted, or empty replies pile up without a stop.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { openWire, type Wire } from "../../lanes/office-hours-rewrite/wire.ts";

const D = 1_000_000;
const KEYS = { OPENAI_API_KEY: "stub-not-a-key", ANTHROPIC_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" };
const usage = { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 };
const answered = (content: string, provider: string | null = "Google") => () => Response.json({ id: "gen-1", ...(provider === null ? {} : { provider }), model: "google/gemini-4-argon", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage });
const errored = () => Response.json({ id: "gen-1", error: { code: 524, message: "upstream timed out" }, usage });
const SIM_TEXT = JSON.stringify({ reply: "Two services pay me.", revealed: ["f1"], rules: [3], done: false });

/** A wire on a temporary ledger whose upstream answers each Argon call with the next reply in turn. */
async function withArgon<T>(replies: (() => Response)[], body: (w: Wire) => Promise<T>, dir = mkdtempSync(join(tmpdir(), "ohr-drift-"))): Promise<T> {
  const record = join(dir, "record");
  try {
    recordApproval(record, { action: "init", item: "ohr-drift-test", cap_micros: 20 * D, quotes: [{ words: "drift test on a temporary ledger, not an approval", by: "tests/ohr/meter-drift.test.ts", source: "pre-run change 5" }], admission: "warn" });
  } catch {}
  let i = 0;
  const w = await openWire({ dir: join(dir, "wire"), item: "ohr-drift-test", capMicros: 5 * D, label: "ohr-drift-test", record, ledger: join(dir, "ledger.sqlite"), env: KEYS, io: { out: () => {}, err: () => {} }, upstream: (async () => replies[i++]!()) as unknown as typeof fetch });
  try {
    return await body(w);
  } finally {
    await w.close("drift test");
  }
}

let n = 0;
const ask = (w: Wire) => w.call({ model: "gemini", prompt: "Say ok " + n++ + ".", maxTokens: 200, effort: null, label: "drift" }).then((r) => ({ r, code: null as string | null, message: "" }), (e: { code?: string; message: string }) => ({ r: null, code: e.code ?? "thrown", message: e.message }));
const one = (reply: () => Response) => withArgon([reply], ask);

test("an errored, empty or cut-off reply with no answer is a failed call, not a provider drift", async () => {
  const err = await one(errored);
  expect(err.code).toBeNull();
  expect(err.r?.text).toBeNull();
  expect(err.r?.problem).toBe("the reply carries no answer and names no provider");
  const empty = await one(answered(""));
  expect([empty.code, empty.r?.text, empty.r?.problem]).toEqual([null, null, "the reply carries no answer"]);
  const cut = await one(() => new Response('{"id":"gen-1","choices":[{"mess', { status: 200, headers: { "content-type": "application/json" } }));
  expect([cut.code, cut.r?.problem]).toEqual([null, "the reply is not JSON"]);
});

test("an answer served by any provider other than Google stops the command", async () => {
  expect((await one(answered("ok", "Azure"))).code).toBe("E_PV_PROVIDER_DRIFT");
  expect((await one(answered("ok", "Together"))).code).toBe("E_PV_PROVIDER_DRIFT");
  expect((await one(answered("ok", "Google"))).r?.text).toBe("ok");
});

test("an answer that names no provider stops the command: missing provenance on an answer is drift", async () => {
  expect((await one(answered("ok", null))).code).toBe("E_PV_PROVIDER_DRIFT");
});

test("three empty replies in a row stop the run (E_PV_EMPTY_REPLIES), and an answer between them resets the row", async () => {
  const tail = [errored, errored, answered("ok"), errored, errored, errored];
  const codes = await withArgon([...Array.from({ length: 500 }, () => answered("ok")), ...tail], async (w) => {
    for (let k = 0; k < 500; k++) await ask(w);
    const out: (string | null)[] = [];
    for (let k = 0; k < tail.length; k++) out.push((await ask(w)).code);
    return out;
  });
  expect(codes).toEqual([null, null, null, null, null, "E_PV_EMPTY_REPLIES"]);
});

test("two empty replies in a run's first 100 calls are more than 1% of them, so the second stops the run", async () => {
  expect(await withArgon([errored, answered("ok"), errored], async (w) => [(await ask(w)).code, (await ask(w)).code, (await ask(w)).code])).toEqual([null, null, "E_PV_EMPTY_REPLIES"]);
});

test("more than 1% of the run's calls coming back empty, counted over at least 100 calls, stops the run", async () => {
  const replies = [errored, ...Array.from({ length: 97 }, () => answered("ok")), errored];
  const last = await withArgon(replies, async (w) => {
    let r = await ask(w);
    for (let k = 0; k < 98; k++) r = await ask(w);
    return r;
  });
  expect(last.code).toBe("E_PV_EMPTY_REPLIES");
  expect(last.message).toContain("2 of 99 calls");
});

test("the counts persist across a resume of the same run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohr-drift-"));
  expect((await withArgon([errored], ask, dir)).code).toBeNull();
  expect((await withArgon([errored], ask, dir)).code).toBe("E_PV_EMPTY_REPLIES");
});

test("on the simulated person's path, the bound halts like a drift, so the audit and the launches stop", async () => {
  const sim = () => Response.json({ id: "gen-1", provider: "Google", model: "google/gemini-4-argon", choices: [{ index: 0, message: { role: "assistant", content: SIM_TEXT }, finish_reason: "stop" }], usage });
  const out = await withArgon([errored, errored, sim], async (w) => {
    const call = w.sim("drift");
    const got = [];
    for (let k = 0; k < 2; k++) got.push(await call({ system: "s" + k, messages: [{ role: "user" as const, content: "Does anyone pay you?" }] }));
    return got;
  });
  expect(out.map((o) => (o.kind === "call-failed" ? o.reason : o.kind))).toEqual(["provider", "drift"]);
  const last = out[1]!;
  expect(last.kind === "call-failed" && last.detail.startsWith("E_PV_EMPTY_REPLIES")).toBe(true);
});
