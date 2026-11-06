// GST-1437, the CEO harness follow-up to #225 (open notes 16 to 23 and 18): ceo rows, packets and readings bound to the
// run's suite digest, a cap-stopped cell never rerun by --resume, exposure_sha256 in rows.json, the transcripts in the
// receipts sink, the prereg freeze check on a ceo-outcome suite, exact model ids with model_id on each row, a handoff
// exposure check that only the handoff's own call passes, printf -v writing no Findings, and a repo name holding __.
// Keyless: the runs use a stub driver and the rows use ceo-pipeline.ts's synthetic run dirs.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { catalogsDigest, checkSuite, type Suite } from "../../../lanes/review-noloss/suite.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import * as ceoCli from "../../../src/trial/review/ceo-cli.ts";
import { autoplanCeoExposure, findingsWrittenTranscript, CEO_EXPOSURE_SHA256, handoffNamed } from "../../../src/trial/review/ceo-exposure.ts";
import { readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import { copyNamed, type AgentOutcome } from "../../../src/trial/trial.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";
import { binding, ceo, FENCE, MODEL, pipeline, PROJECTION, runDir, SMOKE, STAGE1_NONE, STAGE2, tmp, U1, U2, U3, unitsDir } from "./ceo-pipeline.ts";

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const fresh = (tag: string) => {
  const d = tmp(tag);
  roots.push(d);
  unitsDir(d);
  return d;
};
const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const editKey = (d: string, unit: string, edit: (k: Record<string, any>) => void) => {
  const f = join(d, "units", unit.replaceAll("/", "__"), "key.json");
  const k = json(f);
  edit(k);
  writeFileSync(f, JSON.stringify(k, null, 2) + "\n");
};
const stage1 = (d: string) => runDir(d, "run", [...STAGE1_NONE, ...SMOKE]);
const rows1 = (d: string, run: string, out = join(d, "rows.json")) => ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--out", out]);

describe("item 1 (note 16, 23): rows, packets and readings are bound to the run's suite digest", () => {
  // Value: protects=strict, category, remedy, decoy and every packet field come from the units the runs were made on; fails_when=an edited key.json or plan.md moves rows, packets or readings; why_new=GST-1437 item 1, #225 notes 16 and 23; seam=ceo rows/packets/readings --units; no_claim=custody of the units dir itself
  test("rows refuse a units dir whose digest differs from the runs' units.json", async () => {
    const d = fresh("bind-rows");
    const run = stage1(d);
    editKey(d, U1, (k) => (k.strict = "2026-09-30"));
    const r = await rows1(d, run);
    expect(r.code).toBe(2);
    expect(r.err).toContain("catalogs_sha256");
    expect(r.err).toContain("fix: ");
  });
  test("packets refuse a units dir edited after rows, and readings refuse one edited after packets", async () => {
    const d = fresh("bind-readings");
    const run = stage1(d);
    const p = await pipeline(d, 1, [run]);
    expect(p.log.filter((_, i) => i !== 1).map((l) => l.code)).toEqual(p.log.slice(1).map(() => 0));
    editKey(d, U1, (k) => ((k.remedy = null), (k.remedy_notes = null), (k.remedy_kind = null), (k.decoy = null)));
    const packets = await ceo(["packets", "--rows", p.rows, "--units", join(d, "units"), "--seed", "7", "--out", join(d, "packets-again"), "--key", join(d, "key-again.json")]);
    expect([packets.code, packets.err]).toEqual([2, expect.stringContaining("catalogs_sha256")]);
    const readings = await ceo(["readings", "--rows", p.rows, "--key", p.key, "--sol", p.dirs.sol!, "--opus", p.dirs.opus!, "--sonnet", p.dirs.sonnet!, "--units", join(d, "units"), "--out", join(d, "readings-again.json")]);
    expect([readings.code, readings.err]).toEqual([2, expect.stringContaining("catalogs_sha256")]);
    expect(existsSync(join(d, "readings-again.json"))).toBe(false);
  });
  test("a plan.md edit is refused too", async () => {
    const d = fresh("bind-plan");
    const run = stage1(d);
    writeFileSync(join(d, "units", U2.replaceAll("/", "__"), "plan.md"), "# Another plan\n");
    expect((await rows1(d, run)).code).toBe(2);
  });
  test("a run with no suite binding, or two runs of two suites, are refused", async () => {
    const d = fresh("bind-runs");
    const run = stage1(d);
    const units = json(join(run, "units.json"));
    writeFileSync(join(run, "units.json"), JSON.stringify({ ...units, suite: { id: "ceo-outcome-test", sha256: null } }));
    const r = await rows1(d, run);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("catalogs_sha256")]);
    const e = fresh("bind-two");
    const a = runDir(e, "a", STAGE1_NONE);
    const b = runDir(e, "b", SMOKE);
    writeFileSync(join(b, "units.json"), JSON.stringify({ ...json(join(b, "units.json")), suite: { ...binding(), sha256: "6".repeat(64) } }));
    const two = await ceo(["rows", "--stage", "1", "--units", join(e, "units"), "--run", a, "--run", b, "--out", join(e, "rows.json")]);
    expect([two.code, two.err]).toEqual([2, expect.stringContaining("another suite")]);
  });
  test("rows.json, the packet key and readings.json carry the binding; the digest is the suite stub's catalogs digest", async () => {
    const d = fresh("bind-carry");
    const p = await pipeline(d, 1, [stage1(d)]);
    const want = binding();
    expect(json(p.rows).suite).toEqual(want);
    expect(json(p.key).catalogs_sha256).toBe(want.catalogs_sha256);
    expect(json(p.readings).suite).toEqual(want);
    const suite = { kind: "ceo-outcome", catalogs: ["units"], units: [U3, U1, U2].map((id) => ({ id })) } as unknown as Suite;
    expect(catalogsDigest(suite, d)).toBe(want.catalogs_sha256);
  });
  test("stage 2 binds the same way", async () => {
    const d = fresh("bind-stage2");
    const proj = join(d, "projection.txt");
    writeFileSync(proj, PROJECTION);
    const p = await pipeline(d, 2, [runDir(d, "run2", STAGE2)], { projection: proj });
    expect(p.log.map((l) => l.code)).toEqual(p.log.map(() => 0));
    expect(json(p.readings).suite.catalogs_sha256).toBe(binding().catalogs_sha256);
  });
});

