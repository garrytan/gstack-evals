// Copyright (c) 2026 Garry Tan. MIT License.
// The money and ledger area's dry-run cases (build plan section 15, L1 to L7; addendum R2-3, R2-4, R2-7, R2-8, R2-13,
// R2-17, R2-20; PD-9, PD-13). Each runs the area's real functions on main's ledger in a temporary directory, with the
// real metering proxy behind a fake upstream where a call is made, and names the rule it drives.
import { join } from "node:path";
import { openLease } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import type { DcError } from "../errors.ts";
import { LEDGER_ITEMS, MONEY, RECIPES } from "../frozen.ts";
import type { DryRunCase, LedgerItemId, Model } from "../types.ts";
import { $, MoneyController } from "./book.ts";
import { durableCases } from "./dryrun-durable.ts";
import { controllerHostCases } from "./dryrun-hosts.ts";
import { journalCases } from "./dryrun-journals.ts";
import { admitted, expectations, withRig, type Rig } from "./dryrun-fixture.ts";
import { planProblems, type ControllerPlan } from "./controller-host.ts";
import { admitStage, admitVm, extendVm, hostsProjection, settleVm, walFoldProjection } from "./hosts.ts";
import { mainLeases } from "./ledger-main.ts";
import { worstCaseMicros, requestBody, callWorstCase } from "./price.ts";
import { afterFirstPacket, authoring3, baseAppsCapStop, envelope, FIRST_PACKET_TAG, holdForFirstPacket, moneyFigures } from "./projection.ts";
import { ProviderWatch } from "./served.ts";
import { applyStop, AUTHORING_ITEMS, LEASED_ITEMS, stopPlan, STAGE3_ITEMS } from "./stops.ts";
import type { Sub } from "./types.ts";

/** Reserves and settles one call on the item's lease in the local ledger, as the metering proxy does. */
export async function spendOnLease(r: Rig, item: LedgerItemId, micros: number, key: string): Promise<void> {
  const lease = r.c.lease(item)!;
  const res = await r.local.reserve({ idempotency_key: key, lease_id: lease.leaseId, cell: { run_id: r.c.runId, arm: "dc", task: key, model: "m", trial: 1, attempt: 1, meter_id: "mtr-" + key }, max_micros: micros });
  if (!res.ok) throw new Error("local reserve refused: " + res.message);
  await r.local.settle(res.reservation.reservation_id, { kind: "spent", spent_micros: micros, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } });
}

const ARMS4 = ["none", "lens", "plan-design-review", "autoplan"];
const PRICE = 350_000;

