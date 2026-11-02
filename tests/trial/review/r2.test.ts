import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArm } from "../../../lanes/review-noloss/contract.ts";
import type { Suite } from "../../../lanes/review-noloss/suite.ts";
import { hostDriver } from "../../../src/adapters/host.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import { parseClaudeCode } from "../../../src/grade/transcript.ts";
import { openLease, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { LedgerError } from "../../../src/runner/ledger/record.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { dirTreeSha256 } from "../../../src/trial/cache.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { loadReaderMap, READER_ROW, READERS_SHA256, readTranscript, type ReaderMap } from "../../../src/trial/review/readers.ts";
import { CAPPED_PARSER_SHA256, cappedParse } from "../../../src/trial/review/capped.ts";
import { HELD_PARSER_SHA256 } from "../../../src/trial/review/held.ts";
import { PARSER_SHA256 } from "../../../src/trial/review/findings.ts";
import { readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness } from "../../adapters/harness.ts";
import { sourceRepo } from "./helpers.ts";

// The R2 build end to end without a key (R48 follow-ups prereg, section 3.6): review units through runReviewUnits with
// the real Claude Code driver and the pinned Agent SDK, whose CLI is the stub (tests/adapters/fixtures/stub-cli.cjs), so
// every record below is the driver's own output. The stub launches readers, hits the turn cap (after writing a findings
// block, when the cell asks) or answers with the metering proxy's allowance refusal, as each cell asks.

const OPUS = "claude-opus-5-5";
const STUB = join(REPO_ROOT, "tests", "adapters", "fixtures", "stub-cli.cjs");
const MAP_FILE = join(REPO_ROOT, "src", "trial", "review", "reader-maps", "gstack-77fe28c39796.json");
const GATE = join(REPO_ROOT, "wiki", "plans", "2026-11-01-geva-101-r48-follow-ups-prereg", "r1-exposure.py.txt");
const R2_PREFIX = "/review Run the full review procedure: dispatch the Review Army specialists your plan selects and run the adversarial pass. Do not make Fix-First edits; report findings only. Writes to gstack's own state (its learnings, timeline and review log) are allowed.";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const loaded = loadReaderMap(MAP_FILE) as { map: ReaderMap; sha256: string };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const durable = () => {
  const dir = mkdtempSync(join(REPO_ROOT, ".review-units-test-"));
  roots.push(dir);
  return dir;
};
const files = (dir: string) => {
  const map = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : map.set(relative(dir, join(d, n)), readFileSync(join(d, n)));
  };
  walk(dir);
  return map;
};

const specialist = (name: string) => "You are a specialist code reviewer. Read the checklist at ~/.claude/skills/gstack/review/specialists/" + name + ".md, then run DIFF_BASE=$(git merge-base origin/main HEAD) && git diff \"$DIFF_BASE\" to get the full diff.";
const ADVERSARIAL = "Read the diff for this branch. Think like an attacker and a chaos engineer. Your job is to find ways this code will fail in production.";
const ARMY = [
  { id: "tu_testing", prompt: specialist("testing"), started: true, tokens: 41000 },
  { id: "tu_api", prompt: specialist("api-contract"), started: true, tokens: 38000 },
  { id: "tu_state", prompt: specialist("state-machines"), started: true, tokens: 36000 },
  { id: "tu_adv", prompt: ADVERSARIAL, started: true, tokens: 52000 },
];
const findings = (claim: string) => "Review done.\n\n```json\n" + JSON.stringify([{ file: "src/a.ts", line: 1, severity: "CRITICAL", claim, evidence: "src/a.ts:1 changes the exported value." }]) + "\n```\n";
const SPENT = 'API Error: 402 {"type":"https://github.com/garrytan/gstack-evals/blob/main/docs/errors.md#e_allowance","title":"E_ALLOWANCE","status":402,"code":"E_ALLOWANCE","detail":"E_ALLOWANCE: metering proxy: the slot\'s allowance of $40.000000 cannot hold this call\'s worst case of $1.120000 ($39.100000 already committed)"}';
const cells = {
  readers: { STUB_MODE: "agents", STUB_AGENTS: JSON.stringify(ARMY), STUB_FINAL: findings("The API contract changes: callers of a now get 2.") },
  plain: { STUB_MODE: "agents", STUB_AGENTS: "[]", STUB_FINAL: findings("The data migration leaves old rows on 1.") },
  turns: { STUB_MODE: "turns" },
  turnsReview: { STUB_MODE: "turns", STUB_TURN_TEXTS: JSON.stringify({ 2: findings("The cache key drops the allowance."), 3: "One more check.\n\n```json\n{\"draft\": true}\n```\n" }) },
  spent: { STUB_MODE: "apierror", STUB_API_ERROR: SPENT, STUB_API_STATUS: "402" },
  held: { STUB_MODE: "background", STUB_BG: JSON.stringify({ first: findings("The retry loop never backs off."), readers: [{ id: "tu_bg", delay: 300, kind: "local_bash" }] }), STUB_FINAL: "The background check finished; my findings above stand." },
  hung: { STUB_MODE: "background", STUB_BG: JSON.stringify({ first: findings("The lock is never released."), readers: [{ id: "tu_hang", delay: null }] }) },
  hungBare: { STUB_MODE: "background", STUB_BG: JSON.stringify({ readers: [{ id: "tu_hang", delay: null }] }) },
} as const;

