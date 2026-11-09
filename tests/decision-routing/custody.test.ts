// Copyright (c) 2026 Garry Tan. MIT License.
// The live leak scan (prereg section 2 "Leak scan", section 15 B8): per-slot runner-only markers in the metering proxy,
// the marker list built from a task's hidden test patch, and the controller's DR_CUSTODY_HIT stop.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBatch, seededShuffle, sessionId, type BatchOptions, type PlanRow } from "../../lanes/decision-routing/host/controller.ts";
import { MIN_MARKER_CHARS, plantCanary, pristineListing, runnerOnlyMarkers, taskMarkers, type Pristine } from "../../lanes/decision-routing/labels/markers.ts";
import { MeteringProxy, problem, type BindRequest, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const cell: Omit<CellAttempt, "meter_id"> = { run_id: "dr", arm: "R", task: "t1", model: "opus", trial: 1, attempt: 1 };

class Ledger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: `res_${this.reservations.size + 1}`, ...r, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.reservations.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const FIX_PATCH = [
  "diff --git a/src/pkg/parser.py b/src/pkg/parser.py",
  "--- a/src/pkg/parser.py",
  "+++ b/src/pkg/parser.py",
  "@@ -1,2 +1,2 @@",
  " def parse(x):",
  "-    return x",
  "+    return normalize_whitespace(x)",
].join("\n");
const TEST_PATCH = [
  "diff --git a/tests/test_parser.py b/tests/test_parser.py",
  "--- a/tests/test_parser.py",
  "+++ b/tests/test_parser.py",
  "@@ -1,3 +1,15 @@",
  "-def test_parse_keeps_text():",
  "+def test_parse_keeps_text():",
  "     assert parse(\"a\") == \"a\"",
  "+",
  "+def test_parse_collapses_whitespace():",
  "+    assert parse(\"a  b\") == \"a b\"",
  "+",
  "+async def test_issue_reported_case():",
  "+    pass",
  "+",
  "+def test_parse_keeps():",
  "+    pass",
  "+",
  "+class TestParserRegression:",
  "+    pass",
  "diff --git a/tests/test_hidden_regression_data.py b/tests/test_hidden_regression_data.py",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/tests/test_hidden_regression_data.py",
  "@@ -0,0 +1,2 @@",
  "+def test_short():",
  "+    pass",
].join("\n");
const PRISTINE: Pristine = { files: ["src/pkg/parser.py", "tests/test_parser.py", "tests/conftest.py"], testNames: ["test_parse_keeps_text"] };
const INSTRUCTION = "parse() keeps runs of spaces; see test_issue_reported_case in the report.\n";
const CANARY = "DRCANARY-00112233445566778899aabbccddeeff";

/** A Harbor task dir in the SWE-rebench export layout: the test patch inside tests/test.sh, the fix inside solution/solve.sh. */
function writeTask(dir: string) {
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "solution"), { recursive: true });
  writeFileSync(join(dir, "instruction.md"), INSTRUCTION);
  writeFileSync(join(dir, "tests", "test.sh"), "#!/bin/bash\ncd /testbed\ncat > /tmp/test.patch <<'EOF'\n" + TEST_PATCH + "\nEOF\ngit apply /tmp/test.patch\npytest tests\n");
  writeFileSync(join(dir, "tests", "config.json"), JSON.stringify({ FAIL_TO_PASS: ["tests/test_parser.py::test_parse_collapses_whitespace"], PASS_TO_PASS: ["tests/test_parser.py::test_parse_keeps_text"] }));
  writeFileSync(join(dir, "solution", "solve.sh"), "#!/bin/bash\ncd /testbed\ncat > /tmp/fix.patch <<'EOF'\n" + FIX_PATCH + "\nEOF\ngit apply /tmp/fix.patch\n");
}

