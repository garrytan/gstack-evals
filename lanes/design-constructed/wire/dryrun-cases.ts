// Copyright (c) 2026 Garry Tan. MIT License.
// The wiring's dry-run cases: each refusal a paid row has before it spends (off the controller host, a provider not
// bound, each start rule, the ledger admission, provider drift), the sessions row end to end on the keyless fake
// session provider, from its arguments to the printed counts, the stage 3 row on the fake VM world, and each keyless
// row (scope, score, read, power, items, pins). Every case runs the row through cli.ts as the command line would.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "../money/book.ts";
import { endpointsFixture } from "../paid/dryrun-cases.ts";
import type { ProbePlan } from "../paid/pin.ts";
import type { ReadCell } from "../read/types.ts";
import { BLOCK, PLAN_AFTER, PLAN_BEFORE, pdrExposedTranscript, say, tx } from "../run/fixtures.ts";
import { makeRow, makeUnit } from "../score/fixtures.ts";
import type { ReviewRow } from "../score/types.ts";
import type { DryRunCase } from "../types.ts";
import { BOUND_PROVIDERS } from "../wire.ts";
import { fakeEnv, fakeKit, fakeSessions, fakeVm, type FakeAttempt, type Kit, type KitOptions } from "./fakes.ts";
import { runRow, scratch, sessionsFixture, stage3Fixture } from "./fixtures.ts";
import { hostRowCases } from "./dryrun-host.ts";
import type { Cell } from "../run/types.ts";

type Ran = Awaited<ReturnType<typeof runRow>>;

