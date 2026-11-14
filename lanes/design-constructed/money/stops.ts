// Copyright (c) 2026 Garry Tan. MIT License.
// Stop scopes (plan L5, PD-13, PD-9; R2-3's dc-hosts row; R2-20): each stop keeps the consequence prereg start rule 3
// gives it (it stops for the Captain, settles its open leases at the spend recorded so far, releases the rest and
// leaves partial outputs sealed), and this file turns STOP_SCOPES in frozen.ts into the controller's scope stops, the
// unrun work it releases and the leases it settles. Work in flight finishes and settles; a lease settles once nothing
// on it is in flight. Only a cap stop closes an item for good.
import { CAP_STOP_SCOPE, LEDGER_ITEMS, STOP_SCOPES } from "../frozen.ts";
import type { AnyModel, DcStopCode, LedgerItemId, Model, StopReach, StopScope } from "../types.ts";
import type { MoneyController, ScopeStop } from "./book.ts";

export const AUTHORING_ITEMS: LedgerItemId[] = ["dc-base-apps", "dc-gate-check", "dc-authoring-1", "dc-authoring-2", "dc-authoring-3"];
export const STAGE3_ITEMS: LedgerItemId[] = ["dc-stage3-authoring", "dc-stage3-builds", "dc-stage3-reads"];
export const LEASED_ITEMS = (Object.keys(LEDGER_ITEMS) as LedgerItemId[]).filter((i) => LEDGER_ITEMS[i].leased);
const MODELS_UNDER_TEST: readonly AnyModel[] = ["opus", "sol", "particle"];
export const sessionItems = (m: Model): LedgerItemId[] => ["dc-stage1-" + m, "dc-stage2-" + m] as LedgerItemId[];

export interface StopContext {
  /** The model the stop names: the model under test for an arm, kappa or stock stop; the drifted model for PD-9. */
  model?: AnyModel;
  arm?: string;
  stage?: 1 | 2 | 3;
  /** E_DC_SANDBOX_AUDIT only: the hit was in a recipe VM. */
  inRecipeVm?: boolean;
  /** A cap stop's item. */
  item?: LedgerItemId;
}

export interface StopPlan {
  code: string;
  reach: StopReach;
  frozen: StopScope;
  scopes: ScopeStop[];
  /** Leases that settle (once drained); none closes for good unless capStop is set. */
  settle: LedgerItemId[];
  capStop: boolean;
}

const scope = (code: string, why: string, s: Partial<ScopeStop>): ScopeStop => ({ code, items: null, model: null, subject: null, arm: null, stage: null, why, captain: true, ...s });

/** The plan for a stop: what it halts, what keeps running and which leases settle. */
export function stopPlan(code: DcStopCode | "CAP_STOP", ctx: StopContext = {}): StopPlan {
  if (code === "CAP_STOP") {
    if (!ctx.item) throw new Error("a cap stop names its item");
    const hosts = ctx.item === "dc-hosts";
    const frozen = hosts ? CAP_STOP_SCOPE.hosts : CAP_STOP_SCOPE.item;
    const why = "cap stop on " + ctx.item + ": " + frozen.keepsRunning + " keeps running; " + frozen.ledger;
    return hosts
      ? { code, reach: frozen.stops, frozen, scopes: [scope(code, why, {})], settle: LEASED_ITEMS, capStop: true }
      : { code, reach: frozen.stops, frozen, scopes: [scope(code, why, { items: [ctx.item] })], settle: [ctx.item], capStop: true };
  }
  const frozen = STOP_SCOPES[code];
  let reach = frozen.stops;
  if (frozen.unless && frozen.unless.reach === "eval" && ctx.model === "opus" && ctx.stage === 1) reach = "eval";
  if (frozen.unless && frozen.unless.reach === "base-app-screen" && ctx.inRecipeVm) reach = "base-app-screen";
  const why = code + ": stops " + reach + (ctx.model ? " on " + ctx.model : "") + (ctx.arm ? " arm " + ctx.arm : "") + "; keeps running: " + frozen.keepsRunning + "; ledger: " + frozen.ledger;
  const needModel = (): Model => {
    if (!ctx.model || !MODELS_UNDER_TEST.includes(ctx.model)) throw new Error(code + " names a model under test, not " + ctx.model);
    return ctx.model as Model;
  };
  const plan = (scopes: ScopeStop[], settle: LedgerItemId[]): StopPlan => ({ code, reach, frozen, scopes, settle, capStop: false });
  switch (reach) {
    case "arm-on-model": {
      const m = needModel();
      if (!ctx.arm) throw new Error(code + " names an arm");
      return plan([scope(code, why, { items: sessionItems(m), model: m, arm: ctx.arm }), scope(code, why, { items: ["dc-judges"], subject: m, arm: ctx.arm })], []);
    }
    case "model-contrasts": {
      const m = needModel();
      return plan([scope(code, why, { items: sessionItems(m), model: m }), scope(code, why, { items: ["dc-judges"], subject: m })], sessionItems(m));
    }
    case "model-calls": {
      if (!ctx.model) throw new Error(code + " names the drifted model");
      return plan([scope(code, why, { model: ctx.model })], MODELS_UNDER_TEST.includes(ctx.model) ? sessionItems(ctx.model as Model) : []);
    }
    case "eval":
    case "every-stage":
      return plan([scope(code, why, {})], LEASED_ITEMS);
    case "authoring":
      return plan([scope(code, why, { items: AUTHORING_ITEMS })], AUTHORING_ITEMS);
    case "stage3":
      return plan([scope(code, why, { items: STAGE3_ITEMS }), scope(code, why, { items: ["dc-hosts"], stage: "stage3" })], STAGE3_ITEMS);
    case "base-app-screen":
      return plan([scope(code, why, { items: ["dc-base-apps"] }), scope(code, why, { items: ["dc-hosts"], stage: "recipes" })], ["dc-base-apps"]);
    case "item":
      return plan([scope(code, why, { items: ctx.item ? [ctx.item] : [] })], ctx.item ? [ctx.item] : []);
  }
}

/**
 * Applies a stop: adds its scopes, releases the unrun sessions they cover, and settles each named lease now or once
 * nothing on it is in flight. Returns the leases settled now and those that settle when drained.
 */
export async function applyStop(c: MoneyController, p: StopPlan): Promise<{ settledNow: LedgerItemId[]; draining: LedgerItemId[]; releasedSessions: string[] }> {
  for (const s of p.scopes) await c.addStop(s);
  const released: string[] = [];
  for (const sub of c.subsOf()) {
    if (sub.state !== "in-flight") continue;
    for (const slot of sub.sessions) {
      if (slot.state !== "pending") continue;
      if (c.stopFor(sub.item, { model: sub.model, subject: sub.subject, arm: slot.arm, stage: sub.stage })) {
        await c.releaseSession(sub.id, slot.id);
        released.push(slot.id);
      }
    }
  }
  const settledNow: LedgerItemId[] = [];
  const draining: LedgerItemId[] = [];
  for (const item of p.settle) {
    if (!c.lease(item)) continue;
    ((await c.settleItem(item)) ? settledNow : draining).push(item);
  }
  return { settledNow, draining, releasedSessions: released };
}
