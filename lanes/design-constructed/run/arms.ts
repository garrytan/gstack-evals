// Copyright (c) 2026 Garry Tan. MIT License.
// The four arms and the full-information reference as frozen (prereg section 4; 2026-11-09-geva-420 section 4): each
// session's prompt, its env, its limits, its denied tools and its container. Every string comes from frozen.ts.
// Build-time choices (NOTES.md): the parts of a prompt before the template join with one newline, and the template
// follows a blank line, as the frozen text asks; the reference copies each evidence file in path order under its path,
// inside a fence longer than any backtick run in the file. GSTACK_SESSION_KIND=unattended and the empty plan-tune
// state belong to the two gstack arms (HARNESS.gstackEnv); the two CLAUDE_CODE_ settings go to every session.
import { ARM_LEAD, COMMON_LINE, FORCED_SENTENCE, GSTACK_PIN, HARNESS, REFERENCE_OPENING, SESSION_LIMITS, TEMPLATE } from "../frozen.ts";
import type { Arm, GstackArm, Model, SessionKind } from "../types.ts";

export const GSTACK_ARMS: readonly GstackArm[] = ["plan-design-review", "autoplan"];
export const isGstackArm = (k: SessionKind): k is GstackArm => (GSTACK_ARMS as readonly string[]).includes(k);

/** One evidence file as the unit holds it: a path under the repository root and its text. */
export interface EvidenceFile {
  path: string;
  text: string;
}

const fenceFor = (text: string): string => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

/** The reference's copied evidence: each file under its path, in byte order of path, each in its own fence. */
export function evidenceBlock(files: readonly EvidenceFile[]): string {
  return [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => {
      const fence = fenceFor(f.text);
      return f.path + "\n" + fence + "\n" + f.text.replace(/\n+$/, "") + "\n" + fence;
    })
    .join("\n\n");
}

/** A session's prompt: what comes before the common line, the common line, a blank line and the template. */
export function armPrompt(kind: SessionKind, evidence: readonly EvidenceFile[] = []): string {
  if (kind !== "reference" && evidence.length) throw new Error("E_USAGE: only the full-information reference copies evidence into its prompt");
  if (kind === "reference" && !evidence.length) throw new Error("E_USAGE: the full-information reference needs the unit's evidence files");
  const lead = kind === "reference" ? [REFERENCE_OPENING, evidenceBlock(evidence)] : kind === "none" ? [] : isGstackArm(kind) ? [ARM_LEAD[kind]!, FORCED_SENTENCE] : [ARM_LEAD[kind as Arm]!];
  return [...lead, COMMON_LINE].join("\n") + "\n\n" + TEMPLATE;
}

/** The container one session runs in (C3). The integrator maps it onto the Docker rig. */
export interface ContainerSpec {
  /** The session's working folder; it holds plan.md, context/ and repo/. */
  cwd: "/work";
  mounts: readonly string[];
  /** Files that exist in no mount. */
  neverMounted: readonly string[];
  /** HOME starts empty; only the gstack install writes into it, in the two gstack arms. */
  home: "/home/agent";
  /** Paths that hold nothing before any install: no skills folder, no gstack state root, no gstack checkout. */
  absentAtStart: readonly string[];
  /** gstack's install at the pin after the strip, or none. */
  gstack: { commit: string; version: string; install: string } | null;
  /** No network but the metering proxy, which admits only this model on the lease. */
  network: "proxy-only";
  drive: false;
}

export interface SessionSetup {
  kind: SessionKind;
  model: Model;
  prompt: string;
  env: Record<string, string>;
  deniedTools: readonly string[];
  limits: { usd: number; turns: number; minutes: number };
  container: ContainerSpec;
  /** The gstack arms start with an empty plan-tune state (no PLAN_TUNE_FILES name under the state root). */
  planTune: "empty" | null;
}

/** Names of gstack's plan-tune state at the pin (question preferences, the question log, the developer profile). */
export const PLAN_TUNE_FILES = /^(?:global-)?question-(?:preferences|log)[\w.-]*$|^developer-profile[\w.-]*$/;
export const HOME = "/home/agent";
export const STATE_ROOT = HOME + "/.gstack";

/** Every session's frozen setup. The reference takes the none arm's limits and container, with no gstack. */
export function sessionSetup(kind: SessionKind, model: Model, evidence: readonly EvidenceFile[] = []): SessionSetup {
  const gstack = isGstackArm(kind);
  return {
    kind,
    model,
    prompt: armPrompt(kind, evidence),
    env: { ...HARNESS.env, ...(gstack ? HARNESS.gstackEnv : {}) },
    deniedTools: HARNESS.deniedTools,
    limits: { ...SESSION_LIMITS[model] },
    container: {
      cwd: "/work",
      mounts: HARNESS.mounts,
      neverMounted: HARNESS.neverMounted,
      home: HOME,
      absentAtStart: [HOME + "/.claude/skills", STATE_ROOT, HOME + "/.local/share/gstack"],
      gstack: gstack ? { commit: GSTACK_PIN.commit, version: GSTACK_PIN.version, install: GSTACK_PIN.install } : null,
      network: "proxy-only",
      drive: false,
    },
    planTune: gstack ? "empty" : null,
  };
}

/**
 * The container check before a session (C3), on a listing of the container's files: entries is every path under HOME
 * and every mount point, as absolute paths. A clean session (none, lens, reference) needs an empty HOME, none of the
 * absent paths and no drive path; a gstack arm needs no plan-tune file under its state root and no drive path.
 * Returns the problems found; an empty list passes.
 */
export function containerProblems(setup: SessionSetup, entries: readonly string[]): string[] {
  const problems: string[] = [];
  const under = (root: string) => entries.filter((p) => p.startsWith(root + "/"));
  if (setup.container.gstack === null) {
    const home = under(HOME);
    if (home.length) problems.push("HOME is not empty: " + home.slice(0, 5).join(", "));
    for (const p of setup.container.absentAtStart) if (entries.some((e) => e === p || e.startsWith(p + "/"))) problems.push(p + " exists");
  } else {
    for (const p of under(STATE_ROOT)) if (PLAN_TUNE_FILES.test(p.split("/").pop()!)) problems.push("plan-tune state: " + p);
  }
  for (const p of entries) if (/\/\.capy\/drive(?:\/|$)|^\/drive(?:\/|$)/.test(p)) problems.push("a drive path is mounted: " + p);
  return problems;
}
