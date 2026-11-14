// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's launcher on stage3/fake.ts's simulated Ubicloud, with every SSH command run locally (a local SSH
// stand-in): launch with the real service started detached by setsid, relaunch on the same host, a lost host
// recovered from the off-host copy, teardown, and VM cleanup on every failure path. No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controllerProvision, launch, layout, planProblems, recoverHost, relaunch, serviceEnv, teardown, type ControllerPlan, type HostRecord } from "../../../lanes/design-constructed/money/controller-host.ts";
import { makeRecord } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { recordTar } from "../../../lanes/design-constructed/money/ledger-service.ts";
import { WALCTL_PY } from "../../../lanes/design-constructed/money/offhost.ts";
import { fakeBackend, fakeWorld, type FakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { runProcess } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";

const ENTRY = join(import.meta.dir, "../../../lanes/design-constructed/money/host-main.ts");
const FAKE_KEYS = { ANTHROPIC_API_KEY: "test-not-a-key-anthropic", OPENAI_API_KEY: "test-not-a-key-openai", OPENROUTER_API_KEY: "test-not-a-key-openrouter", UBICLOUD_API_KEY: "test-not-a-key-ubicloud" };

const dirs: string[] = [];
const pids: number[] = [];
afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Every SSH command runs on this machine; failOn names commands (by substring) that exit 1 instead. */
function world(o: { failOn?: string[]; api?: FakeWorld["api"] } = {}): FakeWorld {
  return fakeWorld({
    api: o.api,
    ssh: async (_vm, command, input) => {
      if (o.failOn?.some((s) => command.includes(s))) return { exit: 1, stdout: "", stderr: "stand-in failure" };
      const r = await runProcess(["bash", "-c", command], { input, timeoutMs: 60_000 });
      return { exit: r.exit, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr, raw: r.stdout };
    },
  });
}

function plan(over: Partial<ControllerPlan> = {}): ControllerPlan & { tmp: string } {
  const tmp = mkdtempSync(join(tmpdir(), "dc-ctl-"));
  dirs.push(tmp);
  mkdirSync(join(tmp, "src", "repo"), { recursive: true });
  writeFileSync(join(tmp, "src", "repo", "README.md"), "fixture repository\n");
  const repoTar = new Uint8Array(Bun.spawnSync(["tar", "-C", join(tmp, "src", "repo"), "-cf", "-", "."]).stdout);
  mkdirSync(join(tmp, "src", "approval"), { recursive: true });
  const record = makeRecord(join(tmp, "src", "approval"));
  const walRoot = join(tmp, "walhost");
  mkdirSync(walRoot, { recursive: true });
  return {
    tmp,
    runId: "dc-host-test",
    owner: "test-owner",
    longestStageHours: 24,
    ttlHours: 30,
    priceMicrosPerHour: { controller: 60_000, wal: 20_000 },
    commit: "0123456789abcdef0123456789abcdef01234567",
    repoTar,
    recordTar: recordTar(record),
    root: join(tmp, "host"),
    wal: { dir: join(walRoot, "data"), script: join(walRoot, "walctl.py"), owner: null, authorizedKeys: join(walRoot, "authorized_keys") },
    provision: () => ["set -e", "echo provisioned"],
    bun: process.execPath,
    entry: ENTRY,
    tickMs: 200,
    drainMs: 100,
    target: () => ({ kind: "local", script: join(walRoot, "walctl.py"), dir: join(walRoot, "data") }),
    upWaitMs: 20_000,
    ...over,
  };
}

const env = () => serviceEnv(FAKE_KEYS, "test-owner");
const pidOf = (p: ControllerPlan) => Number(readFileSync(layout(p.runId, p.root).pid, "utf8"));
async function gone(file: string, ms = 15_000) {
  for (const until = Date.now() + ms; Date.now() < until && existsSync(file); ) await Bun.sleep(100);
  return !existsSync(file);
}
const allDeleted = (w: FakeWorld) => w.vms.every((v) => w.deleted.includes(v.id));
const grepKeys = (dir: string) => runProcess(["grep", "-rl", "test-not-a-key", dir]).then((r) => new TextDecoder().decode(r.stdout).trim());

describe("the controller host launcher", () => {
  test("the plan refuses a time to live that does not cover the longest stage, and env carries keys by name only", () => {
    const p = plan({ ttlHours: 24 });
    expect(planProblems(p).join(";")).toContain("does not cover the longest stage");
    expect(() => serviceEnv({}, "o")).toThrow("ANTHROPIC_API_KEY is not set");
    expect(new TextDecoder().decode(env()).split("\n")[0]).toBe("UBI_OWNER=test-owner");
    expect(controllerProvision({ bunVersion: "1.4.4", mirrors: false })({ privateIp: null, layout: layout("r") }).join("\n")).toContain("bun-v1.4.4");
    expect(() => controllerProvision({ bunVersion: "1.4.4", mirrors: true })({ privateIp: null, layout: layout("r") })).toThrow("no private IPv4");
  });

  test("launch, relaunch on the same host, host loss and recovery, then teardown deletes every VM", async () => {
    const w = world();
    const b = fakeBackend(w);
    const p = plan();
    const l = layout(p.runId, p.root);
    const rec: HostRecord = await launch(b, p, env());
    pids.push(pidOf(p));
    expect(w.vms.map((v) => v.id.split("-")[0])).toEqual(["dcwal", "dcctl"]);
    expect([rec.controller.vm.startsWith("dcctl-test-owner-"), rec.captain]).toEqual([true, null]);
    expect(JSON.parse(readFileSync(l.status, "utf8")).boot).toBe("fresh");
    expect(readFileSync(p.wal!.authorizedKeys!, "utf8")).toContain('command="python3 ' + p.wal!.script);
    expect(await grepKeys(p.tmp)).toBe("");

    expect((await relaunch(b, p, rec, env())).kind).toBe("running");
    const ino = statSync(l.ledger).ino;
    const lease = JSON.parse(readFileSync(l.status, "utf8")).items[0].leaseId;
    process.kill(pidOf(p), "SIGTERM");
    expect(await gone(l.pid)).toBe(true);
    const again = await relaunch(b, p, rec, env());
    pids.push(pidOf(p));
    expect(again.kind === "relaunched" && again.status.boot).toBe("same-host");
    expect(statSync(l.ledger).ino).toBe(ino);

    process.kill(pidOf(p), "SIGKILL");
    rmSync(p.root!, { recursive: true, force: true });
    w.deleted.push(rec.controller.vm);
    const lost = rec.controller.vm;
    const back = await recoverHost(b, p, rec, env());
    pids.push(pidOf(p));
    expect(back.kind === "recovered" && back.status.boot).toBe("restored");
    expect(rec.controller.vm).not.toBe(lost);
    expect(JSON.parse(readFileSync(l.status, "utf8")).items[0].leaseId).toBe(lease);
    expect(existsSync(join(l.record, "items"))).toBe(true);

    const t = await teardown(b, p, rec, { waitMs: 30_000 });
    expect(t.kind).toBe("deleted");
    if (t.kind === "deleted") {
      expect(new TextDecoder().decode(t.archive.lines).split("\n").filter(Boolean).length).toBeGreaterThan(3);
      expect(t.archive.snapshot?.name).toMatch(/^snap-\d{10}$/);
      expect(t.archive.record?.length).toBeGreaterThan(0);
    }
    expect(allDeleted(w)).toBe(true);
    expect(await gone(l.pid)).toBe(true);
    expect(await grepKeys(p.tmp)).toBe("");
  }, 120_000);

  test("a launch writes its record of the controller host (the VM, the region and the private IPv4) into the state folder, and a recovery plan in another region refuses before it makes a VM", async () => {
    // Value: protects=the runbook's late-address gap and PD-42: the host learns its private IPv4 and region from the launch, and a recovery never moves the hosts' region; fails_when=no record is written, it holds another VM's address or no region, or a recovery in another region creates a VM; why_new=the address existed only on the launcher's side; seam=launch, prepareController, recoverHost; no_claim=a real Ubicloud private subnet
    const w = world();
    const b = fakeBackend(w);
    const at = new Map<string, string>();
    b.privateAddress = (vm) => at.get(vm.id) ?? (at.set(vm.id, "10.9.0." + (at.size + 5)), at.get(vm.id)!);
    const p = plan({ location: "eu-central-h1" });
    const rec = await launch(b, p, env());
    pids.push(pidOf(p));
    expect(JSON.parse(readFileSync(layout(p.runId, p.root).controller, "utf8"))).toEqual({ vm: rec.controller.vm, location: "eu-central-h1", privateIp: at.get(rec.controller.vm) });
    expect(rec.location).toBe("eu-central-h1");
    process.kill(pidOf(p), "SIGKILL");
    w.deleted.push(rec.controller.vm);
    const made = w.vms.length;
    await expect(recoverHost(b, { ...p, location: "us-east-a2" }, rec, env())).rejects.toThrow("a recovery never moves a stage to another region");
    expect(w.vms.length).toBe(made);
  }, 60_000);

  test("a recovery refuses while the host runs, and stops for the Captain when the WAL host is gone", async () => {
    const w = world();
    const b = fakeBackend(w);
    const p = plan();
    const rec = await launch(b, p, env());
    pids.push(pidOf(p));
    await expect(recoverHost(b, p, rec, env())).rejects.toThrow("still runs");
    w.deleted.push(rec.controller.vm, rec.wal.vm);
    expect((await recoverHost(b, p, rec, env())).kind).toBe("captain");
  }, 60_000);

  const failing: Array<[string, () => { w: FakeWorld; p: ControllerPlan }, string, number]> = [
    ["the WAL host's start fails", () => ({ w: world({ failOn: [" init"] }), p: plan() }), "starting the write-ahead copy failed", 1],
    ["provisioning fails", () => ({ w: world(), p: plan({ provision: () => ["exit 7"] }) }), "provisioning the controller host failed", 2],
    ["Ubicloud's API drops while the controller host starts", () => ({ w: world({ api: { GET: { throws: "network down", nth: 2 } } }), p: plan() }), "network down", 2],
    ["the service never writes a status", () => ({ w: world(), p: plan({ entry: "missing/host-main.ts", upWaitMs: 1500 }) }), "wrote no status", 2],
  ];
  for (const [name, make, why, made] of failing) {
    test("a launch whose " + name + " deletes every VM it made", async () => {
      const { w, p } = make();
      await expect(launch(fakeBackend(w), p, env())).rejects.toThrow(why);
      expect(w.vms.length).toBe(made);
      expect(allDeleted(w)).toBe(true);
    }, 60_000);
  }
});
