// Copyright (c) 2026 Garry Tan. MIT License.
// Severity for part C's blocking secondary (preregistration section 5.3): R2's after-pin severity maps, read the way R2's
// amendment (2026-11-03-geva-255-r2-after-pin-amendment, section 6) says GEVA-89's sevmap.ts reads them. A label is cut at
// its first comma; CRITICAL and INFORMATIONAL map to themselves (R2's mapSeverity); any other label needs a row of the
// arm's entry, matched exactly or as a case twin; a compound label maps by its first word; anything else is unmapped, and
// an unmapped label stops the blocking secondary rather than guessing. Key-blind extraction writes UNLABELLED for a
// finding its message gives no label, which no map names and which is never blocking.
import { readFileSync } from "node:fs";
import { mapSeverity, type ArmJson, type Mapped } from "../../../review-noloss/contract.ts";
import { sha256 } from "../../../review-noloss/suite.ts";
import { ARMS, SEVERITY_ENTRY, SEVERITY_MAP, SUITE, type CArm } from "./frozen.ts";

export type SeverityEntry = NonNullable<ArmJson["severity_map"]>;
export const UNLABELLED = "unlabelled";
/** A finding's severity under its arm's map: CRITICAL, INFORMATIONAL, unlabelled (extracted with no label) or null (unmapped). */
export type Severity = Mapped | "unlabelled" | null;

/** R2's ArmJson for one of this eval's arms, so R2's code that reads an arm's severity map reads this one. */
export const armJson = (arm: CArm, map: SeverityEntry): ArmJson => ({ contract_version: 1, id: arm, label: arm, suite: "stacks-r1", date: "2026-11-21", passes: 2, severity_map: map });

export function loadSeverityMaps(path: string = SEVERITY_MAP.path): Record<CArm, SeverityEntry> {
  const text = readFileSync(path);
  if (sha256(text) !== SEVERITY_MAP.sha256) throw new Error("E_CH_C_FROZEN " + path + " hashes to " + sha256(text) + ", not R2's after-pin map " + SEVERITY_MAP.sha256 + " (suite " + SUITE.sha256.slice(0, 12) + ")");
  const all = JSON.parse(text.toString("utf8")) as Record<string, SeverityEntry>;
  return Object.fromEntries(ARMS.map((a) => [a, all[SEVERITY_ENTRY[a]] ?? {}])) as Record<CArm, SeverityEntry>;
}

function lookup(arm: CArm, map: SeverityEntry, raw: string, reader: string | null): Mapped | null {
  const exact = mapSeverity(armJson(arm, map), raw, reader);
  if (exact) return exact;
  const rows = { ...(map.default ?? {}), ...(reader !== null ? (map.by_reader?.[reader] ?? {}) : {}) };
  const twin = Object.keys(rows).find((k) => k.toLowerCase() === raw.toLowerCase());
  return twin ? rows[twin]! : null;
}

/** The mapped severity of a finding's label under its arm's map. */
export function severityOf(arm: CArm, map: SeverityEntry, label: string, reader: string | null = null): Severity {
  const raw = label.split(",")[0]!.trim();
  if (raw.toLowerCase() === UNLABELLED) return UNLABELLED;
  const whole = lookup(arm, map, raw, reader);
  if (whole) return whole;
  const first = raw.split(/[^A-Za-z0-9]+/).find(Boolean) ?? "";
  return first && first !== raw ? lookup(arm, map, first, reader) : null;
}

/** The reader review-units' renderFindings gives a finding that says whether it was confirmed. */
export const readerOf = (f: { confirmed?: boolean }) => (f.confirmed === undefined ? null : f.confirmed ? "confirmed" : "unconfirmed");