/** The harness's local sandbox, with the stub as the CLI and each cell's stub settings in its env. */
function stubSandbox(cell: (task: string) => Record<string, string>): Sandbox {
  return {
    isolation: "process",
    workPath: (work) => work,
    fixturesPath: (fixtures) => fixtures,
    homePath: (dir) => join(dir, "home"),
    step(_role, command, _task, o) {
      const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: o.timeoutMs, encoding: "utf8" });
      return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    agent(task, o) {
      mkdirSync(o.env.HOME!, { recursive: true });
      return {
        exec: (command, timeoutMs) => {
          const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: timeoutMs, encoding: "utf8" });
          return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        },
        spawn: (argv, extra = {}) => (argv[0] === "claude" ? spawn(process.execPath, [STUB, ...argv.slice(1)], { cwd: o.work, env: { ...o.env, PATH: process.env.PATH ?? "", ...extra, ...cell(task) }, stdio: ["pipe", "pipe", "pipe"] }) : spawn(argv[0]!, argv.slice(1), { cwd: o.work, env: { ...o.env, PATH: process.env.PATH ?? "", ...extra }, stdio: ["pipe", "pipe", "pipe"] })),
        stop() {},
      };
    },
  } as Sandbox;
}

/** Two units of one synthetic repo, and a suite naming them. */
function twoUnits() {
  const s = sourceRepo();
  const dir = join(mkdtempSync(join(tmpdir(), "gse-r2unit-")), "repo");
  roots.push(dir);
  const units = [7, 8].map((pr) => ({ id: "garrytan/gstack#" + pr + "@" + s.head.slice(0, 12), repo: "garrytan/gstack", pr, head: s.head, base: s.base }));
  const repo = buildUnitRepo({ unit: units[0]!, source: s.root, dest: dir });
  const prepared: PreparedUnit[] = units.map((unit) => ({ unit, task: unitTaskId(unit), base_branch: repo.base_branch, merge_base: repo.merge_base, tree: dir, tree_sha256: dirTreeSha256(dir), instructions: repo.instructions }));
  const suite = { schema_version: 1, id: "r2-test", title: "t", kind: "noloss", units: units.map((u) => ({ ...u, cluster: u.repo + "#" + u.pr, group: null, blockers: [] })) };
  return { prepared, suite };
}

function stubRun(o: { prepared: PreparedUnit[]; plan: Record<string, Record<string, keyof typeof cells>>; settings: Partial<ReviewRunInput> }) {
  const h = harness(() => [{ type: "text", text: "ok" }]);
  roots.push(h.dir);
  const byTask = new Map(o.prepared.map((p) => [p.task, p.unit.id]));
  const rig: HostRig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request) => h.proxy.bind(request),
    finalize: (m) => h.proxy.finalize(m),
    arms: { "gstack-full": { tree_sha256: "gstack-tree", skill: null, gstack: null, plugins: [], provenance: { kind: "stack", stack: { repo: "garrytan/gstack", sha: loaded.map.gstack.sha, source: "local-git" } } } as never, "none-r2": { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] } },
    sandbox: (arm) => stubSandbox((task) => cells[o.plan[arm]![byTask.get(task)!]!]),
    judgeSandbox: () => stubSandbox(() => ({})),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
  const out = durable();
  const input: ReviewRunInput = { host: "claude", suite: { id: "r2-test", sha256: null }, units: o.prepared, arms: [{ name: "gstack-full", told: "gstack", toldPrefix: R2_PREFIX, systemPrompt: "claude-code-preset" }, { name: "none-r2", told: "none", systemPrompt: "claude-code-preset" }], models: [OPUS], passes: 1, parallel: 2, timeoutS: 120, cap: 1_000_000_000, runId: "r2-stub", out, date: "2026-11-01", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: join(h.dir, "journal.ndjson"), env: {}, ...o.settings };
  return { rig, input, out, h };
}

