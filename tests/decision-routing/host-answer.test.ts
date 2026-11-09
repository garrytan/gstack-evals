// Copyright (c) 2026 Garry Tan. MIT License.
// The host answering step (lanes/decision-routing/host/answer.ts), keyless: a temporary ledger, fake upstreams and a
// stub runtime python. It runs the controller's reserve check, opens one lease, binds one decider-only slot per session
// with the session's markers and canary, runs the child with only the proxy URL and token, settles and writes answer.json.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODES, PSEUDO_SESSION, main, pseudoSession, runAnswer, type AnswerOptions } from "../../lanes/decision-routing/host/answer.ts";
import { SAFETY_SET_PATH } from "../../lanes/decision-routing/labels/safety-set.ts";
import { fakeFetch } from "../../lanes/decision-routing/host/controller.ts";
import { FakeUpstreams } from "../../lanes/decision-routing/fake/upstreams.ts";

const CANARY = "DRCANARY-" + "ab".repeat(16);
const STUB = [
  'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  "const a = process.argv.slice(2);",
  "const flag = (n) => a[a.indexOf(n) + 1];",
  "const url = process.env.DR_PROXY_URL, token = process.env.DR_PROXY_TOKEN;",
  'const dir = flag("--log-dir");',
  'mkdirSync(dir, { recursive: true });',
  'const plant = existsSync(dir + "/plant") ? readFileSync(dir + "/plant", "utf8").trim() || "' + CANARY + '" : null;',
  'const jevModel = existsSync(dir + "/jev-model") ? readFileSync(dir + "/jev-model", "utf8").trim() : "jev-1.13.0";',
  'const post = (path, body) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) }).then((r) => r.status);',
  'const jev = await post("/typesafe/v1/systemone", { model: jevModel, state: plant ? "the agent read " + plant : "the agent ran pytest", questions: { tests_passed: { type: "noul", instructions: "Did the tests pass?" } } });',
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
  expect(MODES.shadow).toEqual({ module: "dr_agent.shadow", deciders: ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"], args: [], pseudo: false });
});

test("the replay modes allow only their own deciders and run their own modules", () => {
  expect(MODES.jev_newer).toEqual({ module: "dr_agent.jev_newer", deciders: ["typesafe:jev-1.14.0"], args: [], pseudo: false });
  expect(MODES.safety_held).toEqual({ module: "dr_agent.safety_held", deciders: ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"], args: ["--safety-set", SAFETY_SET_PATH], pseudo: true });
  expect(MODES.guess_ablation).toEqual({ module: "dr_agent.guess_ablation", deciders: ["openrouter:particle-ai/particle-1"], args: [], pseudo: false });
});

test("jev_newer's slot takes Jev 1.14.0 only, guess_ablation's particle-1 only", async () => {
  for (const [mode, jevModel, want] of [["jev_newer", "jev-1.14.0", [200, 403]], ["jev_newer", "jev-1.13.0", [403, 403]], ["guess_ablation", "jev-1.13.0", [403, 200]]] as const) {
    const { opts, list } = world(1);
    writeFileSync(join(list[0]!.log_dir, "jev-model"), jevModel);
    const r = await runAnswer({ ...opts, mode });
    expect(r.stop).toBeNull();
    const child = JSON.parse(readFileSync(join(opts.out, "answers", list[0]!.session + "." + mode + ".jsonl"), "utf8"));
    expect(child.argv.slice(0, 5)).toEqual(["-I", "-m", MODES[mode].module, "--log-dir", list[0]!.log_dir]);
    expect([child.jev, child.particle, child.opus]).toEqual([...want, 403]);
    fakes!.stop();
    fakes = null;
  }
});

test("safety_held answers the held half as one pseudo-session whose planted canary the slot forbids", async () => {
  const { dir, opts } = world(0);
  const ps = pseudoSession(join(dir, "pseudo"));
  expect(ps.session).toBe(PSEUDO_SESSION);
  const canary = readFileSync(join(dir, "pseudo", "canary.txt"), "utf8").trim();
  expect(canary).toMatch(/^DRCANARY-[0-9a-f]{32}$/);
  expect(JSON.parse(readFileSync(ps.markers_file, "utf8"))).toEqual([canary]);
  expect(statSync(join(dir, "pseudo", "canary.txt")).mode & 0o777).toBe(0o600);
  expect(pseudoSession(join(dir, "pseudo"))).toEqual(ps);
  const r = await runAnswer({ ...opts, mode: "safety_held", sessions: [ps] });
  expect(r.stop).toBeNull();
  expect(r.answered).toEqual([PSEUDO_SESSION]);
  const child = JSON.parse(readFileSync(join(opts.out, "answers", PSEUDO_SESSION + ".safety_held.jsonl"), "utf8"));
  expect(child.argv.slice(0, 5)).toEqual(["-I", "-m", "dr_agent.safety_held", "--log-dir", ps.log_dir]);
  expect(child.argv.slice(-2)).toEqual(["--safety-set", SAFETY_SET_PATH]);
  expect([child.jev, child.particle]).toEqual([200, 200]);

  const planted = pseudoSession(join(dir, "pseudo2"));
  mkdirSync(planted.log_dir, { recursive: true });
  writeFileSync(join(planted.log_dir, "plant"), JSON.parse(readFileSync(planted.markers_file, "utf8"))[0]);
  const hit = await runAnswer({ ...opts, mode: "safety_held", sessions: [planted], out: join(dir, "out2"), fetch: fakeFetch(fakes!.urls) });
  expect(hit.stop?.code).toBe("DR_CUSTODY_HIT");
});

test("the safety_held command line builds its pseudo-session under --out when --sessions is left out", async () => {
  const { dir, opts } = world(0);
  writeFileSync(join(dir, "urls.json"), JSON.stringify(fakes!.urls));
  const out = join(dir, "cli-out");
  const code = await main(["--item", opts.item, "--run-id", opts.runId, "--mode", "safety_held", "--out", out, "--questions", opts.questions, "--python", opts.python!.join(" "), "--temp", "--fake-upstreams", join(dir, "urls.json"), "--items", opts.items!]);
  expect(code).toBe(0);
  const saved = JSON.parse(readFileSync(join(out, "answer.json"), "utf8"));
  expect(saved.answered).toEqual([PSEUDO_SESSION]);
  expect(JSON.parse(readFileSync(join(out, PSEUDO_SESSION, "markers.json"), "utf8"))).toHaveLength(1);
  expect(await main(["--item", opts.item, "--run-id", opts.runId, "--mode", "jev_newer", "--out", join(dir, "x"), "--questions", opts.questions])).toBe(2);
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
