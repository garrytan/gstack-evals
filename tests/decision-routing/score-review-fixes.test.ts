// Copyright (c) 2026 Garry Tan. MIT License.
// The #292 review fixes on the scorer and the labels, read from real dr_agent and proxy records of the keyless dry run
// (fixtures/review-fixes/, from fake upstreams): an unknown call costs its reservation while a no-usage 5xx stays $0;
// acts map from the words dr_agent logs; a test-pass label needs a bare runner once its pipe is stripped; over 5% of a
// cell's decisions with a failed decider call marks the cell DR_CELL_DEGRADED beside its verdicts.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testPassLabel, type DockerRunner } from "../../lanes/decision-routing/labels/container.ts";
import { actingRates } from "../../lanes/decision-routing/score/acting.ts";
import { main } from "../../lanes/decision-routing/score/cli.ts";
import { callUsd, loadPrices, readJournal } from "../../lanes/decision-routing/score/session.ts";

const FIX = join(import.meta.dir, "fixtures", "review-fixes");
const PRICES = join(import.meta.dir, "../../lanes/decision-routing/config/prices.json");
const records = (name: string): Array<Record<string, any>> => readFileSync(join(FIX, name), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const ladder = records("decisions.ladder-R-opus.jsonl");
const done = records("decision.done.R-opus-alpha-1.jsonl")[0]!;
const real = (id: string, o: Record<string, unknown> = {}) => ({ ...structuredClone(ladder.find((d) => d.decision_id === id)!), ...o });
const tmp = mkdtempSync(join(tmpdir(), "dr-review-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const fake = (code: number): DockerRunner & { calls: string[][] } => {
  const calls: string[][] = [];
  return { calls, async run(args) { calls.push(args); return { code, stdout: "", stderr: "" }; } };
};

const METER = JSON.parse(readFileSync(join(FIX, "meter.R-opus-alpha-1.json"), "utf8")).meter_id as string;
const own = records("journal.R-opus-alpha-1.ndjson");
const opusRequest: Record<string, any> = { ...own.find((l) => l.kind === "request" && l.provider === "anthropic")!, reservation_id: "rsv_unknown" };
const unknownOutcome = { ...own.find((l) => l.kind === "outcome" && l.reservation_id !== opusRequest.reservation_id)!, reservation_id: "rsv_unknown", status: 200, outcome: { kind: "unknown" }, reason: "the stream ended without usage" };
const JOURNAL = join(tmp, "journal.ndjson");
writeFileSync(JOURNAL, [...own, opusRequest, unknownOutcome, ...records("journal.no-usage-5xx.ndjson")].map((l) => JSON.stringify(l)).join("\n") + "\n");

describe("the scorer's bill", () => {
  test("an unknown outcome costs its request's full reservation, as meterSpend charges it; a no-usage 5xx under DR_ALLOWANCE_STOP stays $0", () => {
    const calls = readJournal([JOURNAL]);
    const prices = loadPrices(PRICES);
    const unknown = calls.get(METER)!.find((c) => c.reservation_id === "rsv_unknown")!;
    expect(callUsd(unknown, prices)).toBeCloseTo(opusRequest.max_micros / 1e6, 12);
    expect(calls.get("m_c9f3397de2c4f586ade06d2e")!.map((c) => callUsd(c, prices))).toEqual([0]);
  });
});

describe("S10 wrong acts from dr_agent's logged acts", () => {
  const labelOf = (d: Record<string, any>) => (d.type === "safe" || d.type === "tests_passed" ? false : d.type === "done" ? true : null);
  test("safe allowed or blocked, tests passed or failed, done or not_done; an unknown test act drops from labelled acts, counted", () => {
    const decisions = [...ladder, done, real("ladder-R-opus:20", { decision_id: "ladder-R-opus:20u", acted: "unknown" })];
    const r = actingRates(decisions, [], new Map(decisions.map((d) => [d.decision_id, labelOf(d)])));
    const row = (type: string) => r.rows.find((x) => x.type === type)!;
    expect([row("safe").wrong_acts, row("safe").labelled_acts]).toEqual([1, 15]);
    expect([row("tests_passed").wrong_acts, row("tests_passed").labelled_acts, row("tests_passed").unknown_acts]).toEqual([2, 2, 1]);
    expect([row("done").wrong_acts, row("done").labelled_acts]).toEqual([1, 3]);
  });
  test("an act below the main model that dr_agent never logs throws, never skipped", () => {
    expect(() => actingRates([real("ladder-R-opus:20", { acted: "yes" })], [], new Map([["ladder-R-opus:20", false]]))).toThrow(/acted "yes"/);
  });
});

describe("test-pass labels", () => {
  const snap = join(tmp, "snap.diff");
  writeFileSync(snap, "");
  test("missing unless the command, its pipe stripped, is a bare runner, optionally after cd <dir> &&", async () => {
    for (const command of ["python3 -m pytest -q tests; echo $?", "python3 -m pytest -q tests || true", "python3 -m pytest -q tests && echo ok", "true && python3 -m pytest -q tests", "cd /testbed && ./tests/runtests.py queries", "make test"]) {
      const d = fake(0);
      const r = await testPassLabel(d, { image: "i", snapshot: snap, command });
      expect([command, r.passed, r.missing?.startsWith("DR_LABEL_MISSING: with its pipe stripped") ?? false, d.calls.length]).toEqual([command, null, true, 0]);
    }
    for (const d of ladder.filter((x) => x.type === "tests_passed")) expect([d.command, (await testPassLabel(fake(1), { image: "i", snapshot: snap, command: d.command })).passed]).toEqual([d.command, false]);
    expect((await testPassLabel(fake(0), { image: "i", snapshot: snap, command: "cd /testbed && python -m pytest -x 2>&1 | tail -5" })).passed).toBe(true);
  });
});

async function score(name: string, decisions: Array<Record<string, any>>, labels: object[] = []): Promise<{ text: string; json: any }> {
  const root = join(tmp, name), t = join(root, "trials", "R-opus-alpha-1"), dr = join(t, "agent", "dr");
  mkdirSync(dr, { recursive: true });
  mkdirSync(join(t, "verifier"));
  cpSync(join(FIX, "result.R-opus-alpha-1.json"), join(t, "result.json"));
  writeFileSync(join(t, "verifier", "reward.txt"), "1\n");
  cpSync(join(FIX, "dr-summary.R-opus-alpha-1.json"), join(dr, "dr-summary.json"));
  cpSync(join(FIX, "meter.R-opus-alpha-1.json"), join(dr, "meter.json"));
  writeFileSync(join(dr, "decisions.jsonl"), decisions.map((d) => JSON.stringify(d)).join("\n") + "\n");
  writeFileSync(join(root, "planned.json"), JSON.stringify({ tasks: ["dryrun__alpha-1"] }));
  writeFileSync(join(root, "admission.json"), JSON.stringify({ contrasts: {} }));
  writeFileSync(join(root, "labels.jsonl"), labels.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out: string[] = [];
  const log = console.log;
  console.log = (m: string) => out.push(m);
  try {
    expect(await main(["--trials", join(root, "trials"), "--journal", JOURNAL, "--prices", PRICES, "--planned", join(root, "planned.json"), "--admission", join(root, "admission.json"), "--labels", join(root, "labels.jsonl"), "--json", join(root, "report.json")])).toBe(0);
  } finally { console.log = log; }
  return { text: out.join("\n"), json: JSON.parse(readFileSync(join(root, "report.json"), "utf8")) };
}

describe("score report", () => {
  const ok = (i: number) => real("ladder-R-opus:1", { decision_id: "ok:" + i });
  const failed = real("ladder-R-opus:12");
  const degraded = "DR_CELL_DEGRADED cell R: 1 of 19 decisions (5.3%) had a decider call fail after its retry, over 5%; a null here reads FIX-METHOD on infrastructure";
  test("exactly 5% of a cell's decisions with a failed decider call is not degraded", async () => {
    const { text, json } = await score("at-5", [...Array.from({ length: 19 }, (_, i) => ok(i)), failed]);
    expect(text).toContain("  opus R: 1 of 20 (5.0%)\n");
    expect(text).not.toContain("DR_CELL_DEGRADED cell");
    expect(json.opus.degraded).toEqual({ "R-N": [], "R-P": [] });
  });
  test("just over 5% marks the cell DR_CELL_DEGRADED with FIX-METHOD beside both of that model's verdicts; unknown calls and runner label drops print per arm", async () => {
    const missing = (await testPassLabel(fake(0), { image: "i", snapshot: join(tmp, "snap.diff"), command: "python3 -m pytest -q tests; echo $?" })).missing;
    const { text, json } = await score("over-5", [...Array.from({ length: 17 }, (_, i) => ok(i)), real("ladder-R-opus:20"), failed], [{ decision_id: "ladder-R-opus:20", type: "tests_passed", label: null, missing }]);
    const opus = text.slice(text.indexOf("== opus =="), text.indexOf("== sol =="));
    expect(opus.split(degraded).length - 1).toBe(2);
    expect(opus.indexOf(degraded)).toBeLessThan(opus.indexOf("Primary B, R against P"));
    expect(text.slice(text.indexOf("== sol =="))).not.toContain("DR_CELL_DEGRADED cell");
    expect(json.opus.degraded["R-N"]).toEqual([{ code: "DR_CELL_DEGRADED", null_reads: "FIX-METHOD on infrastructure", model: "opus", cell: "R", decisions: 19, failed: 1, share: 1 / 19, degraded: true }]);
    expect(json.opus.degraded["R-P"]).toEqual(json.opus.degraded["R-N"]);
    expect(text).toContain("calls with an unknown outcome (no usage came back), charged at their full reservation:\n  opus R: 1, reserved $0.67\n");
    expect(json.unknown_calls).toEqual({ "opus R": { count: 1, reserved_micros: opusRequest.max_micros } });
    expect(text).toContain("test-pass labels dropped because the command is not a bare runner (lanes/decision-routing/README.md), per model, cell and acting layer:\n  opus R particle: 1\n");
    expect(json.label_drops_not_bare_runner).toEqual({ "opus R particle": 1 });
  });
});