/** A session key part's hash for a string value, as sessionKey writes it. */
const keyPart = (value: string) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
const arm = (out: string, id: string) => JSON.parse(readFileSync(join(out, "arms", id, "arm.json"), "utf8"));
const costRows = (out: string, id: string) => readFileSync(join(out, "arms", id, "cost.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));

describe("R2 build: a stub run through the run loop with the real driver and the pinned Agent SDK (keyless)", () => {
  // Value: protects=section 3.6 items 2 and 3, GEVA-116's note and GSTA-2's cap-stop ruling in the records R2 scores: under R2's settings (200 turns, a $40 allowance) a session the turn cap ends and one the allowance stops are journaled as turn_cap and allowance_stop, each scored against its own arm (with no findings block, as finding nothing), never a coverage gap, counted with its unit in arm.json's cap_stops and named in diagnostics, in both arms alike; the reader map's rows reach cost.tsv in the pinned format, ingest's contract accepts the arms, and resume reuses every cell; fails_when=a cap stop becomes a coverage gap or stops its arm, goes uncounted or unnamed, reader rows are missing, malformed or written for a session with no launches, or the contract refuses a reader row; why_new=R2 build (GEVA-122), GSTA-2's ruling (GEVA-129); seam=runReviewUnits, hostDriver, claudeCodeDriver, readers.ts, costTsv; no_claim=a real model or the Docker rig
  test("cap stops are their own terminations, scored against their own arm, and reader rows land in cost.tsv", async () => {
    const { prepared, suite } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const run = stubRun({ prepared, plan: { "gstack-full": { [a]: "readers", [b]: "turns" }, "none-r2": { [a]: "plain", [b]: "spent" } }, settings: { maxTurns: 200, allowanceMicros: 40_000_000, capStops: true, readers: { map: loaded.map, sha256: loaded.sha256 } } });
    try {
      const first = await runReviewUnits(run.input, run.rig);
      const journal = readReviewJournal(run.out);
      const ended = (armName: string, unit: string) => [...journal.values()].find((e) => e.cell.arm === armName && e.cell.unit === unit)!.record.termination;
      expect([ended("gstack-full", a), ended("gstack-full", b), ended("none-r2", a), ended("none-r2", b)]).toEqual([{ kind: "completed" }, { kind: "turn_cap" }, { kind: "completed" }, { kind: "allowance_stop" }]);
      expect(first.stops).toEqual([]);
      const full = arm(run.out, "gstack-full-opus");
      const none = arm(run.out, "none-r2-opus");
      expect([full.status, none.status]).toEqual(["complete", "complete"]);
      expect([full.cap_stops, none.cap_stops]).toEqual([{ turn_cap: 1, allowance_stop: 0, units: [b], parser_sha256: CAPPED_PARSER_SHA256 }, { turn_cap: 0, allowance_stop: 1, units: [b], parser_sha256: CAPPED_PARSER_SHA256 }]);
      expect(READERS_SHA256).toBe(new Bun.CryptoHasher("sha256").update(readFileSync(join(REPO_ROOT, "src/trial/review/readers.ts"))).digest("hex"));
      expect(new Set([...journal.values()].map((e) => e.key.parts.verifier))).toEqual(new Set([keyPart(PARSER_SHA256 + "+" + CAPPED_PARSER_SHA256 + "+" + READERS_SHA256 + "+" + HELD_PARSER_SHA256)]));
      expect([full.coverage_gaps, none.coverage_gaps]).toEqual([undefined, undefined]);
      expect(full.diagnostics).toEqual([b + " pass 1: missing; ended turn_cap, settled spend $0.000000, scored as finding nothing"]);
      expect(none.diagnostics).toEqual([b + " pass 1: missing; ended allowance_stop, settled spend $0.000000, scored as finding nothing"]);
      expect([full.parse_outcomes, none.parse_outcomes].map((c) => [c.findings, c.missing, c.incomplete])).toEqual([[1, 1, 0], [1, 1, 0]]);
      for (const id of ["gstack-full-opus", "none-r2-opus"]) expect(readFileSync(join(run.out, "arms", id, "findings", b.replaceAll("/", "__") + ".jsonl"), "utf8")).toBe("");
      expect([full.reader_map_sha256, none.reader_map_sha256]).toEqual([loaded.sha256, loaded.sha256]);
      expect(full.told.prefix_sha256).toBe(new Bun.CryptoHasher("sha256").update(R2_PREFIX).digest("hex"));
      const rows = costRows(run.out, "gstack-full-opus");
      expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[11]])).toEqual([
        [a, "all", "1", "0", "proxy-journal"],
        [a, "reader:adversarial-native", "1", "52000", "reader-counter"],
        [a, "reader:api-contract", "1", "38000", "reader-counter"],
        [a, "reader:state-machines", "1", "36000", "reader-counter"],
        [a, "reader:testing", "1", "41000", "reader-counter"],
        [b, "all", "1", "0", "proxy-journal"],
      ]);
      for (const r of rows.filter((x) => x[1]!.startsWith("reader:"))) {
        expect(r[1]).toMatch(READER_ROW.scope);
        expect(r[2]).toMatch(READER_ROW.pass);
        expect(r[11]).toBe(READER_ROW.meter_source);
        expect(r[0]).toBe(rows.find((x) => x[1] === "all" && x[2] === r[2] && x[0] === r[0])![0]);
      }
      expect(costRows(run.out, "none-r2-opus").map((r) => r[1])).toEqual(["all", "all"]);
      for (const id of ["gstack-full-opus", "none-r2-opus"]) expect(() => parseArm(files(join(run.out, "arms", id)), suite as unknown as Suite)).not.toThrow();
      const again = await runReviewUnits({ ...run.input, reuse: readReviewJournal(run.out) }, run.rig);
      expect(again.spent).toBe(0);
      expect(costRows(run.out, "gstack-full-opus")).toEqual(rows);
      const changed = await runReviewUnits({ ...run.input, allowanceMicros: 15_000_000, reuse: readReviewJournal(run.out) }, run.rig);
      expect([changed.stale.length, changed.stale[0]!.message]).toEqual([4, expect.stringContaining("task")]);
    } finally {
      run.h.proxy.stop();
    }
  }, 120_000);

  // Value: protects=GSTA-2's cap-stop ruling: a session the turn cap ends is scored on the last findings block its main agent wrote before the stop, past a later json block that is not findings, and one that wrote none is scored as finding nothing; the arm stays complete and counts both; fails_when=a capped session's findings are dropped, read from a non-findings block, or the arm stops; why_new=GSTA-2's ruling (GEVA-129); seam=cappedParse in runReviewUnits, the driver's turns; no_claim=a real model
  test("a capped session is scored on the findings it wrote before the stop", async () => {
    const { prepared, suite } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const run = stubRun({ prepared, plan: { "gstack-full": { [a]: "turnsReview", [b]: "turns" }, "none-r2": { [a]: "plain", [b]: "plain" } }, settings: { maxTurns: 5, capStops: true } });
    try {
      const first = await runReviewUnits(run.input, run.rig);
      expect(first.stops).toEqual([]);
      const full = arm(run.out, "gstack-full-opus");
      expect([full.status, full.cap_stops, full.coverage_gaps]).toEqual(["complete", { turn_cap: 2, allowance_stop: 0, units: [a, b], parser_sha256: CAPPED_PARSER_SHA256 }, undefined]);
      expect(full.diagnostics).toEqual([a + " pass 1: findings; ended turn_cap, settled spend $0.000000, scored on the findings it wrote before the stop", b + " pass 1: missing; ended turn_cap, settled spend $0.000000, scored as finding nothing"]);
      const lines = readFileSync(join(run.out, "arms", "gstack-full-opus", "findings", a.replaceAll("/", "__") + ".jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.map((f) => [f.severity, f.path, f.summary])).toEqual([["CRITICAL", "src/a.ts", "The cache key drops the allowance."]]);
      expect(arm(run.out, "none-r2-opus").cap_stops).toEqual({ turn_cap: 0, allowance_stop: 0, units: [], parser_sha256: CAPPED_PARSER_SHA256 });
      for (const id of ["gstack-full-opus", "none-r2-opus"]) expect(() => parseArm(files(join(run.out, "arms", id)), suite as unknown as Suite)).not.toThrow();
    } finally {
      run.h.proxy.stop();
    }
  }, 120_000);

  // Value: protects=the cap-stop read rule itself: the latest text turn whose last json block parses as findings wins, an empty array is a real zero, and malformed or non-array blocks never count; fails_when=an earlier block beats a later valid one, a malformed block scores, or no block reads as anything but missing; why_new=GSTA-2's ruling (GEVA-129); seam=cappedParse; no_claim=the driver
  test("cappedParse reads the latest findings block and ignores the rest", () => {
    const block = (body: string) => "x\n\n```json\n" + body + "\n```\n";
    const one = JSON.stringify([{ file: "a.ts", line: 1, severity: "HIGH", claim: "c", evidence: "e" }]);
    expect(cappedParse([])).toEqual({ kind: "missing" });
    expect(cappedParse(["Looking at the diff.", block("{\"a\": 1}"), block("[{\"file\": 3}]")])).toEqual({ kind: "missing" });
    expect(cappedParse([block(one), "Checking one more file.", block("not json")])).toEqual({ kind: "findings", findings: [{ file: "a.ts", line: 1, severity: "HIGH", claim: "c", evidence: "e" }] });
    expect(cappedParse([block(one), block("[]")])).toEqual({ kind: "findings", findings: [] });
  });

  // Value: protects=the cap-stop read rule's source: a capped session is scored on its main agent's own text, read from the session's transcript, so a findings-shaped json block inside an AskUserQuestion question (which the driver's turns also hold, unmarked) earns no credit, the same block in main-agent text still scores, and a capped session whose transcript is gone scores as finding nothing; fails_when=a capped session is credited with a question's findings, loses its main agent's findings, or scores findings without a transcript; why_new=GEVA-129's /ship outside voice (capped.ts read every entry of record.turns); seam=runReviewUnits' capped parse, the driver's transcript.ndjson and turns; no_claim=a real model asking a question in a review session
  test("a findings block inside an AskUserQuestion question earns no capped credit", async () => {
    const { prepared } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const asked = findings("A question carried this block.");
    const ask = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "tu_ask", name: "AskUserQuestion", input: { questions: [{ question: asked, header: "Post", options: [{ label: "Yes", description: "" }, { label: "No", description: "" }], multiSelect: false }] } }] }, parent_tool_use_id: null, session_id: "s" };
    const capped = async (keep: boolean) => {
      const run = stubRun({ prepared, plan: { "gstack-full": { [a]: "turnsReview", [b]: "turns" }, "none-r2": { [a]: "plain", [b]: "plain" } }, settings: { maxTurns: 5, capStops: true } });
      const rig: HostRig = {
        ...run.rig,
        driver: (o) => {
          const d = hostDriver(o);
          return {
            ...d,
            async run(...args: Parameters<typeof d.run>) {
              const r = await d.run(...args);
              if (r.termination.kind !== "turn_cap") return r;
              const file = join(o.out, "transcript.ndjson");
              appendFileSync(file, JSON.stringify(ask) + "\n");
              const turns = parseClaudeCode(readTranscript(readFileSync(file, "utf8"))).turns;
              if (!keep) rmSync(file);
              return { ...r, turns };
            },
          };
        },
      };
      try {
        await runReviewUnits(run.input, rig);
        const journal = [...readReviewJournal(run.out).values()].filter((e) => e.cell.arm === "gstack-full");
        const lines = (unit: string) => readFileSync(join(run.out, "arms", "gstack-full-opus", "findings", unit.replaceAll("/", "__") + ".jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).summary);
        return { ended: [a, b].map((u) => journal.find((e) => e.cell.unit === u)!.record).map((r) => [r.termination.kind, r.turns.at(-1)!.startsWith(asked)]), diagnostics: arm(run.out, "gstack-full-opus").diagnostics, findings: [lines(a), lines(b)] };
      } finally {
        run.h.proxy.stop();
      }
    };
    const kept = await capped(true);
    expect(kept.ended).toEqual([["turn_cap", true], ["turn_cap", true]]);
    expect(kept.diagnostics).toEqual([a + " pass 1: findings; ended turn_cap, settled spend $0.000000, scored on the findings it wrote before the stop", b + " pass 1: missing; ended turn_cap, settled spend $0.000000, scored as finding nothing"]);
    expect(kept.findings).toEqual([["The cache key drops the allowance."], []]);
    const gone = await capped(false);
    expect(gone.ended).toEqual([["turn_cap", true], ["turn_cap", true]]);
    expect(gone.diagnostics).toEqual([a + " pass 1: missing; ended turn_cap, settled spend $0.000000, scored as finding nothing", b + " pass 1: missing; ended turn_cap, settled spend $0.000000, scored as finding nothing"]);
    expect(gone.findings).toEqual([[], []]);
  }, 240_000);

  // Value: protects=GSTA-2's A1 and B1 rulings on #141 through the run loop with the real driver: a held code session whose report came before its background Bash landed is scored from that report and records the turn (scored_turn), a session that never waited records its final turn, and a reader that never lands ends at the background deadline as a gap whose session_end says whether a findings block existed; fails_when=the acknowledgement turn scores as finding nothing, the scored turn goes unrecorded, or a deadline session is scored or loses findings_block; why_new=the red team on #141; seam=runReviewUnits, held.ts and the driver on the pinned SDK with the stub CLI; no_claim=a real model
  test("a held session is scored from its report and records that turn; a deadline is a gap that records whether a block existed", async () => {
    const { prepared } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const run = stubRun({ prepared, plan: { "gstack-full": { [a]: "held", [b]: "hung" }, "none-r2": { [a]: "plain", [b]: "hungBare" } }, settings: { backgroundWaitS: 2 } });
    try {
      await runReviewUnits(run.input, run.rig);
      const journal = [...readReviewJournal(run.out).values()];
      const at = (name: string, unit: string) => journal.find((e) => e.cell.arm === name && e.cell.unit === unit)!;
      const held = at("gstack-full", a);
      expect([held.record.termination, held.record.turns.at(-1), held.parse.kind, held.scored_turn]).toEqual([{ kind: "completed" }, "The background check finished; my findings above stand.", "findings", { rule: "held", index: 0, of: 2 }]);
      expect(held.record.session_end!.waited_ms).toBeGreaterThan(0);
      expect([at("none-r2", a).parse.kind, at("none-r2", a).scored_turn?.rule]).toEqual(["findings", "final"]);
      expect([arm(run.out, "gstack-full-opus").held_rescues, arm(run.out, "none-r2-opus").held_rescues]).toEqual([1, 0]);
      for (const [name, block] of [["gstack-full", true], ["none-r2", false]] as const) {
        const e = at(name, b);
        expect([e.record.termination, e.parse.kind, e.record.session_end?.cause, e.record.session_end?.findings_block, e.scored_turn?.index]).toEqual([{ kind: "missing", code: "E_BACKGROUND_DEADLINE" }, "incomplete", "deadline", block, null]);
        expect(JSON.stringify(arm(run.out, name + "-opus").coverage_gaps)).toContain("E_BACKGROUND_DEADLINE");
      }
    } finally {
      run.h.proxy.stop();
    }
  }, 120_000);

  // Value: protects=GSTA-2's C1 ruling on #141 and the plumbing the specialist found untested: review-units always hands the driver its background wait (3600 s unless the run sets another), and only a wait off the default joins the session key, through its task part alone; fails_when=a run omits the wait (no hold), passes another value, or a wait off the default leaves the key unchanged; why_new=the testing specialist on #141; seam=runReviewUnits' hostDriver options and keyOf; no_claim=the CLI's parsing (cli.test.ts)
  test("review-units always passes its background wait to the driver, and a wait off the default joins the session key", async () => {
    const { prepared } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const plan = { "gstack-full": { [a]: "plain", [b]: "plain" }, "none-r2": { [a]: "plain", [b]: "plain" } } as const;
    const record = async (settings: Partial<ReviewRunInput>) => {
      const run = stubRun({ prepared, plan, settings });
      const waits: (number | undefined)[] = [];
      const rig: HostRig = { ...run.rig, driver: (o) => (waits.push(o.backgroundWaitMs), hostDriver(o)) };
      try {
        await runReviewUnits(run.input, rig);
        const journal = [...readReviewJournal(run.out).values()].sort((x, y) => (x.cell.arm + x.cell.unit).localeCompare(y.cell.arm + y.cell.unit));
        return { waits, parts: journal.map((e) => e.key.parts) };
      } finally {
        run.h.proxy.stop();
      }
    };
    const today = await record({});
    const named = await record({ backgroundWaitS: 3_600 });
    const sixty = await record({ backgroundWaitS: 60 });
    expect([today.waits, named.waits, sixty.waits]).toEqual([[3_600_000, 3_600_000, 3_600_000, 3_600_000], [3_600_000, 3_600_000, 3_600_000, 3_600_000], [60_000, 60_000, 60_000, 60_000]]);
    expect(named.parts).toEqual(today.parts);
    expect(sixty.parts.map((p, i) => p.task !== today.parts[i]!.task)).toEqual([true, true, true, true]);
    expect(sixty.parts.map(({ task: _, ...rest }) => rest)).toEqual(today.parts.map(({ task: _, ...rest }) => rest));
  }, 240_000);

  // Value: protects=C1 on #141 round 2: when a waited code session's transcript cannot be read, the run says so in its log and the session keeps the final-turn parse; fails_when=the fallback is silent; why_new=the round-2 specialist on #141; seam=runReviewUnits' transcript read; no_claim=why a transcript goes missing
  test("an unreadable transcript on a held session is logged, and the session keeps its final-turn parse", async () => {
    const { prepared } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const run = stubRun({ prepared, plan: { "gstack-full": { [a]: "held", [b]: "plain" }, "none-r2": { [a]: "plain", [b]: "plain" } }, settings: {} });
    const rig: HostRig = {
      ...run.rig,
      driver: (o) => {
        const d = hostDriver(o);
        return {
          ...d,
          async run(...args: Parameters<typeof d.run>) {
            const r = await d.run(...args);
            if ((r.session_end?.waited_ms ?? 0) > 0) rmSync(join(o.out, "transcript.ndjson"));
            return r;
          },
        };
      },
    };
    const lines: string[] = [];
    try {
      await runReviewUnits(run.input, rig, (l) => lines.push(l));
      const held = [...readReviewJournal(run.out).values()].find((e) => e.cell.arm === "gstack-full" && e.cell.unit === a)!;
      expect([held.parse.kind, held.scored_turn?.rule]).toEqual(["missing", "final"]);
      expect(lines.filter((l) => l.includes("transcript.ndjson is unreadable"))).toEqual([expect.stringContaining(a)]);
    } finally {
      run.h.proxy.stop();
    }
  }, 120_000);

  // Value: protects=GEVA-116's byte-for-byte line: a run at today's defaults (60 turns, the policy allowance, no reader map) records the same stub sessions as before the build: the turn cap as completed, the allowance as a missing E_ALLOWANCE cell, no cap_stops or reader_map_sha256 in arm.json and no reader rows; fails_when=a default run gains a cap kind, an arm.json field or a cost row; why_new=GEVA-116's note on #119; seam=runReviewUnits' capStops and readers gates
  test("a default run keeps today's records", async () => {
    const { prepared } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const run = stubRun({ prepared, plan: { "gstack-full": { [a]: "readers", [b]: "turns" }, "none-r2": { [a]: "plain", [b]: "spent" } }, settings: {} });
    try {
      await runReviewUnits(run.input, run.rig);
      const journal = [...readReviewJournal(run.out).values()];
      expect(journal.map((e) => [e.cell.arm, e.cell.unit, e.record.termination]).sort()).toEqual([["gstack-full", a, { kind: "completed" }], ["gstack-full", b, { kind: "completed" }], ["none-r2", a, { kind: "completed" }], ["none-r2", b, { kind: "missing", code: "E_ALLOWANCE" }]].sort() as never);
      expect(journal.every((e) => !("readers" in e) && e.key.parts.verifier === keyPart(PARSER_SHA256 + "+" + CAPPED_PARSER_SHA256 + "+" + READERS_SHA256 + "+" + HELD_PARSER_SHA256))).toBe(true);
      for (const id of ["gstack-full-opus", "none-r2-opus"]) {
        expect(Object.keys(arm(run.out, id)).filter((k) => k === "cap_stops" || k === "reader_map_sha256")).toEqual([]);
        expect(costRows(run.out, id).map((r) => r[1])).toEqual(["all", "all"]);
      }
    } finally {
      run.h.proxy.stop();
    }
  }, 120_000);

  // Value: protects=GSTA-2's A1 ruling on #124: only --cap-stops turns cap stops on, so a run that sets just an allowance (stacks round 1's frozen --allowance 15 shape) keeps today's records byte for byte: the turn cap as completed, the allowance refusal as a missing E_ALLOWANCE cell, no cap_stops, the same cost.tsv (but wall_seconds) and the same session keys as the run without the allowance; fails_when=an allowance alone turns cap stops on or joins the session key; why_new=GEVA-129's /ship pass 1 found an allowance-only run scored refusals as allowance_stop.
  test("an allowance-only run keeps today's records and keys", async () => {
    const { prepared } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const plan = { "gstack-full": { [a]: "readers", [b]: "turns" }, "none-r2": { [a]: "plain", [b]: "spent" } } as const;
    const record = async (settings: Partial<ReviewRunInput>) => {
      const run = stubRun({ prepared, plan, settings });
      try {
        await runReviewUnits(run.input, run.rig);
        const journal = [...readReviewJournal(run.out).values()].sort((x, y) => (x.cell.arm + x.cell.unit).localeCompare(y.cell.arm + y.cell.unit));
        const ids = ["gstack-full-opus", "none-r2-opus"];
        return { ended: journal.map((e) => [e.cell.arm, e.cell.unit, e.record.termination]), keys: journal.map((e) => e.key), arms: ids.map((id) => readFileSync(join(run.out, "arms", id, "arm.json"), "utf8")), cost: ids.map((id) => readFileSync(join(run.out, "arms", id, "cost.tsv"), "utf8").split("\n").map((l) => l.split("\t").map((c, i) => (i === 10 ? "" : c)).join("\t"))) };
      } finally {
        run.h.proxy.stop();
      }
    };
    const today = await record({});
    const allowance = await record({ allowanceMicros: 15_000_000 });
    expect(allowance.ended).toEqual([["gstack-full", a, { kind: "completed" }], ["gstack-full", b, { kind: "completed" }], ["none-r2", a, { kind: "completed" }], ["none-r2", b, { kind: "missing", code: "E_ALLOWANCE" }]] as never);
    expect(allowance.arms.some((t) => t.includes("cap_stops"))).toBe(false);
    expect(allowance).toEqual(today);
  }, 240_000);

  // Value: protects=section 3.6's gate test: the frozen procedure gate (r1-exposure.py, attached to the merged prereg) passes on reader rows the driver recorded from sessions that ran three specialists and the adversarial pass, and fails on rows from sessions that launched no reader; fails_when=the rows' pr or pass don't resolve to the suite's PR-passes, or the scope isn't reader:<name>; why_new=section 3.6 item 3 and the B1 note; seam=cost.tsv reader rows, r1-exposure.py
  test("the frozen procedure gate passes on the specialists' rows and fails with no readers", async () => {
    const { prepared, suite } = twoUnits();
    const [a, b] = prepared.map((p) => p.unit.id) as [string, string];
    const run = stubRun({ prepared, plan: { "gstack-full": { [a]: "readers", [b]: "readers" }, "none-r2": { [a]: "plain", [b]: "plain" } }, settings: { readers: { map: loaded.map, sha256: loaded.sha256 } } });
    try {
      await runReviewUnits(run.input, run.rig);
      const suiteFile = join(run.out, "suite.json");
      writeFileSync(suiteFile, JSON.stringify(suite));
      const gate = (id: string) => spawnSync("python3", [GATE, suiteFile, join(run.out, "arms", id)], { encoding: "utf8" });
      const pass = gate("gstack-full-opus");
      const fail = gate("none-r2-opus");
      expect([pass.status, pass.stdout.trim().split("\n")]).toEqual([0, ["exposure: Review Army specialists ran in 2 of 2 PR-passes, the adversarial pass in 2, both in 2 (0 rows or findings name no PR-pass of the suite)", "gate: pass (both in at least 2 of 2 PR-passes)"]]);
      expect([fail.status, fail.stdout.trim().split("\n").at(-1)]).toEqual([3, "gate: FAIL (both in at least 2 of 2 PR-passes)"]);
    } finally {
      run.h.proxy.stop();
    }
  }, 120_000);
});

