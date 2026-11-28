#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's driven launch (prereg 2026-11-24-geva-587-design-time-state-modeling section 10) is withdrawn. Its teardown
// removed Docker resources by the labels other evals share, so on a shared daemon it could delete another run's
// containers, volumes or images, and an empty label list at start does not show the daemon is its own. Eval 1 is stopped
// SUPPLY SHORT, so the launch now reports unavailable and makes no Docker call, whatever the paid stop says. Its last
// implementation is at commit 074beb2a; a rerun that needs it brings it back by a dated pre-run change, with resources it
// can prove it created or a daemon of its own.
// Usage: bun lanes/eng-planted/e1/e2e.ts
import { E1_STOPPED } from "./commands.ts";

export interface Check {
  check: string;
  ok: boolean;
  detail: string;
}

export async function drivenLaunch(): Promise<{ ok: boolean; detail: string; checks: Check[] }> {
  return { ok: false, detail: "unavailable: the e1 driven launch is withdrawn and makes no Docker call (" + E1_STOPPED + ")", checks: [] };
}

if (import.meta.main) {
  const r = await drivenLaunch();
  console.log("FAIL e1 driven launch: " + r.detail);
  process.exit(1);
}
