// Copyright (c) 2026 Garry Tan. MIT License.
// stage3-pilot's smoke part on the real launcher (S1, the Captain's ruling, 2026-11-13), keyless and end to end on the fake
// awake host quick/laneb/tests/l1-host.test.ts uses: fixtures/l1/ubi plays ubi-runner (each VM a directory, ssh runs the
// real host.sh, launch.sh and ledger service in it), fake-vm-run.ts plays vm-run.sh, and fake-prepare-run.ts stands in for
// prepare-run. The real hm CLI runs its launch guard and l1.ts under HM_PROFILE on the real stage3-pilot plan. After
// smoke-opus settles nothing launches on its own: the pilot parts stay unlaunched with no controller, the item stays open,
// and launch --part pilot-opus still works on the same bound run. A host lost while a judge part runs makes recover refuse
// and destroy nothing (E1).
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Ledger, readRows } from "../../quick/laneb/runner/ledger.ts";
import { sha256 } from "../../quick/laneb/l1/l1.ts";
import { bundleLists, CAPS_USD, HM, REPO, SMOKE_PART, unscreenedText } from "../../lanes/harness-mechanics/pins.ts";
import { judgeTarFixture } from "./judge-tar-fixture.ts";

const FIX = join(REPO, "quick/laneb/tests/fixtures/l1");
const CLI = join(REPO, "lanes/harness-mechanics/cli.ts");
const ITEM = "stage3-pilot", PILOTS = ["pilot-opus", "pilot-sol", "pilot-p1"];

function freePort() {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = s.port;
  s.stop(true);
  return port;
}

type Rig = { root: string; fake: string; work: string; ledger: string; env: Record<string, string>; judgeTar: string };
const rigs: Rig[] = [];
function rig(): Rig {
  const root = mkdtempSync(join(tmpdir(), "hm-hold-"));
  const fake = join(root, "vms"), recovery = join(root, "recovery"), state = join(root, "agent-state"), arms = join(root, "arms"), ledgers = join(root, "ledgers");
  for (const d of [fake, recovery, state, arms, ledgers]) mkdirSync(d, { recursive: true });
  const ledger = join(ledgers, ITEM + ".jsonl");
  new Ledger(ledger, ITEM).approve(CAPS_USD[ITEM], { quotes: ["test approval"] });
  const screened = join(root, "screened.txt"), crew = join(root, "crew.json"), judge = judgeTarFixture();
  writeFileSync(screened, unscreenedText(bundleLists()));
  writeFileSync(crew, JSON.stringify({ as_of: "2026-11-13", threads: [] }));
  const env: Record<string, string> = {
    PATH: FIX + ":" + process.env.PATH, HOME: process.env.HOME ?? root,
    UBI_FAKE: fake, UBI_RUNNER: join(FIX, "ubi"), UBI_RUNNER_SHA256: sha256(readFileSync(join(FIX, "ubi"))), UBI_RUNNER_STATE: state, UBI_RECOVERY_DIR: recovery, UBI_OWNER: "GEVA-503",
    LEDGER: ledger, ARMS: arms, HM_LEDGERS: ledgers, HM_CREW: crew, HM_JUDGE_MANIFEST: judge.manifest, HM_SCREENED: screened, HM_SCREENED_SHA256: sha256(readFileSync(screened)),
    L1_PREPARE_RUN: join(FIX, "fake-prepare-run.ts"), L1_HOST_LEDGER_PORT: String(freePort()), L1_BUNDLE_WAIT_SEC: "30", L1_POLL_SEC: "0.2", L1_SALVAGE_WAIT_SEC: "30", PULL_RETRY_SEC: "0",
    ANTHROPIC_API_KEY: "test-not-a-key", OPENROUTER_API_KEY: "test-not-a-key", TYPESAFE_API_KEY: "test-not-a-key", UBICLOUD_API_KEY: "test-not-a-key",
  };
  const r = { root, fake, work: join(root, "work"), ledger, env, judgeTar: judge.tarGz };
  rigs.push(r);
  return r;
}
const hostWork = (r: Rig, host = "host-1") => join(r.fake, host, HM.hostRoot, "work");
function killController(r: Rig, host: string, part: string) {
  const f = join(hostWork(r, host), part + ".controller.json");
  if (!existsSync(f)) return;
  const c = JSON.parse(readFileSync(f, "utf8"));
  try { if (readFileSync("/proc/" + c.pid + "/cmdline", "utf8").includes("host.sh")) process.kill(c.pid, "SIGKILL"); } catch {}
  Bun.spawnSync(["pkill", "-9", "-f", join(r.fake, host, HM.hostRoot, "laneb/runner/launch.sh")]);
}
afterEach(() => {
  for (const r of rigs.splice(0)) {
    for (const host of readdirSync(r.fake).filter((d) => d.startsWith("host-"))) {
      const w = hostWork(r, host);
      for (const f of existsSync(w) ? readdirSync(w).filter((f) => f.endsWith(".controller.json")) : []) killController(r, host, f.replace(/\.controller\.json$/, ""));
    }
    Bun.spawnSync(["pkill", "-9", "-f", r.root]);
  }
});

