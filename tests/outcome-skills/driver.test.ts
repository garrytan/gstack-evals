// The outcome-skills session driver (lanes/outcome-skills/driver/stage.ts), keyless: a temporary ledger record and local
// ledger, a stub upstream behind the real metering proxy, and the driver's control plane over HTTP on 127.0.0.1.
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { openLease, recordApproval, recordStop, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { LedgerError, readItem } from "../../src/runner/ledger/record.ts";
import { loadRegistry, type Registry } from "../../lanes/outcome-skills/arms/registry.ts";
import { serveStages, type ServeOptions, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";
import { unknownFromRun } from "../../src/runner/stats/g-admission.ts";

const D = 1_000_000;
const quote = { words: "test words", by: "test", source: "driver.test.ts" };
const NONE = { item: "i-none", arm: "none" };
const PE = { item: "i-pe", arm: "plan-eng-review:told" };
const AP = { item: "i-ap", arm: "autoplan:told" };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const usage = { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const upstream = async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as { model: string };
  return Response.json({ id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage });
};

function world(caps: Record<string, number>, o: { skillCap?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "driver-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "w", cap_micros: 10_000 * D, skill_cap_micros: (o.skillCap ?? 2_000) * D, skills: ["plan-eng-review", "autoplan"], credit_rate_micros: D, quotes: [quote] });
  const skills: Record<string, string[]> = { "i-none": ["plan-eng-review", "autoplan"], "i-pe": ["plan-eng-review"], "i-ap": ["autoplan"], "i-tg": ["plan-eng-review", "autoplan"] };
  for (const [item, cap] of Object.entries(caps)) recordApproval(record, { action: "init", item, cap_micros: cap * D, quotes: [quote], admission: "required", program: "w", skills: skills[item]! });
  const local = LocalLedger.open(join(root, "ledger.sqlite"));
  const logs: string[] = [];
  const dir = join(root, "run");
  const serve = (stages: StageSpec[], more: Partial<ServeOptions> = {}) => serveStages({ record, local, run_id: "r1", envelope_host: "m1", machine: "m1", stages, host: "127.0.0.1", dir, fetch: upstream, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key" }, log: (l) => logs.push(l), ...more });
  return { root, record, local, logs, dir, serve };
}

const body = (arm: string, task: string, trial_n: number, more: Record<string, unknown> = {}) => {
  const cap = { none: 8, "plan-eng-review:told": 20, "autoplan:told": 45 }[arm];
  const { meta, ...rest } = more as { meta?: Record<string, unknown> };
  return { trial: "t-" + task + "-" + trial_n, model: "claude-opus-5-5", cap_usd: cap, meta: { arm, task, trial_n, ...meta }, open_key: arm + task + trial_n + JSON.stringify(meta ?? {}), ledger: "u4", ...rest };
};
const post = async (url: string, b: unknown) => {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(b) });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};
const call = (answer: Record<string, any>) => fetch(answer.base_url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": answer.token }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }] }) });
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof LedgerError ? e.code : (e as Error).message));
const refused = (p: Promise<unknown>) => p.then(() => null, (e) => e as LedgerError);
const NO_HAND = /append|by hand|leases\.jsonl|ownership line/i;

describe("the outcome-skills session driver", () => {
  test("refuses to run off the envelope host and opens nothing", async () => {
    const w = world({ "i-none": 229 });
    expect(await codeOf(w.serve([NONE], { envelope_host: "m2" }))).toBe("E_USAGE");
    expect(readItem(w.record, "i-none").leases).toHaveLength(0);
  });

  test("preflight refuses a batch the envelope can't hold together, and one with no admission record, before any lease", async () => {
    const w = world({ "i-pe": 1500, "i-none": 1200 });
    expect(await codeOf(w.serve([PE, NONE]))).toBe("ENVELOPE_SKILL_STOP");
    expect(await codeOf(w.serve([PE], { requireAdmission: () => "no record for this slot" }))).toBe("E_RIG_UNPROVEN");
    for (const item of ["i-pe", "i-none"]) expect(readItem(w.record, item).leases).toHaveLength(0);
  });

  test("preflight refuses a stage whose line item is in no program, before any lease", async () => {
    const w = world({ "i-pe": 572 });
    recordApproval(w.record, { action: "init", item: "i-free", cap_micros: 229 * D, quotes: [quote], admission: "required" });
    const err = await w.serve([PE, { item: "i-free", arm: "none" }]).then(() => null, (e) => e as LedgerError);
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain("--program");
    for (const item of ["i-pe", "i-free"]) expect(readItem(w.record, item).leases).toHaveLength(0);
  });

  test("a host the proxies can't listen on is refused before any lease", async () => {
    const w = world({ "i-none": 229, "i-pe": 572 });
    for (const host of ["0.0.0.0", "10.255.255.254"]) expect(await codeOf(w.serve([NONE, PE], { host }))).toBe("E_USAGE");
    for (const item of ["i-none", "i-pe"]) expect(readItem(w.record, item).leases).toHaveLength(0);
  });

  test("a control port that can't bind, or is out of range, is refused before any lease", async () => {
    const w = world({ "i-none": 229, "i-pe": 572 });
    const busy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy") });
    try {
      expect(await codeOf(w.serve([NONE, PE], { control_port: busy.port }))).not.toBe("ok");
    } finally {
      busy.stop(true);
    }
    expect(await codeOf(w.serve([NONE, PE], { control_port: 70_000 }))).toBe("E_USAGE");
    for (const item of ["i-none", "i-pe"]) expect(readItem(w.record, item).leases).toHaveLength(0);
  });

  test("one lease per stage at its cap; a session's slot meters its calls; stop settles every lease", async () => {
    const w = world({ "i-none": 229, "i-pe": 572 });
    const served = await w.serve([NONE, PE]);
    expect(served.control).toStartWith("http://127.0.0.1:");
    expect(served.stages.map((s) => s.reserved_micros)).toEqual([229 * D, 572 * D]);
    const open = await post(served.control + "/sessions", body("none", "a", 1));
    expect(open.status).toBe(200);
    expect(open.json).toMatchObject({ ledger: "u4", item: "i-none", allowance_micros: 8 * D });
    expect(open.json.base_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s_[A-Za-z0-9_-]+\/anthropic$/);
    expect((await call(open.json)).status).toBe(200);
    const closed = await post(served.control + "/sessions/" + open.json.id + "/close", { reason: "agent_finished" });
    expect(closed.json).toMatchObject({ spent_micros: 20_040, requests: 1, ok_responses: 1, unknown: 0, usage: { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    expect((await post(served.control + "/sessions/" + open.json.id + "/close", {})).json).toEqual(closed.json);
    expect((await call(open.json)).status).toBe(403);
    expect(await served.stop()).toBe(0);
    expect(readItem(w.record, "i-none").leases[0]!.close).toMatchObject({ spent_micros: 20_040, unknown_calls: 0 });
    expect(readItem(w.record, "i-pe").leases[0]!.close).toMatchObject({ spent_micros: 0 });
    expect(w.logs.filter((l) => l.startsWith("STAGE_SETTLED")).map((l) => l.match(/ended=\S+/)![0])).toEqual(["ended=completed", "ended=completed"]);
    const journals = readFileSync(join(w.dir, "sessions.jsonl"), "utf8") + readFileSync(join(w.dir, served.stages[0]!.lease_id + ".journal.ndjson"), "utf8");
    expect(journals).not.toContain(open.json.token);
    expect(journals).not.toContain("upstream-key");
  });

  test("opens are checked against the registry, the batch, the trial and the stage's planned sessions and reruns", async () => {
    const w = world({ "i-none": 229 });
    const served = await w.serve([NONE], { planned: 2, reruns: 1 });
    const open = (b: unknown) => post(served.control + "/sessions", b);
    expect((await open({ ...body("none", "a", 1), model: "claude-sonnet-5-5" })).status).toBe(400);
    expect((await open({ ...body("none", "a", 1), cap_usd: 20 })).status).toBe(400);
    expect((await open(body("plan-eng-review:told", "a", 1))).status).toBe(400);
    expect((await open({ ...body("none", "a", 1), ledger: undefined })).status).toBe(400);
    expect((await open({ ...body("none", "a", 1), meta: { arm: "none", task: "a" } })).status).toBe(400);
    const first = await open(body("none", "a", 1));
    expect(first.status).toBe(200);
    expect((await open(body("none", "a", 1))).json.id).toBe(first.json.id);
    expect((await open({ ...body("none", "a", 1), trial: "other" })).status).toBe(400);
    expect((await open({ ...body("none", "a", 1), open_key: "k2" })).status).toBe(422);
    expect((await open(body("none", "a", 1, { meta: { rerun: "sidecar restart" } }))).status).toBe(200);
    expect((await open(body("none", "a", 1, { meta: { rerun: "again" } }))).status).toBe(422);
    expect((await open(body("none", "b", 1))).status).toBe(200);
    const over = await open(body("none", "c", 1));
    expect(over.status).toBe(422);
    expect(over.json.detail).toStartWith("E_USAGE: outcome driver: stage i-none has opened 3 sessions");
    await post(served.control + "/sessions/" + first.json.id + "/close", {});
    expect((await open(body("none", "a", 1))).json.closed?.id).toBe(first.json.id);
    expect(readFileSync(join(w.dir, "sessions.jsonl"), "utf8").split("\n").filter((l) => l.includes('"event":"refuse"'))).toHaveLength(10);
    await served.stop();
  });

  test("first-time opens stop at the planned count, so the rerun slots serve only named reruns, across a relaunch", async () => {
    const w = world({ "i-none": 229 });
    const served = await w.serve([NONE], { planned: 2, reruns: 2 });
    const open = (b: unknown) => post(served.control + "/sessions", b);
    expect((await open(body("none", "a", 1))).status).toBe(200);
    expect((await open(body("none", "b", 1))).status).toBe(200);
    const third = await open(body("none", "c", 1));
    expect(third.status).toBe(422);
    expect(third.json.detail).toContain("2 planned");
    expect((await open(body("none", "a", 1, { meta: { rerun: "sidecar restart" } }))).status).toBe(200);
    await served.stop();
    const again = await w.serve([NONE], { planned: 2, reruns: 2 });
    expect((await post(again.control + "/sessions", body("none", "c", 1))).status).toBe(422);
    expect((await post(again.control + "/sessions", body("none", "b", 1, { meta: { rerun: "proxy restart" } }))).status).toBe(200);
    await again.stop();
  });

  test("room counts live slots' allowance; a none cap stop ends every stage, which settle as their live sessions close", async () => {
    const w = world({ "i-none": 20, "i-pe": 572 });
    const served = await w.serve([NONE, PE]);
    const a = await post(served.control + "/sessions", body("none", "a", 1));
    const b = await post(served.control + "/sessions", body("none", "a", 2));
    expect([a.status, b.status]).toEqual([200, 200]);
    const c = await post(served.control + "/sessions", body("none", "a", 3));
    expect(c.status).toBe(409);
    expect(c.json).toMatchObject({ code: "CAP_STOP", room_micros: 4 * D, allowance_micros: 8 * D });
    expect((await post(served.control + "/sessions", body("plan-eng-review:told", "a", 1))).status).toBe(409);
    for (const s of [a, b]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.done).toBe(0);
    expect(w.logs.filter((l) => l.startsWith("STAGE_SETTLED")).every((l) => l.includes("ended=cap_stop scope=all"))).toBe(true);
  });

  test("a told cap stop ends only its stage; none serves on while another told stage runs", async () => {
    const w = world({ "i-none": 229, "i-pe": 25, "i-ap": 1287 });
    const served = await w.serve([NONE, PE, AP]);
    const a = await post(served.control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect((await post(served.control + "/sessions", body("plan-eng-review:told", "a", 2))).status).toBe(409);
    await post(served.control + "/sessions/" + a.json.id + "/close", {});
    const n = await post(served.control + "/sessions", body("none", "a", 1));
    const ap = await post(served.control + "/sessions", body("autoplan:told", "a", 1));
    expect([n.status, ap.status]).toEqual([200, 200]);
    expect(w.logs.find((l) => l.includes("item=i-pe"))).toContain("ended=cap_stop scope=plan-eng-review:told only");
    for (const s of [n, ap]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.stop()).toBe(0);
  });

  test("a lease that would expire before a session could end refuses with 503 and settles as lease_expired", async () => {
    const w = world({ "i-none": 229 });
    const served = await w.serve([NONE], { ttl_ms: 3_600_000 });
    const r = await post(served.control + "/sessions", body("none", "a", 1));
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("E_LEASE_CLOSED");
    expect(await served.done).toBe(0);
    expect(w.logs.find((l) => l.startsWith("STAGE_SETTLED"))).toContain("ended=lease_expired");
  });

  test("a slot past its wall limit plus the grace is closed and its bearer refused", async () => {
    const w = world({ "i-none": 229 });
    const reg = loadRegistry();
    const fast: Registry = { ...reg, arms: { ...reg.arms, none: { ...reg.arms.none!, limits: { ...reg.arms.none!.limits, wall_limit_sec: 0.2 } } } };
    const served = await w.serve([NONE], { registry: fast, deadline_grace_ms: 100 });
    const a = await post(served.control + "/sessions", body("none", "a", 1));
    await Bun.sleep(600);
    expect((await call(a.json)).status).toBe(403);
    expect(readFileSync(join(w.dir, "sessions.jsonl"), "utf8")).toContain('"reason":"deadline"');
    await served.stop();
  });

  test("relaunch from the bound run directory recovers a lease its crashed launch left open, never one that names no holder, and only from there (Capy 01M6N3WWX2)", async () => {
    const w = world({ "i-none": 229, "i-tg": 60 });
    mkdirSync(w.dir, { recursive: true });
    const crashed = { dir: realpathSync(w.dir), nonce: "0123456789abcdef" };
    writeFileSync(join(w.dir, "sessions.jsonl"), JSON.stringify({ run_id: "r1", event: "launch", nonce: crashed.nonce }) + "\n");
    const left = openLease(w.record, w.local, { item: "i-none", run_id: "r1", machine_id: "m1", holder: crashed, requireAdmission: () => null });
    const tg = openLease(w.record, w.local, { item: "i-tg", run_id: "r1", machine_id: "m1", requireAdmission: () => null });
    const elsewhere = await refused(w.serve([NONE], { dir: join(w.root, "runB") }));
    expect(elsewhere?.code).toBe("E_USAGE");
    expect(elsewhere?.message).toContain(crashed.dir);
    expect(readItem(w.record, "i-none").open?.lease_id).toBe(left.lease_id);
    const served = await w.serve([NONE]);
    expect(w.logs.some((l) => l.startsWith("JOURNAL_MISSING lease " + left.lease_id))).toBe(true);
    expect(w.logs.some((l) => l.startsWith("STAGE_RECOVERED item=i-none lease=" + left.lease_id))).toBe(true);
    expect(readItem(w.record, "i-none").leases.map((l) => l.lease.seq)).toEqual([1, 2]);
    expect(readItem(w.record, "i-tg").open?.lease_id).toBe(tg.lease_id);
    expect(await served.stop()).toBe(0);
  });

  test("recovery writes a cap stop its crashed launch recorded into the lease's close, so a later relaunch with sessions.jsonl emptied is still refused", async () => {
    const w = world({ "i-pe": 572 });
    mkdirSync(w.dir, { recursive: true });
    const crashed = { dir: realpathSync(w.dir), nonce: "0123456789abcdef" };
    const left = openLease(w.record, w.local, { item: "i-pe", run_id: "r1", machine_id: "m1", holder: crashed, requireAdmission: () => null });
    const file = join(w.dir, "sessions.jsonl");
    writeFileSync(file, [{ run_id: "r1", event: "launch", nonce: crashed.nonce }, { at: "2026-11-05T00:00:00.000Z", run_id: "r1", event: "refuse", code: "CAP_STOP", item: "i-pe", scope: "plan-eng-review:told only" }].map((l) => JSON.stringify(l) + "\n").join(""));
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(w.logs.some((l) => l.startsWith("STAGE_RECOVERED item=i-pe lease=" + left.lease_id))).toBe(true);
    expect(readItem(w.record, "i-pe").leases[0]!.close?.cap_stop).toBe("plan-eng-review:told only");
    writeFileSync(file, "");
    expect(["CAP_STOP", "E_USAGE"]).toContain(await codeOf(w.serve([PE])));
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("a second driver on the same run directory is refused while the first serves, and launches once it stops", async () => {
    const w = world({ "i-none": 229 });
    const first = await w.serve([NONE]);
    const lease = readItem(w.record, "i-none").open?.lease_id;
    expect(await codeOf(w.serve([NONE]))).toBe("E_USAGE");
    expect(readItem(w.record, "i-none").open?.lease_id).toBe(lease);
    expect(await first.stop()).toBe(0);
    const again = await w.serve([NONE]);
    expect(readItem(w.record, "i-none").leases).toHaveLength(2);
    await again.stop();
  });

  test("a stage whose line item carries other skills than its arm's is refused before any lease", async () => {
    const w = world({ "i-pe": 572, "i-none": 229 });
    expect(await codeOf(w.serve([{ item: "i-pe", arm: "autoplan:told" }]))).toBe("E_USAGE");
    expect(await codeOf(w.serve([{ item: "i-pe", arm: "none" }]))).toBe("E_USAGE");
    expect(await codeOf(w.serve([{ item: "i-none", arm: "plan-eng-review:told" }]))).toBe("E_USAGE");
    for (const item of ["i-pe", "i-none"]) expect(readItem(w.record, item).leases).toHaveLength(0);
  });

  test("a stop that cuts a live session ends its stage failed, and the driver exits 2", async () => {
    const w = world({ "i-none": 229 });
    const served = await w.serve([NONE]);
    expect((await post(served.control + "/sessions", body("none", "a", 1))).status).toBe(200);
    expect(await served.stop()).toBe(2);
    expect(await served.done).toBe(2);
    expect(w.logs.some((l) => l.startsWith("STAGE_SETTLED item=i-none") && l.includes("ended=failed"))).toBe(true);
  });

  const capStopped = async (w: ReturnType<typeof world>, stages: StageSpec[], arm: string, more: Partial<ServeOptions> = {}) => {
    const served = await w.serve(stages, more);
    const open = (task: string) => post(served.control + "/sessions", body(arm, task, 1));
    const [a, b] = [await open("a"), await open("b")];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await open("c")).status).toBe(409);
    for (const s of [a, b]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.done).toBe(0);
  };

  test("every lease the driver opens names its run directory's canonical path and the launch's nonce; another spelling of that directory serves the run", async () => {
    const w = world({ "i-none": 229 });
    const first = await w.serve([NONE]);
    expect(await first.stop()).toBe(0);
    const h1 = readItem(w.record, "i-none").leases[0]!.lease.holder;
    expect(h1).toEqual({ dir: realpathSync(w.dir), nonce: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const link = join(w.root, "link");
    symlinkSync(w.dir, link);
    const again = await w.serve([NONE], { dir: link });
    expect(await again.stop()).toBe(0);
    const h2 = readItem(w.record, "i-none").leases[1]!.lease.holder;
    expect(h2?.dir).toBe(h1!.dir);
    expect(h2?.nonce).not.toBe(h1!.nonce);
  });

  test("a run binds to the directory of its first lease: a launch from another directory is refused with E_USAGE before anything is opened, with no hand override", async () => {
    const w = world({ "i-none": 229, "i-pe": 572 });
    const first = await w.serve([NONE]);
    expect(await first.stop()).toBe(0);
    const err = await refused(w.serve([PE], { dir: join(w.root, "runB") }));
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain(realpathSync(w.dir));
    expect(err?.message).not.toMatch(NO_HAND);
    expect(readItem(w.record, "i-pe").leases).toHaveLength(0);
    expect(readItem(w.record, "i-none").leases).toHaveLength(1);
  });

  test("a cap-stopped stage is not reopened from another directory, even one holding a hand-written ownership line and an empty sessions.jsonl (Capy 01M6N5BJ1B)", async () => {
    const w = world({ "i-pe": 50 });
    await capStopped(w, [PE], "plan-eng-review:told");
    const before = readItem(w.record, "i-pe").leases;
    const b = join(w.root, "runB");
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, "leases.jsonl"), JSON.stringify({ run_id: "r1", item: "i-pe", lease_id: before[0]!.lease.lease_id }) + "\n");
    writeFileSync(join(b, "sessions.jsonl"), "");
    const err = await refused(w.serve([PE], { dir: b }));
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain(realpathSync(w.dir));
    expect(err?.message).not.toMatch(NO_HAND);
    expect(readItem(w.record, "i-pe").leases).toEqual(before);
  });

  test("a launch from another directory never settles or claims a lease the bound directory still serves, whatever markers or ownership lines it holds (Capy 01M6N0DTS8, fc4/fix-check#2)", async () => {
    const w = world({ "i-pe": 572 });
    const a = await w.serve([PE]);
    const s = await post(a.control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect(s.status).toBe(200);
    const lease = readItem(w.record, "i-pe").open!.lease_id;
    const b = join(w.root, "runB");
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, "leases.jsonl"), JSON.stringify({ run_id: "r1", item: "i-pe", seq: 1, opening: true }) + "\n" + JSON.stringify({ run_id: "r1", item: "i-pe", lease_id: lease }) + "\n");
    const err = await refused(w.serve([PE], { dir: b }));
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).not.toMatch(NO_HAND);
    expect(readItem(w.record, "i-pe").open?.lease_id).toBe(lease);
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
    expect((await call(s.json)).status).toBe(200);
    await post(a.control + "/sessions/" + s.json.id + "/close", {});
    expect(await a.stop()).toBe(0);
  });

  test("a launch whose open is refused unwinds at $0 and leaves nothing that blocks its directory, which stays the run's", async () => {
    const w = world({ "i-none": 229, "i-pe": 572 });
    let checks = 0;
    const err = await refused(w.serve([NONE, PE], { requireAdmission: () => (++checks === 4 ? "no record for this slot" : null) }));
    expect(err?.code).toBe("E_RIG_UNPROVEN");
    expect(readItem(w.record, "i-none").leases[0]!.close).toMatchObject({ spent_micros: 0 });
    expect(readItem(w.record, "i-pe").leases).toHaveLength(0);
    expect(await codeOf(w.serve([PE], { dir: join(w.root, "runB") }))).toBe("E_USAGE");
    const again = await w.serve([NONE, PE]);
    expect(readItem(w.record, "i-none").leases.map((l) => l.lease.seq)).toEqual([1, 2]);
    expect(readItem(w.record, "i-pe").leases.map((l) => l.lease.seq)).toEqual([1]);
    expect(await again.stop()).toBe(0);
  });

  test("a stage item holding a lease of the run that names no holder is refused with no override, and recovery never settles it", async () => {
    const w = world({ "i-none": 229 });
    const hand = openLease(w.record, w.local, { item: "i-none", run_id: "r1", machine_id: "m1", requireAdmission: () => null });
    const err = await refused(w.serve([NONE]));
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain(hand.lease_id);
    expect(err?.message).not.toMatch(NO_HAND);
    expect(readItem(w.record, "i-none").open?.lease_id).toBe(hand.lease_id);
    expect(readItem(w.record, "i-none").leases).toHaveLength(1);
  });

  test("a told stage that cap-stopped is not reopened by a relaunch from the same run directory", async () => {
    const w = world({ "i-pe": 50 });
    await capStopped(w, [PE], "plan-eng-review:told");
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("a cap-stopped item is not reopened from a new run directory either", async () => {
    const w = world({ "i-pe": 50 });
    await capStopped(w, [PE], "plan-eng-review:told");
    const err = await refused(w.serve([PE], { dir: join(w.root, "run2") }));
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain(realpathSync(w.dir));
    expect(err?.message).not.toMatch(NO_HAND);
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("after a none cap stop, a relaunch refuses every stage", async () => {
    const w = world({ "i-none": 20, "i-pe": 572 });
    await capStopped(w, [NONE, PE], "none");
    for (const stages of [[PE], [NONE, PE]]) expect(await codeOf(w.serve(stages))).toBe("CAP_STOP");
    for (const stages of [[PE], [NONE, PE]]) expect(await codeOf(w.serve(stages, { dir: join(w.root, "run2") }))).toBe("E_USAGE");
    for (const item of ["i-none", "i-pe"]) expect(readItem(w.record, item).leases).toHaveLength(1);
  });

  test("a cap stop is in O6's record before the 409 answers, with the lease still open, and a direct lease on the item is refused", async () => {
    const w = world({ "i-pe": 50 });
    const served = await w.serve([PE]);
    const open = (task: string) => post(served.control + "/sessions", body("plan-eng-review:told", task, 1));
    const [a, b] = [await open("a"), await open("b")];
    expect((await open("c")).status).toBe(409);
    const state = readItem(w.record, "i-pe");
    expect(state.open?.lease_id).toBe(served.stages[0]!.lease_id);
    expect(state.stops).toMatchObject([{ lease_id: served.stages[0]!.lease_id, run_id: "r1", scope: "plan-eng-review:told only" }]);
    expect(() => openLease(w.record, w.local, { item: "i-pe", run_id: "r1", machine_id: "m1", requireAdmission: () => null })).toThrow(/cap-stopped/);
    for (const s of [a, b]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.done).toBe(0);
    expect(readItem(w.record, "i-pe").leases[0]!.close?.cap_stop).toBe("plan-eng-review:told only");
  });

  test("a none cap stop writes a stop record on every stage's item", async () => {
    const w = world({ "i-none": 20, "i-pe": 572 });
    await capStopped(w, [NONE, PE], "none");
    for (const item of ["i-none", "i-pe"]) expect(readItem(w.record, item).stops.map((s) => s.scope)).toEqual(["all: none's cap stop ends both skills incomplete"]);
  });

  test("a none cap stop on a lease still open on another machine refuses every stage of the run, from its stop record", async () => {
    const w = world({ "i-none": 20, "i-pe": 572 });
    mkdirSync(w.dir, { recursive: true });
    const crashed = { dir: realpathSync(w.dir), nonce: "0123456789abcdef" };
    writeFileSync(join(w.dir, "sessions.jsonl"), JSON.stringify({ run_id: "r1", event: "launch", nonce: crashed.nonce }) + "\n");
    const left = openLease(w.record, w.local, { item: "i-none", run_id: "r1", machine_id: "m1", holder: crashed, requireAdmission: () => null });
    recordStop(w.record, left.lease_id, "all: none's cap stop ends both skills incomplete");
    expect(await codeOf(w.serve([PE], { machine: "m2", envelope_host: "m2" }))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(0);
  });

  test("a driver killed with kill -9 while a cap-stopped stage drains leaves the stop in O6's record, so a relaunch with sessions.jsonl restored to before the 409 is refused with CAP_STOP (fix-check#1)", async () => {
    const w = world({ "i-pe": 50 });
    const at = (path: string) => JSON.stringify(join(import.meta.dir, "../..", path));
    const child = join(w.root, "child.ts");
    writeFileSync(child, [
      "import { serveStages } from " + at("lanes/outcome-skills/driver/stage.ts") + ";",
      "import { LocalLedger } from " + at("src/runner/ledger/local.ts") + ";",
      "const usage = " + JSON.stringify(usage) + ";",
      'const fetch = async (_url: string, init: RequestInit) => Response.json({ id: "msg_1", type: "message", role: "assistant", model: JSON.parse(String(init.body)).model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage });',
      "const served = await serveStages({ record: " + JSON.stringify(w.record) + ", local: LocalLedger.open(" + JSON.stringify(join(w.root, "ledger.sqlite")) + '), run_id: "r1", envelope_host: "m1", machine: "m1", stages: [' + JSON.stringify(PE) + '], host: "127.0.0.1", dir: ' + JSON.stringify(w.dir) + ', fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key" }, log: () => {} });',
      'console.log("CONTROL " + served.control);',
      "await new Promise(() => {});",
    ].join("\n"));
    const proc = Bun.spawn(["bun", child], { stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.getReader();
    let out = "";
    while (!out.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    const control = out.match(/CONTROL (\S+)/)?.[1];
    expect(control).toBeDefined();
    const open = (task: string) => post(control + "/sessions", body("plan-eng-review:told", task, 1));
    const a = await open("a");
    expect((await open("b")).status).toBe(200);
    expect((await call(a.json)).status).toBe(200);
    const file = join(w.dir, "sessions.jsonl");
    const snapshot = readFileSync(file, "utf8");
    expect((await open("c")).status).toBe(409);
    proc.kill(9);
    await proc.exited;
    expect(readItem(w.record, "i-pe").open).not.toBeNull();
    writeFileSync(file, snapshot);
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
    expect(readItem(w.record, "i-pe").leases[0]!.close?.cap_stop).toBe("plan-eng-review:told only");
  });

  test("a cap-stopped stage whose settle fails still refuses, and ledger settle on its lease keeps the stop (fix-check#2, targeted#1)", async () => {
    const w = world({ "i-pe": 50 });
    const served = await w.serve([PE]);
    const open = (task: string) => post(served.control + "/sessions", body("plan-eng-review:told", task, 1));
    const [a, b] = [await open("a"), await open("b")];
    expect((await open("c")).status).toBe(409);
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    try {
      for (const s of [a, b]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
      expect(await served.done).not.toBe(0);
    } finally {
      chmodSync(items, 0o755);
    }
    const lease = readItem(w.record, "i-pe").open;
    expect(lease?.lease_id).toBe(served.stages[0]!.lease_id);
    expect(() => openLease(w.record, w.local, { item: "i-pe", run_id: "r1", machine_id: "m1", requireAdmission: () => null })).toThrow(/cap-stopped/);
    expect(settleLease(w.record, w.local, lease!.lease_id).cap_stop).toBe("plan-eng-review:told only");
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("a none cap stop is read from the ledger: with sessions.jsonl cut back to its launch and open lines, a relaunch of a told stage is refused before any lease", async () => {
    const w = world({ "i-none": 20, "i-pe": 572 });
    await capStopped(w, [NONE], "none");
    expect(readItem(w.record, "i-none").leases[0]!.close?.cap_stop).toStartWith("all");
    const file = join(w.dir, "sessions.jsonl");
    writeFileSync(file, readFileSync(file, "utf8").split("\n").filter((l) => /"event":"(launch|open)"/.test(l)).join("\n") + "\n");
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(0);
  });

  test("a stage that ended lease_expired reopens on a relaunch from the same run directory", async () => {
    const w = world({ "i-none": 229 });
    const served = await w.serve([NONE], { ttl_ms: 3_600_000 });
    expect((await post(served.control + "/sessions", body("none", "a", 1))).status).toBe(503);
    expect(await served.done).toBe(0);
    const again = await w.serve([NONE]);
    expect(readItem(w.record, "i-none").leases.map((l) => l.lease.seq)).toEqual([1, 2]);
    await again.stop();
  });

  test("a run whose bound directory lost its sessions.jsonl is refused on any machine, so a cap stop it recorded is never retried (adversarial-native#1, targeted#1)", async () => {
    const w = world({ "i-pe": 50 });
    await capStopped(w, [PE], "plan-eng-review:told");
    rmSync(w.dir, { recursive: true, force: true });
    for (const more of [{}, { machine: "m2", envelope_host: "m2" }]) {
      const err = await refused(w.serve([PE], more));
      expect(err?.code).toBe("E_USAGE");
      expect(err?.message).toContain("sessions.jsonl");
    }
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("two launches of one run from two directories never both bind it, even on two programs at the same moment (outside-voice#1)", async () => {
    const w = world({ "i-pe": 572 });
    recordProgram(w.record, { program: "w2", cap_micros: 10_000 * D, skill_cap_micros: 2_000 * D, skills: ["plan-eng-review", "autoplan"], credit_rate_micros: D, quotes: [quote] });
    recordApproval(w.record, { action: "init", item: "i-ap", cap_micros: 1287 * D, quotes: [quote], admission: "required", program: "w2", skills: ["autoplan"] });
    let calls = 0;
    let inner: ReturnType<typeof w.serve> | null = null;
    const first = await w.serve([PE], { requireAdmission: () => { if (++calls === 2) inner = w.serve([AP], { dir: join(w.root, "run2") }); return null; } });
    const second = await inner!.then(async (s) => { await s.stop(); return null; }, (e) => e as LedgerError);
    expect(second?.code).toBe("E_USAGE");
    expect(readItem(w.record, "i-ap").leases).toHaveLength(0);
    expect(readItem(w.record, "i-pe").open?.holder?.dir).toBe(realpathSync(w.dir));
    expect(await first.stop()).toBe(0);
  });

  test("a launch is refused while another process holds the run's lock on this host, and serves once that lock is let go (Capy 01M6N9A46QRD6XG1V5FRJFXDNP)", async () => {
    const w = world({ "i-none": 229 });
    const other = new Database(join(w.root, ".record.run-" + createHash("sha256").update("r1").digest("hex").slice(0, 16) + ".lock.db"), { create: true });
    other.exec("BEGIN EXCLUSIVE");
    const err = await refused(w.serve([NONE]));
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain("run r1");
    expect(readItem(w.record, "i-none").leases).toHaveLength(0);
    other.close();
    const served = await w.serve([NONE]);
    expect(await served.stop()).toBe(0);
    expect(readItem(w.record, "i-none").leases).toHaveLength(1);
  });

  test("a launch whose approval record is missing is refused with E_LEDGER_MISSING before it takes any lock (Capy 01M6N9A46QRD6XG1V5FRJFXDNQ)", async () => {
    const w = world({});
    expect(await codeOf(w.serve([NONE], { record: join(w.root, "absent", "record") }))).toBe("E_LEDGER_MISSING");
  });

  test("a cap stop is a ledger fact: a relaunch from the bound directory with its sessions.jsonl emptied is refused, with one lease (pass 2, targeted#1)", async () => {
    const w = world({ "i-pe": 50 });
    await capStopped(w, [PE], "plan-eng-review:told");
    expect(readItem(w.record, "i-pe").leases[0]!.close?.cap_stop).toBe("plan-eng-review:told only");
    writeFileSync(join(w.dir, "sessions.jsonl"), "");
    expect(["CAP_STOP", "E_USAGE"]).toContain(await codeOf(w.serve([PE])));
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("a sessions.jsonl restored from after the launch wrote its nonce but before the cap stop is refused, with one lease (pass 2, targeted#1)", async () => {
    const w = world({ "i-pe": 50 });
    const served = await w.serve([PE]);
    const open = (task: string) => post(served.control + "/sessions", body("plan-eng-review:told", task, 1));
    const a = await open("a");
    expect(a.status).toBe(200);
    const snapshot = readFileSync(join(w.dir, "sessions.jsonl"), "utf8");
    expect(snapshot).toContain('"event":"launch"');
    const b = await open("b");
    expect((await open("c")).status).toBe(409);
    for (const s of [a, b]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.done).toBe(0);
    writeFileSync(join(w.dir, "sessions.jsonl"), snapshot);
    expect(["CAP_STOP", "E_USAGE"]).toContain(await codeOf(w.serve([PE])));
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("a sessions.jsonl that names fewer sessions than the ledger holds reservations for is refused, and an honest relaunch from the same directory still serves", async () => {
    const w = world({ "i-none": 229 });
    const served = await w.serve([NONE]);
    const snapshot = readFileSync(join(w.dir, "sessions.jsonl"), "utf8");
    const a = await post(served.control + "/sessions", body("none", "a", 1));
    expect((await call(a.json)).status).toBe(200);
    await post(served.control + "/sessions/" + a.json.id + "/close", {});
    expect(await served.stop()).toBe(0);
    const honest = readFileSync(join(w.dir, "sessions.jsonl"), "utf8");
    writeFileSync(join(w.dir, "sessions.jsonl"), snapshot);
    const err = await refused(w.serve([NONE]));
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain("sessions.jsonl");
    expect(err?.message).not.toMatch(NO_HAND);
    expect(readItem(w.record, "i-none").leases).toHaveLength(1);
    writeFileSync(join(w.dir, "sessions.jsonl"), honest);
    const again = await w.serve([NONE]);
    expect(readItem(w.record, "i-none").leases.map((l) => l.lease.seq)).toEqual([1, 2]);
    expect(await again.stop()).toBe(0);
  });

  const statusOf = async (control: string, item: string) => ((await (await fetch(control + "/status")).json()) as { stages: Array<{ item: string; state: string; ended: string | null }> }).stages.find((s) => s.item === item);

  test("after a told cap stop, none serves on while another told stage ended lease_expired and still owes trials", async () => {
    const w = world({ "i-none": 229, "i-pe": 25, "i-ap": 1287 });
    const served = await w.serve([NONE, PE, AP], { ttl_ms: 3 * 3_600_000 });
    expect((await post(served.control + "/sessions", body("autoplan:told", "a", 1))).status).toBe(503);
    const a = await post(served.control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect(a.status).toBe(200);
    expect((await post(served.control + "/sessions", body("plan-eng-review:told", "a", 2))).status).toBe(409);
    const n = await post(served.control + "/sessions", body("none", "a", 1));
    expect(n.status).toBe(200);
    expect(await statusOf(served.control, "i-none")).toMatchObject({ state: "serving", ended: null });
    for (const s of [a, n]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.stop()).toBe(0);
    expect(w.logs.find((l) => l.startsWith("STAGE_SETTLED item=i-ap"))).toContain("ended=lease_expired");
  });

  test("after a told cap stop, none serves on while another told stage ended failed", async () => {
    const w = world({ "i-none": 229, "i-pe": 25, "i-ap": 1287 });
    const served = await w.serve([NONE, PE, AP], { ttl_ms: 3 * 3_600_000 });
    const items = join(w.record, "items", "i-ap");
    chmodSync(items, 0o555);
    try {
      expect((await post(served.control + "/sessions", body("autoplan:told", "a", 1))).status).toBe(503);
      // gstack-timing-ok: a bounded wait for the drained stage's settle to fail; the assertion is on the stage's state, never on elapsed time
      for (let i = 0; i < 250 && (await statusOf(served.control, "i-ap"))?.ended !== "failed"; i++) await Bun.sleep(20);
    } finally {
      chmodSync(items, 0o755);
    }
    expect(await statusOf(served.control, "i-ap")).toMatchObject({ state: "stopped", ended: "failed" });
    const a = await post(served.control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect((await post(served.control + "/sessions", body("plan-eng-review:told", "a", 2))).status).toBe(409);
    const n = await post(served.control + "/sessions", body("none", "a", 1));
    expect(n.status).toBe(200);
    for (const s of [a, n]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.stop()).toBe(2);
  });

  test("once every told stage has cap-stopped, none drains and settles as completed", async () => {
    const w = world({ "i-none": 229, "i-pe": 25, "i-ap": 50 });
    const served = await w.serve([NONE, PE, AP]);
    const pe = await post(served.control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect((await post(served.control + "/sessions", body("plan-eng-review:told", "a", 2))).status).toBe(409);
    const first = await post(served.control + "/sessions", body("none", "a", 1));
    expect(first.status).toBe(200);
    await post(served.control + "/sessions/" + first.json.id + "/close", {});
    const ap = await post(served.control + "/sessions", body("autoplan:told", "a", 1));
    expect((await post(served.control + "/sessions", body("autoplan:told", "a", 2))).status).toBe(409);
    const n = await post(served.control + "/sessions", body("none", "b", 1));
    expect([n.status, n.json.code]).toEqual([503, "E_LEASE_CLOSED"]);
    for (const s of [pe, ap]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.done).toBe(0);
    expect(w.logs.find((l) => l.startsWith("STAGE_SETTLED item=i-none"))).toContain("ended=completed");
  });

  test("a cap stop whose stop record can't be written answers 500, and a relaunch closes the lease with cap_stop and refuses with CAP_STOP", async () => {
    const w = world({ "i-pe": 50 });
    const served = await w.serve([PE]);
    const open = (task: string) => post(served.control + "/sessions", body("plan-eng-review:told", task, 1));
    const [a, b] = [await open("a"), await open("b")];
    expect([a.status, b.status]).toEqual([200, 200]);
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    try {
      const c = await open("c");
      expect([c.status, c.json.code]).toEqual([500, "E_INTERNAL"]);
      expect(await served.done).toBe(2);
    } finally {
      chmodSync(items, 0o755);
    }
    expect(readItem(w.record, "i-pe").stops).toHaveLength(0);
    expect(readItem(w.record, "i-pe").open?.lease_id).toBe(served.stages[0]!.lease_id);
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    const leases = readItem(w.record, "i-pe").leases;
    expect(leases).toHaveLength(1);
    expect(leases[0]!.close?.cap_stop).toBe("plan-eng-review:told only");
  });

  test("a cap stop whose stop record can't be written drains its stage with cap_stop, so its close carries the stop once the record is writable", async () => {
    const w = world({ "i-pe": 50 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let sent!: () => void;
    const inflight = new Promise<void>((r) => (sent = r));
    const held = async (url: string, init: RequestInit) => {
      sent();
      await gate;
      return upstream(url, init);
    };
    const served = await w.serve([PE], { fetch: held });
    const open = (task: string) => post(served.control + "/sessions", body("plan-eng-review:told", task, 1));
    const [a, b] = [await open("a"), await open("b")];
    expect([a.status, b.status]).toEqual([200, 200]);
    const pending = call(a.json);
    await inflight;
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    let c: Awaited<ReturnType<typeof open>>;
    try {
      c = await open("c");
    } finally {
      chmodSync(items, 0o755);
    }
    expect([c.status, c.json.code]).toEqual([500, "E_INTERNAL"]);
    release();
    await pending;
    expect(await served.done).toBe(2);
    expect(readItem(w.record, "i-pe").leases[0]!.close?.cap_stop).toBe("plan-eng-review:told only");
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("a driver killed while it drains after a failed stop write leaves the stop in sessions.jsonl, so the relaunch closes the lease with cap_stop and refuses with CAP_STOP", async () => {
    const w = world({ "i-pe": 50 });
    const at = (path: string) => JSON.stringify(join(import.meta.dir, "../..", path));
    const child = join(w.root, "child.ts");
    writeFileSync(child, [
      "import { serveStages } from " + at("lanes/outcome-skills/driver/stage.ts") + ";",
      "import { LocalLedger } from " + at("src/runner/ledger/local.ts") + ";",
      'const fetch = () => (console.log("SENT"), new Promise<Response>(() => {}));',
      "const served = await serveStages({ record: " + JSON.stringify(w.record) + ", local: LocalLedger.open(" + JSON.stringify(join(w.root, "ledger.sqlite")) + '), run_id: "r1", envelope_host: "m1", machine: "m1", stages: [' + JSON.stringify(PE) + '], host: "127.0.0.1", dir: ' + JSON.stringify(w.dir) + ', fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key" }, log: () => {} });',
      'console.log("CONTROL " + served.control);',
      "await new Promise(() => {});",
    ].join("\n"));
    const proc = Bun.spawn(["bun", child], { stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.getReader();
    let out = "";
    const until = async (word: string) => {
      while (!out.includes(word)) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
    };
    await until("\n");
    const control = out.match(/CONTROL (\S+)/)?.[1];
    expect(control).toBeDefined();
    const open = (task: string) => post(control + "/sessions", body("plan-eng-review:told", task, 1));
    const a = await open("a");
    expect((await open("b")).status).toBe(200);
    void call(a.json).catch(() => null);
    await until("SENT");
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    try {
      expect((await open("c")).status).toBe(500);
      proc.kill(9);
      await proc.exited;
    } finally {
      chmodSync(items, 0o755);
    }
    expect(readItem(w.record, "i-pe").stops).toHaveLength(0);
    expect(readItem(w.record, "i-pe").open).not.toBeNull();
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
    expect(readItem(w.record, "i-pe").leases[0]!.close?.cap_stop).toBe("plan-eng-review:told only");
  });

  test("after a stop write and the stage's settle both fail, ledger settle on the lease still closes it with cap_stop", async () => {
    const w = world({ "i-pe": 50 });
    const served = await w.serve([PE]);
    const open = (task: string) => post(served.control + "/sessions", body("plan-eng-review:told", task, 1));
    expect([(await open("a")).status, (await open("b")).status]).toEqual([200, 200]);
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    try {
      expect((await open("c")).status).toBe(500);
      expect(await served.done).toBe(2);
    } finally {
      chmodSync(items, 0o755);
    }
    const lease = readItem(w.record, "i-pe").open;
    expect(lease?.lease_id).toBe(served.stages[0]!.lease_id);
    expect(settleLease(w.record, w.local, lease!.lease_id).cap_stop).toBe("plan-eng-review:told only");
    expect(() => openLease(w.record, w.local, { item: "i-pe", run_id: "r1", machine_id: "m1", requireAdmission: () => null })).toThrow(/cap-stopped/);
  });

  test("a close answers its settled spend as spent_micros, and counts a call of unknown cost apart with the reservation O6 holds for it", async () => {
    let calls = 0;
    const unpriced = async (url: string, init: RequestInit) => (calls++ === 0 ? upstream(url, init) : Response.json({ id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    const w = world({ "i-none": 229 });
    const served = await w.serve([NONE], { fetch: unpriced });
    const open = await post(served.control + "/sessions", body("none", "a", 1));
    for (let i = 0; i < 2; i++) expect((await call(open.json)).status).toBe(200);
    const closed = await post(served.control + "/sessions/" + open.json.id + "/close", {});
    expect(await served.stop()).toBe(0);
    const close = readItem(w.record, "i-none").leases[0]!.close!;
    expect(close).toMatchObject({ spent_micros: 20_040, unknown_calls: 1 });
    expect(close.unknown_micros).toBeGreaterThan(0);
    expect(closed.json).toMatchObject({ spent_micros: 20_040, unknown: 1, unknown_micros: close.unknown_micros });
  });

  test("a driver killed with kill -9 while a session is in flight, after its stop record could not be written, still leaves the stop in the local ledger: ledger settle --lease closes with cap_stop and O6 refuses a new lease (outside-voice#1)", async () => {
    const w = world({ "i-pe": 50 });
    const at = (path: string) => JSON.stringify(join(import.meta.dir, "../..", path));
    const child = join(w.root, "child.ts");
    writeFileSync(child, [
      "import { serveStages } from " + at("lanes/outcome-skills/driver/stage.ts") + ";",
      "import { LocalLedger } from " + at("src/runner/ledger/local.ts") + ";",
      "const fetch = () => new Promise<Response>(() => {});",
      "const served = await serveStages({ record: " + JSON.stringify(w.record) + ", local: LocalLedger.open(" + JSON.stringify(join(w.root, "ledger.sqlite")) + '), run_id: "r1", envelope_host: "m1", machine: "m1", stages: [' + JSON.stringify(PE) + '], host: "127.0.0.1", dir: ' + JSON.stringify(w.dir) + ', fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key" }, log: () => {} });',
      'console.log("CONTROL " + served.control);',
      "await new Promise(() => {});",
    ].join("\n"));
    const proc = Bun.spawn(["bun", child], { stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.getReader();
    let out = "";
    while (!out.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    const control = out.match(/CONTROL (\S+)/)?.[1];
    expect(control).toBeDefined();
    const open = (task: string) => post(control + "/sessions", body("plan-eng-review:told", task, 1));
    const a = await open("a");
    expect((await open("b")).status).toBe(200);
    void call(a.json).catch(() => {});
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    try {
      expect((await open("c")).status).toBe(500);
    } finally {
      chmodSync(items, 0o755);
    }
    proc.kill(9);
    await proc.exited;
    const lease = readItem(w.record, "i-pe").open;
    expect(readItem(w.record, "i-pe").stops).toHaveLength(0);
    expect(settleLease(w.record, w.local, lease!.lease_id).cap_stop).toBe("plan-eng-review:told only");
    expect(() => openLease(w.record, w.local, { item: "i-pe", run_id: "r1", machine_id: "m1", requireAdmission: () => null })).toThrow(/cap-stopped/);
  });

  test("a told cap stop whose settle fails keeps ended cap_stop: its stage answers 409 CAP_STOP, and none drains once the other told stage cap-stops (adversarial-native#2)", async () => {
    const w = world({ "i-none": 229, "i-pe": 25, "i-ap": 50 });
    const served = await w.serve([NONE, PE, AP]);
    const pe = await post(served.control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect((await post(served.control + "/sessions", body("plan-eng-review:told", "a", 2))).status).toBe(409);
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    try {
      await post(served.control + "/sessions/" + pe.json.id + "/close", {});
      // gstack-timing-ok: a bounded wait for the drained stage's settle to fail; the assertion is on the stage's state, never on elapsed time
      for (let i = 0; i < 250 && !w.logs.some((l) => l.startsWith("E_LEASE_UNSETTLED outcome driver: stage i-pe")); i++) await Bun.sleep(20);
    } finally {
      chmodSync(items, 0o755);
    }
    expect(await statusOf(served.control, "i-pe")).toMatchObject({ state: "stopped", ended: "cap_stop" });
    expect((await post(served.control + "/sessions", body("plan-eng-review:told", "b", 1))).json.code).toBe("CAP_STOP");
    const ap = await post(served.control + "/sessions", body("autoplan:told", "a", 1));
    expect((await post(served.control + "/sessions", body("autoplan:told", "a", 2))).status).toBe(409);
    await post(served.control + "/sessions/" + ap.json.id + "/close", {});
    expect(await served.done).toBe(2);
    expect(w.logs.find((l) => l.startsWith("STAGE_SETTLED item=i-none"))).toContain("ended=completed");
  });

  test("a none cap stop after a told lease settled lease_expired leaves that close as written, so a ledger settle retry answers the same close (adversarial-native#3)", async () => {
    const w = world({ "i-none": 20, "i-ap": 1287 });
    const served = await w.serve([NONE, AP], { ttl_ms: 3 * 3_600_000 });
    expect((await post(served.control + "/sessions", body("autoplan:told", "a", 1))).status).toBe(503);
    // gstack-timing-ok: a bounded wait for the drained stage to settle; the assertion is on the record, never on elapsed time
    for (let i = 0; i < 250 && !readItem(w.record, "i-ap").leases[0]?.close; i++) await Bun.sleep(20);
    const ap = readItem(w.record, "i-ap").leases[0]!;
    const [a, b] = [await post(served.control + "/sessions", body("none", "a", 1)), await post(served.control + "/sessions", body("none", "a", 2))];
    expect((await post(served.control + "/sessions", body("none", "a", 3))).status).toBe(409);
    for (const s of [a, b]) await post(served.control + "/sessions/" + s.json.id + "/close", {});
    expect(await served.done).toBe(0);
    expect(readItem(w.record, "i-ap").stops.map((s) => s.scope)).toEqual(["all: none's cap stop ends both skills incomplete"]);
    expect(settleLease(w.record, w.local, ap.lease.lease_id)).toEqual(ap.close!);
  });

  test("a none cap stop whose stop records can't be written answers 500, writes a stop line for every stage, and a relaunch of a told stage is refused (specialist-batched#1)", async () => {
    const w = world({ "i-none": 20, "i-pe": 572 });
    const served = await w.serve([NONE, PE]);
    for (const n of [1, 2]) expect((await post(served.control + "/sessions", body("none", "a", n))).status).toBe(200);
    const items = join(w.record, "items", "i-pe");
    chmodSync(items, 0o555);
    try {
      const c = await post(served.control + "/sessions", body("none", "a", 3));
      expect([c.status, c.json.code]).toEqual([500, "E_INTERNAL"]);
      expect(await served.done).toBe(2);
    } finally {
      chmodSync(items, 0o755);
    }
    const lines = readFileSync(join(w.dir, "sessions.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { event: string; item?: string });
    expect(lines.filter((e) => e.event === "stop").map((e) => e.item).sort()).toEqual(["i-none", "i-pe"]);
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    for (const item of ["i-none", "i-pe"]) expect(readItem(w.record, item).leases.map((l) => l.close?.cap_stop)).toEqual(["all: none's cap stop ends both skills incomplete"]);
  });

  test("a call still in flight at close counts as one unknown call at its reservation in the close answer, never in spent_micros (red-team#1)", async () => {
    const w = world({ "i-none": 229 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const served = await w.serve([NONE], { fetch: async (url: string, init: RequestInit) => (await gate, upstream(url, init)) });
    const open = await post(served.control + "/sessions", body("none", "a", 1));
    const inflight = call(open.json);
    // gstack-timing-ok: lets the call reach the stub upstream before the close; the assertions are on the close answer, never on elapsed time
    await Bun.sleep(200);
    const closed = await post(served.control + "/sessions/" + open.json.id + "/close", { reason: "wall_limit" });
    expect(closed.json).toMatchObject({ spent_micros: 0, unknown_calls: 1, undrained: 1 });
    expect(closed.json.unknown_micros).toBeGreaterThan(0);
    release();
    expect((await inflight).status).toBe(200);
    expect(await served.stop()).toBe(0);
    expect(readItem(w.record, "i-none").leases[0]!.close).toMatchObject({ spent_micros: 20_040, unknown_calls: 0 });
    expect(unknownFromRun(w.dir, ["i-none"])).toEqual({ calls: 1, micros: closed.json.unknown_micros });
  }, 60_000);

  test("relaunch recovery writes a recovered close line for a session the killed driver left open, so unknownFromRun counts its unknown call and stops refusing (Capy review)", async () => {
    const w = world({ "i-pe": 572 });
    const at = (path: string) => JSON.stringify(join(import.meta.dir, "../..", path));
    const child = join(w.root, "child.ts");
    writeFileSync(child, [
      "import { serveStages } from " + at("lanes/outcome-skills/driver/stage.ts") + ";",
      "import { LocalLedger } from " + at("src/runner/ledger/local.ts") + ";",
      "const fetch = () => new Promise<Response>(() => {});",
      "const served = await serveStages({ record: " + JSON.stringify(w.record) + ", local: LocalLedger.open(" + JSON.stringify(join(w.root, "ledger.sqlite")) + '), run_id: "r1", envelope_host: "m1", machine: "m1", stages: [' + JSON.stringify(PE) + '], host: "127.0.0.1", dir: ' + JSON.stringify(w.dir) + ', fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key" }, log: () => {} });',
      'console.log("CONTROL " + served.control);',
      "await new Promise(() => {});",
    ].join("\n"));
    const proc = Bun.spawn(["bun", child], { stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.getReader();
    let out = "";
    while (!out.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    const control = out.match(/CONTROL (\S+)/)?.[1];
    const a = await post(control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect(a.status).toBe(200);
    void call(a.json).catch(() => {});
    // gstack-timing-ok: lets the call reach the stub upstream and reserve before the kill; the assertions are on the ledger and the close line, never on elapsed time
    await Bun.sleep(300);
    proc.kill(9);
    await proc.exited;
    expect(() => unknownFromRun(w.dir, ["i-pe"])).toThrow(/open/);
    const again = await w.serve([PE]);
    expect(await again.stop()).toBe(0);
    const recovered = readItem(w.record, "i-pe").leases[0]!.close!;
    expect(recovered.unknown_calls).toBe(1);
    expect(unknownFromRun(w.dir, ["i-pe"])).toEqual({ calls: 1, micros: recovered.unknown_micros });
  });
});
