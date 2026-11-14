// Copyright (c) 2026 Garry Tan. MIT License.
// The paid seams: every dry-run case as its own test, plus unit checks on the served-provider read, the write-ahead
// relay and its client, the real proxy-entry with the relay switched on, the served-provider watch, the pin record and
// the pins command. No key is read and nothing reaches a network.
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProxyControl, servedOf } from "../../../src/runner/proxy/metering-proxy.ts";
import { startProxyContainer } from "../../../src/trial/proxy.ts";
import { relayedLedger } from "../../../src/trial/write-ahead.ts";
import type { CallOutcome, LedgerReply, ReservationLedger } from "../../../src/types.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { withRig } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { ProviderWatch } from "../../../lanes/design-constructed/money/served.ts";
import { DIRECT_MAX_OUTPUT_TOKENS, KEY_NAMES, providerKeys } from "../../../lanes/design-constructed/paid/direct.ts";
import { cases, endpointsFixture, FAKE_KEYS, journalLines, withPaid } from "../../../lanes/design-constructed/paid/dryrun-cases.ts";
import { pinsCommand } from "../../../lanes/design-constructed/paid/cli.ts";
import { pinRecord, probePlan, probeScript, writePinRecord } from "../../../lanes/design-constructed/paid/pin.ts";
import { relayEntry, serveWriteAhead } from "../../../lanes/design-constructed/paid/relay.ts";
import { sessionAllowance } from "../../../lanes/design-constructed/paid/sessions.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

describe("paid dry-run cases", () => {
  for (const c of cases()) {
    test(c.rule + " " + c.name, async () => {
      expect(await c.check()).toBeNull();
    });
  }
});

describe("served provider read (metering proxy, off by default)", () => {
  test("a JSON body, a chat stream and an Anthropic-shaped stream name their provider and id", () => {
    expect(servedOf(JSON.stringify({ id: "gen-1", provider: "OpenAI", choices: [] }))).toEqual({ provider: "OpenAI", id: "gen-1" });
    expect(servedOf('data: {"id":"gen-2","provider":"Particle","choices":[]}\n\ndata: [DONE]\n\n')).toEqual({ provider: "Particle", id: "gen-2" });
    expect(servedOf('event: message_start\ndata: {"type":"message_start","message":{"id":"gen-3","provider":"OpenAI"}}\n\n')).toEqual({ provider: "OpenAI", id: "gen-3" });
    expect(servedOf(JSON.stringify({ id: "msg_1", content: [] }))).toEqual({ provider: null, id: "msg_1" });
    expect(servedOf("not json")).toEqual({ provider: null, id: null });
  });

  test("a direct proxy, with the option off, journals no served-provider field", async () => {
    const why = await withPaid({}, async ({ r, direct }) => {
      await r.c.openItem("dc-judges");
      await direct.judge("dc-judges")({ judge: "argon", prompt: "p", effort: "medium", maxTokens: 1000, label: "p", subject: null, cacheKey: "p" });
      const out = journalLines(direct.journal("dc-judges")).filter((l) => l.kind === "outcome");
      return out.length === 1 && !("served_provider" in out[0]!) && !("generation_id" in out[0]!) ? null : JSON.stringify(out);
    });
    expect(why).toBeNull();
  });
});

