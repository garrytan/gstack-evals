import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// vm-run.sh with fake sg, curl, bun, sleep, harbor and pkill: the oracle job's trials are written by the test, the ledger
// tunnel answers, and the metering proxy is healthy only when the test asks for it. The fake pkill logs its arguments
// and narrows the pattern to this rig's own harbor, so the STOP watcher never signals a real local Harbor.
function setup(trials: Record<string, string | null> | null, healthy = false) {
  const root = mkdtempSync(join(tmpdir(), "laneb-vmrun-"));
  const bin = join(root, "bin");
  const run = join(root, "run");
  const home = join(root, "home");
  for (const d of [bin, run, home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, ".laneb-keys"), "");
  const log = join(root, "sg.log");
  const fakes: Record<string, string> = {
    sg: `#!/usr/bin/env bash\necho "$3" >> "${log}"\ncase "$3" in *"network inspect"*) echo 172.17.0.1 ;; *"harbor run"*job.resolved.json*) eval "$3" ;; esac\n`,
    curl: healthy ? `#!/usr/bin/env bash\necho "curl $*" >> "${log}"\necho '{}'\n` : `#!/usr/bin/env bash\ncase "$*" in *9911/status*) echo '{}' ;; *) exit 7 ;; esac\n`,
    bun: "#!/usr/bin/env bash\nexit 1\n",
    sleep: "#!/usr/bin/env bash\nPATH=/usr/bin:/bin exec sleep 0.01\n",
    harbor: `#!/usr/bin/env bash\ntrap 'echo "harbor got INT" >> "${log}"; exit 130' INT\necho "harbor running" >> "${log}"\nfor _ in $(seq 1 300); do PATH=/usr/bin:/bin sleep 0.1; done\necho "harbor finished" >> "${log}"\n`,
    pkill: `#!/usr/bin/env bash\necho "pkill $*" >> "${log}"\nexec /usr/bin/pkill "\${@:1:$#-1}" "${bin}/harbor run"\n`,
  };
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ arms: [] }));
  writeFileSync(join(run, "job.json"), "{}");
  if (trials) {
    writeFileSync(join(run, "oracle.json"), JSON.stringify({ tasks: Object.keys(trials).map((t) => ({ path: `/vm/run/tasks/${t}` })) }));
    for (const [task, reward] of Object.entries(trials)) {
      if (reward === null) continue;
      const d = join(run, "jobs", "batch-oracle", `${task}__abc`);
      mkdirSync(join(d, "verifier"), { recursive: true });
      writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: `/vm/run/tasks/${task}` } }));
      writeFileSync(join(d, "verifier", "reward.txt"), reward);
    }
  }
  return {
    run,
    cmd: ["bash", join(import.meta.dir, "../runner/vm-run.sh"), run, "p-", "5"],
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    sg: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
    exitFile: () => readFileSync(join(run, "out", "vm-run.exit"), "utf8").trim(),
  };
}

function rig(trials: Record<string, string | null> | null, opts: { healthy?: boolean; stop?: boolean } = {}) {
  const s = setup(trials, opts.healthy);
  if (opts.stop) writeFileSync(join(s.run, "STOP"), "");
  const r = Bun.spawnSync(s.cmd, { env: s.env });
  return { run: s.run, code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), sg: s.sg(), exitFile: existsSync(join(s.run, "out", "vm-run.exit")) ? s.exitFile() : null };
}

describe("vm-run.sh before the paid batch", () => {
  test("the oracle gate needs a reward-1 trial for every task, a task with no trial included", () => {
    const r = rig({ a: "1", b: "0", c: null, d: "1.0" });
    expect(r.code).toBe(6);
    expect(readFileSync(join(r.run, "out", "oracle-fails.txt"), "utf8")).toBe("b\nc\n");
    expect(r.stderr).toContain("oracle failed, no paid trial started");
    expect(r.sg).not.toContain("network inspect");
  });

  test("with every task passing, a metering proxy that never turns healthy stops the run before Harbor", () => {
    const r = rig({ a: "1", b: "1" });
    expect(r.stdout).toContain("oracle: every task passed on this host");
    expect(r.code).toBe(8);
    expect(r.stderr).toContain("metering proxy not healthy");
    expect(r.sg).not.toContain("job.resolved.json");
  });

  test("every exit leaves out/vm-run.exit with its exit code, early exits included", () => {
    expect(rig({ a: "0" }).exitFile).toBe("6");
    expect(rig({ a: "1" }).exitFile).toBe("8");
  });

  test("a stop request written before the paid run keeps it from starting", () => {
    const r = rig({ a: "1" }, { healthy: true, stop: true });
    expect(r.stdout).toContain("oracle: every task passed on this host");
    expect(r.stderr).toContain("stop requested: no paid trial started");
    expect(r.sg).not.toContain("network inspect");
    expect(r.code).toBe(130);
    expect(r.exitFile).toBe("130");
  });

  test("a run with no oracle job that stops before the paid run still leaves an empty jobs dir for launch.sh to pull", () => {
    const r = rig(null, { healthy: true, stop: true });
    expect(r.code).toBe(130);
    expect(r.exitFile).toBe("130");
    expect(existsSync(join(r.run, "jobs")) && readdirSync(join(r.run, "jobs"))).toEqual([]);
  });
});

