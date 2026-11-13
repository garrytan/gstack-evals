import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRealProxyRun } from "./real-proxy-rig.ts";

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
  test("a run dir with order.json runs Harbor with LANEB_TRIAL_ORDER set to it, and one without runs Harbor's own order (R3 amendment 5)", async () => {
    for (const ordered of [true, false]) {
      const s = setup(null, true);
      if (ordered) writeFileSync(join(s.run, "order.json"), "[]");
      const proc = Bun.spawn(s.cmd, { env: s.env, stdout: "pipe", stderr: "pipe" });
      for (let i = 0; i < 200 && !s.sg().includes("harbor running"); i++) await Bun.sleep(50);
      writeFileSync(join(s.run, "STOP"), "");
      const timer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
      await proc.exited;
      clearTimeout(timer);
      const line = s.sg().split("\n").find((l) => l.includes("job.resolved.json"))!;
      if (ordered) expect(line).toContain(`LANEB_TRIAL_ORDER='${s.run}/order.json' harbor run -y -c`);
      else expect(line).not.toContain("LANEB_TRIAL_ORDER");
      // The judge proxy's key is unset for Harbor, so a judge-bearing host's TYPESAFE never reaches Harbor or the task
      // containers; only the metering proxies (which source ~/.laneb-keys in their own subshells) ever read it.
      expect(line).toContain("-u TYPESAFE_API_KEY");
      expect(s.sg()).toContain("pkill -INT -f /bin/harbor run");
    }
  }, 90_000);

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

  // The cap watcher and the end-state read against the real proxy.ts control server (tests/real-proxy-rig.ts). At b82ecf9
  // both read GET /status, which proxy.ts never served: the stub curl these tests used to run answered it, so the watcher
  // never fired and proxy-status-end.json came back empty on the VM (GEVA-199, GEVA-200).
  test("with STOP_ON_CAP, a cap stop the real proxy latches reaches the running Harbor as one SIGINT, and out/cap-stop.json and out/proxy-status-end.json record it", async () => {
    const r = await startRealProxyRun({ batchCapUsd: 50, ledgerCapUsd: 5, stopOnCap: true });
    expect(r.harborRunning()).toBe(true);
    const t1 = await r.open("t1", 4);
    expect(t1.status).toBe(200);
    await Bun.sleep(1000);
    expect(r.log()).not.toContain("pkill");
    const t2 = await r.open("t2", 4);
    expect(t2.status).toBe(409);
    const code = await r.exited;
    expect(r.log().match(/pkill -INT -f \/bin\/harbor run/g)).toHaveLength(1);
    expect(r.log().match(/harbor got INT/g)).toHaveLength(1);
    expect(r.log()).not.toContain("harbor finished");
    const capStop = JSON.parse(r.out("cap-stop.json"));
    expect(capStop.cap_stop).toMatch(/^ledger refused a reserve for t2 at /);
    expect(capStop).toMatchObject({ sessions: 1, open_sessions: 1, unsettled_sessions: [t1.body.id] });
    expect(JSON.parse(r.out("proxy-status-end.json"))).toEqual({ sessions: 1, open_sessions: 0, unsettled_sessions: [], cap_stop: capStop.cap_stop, global_spent_micros: 0 });
    expect(JSON.parse(r.out("close-all.json")).map((s: any) => s.id)).toEqual([t1.body.id]);
    expect(code).toBe(130);
    expect(r.out("vm-run.exit").trim()).toBe("130");
  }, 60_000);

  test("without STOP_ON_CAP, a latched cap stop leaves Harbor running, and out/proxy-status-end.json still records it", async () => {
    const r = await startRealProxyRun({ batchCapUsd: 50, ledgerCapUsd: 5 });
    expect((await r.open("t1", 4)).status).toBe(200);
    expect((await r.open("t2", 4)).status).toBe(409);
    await Bun.sleep(1000);
    expect(r.log()).not.toContain("pkill");
    expect(r.has("cap-stop.json")).toBe(false);
    r.stop();
    expect(await r.exited).toBe(130);
    expect(JSON.parse(r.out("proxy-status-end.json")).cap_stop).toMatch(/^ledger refused a reserve for t2 at /);
  }, 60_000);

  test("with STOP_ON_CAP, a real proxy that stops answering leaves Harbor running, and 3 failed reads in a row put one timestamped line in out/cap-watch.log", async () => {
    const r = await startRealProxyRun({ batchCapUsd: 50, ledgerCapUsd: 5, stopOnCap: true });
    expect(r.harborRunning()).toBe(true);
    await Bun.sleep(1000);
    expect(r.has("cap-watch.log")).toBe(false);
    expect(r.killProxy()).toBe(true);
    for (let i = 0; i < 100 && !r.has("cap-watch.log"); i++) await Bun.sleep(100);
    await Bun.sleep(1000);
    const lines = r.out("cap-watch.log").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ proxy_status failed 3 times in a row: /);
    expect(r.log()).not.toContain("pkill");
    expect(r.has("cap-stop.json")).toBe(false);
    r.finish();
    expect(await r.exited).toBe(0);
    expect(r.log()).toContain("harbor finished");
    expect(r.out("proxy-status-end.json")).toBe("");
  }, 60_000);
});

