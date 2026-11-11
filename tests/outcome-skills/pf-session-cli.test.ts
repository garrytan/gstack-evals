// Copyright (c) 2026 Garry Tan. MIT License.
// outcome pf session plan and session run (#305's run notes item 10, the Captain's ruling A): the paid run's entry point,
// mirroring the state machines eval's sm session commands. Keyless and docker-free: a hand-made unit dir, the committed
// prereg.json and a stand-in for runPfSession.
import { afterAll, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SESSION_EXIT, main } from "../../lanes/outcome-skills/pfchecks/cli.ts";
import { OPUS, SOL } from "../../lanes/outcome-skills/pfchecks/items.ts";
import { PfError, readPrereg } from "../../lanes/outcome-skills/pfchecks/prereg.ts";
import type { PfRun, PfRunInput } from "../../lanes/outcome-skills/pfchecks/run.ts";
import { planPart } from "../../lanes/outcome-skills/pfchecks/session.ts";
import { treeVolume } from "../../lanes/outcome-skills/statemachines/oracle.ts";

const PREREG = join(import.meta.dir, "../../wiki/plans/2026-11-09-geva-487-pstack-checks-prereg/prereg.json");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};
const sha = (b: string) => createHash("sha256").update(b).digest("hex");

function unitDir(id: string): string {
  const dir = temp("pf-cli-unit-");
  const body: Record<string, string> = { "fix.patch": "", "test.patch": "", "issue.md": "The flag is never reset.\n", "parser.py": "", "harbor/task.toml": "[environment]\n", "harbor/environment/Dockerfile": "FROM scratch\n", "harbor/instruction.md": "invented" };
  for (const [p, b] of Object.entries(body)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), b);
  }
  const u = {
    schema: "sm-unit.v1", id, lang: "go", base_commit: "b".repeat(40), repo_dir: "/w", work_dir: "/w", image: { ref: "example/fixture@sha256:" + "c".repeat(64), image_id: "sha256:" + "c".repeat(64), runtime_id: "sha256:" + "c".repeat(64) },
    tests: { f2p: ["t1"], p2p: ["t2"] }, files: Object.fromEntries(Object.entries(body).map(([p, b]) => [p, sha(b)])), scope: { dir: "flag/", files: 12, lines: 900, widened: 0 },
  };
  writeFileSync(join(dir, "unit.json"), JSON.stringify(u));
  return dir;
}

/** main with a stand-in for runPfSession that records its input and throws what it is given. */
async function session(argv: string[], fails?: Error) {
  const calls: PfRunInput[] = [];
  const err = spyOn(console, "error").mockImplementation(() => {});
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const exit = await main(["session", ...argv], {
      runPfSession: async (i: PfRunInput) => {
        calls.push(i);
        if (fails) throw fails;
        return { record: { gap: null, unit: i.session.unit }, file: join(i.out, "session.json"), image: {}, attempts: [] } as unknown as PfRun;
      },
    });
    return { exit, calls, stderr: err.mock.calls.map((c) => String(c[0])), stdout: log.mock.calls.map((c) => String(c[0])) };
  } finally {
    err.mockRestore();
    log.mockRestore();
  }
}

