import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReply } from "../../lanes/review-replay/outcome.ts";
import { sha256 } from "../../lanes/review-replay/replay-plan.ts";
import { runReplay, type ItemRecord, type ReplayOptions } from "../../lanes/review-replay/run.ts";
import { openLease, recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "run");
const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value-for-replay-tests", OPENAI_API_KEY: "fake-openai-value-for-replay-tests", OPENROUTER_API_KEY: "fake-openrouter-value-for-replay-tests" };
const QUOTE = { words: "Approve the keyless test cap", by: "test", source: "tests/replay/run.test.ts" };
const LONG = "Finding: lib/ship-queue.ts reads an unreadable GitHub state as not merged.";

type Reply = (id: string, body: any) => Response | Promise<Response>;
const anthropic = (text = LONG, stop = "end_turn", usage: unknown = { input_tokens: 10, output_tokens: 1000 }) => Response.json({ id: "msg", type: "message", content: [{ type: "text", text }], stop_reason: stop, usage });
const chat = (choices: unknown[], extra: Record<string, unknown> = {}) => Response.json({ id: "c", choices, usage: { prompt_tokens: 10, completion_tokens: 50 }, ...extra });

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function setup(cap = 1_000_000, edit?: (plan: any) => void) {
  const dir = mkdtempSync(join(tmpdir(), "u13c-replay-"));
  dirs.push(dir);
  cpSync(FIXTURE, join(dir, "plan"), { recursive: true });
  const plan = join(dir, "plan", "plan.json");
  if (edit) {
    const parsed = JSON.parse(readFileSync(plan, "utf8"));
    edit(parsed);
    writeFileSync(plan, JSON.stringify(parsed));
  }
  const record = join(dir, "record");
  recordApproval(record, { action: "init", item: "replay", cap_micros: cap, quotes: [QUOTE], admission: "warn" });
  const h = { dir, plan, record, ledger: join(dir, "ledger.sqlite"), out: join(dir, "out"), sent: [] as string[], out_lines: [] as string[], err_lines: [] as string[], reply: (() => anthropic()) as Reply };
  const run = (extra: Partial<ReplayOptions> = {}) =>
    runReplay({
      plan: h.plan, out: h.out, item: "replay", ledger: h.ledger, ledgerRecord: h.record, env: KEYS, concurrency: 1,
      io: { out: (l) => h.out_lines.push(l), err: (l) => h.err_lines.push(l) },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body));
        const id = /Item (\w)\./.exec(body.messages[0].content)![1]!;
        h.sent.push(id);
        return h.reply(id, body);
      },
      ...extra,
    });
  return { ...h, h, run };
}

