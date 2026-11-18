// Copyright (c) 2026 Garry Tan. MIT License.
// T8 seeding for the office-hours rewrite eval (prereg section 4 step 6; pre-run change 2, section 4). A skill arm on a
// T8 brief starts with a state root that holds one prior session in that pin's own format; the none arm starts empty,
// and no other brief is seeded.
// - Both pins: one developer-profile.json sessions[] entry in the shape office-hours logs with --log-session at
//   fc5c285 (date, mode, project_slug, signal_count, signals, design_doc, assignment, resources_shown, topics), its
//   assignment carrying the assignment and its test.
// - The new pin also: its commitment entry (mode "commitment", kill_date, kill_test), as design-and-handoff.md logs it
//   at 4afa7f2, so its --kill-check prints KILL_DUE: yes. kill_date is the brief's test date, and it must fall at least
//   two days before the session's UTC day, since the kill check compares with the machine's local date
//   (E_OHR_T8_SEED otherwise).
// - project_slug is the slug gstack-slug prints in the session's work repo: the work dir's basename, the founder lane's
//   task name (/work/idea gives "idea"), since the repo has no remote and nothing above it is a project.
// The file is what the pin's own --log-session writes for these entries on an empty profile: its stub, then each entry
// appended with the signal, resource and topic aggregates, as two-space JSON with no trailing newline.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import { TASK } from "../../office-hours-founder/run/contain.ts";
import type { PriorSession, SkillArm } from "../types.ts";

/** The slug gstack-slug prints in every session's work repo. */
export const SESSION_SLUG = TASK;
/** The profile file under the state root, as gstack-developer-profile names it. */
export const PROFILE_FILE = "developer-profile.json";
/** Days the kill date must sit before the session's UTC day (pre-run change 2, section 4). */
export const KILL_MARGIN_DAYS = 2;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a prior session cannot seed a session on day (YYYY-MM-DD, UTC), or null. */
export function priorProblem(prior: unknown, day: string): string | null {
  const p = prior as Partial<PriorSession> | null;
  if (!p || typeof p !== "object") return "prior.json is not an object";
  for (const k of ["date", "assignment", "test", "test_date", "condition"] as const) if (typeof p[k] !== "string" || !p[k]!.trim()) return "prior.json has no " + k;
  if (!ISO_DATE.test(p.date!.slice(0, 10)) || !ISO_DATE.test(p.test_date!)) return "prior.json's date and test_date must be ISO dates";
  const latest = new Date(Date.parse(day + "T00:00:00Z") - KILL_MARGIN_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (p.test_date! > latest) return "prior.json's test date " + p.test_date + " is not at least " + KILL_MARGIN_DAYS + " days before the session's day " + day;
  return null;
}

/** The entries the pin's skill would have logged after the prior session. */
export function priorEntries(arm: SkillArm, prior: PriorSession, slug: string = SESSION_SLUG): Record<string, unknown>[] {
  const ts = prior.date.slice(0, 10) + "T12:00:00.000Z";
  const session = { date: prior.date, mode: "startup", project_slug: slug, signal_count: 0, signals: [], design_doc: "", assignment: prior.assignment + " Test: " + prior.test, resources_shown: [], topics: [], ts };
  return arm === "new" ? [session, { date: prior.date, mode: "commitment", project_slug: slug, kill_date: prior.test_date, kill_test: prior.condition, ts }] : [session];
}

/** gstack-developer-profile's empty-profile stub (ensure_profile), the same at both pins. */
const stub = () => ({ identity: {}, declared: {}, inferred: { values: { scope_appetite: 0.5, risk_tolerance: 0.5, detail_preference: 0.5, autonomy: 0.5, architecture_care: 0.5 }, sample_size: 0, diversity: { skills_covered: 0, question_ids_covered: 0, days_span: 0 } }, gap: {}, overrides: {}, sessions: [] as unknown[], signals_accumulated: {} as Record<string, number>, schema_version: 1 });

/** developer-profile.json as the pin's --log-session leaves it after logging entries on an empty profile. */
export function profileText(entries: readonly Record<string, unknown>[]): string {
  const p: Record<string, any> = stub();
  for (const e of entries) {
    p.sessions.push(e);
    p.signals_accumulated = p.signals_accumulated || {};
    for (const s of (e.signals as string[] | undefined) ?? []) p.signals_accumulated[s] = (p.signals_accumulated[s] || 0) + 1;
    p.resources_shown = Array.from(new Set([...(p.resources_shown || []), ...(((e.resources_shown as string[] | undefined) ?? []))]));
    p.topics = Array.from(new Set([...(p.topics || []), ...(((e.topics as string[] | undefined) ?? []))]));
  }
  return JSON.stringify(p, null, 2);
}

/** Writes the prior session into the work repo's state root, before the trial seeds the rest of it. */
export function seedPrior(repo: string, arm: SkillArm, prior: PriorSession, day: string): string {
  const problem = priorProblem(prior, day);
  if (problem) throw new Error("E_OHR_T8_SEED " + problem);
  const root = join(repo, STATE_ROOT_DIR);
  mkdirSync(root, { recursive: true });
  const file = join(root, PROFILE_FILE);
  writeFileSync(file, profileText(priorEntries(arm, prior)));
  return file;
}
