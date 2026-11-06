// The armed-and-blocked test (the CEO stage 2 amendment, section 3.3, with rulings B1 and D1) and section 5's 200k check,
// keyless, through the real pinned CLI. ceo-enforced-armed.ts runs every session in its own process: runReviewUnits, the
// real Claude Code driver, the pinned Agent SDK and its CLI, the scripted Messages stand-in behind the real metering proxy,
// and arms installed from gstack 4743132 by its own ./setup. It runs when OUTCOME_GSTACK_ENFORCED_PIN names a git checkout
// of that commit; rig.yml's tier fetches one, and the tier counts a skipped case as red, so the tier never passes on a skip.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENFORCED_GSTACK_SHA, GATE_DEADLINE_MS, GATE_HOOK_TIMEOUT_S } from "../../../src/trial/review/skill-gates.ts";
import { HAS_CLAUDE_CLI } from "../../adapters/harness.ts";
import { CASES, MODELS, OPUS, SLOW_S } from "./ceo-enforced-armed.ts";

const PIN = process.env.OUTCOME_GSTACK_ENFORCED_PIN ?? "";
const HAS_PIN = !!PIN && existsSync(join(PIN, "bin", "gstack-skill-gates"));
/** gstack 4743132's git tree id. */
const TREE = "9340ccf599e3c6dbb550ca2cef5b24a5a36aefa3";

