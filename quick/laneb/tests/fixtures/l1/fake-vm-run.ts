// Fake vm-run.sh for l1-launch.test.ts. It runs the run dir's jobs (job.json, then job-2.json, ...) in Harbor's order
// (attempt, task, agent). Each trial reserves its session cap through the ledger service on LEDGER_PORT and settles it,
// as the metering proxy does, and leaves the rows the real batch leaves: out/proxy-sessions.jsonl, out/proxy-requests.jsonl
// (reserve_failed, cap_stop) and jobs/<job>/<trial>/config.json. Controls, per VM named in PAUSE_VM: PAUSE_AT=<n> stops
// after n trials and waits for <vm dir>/resume, a STOP file, a .dead file or its parent's death. CAP_STOP_AT=<n> answers the
// n+1th open with a cap stop. PROXY_CRASH_AT=<n> lets the n+1th session open (its reserve lands and session_open is logged)
// and then plays the proxy dying: that session never gets a closed row or a settle, no later session opens, and the batch
// waits for a STOP, a .dead file or its parent's death. TUNNEL_DOWN_VM=<vm> fails that VM's first ledger read, as
// vm-run.sh's does when no ledger service answers the tunnel: exit 4 before any trial. NO_RESPONSE_AT=<n>[,<n>...] closes
// those trials' sessions (0-based, on the VM NO_RESPONSE_VM names, or on every VM) with no successful response. Every opened
// session logs session_open in out/proxy-requests.jsonl, as the proxy does.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const [vmDir, prefix, vm, parentPid] = Bun.argv.slice(2) as [string, string, string, string];
const run = join(vmDir, "work/run"), out = join(run, "out");
mkdirSync(out, { recursive: true });
mkdirSync(join(run, "jobs"), { recursive: true });
const port = process.env.LEDGER_PORT ?? "9911";
const parentAlive = () => { try { process.kill(Number(parentPid), 0); return true; } catch { return false; } };
const end = (code: number) => {
  if (existsSync(join(vmDir, ".dead"))) process.exit(0);
  writeFileSync(join(out, "vm-run.exit"), code + "\n");
  process.exit(0);
};
if (process.env.TUNNEL_DOWN_VM === vm) { writeFileSync(join(out, "ledger-status-start.json"), ""); end(4); }
const jobs = ["job.json", ...readdirSync(run).filter((f) => /^job-\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)))];
let n = 0;
const pauseAt = process.env.PAUSE_VM === vm ? Number(process.env.PAUSE_AT ?? -1) : -1;
const capAt = process.env.PAUSE_VM === vm || !process.env.PAUSE_VM ? Number(process.env.CAP_STOP_AT ?? -1) : -1;
const crashAt = process.env.PAUSE_VM === vm || !process.env.PAUSE_VM ? Number(process.env.PROXY_CRASH_AT ?? -1) : -1;
const noResponse = !process.env.NO_RESPONSE_VM || process.env.NO_RESPONSE_VM === vm ? (process.env.NO_RESPONSE_AT ?? "").split(",").filter(Boolean).map(Number) : [];
const post = async (path: string, body: unknown) => {
  const r = await fetch("http://127.0.0.1:" + port + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
for (const f of jobs) {
  const job = JSON.parse(readFileSync(join(run, f), "utf8"));
  for (let a = 0; a < (job.n_attempts ?? 1); a++) for (const t of job.tasks) for (const ag of job.agents) {
    if (existsSync(join(run, "STOP")) || existsSync(join(out, "cap-stop.json"))) end(130);
    if (existsSync(join(vmDir, ".dead"))) process.exit(0);
    if (!parentAlive()) end(129);
    if (n === pauseAt) {
      writeFileSync(join(vmDir, "paused"), "");
      while (!existsSync(join(vmDir, "resume"))) {
        if (existsSync(join(vmDir, ".dead"))) process.exit(0);
        if (existsSync(join(run, "STOP"))) end(130);
        if (!parentAlive()) end(129);
        await Bun.sleep(50);
      }
    }
    const task = basename(t.path), arm = ag.kwargs.arm;
    const trial = task.slice(0, 32).replace(/[_-]+$/, "") + "__" + Math.random().toString(36).slice(2, 9).padEnd(7, "x");
    const sid = "s" + n + "-" + Math.random().toString(36).slice(2, 8);
    const dir = join(run, "jobs", job.job_name, trial);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ task: { path: t.path }, trial_name: trial, agent: { kwargs: ag.kwargs } }));
    n++;
    if (n - 1 === capAt) {
      appendFileSync(join(out, "proxy-requests.jsonl"), JSON.stringify({ event: "cap_stop", reason: "test cap stop" }) + "\n");
      writeFileSync(join(out, "cap-stop.json"), JSON.stringify({ cap_stop: "test cap stop", sessions: n }) + "\n");
      end(130);
    }
    let r;
    try { r = await post("/reserve", { id: prefix + sid, usd_micros: 5_000_000, meta: { trial: trial + "__env", model: "claude-opus-5-5", arm } }); }
    catch (e) { appendFileSync(join(out, "proxy-requests.jsonl"), JSON.stringify({ event: "reserve_failed", trial: trial + "__env", error: String(e).slice(0, 100) }) + "\n"); continue; }
    if (r.status !== 200) { appendFileSync(join(out, "proxy-requests.jsonl"), JSON.stringify({ event: "cap_stop", ledger: r.body }) + "\n"); writeFileSync(join(out, "cap-stop.json"), JSON.stringify({ cap_stop: "ledger refused" })); end(130); }
    appendFileSync(join(out, "proxy-requests.jsonl"), JSON.stringify({ event: "session_open", session: sid, trial: trial + "__env", model: "claude-opus-5-5", cap_micros: 5_000_000 }) + "\n");
    if (n - 1 === crashAt) {
      writeFileSync(join(vmDir, "paused"), "");
      for (;;) {
        if (existsSync(join(vmDir, ".dead"))) process.exit(0);
        if (existsSync(join(run, "STOP"))) end(130);
        if (!parentAlive()) end(129);
        await Bun.sleep(50);
      }
    }
    const spent = 100_000 + n;
    appendFileSync(join(out, "proxy-sessions.jsonl"), JSON.stringify({ id: sid, trial: trial + "__env", model: "claude-opus-5-5", cap_micros: 5_000_000, spent_micros: spent, ok_responses: noResponse.includes(n - 1) ? 0 : 1, closed_at: new Date().toISOString(), route_mark_before_output: arm === "after-u", meta: { arm } }) + "\n");
    writeFileSync(join(dir, "result.json"), "{}");
    try { await post("/settle", { id: prefix + sid, usd_micros: spent }); } catch {}
  }
}
end(0);
