// Copyright (c) 2026 Garry Tan. MIT License.
// The ledger seam bound to main's ledger (src/runner/ledger): openLease with the run id's fixed holder directory and a
// nonce per launch, settleLease from the controller host's local ledger, recordStop for a cap stop. The record binds
// each item to one run id and holds one open lease per item (E_ITEM_BOUND, E_LEASE_UNSETTLED), so this is the only
// place a lease opens. A lease reserves the recorded cap less the larger of the record's committed spend and what the
// books hold on the item (the earlier launches' carried spend and this launch's own), never their sum: a model call
// sits in both the record's close and the book, while host hours sit in the book alone.
import { randomBytes } from "node:crypto";
import { openLease, recordStop, settleLease, type RequireAdmission } from "../../../src/runner/ledger/ledger.ts";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { DcError } from "../errors.ts";
import { exact } from "./book.ts";
import type { LeaseInfo, LeaseSeam } from "./types.ts";

export interface MainLeaseOptions {
  record: string;
  local: LocalLedger;
  /** One nonce per launch; the holder directory stays fixed per run id (R2-17). */
  nonce?: string;
  machineId?: string;
  requireAdmission?: RequireAdmission;
  warn?: (code: ReasonCode, message: string) => void;
}

export function mainLeases(o: MainLeaseOptions): LeaseSeam & { nonce: string } {
  const nonce = o.nonce ?? randomBytes(8).toString("hex");
  return {
    nonce,
    open(req): LeaseInfo {
      const state = readItem(o.record, req.item);
      const cap = state.cap_micros;
      const byBooks = cap !== null && req.heldMicros > state.committed_micros;
      if (byBooks && req.heldMicros >= cap) throw new DcError("E_DCW_LEDGER_REFUSED", req.item + " has no room: its books hold " + exact(req.heldMicros) + " (earlier launches' carried spend and this launch's own) of its " + exact(cap) + " cap, and the record " + exact(state.committed_micros) + "; no lease is opened");
      const lease = openLease(o.record, o.local, { item: req.item, run_id: req.runId, holder: { dir: req.holder, nonce }, ttl_ms: req.ttlMs, now: req.now, ...(byBooks ? { amount_micros: cap - req.heldMicros } : {}), ...(o.machineId ? { machine_id: o.machineId } : {}), ...(o.requireAdmission ? { requireAdmission: o.requireAdmission } : {}), ...(o.warn ? { warn: o.warn } : {}) });
      const file = o.local.getLease(lease.lease_id)!.file;
      return { leaseId: lease.lease_id, item: req.item, reservedMicros: lease.reserved_micros, expiresAt: lease.expires_at, createdAt: file.created_at };
    },
    settle(leaseId, capStop) {
      const close = settleLease(o.record, o.local, leaseId, o.warn, capStop);
      return { spentMicros: close.spent_micros, unknownMicros: close.unknown_micros };
    },
    recordStop(leaseId, scope) {
      o.local.stageStop(leaseId, scope);
      recordStop(o.record, leaseId, scope);
    },
  };
}
