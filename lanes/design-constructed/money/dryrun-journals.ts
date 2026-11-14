// Copyright (c) 2026 Garry Tan. MIT License.
// The money area's dry-run cases for wiring item 6: a same-host relaunch reads the proxy journals in direct/ and
// sessions/. Calls and sessions are admitted on the ledger service and the controller dies before any settles. The
// relaunch settles what a journal shows at its metered spend and keeps the rest unknown at its full reservation (PD-18):
// a call with no link, a journal a proxy still locks, and a session whose host died with a call still in flight. No
// key, no network: the upstream is paid/scripted.ts.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectCallers } from "../paid/direct.ts";
import { scripted } from "../paid/scripted.ts";
import { inProcessLauncher, SessionProxies, type SessionBinding } from "../paid/sessions.ts";
import type { DryRunCase, LedgerItemId } from "../types.ts";
import { $ } from "./book.ts";
import { admitted, makeRecord } from "./dryrun-fixture.ts";
import { appendLink, type JournalScan } from "./journals.ts";
import { openLedgerService, type LedgerService, type ServiceConfig } from "./ledger-service.ts";
import { localWalTransport, RemoteTarget, WALCTL_PY } from "./offhost.ts";
import { DIRECT_MODELS, requestBody, ROUTE } from "./price.ts";
import { ProviderWatch } from "./served.ts";

const KEYS = { ANTHROPIC_API_KEY: "dry-run-not-a-key-anthropic", OPENAI_API_KEY: "dry-run-not-a-key-openai", OPENROUTER_API_KEY: "dry-run-not-a-key-openrouter" };

interface Host {
  dir: string;
  cfg: ServiceConfig;
  boot: () => Promise<LedgerService>;
  stop: Array<() => unknown>;
}