describe("runner-only markers (labels/markers.ts)", () => {
  test("new test names and new test-side paths are markers; existing names, short names, public text and the fix are not", () => {
    const dir = tempDir("dr-markers-");
    writeTask(dir);
    const markers = taskMarkers(dir, PRISTINE, CANARY);
    expect(markers).toEqual([CANARY, "TestParserRegression", "test_parse_collapses_whitespace", "tests/test_hidden_regression_data.py"]);
    for (const m of markers) expect(m.length).toBeGreaterThanOrEqual(MIN_MARKER_CHARS);
    for (const m of markers) expect(FIX_PATCH.includes(m)).toBe(false);
  });

  test("a name or path the real fix contains is never a marker", () => {
    const fixSide = FIX_PATCH + "\n+# see test_parse_collapses_whitespace and tests/test_hidden_regression_data.py";
    expect(runnerOnlyMarkers({ testSide: TEST_PATCH, fixSide, publicText: "", pristine: PRISTINE, canary: CANARY })).toEqual([CANARY, "TestParserRegression", "test_issue_reported_case"]);
  });

  test("a new path that exists in the pristine image is not a marker", () => {
    const pristine = { ...PRISTINE, files: [...PRISTINE.files, "tests/test_hidden_regression_data.py"] };
    expect(runnerOnlyMarkers({ testSide: TEST_PATCH, fixSide: FIX_PATCH, publicText: INSTRUCTION, pristine, canary: CANARY })).not.toContain("tests/test_hidden_regression_data.py");
  });

  test("plantCanary writes one random canary per task beside the labels, owner-only, and reuses it", () => {
    const store = tempDir("dr-labels-");
    const a = plantCanary(join(store, "task-a"));
    expect(a).toMatch(/^DRCANARY-[0-9a-f]{32}$/);
    expect(plantCanary(join(store, "task-a"))).toBe(a);
    expect(plantCanary(join(store, "task-b"))).not.toBe(a);
    expect(statSync(join(store, "task-a", "canary.txt")).mode & 0o777).toBe(0o600);
  });

  test("pristineListing reads the files and test names of /testbed from the pristine image, with no network", async () => {
    const calls: string[][] = [];
    const docker = { run: async (args: string[]) => (calls.push(args), { code: 0, stdout: "src/pkg/parser.py\ntests/test_parser.py\n--names--\ndef test_parse_keeps_text\nclass TestOld\n", stderr: "" }) };
    expect(await pristineListing(docker, "img@sha256:ab")).toEqual({ files: ["src/pkg/parser.py", "tests/test_parser.py"], testNames: ["TestOld", "test_parse_keeps_text"] });
    expect(calls[0]).toContain("--network");
    expect(calls[0]).toContain("none");
    const failing = { run: async () => ({ code: 1, stdout: "", stderr: "no such image" }) };
    await expect(pristineListing(failing, "img")).rejects.toThrow(/^DR_LABEL_MISSING: /);
  });
});

function proxyWorld(overrides: Partial<ProxyOptions> = {}) {
  const dir = tempDir("dr-custody-");
  const calls: string[] = [];
  const proxy = new MeteringProxy({
    ledger: new Ledger(),
    leaseId: "dr-pilot-rp.0001.abcdef",
    host: "127.0.0.1",
    managementSocket: join(dir, "m.sock"),
    managementToken: "management-token-0123456789",
    journal: join(dir, "journal.ndjson"),
    retry: { attempts: 3, elapsed_ms: 60_000 },
    env: { ANTHROPIC_API_KEY: "sk-ant-dr-0123456789" },
    maxOutputTokens: 32_000,
    sleep: async () => {},
    fetch: async (url, init) => {
      calls.push(String(init.body ?? ""));
      return Response.json({ id: "msg", usage: { input_tokens: 100, output_tokens: 20 } });
    },
    allowanceCode: "DR_ALLOWANCE_STOP",
    ...overrides,
  });
  proxy.start();
  cleanup.push(() => proxy.stop());
  const bind = (r: Partial<BindRequest> = {}) => proxy.bind({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 5_000_000, ...r });
  const post = (b: { slot: string; token: string }, content: string) =>
    fetch(`http://127.0.0.1:${proxy.port}/${b.slot}/anthropic/v1/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${b.token}` }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content }] }) });
  const journalText = () => readFileSync(join(dir, "journal.ndjson"), "utf8");
  const journal = () => journalText().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { proxy, calls, bind, post, journal, journalText };
}

