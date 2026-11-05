// The outcome-skills session driver (lanes/outcome-skills/driver/stage.ts), keyless: a temporary ledger record and local
// ledger, a stub upstream behind the real metering proxy, and the driver's control plane over HTTP on 127.0.0.1.
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { openLease, recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { LedgerError, readItem } from "../../src/runner/ledger/record.ts";
import { loadRegistry, type Registry } from "../../lanes/outcome-skills/arms/registry.ts";
import { serveStages, type ServeOptions, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";

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

  test("relaunch recovers a lease this run's driver left open, and never a lease it did not open", async () => {
    const w = world({ "i-none": 229, "i-tg": 60 });
    const left = openLease(w.record, w.local, { item: "i-none", run_id: "r1", machine_id: "m1", requireAdmission: () => null });
    const tg = openLease(w.record, w.local, { item: "i-tg", run_id: "r1", machine_id: "m1", requireAdmission: () => null });
    mkdirSync(w.dir, { recursive: true });
    appendFileSync(join(w.dir, "leases.jsonl"), JSON.stringify({ lease_id: left.lease_id }) + "\n");
    const served = await w.serve([NONE]);
    expect(w.logs.some((l) => l.startsWith("JOURNAL_MISSING lease " + left.lease_id))).toBe(true);
    expect(w.logs.some((l) => l.startsWith("STAGE_RECOVERED item=i-none lease=" + left.lease_id))).toBe(true);
    expect(readItem(w.record, "i-none").leases.map((l) => l.lease.seq)).toEqual([1, 2]);
    expect(readItem(w.record, "i-tg").open?.lease_id).toBe(tg.lease_id);
    await served.stop();
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

  test("relaunch refuses a lease whose ownership line is torn, or was never written after the open, and settles nothing", async () => {
    const w = world({ "i-none": 229 });
    const left = openLease(w.record, w.local, { item: "i-none", run_id: "r1", machine_id: "m1", requireAdmission: () => null });
    mkdirSync(w.dir, { recursive: true });
    appendFileSync(join(w.dir, "leases.jsonl"), JSON.stringify({ run_id: "r1", item: "i-none", seq: 1, opening: true }) + "\n" + '{"lease_id":"i-none.00');
    const err = await w.serve([NONE]).then(() => null, (e) => e as LedgerError);
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain("gstack-evals ledger settle --lease " + left.lease_id);
    expect(readItem(w.record, "i-none").open?.lease_id).toBe(left.lease_id);
    expect(readItem(w.record, "i-none").leases).toHaveLength(1);
  });

  const staleMarker = (w: ReturnType<typeof world>, item: string) => {
    mkdirSync(w.dir, { recursive: true });
    appendFileSync(join(w.dir, "leases.jsonl"), JSON.stringify({ run_id: "r1", item, seq: 1, opening: true }) + "\n");
  };

  test("a stale opening marker claims no lease another run directory opened, so a relaunch can't reopen its cap-stopped item", async () => {
    const w = world({ "i-pe": 50 });
    staleMarker(w, "i-pe");
    await capStopped(w, [PE], "plan-eng-review:told", { dir: join(w.root, "runB") });
    const before = readItem(w.record, "i-pe").leases;
    const err = await w.serve([PE]).then(() => null, (e) => e as LedgerError);
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain(before[0]!.lease.lease_id);
    expect(readItem(w.record, "i-pe").leases).toEqual(before);
  });

  test("a stale opening marker never settles a lease another run directory still serves", async () => {
    const w = world({ "i-pe": 572 });
    staleMarker(w, "i-pe");
    const b = await w.serve([PE], { dir: join(w.root, "runB") });
    const s = await post(b.control + "/sessions", body("plan-eng-review:told", "a", 1));
    expect(s.status).toBe(200);
    const lease = readItem(w.record, "i-pe").open?.lease_id;
    const err = await w.serve([PE]).then(() => null, (e) => e as LedgerError);
    expect(err?.code).toBe("E_USAGE");
    expect(err?.message).toContain("gstack-evals ledger settle --lease " + lease);
    expect(readItem(w.record, "i-pe").open?.lease_id).toBe(lease);
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
    expect((await call(s.json)).status).toBe(200);
    await post(b.control + "/sessions/" + s.json.id + "/close", {});
    expect(await b.stop()).toBe(0);
  });

  test("an opening marker whose slot holds no lease, or from another run, claims nothing and blocks nothing", async () => {
    const w = world({ "i-none": 229, "i-tg": 60 });
    const tg = openLease(w.record, w.local, { item: "i-tg", run_id: "r1", machine_id: "m1", requireAdmission: () => null });
    staleMarker(w, "i-none");
    appendFileSync(join(w.dir, "leases.jsonl"), JSON.stringify({ run_id: "r0", item: "i-tg", seq: 1, opening: true }) + "\n");
    const served = await w.serve([NONE]);
    expect(readItem(w.record, "i-none").leases.map((l) => l.lease.seq)).toEqual([1]);
    expect(readItem(w.record, "i-tg").open?.lease_id).toBe(tg.lease_id);
    expect(await served.stop()).toBe(0);
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

  test("a told stage that cap-stopped is not reopened by a relaunch from the same run directory", async () => {
    const w = world({ "i-pe": 50 });
    await capStopped(w, [PE], "plan-eng-review:told");
    expect(await codeOf(w.serve([PE]))).toBe("CAP_STOP");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("a cap-stopped item is not reopened from a new run directory either", async () => {
    const w = world({ "i-pe": 50 });
    await capStopped(w, [PE], "plan-eng-review:told");
    expect(await codeOf(w.serve([PE], { dir: join(w.root, "run2") }))).toBe("E_USAGE");
    expect(readItem(w.record, "i-pe").leases).toHaveLength(1);
  });

  test("after a none cap stop, a relaunch refuses every stage", async () => {
    const w = world({ "i-none": 20, "i-pe": 572 });
    await capStopped(w, [NONE, PE], "none");
    for (const stages of [[PE], [NONE, PE]]) expect(await codeOf(w.serve(stages))).toBe("CAP_STOP");
    for (const item of ["i-none", "i-pe"]) expect(readItem(w.record, item).leases).toHaveLength(1);
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
});