function hm(r: Rig, args: string[], extra: Record<string, string> = {}) {
  const p = Bun.spawnSync([process.execPath, CLI, ...args], { env: { ...r.env, ...extra }, cwd: REPO, stdout: "pipe", stderr: "pipe" });
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
    const a = hm(r, ["attach", r.work]);
    last = a.out + a.err;
    if (want.test(last)) return a;
    // gstack-timing-ok: the agent attaches on a timer; this is that timer, bounded
    await Bun.sleep(200);
  }
  throw new Error("attach never printed " + want + "; last: " + last);
}
const plan = (r: Rig) => JSON.parse(readFileSync(join(r.work, "plan.json"), "utf8"));
// The fake prepare-run stages no tars, so each prepared part takes the fixture's judge tar.gz, which the launcher check
// (D14) passes against HM_JUDGE_MANIFEST.
const stageJudgeTars = (r: Rig, tar = r.judgeTar, parts: string[] = plan(r).parts.map((x: any) => x.name)) => { for (const p of parts) copyFileSync(tar, join(r.work, p, "arms/judge.tar.gz")); };
const mirror = (r: Rig) => readRows(join(r.work, "host/ledger.jsonl"));
const events = (r: Rig) => (existsSync(join(r.fake, "events.log")) ? readFileSync(join(r.fake, "events.log"), "utf8") : "");
// host-status over the fake runner's ssh, the way l1.ts status() reads it.
const hostStatus = (r: Rig) => {
  const p = Bun.spawnSync([join(FIX, "ubi"), "ssh", "host-1", "export PATH=\"$HOME/.bun/bin:$PATH\"; bun " + HM.hostRoot + "/laneb/l1/l1.ts host-status " + HM.hostRoot], { env: r.env, stdout: "pipe", stderr: "pipe" });
  return JSON.parse(p.stdout.toString().trim().split("\n").at(-1)!);
};
// prepare, host-up and launch smoke-opus; extra holds fake-vm-run.ts's controls for the smoke part's VM.
function smokeLaunched(r: Rig, extra: Record<string, string> = {}) {
  const p = hm(r, ["prepare", r.work, "--item", ITEM]);
  expect([p.code, p.err]).toEqual([0, ""]);
  stageJudgeTars(r);
  expect(plan(r).parts.map((x: any) => x.name)).toEqual([SMOKE_PART, ...PILOTS]);
  expect(plan(r).host_ttl_hours).toBe(114);
  expect(hm(r, ["host-up", r.work]).code).toBe(0);
  const la = hm(r, ["launch", r.work, "--part", SMOKE_PART], extra);
  expect([la.code, la.out]).toEqual([0, expect.stringContaining(SMOKE_PART + ": controller started on host-1")]);
}