describe("item 8 (note 18): a repo name holding __ round-trips through its unit folder", () => {
  // Value: protects=a unit of owner/my__repo is read as its own id, not owner/my/repo; fails_when=the folder name is mapped back by replacing every __; why_new=#225 note 18; seam=ceo-cli readUnits; no_claim=none beyond protects
  test("readUnits reads the folder of each bound id", () => {
    const d = tmp("dunder");
    roots.push(d);
    const id = "acme/my__repo#14";
    const src = join(unitsDir(d), U1.replaceAll("/", "__"));
    const folder = join(d, "units", id.replaceAll("/", "__"));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "key.json"), readFileSync(join(src, "key.json")));
    writeFileSync(join(folder, "plan.md"), readFileSync(join(src, "plan.md")));
    const ids = [U1, U2, U3, id].sort();
    const digest = sha256(ids.flatMap((u) => ["key.json", "plan.md"].map((f) => join("units", u.replaceAll("/", "__"), f) + " " + sha256(readFileSync(join(d, "units", u.replaceAll("/", "__"), f))))).join("\n"));
    const units = (ceoCli as any).readUnits(join(d, "units"), { ...binding(), catalogs_sha256: digest, unit_ids: ids });
    expect(units.map((u: { id: string }) => u.id).sort()).toEqual(ids);
  });
});

describe("items 3 and 6 (notes 15, 21, 28): exposure_sha256 and exact model ids", () => {
  // Value: protects=rows record the detector digest and packets refuse rows from another one; only the prereg's three policy ids read as its models, and each row names its model id; fails_when=another Opus or Sol generation reads as the prereg's model, or rows from another detector build packets; why_new=GST-1437 items 3 and 6; seam=ceo rows/packets; no_claim=the ledger's own model record
  test("rows.json records exposure_sha256, and packets refuse rows with another", async () => {
    const d = fresh("exposure-sha");
    const r = await rows1(d, stage1(d));
    expect(r.code).toBe(0);
    const rows = json(join(d, "rows.json"));
    expect(rows.exposure_sha256).toBe(CEO_EXPOSURE_SHA256);
    writeFileSync(join(d, "rows-other.json"), JSON.stringify({ ...rows, exposure_sha256: "1".repeat(64) }));
    const p = await ceo(["packets", "--rows", join(d, "rows-other.json"), "--units", join(d, "units"), "--seed", "7", "--out", join(d, "packets"), "--key", join(d, "key.json")]);
    expect([p.code, p.err]).toEqual([2, expect.stringContaining("exposure_sha256")]);
  });
  test("each row carries model_id, the policy key the run ran", async () => {
    const d = fresh("model-id");
    await rows1(d, stage1(d));
    const rows = json(join(d, "rows.json")).rows as Array<{ model: string; model_id: string | null; status: string }>;
    for (const r of rows.filter((x) => x.status !== "gap")) expect(r.model_id).toBe(MODEL[r.model]!);
    expect(Object.values(MODEL).sort()).toEqual(["claude-opus-5-5", "openai/gpt-6.1-sol", "particle-ai/particle-1"]);
  });
  for (const other of ["claude-opus-5-1", "openai/gpt-6-sol", "anthropic/claude-opus-5-5", "openrouter/particle-ai/particle-1"])
    test("a run of " + other + " is refused, not read as one of the three", async () => {
      const d = fresh("model-exact");
      const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE], (e) => {
        if (e.cell.model === MODEL[other.includes("sol") ? "sol" : other.includes("particle") ? "particle" : "opus"] && e.cell.unit === U1 && e.cell.pass === 1 && e.cell.arm === "none") e.cell.model = other;
      });
      const r = await rows1(d, run);
      expect([r.code, r.err]).toEqual([2, expect.stringContaining(other)]);
    });
});

