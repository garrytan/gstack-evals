import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";

// launch.sh against a fake ubi-runner and a fake ssh (fixtures/launch/): the "VM" is a local directory.
function freePort() {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = s.port;
  s.stop(true);
  return port;
}

function rig(opts: { failPull?: boolean; dropSsh?: boolean; finish?: number; failBootstrap?: boolean; slowBootstrap?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "laneb-launch-"));
  const vm = join(root, "vm");
  const bin = join(root, "bin");
  const run = join(root, "run");
  const state = join(root, "state");
  for (const d of [vm, bin, run, state]) mkdirSync(d, { recursive: true });
  writeFileSync(join(run, "manifest.json"), "{}");
  const events = join(root, "events.log");
  const port = freePort();
  for (const f of ["ubi", "ssh"]) {
    copyFileSync(join(import.meta.dir, "fixtures", "launch", f), join(bin, f));
    chmodSync(join(bin, f), 0o755);
  }
  const ledgerPath = join(root, "ledger.jsonl");
  const ledger = new Ledger(ledgerPath, "laneb-quick");
  ledger.approve(10, { quotes: ["test"] });
  ledger.reserve("p-s-1", toMicros(1));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, UBI_RUNNER: join(bin, "ubi"), UBI_RUNNER_STATE: state, LEDGER: ledgerPath, LEDGER_PORT: String(port), EVENTS: events, VM: vm, STATE: state, PULL_RETRY_SEC: "0", FAIL_PULL: opts.failPull ? "1" : "", DROP_SSH: opts.dropSsh ? "1" : "", FINISH: opts.finish === undefined ? "" : String(opts.finish), FAIL_BOOTSTRAP: opts.failBootstrap ? "1" : "", SLOW_BOOTSTRAP: opts.slowBootstrap ? "1" : "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
  return { root, vm, run, events, ledgerPath, env };
}

const LAUNCH = join(import.meta.dir, "../runner/launch.sh");
const events = (r: ReturnType<typeof rig>) => (existsSync(r.events) ? readFileSync(r.events, "utf8").trim().split("\n") : []);

async function interruptDuringBatch(r: ReturnType<typeof rig>, cmd = ["bash", LAUNCH, r.run, "p-", "5"]) {
  const proc = Bun.spawn(cmd, { env: r.env, stdout: "pipe", stderr: "pipe" });
  for (let i = 0; i < 300 && !existsSync(join(r.vm, "started")); i++) await Bun.sleep(50);
  await Bun.sleep(300);
  proc.kill("SIGINT");
  const timer = setTimeout(() => proc.kill("SIGKILL"), 40_000);
  const code = await proc.exited;
  clearTimeout(timer);
  const stderr = await new Response(proc.stderr).text();
  return { code, stderr, events: events(r) };
}

