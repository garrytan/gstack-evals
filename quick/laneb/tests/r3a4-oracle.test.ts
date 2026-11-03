import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";

// R3 amendment 4's oracle preflight (plan section 4 item 5, section 8 item 7), keyless: r3/oracle-preflight.sh drives the
// stub ubi-runner.sh in fixtures/r3a4-oracle-stubs, whose "VM" is a local directory; r3/oracle-pass.sh runs there with
// the stub docker, sg, curl and harbor beside it; and r3/drop-list.py scores the pulled passes.
const here = import.meta.dir;
const laneb = join(here, "..");
const repo = join(laneb, "../..");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const exe = (path: string, body: string) => { writeFileSync(path, body); chmodSync(path, 0o755); return path; };

const STUBS = join(here, "fixtures/r3a4-oracle-stubs");

// One shard's prepared run dir (oracle.json and each task's two Dockerfiles) and a pool file holding its tasks.
function shard(tasks: string[]) {
  const w = tmp("r3a4-oracle-"), run = join(w, "run");
  for (const t of tasks) {
    const from = "FROM swerebench/sweb.eval.x86_64." + t.replace("__", "_1776_") + "@sha256:" + sha(t) + "\n";
    for (const f of ["environment", "tests"]) { mkdirSync(join(run, "tasks", t, f), { recursive: true }); writeFileSync(join(run, "tasks", t, f, "Dockerfile"), from); }
  }
  writeFileSync(join(run, "oracle.json"), JSON.stringify({ job_name: "r3a4-oracle-s1-oracle", tasks: tasks.map((t) => ({ path: "tasks/" + t })) }));
  writeFileSync(join(w, "pool.json"), JSON.stringify({ tasks: tasks.map((task_id) => ({ task_id })) }));
  const bin = join(w, "bin");
  mkdirSync(bin);
  for (const name of ["sg", "docker", "curl", "harbor"]) exe(join(bin, name), readFileSync(join(STUBS, name), "utf8"));
  return { w, run, bin, pool: join(w, "pool.json"), out: join(w, "out"), vm: join(w, "vm"), log: join(w, "runner.log"), runner: exe(join(w, "ubi-runner.sh"), readFileSync(join(STUBS, "ubi-runner.sh"), "utf8")), ledger: join(w, "r3a4-oracle.jsonl") };
}

function preflight(s: ReturnType<typeof shard>, env: Record<string, string> = {}, cap = 20) {
  if (!existsSync(s.ledger)) new Ledger(s.ledger, "r3a4-oracle").approve(cap, { words: "test", by: "test" });
  const r = Bun.spawnSync(["bash", join(laneb, "r3/oracle-preflight.sh"), s.runner, repo, s.run, "1", s.out], {
    env: { ...process.env, UBI_OWNER: "test", LEDGER: s.ledger, RUNNER_SHA256: sha(readFileSync(s.runner)), POLL_SEC: "1", STUB_VM: s.vm, STUB_BIN: s.bin, STUB_LOG: s.log, ANTHROPIC_API_KEY: "test-not-a-key", OPENROUTER_API_KEY: "test-not-a-key", ...env },
  });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), log: existsSync(s.log) ? readFileSync(s.log, "utf8") : "" };
}

function drops(s: ReturnType<typeof shard>) {
  const json = join(s.w, "drops.json");
  const r = Bun.spawnSync(["python3", join(laneb, "r3/drop-list.py"), "drops", s.pool, json, join(s.w, "drops.tsv"), s.run, s.out]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), doc: existsSync(json) ? JSON.parse(readFileSync(json, "utf8")) : null };
}

const TASKS = ["alpha__one-1", "beta__two-2", "gamma__three-3", "delta__four-4"];

