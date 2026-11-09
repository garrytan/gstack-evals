// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's docs-only first success, the probe contract and the per-build measures (prereg 2026-11-09-geva-417, section
// 12 "Docs-only first success" and "Measures"). A fresh Opus 5.5 agent with no gstack gets a fresh sandbox with the built
// artifact installed, the tree's README, docs/ and the artifact's help output, no source tree, the frozen goal and 20
// turns. The checker decides first success. Each misuse probe's output is scored on the contract's fields: it names what
// failed and it names a fix or next step (judged by Astra, behind ProbeJudge); it exits non-zero (a CLI) or returns a
// problem-details body (an API); it carries no secret value; it returns within 10 seconds with stdin closed.
import type { Caller } from "../score/judge.ts";
import { EFFORT } from "../score/judge.ts";
import { lastJson } from "../../product-value/author/run.ts";
import type { ArmId } from "../types.ts";
import type { Probe, ProbeKind } from "./goal.ts";

export const DOCS_TURNS = 20;
export const PROBE_SECONDS = 10;
export const DOCS_ROOT = "/work/docs";

export interface DocsInputs {
  readme: string;
  /** docs/ files by their path under docs/. */
  docs: Record<string, string>;
  help: string;
  goal: string;
}

/** The files the docs-only VM gets beside the installed artifact: README, docs/ and the help output, nothing else. */
export function docsFiles(i: DocsInputs): Record<string, string> {
  const out: Record<string, string> = { [DOCS_ROOT + "/README.md"]: i.readme, [DOCS_ROOT + "/help.txt"]: i.help };
  for (const [p, text] of Object.entries(i.docs)) {
    const clean = p.replace(/^\/+/, "");
    if (clean.split("/").includes("..")) throw new Error("E_USAGE a docs path leaves docs/: " + p);
    out[DOCS_ROOT + "/docs/" + clean] = text;
  }
  return out;
}

export const docsPrompt = (goal: string): string => "Goal: " + goal + "\n\nThe tool is installed. Its README, its docs/ folder and its help output are in " + DOCS_ROOT + ". There is no source tree. Reach the goal using only these.";

export const DOCS_SESSION = { turns: DOCS_TURNS, model: "claude-opus-5-5", gstack: false } as const;

/** One probe as the sandbox ran it. */
export interface ProbeRun {
  kind: ProbeKind;
  exit: number;
  stdout: string;
  stderr: string;
  elapsed_ms: number;
  stdin_closed: boolean;
  /** An API probe's response media type; null for a CLI probe. */
  content_type: string | null;
}

export interface Mechanical {
  /** A CLI exits non-zero; an API returns a problem-details body. */
  signals: boolean;
  no_secret: boolean;
  in_time: boolean;
}

