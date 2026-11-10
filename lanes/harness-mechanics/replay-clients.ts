// Copyright (c) 2026 Garry Tan. MIT License.
// The replay's real clients (README, "Stage 2 replay"): replayClients() is what hm replay run --clients reads. Every call
// goes through judge/hm_replay.py, run in the judge tar's container under the decision-routing runtime beside this
// checkout's hm_judge.py, so the replay asks the questions the live hooks ask through the same deciders, timeouts and
// exact rules. Each paid call gets its own slot, for its one model, on a decision-routing metering proxy (unchanged) on
// 127.0.0.1 that holds the provider keys and journals the call; the slot's finalize is the call's cost_usd. det calls no
// model and costs 0. The container gets no key: each request line carries only its slot's URL and token.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FINALIZE_MAX_MS, MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { ARMS_DIR } from "./arms.ts";
import { JEV_MODEL } from "./judge.ts";
import { MemLedger } from "./leak.ts";
import { REPO } from "./pins.ts";
import type { ReplayAnswer, ReplayClient, ReplayClients, ReplayRequest } from "./replay.ts";
import { SESSION_IMAGE } from "./sessions.ts";

export type Who = Exclude<keyof ReplayClients, "close">;
export type BridgeRequest = ReplayRequest & { who: Who; proxy?: string; token?: string };
export type BridgeAnswer = Omit<ReplayAnswer, "cost_usd"> & { latency_ms: number };
export type Bridge = { ask: (r: BridgeRequest) => Promise<BridgeAnswer>; close: () => Promise<void> };

// The model each paid client's slot may call, as provider:model.
export const PAID: Record<Exclude<Who, "det">, string> = { astra: "openai:gpt-6-astra", opus: "anthropic:claude-opus-5-5", jev: "typesafe:" + JEV_MODEL, p1: "openrouter:particle-ai/particle-1" };
export const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY"] as const;
// One call's slot allowance. The run's lease and its batch stop bound the replay's spend; this bounds one call.
const CALL_ALLOWANCE_MICROS = 1_000_000;

/** The five clients over a bridge and a started proxy. A bridge that throws becomes a stop that still carries the call's metered cost. */
export function clientsOver(bridge: Bridge, proxy: MeteringProxy, close: () => Promise<void>): ReplayClients {
  const paid = (who: Exclude<Who, "det">): ReplayClient => async (req) => {
    const b = proxy.bind({ cell: { run_id: "hm-replay", arm: who, task: req.task, model: PAID[who], trial: 1, attempt: 1 }, models: [PAID[who]], allowance_micros: CALL_ALLOWANCE_MICROS });
    let a: BridgeAnswer;
    try {
      a = await bridge.ask({ ...req, who, proxy: "http://127.0.0.1:" + proxy.port + "/" + b.slot, token: b.token });
    } catch (e) {
      a = { label: "", tokens: 0, latency_ms: 0, stop: "E_HM_REPLAY the bridge failed on " + who + " for " + req.id + ": " + String((e as Error).message ?? e) };
    } finally {
      proxy.unbind(b.slot);
    }
    return { ...a, cost_usd: (await proxy.finalize(b.meter_id, FINALIZE_MAX_MS)).micros / 1_000_000 };
  };
  return { astra: paid("astra"), opus: paid("opus"), jev: paid("jev"), p1: paid("p1"), det: async (req) => ({ ...(await bridge.ask({ ...req, who: "det" })), cost_usd: 0 }), close };
}

