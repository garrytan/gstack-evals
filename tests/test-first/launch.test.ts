// Copyright (c) 2026 Garry Tan. MIT License.
// B2's launcher end to end and keyless, on the fake awake host quick/laneb's L1 tests use: fixtures/l1/ubi plays ubi-runner
// (each VM a directory, ssh runs the real host.sh, launch.sh and ledger service in it) and fake-vm-run.ts plays vm-run.sh.
// The real b2 CLI runs B2's prepare (Lane B's prepare played by fixtures/fake-prepare-run.ts, then B2's own rewrite), its
// launch guard with this thread's counter, and l1.ts under B2_PROFILE on the real b2-pilot plan: a refused host-up with no
// counter and with a counter past the all-in stop, host-up, launch pilot-opus, attach until it settles, a counted item's
// host-up refused before the pilot is done, and host-down.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRows } from "../../quick/laneb/runner/ledger.ts";
import { sha256 } from "../../quick/laneb/l1/l1.ts";
import { approve } from "../../lanes/test-first/money.ts";
import { CAPS_USD, REPO } from "../../lanes/test-first/pins.ts";
import { AGENT } from "../../lanes/test-first/prepare-run.ts";

const FIX = join(REPO, "quick/laneb/tests/fixtures/l1"), CLI = join(REPO, "lanes/test-first/cli.ts");
function freePort() { const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }), p = s.port; s.stop(true); return p; }
type Rig = { root: string; fake: string; work: string; ledgers: string; env: Record<string, string> };
const rigs: Rig[] = [], roots: string[] = [];
function rig(): Rig {
  const root = mkdtempSync(join(tmpdir(), "b2-launch-")), fake = join(root, "vms"), ledgers = join(root, "ledgers");
  for (const d of [fake, join(root, "recovery"), join(root, "state"), join(root, "arms"), ledgers]) mkdirSync(d, { recursive: true });
  approve(join(ledgers, "b2-pilot.jsonl"), "b2-pilot", CAPS_USD["b2-pilot"], "test");
  approve(join(ledgers, "b2-opus.jsonl"), "b2-opus", CAPS_USD["b2-opus"], "test");
  const env: Record<string, string> = {
    PATH: FIX + ":" + process.env.PATH, HOME: process.env.HOME ?? root,
    UBI_FAKE: fake, UBI_RUNNER: join(FIX, "ubi"), UBI_RUNNER_SHA256: sha256(readFileSync(join(FIX, "ubi"))), UBI_RUNNER_STATE: join(root, "state"), UBI_RECOVERY_DIR: join(root, "recovery"), UBI_OWNER: "GEVA-569",
    ARMS: join(root, "arms"), B2_LEDGERS: ledgers, B2_LANEB_PREPARE: join(import.meta.dir, "fixtures/fake-prepare-run.ts"),
    L1_HOST_LEDGER_PORT: String(freePort()), L1_BUNDLE_WAIT_SEC: "30", L1_POLL_SEC: "0.2", L1_SALVAGE_WAIT_SEC: "30", PULL_RETRY_SEC: "0",
    ANTHROPIC_API_KEY: "test-not-a-key", OPENROUTER_API_KEY: "test-not-a-key", OPENAI_API_KEY: "test-not-a-key", UBICLOUD_API_KEY: "test-not-a-key",
  };
  const r = { root, fake, work: join(root, "work"), ledgers, env };
  rigs.push(r);
  roots.push(root);
  return r;
}
afterEach(() => { for (const r of rigs.splice(0)) Bun.spawnSync(["pkill", "-9", "-f", r.root]); });
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function b2(r: Rig, args: string[], extra: Record<string, string> = {}) {
  const p = Bun.spawnSync([process.execPath, CLI, ...args], { env: { ...r.env, ...extra }, cwd: REPO, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
async function attachUntil(r: Rig, work: string, want: RegExp) {
  let last = "";
  for (let i = 0; i < 300; i++) {
    const a = b2(r, ["attach", work]);
    last = a.out + a.err;
    if (want.test(last)) return a;
    // gstack-timing-ok: the agent attaches on a timer; this is that timer, bounded
    await Bun.sleep(200);
  }
  throw new Error("attach never printed " + want + "; last: " + last);
}
const events = (r: Rig) => (existsSync(join(r.fake, "events.log")) ? readFileSync(join(r.fake, "events.log"), "utf8") : "");
const COUNTER = ["--counter-usd", "10", "--counter-as-of", "2026-11-21T09:00Z"];

describe("b2-pilot on the real launcher", () => {
  test("prepare rewrites Sol's agents; host-up refuses with no counter or past the stop; pilot-opus runs and settles; a counted item waits for the pilot; host-down tears the host down", async () => {
    const r = rig();
    const p = b2(r, ["prepare", r.work, "--item", "b2-pilot"], { LEDGER: join(r.ledgers, "b2-pilot.jsonl") });
    expect([p.code, p.err]).toEqual([0, ""]);
    const plan = JSON.parse(readFileSync(join(r.work, "plan.json"), "utf8"));
    expect(plan.parts.map((x: any) => x.name)).toEqual(["pilot-opus", "pilot-sol", "pilot-p1"]);
    const job = (part: string) => JSON.parse(readFileSync(join(r.work, part, "job.json"), "utf8"));
    expect(new Set(job("pilot-opus").agents.map((a: any) => a.name))).toEqual(new Set(["laneb-claude-code"]));
    const sol = job("pilot-sol").agents;
    expect(sol.map((a: any) => [a.name, a.kwargs.arm, a.kwargs.told_skill ?? ""]).sort()).toEqual([[AGENT.name, "cx-gstack", ""], [AGENT.name, "cx-line", ""], [AGENT.name, "cx-none", ""], [AGENT.name, "cx-prove-it", "prove-it"]]);
    expect(JSON.parse(readFileSync(join(r.work, "pilot-sol", "manifest.json"), "utf8")).b2.host).toBe("codex");

    const env = { LEDGER: join(r.ledgers, "b2-pilot.jsonl") };
    const none = b2(r, ["host-up", r.work], env);
    expect([none.code, none.err]).toEqual([2, expect.stringContaining("E_USAGE b2 guard: pass --counter-usd")]);
    const far = b2(r, ["host-up", r.work, "--counter-usd", "1800", "--counter-as-of", "t"], env);
    expect([far.code, far.err]).toEqual([2, expect.stringContaining("E_B2_LAUNCH b2-pilot: all-in")]);
    expect(events(r)).not.toMatch(/ up /);
    const up = b2(r, ["host-up", r.work, ...COUNTER], env);
    expect([up.code, up.out]).toEqual([0, expect.stringContaining("B2_LAUNCH PASS b2-pilot")]);

    const la = b2(r, ["launch", r.work, "--part", "pilot-opus", ...COUNTER], env);
    expect([la.code, la.out]).toEqual([0, expect.stringContaining("pilot-opus: controller started on host-1")]);
    const a = await attachUntil(r, r.work, /NEXT: rerun --part pilot-opus /);
    expect(a.out).toContain("pilot-opus: finished, launch exit 0\n");
    const mirror = readRows(join(r.work, "host/ledger.jsonl"));
    expect(mirror.filter((x) => x.kind === "reserve" && x.id.startsWith("b2-pilot/pilot-opus/s"))).toHaveLength(12);

    const counted = join(r.root, "work-opus");
    expect(b2(r, ["prepare", counted, "--item", "b2-opus"], { LEDGER: join(r.ledgers, "b2-opus.jsonl") }).code).toBe(0);
    const early = b2(r, ["host-up", counted, ...COUNTER], { LEDGER: join(r.ledgers, "b2-opus.jsonl") });
    expect([early.code, early.err]).toEqual([2, expect.stringContaining("b2-pilot is not marked done")]);

    const down = b2(r, ["host-down", r.work], env);
    expect(down.code).toBe(0);
    const ups = [...events(r).matchAll(/ up (\S+)/g)].map((m) => m[1]), downs = [...events(r).matchAll(/ down (\S+)/g)].map((m) => m[1]);
    expect(ups.length).toBeGreaterThan(0);
    expect(downs).toEqual(expect.arrayContaining(["host-1"]));
  }, 300_000);
});
