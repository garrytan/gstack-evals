import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";
import { cellKey, ITEMS, plannedCells, sha256, trialTasksFrom } from "../l1/l1.ts";

// l1.ts end to end on a fake awake host. fixtures/l1/ubi plays ubi-runner: each VM is a directory under UBI_FAKE, and ssh
// runs a command in it with HOME set to it, so the host runs the real host.sh, launch.sh and ledger service. fixtures/l1/ssh
// is launch.sh's tunnel session, and fake-vm-run.ts plays vm-run.sh on the part VM: its trials reserve and settle through
// the host's ledger service. fake-prepare-run.ts stands in for prepare-run (no task materialization). The keys are fakes.
const LANEB = resolve(import.meta.dir, "..");
const FIX = join(import.meta.dir, "fixtures/l1");
const L1TS = join(LANEB, "l1/l1.ts");
const tb2Text = () => Array.from({ length: 37 }, (_, i) => (i < 19 ? "1" : "2") + " tb2-task-" + String(i).padStart(2, "0")).join("\n") + "\n";

function freePort() {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = s.port;
  s.stop(true);
  return port;
}

type Rig = { root: string; fake: string; work: string; ledger: string; env: Record<string, string> };
const rigs: Rig[] = [];
function rig(item: string, o: { cap?: number; preReserve?: number } = {}): Rig {
  const root = mkdtempSync(join(tmpdir(), "l1-host-"));
  const fake = join(root, "vms"), recovery = join(root, "recovery"), state = join(root, "agent-state"), arms = join(root, "arms");
  for (const d of [fake, recovery, state, arms, join(root, "ledgers")]) mkdirSync(d, { recursive: true });
  const ledger = join(root, "ledgers", item + ".jsonl");
  const l = new Ledger(ledger, item);
  l.approve(o.cap ?? ITEMS[item]!.capUsd, { quotes: ["test approval"] });
  if (o.preReserve) l.reserve("host-9", toMicros(o.preReserve));
  const tb2 = join(root, "tb2-parts.txt");
  writeFileSync(tb2, tb2Text());
  const env: Record<string, string> = {
    PATH: FIX + ":" + process.env.PATH, HOME: process.env.HOME ?? root,
    UBI_FAKE: fake, UBI_RUNNER: join(FIX, "ubi"), UBI_RUNNER_SHA256: sha256(readFileSync(join(FIX, "ubi"))), UBI_RUNNER_STATE: state, UBI_RECOVERY_DIR: recovery, UBI_OWNER: "GEVA-268",
    LEDGER: ledger, ARMS: arms, TB2_PARTS: tb2, TB2_PARTS_SHA256: sha256(readFileSync(tb2)),
    L1_PREPARE_RUN: join(FIX, "fake-prepare-run.ts"), L1_HOST_LEDGER_PORT: String(freePort()), L1_BUNDLE_WAIT_SEC: "30", L1_POLL_SEC: "0.2", L1_SALVAGE_WAIT_SEC: "30", PULL_RETRY_SEC: "0",
    ANTHROPIC_API_KEY: "test-not-a-key", OPENROUTER_API_KEY: "test-not-a-key", UBICLOUD_API_KEY: "test-not-a-key",
  };
  const r = { root, fake, work: join(root, "work"), ledger, env };
  rigs.push(r);
  return r;
}

function killController(r: Rig, host: string, part: string) {
  const c = JSON.parse(readFileSync(join(r.fake, host, "l1/work", part + ".controller.json"), "utf8"));
  try { if (readFileSync("/proc/" + c.pid + "/cmdline", "utf8").includes("host.sh")) process.kill(c.pid, "SIGKILL"); } catch {}
  Bun.spawnSync(["pkill", "-9", "-f", join(r.fake, host, "l1/laneb/runner/launch.sh")]);
}
afterEach(() => {
  for (const r of rigs.splice(0)) {
    for (const host of readdirSync(r.fake).filter((d) => d.startsWith("host-"))) {
      const w = join(r.fake, host, "l1/work");
      for (const f of existsSync(w) ? readdirSync(w).filter((f) => f.endsWith(".controller.json")) : []) killController(r, host, f.replace(/\.controller\.json$/, ""));
    }
    Bun.spawnSync(["pkill", "-9", "-f", r.root]);
  }
});

