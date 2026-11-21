// Copyright (c) 2026 Garry Tan. MIT License.
// codex-hooks c analysis end to end through main(), keyless: a pilot's states file, every judging step through the real
// metering proxy against a fake provider on a temporary ledger, the judge check, the analysis and the pilot readout.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitCodeAt, main } from "../../../../lanes/codex-hooks/c/analysis/cli.ts";
import { JUDGE_ITEM, POWER } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { recordApproval } from "../../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../../src/runner/ledger/record.ts";
import { at, cleanup, jsonl, KEYS, message, session, sessionId, tmp, unitOf, upstream } from "./helpers.ts";

afterAll(cleanup);
const A = unitOf(3593);
const B = unitOf(3524);
const D = unitOf(3526);
const QUOTE = { words: "Approve the keyless test cap", by: "test", source: "tests/codex-hooks/c/analysis/cli.test.ts" };
const sent: Array<{ model: string; file: string }> = [];
const fetch = upstream({ "google/gemini-4-carbon": { blind: (b) => b === "B2" }, "google/gemini-4-argon": { blind: (b) => b === "B4" } }, sent);
const cli = async (argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, { env: KEYS, fetch });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

describe("codex-hooks c analysis, end to end on a pilot", () => {
  const dir = tmp("chc-cli-");
  const J = join(dir, "judging");
  const S = join(dir, "pilot-states.jsonl");
  const record = join(dir, "record");
  recordApproval(record, { action: "init", item: JUDGE_ITEM.item, cap_micros: JUDGE_ITEM.cap_usd * 1_000_000, quotes: [QUOTE], admission: "warn" });
  writeFileSync(
    S,
    jsonl([
      ...session({ arm: "c-on", unit: A, first: [at(A, "B1")], final: [at(A, "B1"), at(A, "B2")], usd: 1.2 }),
      ...session({ arm: "c-on", unit: B, final: [{ file: null, line: null, severity: "Critical", claim: "A real defect in the cache key", evidence: "" }], usd: 1.4 }),
      ...session({ arm: "c-on", unit: D, final: { message: message([at(D, "B3")]) }, usd: 1.6 }),
      ...session({ arm: "c-off", unit: A, final: [at(A, "B1")] }),
      ...session({ arm: "c-off", unit: B, final: [] }),
      ...session({ arm: "c-off", unit: D, final: [at(D, "B4")] }),
      ...session({ arm: "c-high", unit: A, final: [at(A, "B2")], usd: 3 }),
      ...session({ arm: "c-high", unit: B, final: [], usd: 3 }),
      ...session({ arm: "c-high", unit: D, final: [], usd: 3 }),
      ...session({ arm: "c-none", unit: A, final: [at(A, "B1", "HIGH")], usd: 0.4 }),
      ...session({ arm: "c-none", unit: B, final: [], usd: 0.4 }),
      ...session({ arm: "c-none", unit: D, final: [], usd: 0.4 }),
    ]),
  );
  const common = ["--states", S, "--dir", J, "--pilot"];
  mkdirSync(join(dir, "r-ledgers"));
  writeFileSync(join(dir, "crew.json"), JSON.stringify({ as_of: "test", usd: 0 }));
  writeFileSync(join(dir, "crew-over.json"), JSON.stringify({ as_of: "test", usd: 400 }));
  const allInFlags = ["--r-ledgers", join(dir, "r-ledgers"), "--crew", join(dir, "crew.json")];
  const paid = ["--item", JUDGE_ITEM.item, "--run-id", "geva-562-judge-test", "--ledger", join(dir, "ledger.sqlite"), "--record", record, ...allInFlags];

  test("extraction: one packet for the one message with no json block, read by the primary", async () => {
    const p = await cli(["packets", "extract", ...common]);
    expect(p).toMatchObject({ code: 0, err: "" });
    expect(p.out).toMatch(/^extract: batch [0-9a-f]{64}, 1 packets/);
    const over = await cli(["run", "extract", ...common, ...paid.slice(0, -1), join(dir, "crew-over.json")]);
    expect(over.code).toBe(2);
    expect(over.err).toStartWith("E_CH_ALL_IN all-in $1288.20 (items $888.20, crew $400.00 as of test) passes the $1200.00 stop");
    expect(sent).toHaveLength(0);
    expect(existsSync(join(J, "extract-run"))).toBe(false);
    const r = await cli(["run", "extract", ...common, ...paid]);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/^extract: batch [0-9a-f]{64}, 1 requests, 0 packets unjudged/);
    expect(JSON.parse(readFileSync(join(J, "extract-run", "run.json"), "utf8"))).toMatchObject({ stage: "extract", route: "A", models: ["anthropic/claude-opus-5-5"], item: JUDGE_ITEM.item, run_id: "geva-562-judge-test", requests: 1 });
  });

  test("matching: the pilot batch adds anchors up to 30% of the check set", async () => {
    const p = await cli(["packets", "match", ...common]);
    expect(p.err).toBe("");
    expect(p.out).toMatch(/^match: batch [0-9a-f]{64}, 16 packets \(8 anchors\), 5 states with no counted finding, 0 left unjudged by extraction/);
    expect(existsSync(join(J, "match-key.json"))).toBe(true);
    expect(existsSync(join(J, "match", "match-key.json"))).toBe(false);
  });

  test("the dry run prices every request and sends nothing", async () => {
    const before = sent.length;
    const r = await cli(["run", "match", ...common, "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n").filter((l) => /^\S+ {2}packets\/P\d+\.json {2}worst case \$/.test(l)).length).toBe(3 * 16);
    expect(r.out).toMatch(/Nothing was sent\.$/);
    expect(sent.length).toBe(before);
  });

  test("matching runs primary, second and third, and the join writes each state's judgment", async () => {
    const r = await cli(["run", "match", ...common, ...paid]);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/^match: batch \w+, \d+ requests, 0 packets unjudged/);
    expect(existsSync(join(J, "match-run", "third.json"))).toBe(true);
    const again = await cli(["run", "match", ...common, ...paid]);
    expect(again).toMatchObject({ code: 2 });
    expect(again.err).toMatch(/^E_USAGE .*already holds a finished run/);
    const j = await cli(["join", "match", ...common]);
    expect(j.err).toBe("");
    expect(j.out).toMatch(/^match join: 13 states; second read \d+ items, third \d+, kappa primary against second/);
    const judged = JSON.parse(readFileSync(join(J, "judged.json"), "utf8"));
    expect(judged.route).toBe("A");
    expect(judged.states.find((s: { id: string }) => s.id === sessionId("c-on", A, 1) + "#final").matches).toEqual({ B1: [0], B2: [1] });
    expect(judged.states.find((s: { id: string }) => s.id === sessionId("c-on", D, 1) + "#final")).toMatchObject({ extracted: true, matches: { B3: [0], B1: [], B2: [], B4: [] } });
  });

  test("gold labels and the judge check: too few gold items for kappa to count, so the check fails and says why", async () => {
    const g = await cli(["run", "gold", ...common, ...paid]);
    expect(g.err).toBe("");
    expect(existsSync(join(J, "gold-run", "gold-1.json")) && existsSync(join(J, "gold-run", "gold-2.json"))).toBe(true);
    const c = await cli(["check", ...common]);
    expect(c.err).toBe("");
    expect(c.out).toMatch(/^judge check, route A: fail; primary kappa \S+ on \d+ gold items \(\d+ gold items, under 40\)/);
    const check = JSON.parse(readFileSync(join(J, "check.json"), "utf8"));
    expect(check.set).toMatchObject({ anchors: 8 });
    expect(check.set.anchor_share).toBeLessThanOrEqual(0.3);
    expect(check.gold.disagree).toBeGreaterThan(0);
  });

  test("adjudication: one finding with no file, with its evidence sheet, ruled a new blocker", async () => {
    const p = await cli(["packets", "adjudicate", ...common]);
    expect(p.err).toBe("");
    expect(p.out).toMatch(/^adjudicate: batch \w+, 1 packets/);
    const sheet = JSON.parse(readFileSync(join(J, "adjudicate", "sheets", "A1.json"), "utf8"));
    expect(sheet.findings[0]).toMatchObject({ code: null, code_note: "the finding names no file, so the sheet shows no code" });
    expect((await cli(["run", "adjudicate", ...common, ...paid])).err).toBe("");
    const j = await cli(["join", "adjudicate", ...common]);
    expect(j.err).toBe("");
    const judged = JSON.parse(readFileSync(join(J, "judged.json"), "utf8"));
    expect(judged.batches.adjudicate).toMatch(/^[0-9a-f]{64}$/);
    expect(judged.states.find((s: { id: string }) => s.id === sessionId("c-on", B, 1) + "#final").rulings).toEqual({ "0": "defect" });
  });

  test("every step spent from the one judge item under the one run id", () => {
    const state = readItem(record, JUDGE_ITEM.item);
    expect(state.committed_micros).toBeGreaterThan(0);
    expect(state.committed_micros).toBeLessThan(JUDGE_ITEM.cap_usd * 1_000_000);
  });

  test("analyze reads the contract and E3 tables, and refuses a route other than the one judged", async () => {
    const route = join(dir, "route.json");
    writeFileSync(route, JSON.stringify({ route: "A" }));
    const a = await cli(["analyze", ...common, "--route-file", route]);
    expect(a.err).toBe("");
    expect(a.out).toMatch(/^Contract: The contract blocked in 1 of 3 c-on sessions, fewer than 7/);
    expect(a.out).toMatch(/\nE3: E3, c-high's final minus c-on's final: /);
    expect(a.out).toMatch(/\ncontract primary: c-on final minus c-on first stop: \+14\.3 points \[\+0\.0 points, \+50\.0 points\], sign-flip p 1\.00 on 1 clusters/);
    expect(a.out).toMatch(/\nc-on: 3 of 3 sessions scored; blocked 1, false blocks 0/);
    expect(a.out).toMatch(/MDDs \(power.txt\): contract primary 11.5 points at 0% losses/);
    const json = JSON.parse((await cli(["analyze", ...common, "--route-file", route, "--json"])).out);
    expect(json.contract.row).toBe("ceiling");
    expect(json.analysis.arms["c-on"].per_state.final.new_blockers).toBe(1);
    writeFileSync(route, JSON.stringify({ route: "B" }));
    const b = await cli(["analyze", ...common, "--route-file", route]);
    expect(b.code).toBe(2);
    expect(b.err).toMatch(/^E_CH_C_CHECK the route that passed is B, but judged.json was judged on route A/);
    writeFileSync(route, JSON.stringify({ route: null }));
    expect((await cli(["analyze", ...common, "--route-file", route])).out).toMatch(/^Contract: No reading: no judge route passed/);
    const other = join(dir, "other-states.jsonl");
    const text = readFileSync(S, "utf8");
    expect(text).toContain('"usd":1.2');
    writeFileSync(other, text.replaceAll('"usd":1.2', '"usd":1.3'));
    writeFileSync(route, JSON.stringify({ route: "A" }));
    const mixed = await cli(["analyze", "--states", other, "--dir", J, "--pilot", "--route-file", route]);
    expect(mixed.code).toBe(2);
    expect(mixed.err).toMatch(/^E_CH_C_BLIND the extract batch was built from another states file/);
  });

  test("the pilot readout gives supply, exposure, cost, the judge check and the R113 line, and no found rate", async () => {
    const hand = join(dir, "hand.json");
    writeFileSync(hand, JSON.stringify(["c-on", "c-off", "c-high", "c-none"].flatMap((arm) => [A, B].map((u) => ({ arm, session: sessionId(arm as "c-on", u, 1), agree: true, note: "" })))));
    const r = await cli(["pilot", "--states", S, "--hand", hand, "--dir", J]);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/^c-on: 3 of 3 scored, gaps \{\}, reruns 0; blocked 1/);
    expect(r.out).toMatch(/\njudge check: fail/);
    expect(r.out).toMatch(/\nR113: no interim look\. The counted run re-priced at the pilot's costs is \$\d+\.\d\d/);
    expect(r.out).not.toMatch(/found/);
  });

  test("route, judge-item and power", async () => {
    const yes = join(dir, "yes.json");
    writeFileSync(yes, JSON.stringify({ route: "B", pass: true }));
    const r = await cli(["route", "--check", "A=" + join(J, "check.json"), "--check", "B=" + yes, "--confirm", "B=" + yes]);
    expect(JSON.parse(r.out)).toEqual({ route: "B", checks: { A: false, B: true }, confirmations: { B: true } });
    const i = await cli(["judge-item"]);
    expect(i.out).toMatch(/^judge item geva-562-judge: central \$55, cap \$80\.00; on a temporary ledger, lease \S+ opened and settled \(\S+ at \$0\.00\), \$0\.00 committed/);
    expect(JSON.parse((await cli(["power"])).out)).toEqual(JSON.parse(JSON.stringify(POWER)));
  });

  test("refuses a batch built from another states file, confirm on a pilot, and an unknown command", async () => {
    const other = join(dir, "other.jsonl");
    writeFileSync(other, readFileSync(S, "utf8") + "\n");
    const j = await cli(["join", "match", "--states", other, "--dir", J, "--pilot"]);
    expect(j.code).toBe(2);
    expect(j.err).toMatch(/^E_CH_C_BLIND the match batch was built from another states file/);
    expect((await cli(["confirm", ...common])).err).toMatch(/^E_USAGE confirm reads the counted run/);
    expect((await cli(["nope"])).err).toMatch(/^E_USAGE unknown command "nope"/);
    expect((await cli(["packets", "match", "--states"])).err).toMatch(/^E_USAGE --states needs a value/);
  });
});