describe("R2 ledger items (keyless)", () => {
  // Value: protects=section 3.6 item 4: r2a-grid funds none-r2's run and r2b-grid gstack-full's, one run each at the recorded caps; a second run on a bound grid item is refused with E_ITEM_BOUND, and a lease past an item's cap is refused; fails_when=a grid item funds two runs or a run outspends its item; why_new=R48 follow-ups prereg section 5; seam=recordApproval and openLease, as review-units' rig opens its lease
  test("one lease per grid item; a second run on a bound item is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "gse-r2-ledger-"));
    roots.push(dir);
    const record = join(dir, "record");
    const local = LocalLedger.open(join(dir, "ledger.sqlite"));
    const quote = { words: "R48 follow-ups caps approved by GSTA-2 under R42, 2026-11-01 (approvals/2026-11-01-r48-follow-ups-caps.md); this item as section 5 of the merged prereg (#112, main f0b81c0).", by: "GSTA-2", source: "approvals/2026-11-01-r48-follow-ups-caps.md" };
    for (const [item, usd] of [["r2a-grid", 25], ["r2b-grid", 325]] as const) recordApproval(record, { action: "init", item, cap_micros: usd * 1_000_000, quotes: [quote], admission: "warn" });
    const code = (fn: () => unknown) => {
      try {
        fn();
        return "ok";
      } catch (e) {
        if (e instanceof LedgerError) return e.code;
        throw e;
      }
    };
    expect(code(() => openLease(record, local, { item: "r2a-grid", run_id: "r2-none", amount_micros: 26_000_000, requireAdmission: () => null }))).toBe("CAP_STOP");
    const none = openLease(record, local, { item: "r2a-grid", run_id: "r2-none", amount_micros: 25_000_000, requireAdmission: () => null });
    const full = openLease(record, local, { item: "r2b-grid", run_id: "r2-full", amount_micros: 325_000_000, requireAdmission: () => null });
    expect([none.line_item, none.run_id, full.line_item, full.run_id]).toEqual(["r2a-grid", "r2-none", "r2b-grid", "r2-full"]);
    expect(code(() => openLease(record, local, { item: "r2b-grid", run_id: "r2-full-again", amount_micros: 1_000_000, requireAdmission: () => null }))).toBe("E_ITEM_BOUND");
    expect(code(() => openLease(record, local, { item: "r2a-grid", run_id: "r2-full", amount_micros: 1_000_000, requireAdmission: () => null }))).toBe("E_ITEM_BOUND");
  });
});