const AP = "/work/agent/.gstack/projects/demo/autoplan-run-1";
const LINE = "Auto-selected review mode \u2192 HOLD SCOPE (CEO-only run: Step 0E's rule). Approved decisions: none.";
const CALL = '~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff "HOLD SCOPE" --ceo-only --decisions "none"';
let n = 0;
const bash = (command: string, result: string) => {
  const id = "toolu_f" + ++n;
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] }, parent_tool_use_id: null },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: false }] }, parent_tool_use_id: null },
  ];
};
const write = () => [
  { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_w", name: "Write", input: { file_path: AP + "/ceo-review.md", content: "## Findings\n- x\n" } }] }, parent_tool_use_id: null },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_w", content: "ok", is_error: false }] }, parent_tool_use_id: null },
];
const nd = (...parts: unknown[][]) => parts.flat().map((m) => JSON.stringify(m)).join("\n") + "\n";
const handoff = (command: string, result = LINE) => autoplanCeoExposure(nd(bash(command, result), write()), { copies: [], copy_failed: false }).checks.handoff_ceo_only;
const BT = "\x60";

describe("item 7 (note 22), as the stage 2 amendment's section 3.1 replaces it: only a call whose own result holds the handoff's line passes handoff_ceo_only", () => {
  // Value: protects=the autoplan arm's exposure needs the handoff run with --ceo-only, not a command that prints its line; fails_when=a grep, printf, ||, a filter that can make text, $(), backticks or bash -c passes; why_new=GST-1437 item 7 and the Captain's cut-line rule (2026-11-05); seam=autoplanCeoExposure; no_claim=a real session's call form, which the smoke-first rows --checks rule tests
  test("commands that only print or search for the line, or send the call's output away, fail", () => {
    const fakes = [
      "grep -n 'Auto-selected' ~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff",
      "printf '%s\\n' \"" + LINE + "\" # gstack-ceo-mode-handoff",
      "echo gstack-ceo-mode-handoff; printf '%s\\n' \"" + LINE + "\"",
      CALL + " || printf '%s\\n' \"" + LINE + "\"",
      "bash -c '" + CALL.replaceAll('"', "") + "'",
      CALL + " > " + AP + "/out.txt",
    ];
    for (const c of fakes) expect([c, handoff(c)]).toEqual([c, false]);
  });
  test("compound forms whose output reaches the result pass once the result holds the line (section 3.1)", () => {
    const compound = [CALL + " | sed 's/x/y/'", CALL + " | grep Auto", "x=$(" + CALL + "); echo \"$x\"", BT + CALL + BT, CALL + "; " + CALL, "cat ~/notes.txt; " + CALL, CALL + " &"];
    for (const c of compound) expect([c, handoff(c)]).toEqual([c, true]);
  });
  test("the call itself, with cd, an assignment, a status echo, the allowed redirections or one filter pipe, passes", () => {
    const real = [CALL, CALL + " 2>&1", CALL + " 2>/dev/null", CALL + " >&2", "cd " + AP + " && " + CALL, "AP=" + AP + "; " + CALL, CALL + '; echo "HANDOFF_EXIT: $?"', CALL + " 2>&1 | tee " + AP + "/handoff.log", CALL + " | head -n 5", CALL + " | tail -1", CALL + " | cat"];
    for (const c of real) expect([c, handoff(c)]).toEqual([c, true]);
  });
  test("every call, the bare call included, needs the --ceo-only line in its own result", () => {
    expect(handoff(CALL + '; echo "HANDOFF_EXIT: $?"', "HANDOFF_EXIT: 2")).toBe(false);
    expect(handoff(CALL + " | head -n 5", "")).toBe(false);
    expect(handoff(CALL, "")).toBe(false);
  });
  test("a status echo that could print the line fails", () => {
    expect(handoff(CALL + '; echo "' + LINE + ' $?"')).toBe(false);
  });
  test("the detector says when a session named the handoff, so rows can count false unexposed sessions", () => {
    expect(handoffNamed(nd(bash("grep x ~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff", LINE), write()))).toBe(true);
    expect(handoffNamed(nd(bash(CALL, LINE), write()))).toBe(true);
    expect(handoffNamed(nd(write()))).toBe(false);
  });
});

describe("item 7 (the Captain's include, 2026-11-05): printf -v writes no Findings", () => {
  // Value: protects=findings_written needs text written to ceo-review.md; fails_when=printf -v, which sets a variable, passes; why_new=#225's Attention block and the Captain's include; seam=autoplanCeoExposure; no_claim=none beyond protects
  test("printf -v into ceo-review.md fails, plain printf passes", () => {
    const at = (c: string) => findingsWrittenTranscript(nd(bash(CALL, LINE), bash(c, "")));
    expect(at("printf -v x '\\n## Findings\\nNone.\\n' > " + AP + "/ceo-review.md")).toBe(false);
    expect(at("printf '## Findings\\nNone.\\n' > " + AP + "/ceo-review.md")).toBe(true);
  });
});

describe("review round 2 (#229 Step 11): the handoff and printf checks read shell words", () => {
  // Value: protects=handoff_ceo_only and findings_written read the arguments the shell passes, so a comment or quoted text can't stand in for --ceo-only, hide --auto, or hide printf -v; fails_when=a comment, quoted --decisions text, a quoted "--auto", a comment-only call, printf "-v" or printf -vx reads exposed, or a real call with --auto in its quoted text or a quoted "--ceo-only" reads unexposed; why_new=#229 Step 11 outside voice and adversarial reader; seam=autoplanCeoExposure; no_claim=the rest of the handoff call form
  const EXE = "~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff";
  test("comments, quoted text and a quoted --auto never read as the handoff run with --ceo-only", () => {
    const fakes = [
      EXE + ' "HOLD SCOPE" # --ceo-only',
      EXE + ' HOLD_SCOPE --decisions "note --ceo-only ignored"',
      CALL + ' "--auto"',
      "#/gstack-ceo-mode-handoff HOLD_SCOPE --ceo-only",
    ];
    for (const c of fakes) expect([c, handoff(c, "ok")]).toEqual([c, false]);
  });
  test("the documented call forms still read exposed, with --auto inside quoted text or a quoted --ceo-only", () => {
    const real = [
      CALL,
      CALL + '; echo "HANDOFF_EXIT: $?"',
      CALL + " 2>&1",
      CALL + " 2>&1 | tee " + AP + "/handoff.txt",
      EXE + ' "HOLD SCOPE" --ceo-only --decisions "D2: drop the --auto flag idea"',
      EXE + ' "HOLD SCOPE" "--ceo-only" --decisions "none"',
    ];
    for (const c of real) expect([c, handoff(c)]).toEqual([c, true]);
  });
  test("printf with a quoted or attached -v writes no Findings", () => {
    const at = (c: string) => findingsWrittenTranscript(nd(bash(CALL, LINE), bash(c, "")));
    expect(at("printf \"-v\" x '\\n## Findings\\nNone.\\n' > " + AP + "/ceo-review.md")).toBe(false);
    expect(at("printf -vx '\\n## Findings\\nNone.\\n' > " + AP + "/ceo-review.md")).toBe(false);
    expect(at("printf '## Findings\\nNone.\\n' > " + AP + "/ceo-review.md")).toBe(true);
  });
});

describe("backslash escapes (#229's Capy Low): a first line with a backslash outside single quotes writes no Findings", () => {
  // Value: protects=findings_written reads a Bash write only when words() parses its first line as bash does; fails_when=printf \-v, an escaped redirect or an escaped command name reads written (fail open), or a plain printf, heredoc, echo or tee write reads unwritten; why_new=#229's Capy Low on words() and backslash escapes; seam=autoplanCeoExposure; no_claim=bash escape parsing, which the check refuses rather than models
  const F = AP + "/ceo-review.md";
  const at = (c: string) => findingsWrittenTranscript(nd(bash(CALL, LINE), bash(c, "")));
  test("case 1: printf \\-v, an escaped -v, an escaped printf name or an escaped redirect writes no Findings", () => {
    const fakes = [
      "printf \\-v x '\\n## Findings\\nNone.\\n' > " + F,
      "printf -\\v x '\\n## Findings\\nNone.\\n' > " + F,
      "pr\\intf -v x '\\n## Findings\\nNone.\\n' > " + F,
      "echo '## Findings' \\> " + F,
      'echo "## Findings: it\'s" \\> ' + F + " 'x'",
    ];
    for (const c of fakes) expect([c, at(c)]).toEqual([c, false]);
  });
  test("case 2: an escaped double quote in a double-quoted first line, and any other backslash outside single quotes, reads unwritten", () => {
    const closed = ['printf "## Findings\\n5\\" wide\\n" > ' + F, 'printf "## Findings\\nNone.\\n" > ' + F, 'echo -e "\\n## Findings" >> ' + F];
    for (const c of closed) expect([c, at(c)]).toEqual([c, false]);
  });
  test("plain printf, heredoc, echo and tee writes of the Findings section still read written", () => {
    const real = [
      "printf '## Findings\\nNone.\\n' > " + F,
      "printf '\\n## Findings\\n- High: no bound.\\n' >> " + F,
      'cat > "' + F + "\" <<'EOF'\n# CEO-only review\n## Findings\n- High: no bound under C:\\tmp.\nEOF",
      "echo '## Findings' >> " + F,
      'echo "## Findings: it\'s fine" > ' + F,
      "printf '## Findings\\nNone.\\n' | tee " + F,
    ];
    for (const c of real) expect([c, at(c)]).toEqual([c, true]);
  });
  test("the handoff path reads shell words: the documented calls pass, and so do escapes bash removes", () => {
    for (const c of [CALL, CALL + " 2>&1 | tee " + AP + "/handoff.txt", CALL.replace("--ceo-only", "--ceo\\-only"), CALL.replace('"none"', '"a \\"b\\""')]) expect([c, handoff(c)]).toEqual([c, true]);
  });
});

describe("escape expansion (#230 ruling): only printf's format and echo -e expand \\n, as bash does", () => {
  // Value: protects=findings_written reads the text bash writes, so a literal \\n never makes a Findings line; fails_when=plain echo, a printf argument or a doubled backslash expands \\n into a Findings line, text after echo -e's \\c or a heredoc body that only cat reads counts (fail open), or echo -e, a single-quoted printf format or a cat heredoc stops reading written; why_new=the Captain's ruling on #230 (2026-11-05); seam=autoplanCeoExposure; no_claim=printf's other escapes and %b, which the check does not model
  const F = AP + "/ceo-review.md";
  const at = (c: string) => findingsWrittenTranscript(nd(bash(CALL, LINE), bash(c, "")));
  test("plain echo, echo -e then -E, a printf argument and a doubled backslash write a literal \\n, not a Findings line", () => {
    const fakes = [
      "echo 'x\\n## Findings' > " + F,
      "echo -n 'x\\n## Findings' > " + F,
      "echo -e -E 'x\\n## Findings' > " + F,
      "printf '%s\\n' 'x\\n## Findings' > " + F,
      "printf '\\\\n## Findings' > " + F,
      "echo -e 'x\\\\n## Findings' > " + F,
      "echo -e 'x\\c\\n## Findings' > " + F,
    ];
    for (const c of fakes) expect([c, at(c)]).toEqual([c, false]);
  });
  test("echo -e and a single-quoted printf format still expand \\n into a Findings line", () => {
    const real = [
      "echo -e 'x\\n## Findings' > " + F,
      "echo -ne 'x\\n## Findings' > " + F,
      "echo -n -e 'x\\n## Findings' >> " + F,
      "printf 'x\\n## Findings\\n' > " + F,
      "printf -- '## Findings\\nNone.\\n' > " + F,
      "printf '## Findings\\n%s\\n' 'None.' > " + F,
      "printf 'x\\\\\\n## Findings\\n' > " + F,
      "echo -e 'x\\\\\\n## Findings' > " + F,
    ];
    for (const c of real) expect([c, at(c)]).toEqual([c, true]);
  });
  test("a heredoc body counts for a bare cat and for tee, wherever the redirects sit; other commands read unwritten", () => {
    const doc = " <<'EOF'\n## Findings\n- High: no bound.\nEOF";
    const unwritten = ["echo 'x' > " + F + doc, "printf 'x' > " + F + doc, "true > " + F + doc, "sed 's/^## /# /' > " + F + doc, "sed '' > " + F + doc, "cat -n > " + F + doc, "cat notes.md > " + F + doc];
    const written = ["cat > " + F + doc, "cat >> " + F + doc, "cat - > " + F + doc, "cat" + doc.replace("\n", " > " + F + "\n"), "cat" + doc.replace("\n", " | tee " + F + "\n"), "> " + F + " cat" + doc, ">" + F + " cat" + doc, "tee " + F + doc, "tee -a " + F + doc];
    written.push(...[" 2>&1", " >/dev/null", " 2>/dev/null", " | cat"].map((tail) => "tee " + F + doc.replace("\n", tail + "\n")));
    written.push("printf '## Findings\\n' | tee " + F + " >/dev/null", "printf '## Findings\\n' | tee -a " + F + " 2>&1");
    written.push("tee " + F + doc.replace("\n", " | tee /dev/null\n"));
    unwritten.push("tee notes.md" + doc, "printf '## Findings\\n' | tee notes.md >/dev/null");
    unwritten.push("printf '## Findings\\n' | tee " + F + " <<'EOF'\n- Low: x\nEOF", "printf '## Findings\\n' | tee " + F + " < notes.md");
    for (const c of unwritten) expect([c, at(c)]).toEqual([c, false]);
    for (const c of written) expect([c, at(c)]).toEqual([c, true]);
  });
});

describe("the fail-closed rule set (#230 pass 1): a write reads written only when bash puts that text in the file", () => {
  // Value: protects=findings_written reads true only when bash writes the Findings text into ceo-review.md; fails_when=a tee option other than -a, a later input redirect, a second stdout target, a head redirected away from a piped tee, or an unquoted heredoc that bash expands reads written; why_new=/ship pass 1 on #230 and the Captain's option B (2026-11-05); seam=autoplanCeoExposure; no_claim=simpleCommand's comment and quoted << forms, a named note
  const F = AP + "/ceo-review.md";
  const at = (c: string) => findingsWrittenTranscript(nd(bash(CALL, LINE), bash(c, "")));
  test("each override reads unwritten, and the plain forms beside it still read written", () => {
    const body = "\n## Findings\n- High: no bound.\nEOF";
    const unwritten = [
      "tee --help " + F + " <<'EOF'" + body,
      "tee -p " + F + " <<'EOF'" + body,
      "tee " + F + " <<'EOF' < notes.md" + body,
      "cat <<'EOF' < notes.md > " + F + body,
      "> " + F + " echo '## Findings' > /dev/null",
      "printf '## Findings\\n' > " + F + " >> other.md",
      "printf '## Findings\\n' >/dev/null | tee " + F,
      "cat <<'EOF' >/dev/null | tee " + F + body,
      "tee " + F + " <<EOF\nx\\\n## Findings\nEOF",
      "cat > " + F + " <<EOF\nx \x60\n## Findings\n\x60\nEOF",
      "cat > " + F + " <<EOF\nx $(\n## Findings\n)\nEOF",
    ];
    const written = [
      "tee -a " + F + " <<EOF" + body,
      "cat > " + F + " <<EOF" + body,
      "printf '## Findings\\n' 2>/dev/null | tee " + F,
      "cat > " + F + " 2>/dev/null <<'EOF'" + body,
      "cat > " + F + " <<'EOF'\n$(x) \x60y\x60 \\\n## Findings\nEOF",
    ];
    for (const c of unwritten) expect([c, at(c)]).toEqual([c, false]);
    for (const c of written) expect([c, at(c)]).toEqual([c, true]);
  });
});

describe("rows diagnostics count the sessions that named the handoff and read unexposed", () => {
  // Value: protects=a false unexposed under the strict handoff rule shows up per cell; fails_when=such sessions read unexposed silently; why_new=the Captain's cut-line rule (2026-11-05); seam=ceo rows; no_claim=none beyond protects
  test("one autoplan-ceo smoke session that grepped the handoff counts once", async () => {
    const d = fresh("named");
    const run = stage1(d);
    const t = join(run, "runs", MODEL.opus!.replaceAll("/", "_"), "gstack-auto", "u-11", "p1", "host", "transcript.ndjson");
    writeFileSync(t, nd(bash("grep -c x ~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff", LINE), write()));
    const r = await rows1(d, run);
    expect(r.code).toBe(0);
    expect(r.out).toContain("handoff: smoke autoplan-ceo:opus: 1 session named gstack-ceo-mode-handoff and read unexposed on handoff_ceo_only");
    expect(r.out).toContain("handoff: smoke autoplan-ceo:sol: 0 sessions named gstack-ceo-mode-handoff and read unexposed on handoff_ceo_only");
  });
});

describe("item 5 (note 20): checkSuite runs the prereg freeze loop for a ceo-outcome suite", () => {
  // Value: protects=noloss suite --check --prereg refuses a ceo suite whose prereg changed; fails_when=the ceo branch returns before the freeze loop; why_new=#225 note 20; seam=checkSuite; no_claim=none beyond protects
  test("a changed prereg is a problem, the frozen one is not", () => {
    const d = fresh("freeze");
    const frozen = Buffer.from("# Prereg\nfrozen text\n");
    const suite = { kind: "ceo-outcome", catalogs: ["units"], units: [U1, U2, U3].map((id) => ({ id, blockers: [] })), prereg_freezes: [{ round: "r1", bytes: frozen.length, sha256: sha256(frozen) }] } as unknown as Suite;
    expect(checkSuite(suite, { repoRoot: d, prereg: frozen })).toEqual([]);
    expect(checkSuite(suite, { repoRoot: d, prereg: Buffer.from("# Prereg\nfrozen TEXT\n") })).toEqual([expect.stringContaining("prereg freeze r1")]);
  });
});

// A ceo-outcome run on a stub driver: each session writes its transcript and ends as the case says.
const OPUS = "claude-opus-5-5";
const durable = () => {
  const d = mkdtempSync(join(homedir(), ".gstack-evals-ceo-followup-test-"));
  roots.push(d);
  return d;
};
function unitFixture(): PreparedUnit {
  const s = mkdtempSync(join(tmpdir(), "ceo-followup-unit-"));
  roots.push(s);
  const panel = planPanel(join(s, "panel"), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(s, "unit", "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(s, "tree", "tree"), image: "unused", test: null, install: null, scratch: join(s, "build"), run: () => { throw new Error("a plan unit runs no container"); } });
  return { unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null };
}
const unitsSeen: boolean[] = [];
const BLOCK = FENCE + "ceo-outcome\n" + JSON.stringify({ top: [{ issue: "No opt-out for existing users.", evidence: "plan.md", fix: "Add a flag." }], forecast: 30 }) + "\n" + FENCE;
async function ceoRun(out: string, unit: PreparedUnit, capPass: number | null, calls: number[], env: Record<string, string> = {}, reuse = new Map(), suite: ReviewRunInput["suite"] = { id: "ceo-followup", sha256: null }, step: (pass: number) => string | null = () => null) {
  const h = harness(() => [{ type: "text", text: "unused" }]);
  const passOf = new Map<string, number>();
  const rig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request: any) => {
      const b = h.proxy.bind(request);
      passOf.set(b.slot, request.cell.trial);
      return b;
    },
    finalize: async (m: string) => ({ ...(await h.proxy.finalize(m)), micros: 1_750_000 }),
    arms: { none: { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] } },
    sandbox: () => localSandbox(() => {}),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
    driver: (o: any) => ({
      env: {},
      run: async (session: AgentSession): Promise<AgentOutcome> => {
        const pass = passOf.get(o.proxy.slot)!;
        calls.push(pass);
        const command = step(pass);
        if (command) expect(session.exec(command, 10_000).exitCode).toBe(0);
        unitsSeen.push(existsSync(join(out, "units.json")));
        mkdirSync(o.out, { recursive: true });
        writeFileSync(join(o.out, "transcript.ndjson"), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Review.\n\n" + BLOCK }] }, parent_tool_use_id: null }) + "\n");
        return { turns: ["Review.\n\n" + BLOCK], termination: pass === capPass ? { kind: "cap_stop" } : { kind: "completed" }, model_output: true, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null };
      },
    }),
  } as unknown as HostRig;
  const input: ReviewRunInput = { host: "claude", suite, units: [unit], arms: [{ name: "none", told: "none" }], models: [OPUS], passes: 3, parallel: 1, timeoutS: 30, cap: 50_000_000, runId: "ceo-followup", out, date: "2026-11-05", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo-outcome" }, reuse, env };
  try {
    return await runReviewUnits(input, rig);
  } finally {
    h.proxy.stop();
    removeTree(h.dir);
  }
}

describe("item 2 (note 17): --resume never reruns a cell a cap stop ended", () => {
  // Value: protects=a cap stop is never retried: the resume carries the stopped cell with its settled spend into stops.json and runs only never-started cells; fails_when=the resume reruns the stopped cell, or rewrites stops.json without it and drops its spend from rows; why_new=GST-1437 item 2, #225 note 17; seam=runReviewUnits on a prior ceo-outcome out dir; no_claim=the CLI's flag parsing
  test("the stopped cell stays stopped with its usd; unstarted cells run", async () => {
    const out = durable();
    const unit = unitFixture();
    const first: number[] = [];
    const a = await ceoRun(out, unit, 1, first);
    expect(first).toEqual([1]);
    expect(a.stops.map((s) => s.code)).toEqual(["CAP_STOP"]);
    const before = json(join(out, "stops.json")).stops[0].cells.map((c: any) => [c.pass, c.how, c.usd ?? null]);
    expect(before).toEqual([[1, "stopped", 1.75], [2, "unstarted", null], [3, "unstarted", null]]);
    const second: number[] = [];
    const b = await ceoRun(out, unit, null, second, {}, readReviewJournal(out));
    expect(second.sort()).toEqual([2, 3]);
    expect(b.stops.map((s) => s.code)).toEqual(["CAP_STOP"]);
    const after = json(join(out, "stops.json")).stops;
    expect(after).toHaveLength(1);
    expect(after[0].cells.map((c: any) => [c.pass, c.how, c.usd, c.wall_s])).toEqual([[1, "stopped", 1.75, null]]);
    expect(readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l).cell.pass).sort()).toEqual([2, 3]);
    const third: number[] = [];
    await ceoRun(out, unit, null, third, {}, readReviewJournal(out));
    expect(third).toEqual([]);
    expect(json(join(out, "stops.json")).stops[0].cells).toHaveLength(1);
  }, 60_000);
  test("a stops.json that doesn't parse refuses the resume before any session", async () => {
    const out = durable();
    const unit = unitFixture();
    await ceoRun(out, unit, 1, []);
    writeFileSync(join(out, "stops.json"), "{");
    const calls: number[] = [];
    await expect(ceoRun(out, unit, null, calls, {}, readReviewJournal(out))).rejects.toThrow("stops.json");
    expect(calls).toEqual([]);
  }, 60_000);
});