describe("per-slot leak scan (metering proxy)", () => {
  const MARKERS = [CANARY, "TestParserRegression", "test_parse_collapses_whitespace", "tests/test_hidden_regression_data.py"];

  test("a planted canary in a decider request is refused with DR_CUSTODY_HIT, journalled by index and hash only, and not forwarded", async () => {
    const w = proxyWorld();
    const b = w.bind({ forbidden_markers: MARKERS });
    const res = await w.post(b, "state: the agent ran pytest; label store says " + CANARY);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("DR_CUSTODY_HIT");
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(w.calls).toHaveLength(0);
    const refusal = w.journal().find((l) => l.kind === "refusal");
    expect(refusal).toMatchObject({ kind: "refusal", code: "DR_CUSTODY_HIT", meter_id: b.meter_id, cell: { task: "t1", arm: "R", model: "opus" }, markers: [{ index: 0, sha256: sha(CANARY).slice(0, 12) }] });
    expect(w.journal().some((l) => l.kind === "request")).toBe(false);
    expect(w.journalText()).not.toContain(CANARY);
  });

  test("a hidden new test name is a custody hit at its own index", async () => {
    const w = proxyWorld();
    const b = w.bind({ forbidden_markers: MARKERS });
    expect((await w.post(b, "pytest -k test_parse_collapses_whitespace")).status).toBe(403);
    expect(w.journal().find((l) => l.kind === "refusal")?.markers).toEqual([{ index: 2, sha256: sha(MARKERS[2]!).slice(0, 12) }]);
    expect(w.journalText()).not.toContain(MARKERS[2]!);
  });

  test("an agent diff equal to the real-fix hunk passes", async () => {
    const w = proxyWorld();
    const b = w.bind({ forbidden_markers: MARKERS });
    const res = await w.post(b, "diff so far:\n" + FIX_PATCH);
    expect(res.status).toBe(200);
    expect(w.calls).toHaveLength(1);
  });

  test("an existing test name passes", async () => {
    const w = proxyWorld();
    const b = w.bind({ forbidden_markers: MARKERS });
    expect((await w.post(b, "FAILED tests/test_parser.py::test_parse_keeps_text")).status).toBe(200);
    expect(w.calls).toHaveLength(1);
  });

  test("a marker on slot A does not affect slot B", async () => {
    const w = proxyWorld();
    const a = w.bind({ forbidden_markers: MARKERS });
    const b = w.bind();
    const c = w.bind({ forbidden_markers: ["DRCANARY-ffffffffffffffffffffffffffffffff"] });
    expect((await w.post(b, "context " + CANARY)).status).toBe(200);
    expect((await w.post(c, "context " + CANARY)).status).toBe(200);
    expect((await w.post(a, "context " + CANARY)).status).toBe(403);
    expect(w.calls).toHaveLength(2);
  });

  test("a proxy-wide marker on a decision-routing proxy keeps today's E_TRIPWIRE", async () => {
    const w = proxyWorld({ forbiddenMarkers: ["proxy-wide-hidden-fact"] });
    const b = w.bind({ forbidden_markers: MARKERS });
    expect((await w.post(b, "proxy-wide-hidden-fact " + CANARY)).status).toBe(403);
    expect(w.journal().find((l) => l.kind === "refusal")).toMatchObject({ code: "E_TRIPWIRE" });
    expect(w.journal().find((l) => l.kind === "refusal")?.markers).toBeUndefined();
  });

  test("default lanes keep E_TRIPWIRE and its bytes, for proxy-wide and slot markers", async () => {
    const w = proxyWorld({ allowanceCode: undefined, forbiddenMarkers: ["proxy-wide-hidden-fact"] });
    const b = w.bind({ forbidden_markers: [CANARY] });
    for (const content of ["proxy-wide-hidden-fact", CANARY]) {
      const res = await w.post(b, content);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(await problem("E_TRIPWIRE", 403, "the request carries 1 forbidden marker(s); the cell is invalid").text());
    }
    const refusals = w.journal().filter((l) => l.kind === "refusal");
    expect(refusals.map((l) => l.code)).toEqual(["E_TRIPWIRE", "E_TRIPWIRE"]);
    for (const l of refusals) {
      expect(l.markers).toBeUndefined();
      expect(l.cell).toBeUndefined();
    }
    expect(w.calls).toHaveLength(0);
  });

  test("bind refuses forbidden_markers that are not a list of non-empty strings", () => {
    const w = proxyWorld();
    for (const bad of ["x", [""], [3], [CANARY, null]]) expect(() => w.bind({ forbidden_markers: bad as never })).toThrow(/^E_USAGE: /);
  });
});

const FAKE_HARBOR = `import { readFileSync } from "node:fs";
const env = process.env;
const job = JSON.parse(readFileSync(process.argv[process.argv.indexOf("-c") + 1], "utf8"));
const kw = job.agents[0].kwargs;
const task = job.tasks[0].path.split("/").pop();
const markers = JSON.parse(readFileSync(kw.markers_file, "utf8"));
const mgmt = (path, body) => fetch("http://localhost" + path, { unix: env.DR_MGMT_SOCKET, method: "POST", headers: { "content-type": "application/json", "x-gstack-evals-management": env.DR_MGMT_TOKEN }, body: JSON.stringify(body) }).then((r) => r.json());
const b = await mgmt("/bind", { cell: { run_id: "dr-test", arm: kw.cell, task, model: kw.model, trial: 1, attempt: 1 }, models: ["anthropic:claude-opus-5-5"], allowance_micros: 5000000, forbidden_markers: markers });
const content = env.DR_TEST_LEAK_TASK === task ? "decider state: " + markers[0] : "decider state: " + env.DR_TEST_FIX;
await fetch(env.DR_PROXY_BASE + "/" + b.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": b.token }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content }] }) });
await mgmt("/unbind", { slot: b.slot });
await mgmt("/finalize", { meter_id: b.meter_id });
`;

