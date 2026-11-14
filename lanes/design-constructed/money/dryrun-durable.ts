// Copyright (c) 2026 Garry Tan. MIT License.
// The money area's dry-run cases that make calls or lose a host: the metered client through the real metering proxy
// behind a fake upstream (L1's worst case, L3's reply cache, PD-9's drift and terms), the write-ahead copy and recovery
// through main's reconcileJournal and reconcileLease (R2-4), renewal with a live session (R2-13), and the controller
// host's deletion and relaunch from the verified copy (R2-3, L7).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { reconcileJournal } from "../../../src/runner/proxy/metering-proxy.ts";
import type { AnyModel, DryRunCase, LedgerItemId } from "../types.ts";
import { $ } from "./book.ts";
import { admitted, expectations, fakeReply, QUOTE, startProxy, withRig, type ProxyRig, type Rig, type Upstream } from "./dryrun-fixture.ts";
import { DirTarget, latestSnapshot, ownerReconcile, recover, replayReserves, restoreLedgerFile, snapshotDue, takeSnapshot, writeAheadLedger } from "./durability.ts";
import { admitVm, deleteController, idleDelete, settleVm } from "./hosts.ts";
import { mainLeases } from "./ledger-main.ts";
import { ledgerFigures, openMeter, type Meter } from "./meter.ts";
import { requestBody, worstCaseMicros, DIRECT_MODELS } from "./price.ts";
import { renew, renewalDue } from "./renewal.ts";
import type { OffHostTarget } from "./types.ts";

/** A directory target that refuses the lines a test names, as a lost link or a host killed mid-copy does. */
class FailingTarget extends DirTarget {
  constructor(dir: string, private readonly failWhen: (line: string) => boolean) {
    super(dir);
  }
  override async append(line: string): Promise<void> {
    if (this.failWhen(line)) throw new Error("the off-host target did not answer");
    return super.append(line);
  }
}

const PROVIDER_OF: Record<string, string> = { "openai/gpt-6.1-sol": "OpenAI", "google/gemini-4-argon": "Google", "particle-ai/particle-1": "Particle AI" };
const pinned: Upstream = (url, body) => fakeReply({ provider: PROVIDER_OF[body.model] ?? "OpenAI" })(url, body);

function meterOn(r: Rig, item: LedgerItemId, px: () => ProxyRig, o: { datedTerms?: Partial<Record<AnyModel, string>> } = {}): Meter {
  return openMeter({ controller: r.c, item, runId: r.c.runId, proxy: () => px().proxy, figures: ledgerFigures(r.local, () => r.c.lease(item)?.leaseId ?? null), cacheDir: join(r.dir, "cache-" + item), out: join(r.dir, "out-" + item), datedTerms: o.datedTerms });
}

const journalLines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : []);

async function withProxy(r: Rig, item: LedgerItemId, upstream: Upstream, fn: (px: ProxyRig) => Promise<string | null>, walLedger = false): Promise<string | null> {
  await r.c.openItem(item);
  const px = startProxy(r, item, upstream, { walLedger });
  try {
    return await fn(px);
  } finally {
    px.stop();
  }
}

