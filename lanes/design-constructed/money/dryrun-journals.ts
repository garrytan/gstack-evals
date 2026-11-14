// Copyright (c) 2026 Garry Tan. MIT License.
// The money area's dry-run case for wiring item 6: a same-host relaunch reads the proxy journals. Three direct calls are
// admitted on the ledger service and the host dies before any settles: one was linked to its slot and answered (its
// journal shows the outcome), one was never linked, one sits on a proxy that still holds its journal's lock. The
// relaunch settles the first at its metered spend and keeps the other two unknown at their full reservations (PD-18).
// No key, no network: the upstream is paid/scripted.ts.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectCallers } from "../paid/direct.ts";
import { scripted } from "../paid/scripted.ts";
import type { DryRunCase, LedgerItemId } from "../types.ts";
import { $ } from "./book.ts";
import { makeRecord } from "./dryrun-fixture.ts";
import { appendLink, type JournalScan } from "./journals.ts";
import { openLedgerService, type LedgerService, type ServiceConfig } from "./ledger-service.ts";
import { localWalTransport, RemoteTarget, WALCTL_PY } from "./offhost.ts";
import { DIRECT_MODELS, requestBody, ROUTE } from "./price.ts";
import { ProviderWatch } from "./served.ts";

const KEYS = { ANTHROPIC_API_KEY: "dry-run-not-a-key-anthropic", OPENAI_API_KEY: "dry-run-not-a-key-openai", OPENROUTER_API_KEY: "dry-run-not-a-key-openrouter" };

export function journalCases(): DryRunCase[] {
  return [
    {
      rule: "R2-3",
      name: "a same-host relaunch reads the proxy journals: an answered linked call settles at its spend, an unlinked one and one on a locked journal stay unknown",
      check: async () => {
        const dir = mkdtempSync(join(tmpdir(), "dc-journals-"));
        const stop: Array<() => void> = [];
        try {
          writeFileSync(join(dir, "walctl.py"), WALCTL_PY);
          mkdirSync(join(dir, "wal"));
          const transport = localWalTransport(join(dir, "walctl.py"), join(dir, "wal"), 10_000);
          if ((await transport(["init"])).exit !== 0) return "walctl init failed";
          mkdirSync(join(dir, "host", "ledger"), { recursive: true });
          const cfg: ServiceConfig = { runId: "dc-dryrun-journals", holder: join(dir, "host", "holders", "r"), record: makeRecord(join(dir, "host", "ledger")), ledgerPath: join(dir, "host", "ledger", "ledger.sqlite"), journalDir: join(dir, "host", "journals"), stateDir: join(dir, "host", "state"), hosts: [] };
          const boot = async (): Promise<LedgerService> => {
            const o = await openLedgerService(cfg, new RemoteTarget(transport));
            if (!o.ok) throw new Error("the service did not boot: " + o.captain);
            return o.service;
          };
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
          const scans = readdirSync(cfg.stateDir).filter((n) => n.startsWith("journals-"));
          const out: string[] = [];
          if (again.boot !== "same-host") out.push("the relaunch booted " + again.boot);
          if (sub(answered).state !== "settled" || !(sub(answered).spentMicros > 0)) out.push("the answered call is " + sub(answered).state + " at " + sub(answered).spentMicros);
          for (const id of [unlinked, locked]) if (sub(id).state !== "unknown" || sub(id).unknownMicros !== $(1)) out.push(id + " is " + sub(id).state + " with " + sub(id).unknownMicros + " unknown");
          if (again.status().held !== 2) out.push("status holds " + again.status().held + " unknown, not 2");
          if (scans.length !== 1) out.push("no journal scan was written");
          else {
            const scan = JSON.parse(readFileSync(join(cfg.stateDir, scans[0]!), "utf8")) as JournalScan;
            const why = Object.fromEntries(scan.unknown.map((u) => [u.sub, u.why]));
            if (why[unlinked] !== "no slot was linked to it" || why[locked] !== "its proxy journal could not be read" || scan.unread.length !== 1) out.push("the scan read " + JSON.stringify(scan.unknown) + " with " + scan.unread.length + " unread");
          }
          return out.length ? out.join("; ") : null;
        } finally {
          for (const f of stop) {
            try {
              f();
            } catch {}
          }
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ];
}
