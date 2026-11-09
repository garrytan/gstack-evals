// Copyright (c) 2026 Garry Tan. MIT License.
// The host answering step (lanes/decision-routing/host/answer.ts), keyless: a temporary ledger, fake upstreams and a
// stub runtime python. It runs the controller's reserve check, opens one lease, binds one decider-only slot per session
// with the session's markers and canary, runs the child with only the proxy URL and token, settles and writes answer.json.

import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readItem } from "../../src/runner/ledger/record.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_SESSIONS_IN_FLIGHT, MODES, OneSession, main, pseudoSession, runAnswer, type AnswerOptions } from "../../lanes/decision-routing/host/answer.ts";
import { SAFETY_SET_PATH } from "../../lanes/decision-routing/labels/safety-set.ts";
import { ControllerError, fakeFetch, reserveMicros } from "../../lanes/decision-routing/host/controller.ts";
import { FakeUpstreams } from "../../lanes/decision-routing/fake/upstreams.ts";

const CANARY = "DRCANARY-" + "ab".repeat(16);
const PSEUDO_SESSION = "constructed-held";
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
  'if (existsSync(dir + "/fail")) process.exit(3);',
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
  writeFileSync(join(dir, "items.json"), JSON.stringify({ items: [{ item: "dr-calibration-r2", cap_micros: capMicros }] }));
  writeFileSync(join(dir, "questions.json"), "{}");
  const list = Array.from({ length: sessions }, (_, i) => {
    const log_dir = join(dir, "trials", "s" + i, "agent", "dr");
    mkdirSync(log_dir, { recursive: true });
    const markers_file = join(dir, "s" + i + ".markers.json");
    writeFileSync(markers_file, JSON.stringify(["tests/test_hidden_case.py", CANARY]));
    return { session: "task-" + i + "__N__opus", log_dir, markers_file };
  });
  const opts: AnswerOptions = {
    item: "dr-calibration-r2",
    runId: "dr-calibration-r2@0123456789ab",
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
  expect(MODES.shadow).toEqual({ module: "dr_agent.shadow", deciders: ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"], args: [], pseudo: null });
});

test("the replay modes allow only their own deciders and run their own modules", () => {
  expect(MODES.jev_newer).toEqual({ module: "dr_agent.jev_newer", deciders: ["typesafe:jev-1.14.0"], args: [], pseudo: null });
  expect(MODES.safety_held).toEqual({ module: "dr_agent.safety_set", deciders: ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"], args: ["--safety-set", SAFETY_SET_PATH, "--half", "held"], pseudo: "constructed-held" });
  expect(MODES.safety_calibration).toEqual({ module: "dr_agent.safety_set", deciders: ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"], args: ["--safety-set", SAFETY_SET_PATH, "--half", "calibration"], pseudo: "constructed-calibration" });
  expect(MODES.guess_ablation).toEqual({ module: "dr_agent.guess_ablation", deciders: ["openrouter:particle-ai/particle-1"], args: [], pseudo: null });
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
  const ps = pseudoSession(join(dir, "pseudo"), PSEUDO_SESSION);
  expect(ps.session).toBe(PSEUDO_SESSION);
  const canary = readFileSync(join(dir, "pseudo", "canary.txt"), "utf8").trim();
  expect(canary).toMatch(/^DRCANARY-[0-9a-f]{32}$/);
  expect(JSON.parse(readFileSync(ps.markers_file, "utf8"))).toEqual([canary]);
  expect(statSync(join(dir, "pseudo", "canary.txt")).mode & 0o777).toBe(0o600);
  expect(pseudoSession(join(dir, "pseudo"), PSEUDO_SESSION)).toEqual(ps);
  const r = await runAnswer({ ...opts, mode: "safety_held", sessions: [ps] });
  expect(r.stop).toBeNull();
  expect(r.answered).toEqual([PSEUDO_SESSION]);
  const child = JSON.parse(readFileSync(join(opts.out, "answers", PSEUDO_SESSION + ".safety_held.jsonl"), "utf8"));
  expect(child.argv.slice(0, 5)).toEqual(["-I", "-m", "dr_agent.safety_set", "--log-dir", ps.log_dir]);
  expect(child.argv.slice(-4)).toEqual(["--safety-set", SAFETY_SET_PATH, "--half", "held"]);
  expect([child.jev, child.particle]).toEqual([200, 200]);

  const planted = pseudoSession(join(dir, "pseudo2"), PSEUDO_SESSION);
  mkdirSync(planted.log_dir, { recursive: true });
  writeFileSync(join(planted.log_dir, "plant"), JSON.parse(readFileSync(planted.markers_file, "utf8"))[0]);
  const hit = await runAnswer({ ...opts, mode: "safety_held", sessions: [planted], out: join(dir, "out2"), fetch: fakeFetch(fakes!.urls) });
  expect(hit.stop?.code).toBe("DR_CUSTODY_HIT");
});

test("the safety modes' command line builds the mode's pseudo-session under --out when --sessions is left out", async () => {
  const { dir, opts } = world(0);
  writeFileSync(join(dir, "urls.json"), JSON.stringify(fakes!.urls));
  for (const [mode, session] of [["safety_held", "constructed-held"], ["safety_calibration", "constructed-calibration"]] as const) {
    const out = join(dir, mode);
    const code = await main(["--item", opts.item, "--run-id", opts.runId, "--mode", mode, "--out", out, "--questions", opts.questions, "--python", opts.python!.join(" "), "--temp", "--fake-upstreams", join(dir, "urls.json"), "--items", opts.items!]);
    expect(code).toBe(0);
    const saved = JSON.parse(readFileSync(join(out, "answer.json"), "utf8"));
    expect(saved.answered).toEqual([session]);
    expect(JSON.parse(readFileSync(join(out, session, "markers.json"), "utf8"))).toHaveLength(1);
    const child = JSON.parse(readFileSync(join(out, "answers", session + "." + mode + ".jsonl"), "utf8"));
    expect(child.argv.slice(3, 5)).toEqual(["--log-dir", join(out, session, "log")]);
  }
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

test("an answering lease reserves one session at the allowance: a cap just under it is refused before any lease or child, just over it answers", async () => {
  expect(ANSWER_SESSIONS_IN_FLIGHT).toBe(1);
  const one = reserveMicros(1);
  expect(one).toBe(5_000_000);
  const under = world(1, one - 1);
  await expect(runAnswer(under.opts)).rejects.toThrow("reserve for 1 session in flight");
  expect(existsSync(join(under.opts.out, "answers"))).toBe(false);
  expect(existsSync(join(under.opts.out, "answer.json"))).toBe(false);
  fakes?.stop();
  const over = world(1, one + 1_000_000);
  const r = await runAnswer(over.opts);
  expect(r.stop).toBeNull();
  expect(r.answered).toEqual([over.list[0]!.session]);
});

test("one answering session in flight per lease: a second start while one runs is refused with DR_ANSWER_CONCURRENCY, and starts after an end", () => {
  const slot = new OneSession();
  slot.start("a");
  let err: unknown = null;
  try {
    slot.start("b");
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ControllerError);
  expect((err as ControllerError).code).toBe("DR_ANSWER_CONCURRENCY");
  expect((err as Error).message).toContain("a is still in flight");
  slot.end();
  slot.start("b");
  slot.end();
});

test("the step's sessions never overlap in time", async () => {
  const { opts } = world(3);
  await runAnswer(opts);
  const rows = JSON.parse(readFileSync(join(opts.out, "answer.json"), "utf8")).sessions as Array<{ started: string; ended: string }>;
  expect(rows).toHaveLength(3);
  for (let i = 1; i < rows.length; i++) expect(Date.parse(rows[i]!.started)).toBeGreaterThanOrEqual(Date.parse(rows[i - 1]!.ended));
});

const REAL_RECORD = process.env.DR_REAL_RECORD ?? "";

const HAS_REAL_RECORD = !!REAL_RECORD && existsSync(join(REAL_RECORD, "items", "dr-calibration-r2"));

test("answering on the closed dr-calibration item is refused with DR_ITEM_CLOSED before anything is written or leased", async () => {
  const { dir, opts } = world(1);
  const err = await runAnswer({ ...opts, item: "dr-calibration", runId: "dr-calibration@0123456789ab", items: join(import.meta.dir, "../../lanes/decision-routing/config/items.json") }).then(() => null, (e) => e);
  expect((err as Error).message).toStartWith("DR_ITEM_CLOSED: line item dr-calibration is closed");
  expect(existsSync(join(dir, "out"))).toBe(false);
});

test.skipIf(!HAS_REAL_RECORD)("a stop file that appears while the step waits for the drive's confirmation ends the wait at once: nothing answered, the lease settles at zero", async () => {
  const { dir, opts, list } = world(1);
  const record = join(dir, "record");
  cpSync(REAL_RECORD, record, { recursive: true });
  const real = { ...opts, temp: false, record, ledger: join(dir, "ledger.sqlite"), leaseConfirmMs: 30_000 };
  const timer = setInterval(() => {
    if (!readItem(record, "dr-calibration-r2").open) return;
    writeFileSync(join(opts.out, "STOP"), "operator stop\n");
  }, 10);
  const t0 = Date.now();
  try {
    await expect(runAnswer(real)).rejects.toThrow("DR_LEASE_UNRECORDED");
  } finally {
    clearInterval(timer);
  }
  expect(Date.now() - t0).toBeLessThan(15_000);
  expect(existsSync(join(opts.out, "answers", list[0]!.session + ".shadow.jsonl"))).toBe(false);
  expect(readItem(record, "dr-calibration-r2").leases.at(-1)!.close?.spent_micros).toBe(0);
}, 60_000);

test.skipIf(!HAS_REAL_RECORD)("on a real record nothing is answered until the drive is confirmed to hold the lease (DR_LEASE_UNRECORDED), and answering runs once it is", async () => {
  for (const confirm of [false, true]) {
    const { dir, opts, list } = world(1);
    const record = join(dir, "record");
    cpSync(REAL_RECORD, record, { recursive: true });
    const real = { ...opts, temp: false, record, ledger: join(dir, "ledger.sqlite"), leaseConfirmMs: 1500 };
    const timer = confirm
      ? setInterval(() => {
          const open = readItem(record, "dr-calibration-r2").open;
          if (!open) return;
          mkdirSync(opts.out, { recursive: true });
          writeFileSync(join(opts.out, "lease-confirmed.json"), JSON.stringify({ leases: [open.lease_id] }));
        }, 10)
      : null;
    try {
      if (!confirm) {
        await expect(runAnswer(real)).rejects.toThrow("DR_LEASE_UNRECORDED");
        expect(existsSync(join(opts.out, "answers", list[0]!.session + ".shadow.jsonl"))).toBe(false);
        expect(readItem(record, "dr-calibration-r2").leases.at(-1)!.close?.spent_micros).toBe(0);
      } else {
        expect((await runAnswer(real)).answered).toEqual([list[0]!.session]);
      }
    } finally {
      if (timer) clearInterval(timer);
      fakes?.stop();
    }
  }
}, 60_000);

test("a mode name off the MODES table, a prototype key included, is refused before any lease", async () => {
  const { opts } = world(1);
  for (const mode of ["constructor", "toString", "nope"]) await expect(runAnswer({ ...opts, mode: mode as any })).rejects.toThrow("unknown answering mode");
  expect(existsSync(join(opts.out, "answer.json"))).toBe(false);
});

test("a second mode on an out dir that holds another mode's sessions is refused before any lease", async () => {
  const { opts } = world(1);
  await runAnswer(opts);
  const lease = JSON.parse(readFileSync(join(opts.out, "answer.json"), "utf8")).lease.lease_id;
  await expect(runAnswer({ ...opts, mode: "jev_newer", fetch: fakeFetch(fakes!.urls) })).rejects.toThrow("holds shadow answers");
  expect(JSON.parse(readFileSync(join(opts.out, "answer.json"), "utf8")).lease.lease_id).toBe(lease);
  expect(existsSync(join(opts.out, "answers", opts.sessions[0]!.session + ".jev_newer.jsonl"))).toBe(false);
});

test("a child that exits non-zero counts as failed, not answered, is never started again, and the command line exits 2", async () => {
  const { dir, opts, list } = world(2);
  writeFileSync(join(list[0]!.log_dir, "fail"), "");
  const r = await runAnswer(opts);
  expect(r.failed).toEqual([list[0]!.session]);
  expect(r.answered).toEqual([list[1]!.session]);
  expect(JSON.parse(readFileSync(join(opts.out, "answer.json"), "utf8")).failed).toEqual([list[0]!.session]);
  const again = await runAnswer({ ...opts, fetch: fakeFetch(fakes!.urls) });
  expect(again.failed).toEqual([list[0]!.session]);
  expect(again.skipped).toEqual([list[1]!.session]);
  expect(JSON.parse(readFileSync(join(opts.out, "answer.json"), "utf8")).failed).toEqual([list[0]!.session]);
  writeFileSync(join(dir, "urls.json"), JSON.stringify(fakes!.urls));
  writeFileSync(join(dir, "sessions.json"), JSON.stringify(list));
  const args = ["--item", opts.item, "--run-id", opts.runId, "--mode", "shadow", "--sessions", join(dir, "sessions.json"), "--questions", opts.questions, "--python", opts.python!.join(" "), "--temp", "--fake-upstreams", join(dir, "urls.json"), "--items", opts.items!];
  expect(await main([...args, "--out", join(dir, "cli-fail")])).toBe(2);
  rmSync(join(list[0]!.log_dir, "fail"));
  expect(await main([...args, "--out", join(dir, "cli-fail")])).toBe(2);
  expect(JSON.parse(readFileSync(join(dir, "cli-fail", "answer.json"), "utf8")).failed).toEqual([list[0]!.session]);
  expect(await main([...args, "--out", join(dir, "cli-ok")])).toBe(0);
});

test("on a relaunch a session whose record has no exit code (a crash mid-session) counts as failed and is never started again", async () => {
  const { opts, list } = world(2);
  mkdirSync(join(opts.out, "answers"), { recursive: true });
  writeFileSync(join(opts.out, "answers", list[0]!.session + ".json"), JSON.stringify({ session: list[0]!.session, mode: "shadow", started: "2026-11-09T00:00:00.000Z" }) + "\n");
  const r = await runAnswer(opts);
  expect(r.failed).toEqual([list[0]!.session]);
  expect(r.answered).toEqual([list[1]!.session]);
  expect(existsSync(join(opts.out, "answers", list[0]!.session + ".shadow.jsonl"))).toBe(false);
});

test("a session record in the out dir that is not readable JSON is refused with E_USAGE naming it, before any lease", async () => {
  const { opts, list } = world(1);
  mkdirSync(join(opts.out, "answers"), { recursive: true });
  const meta = join(opts.out, "answers", list[0]!.session + ".json");
  writeFileSync(meta, '{"session": "' + list[0]!.session + '", "mo');
  const e = await runAnswer(opts).catch((x) => x);
  expect(e).toBeInstanceOf(ControllerError);
  expect((e as ControllerError).code).toBe("E_USAGE");
  expect((e as Error).message).toContain(meta);
  expect(existsSync(join(opts.out, "answer.json"))).toBe(false);
});