const itemCases: DryRunCase[] = [
  {
    rule: "S5",
    name: "the 17 items carry their frozen caps and admission units, summing to the all-in cap",
    check: () => {
      const e = expectations();
      const ids = Object.keys(LEDGER_ITEMS) as LedgerItemId[];
      e.want(ids.length === 17, ids.length + " items");
      e.want(ids.reduce((a, i) => a + LEDGER_ITEMS[i].capUsd, 0) === MONEY.capAllInUsd, "caps do not sum to " + MONEY.capAllInUsd);
      for (const i of ids) {
        const a = LEDGER_ITEMS[i].admission;
        e.want(LEDGER_ITEMS[i].leased === (i !== "crew"), i + " leased flag");
        if (a.kind === "sessions") e.want(a.reserveUsd === (i === "dc-base-apps" ? a.allowanceUsd : a.perRound * a.allowanceUsd * 2), i + " reserve " + a.reserveUsd);
      }
      return e.result();
    },
  },
  {
    rule: "S5",
    name: "one lease per item and run id on a temporary ledger, every frozen run a named sub-reservation, every lease settled",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        for (const item of LEASED_ITEMS) {
          const lease = await r.c.openItem(item);
          e.want((await r.c.openItem(item)).leaseId === lease.leaseId, item + " opened a second lease");
          const a = LEDGER_ITEMS[item].admission;
          const sub =
            item === "dc-base-apps"
              ? admitted(await r.c.admitRecipe({ run: "recipe session 1" }), item)
              : a.kind === "sessions"
                ? admitted(await r.c.admitRound(item, { run: "round 1", model: item.endsWith("sol") ? "sol" : item.endsWith("particle") ? "particle" : "opus", arms: ARMS4.slice(0, a.perRound) }), item)
                : a.kind === "vms"
                  ? admitted(await admitVm(r.c, { vm: "controller", ttlHours: 24, priceMicrosPerHour: PRICE, stage: "phase 1", controller: true }), item)
                  : admitted(await r.c.admitCall(item, { run: "call 1", model: "opus", worstCaseMicros: $(1) }), item);
          e.want(sub.holder === r.holder && sub.leaseId === lease.leaseId && sub.run.length > 0, item + " sub-reservation is not named in its lease");
          const spend = Math.floor(sub.reserveMicros / 2);
          await spendOnLease(r, item, spend, item + "-1");
          await r.c.settle(sub.id, { spentMicros: spend });
          e.want(await r.c.settleItem(item), item + " did not settle");
          const st = readItem(r.record, item);
          e.want(st.leases.length === 1 && st.leases[0]!.close?.spent_micros === spend && st.run_id === r.c.runId, item + " record: " + st.leases.length + " leases, close " + JSON.stringify(st.leases[0]?.close?.spent_micros));
        }
        return e.result();
      }),
  },
  {
    rule: "R2-17",
    name: "no other process opens a lease while the controller holds one, and the run id keeps one fixed holder directory",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await r.c.openItem("dc-gate-check");
        let refused = "";
        try {
          openLease(r.record, r.local, { item: "dc-gate-check", run_id: r.c.runId, holder: { dir: r.holder, nonce: "other" }, requireAdmission: () => null });
        } catch (err) {
          refused = (err as Error).message;
        }
        e.want(/still open/.test(refused), "a second lease opened beside the controller's: " + refused);
        await r.c.settleItem("dc-gate-check");
        const relaunch = new MoneyController({ runId: r.c.runId, holder: r.holder, leases: mainLeases({ record: r.record, local: r.local, requireAdmission: () => null }) });
        e.want((await relaunch.openItem("dc-gate-check")).leaseId.startsWith("dc-gate-check.0002"), "a relaunch at the same holder path did not open the continuation");
        const moved = new MoneyController({ runId: r.c.runId, holder: join(r.dir, "elsewhere", r.c.runId), leases: mainLeases({ record: r.record, local: r.local, requireAdmission: () => null }) });
        let bound = "";
        try {
          await moved.openItem("dc-authoring-1");
        } catch (err) {
          bound = (err as Error).message;
        }
        e.want(/bound to run directory/.test(bound), "a new holder directory for the same run id was not refused: " + bound);
        let restore = "";
        try {
          MoneyController.restore(relaunch.toJSON(), { runId: r.c.runId, holder: join(r.dir, "elsewhere", r.c.runId), leases: r.leases });
        } catch (err) {
          restore = (err as Error).message;
        }
        e.want(/not run/.test(restore), "a snapshot restored under a new holder path");
        return e.result();
      }),
  },
  {
    rule: "S5",
    name: "two runs on one item in sequence and at once: the controller host and a recipe VM on dc-hosts",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await r.c.openItem("dc-hosts");
        const host = admitted(await admitVm(r.c, { vm: "controller", ttlHours: 48, priceMicrosPerHour: PRICE, stage: "recipes", controller: true }), "controller host");
        await settleVm(r.c, "controller", 30);
        const vm = admitted(await admitVm(r.c, { vm: "recipe-1", ttlHours: 2, priceMicrosPerHour: PRICE, stage: "recipes" }), "recipe VM");
        await settleVm(r.c, "recipe-1", 1.5);
        e.want(r.c.figures("dc-hosts").settledMicros === 30 * PRICE + 1.5 * PRICE, "in sequence: settled " + r.c.figures("dc-hosts").settledMicros);
        const host2 = admitted(await admitVm(r.c, { vm: "controller-2", ttlHours: 48, priceMicrosPerHour: PRICE, stage: "stage1", controller: true }), "controller host 2");
        const vm2 = admitted(await admitVm(r.c, { vm: "recipe-2", ttlHours: 2, priceMicrosPerHour: PRICE, stage: "recipes" }), "recipe VM 2");
        const f = r.c.figures("dc-hosts");
        e.want(f.inFlightCount === 2 && f.inFlightMicros === 50 * PRICE, "at once: " + f.inFlightCount + " in flight, " + f.inFlightMicros);
        e.want(new Set([host.leaseId, vm.leaseId, host2.leaseId, vm2.leaseId]).size === 1, "the runs did not share the item's one lease");
        return e.result();
      }),
  },
  {
    rule: "L2",
    name: "a round that fits exactly is admitted, and a round refused at $0.01 short with nothing in flight is a cap stop",
    check: async () => {
      const run = (lastSpend: number) =>
        withRig({}, async (r) => {
          await r.c.openItem("dc-stage1-opus");
          for (let i = 0; i < 5; i++) {
            const s = admitted(await r.c.admitRound("dc-stage1-opus", { run: "round " + i, model: "opus", arms: ["none", "reference"] }), "round");
            await r.c.settle(s.id, { spentMicros: i === 4 ? lastSpend : $(35) });
          }
          const a = await r.c.admitRound("dc-stage1-opus", { run: "round 6", model: "opus", arms: ["none", "reference"] });
          return a.kind + (a.kind === "cap-stop" ? " " + (readItem(r.record, "dc-stage1-opus").stops.length === 1 && readItem(r.record, "dc-stage1-opus").leases[0]!.close?.cap_stop ? "recorded" : "unrecorded") : "");
        });
      const exact = await run($(35));
      const short = await run($(35.01));
      return exact === "admitted" && short === "cap-stop recorded" ? null : "exact fit read " + exact + ", $0.01 short read " + short;
    },
  },
  {
    rule: "R2-8",
    name: "a refused round waits while another round on the item is in flight, near the cap, with spend on projection",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        const item = "dc-stage2-opus";
        await r.c.openItem(item);
        const unitPass = $(MONEY.planningOpusUsd.none + MONEY.planningOpusUsd.lens + MONEY.planningOpusUsd["plan-design-review"] + MONEY.planningOpusUsd.autoplan);
        for (let i = 0; i < 128; i++) await r.c.settle(admitted(await r.c.admitRound(item, { run: "pass " + i, model: "opus", arms: ARMS4 }), "pass").id, { spentMicros: unitPass });
        const a = admitted(await r.c.admitRound(item, { run: "pass A", model: "opus", arms: ARMS4 }), "pass A");
        const first = await r.c.admitRound(item, { run: "pass B", model: "opus", arms: ARMS4 });
        e.want(first.kind === "wait", "pass B read " + first.kind + " while pass A was in flight");
        const b = r.c.admitWhenReady(item, () => r.c.admitRound(item, { run: "pass B", model: "opus", arms: ARMS4 }));
        await r.c.settle(a.id, { spentMicros: unitPass });
        const got = await b;
        e.want(got.kind === "admitted", "pass B read " + got.kind + " after pass A settled on projection");
        e.want(r.c.figures(item).settledMicros === 129 * unitPass, "settled " + r.c.figures(item).settledMicros);
        return e.result();
      }),
  },
  {
    rule: "R2-8",
    name: "a dc-judges call near its cap waits while a call is in flight, then is admitted or is a cap stop when nothing is",
    check: async () => {
      const run = (xSpend: number) =>
        withRig({}, async (r) => {
          await r.c.openItem("dc-judges");
          await r.c.settle(admitted(await r.c.admitCall("dc-judges", { run: "labels", model: "astra", worstCaseMicros: $(510) }), "labels").id, { spentMicros: $(510) });
          const x = admitted(await r.c.admitCall("dc-judges", { run: "x", model: "astra", worstCaseMicros: $(6) }), "x");
          const y1 = await r.c.admitCall("dc-judges", { run: "y", model: "opus", worstCaseMicros: $(5) });
          const later = r.c.admitWhenReady("dc-judges", () => r.c.admitCall("dc-judges", { run: "y", model: "opus", worstCaseMicros: $(5) }));
          await r.c.settle(x.id, { spentMicros: xSpend });
          return y1.kind + " then " + (await later).kind;
        });
      const low = await run($(1));
      const high = await run($(6));
      return low === "wait then admitted" && high === "wait then cap-stop" ? null : "x settling low read " + low + "; high read " + high;
    },
  },
  {
    rule: "L1",
    name: "a ninth direct call waits while 8 are in flight on its item",
    check: () =>
      withRig({}, async (r) => {
        await r.c.openItem("dc-authoring-2");
        const subs: Sub[] = [];
        for (let i = 0; i < 8; i++) subs.push(admitted(await r.c.admitCall("dc-authoring-2", { run: "call " + i, model: "sol", worstCaseMicros: $(1) }), "call"));
        const ninth = await r.c.admitCall("dc-authoring-2", { run: "call 9", model: "sol", worstCaseMicros: $(1) });
        await r.c.settle(subs[0]!.id, { spentMicros: $(0.5) });
        const again = await r.c.admitCall("dc-authoring-2", { run: "call 9", model: "sol", worstCaseMicros: $(1) });
        return ninth.kind === "wait" && again.kind === "admitted" ? null : "ninth read " + ninth.kind + ", then " + again.kind;
      }),
  },
  {
    rule: "L2",
    name: "a refusal with only an unknown charge on its item waits; once reconciled, a refusal that still doesn't fit is a cap stop",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await r.c.openItem("dc-gate-check");
        const a = admitted(await r.c.admitCall("dc-gate-check", { run: "a", model: "opus", worstCaseMicros: $(20) }), "a");
        await r.c.markUnknown(a.id);
        const b1 = await r.c.admitCall("dc-gate-check", { run: "b", model: "opus", worstCaseMicros: $(10) });
        e.want(b1.kind === "wait" && /1 unknown charge not yet reconciled/.test(b1.why), "b read " + b1.kind + ": " + ("why" in b1 ? b1.why : ""));
        await r.c.reconcile(a.id, $(20));
        const b2 = await r.c.admitCall("dc-gate-check", { run: "b", model: "opus", worstCaseMicros: $(10) });
        e.want(b2.kind === "cap-stop", "b read " + b2.kind + " after reconciliation");
        return e.result();
      }),
  },
  {
    rule: "L1",
    name: "an unknown charge stays held at its full reservation in admission until reconciled",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await r.c.openItem("dc-gate-check");
        const a = admitted(await r.c.admitCall("dc-gate-check", { run: "a", model: "opus", worstCaseMicros: $(20) }), "a");
        await r.c.markUnknown(a.id);
        const f = r.c.figures("dc-gate-check");
        e.want(f.unknownMicros === $(20) && f.settledMicros === 0 && f.inFlightMicros === 0, "figures after unknown: " + JSON.stringify(f));
        admitted(await r.c.admitCall("dc-gate-check", { run: "b", model: "opus", worstCaseMicros: $(4) }), "b");
        const c1 = await r.c.admitCall("dc-gate-check", { run: "c", model: "opus", worstCaseMicros: $(2) });
        e.want(c1.kind === "wait", "c read " + c1.kind + " with the unknown charge held");
        await r.c.reconcile(a.id, $(3));
        const c2 = await r.c.admitCall("dc-gate-check", { run: "c", model: "opus", worstCaseMicros: $(2) });
        e.want(c2.kind === "admitted", "c read " + c2.kind + " after reconciliation");
        return e.result();
      }),
  },
  {
    rule: "L1",
    name: "the worst case counts UTF-8 bytes at the input rate plus the output cap, never characters divided by 3",
    check: () => {
      const e = expectations();
      const ascii = callWorstCase("opus", "e".repeat(3000), 16_000);
      const wide = callWorstCase("opus", "é".repeat(3000), 16_000);
      e.want(wide - ascii === 3000 * 4, "3000 two-byte characters added " + (wide - ascii) + " micros, not 12000");
      e.want(ascii > Math.ceil(3000 / 3) * 4 + 16_000 * 20 && ascii >= 3000 * 4 + 16_000 * 20, "the bound " + ascii + " is not at least the bytes and the output cap");
      const sol = worstCaseMicros("openrouter", { ...requestBody("sol", "x".repeat(300_000), 4000) });
      e.want(sol >= 300_000 * 4 + 4000 * 15, "a long Sol prompt was not priced at the long tier: " + sol);
      return e.result();
    },
  },
  {
    rule: "R2-7",
    name: "the recipe item admits all 30 sessions at $3 and 29 at $3.20, one at a time at one $5.00 allowance",
    check: async () => {
      const run = (spend: number) =>
        withRig({}, async (r) => {
          await r.c.openItem("dc-base-apps");
          let n = 0;
          for (; n < RECIPES.maxSessions; n++) {
            const a = await r.c.admitRecipe({ run: "recipe session " + (n + 1) });
            if (a.kind !== "admitted") return n + " then " + a.kind;
            await r.c.settle(a.sub.id, { spentMicros: spend });
          }
          return n + " admitted";
        });
      const at3 = await run($(MONEY.planningRecipeUsd));
      const at320 = await run($(3.2));
      return at3 === "30 admitted" && at320 === "29 then cap-stop" ? null : "$3 read " + at3 + "; $3.20 read " + at320;
    },
  },
  {
    rule: "R2-7",
    name: "a second recipe session waits while one is in flight, and a J1 retry is admitted on its own at $5.00",
    check: () =>
      withRig({}, async (r) => {
        await r.c.openItem("dc-base-apps");
        const a = admitted(await r.c.admitRecipe({ run: "recipe session 1" }), "session 1");
        const b = await r.c.admitRecipe({ run: "recipe session 2" });
        await r.c.settle(a.id, { spentMicros: $(1.2) });
        const retry = await r.c.admitRecipe({ run: "recipe session 1 retry", retry: true });
        return b.kind === "wait" && retry.kind === "admitted" && retry.sub.retry && retry.sub.reserveMicros === $(5) ? null : "second session read " + b.kind + ", retry read " + retry.kind;
      }),
  },
  {
    rule: "R2-7",
    name: "a dc-base-apps cap stop keeps 16 or more qualified for the Captain and is a supply stop under 16",
    check: () => {
      const a = baseAppsCapStop(16);
      const b = baseAppsCapStop(15);
      return a.code === null && a.baseApps === 16 && b.code === "E_DC_SUPPLY_SHORT" ? null : JSON.stringify([a, b]);
    },
  },
  {
    rule: "R2-20",
    name: "a recorded cap stop closes its whole item; a stop code settles without cap_stop so the Captain can resume",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await r.c.openItem("dc-stage1-particle");
        for (let i = 0; i < 6; i++) await r.c.settle(admitted(await r.c.admitRound("dc-stage1-particle", { run: "round " + i, model: "particle", arms: ["none", "lens"] }), "round").id, { spentMicros: $(1.9) });
        const stop = await r.c.admitRound("dc-stage1-particle", { run: "round 6", model: "particle", arms: ["none", "lens"] });
        e.want(stop.kind === "cap-stop", "round 6 read " + stop.kind);
        e.want((await r.c.admitRound("dc-stage1-particle", { run: "round 7", model: "particle", arms: ["none"] })).kind === "closed", "the item did not close");
        let refused = "";
        try {
          openLease(r.record, r.local, { item: "dc-stage1-particle", run_id: r.c.runId, holder: { dir: r.holder, nonce: "x" }, requireAdmission: () => null });
        } catch (err) {
          refused = (err as Error).message;
        }
        e.want(/cap-stopped/.test(refused), "main's record admitted a new lease after the cap stop: " + refused);
        await r.c.openItem("dc-authoring-1");
        await applyStop(r.c, stopPlan("E_DC_AUTHOR_COST"));
        const close = readItem(r.record, "dc-authoring-1").leases[0]!.close;
        e.want(close !== null && close.cap_stop === undefined, "the stop code settled with cap_stop " + close?.cap_stop);
        await r.c.liftStop("E_DC_AUTHOR_COST", { captain: true });
        e.want((await r.c.openItem("dc-authoring-1")).leaseId.includes(".0002."), "the Captain's resume did not open a continuation");
        return e.result();
      }),
  },
  {
    rule: "L2",
    name: "oracle builds run one at a time inside dc-stage3-authoring against the $30 reserve, with spend exactly on projection",
    check: () =>
      withRig({}, async (r) => {
        await r.c.openItem("dc-stage3-authoring");
        const a = admitted(await r.c.admitOracle({ run: "oracle build 1" }), "oracle 1");
        const b = await r.c.admitOracle({ run: "oracle build 2" });
        const call = await r.c.admitCall("dc-stage3-authoring", { run: "fixture call", model: "sol", worstCaseMicros: $(1) });
        await r.c.settle(a.id, { spentMicros: $(MONEY.planningBuildUsd) });
        const b2 = await r.c.admitOracle({ run: "oracle build 2" });
        return a.reserveMicros === $(MONEY.oracleBuildReserveUsd) && b.kind === "wait" && call.kind === "admitted" && b2.kind === "admitted" && r.c.figures("dc-stage3-authoring").settledMicros === $(1.5) ? null : "oracle 2 read " + b.kind + " then " + b2.kind + ", a call read " + call.kind;
      }),
  },
];