describe("review finding 01M6P4PKCJ1CYR3TQ02HVJMWE8: --resume keeps the suite binding the run started with", () => {
  // Value: protects=cached cells stay labelled with the units dir they ran on, because session keys don't cover key.json; fails_when=a resume after a key.json-only edit reuses every cell and rewrites units.json with the new catalogs_sha256, so rows, packets and readings accept old results against the new key; why_new=Capy review of #229; seam=runReviewUnits on a prior ceo-outcome out dir; no_claim=the CLI's recompute of the binding
  const bound = (unitId: string) => ({ id: "ceo-followup", sha256: null, catalogs_sha256: "a".repeat(64), units_dir: "units", unit_ids: [unitId] });
  test("a resume whose units dir hashes to another catalogs_sha256 is refused before any session", async () => {
    const out = durable();
    const unit = unitFixture();
    await ceoRun(out, unit, 1, [], {}, new Map(), bound(unit.unit.id));
    expect(json(join(out, "units.json")).suite.catalogs_sha256).toBe("a".repeat(64));
    const calls: number[] = [];
    await expect(ceoRun(out, unit, null, calls, {}, readReviewJournal(out), { ...bound(unit.unit.id), catalogs_sha256: "b".repeat(64) })).rejects.toThrow(/units\.json[\s\S]*catalogs_sha256/);
    expect(calls).toEqual([]);
    expect(json(join(out, "units.json")).suite.catalogs_sha256).toBe("a".repeat(64));
  }, 60_000);
  test("a run that recorded no binding refuses a resume that carries one", async () => {
    const out = durable();
    const unit = unitFixture();
    await ceoRun(out, unit, 1, []);
    const calls: number[] = [];
    await expect(ceoRun(out, unit, null, calls, {}, readReviewJournal(out), bound(unit.unit.id))).rejects.toThrow(/units\.json[\s\S]*catalogs_sha256/);
    expect(calls).toEqual([]);
  }, 60_000);
  test("a resume whose out dir holds cells but no units.json is refused before any session", async () => {
    // Value: protects=the binding check can't be skipped by deleting units.json; fails_when=a resume with cells.ndjson and no units.json reuses the cells and writes a fresh units.json with the new binding; why_new=Capy re-review of #229 (01M6P5DGW1MQ9H01BWV1HS9HGG); seam=runReviewUnits on a prior ceo-outcome out dir; no_claim=a units.json restored from elsewhere
    const out = durable();
    const unit = unitFixture();
    await ceoRun(out, unit, 3, [], {}, new Map(), bound(unit.unit.id));
    expect(readFileSync(join(out, "cells.ndjson"), "utf8").trim()).not.toBe("");
    rmSync(join(out, "units.json"));
    const calls: number[] = [];
    await expect(ceoRun(out, unit, null, calls, {}, readReviewJournal(out), { ...bound(unit.unit.id), catalogs_sha256: "b".repeat(64) })).rejects.toThrow(/units\.json/);
    expect(calls).toEqual([]);
    expect(existsSync(join(out, "units.json"))).toBe(false);
  }, 60_000);
  test("units.json holds the binding before the first session, so a run lost mid-way can still resume", async () => {
    const out = durable();
    const unit = unitFixture();
    unitsSeen.length = 0;
    await ceoRun(out, unit, null, [], {}, new Map(), bound(unit.unit.id));
    expect(unitsSeen).toEqual([true, true, true]);
  }, 60_000);
  test("a resume with the same binding runs the unstarted cells", async () => {
    const out = durable();
    const unit = unitFixture();
    await ceoRun(out, unit, 1, [], {}, new Map(), bound(unit.unit.id));
    const calls: number[] = [];
    await ceoRun(out, unit, null, calls, {}, readReviewJournal(out), bound(unit.unit.id));
    expect(calls.sort()).toEqual([2, 3]);
  }, 60_000);
});