// Value: protects=section 11's session order on the paid run (#305's run notes item 10); fails_when=session plan gives a different order on another call, an order other than planPart's from prereg.json's order_seed, or overwrites a plan; why_new=the paid run had no entry point that plans a part; seam=pfchecks/cli.ts session plan; no_claim=the shuffle itself (pf-session.test.ts)
test("session plan writes the same order from prereg.json's order_seed on every call, planPart's, and never overwrites a plan", async () => {
  const d = temp("pf-cli-plan-");
  const args = (out: string) => ["plan", "--units", "u-b,u-a,u-c", "--prereg", PREREG, "--part", "2", "--out", out];
  const a = await session(args(join(d, "a.json")));
  const b = await session(args(join(d, "b.json")));
  expect([a.exit, b.exit]).toEqual([0, 0]);
  const first = JSON.parse(readFileSync(join(d, "a.json"), "utf8"));
  expect(readFileSync(join(d, "b.json"), "utf8")).toBe(readFileSync(join(d, "a.json"), "utf8"));
  expect(first).toEqual({ schema: "pf-plan.v1", kind: "test", part: 2, sessions: planPart(["u-b", "u-a", "u-c"], readPrereg(PREREG).order_seed, 2, "test") });
  expect(first.sessions.length).toBe(27);
  expect(new Set(first.sessions.map((s: { index: number }) => s.index)).size).toBe(27);
  const again = await session(args(join(d, "a.json")));
  expect(again.exit).not.toBe(0);
  expect(readFileSync(join(d, "a.json"), "utf8")).toBe(readFileSync(join(d, "b.json"), "utf8"));
  const admit = await session(["plan", "--units", "u-a", "--prereg", PREREG, "--part", "0", "--kind", "admit", "--models", SOL, "--out", join(d, "admit.json")]);
  expect(admit.exit).toBe(0);
  expect(JSON.parse(readFileSync(join(d, "admit.json"), "utf8")).sessions.map((s: { model: string; item: string }) => [s.model, s.item])).toEqual([[SOL, "pf-admit"], [SOL, "pf-admit"], [SOL, "pf-admit"]]);
  const bad = await session(["plan", "--units", "u-a", "--prereg", PREREG, "--part", "0", "--kind", "other", "--out", join(d, "bad.json")]);
  expect([bad.exit, bad.stderr[0]?.split(" ")[0], existsSync(join(d, "bad.json"))]).toEqual([2, "E_USAGE", false]);
});

const planFile = async (units: string, kind = "test") => {
  const out = join(temp("pf-cli-plan-"), "plan.json");
  expect((await session(["plan", "--units", units, "--prereg", PREREG, "--part", "1", "--kind", kind, "--out", out])).exit).toBe(0);
  return out;
};
const effortFile = () => {
  const p = join(temp("pf-cli-effort-"), "effort.json");
  writeFileSync(p, JSON.stringify({ [OPUS]: { thinking: { type: "adaptive" } }, [SOL]: { reasoning: null } }));
  return p;
};
const runArgs = (o: { unit: string; plan: string; index: string; effort?: string; out?: string }) => ["run", "--unit", o.unit, "--plan", o.plan, "--index", o.index, "--control", "http://172.17.0.1:9000", "--proxy", "172.17.0.1:9001", "--names", "short", "--out", o.out ?? join(temp("pf-cli-out-"), "s"), ...(o.effort ? ["--effort", o.effort] : [])];

// Value: protects=the paid run's session inputs (#305's run notes item 10); fails_when=session run starts a session for an index outside the plan, without effort.json, or for a unit other than the planned one, or passes runPfSession anything but the planned session, the unit's tree volume, the effort record and, for the blind probe, the unit's scope; why_new=the paid run had no entry point that runs one planned session; seam=pfchecks/cli.ts session run; no_claim=runPfSession (pf-run.test.ts, pf_agent_sdk_test.py)
test("session run refuses an index outside the plan, a run without effort.json and another unit, and runs the planned session on the unit's tree volume", async () => {
  const unit = unitDir("pf-cli-flag");
  const plan = await planFile("pf-cli-flag");
  const effort = effortFile();
  for (const index of ["9", "-1", "1.5", "x"]) {
    const r = await session(runArgs({ unit, plan, index, effort }));
    expect([index, r.exit, r.stderr[0]?.split(" ")[0], r.calls.length]).toEqual([index, 2, "E_USAGE", 0]);
  }
  const noEffort = await session(runArgs({ unit, plan, index: "0" }));
  expect([noEffort.exit, noEffort.stderr[0]?.split(" ")[0], noEffort.calls.length]).toEqual([2, "E_USAGE", 0]);
  expect(noEffort.stderr[0]).toContain("--effort");
  for (const body of ["null", "[]", "\"effort\"", "7"]) {
    const bad = join(temp("pf-cli-effort-"), "effort.json");
    writeFileSync(bad, body);
    const r = await session(runArgs({ unit, plan, index: "0", effort: bad }));
    expect([body, r.exit, r.stderr[0]?.split(" ")[0], r.calls.length]).toEqual([body, 2, "E_USAGE", 0]);
  }
  const other = await session(runArgs({ unit: unitDir("pf-cli-other"), plan, index: "0", effort }));
  expect([other.exit, other.calls.length]).toEqual([2, 0]);
  const sessions = JSON.parse(readFileSync(plan, "utf8")).sessions;
  const ok = await session(runArgs({ unit, plan, index: "4", effort }));
  expect(ok.exit).toBe(0);
  expect(ok.calls.length).toBe(1);
  const i = ok.calls[0]!;
  expect(i.session).toEqual(sessions[4]);
  expect(i).toMatchObject({ unitDir: unit, names: "short", control: "http://172.17.0.1:9000", proxy: "172.17.0.1:9001", volume: treeVolume("pf-cli-flag"), effort: JSON.parse(readFileSync(effort, "utf8")) });
  expect(i.scope).toBeUndefined();
  const blind = await session(runArgs({ unit, plan: await planFile("pf-cli-flag", "blind"), index: "0", effort }));
  expect([blind.exit, blind.calls[0]?.session.arm, blind.calls[0]?.scope]).toEqual([0, "blind", "flag/"]);
});