describe("vm-run.sh's image pulls before the oracle gate (R3 amendment 3, rule 3)", () => {
  // A fake Docker Hub on a virtual clock: the token and ratelimitpreview HEAD endpoints vm-run.sh reads, and a pull
  // endpoint the fake docker asks. The fake sleep logs its seconds instead of waiting, and the clock is their sum. While the clock is before
  // limitedUntil every pull gets 429 and the HEAD says ratelimit-remaining 0 (with ratelimit-reset when reset is set); an
  // image in fails fails that many more pulls before one succeeds.
  function hub(o: { limitedUntil?: number; reset?: boolean; fails?: Record<string, number>; hangHead?: boolean } = {}) {
    const h = { sleepLog: "", pulls: {} as Record<string, number>, url: "" };
    const left = { ...(o.fails ?? {}) };
    const sleeps = () => (h.sleepLog && existsSync(h.sleepLog) ? readFileSync(h.sleepLog, "utf8").split("\n").filter(Boolean).map(Number) : []);
    const clock = () => sleeps().reduce((a, x) => a + x, 0);
    const limited = () => clock() < (o.limitedUntil ?? 0);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: o.hangHead ? 0 : undefined,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/token") return Response.json({ token: "t" });
        if (u.pathname === "/v2/ratelimitpreview/test/manifests/latest") {
          if (o.hangHead) return new Promise<Response>(() => {});
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
  async function pulls(fake: ReturnType<typeof hub>, tasks: Record<string, string>, opts: { side?: string; stopOnSleep?: boolean; stopOnPull?: boolean; hangPull?: boolean; env?: Record<string, string>; killAfterMs?: number } = {}) {
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
    bin("sg", `echo "$3" >> "${join(root, "sg.log")}"\ncase "$3" in "docker pull -q '"*) ${opts.stopOnPull ? `touch "${join(s.run, "STOP")}"; ` : ""}${opts.hangPull ? "exec /usr/bin/sleep 600; " : ""}img=\${3#"docker pull -q '"}; img=\${img%"'"}; [ "$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' -X POST "${url}/pull?image=$img")" = 200 ] ;; *"network inspect"*) echo 172.17.0.1 ;; esac\n`);
    const p = Bun.spawn(s.cmd, { env: { ...s.env, DOCKER_HUB_AUTH_URL: url, DOCKER_HUB_URL: url, ...opts.env }, stdout: "pipe", stderr: "pipe" });
    const timer = opts.killAfterMs ? setTimeout(() => p.kill("SIGKILL"), opts.killAfterMs) : undefined;
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    clearTimeout(timer);
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

  test("a STOP file during the last image's wait at the rate limit ends the pulls even when the next pull would succeed (exit 130)", async () => {
    const r = await pulls(hub({ limitedUntil: 60, reset: true }), { a: "FROM img-a\n" }, { stopOnSleep: true });
    expect(r.out("pulls.tsv")).toBe(HEAD + "STOP\t1\t60\timg-a\n");
    expect(r.pulls).toEqual({ "img-a": 1 });
    expect(r.stderr).toContain("stop requested during the image pulls: no paid trial started");
    expect(r.log).not.toContain("oracle.json");
    expect(r.code).toBe(130);
    expect(r.exitFile()).toBe("130");
  }, 60_000);

  test("a STOP file written while the last image pulls ends the run before the oracle gate (exit 130)", async () => {
    const r = await pulls(hub(), { a: "FROM img-a\n" }, { stopOnPull: true });
    expect(r.out("pulls.tsv")).toBe(HEAD + "ok\t1\t0\timg-a\n");
    expect(r.stderr).toContain("stop requested during the image pulls: no paid trial started");
    expect(r.log).not.toContain("oracle.json");
    expect(r.code).toBe(130);
    expect(r.exitFile()).toBe("130");
  }, 60_000);

  test("a pull that hangs is stopped at its try limit and counts as a failed try; an image that never pulls is infra: exit 10 before the oracle job", async () => {
    const r = await pulls(hub(), { a: "FROM img-a\n" }, { hangPull: true, env: { PULL_TRY_SEC: "1" }, killAfterMs: 45_000 });
    expect(r.out("pulls.tsv")).toBe(HEAD + "FAIL\t6\t0\timg-a\n");
    expect(r.out("pull.d/img-a.log")).toContain("try 1 of 6 timed out after 1 s");
    expect(r.out("pull-fails.txt")).toBe("img-a (a)\n");
    expect(r.log).not.toContain("oracle.json");
    expect(r.code).toBe(10);
  }, 60_000);

  test("a STOP file during a pull kills the pull in flight and ends the run before the oracle gate (exit 130)", async () => {
    const t0 = Date.now();
    const r = await pulls(hub(), { a: "FROM img-a\n", b: "FROM img-b\n" }, { hangPull: true, stopOnPull: true, killAfterMs: 45_000 });
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.out("pulls.tsv")).toBe(HEAD + "STOP\t1\t0\timg-a\n");
    expect(r.stderr).toContain("stop requested during the image pulls: no paid trial started");
    expect(r.log).not.toContain("oracle.json");
    expect(r.code).toBe(130);
  }, 60_000);

  test("a SIGHUP, SIGINT or SIGTERM during a pull kills the pull and its watcher, then exits 129, 130 or 143 before the oracle gate", async () => {
    const ps = (pid: number) => Bun.spawnSync(["ps", "-o", "ppid=,stat=", "-p", String(pid)]).stdout.toString().trim().split(/\s+/);
    const alive = (pid: number) => { const [, stat] = ps(pid); return stat !== undefined && !stat.startsWith("Z"); };
    for (const [sig, code] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]] as const) {
      const s = setup({ a: "1" });
      const root = join(s.run, "..");
      mkdirSync(join(s.run, "tasks", "a", "environment"), { recursive: true });
      writeFileSync(join(s.run, "tasks", "a", "environment", "Dockerfile"), "FROM img-a\n");
      const pidFile = join(root, "pull.pid");
      writeFileSync(join(root, "bin", "sg"), `#!/usr/bin/env bash\necho "$3" >> "${join(root, "sg.log")}"\ncase "$3" in "docker pull"*) echo $$ > "${pidFile}.tmp"; mv "${pidFile}.tmp" "${pidFile}"; exec /usr/bin/sleep 600 ;; esac\n`);
      const p = Bun.spawn(s.cmd, { env: s.env, stdout: "ignore", stderr: "ignore" });
      for (let i = 0; i < 400 && !existsSync(pidFile); i++) await Bun.sleep(25);
      await Bun.sleep(300);
      const pull = Number(readFileSync(pidFile, "utf8"));
      const timeout = Number(ps(pull)[0]);
      const watchers = () => Bun.spawnSync(["pgrep", "-f", s.run]).stdout.toString().split("\n").filter(Boolean).map(Number).filter((pid) => pid !== p.pid);
      expect(alive(pull) && alive(timeout) && watchers().length > 0).toBe(true);
      const left = () => [pull, timeout, ...watchers()].filter(alive);
      try {
        p.kill(sig);
        expect(await p.exited).toBe(code);
        expect(s.exitFile()).toBe(String(code));
        for (let i = 0; i < 40 && left().length; i++) await Bun.sleep(50);
        expect(left()).toEqual([]);
        expect(s.sg()).not.toContain("oracle.json");
      } finally {
        for (const pid of left()) process.kill(pid, "SIGKILL");
      }
    }
  }, 60_000);

  test("a rate-limit read that hangs gives up after 30 s, so the failed pull counts as a try and the next pull goes ahead", async () => {
    const r = await pulls(hub({ fails: { "img-a": 1 }, hangHead: true }), { a: "FROM img-a\n" }, { killAfterMs: 80_000 });
    expect(r.out("pulls.tsv")).toBe(HEAD + "ok\t2\t0\timg-a\n");
    expect(r.code).toBe(8);
  }, 90_000);
});

