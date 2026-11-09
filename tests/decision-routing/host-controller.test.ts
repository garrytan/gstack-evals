// Copyright (c) 2026 Garry Tan. MIT License.
// The decision-routing host controller: seeded order, leases, one proxy per lease, concurrency and task exclusion,
// Harbor job files and env, stops (STOP file, CAP_STOP, pilot session meter), settle and reconcile before relaunch.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readItem } from "../../src/runner/ledger/record.ts";
import { ControllerError, fakeFetch, harborEnv, harborJob, HARBOR_RETRY, meterSpend, proxyPort, PROXY_PORT_COUNT, PROXY_PORT_FIRST, nextRunnable, parsePlan, prng, runBatch, seededShuffle, sessionId, type BatchOptions, type PlanRow } from "../../lanes/decision-routing/host/controller.ts";

const CONTROLLER = join(import.meta.dir, "../../lanes/decision-routing/host/controller.ts");
const FAKE_HARBOR = "import { appendFileSync, readFileSync, writeFileSync } from \"node:fs\";\nconst env = process.env;\nconst job = JSON.parse(readFileSync(process.argv[process.argv.indexOf(\"-c\") + 1], \"utf8\"));\nconst kw = job.agents[0].kwargs;\nconst task = job.tasks[0].path.split(\"/\").pop();\nconst ev = (e) => appendFileSync(env.DR_TEST_EVENTS, JSON.stringify({ ...e, task, cell: kw.cell, t: performance.timeOrigin + performance.now() }) + \"\\n\");\nev({ ev: \"start\", keys_seen: Object.keys(env).filter((k) => /_API_KEY$/.test(k)), telemetry: env.HARBOR_TELEMETRY, mgmt: !!env.DR_MGMT_SOCKET && !!env.DR_MGMT_TOKEN, base: env.DR_PROXY_BASE, pythonpath: env.PYTHONPATH });\nconst mgmt = (path, body) => fetch(\"http://localhost\" + path, { unix: env.DR_MGMT_SOCKET, method: \"POST\", headers: { \"content-type\": \"application/json\", \"x-gstack-evals-management\": env.DR_MGMT_TOKEN }, body: JSON.stringify(body) }).then((r) => r.json());\nconst b = await mgmt(\"/bind\", { cell: { run_id: \"dr-test\", arm: kw.cell, task, model: kw.model, trial: 1, attempt: 1 }, models: [\"anthropic:claude-opus-5-5\"], allowance_micros: 5000000 });\nconst res = await fetch(env.DR_PROXY_BASE + \"/\" + b.slot + \"/anthropic/v1/messages\", { method: \"POST\", headers: { \"content-type\": \"application/json\", \"x-api-key\": b.token }, body: JSON.stringify({ model: \"claude-opus-5-5\", max_tokens: 100, messages: [{ role: \"user\", content: \"hi\" }] }) });\nconst answer = await res.json();\nawait Bun.sleep(Number(env.DR_TEST_SLEEP_MS ?? 150));\nawait mgmt(\"/unbind\", { slot: b.slot });\nawait mgmt(\"/finalize\", { meter_id: b.meter_id });\nif (env.DR_TEST_TOUCH_STOP) writeFileSync(env.DR_TEST_TOUCH_STOP, \"stop\\n\");\nev({ ev: \"end\", status: res.status, code: answer.code ?? null });\n";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function world(over: { items?: Array<{ item: string; cap_micros: number }>; usage?: Record<string, number>; env?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dr-host-"));
  dirs.push(dir);
  const harbor = join(dir, "fake-harbor.ts");
  writeFileSync(harbor, FAKE_HARBOR);
  writeFileSync(join(dir, "runtime.tgz"), "runtime");
  writeFileSync(join(dir, "pin.json"), "{}");
  const items = join(dir, "items.json");
  writeFileSync(items, JSON.stringify({ items: over.items ?? [{ item: "dr-pilot-rp", cap_micros: 70_000_000 }, { item: "dr-pilot-jfw", cap_micros: 70_000_000 }] }));
  const events = join(dir, "events.ndjson");
  const sent: string[] = [];
  const opts = (plan: PlanRow[], extra: Partial<BatchOptions> = {}): BatchOptions => ({
    plan,
    out: join(dir, "out"),
    runId: "dr-test-run",
    temp: true,
    items,
    harbor: [process.execPath, harbor],
    tasksDir: join(dir, "tasks"),
    proxyHost: "127.0.0.1",
    runtimeTarball: join(dir, "runtime.tgz"),
    runtimeSha256: sha("runtime"),
    pinFile: join(dir, "pin.json"),
    pinSha256: sha("{}"),
    pollMs: 20,
    log: () => {},
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: "sk-ant-fake-0123456789", TYPESAFE_API_KEY: "ts-fake-0123456789", DR_TEST_EVENTS: events, ...over.env },
    fetch: async (url) => {
      sent.push(url);
      return Response.json({ id: "msg", usage: over.usage ?? { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500 } });
    },
    ...extra,
  });
  const read = () => (existsSync(events) ? readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { dir, opts, read, sent, out: join(dir, "out") };
}

const plan = (tasks: number, cells: PlanRow["cell"][], item = "dr-pilot-rp"): PlanRow[] => Array.from({ length: tasks }, (_, i) => cells.map((cell) => ({ task: "task-" + i, cell, model: cell === "W" ? "particle" : "opus", item }) as PlanRow)).flat();

describe("seeded order", () => {
  test("prng is deterministic, in [0, 1), and pinned for seed 20261110", () => {
    const a = prng(20261110);
    expect([a(), a(), a()]).toEqual([0.47585524804890156, 0.4372278384398669, 0.7736968537792563]);
    const b = prng(7);
    for (let i = 0; i < 1000; i++) {
      const x = b();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  test("the shuffle is a fixed permutation for the seed, and a different seed gives a different one", () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(seededShuffle(rows)).toEqual([5, 1, 8, 9, 0, 7, 2, 6, 3, 4]);
    expect(seededShuffle(rows)).toEqual(seededShuffle(rows));
    expect([...seededShuffle(rows)].sort((x, y) => x - y)).toEqual(rows);
    expect(seededShuffle(rows, 20261111)).not.toEqual(seededShuffle(rows));
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("nextRunnable skips a task with a running session", () => {
    const q = plan(2, ["N", "R"]);
    expect(nextRunnable(q, new Set())).toBe(0);
    expect(nextRunnable(q, new Set(["task-0"]))).toBe(2);
    expect(nextRunnable(q, new Set(["task-0", "task-1"]))).toBe(-1);
  });
});

describe("plan, job and env", () => {
  test("parsePlan takes valid rows and refuses bad cells, models, items and repeats", () => {
    expect(parsePlan(JSON.stringify(plan(1, ["N", "W"])))).toHaveLength(2);
    for (const bad of [[], [{ task: "t", cell: "X", model: "opus", item: "dr-a" }], [{ task: "t", cell: "W", model: "opus", item: "dr-a" }], [{ task: "t", cell: "N", model: "particle", item: "dr-a" }], [{ task: "t", cell: "N", model: "opus", item: "Bad Item" }], [...plan(1, ["N"]), ...plan(1, ["N"])]]) {
      expect(() => parsePlan(JSON.stringify(bad))).toThrow(ControllerError);
    }
  });

  test("a Harbor job runs the decision-routing agent once, in docker with delete, with the proxy host allowlisted for the agent's run only", () => {
    const row: PlanRow = { task: "django-1", cell: "R", model: "sol", item: "dr-pilot-rp" };
    expect(harborJob(row, { out: "/o", tasksDir: "/tasks", proxyHost: "172.17.0.1", runtimeTarball: "/rt.tgz", runtimeSha256: "ab", pinFile: "/pin.json" })).toEqual({
      job_name: "django-1__R__sol",
      jobs_dir: "/o/harbor",
      n_attempts: 1,
      n_concurrent_trials: 1,
      quiet: true,
      retry: { max_retries: 1, include_exceptions: ["DrInfraError", "EnvironmentStartTimeoutError", "AgentSetupTimeoutError"] },
      environment: { type: "docker", delete: true },
      agents: [{ import_path: "dr_harbor:DecisionRoutingAgent", extra_allowed_hosts: ["172.17.0.1"], kwargs: { cell: "R", model: "sol", runtime_tarball: "/rt.tgz", runtime_sha256: "ab", pin_file: "/pin.json", item: "dr-pilot-rp" } }],
      tasks: [{ path: "/tasks/django-1" }],
    });
    expect(HARBOR_RETRY.include_exceptions).not.toContain("AllowanceStop");
  });

  test("a proxy on a loopback host takes any free port, and on a runner's bridge address item k takes the k-th fixed port the runner's firewall opens", () => {
    expect(proxyPort("127.0.0.1", 0)).toBeUndefined();
    expect(proxyPort("::1", 3)).toBeUndefined();
    expect(proxyPort("172.17.0.1", 0)).toBe(PROXY_PORT_FIRST);
    expect(proxyPort("172.17.0.1", PROXY_PORT_COUNT - 1)).toBe(PROXY_PORT_FIRST + PROXY_PORT_COUNT - 1);
    expect(() => proxyPort("172.17.0.1", PROXY_PORT_COUNT)).toThrow(ControllerError);
  });

  test("Harbor's env holds no provider or cloud key, has telemetry off and the management socket and token", () => {
    const env = harborEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b", OPENROUTER_API_KEY: "c", TYPESAFE_API_KEY: "d", UBICLOUD_API_KEY: "e", OTHER_API_KEY: "f", HARBOR_TELEMETRY: "1" }, { socket: "/s.sock", token: "tok", base: "http://127.0.0.1:9" }, "/agent");
    expect(env).toEqual({ PATH: "/bin", HARBOR_TELEMETRY: "0", DR_MGMT_SOCKET: "/s.sock", DR_MGMT_TOKEN: "tok", DR_PROXY_BASE: "http://127.0.0.1:9", PYTHONPATH: "/agent" });
  });

  test("meterSpend sums settled spend and charges an unknown outcome its reservation", () => {
    const lines = [
      { kind: "request", reservation_id: "r1", max_micros: 900 },
      { kind: "outcome", reservation_id: "r1", meter_id: "m1", outcome: { kind: "spent", spent_micros: 100 } },
      { kind: "request", reservation_id: "r2", max_micros: 700 },
      { kind: "outcome", reservation_id: "r2", meter_id: "m1", outcome: { kind: "unknown" } },
      { kind: "outcome", reservation_id: "r3", meter_id: "m2", outcome: { kind: "spent", spent_micros: 5 } },
    ];
    expect([...meterSpend(lines)]).toEqual([["m1", 800], ["m2", 5]]);
  });
});

describe("runBatch", () => {
  test("runs every session once, at most 6 at once and never two cells of one task together, then settles each lease", async () => {
    const w = world();
    const rows = [...plan(8, ["N", "R"]), ...plan(2, ["J"], "dr-pilot-jfw")];
    const result = await runBatch(w.opts(rows));
    expect(result.exit).toBe(0);
    expect(result.stop).toBeNull();
    expect(result.launched).toHaveLength(18);
    expect(result.launched[0]).toBe(sessionId(seededShuffle(rows)[0]!));
    const ev = w.read();
    expect(ev.filter((e) => e.ev === "end").every((e) => e.status === 200)).toBe(true);
    const timeline = ev.map((e) => [e.t, e.ev === "start" ? 1 : -1, e.task] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let running = 0;
    let peak = 0;
    const byTask = new Map<string, number>();
    for (const [, d, task] of timeline) {
      running += d;
      peak = Math.max(peak, running);
      byTask.set(task, (byTask.get(task) ?? 0) + d);
      expect(byTask.get(task)!).toBeLessThanOrEqual(1);
    }
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
    for (const e of ev.filter((e) => e.ev === "start")) {
      expect(e.keys_seen).toEqual([]);
      expect(e.telemetry).toBe("0");
      expect(e.mgmt).toBe(true);
      expect(e.pythonpath).toEndWith("lanes/decision-routing/agent");
    }
    expect(new Set(ev.filter((e) => e.ev === "start").map((e) => e.base)).size).toBe(2);
    expect(w.sent).toHaveLength(18);
    expect(result.leases.map((l) => l.item).sort()).toEqual(["dr-pilot-jfw", "dr-pilot-rp"]);
    for (const l of result.leases) {
      expect(l.spent_micros).toBeGreaterThan(0);
      expect(l.cap_stop).toBeNull();
    }
    const job = JSON.parse(readFileSync(join(w.out, "jobs", "task-0__R__opus.json"), "utf8"));
    expect(job.agents[0].kwargs.item).toBe("dr-pilot-rp");
    expect(JSON.parse(readFileSync(join(w.out, "batch.json"), "utf8")).seed).toBe(20261110);
    const journal = readFileSync(join(w.out, "journals", "dr-pilot-rp.ndjson"), "utf8");
    expect(journal).not.toContain("sk-ant-fake");
    expect(journal).toContain('"latency_ms"');
  }, 30_000);

  test("a relaunch reconciles the earlier journal, settles before leasing again and never relaunches a launched session", async () => {
    const w = world();
    const rows = plan(2, ["N", "P"]);
    expect((await runBatch(w.opts(rows))).launched).toHaveLength(4);
    const again = await runBatch(w.opts([...rows, ...plan(3, ["N"]).slice(2)]));
    expect(again.exit).toBe(0);
    expect(again.launched).toEqual(["task-2__N__opus"]);
    expect(again.skipped.sort()).toEqual(rows.map(sessionId).sort());
    expect(readdirSync(join(w.out, "journals")).sort()).toEqual(["dr-pilot-rp.dead-0.ndjson", "dr-pilot-rp.ndjson", "dr-pilot-rp.ndjson.lock"]);
    const state = readItem(join(w.out, "temp-ledger", "record"), "dr-pilot-rp");
    expect(state.leases).toHaveLength(2);
    expect(state.leases.every((l) => l.close !== null)).toBe(true);
  }, 30_000);

  test("a CAP_STOP from the ledger stops the batch: nothing more launches, nothing retries, the lease closes with its stop", async () => {
    const w = world({ items: [{ item: "dr-pilot-rp", cap_micros: 30_000_000 }], usage: { input_tokens: 10_000_000, output_tokens: 0 } });
    const result = await runBatch(w.opts(plan(1, ["N", "R", "P"])));
    expect(result.exit).toBe(2);
    expect(result.stop?.code).toBe("CAP_STOP");
    expect(result.launched).toHaveLength(2);
    expect(result.not_launched).toHaveLength(1);
    expect(w.sent).toHaveLength(1);
    expect(w.read().filter((e) => e.ev === "end").map((e) => e.code)).toEqual([null, "CAP_STOP"]);
    expect(result.leases[0]!.cap_stop).toBe("batch dr-test-run");
  }, 30_000);

  test("a pilot session whose meter passes $2.50 stops the batch with DR_PILOT_SESSION_STOP", async () => {
    const w = world({ usage: { input_tokens: 700_000, output_tokens: 10 } });
    const result = await runBatch(w.opts(plan(1, ["R", "P"]), { pilot: true }));
    expect(result.stop?.code).toBe("DR_PILOT_SESSION_STOP");
    expect(result.exit).toBe(2);
    expect(result.launched).toHaveLength(1);
    expect(result.not_launched).toHaveLength(1);
  }, 30_000);

  test("a pilot session stop writes the STOP file with its code and session, and a relaunch launches nothing", async () => {
    const w = world({ usage: { input_tokens: 700_000, output_tokens: 10 } });
    const rows = plan(1, ["R", "P"]);
    const result = await runBatch(w.opts(rows, { pilot: true }));
    expect(result.stop?.code).toBe("DR_PILOT_SESSION_STOP");
    const stop = readFileSync(join(w.out, "STOP"), "utf8");
    expect(stop).toStartWith("DR_PILOT_SESSION_STOP: ");
    expect(stop).toContain(result.launched[0]!);
    const jobs = readdirSync(join(w.out, "jobs")).sort();
    await expect(runBatch(w.opts(rows, { pilot: true }))).rejects.toThrow(/^E_DR_STOPPED: .*DR_PILOT_SESSION_STOP/);
    expect(readdirSync(join(w.out, "jobs")).sort()).toEqual(jobs);
    expect(w.read().filter((e) => e.ev === "start")).toHaveLength(1);
  }, 30_000);

  test("the same spend outside a pilot batch does not stop it", async () => {
    const w = world({ usage: { input_tokens: 700_000, output_tokens: 10 } });
    const result = await runBatch(w.opts(plan(1, ["R", "P"])));
    expect(result.stop).toBeNull();
    expect(result.launched).toHaveLength(2);
  }, 30_000);

  test("a STOP file that appears mid-batch stops launching, and one present at start leases nothing", async () => {
    const w = world({ env: { DR_TEST_TOUCH_STOP: "" } });
    const stopFile = join(w.dir, "STOP");
    const mid = world({ env: { DR_TEST_TOUCH_STOP: stopFile } });
    const result = await runBatch(mid.opts(plan(1, ["N", "R"]), { stopFile }));
    expect(result.stop?.code).toBe("E_DR_STOPPED");
    expect(result.launched).toHaveLength(1);
    expect(result.leases[0]!.spent_micros).toBeGreaterThan(0);
    await expect(runBatch(w.opts(plan(1, ["N"]), { stopFile }))).rejects.toThrow(/^E_DR_STOPPED: /);
    expect(existsSync(join(w.out, "temp-ledger"))).toBe(false);
  }, 30_000);

  test("a runtime tarball or pin file off its sha256 is refused before any lease", async () => {
    const w = world();
    await expect(runBatch(w.opts(plan(1, ["N"]), { runtimeSha256: "0".repeat(64) }))).rejects.toThrow(/^E_DR_RUNTIME: /);
    await expect(runBatch(w.opts(plan(1, ["N"]), { pinSha256: "0".repeat(64) }))).rejects.toThrow(/^E_DR_PIN: /);
    expect(existsSync(join(w.out, "temp-ledger"))).toBe(false);
  });

  test("the CLI prints the stop code first on stderr", () => {
    const w = world();
    mkdirSync(w.out, { recursive: true });
    writeFileSync(join(w.out, "STOP"), "");
    writeFileSync(join(w.dir, "plan.json"), JSON.stringify(plan(1, ["N"])));
    const o = w.opts([]);
    const r = Bun.spawnSync([process.execPath, CONTROLLER, "--plan", join(w.dir, "plan.json"), "--out", w.out, "--run-id", "x", "--tasks-dir", o.tasksDir, "--runtime-tarball", o.runtimeTarball, "--runtime-sha256", o.runtimeSha256, "--pin-file", o.pinFile, "--pin-sha256", o.pinSha256, "--temp", "--items", o.items!], { env: { PATH: process.env.PATH! } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toStartWith("E_DR_STOPPED: ");
  });

  test("--temp without fake upstreams is refused with E_USAGE before anything is leased or written", async () => {
    const w = world();
    await expect(runBatch(w.opts(plan(1, ["N"]), { fetch: undefined }))).rejects.toThrow(/^E_USAGE: --temp needs --fake-upstreams/);
    expect(existsSync(w.out)).toBe(false);
    writeFileSync(join(w.dir, "plan.json"), JSON.stringify(plan(1, ["N"])));
    const o = w.opts([]);
    const r = Bun.spawnSync([process.execPath, CONTROLLER, "--plan", join(w.dir, "plan.json"), "--out", w.out, "--run-id", "x", "--tasks-dir", o.tasksDir, "--runtime-tarball", o.runtimeTarball, "--runtime-sha256", o.runtimeSha256, "--pin-file", o.pinFile, "--pin-sha256", o.pinSha256, "--temp", "--items", o.items!], { env: { PATH: process.env.PATH!, ANTHROPIC_API_KEY: "sk-ant-fake-0123456789" } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toStartWith("E_USAGE: ");
    expect(existsSync(w.out)).toBe(false);
    expect(w.read()).toHaveLength(0);
  });

  test("fakeFetch throws for a provider with no fake and never calls the real fetch", async () => {
    const real = globalThis.fetch;
    const reached: string[] = [];
    globalThis.fetch = (async (input: string) => (reached.push(String(input)), Response.json({}))) as typeof fetch;
    try {
      const send = fakeFetch({ anthropic: "http://127.0.0.1:9" });
      expect(() => send("https://api.openai.com/v1/chat/completions", { method: "POST" })).toThrow(/^E_INTERNAL: no fake upstream/);
      expect(() => send("https://api.typesafe.ai/v1/systemone", { method: "POST" })).toThrow(/^E_INTERNAL: no fake upstream/);
      await send("https://api.anthropic.com/v1/messages", { method: "POST" });
    } finally {
      globalThis.fetch = real;
    }
    expect(reached).toEqual(["http://127.0.0.1:9/v1/messages"]);
  });
});
