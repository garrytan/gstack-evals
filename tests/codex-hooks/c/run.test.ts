import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import { sessionDir } from "../../../src/trial/review/run.ts";
import { unitTaskId } from "../../../src/trial/review/unit.ts";
import { GSTACK } from "../../../lanes/codex-hooks/pins.ts";
import { ITEMS, MODEL, SUITE, suiteUnits, type ItemName } from "../../../lanes/codex-hooks/c/pins.ts";
import { approve, doneMark, dryRun, guard, markDone, reviewArgv, schedule } from "../../../lanes/codex-hooks/c/plan.ts";
import { questionCounts, writeReadout, type UnitRef } from "../../../lanes/codex-hooks/c/readout.ts";
import { moveForRerun, runPhase, type Exec } from "../../../lanes/codex-hooks/c/run.ts";

const FIX = join(import.meta.dir, "fixtures");
const REPO = join(import.meta.dir, "..", "..", "..");
const refs = (JSON.parse(readFileSync(join(REPO, SUITE.path), "utf8")).units as UnitRef[]).map((u) => ({ id: u.id, repo: u.repo, pr: u.pr, head: u.head }));
const ids = suiteUnits();
const tmp = () => mkdtempSync(join(tmpdir(), "codex-hooks-c-test-"));
const flagValues = (argv: string[], flag: string): string[] => {
  const i = argv.indexOf(flag);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j]!.startsWith("--"); j++) out.push(argv[j]!);
  return out;
};

/** A stand-in for review-units: each cell it is asked for gets a cells.ndjson line, a journal and a fixture's host dir. */
function fakeReviewUnits(pick: (item: string, arm: string, unit: string, pass: number) => string | null, calls: string[][]): Exec {
  let meter = 0;
  return async (argv) => {
    calls.push(argv);
    const out = flagValues(argv, "--out")[0]!;
    const item = flagValues(argv, "--item")[0] as ItemName;
    const p = ITEMS[item];
    const have = existsSync(join(out, "cells.ndjson")) ? readFileSync(join(out, "cells.ndjson"), "utf8") : "";
    for (const unit of flagValues(argv, "--units")) {
      for (const arm of p.arms) for (let pass = 1; pass <= Number(flagValues(argv, "--passes")[0]); pass++) {
        const cell = { model: MODEL, arm, unit, pass };
        if (have.includes(JSON.stringify(cell))) continue;
        const fixture = pick(item, arm, unit, pass);
        const host = join(sessionDir(out, MODEL, arm, unitTaskId(refs.find((u) => u.id === unit)!), pass), "host");
        mkdirSync(host, { recursive: true });
        if (fixture) cpSync(join(FIX, fixture, "host"), host, { recursive: true });
        else writeFileSync(join(host, "init.json"), "{}\n");
        const meter_id = "m" + ++meter;
        mkdirSync(join(out, "proxy"), { recursive: true });
        for (let i = 0; i < 2; i++) appendFileSync(join(out, "proxy", "journal.ndjson"), JSON.stringify({ kind: "request", reservation_id: meter_id + "-" + i, cell: { meter_id }, model: MODEL, fields: { reasoning: { effort: arm === "c-high" ? "high" : "low" } } }) + "\n");
        appendFileSync(join(out, "cells.ndjson"), JSON.stringify({ cell, key: {}, meter_id, record: { termination: { kind: "completed" } }, parse: {}, cost: { all: { spent_micros: arm === "c-high" ? 3_000_000 : 1_000_000 } }, codex: { allowance_stops: 0, prompt_input_sha256: "p" } }) + "\n");
      }
    }
    return { code: 0, stderr: "" };
  };
}

const FIXTURE: Record<string, string> = { "c-on": "block", "c-off": "off", "c-none": "none", "c-high": "met" };