describe("task-hooks.sh (L1 Amendment C): which task images register their own UserPromptSubmit hook", () => {
  // Value: protects=the run-time count of task work trees whose .claude/settings*.json (or managed settings) register a UserPromptSubmit hook, #218's named route-evidence residual; fails_when=a hooked image reads no, a clean one reads yes, a failed scan reads anything but unknown, or vm-run.sh stops on a failed scan; why_new=GEVA-294; seam=runner/task-hooks.sh through sg docker; no_claim=a real image, which the dry run scans
  function scan(images: Record<string, Record<string, string> | null>, dockerfiles: Record<string, string>, context: Record<string, Record<string, string>> = {}) {
    const root = mkdtempSync(join(tmpdir(), "laneb-taskhooks-"));
    const bin = join(root, "bin"), run = join(root, "run"), fs = join(root, "images");
    mkdirSync(bin, { recursive: true });
    for (const [img, files] of Object.entries(images)) for (const [p, body] of Object.entries(files ?? {})) { mkdirSync(join(fs, img, p, ".."), { recursive: true }); writeFileSync(join(fs, img, p), body); }
    for (const [task, df] of Object.entries(dockerfiles)) { mkdirSync(join(run, "tasks", task, "environment"), { recursive: true }); writeFileSync(join(run, "tasks", task, "environment", "Dockerfile"), df); }
    for (const [task, files] of Object.entries(context)) for (const [p, body] of Object.entries(files)) { mkdirSync(join(run, "tasks", task, "environment", p, ".."), { recursive: true }); writeFileSync(join(run, "tasks", task, "environment", p), body); }
    const broken = Object.keys(images).filter((i) => images[i] === null).join(" ");
    // The fake sg plays docker: image inspect prints /testbed, and run executes the mounted probe with the image's fake root as its second argument.
    writeFileSync(join(bin, "sg"), `#!/usr/bin/env bash\nset -- $3\necho "$*" >> ${root}/sg.log\n[ "$2" = image ] && { echo /testbed; exit 0; }\nprobe=""; img=""; while [ $# -gt 2 ]; do case "$1" in -v) probe=\${2%%:*}; shift ;; /bin/sh) img=$prev ;; esac; prev=$1; shift; done\ncase " ${broken} " in *" $img "*) echo "Unable to find image" >&2; exit 125 ;; esac\nexec sh "$probe" "$2" "${fs}/$img"\n`);
    chmodSync(join(bin, "sg"), 0o755);
    const p = Bun.spawnSync(["bash", join(import.meta.dir, "../runner/task-hooks.sh"), run], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    const rows = p.stdout.toString().trim().split("\n").map((l) => l.split("\t"));
    return { code: p.exitCode, head: rows[0], rows: Object.fromEntries(rows.slice(1).map((r) => [r[0], r.slice(1)])), sg: readFileSync(join(root, "sg.log"), "utf8") };
  }
  const hook = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo hi" }] }] } });
  const stop = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "true" }] }] } });
  test("a work tree hook, a local settings hook, managed settings and a build-context file read yes; settings with no UserPromptSubmit read no; a failed scan reads unknown", () => {
    const r = scan(
      { "img-hook": { "testbed/.claude/settings.json": hook }, "img-local": { "src/app/.claude/settings.local.json": hook }, "img-clean": { "testbed/.claude/settings.json": stop }, "img-managed": { "etc/claude-code/managed-settings.json": hook }, "img-gone": null, "img-ctx": {} },
      { a: "FROM laneb-claude AS x\nFROM img-hook\n", b: "FROM img-local\nWORKDIR /src\nWORKDIR app\n", c: "FROM img-clean\n", d: "FROM img-managed\n", e: "FROM img-gone\n", f: "FROM img-ctx\n" },
      { f: { "repo/.claude/settings.json": hook } },
    );
    expect(r.code).toBe(0);
    expect(r.head).toEqual(["task", "image", "workdir", "hook", "files"]);
    expect(r.rows.a).toEqual(["img-hook", "/testbed", "yes", "/testbed/.claude/settings.json"]);
    expect(r.rows.b).toEqual(["img-local", "/src/app", "yes", "/src/app/.claude/settings.local.json"]);
    expect(r.rows.c).toEqual(["img-clean", "/testbed", "no", ""]);
    expect(r.rows.d).toEqual(["img-managed", "/testbed", "yes", "/etc/claude-code/managed-settings.json"]);
    expect(r.rows.e!.slice(0, 3)).toEqual(["img-gone", "/testbed", "unknown"]);
    expect(r.rows.f).toEqual(["img-ctx", "/testbed", "yes", "context:repo/.claude/settings.json"]);
    expect(r.sg).toContain("run --rm --pull never --network none");
    expect(r.sg).not.toContain(" pull ");
  });
  test("vm-run.sh writes out/task-hooks.tsv after the pulls and before the oracle gate, and a scan that fails never stops the run", () => {
    const s = setup({ a: "1" });
    mkdirSync(join(s.run, "tasks", "a", "environment"), { recursive: true });
    writeFileSync(join(s.run, "tasks", "a", "environment", "Dockerfile"), "FROM img-a\nWORKDIR /testbed\n");
    const r = Bun.spawnSync(s.cmd, { env: s.env });
    expect(readFileSync(join(s.run, "out", "task-hooks.tsv"), "utf8")).toBe("task\timage\tworkdir\thook\tfiles\na\timg-a\t/testbed\tunknown\tthe scan printed no result\n");
    expect(r.stdout.toString()).toContain("oracle: every task passed on this host");
    expect(s.sg().indexOf("run --rm --pull never")).toBeLessThan(s.sg().indexOf("harbor run -y -c"));
  });
});

