// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's launcher on stage3/fake.ts's simulated Ubicloud, with every SSH command run locally (a local SSH
// stand-in): launch with the real service started detached by setsid, rows sent in sequence to the running service,
// relaunch on the same host, a lost host recovered from the off-host copy, teardown that seals the work folder with
// age, the work folder's tmpfs custody (PD-41), and VM cleanup on every failure path. No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGE_HEADER, controllerProvision, hostStatus, launch, layout, planProblems, recoverHost, relaunch, repoBundle, repoTree, rowLog, sendRow, serviceEnv, teardown, tmpfsLine, type ControllerPlan, type HostRecord } from "../../../lanes/design-constructed/money/controller-host.ts";
import type { RowRecord } from "../../../lanes/design-constructed/money/host-main.ts";
import { commitAll, makeRecord } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { recordTar } from "../../../lanes/design-constructed/money/ledger-service.ts";
import { WALCTL_PY } from "../../../lanes/design-constructed/money/offhost.ts";
import { fakeBackend, fakeWorld, type FakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { runProcess } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";
import { ageKeys, openSealed } from "../../../lanes/design-constructed/wire/dryrun-host.ts";

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

/** Every SSH command runs on this machine; failOn names commands (by substring) that exit 1 instead, answer ones answered with exit 0. */
function world(o: { failOn?: string[]; answer?: string[]; say?: Array<[string, string]>; api?: FakeWorld["api"] } = {}): FakeWorld & { answered: string[] } {
  const answered: string[] = [];
  const w = fakeWorld({
    api: o.api,
    ssh: async (_vm, command, input) => {
      if (o.failOn?.some((s) => command.includes(s))) return { exit: 1, stdout: "", stderr: "stand-in failure" };
      if (o.answer?.some((s) => command.includes(s))) return (answered.push(command), { exit: 0, stdout: "", stderr: "" });
      const said = o.say?.find(([s]) => command.includes(s));
      if (said) return { exit: 0, stdout: said[1] + "\n", stderr: "" };
      const r = await runProcess(["bash", "-c", command], { input, timeoutMs: 60_000 });
      return { exit: r.exit, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr, raw: r.stdout };
    },
  });
  return Object.assign(w, { answered });
}

function plan(over: Partial<ControllerPlan> = {}): ControllerPlan & { tmp: string; shm: string; identity: string } {
  const tmp = mkdtempSync(join(tmpdir(), "dc-ctl-"));
  dirs.push(tmp);
  mkdirSync(join(tmp, "src", "repo"), { recursive: true });
  writeFileSync(join(tmp, "src", "repo", "README.md"), "fixture repository\n");
  const commit = commitAll(join(tmp, "src", "repo"), tmp);
  mkdirSync(join(tmp, "src", "approval"), { recursive: true });
  const record = makeRecord(join(tmp, "src", "approval"));
  const walRoot = join(tmp, "walhost");
  mkdirSync(walRoot, { recursive: true });
  const shm = mkdtempSync("/dev/shm/dc-ctl-");
  dirs.push(shm);
  const keys = ageKeys(shm);
  return {
    tmp,
    shm,
    identity: keys.identity,
    recipient: keys.recipient,
    workDir: join(shm, "work"),
    mountWork: false,
    runId: "dc-host-test",
    owner: "test-owner",
    longestStageHours: 24,
    ttlHours: 30,
    priceMicrosPerHour: { controller: 60_000, wal: 20_000 },
    commit,
    tree: repoTree(join(tmp, "src", "repo"), commit),
    repoBundle: repoBundle(join(tmp, "src", "repo"), commit),
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
    const l = layout(p.runId, p.root, p.workDir);
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
      expect(new TextDecoder().decode(t.archive.sealed.subarray(0, AGE_HEADER.length))).toBe(AGE_HEADER);
    }
    expect(readdirSync(l.work)).toEqual([]);
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

  /** A stage module standing in for wire/host.ts: it logs, waits on a release file for "slow", throws for "fail", writes a sink. */
  const stageModule = (dir: string) => {
    const path = join(dir, "stage-module.ts");
    writeFileSync(
      path,
      [
        'import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "export async function runOnHost(_svc: unknown, args: string[], row: { work: string; log: string }) {",
        "  const name = args[1]!;",
        '  appendFileSync(row.log, "row " + name + " starts\\n");',
        '  if (name === "fail") throw Object.assign(new Error("the row refused"), { code: "E_USAGE" });',
        '  while (name === "slow" && !existsSync(join(row.work, "release"))) await Bun.sleep(100);',
        '  if (name === "big") {',
        '    writeFileSync(join(row.work, "big.bin"), new Uint8Array(8 << 20));',
        "    await Bun.sleep(1000);",
        '    rmSync(join(row.work, "big.bin"));',
        "  }",
        '  mkdirSync(join(row.work, "sinks", name), { recursive: true });',
        '  writeFileSync(join(row.work, "sinks", name, "out.txt"), "sink of " + name + "\\n");',
        '  appendFileSync(row.log, "row " + name + " wrote its sink\\n");',
        "}",
        "",
      ].join("\n"),
    );
    return path;
  };
  const tarOfFiles = (dir: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return new Uint8Array(Bun.spawnSync(["tar", "-C", dir, "-cf", "-", "."]).stdout);
  };
  async function rowsUntil(file: string, done: (rows: RowRecord[]) => boolean, ms = 20_000): Promise<RowRecord[]> {
    let rows: RowRecord[] = [];
    for (const until = Date.now() + ms; Date.now() < until; await Bun.sleep(100)) {
      rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
      if (done(rows)) break;
    }
    return rows;
  }

  // Value: protects=runbook gap 2 and gap 9; fails_when=a second row can't reach the running host, a row starts while another runs, a row's inputs replace a file, or status can't name the row; why_new=host-main ran one row and then only ticked; seam=sendRow and host-main's row loop; no_claim=the real Ubicloud host
  test("rows run one at a time on one service: launch's stage is row 1, the next row brings its own inputs, a busy host refuses, and status names each row with the last log lines", async () => {
    const w = world();
    const b = fakeBackend(w);
    const p = plan();
    const mod = stageModule(p.tmp);
    const l = layout(p.runId, p.root, p.workDir);
    const first = { ...p, stage: { module: mod, args: ["wiring.json", "first"] }, workTar: tarOfFiles(join(p.shm, "in1"), { "inputs/a.txt": "input one\n" }) };
    const rec = await launch(b, first, env());
    pids.push(pidOf(p));
    const pid = pidOf(p);
    expect((await rowsUntil(l.rows, (r) => r[0]?.state === "done"))[0]).toMatchObject({ n: 1, row: "first", state: "done", code: null });
    expect(readFileSync(join(l.work, "inputs", "a.txt"), "utf8")).toBe("input one\n");
    const slow = { ...p, stage: { module: mod, args: ["wiring.json", "slow"] } };
    const sent = await sendRow(b, slow, rec, tarOfFiles(join(p.shm, "in2"), { "inputs/b.txt": "input two\n" }));
    expect(sent.kind === "sent" && sent.row.n).toBe(2);
    expect(readFileSync(join(l.work, "inputs", "b.txt"), "utf8")).toBe("input two\n");
    expect((await sendRow(b, { ...p, stage: { module: mod, args: ["wiring.json", "third"] } }, rec, null)).kind).toBe("busy");
    const st = await hostStatus(b, p, rec, { tail: 5 });
    expect(st?.rows.map((r) => r.state)).toEqual(["done", "running"]);
    expect(st?.tail).toEqual(["row slow starts"]);
    writeFileSync(join(l.work, "release"), "");
    expect((await rowsUntil(l.rows, (r) => r[1]?.state === "done"))[1]?.state).toBe("done");
    await expect(sendRow(b, { ...p, stage: { module: mod, args: ["wiring.json", "third"] } }, rec, tarOfFiles(join(p.shm, "in3"), { "inputs/b.txt": "again\n" }))).rejects.toThrow("which the host's work folder has already");
    expect(readFileSync(join(l.work, "inputs", "b.txt"), "utf8")).toBe("input two\n");
    expect((await sendRow(b, { ...p, stage: { module: mod, args: ["wiring.json", "fail"] } }, rec, null)).kind).toBe("sent");
    const rows = await rowsUntil(l.rows, (r) => r[2]?.state === "failed");
    expect(rows.map((r) => [r.n, r.row, r.state, r.code])).toEqual([[1, "first", "done", null], [2, "slow", "done", null], [3, "fail", "failed", "E_USAGE"]]);
    expect(readFileSync(rowLog(l.work, 3), "utf8")).toContain("row 3 failed: the row refused");
    expect(JSON.parse(readFileSync(join(l.state, "stage.json"), "utf8"))).toMatchObject({ n: 3, done: false, code: "E_USAGE" });
    expect(readFileSync(l.rows, "utf8")).not.toContain("the row refused");
    expect(pidOf(p)).toBe(pid);
    expect(JSON.parse(readFileSync(l.status, "utf8")).boot).toBe("fresh");
    const t = await teardown(b, p, rec, { waitMs: 30_000 });
    expect(t.kind).toBe("deleted");
    if (t.kind !== "deleted") return;
    expect(JSON.parse(new TextDecoder().decode(t.archive.rows!)).length).toBe(3);
    writeFileSync(join(p.shm, "sealed.age"), t.archive.sealed);
    const files = openSealed(join(p.shm, "sealed.age"), p.identity, join(p.shm, "opened"));
    for (const f of ["./inputs/a.txt", "./inputs/b.txt", "./sinks/first/out.txt", "./sinks/slow/out.txt", "./.rows/1.log", "./.rows/3.log"]) expect(files).toContain(f);
    expect(readdirSync(l.work)).toEqual([]);
    expect(allDeleted(w)).toBe(true);
  }, 120_000);

  // Value: protects=PD-41's tmpfs work folder; fails_when=a launch unpacks inputs onto a disk folder or mounts without the memory sizing and linger; why_new=the work folder sat on the VM's disk; seam=placeWork; no_claim=a real mount, which needs root on a real VM
  // Value: protects=the Captain's tmpfs guard on the controller host; fails_when=a row ends without its tmpfs use and peak in its log, rows.json and stage.json, a peak between the row's start and end is lost, or next sends a row while the tmpfs is above 80% now or at the last row's peak; why_new=the frame clones filled about a third of the work tmpfs before any authoring output landed, and nothing printed or checked it; seam=host-main's row end and tick, sendRow; no_claim=the real host's tmpfs size
  test("each row ends with the work tmpfs use and its peak in its log, rows.json and stage.json, and next refuses just over 80% now or at the last peak but sends just under", async () => {
    const say: Array<[string, string]> = [];
    const w = world({ say });
    const b = fakeBackend(w);
    const p = plan();
    const mod = stageModule(p.tmp);
    const l = layout(p.runId, p.root, p.workDir);
    const rec = await launch(b, { ...p, stage: { module: mod, args: ["wiring.json", "big"] } }, env());
    pids.push(pidOf(p));
    const t = (await rowsUntil(l.rows, (r) => r[0]?.state === "done"))[0]!.tmpfs!;
    expect(t.sizeBytes).toBeGreaterThan(0);
    expect(t.peakBytes - t.usedBytes).toBeGreaterThanOrEqual(4 << 20);
    expect(JSON.parse(readFileSync(join(l.state, "stage.json"), "utf8")).tmpfs).toEqual(t);
    expect(readFileSync(rowLog(l.work, 1), "utf8").trim().split("\n").at(-1)).toBe("tmpfs: " + tmpfsLine(t));
    const size = 1_000_000;
    const next = (name: string) => sendRow(b, { ...p, stage: { module: mod, args: ["wiring.json", name] } }, rec, null);
    const lastPeak = (peakBytes: number) => {
      const rows = JSON.parse(readFileSync(l.rows, "utf8")) as RowRecord[];
      rows.at(-1)!.tmpfs = { usedBytes: 1, sizeBytes: size, peakBytes };
      writeFileSync(l.rows, JSON.stringify(rows));
    };
    say.push(["df -B1 --output=size,used", size + " 800001"]);
    await expect(next("first")).rejects.toMatchObject({ code: "E_DCH_TMPFS_HIGH" });
    say[0] = ["df -B1 --output=size,used", size + " 799999"];
    expect((await next("first")).kind).toBe("sent");
    await rowsUntil(l.rows, (r) => r[1]?.state === "done");
    lastPeak(800_001);
    await expect(next("first")).rejects.toMatchObject({ code: "E_DCH_TMPFS_HIGH", message: expect.stringContaining("row 2 (first) peaked at") });
    expect(existsSync(join(l.state, "next", "row.json"))).toBe(false);
    lastPeak(799_999);
    expect((await next("first")).kind).toBe("sent");
    expect((await rowsUntil(l.rows, (r) => r[2]?.state === "done")).length).toBe(3);
  }, 60_000);

  test("a launch mounts the work folder's tmpfs from the host's memory with the run user lingering, refuses a work folder that isn't tmpfs, and refuses inputs that don't fit", async () => {
    const mounted = world({ answer: ["mount -t tmpfs"] });
    const p = plan({ mountWork: true });
    const rec = await launch(fakeBackend(mounted), p, env());
    pids.push(pidOf(p));
    expect(mounted.answered.join("\n")).toContain("mount -t tmpfs -o size=$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) * 512 )),mode=0700,nosuid,nodev tmpfs '" + p.workDir + "'");
    expect(mounted.answered.join("\n")).toContain("loginctl enable-linger run");
    expect(rec.tmpfs!.memBytes).toBeGreaterThan(0);
    expect(rec.tmpfs!.sizeBytes).toBeGreaterThan(0);
    const disk = world();
    const q = plan({ workDir: join(mkdtempSync(join(tmpdir(), "dc-ctl-disk-")), "work") });
    dirs.push(join(q.workDir!, ".."));
    await expect(launch(fakeBackend(disk), q, env())).rejects.toThrow("not tmpfs");
    expect(disk.vms.length).toBe(2);
    expect(allDeleted(disk)).toBe(true);
    const small = world({ say: [["--output=avail", "100"]] });
    const r = plan();
    await expect(launch(fakeBackend(small), { ...r, workTar: tarOfFiles(join(r.shm, "big"), { "inputs/a.txt": "x".repeat(4096) }) }, env())).rejects.toThrow("MiB free; nothing was unpacked");
    expect(allDeleted(small)).toBe(true);
    expect(existsSync(join(r.workDir!, "inputs"))).toBe(false);
  }, 90_000);

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