async function withHost(name: string, fn: (h: Host) => Promise<string | null>): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "dc-journals-"));
  const stop: Array<() => unknown> = [];
  try {
    writeFileSync(join(dir, "walctl.py"), WALCTL_PY);
    mkdirSync(join(dir, "wal"));
    const transport = localWalTransport(join(dir, "walctl.py"), join(dir, "wal"), 10_000);
    if ((await transport(["init"])).exit !== 0) return "walctl init failed";
    mkdirSync(join(dir, "host", "ledger"), { recursive: true });
    const cfg: ServiceConfig = { runId: name, holder: join(dir, "host", "holders", "r"), record: makeRecord(join(dir, "host", "ledger")), ledgerPath: join(dir, "host", "ledger", "ledger.sqlite"), journalDir: join(dir, "host", "journals"), stateDir: join(dir, "host", "state"), hosts: [] };
    const boot = async (): Promise<LedgerService> => {
      const o = await openLedgerService(cfg, new RemoteTarget(transport));
      if (!o.ok) throw new Error("the service did not boot: " + o.captain);
      return o.service;
    };
    return await fn({ dir, cfg, boot, stop });
  } finally {
    for (const f of stop) {
      try {
        await f();
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

const scanOf = (stateDir: string): JournalScan | null => {
  const scans = readdirSync(stateDir).filter((n) => n.startsWith("journals-"));
  return scans.length === 1 ? (JSON.parse(readFileSync(join(stateDir, scans[0]!), "utf8")) as JournalScan) : null;
};

const sessionCall = (b: SessionBinding, prompt: string) =>
  fetch(b.baseUrl + "/v1/messages", { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: b.model.slice(b.model.indexOf(":") + 1), max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) }).then((r) => r.text());

export function journalCases(): DryRunCase[] {
  return [
    {
      rule: "R2-3",
      name: "a same-host relaunch reads the proxy journals: an answered linked call settles at its spend, an unlinked one and one on a locked journal stay unknown",
      check: () =>
        withHost("dc-dryrun-journals", async ({ dir, cfg, boot, stop }) => {
          const svc = await boot();
          const c = svc.controller;
          const up = scripted(() => ({ kind: "ok", input: 1000, output: 200 }));
          const callers = new DirectCallers({ controller: c, local: svc.local, wal: svc.wal, watch: new ProviderWatch({ controller: c, out: join(dir, "watch") }), dir: join(cfg.journalDir, "direct"), cacheDir: join(dir, "cache"), retry: { attempts: 1, elapsed_ms: 1000 }, env: KEYS, fetch: (u, i) => up.fetch(u, i) });
          stop.push(() => callers.stopAll());
          const m = DIRECT_MODELS.opus;
          const call = async (item: LedgerItemId, run: string, link: boolean) => {
            await c.openItem(item);
            const a = await c.admitCall(item, { run, model: "opus", worstCaseMicros: $(1) });
            if (a.kind !== "admitted") throw new Error(run + " was not admitted: " + a.kind);
            const p = callers.proxy(item);
            const b = p.bind({ cell: { run_id: c.runId, arm: "dc", task: run, model: m.id, trial: 1, attempt: 1 }, models: ["anthropic:" + m.id], allowance_micros: $(1) });
            if (link) appendLink(join(cfg.journalDir, "direct"), { sub: a.sub.id, item, lease: c.lease(item)!.leaseId, meter: b.meter_id, journal: callers.journal(item)! });
            const res = await fetch("http://127.0.0.1:" + p.port + "/" + b.slot + "/anthropic" + ROUTE.anthropic, { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify(requestBody("opus", "hi", 16, null)) });
            await res.text();
            return a.sub.id;
          };
          const answered = await call("dc-authoring-1", "answered", true);
          const unlinked = await call("dc-authoring-1", "unlinked", false);
          const locked = await call("dc-judges", "locked", true);
          const judges = callers.proxy("dc-judges");
          callers.proxy("dc-authoring-1").stop();
          svc.close();
          const again = await boot();
          stop.push(() => again.close());
          judges.stop();
          const sub = (id: string) => again.controller.sub(id)!;
          const out: string[] = [];
          if (again.boot !== "same-host") out.push("the relaunch booted " + again.boot);
          if (sub(answered).state !== "settled" || !(sub(answered).spentMicros > 0)) out.push("the answered call is " + sub(answered).state + " at " + sub(answered).spentMicros);
          for (const id of [unlinked, locked]) if (sub(id).state !== "unknown" || sub(id).unknownMicros !== $(1)) out.push(id + " is " + sub(id).state + " with " + sub(id).unknownMicros + " unknown");
          if (again.status().held !== 2) out.push("status holds " + again.status().held + " unknown, not 2");
          const scan = scanOf(cfg.stateDir);
          if (!scan) out.push("no journal scan was written");
          else {
            const why = Object.fromEntries(scan.unknown.map((u) => [u.sub, u.why]));
            if (why[unlinked] !== "no slot was linked to it" || why[locked] !== "its proxy journal could not be read" || scan.unread.length !== 1) out.push("the scan read " + JSON.stringify(scan.unknown) + " with " + scan.unread.length + " unread");
          }
          return out.length ? out.join("; ") : null;
        }),
    },
    {
      rule: "R2-3",
      name: "a host lost mid-session: the relaunch reads sessions/, settles an ended session's round at its meters and keeps a round with a call in flight unknown at its full reservation",
      check: () =>
        withHost("dc-dryrun-journals-sessions", async ({ cfg, boot, stop }) => {
          const svc = await boot();
          const c = svc.controller;
          const up = scripted(() => ({ kind: "ok", input: 2000, output: 400 }));
          let release: (() => void) | null = null;
          const upstream = async (u: string, i: RequestInit) => {
            if (String(i.body).includes("hang")) await new Promise<void>((r) => (release = r));
            return up.fetch(u, i);
          };
          const sessions = new SessionProxies({ controller: c, local: svc.local, wal: svc.wal, watch: new ProviderWatch({ controller: c, out: join(cfg.stateDir, "watch") }), dir: join(cfg.journalDir, "sessions"), launcher: inProcessLauncher({ local: svc.local, retry: { attempts: 1, elapsed_ms: 1000 }, env: KEYS, fetch: upstream }) });
          stop.push(() => sessions.stopAll());
          const item: LedgerItemId = "dc-stage1-opus";
          await c.openItem(item);
          const ended = admitted(await c.admitRound(item, { run: "ended u1", model: "opus", arms: ["none"] }), "the ended round");
          const b1 = await sessions.bind(item, { sub: ended, session: ended.sessions[0]!.id, attempt: 1, arm: "none" });
          await sessionCall(b1, "review the plan");
          await sessionCall(b1, "review it again");
          const meter = (await sessions.end(b1)).spentMicros;
          const midway = admitted(await c.admitRound(item, { run: "midway u2", model: "opus", arms: ["none"] }), "the midway round");
          const b2 = await sessions.bind(item, { sub: midway, session: midway.sessions[0]!.id, attempt: 1, arm: "none" });
          await sessionCall(b2, "review the plan");
          const inFlight = sessionCall(b2, "hang here").catch(() => null);
          for (let i = 0; i < 200 && !release; i++) await new Promise((r) => setTimeout(r, 10));
          await sessions.stopAll();
          svc.close();
          await inFlight;
          const again = await boot();
          stop.push(() => again.close());
          const out: string[] = [];
          if (!release) out.push("the in-flight call never reached the upstream");
          const s1 = again.controller.sub(ended.id)!;
          const s2 = again.controller.sub(midway.id)!;
          if (again.boot !== "same-host") out.push("the relaunch booted " + again.boot);
          if (s1.state !== "settled" || !(meter > 0) || s1.spentMicros !== meter) out.push("the ended round is " + s1.state + " at " + s1.spentMicros + ", its meter read " + meter);
          if (s2.state !== "unknown" || s2.unknownMicros !== midway.reserveMicros) out.push("the midway round is " + s2.state + " with " + s2.unknownMicros + " unknown of " + midway.reserveMicros);
          if (again.status().held !== 1) out.push("status holds " + again.status().held + " unknown, not 1");
          const scan = scanOf(cfg.stateDir);
          const why = scan?.unknown.find((u) => u.sub === midway.id)?.why ?? "";
          if (!scan || !scan.read.some((r) => r.journal.includes("/sessions/")) || !why.includes("no outcome")) out.push("the scan read " + JSON.stringify(scan));
          return out.length ? out.join("; ") : null;
        }),
    },
  ];
}