/** A stop-scope rig: the named items open, each with one admitted sub-reservation per model given. */
async function openAll(r: Rig, items: LedgerItemId[]): Promise<void> {
  for (const i of items) await r.c.openItem(i);
}

const leaseOpen = (r: Rig, item: LedgerItemId) => readItem(r.record, item).open !== null;

const stopCases: DryRunCase[] = [
  {
    rule: "L5",
    name: "an Opus exposure stop mid stage 2 stops that arm only: the other three arms finish and the round lease stays open",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await openAll(r, ["dc-stage2-opus", "dc-stage2-sol", "dc-judges"]);
        const running = admitted(await r.c.admitRound("dc-stage2-opus", { run: "unit 7 pass 1", model: "opus", arms: ARMS4 }), "running pass");
        for (const s of running.sessions) r.c.startSession(running.id, s.id);
        const queued = admitted(await r.c.admitRound("dc-stage2-opus", { run: "unit 8 pass 1", model: "opus", arms: ARMS4 }), "queued pass");
        const res = await applyStop(r.c, stopPlan("E_DC_EXPOSURE_STOP", { model: "opus", arm: "autoplan", stage: 2 }));
        e.want(res.releasedSessions.length === 1 && queued.reserveMicros === 3 * 20_000_000, "the queued autoplan session was not released: " + res.releasedSessions.join(","));
        e.want(running.sessions.every((s) => s.state === "started"), "a running session was cut");
        await r.c.settle(running.id, { spentMicros: $(5.85) });
        e.want((await r.c.admitRound("dc-stage2-opus", { run: "unit 9", model: "opus", arms: ARMS4 })).kind === "stopped", "a pass with autoplan on Opus was admitted");
        e.want((await r.c.admitRound("dc-stage2-opus", { run: "unit 9", model: "opus", arms: ARMS4.slice(0, 3) })).kind === "admitted", "the other three arms were stopped");
        e.want((await r.c.admitRound("dc-stage2-sol", { run: "unit 9", model: "sol", arms: ARMS4 })).kind === "admitted", "Sol's autoplan was stopped");
        e.want((await r.c.admitCall("dc-judges", { run: "label opus autoplan", model: "astra", subject: "opus", arm: "autoplan", worstCaseMicros: $(1) })).kind === "stopped", "a label of the stopped arm was admitted");
        e.want(leaseOpen(r, "dc-stage2-opus"), "the shared stage lease settled");
        return e.result();
      }),
  },
  {
    rule: "L5",
    name: "a smoke drop stops that arm on that model and leaves every lease open",
    check: () =>
      withRig({}, async (r) => {
        await openAll(r, ["dc-stage1-sol"]);
        const p = stopPlan("E_DC_SMOKE_DROP", { model: "sol", arm: "plan-design-review", stage: 1 });
        await applyStop(r.c, p);
        const a = await r.c.admitRound("dc-stage1-sol", { run: "smoke", model: "sol", arms: ["plan-design-review", "autoplan"] });
        const b = await r.c.admitRound("dc-stage1-sol", { run: "smoke", model: "sol", arms: ["autoplan", "lens"] });
        return p.reach === "arm-on-model" && a.kind === "stopped" && b.kind === "admitted" && leaseOpen(r, "dc-stage1-sol") ? null : p.reach + " " + a.kind + " " + b.kind;
      }),
  },
  {
    rule: "L5",
    name: "a Sol kappa failure stops Sol's contrasts while Opus's sessions and labels continue and dc-judges stays open",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await openAll(r, ["dc-stage1-sol", "dc-stage1-opus", "dc-judges"]);
        const res = await applyStop(r.c, stopPlan("E_DC_JUDGE_KAPPA", { model: "sol", stage: 1 }));
        e.want(res.settledNow.includes("dc-stage1-sol") && !leaseOpen(r, "dc-stage1-sol"), "Sol's stage lease did not settle");
        e.want(readItem(r.record, "dc-stage1-sol").leases[0]!.close?.cap_stop === undefined, "the kappa stop closed Sol's item for good");
        e.want((await r.c.admitCall("dc-judges", { run: "label sol", model: "opus", subject: "sol", worstCaseMicros: $(1) })).kind === "stopped", "a Sol label was admitted");
        e.want((await r.c.admitCall("dc-judges", { run: "label opus", model: "astra", subject: "opus", worstCaseMicros: $(1) })).kind === "admitted", "an Opus label was stopped");
        e.want((await r.c.admitRound("dc-stage1-opus", { run: "r", model: "opus", arms: ["none", "reference"] })).kind === "admitted", "Opus's sessions were stopped");
        e.want(leaseOpen(r, "dc-judges"), "dc-judges settled");
        return e.result();
      }),
  },
  {
    rule: "L5",
    name: "a kappa or stock failure on Opus lists in stage 1 ends the eval, as no-read and twin do: every lease settles",
    check: async () => {
      const fails: string[] = [];
      for (const code of ["E_DC_JUDGE_KAPPA", "E_DC_STOCK_FAIL", "E_DC_NO_READ", "E_DC_TWIN"] as const) {
        const why = await withRig({}, async (r) => {
          await openAll(r, ["dc-stage1-opus", "dc-stage1-sol", "dc-judges", "dc-authoring-2"]);
          const p = stopPlan(code, { model: "opus", stage: 1 });
          await applyStop(r.c, p);
          const open = ["dc-stage1-opus", "dc-stage1-sol", "dc-judges", "dc-authoring-2"].filter((i) => leaseOpen(r, i as LedgerItemId));
          const a = await r.c.admitCall("dc-authoring-2", { run: "x", model: "sol", worstCaseMicros: $(1) });
          return p.reach === "eval" && open.length === 0 && a.kind === "stopped" ? null : code + " reach " + p.reach + ", open " + open.join(",") + ", call " + a.kind;
        });
        if (why) fails.push(why);
      }
      const stage2 = stopPlan("E_DC_STOCK_FAIL", { model: "opus", stage: 2 });
      if (stage2.reach !== "model-contrasts") fails.push("a stage 2 stock failure on Opus read " + stage2.reach);
      return fails.length ? fails.join("; ") : null;
    },
  },
  {
    rule: "PD-9",
    name: "a provider drift on Argon during authoring stops every Argon call in every role, for the Captain only",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await openAll(r, ["dc-authoring-1", "dc-judges", "dc-stage1-particle"]);
        const inFlight = admitted(await r.c.admitCall("dc-authoring-1", { run: "argon author", model: "argon", worstCaseMicros: $(1) }), "argon author");
        const res = await applyStop(r.c, stopPlan("E_DC_PROVIDER_DRIFT", { model: "argon" }));
        e.want((await r.c.admitCall("dc-authoring-1", { run: "argon audit", model: "argon", worstCaseMicros: $(1) })).kind === "stopped", "an Argon audit was admitted");
        e.want((await r.c.admitCall("dc-judges", { run: "panel vote", model: "argon", subject: "particle", worstCaseMicros: $(1) })).kind === "stopped", "an Argon panel vote was admitted");
        e.want((await r.c.admitCall("dc-authoring-1", { run: "sol author", model: "sol", worstCaseMicros: $(1) })).kind === "admitted", "a Sol call was stopped");
        e.want((await r.c.admitRound("dc-stage1-particle", { run: "r", model: "particle", arms: ["none", "lens"] })).kind === "admitted", "particle-1 sessions were stopped");
        await r.c.settle(inFlight.id, { spentMicros: $(0.4) });
        e.want(res.settledNow.length === 0 && leaseOpen(r, "dc-authoring-1"), "an item settled that other models still use");
        let lifted = "";
        try {
          await r.c.liftStop("E_DC_PROVIDER_DRIFT");
        } catch (err) {
          lifted = (err as Error).message;
        }
        e.want(/Captain/.test(lifted), "the drift stop lifted without the Captain");
        return e.result();
      }),
  },
  {
    rule: "L5",
    name: "a supply, author-cost or gate-check stop halts authoring and settles the authoring and base-app leases only",
    check: async () => {
      const fails: string[] = [];
      for (const code of ["E_DC_SUPPLY_SHORT", "E_DC_AUTHOR_COST", "E_DC_GATE_CHECK"] as const) {
        const why = await withRig({}, async (r) => {
          await openAll(r, [...AUTHORING_ITEMS, "dc-stage1-opus", "dc-hosts"]);
          await applyStop(r.c, stopPlan(code));
          const open = AUTHORING_ITEMS.filter((i) => leaseOpen(r, i));
          const call = await r.c.admitCall("dc-authoring-2", { run: "x", model: "sol", worstCaseMicros: $(1) });
          return open.length === 0 && call.kind === "stopped" && leaseOpen(r, "dc-stage1-opus") && leaseOpen(r, "dc-hosts") ? null : code + ": open " + open.join(",") + ", call " + call.kind;
        });
        if (why) fails.push(why);
      }
      return fails.length ? fails.join("; ") : null;
    },
  },
  {
    rule: "L5",
    name: "a sandbox audit hit stops stage 3, or the base-app screen when the hit is in a recipe VM",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await openAll(r, [...STAGE3_ITEMS, "dc-base-apps", "dc-hosts"]);
        await admitVm(r.c, { vm: "controller", ttlHours: 100, priceMicrosPerHour: PRICE, stage: "all", controller: true });
        await applyStop(r.c, stopPlan("E_DC_SANDBOX_AUDIT", { stage: 3 }));
        e.want(STAGE3_ITEMS.every((i) => !leaseOpen(r, i)) && leaseOpen(r, "dc-base-apps"), "stage 3's leases did not settle alone");
        e.want((await admitVm(r.c, { vm: "build-1", ttlHours: 3, priceMicrosPerHour: PRICE, stage: "stage3" })).kind === "stopped", "a stage 3 VM was admitted");
        e.want((await admitVm(r.c, { vm: "recipe-1", ttlHours: 1, priceMicrosPerHour: PRICE, stage: "recipes" })).kind === "admitted", "a recipe VM was stopped");
        const recipe = stopPlan("E_DC_SANDBOX_AUDIT", { inRecipeVm: true });
        e.want(recipe.reach === "base-app-screen" && recipe.settle.join() === "dc-base-apps", "a recipe VM hit read " + recipe.reach);
        return e.result();
      }),
  },
  {
    rule: "L5",
    name: "a cap stop on one item stops only that item's runs; a dc-hosts cap stop stops every stage and settles every lease",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await openAll(r, ["dc-gate-check", "dc-authoring-1", "dc-hosts", "dc-judges"]);
        await r.c.settle(admitted(await r.c.admitCall("dc-gate-check", { run: "a", model: "opus", worstCaseMicros: $(24) }), "a").id, { spentMicros: $(24) });
        const cap = await r.c.admitCall("dc-gate-check", { run: "b", model: "opus", worstCaseMicros: $(2) });
        e.want(cap.kind === "cap-stop" && (await r.c.admitCall("dc-authoring-1", { run: "c", model: "sol", worstCaseMicros: $(2) })).kind === "admitted", "a gate-check cap stop reached another item");
        await r.c.settle(admitted(await admitVm(r.c, { vm: "controller", ttlHours: 228, priceMicrosPerHour: PRICE, stage: "all", controller: true }), "host").id, { spentMicros: 228 * PRICE });
        const hosts = await admitVm(r.c, { vm: "recipe-1", ttlHours: 2, priceMicrosPerHour: PRICE, stage: "recipes" });
        e.want(hosts.kind === "cap-stop", "the dc-hosts VM read " + hosts.kind);
        await r.c.settle(r.c.subsOf("dc-authoring-1")[0]!.id, { spentMicros: $(1) });
        const res = await applyStop(r.c, stopPlan("CAP_STOP", { item: "dc-hosts" }));
        e.want(res.draining.length === 0 && ["dc-authoring-1", "dc-judges"].every((i) => !leaseOpen(r, i as LedgerItemId)), "every lease did not settle on the dc-hosts cap stop");
        e.want((await r.c.admitCall("dc-judges", { run: "d", model: "astra", worstCaseMicros: $(1) })).kind === "stopped", "work went on after the dc-hosts cap stop");
        return e.result();
      }),
  },
];