async function runToEnd(r: ReturnType<typeof rig>) {
  const proc = Bun.spawn(["bash", LAUNCH, r.run, "p-", "5"], { env: r.env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill("SIGKILL"), 40_000);
  const code = await proc.exited;
  clearTimeout(timer);
  const stderr = await new Response(proc.stderr).text();
  return { code, stderr, events: events(r) };
}

describe("launch.sh without an interrupt", () => {
  test("pulled x no_interrupt: once vm-run.exit exists it pulls, counts, reconciles, destroys the VM and exits with the batch's code", async () => {
    const r = rig({ finish: 3 });
    const { code, events } = await runToEnd(r);
    const at = (prefix: string) => events.findIndex((e) => e.startsWith(prefix));
    expect(events.some((e) => e.includes("STOP"))).toBe(false);
    expect(at("pull vm-1 work/run/out")).toBeGreaterThan(at("batch ended"));
    expect(at("down vm-1")).toBeGreaterThan(at("pull vm-1 work/run/jobs"));
    expect(existsSync(join(r.run, "pulled", "jobs", "j", "t__1", "reward.txt"))).toBe(true);
    expect(readRows(r.ledgerPath).at(-1)).toMatchObject({ kind: "settle", id: "p-s-1", usd_micros: 1234, reconciled: true });
    expect(code).toBe(3);
  }, 60_000);

  test("not_started x no_interrupt: a failure before the batch starts destroys the VM and stops the ledger service", async () => {
    const r = rig({ failBootstrap: true });
    const { code, events } = await runToEnd(r);
    expect(events).not.toContain("batch started");
    expect(events).toContain("down vm-1");
    let serving = true;
    for (let i = 0; i < 50 && serving; i++) {
      serving = Bun.spawnSync(["pgrep", "-f", r.ledgerPath]).exitCode === 0;
      // gstack-timing-ok: a bounded poll for the outcome (the ledger service exits once finish() kills it), not a fixed wait
      if (serving) await Bun.sleep(20);
    }
    expect(serving).toBe(false);
    expect(readRows(r.ledgerPath).filter((x) => x.kind === "settle")).toHaveLength(0);
    expect(code).toBe(1);
  }, 60_000);

  test("pull_failed x no_interrupt: vm-run.exit exists but the pull fails, so the VM is kept, the commands are printed and it exits 7", async () => {
    const r = rig({ failPull: true, finish: 0 });
    const { code, stderr, events } = await runToEnd(r);
    expect(events).toContain("batch ended");
    expect(stderr.match(/pull attempt \d failed/g)).toHaveLength(3);
    expect(events.some((e) => e.startsWith("down"))).toBe(false);
    expect(stderr).toContain("VM vm-1 is kept");
    expect(readRows(r.ledgerPath).filter((x) => x.kind === "settle")).toHaveLength(0);
    expect(code).toBe(7);
  }, 60_000);

  test("a run dir that already holds pulled/ from an earlier launch is refused before any VM exists", async () => {
    const r = rig({ finish: 0 });
    mkdirSync(join(r.run, "pulled", "out"), { recursive: true });
    const { code, stderr, events } = await runToEnd(r);
    expect(stderr).toContain(`${r.run}/pulled exists from an earlier launch`);
    expect(events.some((e) => e.startsWith("up"))).toBe(false);
    expect(code).toBe(2);
  }, 60_000);
});

describe("launch.sh on interrupt", () => {
  test("not_started x interrupt: an interrupt before the batch starts exits 130, writes no STOP and destroys the VM", async () => {
    const r = rig({ slowBootstrap: true });
    const proc = Bun.spawn(["bash", LAUNCH, r.run, "p-", "5"], { env: r.env, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 300 && !existsSync(join(r.vm, "bootstrapping")); i++) await Bun.sleep(50);
    proc.kill("SIGINT");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 40_000);
    const code = await proc.exited;
    clearTimeout(timer);
    const stderr = await new Response(proc.stderr).text();
    expect(events(r).some((e) => e.includes("STOP"))).toBe(false);
    expect(events(r)).not.toContain("batch started");
    expect(events(r)).toContain("down vm-1");
    expect(stderr).toContain("interrupted before the batch started: nothing to pull; the VM is destroyed");
    expect(stderr).not.toContain("results are pulled");
    expect(code).toBe(130);
  }, 60_000);

  test("stops the batch, keeps the ledger up until sessions close, pulls, reconciles, then destroys the VM", async () => {
    const r = rig({});
    const { code, events } = await interruptDuringBatch(r);
    const at = (prefix: string) => events.findIndex((e) => e.startsWith(prefix));
    expect(at("ssh vm-1 touch work/run/STOP")).toBeGreaterThan(at("batch started"));
    expect(events).toContain("ledger up at close");
    expect(at("pull vm-1 work/run/out")).toBeGreaterThan(at("batch ended"));
    expect(at("down vm-1")).toBeGreaterThan(at("pull vm-1 work/run/jobs"));
    expect(existsSync(join(r.run, "pulled", "jobs", "j", "t__1", "reward.txt"))).toBe(true);
    expect(readRows(r.ledgerPath).at(-1)).toMatchObject({ kind: "settle", id: "p-s-1", usd_micros: 1234, reconciled: true });
    expect(code).toBe(130);
  }, 60_000);

  test("keeps the VM and prints the pull commands when the pull fails", async () => {
    const r = rig({ failPull: true });
    const { code, stderr, events } = await interruptDuringBatch(r);
    expect(events.some((e) => e.startsWith("down"))).toBe(false);
    expect(stderr).toContain("VM vm-1 is kept");
    expect(stderr).toContain("pull vm-1 work/run/out");
    expect(stderr).toContain(`reconcile with: bun ${join(import.meta.dir, "../runner")}/ledger.ts reconcile --path ${r.ledgerPath} --item laneb-quick --sessions ${r.run}/pulled/out/proxy-sessions.jsonl --prefix p-; then:`);
    expect(readRows(r.ledgerPath).filter((x) => x.kind === "settle")).toHaveLength(0);
    expect(code).toBe(130);
  }, 60_000);

  test("still stops the batch, pulls and destroys the VM when stderr is a broken pipe", async () => {
    const r = rig({});
    const { code, events } = await interruptDuringBatch(r, ["bash", "-c", 'exec bash "$0" "$@" 2> >(exit 0)', LAUNCH, r.run, "p-", "5"]);
    const at = (prefix: string) => events.findIndex((e) => e.startsWith(prefix));
    expect(at("ssh vm-1 touch work/run/STOP")).toBeGreaterThan(at("batch started"));
    expect(at("down vm-1")).toBeGreaterThan(at("pull vm-1 work/run/jobs"));
    expect(readRows(r.ledgerPath).at(-1)).toMatchObject({ kind: "settle", id: "p-s-1", reconciled: true });
    expect(code).toBe(130);
  }, 60_000);
});

describe("launch.sh when the batch connection drops", () => {
  test("keeps the VM and pulls nothing while vm-run.sh has not finished", async () => {
    const r = rig({ dropSsh: true });
    const proc = Bun.spawn(["bash", LAUNCH, r.run, "p-", "5"], { env: r.env, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill("SIGKILL"), 40_000);
    const code = await proc.exited;
    clearTimeout(timer);
    const stderr = await new Response(proc.stderr).text();
    expect(events(r)).toContain("ssh dropped");
    expect(stderr.match(/pull attempt \d: vm-run.sh has not finished \(no work\/run\/out\/vm-run.exit\)/g)).toHaveLength(3);
    expect(stderr).not.toContain("failed");
    expect(events(r).some((e) => e.startsWith("pull") || e.startsWith("down"))).toBe(false);
    expect(stderr).toContain("VM vm-1 is kept");
    expect(readRows(r.ledgerPath).filter((x) => x.kind === "settle")).toHaveLength(0);
    expect(code).toBe(7);
  }, 60_000);

  test("not_finished x interrupt: an interrupt after the drop writes STOP, pulls nothing, keeps the VM and exits 130", async () => {
    const r = rig({ dropSsh: true });
    r.env.PULL_RETRY_SEC = "1";
    const proc = Bun.spawn(["bash", LAUNCH, r.run, "p-", "5"], { env: r.env, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 300 && !events(r).includes("ssh dropped"); i++) await Bun.sleep(50);
    proc.kill("SIGINT");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 40_000);
    const code = await proc.exited;
    clearTimeout(timer);
    const stderr = await new Response(proc.stderr).text();
    expect(events(r)).toContain("ssh vm-1 touch work/run/STOP");
    expect(events(r).some((e) => e.startsWith("pull") || e.startsWith("down"))).toBe(false);
    expect(stderr).toContain("VM vm-1 is kept");
    expect(readRows(r.ledgerPath).filter((x) => x.kind === "settle")).toHaveLength(0);
    expect(code).toBe(130);
  }, 60_000);
});
