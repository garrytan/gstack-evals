// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals day-one dryrun (prereg section 12): the keyless dry run. Each case drives a frozen rule on fixtures and
// prints one PASS or FAIL line with what it saw; nothing calls a provider. The stage runner runs end to end on a stub rig
// and a stub launch (every stage, the owner channel on and dropped, an admission stop and its resume, a session cap stop
// and its refusal, a changed manifest, the cross-launch guard, a crash marker, a containment halt); the checker
// session's setup runs through launchSession with a stub driver; the fixtures with the real checker run on a stub
// launch; the Astra voice route runs on a real metering proxy against a stub upstream on a temporary ledger; the
// smoke's admission arithmetic replays at planning prices; and every metered line item opens and settles one lease on
// a temporary ledger.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";
import type { LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { DEFAULT_POLICY, loadPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { Meter as PvMeter } from "../product-value/meter.ts";
import { decide, paired, read, source, type Interval, type ScoredBuild } from "./analysis.ts";
import { appWrites, RAM_SIZE } from "./app.ts";
import { armPlan, findRun, PLAN, readExposure, WORK } from "./exposure.ts";
import { runRealFixtures } from "./fixtures.ts";
import { armPrompt, COMMON_ASK, DAY_ONE_PASS, GATE_REPLY, MODELS, OWNER_CLOSING, OWNER_NOTICE, PREREG, PROBE_QUESTIONS, PROMPTS_SHA256, BUILD_PROMPT, CHECK_FOOTER, CHECK_HEADER, OWNER_HEAD, OWNER_RULES, PLATFORM, QUESTION_CHARS, REVIEW_ASK, AUTOPLAN_LINE } from "./frozen.ts";
import { controls, goldAgreement, labelPacket, packets, parseLabels, stockPlan, type Label } from "./judge.ts";
import { ALL_IN_USD, DAYONE_RUN, HEADROOM_USD, ITEMS, itemOf, ledgerCapUsd, leaseAmount, leaseItem, PLANNING_PRICES, settleItem, shrink } from "./ledger.ts";
import { ownerLoop, splitSource } from "./owner.ts";
import { buildDir, cellLimits, planFile, runStage, treeDigest, type CrashPoint, stageCells, type Stage, type StageDeps, type StageInput } from "./run.ts";
import { attemptOutcome, BROWSER_TOOLS, launchSession, RAM_FULL_CHECK, settle, type AttemptRead, type LaunchInput } from "./sessions.ts";
import { briefText, loadUnit, type Unit } from "./units.ts";
import { checkPrompt, parseVerdicts, scoreBuild } from "./verdict.ts";

interface Io {
  out: (t: string) => void;
  err: (t: string) => void;
}
type Case = () => string | Promise<string>;
class Fail extends Error {}
const must = (ok: boolean, why: string) => {
  if (!ok) throw new Fail(why);
};
const fail = (why: string): never => {
  throw new Fail(why);
};
const withTmp = async <T>(fn: (dir: string) => T | Promise<T>): Promise<T> => {
  const dir = mkdtempSync(join(tmpdir(), "day-one-dry-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A fixture unit: category 2 with a five-task list and one sample, or category 1 with two checks. */
export function fixtureUnit(dir: string, id: string, category: 1 | 2): void {
  const u = join(dir, id);
  mkdirSync(join(u, "samples"), { recursive: true });
  writeFileSync(join(u, "brief.md"), "I keep a few houseplants and forget to water them. I want a little page to keep track.\n");
  writeFileSync(join(u, "profile.md"), "I have about a dozen plants. I keep a spreadsheet of them, which I can export as CSV.\n");
  if (category === 2) {
    writeFileSync(join(u, "samples", "plants.csv"), "name,days\nFern,3\nCactus,14\nBasil,2\nIvy,5\n");
    const t = (i: number, from: "brief" | "implied", data: string | null = null) => ({ id: "t" + i, rank: i, task: "Task " + i, success: "Result " + i + " shows after a reload", data, from, support: "a fact" });
    writeFileSync(join(u, "list.json"), JSON.stringify({ obvious: false, tasks: [t(1, "brief"), t(2, "brief"), t(3, "implied"), t(4, "implied", "plants.csv"), t(5, "brief")] }));
  } else {
    const c = (id: string, role: "primary" | "secondary") => ({ id, kind: "ask", statement: "s", covered_if: "c", usable_if: "u", from_brief: role === "primary" ? "implied" : "not_foreseeable", rank: 1, role });
    writeFileSync(join(u, "checks.json"), JSON.stringify({ schema: "day-one.checks.v1", items: [c("c1", "primary"), c("c2", "secondary")] }));
  }
}

const policyOf = (): LoadedPolicy => {
  const p = loadPolicy(DEFAULT_POLICY);
  if ("problem" in p) throw new Fail(p.problem);
  return p as LoadedPolicy;
};

/** A rig that binds slots and meters nothing; launches are stubbed, so no container starts. */
function stubRig(closed: { n: number }): HostRig {
  let n = 0;
  return {
    baseUrl: "http://proxy",
    network: "none",
    imageDigest: null,
    bind: async () => ({ slot: "s" + ++n, token: "t" + n, meter_id: "m" + n }) as never,
    finalize: async () => ({ micros: 0 }) as never,
    arms: {},
    sandbox: () => ({}) as never,
    judgeSandbox: () => ({}) as never,
    egress: () => ({ open: false, detail: "" }),
    close: async () => {
      closed.n++;
      return { committed: 0, unknown: 0, lease_id: null };
    },
    recovery: null,
  };
}

const ownerMeter = (calls: string[]): PvMeter => ({
  leaseId: "owner",
  spent: () => 0,
  close: async () => ({ spent_micros: 0, unknown_micros: 0 }),
  call: async (req) => {
    calls.push(req.prompt);
    return { text: "On weekends.\nSOURCE: profile", status: 200, micros: 1000, cached: false, problem: null, served_by: "openai" };
  },
});

/** A launch that plays each stage's agent: asks the owner once on a plan, writes the stage's output, answers the checker. */
function stubLaunch(o: { leak?: boolean; usd?: number; dropped?: boolean; seen?: LaunchInput[]; capStop?: boolean; noBrowser?: boolean; allFail?: boolean } = {}) {
  return async (l: LaunchInput): Promise<AttemptRead> => {
    o.seen?.push(l);
    const out = join(l.dir, "out");
    mkdirSync(out, { recursive: true });
    if (o.capStop) return { termination: { kind: "cap_stop" } as never, web: 0, gstack_reads: [], contained: [], micros: 1e6, voice: null, out };
    if (l.arm === "check") {
      must(l.mcpUrl === "http://c:8931/mcp", "the checker was launched without the browser container's MCP endpoint");
      mkdirSync(join(l.dir, "host"), { recursive: true });
      if (!o.noBrowser) writeFileSync(join(l.dir, "host", "transcript.ndjson"), JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "mcp__browser__browser_navigate", input: {} }] } }) + "\n" + JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "ok" }] } }) + "\n");
      await l.nextUser(["Tried every task.\n```verdicts\n" + JSON.stringify({ tasks: [1, 2, 3, 4, 5].map((i) => ({ id: "t" + i, done: !o.allFail && i <= 2, why: "seen" })) }) + "\n```"]);
    } else if (l.arm === "build") {
      writeFileSync(join(out, "start.sh"), "node server.js\n");
      await l.nextUser(["Built."]);
    } else {
      const q = await l.nextUser(["Which days do you water?"]);
      must(o.dropped ? "end" in q : "reply" in q, o.dropped ? "a question was answered with the channel dropped" : "the owner loop did not answer a question");
      writeFileSync(join(out, "plan.md"), "# Plan by " + l.arm + "\n");
      await l.nextUser(["Done."]);
    }
    return { termination: { kind: "completed" }, web: 0, gstack_reads: [], contained: o.leak ? ["env name OPENAI_REAL_KEY"] : [], micros: Math.round((o.usd ?? 1) * 1e6), voice: l.gstack ? { micros: 500_000, requests: 3, refused: 0 } : null, out };
  };
}

const stubApp = { start: async () => ({ container: "c", mcpUrl: "http://c:8931/mcp", started: true, start_s: 3, detail: "ok", copy: "/nonexistent", build: "/nonexistent" }), stop: () => [] } as unknown as NonNullable<StageDeps["app"]>;

