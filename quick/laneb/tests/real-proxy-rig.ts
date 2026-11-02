import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "../runner/ledger.ts";

// vm-run.sh's paid phase against the real metering proxy and a real ledger service, so every control route vm-run.sh
// reads is the one runner/proxy.ts serves. vm-run.sh starts proxy.ts itself and the rig serves runner/ledger.ts where the
// SSH tunnel would be, all on free ports the rig picks and passes in PROXY_DATA_PORT, PROXY_CONTROL_PORT and
// LEDGER_TUNNEL_PORT, so a live proxy or ledger on 8787, 8788 or 9911 never meets the rig. Only sg, harbor, pkill and sleep are fakes:
// Harbor runs until the test writes HARBOR_DONE or a SIGINT reaches it, and the test plays the agent by opening and
// closing sessions on the control port. No provider key reaches the proxy, and no request goes to its data port.
const laneb = join(import.meta.dir, "..");
const freePorts = (n: number) => {
  const held = Array.from({ length: n }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
  const ports = held.map((s) => s.port);
  for (const s of held) s.stop(true);
  return ports;
};
const post = async (control: string, path: string, body: unknown) => {
  const res = await fetch(control + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

export async function startRealProxyRun(o: { batchCapUsd: number; ledgerCapUsd: number; stopOnCap?: boolean }) {
  const [dataPort, controlPort, ledgerPort] = freePorts(3);
  const control = `http://127.0.0.1:${controlPort}`;
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
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, PROXY_DATA_PORT: String(dataPort), PROXY_CONTROL_PORT: String(controlPort), LEDGER_TUNNEL_PORT: String(ledgerPort) };
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "UBICLOUD_API_KEY"]) delete env[k];
  const ledger = Bun.spawn([process.execPath, join(laneb, "runner/ledger.ts"), "serve", "--path", ledgerPath, "--item", "rig", "--port", String(ledgerPort)], { env, stdout: "ignore", stderr: "ignore" });
  const ledgerStatus = () => fetch(`http://127.0.0.1:${ledgerPort}/status`).then((r) => (r.ok ? r.json() : null), () => null);
  for (let i = 0; i < 100 && !(await ledgerStatus()); i++) await Bun.sleep(50);
  if (ledger.exitCode !== null) throw new Error(`the rig's ledger exited (${ledger.exitCode}) before vm-run.sh started`);
  const capMicros = ((await ledgerStatus()) as any)?.capMicros;
  if (capMicros !== Math.round(o.ledgerCapUsd * 1e6)) throw new Error(`127.0.0.1:${ledgerPort}/status reports capMicros ${capMicros}, not the rig's approved ${o.ledgerCapUsd} USD`);
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
    open: (trial: string, capUsd: number) => post(control, "/sessions", { trial, model: "claude-opus-5-5", cap_usd: capUsd }),
    close: (id: string) => post(control, `/sessions/${id}/close`, { reason: "agent_finished" }),
    killProxy: () => Bun.spawnSync(["/usr/bin/pkill", "-f", `control-port ${controlPort}`]).exitCode === 0,
    finish: () => writeFileSync(join(run, "HARBOR_DONE"), ""),
    stop: () => writeFileSync(join(run, "STOP"), ""),
    exited,
    out: (file: string) => readFileSync(join(run, "out", file), "utf8"),
    has: (file: string) => existsSync(join(run, "out", file)),
  };
}