describe("part C's schedule and money (preregistration sections 9, 11 and 13)", () => {
  // Value: protects=the pilot runs c-pilot and h-pilot unit by unit over the six drawn units, the counted run interleaves c-main and h-main unit by unit over all 33, and each step's review-units command carries the frozen suite, arms, model, passes, parallel, timeout, allowance, session kind and the item's left cap with --resume; fails_when=the order, a flag or a value drifts; why_new=GEVA-562 part C; seam=schedule, reviewArgv; no_claim=review-units' own behaviour
  test("the schedule and each step's review-units command", () => {
    const pilot = schedule("pilot", ids);
    expect(pilot.map((s) => s.item)).toEqual(Array.from({ length: 12 }, (_, i) => (i % 2 ? "h-pilot" : "c-pilot")));
    expect(schedule("main", ids)).toHaveLength(66);
    const argv = reviewArgv({ item: "c-main", units: ["u1"], out: "/o", codexArms: "/o/codex-arms.json", ledger: "/l", record: "/r", spendCapUsd: 345, sources: { "garrytan/gbrain": "/b", "garrytan/gstack": "/s" } });
    expect(argv.join(" ")).toBe("review-units --host codex --codex-arms /o/codex-arms.json --suite " + SUITE.path + " --units u1 --arms c-on=garrytan/gstack@" + GSTACK.sha + " c-off=garrytan/gstack@" + GSTACK.sha + " c-none=none --models gpt-6.1-sol --passes 2 --parallel 4 --timeout 3600 --allowance 8 --session-kind unattended --severity-map wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/severity-map.json --test garrytan/gstack=true --test garrytan/gbrain=true --source garrytan/gbrain=/b --source garrytan/gstack=/s --item c-main --spend-cap 345.00 --ledger /l --record /r --out /o --resume");
    expect(reviewArgv({ item: "h-pilot", units: ["u"], out: "/o", codexArms: "/c", ledger: "/l", record: "/r", spendCapUsd: 12.345, sources: {}, upstream: "http://host.docker.internal:1" }).join(" ")).toContain("--arms c-high=garrytan/gstack@" + GSTACK.sha + " --models gpt-6.1-sol --passes 1 --parallel 4 --timeout 3600 --allowance 15 ");
  });

  // Value: protects=an item's approval row is its frozen cap with the approver's words, and the guard refuses an item with no approval, a cap other than the frozen one, an open lease, a projection past what is left, or a done mark; the done mark is refused while a lease is open or twice; fails_when=a step can lease past the frozen money; why_new=GEVA-562 part C (section 11); seam=approve, guard, markDone; no_claim=review-units' own cap stop
  test("approval, the guard and the done mark", () => {
    const dir = tmp();
    try {
      const record = join(dir, "record");
      expect(() => approve(record, "c-pilot", 61, "Captain", "words")).toThrow(/frozen cap is \$60/);
      expect(() => approve(record, "c-pilot", 60, "", "words")).toThrow(/needs --by/);
      expect(guard(record, "c-pilot", 18).why[0]).toMatch(/no approval row/);
      approve(record, "c-pilot", 60, "Captain", "approved at $60", "warn");
      expect(() => approve(record, "c-pilot", 60, "Captain", "again", "warn")).toThrow(/already has an approval row/);
      expect(guard(record, "c-pilot", 18)).toMatchObject({ ok: true, spend_cap_usd: 60 });
      expect(guard(record, "c-pilot", 18).line).toBe("CODEX_C_GUARD PASS c-pilot: cap $60.00, committed $0.00, left $60.00, projection $53.00 for 18 sessions");
      expect(guard(record, "c-pilot", 40).why[0]).toMatch(/projection \$78.67 .* passes what it has left, \$60.00/);
      recordApproval(record, { action: "init", item: "h-pilot", cap_micros: 10_000_000, quotes: [{ words: "w", by: "b", source: "s" }], admission: "warn" });
      expect(guard(record, "h-pilot", 0).why).toContain("h-pilot's cap is $10.00, not its frozen $85");
      const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite"), {}));
      const lease = openLease(record, local, { item: "c-pilot", run_id: "r", amount_micros: 1_000_000 });
      expect(guard(record, "c-pilot", 18).why.join(" ")).toContain("holds open lease " + lease.lease_id);
      expect(() => markDone(record, "c-pilot")).toThrow(/open lease/);
      approve(record, "c-main", 345, "Captain", "approved", "warn");
      markDone(record, "c-main");
      expect(existsSync(doneMark(record, "c-main"))).toBe(true);
      expect(() => markDone(record, "c-main")).toThrow(/marked done already/);
      expect(guard(record, "c-main", 0).why).toContain("c-main is marked done");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Value: protects=a counted item's VM share, which section 11's central includes and the ledger never sees, is held back from the model spend each step leases, in proportion to the sessions still to run, and the two shares are what c-main's and h-main's centrals leave after the planned session prices (R113's $12.60); fails_when=model spend can use the money planned for the run's VM, so the item's whole cost passes its cap; why_new=GEVA-562 part C (section 11, decision D); seam=guard; no_claim=the VM's real cost, which Ubicloud bills
  test("the VM share is held back from what a counted step leases", () => {
    const dir = tmp();
    try {
      const record = join(dir, "record");
      expect([ITEMS["c-main"].central_usd - 66 * (1.5 + 1.5 + 0.4), ITEMS["h-main"].central_usd - 66 * 3].map((x) => Math.round(x * 100) / 100)).toEqual([ITEMS["c-main"].vm_usd, ITEMS["h-main"].vm_usd]);
      approve(record, "c-main", 345, "Captain", "approved", "warn");
      expect(guard(record, "c-main", 198)).toMatchObject({ ok: true, vm_micros: 9_600_000, spend_cap_usd: 335.4 });
      expect(guard(record, "c-main", 99)).toMatchObject({ vm_micros: 4_800_000, spend_cap_usd: 340.2 });
      expect(guard(record, "c-main", 198).line).toEndWith("for 198 sessions, VM share held back $9.60");
      approve(record, "c-pilot", 60, "Captain", "approved", "warn");
      expect(guard(record, "c-pilot", 18)).toMatchObject({ vm_micros: 0, spend_cap_usd: 60 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Value: protects=the dry run opens and settles one ledger lease per frozen item on a temporary ledger, shows a done item's guard refusing, and checks the schedule's sessions against the frozen counts and the interleave; fails_when=an item cannot serve its lease or a count drifts; why_new=GEVA-562 part C (section 12: one lease per item); seam=dryRun; no_claim=a paid run
  test("the dry run", () => {
    const d = dryRun(ids);
    expect(d.lines.filter((l) => l.startsWith("PASS lease"))).toHaveLength(4);
    expect(d.lines.filter((l) => !l.startsWith("PASS"))).toEqual([]);
    expect(d.ok).toBe(true);
  });
});

describe("part C's run controller and readout, against a stand-in for review-units", () => {
  // Value: protects=a pilot run executes its twelve steps in order with the item's left cap and its own codex-arms file, then one collect pass per item; a relaunch skips the steps whose cells exist; the readout counts blocks, would-blocks, infra rows and costs per arm and releases no found rate; a session with no rollout owes one rerun, which moves its line and dir aside so the next run runs it again as attempt 2; fails_when=a step reruns finished cells, the collect pass is skipped, a rerun is lost or doubled, or the summary miscounts; why_new=GEVA-562 part C; seam=runPhase, moveForRerun, writeReadout; no_claim=review-units itself, which the Docker end-to-end check runs
  test("a pilot run, its readout and the one rerun", async () => {
    const dir = tmp();
    try {
      const record = join(dir, "record");
      approve(record, "c-pilot", 60, "Captain", "approved", "warn");
      approve(record, "h-pilot", 85, "Captain", "approved", "warn");
      const root = join(dir, "root");
      const calls: string[][] = [];
      const lostOnce = new Set<string>();
      const pick = (item: string, arm: string, unit: string) => {
        const k = arm + unit;
        if (arm === "c-off" && unit === schedule("pilot", ids)[2]!.unit && !lostOnce.has(k)) {
          lostOnce.add(k);
          return null;
        }
        return FIXTURE[arm]!;
      };
      const run = () => runPhase({ root, phase: "pilot", record, ledger: join(dir, "ledger.sqlite"), sources: { "garrytan/gstack": "/s", "garrytan/gbrain": "/b" }, ids, exec: fakeReviewUnits(pick, calls), log: () => {} });
      expect(await run()).toEqual({ ok: true, stopped: {} });
      expect(calls).toHaveLength(14);
      expect(calls.slice(0, 12).map((a) => flagValues(a, "--item")[0] + " " + flagValues(a, "--units").join(","))).toEqual(schedule("pilot", ids).map((s) => s.item + " " + s.unit));
      expect(flagValues(calls[0]!, "--spend-cap")).toEqual(["60.00"]);
      expect(flagValues(calls[0]!, "--codex-arms")).toEqual([join(root, "c-pilot", "codex-arms.json")]);
      expect(flagValues(calls[12]!, "--units")).toHaveLength(6);
      const summary = writeReadout(root, "c-pilot", refs) as any;
      expect(summary.captain_hears).toEqual([]);
      expect(summary.arms["c-on"]).toMatchObject({ planned: 6, found: 6, scored: 6, supplied: true, contract_ran: true, exposure: { blocked: 6, items: { "adversarial-pass": 6, "review-report": 6 }, false_blocks: 0, would_block: 6 } });
      expect(summary.arms["c-off"]).toMatchObject({ found: 6, scored: 5, supplied: false, classes: { scored: 5, infra: 1 }, exposure: { no_log: 6, would_block: 6 } });
      expect(summary.arms["c-on"].usd).toMatchObject({ sessions: 6, mean: 1, median: 1, p95: 1, allowance: 8, doubles_allowance: false });
      expect(summary.arms["c-on"].hand_read).toHaveLength(2);
      expect(JSON.stringify(summary)).not.toMatch(/found_rate|"found":\s*\{/);
      const states = readFileSync(join(root, "c-pilot", "readout", "states.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(states.filter((s) => s.state === "first_stop")).toHaveLength(6);
      expect(readFileSync(join(root, "c-pilot", "readout", "states-blind.jsonl"), "utf8")).not.toContain("c-on");
      expect(writeReadout(root, "h-pilot", refs).arms["c-high"]).toMatchObject({ scored: 6, exposure: { blocked: 0, pass: { before: 6 } }, usd: { p95: 3, doubles_allowance: false } });

      expect(moveForRerun(root, "c-pilot", refs)).toHaveLength(1);
      expect(moveForRerun(root, "c-pilot", refs)).toEqual([]);
      expect(readFileSync(join(root, "c-pilot", "cells-attempt1.ndjson"), "utf8").trim().split("\n")).toHaveLength(1);
      calls.length = 0;
      expect(await run()).toEqual({ ok: true, stopped: {} });
      expect(calls.map((a) => flagValues(a, "--item")[0] + " " + flagValues(a, "--units").length)).toEqual(["c-pilot 1", "c-pilot 6", "h-pilot 6"]);
      const after = writeReadout(root, "c-pilot", refs) as any;
      expect(after.arms["c-off"]).toMatchObject({ found: 6, scored: 6, supplied: true, reruns: 1, gaps: 0 });
      const outcomes = readFileSync(join(root, "c-pilot", "readout", "outcomes.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(outcomes.filter((o) => o.arm === "c-off" && o.unit === schedule("pilot", ids)[2]!.unit).map((o) => [o.attempt, o.class, o.code])).toEqual([[1, "infra", "E_CODEX_C_NO_ROLLOUT"], [2, "scored", null]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Value: protects=pre-run change 1, section 6's question counts: every question the driver captured, and the ones that share one answer with a same-titled question in the same turn; a session with no questions.json asked none; fails_when=a question is lost or a same-titled pair goes uncounted; why_new=GEVA-562 pre-run change 1, section 6; seam=questionCounts; no_claim=forged question lines, which the rollout cannot tell apart
  test("question counts", () => {
    const dir = tmp();
    try {
      expect(questionCounts(dir)).toEqual({ asked: 0, same_title: 0 });
      writeFileSync(join(dir, "questions.json"), JSON.stringify([{ call_id: "a", turn: 1, questions: [{ title: "Which?" }, { title: "Which?" }] }, { call_id: "b", turn: 2, questions: [{ title: "Which?" }] }]));
      expect(questionCounts(dir)).toEqual({ asked: 3, same_title: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Value: protects=a step that exits with a CAP_STOP stops its item for good (a CAP_STOP file, its later steps and its collect pass skipped) while the other item runs on, and any other failed step stops the phase; fails_when=a cap-stopped item runs again or a broken rig runs on; why_new=GEVA-562 part C (section 5.8: a cap stop never reruns); seam=runPhase; no_claim=review-units' cap arithmetic
  test("a cap stop stops its item; any other failure stops the phase", async () => {
    const dir = tmp();
    try {
      const record = join(dir, "record");
      approve(record, "c-pilot", 60, "Captain", "approved", "warn");
      approve(record, "h-pilot", 85, "Captain", "approved", "warn");
      const root = join(dir, "root");
      const calls: string[][] = [];
      const inner = fakeReviewUnits((_i, arm) => FIXTURE[arm]!, []);
      const exec: Exec = async (argv) => {
        calls.push(argv);
        if (flagValues(argv, "--item")[0] === "h-pilot") return { code: 2, stderr: "CAP_STOP review-units: the next round's worst case does not fit under the cap\n" };
        return inner(argv);
      };
      const r = await runPhase({ root, phase: "pilot", record, ledger: join(dir, "l.sqlite"), sources: {}, ids, exec, log: () => {} });
      expect(r.ok).toBe(true);
      expect(Object.keys(r.stopped)).toEqual(["h-pilot"]);
      expect(existsSync(join(root, "h-pilot", "CAP_STOP"))).toBe(true);
      expect(calls.filter((a) => flagValues(a, "--item")[0] === "h-pilot")).toHaveLength(1);
      expect(calls.filter((a) => flagValues(a, "--item")[0] === "c-pilot")).toHaveLength(7);
      const again = await runPhase({ root, phase: "pilot", record, ledger: join(dir, "l.sqlite"), sources: {}, ids, exec, log: () => {} });
      expect(again.stopped["h-pilot"]).toBe("a cap stop ended it before this run");
      const broken = await runPhase({ root: join(dir, "root2"), phase: "pilot", record, ledger: join(dir, "l.sqlite"), sources: {}, ids, exec: async () => ({ code: 1, stderr: "E_DOCKER_UNAVAILABLE" }), log: () => {} });
      expect(broken.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