const item = (out: string, id: string) => JSON.parse(readFileSync(join(out, "items", id + ".json"), "utf8")) as ItemRecord;
const reservations = (ledger: string) => {
  const db = new Database(ledger, { readonly: true });
  const rows = db.query("SELECT reservation_id, idempotency_key, state, spent_micros, usage FROM reservations").all() as { reservation_id: string; idempotency_key: string; state: string; spent_micros: number | null; usage: string | null }[];
  db.close();
  return rows;
};
const journal = (out: string) => readFileSync(join(out, "journal.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("review replay runner: done-means", () => {
  test("a cap stop prints the STOP line and exits 2, keeps recorded items, and after a raise a resume sends each item exactly once", async () => {
    const t = setup(50_000);
    expect(await t.run()).toBe(2);
    expect(t.out_lines[0]).toMatch(/^STOP: reason=budget_exhausted spent=\$0\.04008 reserved=\$0\.04008 unknown=0 cap=\$0\.05$/);
    expect(t.err_lines.some((l) => l.startsWith("CAP_STOP "))).toBe(true);
    expect(t.sent).toEqual(["a", "b"]);
    expect(existsSync(join(t.out, "items", "c.json"))).toBe(false);
    recordApproval(t.record, { action: "raise", item: "replay", cap_micros: 100_000, quotes: [QUOTE] });
    expect(await t.run({ resume: true })).toBe(0);
    expect(t.sent).toEqual(["a", "b", "c"]);
    expect(["a", "b", "c"].map((id) => item(t.out, id).termination.kind)).toEqual(["completed", "completed", "completed"]);
    expect(readItem(t.record, "replay").leases.map((l) => l.close?.how)).toEqual(["settled", "settled"]);
  });

  test("rejected credentials stop at once with no outcome for the item, and a resume with a good key sends it", async () => {
    const t = setup();
    t.h.reply = () => Response.json({ error: { type: "authentication_error" } }, { status: 401 });
    expect(await t.run()).toBe(2);
    expect(t.err_lines.some((l) => l.startsWith("E_KEY_REJECTED "))).toBe(true);
    expect(t.sent).toEqual(["a"]);
    expect(readdirSync(join(t.out, "items"))).toEqual([]);
    t.h.reply = () => anthropic();
    expect(await t.run({ resume: true })).toBe(0);
    expect(t.sent).toEqual(["a", "a", "b", "c"]);
  });

  test("a send that throws records unknown with its reservation, keeps its charge, and a resume sends only the remaining items", async () => {
    const t = setup();
    t.h.reply = (id) => (id === "b" ? Promise.reject(new Error("socket hang up")) : anthropic());
    expect(await t.run()).toBe(2);
    expect(t.err_lines.some((l) => l.startsWith("E_REPLAY_TRANSPORT "))).toBe(true);
    const b = item(t.out, "b");
    expect(b.termination).toEqual({ kind: "unknown", reservation_id: b.reservation_ids[0]! });
    expect(b.spend_known).toBe(false);
    expect(reservations(t.ledger).find((r) => r.reservation_id === b.reservation_ids[0])?.state).toBe("unknown");
    expect(readItem(t.record, "replay").leases[0]!.close).toMatchObject({ unknown_calls: 1, unknown_micros: b.spent_micros });
    t.h.reply = () => anthropic();
    expect(await t.run({ resume: true })).toBe(0);
    expect(t.sent).toEqual(["a", "b", "c"]);
  });

  test("a 503 records missing and stops with E_REPLAY_TRANSPORT", async () => {
    const t = setup();
    t.h.reply = (id) => (id === "a" ? new Response("overloaded", { status: 503 }) : anthropic());
    expect(await t.run()).toBe(2);
    expect(item(t.out, "a").termination).toEqual({ kind: "missing", code: "E_REPLAY_TRANSPORT" });
    expect(item(t.out, "a").http_status).toBe(503);
    expect(t.sent).toEqual(["a"]);
    expect(t.err_lines.some((l) => l.startsWith("E_REPLAY_TRANSPORT "))).toBe(true);
  });

  test("a resume after a crash records a journaled send unknown and never resends it, and sends an intent the journal never saw", async () => {
    const t = setup();
    const runId = "replay-crash0000001";
    const local = LocalLedger.open(t.ledger);
    const lease = openLease(t.record, local, { item: "replay", run_id: runId, warn: () => {} });
    const cell = { run_id: runId, arm: "gstack", task: "c1", model: "claude-opus-5-5", trial: 1, attempt: 1, meter_id: "m_crash_a" };
    const held = await local.reserve({ idempotency_key: "m_crash_a:1:1", lease_id: lease.lease_id, cell, max_micros: 25_000 });
    local.close();
    if (!held.ok) throw new Error(held.message);
    const rid = held.reservation.reservation_id;
    mkdirSync(join(t.out, "items"), { recursive: true });
    const common = { idempotency_key: "m_crash_a:1:1", lease_id: lease.lease_id, cell, provider: "anthropic", route: "/v1/messages", model: "claude-opus-5-5", try: 1, max_micros: 25_000, source: null };
    writeFileSync(join(t.out, "journal.ndjson"), JSON.stringify({ kind: "reserve", ...common }) + "\n" + JSON.stringify({ kind: "request", reservation_id: rid, ...common }) + "\n");
    for (const [id, meter] of [["a", "m_crash_a"], ["b", "m_crash_b"]]) writeFileSync(join(t.out, "items", id + ".intent.json"), JSON.stringify({ id, run_id: runId, lease_id: lease.lease_id, meter_id: meter, prompt_sha256: "x", sent_at: new Date().toISOString() }));
    writeFileSync(join(t.out, "run.json"), JSON.stringify({ schema_version: 1, run_id: runId, plan_name: "u13c-fixture", plan_sha256: sha256(readFileSync(t.plan)), line_item: "replay", lease_id: lease.lease_id, created_at: new Date().toISOString() }));
    expect(await t.run({ resume: true })).toBe(0);
    expect(item(t.out, "a").termination).toEqual({ kind: "unknown", reservation_id: rid });
    expect(t.sent).toEqual(["b", "c"]);
    expect(reservations(t.ledger).find((r) => r.reservation_id === rid)?.state).toBe("unknown");
  });
});