describe("stage3-pilot holds after its smoke part (S1) on the real launcher", () => {
  test("after smoke-opus settles nothing launches on its own: the pilot parts have no launch record or controller, the item stays open, and launch --part pilot-opus still works on the same bound run", async () => {
    const r = rig();
    const early = hm(r, ["prepare", r.work, "--item", ITEM]);
    expect(early.code).toBe(0);
    stageJudgeTars(r);
    expect(hm(r, ["host-up", r.work]).code).toBe(0);
    const outOfOrder = hm(r, ["launch", r.work, "--part", "pilot-opus"]);
    expect([outOfOrder.code, outOfOrder.err]).toEqual([3, expect.stringContaining(SMOKE_PART + " has not finished; parts run one after another")]);
    expect(hm(r, ["launch", r.work, "--part", SMOKE_PART]).code).toBe(0);
    const a = await attachUntil(r, new RegExp("NEXT: rerun --part " + SMOKE_PART + " "));
    expect(a.out).toContain(SMOKE_PART + ": finished, launch exit 0\n");
    const runId = plan(r).run_id;
    expect(JSON.parse(readFileSync(join(r.work, "host/bound.json"), "utf8")).run_id).toBe(runId);
    // The smoke part's session rows carry its own prefix; no row names a pilot part.
    const sessionRows = (rows: any[], part: string) => rows.filter((x) => x.kind === "reserve" && x.id.startsWith(ITEM + "/" + part + "/s"));
    expect(sessionRows(mirror(r), SMOKE_PART)).toHaveLength(2);
    const held = async () => {
      for (const p of PILOTS) {
        expect([p, existsSync(join(r.work, p + ".launch.json")), existsSync(join(r.work, p + ".result.json"))]).toEqual([p, false, false]);
        expect([p, existsSync(join(hostWork(r), p)), existsSync(join(hostWork(r), p + ".controller.json"))]).toEqual([p, false, false]);
        expect([p, mirror(r).filter((x) => x.id.includes(ITEM + "/" + p + "/"))]).toEqual([p, []]);
      }
      const st = hostStatus(r);
      expect(Object.keys(st.parts)).toEqual([SMOKE_PART]);
      expect(st.parts[SMOKE_PART].alive).toBe(false);
      expect(mirror(r).some((x) => x.kind === "note" && x.id === "done")).toBe(false);
    };
    await held();
    // gstack-timing-ok: a hold is the absence of a launch, so wait a few attach intervals and look again
    await Bun.sleep(2_000);
    await held();
    // The attempt 2 check is the only step owed, and after it the next step is a launch someone must run: never done.
    const re = hm(r, ["rerun", r.work, "--part", SMOKE_PART]);
    expect([re.code, re.out]).toEqual([0, expect.stringContaining(SMOKE_PART + ": no cell owes section 13's attempt 2. NEXT: launch --part pilot-opus")]);
    const again = hm(r, ["attach", r.work]);
    expect(again.out).toContain("NEXT: launch --part pilot-opus");
    expect(again.out).not.toContain("every part has finished");
    await held();
    // The same bound run takes the next launch.
    const go = hm(r, ["launch", r.work, "--part", "pilot-opus"]);
    expect([go.code, go.out]).toEqual([0, expect.stringContaining("pilot-opus: controller started on host-1")]);
    expect(JSON.parse(readFileSync(join(r.work, "host/bound.json"), "utf8")).run_id).toBe(runId);
    expect(plan(r).run_id).toBe(runId);
    await attachUntil(r, /NEXT: rerun --part pilot-opus /);
    expect(sessionRows(mirror(r), "pilot-opus")).toHaveLength(24);
    for (const p of ["pilot-sol", "pilot-p1"]) expect([p, existsSync(join(r.work, p + ".launch.json"))]).toEqual([p, false]);
  }, 240_000);

  test("host-up, launch and relaunch refuse a judge part whose tar fails the launcher check, and start nothing (D14)", () => {
    const r = rig(), placeholder = judgeTarFixture({ placeholder: true }).tarGz;
    expect(hm(r, ["prepare", r.work, "--item", ITEM]).code).toBe(0);
    stageJudgeTars(r);
    stageJudgeTars(r, placeholder, ["pilot-p1"]);
    const up = hm(r, ["host-up", r.work]);
    expect([up.code, up.err]).toEqual([2, expect.stringContaining("E_HM_JUDGE_BUILD " + ITEM + ": the judge tar " + join(r.work, "pilot-p1/arms/judge.tar.gz") + " fails the launcher check (the tar.gz is sha256 ")]);
    expect(up.out.split("\n").filter((l) => l.startsWith("HM_JUDGE_TAR PASS"))).toHaveLength(3);
    expect(events(r)).not.toMatch(/ up /);
    stageJudgeTars(r, r.judgeTar, ["pilot-p1"]);
    const up2 = hm(r, ["host-up", r.work]);
    expect(up2.code).toBe(0);
    expect(up2.out.split("\n").filter((l) => l.startsWith("HM_JUDGE_TAR PASS"))).toHaveLength(4);
    stageJudgeTars(r, placeholder, [SMOKE_PART]);
    const la = hm(r, ["launch", r.work, "--part", SMOKE_PART]);
    expect([la.code, la.err]).toEqual([2, expect.stringContaining("E_HM_JUDGE_BUILD " + ITEM + ": the judge tar " + join(r.work, SMOKE_PART, "arms/judge.tar.gz") + " fails the launcher check")]);
    expect(existsSync(join(r.work, SMOKE_PART + ".launch.json"))).toBe(false);
    const re = hm(r, ["relaunch", r.work, "--part", SMOKE_PART]);
    expect([re.code, re.err]).toEqual([2, expect.stringContaining("E_HM_JUDGE_BUILD " + ITEM + ": the judge tar " + join(r.env.ARMS!, "judge.tar.gz") + " fails the launcher check (no judge tar at ")]);
  }, 120_000);

  test("a host lost while the smoke part runs: recover refuses because the part has judge arms, and destroys nothing (E1)", async () => {
    const r = rig();
    smokeLaunched(r, { PAUSE_VM: "vm-2", PAUSE_AT: "1" });
    await until(() => existsSync(join(r.fake, "vm-2/paused")));
    writeFileSync(join(r.fake, "host-1", ".dead"), "");
    killController(r, "host-1", SMOKE_PART);
    Bun.spawnSync(["pkill", "-9", "-f", join(r.fake, "host-1")]);
    await until(() => existsSync(join(r.fake, "vm-2/work/run/out/vm-run.exit")));
    for (let i = 1; i <= 2; i++) expect(hm(r, ["attach", r.work]).out).toContain("did not answer (" + i + " of 3)");
    expect(hm(r, ["attach", r.work], { L1_UNREACHABLE_MINUTES: "0" }).code).toBe(5);
    const before = events(r);
    const rec = hm(r, ["recover", r.work]);
    expect(rec.code).toBe(3);
    expect(rec.err).toContain(SMOKE_PART + " has judge arms: its judge:" + ITEM + "/" + SMOKE_PART + "/ ledger rows after the last mirror lived only on the lost host and are in no session record, so recover can't rebuild them; nothing was destroyed. Settle it by hand: lanes/harness-mechanics/README.md, \"Live judge wiring\"");
    expect(events(r).slice(before.length)).not.toMatch(/ down /);
    expect(existsSync(join(r.work, "host/recover.json"))).toBe(false);
    expect(existsSync(resolve(r.ledger))).toBe(false);
  }, 240_000);
});