describe("B2 ruling on #230: each session's ceo-review.md is copied into host/ before cleanup", () => {
  // Value: protects=the smoke check compares findings_written with the ceo-review.md each session left on disk; fails_when=the copy is missing, differs by a byte, appears for a session that wrote none, or follows a symlink out of the work dir; why_new=the Captain's B2 ruling on #230 (2026-11-05); seam=runReviewUnits on a stub driver; no_claim=files written outside the work dir, which no copy reaches
  test("a session that wrote the file leaves a byte-identical copy; one that wrote none, or only a symlink, leaves none", async () => {
    const out = durable();
    const unit = unitFixture();
    const review = "# CEO-only review\n## Findings\n- High: no bound.\t\n";
    const steps: Record<number, string> = {
      1: 'd="$GSTACK_STATE_ROOT/projects/demo/autoplan-run-1" && mkdir -p "$d" && printf \'# CEO-only review\\n## Findings\\n- High: no bound.\\t\\n\' > "$d/ceo-review.md" && printf x > ceo-review.md',
      3: "ln -s /etc/hostname ceo-review.md",
    };
    await ceoRun(out, unit, null, [], {}, new Map(), undefined, (p) => steps[p] ?? null);
    const dir = (p: number) => join(out, "runs", OPUS, "none", unit.task, "p" + p);
    expect(readFileSync(join(dir(1), "host", "ceo-review", ".gstack-home", "projects", "demo", "autoplan-run-1", "ceo-review.md"))).toEqual(Buffer.from(review));
    expect(readFileSync(join(dir(1), "host", "ceo-review", "ceo-review.md"), "utf8")).toBe("x");
    for (const p of [2, 3]) expect([p, existsSync(join(dir(p), "host", "ceo-review"))]).toEqual([p, false]);
    for (const p of [1, 2, 3]) expect([p, existsSync(join(dir(p), "work", unit.task))]).toEqual([p, false]);
  }, 60_000);
});