describe("review replay runner: GSTA-11 rerun preconditions", () => {
  test("precondition 1: a refusal, a content_filter stop and choices: [] are not answered", async () => {
    const t = setup(1_000_000, (p) => {
      p.items[1].model = "gpt-6.1-sol";
      p.items[2].model = "deepseek/deepseek-v4.1-flash-1017";
    });
    t.h.reply = (id) => (id === "a" ? anthropic("", "refusal") : id === "b" ? chat([{ message: { content: "" }, finish_reason: "content_filter" }]) : chat([], { provider: "DeepSeek" }));
    expect(await t.run()).toBe(0);
    expect(["a", "b", "c"].map((id) => item(t.out, id).termination)).toEqual([{ kind: "arm_failure", failure: "refusal" }, { kind: "arm_failure", failure: "refusal" }, { kind: "arm_failure", failure: "empty_response" }]);
    expect(t.sent).toEqual(["a", "b", "c"]);
  });

  test("precondition 2 and G3: moved prompt bytes are refused before any spend, and a resume refuses a changed plan or a recorded item with another prompt digest", async () => {
    const moved = setup();
    writeFileSync(join(moved.dir, "plan", "prompts", "b.md"), "Review this diff. Item b, edited.\n");
    expect(await moved.run()).toBe(2);
    expect(moved.err_lines[0]).toMatch(/^E_REPLAY_PLAN .*prompts\/b\.md has sha256/);
    expect([existsSync(moved.ledger), existsSync(moved.out), moved.sent.length]).toEqual([false, false, 0]);
    const t = setup();
    expect(await t.run()).toBe(0);
    const a = join(t.out, "items", "a.json");
    writeFileSync(a, JSON.stringify({ ...item(t.out, "a"), prompt_sha256: "0".repeat(64) }));
    expect(await t.run({ resume: true })).toBe(2);
    expect(t.err_lines.some((l) => /^E_REPLAY_PLAN .*item a was recorded with prompt sha256 0{64}/.test(l))).toBe(true);
    const plan = JSON.parse(readFileSync(t.plan, "utf8"));
    writeFileSync(t.plan, JSON.stringify({ ...plan, name: "changed" }));
    expect(await t.run({ resume: true })).toBe(2);
    expect(t.err_lines.some((l) => /^E_REPLAY_PLAN .*a resume never runs a changed plan/.test(l))).toBe(true);
    expect(t.sent).toEqual(["a", "b", "c"]);
  });

  test("precondition 3: a cut-off fragment under min_visible_chars is an empty response, a longer cut-off is completed and truncated, and a plan without cut_off is refused", async () => {
    const t = setup();
    t.h.reply = (id) => (id === "a" ? anthropic("Find", "max_tokens") : anthropic(LONG, "max_tokens"));
    expect(await t.run()).toBe(0);
    expect(item(t.out, "a")).toMatchObject({ termination: { kind: "arm_failure", failure: "empty_response" }, cut_off: true, truncated: false });
    expect(item(t.out, "b")).toMatchObject({ termination: { kind: "completed" }, cut_off: true, truncated: true });
    const bare = setup(1_000_000, (p) => delete p.cut_off);
    expect(await bare.run({ dryRun: true })).toBe(2);
    expect(bare.err_lines[0]).toMatch(/^E_REPLAY_PLAN .*cut_off must state \{min_visible_chars\}/);
  });

  test("precondition 4 (runner analogue): across a stop and a resume no idempotency key repeats and every reservation is settled exactly once", async () => {
    const t = setup(50_000);
    expect(await t.run()).toBe(2);
    recordApproval(t.record, { action: "raise", item: "replay", cap_micros: 100_000, quotes: [QUOTE] });
    expect(await t.run({ resume: true })).toBe(0);
    const lines = journal(t.out);
    const keys = lines.filter((l) => l.kind === "reserve").map((l) => l.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
    const rows = reservations(t.ledger);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.state === "settled")).toBe(true);
    for (const r of rows) expect(lines.filter((l) => l.kind === "outcome" && l.reservation_id === r.reservation_id).length).toBe(1);
  });

  test("precondition 6: an error-finish 200 keeps the provider's usage on the record and in the ledger settle", async () => {
    const t = setup(1_000_000, (p) => (p.items[0].model = "deepseek/deepseek-v4.1-flash-1017"));
    t.h.reply = () => chat([{ message: { content: "partial" }, finish_reason: "error" }], { provider: "DeepSeek" });
    expect(await t.run()).toBe(2);
    const a = item(t.out, "a");
    expect(a).toMatchObject({ termination: { kind: "missing", code: "E_REPLAY_TRANSPORT" }, usage: { prompt_tokens: 10, completion_tokens: 50 }, text: "partial", spend_known: true });
    const row = reservations(t.ledger).find((r) => r.reservation_id === a.reservation_ids[0])!;
    expect([row.state, row.spent_micros, JSON.parse(row.usage!).output]).toEqual(["settled", a.spent_micros, 50]);
    expect(a.spent_micros).toBeGreaterThan(0);
  });

  test("precondition 7: an error object in a 200, finish_reason error and a choice error classify the same way", () => {
    const usage = { prompt_tokens: 10, completion_tokens: 5 };
    const bodies = [{ error: { message: "upstream failed" }, choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage }, { choices: [{ message: { content: "x" }, finish_reason: "error" }], usage }, { choices: [{ message: { content: "x" }, finish_reason: "stop", error: { code: 502 } }], usage }];
    for (const provider of ["openai", "openrouter"] as const) {
      const model = provider === "openai" ? "gpt-6.1-sol" : "particle-ai/particle-1";
      for (const body of bodies) expect(readReply(provider, model, 200, JSON.stringify(body), 20, true)).toMatchObject({ termination: { kind: "missing", code: "E_REPLAY_TRANSPORT" }, stop: "E_REPLAY_TRANSPORT", usage });
    }
  });

  test("G6: an OpenRouter reply from an unpinned provider and a 200 without usage are missing", async () => {
    const reply = { choices: [{ message: { content: LONG }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 50 } };
    expect(readReply("openrouter", "deepseek/deepseek-v4.1-flash-1017", 200, JSON.stringify({ ...reply, provider: "Chutes" }), 20, true).termination).toEqual({ kind: "missing", code: "E_REPLAY_TRANSPORT" });
    expect(readReply("openrouter", "deepseek/deepseek-v4.1-flash-1017", 200, JSON.stringify({ ...reply, provider: "DeepSeek" }), 20, true).termination).toEqual({ kind: "completed" });
    const t = setup();
    t.h.reply = () => Response.json({ id: "msg", type: "message", content: [{ type: "text", text: LONG }], stop_reason: "end_turn" });
    expect(await t.run()).toBe(2);
    expect(item(t.out, "a")).toMatchObject({ termination: { kind: "missing", code: "E_REPLAY_TRANSPORT" }, text: LONG, spend_known: false });
    expect(t.sent).toEqual(["a"]);
  });

  test("G7: a moved preregistration is refused, and --dry-run prints worst cases and creates no ledger, record or out dir", async () => {
    const t = setup();
    const record = join(t.dir, "fresh-record");
    expect(await t.run({ dryRun: true, ledgerRecord: record })).toBe(0);
    expect(t.out_lines[0]).toMatch(/^a {2}anthropic:claude-opus-5-5 {2}worst case \$0\.02\d+$/);
    expect(t.out_lines.at(-1)).toMatch(/^total worst case \$0\.0\d+ for 3 items; nothing was sent or recorded$/);
    expect([existsSync(t.ledger), existsSync(record), existsSync(t.out), t.sent.length]).toEqual([false, false, false, 0]);
    expect(await t.run({ dryRun: true, json: true })).toBe(0);
    const worst = JSON.parse(t.out_lines.at(-1)!).items.map((i: { worst_micros: number }) => i.worst_micros);
    expect(await t.run()).toBe(0);
    expect(journal(t.out).filter((l) => l.kind === "reserve").map((l) => l.max_micros)).toEqual(worst);
    const moved = setup();
    writeFileSync(join(moved.dir, "plan", "prereg.md"), "moved\n");
    expect(await moved.run()).toBe(2);
    expect(moved.err_lines[0]).toMatch(/^E_REPLAY_PLAN .*the preregistration prereg\.md has sha256/);
    expect([existsSync(moved.ledger), existsSync(moved.out), moved.sent.length]).toEqual([false, false, 0]);
  });

  test("rig note: a second runner on the same --out is refused before it spends", async () => {
    const t = setup();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    t.h.reply = async (id) => (id === "a" ? (await gate, anthropic()) : anthropic());
    const first = t.run();
    while (!t.sent.length) await Bun.sleep(5);
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => err.push(l) };
    expect(await t.run({ io })).toBe(2);
    expect(await t.run({ io, resume: true })).toBe(2);
    expect(err.filter((l) => l.includes(" review replay: "))).toEqual([expect.stringMatching(/^E_USAGE .*already holds a run/), expect.stringMatching(/^E_USAGE .*is held by another proxy or reconcile/)]);
    expect(t.sent).toEqual(["a"]);
    release();
    expect(await first).toBe(0);
    expect(t.sent).toEqual(["a", "b", "c"]);
  });

  test("rig note: the lease's cap, held by the ledger, stops spend, not a field in a file", async () => {
    const t = setup(30_000);
    expect(await t.run()).toBe(2);
    const refusal = journal(t.out).find((l) => l.kind === "refusal");
    expect(refusal).toMatchObject({ code: "CAP_STOP", reason: expect.stringContaining("holds $0.02004 of $0.03") });
    expect(t.sent).toEqual(["a"]);
  });
});