function l1(r: Rig, args: string[], extra: Record<string, string> = {}) {
  const p = Bun.spawnSync([process.execPath, L1TS, ...args], { env: { ...r.env, ...extra }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
async function until(f: () => boolean, ms = 60_000) {
  const end = Date.now() + ms;
  // gstack-timing-ok: a bounded poll for an outcome another process writes, not a fixed wait
  while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(50); }
}
async function attachUntil(r: Rig, want: RegExp, extra: Record<string, string> = {}) {
  let last = "";
  for (let i = 0; i < 300; i++) {
    const a = l1(r, ["attach", r.work], extra);
    last = a.out + a.err;
    if (want.test(last)) return a;
    // gstack-timing-ok: the agent attaches on a timer; this is that timer, bounded
    await Bun.sleep(200);
  }
  throw new Error("attach never printed " + want + "; last: " + last);
}
const events = (r: Rig) => (existsSync(join(r.fake, "events.log")) ? readFileSync(join(r.fake, "events.log"), "utf8") : "");
const plan = (r: Rig) => JSON.parse(readFileSync(join(r.work, "plan.json"), "utf8"));
const openIds = (r: Rig, item: string) => new Ledger(r.ledger, item).status().openIds;
// The cells a part ran: trials that opened a session (a result.json beside config.json), as "<task>\t<arm>".
function ranCells(dir: string): string[] {
  const jobs = join(dir, "pulled/jobs"), out: string[] = [];
  for (const j of existsSync(jobs) ? readdirSync(jobs) : []) for (const t of readdirSync(join(jobs, j))) {
    const c = JSON.parse(readFileSync(join(jobs, j, t, "config.json"), "utf8"));
    if (existsSync(join(jobs, j, t, "result.json"))) out.push(cellKey(basename(c.task.path), c.agent.kwargs.arm));
  }
  return out;
}

// Kills a host the way the dry run does: every process on it, and it answers nothing more. Then attach calls it lost.
async function loseHost(r: Rig, host: string, part: string, vm: string) {
  writeFileSync(join(r.fake, host, ".dead"), "");
  killController(r, host, part);
  Bun.spawnSync(["pkill", "-9", "-f", join(r.fake, host)]);
  await until(() => existsSync(join(r.fake, vm, "work/run/out/vm-run.exit")));
  for (let i = 1; i <= 2; i++) expect(l1(r, ["attach", r.work]).out).toContain("did not answer (" + i + " of 3)");
  expect(l1(r, ["attach", r.work], { L1_UNREACHABLE_MINUTES: "0" }).code).toBe(5);
}
const launchJson = (r: Rig, part: string) => JSON.parse(readFileSync(join(r.work, part + ".launch.json"), "utf8"));
const recoverJson = (r: Rig) => JSON.parse(readFileSync(join(r.work, "host/recover.json"), "utf8"));
const hostUps = (r: Rig) => events(r).match(/ up -s standard-2 /g)?.length ?? 0;
const salvageJson = (r: Rig) => JSON.parse(readFileSync(join(r.fake, "host-1/l1/work/pilot.salvage.json"), "utf8"));
// prepare, host-up and launch pilot on host-1, with its part VM vm-2 paused after its fourth trial.
async function started(r: Rig) {
  expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
  expect(l1(r, ["host-up", r.work]).code).toBe(0);
  expect(l1(r, ["launch", r.work, "--part", "pilot"], { PAUSE_VM: "vm-2", PAUSE_AT: "4" }).code).toBe(0);
  await until(() => existsSync(join(r.fake, "vm-2/paused")));
}

describe("l1.ts before any spend", () => {
  test("prepare and host-up refuse a used item, a cap that differs from approvals/, an unpinned runner, a missing recovery folder and an unpinned TB2 split, and start no host", () => {
    const used = rig("pilot-opus");
    new Ledger(used.ledger, "pilot-opus").reserve("pilot-opus/old/s1", toMicros(1));
    const a = l1(used, ["prepare", used.work, "--item", "pilot-opus"]);
    expect([a.code, a.err]).toEqual([3, expect.stringContaining("already holds 1 reserve or settle rows")]);
    const cap = rig("pilot-opus", { cap: 90 });
    expect(l1(cap, ["prepare", cap.work, "--item", "pilot-opus"]).err).toContain("cap on the ledger is $90");
    const r = rig("pilot-opus");
    expect(l1(r, ["launch", r.work, "--part", "pilot"]).code).toBe(2);
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(3);
    const sha = l1(r, ["host-up", r.work], { UBI_RUNNER_SHA256: "0".repeat(64) });
    expect([sha.code, sha.err]).toEqual([2, expect.stringContaining("not the recorded")]);
    expect(l1(r, ["host-up", r.work], { UBI_RECOVERY_DIR: "" }).code).toBe(2);
    expect(l1(r, ["launch", r.work, "--part", "pilot"]).err).toContain("no host is up");
    const tb2 = rig("tb2-opus");
    expect(l1(tb2, ["prepare", tb2.work, "--item", "tb2-opus"], { TB2_PARTS_SHA256: "0".repeat(64) }).code).toBe(2);
    const ok = l1(tb2, ["prepare", tb2.work, "--item", "tb2-opus"]);
    expect([ok.code, plan(tb2).parts.map((p: any) => p.name), plan(tb2).host_ttl_hours]).toEqual([0, ["tb2-1", "tb2-2"], 78]);
    expect(ok.out).toContain("tb2-1 (190 sessions), tb2-2 (180 sessions)");
    for (const x of [used, cap, r, tb2]) expect(events(x)).not.toContain(" up ");
  }, 60_000);

  test("host-up: when the ledger refuses the host's hours it is a cap stop (exit 9), and no host starts", () => {
    const r = rig("pilot-opus", { preReserve: 78 });
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    const up = l1(r, ["host-up", r.work]);
    expect([up.code, up.err]).toEqual([9, expect.stringContaining("no host started (cap stop)")]);
    expect(up.err).toMatch(/^CAP_STOP /);
    expect(events(r)).not.toContain(" up ");
    expect(existsSync(r.ledger + ".host.json")).toBe(false);
    expect(readRows(r.ledger).some((x) => x.id === "host-1")).toBe(false);
  }, 60_000);
});

describe("l1.ts on a fake awake host", () => {
  test("pilot: host-up reserves the host's hours first and moves the item's only ledger onto it; launch, attach and host-down run every planned cell once in the seeded order", async () => {
    const r = rig("pilot-opus");
    const p = l1(r, ["prepare", r.work, "--item", "pilot-opus"]);
    expect([p.code, p.out]).toEqual([0, expect.stringContaining("pilot (32 sessions)")]);
    expect(plan(r).host_ttl_hours).toBe(60);
    expect(readdirSync(join(r.work, "pilot")).filter((f) => /^job(-\d+)?\.json$/.test(f)).sort()).toEqual(["job-2.json", "job.json"]);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(events(r)).toMatch(/ up -s standard-2 ttl=60 counted=1\n/);
    const hostLedger = join(r.fake, "host-1/l1/ledger/pilot-opus.jsonl");
    expect(readRows(hostLedger).filter((x) => x.kind !== "approval").map((x) => [x.kind, x.id, x.usd_micros])).toEqual([["reserve", "host-1", toMicros(4.8)]]);
    expect(existsSync(r.ledger)).toBe(false);
    expect(JSON.parse(readFileSync(r.ledger + ".host.json", "utf8"))).toMatchObject({ host: "host-1", item: "pilot-opus" });
    expect(l1(r, ["host-up", r.work]).code).toBe(3);
    expect(l1(r, ["recover", r.work]).err).toContain("answers; run attach");
    const la = l1(r, ["launch", r.work, "--part", "pilot"]);
    expect([la.code, la.out]).toEqual([0, expect.stringContaining("part VM vm-2 (recovery bundle copied)")]);
    expect(existsSync(join(r.env.UBI_RECOVERY_DIR!, "geva268", "vm-2.bundle"))).toBe(true);
    expect(l1(r, ["launch", r.work, "--part", "pilot"]).code).toBe(3);
    const a = await attachUntil(r, /NEXT: host-down \(every part has finished\)/);
    expect(a.out).toContain("pilot: finished, launch exit 0\n");
    expect(JSON.parse(readFileSync(join(r.work, "host/bound.json"), "utf8")).run_id).toBe(plan(r).run_id);
    const part = plan(r).parts[0];
    expect(ranCells(join(r.work, "pilot")).sort()).toEqual([...plannedCells(part).keys()].sort());
    const tasks = trialTasksFrom(join(r.work, "pilot/pulled/jobs"));
    const order = readFileSync(join(r.work, "pilot/pulled/out/proxy-sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((s) => cellKey(tasks.get(s.trial.replace(/__env$/, ""))!, s.meta.arm));
    expect(order).toEqual(part.rects.flatMap((x: any) => x.tasks.flatMap((t: string) => x.arms.map((arm: string) => cellKey(t, arm)))));
    const d = l1(r, ["host-down", r.work]);
    expect(d.code).toBe(0);
    expect(events(r)).toMatch(/ down host-1 /);
    expect(existsSync(r.ledger + ".host.json")).toBe(false);
    expect(existsSync(r.ledger + ".bound")).toBe(true);
    const rows = readRows(r.ledger);
    expect(rows.filter((x) => x.kind === "reserve" && x.id.startsWith("pilot-opus/pilot/s"))).toHaveLength(32);
    expect(rows.filter((x) => x.kind === "settle" && (x.id === "host-1" || x.id === "pilot-opus/pilot/vm"))).toHaveLength(2);
    expect(openIds(r, "pilot-opus")).toEqual([]);
  }, 180_000);

  test("f1: a part launched out of order is refused, and a cap stop ends the item: the next part and a relaunch are refused", async () => {
    const r = rig("f1-opus");
    expect(l1(r, ["prepare", r.work, "--item", "f1-opus"]).code).toBe(0);
    expect([plan(r).parts.map((p: any) => p.name), plan(r).host_ttl_hours]).toEqual([["f1-1", "f1-2", "f1-3", "f1-4"], 114]);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(readRows(join(r.fake, "host-1/l1/ledger/f1-opus.jsonl")).find((x) => x.id === "host-1")!.usd_micros).toBe(toMicros(9.12));
    const early = l1(r, ["launch", r.work, "--part", "f1-2"]);
    expect([early.code, early.err]).toEqual([3, expect.stringContaining("f1-1 has not finished")]);
    expect(l1(r, ["launch", r.work, "--part", "f1-1"], { CAP_STOP_AT: "4" }).code).toBe(0);
    const a = await attachUntil(r, /NEXT: host-down: f1-1 ended at a cap stop/);
    expect(a.out).toContain("CAP STOP");
    expect(ranCells(join(r.work, "f1-1"))).toHaveLength(4);
    const next = l1(r, ["launch", r.work, "--part", "f1-2"]);
    expect([next.code, next.err]).toEqual([3, expect.stringContaining("ended at a cap stop")]);
    const re = l1(r, ["relaunch", r.work, "--part", "f1-1"]);
    expect([re.code, re.err]).toEqual([3, expect.stringContaining("a cap stop is never relaunched")]);
    expect(l1(r, ["host-down", r.work]).code).toBe(0);
    expect(openIds(r, "f1-opus")).toEqual([]);
    const up = l1(r, ["host-up", r.work]);
    expect([up.code, up.err]).toEqual([3, expect.stringContaining("f1-opus has ended incomplete: f1-1 ended at a cap stop")]);
    expect(l1(r, ["attach", r.work]).out).toContain("f1-opus ended incomplete");
    expect(events(r).match(/ up -s standard-2 /g)).toHaveLength(1);
  }, 180_000);

  test("a lost controller: host-down is refused, and the one relaunch salvages the part, then runs only the cells that never started", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { PAUSE_VM: "vm-2", PAUSE_AT: "5" }).code).toBe(0);
    await until(() => existsSync(join(r.fake, "vm-2/paused")));
    killController(r, "host-1", "pilot");
    await attachUntil(r, /pilot: CONTROLLER_LOST/);
    expect(l1(r, ["host-down", r.work]).code).toBe(3);
    const re = l1(r, ["relaunch", r.work, "--part", "pilot"]);
    expect([re.code, re.out]).toEqual([0, expect.stringContaining("pilot-relaunch: controller started on host-1")]);
    expect(JSON.parse(readFileSync(join(r.fake, "host-1/l1/work/pilot.salvage.json"), "utf8"))).toMatchObject({ vm: "vm-2", pulled: true, vm_down: true });
    const rel = JSON.parse(readFileSync(join(r.work, "pilot.relaunch.json"), "utf8"));
    expect(rel.loss).toEqual(["the controller was lost before it recorded an exit"]);
    expect(rel.never_started.reduce((s: number, c: any) => s + c.replicates, 0)).toBe(27);
    await attachUntil(r, /NEXT: host-down \(every part has finished\)/);
    const first = ranCells(join(r.work, "pilot")), second = ranCells(join(r.work, "pilot-relaunch"));
    expect([first.length, second.length, new Set([...first, ...second]).size]).toEqual([5, 27, 32]);
    expect(l1(r, ["relaunch", r.work, "--part", "pilot"]).err).toContain("relaunched already");
    expect(l1(r, ["relaunch", r.work, "--part", "pilot-relaunch"]).code).toBe(2);
    expect(l1(r, ["host-down", r.work]).code).toBe(0);
    const rows = readRows(r.ledger);
    expect(rows.find((x) => x.kind === "settle" && x.id === "pilot-opus/pilot/vm")!.kind_detail).toContain("settled by salvage");
    expect(openIds(r, "pilot-opus")).toEqual([]);
  }, 240_000);

  test("Amendment C's dry run: the host dies mid-part; attach calls it lost only after 3 misses over the window, recover rebuilds the ledger from the mirror and the part VM's records, and the relaunch on a new host runs only the cells that never started", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { PAUSE_VM: "vm-2", PAUSE_AT: "8" }).code).toBe(0);
    await until(() => existsSync(join(r.fake, "vm-2/paused")));
    expect(l1(r, ["attach", r.work]).out).toContain("pilot: running");
    // The agent's last mirror is from an earlier look: it ends at the third session's settle.
    const mirror = join(r.work, "host/ledger.jsonl");
    const lines = readFileSync(mirror, "utf8").trim().split("\n");
    const settles = lines.map((l, i) => [JSON.parse(l), i] as const).filter(([x]) => x.kind === "settle" && x.id.startsWith("pilot-opus/pilot/s"));
    writeFileSync(mirror, lines.slice(0, settles[2]![1] + 1).join("\n") + "\n");
    // Kill the host itself: every process on it, and it answers nothing more. The part VM's batch sees its tunnel drop.
    writeFileSync(join(r.fake, "host-1/.dead"), "");
    killController(r, "host-1", "pilot");
    Bun.spawnSync(["pkill", "-9", "-f", join(r.fake, "host-1")]);
    await until(() => existsSync(join(r.fake, "vm-2/work/run/out/vm-run.exit")));
    expect(readFileSync(join(r.fake, "vm-2/work/run/out/vm-run.exit"), "utf8").trim()).toBe("129");
    for (let i = 1; i <= 3; i++) expect(l1(r, ["attach", r.work]).out).toContain("did not answer (" + i + " of 3)");
    expect(l1(r, ["relaunch", r.work, "--part", "pilot"]).err).toContain("did not answer");
    const lost = l1(r, ["attach", r.work], { L1_UNREACHABLE_MINUTES: "0" });
    expect([lost.code, lost.out]).toEqual([5, expect.stringContaining("HOST_LOST")]);
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([0, expect.stringContaining("NEXT: host-up, then relaunch --part pilot")]);
    expect(existsSync(r.ledger + ".host.json")).toBe(false);
    const rows = readRows(r.ledger);
    const sess = rows.filter((x) => x.id.startsWith("pilot-opus/pilot/s"));
    expect([sess.filter((x) => x.kind === "reserve").length, sess.filter((x) => x.kind === "settle").length, sess.filter((x) => x.recovered).length]).toEqual([8, 8, 10]);
    for (const s of readFileSync(join(r.work, "pilot/pulled/out/proxy-sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))) {
      expect(sess.find((x) => x.kind === "settle" && x.id === "pilot-opus/pilot/" + s.id)!.usd_micros).toBe(s.spent_micros);
    }
    expect(rows.find((x) => x.kind === "settle" && x.id === "host-1")).toMatchObject({ recovered: true });
    expect(openIds(r, "pilot-opus")).toEqual([]);
    expect(JSON.parse(readFileSync(join(r.work, "pilot.result.json"), "utf8")).loss).toContain("the awake host was lost");
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(readRows(join(r.fake, "host-3/l1/ledger/pilot-opus.jsonl")).find((x) => x.kind === "reserve" && x.id === "host-2")).toBeTruthy();
    const re = l1(r, ["relaunch", r.work, "--part", "pilot"]);
    expect([re.code, re.out]).toEqual([0, expect.stringContaining("pilot-relaunch: controller started on host-3")]);
    await attachUntil(r, /NEXT: host-down \(every part has finished\)/);
    const first = ranCells(join(r.work, "pilot")), second = ranCells(join(r.work, "pilot-relaunch"));
    expect([first.length, second.length, new Set([...first, ...second]).size]).toEqual([8, 24, 32]);
    expect(l1(r, ["host-down", r.work]).code).toBe(0);
    expect(openIds(r, "pilot-opus")).toEqual([]);
    expect(readRows(r.ledger).filter((x) => x.kind === "settle" && /^host-\d$/.test(x.id)).map((x) => x.id)).toEqual(["host-1", "host-2"]);
  }, 300_000);

  test("a part VM that comes up after launch stops waiting: attach records it in launch.json, and recover after the host dies stops that VM and rebuilds its sessions", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    const la = l1(r, ["launch", r.work, "--part", "pilot"], { L1_BUNDLE_WAIT_SEC: "0", PAUSE_VM: "vm-2", PAUSE_AT: "4" });
    expect([la.code, la.out]).toEqual([0, expect.stringContaining("no part VM yet")]);
    expect(launchJson(r, "pilot").vm).toBeUndefined();
    await until(() => existsSync(join(r.fake, "vm-2/paused")));
    expect(l1(r, ["attach", r.work]).out).toContain("pilot: running");
    expect(launchJson(r, "pilot")).toMatchObject({ vm: "vm-2", controller_started_at: expect.any(Number) });
    const mirror = join(r.work, "host/ledger.jsonl");
    const lines = readFileSync(mirror, "utf8").trim().split("\n");
    const settles = lines.map((l, i) => [JSON.parse(l), i] as const).filter(([x]) => x.kind === "settle" && x.id.startsWith("pilot-opus/pilot/s"));
    writeFileSync(mirror, lines.slice(0, settles[1]![1] + 1).join("\n") + "\n");
    await loseHost(r, "host-1", "pilot", "vm-2");
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([0, expect.stringContaining("NEXT: host-up, then relaunch --part pilot")]);
    expect(events(r)).toMatch(/ down vm-2 /);
    expect(recoverJson(r)).toMatchObject({ part_vm: "vm-2", part_results_pulled: true, complete: true });
    const rows = readRows(r.ledger);
    const sess = rows.filter((x) => x.id.startsWith("pilot-opus/pilot/s"));
    expect([sess.filter((x) => x.kind === "reserve").length, sess.filter((x) => x.kind === "settle").length, sess.filter((x) => x.recovered).length]).toEqual([4, 4, 4]);
    expect(rows.find((x) => x.kind === "settle" && x.id === "pilot-opus/pilot/vm")).toMatchObject({ recovered: true });
    expect(openIds(r, "pilot-opus")).toEqual([]);
  }, 240_000);

  test("recover with no VM in launch.json uses the one recovery bundle copied since the launch that nothing claims; with none the part VM is unknown, so recover exits 4 and the item ends: host-up, launch and relaunch are refused and no host starts", async () => {
    const lateVm = async (r: Rig, copyBundle: boolean) => {
      expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
      expect(l1(r, ["host-up", r.work]).code).toBe(0);
      expect(l1(r, ["launch", r.work, "--part", "pilot"], { L1_BUNDLE_WAIT_SEC: "0", PAUSE_VM: "vm-2", PAUSE_AT: "3" }).code).toBe(0);
      await until(() => existsSync(join(r.fake, "vm-2/paused")));
      if (copyBundle) copyFileSync(join(r.fake, "host-1/l1/recovery/geva268/vm-2.bundle"), join(r.env.UBI_RECOVERY_DIR!, "geva268/vm-2.bundle"));
      expect(existsSync(join(r.env.UBI_RECOVERY_DIR!, "geva268/host-1.bundle"))).toBe(true);
      expect(launchJson(r, "pilot").vm).toBeUndefined();
      await loseHost(r, "host-1", "pilot", "vm-2");
      return l1(r, ["recover", r.work]);
    };
    const found = rig("pilot-opus");
    const ok = await lateVm(found, true);
    expect([ok.code, ok.out]).toEqual([0, expect.stringContaining("NEXT: host-up, then relaunch --part pilot")]);
    expect(events(found)).toMatch(/ down vm-2 /);
    expect(recoverJson(found)).toMatchObject({ part_vm: "vm-2", complete: true });
    expect(openIds(found, "pilot-opus")).toEqual([]);

    const r = rig("pilot-opus");
    const stop = await lateVm(r, false);
    expect([stop.code, stop.out]).toEqual([4, expect.stringContaining("ends incomplete and goes to the Captain")]);
    expect(events(r)).not.toMatch(/ down vm-2 /);
    expect(recoverJson(r)).toMatchObject({ part_vm: null, part_results_pulled: false, complete: false });
    for (const args of [["host-up", r.work], ["launch", r.work, "--part", "pilot"], ["relaunch", r.work, "--part", "pilot"]]) {
      const x = l1(r, args);
      expect([x.code, x.err]).toEqual([3, expect.stringContaining("pilot-opus has ended incomplete: the host was lost and recover could not rebuild the ledger")]);
    }
    expect(l1(r, ["attach", r.work]).out).toContain("NEXT: none: pilot-opus ended incomplete");
    expect(hostUps(r)).toBe(1);
  }, 300_000);

  test("a host-up whose bootstrap fails and whose host can't be destroyed keeps that host current: a second host-up and a launch are refused, and host-down destroys it and settles its hours", () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    const up = l1(r, ["host-up", r.work], { FAIL_HOST_BOOTSTRAP: "1", FAIL_DOWN: "1" });
    expect([up.code, up.err]).toEqual([1, expect.stringContaining("bootstrapping the host failed")]);
    expect(openIds(r, "pilot-opus")).toEqual(["host-1"]);
    const again = l1(r, ["host-up", r.work]);
    expect([again.code, again.err]).toEqual([3, expect.stringContaining("host host-1 is already up")]);
    expect(hostUps(r)).toBe(1);
    expect(l1(r, ["launch", r.work, "--part", "pilot"]).err).toContain("cleanup is pending; run host-down");
    expect(l1(r, ["attach", r.work]).out).toContain("NEXT: host-down (cleanup of a failed host-up is pending)");
    const stuck = l1(r, ["host-down", r.work], { FAIL_DOWN: "1" });
    expect([stuck.code, stuck.err]).toEqual([3, expect.stringContaining("its reserve host-1 stays open")]);
    expect(openIds(r, "pilot-opus")).toEqual(["host-1"]);
    expect(l1(r, ["host-down", r.work]).code).toBe(0);
    expect(existsSync(join(r.fake, "host-1/.down"))).toBe(true);
    expect(readRows(r.ledger).find((x) => x.kind === "settle" && x.id === "host-1")).toBeTruthy();
    expect(openIds(r, "pilot-opus")).toEqual([]);
    expect(l1(r, ["attach", r.work]).out).toContain("NEXT: host-up");
  }, 60_000);

  test("a controller is alive while any process in host.sh's session is: with only host.sh killed, attach reports the part running and relaunch is refused", async () => {
    const r = rig("pilot-opus");
    await started(r);
    process.kill(JSON.parse(readFileSync(join(r.fake, "host-1/l1/work/pilot.controller.json"), "utf8")).pid, "SIGKILL");
    expect(l1(r, ["attach", r.work]).out).toContain("pilot: running");
    const re = l1(r, ["relaunch", r.work, "--part", "pilot"]);
    expect([re.code, re.err, existsSync(join(r.fake, "host-1/l1/work/pilot.salvage.json"))]).toEqual([3, expect.stringContaining("pilot's controller is still running"), false]);
    Bun.spawnSync(["pkill", "-9", "-f", join(r.fake, "host-1/l1/laneb/runner/launch.sh")]);
    await attachUntil(r, /pilot: CONTROLLER_LOST/);
  }, 180_000);

  test("relaunch starts the salvage detached and polls host-status, so the runner's idle watchdog can't cut the salvage off", async () => {
    const r = rig("pilot-opus");
    await started(r);
    killController(r, "host-1", "pilot");
    await attachUntil(r, /pilot: CONTROLLER_LOST/);
    const re = l1(r, ["relaunch", r.work, "--part", "pilot"], { UBI_FAKE_SSH_LIMIT: "6", SLOW_PULL: "4" });
    expect([re.code, re.out]).toEqual([0, expect.stringContaining("pilot-relaunch: controller started on host-1")]);
    expect(salvageJson(r)).toMatchObject({ vm: "vm-2", pulled: true, vm_down: true });
  }, 240_000);

  test("salvage finds a part VM the controller never logged from the one recovery bundle on the host that no part claims, then stops, pulls and destroys it", async () => {
    const r = rig("pilot-opus");
    await started(r);
    killController(r, "host-1", "pilot");
    const log = join(r.fake, "host-1/l1/work/pilot.controller.log");
    writeFileSync(log, readFileSync(log, "utf8").replace(/^vm: .*\n/m, ""));
    await attachUntil(r, /pilot: CONTROLLER_LOST/);
    expect(l1(r, ["relaunch", r.work, "--part", "pilot"]).code).toBe(0);
    expect(salvageJson(r)).toMatchObject({ vm: "vm-2", pulled: true, vm_down: true });
    expect(events(r)).toMatch(/ down vm-2 /);
  }, 240_000);

  test("a host that answers ssh while host-status fails on it is not lost: attach counts no miss, and recover refuses and destroys nothing", async () => {
    const r = rig("pilot-opus");
    await started(r);
    const bad = join(r.fake, "host-1/l1/work/pilot.salvage.json");
    writeFileSync(bad, "{\"part\":");
    for (let i = 0; i < 3; i++) {
      const a = l1(r, ["attach", r.work], { L1_UNREACHABLE_MINUTES: "0" });
      expect([a.code, a.err]).toEqual([3, expect.stringContaining("answers ssh but host-status failed")]);
    }
    expect(existsSync(join(r.work, "host/unreachable.jsonl"))).toBe(false);
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.err]).toEqual([3, expect.stringContaining("answers ssh, so it is not lost")]);
    expect(events(r)).not.toMatch(/ down host-1 /);
    rmSync(bad);
    expect(l1(r, ["attach", r.work]).out).toContain("pilot: running");
  }, 180_000);

  test("host-up refuses while UBI_RECOVERY_KEY is set, and recover destroys nothing when ubi-runner recover fails", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    const keyed = l1(r, ["host-up", r.work], { UBI_RECOVERY_KEY: "test-not-a-key" });
    expect([keyed.code, keyed.err, hostUps(r), openIds(r, "pilot-opus")]).toEqual([3, expect.stringContaining("UBI_RECOVERY_KEY is set"), 0, []]);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { PAUSE_VM: "vm-2", PAUSE_AT: "4" }).code).toBe(0);
    await until(() => existsSync(join(r.fake, "vm-2/paused")));
    await loseHost(r, "host-1", "pilot", "vm-2");
    const failed = l1(r, ["recover", r.work], { FAIL_RECOVER: "1" });
    expect([failed.code, failed.err]).toEqual([3, expect.stringContaining("left no local state for part VM vm-2")]);
    expect(events(r)).not.toMatch(/ down host-1 /);
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([0, expect.stringContaining("NEXT: host-up, then relaunch --part pilot")]);
    expect(recoverJson(r)).toMatchObject({ part_vm: "vm-2", complete: true });
  }, 300_000);

  test("a part whose launch.sh exits 7 keeps its VM: host-down salvages it first (stops, pulls, destroys it, settles its blocks) and refuses while it can't", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { FAIL_PULL: "vm-2" }).code).toBe(0);
    await attachUntil(r, /pilot: finished, launch exit 7/);
    const stuck = l1(r, ["host-down", r.work], { FAIL_DOWN: "1" });
    expect([stuck.code, existsSync(join(r.fake, "vm-2/.down")), existsSync(join(r.fake, "host-1/.down"))]).toEqual([3, false, false]);
    expect(l1(r, ["host-down", r.work]).code).toBe(0);
    expect(salvageJson(r)).toMatchObject({ vm: "vm-2", pulled: true, vm_down: true });
    expect(readRows(r.ledger).find((x) => x.kind === "settle" && x.id === "pilot-opus/pilot/vm")!.kind_detail).toContain("settled by salvage of the VM launch.sh kept (exit 7)");
    expect(openIds(r, "pilot-opus")).toEqual([]);
  }, 240_000);

  test("host-down refuses while any part's VM reserve is open", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"]).code).toBe(0);
    await attachUntil(r, /NEXT: host-down \(every part has finished\)/);
    new Ledger(join(r.fake, "host-1/l1/ledger/pilot-opus.jsonl"), "pilot-opus").reserve("pilot-opus/pilot/vm-9", toMicros(1));
    const x = l1(r, ["host-down", r.work]);
    expect([x.code, x.err, existsSync(join(r.fake, "host-1/.down"))]).toEqual([3, expect.stringContaining("pilot-opus/pilot/vm-9"), false]);
  }, 120_000);

  test("launch writes launch.json before it starts the controller, and a start whose ssh fails reads host-status: a controller that started counts, one that didn't leaves no launch.json", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    const no = l1(r, ["launch", r.work, "--part", "pilot"], { FAIL_SSH_MATCH: "host.sh run" });
    expect([no.code, no.err, existsSync(join(r.work, "pilot.launch.json"))]).toEqual([1, expect.stringContaining("starting pilot's controller failed (exit 255)"), false]);
    const la = l1(r, ["launch", r.work, "--part", "pilot"], { FAIL_SSH_MATCH: "host.sh run", FAIL_SSH_RUN: "1", PAUSE_VM: "vm-2", PAUSE_AT: "4" });
    expect([la.code, la.out]).toEqual([0, expect.stringContaining("pilot: controller started on host-1, part VM vm-2")]);
    expect(launchJson(r, "pilot")).toMatchObject({ host: "host-1", vm: "vm-2" });
  }, 120_000);
});

