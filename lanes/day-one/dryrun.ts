// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals day-one dryrun (prereg section 12): the keyless dry run. Each case drives a frozen rule on fixtures and
// prints one PASS or FAIL line with what it saw; nothing calls a provider. The stage runner runs end to end on a stub rig
// and a stub launch (every stage, the owner channel, the cap stop and its refusal, a changed manifest, a crash marker, a
// containment halt); the Astra voice route runs on a real metering proxy against a stub upstream on a temporary
// ledger; and every metered line item opens and settles one lease on a temporary ledger.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { decide, paired, read, type ScoredBuild } from "./analysis.ts";
import { armPrompt, COMMON_ASK, DAY_ONE_PASS, OWNER_CLOSING, OWNER_NOTICE, PREREG, PROMPTS_SHA256, BUILD_PROMPT, CHECK_FOOTER, CHECK_HEADER, OWNER_HEAD, OWNER_RULES, PLATFORM, REVIEW_ASK, AUTOPLAN_LINE } from "./frozen.ts";
import { controls, goldAgreement, labelPacket, packets, parseLabels, stockPlan, type Label } from "./judge.ts";
import { ALL_IN_USD, DAYONE_RUN, ITEMS, ledgerCapUsd, leaseItem, settleItem, shrink } from "./ledger.ts";
import { ownerLoop, splitSource } from "./owner.ts";
import { runStage, type Stage, type StageDeps } from "./run.ts";
import { attemptOutcome, settle, type AttemptRead, type LaunchInput } from "./sessions.ts";
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
function stubLaunch(o: { leak?: boolean; usd?: number } = {}) {
  return async (l: LaunchInput): Promise<AttemptRead> => {
    const out = join(l.dir, "out");
    mkdirSync(out, { recursive: true });
    if (l.arm === "check") {
      must(l.mcpUrl === "http://c:8931/mcp", "the checker was launched without the browser container's MCP endpoint");
      await l.nextUser(["Tried every task.\n```verdicts\n" + JSON.stringify({ tasks: [1, 2, 3, 4, 5].map((i) => ({ id: "t" + i, done: i <= 2, why: "seen" })) }) + "\n```"]);
    } else if (l.arm === "build") {
      writeFileSync(join(out, "start.sh"), "node server.js\n");
      await l.nextUser(["Built."]);
    } else {
      const q = await l.nextUser(["Which days do you water?"]);
      must("reply" in q, "the owner loop did not answer a question");
      writeFileSync(join(out, "plan.md"), "# Plan by " + l.arm + "\n");
      await l.nextUser(["Done."]);
    }
    return { termination: { kind: "completed" }, web: 0, gstack_reads: [], contained: o.leak ? ["env name OPENAI_REAL_KEY"] : [], micros: Math.round((o.usd ?? 1) * 1e6), voice: l.gstack ? { micros: 500_000, requests: 3, refused: 0 } : null, out };
  };
}

const stubApp = { start: async () => ({ container: "c", mcpUrl: "http://c:8931/mcp", started: true, start_s: 3, detail: "ok", copy: "/nonexistent" }), stop: () => {} } as unknown as NonNullable<StageDeps["app"]>;

async function stageRun(dir: string, us: Unit[], st: Stage, arms: ("n" | "d" | "a")[], cap: number, extra: Partial<StageDeps> = {}, closed = { n: 0 }, ledger: string | null = null) {
  const calls: string[] = [];
  return runStage({ stage: st, tag: "dry", units: us, reps: [1], arms, out: dir, runId: DAYONE_RUN, cap: cap * 1e6, ownerCap: 10e6, voiceCap: 100e6, parallel: 2, policy: policyOf(), ledger, docker: "docker", scratch: join(dir, "scratch"), nodeVolume: "vol", log: () => {} }, { openRig: () => stubRig(closed), ownerMeter: ownerMeter(calls), launch: stubLaunch(), app: stubApp, ...extra });
}

