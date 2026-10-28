import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// vm-run.sh with fake sg, curl, bun and sleep: the oracle job's trials are written by the test, the ledger tunnel
// answers, and the metering proxy never comes up.
function rig(trials: Record<string, string | null>) {
  const root = mkdtempSync(join(tmpdir(), "laneb-vmrun-"));
  const bin = join(root, "bin");
  const run = join(root, "run");
  const home = join(root, "home");
  for (const d of [bin, run, home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, ".laneb-keys"), "");
  const log = join(root, "sg.log");
  const fakes: Record<string, string> = {
    sg: `#!/usr/bin/env bash\necho "$3" >> "${log}"\ncase "$3" in *"network inspect"*) echo 172.17.0.1 ;; esac\n`,
    curl: `#!/usr/bin/env bash\ncase "$*" in *9911/status*) echo '{}' ;; *) exit 7 ;; esac\n`,
    bun: "#!/usr/bin/env bash\nexit 1\n",
    sleep: "#!/usr/bin/env bash\n",
  };
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ arms: [] }));
  writeFileSync(join(run, "oracle.json"), JSON.stringify({ tasks: Object.keys(trials).map((t) => ({ path: `/vm/run/tasks/${t}` })) }));
  for (const [task, reward] of Object.entries(trials)) {
    if (reward === null) continue;
    const d = join(run, "jobs", "batch-oracle", `${task}__abc`);
    mkdirSync(join(d, "verifier"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: `/vm/run/tasks/${task}` } }));
    writeFileSync(join(d, "verifier", "reward.txt"), reward);
  }
  const r = Bun.spawnSync(["bash", join(import.meta.dir, "../runner/vm-run.sh"), run, "p-", "5"], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  const sg = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { run, code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), sg };
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
});
