// Copyright (c) 2026 Garry Tan. MIT License.
// The pin writer (build spec section 6): thresholds, acting bands, the safety rule's exact patterns and the sha256 of
// questions.json, the next-step mapping and the safety rule, written before any pilot or scored session. The file's own
// sha256 goes beside it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAFETY_PATTERNS } from "../labels/safety.ts";
import { EDGES } from "./bands.ts";
import type { Tuned } from "./tune.ts";

export const J_FIXED = { choice: 0.9, noul_yes: 0.9, noul_no: 0.1, relevant_drop_p: 0.1 };
const LABELS = join(import.meta.dir, "..", "labels");

export interface Pin {
  v: 1;
  questions_sha256: string;
  mapping_sha256: string;
  safety_rule_sha256: string;
  safety_patterns: typeof SAFETY_PATTERNS;
  particle_max_tokens: 8000 | 16000;
  jev: Tuned["jev"];
  particle_guess: Tuned["particle_guess"];
  particle_noguess: Tuned["particle_noguess"];
  j_fixed: typeof J_FIXED;
  ece: Record<string, number | null>;
  n_labelled: Record<string, number>;
}

export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The mapping and the safety rule are frozen in code: each digest covers its file and the shell reader it uses. */
export function ruleDigests(): { mapping_sha256: string; safety_rule_sha256: string } {
  const shell = readFileSync(join(LABELS, "shell.ts"));
  return {
    mapping_sha256: sha256(Buffer.concat([readFileSync(join(LABELS, "next-step.ts")), shell])),
    safety_rule_sha256: sha256(Buffer.concat([readFileSync(join(LABELS, "safety.ts")), shell])),
  };
}

export function buildPin(t: Tuned, meta: { questions_sha256: string; mapping_sha256: string; safety_rule_sha256: string; particle_max_tokens: number }): Pin {
  return validatePin({ v: 1, ...meta, safety_patterns: SAFETY_PATTERNS, jev: t.jev, particle_guess: t.particle_guess, particle_noguess: t.particle_noguess, j_fixed: J_FIXED, ece: t.ece, n_labelled: t.n_labelled });
}

export function validatePin(p: any): Pin {
  const fail = (m: string): never => { throw new Error("E_DR_PIN " + m); };
  if (p?.v !== 1) fail("pin v must be 1");
  for (const k of ["questions_sha256", "mapping_sha256", "safety_rule_sha256"]) if (!/^[0-9a-f]{64}$/.test(p[k] ?? "")) fail(k + " is not a sha256");
  if (JSON.stringify(p.safety_patterns) !== JSON.stringify(SAFETY_PATTERNS)) fail("safety_patterns differ from the frozen rule's patterns in labels/safety.ts");
  if (p.particle_max_tokens !== 8000 && p.particle_max_tokens !== 16000) fail("particle_max_tokens must be 8000 or 16000");
  if (p.jev?.done?.edge !== null) fail("done never gets a Jev band (prereg section 6.5)");
  const edge = (x: unknown, where: string) => { if (x !== null && !EDGES.includes(x as number)) fail(where + " is " + JSON.stringify(x) + ", not a band edge or null"); };
  edge(p.jev.next_step?.edge, "jev.next_step.edge");
  edge(p.jev.tests_passed?.edge, "jev.tests_passed.edge");
  edge(p.jev.safe?.block_edge, "jev.safe.block_edge");
  edge(p.jev.safe?.allow_edge, "jev.safe.allow_edge");
  edge(p.jev.relevant?.drop_edge, "jev.relevant.drop_edge");
  for (const d of ["particle_guess", "particle_noguess"]) { edge(p[d]?.next_step?.edge, d + ".next_step.edge"); edge(p[d]?.relevant?.drop_edge, d + ".relevant.drop_edge"); }
  if (JSON.stringify(p.j_fixed) !== JSON.stringify(J_FIXED)) fail("j_fixed must be " + JSON.stringify(J_FIXED));
  if (!p.ece || !p.n_labelled) fail("ece and n_labelled are required");
  return p as Pin;
}

/** Writes pin.json and pin.json.sha256; returns the sha256 of the bytes written. */
export function writePin(path: string, pin: Pin): string {
  const text = JSON.stringify(validatePin(pin), null, 2) + "\n";
  const digest = sha256(text);
  writeFileSync(path, text);
  writeFileSync(path + ".sha256", digest + "\n");
  return digest;
}
