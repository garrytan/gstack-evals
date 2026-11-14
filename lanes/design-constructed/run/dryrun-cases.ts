// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's dry-run cases (build plan section 15 and the addendum): every row and precedence step of section 6,
// each retry sequence, the descriptive count, the C1 export and every C2 failure, each hook edge, each detector on
// its exposed and unexposed fixtures, the scope read and the arms. Each case runs the area's real functions on
// invented fixtures (real git for the export and C2, a fake RunBox for the hooks) and names its rule. The real-SDK
// checks (the hostile fixture both ways, both hooks through the driver) are in tests/dc/run/sdk.test.ts.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARM_LEAD, CELL_STATES, COMMON_LINE, FORCED_SENTENCE, GATE_MESSAGE, HARNESS, REFERENCE_OPENING, SESSION_LIMITS, TEMPLATE } from "../frozen.ts";
import { DcError } from "../errors.ts";
import type { CellState, DryRunCase, SessionKind } from "../types.ts";
import { armPrompt, containerProblems, HOME, sessionSetup } from "./arms.ts";
import { c2Problems, containPoint, keyStatementHits, runC2, sha256Hex } from "./contain.ts";
import { autoplanExposure, pdrExposure } from "./detect.ts";
import { EXPORT_COMMIT, exportUnit, git, stripReason, type ExportResult } from "./export.ts";
import { attempt, autoplanRun, BLOCK, fakeBox, parseFixture, PDR_NO_UI_TRANSCRIPT, pdrExposedTranscript, PLAN_AFTER, PLAN_BEFORE } from "./fixtures.ts";
import { answerArgs, D1_MESSAGE, gateHook, repairHook, repairOn, stopHandler } from "./hooks.ts";
import { MARK, writeHostile } from "./hostile.ts";
import { scopeOf, scopeShare } from "./scope.ts";
import { armStopsWithBlock, cellOrder, endOf, malformedToolCalls, packetReady, printMalformedToolCalls, readAttempt, runCell, runCells, cellId } from "./session.ts";
import { toolCallEnd } from "./stream.ts";
import type { AttemptRecord, Cell, CellOutcome, Exec, LoopSeams, Reconciled } from "./types.ts";

const eq = (a: unknown, b: unknown, what: string): string | null => (JSON.stringify(a) === JSON.stringify(b) ? null : what + ": expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
const all = (...checks: Array<string | null>): string | null => checks.find((c) => c !== null) ?? null;
const cell = (kind: SessionKind = "none", unit = "u1", pass = 1): Cell => ({ unit, kind, model: "opus", pass });
const own = { kind: "own-limit", limit: "turns" } as const;
const outside = { kind: "outside", reason: "UPSTREAM" } as const;

/** A loop run on scripted attempts; counts sessions per cell so a third session would show. */
async function scripted(kind: SessionKind, attempts: AttemptRecord[], rec: Reconciled = { ok: true, judged: false }): Promise<{ o: CellOutcome; sessions: number; reconciled: number }> {
  let sessions = 0;
  let reconciled = 0;
  const seams: LoopSeams = {
    session: async (_c, n) => {
      sessions++;
      if (n !== sessions) throw new Error("attempt numbers out of order");
      if (n > attempts.length) throw new Error("a session past the script");
      return attempts[n - 1]!;
    },
    reconcile: async () => (reconciled++, rec),
    parse: parseFixture,
  };
  return { o: await runCell(cell(kind), seams), sessions, reconciled };
}

const read = (kind: SessionKind, a: Partial<AttemptRecord>) => readAttempt(kind, attempt(a), parseFixture).state;

// ---- the export and containment fixtures (real git, invented files)

const EVIDENCE = [
  { path: "docs/research/notes.md", text: "# Research notes\n\nFour of six people looked for the export button below the fold, and two never found it.\n" },
  { path: "docs/support/summary.md", text: "# Support summary\n\nTickets about empty dashboards rose in March.\n" },
];
const KEY = Buffer.from(JSON.stringify({ items: [{ statement: "the orders screen must show an empty state when a new store has no orders yet" }] }));
const UNIT = Buffer.from(JSON.stringify({ id: "u1" }));

function commitAll(dir: string): string {
  git(dir, ["init", "-q", "--template="]);
  git(dir, ["add", "-A", "-f"]);
  const tree = git(dir, ["write-tree"]).stdout.trim();
  const c = git(dir, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: "tree " + tree + "\nauthor t <t@invalid> 1 +0000\ncommitter t <t@invalid> 1 +0000\n\nfixture\n" }).stdout.trim();
  git(dir, ["update-ref", "HEAD", c]);
  return c;
}

/** A clone's HEAD and HEAD^{tree}: the record the export intake checks. */
const recordOf = (dir: string) => ({ commit: git(dir, ["rev-parse", "HEAD"]).stdout.trim(), tree: git(dir, ["rev-parse", "HEAD^{tree}"]).stdout.trim() });

function baseApp(extra: Record<string, string> = {}): { dir: string; pin: string } {
  const dir = mkdtempSync(join(tmpdir(), "dc-dry-app-"));
  const files: Record<string, string> = {
    "package.json": "{\"name\":\"demo\",\"dependencies\":{\"react\":\"19.0.0\"}}\n",
    "src/components/Button.tsx": "export const Button = () => null;\n",
    ".gitignore": "dist/\n*.log\n",
    "dist/tracked.js": "// tracked though its .gitignore matches\n",
    "CLAUDE.md": "instructions\n",
    "pkg/AGENTS.md": "agents\n",
    ".cursor/rules.md": "rules\n",
    "skills/x/SKILL.md": "skill\n",
    ".mcp.json": "{}\n",
    ...extra,
  };
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), t);
  }
  symlinkSync("/etc", join(dir, "etc-link"));
  symlinkSync("../..", join(dir, "src", "up-link"));
  symlinkSync("src", join(dir, "inside-link"));
  return { dir, pin: commitAll(dir) };
}