const all = (...checks: (string | null)[]): string | null => checks.find((x) => x !== null) ?? null;
const eq = (got: unknown, want: unknown, what: string): string | null => (JSON.stringify(got) === JSON.stringify(want) ? null : what + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
const has = (r: Ran, line: string): string | null => (r.out.includes(line) ? null : "no line " + JSON.stringify(line) + " in " + JSON.stringify(r.out.slice(-12)));
const refused = (r: Ran, code: string, part: string): string | null =>
  r.code === 2 && (r.err[0] ?? "").startsWith(code + " ") && (r.err[0] ?? "").includes(part) ? null : "want " + code + " naming " + JSON.stringify(part) + ", got exit " + r.code + ": " + (r.err[0] ?? r.out.at(-1) ?? "nothing");

async function withKit(o: KitOptions, f: (kit: Kit) => Promise<string | null>): Promise<string | null> {
  const kit = fakeKit(o);
  try {
    return await f(kit);
  } finally {
    kit.dispose();
  }
}

/** Every attempt of every cell completes with a block, on $1.00. */
const plain = (): FakeAttempt => ({ transcript: tx(say("Review.\n\n" + BLOCK)) });
const NONE_U1 = { cells: [{ unit: "u1", kind: "none" as const }] };

/**
 * One unit-pass of stage 2 on Opus: none completes; lens hits its turn cap holding a block, then completes; the
 * plan-design-review session ends on a malformed tool call after an API error (outside the agent, a J1 retry), then
 * runs the procedure; autoplan ends on its own malformed tool call (an arm stop), then completes with no gate.
 */
function unitPass(o: { cell: Cell; attempt: 1 | 2 }): FakeAttempt {
  const k = o.cell.kind;
  if (k === "lens" && o.attempt === 1) return { transcript: tx(say("Partway.\n\n" + BLOCK)), termination: { kind: "turn_cap" } };
  if (k === "plan-design-review") return o.attempt === 1 ? { transcript: tx(say("Reading the plan.")), termination: { kind: "arm_failure", failure: "malformed_tool_call" }, errorSeen: true } : { transcript: pdrExposedTranscript(), planAfter: PLAN_AFTER };
  if (k === "autoplan" && o.attempt === 1) return { transcript: tx(say("Starting.")), termination: { kind: "arm_failure", failure: "malformed_tool_call" } };
  return plain();
}

const read1Cell = (unit: string, pass: number, a: number): ReadCell => ({ unit, arm: "none", pass, model: "opus", state: "scored", a, g: null, d: null, shuffledA: 0, shuffledG: null, words: 100, exposed: null });

export function cases(): DryRunCase[] {
  return [
    {
      rule: "W-host",
      name: "off the controller host a paid row refuses with E_DCW_OFF_HOST after its start rules, before any lease or sink",
      check: () =>
        withKit({}, async (kit) => {
          const f = sessionsFixture({ model: "opus", stage: 2, ...NONE_U1 });
          const r = await runRow(f.argv, { ...fakeEnv(kit), providers: BOUND_PROVIDERS(null) });
          return all(refused(r, "E_DCW_OFF_HOST", "controller host"), existsSync(f.sink) ? "the sink was made" : null);
        }),
    },
    {
      rule: "W-provider",
      name: "a provider left unbound refuses with E_DCW_NO_PROVIDER after the ledger admission, with only the ledger built",
      check: () =>
        withKit({}, async (kit) => {
          const f = sessionsFixture({ model: "opus", stage: 2, ...NONE_U1 });
          const r = await runRow(f.argv, fakeEnv(kit));
          return all(refused(r, "E_DCW_NO_PROVIDER", "session provider"), eq(kit.built, ["ledger"], "built"), existsSync(join(f.sink, "launch.json")) ? null : "no launch record");
        }),
    },
    ...(
      [
        ["2", "a dirty checkout", (f: ReturnType<typeof sessionsFixture>, kit: Kit) => runRow(f.argv, fakeEnv(kit, { dirty: true }))],
        ["10", "a sink that exists", (f: ReturnType<typeof sessionsFixture>, kit: Kit) => (mkdirSync(f.sink), runRow(f.argv, fakeEnv(kit)))],
        ["5", "a FAIL line in the dry run", (f: ReturnType<typeof sessionsFixture>, kit: Kit) => runRow(f.argv, fakeEnv(kit, { dryRun: false }))],
      ] as const
    ).map(([rule, what, run]) => ({
      rule: "W-start",
      name: "start rule " + rule + " refuses " + what + " with E_DCW_START_RULE before any provider is built",
      check: () =>
        withKit({ session: fakeSessions(plain) }, async (kit) => {
          const f = sessionsFixture({ model: "opus", stage: 2, ...NONE_U1 });
          const r = await run(f, kit);
          return all(refused(r, "E_DCW_START_RULE", "start rule " + rule + ":"), eq(kit.built, [], "built"));
        }),
    })),
    {
      rule: "W-start",
      name: "start rule 9 refuses an OpenRouter model with no dated terms record before any provider is built",
      check: () =>
        withKit({ session: fakeSessions(plain) }, async (kit) => {
          const f = sessionsFixture({ model: "sol", stage: 2, ...NONE_U1 });
          writeFileSync(join(f.dir, "terms.json"), "[]");
          const r = await runRow(f.argv, fakeEnv(kit));
          return all(refused(r, "E_DCW_START_RULE", "start rule 9: sol has no dated terms record"), eq(kit.built, [], "built"));
        }),
    },
    {
      rule: "W-start",
      name: "start rule 8 holds stage 1 with no Captain go and no passed pilot, before any provider is built",
      check: () =>
        withKit({ session: fakeSessions(plain) }, async (kit) => {
          const f = sessionsFixture({ model: "opus", stage: 1, ...NONE_U1, rule8: { go: null, choice: null, pilotPassedAt: null } });
          const r = await runRow(f.argv, fakeEnv(kit));
          return all(refused(r, "E_DCW_START_RULE", "start rule 8: no Captain go"), eq(kit.built, [], "built"));
        }),
    },
    {
      rule: "W-ledger",
      name: "an item with no recorded cap refuses with E_DCW_LEDGER_REFUSED (start rule 1) and builds nothing past the ledger",
      check: () =>
        withKit({ session: fakeSessions(plain), unrecorded: ["dc-stage2-opus"] }, async (kit) => {
          const r = await runRow(sessionsFixture({ model: "opus", stage: 2, ...NONE_U1 }).argv, fakeEnv(kit));
          return all(refused(r, "E_DCW_LEDGER_REFUSED", "start rule 1"), eq(kit.built, ["ledger"], "built"), eq(kit.calls, [], "sessions"));
        }),
    },
    {
      rule: "W-ledger",
      name: "a recorded cap other than the frozen one refuses with E_DCW_LEDGER_REFUSED and opens no session",
      check: () =>
        withKit({ session: fakeSessions(plain), caps: { "dc-stage2-opus": $(1) } }, async (kit) => {
          const r = await runRow(sessionsFixture({ model: "opus", stage: 2, ...NONE_U1 }).argv, fakeEnv(kit));
          return all(refused(r, "E_DCW_LEDGER_REFUSED", "is not the frozen"), eq(kit.calls, [], "sessions"));
        }),
    },
    {
      rule: "W-drift",
      name: "a Sol session served by another provider stops every call on Sol (PD-9) and ends the launch with E_DC_PROVIDER_DRIFT",
      check: () =>
        withKit({ session: fakeSessions(() => ({ ...plain(), served: "Azure" })) }, async (kit) => {
          const r = await runRow(sessionsFixture({ model: "sol", stage: 2, ...NONE_U1 }).argv, fakeEnv(kit));
          const c = kit.rig().c;
          return all(refused(r, "E_DC_PROVIDER_DRIFT", "Azure"), c.stopFor("dc-stage2-sol", { model: "sol", subject: "sol", stage: null }) ? null : "dc-stage2-sol is not stopped", c.stopFor("dc-judges", { model: "sol", subject: null, stage: null }) ? null : "Sol's judge calls are not stopped");
        }),
    },
    {
      rule: "W-sessions",
      name: "the sessions row runs a stage 2 unit-pass end to end on the fake sessions and prints its counts, arm stops with a block and malformed tool calls",
      check: () =>
        withKit({ session: fakeSessions(unitPass) }, async (kit) => {
          const f = sessionsFixture({ model: "opus", stage: 2, cells: (["none", "lens", "plan-design-review", "autoplan"] as const).map((kind) => ({ unit: "u1", kind })) });
          const r = await runRow(f.argv, fakeEnv(kit));
          if (r.code !== 0) return "exit " + r.code + ": " + r.err.join(" | ");
          const rows = JSON.parse(readFileSync(join(f.sink, "rows.json"), "utf8")) as ReviewRow[];
          const states = Object.fromEntries(rows.map((x) => [x.kind, x.state]));
          const fig = kit.rig().c.figures("dc-stage2-opus");
          return all(
            r.out.some((l) => /^sessions opus stage 2: 4 cells, .*; 3 retried$/.test(l)) ? null : "no count line in " + JSON.stringify(r.out.slice(-6)),
            has(r, "arm stops that held a block: lens on opus 1 (descriptive)"),
            has(r, "malformed tool calls: autoplan on opus 1 read as arm stops, 0 as outside the agent"),
            has(r, "malformed tool calls: plan-design-review on opus 0 read as arm stops, 1 as outside the agent"),
            eq(states.none, "scored", "none's state"),
            eq(states.autoplan, "scored-unexposed", "autoplan's state"),
            eq(readdirSync(join(f.sink, "transcripts")).length, 7, "transcripts"),
            eq([fig.settledMicros, fig.inFlightMicros, fig.unknownMicros], [$(7), 0, 0], "dc-stage2-opus figures"),
            eq(kit.built, ["ledger", "session"], "built"),
          );
        }),
    },
    {
      rule: "W-sessions",
      name: "an unknown session charge stays held in flight when J1 has no figure (PD-18), and the launch prints it",
      check: () =>
        withKit({ session: fakeSessions(() => ({ ...plain(), spentUsd: null })), held: true }, async (kit) => {
          const r = await runRow(sessionsFixture({ model: "opus", stage: 2, ...NONE_U1 }).argv, fakeEnv(kit));
          const fig = kit.rig().c.figures("dc-stage2-opus");
          return all(eq(r.code, 0, "exit"), has(r, "held stage2:opus:u1:p1:r1: an unknown charge stays in flight until the owner's reconcile (PD-18)"), fig.unknownMicros > 0 ? null : "no unknown charge held");
        }),
    },
    {
      rule: "W-stage3",
      name: "the stage3 row selects 8 units on the fake VM world and runs every build arm, check and DES-4 pair",
      check: () =>
        withKit({ vm: fakeVm() }, async (kit) => {
          const f = stage3Fixture(8);
          const r = await runRow(f.argv, fakeEnv(kit));
          if (r.code !== 0) return "exit " + r.code + ": " + [...r.err, ...r.out.slice(-4)].join(" | ");
          const builds = JSON.parse(readFileSync(join(f.sink, "builds.json"), "utf8")) as unknown[];
          return all(has(r, "stage 3 selection: 8 tried, 8 qualify, 0 skipped for a base app already used"), eq(builds.length, 48, "builds"), eq(kit.built, ["ledger", "vm"], "built"));
        }),
    },
    {
      rule: "W-stage3",
      name: "start rule 7 holds stage 3 until stage 2's Opus pass 1 exists, before the VM provider is built",
      check: () =>
        withKit({ vm: fakeVm() }, async (kit) => {
          const r = await runRow(stage3Fixture(8, { pass1: false }).argv, fakeEnv(kit));
          return all(refused(r, "E_DCW_START_RULE", "start rule 7: stage 3 runs after stage 2's Opus pass 1"), eq(kit.built, [], "built"));
        }),
    },
    {
      rule: "W-keyless",
      name: "pins plan prints the keyless probe and pins record pins every route from the reads, or stops for the Captain without them",
      check: () =>
        withKit({}, async (kit) => {
          const env = fakeEnv(kit);
          const root = scratch("pins");
          const plan = await runRow(["pins", "plan", "--dir", join(root, "probe")], env);
          const p = JSON.parse(readFileSync(join(root, "probe", "plan.json"), "utf8")) as ProbePlan;
          const bare = await runRow(["pins", "record", "--dir", join(root, "probe"), "--run", "dry-run", "--commit", "0".repeat(40), "--out", join(root, "bare.json")], env);
          for (const c of p.commands) writeFileSync(join(root, "probe", c.file), endpointsFixture(c.model));
          const rec = await runRow(["pins", "record", "--dir", join(root, "probe"), "--run", "dry-run", "--commit", "0".repeat(40), "--dated", "2026-11-13T00:00:00Z", "--out", join(root, "pins.json")], env);
          return all(eq(plan.code, 0, "plan exit"), eq(plan.out.filter((l) => l.includes("https://openrouter.ai/api/v1/models/")).length, 3, "probe lines"), eq([bare.code, bare.out.at(-1)], [1, "pins: STOP for the Captain, 3 route(s) unpinned"], "without reads"), eq([rec.code, rec.out.at(-1)], [0, "pins: every route pinned"], "with reads"), eq(kit.built, [], "built"));
        }),
    },
    {
      rule: "W-keyless",
      name: "items prints the 17 ledger items and the all-in line, building nothing",
      check: () =>
        withKit({}, async (kit) => {
          const r = await runRow(["items"], fakeEnv(kit));
          return all(eq(r.code, 0, "exit"), eq(r.out.length, 18, "lines"), (r.out.at(-1) ?? "").startsWith("all-in cap $") ? null : "no all-in line", eq(kit.built, [], "built"));
        }),
    },
    {
      rule: "W-keyless",
      name: "scope reads each unit folder's plan.md and prints the share",
      check: () =>
        withKit({}, async (kit) => {
          const dir = scratch("scope");
          mkdirSync(join(dir, "u1"));
          writeFileSync(join(dir, "u1", "plan.md"), PLAN_BEFORE);
          const r = await runRow(["scope", "--units", dir], fakeEnv(kit));
          return all(eq(r.code, 0, "exit"), r.out[0]?.startsWith("scope u1: ") ? null : "no unit line: " + r.out[0], eq(r.out.length, 2, "lines"));
        }),
    },
    {
      rule: "W-keyless",
      name: "score reads units, rows, packets and labels and prints a line per model and arm, then the review count (a no-block row needs no packet)",
      check: () =>
        withKit({}, async (kit) => {
          const dir = scratch("score");
          writeFileSync(join(dir, "units.json"), JSON.stringify([makeUnit("u1", { set: "comparison" })]));
          writeFileSync(join(dir, "rows.json"), JSON.stringify([makeRow("u1", "none", null, { stage: 2 })]));
          writeFileSync(join(dir, "packets.json"), "[]");
          writeFileSync(join(dir, "labels.json"), "[]");
          const r = await runRow(["score", "--in", dir, "--read", "base", "--stage", "2"], fakeEnv(kit));
          return all(eq(r.code, 0, "exit"), r.out.some((l) => l.startsWith("score opus none at base: ")) ? null : "no arm line: " + JSON.stringify(r.out), eq(r.out.at(-1), "score: 1 reviews at base", "last line"));
        }),
    },
    {
      rule: "W-keyless",
      name: "read --stage 1 runs the twin check and the tier chain from a read input file",
      check: () =>
        withKit({}, async (kit) => {
          const dir = scratch("read");
          const pair = (n: number) => ({ pair: "p" + n, first: [0.4, 0.6, 0.4].map((a, i) => read1Cell("p" + n + "-1", i + 1, a)), second: [0.6, 0.4, 0.4].map((a, i) => read1Cell("p" + n + "-2", i + 1, a)) });
          writeFileSync(join(dir, "s1.json"), JSON.stringify({ twinPairs: [1, 2, 3, 4, 5, 6].map(pair), opusJudge: { kappa: 0.7, goldShort: false }, stockFailOpus: false, opusNoneParse: { parsed: 48, replies: 48 }, base: { none: 0.4, reference: 0.7 } }));
          const r = await runRow(["read", "--stage", "1", "--in", join(dir, "s1.json")], fakeEnv(kit));
          return all(eq(r.code, 0, "exit"), (r.out.at(-1) ?? "").startsWith("stage 1: HEADROOM at base") ? null : "last line " + r.out.at(-1));
        }),
    },
    {
      rule: "W-keyless",
      name: "power writes design.json into a new folder and reads power.py's ADMIT and MDD lines",
      check: () =>
        withKit({}, async (kit) => {
          const dir = scratch("power");
          writeFileSync(join(dir, "design.json"), JSON.stringify({ p0: 0.3, rho: 0.5, passes_arm: 1, passes_none: 3, units: [{ repo: "app-a", items: 5 }, { repo: "app-b", items: 4 }] }));
          const r = await runRow(["power", "--design", join(dir, "design.json"), "--out", join(dir, "out")], fakeEnv(kit));
          return all(eq(r.code, 0, "exit"), (r.out[0] ?? "").startsWith("admission read: 2 units on 2 base apps") ? null : "first line " + r.out[0], existsSync(join(dir, "out", "design.json")) ? null : "no design.json written");
        }),
    },
    ...hostRowCases(),
  ];
}
