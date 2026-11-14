// Copyright (c) 2026 Garry Tan. MIT License.
// The money area's own types: the sub-reservation book, admission outcomes and the seams integration wires (the
// ledger and the off-host copy target). Shared shapes stay in ../types.ts.
import type { AnyModel, LedgerItemId, Model, SubReservation } from "../types.ts";

export type SubKind = "call" | "round" | "recipe" | "oracle" | "vm";
export type SubState = "in-flight" | "settled" | "unknown" | "released";

/** One session inside a round sub-reservation. Its share is its allowance twice over (the one retry runs inside). */
export interface SessionSlot {
  id: string;
  arm: string | null;
  state: "pending" | "started" | "done" | "released";
}

/** A frozen run's hold inside its item's one lease (plan section 5). Money is integer micro-dollars. */
export interface Sub extends SubReservation {
  id: string;
  kind: SubKind;
  leaseId: string;
  /** The model the work calls (author, auditor, judge or model under test), or null for a VM. */
  model: AnyModel | null;
  /** The model under test whose lists a judge call labels, when there is one. */
  subject: Model | null;
  arm: string | null;
  /** The stage a VM or call serves, such as "recipes", "stage1" or "stage3". */
  stage: string | null;
  /** A free tag, such as a judge packet id, that a pause may let through. */
  tag: string | null;
  retry: boolean;
  reserveMicros: number;
  spentMicros: number;
  unknownMicros: number;
  state: SubState;
  sessions: SessionSlot[];
  /** dc-hosts only: the VM, its list price per hour in micros, its time to live in hours, and whether it is the controller host, which holds for the whole stage and so never counts as work that will free room. */
  vm: { id: string; priceMicrosPerHour: number; ttlHours: number; controller: boolean } | null;
}

export type Admission =
  | { kind: "admitted"; sub: Sub }
  /** Refused while something on the item is in flight, or held by a pause: try again after the next settlement. */
  | { kind: "wait"; why: string }
  /** Refused with nothing in flight on the item: recorded, the lease settled with cap_stop, the item closed. */
  | { kind: "cap-stop"; why: string }
  /** The item is closed by an earlier cap stop or a settled stop. */
  | { kind: "closed"; why: string }
  /** A stop scope (L5) covers this work. */
  | { kind: "stopped"; code: string; why: string }
  /** The work waits for the Captain: a re-projection past the cap, a refused stage or an unproven ledger copy. */
  | { kind: "captain"; why: string }
  /** The off-host copy did not acknowledge the admission, so nothing may be forwarded. */
  | { kind: "unacked"; why: string };

/** One item's money, the three charges carried apart (plan L1). */
export interface ItemFigures {
  item: LedgerItemId;
  capMicros: number;
  settledMicros: number;
  /** Full reservations of in-flight sub-reservations. */
  inFlightMicros: number;
  /** Unknown charges, each at its full reservation until reconciled. */
  unknownMicros: number;
  inFlightCount: number;
  leaseId: string | null;
  closed: boolean;
  /** Why admissions on the item are held, or null. */
  paused: string | null;
}

export interface LeaseInfo {
  leaseId: string;
  item: LedgerItemId;
  reservedMicros: number;
  expiresAt: string;
  createdAt: string;
}

/** The ledger seam. ledger-main.ts binds it to main's src/runner/ledger; a test may bind a fake. */
export interface LeaseSeam {
  open(req: { item: LedgerItemId; runId: string; holder: string; ttlMs: number; now: Date }): LeaseInfo;
  /** Settles the lease from its local ledger. capStop marks a cap stop, which closes the item for good (R2-20). */
  settle(leaseId: string, capStop?: string): { spentMicros: number; unknownMicros: number };
  /** Records a cap stop in the record before anything answers the refused work. */
  recordStop(leaseId: string, scope: string): void;
}

/** The off-host copy target (R2-4). Integration binds a real one; append resolves only once the line is durable there. */
export interface OffHostTarget {
  append(line: string): Promise<void>;
  /** Every line the target holds, in order. */
  lines(): Promise<string[]>;
  putSnapshot(name: string, bytes: Uint8Array): Promise<void>;
  getSnapshot(name: string): Promise<Uint8Array | null>;
  /** The newest snapshot name the target holds, or null. */
  latestSnapshot(): Promise<string | null>;
}