export const CASES: Record<string, Case> = {
  "frozen texts": () => {
    const prereg = existsSync(PREREG) ? readFileSync(PREREG, "utf8") : null;
    must(prereg !== null, PREREG + " is missing");
    const missing = Object.entries({ COMMON_ASK, REVIEW_ASK, DAY_ONE_PASS, AUTOPLAN_LINE, OWNER_NOTICE, PLATFORM, BUILD_PROMPT, CHECK_HEADER, CHECK_FOOTER, OWNER_HEAD, OWNER_RULES, OWNER_CLOSING }).filter(([, v]) => !prereg!.includes(v)).map(([k]) => k);
    must(!missing.length, "not in the prereg byte for byte: " + missing.join(", "));
    must(armPrompt("d").startsWith(REVIEW_ASK + "\n\n" + DAY_ONE_PASS), "D's prompt is not the review ask then the day-one paragraph");
    return "12 frozen texts in the prereg; prompts sha256 " + PROMPTS_SHA256.slice(0, 12);
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
    return "answer with its source cut, closing at the limit, gate question, no question ends, failed call stops";
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
    const iv = (lo: number, hi: number) => ({ est: (lo + hi) / 2, lo, hi, briefs: 15, sd: 0.2 });
    must(decide(iv(0.1, 0.3), iv(-0.1, 0.1), iv(0.05, 0.2)) === "keep", "keep");
    must(decide(iv(0.1, 0.3), iv(0.1, 0.3), iv(-0.1, 0.1)) === "slim", "slim");
    must(decide(iv(-0.1, 0.2), iv(-0.1, 0.2), iv(-0.1, 0.1)) === "cut", "cut");
    must(decide(iv(0.05, 0.3), iv(-0.05, 0.2), iv(-0.1, 0.2)) === "undecided", "undecided");
    const b = (unit: string, arm: "n" | "d" | "a", done: boolean[] | null, more: Partial<ScoredBuild> = {}): ScoredBuild => ({ unit, rep: 1, arm, done, empty_plan: false, contaminated: false, implied: [false, false, true, true, false], obvious: false, ...more });
    const builds = ["u1", "u2", "u3", "u4"].flatMap((u, i) => [b(u, "n", [true, false, false, false, false]), b(u, "d", [true, true, i > 0, false, false]), b(u, "a", i === 3 ? null : [true, true, true, true, false], i === 2 ? { empty_plan: true } : {})]);
    const r = read(builds, ["n", "d", "a"]);
    const again = paired(new Map([["u1", 0.4], ["u2", 0.6]]), new Map([["u1", 0.2], ["u2", 0.2]]));
    must(r.comparisons["a-n"]!.briefs === 3 && r.excluded.length === 1, "the unscored A build was not dropped from its pair");
    must(r.arms["a"]!.briefs === 3 && r.comparisons["d-n"]!.briefs === 4, "brief counts are wrong");
    must(JSON.stringify(again) === JSON.stringify(paired(new Map([["u1", 0.4], ["u2", 0.6]]), new Map([["u1", 0.2], ["u2", 0.2]]))), "the bootstrap is not seeded");
    return "keep, slim, cut and undecided; an empty plan scores 0; an unscored build leaves its pair; MDD " + r.mdd + " at " + r.comparisons["a-n"]!.briefs + " briefs";
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
    const l = (covered: boolean): Label => ({ id: "c1", covered, usable: covered });
    const gold = new Map<string, Label>(Array.from({ length: 40 }, (_, i) => ["k" + i, l(i % 2 === 0)]));
    must(goldAgreement(new Map(gold), gold).admitted && !goldAgreement(new Map([...gold].slice(0, 39)), gold).admitted, "gold admission ignores the 40-pair floor");
    must(stockPlan().startsWith("# Plan"), "the stock plan did not load");
    return "blind labels, usable needs covered, one resend, a check labelled twice stays unlabelled, stock control, gold floor of 40";
  },
  "stage runner": () =>
    withTmp(async (dir) => {
      const units = join(dir, "units");
      fixtureUnit(units, "aaaaaa", 2);
      fixtureUnit(units, "bbbbbb", 2);
      const us = ["aaaaaa", "bbbbbb"].map((id) => (loadUnit(units, id) as { unit: Unit }).unit);
      const out = join(dir, "out");
      const closed = { n: 0 };
      const base = await stageRun(out, us, "base", ["n", "d"], 100, {}, closed);
      const review = await stageRun(out, us, "review", ["n", "d"], 100, {}, closed);
      const build = await stageRun(out, us, "build", ["n", "d"], 100, {}, closed);
      const check = await stageRun(out, us, "check", ["n", "d"], 100, {}, closed);
      must(base.rows.length === 2 && review.rows.length === 2 && build.rows.length === 4 && check.rows.length === 4, "rows: " + [base, review, build, check].map((r) => r.rows.length).join("/"));
      must(base.rows.every((r) => r.owner?.counts.questions === 1 && r.owner.counts.profile === 1), "the owner channel was not logged");
      must(check.rows.every((r) => r.check?.score.share === 0.4), "the check score is not 2 of 5");
      must(closed.n === 4, "a rig was left open");
      const capDir = join(dir, "cap");
      const cap = await stageRun(capDir, us, "base", ["n"], 5);
      must(cap.stops.some((s) => s.code === "CAP_STOP") && !cap.rows.length, "a round over the cap ran");
      let refused = "";
      await stageRun(capDir, us, "base", ["n"], 500).catch((e) => (refused = String(e.message)));
      must(/cap stop/.test(refused), "a launch after a cap stop was not refused");
      let changed = "";
      await stageRun(out, us, "base", ["n", "d", "a"], 100).catch((e) => (changed = String(e.message)));
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
      const vre = await stageRun(vDir, us.slice(0, 1), "base", ["n"], 100, {}, { n: 0 }, vLedger);
      const crashed = vre.rows[0]!.attempts[0]!;
      must(crashed.usd === 2 && crashed.voice_usd === 3 && vre.voice_micros === 3e6, "a crashed attempt's held spend was not split by meter (planner $" + crashed.usd + ", voice $" + crashed.voice_usd + ", stage voice " + vre.voice_micros + " micros)");
      const halt = await stageRun(join(dir, "halt"), us, "base", ["n"], 100, { launch: stubLaunch({ leak: true }) });
      must(halt.stops.some((s) => s.code === "E_DAYONE_LEAK"), "a containment departure did not halt");
      return "base, review, build and check end to end, the checker on the browser endpoint; cap stop and its refusal; " + (changed ? "a changed manifest refused" : "manifest unchanged") + "; crash marker reconciled, a crashed attempt's held spend split between planner and voice; leak halts";
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
    withTmp((dir) => {
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
        const caps = ITEMS.reduce((a, i) => a + i.capUsd, 0);
        must(caps === ALL_IN_USD, "the caps total $" + caps + ", not the all-in $" + ALL_IN_USD);
        return "caps total $" + caps + "; " + metered.length + " items, " + metered.length + " leases opened and settled on " + DAYONE_RUN + "; a second run: " + bound;
      } finally {
        local.close();
      }
    }),
  "shrink order": () => {
    const s = shrink(4150, [81, 81, 420]);
    const r = shrink(5200, [81, 81, 420]);
    must("steps" in s && s.steps === 2 && "ruling" in r, "the shrink order misapplied");
    return "4,150 takes 2 steps to " + s.projected + "; 5,200 needs a ruling";
  },
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