describe("evidence sheets from a local clone", () => {
  const repo = tmp("chc-clone-");
  mkdirSync(join(repo, "lib"), { recursive: true });
  writeFileSync(join(repo, "lib", "x.ts"), Array.from({ length: 100 }, (_, i) => "line " + (i + 1)).join("\n") + "\n");
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).stdout.trim();
  git("init", "-q");
  git("add", ".");
  const tree = git("write-tree");
  const unit = { ...unitOf(3593), head: tree };
  const codeAt = gitCodeAt(new Map([[unit.repo, repo]]));
  test("shows 30 lines either side of the finding's line, numbered", () => {
    const r = codeAt(unit, "lib/x.ts", 50);
    expect(r.code_note).toBeNull();
    expect(r.code).toMatchObject({ path: "lib/x.ts", from: 20, to: 80 });
    expect(r.code!.text.split("\n")[0]).toBe("20  line 20");
    expect(r.code!.text.split("\n").length).toBe(61);
  });
  test("says why there is no code: no file, a file not at the head, a line past the end", () => {
    expect(codeAt(unit, null, null).code_note).toMatch(/names no file/);
    expect(codeAt(unit, "lib/missing.ts", 3).code_note).toMatch(/is not a file in the repository at the head/);
    expect(codeAt(unit, "lib/x.ts", 101).code_note).toMatch(/line 101 is past the end of lib\/x.ts \(100 lines\)/);
  });
  test("refuses a finding whose repository has no clone", () => {
    expect(() => gitCodeAt(new Map())(unit, "lib/x.ts", 1)).toThrow(/^E_USAGE no --source clone for garrytan\/gstack/);
  });
});
