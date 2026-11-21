import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureUnit } from "../../lanes/day-one/dryrun.ts";
import { PLAN, WORK } from "../../lanes/day-one/exposure.ts";
import { GATE_REPLY, OWNER_CLOSING, REVIEW_ARMS, type PlanArm } from "../../lanes/day-one/frozen.ts";
import { DAYONE_RUN } from "../../lanes/day-one/ledger.ts";
import { ownerLoop, sourceCounts, type AnswerSource, type OwnerReply } from "../../lanes/day-one/owner.ts";
import { runStage, type StageInput } from "../../lanes/day-one/run.ts";
import type { AttemptRead, LaunchInput } from "../../lanes/day-one/sessions.ts";
import { loadUnit, type Unit } from "../../lanes/day-one/units.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";

/** The persona rules' last branch: the question offers options, none is marked recommended, and the profile supports none. */
const LAST = "I don't know, use your judgment.";
const APPROVAL = "All four phases are closed and the run waits at its approval gate. Nothing is approved yet. Reply approve to treat this plan as final, or build it to start building. Which do you want?";
const FREE = "While the gate waits: roughly how many tickets do you expect in the first month?";

const said = (text: string) => async (): Promise<OwnerReply> => ({ text });
const reply = (n: object): string | null => ("reply" in n ? (n as { reply: string }).reply : null);

// Value: protects=the gate-default reply (a dated change to the prereg's section 4, after rep 4 of the smoke): on a gstack arm whose run waits at its gate, an answer from the persona rules' last branch ("I don't know, use your judgment.") is replaced by the fixed gate reply "do it", logged as its own type gate-default and counted toward the 30-answer limit; fails_when=a gstack gate ask the persona can't decide stays unanswered, the substitution is logged as recommended or unknown, or it fires with no gate pending, on N, D or R, on a marked recommendation, on a profile answer, or on a free-form question while the gate waits
describe("the gate-default reply at a gstack gate", () => {
  test("an unmarked approval ask with the gate pending gets the fixed gate reply, logged as gate-default", async () => {
    for (const persona of [LAST, "I don't know, use your judgement.", "I don\u2019t know, use your judgment", "i don't know, use your judgment."]) {
      const loop = ownerLoop({ ask: said(persona + "\nSOURCE: unknown"), gatePending: () => true });
      const r = await loop.nextUser([APPROVAL]);
      expect([persona, reply(r)]).toEqual([persona, GATE_REPLY]);
      expect(loop.state.turns).toEqual([{ n: 1, question: APPROVAL, answer: GATE_REPLY, source: "gate-default", gate: true, persona: persona }]);
      expect(sourceCounts(loop.state.turns)).toMatchObject({ "gate-default": 1, recommended: 0, unknown: 0, questions: 1, gate: 1 });
    }
  });

  test("a gate-default reply counts toward the answer limit", async () => {
    const loop = ownerLoop({ ask: said(LAST + "\nSOURCE: unknown"), gatePending: () => true, limit: 1 });
    expect(reply(await loop.nextUser([APPROVAL]))).toBe(GATE_REPLY);
    expect(reply(await loop.nextUser([APPROVAL]))).toBe(OWNER_CLOSING);
    expect(loop.state.turns.length).toBe(1);
  });

  test("the same ask with no gate pending keeps the persona's answer", async () => {
    for (const gatePending of [() => false, undefined]) {
      const loop = ownerLoop({ ask: said(LAST + "\nSOURCE: unknown"), ...(gatePending ? { gatePending } : {}) });
      expect(reply(await loop.nextUser([APPROVAL]))).toBe(LAST);
      expect(loop.state.turns[0]).toMatchObject({ answer: LAST, source: "unknown", gate: false });
      expect(sourceCounts(loop.state.turns)["gate-default"]).toBe(0);
    }
  });

  test("a marked recommendation, a profile answer and a free-form question keep the persona's answer while the gate waits", async () => {
    const cases: [string, string, string, AnswerSource][] = [
      ["marked recommendation", APPROVAL + " I recommend approve.", "approve\nSOURCE: recommended", "recommended"],
      ["profile answer", APPROVAL, "build it\nSOURCE: profile", "profile"],
      ["free-form question", FREE, "I don't know.\nSOURCE: unknown", "unknown"],
      ["the last branch's words tagged profile", APPROVAL, LAST + "\nSOURCE: profile", "profile"],
      ["the last branch's words untagged", APPROVAL, LAST, "untagged"],
      ["the last branch's words beside an answer", APPROVAL, "Approve. On the rest, I don't know, use your judgment.\nSOURCE: unknown", "unknown"],
    ];
    for (const [name, question, text, source] of cases) {
      const loop = ownerLoop({ ask: said(text), gatePending: () => true });
      const answer = text.replace(/\nSOURCE: \w+$/, "");
      expect([name, reply(await loop.nextUser([question]))]).toEqual([name, answer]);
      expect([name, loop.state.turns[0]]).toEqual([name, { n: 1, question, answer, source, gate: true }]);
    }
  });

  test("with the channel dropped the gate still gets the fixed reply logged as recommended, not gate-default", async () => {
    const loop = ownerLoop({ ask: async () => { throw new Error("the responder was called with the channel dropped"); }, gatePending: () => true, dropped: true });
    expect(reply(await loop.nextUser([APPROVAL]))).toBe(GATE_REPLY);
    expect(loop.state.turns[0]).toMatchObject({ source: "recommended", gate: true });
  });
});

const withDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "day-one-gate-default-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const RUN = WORK + "/.gstack/tmp/autoplan/run";
const SCAFFOLD = "cd /work/app; ~/.claude/skills/gstack/bin/gstack-autoplan next --out " + RUN + " --plan /work/app/plan.md --full --scaffold 2>&1 | tail -40";
const closed = { closed_at: "2026-11-17T18:30:00Z", native: { status: "completed" }, outside: { status: "completed" } };
const PENDING = { status: "gate_pending", plan_input: PLAN, plan_source: PLAN, out: RUN, active_plan: RUN + "/plan-active.md", updated_at: "2026-11-17T18:30:36Z", phases: { ceo: closed, design: closed, eng: closed } };

// Value: protects=the gate-default reply's arm wiring: only the gstack arms (A, S-dayone, S-full) pass the live gate check to the owner loop, so the same planted waiting gate and the same persona answer give "do it" there and leave N, D and R with the persona's own answer; fails_when=the substitution reaches a non-gstack arm, or a gstack arm's live gate check does not reach it
describe("the gate-default reply by arm", () => {
  test("every arm's session sees the same waiting gate; only A, S-dayone and S-full get the fixed reply", async () => {
    await withDir(async (dir) => {
      const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
      const stubRig = (): HostRig => ({ baseUrl: "http://proxy", network: "none", imageDigest: null, bind: async () => ({}) as never, finalize: async () => ({}) as never, arms: {}, sandbox: () => ({}) as never, judgeSandbox: () => ({}) as never, egress: () => ({ open: false, detail: "" }), close: async () => {} }) as never;
      const meter = { leaseId: "owner", spent: () => 0, close: async () => ({ spent_micros: 0, unknown_micros: 0 }), call: async () => ({ text: LAST + "\nSOURCE: unknown", status: 200, micros: 1000, cached: false, problem: null, served_by: "openai" }) };
      fixtureUnit(dir, "aaaaaa", 2);
      const u = (loadUnit(dir, "aaaaaa") as { unit: Unit }).unit;
      const replies: Record<string, string | null> = {};
      const launch = async (l: LaunchInput): Promise<AttemptRead> => {
        const app = join(l.dir, "work", "app");
        mkdirSync(join(app, ".gstack/tmp/autoplan/run"), { recursive: true });
        writeFileSync(join(app, ".gstack/tmp/autoplan/run/run.json"), JSON.stringify(PENDING));
        mkdirSync(join(l.dir, "host"), { recursive: true });
        writeFileSync(join(l.dir, "host", "transcript.ndjson"), JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t0", name: "Bash", input: { command: SCAFFOLD } }] } }) + "\n");
        replies[l.cell] = reply(await l.nextUser([APPROVAL]));
        const out = join(l.dir, "out");
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "plan.md"), "# Plan\n");
        return { termination: { kind: "completed" }, web: 0, gstack_reads: [], contained: [], micros: 1e6, voice: null, out };
      };
      const stage = (s: "base" | "review", arms: PlanArm[]): StageInput => ({ stage: s, tag: "t", units: [u], reps: [1], arms, out: join(dir, "out"), runId: DAYONE_RUN, cap: 2000e6, ownerCap: 100e6, voiceCap: 1000e6, parallel: 1, ownerChannel: true, policy, ledger: null, docker: "docker", scratch: join(dir, "scratch"), nodeVolume: null, log: () => {} });
      const base = await runStage(stage("base", ["n"]), { openRig: stubRig, ownerMeter: meter as never, launch });
      const review = await runStage(stage("review", [...REVIEW_ARMS]), { openRig: stubRig, ownerMeter: meter as never, launch });
      expect([...base.stops, ...review.stops]).toEqual([]);
      const by = Object.fromEntries([...base.rows, ...review.rows].map((r) => [r.cell.arm, r.owner]));
      const got = Object.fromEntries(Object.entries(by).map(([arm, o]) => [arm, o ? [o.turns.map((t) => [t.answer, t.source, t.gate]), o.counts["gate-default"]] : null]));
      expect(got).toEqual({
        n: [[[LAST, "unknown", false]], 0],
        d: [[[LAST, "unknown", false]], 0],
        r: [[[LAST, "unknown", false]], 0],
        a: [[[GATE_REPLY, "gate-default", true]], 1],
        "s-full": [[[GATE_REPLY, "gate-default", true]], 1],
        "s-dayone": [[[GATE_REPLY, "gate-default", true]], 1],
      });
      expect(Object.values(replies).sort()).toEqual([GATE_REPLY, GATE_REPLY, GATE_REPLY, LAST, LAST, LAST].sort());
    });
  });
});
