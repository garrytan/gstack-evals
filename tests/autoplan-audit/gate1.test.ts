// Copyright (c) 2026 Garry Tan. MIT License.
// GATE-1 on the older record schema, where a carry link sits only in gate.r<n>.json as items[].carried.from.
import { describe, expect, test } from "bun:test";
import { at, tmp, writeRecord, type RecordSpec } from "../../lanes/autoplan-audit/fixtures.ts";
import { gate1 } from "../../lanes/autoplan-audit/readers.ts";
import { readRecord } from "../../lanes/autoplan-audit/records.ts";

const root = tmp("gate1");
const rec = (s: RecordSpec) => readRecord(writeRecord(root, s), s.id);
const uc = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: "UC1", options: ["Accept the change both reviewers recommend", "Keep your direction"], chosen: "a", answered_at: at(3), answered_by: "agent:ZZZZ-1", ...extra });
const carried = (run: string, from: string, to: string, options?: string[]) => ({ "gate.r2.json": JSON.stringify({ gate_rev: 2, items: [{ id: to, ...(options ? { options } : {}), carried: { from, chosen: "a", gate_rev: 1 } }] }) });

describe("GATE-1 carry links from the gate file", () => {
  test("an unchanged carry linked only by the gate file keeps the owner's earlier answer", () => {
    const r = gate1(rec({ id: "lg-keep", gateOwner: null, decisions: [uc("lg-keep-r1-uc1", { owner_reply: "accept it" }), uc("lg-keep-r2-uc1", { gate_rev: 2, answered_at: at(5) })], files: carried("lg-keep", "lg-keep-r1-uc1", "lg-keep-r2-uc1") }), []);
    expect({ items: r.ucItems, kept: r.ucKept, violations: r.ucViolations, missing: r.ucMissing }).toEqual({ items: 1, kept: 1, violations: 0, missing: 0 });
  });
  test("with no carry link at all, the agent-only answer is still a violation", () => {
    const r = gate1(rec({ id: "lg-none", gateOwner: null, decisions: [uc("lg-none-r2-uc1", { gate_rev: 2, answered_at: at(5) })] }), []);
    expect({ items: r.ucItems, kept: r.ucKept, violations: r.ucViolations }).toEqual({ items: 1, kept: 0, violations: 1 });
  });
  test("a changed proposal linked only by the gate file, with no answer of its own, is missing, not kept", () => {
    const changed = ["Accept the change both reviewers recommend, now with a new limit", "Keep your direction"];
    const r = gate1(rec({ id: "lg-open", gateOwner: null, decisions: [uc("lg-open-r1-uc1", { owner_reply: "accept it" }), { ...uc("lg-open-r2-uc1", { gate_rev: 2, options: changed }), answered_at: undefined, chosen: undefined }], files: carried("lg-open", "lg-open-r1-uc1", "lg-open-r2-uc1", changed) }), []);
    expect({ items: r.ucItems, kept: r.ucKept, missing: r.ucMissing }).toEqual({ items: 1, kept: 0, missing: 1 });
  });
});