type Row = { fired: number; blocked: number; released: number; exhausted: number; errors: number };
type Case = { termination: { kind: string }; gate: { exit: number | null; json: { rows: Row[] } | null; stderr: string; deadline_ms?: number; hook_timeout_s?: number } | null; copy_out: string[]; exposure: { exposed: boolean; failed: string | null; checks: Record<string, boolean> } | null; records: { hooks: Record<string, { runs: Record<string, { blocked: number; released_at?: string; file?: string }> }> }[]; settings_timeouts: number[] | null; slowed: boolean | null; session_kind: string | null; review_sections_bytes: number; model_saw_block: boolean; model_saw_fired: boolean; fired_markers: number; wall_ms: number };
type Reading = { env: boolean; maxTokens: number; rawMaxTokens: number; autoCompactThreshold: number; isAutoCompactEnabled: boolean };
let ran: { cases: Record<string, Case>; context: { built: Record<string, Reading>; without: Record<string, Reading> } } | null = null;
let failed: Error | null = null;
function run() {
  if (ran) return ran;
  if (failed) throw failed;
  const root = mkdtempSync(join(homedir(), ".gstack-evals-ceo-armed-test-"));
  try {
    const r = spawnSync(process.execPath, [join(import.meta.dir, "ceo-enforced-armed.ts"), PIN, root], { encoding: "utf8", timeout: 540_000 });
    if (r.status !== 0) throw (failed = new Error("ceo-enforced-armed.ts exited " + r.status + ": " + (r.stderr ?? "").slice(-3000)));
    ran = JSON.parse(r.stdout.trim().split("\n").pop()!);
    return ran!;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const row = (c: Case) => c.gate?.json?.rows?.[0] ?? null;
const counts = (c: Case) => { const r = row(c); return r ? { fired: r.fired, blocked: r.blocked, released: r.released, exhausted: r.exhausted, errors: r.errors } : null; };

describe.skipIf(!HAS_PIN || !HAS_CLAUDE_CLI)("the armed-and-blocked test through the pinned CLI (OUTCOME_GSTACK_ENFORCED_PIN)", () => {
  // Value: protects=section 3.3's armed-and-blocked cases 1, 2 and 7 and what gstack-session-kind prints in a session: the gate the printed settings register blocks a stop without ranked findings and releases it once a Bash heredoc writes them, reads a question ending as final only under unattended, and governs a 15 s scan at the 30 s shim timeout; fails_when=the gate never arms through the Agent SDK's settings, arms twice, misses the record copy, reads exposed with no gate wiring, or a slow scan goes through unblocked at 30 s; why_new=GEVA-351 3.3 cases 1, 2, 7 and B1; seam=runReviewUnits, claudeCodeDriver's settings, the pinned Agent SDK and CLI, gstack 4743132's hooks and report, gateRecord, ceo rows' gateReport and enforcedExposure; no_claim=a model's own behavior, or cases 3 to 6 (ceo-enforced.test.ts)
  test("the pin is gstack 4743132 by commit and tree", () => {
    const git = (...a: string[]) => spawnSync("git", ["-C", PIN, ...a], { encoding: "utf8" }).stdout.trim();
    expect([git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")]).toEqual([ENFORCED_GSTACK_SHA, TREE]);
    expect(CASES.map((c) => c.name)).toEqual(["blocked-released", "blocked-no-gate", "question-unattended", "question-kind-unset", "slow-scan-30", "slow-scan-10"]);
  });
  test("case 1: blocked, then released; the report exits 0, one fired marker, and the row reads exposed", () => {
    const c = run().cases["blocked-released"]!;
    expect(c.termination.kind).toBe("completed");
    expect([c.gate?.exit, counts(c), c.copy_out]).toEqual([0, { fired: 1, blocked: 1, released: 1, exhausted: 0, errors: 0 }, []]);
    expect([c.gate?.hook_timeout_s, c.gate?.deadline_ms, c.settings_timeouts]).toEqual([GATE_HOOK_TIMEOUT_S, GATE_DEADLINE_MS, [30, 30]]);
    expect(c.records.length).toBe(1);
    expect(Object.values(c.records[0]!.hooks["ceo-review-gate"]!.runs)).toEqual([expect.objectContaining({ blocked: 1, file: "ceo-review.md", released_at: expect.any(String) })]);
    expect([c.model_saw_block, c.model_saw_fired, c.fired_markers]).toEqual([true, false, 1]);
    expect(c.review_sections_bytes).toBeGreaterThan(0);
    expect(c.exposure).toEqual({ detector: "enforced", exposed: true, failed: null, checks: { review_sections_read: true, mode_named: true, gate_armed: true, gate_released: true } } as never);
  }, 600_000);
  test("case 1's contrast: the same script with no gate wiring (gstack-forced) has no record, the report exits 2 and the row reads unexposed", () => {
    const c = run().cases["blocked-no-gate"]!;
    expect(c.termination.kind).toBe("completed");
    expect([c.gate?.exit, c.gate?.json?.rows, c.records, c.settings_timeouts]).toEqual([2, [], [], null]);
    expect(c.gate?.stderr).toContain("GATE_NOT_ARMED");
    expect([c.model_saw_block, c.fired_markers]).toEqual([false, 0]);
    expect(c.exposure).toMatchObject({ exposed: false, failed: "gate_armed", checks: { review_sections_read: true, mode_named: true } });
  }, 600_000);
  test("case 2: a question ending under unattended counts as final, the gate releases it, and the row reads exposed; with the kind unset the report exits 2 and the row reads unexposed", () => {
    const yes = run().cases["question-unattended"]!;
    expect([yes.termination.kind, yes.gate?.exit, counts(yes), yes.model_saw_block, yes.fired_markers]).toEqual(["completed", 0, { fired: 1, blocked: 0, released: 1, exhausted: 0, errors: 0 }, false, 1]);
    expect(yes.exposure).toMatchObject({ exposed: true, failed: null });
    const no = run().cases["question-kind-unset"]!;
    expect([no.termination.kind, no.gate?.exit, no.gate?.json?.rows, no.records, no.settings_timeouts, no.fired_markers]).toEqual(["completed", 2, [], [], [30, 30], 0]);
    expect(no.exposure).toMatchObject({ exposed: false, failed: "gate_armed" });
  }, 600_000);
  test("inside a session, gstack-session-kind prints unattended for the enforced arm, and interactive with the kind unset", () => {
    const c = run().cases;
    expect(["blocked-released", "question-unattended", "slow-scan-30", "slow-scan-10"].map((n) => c[n]!.session_kind)).toEqual(["unattended", "unattended", "unattended", "unattended"]);
    expect(c["question-kind-unset"]!.session_kind).toBe("interactive");
  }, 600_000);
  test("case 7 (ruling B1): a " + SLOW_S + " s gate scan at the 30 s shim timeout still blocks, then releases; the same scan at 10 s lets the stop through unblocked", () => {
    const slow = run().cases["slow-scan-30"]!;
    expect([slow.slowed, slow.settings_timeouts, slow.gate?.exit, counts(slow), slow.model_saw_block]).toEqual([true, [30, 30], 0, { fired: 1, blocked: 1, released: 1, exhausted: 0, errors: 0 }, true]);
    // gstack-timing-ok: a lower bound that proves the shim's slow scan ran inside the hook, so a slow machine cannot fail it
    expect(slow.wall_ms).toBeGreaterThanOrEqual(SLOW_S * 1000);
    expect(slow.exposure).toMatchObject({ exposed: true, failed: null });
    const ten = run().cases["slow-scan-10"]!;
    expect([ten.slowed, ten.termination.kind, ten.model_saw_block, row(ten)?.released, row(ten)?.exhausted]).toEqual([true, "completed", false, 0, 0]);
    expect(ten.exposure).toMatchObject({ exposed: false, failed: "gate_released" });
  }, 600_000);
});

describe.skipIf(!HAS_PIN || !HAS_CLAUDE_CLI)("section 5's 200k check: the pinned CLI's context window on every model (ruling D1)", () => {
  // Value: protects=section 5's trip rule, which holds one call at a 200,000-token prompt: with CLAUDE_CODE_DISABLE_1M_CONTEXT=1 on every ceo-outcome session, the pinned CLI's own getContextUsage() reads a 200,000-token window that compacts at 167,000 on Opus 5.5, GPT-6.1 Sol and particle-1; without it Opus reads 1,000,000, compacting at 967,000; fails_when=the env line drops off an arm or model, or the pinned CLI moves its window or compaction point; why_new=GEVA-351 section 5 and D1; seam=runReviewUnits, hostDriver, the pinned Agent SDK's getContextUsage and CLI; no_claim=a live model's prompt sizes (the smoke rerun reports each cell's largest prompt)
  test("200,000 tokens, compacting at 167,000, on all three models; Opus without the env line reads 1,000,000", () => {
    const { built, without } = run().context;
    const at200k = { env: true, maxTokens: 200_000, rawMaxTokens: 200_000, autoCompactThreshold: 167_000, isAutoCompactEnabled: true };
    expect(built).toEqual(Object.fromEntries(MODELS.map((m) => [m, at200k])));
    expect(without).toEqual({ [OPUS]: { env: false, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, autoCompactThreshold: 967_000, isAutoCompactEnabled: true } });
  }, 600_000);
});