describe("pass 1 on #230: the copy walks past an unreadable entry, and the receipts sink holds it", () => {
  // Value: protects=the on-disk copy backs up whatever the parser misses; fails_when=one unreadable directory drops the copies after it, or an ephemeral runner's sink lacks host/ceo-review; why_new=/ship pass 1 on #230 and the Captain's option B (2026-11-05); seam=runReviewUnits on a stub driver; no_claim=a file the agent made unreadable itself, which no copy reaches
  test.skipIf(process.getuid?.() === 0)("every readable ceo-review.md is copied and each failure is returned", () => {
    const root = mkdtempSync(join(tmpdir(), "copy-named-"));
    const to = join(root, "out");
    for (let i = 0; i < 8; i++) {
      mkdirSync(join(root, "w", "a" + i), { recursive: true });
      mkdirSync(join(root, "w", "g" + i), { recursive: true });
      writeFileSync(join(root, "w", "g" + i, "ceo-review.md"), "x");
      chmodSync(join(root, "w", "a" + i), 0);
    }
    const failures = copyNamed(join(root, "w"), "ceo-review.md", to);
    for (let i = 0; i < 8; i++) expect([i, readFileSync(join(to, "g" + i, "ceo-review.md"), "utf8")]).toEqual([i, "x"]);
    expect([failures.length, failures.every((f) => f.includes("EACCES"))]).toEqual([8, true]);
    for (let i = 0; i < 8; i++) chmodSync(join(root, "w", "a" + i), 0o755);
    rmSync(root, { recursive: true, force: true });
  });
  test("an ephemeral run's receipts sink holds each session's host/ceo-review copy", async () => {
    const out = durable();
    const sink = durable();
    const unit = unitFixture();
    await ceoRun(out, unit, null, [], { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: sink }, new Map(), undefined, (p) => (p === 1 ? "printf x > ceo-review.md" : null));
    expect(readFileSync(join(sink, "runs", OPUS, "none", unit.task, "p1", "host", "ceo-review", "ceo-review.md"), "utf8")).toBe("x");
  }, 60_000);
});

describe("item 4 (note 19): the receipts sink holds every session's transcript", () => {
  // Value: protects=a run whose runner is lost keeps the transcripts rows needs; fails_when=runs/**/host/transcript.ndjson stay out of the sink; why_new=GST-1437 item 4, #225 note 19; seam=runReviewUnits with GSTACK_EVALS_EPHEMERAL=1; no_claim=the sink's own durability
  test("each session's host/transcript.ndjson is copied under the sink", async () => {
    const out = durable();
    const sink = durable();
    const unit = unitFixture();
    const run = await ceoRun(out, unit, null, [], { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: sink });
    for (const p of [1, 2, 3]) {
      const rel = join("runs", OPUS, "none", unit.task, "p" + p, "host", "transcript.ndjson");
      expect(readFileSync(join(sink, rel), "utf8")).toBe(readFileSync(join(out, rel), "utf8"));
      expect(run.copied).toContain(join(sink, rel));
    }
    expect(existsSync(join(sink, "runs", OPUS, "none", unit.task, "p1", "home"))).toBe(false);
  }, 60_000);
});