describe("vm-run.sh during the paid batch", () => {
  test("a stop request reaches the running Harbor as one SIGINT; the sessions are closed and the exit code recorded", async () => {
    const s = setup(null, true);
    const proc = Bun.spawn(s.cmd, { env: s.env, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 200 && !s.sg().includes("harbor running"); i++) await Bun.sleep(50);
    writeFileSync(join(s.run, "STOP"), "");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    const code = await proc.exited;
    clearTimeout(timer);
    expect(s.sg()).toContain("pkill -INT -f /bin/harbor run");
    expect(s.sg().match(/harbor got INT/g)).toHaveLength(1);
    expect(s.sg()).not.toContain("harbor finished");
    expect(s.sg()).toContain("8788/close-all");
    expect(code).toBe(130);
    expect(s.exitFile()).toBe("130");
  }, 60_000);

  test("a SIGTERM to vm-run.sh records exit code 143 once Harbor returns, and the sessions are closed", async () => {
    const s = setup(null, true);
    const proc = Bun.spawn(s.cmd, { env: s.env, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 200 && !s.sg().includes("harbor running"); i++) await Bun.sleep(50);
    proc.kill("SIGTERM");
    await Bun.sleep(200);
    writeFileSync(join(s.run, "STOP"), "");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    const code = await proc.exited;
    clearTimeout(timer);
    expect(s.sg()).toContain("8788/close-all");
    expect(s.exitFile()).toBe("143");
    expect(code).toBe(143);
  }, 60_000);

  test("with STOP_ON_CAP, a latched cap stop reaches the running Harbor as one SIGINT and out/cap-stop.json records it", async () => {
    const s = setup(null, true);
    const log = join(s.run, "..", "sg.log");
    writeFileSync(join(s.run, "..", "bin", "curl"), `#!/usr/bin/env bash\necho "curl $*" >> "${log}"\ncase "$*" in *8788/status*) if [ -e "${s.run}/CAPPED" ]; then echo '{"cap_stop":"ledger refused a reserve for t1"}'; else echo '{"cap_stop":null}'; fi ;; *) echo '{}' ;; esac\n`);
    writeFileSync(join(s.run, "STOP_ON_CAP"), "");
    const proc = Bun.spawn(s.cmd, { env: s.env, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 200 && !s.sg().includes("harbor running"); i++) await Bun.sleep(50);
    for (let i = 0; i < 200 && !s.sg().includes("8788/status"); i++) await Bun.sleep(50);
    expect(s.sg()).not.toContain("pkill");
    writeFileSync(join(s.run, "CAPPED"), "");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    const code = await proc.exited;
    clearTimeout(timer);
    expect(s.sg().match(/pkill -INT -f \/bin\/harbor run/g)).toHaveLength(1);
    expect(s.sg().match(/harbor got INT/g)).toHaveLength(1);
    expect(s.sg()).not.toContain("harbor finished");
    expect(JSON.parse(readFileSync(join(s.run, "out", "cap-stop.json"), "utf8")).cap_stop).toBe("ledger refused a reserve for t1");
    expect(s.sg()).toContain("8788/close-all");
    expect(code).toBe(130);
    expect(s.exitFile()).toBe("130");
  }, 60_000);

  test("without STOP_ON_CAP, a latched cap stop leaves Harbor running", async () => {
    const s = setup(null, true);
    const log = join(s.run, "..", "sg.log");
    writeFileSync(join(s.run, "..", "bin", "curl"), `#!/usr/bin/env bash\necho "curl $*" >> "${log}"\ncase "$*" in *8788/status*) echo '{"cap_stop":"ledger refused a reserve for t1"}' ;; *) echo '{}' ;; esac\n`);
    const proc = Bun.spawn(s.cmd, { env: s.env, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 200 && !s.sg().includes("harbor running"); i++) await Bun.sleep(50);
    await Bun.sleep(1000);
    expect(s.sg()).not.toContain("pkill");
    expect(existsSync(join(s.run, "out", "cap-stop.json"))).toBe(false);
    writeFileSync(join(s.run, "STOP"), "");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    expect(await proc.exited).toBe(130);
    clearTimeout(timer);
  }, 60_000);
});

describe("vm-run.sh's image pulls before the oracle gate (R3 amendment 3, rule 3)", () => {
  // A fake Docker Hub on a virtual clock: the token and ratelimitpreview HEAD endpoints vm-run.sh reads, and a pull
  // endpoint the fake docker asks. The fake sleep logs its seconds instead of waiting, and the clock is their sum. While the clock is before
  // limitedUntil every pull gets 429 and the HEAD says ratelimit-remaining 0 (with ratelimit-reset when reset is set); an
  // image in fails fails that many more pulls before one succeeds.
  function hub(o: { limitedUntil?: number; reset?: boolean; fails?: Record<string, number> } = {}) {
    const h = { sleepLog: "", pulls: {} as Record<string, number>, url: "" };
    const left = { ...(o.fails ?? {}) };
    const sleeps = () => (h.sleepLog && existsSync(h.sleepLog) ? readFileSync(h.sleepLog, "utf8").split("\n").filter(Boolean).map(Number) : []);
    const clock = () => sleeps().reduce((a, x) => a + x, 0);
    const limited = () => clock() < (o.limitedUntil ?? 0);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/token") return Response.json({ token: "t" });
        if (u.pathname === "/v2/ratelimitpreview/test/manifests/latest") {
          const headers: Record<string, string> = { "ratelimit-limit": "100;w=3600", "ratelimit-remaining": (limited() ? "0" : "42") + ";w=3600" };
          if (limited() && o.reset) headers["ratelimit-reset"] = String(o.limitedUntil! - clock());
          return new Response(null, { headers });
        }
        if (u.pathname === "/pull") {
          const img = u.searchParams.get("image")!;
          h.pulls[img] = (h.pulls[img] ?? 0) + 1;
          if (limited()) return new Response("toomanyrequests", { status: 429 });
          if ((left[img] ?? 0) > 0) { left[img]!--; return new Response("boom", { status: 500 }); }
          return new Response("ok");
        }
        return new Response("not found", { status: 404 });
      },
    });
    h.url = `http://127.0.0.1:${server.port}`;
    return { h, sleeps, stop: () => server.stop(true) };
  }
  // A run whose tasks' environment Dockerfiles are the test's, against the fake hub, with fake curl, sleep and sg (whose
  // docker pull asks the hub). The oracle trials pass and the proxy never turns healthy, so a run past the gate exits 8.
  async function pulls(fake: ReturnType<typeof hub>, tasks: Record<string, string>, opts: { side?: string; stopOnSleep?: boolean } = {}) {
    const s = setup(Object.fromEntries(Object.keys(tasks).map((t) => [t, "1"])));
    const root = join(s.run, "..");
    const url = fake.h.url;
    for (const [t, dockerfile] of Object.entries(tasks)) {
      mkdirSync(join(s.run, "tasks", t, "environment"), { recursive: true });
      writeFileSync(join(s.run, "tasks", t, "environment", "Dockerfile"), dockerfile);
    }
    if (opts.side) {
      const d = join(root, "home/.local/share/uv/tools/harbor/lib/python3.12/site-packages/harbor/environments/harbor-docker-egress-control-sidecar");
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "Dockerfile"), opts.side);
    }
    fake.h.sleepLog = join(root, "sleeps.log");
    const bin = (name: string, body: string) => { writeFileSync(join(root, "bin", name), "#!/usr/bin/env bash\n" + body); chmodSync(join(root, "bin", name), 0o755); };
    bin("curl", `case "$*" in *${url}*) exec /usr/bin/curl "$@" ;; *9911/status*) echo '{}' ;; *) exit 7 ;; esac\n`);
    bin("sleep", `echo "$1" >> "${fake.h.sleepLog}"\n` + (opts.stopOnSleep ? `touch "${join(s.run, "STOP")}"\n` : ""));
    bin("sg", `echo "$3" >> "${join(root, "sg.log")}"\ncase "$3" in "docker pull -q '"*) img=\${3#"docker pull -q '"}; img=\${img%"'"}; [ "$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' -X POST "${url}/pull?image=$img")" = 200 ] ;; *"network inspect"*) echo 172.17.0.1 ;; esac\n`);
    const p = Bun.spawn(s.cmd, { env: { ...s.env, DOCKER_HUB_AUTH_URL: url, DOCKER_HUB_URL: url }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    fake.stop();
    const out = (f: string) => (existsSync(join(s.run, "out", f)) ? readFileSync(join(s.run, "out", f), "utf8") : null);
    return { ...s, code, stdout, stderr, log: s.sg(), out, waited: fake.sleeps().filter((x) => x >= 1).reduce((a, x) => a + x, 0), pulls: fake.h.pulls };
  }
  const HEAD = "status\ttries\trate_limit_wait_s\timage\n";

  test("a pull refused at the rate limit waits out the window the registry gives and pulls again: no try spent, the task stays in", async () => {
    const r = await pulls(hub({ limitedUntil: 120, reset: true }), { a: "FROM img-a\n" });
    expect(r.out("pulls.tsv")).toBe(HEAD + "ok\t1\t120\timg-a\n");
    expect(r.pulls).toEqual({ "img-a": 2 });
    expect(r.waited).toBe(120);
    expect(r.out("pull.d/img-a.log")).toContain("refused while the rate limit is used up: waiting 120 s, not a try");
    expect(r.out("pull-fails.txt")).toBeNull();
    expect(r.stdout).toContain("pulls: 1 images, 120 s waited at the rate limit");
    expect(r.stdout).toContain("oracle: every task passed on this host");
    expect(r.log.lastIndexOf("docker pull")).toBeLessThan(r.log.indexOf("oracle.json"));
    expect(r.code).toBe(8);
  }, 60_000);

  test("with no reset from the registry it waits 5 minutes at a time until the limit clears", async () => {
    const r = await pulls(hub({ limitedUntil: 500 }), { a: "FROM img-a\n" });
    expect(r.out("pulls.tsv")).toBe(HEAD + "ok\t1\t600\timg-a\n");
    expect(r.pulls).toEqual({ "img-a": 3 });
    expect(r.code).toBe(8);
  }, 60_000);

  test("an image still refused after 3 hours at the limit then uses its 6 tries and is infra: exit 10 before the oracle job", async () => {
    const r = await pulls(hub({ limitedUntil: Infinity }), { b: "FROM img-b\n" });
    expect(r.out("pulls.tsv")).toBe(HEAD + "FAIL\t6\t10800\timg-b\n");
    expect(r.pulls).toEqual({ "img-b": 42 });
    expect(r.waited).toBe(10800 + 60 + 120 + 240 + 480 + 960);
    expect(r.out("pull-fails.txt")).toBe("img-b (b)\n");
    expect(r.stderr).toContain("an image did not pull (6 tries and up to 3 hours at the rate limit), infra: no paid trial started:\nimg-b (b)");
    expect(r.log).not.toContain("oracle.json");
    expect(r.log).not.toContain("network inspect");
    expect(r.code).toBe(10);
    expect(r.exitFile()).toBe("10");
  }, 60_000);

  test("a failure with the limit not used up is a try: 60 and 120 s between tries, and a pull on the third try is ok", async () => {
    const r = await pulls(hub({ fails: { "img-a": 2 } }), { a: "FROM img-a\n" });
    expect(r.out("pulls.tsv")).toBe(HEAD + "ok\t3\t0\timg-a\n");
    expect(r.waited).toBe(180);
    expect(r.out("pull.d/img-a.log")).toContain("try 2 of 6 failed");
    expect(r.code).toBe(8);
  }, 60_000);

  test("every FROM image in the tasks and the egress sidecar's base are pulled once each, all before the oracle gate", async () => {
    const r = await pulls(hub(), { a: "FROM node:24 AS laneb\nRUN true\nFROM img-a\n", b: "FROM node:24 AS laneb\nFROM img-b\n" }, { side: "FROM alpine:3.20\n" });
    expect(r.out("images.txt")).toBe("alpine:3.20\nimg-a\nimg-b\nnode:24\n");
    expect(r.pulls).toEqual({ "alpine:3.20": 1, "img-a": 1, "img-b": 1, "node:24": 1 });
    expect(r.log.lastIndexOf("docker pull")).toBeLessThan(r.log.indexOf("oracle.json"));
    expect(r.code).toBe(8);
  }, 60_000);

  test("a STOP file during a wait at the rate limit ends the pulls before the oracle gate (exit 130)", async () => {
    const r = await pulls(hub({ limitedUntil: Infinity }), { a: "FROM img-a\n", b: "FROM img-b\n" }, { stopOnSleep: true });
    expect(r.out("pulls.tsv")).toBe(HEAD + "STOP\t1\t300\timg-a\n");
    expect(r.stderr).toContain("stop requested during the image pulls: no paid trial started");
    expect(r.log).not.toContain("oracle.json");
    expect(r.code).toBe(130);
  }, 60_000);
});