/** A bridge program on stdin and stdout, one JSON line each way, answers matched by n. When it exits, every open request rejects. */
export function processBridge(argv: string[], cleanup: () => void = () => {}): Bridge {
  const p = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const open = new Map<number, { resolve: (a: BridgeAnswer) => void; reject: (e: Error) => void }>();
  let n = 0, dead: string | null = null;
  const reader = (async () => {
    let buf = "";
    const dec = new TextDecoder();
    for await (const chunk of p.stdout) {
      buf += dec.decode(chunk, { stream: true });
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const a = JSON.parse(line) as BridgeAnswer & { n: number };
        open.get(a.n)?.resolve(a);
        open.delete(a.n);
      }
    }
    dead = "E_HM_REPLAY the bridge exited " + (await p.exited);
    for (const w of open.values()) w.reject(new Error(dead));
    open.clear();
  })();
  return {
    ask: (r) => new Promise((resolve, reject) => {
      if (dead) return reject(new Error(dead));
      const k = ++n;
      open.set(k, { resolve, reject });
      p.stdin.write(JSON.stringify({ ...r, n: k }) + "\n");
      p.stdin.flush();
    }),
    close: async () => {
      p.stdin.end();
      await p.exited;
      await reader;
      cleanup();
    },
  };
}

/** hm_replay.py in an hm-session container holding the judge tar (ARMS_DIR/judge.tar), with this checkout's judge/ mounted read-only at /root/.hm/replay. */
export function containerBridge(): Bridge {
  const name = "hm-replay-" + process.pid + "-" + randomBytes(3).toString("hex"), judgeDir = join(REPO, "lanes/harness-mechanics/judge");
  const docker = (args: string[]) => { const r = spawnSync("docker", args, { encoding: "utf8" }); if (r.status !== 0) throw new Error("E_HM_REPLAY docker " + args[0] + " failed: " + (r.stderr ?? "").trim().slice(-200)); return r.stdout; };
  docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "-v", join(ARMS_DIR(), "judge.tar") + ":/judge.tar:ro", "-v", judgeDir + ":/root/.hm/replay:ro", SESSION_IMAGE, "sleep", "infinity"]);
  try {
    docker(["exec", name, "tar", "-xpf", "/judge.tar", "-C", "/root"]);
  } catch (e) {
    spawnSync("docker", ["rm", "-f", name]);
    throw e;
  }
  const cfg = { judge: "/root/.hm/judge/judge-p1.json", skills: "/root/.claude/skills", route: ["/opt/laneb/bin/bun", "--no-env-file", "--config=/dev/null", "/root/.claude/skills/gstack/bin/gstack-skill-route"] };
  return processBridge(["docker", "exec", "-i", name, "/root/.hm/dr/venv/bin/python", "-I", "-B", "/root/.hm/replay/hm_replay.py", JSON.stringify(cfg)], () => { spawnSync("docker", ["rm", "-f", name]); });
}

/** The real clients: a metering proxy on 127.0.0.1 with the provider keys from env, its journal in HM_REPLAY_WORK, and the container bridge. The dry run passes fake upstreams as fetch. */
export function replayClients(env: Record<string, string | undefined> = process.env, o: { bridge?: () => Bridge; fetch?: (input: string, init: RequestInit) => Promise<Response> } = {}): ReplayClients {
  const work = env.HM_REPLAY_WORK ?? "";
  if (!work) throw new Error("E_USAGE set HM_REPLAY_WORK to a directory for the replay clients' proxy journal");
  const missing = KEYS.filter((k) => !env[k]);
  if (missing.length) throw new Error("E_USAGE the replay's metering proxy needs " + missing.join(", ") + " in its environment");
  mkdirSync(work, { recursive: true });
  const proxy = new MeteringProxy({ ledger: new MemLedger(), leaseId: "hm-replay", host: "127.0.0.1", managementSocket: join(work, "m.sock"), managementToken: randomBytes(24).toString("hex"),
    journal: join(work, "journal.ndjson"), retry: { attempts: 3, elapsed_ms: 300_000 }, env: Object.fromEntries(KEYS.map((k) => [k, env[k]])), allowanceCode: "DR_ALLOWANCE_STOP", ...(o.fetch ? { fetch: o.fetch } : {}) });
  proxy.start();
  let b: Bridge;
  try { b = (o.bridge ?? containerBridge)(); } catch (e) { proxy.stop(); throw e; }
  return clientsOver(b, proxy, async () => { try { await b.close(); } finally { proxy.stop(); } });
}
