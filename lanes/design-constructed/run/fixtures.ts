// Copyright (c) 2026 Garry Tan. MIT License.
// Invented fixtures for the run area's detectors, hooks and session loop: exposed and unexposed plan-design-review
// transcripts written with the strings gstack b6155921 writes, autoplan run directories in memory, and a fake RunBox
// whose gstack binaries answer the way the pin's do. The dry run and the tests share them; nothing here is real data.
import { DETECTOR_PASS_NAMES } from "../frozen.ts";
import { HOME } from "./arms.ts";
import type { RunFiles } from "./detect.ts";
import type { AttemptRecord, ExecResult, RunBox } from "./types.ts";

type Rec = Record<string, unknown>;
export const say = (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
export const call = (id: string, name: string, input: Rec, result: string, error = false): Rec[] => [
  { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: error }] } },
];
export const tx = (...ms: unknown[]): string => ms.flat().map((m) => JSON.stringify(m)).join("\n") + "\n";
export const BLOCK = "```plan-changes\n" + JSON.stringify({ changes: ["Show an empty state on the orders screen with one action."] }) + "\n```";

export const PLAN_BEFORE = "# Orders screen\n\nWe will add an orders page.\n";
const STATE_TABLE = "  FEATURE    | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL\n  -----------|---------|-------|-------|---------|--------\n  orders     | skeleton| CTA   | retry | list    | banner\n";
const SUMMARY = "## Design Review Completion Summary\n\n| Pass 1  (Info Arch)  | 5/10 → 8/10 after fixes |\n| Pass 2  (States)     | 4/10 → 8/10 after fixes |\n";
export const PLAN_AFTER = PLAN_BEFORE + "\n" + STATE_TABLE + "\n" + SUMMARY;

/** A plan-design-review session that ran the procedure: the passes in order, the state table, the summary, a plan edit. */
export function pdrExposedTranscript(names: readonly string[] = DETECTOR_PASS_NAMES): string {
  return tx(
    call("t1", "Read", { file_path: HOME + "/.claude/skills/plan-design-review/sections/review-sections.md" }, "## Review Sections (7 passes)"),
    ...names.map((n, i) => say("### Pass " + (i + 1) + ": " + n + "\nRated 6/10.")),
    call("t2", "Write", { file_path: "/work/plan.md", content: PLAN_AFTER }, "File written"),
    say("Done.\n\n" + BLOCK),
  );
}

/** A plan-design-review session that exits on the skill's own "no UI scope" line. */
export const PDR_NO_UI_TRANSCRIPT = tx(say("This plan has no UI scope. A design review isn't applicable."), say(BLOCK));

/** An autoplan run directory, as the pin writes one, in memory. Overrides change one field each. */
export function autoplanRun(o: { lean?: boolean; ui?: boolean; nativeAttempts?: number; outsideAttempts?: number; reply?: string; by?: string; status?: string; exported?: boolean; validates?: boolean; bound?: string } = {}): RunFiles {
  const dir = HOME + "/.gstack/projects/demo/autoplan/run-1";
  const attempts = Array.from({ length: o.nativeAttempts ?? 1 }, (_, i) => ({ attempt: "run-1-a" + (i + 1), state: "submitted" }));
  const state: Rec = {
    status: o.status ?? "complete",
    plan_source: "/work/plan.md",
    lean: o.lean === false ? undefined : { kind: "feature", source: "flag" },
    scope: { ui: o.ui ?? true, dx: false, docs_only: false },
    max_rounds: 1,
    phases: {
      ceo: { skipped: "lean run: merged into the one eng reviewer (R65)", native: { status: "skipped" }, outside: { status: "skipped" } },
      eng: { native: { status: "completed", attempts, output: "eng-native.a1.bound.md" }, outside: { status: "not_run", attempts: Array.from({ length: o.outsideAttempts ?? 0 }, () => ({ state: "submitted" })) } },
    },
    gate: { reply: o.reply ?? "rec", answered_by: o.by ?? "agent:harness", words_by: o.by ?? "agent:harness", gate_rev: 1 },
    updated_at: "2026-11-14T00:00:00.000Z",
  };
  const files: Record<string, string> = {
    [dir + "/eng-native.a1.bound.md"]: o.bound ?? "INPUT: eng " + "a".repeat(64) + "\nDRAFT: none\n\nThe orders screen has no empty state.\n\n```gstack-findings\n{\"id\":\"F1\",\"severity\":\"High\",\"title\":\"No empty state\",\"fix\":\"Add one\"}\n```\n",
    ...(o.exported === false ? {} : { [dir + "/plan.md"]: PLAN_AFTER, [dir + "/review-record.md"]: "# Review record\n" }),
  };
  return { runs: () => [{ dir, state }], read: (p) => files[p] ?? null, validate: () => o.validates ?? true };
}

