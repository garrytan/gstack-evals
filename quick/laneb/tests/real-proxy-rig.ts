import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "../runner/ledger.ts";

// vm-run.sh's paid phase against the real metering proxy and a real ledger service, so every control route vm-run.sh
// reads is the one runner/proxy.ts serves. vm-run.sh starts proxy.ts itself (data 127.0.0.1:8787, control :8788), and the
// rig serves runner/ledger.ts on 127.0.0.1:9911, where the SSH tunnel would be. Only sg, harbor, pkill and sleep are fakes:
// Harbor runs until the test writes HARBOR_DONE or a SIGINT reaches it, and the test plays the agent by opening and
// closing sessions on the control port. No provider key reaches the proxy, and no request goes to its data port.
const laneb = join(import.meta.dir, "..");
const CONTROL = "http://127.0.0.1:8788";
const taken = (port: number) => Bun.spawnSync(["bash", "-c", 'exec 3<>"/dev/tcp/127.0.0.1/$1"', "bash", String(port)], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
const post = async (path: string, body: unknown) => {
  const res = await fetch(CONTROL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

export async function startRealProxyRun(o: { batchCapUsd: number; ledgerCapUsd: number; stopOnCap?: boolean }) {
  for (const port of [8787, 8788, 9911]) if (taken(port)) throw new Error(`127.0.0.1:${port} already answers; the real-proxy rig needs it free`);
  const root = mkdtempSync(join(tmpdir(), "laneb-realproxy-"));
  const bin = join(root, "bin"), run = join(root, "run"), home = join(root, "home"), log = join(root, "rig.log");
  for (const d of [bin, run, home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, ".laneb-keys"), "");
  const fakes: Record<string, string> = {
    sg: `#!/usr/bin/env bash\necho "$3" >> "${log}"\ncase "$3" in *"network inspect"*) echo 127.0.0.1 ;; *"harbor run"*job.resolved.json*) eval "$3" ;; esac\n`,
    harbor: `#!/usr/bin/env bash\ntrap 'echo "harbor got INT" >> "${log}"; exit 130' INT\necho "harbor running" >> "${log}"\nfor _ in $(seq 1 600); do [ -e "${run}/HARBOR_DONE" ] && break; PATH=/usr/bin:/bin sleep 0.1; done\necho "harbor finished" >> "${log}"\n`,
    pkill: `#!/usr/bin/env bash\necho "pkill $*" >> "${log}"\nexec /usr/bin/pkill "\${@:1:$#-1}" "${bin}/harbor run"\n`,
    sleep: "#!/usr/bin/env bash\nPATH=/usr/bin:/bin exec sleep 0.1\n",
  };
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  symlinkSync(process.execPath, join(bin, "bun"));
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ arms: [] }));
  writeFileSync(join(run, "job.json"), "{}");
  copyFileSync(join(laneb, "config/proxy.json"), join(run, "proxy.json"));
  if (o.stopOnCap) writeFileSync(join(run, "STOP_ON_CAP"), "");
  const ledgerPath = join(root, "ledger.jsonl");
  new Ledger(ledgerPath, "rig").approve(o.ledgerCapUsd, { words: "test", by: "test" });
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "UBICLOUD_API_KEY"]) delete env[k];
  const ledger = Bun.spawn([process.execPath, join(laneb, "runner/ledger.ts"), "serve", "--path", ledgerPath, "--item", "rig", "--port", "9911"], { env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 100 && !(await fetch("http://127.0.0.1:9911/status").then((r) => r.ok, () => false)); i++) await Bun.sleep(50);
  const proc = Bun.spawn(["setsid", "bash", join(laneb, "runner/vm-run.sh"), run, "p-", String(o.batchCapUsd)], { env, stdout: "pipe", stderr: "pipe" });
  const rigLog = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  for (let i = 0; i < 300 && !rigLog().includes("harbor running") && proc.exitCode === null; i++) await Bun.sleep(50);
  const exited = (async () => {
    const timer = setTimeout(() => { try { process.kill(-proc.pid, "SIGKILL"); } catch {} }, 45_000);
    const code = await proc.exited;
    clearTimeout(timer);
    ledger.kill();
    await ledger.exited;
    return code;
  })();
  return {
    run,
    log: rigLog,
    harborRunning: () => rigLog().includes("harbor running"),
    open: (trial: string, capUsd: number) => post("/sessions", { trial, model: "claude-opus-5-5", cap_usd: capUsd }),
    close: (id: string) => post(`/sessions/${id}/close`, { reason: "agent_finished" }),
    finish: () => writeFileSync(join(run, "HARBOR_DONE"), ""),
    stop: () => writeFileSync(join(run, "STOP"), ""),
    exited,
    out: (file: string) => readFileSync(join(run, "out", file), "utf8"),
    has: (file: string) => existsSync(join(run, "out", file)),
  };
}
