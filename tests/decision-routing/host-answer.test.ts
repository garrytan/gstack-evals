// Copyright (c) 2026 Garry Tan. MIT License.
// The host answering step (lanes/decision-routing/host/answer.ts), keyless: a temporary ledger, fake upstreams and a
// stub runtime python. It runs the controller's reserve check, opens one lease, binds one decider-only slot per session
// with the session's markers and canary, runs the child with only the proxy URL and token, settles and writes answer.json.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODES, runAnswer, type AnswerOptions } from "../../lanes/decision-routing/host/answer.ts";
import { fakeFetch } from "../../lanes/decision-routing/host/controller.ts";
import { FakeUpstreams } from "../../lanes/decision-routing/fake/upstreams.ts";

const CANARY = "DRCANARY-" + "ab".repeat(16);
const STUB = [
  'import { existsSync, writeFileSync } from "node:fs";',
  "const a = process.argv.slice(2);",
  "const flag = (n) => a[a.indexOf(n) + 1];",
  "const url = process.env.DR_PROXY_URL, token = process.env.DR_PROXY_TOKEN;",
  'const plant = existsSync(flag("--log-dir") + "/plant");',
  'const post = (path, body) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) }).then((r) => r.status);',
  'const jev = await post("/typesafe/v1/systemone", { model: "jev-1.13.0", state: plant ? "the agent read ' + CANARY + '" : "the agent ran pytest", questions: { tests_passed: { type: "noul", instructions: "Did the tests pass?" } } });',
  'const particle = await post("/openrouter/v1/chat/completions", { model: "particle-ai/particle-1", max_tokens: 100, messages: [{ role: "user", content: "answer" }] });',
  'const opus = await post("/anthropic/v1/messages", { model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] });',
  'writeFileSync(flag("--out"), JSON.stringify({ argv: a, env: Object.keys(process.env).sort(), jev, particle, opus }) + "\\n");',
].join("\n");

let dirs: string[] = [];
let fakes: FakeUpstreams | null = null;
afterEach(() => {
  fakes?.stop();
  fakes = null;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function world(sessions = 2, capMicros = 90_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "dr-answer-"));
  dirs.push(dir);
  fakes = FakeUpstreams.start();
  writeFileSync(join(dir, "stub.ts"), STUB);
  writeFileSync(join(dir, "items.json"), JSON.stringify({ items: [{ item: "dr-calibration", cap_micros: capMicros }] }));
  writeFileSync(join(dir, "questions.json"), "{}");
  const list = Array.from({ length: sessions }, (_, i) => {
    const log_dir = join(dir, "trials", "s" + i, "agent", "dr");
    mkdirSync(log_dir, { recursive: true });
    const markers_file = join(dir, "s" + i + ".markers.json");
    writeFileSync(markers_file, JSON.stringify(["tests/test_hidden_case.py", CANARY]));
    return { session: "task-" + i + "__N__opus", log_dir, markers_file };
  });
  const opts: AnswerOptions = {
    item: "dr-calibration",
    runId: "dr-calibration@0123456789ab",
    mode: "shadow",
    sessions: list,
    out: join(dir, "out"),
    questions: join(dir, "questions.json"),
    python: [process.execPath, join(dir, "stub.ts")],
    temp: true,
    items: join(dir, "items.json"),
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: "test-not-a-key", TYPESAFE_API_KEY: "test-not-a-key", OPENROUTER_API_KEY: "test-not-a-key" },
    fetch: fakeFetch(fakes.urls),
    log: () => {},
  };
  return { dir, opts, list };
}

test("shadow mode allows Jev 1.13.0 and particle-1 only", () => {
  expect(MODES.shadow.deciders).toEqual(["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"]);
});

test("one lease, one decider-only slot per session, the child sees only the proxy URL and token, the lease settles", async () => {
  const { opts, list } = world();
  const r = await runAnswer(opts);
  expect(r.stop).toBeNull();
  expect(r.answered).toEqual(list.map((s) => s.session));
  expect(r.lease!.spent_micros).toBeGreaterThan(0);
  for (const s of list) {
    const child = JSON.parse(readFileSync(join(opts.out, "answers", s.session + ".shadow.jsonl"), "utf8"));
    expect(child.argv.slice(0, 5)).toEqual(["-I", "-m", "dr_agent.shadow", "--log-dir", s.log_dir]);
    expect(child.env.filter((k: string) => /^DR_|_API_KEY$/.test(k))).toEqual(["DR_PROXY_TOKEN", "DR_PROXY_URL"]);
    expect([child.jev, child.particle, child.opus]).toEqual([200, 200, 403]);
  }
  expect(fakes!.requests.filter((q) => q.provider === "anthropic")).toEqual([]);
  const saved = JSON.parse(readFileSync(join(opts.out, "answer.json"), "utf8"));
  expect(saved.sessions.map((s: any) => s.exit_code)).toEqual([0, 0]);
  expect(saved.lease.lease_id).toBe(r.lease!.lease_id);
  const again = await runAnswer({ ...opts, fetch: fakeFetch(fakes!.urls) });
  expect(again.skipped).toEqual(list.map((s) => s.session));
  expect(again.answered).toEqual([]);
});

test("a planted canary in a decider request stops the step with DR_CUSTODY_HIT and writes the stop file", async () => {
  const { opts, list } = world(3);
  writeFileSync(join(list[0]!.log_dir, "plant"), "");
  const r = await runAnswer(opts);
  expect(r.stop?.code).toBe("DR_CUSTODY_HIT");
  expect(r.stop?.message).not.toContain(CANARY);
  expect(r.answered).toEqual([list[0]!.session]);
  expect(r.not_run).toEqual([list[1]!.session, list[2]!.session]);
  expect(readFileSync(join(opts.out, "STOP"), "utf8")).toStartWith("DR_CUSTODY_HIT");
  expect(r.lease!.lease_id).toBeTruthy();
  await expect(runAnswer({ ...opts, fetch: fakeFetch(fakes!.urls) })).rejects.toThrow("E_DR_STOPPED");
});

test("a cap under the controller's reserve is refused before any lease or child", async () => {
  const { opts } = world(1, 10_000_000);
  await expect(runAnswer(opts)).rejects.toThrow("DR_RESERVE_STOP");
  expect(existsSync(join(opts.out, "answers"))).toBe(false);
  expect(existsSync(join(opts.out, "answer.json"))).toBe(false);
});
