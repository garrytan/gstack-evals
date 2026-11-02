// Copyright (c) 2026 Garry Tan. MIT License.
// The window filter reads a change's earliest public exposure, not its merge date (plan open item 12): the first of
// its linked issues opening, its pull request opening and its earliest commit (authored or committed). A change whose
// exposure can't be read completely is not eligible, because an unseen earlier exposure could predate the cutoff.

export interface ExposurePart {
  source: "issue" | "pr" | "commit";
  ref: string;
  at: string;
}

export interface Exposure {
  at: string;
  source: ExposurePart["source"];
  ref: string;
  /** false when an exposure the change names (a closing issue, a pull request) has no date in the metadata. */
  complete: boolean;
  missing: string[];
  parts: ExposurePart[];
}

export interface Window {
  /** First exposure date a task may have (inclusive). */
  start: string;
  /** Start of the strict stratum (inclusive), reported apart. */
  strict_start: string;
  /** The mining date: a change must be merged on or before it. */
  mined_at: string;
}

/** Where the window's start comes from. The plan states it as unverified, so the record says so. */
export const CUTOFF = {
  model: "anthropic/claude-opus-5-5",
  stated_cutoff: "2026-06",
  provenance: "Opus 5.5's stated training cutoff is June 2026, with some data possibly collected to September (unverified; public task sourcing brief, 2026-10-27-gsta-4-public-task-sourcing).",
  window_start: "2026-07-01",
  strict_start: "2026-10-01",
} as const;

export function earliestExposure(parts: ExposurePart[], missing: string[]): Exposure {
  if (parts.length === 0) throw new Error("a change with no dated exposure");
  const first = [...parts].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.ref.localeCompare(b.ref))[0];
  return { at: new Date(first.at).toISOString(), source: first.source, ref: first.ref, complete: missing.length === 0, missing, parts };
}

export type WindowReason = "exposure_incomplete" | "exposed_before_window" | "merged_after_mining";

export function windowVerdict(exposure: Exposure, mergedAt: string, w: Window): { stratum: "strict" | "window" | null; reasons: WindowReason[] } {
  const reasons: WindowReason[] = [];
  if (!exposure.complete) reasons.push("exposure_incomplete");
  if (Date.parse(exposure.at) < Date.parse(w.start)) reasons.push("exposed_before_window");
  if (Date.parse(mergedAt) > Date.parse(w.mined_at)) reasons.push("merged_after_mining");
  if (reasons.length > 0) return { stratum: null, reasons };
  return { stratum: Date.parse(exposure.at) >= Date.parse(w.strict_start) ? "strict" : "window", reasons };
}