describe("the oracle preflight with a stub runner", () => {
  test("two finished passes are pulled and scored, the VM goes down, its hours settle, and a task whose reference fails is dropped", () => {
    const s = shard(TASKS);
    const p = preflight(s, { STUB_FAIL: "gamma__three-3" });
    expect(p.code).toBe(0);
    expect(p.log).toContain("up -s standard-16 -S 640 ttl=12 keys=\n");
    expect(p.log).toContain("down stub-vm-1");
    expect(p.out).toContain("vm ipv6: 2001:db8:1:2::7/64 (the /64 Docker Hub counts pulls against)");
    for (const n of [1, 2]) {
      expect(p.out).toContain("shard 1 pass " + n + ": harbor exit 0, pass exit 0, finished, 1 oracle fails");
      expect(readFileSync(join(s.out, "pass" + n, "oracle-fails.txt"), "utf8")).toBe("gamma__three-3\n");
      expect(readFileSync(join(s.out, "pass" + n, "pulls.tsv"), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")[0])).toEqual(["ok", "ok", "ok", "ok"]);
    }
    const rows = readRows(s.ledger).filter((r) => r.kind !== "approval");
    expect(rows.map((r) => r.kind)).toEqual(["reserve", "settle"]);
    expect(rows[0]!.usd_micros).toBe(toMicros(2.4));
    expect(rows[1]!.usd_micros).toBeLessThan(toMicros(0.01));
    const d = drops(s);
    expect(d.code).toBe(0);
    expect(d.out).toContain("dropped gamma__three-3: reference fails");
    expect(d.out).toContain("pool: 4 -> 3 tasks");
    expect(d.doc.dropped.map((x: any) => x.task)).toEqual(["gamma__three-3"]);
    expect(d.doc.shards[0].passes.map((x: any) => [x.passed, x.failed, x.images_pulled])).toEqual([[3, 1, 4], [3, 1, 4]]);
  }, 120_000);

  test("a pass whose Harbor job never finished is pulled but void: drop-list.py writes nothing and exits 2", () => {
    const s = shard(TASKS);
    const p = preflight(s, { STUB_UNFINISHED: "2" });
    expect(p.code).toBe(0);
    expect(p.out).toContain("shard 1 pass 1: harbor exit 0, pass exit 0, finished, 0 oracle fails");
    expect(p.out).toContain("shard 1 pass 2: harbor exit 0, pass exit 0, NOT finished, 0 oracle fails");
    const d = drops(s);
    expect(d.code).toBe(2);
    expect(d.out).toContain("pass 2 (" + join(s.out, "pass2") + ") has no finished_at line; it is void");
    expect(d.doc).toBeNull();
  }, 120_000);

  test("more than a quarter of the pool failing is the quarter stop: exit 3 with the list written (the first test drops 1 of 4, a quarter exactly, and exits 0)", () => {
    const s = shard(TASKS);
    expect(preflight(s, { STUB_FAIL: "alpha__one-1,beta__two-2" }).code).toBe(0);
    const d = drops(s);
    expect(d.code).toBe(3);
    expect(d.out).toContain("STOP: 2 of 4 pool tasks failed the preflight, more than a quarter; no model call runs and the Captain gets the record");
    expect(d.doc.kept_size).toBe(2);
    // A pass.exit other than 0 voids the pass, and so does a scorer that disagrees with the VM's oracle-fails.txt.
    writeFileSync(join(s.out, "pass1/oracle-fails.txt"), "alpha__one-1\n");
    expect(drops(s).code).toBe(1);
    writeFileSync(join(s.out, "pass2/pass.exit"), "1\n");
    const v = drops(s);
    expect(v.code).toBe(2);
    expect(v.out).toContain("exited 1, not 0; it is void");
  }, 120_000);

  test("a runner off its pin, a cap that isn't $20, a refused block or a VM that won't come up starts no pass", () => {
    const off = shard(TASKS);
    const a = preflight(off, { RUNNER_SHA256: "0".repeat(64) });
    expect([a.code, a.out.includes("is not the pinned runner"), a.log]).toEqual([1, true, ""]);
    const wrong = shard(TASKS);
    const b = preflight(wrong, {}, 21);
    expect([b.code, b.out.includes("r3a4-oracle's cap is $21, not amendment 4's $20"), b.log]).toEqual([1, true, ""]);
    const spent = shard(TASKS);
    const l = new Ledger(spent.ledger, "r3a4-oracle");
    l.approve(20, { words: "test", by: "test" });
    l.reserve("earlier", toMicros(18));
    const c = preflight(spent);
    expect([c.code, c.out.includes("the ledger refused block 1; no VM started (cap stop)"), c.log]).toEqual([9, true, ""]);
    const down = shard(TASKS);
    const e = preflight(down, { STUB_UP_FAIL: "1" });
    expect(e.code).toBe(3);
    expect(e.out).toContain("VM did not come up (void shard)");
    expect(e.log).not.toContain("ssh");
    expect(readRows(down.ledger).filter((r) => r.kind !== "approval").map((r) => r.kind)).toEqual(["reserve", "settle"]);
  }, 120_000);
});

describe("drop-list.py shard", () => {
  test("shard N is every fourth sorted pool id from the Nth, so four shards cover the pool once", () => {
    const ids = Array.from({ length: 10 }, (_, i) => "t__t-" + String(i).padStart(2, "0"));
    const w = tmp("r3a4-shards-");
    writeFileSync(join(w, "pool.json"), JSON.stringify({ tasks: [...ids].reverse().map((task_id) => ({ task_id })) }));
    const shards = [1, 2, 3, 4].map((n) => Bun.spawnSync(["python3", join(laneb, "r3/drop-list.py"), "shard", join(w, "pool.json"), String(n)]).stdout.toString().trim().split(","));
    expect(shards[0]).toEqual(["t__t-00", "t__t-04", "t__t-08"]);
    expect(shards.flat().sort()).toEqual(ids);
    expect(Bun.spawnSync(["python3", join(laneb, "r3/drop-list.py"), "shard", join(w, "pool.json"), "5"]).exitCode).toBe(2);
    rmSync(w, { recursive: true });
  });
});