const hostCases: DryRunCase[] = [
  {
    rule: "R2-3",
    name: "each VM is an atomic sub-reservation of its time to live at the list price passed in, settled at measured hours",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        await r.c.openItem("dc-hosts");
        const host = admitted(await admitVm(r.c, { vm: "controller", ttlHours: 30, priceMicrosPerHour: PRICE, stage: "phase 1", controller: true }), "host");
        e.want(host.reserveMicros === 30 * PRICE, "reserve " + host.reserveMicros);
        admitted(await extendVm(r.c, "controller", 24), "extension");
        const spent = await settleVm(r.c, "controller", 41.5);
        e.want(spent === Math.ceil(30 * PRICE) + Math.ceil(11.5 * PRICE), "measured hours settled at " + spent);
        e.want(r.c.figures("dc-hosts").inFlightCount === 0, "a VM stayed in flight");
        return e.result();
      }),
  },
  {
    rule: "R2-3",
    name: "a stage whose dc-hosts projection doesn't fit is refused for the Captain, and the projection line prints",
    check: () =>
      withRig({}, async (r) => {
        await r.c.openItem("dc-hosts");
        await r.c.settle(admitted(await admitVm(r.c, { vm: "controller", ttlHours: 150, priceMicrosPerHour: PRICE, stage: "phase 1", controller: true }), "host").id, { spentMicros: 150 * PRICE });
        const fits = admitStage(r.c.figures("dc-hosts"), { stage: "stage 1", controllerHours: 48, vms: [] }, PRICE);
        const big = admitStage(r.c.figures("dc-hosts"), { stage: "stage 3", controllerHours: 48, vms: [{ count: 96, hours: 2 }] }, PRICE);
        const line = hostsProjection({ stage: "stage 3", controllerHours: 48, vms: [{ count: 96, hours: 2 }] }, PRICE).line;
        return fits.ok && !big.ok && /Captain/.test(big.captain) && line.includes("240 host-hours") ? null : JSON.stringify([fits, big, line]);
      }),
  },
  {
    rule: "PD-9",
    name: "provider names compare after folding case, spaces and punctuation, both raw names are recorded, and a real provider change still trips the drift watch",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        const watch = new ProviderWatch({ controller: r.c, out: join(r.dir, "watch-names"), datedTerms: { sol: "OpenAI" } });
        await watch.check({ model: "sol", servedBy: "OpenAI", via: "direct", label: "first" });
        let code = "no error";
        for (const name of ["openai", "Open AI", "open-ai."]) {
          try {
            await watch.check({ model: "sol", servedBy: name, via: "session", label: name });
          } catch (err) {
            code = (err as DcError).code ?? String(err);
          }
        }
        e.want(code === "no error", "a folded name read " + code);
        const names = watch.names();
        e.want(names.some((n) => n.servedBy === "Open AI" && n.against === "OpenAI" && n.source === "dated terms") && names.some((n) => n.servedBy === "open-ai." && n.source === "first call"), "names.ndjson read " + JSON.stringify(names));
        try {
          await watch.check({ model: "sol", servedBy: "Azure", via: "direct", label: "moved" });
        } catch (err) {
          code = (err as DcError).code ?? String(err);
        }
        e.want(code === "E_DC_PROVIDER_DRIFT", "a move to Azure read " + code);
        return e.result();
      }),
  },
  {
    rule: "R2-3",
    name: "the WAL host is folded into dc-hosts on burstable-1: the run projection reruns with it inside the $80 cap, a stage projection carries its hours, and a WAL host on another size is refused",
    check: async () => {
      const e = expectations();
      const burstable1 = 14_300;
      const fold = walFoldProjection(14 * 24, burstable1);
      e.want(fold.fits && fold.micros === 70_000_000 + 336 * burstable1, fold.line);
      e.want(!walFoldProjection(24 * 30 * 12, 20_000).fits, "a year of WAL host-hours fit the cap");
      const stage = hostsProjection({ stage: "stage 1", controllerHours: 48, vms: [], wal: { hours: 48, priceMicrosPerHour: burstable1 } }, PRICE);
      e.want(stage.micros === 48 * PRICE + 48 * burstable1 && stage.line.includes("WAL host's 48 hours"), stage.line);
      const plan = { runId: "dc-dryrun", owner: "dry-owner", longestStageHours: 24, ttlHours: 30, priceMicrosPerHour: { controller: 60_000, wal: burstable1 }, commit: "0".repeat(40), repoTar: new Uint8Array(1), recordTar: new Uint8Array(1), root: "/x", wal: { dir: "/w", script: "/s", owner: null, authorizedKeys: "/k" }, recipient: "age1" + "q".repeat(58) } as unknown as ControllerPlan;
      e.want(planProblems(plan).length === 0, "the plan read " + planProblems(plan).join("; "));
      e.want(planProblems({ ...plan, sizes: { wal: "standard-2" } }).some((p) => p.includes("burstable-1")), "a standard-2 WAL host was not refused");
      e.want(planProblems({ ...plan, ttlHours: 24 * 365 * 2 }).some((p) => p.includes("does not fit")), "a WAL host past the cap was not refused");
      return e.result();
    },
  },
  {
    rule: "S15",
    name: "the first judge packet runs alone and re-projects the line; past the cap dc-judges stops for the Captain",
    check: async () => {
      const run = (perPacket: number) =>
        withRig({}, async (r) => {
          await r.c.openItem("dc-judges");
          await holdForFirstPacket(r.c);
          const first = await r.c.admitCall("dc-judges", { run: "packet 1", model: "astra", worstCaseMicros: $(5), tag: FIRST_PACKET_TAG });
          const other = await r.c.admitCall("dc-judges", { run: "packet 2", model: "astra", worstCaseMicros: $(5) });
          if (first.kind !== "admitted" || other.kind !== "wait") return "first " + first.kind + ", other " + other.kind;
          await r.c.settle(first.sub.id, { spentMicros: perPacket });
          const rp = await afterFirstPacket(r.c, { firstPacketMicros: perPacket, packetsLeft: 159 });
          const next = await r.c.admitCall("dc-judges", { run: "packet 2", model: "astra", worstCaseMicros: $(5) });
          return (rp.fits ? "fits" : "past") + " " + next.kind;
        });
      const ok = await run($(3));
      const past = await run($(3.3));
      return ok === "fits admitted" && past === "past captain" ? null : "$3 a packet read " + ok + "; $3.30 read " + past;
    },
  },
  {
    rule: "L4",
    name: "a projection past $5,000 stops for the Captain, and dc-authoring-3 is released unleased when the base tier admits",
    check: () =>
      withRig({}, async (r) => {
        const e = expectations();
        e.want(envelope({ "dc-stage2-opus": $(4000), crew: $(1000) }).captain === null, "$5,000 exactly stopped");
        e.want(envelope({ "dc-stage2-opus": $(4000), crew: $(1000.01) }).captain !== null, "$5,000.01 did not stop");
        const base = await authoring3(r.c, "base");
        e.want(!base.leased && base.projectionMicros === 0 && readItem(r.record, "dc-authoring-3").leases.length === 0, "dc-authoring-3 leased on a base admit");
        const harder = await authoring3(r.c, "harder");
        e.want(harder.leased && harder.projectionMicros === $(MONEY.authoring3IfRunUsd), "dc-authoring-3 did not lease for a harder tier");
        return e.result();
      }),
  },
  {
    rule: "L1",
    name: "the figures export carries settled, in-flight and unknown apart for every item",
    check: () =>
      withRig({}, async (r) => {
        await r.c.openItem("dc-authoring-1");
        const a = admitted(await r.c.admitCall("dc-authoring-1", { run: "a", model: "sol", worstCaseMicros: $(3) }), "a");
        const b = admitted(await r.c.admitCall("dc-authoring-1", { run: "b", model: "sol", worstCaseMicros: $(4) }), "b");
        admitted(await r.c.admitCall("dc-authoring-1", { run: "c", model: "sol", worstCaseMicros: $(5) }), "c");
        await r.c.settle(a.id, { spentMicros: $(1) });
        await r.c.markUnknown(b.id);
        const f = moneyFigures(r.c, $(12));
        const x = f["dc-authoring-1"];
        return Object.keys(f).length === 17 && x.settledMicros === $(1) && x.unknownMicros === $(4) && x.inFlightMicros === $(5) && f.crew.settledMicros === $(12) ? null : JSON.stringify(x);
      }),
  },
];

export function cases(): DryRunCase[] {
  return [...itemCases, ...stopCases, ...hostCases, ...durableCases(), ...controllerHostCases(), ...journalCases()];
}

export type { Model };