function batchWorld(tasks: number) {
  const dir = tempDir("dr-custody-host-");
  writeFileSync(join(dir, "fake-harbor.ts"), FAKE_HARBOR);
  writeFileSync(join(dir, "runtime.tgz"), "runtime");
  writeFileSync(join(dir, "pin.json"), "{}");
  writeFileSync(join(dir, "items.json"), JSON.stringify({ items: [{ item: "dr-pilot-rp", cap_micros: 70_000_000 }] }));
  mkdirSync(join(dir, "pristine"));
  for (let i = 0; i < tasks; i++) {
    writeTask(join(dir, "tasks", "task-" + i));
    writeFileSync(join(dir, "pristine", "task-" + i + ".json"), JSON.stringify(PRISTINE));
  }
  const sent: string[] = [];
  const logs: string[] = [];
  const rows: PlanRow[] = Array.from({ length: tasks }, (_, i) => ({ task: "task-" + i, cell: "R", model: "opus", item: "dr-pilot-rp" }));
  const opts = (env: Record<string, string> = {}, extra: Partial<BatchOptions> = {}): BatchOptions => ({
    plan: rows,
    out: join(dir, "out"),
    runId: "dr-custody-run",
    temp: true,
    items: join(dir, "items.json"),
    harbor: [process.execPath, join(dir, "fake-harbor.ts")],
    tasksDir: join(dir, "tasks"),
    proxyHost: "127.0.0.1",
    runtimeTarball: join(dir, "runtime.tgz"),
    runtimeSha256: sha("runtime"),
    pinFile: join(dir, "pin.json"),
    pinSha256: sha("{}"),
    custody: { pristineDir: join(dir, "pristine"), labelStore: join(dir, "labels") },
    concurrency: 1,
    pollMs: 20,
    log: (l) => logs.push(l),
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ANTHROPIC_API_KEY: "sk-ant-fake-0123456789", DR_TEST_FIX: FIX_PATCH, ...env },
    fetch: async (_url, init) => {
      sent.push(String(init.body ?? ""));
      return Response.json({ id: "msg", usage: { input_tokens: 100, output_tokens: 20 } });
    },
    ...extra,
  });
  return { dir, rows, opts, sent, logs };
}

describe("controller custody stop", () => {
  test("each session's bind carries its task's markers through markers_file; real-fix diffs run to the end", async () => {
    const w = batchWorld(2);
    const result = await runBatch(w.opts());
    expect(result.stop).toBeNull();
    expect(result.launched).toHaveLength(2);
    expect(w.sent).toHaveLength(2);
    for (const row of w.rows) {
      const job = JSON.parse(readFileSync(join(w.dir, "out", "jobs", sessionId(row) + ".json"), "utf8"));
      const file = job.agents[0].kwargs.markers_file as string;
      expect(file).toBe(join(w.dir, "out", "markers", sessionId(row) + ".json"));
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const canary = readFileSync(join(w.dir, "labels", row.task, "canary.txt"), "utf8").trim();
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([canary, "TestParserRegression", "test_parse_collapses_whitespace", "tests/test_hidden_regression_data.py"]);
    }
  });

  test("a planted canary stops the batch with DR_CUSTODY_HIT: no new launches, leases settled, session and marker index logged", async () => {
    const w = batchWorld(3);
    const first = seededShuffle(w.rows)[0]!;
    const result = await runBatch(w.opts({ DR_TEST_LEAK_TASK: first.task }));
    expect(result.exit).toBe(2);
    expect(result.stop?.code).toBe("DR_CUSTODY_HIT");
    expect(result.stop?.message).toContain(sessionId(first));
    expect(result.stop?.message).toContain("marker 0");
    expect(result.launched).toEqual([sessionId(first)]);
    expect(result.not_launched).toHaveLength(2);
    expect(w.sent).toHaveLength(0);
    expect(result.leases).toHaveLength(1);
    expect(result.warnings.filter((x) => x.startsWith("E_LEASE_UNSETTLED"))).toEqual([]);
    expect(w.logs.some((l) => l.startsWith("DR_CUSTODY_HIT: ") && l.includes(sessionId(first)) && l.includes("marker 0"))).toBe(true);
    const canary = readFileSync(join(w.dir, "labels", first.task, "canary.txt"), "utf8").trim();
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(w.logs.join("\n")).not.toContain(canary);
  });

  test("a task with no pristine listing is refused before any lease opens", async () => {
    const w = batchWorld(1);
    rmSync(join(w.dir, "pristine", "task-0.json"));
    await expect(runBatch(w.opts())).rejects.toThrow(/^E_USAGE: .*pristine/);
    expect(existsSync(join(w.dir, "out", "jobs", sessionId(w.rows[0]!) + ".json"))).toBe(false);
  });
});
