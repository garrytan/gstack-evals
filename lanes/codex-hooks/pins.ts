// Copyright (c) 2026 Garry Tan. MIT License.
// Frozen values both parts of the Codex hooks eval share: the preregistration and its pre-run change, the gstack pin, the
// Codex CLI and the model, and the settings every arm passes. Part R's values are in r/, part C's in c/.
import { resolve } from "node:path";

export const REPO = resolve(import.meta.dir, "../..");
export const PREREG = "wiki/plans/2026-11-19-geva-562-codex-hooks-prereg";
export const CHANGE_1 = "wiki/plans/2026-11-19-geva-562-codex-hooks-pre-run-change-1";

// gstack at the release tag v1.102.0.0, for both parts (pre-run change 1, section 1).
export const GSTACK = {
  repo: "https://github.com/garrytan/gstack",
  tag: "v1.102.0.0",
  sha: "a0534ce6db39a8da1f3c23ec070aac2479e44be9",
  version: "1.102.0.0",
} as const;

// Codex CLI 0.170.0, installed beside the image's default codex, never from a floating tag (pre-run change 1, section 10).
// The npm tarball and the linux-x64 musl binary in it, by sha256; the office-hours rewrite eval pins the same bits.
export const CODEX = {
  version: "0.170.0",
  tarballSha256: "67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32",
  binarySha256: "880819aab735adcf16f36cd628940b9f1e652a36c01d10a5d32f83cc84902971",
} as const;

// The model under test, named on every command line (section 2), and the efforts the arms pin.
export const MODEL = "gpt-6.1-sol";
export const EFFORT = { low: "low", high: "high" } as const;

// -c settings every arm passes, the no-gstack arms included: Codex's sleep tool off (pre-run change 1, section 5).
export const ARM_SETTINGS: Readonly<Record<string, boolean>> = { "features.sleep_tool": false };

// gstack's three switches as gstack-config reports them, recorded per session (section 2).
export const SWITCHES = ["skill_routing", "skill_contracts", "destructive_guard"] as const;
