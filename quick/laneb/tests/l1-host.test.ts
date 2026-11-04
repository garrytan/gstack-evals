import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
async function attachUntil(r: Rig, want: RegExp) {
  let last = "";
  for (let i = 0; i < 300; i++) {
    const a = l1(r, ["attach", r.work]);
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
});
