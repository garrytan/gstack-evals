import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";

// launch.sh against a fake ubi-runner and a fake ssh (fixtures/launch/): the "VM" is a local directory.
function rig(opts: { failPull?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "laneb-launch-"));
  const vm = join(root, "vm");
  const bin = join(root, "bin");
  const run = join(root, "run");
  const state = join(root, "state");
  for (const d of [vm, bin, run, state]) mkdirSync(d, { recursive: true });
  writeFileSync(join(run, "manifest.json"), "{}");
  const events = join(root, "events.log");
  const port = 20000 + Math.floor(Math.random() * 20000);
  for (const f of ["ubi", "ssh"]) {
    copyFileSync(join(import.meta.dir, "fixtures", "launch", f), join(bin, f));
    chmodSync(join(bin, f), 0o755);
  }
  const ledgerPath = join(root, "ledger.jsonl");
  const ledger = new Ledger(ledgerPath, "laneb-quick");
  ledger.approve(10, { quotes: ["test"] });
  ledger.reserve("p-s-1", toMicros(1));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, UBI_RUNNER: join(bin, "ubi"), UBI_RUNNER_STATE: state, LEDGER: ledgerPath, LEDGER_PORT: String(port), EVENTS: events, VM: vm, STATE: state, PULL_RETRY_SEC: "0", FAIL_PULL: opts.failPull ? "1" : "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
  return { root, vm, run, events, ledgerPath, env };
}

async function interruptDuringBatch(r: ReturnType<typeof rig>) {
  const proc = Bun.spawn(["bash", join(import.meta.dir, "../runner/launch.sh"), r.run, "p-", "5"], { env: r.env, stdout: "pipe", stderr: "pipe" });
  for (let i = 0; i < 300 && !existsSync(join(r.vm, "started")); i++) await Bun.sleep(50);
  await Bun.sleep(300);
  proc.kill("SIGINT");
  const timer = setTimeout(() => proc.kill("SIGKILL"), 40_000);
  const code = await proc.exited;
  clearTimeout(timer);
  const stderr = await new Response(proc.stderr).text();
  return { code, stderr, events: readFileSync(r.events, "utf8").trim().split("\n") };
}

describe("launch.sh on interrupt", () => {
  test("stops the batch, keeps the ledger up until sessions close, pulls, reconciles, then destroys the VM", async () => {
    const r = rig({});
    const { code, events } = await interruptDuringBatch(r);
    const at = (prefix: string) => events.findIndex((e) => e.startsWith(prefix));
    expect(at("ssh vm-1 pkill")).toBeGreaterThan(at("batch started"));
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
    expect(readRows(r.ledgerPath).filter((x) => x.kind === "settle")).toHaveLength(0);
    expect(code).toBe(130);
  }, 60_000);
});