const hostExec: Exec = (command) => {
  const r = spawnSync("sh", ["-c", command], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

let pristine: { work: string; ex: ExportResult; app: { dir: string; pin: string } } | null = null;

/** One clean exported unit in /work-like layout (work/repo, work/plan.md, work/context/project.md): a copy of one export made once per process. */
function exported(): { work: string; repo: string; ex: ExportResult; mounts: string[] } {
  if (!pristine) {
    const app = baseApp();
    const work = mkdtempSync(join(tmpdir(), "dc-dry-pristine-"));
    const ex = exportUnit({ source: { clone: app.dir }, expect: recordOf(app.dir), evidence: EVIDENCE, out: join(work, "repo") });
    writeFileSync(join(work, "plan.md"), PLAN_BEFORE);
    mkdirSync(join(work, "context"));
    writeFileSync(join(work, "context", "project.md"), "A demo store app.\n");
    pristine = { work, ex, app };
  }
  const work = mkdtempSync(join(tmpdir(), "dc-dry-work-"));
  cpSync(pristine.work, work, { recursive: true, verbatimSymlinks: true });
  const repo = join(work, "repo");
  return { work, repo, ex: { ...pristine.ex, repo }, mounts: [repo, join(work, "plan.md"), join(work, "context")] };
}
const expectOf = (ex: ExportResult) => ({ manifest: ex.manifest, expectedTree: ex.expectedTree, sealedSha256: [sha256Hex(KEY), sha256Hex(UNIT)] });

type Mutation = { name: string; change: (u: ReturnType<typeof exported>) => void; expected: RegExp };

/** C2 on a copy of the clean export after one change (the clean copy's own pass is its own case); passes when the problems
 *  name what the change broke. Every mutation runs on its own copy, all of them side by side the first time any is checked. */
function c2Batch(): (name: string, change: Mutation["change"], expected: RegExp) => () => Promise<string | null> {
  const mutations: Mutation[] = [];
  let mutationRuns: Promise<Map<string, string | null>> | null = null;
  return (name, change, expected) => {
    mutations.push({ name, change, expected });
    return async () => {
      mutationRuns ??= Promise.all(
        mutations.map(async (m) => {
          const u = exported();
          try {
            m.change(u);
            const p = await runC2(hostExecAsync, u.repo, u.mounts, expectOf(u.ex));
            return [m.name, p.some((x) => m.expected.test(x)) ? null : "C2 did not catch it: " + (p.join("; ") || "no problem found")] as const;
          } catch (e) {
            return [m.name, "threw: " + (e as Error).message] as const;
          } finally {
            rmSync(u.work, { recursive: true, force: true });
          }
        }),
      ).then((rows) => new Map(rows));
      const runs = await mutationRuns;
      return runs.has(name) ? runs.get(name)! : "no result";
    };
  };
}

/** The C2 script on this host without blocking, so the mutation cases' checks run side by side. */
const hostExecAsync: Exec = (command) =>
  new Promise((resolve) => {
    const p = spawn("sh", ["-c", command]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => err.push(d));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });

let failingApp: { dir: string; pin: string } | null = null;

/** An export of one base app holding every hiding file the evidence cases need; passes when it fails for the expected reason. */
function exportFails(evidence: typeof EVIDENCE, expected: RegExp): string | null {
  failingApp ??= baseApp({ "docs/.rgignore": "secret/\n", ".ignore": "research/\n", "docs/a.md": "a\n" });
  const app = failingApp;
  const out = join(mkdtempSync(join(tmpdir(), "dc-dry-out-")), "repo");
  try {
    exportUnit({ source: { clone: app.dir }, expect: recordOf(app.dir), evidence, out });
    return "the export passed";
  } catch (e) {
    return expected.test((e as Error).message) ? null : "the export failed for another reason: " + (e as Error).message;
  }
}

const g = (dir: string, args: string[], input?: string) => git(dir, args, input === undefined ? {} : { input }).stdout.trim();

export function cases(): DryRunCase[] {
  const c: DryRunCase[] = [];
  const add = (rule: string, name: string, check: DryRunCase["check"]) => c.push({ rule, name, check });
  const c2After = c2Batch();

  // ---- section 6: every row, each precedence step, every retry sequence

  add("S6", "a completed reply with a block scores", () => eq(read("none", {}), "scored", "state"));
  add("S6", "a completed reply with no block is no-block, 0, no retry", async () => {
    const r = await scripted("none", [attempt({ reply: "No block here.", heldBlock: false })]);
    return all(eq(r.o.state, "no-block", "state"), eq(r.sessions, 1, "sessions"), eq(CELL_STATES["no-block"].count, "zero", "count"));
  });
  add("S6", "a block that fails the parse is no-block", () => eq(read("none", { reply: "```plan-changes\n{not json\n```" }), "no-block", "state"));
  add("S6", "only the last block of a completed reply is read", () => {
    const r = readAttempt("none", attempt({ reply: BLOCK.replace("empty state", "first") + "\n\n" + BLOCK }), parseFixture);
    return eq(r.list?.changes, ["Show an empty state on the orders screen with one action."], "the scored list");
  });
  add("PD-6", "contamination first: a web result in a session that also hit its limit is missing with no retry", async () => {
    const r = await scripted("none", [attempt({ webResult: true, end: own })]);
    return all(eq(r.o.state, "web-contaminated", "state"), eq(r.sessions, 1, "sessions"), eq(CELL_STATES["web-contaminated"].count, "missing", "count"));
  });
  add("PD-6", "a gstack read in a none, lens or reference session is missing; in a gstack arm it is not contamination", () => all(eq(read("none", { gstackRead: true }), "gstack-read", "none"), eq(read("lens", { gstackRead: true }), "gstack-read", "lens"), eq(read("reference", { gstackRead: true }), "gstack-read", "reference"), eq(read("plan-design-review", { gstackRead: true }), "scored", "plan-design-review")));
  add("PD-6", "contamination outranks a cap stop", () => eq(read("lens", { gstackRead: true, end: { kind: "cap-stop" } }), "gstack-read", "state"));
  add("R2-22", "a cap stop reads incomplete whatever block it holds, and never retries", async () => {
    const r = await scripted("none", [attempt({ end: { kind: "cap-stop" } })]);
    return all(eq(r.o.state, "incomplete", "state"), eq(r.sessions, 1, "sessions"), eq(r.o.list, null, "list"));
  });
  add("R2-22", "a cap stop outranks the session's own limit", () => eq(read("none", { end: { kind: "cap-stop" }, heldBlock: true }), "incomplete", "state"));
  add("PD-6", "a block then an own-limit stop is an arm stop, retried in a fresh session", async () => {
    const r = await scripted("none", [attempt({ end: own, heldBlock: true }), attempt()]);
    return all(eq(r.o.attempts.map((a) => a.read.state), ["arm-stop", "scored"], "attempts"), eq(r.o.state, "scored", "final"), eq(r.reconciled, 1, "J1 before the retry"));
  });
  add("PD-6", "an own-limit stop after the D1 hook held the session is an arm stop", () => eq(read("plan-design-review", { end: { kind: "own-limit", limit: "timeout" }, heldBlock: true }), "arm-stop", "state"));
  add("PD-6", "each own limit is an arm stop: context, timeout, turns and dollars", () => all(...(["context", "timeout", "turns", "dollars"] as const).map((limit) => eq(read("none", { end: { kind: "own-limit", limit } }), "arm-stop", limit))));
  add("PD-6", "a block then a failure outside the agent is infra-missing with one J1 retry", async () => {
    const r = await scripted("none", [attempt({ end: outside, heldBlock: true }), attempt()]);
    return all(eq(r.o.attempts.map((a) => a.read.state), ["infra-missing", "scored"], "attempts"), eq(r.reconciled, 1, "J1"));
  });
  add("S6", "the autoplan row: a block but no gate answered reads scored and unexposed", () => eq(read("autoplan", { autoplan: { gateAnswered: false, approved: false } }), "scored-unexposed", "state"));
  add("S6", "the autoplan row: a gate answered but no APPROVED reads scored and unexposed", () => eq(read("autoplan", { autoplan: { gateAnswered: true, approved: false } }), "scored-unexposed", "state"));
  add("S6", "an autoplan run with the gate answered and APPROVED reads scored", () => eq(read("autoplan", { autoplan: { gateAnswered: true, approved: true } }), "scored", "state"));
  add("S6", "the reference follows the none arm's rows", () => all(eq(read("reference", {}), "scored", "scored"), eq(read("reference", { end: own }), "arm-stop", "arm stop")));
  add("S6", "retry: an arm stop whose retry stops again scores 0", async () => {
    const r = await scripted("none", [attempt({ end: own }), attempt({ end: own })]);
    return all(eq(r.o.state, "arm-stop", "state"), eq(CELL_STATES["arm-stop"].count, "zero", "count"), eq(r.sessions, 2, "sessions"));
  });
  add("S6", "retry: an arm stop whose retry fails outside the agent is missing", async () => eq((await scripted("none", [attempt({ end: own }), attempt({ end: outside })])).o.state, "infra-missing", "state"));
  add("S6", "retry: an arm stop whose retry has no block scores 0", async () => eq((await scripted("none", [attempt({ end: own }), attempt({ reply: "none" })])).o.state, "no-block", "state"));
  add("S6", "retry: a failure outside the agent whose retry fails again is missing", async () => eq((await scripted("none", [attempt({ end: outside }), attempt({ end: outside })])).o.state, "infra-missing", "state"));
  add("S6", "retry: a failure outside the agent whose retry hits its own limit scores 0", async () => eq((await scripted("none", [attempt({ end: outside }), attempt({ end: own })])).o.state, "arm-stop", "state"));
  add("S6", "no third session, whatever the second attempt does", async () => {
    const r = await scripted("none", [attempt({ end: own }), attempt({ end: own }), attempt()]);
    return all(eq(r.sessions, 2, "sessions"), eq(r.o.attempts.length, 2, "attempts"));
  });
  add("J1", "a first attempt any judge read is never retried", async () => {
    const r = await scripted("none", [attempt({ end: outside, judged: true }), attempt()]);
    return all(eq(r.sessions, 1, "sessions"), eq(r.o.state, "infra-missing", "state"));
  });
  add("J1", "reconciliation runs before any retry and a reconciled judged attempt is not retried", async () => {
    const r = await scripted("none", [attempt({ end: outside }), attempt()], { ok: true, judged: true });
    return all(eq(r.sessions, 1, "sessions"), eq(r.reconciled, 1, "reconciled"));
  });
  add("J1", "an attempt that can't be reconciled is missing, never retried", async () => {
    const r = await scripted("none", [attempt({ end: outside }), attempt()], { ok: false, why: "the proxy journal has no settle line" });
    return all(eq(r.sessions, 1, "sessions"), eq(r.o.state, "infra-missing", "state"));
  });
  add("S6", "a refusal, an empty reply or malformed output is a completed reply, and the frozen parse decides it", async () => {
    const ends = (["refusal", "empty_response", "malformed_output"] as const).map((f) => endOf({ kind: "arm_failure", failure: f }));
    const withBlock = await scripted("none", [attempt({ end: ends[0]! })]);
    const without = await scripted("none", [attempt({ end: ends[1]!, reply: "", heldBlock: false })]);
    return all(eq(ends.map((e) => e.kind), ["completed", "completed", "completed"], "ends"), eq([withBlock.o.state, withBlock.sessions], ["scored", 1], "with a block"), eq([without.o.state, without.sessions], ["no-block", 1], "with no block"));
  });
  add("S6", "a session the harness ended right after rejecting the model's tool call reads from its stream as a malformed tool call, then splits by errorSeen", async () => {
    const crash = { kind: "arm_failure", failure: "harness_crash" } as const;
    const say = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } };
    const rejected = (text: string) => ({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: text }] } });
    const result = (subtype: string) => ({ type: "result", subtype });
    const tx = (...m: unknown[]) => m.map((x) => JSON.stringify(x)).join("\n") + "\n";
    const invalid = "<tool_use_error>InputValidationError: Read failed: the required parameter file_path is missing</tool_use_error>";
    const read = [
      toolCallEnd(tx(say, rejected(invalid), result("error_during_execution")), crash),
      toolCallEnd(tx(say, rejected("<tool_use_error>Error: No such tool available: Raed</tool_use_error>"), result("error_during_execution")), crash),
      toolCallEnd(tx(say, rejected("<tool_use_error>File has not been read yet</tool_use_error>"), result("error_during_execution")), crash),
      toolCallEnd(tx(say, rejected(invalid), say, result("error_during_execution")), crash),
      toolCallEnd(tx(say, rejected(invalid), result("error_during_execution")), { kind: "missing", code: "UPSTREAM" }),
    ].map((t) => (t.kind === "arm_failure" ? t.failure : t.kind));
    const t = toolCallEnd(tx(say, rejected(invalid), result("error_during_execution")), crash);
    const err = await scripted("none", [attempt({ end: endOf(t, true) }), attempt({ end: endOf(t, true) })]);
    const own = await scripted("none", [attempt({ end: endOf(t, false) }), attempt({ end: endOf(t, false) })]);
    return all(
      eq(read, ["malformed_tool_call", "malformed_tool_call", "harness_crash", "harness_crash", "missing"], "stream reads"),
      eq([err.o.state, err.sessions, err.o.attempts[0]!.read.state, own.o.state, own.sessions], ["infra-missing", 2, "infra-missing", "arm-stop", 2], "PD-17 split"),
    );
  });
  add("S6", "a malformed tool call decides by mechanism: after an API, provider or harness error it is outside the agent, else an arm stop", async () => {
    const t = { kind: "arm_failure", failure: "malformed_tool_call" } as const;
    const err = await scripted("none", [attempt({ end: endOf(t, true) }), attempt({ end: endOf(t, true) })]);
    const own2 = await scripted("lens", [attempt({ end: endOf(t) }), attempt({ end: endOf(t) })]);
    const printed = printMalformedToolCalls([err.o, own2.o]);
    return all(
      eq([err.o.state, err.sessions, own2.o.state, own2.sessions], ["infra-missing", 2, "arm-stop", 2], "states"),
      eq(malformedToolCalls([err.o, own2.o]), [{ kind: "lens", model: "opus", armStop: 2, outside: 0 }, { kind: "none", model: "opus", armStop: 0, outside: 2 }], "counts"),
      eq(printed, ["malformed tool calls: lens on opus 2 read as arm stops, 0 as outside the agent", "malformed tool calls: none on opus 0 read as arm stops, 2 as outside the agent"], "print"),
    );
  });
  add("S6", "the driver's terminations map to their ends", () =>
    eq(
      [{ kind: "completed" }, { kind: "timeout" }, { kind: "turn_cap" }, { kind: "allowance_stop" }, { kind: "cap_stop" }, { kind: "arm_failure", failure: "context_overflow" }, { kind: "arm_failure", failure: "harness_crash" }, { kind: "missing", code: "E_ALLOWANCE" }, { kind: "infra", incident: "x" }, { kind: "unknown", reservation_id: "r" }, { kind: "credentials_rejected" }].map((t) => endOf(t as never).kind),
      ["completed", "own-limit", "own-limit", "own-limit", "cap-stop", "own-limit", "outside", "outside", "outside", "outside", "outside"],
      "ends",
    ),
  );
  add("S6", "the classifier's retries match CELL_STATES for every state it returns", async () => {
    const rows: Array<[Partial<AttemptRecord>, CellState]> = [[{}, "scored"], [{ reply: "x" }, "no-block"], [{ end: own }, "arm-stop"], [{ end: outside }, "infra-missing"], [{ webResult: true }, "web-contaminated"], [{ gstackRead: true }, "gstack-read"], [{ end: { kind: "cap-stop" } }, "incomplete"]];
    for (const [a, state] of rows) {
      const r = await scripted("none", [attempt(a), attempt()]);
      const retried = CELL_STATES[state].retry === "fresh-session" || CELL_STATES[state].retry === "j1";
      const bad = eq([r.o.attempts[0]!.read.state, r.sessions], [state, retried ? 2 : 1], state);
      if (bad) return bad;
    }
    return null;
  });
  add("S6", "the descriptive count: arm stops whose attempt held a block, per arm and model", async () => {
    const outs = [(await scripted("none", [attempt({ end: own, heldBlock: true }), attempt({ end: own, heldBlock: true })])).o, (await scripted("lens", [attempt({ end: own, heldBlock: false }), attempt()])).o];
    return eq(armStopsWithBlock(outs), [{ kind: "none", model: "opus", attempts: 2 }], "count");
  });
  add("S6", "a label packet waits until every cell in it is final", () => {
    const planned = [cell("none", "u1", 1), cell("lens", "u1", 1)];
    const outs = new Map<string, CellOutcome>([[cellId(planned[0]!), { cell: planned[0]!, state: "scored", list: null, attempts: [], why: "" }]]);
    const before = packetReady(planned, outs);
    outs.set(cellId(planned[1]!), { cell: planned[1]!, state: "scored", list: null, attempts: [], why: "" });
    return eq([before, packetReady(planned, outs)], [false, true], "ready");
  });
  add("S10", "at most 8 sessions at once, and a limit above 8 is refused", async () => {
    let live = 0;
    let peak = 0;
    const seams: LoopSeams = { session: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--; return attempt(); }, reconcile: async () => ({ ok: true, judged: false }), parse: parseFixture };
    const cells = Array.from({ length: 30 }, (_, i) => cell(i % 2 ? "none" : "lens", "u" + (i % 3), i));
    await runCells(cells, seams);
    let refused = false;
    try {
      await runCells(cells, seams, 9);
    } catch {
      refused = true;
    }
    return all(peak <= HARNESS.maxSessionsAtOnce && peak > 1 ? null : "peak " + peak, refused ? null : "a limit of 9 ran");
  });
  add("S10", "each unit's cells run in a seeded order, the same on every run, units in the order given", () => {
    const cells = (["none", "lens", "plan-design-review", "autoplan"] as const).flatMap((k) => [1, 2, 3].flatMap((p) => [cell(k, "u2", p), cell(k, "u1", p)]));
    const a = cellOrder(cells).map(cellId);
    const b = cellOrder([...cells].reverse()).map(cellId);
    const u1 = a.filter((x) => x.startsWith("u1:"));
    const grouped = a.slice(0, 12).every((x) => x.startsWith("u2:")) && a.slice(12).every((x) => x.startsWith("u1:"));
    const sorted = [...u1].sort();
    return all(grouped ? null : "units interleave", eq(u1, b.filter((x) => x.startsWith("u1:")), "the order moved with the input order"), JSON.stringify(u1) !== JSON.stringify(sorted) ? null : "the order is not shuffled");
  });

  // ---- C1: the export

  add("C1", "the export strips every instruction file, folder and outside symlink and keeps the rest", () => {
    const u = exported();
    const removed = u.ex.manifest.removed.map((r) => r.path).sort();
    const kept = g(u.repo, ["ls-files"]).split("\n");
    return all(eq(removed, [".cursor/rules.md", ".mcp.json", "CLAUDE.md", "etc-link", "pkg/AGENTS.md", "skills/x/SKILL.md", "src/up-link"], "removed"), kept.includes("inside-link") ? null : "an in-tree symlink was removed");
  });
  add("C1", "a file the upstream tracked but its own .gitignore matches stays in the export", () => {
    const u = exported();
    return g(u.repo, ["ls-files"]).split("\n").includes("dist/tracked.js") ? null : "dist/tracked.js left the export";
  });
  add("C1", "an entry named .claude goes whatever its type, a symlink inside the tree included", () => eq([stripReason("app/.claude", "120000", "../shadow") !== null, stripReason("a/CLAUDE.local.md", "100644", null) !== null, stripReason(".claude/AGENTS.md", "100644", null) !== null, stripReason("docs/readme.md", "100644", null)], [true, true, true, null], "reasons"));
  add("C1", "an evidence path the tree's .gitignore matches fails the export", () => exportFails([{ path: "docs/notes.log", text: "x\n" }], /check-ignore/));
  add("C1", "an evidence path an .rgignore hides fails the export", () => exportFails([{ path: "docs/secret/notes.md", text: "x\n" }], /rgignore/));
  add("C1", "an evidence path an .ignore hides fails the export", () => exportFails([{ path: "research/notes.md", text: "x\n" }], /\.ignore/));
  add("C1", "an evidence path the base app already has, or one the strip would remove, fails the export", () => all(exportFails([{ path: "docs/a.md", text: "x\n" }], /already has/), exportFails([{ path: "docs/AGENTS.md", text: "x\n" }], /strip/)));
  add("C1", "fixed metadata: two exports of one unit give one commit id, and its tree equals the expected tree", () => {
    const a = exported().ex;
    const app = pristine!.app;
    const b = exportUnit({ source: { clone: app.dir }, expect: recordOf(app.dir), evidence: [...EVIDENCE].reverse(), out: join(mkdtempSync(join(tmpdir(), "dc-dry-")), "r") });
    const meta = g(a.repo, ["cat-file", "commit", "HEAD"]);
    return all(eq(a.manifest.commit, b.manifest.commit, "commit"), eq(a.manifest.tree, a.expectedTree, "tree"), meta.includes("author " + EXPORT_COMMIT.name + " <" + EXPORT_COMMIT.email + "> " + EXPORT_COMMIT.time) ? null : "metadata moved");
  });
  add("R2-15", "the fresh repository holds exactly the objects git rev-list --objects lists", () => {
    const u = exported();
    const stored = g(u.repo, ["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"]).split("\n").sort();
    const listed = g(u.repo, ["rev-list", "--objects", "--all", "--no-object-names"]).split("\n").sort();
    return eq(stored, listed, "objects");
  });
  add("C1", "the intake reads a kept bundle as it reads the clone, and drops a base app whose HEAD or tree is not the record or whose commit can't be fetched", () => {
    const app = baseApp();
    const rec = recordOf(app.dir);
    const root = mkdtempSync(join(tmpdir(), "dc-dry-intake-"));
    const bundle = join(root, "app.bundle");
    git(app.dir, ["bundle", "create", "-q", bundle, "HEAD"]);
    let n = 0;
    const run = (source: { clone: string } | { bundle: string }, expect = rec): string => {
      try {
        return exportUnit({ source, expect, evidence: EVIDENCE, out: join(root, "out" + n++) }).manifest.commit;
      } catch (e) {
        return (e instanceof DcError ? e.code : "?") + " " + (e as Error).message;
      }
    };
    const child = git(app.dir, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: "tree " + rec.tree + "\nparent " + rec.commit + "\nauthor t <t@invalid> 2 +0000\ncommitter t <t@invalid> 2 +0000\n\nnext\n" }).stdout.trim();
    git(app.dir, ["update-ref", "refs/heads/next", child]);
    const thin = join(root, "thin.bundle");
    git(app.dir, ["bundle", "create", "-q", thin, "refs/heads/next", "^" + rec.commit]);
    const gone = baseApp();
    const goneHead = recordOf(gone.dir);
    rmSync(join(gone.dir, ".git", "objects", goneHead.commit.slice(0, 2), goneHead.commit.slice(2)));
    const dropped = (r: string, why: RegExp, what: string) => (r.startsWith("E_BASE_APP_DROPPED ") && why.test(r) ? null : what + ": " + r);
    return all(
      eq(run({ bundle }), run({ clone: app.dir }), "bundle and clone export one commit"),
      dropped(run({ clone: app.dir }, { commit: child, tree: rec.tree }), /HEAD is [0-9a-f]+, not the recorded commit/, "HEAD mismatch"),
      dropped(run({ bundle }, { commit: rec.commit, tree: "1".repeat(40) }), /not the recorded tree/, "tree mismatch"),
      dropped(run({ bundle: thin }, { commit: child, tree: rec.tree }), /bundle verify failed/, "bundle with a missing prerequisite"),
      dropped(run({ clone: gone.dir }, goneHead), /can no longer be read/, "clone whose commit object is gone"),
      dropped(run({ bundle: join(root, "missing.bundle") }), /does not exist/, "missing bundle"),
    );
  });
  add("C1", "an export into a folder that exists is refused", () => {
    const app = baseApp();
    try {
      exportUnit({ source: { clone: app.dir }, expect: recordOf(app.dir), evidence: EVIDENCE, out: app.dir });
      return "it wrote into an existing folder";
    } catch (e) {
      return /exists already/.test((e as Error).message) ? null : (e as Error).message;
    }
  });

  // ---- C2: every failure in section 15 and the addendum

  add("C2", "a clean export passes C2 on the host and on a container's own copy of the mount", async () => {
    const u = exported();
    const box = mkdtempSync(join(tmpdir(), "dc-dry-box-"));
    cpSync(u.work, box, { recursive: true, verbatimSymlinks: true });
    const [host, inBox] = await Promise.all([runC2(hostExecAsync, u.repo, u.mounts, expectOf(u.ex)), runC2(hostExecAsync, join(box, "repo"), [join(box, "repo"), join(box, "plan.md"), join(box, "context")], expectOf(u.ex))]);
    return all(eq(host, [], "host"), eq(inBox, [], "container copy"));
  });
  add("C2", "a second commit fails", c2After("a second commit fails", (u) => {
    const tree = g(u.repo, ["rev-parse", "HEAD^{tree}"]);
    const c = g(u.repo, ["hash-object", "-t", "commit", "-w", "--stdin"], "tree " + tree + "\nparent " + u.ex.manifest.commit + "\nauthor a <a@invalid> 2 +0000\ncommitter a <a@invalid> 2 +0000\n\nlater\n");
    g(u.repo, ["update-ref", "refs/heads/main", c]);
  }, /^commits:/));
  add("C2", "a remote fails", c2After("a remote fails", (u) => g(u.repo, ["remote", "add", "origin", "https://example.invalid/demo.git"]), /remote/));
  add("C2", "a tag fails", c2After("a tag fails", (u) => g(u.repo, ["update-ref", "refs/tags/v1", u.ex.manifest.commit]), /^refs:/));
  add("C2", "an unreachable object fails", c2After("an unreachable object fails", (u) => g(u.repo, ["hash-object", "-w", "--stdin"], "orphan blob from later history\n"), /^objects:|git fsck/));
  add("C2", "an extra file fails", c2After("an extra file fails", (u) => writeFileSync(join(u.repo, "src", "extra.ts"), "x\n"), /status|digest/));
  add("C2", "a missing file fails", c2After("a missing file fails", (u) => rmSync(join(u.repo, "src", "components", "Button.tsx")), /status|digest/));
  add("C2", "a mount holding key.json's bytes under another name fails", c2After("a mount holding key.json's bytes under another name fails", (u) => writeFileSync(join(u.work, "context", "notes.txt"), KEY), /bytes of a sealed file/));
  add("C2", "a mount holding a file named unit.json fails", c2After("a mount holding a file named unit.json fails", (u) => writeFileSync(join(u.repo, "docs", "unit.json"), "{}\n"), /sealed file name/));
  add("R2-15", "objects/info/alternates fails", c2After("objects/info/alternates fails", (u) => writeFileSync(join(u.repo, ".git", "objects", "info", "alternates"), "/tmp/objects\n"), /alternates/));
  add("R2-15", "a shallow file fails", c2After("a shallow file fails", (u) => writeFileSync(join(u.repo, ".git", "shallow"), u.ex.manifest.commit + "\n"), /shallow/));
  add("R2-15", "info/grafts fails", c2After("info/grafts fails", (u) => (mkdirSync(join(u.repo, ".git", "info"), { recursive: true }), writeFileSync(join(u.repo, ".git", "info", "grafts"), u.ex.manifest.commit + "\n")), /grafts/));
  add("R2-15", "refs/replace fails", c2After("refs/replace fails", (u) => g(u.repo, ["update-ref", "refs/replace/" + u.ex.manifest.commit, u.ex.manifest.commit]), /replace|exited/));
  add("C2", "a stash fails", c2After("a stash fails", (u) => g(u.repo, ["update-ref", "refs/stash", u.ex.manifest.commit]), /stash|^refs:/));
  add("C2", "a hook fails", c2After("a hook fails", (u) => (mkdirSync(join(u.repo, ".git", "hooks"), { recursive: true }), writeFileSync(join(u.repo, ".git", "hooks", "post-checkout"), "#!/bin/sh\n")), /hooks/));
  add("C2", "a reflog beyond the commit fails", c2After("a reflog beyond the commit fails", (u) => appendFileSync(join(u.repo, ".git", "logs", "HEAD"), u.ex.manifest.commit + " " + "1".repeat(40) + " a <a@invalid> 2 +0000\tlater\n"), /reflog/));
  add("C2", "a container copy that differs from the export fails its own C2", async () => {
    const u = exported();
    const box = mkdtempSync(join(tmpdir(), "dc-dry-box-"));
    cpSync(u.work, box, { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(box, "repo", "docs", "research", "notes.md"), "changed\n");
    const p = await runC2(hostExec, join(box, "repo"), [join(box, "repo")], expectOf(u.ex));
    return p.some((x) => /digest|status/.test(x)) ? null : "the differing copy passed: " + p.join("; ");
  });
  add("C2", "C2 after the gstack install: an install into HOME passes, an install that writes into the repository fails", async () => {
    const u = exported();
    const v = exported();
    const home = mkdtempSync(join(tmpdir(), "dc-dry-home-"));
    mkdirSync(join(home, ".claude", "skills", "plan-design-review"), { recursive: true });
    mkdirSync(join(v.repo, ".claude", "skills", "autoplan"), { recursive: true });
    writeFileSync(join(v.repo, ".claude", "skills", "autoplan", "SKILL.md"), "x\n");
    const [ok, bad] = await Promise.all([runC2(hostExecAsync, u.repo, u.mounts, expectOf(u.ex)), runC2(hostExecAsync, v.repo, v.mounts, expectOf(v.ex))]);
    return all(eq(ok, [], "after an install into HOME"), bad.length ? null : "an install into the repository passed");
  });
  add("C2", "the check fails closed on a cut output, a missing section and a non-zero exit", async () => {
    const u = exported();
    const full = hostExec((await import("./contain.ts")).c2Script(u.repo, u.mounts)) as { stdout: string };
    const cut = c2Problems(full.stdout.slice(0, full.stdout.indexOf("@@digest")), expectOf(u.ex));
    const missing = c2Problems(full.stdout.replace(/@@hooks\n[\s\S]*?@@exit hooks 0\n/, ""), expectOf(u.ex));
    const exit = await runC2(() => ({ code: 125, stdout: "", stderr: "docker exec failed" }), u.repo, u.mounts, expectOf(u.ex));
    return all(cut.length ? null : "a cut output passed", missing.some((m) => /hooks is missing/.test(m)) ? null : "a missing section passed", exit.length ? null : "a failed exec passed");
  });
  add("C2", "one re-export, then a drop before seal and a hold after it", async () => {
    let exports = 0;
    const failing = async () => ["a remote is configured"];
    const dropped = await containPoint("seal", failing, async () => void exports++);
    const held = await containPoint("before-session", failing, async () => void exports++);
    let n = 0;
    const recovered = await containPoint("after-install", async () => (n++ ? [] : ["a tag"]), async () => void exports++);
    return eq([dropped.status, dropped.exports, held.status, recovered.status, recovered.exports, exports], ["dropped", 1, "held", "ok", 1, 3], "outcomes");
  });
  add("C2", "the key-statement print finds 8 consecutive normalized words and not 7", () => {
    const st = ["The orders screen must show an empty state when a new store has no orders yet"];
    const eight = keyStatementHits(st, [{ path: "docs/a.md", text: "Notes: an EMPTY state, when a new store has no orders." }]);
    const seven = keyStatementHits(st, [{ path: "docs/b.md", text: "an empty state when a new store" }]);
    return eq([eight.map((h) => h.path), seven.length], [["docs/a.md"], 0], "hits");
  });
  add("C2", "key.json and unit.json are mounted nowhere in a clean unit", async () => {
    const u = exported();
    const p = await runC2(hostExec, u.repo, u.mounts, expectOf(u.ex));
    return eq(p.filter((x) => /sealed/.test(x)), [], "sealed hits");
  });

  // ---- C3 and the arms

  add("C3", "each arm's prompt is its lead, the common line, a blank line and the template", () =>
    all(
      eq(armPrompt("none"), COMMON_LINE + "\n\n" + TEMPLATE, "none"),
      eq(armPrompt("lens"), ARM_LEAD.lens + "\n" + COMMON_LINE + "\n\n" + TEMPLATE, "lens"),
      eq(armPrompt("plan-design-review"), ARM_LEAD["plan-design-review"] + "\n" + FORCED_SENTENCE + "\n" + COMMON_LINE + "\n\n" + TEMPLATE, "plan-design-review"),
      eq(armPrompt("autoplan"), ARM_LEAD.autoplan + "\n" + FORCED_SENTENCE + "\n" + COMMON_LINE + "\n\n" + TEMPLATE, "autoplan"),
    ),
  );
  add("C3", "the reference copies each evidence file under its path in path order, then the common line and template", () => {
    const p = armPrompt("reference", [{ path: "docs/b.md", text: "B ``` fence\n" }, { path: "docs/a.md", text: "A\n" }]);
    return all(p.startsWith(REFERENCE_OPENING + "\ndocs/a.md\n```\nA\n```\n\ndocs/b.md\n````\nB ``` fence\n````\n" + COMMON_LINE) ? null : "layout: " + JSON.stringify(p.slice(0, 160)), p.endsWith("\n\n" + TEMPLATE) ? null : "the template");
  });
  add("C3", "every session disables bundled skills and the 1M context and denies the web tools; only gstack arms run unattended", () => {
    const kinds: SessionKind[] = ["none", "lens", "plan-design-review", "autoplan", "reference"];
    const ev = [{ path: "docs/a.md", text: "a" }];
    return all(...kinds.map((k) => {
      const s = sessionSetup(k, "sol", k === "reference" ? ev : []);
      const gstack = k === "plan-design-review" || k === "autoplan";
      return eq([s.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS, s.env.CLAUDE_CODE_DISABLE_1M_CONTEXT, s.env.GSTACK_SESSION_KIND ?? null, s.deniedTools, s.limits, s.container.gstack !== null, s.planTune], ["1", "1", gstack ? "unattended" : null, ["WebSearch", "WebFetch"], SESSION_LIMITS.sol, gstack, gstack ? "empty" : null], k);
    }));
  });
  add("C3", "a clean container has an empty HOME, no skills folder, no gstack state root and no drive mount", () => {
    const none = sessionSetup("none", "opus");
    const pdr = sessionSetup("plan-design-review", "opus");
    return eq([containerProblems(none, ["/work/repo/a"]).length, containerProblems(none, [HOME + "/.claude/skills/x/SKILL.md"]).length > 0, containerProblems(none, ["/root/.capy/drive/x"]).length > 0, containerProblems(pdr, [HOME + "/.claude/skills/autoplan/SKILL.md"]).length, containerProblems(pdr, [HOME + "/.gstack/projects/demo/question-preferences.json"]).length > 0], [0, true, true, 0, true], "problems");
  });
  add("C3", "key.json and unit.json are never mounted: the mounts are the three frozen paths", () => eq(sessionSetup("lens", "opus").container.mounts, ["/work/repo", "/work/plan.md", "/work/context/"], "mounts"));
  add("C3", "the hostile fixture's every planted instruction file leaves the export", () => {
    const root = mkdtempSync(join(tmpdir(), "dc-dry-hostile-"));
    const repo = join(root, "src");
    mkdirSync(repo);
    writeHostile(repo, join(root, "fired.log"));
    commitAll(repo);
    const ex = exportUnit({ source: { clone: repo }, expect: recordOf(repo), evidence: EVIDENCE, out: join(root, "export") });
    const text = spawnSync("grep", ["-rl", "HOSTILE-", join(root, "export"), "--exclude-dir=.git"], { encoding: "utf8" }).stdout.trim();
    const kept = text.split("\n").map((f) => f.slice(join(root, "export").length + 1)).sort();
    return all(eq(kept, ["docs/imported.md", "shadow/rules/link.md", "shadow/settings.json"], "ordinary content that keeps a marker (an import target, a symlink's target folder)"), eq(ex.manifest.removed.map((r) => r.path).sort(), [".claude/AGENTS.md", ".claude/CLAUDE.md", ".claude/rules/hostile.md", ".claude/settings.json", ".claude/skills/hostile/SKILL.md", "AGENTS.md", "CLAUDE.local.md", "CLAUDE.md", "app/.claude", "etc-link", "lib/AGENTS.md", "pkg/sub/CLAUDE.md", "up-link"], "removed"), Object.keys(MARK).length === 13 ? null : "markers");
  });

  // ---- the hooks

  const run1 = (o: Partial<Parameters<typeof fakeBox>[0][number]> = {}) => ({ dir: HOME + "/.gstack/projects/demo/autoplan/run-1", status: "gate_pending", gateRev: 1, recRev: 0, recHash: "aaaaaaaaaaaa", ...o });
  add("R2-6", "the gate hook answers with the frozen answer and every flag the pin needs, then returns the fixed message", () => {
    const box = fakeBox([run1()]);
    const h = gateHook({ box, sinceMs: 0 });
    const m = h.onStop();
    const answer = box.calls.find((x) => x[0] === "gstack-autoplan")!;
    return all(eq(m, GATE_MESSAGE, "message"), eq(answer.slice(1), answerArgs(run1().dir, 1, "aaaaaaaaaaaa"), "argv"), eq(answer.slice(1), ["answer", "--out", run1().dir, "--gate-rev", "1", "--reply", "rec", "--by", "agent:harness", "--owner-reply", "rec", "--words-by", "agent:harness", "--rec-hash", "aaaaaaaaaaaa"], "flags"));
  });
  add("R2-6", "a second gate revision is answered and messaged again; a stop with no new revision answers nothing", () => {
    const r = run1({ maxRounds: 2 });
    const box = fakeBox([r]);
    const h = gateHook({ box, sinceMs: 0 });
    const first = h.onStop();
    const again = h.onStop();
    r.status = "gate_pending";
    r.gateRev = 2;
    const second = h.onStop();
    return eq([first, again, second, h.answered().map((a) => a.gateRev), h.messages()], [GATE_MESSAGE, null, GATE_MESSAGE, [1, 2], 2], "answers");
  });
  add("R2-6", "every gate revision is answered, past the run's max_rounds", () => {
    const r = run1({ maxRounds: 1 });
    const h = gateHook({ box: fakeBox([r]), sinceMs: 0 });
    const first = h.onStop();
    r.status = "gate_pending";
    r.gateRev = 2;
    const second = h.onStop();
    r.status = "gate_pending";
    r.gateRev = 3;
    const third = h.onStop();
    return eq([first, second, third, h.answered().map((a) => a.gateRev), h.messages()], [GATE_MESSAGE, GATE_MESSAGE, GATE_MESSAGE, [1, 2, 3], 3], "answers");
  });
  add("R2-6", "an answer the pin refuses is recorded once, sends no message and doesn't block the stop", () => {
    const r = run1({ answerExit: 4 });
    const logs: string[] = [];
    const box = fakeBox([r]);
    const h = gateHook({ box, sinceMs: 0, log: (l) => logs.push(l) });
    const first = h.onStop();
    const again = h.onStop();
    const tries = box.calls.filter((c) => c[0] === "gstack-autoplan").length;
    return all(eq([first, again, h.refused(), h.answered(), h.messages(), tries], [null, null, [{ dir: r.dir, gateRev: 1, code: 4 }], [], 0, 1], "refusal"), logs.some((l) => /the pin refused the answer at gate_rev 1 \(exit 4\)/.test(l)) ? null : "no print");
  });
  add("R2-11", "two run directories at gate_pending are each answered, with the count printed and one message", () => {
    const logs: string[] = [];
    const h = gateHook({ box: fakeBox([run1(), run1({ dir: "/work/.gstack/run-2", recHash: "bbbbbbbbbbbb" })]), sinceMs: 0, log: (l) => logs.push(l) });
    return all(eq(h.onStop(), GATE_MESSAGE, "message"), eq(h.answered().length, 2, "answered"), logs.some((l) => /^gate hook: 2 run directories/.test(l)) ? null : "no count");
  });
  add("S10", "no run directory, or none at gate_pending, answers nothing and prints", () => {
    const logs: string[] = [];
    const empty = gateHook({ box: fakeBox([]), sinceMs: 0, log: (l) => logs.push(l) });
    const busy = gateHook({ box: fakeBox([run1({ status: "awaiting_result" })]), sinceMs: 0, log: (l) => logs.push(l) });
    return all(eq([empty.onStop(), busy.onStop()], [null, null], "answers"), eq(logs.length, 2, "prints"));
  });
  add("R2-14", "with rec_rev above 0 the hash comes from the pinned render, never gate.json", () => {
    const box = fakeBox([run1({ recRev: 1, recHash: "cccccccccccc" })]);
    const h = gateHook({ box, sinceMs: 0 });
    return all(eq(h.onStop(), GATE_MESSAGE, "message"), box.calls.some((x) => x[0] === "gstack-gate" && x[1] === "render") ? null : "no render");
  });
  add("R2-14", "when the render fails, the hash comes from the last recommended journal row for that gate_rev", () => {
    const h = gateHook({ box: fakeBox([run1({ recRev: 1, recHash: "dddddddddddd", renderHash: null, journalHash: "dddddddddddd" })]), sinceMs: 0 });
    return eq(h.onStop(), GATE_MESSAGE, "message");
  });
  add("R2-14", "with no hash from the render or the journal, nothing is answered", () => {
    const logs: string[] = [];
    const box = fakeBox([run1({ recRev: 1, renderHash: null })]);
    const h = gateHook({ box, sinceMs: 0, log: (l) => logs.push(l) });
    return all(eq(h.onStop(), null, "message"), box.calls.some((x) => x[0] === "gstack-autoplan") ? "it answered" : null, logs.some((l) => /no rec hash/.test(l)) ? null : "no print");
  });
  add("S10", "a refused answer returns no message", () => eq(gateHook({ box: fakeBox([run1({ answerExit: 3 })]), sinceMs: 0 }).onStop(), null, "message"));
  add("R2-6", "a gate-hook block takes the Stop turn before the D1 hook", () => {
    const repair = repairHook({ kind: "autoplan", detect: () => ({ exposed: false, missing: ["x"] }), parse: parseFixture, reply: () => "" });
    const handler = stopHandler({ kind: "autoplan", gate: gateHook({ box: fakeBox([run1()]), sinceMs: 0 }), repair })!;
    const first = handler("");
    const before = repair.blocks();
    const second = handler("");
    return eq([first, before, second?.startsWith("Do not stop yet."), repair.blocks()], [GATE_MESSAGE, 0, true, 1], "turns");
  });
  add("D1", "the D1 hook is off by default and on only for a gstack arm after smoke rule 1 or 2 failed", () => eq([repairOn("plan-design-review", null), repairOn("autoplan", 2), repairOn("plan-design-review", 1), repairOn("none", 1), repairOn("lens", 2), repairOn("reference", 1), stopHandler({ kind: "plan-design-review", gate: null, repair: null })], [false, true, true, false, false, false, null], "on"));
  add("D1", "the D1 hook never runs in none, lens or reference", () => {
    const refused = (["none", "lens", "reference"] as const).map((kind) => {
      try {
        repairHook({ kind, detect: () => ({ exposed: false, missing: [] }), parse: parseFixture, reply: () => "" });
        return false;
      } catch {
        return true;
      }
    });
    return eq(refused, [true, true, true], "refused");
  });
  add("D1", "the D1 hook blocks at most twice with one fixed message naming the missing outputs, then releases", () => {
    const h = repairHook({ kind: "plan-design-review", detect: (t) => pdrExposure({ transcript: t, planBefore: PLAN_BEFORE, planAfter: PLAN_BEFORE }), parse: parseFixture, reply: () => "no block" });
    const a = h.onStop("");
    const b = h.onStop("");
    const c = h.onStop("");
    return all(eq([a === b, c, h.blocks()], [true, null, 2], "blocks"), a?.startsWith(D1_MESSAGE.split("{missing}")[0]!) && a.includes("a plan-changes block that parses") && a.includes("interaction state table") ? null : "message: " + a);
  });
  add("D1", "the D1 hook lets an exposed session with a parsable block stop at once", () => {
    const t = pdrExposedTranscript();
    const h = repairHook({ kind: "plan-design-review", detect: (x) => pdrExposure({ transcript: x, planBefore: PLAN_BEFORE, planAfter: PLAN_AFTER }), parse: parseFixture, reply: () => BLOCK });
    return eq([h.onStop(t), h.blocks()], [null, 0], "release");
  });

  // ---- the detectors on their exposed and unexposed fixtures

  add("S10", "plan-design-review exposed: five or more pass names in order, the state table, the summary and a plan edit", () => {
    const r = pdrExposure({ transcript: pdrExposedTranscript(), planBefore: PLAN_BEFORE, planAfter: PLAN_AFTER });
    return eq([r.exposed, r.passNames, r.loaded, r.missing], [true, 7, true, []], "reading");
  });
  add("S10", "plan-design-review unexposed: four pass names, names out of order, no state table, the plan unchanged", () => {
    const four = pdrExposure({ transcript: pdrExposedTranscript(["Information Architecture", "Interaction State Coverage", "User Journey", "AI Slop Risk"]), planBefore: PLAN_BEFORE, planAfter: PLAN_AFTER });
    const reversed = pdrExposure({ transcript: pdrExposedTranscript(["Unresolved Design Decisions", "Responsive & Accessibility", "Design System Alignment", "AI Slop Risk", "User Journey", "Interaction State Coverage", "Information Architecture"]), planBefore: PLAN_BEFORE, planAfter: PLAN_AFTER });
    const unchanged = pdrExposure({ transcript: pdrExposedTranscript(), planBefore: PLAN_AFTER, planAfter: PLAN_AFTER });
    const noTable = pdrExposure({ transcript: pdrExposedTranscript().replaceAll("PARTIAL", "PART"), planBefore: PLAN_BEFORE, planAfter: PLAN_AFTER.replaceAll("PARTIAL", "PART") });
    return eq([four.exposed, four.passNames, reversed.exposed, unchanged.planChanged, noTable.stateTable], [false, 4, false, false, false], "readings");
  });
  add("S10", "plan-design-review that exits on no UI scope is unexposed", () => {
    const r = pdrExposure({ transcript: PDR_NO_UI_TRANSCRIPT, planBefore: PLAN_BEFORE, planAfter: PLAN_BEFORE });
    return eq([r.exposed, r.noUiExit], [false, true], "reading");
  });
  add("S10", "autoplan exposed: the lean design lens, one bound native result, the gate answered rec by the harness, APPROVED and exported", () => eq(autoplanExposure(autoplanRun()).missing, [], "missing"));
  add("S10", "autoplan with no design lens is unexposed whatever else it did", () => {
    const r = autoplanExposure(autoplanRun({ ui: false }));
    return eq([r.exposed, r.designLens, r.leanDesign], [false, false, false], "reading");
  });
  add("S10", "autoplan unexposed: not lean, two native attempts, an outside attempt, a gate not answered by the harness, not approved, not exported, failed validate, no receipt", () =>
    eq(
      [autoplanRun({ lean: false }), autoplanRun({ nativeAttempts: 2 }), autoplanRun({ outsideAttempts: 1 }), autoplanRun({ by: "human" }), autoplanRun({ reply: "d1b p1a" }), autoplanRun({ status: "amend_pending" }), autoplanRun({ exported: false }), autoplanRun({ validates: false }), autoplanRun({ bound: "no receipt\n" })].map((f) => autoplanExposure(f).exposed),
      [false, false, false, false, false, false, false, false, false],
      "exposed",
    ),
  );
  add("S10", "autoplan with no run directory is unexposed with every output missing", () => {
    const r = autoplanExposure({ runs: () => [], read: () => null, validate: () => true });
    return eq([r.exposed, r.runDir, r.missing.length], [false, null, 4], "reading");
  });

  // ---- the scope read

  add("S10", "the scope read: a rendered path or a UI term beside a visual noun is UI; bare UI words are not; a refused plan is unreadable", () => {
    const root = mkdtempSync(join(tmpdir(), "dc-dry-scope-"));
    const reads = [
      scopeOf("# Orders\n\nWe will change src/pages/orders.tsx.\n", root),
      scopeOf("# Orders\n\nThe form on the page gets a save button.\n", root),
      scopeOf("# Orders\n\nThe list and the button stay.\n", root),
      scopeOf("## Implementation plan\n\nA.\n\n## Implementation plan\n\nB.\n\n## Review record\n", root),
      scopeOf("## Implementation plan\n\nThe modal layout on the view changes.\n", root),
    ];
    return all(eq(reads.map((r) => (r === null ? null : r.uiRequired)), [true, true, false, null, true], "reads"), eq(scopeShare(reads), { plans: 5, ui: 3, unreadable: 1, share: 0.6 }, "share"));
  });
  add("S10", "the scope read finds a named template file under the session's working folder", () => {
    const root = mkdtempSync(join(tmpdir(), "dc-dry-scope-"));
    mkdirSync(join(root, "repo", "src"), { recursive: true });
    writeFileSync(join(root, "repo", "src", "card.ts"), "const t = html`<div></div>`;\n");
    return eq([scopeOf("# Card\n\nWe will change repo/src/card.ts.\n", root)?.uiRequired, scopeOf("# Card\n\nWe will change src/card.ts.\n", root)?.uiRequired], [true, false], "template reads");
  });
  return c;
}