describe("review replay runner: records and secrets", () => {
  test("--json writes error.json with the record's fields, prints one summary object, and no key value appears in the out dir or the output", async () => {
    const t = setup();
    t.h.reply = (id) => (id === "b" ? new Response("bad key", { status: 401 }) : anthropic());
    expect(await t.run({ json: true })).toBe(2);
    const record = JSON.parse(readFileSync(join(t.out, "error.json"), "utf8"));
    expect(record).toMatchObject({ schema_version: 1, code: "E_KEY_REJECTED", operation: "review replay", resumable: true, doc: expect.stringContaining("docs/errors.md#"), context: { env_names: ["ANTHROPIC_API_KEY"], ledger: t.ledger } });
    expect(t.out_lines.length).toBe(1);
    expect(JSON.parse(t.out_lines[0]!)).toMatchObject({ state: "stopped", stop: "E_KEY_REJECTED", counts: { completed: 1, pending: 2 } });
    const files = readdirSync(t.out, { recursive: true }).map(String).filter((f) => f.includes("."));
    const text = [...t.out_lines, ...t.err_lines, ...files.map((f) => readFileSync(join(t.out, f), "utf8"))].join("\n");
    for (const key of Object.values(KEYS)) expect(text.includes(key)).toBe(false);
  });
});