/** A fake RunBox: run directories in memory, and gstack binaries that answer the way the pin's do. */
export interface FakeRun {
  dir: string;
  status: string;
  gateRev: number;
  recRev?: number;
  recHash: string;
  maxRounds?: number;
  /** The render prints this hash (a stale render when it differs from recHash); null makes the render fail. */
  renderHash?: string | null;
  journalHash?: string;
  answerExit?: number;
}
export function fakeBox(runs: FakeRun[]): RunBox & { calls: string[][] } {
  const calls: string[][] = [];
  const box = {
    calls,
    runs: () => runs.map((r) => ({ dir: r.dir, state: { status: r.status, ...(r.maxRounds !== undefined ? { max_rounds: r.maxRounds } : {}) } as Rec })),
    read(path: string) {
      const r = runs.find((x) => path.startsWith(x.dir + "/"));
      if (!r) return null;
      if (path.endsWith("/gate.json")) return JSON.stringify({ gate_rev: r.gateRev, ...(r.recRev !== undefined ? { rec_rev: r.recRev } : {}) });
      if (path.endsWith("/attempts.jsonl")) return r.journalHash ? JSON.stringify({ event: "recommended", gate_rev: r.gateRev, rec_hash: r.journalHash }) + "\n" : "";
      return null;
    },
    gstack(bin: string, args: string[]): ExecResult {
      calls.push([bin, ...args]);
      const r = runs.find((x) => args.some((a) => a === x.dir || a.startsWith(x.dir + "/")))!;
      if (bin === "gstack-gate") {
        const h = r.renderHash === undefined ? r.recHash : r.renderHash;
        return h === null ? { code: 2, stdout: "", stderr: "render failed" } : { code: 0, stdout: "Reply binds to gate_rev=" + r.gateRev + " rec_hash=" + h + ". `rec` resolves to: {}\n", stderr: "" };
      }
      if (bin === "gstack-autoplan") {
        const hash = args.includes("--rec-hash") ? args[args.indexOf("--rec-hash") + 1] : undefined;
        if (r.answerExit) return { code: r.answerExit, stdout: "", stderr: "refused" };
        if ((r.recRev ?? 0) > 0 && hash !== r.recHash) return { code: 3, stdout: "", stderr: "GATE_REC_STALE" };
        if (hash !== undefined && hash !== r.recHash) return { code: 3, stdout: "", stderr: "GATE_REC_STALE" };
        r.status = "amend_pending";
        return { code: 0, stdout: "GSTACK_RESULT: skill=autoplan status=amend_pending\n", stderr: "" };
      }
      return { code: 0, stdout: "ARTIFACT_VALID: run=x status=complete\n", stderr: "" };
    },
  };
  return box;
}

/** An attempt record with every contamination flag off and a completed reply holding a block. */
export function attempt(o: Partial<AttemptRecord> = {}): AttemptRecord {
  return { end: { kind: "completed" }, reply: "Review.\n\n" + BLOCK, heldBlock: true, webResult: false, gstackRead: false, judged: false, autoplan: null, ...o };
}

/** The parser stand-in the dry run uses for the score area's parse: the last plan-changes fence with a changes array. */
export function parseFixture(reply: string) {
  const m = [...reply.matchAll(/```plan-changes\n([\s\S]*?)\n```/g)].at(-1);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]!);
    return Array.isArray(v.changes) ? { source: "none" as const, changes: v.changes.map(String) } : null;
  } catch {
    return null;
  }
}
