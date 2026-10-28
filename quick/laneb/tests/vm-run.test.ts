import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// vm-run.sh with fake sg, curl, bun, sleep and harbor: the oracle job's trials are written by the test, the ledger
// tunnel answers, and the metering proxy is healthy only when the test asks for it.
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

function rig(trials: Record<string, string | null>, opts: { healthy?: boolean; stop?: boolean } = {}) {
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
    expect(s.sg().match(/harbor got INT/g)).toHaveLength(1);
    expect(s.sg()).not.toContain("harbor finished");
    expect(s.sg()).toContain("8788/close-all");
    expect(code).toBe(130);
    expect(s.exitFile()).toBe("130");
  }, 60_000);
});