describe("write-ahead relay and its client", () => {
  const cell = { run_id: "r", arm: "none", task: "s1", model: "claude-opus-5-5", trial: 1, attempt: 1, meter_id: "m_1" };

  test("the relay takes only reserve and outcome lines on its own lease, rebuilt from checked fields", () => {
    const ok = relayEntry({ kind: "reserve", idempotency_key: "m_1:1:1", lease_id: "L", cell: { ...cell, extra: "x" }, max_micros: 5, reservation_id: "res_1", sub: { id: "forged" } }, "L");
    expect(ok).toEqual({ kind: "reserve", idempotency_key: "m_1:1:1", lease_id: "L", cell, max_micros: 5, reservation_id: "res_1" });
    expect(typeof relayEntry({ kind: "admit", sub: {} }, "L")).toBe("string");
    expect(typeof relayEntry({ kind: "reserve", idempotency_key: "k", lease_id: "other", cell, max_micros: 5, reservation_id: "r" }, "L")).toBe("string");
    expect(typeof relayEntry({ kind: "reserve", idempotency_key: "k", lease_id: "L", cell, max_micros: 0.5, reservation_id: "r" }, "L")).toBe("string");
    expect(relayEntry({ kind: "outcome", reservation_id: "res_1", outcome: { kind: "unknown", note: "x" } }, "L")).toEqual({ kind: "outcome", reservation_id: "res_1", outcome: { kind: "unknown" } });
    expect(typeof relayEntry({ kind: "outcome", reservation_id: "res_1", outcome: { kind: "spent", spent_micros: -1, usage: {} } }, "L")).toBe("string");
  });

  test("the client answers a reserve only after the relay acknowledges it, throws when it doesn't, and copies outcomes best effort", async () => {
    const why = await withRig({ wal: true }, async (r) => {
      const inner: ReservationLedger = {
        reserve: async (q) => ({ ok: true, reservation: { reservation_id: "res_1", ...q, state: "reserved", spent_micros: null, usage: null } }) as LedgerReply,
        settle: async (id: string, o: CallOutcome) => ({ ok: true, reservation: { reservation_id: id, idempotency_key: "k", lease_id: "L", cell, max_micros: 5, state: "settled", spent_micros: o.kind === "spent" ? o.spent_micros : null, usage: null } }) as LedgerReply,
      };
      const socket = join(r.dir, "wal.sock");
      const relay = serveWriteAhead({ wal: r.wal!, socket, leaseId: "L" });
      try {
        const led = relayedLedger(inner, socket);
        const reply = await led.reserve({ idempotency_key: "m_1:1:1", lease_id: "L", cell, max_micros: 5 });
        const lines = await r.target.lines();
        if (!reply.ok || relay.acked() !== 1 || !lines.some((l) => l.includes('"res_1"'))) return "the reserve was not copied first";
        const wrong = await led.reserve({ idempotency_key: "k2", lease_id: "M", cell, max_micros: 5 }).then(() => "answered", (e: Error) => e.message);
        if (!/400/.test(wrong)) return "a reserve on another lease read " + wrong;
        relay.stop();
        const lost = await led.reserve({ idempotency_key: "k3", lease_id: "L", cell, max_micros: 5 }).then(() => "answered", () => "threw");
        if (lost !== "threw") return "a reserve with no relay was answered";
        const settled = await led.settle("res_1", { kind: "unknown" });
        return settled.ok ? null : "a settle failed with the relay gone";
      } finally {
        relay.stop();
      }
    });
    expect(why).toBeNull();
  });

  test("proxy-entry with write_ahead_socket refuses a call whose copy no relay acknowledges, with nothing sent", async () => {
    const why = await withRig({ wal: true }, async (r) => {
      await r.c.openItem("dc-stage1-particle");
      const lease = r.c.lease("dc-stage1-particle")!;
      const dir = join(r.dir, "proxy");
      mkdirSync(dir, { recursive: true });
      const config = { lease_id: lease.leaseId, ledger: r.ledgerPath, journal: join(dir, "journal.ndjson"), socket: join(dir, "management.sock"), host: "127.0.0.1", port: 0, retry: { attempts: 1, elapsed_ms: 1000 }, write_ahead_socket: join(dir, "write-ahead.sock"), served_provider: true };
      writeFileSync(join(dir, "config.json"), JSON.stringify(config));
      const token = "test-management-token-0123456789";
      const child = spawn(process.execPath, [join(REPO, "src", "trial", "proxy-entry.ts"), join(dir, "config.json")], { env: { PATH: "/usr/bin:/bin", HOME: dir, GSTACK_EVALS_PROXY_TOKEN: token, OPENROUTER_API_KEY: FAKE_KEYS.OPENROUTER_API_KEY }, stdio: ["ignore", "pipe", "pipe"] });
      try {
        const ready = await new Promise<string>((res, rej) => {
          let out = "";
          child.stdout!.on("data", (b) => {
            out += String(b);
            const m = out.match(/PROXY_READY \S+:(\d+)/);
            if (m) res(m[1]!);
          });
          child.on("exit", () => rej(new Error("proxy-entry exited")));
          setTimeout(() => rej(new Error("proxy-entry did not start")), 15_000);
        });
        const control = new ProxyControl(config.socket, token);
        const b = await control.bind({ cell: { run_id: r.c.runId, arm: "none", task: "s1", model: "particle-ai/particle-1", trial: 1, attempt: 1 }, models: ["openrouter:particle-ai/particle-1"], allowance_micros: 500_000 });
        const res = await fetch("http://127.0.0.1:" + ready + "/" + b.slot + "/openrouter/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify({ model: "particle-ai/particle-1", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }) });
        const body = await res.text();
        const lines = journalLines(config.journal);
        if (res.status !== 503 || !body.includes("E_LEDGER_UNAVAILABLE")) return "the call read " + res.status + " " + body.slice(0, 200);
        if (!lines.some((l) => l.kind === "reserve") || lines.some((l) => l.kind === "request")) return "the journal shows a send: " + lines.map((l) => l.kind).join(",");
        return null;
      } finally {
        child.kill("SIGTERM");
      }
    });
    expect(why).toBeNull();
  }, 30_000);

  test("startProxyContainer refuses a relay socket outside the proxy's mounted directory before any docker call", () => {
    const dir = tmp("dc-paid-container-");
    try {
      expect(() => startProxyContainer({ image: "none", net: { name: "n", egress: "e", subnet: "10.231.0.0/24", proxyIp: "10.231.0.2" }, dir, ledger: join(dir, "l.sqlite"), leaseId: "L", managementToken: "t", retry: { attempts: 1, elapsed_ms: 1 }, docker: "/nonexistent/docker", writeAheadSocket: join(tmpdir(), "elsewhere.sock") })).toThrow(/mounted directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("served-provider watch", () => {
  test("an unnamed or unpinned OpenRouter provider drifts; the stop applies once and every drifting call throws", async () => {
    const why = await withRig({}, async (r) => {
      const watch = new ProviderWatch({ controller: r.c, out: join(r.dir, "out"), datedTerms: { argon: "Google Vertex" } });
      const heard: string[] = [];
      watch.onDrift((m) => void heard.push(m));
      await watch.check({ model: "opus", servedBy: "anthropic", via: "session", label: "s" });
      const codes: string[] = [];
      for (const servedBy of [null, "Azure"]) await watch.check({ model: "sol", servedBy, via: "direct", label: "d" }).catch((e) => codes.push((e as DcError).code));
      await watch.check({ model: "argon", servedBy: "Google", via: "direct", label: "a" }).catch((e) => codes.push((e as DcError).code));
      if (codes.join() !== "E_DC_PROVIDER_DRIFT,E_DC_PROVIDER_DRIFT,E_DC_PROVIDER_DRIFT") return "codes " + codes.join();
      if (heard.join() !== "sol,argon") return "listeners heard " + heard.join();
      const t = watch.terms();
      return t.length === 3 && t.find((l) => l.model === "opus")!.routing === null && t.find((l) => l.model === "sol")!.servedBy === null ? null : JSON.stringify(t);
    });
    expect(why).toBeNull();
  });
});

describe("keys, caps and allowances", () => {
  test("a proxy's env holds the three provider keys by name and nothing else", () => {
    expect(Object.keys(providerKeys({ ...FAKE_KEYS, UBICLOUD_API_KEY: "x", PATH: "/bin" })).sort()).toEqual([...KEY_NAMES].sort());
    expect(DIRECT_MAX_OUTPUT_TOKENS).toBe(48_000);
  });

  test("each session item binds at its frozen allowance; a direct item runs no sessions", () => {
    expect(sessionAllowance("dc-stage2-opus")).toBe(10_000_000);
    expect(sessionAllowance("dc-stage1-particle")).toBe(500_000);
    expect(sessionAllowance("dc-base-apps")).toBe(5_000_000);
    expect(sessionAllowance("dc-stage3-authoring")).toBe(15_000_000);
    expect(() => sessionAllowance("dc-judges")).toThrow(/no agent sessions/);
  });
});

describe("pin record and the pins command", () => {
  const reads = () => ({ sol: endpointsFixture("sol"), particle: endpointsFixture("particle"), argon: endpointsFixture("argon") });

  test("the script quotes every argument and sends no header", () => {
    const lines = probeScript(probePlan("/tmp/probe dir"));
    expect(lines[0]).toBe("set -eu");
    expect(lines.slice(2).every((l) => l.startsWith("curl ") && !/ -H | --header /.test(l) && l.includes("'/tmp/probe dir/"))).toBe(true);
  });

  test("the record is written once per run", () => {
    const dir = tmp("dc-paid-pin-");
    try {
      const rec = pinRecord({ runId: "r1", commit: "a".repeat(40), dated: "2026-11-14T00:00:00Z", reads: reads() });
      writePinRecord(join(dir, "pins.json"), rec);
      expect(() => writePinRecord(join(dir, "pins.json"), rec)).toThrow(/written once per run/);
      expect(() => pinRecord({ runId: "r1", commit: "main", dated: "2026-11-14T00:00:00Z", reads: reads() })).toThrow(/40 hex/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pins plan writes plan.json into a new directory; pins record parses the reads and exits 1 on a missing one", () => {
    const root = tmp("dc-paid-pins-");
    try {
      const dir = join(root, "probe");
      const out: string[] = [];
      const io = { out: (t: string) => void out.push(t) };
      expect(pinsCommand({ flags: new Map([["--dir", dir]]), rest: ["plan"] }, io)).toBe(0);
      expect(existsSync(join(dir, "plan.json")) && out.some((l) => l.includes("openrouter.ai/api/v1/models/openai/gpt-6.1-sol/endpoints"))).toBe(true);
      expect(() => pinsCommand({ flags: new Map([["--dir", dir]]), rest: ["plan"] }, io)).toThrow(/doesn't exist yet/);
      for (const [m, text] of Object.entries(reads())) writeFileSync(join(dir, m + ".endpoints.json"), text);
      const flags = (outFile: string) => new Map([["--dir", dir], ["--run", "r1"], ["--commit", "b".repeat(40)], ["--out", outFile], ["--dated", "2026-11-14T00:00:00Z"]]);
      expect(pinsCommand({ flags: flags(join(root, "pins.json")), rest: ["record"] }, io)).toBe(0);
      const rec = JSON.parse(readFileSync(join(root, "pins.json"), "utf8"));
      expect(rec.ok).toBe(true);
      expect(rec.routes.find((x: any) => x.model === "sol").served).toBe("OpenAI");
      rmSync(join(dir, "argon.endpoints.json"));
      expect(pinsCommand({ flags: flags(join(root, "pins2.json")), rest: ["record"] }, io)).toBe(1);
      expect(out.at(-1)).toMatch(/^pins: STOP for the Captain/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
