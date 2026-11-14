// Copyright (c) 2026 Garry Tan. MIT License.
// Start rules 8 and 9 as code checks (prereg section 14, plan section 12, PD-9): stage 1 waits for the Captain's go on
// office-hours' twin reading, and each OpenRouter model's first call is checked against the dated terms record.
import { STOP_SCOPES } from "../frozen.ts";
import { fail } from "../errors.ts";
import type { AnyModel, StopScope } from "../types.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";

const DAY_MS = 86_400_000;
export const OFFICE_HOURS_WAIT_DAYS = 14;

/** The Captain's recorded go for stage 1, naming office-hours' stage 1 twin reading. */
export interface CaptainGo {
  recordedAt: string;
  officeHoursReading: "tracks" | "NO READ (twin)";
}

/** The Captain's recorded choice once 14 days have passed since this eval's pilot passed with no office-hours reading. */
export interface CaptainChoice {
  recordedAt: string;
  start: boolean;
}

export interface Rule8Decision {
  start: boolean;
  /** A start on the Captain's choice after 14 days is a recorded deviation. */
  deviation: string | null;
  line: string;
}

const at = (iso: string, what: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) fail("E_USAGE", what + " is not a date: " + JSON.stringify(iso));
  return t;
};

/**
 * Rule 8: stage 1 starts on a recorded Captain go that names office-hours' stage 1 twin reading. A go naming NO READ
 * (twin) is the Captain's decision after the pause. With no reading 14 days after the pilot passed, stage 1 starts only
 * on the Captain's recorded choice, made after those 14 days, and the start is a deviation.
 */
export function startRule8(o: { go: CaptainGo | null; choice: CaptainChoice | null; pilotPassedAt: string | null; now: string }): Rule8Decision {
  if (o.go) {
    at(o.go.recordedAt, "the Captain's go");
    if (o.go.officeHoursReading !== "tracks" && o.go.officeHoursReading !== "NO READ (twin)") fail("E_USAGE", "the Captain's go must name office-hours' stage 1 twin reading");
    return { start: true, deviation: null, line: "start rule 8: the Captain's go names office-hours' twin reading (" + o.go.officeHoursReading + ")" + (o.go.officeHoursReading === "NO READ (twin)" ? "; stage 1 starts on the Captain's decision after the pause" : "") };
  }
  if (!o.pilotPassedAt) return { start: false, deviation: null, line: "start rule 8: no Captain go and the pilot hasn't passed; stage 1 waits" };
  const due = at(o.pilotPassedAt, "the pilot's pass date") + OFFICE_HOURS_WAIT_DAYS * DAY_MS;
  if (at(o.now, "now") < due) return { start: false, deviation: null, line: "start rule 8: no Captain go naming office-hours' twin reading; stage 1 waits until the reading reaches the Captain" };
  if (!o.choice) return { start: false, deviation: null, line: "start rule 8: 14 days have passed since the pilot passed with no office-hours reading; the Captain decides whether stage 1 starts" };
  if (at(o.choice.recordedAt, "the Captain's choice") < due) return { start: false, deviation: null, line: "start rule 8: the Captain's choice was recorded before the 14 days ran out; it doesn't count" };
  return o.choice.start
    ? { start: true, deviation: "stage 1 started on this eval's own twin check alone, by the Captain's choice after 14 days without office-hours' reading", line: "start rule 8: stage 1 starts on the Captain's choice after 14 days (a recorded deviation)" }
    : { start: false, deviation: null, line: "start rule 8: the Captain chose to keep waiting" };
}

/** Throws when rule 8 doesn't let stage 1 start. */
export function requireStartRule8(o: Parameters<typeof startRule8>[0]): Rule8Decision {
  const d = startRule8(o);
  if (!d.start) fail("E_USAGE", "stage 1 refused: " + d.line);
  return d;
}

/** The dated terms record for one OpenRouter model, read from OpenRouter's endpoints API before the cap request. */
export interface TermsRecord {
  model: Extract<AnyModel, "sol" | "particle" | "argon">;
  dated: string;
  provider: string;
  dataCollection: "deny";
  /** sha256 of the provider's data terms as recorded. */
  termsDigest: string;
}

/** What a model's first call recorded about where it was served. */
export interface FirstCall {
  model: TermsRecord["model"];
  provider: string;
  fallbacks: boolean;
  dataCollection: string;
  termsDigest: string;
}

/** PD-9: a drift stops every call on that model, in every role. */
export const DRIFT_ROLES = ["author", "auditor", "validator", "labeller", "panel", "gold source", "arm"] as const;

/**
 * Rule 9: a model's first call must be served by the recorded provider, with fallbacks off and data collection denied,
 * under the recorded terms. Any difference stops that model (E_DC_PROVIDER_DRIFT) for the Captain.
 */
export function startRule9(record: TermsRecord, call: FirstCall): { ok: boolean; code: ReasonCode | null; mismatches: string[]; scope: StopScope | null; roles: readonly string[]; line: string } {
  if (record.model !== call.model) fail("E_USAGE", "the terms record is for " + record.model + ", the call for " + call.model);
  const mismatches: string[] = [];
  if (call.provider !== record.provider) mismatches.push("provider " + call.provider + ", recorded " + record.provider);
  if (call.fallbacks) mismatches.push("fallbacks on");
  if (call.dataCollection !== record.dataCollection) mismatches.push("data collection " + call.dataCollection + ", recorded " + record.dataCollection);
  if (call.termsDigest !== record.termsDigest) mismatches.push("data terms differ from the record dated " + record.dated);
  const ok = !mismatches.length;
  return {
    ok,
    code: ok ? null : "E_DC_PROVIDER_DRIFT",
    mismatches,
    scope: ok ? null : STOP_SCOPES.E_DC_PROVIDER_DRIFT,
    roles: ok ? [] : DRIFT_ROLES,
    line: ok ? "start rule 9: " + call.model + " served by " + call.provider + " under the recorded terms" : "start rule 9: " + call.model + " drifted (" + mismatches.join("; ") + "): every call on it stops, in every role, for the Captain (E_DC_PROVIDER_DRIFT)",
  };
}