/** An RFC 9457 problem-details body: media type application/problem+json and a JSON object body. */
export function problemDetails(r: ProbeRun): boolean {
  if (!/^application\/problem\+json\b/i.test(r.content_type ?? "")) return false;
  try {
    const v = JSON.parse(r.stdout);
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** The contract's three mechanical fields; secrets are the values planted in the sandbox for the run. */
export function mechanical(r: ProbeRun, secrets: readonly string[]): Mechanical {
  const text = r.stdout + "\n" + r.stderr;
  return {
    signals: r.kind === "cli" ? r.exit !== 0 : problemDetails(r),
    no_secret: !secrets.some((s) => s.length > 0 && text.includes(s)),
    in_time: r.stdin_closed && r.elapsed_ms <= PROBE_SECONDS * 1000,
  };
}

export interface Judged {
  names_failure: boolean;
  names_fix: boolean;
}

/** The first two fields; null when the judge gave no readable answer. */
export type ProbeJudge = (o: { goal: string; probe: Probe; output: string }) => Promise<Judged | null>;

export const PROBE_JUDGE_PROMPT = [
  "You read one error output from a developer tool. A developer ran a command that misuses the tool on purpose.",
  "Answer two questions about the output alone:",
  "1. names_failure: does it say what failed?",
  "2. names_fix: does it name a fix or a next step?",
  "Reply with one JSON object: {\"names_failure\": true or false, \"names_fix\": true or false}.",
].join("\n");

/** The Astra judge of the two judged fields, through the shared metered caller (score/judge.ts openJudge). */
export function astraProbeJudge(call: Caller): ProbeJudge {
  return async ({ goal, probe, output }) => {
    const prompt = PROBE_JUDGE_PROMPT + "\n\nTool goal: " + goal + "\nMisuse: " + probe.misuse + "\nCommand: " + probe.command + "\n\nOutput:\n" + output;
    const r = await call({ judge: "astra", prompt, effort: EFFORT.production, maxTokens: 4_000, label: "stage3-probe:" + probe.id, subject: "opus" });
    const v = lastJson(r.text);
    return typeof v?.names_failure === "boolean" && typeof v?.names_fix === "boolean" ? { names_failure: v.names_failure, names_fix: v.names_fix } : null;
  };
}

export interface ProbeScore extends Mechanical {
  probe: string;
  names_failure: boolean | null;
  names_fix: boolean | null;
  /** Every field met; null when the judge gave no answer. */
  meets: boolean | null;
}

export async function scoreProbe(probe: Probe, run: ProbeRun, o: { goal: string; secrets: readonly string[]; judge: ProbeJudge }): Promise<ProbeScore> {
  const m = mechanical(run, o.secrets);
  const j = await o.judge({ goal: o.goal, probe, output: run.stdout + (run.stderr ? "\n" + run.stderr : "") });
  return { probe: probe.id, ...m, names_failure: j?.names_failure ?? null, names_fix: j?.names_fix ?? null, meets: j ? j.names_failure && j.names_fix && m.signals && m.no_secret && m.in_time : null };
}

/** One command the docs-only agent ran. */
export interface Command {
  command: string;
  exit: number;
  turn: number;
}

/** The docs-only session as the controller recorded it; the checker ran after it ended. */
export interface DocsSession {
  commands: Command[];
  turns: number;
  minutes: number;
  checker_pass: boolean;
}

export interface BuildMeasures {
  unit: string;
  arm: ArmId;
  first_success: 0 | 1;
  turns: number | null;
  minutes: number | null;
  failed_commands: number | null;
  /** DX-5: the share of probes meeting every field. */
  probe_share: number | null;
  /** The share of the goal's steps the README states. */
  readme_share: number | null;
  code: string | null;
  /** Why first success is 0 without a session (section 6's stage 3 row), or null. */
  instrument: string | null;
  contaminated: boolean;
  /** Missing: a contaminated build, or one an infra failure stopped (E_DX_INFRA_MISSING); it drops from the pairs. */
  missing: boolean;
}

/** The lines inside the README's fenced code blocks, with a leading shell prompt stripped and whitespace collapsed. */
export function readmeCommands(readme: string): Set<string> {
  const out = new Set<string>();
  for (const m of readme.matchAll(/^\u0060{3}[^\n]*\n([\s\S]*?)^\u0060{3}/gm)) for (const l of m[1]!.split("\n")) {
    const c = squash(l.replace(/^\s*[$>]\s+/, ""));
    if (c) out.add(c);
  }
  return out;
}
const squash = (s: string) => s.trim().replace(/\s+/g, " ");

/** The goal's steps are the commands that exited 0; a step is stated when a README code line is that command. */
export function readmeShare(commands: readonly Command[], readme: string): number | null {
  const steps = commands.filter((c) => c.exit === 0);
  if (!steps.length) return null;
  const stated = readmeCommands(readme);
  return steps.filter((c) => stated.has(squash(c.command))).length / steps.length;
}

export function measures(o: { unit: string; arm: ArmId; session: DocsSession; probes: readonly ProbeScore[]; readme: string }): BuildMeasures {
  const s = o.session, ok = s.checker_pass;
  const scored = o.probes.filter((p) => p.meets !== null);
  return {
    unit: o.unit,
    arm: o.arm,
    first_success: ok ? 1 : 0,
    turns: ok ? s.turns : null,
    minutes: ok ? s.minutes : null,
    failed_commands: ok ? s.commands.filter((c) => c.exit !== 0).length : null,
    probe_share: scored.length ? scored.filter((p) => p.meets).length / scored.length : null,
    readme_share: readmeShare(s.commands, o.readme),
    code: null,
    instrument: null,
    contaminated: false,
    missing: false,
  };
}

/** A build that never reached the docs-only session: first success 0 and nothing else measured. */
export const instrumented = (unit: string, arm: ArmId, code: string | null, why: string): BuildMeasures => ({ unit, arm, first_success: 0, turns: null, minutes: null, failed_commands: null, probe_share: null, readme_share: null, code, instrument: why, contaminated: false, missing: false });