export function durableCases(): DryRunCase[] {
  return [
    {
      rule: "L1",
      name: "the controller admits each direct call at exactly the metering proxy's own reserve, on every lane model",
      check: () =>
        withRig({}, (r) =>
          withProxy(r, "dc-judges", pinned, async (px) => {
            const m = meterOn(r, "dc-judges", () => px);
            const models: AnyModel[] = ["opus", "astra", "sol", "argon", "particle"];
            const want: number[] = [];
            for (const model of models) {
              const prompt = "Label each change against the key. ".repeat(40) + model;
              want.push(worstCaseMicros(DIRECT_MODELS[model].provider, requestBody(model, prompt, 16_000)));
              const res = await m.call({ model, prompt, maxTokens: 16_000, label: "packet-" + model });
              if (res.status !== 200) return model + " call read " + res.status + " " + res.problem;
            }
            const got = journalLines(px.journal).filter((l) => l.kind === "reserve").map((l) => l.max_micros as number);
            const subs = r.c.subsOf("dc-judges").map((s) => s.reserveMicros);
            return JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(subs) === JSON.stringify(want) ? null : "proxy reserved " + got.join(",") + "; controller " + subs.join(",");
          }),
        ),
    },
    {
      rule: "L3",
      name: "a resend of the same request is answered from the reply cache and pays nothing",
      check: () =>
        withRig({}, (r) =>
          withProxy(r, "dc-judges", pinned, async (px) => {
            const m = meterOn(r, "dc-judges", () => px);
            const a = await m.call({ model: "astra", prompt: "packet 1", maxTokens: 4000, label: "p1" });
            const settled = r.c.figures("dc-judges").settledMicros;
            const b = await m.call({ model: "astra", prompt: "packet 1", maxTokens: 4000, label: "p1 resend" });
            return !a.cached && b.cached && b.micros === 0 && px.sent.length === 1 && r.c.figures("dc-judges").settledMicros === settled ? null : "sent " + px.sent.length + ", cached " + b.cached;
          }),
        ),
    },
    {
      rule: "PD-9",
      name: "a reply from a provider other than the pin stops every call on that model in every role; the first call records provider and terms",
      check: () =>
        withRig({}, async (r) => {
          await r.c.openItem("dc-judges");
          let flip = false;
          return withProxy(r, "dc-authoring-1", (url, body) => fakeReply({ provider: body.model === "google/gemini-4-argon" ? (flip ? "Some Other Host" : "Google") : PROVIDER_OF[body.model] ?? "OpenAI" })(url, body), async (px) => {
            const e = expectations();
            const m = meterOn(r, "dc-authoring-1", () => px);
            e.want((await m.call({ model: "argon", prompt: "author unit 1", maxTokens: 24_000, label: "author-1" })).status === 200, "the pinned Argon call failed");
            const terms = m.terms();
            e.want(terms.length === 1 && terms[0]!.servedBy === "Google" && (terms[0]!.routing as any)?.data_collection === "deny" && (terms[0]!.routing as any)?.allow_fallbacks === false, "the first call's terms: " + JSON.stringify(terms));
            flip = true;
            let code = "";
            try {
              await m.call({ model: "argon", prompt: "author unit 2", maxTokens: 24_000, label: "author-2" });
            } catch (err) {
              code = (err as { code?: string }).code ?? "";
            }
            e.want(code === "E_DC_PROVIDER_DRIFT", "the drifted reply read " + code);
            e.want((await r.c.admitCall("dc-judges", { run: "panel vote", model: "argon", subject: "particle", worstCaseMicros: $(1) })).kind === "stopped", "an Argon judge call was admitted after the drift");
            e.want((await m.call({ model: "sol", prompt: "author unit 3", maxTokens: 24_000, label: "author-3" })).status === 200, "a Sol call was stopped");
            e.want(r.c.figures("dc-authoring-1").inFlightCount === 0, "a drifted call stayed in flight");
            return e.result();
          });
        }),
    },
    {
      rule: "PD-9",
      name: "a serving provider that differs from the dated terms record is drift",
      check: () =>
        withRig({}, (r) =>
          withProxy(r, "dc-authoring-1", (url, body) => fakeReply({ provider: "particle-ai-eu" })(url, body), async (px) => {
            const m = meterOn(r, "dc-authoring-1", () => px, { datedTerms: { particle: "Particle AI" } });
            try {
              await m.call({ model: "particle", prompt: "probe", maxTokens: 1000, label: "probe" });
            } catch (err) {
              return (err as { code?: string }).code === "E_DC_PROVIDER_DRIFT" ? null : "threw " + (err as Error).message;
            }
            return "no drift on a provider the dated record does not name";
          }),
        ),
    },
    {
      rule: "R2-4",
      name: "the host killed after a dispatch and before its copy: nothing is forwarded and recovery holds nothing",
      check: async () => {
        const dir = mkdtempSync(join(tmpdir(), "dc-money-target-"));
        const target = new FailingTarget(dir, (l) => l.includes('"kind":"admit"'));
        return withRig({ wal: true, target }, async (r2) =>
          withProxy(r2, "dc-judges", pinned, async (px) => {
            const e = expectations();
            const m = meterOn(r2, "dc-judges", () => px);
            const res = await m.call({ model: "astra", prompt: "packet", maxTokens: 4000, label: "p1" });
            e.want(res.refused?.kind === "unacked" && px.sent.length === 0, "the call read " + res.refused?.kind + " with " + px.sent.length + " sent");
            px.stop();
            r2.local.close();
            rmSync(join(r2.dir, "host"), { recursive: true, force: true });
            const rec = await recover(target, { runId: r2.c.runId, holder: r2.holder, leases: r2.leases });
            e.want(rec.kind === "recovered" && rec.held.length === 0 && rec.uncertainMicros === 0 && rec.controller.lease("dc-judges") !== null, "recovery read " + JSON.stringify(rec.kind === "recovered" ? { held: rec.held.length } : rec));
            return e.result();
          }),
        );
      },
    },
    {
      rule: "R2-4",
      name: "a proxy reserve whose copy is not acknowledged is refused with nothing sent, main's reconciler releases it at $0, and a snapshot restarts the copy",
      check: async () => {
        const dir = mkdtempSync(join(tmpdir(), "dc-money-target-"));
        let fail = true;
        const target = new FailingTarget(join(dir, "offhost"), (l) => fail && l.includes('"kind":"reserve"'));
        return withRig({ wal: true, target }, async (r) =>
          withProxy(
            r,
            "dc-authoring-1",
            pinned,
            async (px) => {
              const e = expectations();
              const m = meterOn(r, "dc-authoring-1", () => px);
              const res = await m.call({ model: "sol", prompt: "author", maxTokens: 24_000, label: "a1" });
              e.want(res.status === 503 && px.sent.length === 0, "the call read " + res.status + " with " + px.sent.length + " sent");
              const sub = r.c.subsOf("dc-authoring-1")[0]!;
              e.want(sub.state === "unknown", "the refused call's hold read " + sub.state);
              px.stop();
              const rec = await reconcileJournal(px.journal, r.local);
              e.want(rec.released.length === 1 && r.local.held(r.c.lease("dc-authoring-1")!.leaseId) === 0, "main's reconciler released " + rec.released.length);
              await r.c.reconcile(sub.id, 0);
              e.want((await r.c.admitCall("dc-authoring-1", { run: "a2", model: "sol", worstCaseMicros: $(1) })).kind === "unacked", "an admission went through a broken copy");
              fail = false;
              await takeSnapshot(r.c, r.wal!, target, { ledgerPath: r.ledgerPath });
              e.want((await r.c.admitCall("dc-authoring-1", { run: "a2", model: "sol", worstCaseMicros: $(1) })).kind === "admitted", "the snapshot did not restart the copy");
              return e.result();
            },
            true,
          ),
        );
      },
    },
    {
      rule: "R2-4",
      name: "recovery with an uncheckpointed write-ahead log holds every later reservation as unknown, through main's reconcileJournal and reconcileLease",
      check: () =>
        withRig({ wal: true }, async (r) => {
          const e = expectations();
          await r.c.openItem("dc-judges");
          const px = startProxy(r, "dc-judges", pinned, { walLedger: true });
          const m = meterOn(r, "dc-judges", () => px);
          for (const i of [1, 2]) await m.call({ model: "astra", prompt: "packet " + i, maxTokens: 4000, label: "p" + i });
          const snap = await takeSnapshot(r.c, r.wal!, r.target, { ledgerPath: r.ledgerPath, journalPath: px.journal });
          await m.call({ model: "astra", prompt: "packet 3", maxTokens: 4000, label: "p3" });
          const worst4 = worstCaseMicros("openai", requestBody("astra", "packet 4", 4000));
          const four = admitted(await r.c.admitCall("dc-judges", { run: "p4", model: "astra", worstCaseMicros: worst4 }), "p4");
          await writeAheadLedger(r.local, r.wal!).reserve({ idempotency_key: "p4-key", lease_id: r.c.lease("dc-judges")!.leaseId, cell: { run_id: r.c.runId, arm: "dc", task: "p4", model: "gpt-6-astra", trial: 1, attempt: 1, meter_id: "mtr-p4" }, max_micros: worst4 });
          const spentBefore = r.c.figures("dc-judges").settledMicros;
          const third = r.c.subsOf("dc-judges")[2]!;
          px.stop();
          r.local.close();
          rmSync(join(r.dir, "host"), { recursive: true, force: true });
          const copy = await latestSnapshot(r.target);
          e.want(copy?.watermark === snap.watermark, "the newest snapshot is not the one taken");
          restoreLedgerFile(copy!, r.ledgerPath);
          const local2 = LocalLedger.open(r.ledgerPath);
          try {
            const leases = mainLeases({ record: r.record, local: local2, requireAdmission: () => null });
            const rec = await recover(r.target, { runId: r.c.runId, holder: r.holder, leases });
            if (rec.kind !== "recovered") return "recovery stopped: " + rec.why;
            const heldIds = rec.held.map((s) => s.id).sort();
            e.want(JSON.stringify(heldIds) === JSON.stringify([third.id, four.id].sort()), "held " + heldIds.join(","));
            e.want(rec.uncertainMicros === third.reserveMicros + worst4, "uncertain " + rec.uncertainMicros);
            e.want(rec.evidence.some((x) => x.kind === "settle" && x.sub === third.id), "the third call's settle line is not kept as evidence");
            const replay = await replayReserves(local2, rec.reserves, join(r.dir, "host", "recovered-journal.ndjson"));
            const leaseId = rec.controller.lease("dc-judges")!.leaseId;
            const unknown = [...local2.meters(leaseId).values()].reduce((a, x) => a + x.unknown_micros, 0);
            e.want(replay.unknown.length === 2 && unknown === rec.uncertainMicros, "main's ledger holds " + unknown + " unknown over " + replay.unknown.length + " calls");
            const f = rec.controller.figures("dc-judges");
            e.want(f.unknownMicros === rec.uncertainMicros && f.inFlightCount === 0, "the book holds " + f.unknownMicros + " unknown");
            const usage = join(r.dir, "provider-usage.json");
            writeFileSync(usage, JSON.stringify({ invented: true, calls: 3 }));
            const provider = spentBefore;
            await ownerReconcile(r.record, rec.controller, "dc-judges", { spentMicros: provider, quotes: QUOTE, source: usage, now: new Date(Date.now() + 2 * 86_400_000) });
            const after = rec.controller.figures("dc-judges");
            e.want(after.unknownMicros === 0 && after.settledMicros === provider, "after the owner's reconcile: " + JSON.stringify(after));
            e.want(readItem(r.record, "dc-judges").leases[0]!.close?.how === "reconciled", "main's record did not reconcile the lost lease");
            e.want((await rec.controller.openItem("dc-judges")).leaseId.includes(".0002."), "the continuation did not open on the replacement host");
            return e.result();
          } finally {
            local2.close();
          }
        }),
    },
    {
      rule: "R2-4",
      name: "a gap in the off-host copy stops for the Captain with every open lease's allowance held",
      check: () =>
        withRig({ wal: true }, async (r) => {
          await r.c.openItem("dc-judges");
          await takeSnapshot(r.c, r.wal!, r.target, { ledgerPath: r.ledgerPath });
          for (const i of [1, 2, 3]) admitted(await r.c.admitCall("dc-judges", { run: "c" + i, model: "astra", worstCaseMicros: $(1) }), "c" + i);
          const file = join((r.target as DirTarget).dir, "wal.ndjson");
          const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
          writeFileSync(file, lines.filter((_, i) => i !== lines.length - 2).join("\n") + "\n");
          const rec = await recover(r.target, { runId: r.c.runId, holder: r.holder, leases: r.leases });
          return rec.kind === "captain" && /gap/.test(rec.why) && rec.uncertainMicros === $(520) ? null : JSON.stringify(rec.kind === "captain" ? rec : rec.kind);
        }),
    },
    {
      rule: "R2-4",
      name: "a snapshot holds the book, the local ledger and the journal at one watermark, read back by sha256, and is due after a settlement or 10 minutes",
      check: () =>
        withRig({ wal: true }, (r) =>
          withProxy(r, "dc-gate-check", pinned, async (px) => {
            const e = expectations();
            await meterOn(r, "dc-gate-check", () => px).call({ model: "opus", prompt: "gate", maxTokens: 4000, label: "g1" });
            const snap = await takeSnapshot(r.c, r.wal!, r.target, { ledgerPath: r.ledgerPath, journalPath: px.journal });
            e.want(snap.watermark === r.wal!.seq && snap.book.subs.length === 1, "watermark " + snap.watermark + " of " + r.wal!.seq);
            const path = join(r.dir, "check", "ledger.sqlite");
            restoreLedgerFile(snap, path);
            const copy = LocalLedger.open(path);
            const leaseId = r.c.lease("dc-gate-check")!.leaseId;
            e.want(copy.getLease(leaseId) !== null && copy.held(leaseId) === r.local.held(leaseId), "the ledger copy differs");
            copy.close();
            e.want(snap.journal?.lines === journalLines(px.journal).length, "the journal copy holds " + snap.journal?.lines + " lines");
            const t0 = new Date("2026-11-20T00:00:00Z");
            const later = (min: number) => new Date(t0.getTime() + min * 60_000);
            e.want(snapshotDue({ lastAt: null, now: t0, settledSince: 0 }) && snapshotDue({ lastAt: t0, now: later(1), settledSince: 1 }) && !snapshotDue({ lastAt: t0, now: later(9), settledSince: 0 }) && snapshotDue({ lastAt: t0, now: later(10), settledSince: 0 }), "the snapshot schedule");
            return e.result();
          }),
        ),
    },
    {
      rule: "R2-13",
      name: "renewal with a live session: admissions wait, the session drains, the lease settles and its continuation opens with a new proxy and journal",
      check: () =>
        withRig({}, async (r) => {
          const e = expectations();
          const item: LedgerItemId = "dc-stage1-opus";
          await r.c.openItem(item);
          let px = startProxy(r, item, pinned);
          const first = px;
          const live = admitted(await r.c.admitRound(item, { run: "unit 3 pass 1", model: "opus", arms: ["none", "reference"] }), "live round");
          for (const s of live.sessions) r.c.startSession(live.id, s.id);
          const steps: string[] = [];
          const renewal = renew(r.c, item, {
            stop: () => {
              steps.push("stop");
              px.stop();
            },
            reconcile: () => {
              steps.push("reconcile");
              return reconcileJournal(px.journal, r.local);
            },
            start: (lease) => {
              steps.push("start " + lease.leaseId.split(".")[1]);
              px = startProxy(r, item, pinned);
            },
          });
          await Promise.resolve();
          const during = await r.c.admitRound(item, { run: "unit 4 pass 1", model: "opus", arms: ["none", "reference"] });
          e.want(during.kind === "wait" && steps.length === 0, "during the drain: admission " + during.kind + ", steps " + steps.join(","));
          const waiting = r.c.admitWhenReady(item, () => r.c.admitRound(item, { run: "unit 4 pass 1", model: "opus", arms: ["none", "reference"] }));
          await r.c.settle(live.id, { spentMicros: $(1.1) });
          const next = await renewal;
          const got = await waiting;
          e.want(steps.join(",") === "stop,reconcile,start 0002", "steps " + steps.join(","));
          const st = readItem(r.record, item);
          e.want(st.leases.length === 2 && st.leases[0]!.close !== null && st.leases[1]!.lease.run_id === r.c.runId && st.open?.lease_id === next.leaseId, "record after renewal");
          e.want(got.kind === "admitted" && got.sub.leaseId === next.leaseId, "the waiting round read " + got.kind);
          e.want(px !== first && px.journal !== first.journal, "no new proxy and journal");
          px.stop();
          return e.result();
        }),
    },
    {
      rule: "L7",
      name: "a lease is renewed when a third of its time to live is left",
      check: () => {
        const lease = { leaseId: "x", item: "dc-judges" as const, reservedMicros: 1, createdAt: "2026-11-20T00:00:00.000Z", expiresAt: "2026-11-21T00:00:00.000Z" };
        const at = (h: number) => new Date(Date.parse(lease.createdAt) + h * 3_600_000);
        return !renewalDue(lease, at(15.9)) && renewalDue(lease, at(16)) ? null : "renewal due at the wrong time";
      },
    },
    {
      rule: "R2-3",
      name: "the controller host is deleted in a wait over 12 hours with nothing in flight and relaunches from the verified copy",
      check: () =>
        withRig({ wal: true }, async (r) => {
          const e = expectations();
          await r.c.openItem("dc-hosts");
          await r.c.openItem("dc-authoring-1");
          admitted(await admitVm(r.c, { vm: "controller", ttlHours: 72, priceMicrosPerHour: 350_000, stage: "authoring", controller: true }), "host");
          await r.c.settle(admitted(await r.c.admitCall("dc-authoring-1", { run: "a", model: "sol", worstCaseMicros: $(2) }), "a").id, { spentMicros: $(1) });
          admitted(await admitVm(r.c, { vm: "recipe-9", ttlHours: 1, priceMicrosPerHour: 350_000, stage: "recipes" }), "recipe VM");
          e.want(!idleDelete(r.c, 12).delete, "deleted at a 12-hour wait");
          e.want(!idleDelete(r.c, 13).delete, "deleted with a recipe VM in flight");
          await settleVm(r.c, "recipe-9", 0.8);
          const deleted: string[] = [];
          const d = await deleteController(r.c, { vm: "controller", measuredHours: 20, wal: r.wal!, target: r.target, ledgerPath: r.ledgerPath, deleteVm: (vm) => void deleted.push(vm), waitHours: 13 });
          e.want(d.deleted && deleted.join() === "controller" && ["dc-hosts", "dc-authoring-1"].every((i) => readItem(r.record, i).open === null), "deletion: " + d.why);
          r.local.close();
          rmSync(join(r.dir, "host"), { recursive: true, force: true });
          const copy = await latestSnapshot(r.target);
          restoreLedgerFile(copy!, r.ledgerPath);
          const local2 = LocalLedger.open(r.ledgerPath);
          try {
            const rec = await recover(r.target, { runId: r.c.runId, holder: r.holder, leases: mainLeases({ record: r.record, local: local2, requireAdmission: () => null }) });
            if (rec.kind !== "recovered") return "relaunch stopped: " + rec.why;
            e.want(rec.held.length === 0 && rec.uncertainMicros === 0, "the relaunch held " + rec.held.length);
            e.want((await rec.controller.openItem("dc-authoring-1")).leaseId.includes(".0002.") && rec.controller.figures("dc-authoring-1").settledMicros === $(1), "the relaunch lost the item's spend or lease");
            e.want((await rec.controller.openItem("dc-hosts")) !== null && (await admitVm(rec.controller, { vm: "controller-2", ttlHours: 24, priceMicrosPerHour: 350_000, stage: "stage1", controller: true })).kind === "admitted", "the new host was not admitted");
            return e.result();
          } finally {
            local2.close();
          }
        }),
    },
  ];
}

export type { OffHostTarget };