// Value: protects=section 10's raise and cut-report sessions on the paid run (#305's run notes item 10); fails_when=session run with --issue passes runPfSession anything but that file's text as issue, or sets issue without the flag; why_new=session run never set issue, so every session read the unit's issue.md and the raise's report with the changed files, or the cut report, could not run; seam=pfchecks/cli.ts session run --issue; no_claim=which report admission picks (admission.ts), how runCopy builds the task turn (pf-run.test.ts)
test("session run passes the --issue file's text as the session's bug report, and leaves issue unset without the flag", async () => {
  const unit = unitDir("pf-cli-flag");
  const plan = await planFile("pf-cli-flag");
  const effort = effortFile();
  const plain = await session(runArgs({ unit, plan, index: "0", effort }));
  expect([plain.exit, plain.calls.length]).toEqual([0, 1]);
  expect("issue" in plain.calls[0]!).toBe(false);
  const report = join(temp("pf-cli-issue-"), "raise.md");
  writeFileSync(report, "The flag is never reset.\n\nThe fix changed parser.py.\n");
  const raised = await session([...runArgs({ unit, plan, index: "0", effort }), "--issue", report]);
  expect([raised.exit, raised.calls.length, raised.calls[0]?.issue]).toEqual([0, 1, "The flag is never reset.\n\nThe fix changed parser.py.\n"]);
});

// Value: protects=the runner VM's loop, which stops at the first non-zero exit (#305's run notes item 10); fails_when=a cap stop, a finalize halt or a containment halt in session run exits 0, or two of them share an exit, or a session that ends with a gap exits non-zero; why_new=the three stops exited 2, 2 and 1, so the loop could not tell them apart; seam=pfchecks/cli.ts main's exit for session; no_claim=when runPfSession raises each (pf-run.test.ts, pf-containment.test.ts)
test("session run exits 10 at a cap stop, 11 at a finalize halt and 12 at a containment halt, and 0 for a session that ends with a gap", async () => {
  expect(SESSION_EXIT).toEqual({ CAP_STOP: 10, E_PF_FINALIZE_HALT: 11, E_PF_CONTAINMENT: 12 });
  const unit = unitDir("pf-cli-flag");
  const plan = await planFile("pf-cli-flag");
  const effort = effortFile();
  for (const [code, exit] of [["CAP_STOP", 10], ["E_PF_FINALIZE_HALT", 11], ["E_PF_CONTAINMENT", 12], ["E_PF_INFRA_GAP", 2]] as const) {
    const r = await session(runArgs({ unit, plan, index: "0", effort }), new PfError(code, "stand-in"));
    expect([code, r.exit, r.stderr[0]]).toEqual([code, exit, code + " stand-in"]);
  }
  const gap = await session(runArgs({ unit, plan, index: "0", effort }));
  expect(gap.exit).toBe(0);
});
