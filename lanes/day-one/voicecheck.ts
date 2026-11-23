// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless voice check (prereg section 7; the Captain's C2 ruling): the real Codex CLI in the trial image, configured
// the way the adapter configures a gstack arm's voice, talks to a real metering proxy whose upstream is a stub. It shows
// that the container holds only the voice slot's bearer, that the proxy swaps in the provider key upstream, that the
// planner's bearer is refused on the voice slot, and that the slot meters the stub's usage fields exactly. The config
// is written as the driver writes it for a cell with a voice slot: the session's proxy with the voice's slot and bearer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexConfigCommand } from "../../src/adapters/claude-code/driver.ts";
import { openLease, recordApproval } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { DAYONE_RUN } from "./ledger.ts";

/** Runs a command without blocking the event loop, which serves the proxy in this same process. */
function exec(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((done) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => c.kill("SIGKILL"), timeoutMs);
    c.on("close", (status) => {
      clearTimeout(t);
      done({ stdout, stderr, status });
    });
  });
}

const STUB_KEY = "stub-provider-key-" + randomBytes(6).toString("hex");
const USAGE = { input_tokens: 2000, input_tokens_details: { cached_tokens: 500 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 2040 };

/** A Responses stream with one assistant message and the usage above. */
function stubStream(text: string): string {
  const msg = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  const ev = [
    { type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...msg, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_1", delta: text },
    { type: "response.output_item.done", output_index: 0, item: msg },
    { type: "response.completed", response: { id: "resp_1", status: "completed", output: [msg], usage: USAGE } },
  ];
  return ev.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

export async function runVoiceCheck(io: { out: (t: string) => void; err: (t: string) => void }, o: { docker?: string; image: string; host?: string; model?: string }): Promise<number> {
  const docker = o.docker ?? "docker";
  const model = o.model ?? "gpt-6-astra";
  const dir = mkdtempSync(join(tmpdir(), "day-one-voice-"));
  const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite")));
  const seen: { auth: string | null; model: string }[] = [];
  const fails: string[] = [];
  try {
    const record = join(dir, "record");
    recordApproval(record, { action: "init", item: "day1-plans", cap_micros: 10e6, quotes: [{ words: "keyless voice check on a temporary ledger", by: "day-one voice check", source: "section 7" }], admission: "warn" });
    const lease = openLease(record, local, { item: "day1-plans", run_id: DAYONE_RUN, requireAdmission: () => null });
    const proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: o.host ?? "172.17.0.1", managementSocket: join(dir, "m.sock"), managementToken: randomBytes(24).toString("hex"), journal: join(dir, "journal.ndjson"), retry: { attempts: 1, elapsed_ms: 1000 }, env: { OPENAI_API_KEY: STUB_KEY }, fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      seen.push({ auth: new Headers(init.headers).get("authorization"), model: body.model });
      return new Response(stubStream("VOICE-OK"), { headers: { "content-type": "text/event-stream" } });
    } });
    proxy.start();
    try {
      const cell = { run_id: DAYONE_RUN, arm: "a", task: "voice-check", model: "claude-opus-5-5", trial: 1, attempt: 1 };
      const planner = await proxy.bind({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 5e6 });
      const voice = await proxy.bind({ cell: { ...cell, arm: "a-voice" }, models: ["openai:" + model], allowance_micros: 5e6 });
      const baseUrl = "http://" + (o.host ?? "172.17.0.1") + ":" + proxy.port;
      const codex = { provider: "openai" as const, model, proxy: { slot: voice.slot, token: voice.token } };
      const session = { baseUrl, slot: planner.slot, token: planner.token } as Parameters<typeof codexConfigCommand>[1];
      const config = codexConfigCommand(codex, { ...session, ...codex.proxy });
      const run = (token: string) => exec(docker, ["run", "--rm", "-e", "HOME=/tmp/h", "-e", "OPENAI_API_KEY=" + token, "-e", "GSTACK_CODEX_NO_SANDBOX=1", "--entrypoint", "sh", o.image, "-c", "mkdir -p /tmp/h /tmp/w && cd /tmp/w && codex --version && " + config.trimEnd() + "\n" + "codex exec -s danger-full-access --skip-git-repo-check 'Reply with the word OK.' </dev/null 2>&1; echo EXIT=$?; [ \"$OPENAI_API_KEY\" = '" + voice.token + "' ] && echo BEARER=voice; grep -rl '" + STUB_KEY + "' /tmp/h /tmp/w 2>/dev/null | head -1 | sed 's/^/KEYFILE=/'"], 240_000);
      const ok = await run(voice.token);
      const okOut = ok.stdout + ok.stderr;
      const upstreamAfterOk = seen.length;
      const bad = await run(planner.token);
      const badOut = bad.stdout + bad.stderr;
      const m = await proxy.finalize(voice.meter_id);
      const want = (USAGE.input_tokens - USAGE.input_tokens_details.cached_tokens) * 10 + USAGE.input_tokens_details.cached_tokens * 1 + USAGE.output_tokens * 50;
      if (!/VOICE-OK/.test(okOut) || !/EXIT=0/.test(okOut)) fails.push("Codex with the voice bearer did not print the stub's answer: " + okOut.trim().slice(-400));
      if (!/BEARER=voice/.test(okOut)) fails.push("OPENAI_API_KEY in the container is not the voice slot's bearer");
      if (/KEYFILE=/.test(okOut + badOut)) fails.push("the provider key was found in a container file");
      if (upstreamAfterOk < 1 || seen.some((s) => s.auth !== "Bearer " + STUB_KEY)) fails.push("the provider did not get the proxy's key on every call");
      if (seen.some((s) => s.model !== model)) fails.push("an upstream call named a model other than " + model + ": " + seen.map((s) => s.model).join(", "));
      if (seen.length !== upstreamAfterOk) fails.push("the planner's bearer reached the provider on the voice slot");
      if (/VOICE-OK/.test(badOut)) fails.push("Codex with the planner's bearer got an answer");
      if (m.micros !== want * upstreamAfterOk) fails.push("the voice slot metered " + m.micros + " micros for " + upstreamAfterOk + " call(s); the usage fields price at " + want + " each");
      io.out((fails.length ? "FAIL" : "PASS") + " voice check: Codex " + (ok.stdout.match(/codex-cli [0-9.]+/)?.[0] ?? "") + " in the trial image answered through the voice slot with " + upstreamAfterOk + " upstream call(s), each carrying the proxy's key and model " + model + "; metered " + m.micros + " micros (" + want + " per call from the usage fields); the planner's bearer on the voice slot got no answer and reached no provider; no provider key in the container's env or files");
      for (const f of fails) io.out("  " + f);
    } finally {
      proxy.stop();
    }
  } finally {
    local.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return fails.length ? 2 : 0;
}