// The judge launch block (harness-mechanics Stage 3): with a judge arm in job.json, vm-run.sh starts the judge metering
// proxy (the self-contained bundle prepare-run.ts drops in the run dir, built here by the same `bun build` command) and
// exports HM_JUDGE_MGMT_SOCKET/HM_JUDGE_PROXY_BASE/HM_JUDGE_STOP_FILE/HM_JUDGE_JOURNAL into Harbor's env so the host-side agent can bind a
// slot and forward the per-slot proxy URL. The real judge proxy runs (loopback gateway, no provider keys needed to start);
// only the Lane B proxy and Harbor are faked. The skip path (no judge arm) is covered by the rest of this file, which runs
// vm-run.sh with job.json "{}" and never starts a judge proxy.
describe("vm-run.sh's judge launch block (judge arms only)", () => {
  const freePort = () => {
    const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const p = s.port;
    s.stop(true);
    return p;
  };
  function judgeSetup(opts: { keys?: string; job?: string } = {}) {
    const [dataPort, controlPort, ledgerPort, judgePort] = [freePort(), freePort(), freePort(), freePort()];
    const root = mkdtempSync(join(tmpdir(), "laneb-vmrun-judge-"));
    const bin = join(root, "bin"), run = join(root, "run"), home = join(root, "home"), log = join(root, "sg.log");
    for (const d of [bin, run, home]) mkdirSync(d, { recursive: true });
    writeFileSync(join(home, ".laneb-keys"), opts.keys ?? "");
    const built = Bun.spawnSync([process.execPath, "build", join(import.meta.dir, "../../../lanes/harness-mechanics/judge/judge-proxy.ts"), "--target=bun", "--outfile", join(run, "judge-proxy.js")]);
    if (built.exitCode !== 0) throw new Error("judge-proxy bundle failed: " + built.stderr.toString());
    const fakes: Record<string, string> = {
      // The judge proxy binds the gateway the way the Lane B proxy does, so a loopback gateway keeps the bind bindable.
      sg: `#!/usr/bin/env bash\necho "$3" >> "${log}"\ncase "$3" in *"network inspect"*) echo 127.0.0.1 ;; *"harbor run"*job.resolved.json*) eval "$3" ;; esac\n`,
      curl: `#!/usr/bin/env bash\necho "curl $*" >> "${log}"\necho '{}'\n`,
      // Only the judge proxy is a real bun; the Lane B proxy (bun proxy.ts) exits, and the faked curl reports it healthy. The
      // judge proxy's launch env (it sourced ~/.laneb-keys in its own subshell) is dumped so a test can read what keys it got.
      bun: `#!/usr/bin/env bash\ncase "$*" in *judge-proxy.js*) env > "${run}/out/judge-proxy-env.txt"; echo "$*" > "${run}/out/judge-proxy-args.txt"; exec "${process.execPath}" "$@" ;; *) exit 1 ;; esac\n`,
      sleep: "#!/usr/bin/env bash\nPATH=/usr/bin:/bin exec sleep 0.05\n",
      // The token is never echoed; the three forwarded-slot env vars are, to prove they reach Harbor's process. Harbor's full
      // env is dumped so a test can prove no provider key value from ~/.laneb-keys reaches it or the task containers.
      harbor: `#!/usr/bin/env bash\ntrap 'echo "harbor got INT" >> "${log}"; exit 130' INT\nenv > "${run}/out/harbor-env.txt"\necho "JUDGEENV mgmt=$HM_JUDGE_MGMT_SOCKET base=$HM_JUDGE_PROXY_BASE stop=$HM_JUDGE_STOP_FILE" >> "${log}"\necho "harbor running" >> "${log}"\nfor _ in $(seq 1 600); do [ -e "${run}/HARBOR_DONE" ] && break; PATH=/usr/bin:/bin sleep 0.1; done\necho "harbor finished" >> "${log}"\n`,
      pkill: `#!/usr/bin/env bash\necho "pkill $*" >> "${log}"\nexec /usr/bin/pkill "\${@:1:$#-1}" "${bin}/harbor run"\n`,
    };
    for (const [name, body] of Object.entries(fakes)) {
      writeFileSync(join(bin, name), body);
      chmodSync(join(bin, name), 0o755);
    }
    writeFileSync(join(run, "manifest.json"), JSON.stringify({ arms: [] }));
    writeFileSync(join(run, "job.json"), opts.job ?? JSON.stringify({ agents: [{ name: "laneb-claude-code", kwargs: { judge_backend: "p1" } }] }));
    return {
      run, judgePort,
      cmd: ["bash", join(import.meta.dir, "../runner/vm-run.sh"), run, "p-", "5"],
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, PROXY_DATA_PORT: String(dataPort), PROXY_CONTROL_PORT: String(controlPort), LEDGER_TUNNEL_PORT: String(ledgerPort), JUDGE_PROXY_DATA_PORT: String(judgePort) },
      sg: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
    };
  }

  test("starts the judge proxy from the run-dir bundle and hands HM_JUDGE_* to Harbor before the paid batch", async () => {
    const s = judgeSetup();
    const proc = Bun.spawn(s.cmd, { env: s.env, stdout: "pipe", stderr: "pipe" });
    try {
      for (let i = 0; i < 300 && !s.sg().includes("harbor running"); i++) await Bun.sleep(50);
      expect(s.sg()).toContain("harbor running");
      expect(readFileSync(join(s.run, "out", "judge-proxy.log"), "utf8")).toContain("HM_JUDGE_PROXY_READY");
      expect(s.sg()).toContain(`base=http://127.0.0.1:${s.judgePort}`);
      expect(s.sg()).toContain(`mgmt=${s.run}/out/judge-mgmt.sock`);
      expect(s.sg()).toContain(`stop=${s.run}/STOP`);
      // E1: the judge proxy meters under "judge:" plus this part's ledger prefix (vm-run.sh's second argument, "p-"), and
      // Harbor's env names the journal the agent checks after each session.
      const args = readFileSync(join(s.run, "out", "judge-proxy-args.txt"), "utf8");
      expect(args).toContain(`--journal ${s.run}/out/judge-journal.ndjson `);
      expect(args).toContain("--ledger-prefix judge:p-");
      // D11: four attempts for a judge call, so with the decider's one retry a judgment gets 8 attempts inside the hook's 30 s.
      expect(args).toContain("--retry-attempts 4");
      expect(args).not.toContain("--ledger-prefix judge ");
      expect(readFileSync(join(s.run, "out", "harbor-env.txt"), "utf8").split("\n")).toContain(`HM_JUDGE_JOURNAL=${s.run}/out/judge-journal.ndjson`);
      writeFileSync(join(s.run, "HARBOR_DONE"), "");
      const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);
      await proc.exited;
      clearTimeout(timer);
    } finally {
      proc.kill("SIGKILL");
    }
  }, 60_000);

  test("a part VM's provider keys reach the judge proxy but never Harbor or the task containers, judge batch or not", async () => {
    // Plant real-looking provider keys in ~/.laneb-keys (what a judge host ships). The proxies source it in their own
    // subshells, so the judge proxy's process holds every key; Harbor runs under env -u for each, so its process holds none
    // of the planted values and neither does the task container it starts. This holds whether or not the batch has a judge
    // arm, which is why the host may ship the judge keys without them ever reaching a scored session's container.
    const stubs = { ANTHROPIC_API_KEY: "sk-ant-STUB-not-a-key", OPENROUTER_API_KEY: "sk-or-STUB-not-a-key", TYPESAFE_API_KEY: "ts-STUB-not-a-key" };
    const keys = Object.entries(stubs).map(([k, v]) => `${k}=${v}\n`).join("");
    const stubValues = Object.values(stubs);
    const runBatch = async (job: string | undefined, judge: boolean) => {
      const s = judgeSetup({ keys, job });
      const proc = Bun.spawn(s.cmd, { env: s.env, stdout: "pipe", stderr: "pipe" });
      try {
        for (let i = 0; i < 300 && !s.sg().includes("harbor running"); i++) await Bun.sleep(50);
        expect(s.sg()).toContain("harbor running");
        const harborEnv = readFileSync(join(s.run, "out", "harbor-env.txt"), "utf8");
        for (const v of stubValues) expect(harborEnv).not.toContain(v);
        if (judge) {
          const proxyEnv = readFileSync(join(s.run, "out", "judge-proxy-env.txt"), "utf8");
          for (const v of stubValues) expect(proxyEnv).toContain(v);
        } else {
          expect(existsSync(join(s.run, "out", "judge-proxy-env.txt"))).toBe(false);
        }
        writeFileSync(join(s.run, "HARBOR_DONE"), "");
        const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);
        await proc.exited;
        clearTimeout(timer);
      } finally {
        proc.kill("SIGKILL");
      }
    };
    await runBatch(undefined, true); // judge batch (job.json carries judge_backend)
    await runBatch("{}", false); // non-judge batch (no judge arm, no judge proxy)
  }, 120_000);
});
