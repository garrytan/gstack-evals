// Copyright (c) 2026 Garry Tan. MIT License.
// The seams the recipe sessions and stage 3 call through: money, VM hours, the agents, the browser and the model reads.
// Integration wires the real ledger, proxy, Ubicloud backend, Playwright and model clients; tests and the dry run wire
// scripted fakes. Nothing in stage3/ or recipes/ calls a model, the ledger or a VM except through these.
import type { STAGE3 } from "../frozen.ts";
import type { ItemClass, LedgerItemId, Unit } from "../types.ts";
import type { Vm } from "./sandbox.ts";

/** One admission on an item's one controller-held lease (plan section 5). */
export type Admission = { ok: true; id: string } | { ok: false; why: string };

export interface MoneySeam {
  /** Admits one frozen run as a sub-reservation of reserveUsd on the item's lease. */
  admit(req: { item: LedgerItemId; run: string; reserveUsd: number }): Promise<Admission>;
  /** Settles a sub-reservation at its spend. Null spend is unknown: it stays held at its full reserve until reconciled. */
  settle(id: string, spentUsd: number | null): Promise<void>;
  /** J1: reconciles the sub-reservation against the proxy journal and the session log before any retry (plan L3). */
  reconcile(id: string): Promise<void>;
  /** Records a cap stop: the item's lease settles and the item closes (R2-20). */
  capStop(item: LedgerItemId, why: string): Promise<void>;
  /** Releases an item's unrun reserve, as when fewer than 8 units qualify for stage 3. */
  release(item: LedgerItemId, why: string): Promise<void>;
}

/** dc-hosts: each VM is an atomic sub-reservation of its time to live, settled at measured hours (plan section 5). */
export interface HostsSeam {
  admit(req: { run: string; hours: number }): Promise<Admission>;
  settle(id: string, hours: number): Promise<void>;
}

/** Thrown through the run loops when an item refuses an admission with nothing in flight on it (plan L2). */
export class CapStopSignal extends Error {
  constructor(
    readonly item: LedgerItemId,
    why: string,
  ) {
    super("cap stop on " + item + ": " + why);
  }
}

/** How an agent session inside a VM ended, as the harness reads it. */
export type AgentEnd = "completed" | "own-limit" | "infra";

/** The admitted sub-reservation an agent session runs on: its slot on the item's metering proxy is bound to it. */
export interface SubRef {
  item: LedgerItemId;
  id: string;
}

export interface AgentRun {
  end: AgentEnd;
  /** Proxy-metered spend; null when unknown (held until reconciled). */
  spentUsd: number | null;
  /** For an infra end, the driver's termination, for the record's cause. */
  why?: string;
}

// ---- Stage 3 (prereg section 11 and 2026-11-09 section 11)

/** One mechanical key check, per key item a mechanical check can tell (H items have none: the agent user reads them). */
export interface KeyCheck {
  id: string;
  /** The key item's id. */
  item: string;
  class: Exclude<ItemClass, "H">;
  /** The sealed check body (forced state and assertion, viewport, axe rule, diff read); opaque here. */
  body: unknown;
}

export interface Scenario {
  id: string;
  /** The goal and its state checker, sealed; opaque here. */
  body: unknown;
}

/** What Opus writes for a unit: fixtures for the data source plan.md names, key checks and three scenarios. */
export interface Authored {
  fixtures: unknown;
  keyChecks: KeyCheck[];
  scenarios: Scenario[];
}

/** Sol's audit of what Opus wrote: a verdict per fixture set, key check and scenario. */
export interface AuthoredAudit {
  fixtures: boolean;
  keyChecks: Record<string, boolean>;
  scenarios: Record<string, boolean>;
}

/** Runs Opus 5.5 in Claude Code with no gstack inside the build VM under the build limits, through the metering proxy. */
export type BuildAgent = (vm: Vm, o: { prompt: string; limits: typeof STAGE3.build; env: Readonly<Record<string, string>>; sub: SubRef }) => Promise<AgentRun>;

export type AstraState = "designed" | "blank" | "broken" | "raw-error" | "endless-spinner";

/** The raw reads of one served build, from the controller's browser and model calls (measures 2 to 7). */
export interface BuildReads {
  /** Whether the changed screen reads the data source plan.md names; forced-state reads are unavailable when false. */
  readsDataSource: boolean;
  /** Serious and critical axe-core violations, each as "rule target", per route and viewport width. */
  axe: Array<{ route: string; width: number; violations: string[] }>;
  /** Horizontal overflow per route at 375 and 768 pixels. */
  overflow: Array<{ route: string; width: number; overflow: boolean }>;
  /** Interactive elements under 44 pixels on the changed screens at 375 pixels. */
  smallTargets: number;
  /** Forced states per route: the mechanical read and Astra's blind read (null when that read failed twice). */
  forced: Array<{ route: string; state: "empty" | "error" | "loading"; distinct: boolean; astra: AstraState | null }>;
  /** Each validated key check's result; null when its run failed twice. */
  keyChecks: Record<string, boolean | null>;
  /** The agent user per scenario; null when the run failed twice. */
  agentUser: Array<{ scenario: string; completed: boolean | null; steps: number; failedActions: number; consoleErrors: number; deadEnds: number }>;
  /** Colour and spacing literals the build added in UI files where the project has tokens; null when the read failed. */
  literalsAdded: number | null;
  /** Desktop and phone screenshots of the main changed route, by reference, for DES-4. */
  screens: { desktop: string; phone: string } | null;
}

/** Context for one check run's reads: the item that pays, the unit's checks and scenarios, the routes. */
export interface ReadsContext {
  unit: Unit;
  item: LedgerItemId;
  routes: string[];
  keyChecks: KeyCheck[];
  scenarios: Scenario[];
  fixtures: unknown;
}

/** The controller's reads of a served build in its check VM. */
export type BuildReader = (vm: Vm, ctx: ReadsContext) => Promise<BuildReads>;

/** Opus writes, Sol audits (both on dc-stage3-authoring as direct calls). */
export interface Stage3Authoring {
  author(unit: Unit): Promise<Authored>;
  audit(unit: Unit, authored: Authored): Promise<AuthoredAudit>;
}

/** One DES-4 judge call: which of two screenshot pairs looks designed for this product; null after a failed retry. */
export type PairwiseJudge = (o: { unit: Unit; judge: "astra" | "argon"; first: { desktop: string; phone: string }; second: { desktop: string; phone: string } }) => Promise<"first" | "second" | "tie" | null>;