describe("l1.ts keeps cap stops, salvaged results and session records", () => {
  test("a salvage that pulls a cap stop the first pull missed ends the item: relaunch is refused and no part VM starts", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { FAIL_PULL: "vm-2", CAP_STOP_AT: "4" }).code).toBe(0);
    await attachUntil(r, /pilot: finished, launch exit 7/);
    const re = l1(r, ["relaunch", r.work, "--part", "pilot"]);
    expect([re.code, re.err]).toEqual([3, expect.stringContaining("a cap stop is never relaunched")]);
    expect(salvageJson(r)).toMatchObject({ vm: "vm-2", pulled: true, vm_down: true });
    const result = JSON.parse(readFileSync(join(r.work, "pilot.result.json"), "utf8"));
    expect([result.cap_stop[0], result.salvage?.pulled]).toEqual([expect.stringContaining("test cap stop"), true]);
    expect(events(r).match(/ up -s standard-16 /g)).toHaveLength(1);
    expect(l1(r, ["attach", r.work]).out).toContain("NEXT: host-down: pilot ended at a cap stop");
  }, 240_000);

  test("when a salvage can't pull a part's records either, a cap stop counts as possible once the item's ledger came within one session cap of its cap, so relaunch is refused", async () => {
    const r = rig("pilot-opus", { preReserve: 70 });
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { FAIL_PULL: "vm-2" }).code).toBe(0);
    await attachUntil(r, /pilot: finished, launch exit 7/);
    writeFileSync(join(r.fake, "vm-2/.dead"), "");
    const re = l1(r, ["relaunch", r.work, "--part", "pilot"]);
    expect([re.code, re.err]).toEqual([3, expect.stringContaining("a cap stop can't be ruled out")]);
    expect(salvageJson(r)).toMatchObject({ vm: "vm-2", pulled: false, vm_down: true });
    expect(events(r).match(/ up -s standard-16 /g)).toHaveLength(1);
  }, 240_000);

  test("host-down brings a salvaged part's results home and checks them before it destroys the host; when that pull fails it refuses and the host stays", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { FAIL_PULL: "vm-2" }).code).toBe(0);
    await attachUntil(r, /pilot: finished, launch exit 7/);
    expect(existsSync(join(r.work, "pilot/pulled/out/proxy-sessions.jsonl"))).toBe(false);
    const stuck = l1(r, ["host-down", r.work], { FAIL_PULL_MATCH: "work/pilot/pulled" });
    expect([stuck.code, stuck.err]).toEqual([3, expect.stringContaining("could not be pulled home")]);
    expect([existsSync(join(r.fake, "vm-2/.down")), existsSync(join(r.fake, "host-1/.down")), existsSync(r.ledger + ".host.json")]).toEqual([true, false, true]);
    expect(l1(r, ["host-down", r.work]).code).toBe(0);
    expect(readFileSync(join(r.work, "pilot/pulled/out/proxy-sessions.jsonl"), "utf8").trim().split("\n")).toHaveLength(32);
    expect(JSON.parse(readFileSync(join(r.work, "pilot.result.json"), "utf8"))).toMatchObject({ pulled: true, salvage: { pulled: true, vm_down: true } });
    expect(openIds(r, "pilot-opus")).toEqual([]);
  }, 240_000);

  test("a relaunch that launch.sh kept at exit 7 is salvaged, and its results brought home, before the next part starts", async () => {
    const r = rig("f1-opus");
    expect(l1(r, ["prepare", r.work, "--item", "f1-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "f1-1"], { PAUSE_VM: "vm-2", PAUSE_AT: "5" }).code).toBe(0);
    await until(() => existsSync(join(r.fake, "vm-2/paused")));
    killController(r, "host-1", "f1-1");
    await attachUntil(r, /f1-1: CONTROLLER_LOST/);
    expect(l1(r, ["relaunch", r.work, "--part", "f1-1"], { FAIL_PULL: "vm-3" }).code).toBe(0);
    await attachUntil(r, /f1-1-relaunch: finished, launch exit 7/);
    expect(existsSync(join(r.fake, "vm-3/.down"))).toBe(false);
    expect(l1(r, ["launch", r.work, "--part", "f1-2"]).code).toBe(0);
    const ev = events(r);
    expect(ev.indexOf(" down vm-3 ")).toBeGreaterThan(-1);
    expect(ev.indexOf(" down vm-3 ")).toBeLessThan(ev.lastIndexOf(" up -s standard-16 "));
    expect(JSON.parse(readFileSync(join(r.work, "f1-1-relaunch.result.json"), "utf8")).salvage).toMatchObject({ vm: "vm-3", pulled: true, vm_down: true });
    expect(existsSync(join(r.work, "f1-1-relaunch/pulled/out/proxy-sessions.jsonl"))).toBe(true);
  }, 300_000);

  test("recover never calls its accounting complete while a session the part opened has no closed record: it keeps that reserve open, names the session and ends the item incomplete", async () => {
    const r = rig("pilot-opus");
    expect(l1(r, ["prepare", r.work, "--item", "pilot-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "pilot"], { PAUSE_VM: "vm-2", PROXY_CRASH_AT: "3" }).code).toBe(0);
    await until(() => existsSync(join(r.fake, "vm-2/paused")));
    expect(l1(r, ["attach", r.work]).out).toContain("pilot: running");
    const mirror = join(r.work, "host/ledger.jsonl");
    const lines = readFileSync(mirror, "utf8").trim().split("\n");
    const settles = lines.map((l, i) => [JSON.parse(l), i] as const).filter(([x]) => x.kind === "settle" && x.id.startsWith("pilot-opus/pilot/s"));
    writeFileSync(mirror, lines.slice(0, settles[1]![1] + 1).join("\n") + "\n");
    await loseHost(r, "host-1", "pilot", "vm-2");
    const opened = readFileSync(join(r.fake, "vm-2/work/run/out/proxy-requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "session_open");
    const lost = opened.at(-1).session;
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([4, expect.stringContaining("session " + lost)]);
    expect(recoverJson(r)).toMatchObject({ part_results_pulled: true, complete: false, missing_sessions: [expect.stringContaining(lost)] });
    expect(openIds(r, "pilot-opus")).toEqual(["pilot-opus/pilot/" + lost]);
    expect(readRows(r.ledger).find((x) => x.kind === "reserve" && x.id === "pilot-opus/pilot/" + lost)!.usd_micros).toBe(5_000_000);
    const up = l1(r, ["host-up", r.work]);
    expect([up.code, up.err]).toEqual([3, expect.stringContaining("recover could not rebuild the ledger")]);
  }, 300_000);

  test("vm-run.sh's exit 4, the ledger service unreachable before any trial, is an ending the prereg does not class: the next part and a relaunch are refused, and host-down still runs", async () => {
    const r = rig("f1-opus");
    expect(l1(r, ["prepare", r.work, "--item", "f1-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "f1-1"], { TUNNEL_DOWN_VM: "vm-2" }).code).toBe(0);
    const a = await attachUntil(r, /f1-1: finished, launch exit 4/);
    expect(a.out).toContain("UNCLASSIFIED: vm-run.sh exited 4");
    expect(a.out).toContain("NEXT: host-down: f1-1 ended in a way the prereg does not class");
    expect(JSON.parse(readFileSync(join(r.work, "f1-1.result.json"), "utf8"))).toMatchObject({ vm_run_exit: "4", loss: [], cap_stop: [] });
    for (const args of [["launch", r.work, "--part", "f1-2"], ["relaunch", r.work, "--part", "f1-1"]]) {
      const x = l1(r, args);
      expect([x.code, x.err]).toEqual([3, expect.stringContaining("does not class")]);
    }
    expect(events(r).match(/ up -s standard-16 /g)).toHaveLength(1);
    expect(l1(r, ["host-down", r.work]).code).toBe(0);
    expect(openIds(r, "f1-opus")).toEqual([]);
  }, 180_000);

  test("recover after the host dies with the part VM already gone (RECOVER_GONE) ends the item incomplete instead of refusing forever", async () => {
    const r = rig("pilot-opus");
    await started(r);
    await loseHost(r, "host-1", "pilot", "vm-2");
    writeFileSync(join(r.fake, "vm-2/.down"), "");
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([4, expect.stringContaining("was already gone (RECOVER_GONE)")]);
    expect(recoverJson(r)).toMatchObject({ part_vm: "vm-2", part_vm_gone: true, part_results_pulled: false, complete: false });
    expect(events(r)).toMatch(/ down host-1 /);
    expect(existsSync(r.ledger + ".host.json")).toBe(false);
    const rows = readRows(r.ledger);
    expect(rows.find((x) => x.kind === "settle" && x.id === "pilot-opus/pilot/vm")).toMatchObject({ recovered: true });
    expect(rows.find((x) => x.kind === "settle" && x.id === "host-1")).toMatchObject({ recovered: true });
    const up = l1(r, ["host-up", r.work]);
    expect([up.code, up.err]).toEqual([3, expect.stringContaining("recover could not rebuild the ledger")]);
  }, 300_000);

  // launch.sh's answer to a refused VM block (its 409 branch): it writes vm-cap-stop in the part's run dir on the host and
  // stops the batch. These tests play that branch by hand, since a real refusal needs a block to run out.
  const blockRefused = (r: Rig) => writeFileSync(join(r.fake, "host-1/l1/work/pilot/vm-cap-stop"), "the ledger refused VM block 2 (pilot-opus/pilot/vm-2, $2.400000) for pilot-opus\n");

  test("a VM-block cap stop counts even when the pull of its record fails: attach reads it from host-status, so the item ends and relaunch is refused", async () => {
    const r = rig("pilot-opus");
    await started(r);
    blockRefused(r);
    writeFileSync(join(r.fake, "vm-2/work/run/STOP"), "");
    const a = await attachUntil(r, /pilot: finished/, { FAIL_PULL_MATCH: "vm-cap-stop" });
    expect(a.out).toContain("CAP STOP: VM block: the ledger refused VM block 2");
    expect(a.out).toContain("NEXT: host-down: pilot ended at a cap stop");
    const re = l1(r, ["relaunch", r.work, "--part", "pilot"], { FAIL_PULL_MATCH: "vm-cap-stop" });
    expect([re.code, re.err]).toEqual([3, expect.stringContaining("a cap stop is never relaunched")]);
    expect(events(r).match(/ up -s standard-16 /g)).toHaveLength(1);
  }, 240_000);

  test("recover after the host dies runs the ledger check even when it pulls the part's records, since a VM-block cap stop recorded on the host is lost with it", async () => {
    const r = rig("pilot-opus", { preReserve: 65 });
    await started(r);
    blockRefused(r);
    await loseHost(r, "host-1", "pilot", "vm-2");
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([4, expect.stringContaining("NEXT: none: pilot-opus ended incomplete (pilot ended at a cap stop")]);
    expect(recoverJson(r)).toMatchObject({ part_results_pulled: true, missing_sessions: [], complete: true });
    expect(JSON.parse(readFileSync(join(r.work, "pilot.result.json"), "utf8")).cap_stop).toEqual([expect.stringContaining("a cap stop can't be ruled out")]);
    const up = l1(r, ["host-up", r.work]);
    expect([up.code, up.err]).toEqual([3, expect.stringContaining("pilot ended at a cap stop")]);
  }, 300_000);

  test("a recover that refuses after ubi-runner reported the part VM gone still knows it on the next run, since the runner drops the bundle and reports RECOVER_GONE once", async () => {
    const r = rig("pilot-opus");
    await started(r);
    await loseHost(r, "host-1", "pilot", "vm-2");
    writeFileSync(join(r.fake, "vm-2/.down"), "");
    const first = l1(r, ["recover", r.work], { FAIL_DOWN: "1" });
    expect([first.code, first.err]).toEqual([3, expect.stringContaining("could not be confirmed gone")]);
    expect(existsSync(join(r.root, "recovery/geva268/vm-2.bundle"))).toBe(false);
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([4, expect.stringContaining("was already gone (RECOVER_GONE)")]);
    expect(recoverJson(r)).toMatchObject({ part_vm: "vm-2", part_vm_gone: true, complete: false });
  }, 300_000);

  test("recover after the host dies with a part that ended at vm-run.sh's exit 4 says the item has ended, not relaunch", async () => {
    const r = rig("f1-opus");
    expect(l1(r, ["prepare", r.work, "--item", "f1-opus"]).code).toBe(0);
    expect(l1(r, ["host-up", r.work]).code).toBe(0);
    expect(l1(r, ["launch", r.work, "--part", "f1-1"], { TUNNEL_DOWN_VM: "vm-2", FAIL_PULL: "vm-2" }).code).toBe(0);
    await loseHost(r, "host-1", "f1-1", "vm-2");
    const rec = l1(r, ["recover", r.work]);
    expect([rec.code, rec.out]).toEqual([4, expect.stringContaining("NEXT: none: f1-opus ended incomplete (f1-1 ended in a way the prereg does not class")]);
    expect(recoverJson(r)).toMatchObject({ part_results_pulled: true, complete: true });
    const up = l1(r, ["host-up", r.work]);
    expect([up.code, up.err]).toEqual([3, expect.stringContaining("does not class")]);
  }, 240_000);
});