async function stageRun(dir: string, us: Unit[], st: Stage, arms: ("n" | "d" | "r" | "a")[], cap: number, extra: Partial<StageDeps> = {}, closed = { n: 0 }, more: Partial<StageInput> = {}) {
  const calls: string[] = [];
  return runStage({ stage: st, tag: "dry", units: us, reps: [1], arms, out: dir, runId: DAYONE_RUN, cap: cap * 1e6, ownerCap: 10e6, voiceCap: 100e6, parallel: 2, ownerChannel: true, policy: policyOf(), ledger: null, docker: "docker", scratch: join(dir, "scratch"), nodeVolume: "vol", log: () => {}, ...more }, { openRig: () => stubRig(closed), ownerMeter: ownerMeter(calls), launch: stubLaunch(), app: stubApp, ...extra });
}

const iv = (lo: number, hi: number, briefs = 15): Interval => ({ est: (lo + hi) / 2, lo, hi, briefs, sd: 0.2 });

export const CASES: Record<string, Case> = {
  "frozen texts": () => {
    const prereg = existsSync(PREREG) ? readFileSync(PREREG, "utf8") : null;
    must(prereg !== null, PREREG + " is missing");
    const texts = { COMMON_ASK, REVIEW_ASK, DAY_ONE_PASS, AUTOPLAN_LINE, OWNER_NOTICE, PLATFORM, BUILD_PROMPT, CHECK_HEADER, CHECK_FOOTER, OWNER_HEAD, OWNER_RULES, OWNER_CLOSING, GATE_REPLY, ...Object.fromEntries(PROBE_QUESTIONS.map((q, i) => ["PROBE_" + (i + 1), q])) };
    const missing = Object.entries(texts).filter(([, v]) => !prereg!.includes(v)).map(([k]) => k);
    must(!missing.length, "not in the prereg byte for byte: " + missing.join(", "));
    must(armPrompt("d").startsWith(REVIEW_ASK + "\n\n" + DAY_ONE_PASS), "D's prompt is not the review ask then the day-one paragraph");
    must(armPrompt("r") === REVIEW_ASK + "\n\n" + OWNER_NOTICE && armPrompt("d") === REVIEW_ASK + "\n\n" + DAY_ONE_PASS + "\n\n" + OWNER_NOTICE, "R is not D's review ask without the day-one pass");
    must((["n", "d", "r", "a"] as const).every((a) => !armPrompt(a, false).includes(OWNER_NOTICE)), "a dropped channel kept the owner notice");
    return Object.keys(texts).length + " frozen texts in the prereg; R is D without the day-one pass; prompts sha256 " + PROMPTS_SHA256.slice(0, 12);
  },
  "units": () =>
    withTmp((dir) => {
      fixtureUnit(dir, "aaaaaa", 2);
      fixtureUnit(dir, "bbbbbb", 1);
      const a = loadUnit(dir, "aaaaaa");
      const b = loadUnit(dir, "bbbbbb");
      must("unit" in a && a.unit.category === 2 && "unit" in b && b.unit.category === 1, "fixture units did not load");
      must(briefText((a as { unit: Unit }).unit).endsWith(PLATFORM + "\n"), "a category 2 brief lacks the platform paragraph");
      writeFileSync(join(dir, "aaaaaa", "list.json"), JSON.stringify({ obvious: true, tasks: [] }));
      const bad = loadUnit(dir, "aaaaaa");
      must("problems" in bad, "a list with no tasks loaded");
      return "category 1 and 2 fixtures load; an empty list is refused: " + (bad as { problems: string[] }).problems[0];
    }),
  "owner channel": async () => {
    const asked: string[] = [];
    const loop = ownerLoop({ ask: async (q) => (asked.push(q), { text: "Saturdays only.\nSOURCE: profile" }), limit: 1 });
    const a = await loop.nextUser(["Which day do you bake?"]);
    const b = await loop.nextUser(["And how many orders?"]);
    const c = await loop.nextUser(["Thanks, finishing."]);
    must("reply" in a && a.reply === "Saturdays only.", "the SOURCE line reached the agent: " + JSON.stringify(a));
    must("reply" in b && b.reply === OWNER_CLOSING, "the limit did not send the closing message");
    must("end" in c && loop.state.ended === "closing", "the reply to the closing message did not end the session");
    const g = ownerLoop({ ask: async () => ({ text: "Go with the recommendation.\nSOURCE: recommended" }), gatePending: () => true });
    const gate = await g.nextUser(["The plan waits at its approval gate."]);
    const none = await ownerLoop({ ask: async () => ({ text: "x" }) }).nextUser(["Here is the plan."]);
    const failed = ownerLoop({ ask: async () => ({ failed: "allowance", detail: "E_ALLOWANCE" }) });
    const f = await failed.nextUser(["Which day?"]);
    must("reply" in gate && g.state.turns[0]!.gate && g.state.turns[0]!.source === "recommended", "a waiting gate did not reach the owner");
    must("end" in none, "a reply with no question did not end the session");
    must("stop" in f && f.stop.kind === "missing", "a failed responder call did not stop the session");
    must(splitSource("I don't know.\nSOURCE: unknown").source === "unknown" && splitSource("No tag").source === "untagged", "source tags misread");
    const long: string[] = [];
    await ownerLoop({ ask: async (q) => (long.push(q), { text: "Yes.\nSOURCE: profile" }) }).nextUser(["x".repeat(QUESTION_CHARS + 2000) + " Shall I go on?"]);
    must(long[0]!.length === QUESTION_CHARS && long[0]!.endsWith("Shall I go on?"), "the question is not the asking reply's last " + QUESTION_CHARS + " characters");
    const dropped = ownerLoop({ ask: async () => fail("the responder was called with the channel dropped"), gatePending: () => true, dropped: true });
    const dg = await dropped.nextUser(["The plan waits at its approval gate."]);
    const askedGate = ownerLoop({ ask: async () => ({ text: "Go with the recommendation.\nSOURCE: recommended" }), gatePending: () => true });
    const ag = await askedGate.nextUser(["Do you approve the recommended plan?"]);
    must("reply" in ag && askedGate.state.turns[0]!.gate, "a gate whose text asks a question was not logged as the gate with the channel on");
    const droppedAsk = ownerLoop({ ask: async () => fail("the responder was called with the channel dropped"), gatePending: () => true, dropped: true });
    const dag = await droppedAsk.nextUser(["Do you approve the recommended plan?"]);
    must("reply" in dag && dag.reply === GATE_REPLY && droppedAsk.state.turns[0]!.gate, "a gate whose text asks a question did not get the fixed reply with the channel dropped");
    const dq = await ownerLoop({ ask: async () => fail("the responder was called with the channel dropped"), dropped: true }).nextUser(["Which day do you bake?"]);
    must("reply" in dg && dg.reply === GATE_REPLY && dropped.state.turns[0]!.source === "recommended" && dropped.state.turns[0]!.gate, "a dropped channel did not answer the gate with the fixed reply, logged as recommended");
    must("end" in dq, "a dropped channel answered a question");
    const undecided = { text: "I don't know, use your judgment.\nSOURCE: unknown" };
    const gd = ownerLoop({ ask: async () => undecided, gatePending: () => true });
    const gdr = await gd.nextUser(["Reply approve or build it. Which do you want?"]);
    const nogate = await ownerLoop({ ask: async () => undecided }).nextUser(["Reply approve or build it. Which do you want?"]);
    must("reply" in gdr && gdr.reply === GATE_REPLY && gd.state.turns[0]!.source === "gate-default" && "reply" in nogate && nogate.reply !== GATE_REPLY, "an undecided options ask at a waiting gate did not get the gate default, or one with no gate did");
    return "answer with its source cut, closing at the limit, gate question, no question ends, failed call stops, the whole asking reply up to " + QUESTION_CHARS + " characters; an undecided options ask at a waiting gate gets \"" + GATE_REPLY + "\" as gate-default; dropped: the gate gets \"" + GATE_REPLY + "\" as recommended and a question ends";
  },
  "session outcomes": () => {
    const base: AttemptRead = { termination: { kind: "completed" }, web: 0, gstack_reads: [], contained: [], micros: 0, voice: null, out: "/x" };
    const o = (a: Partial<AttemptRead>, owner: Parameters<typeof attemptOutcome>[1] = null) => attemptOutcome({ ...base, ...a }, owner).state;
    must(o({}) === "ended" && o({ termination: { kind: "timeout" } }) === "ended" && o({ termination: { kind: "turn_cap" } }) === "ended", "an arm's own stop is not an end");
    must(o({ termination: { kind: "cap_stop" } }) === "cap", "a cap stop is not a cap");
    must(o({ contained: ["env name X_KEY"] }) === "halt", "a containment departure does not halt");
    must(o({ web: 1 }) === "contaminated" && o({ gstack_reads: ["Read gstack"] }) === "contaminated", "web or gstack reads are not contamination");
    must(o({ contained: null }) === "retry" && o({ termination: { kind: "infra", incident: "x" } }) === "retry", "infra is not a retry");
    must(o({}, { reason: "allowance", detail: "" }) === "missing" && o({}, { reason: "provider", detail: "" }) === "retry", "responder failures misread");
    must(settle({ state: "retry", why: "x" }, 2).state === "missing", "a second retry is not a gap");
    return "end, cap, halt, contaminated, retry and the one-retry gap";
  },
  "verdicts": () => {
    const ids = ["t1", "t2", "t3"];
    const block = (o: unknown) => "```verdicts\n" + JSON.stringify(o) + "\n```";
    const ok = parseVerdicts(["x " + block({ tasks: ids.map((id) => ({ id, done: id === "t2" })) })], ids);
    must(ok.kind === "ok", "a good block failed");
    for (const bad of [block({ tasks: [{ id: "t1", done: true }] }), block({ tasks: ids.map((id) => ({ id, done: "yes" })) }), block({ tasks: [...ids, "t1"].map((id) => ({ id, done: true })) }), "no block"]) must(parseVerdicts([bad], ids).kind === "bad", "a bad block parsed: " + bad.slice(0, 60));
    const list = { tasks: ids.map((id, i) => ({ id, rank: i + 1, task: "t", success: "s", data: null, from: "brief" as const, support: "s" })) };
    const notStarted = scoreBuild(list, false, null);
    const unparsable = scoreBuild(list, true, { kind: "bad", reason: "x" });
    const scored = scoreBuild(list, true, ok);
    must(notStarted.share === 0 && notStarted.nothing_useful === true, "a build that never started is not zero");
    must(unparsable.share === null, "an unparsable verdict scored");
    must(scored.share === 1 / 3 && scored.nothing_useful === false, "the share is wrong");
    must(checkPrompt(list).startsWith(CHECK_HEADER) && checkPrompt(list).endsWith(CHECK_FOOTER), "the checker prompt is not header, tasks, footer");
    return "ok block, four bad blocks refused, not started scores 0, unparsable unscored, share 1/3";
  },
  "readings": () => {
    must(decide(iv(0.1, 0.3), iv(-0.1, 0.1), iv(0.05, 0.2)) === "keep", "keep");
    must(decide(iv(0.1, 0.3), iv(0.1, 0.3), iv(-0.1, 0.1)) === "slim", "slim");
    must(decide(iv(-0.1, 0.15), iv(-0.1, 0.15), iv(-0.1, 0.1)) === "cut", "cut with both upper ends under the MDD");
    must(decide(iv(-0.1, 0.2), iv(-0.1, 0.2), iv(-0.1, 0.1)) === "undecided", "a null whose upper end reaches the MDD read cut");
    must(decide(iv(0.05, 0.3), iv(-0.05, 0.2), iv(-0.1, 0.2)) === "undecided", "undecided");
    const none = paired(new Map(), new Map());
    must(decide(none, none, none) === "undecided" && decide(iv(-0.1, 0.1, 11), iv(-0.1, 0.1, 11), iv(-0.1, 0.1, 11)) === "undecided" && decide(iv(0.1, 0.3, 11), iv(0.1, 0.3), iv(0.05, 0.2)) === "undecided", "no data or under 12 briefs did not read undecided");
    must(source(iv(0.05, 0.3), iv(-0.1, 0.1), iv(0.1, 0.3)) === "wording", "wording");
    must(source(iv(-0.1, 0.1), iv(0.05, 0.3), iv(0.05, 0.3)) === "second-pass", "second pass");
    must(source(iv(-0.1, 0.1), iv(-0.1, 0.1), iv(-0.1, 0.1)) === "neither", "neither");
    must(source(iv(-0.1, 0.25), iv(0.05, 0.3), iv(-0.05, 0.3)) === "undecided" && source(iv(0.05, 0.3, 11), iv(-0.1, 0.1), iv(0.1, 0.3)) === "undecided", "source undecided");
    const b = (unit: string, arm: "n" | "d" | "a", done: boolean[] | null, more: Partial<ScoredBuild> = {}): ScoredBuild => ({ unit, rep: 1, arm, done, empty_plan: false, contaminated: false, implied: [false, false, true, true, false], obvious: false, ...more });
    const builds = ["u1", "u2", "u3", "u4"].flatMap((u, i) => [b(u, "n", [true, false, false, false, false]), b(u, "d", [true, true, i > 0, false, false]), b(u, "a", i === 3 ? null : [true, true, true, true, false], i === 2 ? { empty_plan: true } : {})]);
    const r = read(builds, ["n", "d", "a"]);
    const again = paired(new Map([["u1", 0.4], ["u2", 0.6]]), new Map([["u1", 0.2], ["u2", 0.2]]));
    must(r.comparisons["a-n"]!.briefs === 3 && r.excluded.length === 1, "the unscored A build was not dropped from its pair");
    must(r.arms["a"]!.briefs === 3 && r.comparisons["d-n"]!.briefs === 4, "brief counts are wrong");
    must(JSON.stringify(again) === JSON.stringify(paired(new Map([["u1", 0.4], ["u2", 0.6]]), new Map([["u1", 0.2], ["u2", 0.2]]))), "the bootstrap is not seeded");
    must(r.r107 === "undecided" && r.excluded_counts["a"]!["unscored build"] === 1, "a short reading was not undecided, or exclusions were not counted by arm and cause");
    must(read(builds, ["n", "d", "a"], ["no validation"]).r107 === "not counted", "a reading with a failed gate counted");
    return "keep, slim, cut (both upper ends under the MDD) and undecided; no data or under 12 briefs undecided; wording, second pass, neither and undecided; not counted without its gates; an empty plan scores 0; an unscored build leaves its pair; MDD " + r.mdd + " at " + r.comparisons["a-n"]!.briefs + " briefs";
  },
  "judge": async () => {
    const checks = [{ id: "c1", kind: "ask" as const, statement: "s", covered_if: "c", usable_if: "u", from_brief: "implied" as const, rank: 1, role: "primary" as const }, { id: "c2", kind: "ask" as const, statement: "s2", covered_if: "c", usable_if: "u", from_brief: "implied" as const, rank: 2, role: "secondary" as const }];
    const { packets: ps, keys } = packets([{ key: "n/r1", brief: "b", plan: "p", checks }, { key: "a/r1", brief: "b", plan: "q", checks }]);
    must(Object.keys(keys).length === 2 && ps.every((p) => !p.label.includes("n/") && !p.label.includes("a/")), "packet labels name their source");
    const block = (items: unknown[]) => "```labels\n" + JSON.stringify({ items }) + "\n```";
    const part = parseLabels(block([{ id: "c1", covered: false, usable: true }]), ["c1", "c2"]);
    must(part.kind === "bad" && part.labels[0]!.usable === false, "usable without covered was kept, or a missing cell passed");
    let sends = 0;
    const r = await labelPacket(ps[0]!, async () => (++sends === 1 ? { text: "garbled" } : { text: block([{ id: "c1", covered: true, usable: true }, { id: "c2", covered: false, usable: false }]) }));
    must(sends === 2 && r.resent && !r.missing.length, "the resend did not replace a garbled answer");
    const twice = await labelPacket(ps[0]!, async () => ({ text: block([{ id: "c1", covered: true, usable: true }, { id: "c1", covered: false, usable: false }, { id: "c2", covered: false, usable: false }]) }));
    must(twice.missing.join() === "c1" && twice.labels.length === 1 && twice.labels[0]!.id === "c2", "a check labelled twice after the resend kept a label");
    const stock = controls({ stock: [{ checks, labels: [{ id: "c1", covered: true, usable: false }] }], volume: [] });
    must(!stock.passed, "a stock plan covering a primary check passed");
    const many = Array.from({ length: 40 }, () => ({ checks, labels: [{ id: "c1", covered: false, usable: false }] as Label[] }));
    many[0]!.labels = [{ id: "c1", covered: true, usable: true }];
    const pair = [{ base: [{ id: "c1", covered: true, usable: true }], padded: [{ id: "c1", covered: true, usable: true }] }];
    must(controls({ stock: many, volume: pair }).passed && !controls({ stock: many.map((s, i) => (i < 3 ? { checks, labels: [{ id: "c1", covered: true, usable: true }] } : s)), volume: pair }).passed, "the stock control's 5% tolerance misread");
    must(!controls({ stock: [], volume: pair }).passed && !controls({ stock: many, volume: [] }).passed && !controls({ stock: [...many, { checks, labels: [] }], volume: pair }).passed && !controls({ stock: many, volume: [...pair, { base: pair[0]!.base, padded: [] }] }).passed, "a control with no stock checks, an unlabelled stock check, no volume pair or an empty padded packet passed");
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: "c" + i, covered: i % 2 === 0, usable: false }));
    must(controls({ stock: many, volume: [{ base: eight, padded: eight.map((x) => ({ ...x })) }] }).passed && !controls({ stock: many, volume: [{ base: eight, padded: [{ ...eight[0]! }] }] }).passed, "a padded packet with most checks unlabelled passed the volume control, or a whole agreeing packet failed it");
    const l = (covered: boolean): Label => ({ id: "c1", covered, usable: covered });
    const gold = new Map<string, Label>(Array.from({ length: 40 }, (_, i) => ["k" + i, l(i % 2 === 0)]));
    must(goldAgreement(new Map(gold), gold).admitted && !goldAgreement(new Map([...gold].slice(0, 39)), gold).admitted, "gold admission ignores the 40-pair floor");
    must(stockPlan().startsWith("# Plan"), "the stock plan did not load");
    return "blind labels, usable needs covered, one resend, a check labelled twice stays unlabelled, stock control with its 5% tolerance, gold floor of 40";
  },
  "stage runner": () =>
    withTmp(async (dir) => {
      const units = join(dir, "units");
      fixtureUnit(units, "aaaaaa", 2);
      fixtureUnit(units, "bbbbbb", 2);
      const us = ["aaaaaa", "bbbbbb"].map((id) => (loadUnit(units, id) as { unit: Unit }).unit);
      const out = join(dir, "out");
      const closed = { n: 0 };
      const base = await stageRun(out, us, "base", ["n", "d", "r"], 100, {}, closed);
      const review = await stageRun(out, us, "review", ["n", "d", "r"], 100, {}, closed);
      const stale = join(buildDir(out, "aaaaaa", 1, "n"), "tree.partial");
      mkdirSync(stale, { recursive: true });
      writeFileSync(join(stale, "stale.txt"), "left by a crash");
      const build = await stageRun(out, us, "build", ["n", "d", "r"], 100, {}, closed);
      must(existsSync(join(buildDir(out, "aaaaaa", 1, "n"), "tree", "start.sh")) && !existsSync(join(buildDir(out, "aaaaaa", 1, "n"), "tree", "stale.txt")) && !existsSync(stale), "a build was not moved into place whole after its row, or a crash's partial copy leaked into it");
      const check = await stageRun(out, us, "check", ["n", "d", "r"], 100, {}, closed);
      must(base.rows.length === 2 && review.rows.length === 4 && build.rows.length === 6 && check.rows.length === 6, "rows: " + [base, review, build, check].map((r) => r.rows.length).join("/"));
      must(base.rows.every((r) => r.owner?.counts.questions === 1 && r.owner.counts.profile === 1), "the owner channel was not logged");
      must(check.rows.every((r) => r.check?.score.share === 0.4), "the check score is not 2 of 5");
      must(closed.n === 4, "a rig was left open");
      const admDir = join(dir, "admission");
      const adm = await stageRun(admDir, us, "base", ["n"], 20);
      must(adm.stops.some((s) => s.code === "E_DAYONE_ADMISSION" && /smaller --parallel/.test(s.message)) && !adm.rows.length, "a round over the launch's room ran, or its stop named no fix");
      const resumed = await stageRun(admDir, us, "base", ["n"], 20, {}, { n: 0 }, { parallel: 1 });
      must(resumed.rows.length === 2 && !resumed.stops.length, "an admission stop did not resume at --parallel 1");
      const leased = await stageRun(join(dir, "lease-short"), us, "base", ["n"], 100, {}, { n: 0 }, { lease: 20e6 });
      must(leased.stops.some((s) => s.code === "E_DAYONE_ADMISSION") && !leased.stops.some((s) => s.code === "CAP_STOP") && !leased.rows.length, "a round over what the lease holds (the item had less left than --spend-cap) was admitted instead of stopping for admission");
      const capDir = join(dir, "cap");
      const cap = await stageRun(capDir, us, "base", ["n"], 100, { launch: stubLaunch({ capStop: true }) });
      must(cap.stops.some((s) => s.code === "CAP_STOP"), "a session's cap stop did not stop the launch");
      let refused = "";
      await stageRun(capDir, us, "base", ["n"], 100).catch((e) => (refused = String(e.message)));
      must(/cap stop/.test(refused), "a launch after a cap stop was not refused");
      let changed = "";
      await stageRun(out, us, "base", ["n", "d", "a"], 100).catch((e) => (changed = String(e.message)));
      must(/another manifest/.test(changed), "a changed manifest was not refused");
      const seen: LaunchInput[] = [];
      const again = await stageRun(out, us, "review", ["n", "d"], 100, { launch: stubLaunch({ seen }) }, { n: 0 }, { tag: "again" });
      must(!again.rows.length && !seen.length && existsSync(planFile(out, "aaaaaa", 1, "d")), "a second tag ran cells whose plans another launch wrote");
      const dropSeen: LaunchInput[] = [];
      const dropped = await stageRun(join(dir, "dropped"), us, "base", ["n"], 100, { launch: stubLaunch({ dropped: true, seen: dropSeen }) }, { n: 0 }, { ownerChannel: false, ownerCap: 0 });
      must(dropped.rows.length === 2 && dropSeen.every((l) => !l.prompt.includes(OWNER_NOTICE)) && dropped.rows.every((r) => r.owner?.counts.questions === 0), "a dropped channel kept the notice or answered a question");
      const reDir = join(dir, "re");
      mkdirSync(join(reDir, "base-dry", "sessions", "aaaaaa", "r1", "n", "a1"), { recursive: true });
      writeFileSync(join(reDir, "base-dry", "sessions", "aaaaaa", "r1", "n", "a1", "attempt.json"), "{}\n");
      const re = await stageRun(reDir, us.slice(0, 1), "base", ["n"], 100);
      must(re.rows[0]!.attempts.length === 2 && re.rows[0]!.attempts[0]!.outcome === "retry", "a crash marker was not counted as an infra failure");
      const vDir = join(dir, "voice-crash");
      const vLedger = join(dir, "crash-ledger.sqlite");
      const local = openLocalLedger(ledgerPath(vLedger));
      try {
        const record = join(dir, "crash-record");
        recordApproval(record, { action: "init", item: "day1-plans", cap_micros: 10e6, quotes: [{ words: "dry run on a temporary ledger", by: "day-one dryrun", source: "section 12" }], admission: "warn" });
        const lease = openLease(record, local, { item: "day1-plans", run_id: DAYONE_RUN, requireAdmission: () => null });
        const cell = { run_id: DAYONE_RUN, arm: "n", task: "aaaaaa-r1", model: "claude-opus-5-5", trial: 1, attempt: 1 };
        must((await local.reserve({ idempotency_key: "crash-plan", lease_id: lease.lease_id, cell: { ...cell, meter_id: "mp" }, max_micros: 2e6 })).ok && (await local.reserve({ idempotency_key: "crash-voice", lease_id: lease.lease_id, cell: { ...cell, arm: "n-voice", meter_id: "mv" }, max_micros: 3e6 })).ok, "the crash ledger refused a reservation");
        const a1 = join(vDir, "base-dry", "sessions", "aaaaaa", "r1", "n", "a1");
        mkdirSync(a1, { recursive: true });
        writeFileSync(join(a1, "attempt.json"), "{}\n");
        writeFileSync(join(a1, "meter.json"), JSON.stringify({ meter_id: "mp", voice_meter_id: "mv", lease_id: lease.lease_id }) + "\n");
      } finally {
        local.close();
      }
      const vre = await stageRun(vDir, us.slice(0, 1), "base", ["n"], 100, {}, { n: 0 }, { ledger: vLedger });
      const crashed = vre.rows[0]!.attempts[0]!;
      must(crashed.usd === 2 && crashed.voice_usd === 3 && vre.voice_micros === 3e6, "a crashed attempt's held spend was not split by meter (planner $" + crashed.usd + ", voice $" + crashed.voice_usd + ", stage voice " + vre.voice_micros + " micros)");
      const halt = await stageRun(join(dir, "halt"), us, "base", ["n"], 100, { launch: stubLaunch({ leak: true }) });
      must(halt.stops.some((s) => s.code === "E_DAYONE_LEAK"), "a containment departure did not halt");
      const haltMark = JSON.parse(readFileSync(join(dir, "halt", "base-dry", "stops.json"), "utf8")) as { stops: { code: string }[] };
      must(haltMark.stops.some((s) => s.code === "E_DAYONE_LEAK"), "the halt was not written to stops.json");
      let relaunched = "admitted";
      const relaunchSeen: LaunchInput[] = [];
      await stageRun(join(dir, "halt"), us, "base", ["n"], 100, { launch: stubLaunch({ seen: relaunchSeen }) }).catch((e) => (relaunched = String((e as Error).message)));
      must(/halted/.test(relaunched) && !relaunchSeen.length, "a relaunch after a containment halt started a session: " + relaunched);
      const markDir = join(dir, "halt-mark");
      await stageRun(markDir, us.slice(0, 1), "base", ["n"], 100, { launch: stubLaunch({ leak: true }), crash: (p) => { if (p === "row") throw new Error("killed after the halt row"); } }, { n: 0 }, { parallel: 1 }).catch(() => {});
      let markRelaunch = "admitted";
      await stageRun(markDir, us.slice(0, 1), "base", ["n"], 100).catch((e) => (markRelaunch = String((e as Error).message)));
      must(/halt/.test(markRelaunch), "a runner killed right after a halt left a dir a relaunch could run in: " + markRelaunch);
      for (const point of ["partials", "pending", "published"] as CrashPoint[]) {
        const hDir = join(dir, "halt-kill", point);
        await stageRun(hDir, us.slice(0, 1), "base", ["n"], 100, { launch: stubLaunch({ leak: true }), crash: (p) => { if (p === point) throw new Error("killed at " + p); } }, { n: 0 }, { parallel: 1 }).catch(() => {});
        const hSeen: LaunchInput[] = [];
        let first: string;
        try {
          const r = await stageRun(hDir, us.slice(0, 1), "base", ["n"], 100, { launch: stubLaunch({ seen: hSeen }) }, { n: 0 }, { parallel: 1 });
          first = r.stops.map((s) => s.code).join(",") || "ran";
        } catch (e) {
          first = String((e as Error).message);
        }
        let second = "admitted";
        await stageRun(hDir, us.slice(0, 1), "base", ["n"], 100, { launch: stubLaunch({ seen: hSeen }) }, { n: 0 }, { parallel: 1 }).catch((e) => (second = String((e as Error).message)));
        must(/E_DAYONE_LEAK|halt/.test(first) && /halt/.test(second) && !hSeen.length, "a halting cell killed at " + point + " let a relaunch run past the halt: " + JSON.stringify({ first, second, sessions: hSeen.length }));
      }
      const one = us.slice(0, 1);
      for (const st of ["base", "build"] as const)
        for (const point of ["partials", "pending", "published", "row"] as CrashPoint[]) {
          const kDir = join(dir, "kill", st, point);
          if (st === "build") await stageRun(kDir, one, "base", ["n"], 100, {}, { n: 0 }, { parallel: 1 });
          let killed = false;
          await stageRun(kDir, one, st, ["n"], 100, { crash: (p) => { if (p === point) throw new Error("killed at " + p); } }, { n: 0 }, { parallel: 1 }).catch(() => (killed = true));
          const restartSeen: LaunchInput[] = [];
          await stageRun(kDir, one, st, ["n"], 100, { launch: stubLaunch({ seen: restartSeen }) }, { n: 0 }, { parallel: 1 });
          const rows = readFileSync(join(kDir, st + "-dry", "rows.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { attempts: { usd: number }[]; usd: number; plan: { sha256: string } | null });
          const tree = join(buildDir(kDir, "aaaaaa", 1, "n"), "tree");
          const files = st === "base" ? existsSync(planFile(kDir, "aaaaaa", 1, "n")) && createHash("sha256").update(readFileSync(planFile(kDir, "aaaaaa", 1, "n"), "utf8")).digest("hex") === rows[0]!.plan!.sha256 : existsSync(join(tree, "start.sh")) && !existsSync(tree + ".partial") && treeDigest(tree).length === 64;
          const adopted = point !== "partials";
          must(killed && rows.length === 1 && files && rows[0]!.usd === 1 && restartSeen.length === (adopted ? 0 : 1) && rows[0]!.attempts.length === (adopted ? 1 : 2), "a " + st + " cell killed at " + point + " did not end done with its files, with one row, charged once and " + (adopted ? "adopted without a rerun" : "run again") + ": " + JSON.stringify({ killed, rows: rows.length, files, usd: rows[0]?.usd, reruns: restartSeen.length }));
        }
      const cutDir = join(dir, "cut-row");
      await stageRun(cutDir, one, "base", ["n"], 100, { crash: (p) => { if (p === "published") throw new Error("killed mid-append"); } }, { n: 0 }, { parallel: 1 }).catch(() => {});
      const cutStage = join(cutDir, "base-dry");
      const pendingRow = (JSON.parse(readFileSync(join(cutStage, "pending", readdirSync(join(cutStage, "pending"))[0]!), "utf8")) as { row: unknown }).row;
      appendFileSync(join(cutStage, "rows.ndjson"), JSON.stringify(pendingRow).slice(0, 40));
      const cutSeen: LaunchInput[] = [];
      for (let k = 0; k < 2; k++) await stageRun(cutDir, one, "base", ["n"], 100, { launch: stubLaunch({ seen: cutSeen }) }, { n: 0 }, { parallel: 1 });
      const cutLines = readFileSync(join(cutStage, "rows.ndjson"), "utf8").split("\n").filter((l) => l.trim());
      must(cutLines.length === 1 && cutLines.every((l) => { try { return (JSON.parse(l) as { id: string }).id === "base/aaaaaa/r1/n"; } catch { return false; } }) && !cutSeen.length, "a row cut off mid-append lost its cell or ran it again: " + JSON.stringify({ lines: cutLines.length, reruns: cutSeen.length }));
      appendFileSync(join(cutStage, "rows.ndjson"), "not a row\n");
      let garbled = "admitted";
      await stageRun(cutDir, one, "base", ["n"], 100, {}, { n: 0 }, { parallel: 1 }).catch((e) => (garbled = String((e as Error).message)));
      must(/is not a row/.test(garbled), "a rows.ndjson line that is not a row was skipped silently");
      const rpDir = join(dir, "repair-kill");
      await stageRun(rpDir, one, "base", ["n"], 100, {}, { n: 0 }, { parallel: 1 });
      const rpRows = join(rpDir, "base-dry", "rows.ndjson");
      const intact = readFileSync(rpRows, "utf8");
      appendFileSync(rpRows, intact.slice(0, 40));
      let repairKilled = false;
      await stageRun(rpDir, one, "base", ["n"], 100, { crash: (p) => { if (p === "repair") throw new Error("killed mid-repair"); } }, { n: 0 }, { parallel: 1 }).catch(() => (repairKilled = true));
      const rpSeen: LaunchInput[] = [];
      await stageRun(rpDir, one, "base", ["n"], 100, { launch: stubLaunch({ seen: rpSeen }) }, { n: 0 }, { parallel: 1 });
      must(repairKilled && readFileSync(rpRows, "utf8") === intact && !rpSeen.length, "a kill during the cut-off repair lost finished rows or ran a cell again: " + JSON.stringify({ killed: repairKilled, intact: readFileSync(rpRows, "utf8") === intact, reruns: rpSeen.length }));
      const built = async (d: string) => {
        await stageRun(d, one, "base", ["n"], 100, {}, { n: 0 }, { parallel: 1 });
        await stageRun(d, one, "build", ["n"], 100, {}, { n: 0 }, { parallel: 1 });
      };
      const tDir = join(dir, "throw");
      await built(tDir);
      let stops = 0;
      let threw = false;
      await stageRun(tDir, one, "check", ["n"], 100, { launch: async () => { throw new Error("finalize failed"); }, app: { ...stubApp, stop: () => (stops++, []) } as never }, { n: 0 }, { parallel: 1 }).catch(() => (threw = true));
      must(threw && stops === 1, "a checker launch that threw left its browser container running (stops: " + stops + ")");
      const nbDir = join(dir, "no-browser");
      await built(nbDir);
      const nb = await stageRun(nbDir, one, "check", ["n"], 100, { launch: stubLaunch({ noBrowser: true }) }, { n: 0 }, { parallel: 1 });
      must(nb.rows[0]!.state === "missing" && nb.rows[0]!.code === "E_DAYONE_GAP" && nb.rows[0]!.attempts.length === 2 && nb.rows[0]!.check === null, "a checker whose browser never answered was not a retry and then a gap: " + JSON.stringify({ state: nb.rows[0]!.state, code: nb.rows[0]!.code, score: nb.rows[0]!.check?.score.share }));
      const lateDir = join(dir, "started-then-missed");
      await built(lateDir);
      let starts = 0;
      const late = await stageRun(lateDir, one, "check", ["n"], 100, { launch: stubLaunch({ noBrowser: true }), app: { ...stubApp, start: async () => (++starts === 1 ? stubApp.start({} as never) : { container: "c", mcpUrl: "http://c:8931/mcp", started: false, start_s: null, detail: "the app never answered on 3000 within 60 s", copy: "/nonexistent", build: "/nonexistent" }) } as never }, { n: 0 }, { parallel: 1 });
      must(late.rows[0]!.state === "missing" && late.rows[0]!.code === "E_DAYONE_APP" && late.rows[0]!.check === null, "a build whose app started on attempt 1 and missed the start window on attempt 2 was scored as does not start, not a gap: " + JSON.stringify({ state: late.rows[0]!.state, code: late.rows[0]!.code, share: late.rows[0]!.check?.score.share }));
      const neverDir = join(dir, "never-started");
      await built(neverDir);
      const never = await stageRun(neverDir, one, "check", ["n"], 100, { app: { ...stubApp, start: async () => ({ container: "c", mcpUrl: "http://c:8931/mcp", started: false, start_s: null, detail: "the app never answered on 3000 within 60 s", copy: "/nonexistent", build: "/nonexistent" }) } as never }, { n: 0 }, { parallel: 1 });
      must(never.rows[0]!.state === "scored" && never.rows[0]!.check?.started === false && never.rows[0]!.check?.score.share === 0 && never.rows[0]!.attempts.length === 2, "a build that never started on either attempt did not read does not start, no task done");
      const afDir = join(dir, "all-fail");
      await built(afDir);
      const af = await stageRun(afDir, one, "check", ["n"], 100, { launch: stubLaunch({ allFail: true }) }, { n: 0 }, { parallel: 1 });
      must(af.rows[0]!.state === "scored" && af.rows[0]!.check?.score.share === 0 && af.rows[0]!.attempts.length === 1, "a checker that used the browser and found no task done did not score 0");
      const haltSeen: LaunchInput[] = [];
      const haltAgain = await stageRun(join(dir, "halt"), us, "base", ["n"], 100, { launch: stubLaunch({ seen: haltSeen }) }, { n: 0 }, { tag: "again" });
      must(!haltAgain.rows.length && !haltSeen.length, "a second tag reran a cell another launch ended with a row and no plan");
      return "base, review (D and R), build and check end to end, the checker on the browser endpoint; an admission stop resumed at --parallel 1; a session cap stop and its refusal; a changed manifest refused; a second tag runs no cell another launch planned; a dropped channel sends no notice and answers no question; crash marker reconciled, a crashed attempt's held spend split between planner and voice; leak halts";
    }),
  "voice route": () =>
    withTmp(async (dir) => {
      const record = join(dir, "record");
      const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite")));
      const upstream: { auth: string | null; body: any }[] = [];
      try {
        recordApproval(record, { action: "init", item: "day1-plans", cap_micros: 10e6, quotes: [{ words: "dry run on a temporary ledger", by: "day-one dryrun", source: "section 12" }], admission: "warn" });
        const lease = openLease(record, local, { item: "day1-plans", run_id: DAYONE_RUN, requireAdmission: () => null });
        const events = [{ type: "response.created", response: { id: "r" } }, { type: "response.completed", response: { usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 } } } }];
        const proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: randomBytes(24).toString("hex"), journal: join(dir, "journal.ndjson"), retry: { attempts: 1, elapsed_ms: 1000 }, env: { OPENAI_API_KEY: "provider-key-never-in-a-container" }, fetch: async (_url, init) => {
          upstream.push({ auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
          return new Response(events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
        } });
        proxy.start();
        try {
          const cell = { run_id: DAYONE_RUN, arm: "a", task: "u-r1", model: "claude-opus-5-5", trial: 1, attempt: 1 };
          const planner = await proxy.bind({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 5e6 });
          const voice = await proxy.bind({ cell: { ...cell, arm: "a-voice" }, models: ["openai:gpt-6-astra"], allowance_micros: 5e6 });
          const call = (token: string | null) => fetch("http://127.0.0.1:" + proxy.port + "/" + voice.slot + "/openai/v1/responses", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ model: "gpt-6-astra", stream: true, input: "review this plan" }) });
          const none = await call(null);
          const other = await call(planner.token);
          must(none.status === 403 && other.status === 403 && upstream.length === 0, "a call without the voice bearer reached the provider (" + none.status + ", " + other.status + ")");
          const ok = await call(voice.token);
          await ok.text();
          const m = await proxy.finalize(voice.meter_id);
          const want = 800 * 10 + 200 * 1 + 300 * 50;
          must(ok.status === 200 && m.micros === want, "Astra usage metered " + m.micros + " micros, the usage fields price at " + want);
          must(upstream.length === 1 && upstream[0]!.auth === "Bearer provider-key-never-in-a-container", "the provider did not get the proxy's key");
          return "no bearer 403, the planner's bearer 403, the voice bearer 200; metered " + m.micros + " micros = 800 input at $10, 200 cached at $1, 300 output at $50 per million";
        } finally {
          proxy.stop();
        }
      } finally {
        local.close();
      }
    }),
  "one ledger lease per item": () =>
    withTmp(async (dir) => {
      const record = join(dir, "record");
      const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite")));
      try {
        const metered = ITEMS.filter((i) => i.metered);
        for (const i of metered) recordApproval(record, { action: "init", item: i.item, cap_micros: ledgerCapUsd(i.item) * 1e6, quotes: [{ words: "dry run on a temporary ledger", by: "day-one dryrun", source: "section 12" }], admission: "warn" });
        for (const i of metered) settleItem(record, local, leaseItem(record, local, i.item, { requireAdmission: () => null }).lease_id);
        let bound = "no refusal";
        try {
          openLease(record, local, { item: metered[0]!.item, run_id: "another-run", requireAdmission: () => null });
        } catch (e) {
          bound = (e as { code?: string }).code ?? "error";
        }
        must(bound !== "no refusal", "a second run id opened a lease on a bound item");
        const rRecord = join(dir, "resume-record");
        const rLocal = openLocalLedger(ledgerPath(join(dir, "resume.sqlite")));
        try {
          recordApproval(rRecord, { action: "init", item: "day1-plans", cap_micros: 20e6, quotes: [{ words: "dry run on a temporary ledger", by: "day-one dryrun", source: "section 12" }], admission: "warn" });
          const spend = async (lease_id: string, key: string, amount: number) => {
            const r = (await rLocal.reserve({ idempotency_key: key, lease_id, cell: { run_id: DAYONE_RUN, arm: "n", task: "aaaaaa-r1", model: "claude-opus-5-5", trial: 1, attempt: 1, meter_id: key } as never, max_micros: amount })) as { reservation: { reservation_id: string } };
            await rLocal.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: amount, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } } as never);
          };
          const first = openLease(rRecord, rLocal, { item: "day1-plans", run_id: DAYONE_RUN, amount_micros: leaseAmount(rRecord, "day1-plans", 20e6), requireAdmission: () => null });
          await spend(first.lease_id, "r1", 1e6);
          settleItem(rRecord, rLocal, first.lease_id);
          let whole = "admitted";
          try {
            settleItem(rRecord, rLocal, openLease(rRecord, rLocal, { item: "day1-plans", run_id: DAYONE_RUN, amount_micros: 20e6, requireAdmission: () => null }).lease_id);
          } catch (e) {
            whole = (e as { code?: string }).code ?? "error";
          }
          const resumed = openLease(rRecord, rLocal, { item: "day1-plans", run_id: DAYONE_RUN, amount_micros: leaseAmount(rRecord, "day1-plans", 20e6), requireAdmission: () => null });
          must(whole === "CAP_STOP" && resumed.reserved_micros === 19e6, "a resume after $1 of a $20 item did not lease the $19 left (the whole $20: " + whole + ")");
          await spend(resumed.lease_id, "r2", 19e6);
          settleItem(rRecord, rLocal, resumed.lease_id);
          let spent = "admitted";
          try {
            openLease(rRecord, rLocal, { item: "day1-plans", run_id: DAYONE_RUN, amount_micros: leaseAmount(rRecord, "day1-plans", 20e6), requireAdmission: () => null });
          } catch (e) {
            spent = (e as { code?: string }).code ?? "error";
          }
          must(spent === "CAP_STOP", "a resume on a spent item was admitted");
        } finally {
          rLocal.close();
        }
        const caps = ITEMS.reduce((a, i) => a + i.capUsd, 0);
        must(caps === ALL_IN_USD, "the caps total $" + caps + ", not the all-in $" + ALL_IN_USD);
        const thin = ITEMS.filter((i) => i.capUsd < i.projectionUsd + i.headroomUsd || i.capUsd < Math.ceil(i.projectionUsd * 1.15)).map((i) => i.item);
        must(!thin.length, "caps below their projection plus headroom or 15%: " + thin.join(", "));
        const projection = ITEMS.reduce((a, i) => a + i.projectionUsd, 0);
        return "caps total $" + caps + " over a $" + projection + " projection, every cap at least 15% and its headroom over its line ($" + HEADROOM_USD + " of headroom in all); " + metered.length + " items, " + metered.length + " leases opened and settled on " + DAYONE_RUN + "; a second run: " + bound;
      } finally {
        local.close();
      }
    }),
  "shrink order": () => {
    const s = shrink(4400, [81, 81, 420]);
    const r = shrink(5200, [81, 81, 420]);
    must("steps" in s && s.steps === 2 && "ruling" in r, "the shrink order misapplied");
    return "4,400 takes 2 steps to " + s.projected + " (plus $" + HEADROOM_USD + " headroom, within $" + ALL_IN_USD + "); 5,200 needs a ruling";
  },
  "smoke admission": () => {
    const units = ["p1", "p2", "p3"].map((id) => ({ id, category: 2 }) as Unit);
    const price = (c: { stage: Stage; arm: string }) => (c.stage === "build" ? PLANNING_PRICES.build : c.stage === "check" ? PLANNING_PRICES.check : c.arm === "a" ? PLANNING_PRICES.gstack + PLANNING_PRICES.voice : PLANNING_PRICES[c.arm as "n" | "d" | "r"]);
    const built = (c: { unit: string; arm: string }) => (c.unit === "p1" && ["n", "d", "a"].includes(c.arm)) || (c.unit === "p2" && ["n", "a"].includes(c.arm));
    const launches = [stageCells("base", units, [1], ["n"]), stageCells("review", units, [1], ["d", "r", "a"]), stageCells("build", units, [1], ["n", "d", "a"]).filter(built), stageCells("check", units, [1], ["n", "d", "a"]).filter(built), ["placeholder", "reference"].map((app) => ({ stage: "check" as Stage, unit: "fix", rep: 1, arm: app as never }))];
    const replay = (cap: number): string | number => {
      let left = cap;
      for (const cells of launches) {
        let spent = 0;
        for (const c of cells) {
          const lim = cellLimits(c);
          if (spent + 2 * (lim.usd + lim.voice_usd) > left) return c.stage + "/" + c.unit + "/" + c.arm;
          spent += price(c);
        }
        left -= spent;
      }
      return left;
    };
    const cap = itemOf("day1-smoke").capUsd;
    const left = replay(cap);
    const old = replay(230);
    must(typeof left === "number" && typeof old === "string", "day1-smoke's $" + cap + " stopped at " + left + ", or $230 admitted the smoke");
    return "day1-smoke's $" + cap + " admits every smoke round at --parallel 1 at planning prices, $" + Math.round((cap - (left as number)) * 100) / 100 + " spent and $" + Math.round((left as number) * 100) / 100 + " left; $230 stops at " + old;
  },
  "exposure": () =>
    withTmp((dir) => {
      const call = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "gstack-autoplan next --out " + WORK + "/r --plan " + PLAN + " --full" } }] } }) + "\n";
      const run = (outside: string, transcript = call) => {
        const d = join(dir, outside + (transcript ? "" : "-planted"));
        mkdirSync(join(d, "r"), { recursive: true });
        const phase = { closed_at: "2026-11-17T00:00:00Z", native: { status: "completed" }, outside: { status: outside } };
        writeFileSync(join(d, "r", "run.json"), JSON.stringify({ status: "complete", plan_input: PLAN, updated_at: "2026-11-17T00:00:00Z", phases: { ceo: phase, design: { skipped: true }, eng: phase } }));
        return readExposure(findRun([{ dir: d, seen: WORK }], transcript), 3);
      };
      const ok = run("completed");
      const disabled = run("disabled");
      const skipped = run("skipped");
      const unavailable = run("unavailable");
      must(ok.exposed && ok.voice === "astra", "a complete run with both voices was not exposed on astra");
      must(!disabled.exposed && /disabled/.test(disabled.why) && !skipped.exposed && /skipped/.test(skipped.why), "a disabled or skipped outside voice read exposed");
      must(unavailable.exposed && unavailable.voice === "fallback", "an unavailable outside voice did not read exposed on the fallback");
      const planted = run("completed", "");
      must(!planted.exposed && planted.run === null, "a run.json that no gstack-autoplan call wrote read exposed");
      const dated = join(dir, "dated");
      mkdirSync(join(dated, "r-1"), { recursive: true });
      writeFileSync(join(dated, "r-1", "run.json"), JSON.stringify({ status: "gate_pending", run: "r-1-x", plan_input: PLAN, created_at: "2026-11-17T00:00:01.500Z", updated_at: "2026-11-17T00:00:02Z" }));
      const start = (at: string) => JSON.stringify({ type: "assistant", timestamp: at, message: { content: [{ type: "tool_use", id: "b2", name: "Bash", input: { command: "R=r-$(date +%s); gstack-autoplan next --out " + WORK + '/"$R" --plan ' + PLAN + " > /dev/null" } }] } }) + "\n";
      const done = JSON.stringify({ type: "user", timestamp: "2026-11-17T00:00:01.800Z", message: { content: [{ type: "tool_result", tool_use_id: "b2", content: "" }] } }) + "\n";
      const made = findRun([{ dir: dated, seen: WORK }], start("2026-11-17T00:00:01.200Z") + done);
      const before = findRun([{ dir: dated, seen: WORK }], start("2026-11-17T00:00:01.600Z") + done);
      must(made.run !== null && made.unmatched === 0 && before.run === null && before.unmatched === 1, "a start was not tied to the run gstack created during its Bash call, or one that created no run was not counted");
      const state = join(dir, "state");
      mkdirSync(join(state, "r"), { recursive: true });
      mkdirSync(join(dir, "work"), { recursive: true });
      writeFileSync(join(dir, "outside.md"), "OUTSIDE plan");
      writeFileSync(join(state, "r", "inside.md"), "INSIDE plan");
      const plan = (active: string, runOut = "/") => {
        writeFileSync(join(state, "r", "run.json"), JSON.stringify({ updated_at: "2026-11-17T00:00:00Z", plan_input: PLAN, active_plan: active, out: runOut }));
        return armPlan(join(dir, "work"), "base", findRun([{ dir: state, seen: WORK }], call).run).text;
      };
      must(plan("r/inside.md") === "INSIDE plan" && !plan("../outside.md").includes("OUTSIDE") && !plan("/a/b/outside.md", "/a/b/c/d").includes("OUTSIDE"), "an autoplan plan outside the state root was read, or one inside it was not");
      return "both voices: exposed, astra; a disabled or skipped outside voice: not exposed, with the reason; unavailable: exposed on the fallback; a run.json no gstack-autoplan call wrote: not exposed; a --out from $(date) ties to the run created during the start's Bash call, and a start that created none counts as unmatched";
    }),
  "checker session setup": () =>
    withTmp(async (dir) => {
      const seen: any[] = [];
      const rig = { ...stubRig({ n: 0 }), sandbox: () => ({ homePath: () => "/home/agent", workPath: () => "/work/app", agent: () => fail("no container starts in the dry run") }) as never, finalize: async () => ({ micros: 0, requests: 0, refused: 0 }) as never } as HostRig;
      const go = async (arm: string, mcpUrl?: string, trial: unknown = async () => ({ record: { termination: { kind: "completed" } } })) => {
        const d = join(dir, arm);
        mkdirSync(d, { recursive: true });
        return launchSession({ rig, policy: policyOf(), docker: "docker", runId: DAYONE_RUN, arm, cell: "u-r1-" + arm, rep: 1, attempt: 1, model: arm === "check" ? MODELS.checker : MODELS.planner, dir: d, seed: null, prompt: "p", minutes: 1, turns: 1, allowanceMicros: 1e6, nextUser: async () => ({ end: true }), ...(mcpUrl ? { mcpUrl } : {}) }, { driver: ((o: unknown) => (seen.push(o), { env: {} })) as never, trial: trial as never });
      };
      await go("check", "http://c:8931/mcp");
      await go("n");
      must(seen[0]?.mcpServers?.browser?.url === "http://c:8931/mcp" && JSON.stringify(seen[0].onlyTools) === JSON.stringify(BROWSER_TOOLS), "the checker's driver did not get the browser server and the browser-only tool list");
      must(!seen[1]?.mcpServers && !seen[1]?.onlyTools, "a planner's driver got browser tools");
      const partial = await go("r", undefined, async () => {
        mkdirSync(join(dir, "r", "out"), { recursive: true });
        writeFileSync(join(dir, "r", "trial.json"), JSON.stringify({ logs: { copy_out: [".: plan.md: ENOSPC"] } }));
        return { record: { termination: { kind: "completed" } } };
      });
      must(partial.out === null, "a work tree with a failed copy-out was kept as complete");
      const ramRun = async (full: boolean) => {
        const opened: any[] = [];
        const session = { exec: (cmd: string) => ({ exitCode: 0, timedOut: false, stdout: cmd === RAM_FULL_CHECK && full ? "/home/agent\n" : "", stderr: "" }), spawn: () => fail("no process starts"), stop: () => {} };
        const ramRig = { ...rig, sandbox: () => ({ homePath: () => "/home/agent", workPath: () => "/work/app", agent: (_t: string, opts: unknown) => (opened.push(opts), session) }) as never } as HostRig;
        const d = join(dir, full ? "ram-full" : "ram-ok");
        mkdirSync(d, { recursive: true });
        const read = await launchSession({ rig: ramRig, policy: policyOf(), docker: "docker", runId: DAYONE_RUN, arm: "b", cell: "u-r1-b", rep: 1, attempt: 1, model: MODELS.builder, dir: d, seed: null, prompt: "p", minutes: 1, turns: 1, allowanceMicros: 1e6, nextUser: async () => ({ end: true }) }, { driver: (() => ({ env: {} })) as never, trial: (async (spec: { sandbox: { agent: (t: string, o: unknown) => { stop: () => void } } }) => { spec.sandbox.agent("t", { work: d, env: {} }).stop(); mkdirSync(join(d, "out"), { recursive: true }); return { record: { termination: { kind: "completed" } } }; }) as never });
        return { read, opened };
      };
      const ok = await ramRun(false);
      const full = await ramRun(true);
      must(ok.opened[0]?.ram?.size === RAM_SIZE && ok.read.termination.kind === "completed" && full.read.termination.kind === "infra" && /RAM-backed \/home\/agent filled/.test((full.read.termination as { incident: string }).incident), "a session did not get a RAM-backed HOME and /tmp, or a full one did not read as an infrastructure failure");
      const fullOutcome = attemptOutcome(full.read, null);
      must(settle(fullOutcome, 1).state === "retry" && settle(fullOutcome, 2).state === "missing" && (settle(fullOutcome, 2) as { code: string }).code === "E_DAYONE_GAP", "a full RAM-backed mount was not a retry and then a gap");
      return "the checker's driver gets the browser MCP server and only the " + BROWSER_TOOLS.length + " browser tools; a planner's gets neither";
    }),
  "fixtures with the real checker": () =>
    withTmp(async (dir) => {
      const launch = (doneFor: (app: string) => number) => async (l: LaunchInput): Promise<AttemptRead> => {
        must(l.arm === "check" && l.mcpUrl === "http://c:8931/mcp", "a fixture check was not a checker session on the browser endpoint");
        const app = l.cell.split("-").pop()!;
        await l.nextUser(["```verdicts\n" + JSON.stringify({ tasks: [1, 2, 3, 4, 5].map((i) => ({ id: "t" + i, done: i <= doneFor(app), why: "seen" })) }) + "\n```"]);
        return { termination: { kind: "completed" }, web: 0, gstack_reads: [], contained: [], micros: 2e6, voice: null, out: null };
      };
      const run = (out: string, reference: number) => runRealFixtures({ rig: stubRig({ n: 0 }), policy: policyOf(), docker: "docker", runId: DAYONE_RUN, out, volume: "vol", launch: launch((a) => (a === "reference" ? reference : 0)), app: stubApp, log: () => {} });
      const ok = await run(join(dir, "ok"), 5);
      const bad = await run(join(dir, "bad"), 4);
      must(ok.passed && JSON.parse(readFileSync(join(dir, "ok", "fixtures-real.json"), "utf8")).passed === true, "both fixtures at their bars did not pass, or wrote no receipt");
      must(!bad.passed && bad.apps[1]!.share === 0.8, "a reference app at 4 of 5 passed");
      return "placeholder 0 and reference 5 of 5 pass with a receipt; a reference at 4 of 5 fails";
    }),
  "app writes": () =>
    withTmp((dir) => {
      const build = join(dir, "build");
      const app = join(dir, "app");
      mkdirSync(join(build, "data"), { recursive: true });
      writeFileSync(join(build, "server.js"), "x");
      writeFileSync(join(build, "data", "plants.json"), JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ name: "Test plant " + i }))));
      writeFileSync(join(build, "data", "empty.json"), "[]");
      cpSync(build, app, { recursive: true });
      writeFileSync(join(app, "data", "plants.json"), "[]");
      writeFileSync(join(app, "data", "empty.json"), '[{"name":"Fern"}]');
      writeFileSync(join(app, "data", "log.json"), "[]");
      symlinkSync(".", join(app, "data", "loop"));
      const w = appWrites(build, app);
      const by = (p: string) => w.find((x) => x.path === join("data", p));
      must(w.length === 3 && by("plants.json")!.change === "changed" && by("plants.json")!.bytes_before > 64 && by("empty.json")!.bytes_before === 2 && by("log.json")!.change === "added", "the app's writes against the handed-off build misread: " + JSON.stringify(w));
      return "a store that held the builder's records, an empty store and a new file, each with its size at hand-off";
    }),
};

export async function runDryrun(io: Io): Promise<number> {
  let failed = 0;
  for (const [name, fn] of Object.entries(CASES)) {
    try {
      io.out("PASS " + name + ": " + (await fn()));
    } catch (e) {
      failed++;
      io.out("FAIL " + name + ": " + (e instanceof Fail ? e.message : String((e as Error).stack ?? e)));
    }
  }
  if (failed) io.err("E_DAYONE_DRYRUN day-one dryrun: " + failed + " case(s) failed");
  return failed ? 2 : 0;
}
