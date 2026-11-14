// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's real-SDK checks, keyless: the pinned Claude Code CLI the Agent SDK bundles, behind the real metering
// proxy with a scripted fake upstream (tests/adapters/harness.ts). The hostile fixture is tested both ways with its two
// strip-off controls; the gate hook answers a run the pinned gstack-autoplan drove to gate_pending at its second gate
// revision, and the session reaches APPROVED and export and ends with a block, with D1 off; the D1 hook blocks twice
// and releases. Sessions run locally in the repository root as the working folder, where the CLI loads the most (BT).
// The gstack arms get a stand-in for the install: the pinned plan-design-review and autoplan skill folders copied into
// HOME/.claude/skills. Tests that need the pinned gstack checkout skip without DC_GSTACK_PIN_DIR.
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeCodeDriver } from "../../../src/adapters/claude-code/driver.ts";
import { GATE_MESSAGE } from "../../../lanes/design-constructed/frozen.ts";
import { armPrompt, isGstackArm } from "../../../lanes/design-constructed/run/arms.ts";
import { localRunBox, runFilesOf } from "../../../lanes/design-constructed/run/box.ts";
import { autoplanExposure, pdrExposure } from "../../../lanes/design-constructed/run/detect.ts";
import { exportUnit } from "../../../lanes/design-constructed/run/export.ts";
import { CONTROL_AGENTS, CONTROL_ALL, fixtureFilesLoaded, HOSTILE_OPENS, MARK, markersSeen, writeHostile } from "../../../lanes/design-constructed/run/hostile.ts";
import { D1_MESSAGE, gateHook, repairHook, stopHandler } from "../../../lanes/design-constructed/run/hooks.ts";
import { replyOf } from "../../../lanes/design-constructed/run/transcript.ts";
import type { SessionKind } from "../../../lanes/design-constructed/types.ts";
import { HAS_CLAUDE_CLI, harness, type Harness, type Script } from "../../adapters/harness.ts";
import { BLOCK, commitAll, EVIDENCE, parseStub, pinnedGstack } from "./helpers.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});
const MODEL = "claude-opus-5-5";
const PIN = pinnedGstack();
const SKILL_MARKS = { "plan-design-review": "Designer's eye plan review", autoplan: "Auto-review pipeline" } as const;

async function session(o: { kind: SessionKind; work: string; script: Script; home?: (home: string) => void; path?: string; stopHook?: (t: string) => string | null; prompt?: string }) {
  const h = harness(o.script);
  open.push(h);
  const binding = h.bind(MODEL, "anthropic");
  const home = join(h.dir, "home");
  mkdirSync(home, { recursive: true });
  o.home?.(home);
  const out = join(h.dir, "host");
  const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, skill: null, out, query: query as never, disable1mContext: true, memoryLog: true, ...(isGstackArm(o.kind) ? { sessionKind: "unattended" as const } : {}), ...(o.stopHook ? { stopHook: o.stopHook } : {}) });
  const env = { ...driver.env!, ...(o.path ? { PATH: o.path + ":" + (process.env.PATH ?? "") } : {}) };
  const s = h.session(o.work, home, env);
  const outcome = await driver.run(s, { id: "t", prompt: o.prompt ?? armPrompt(o.kind) }, 150_000);
  const read = (f: string) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8") : null);
  return { h, home, outcome, memory: read("memory.ndjson"), transcript: read("transcript.ndjson") ?? "", bodies: h.upstream.map((u) => JSON.stringify(u.body)) };
}

/** The hostile arms' script: one turn opens a file in each fixture subfolder and runs the sentinel, the next ends with a block. */
const hostileScript: Script = ({ results }) => {
  if (!results.size) return [...HOSTILE_OPENS.map((p, i) => ({ type: "tool_use" as const, id: "toolu_open" + i, name: "Read", input: { file_path: p } })), { type: "tool_use" as const, id: "toolu_sentinel", name: "Bash", input: { command: "sh scripts/sentinel.sh" } }];
  return [{ type: "text", text: "Reviewed.\n\n" + BLOCK }];
};

/** Shell steps the stub model runs: write the reviewer's result for the open attempt and submit it; or apply the pending change. */
const HELPER = [
  "set -e",
  "OUT=$2",
  "if [ \"$1\" = submit ]; then",
  "  A=$(grep -o '\"attempt\":\"[^\"]*\",\"phase\":\"eng\",\"voice\":\"native\"' \"$OUT/attempts.jsonl\" | tail -1 | sed 's/\"attempt\":\"\\([^\"]*\\)\".*/\\1/')",
  "  R=$(grep -o '\"result\":\"[^\"]*\"' \"$OUT/attempts.jsonl\" | tail -1 | sed 's/\"result\":\"\\([^\"]*\\)\"/\\1/')",
  "  H=$(grep -o 'INPUT: eng [0-9a-f]*' \"$OUT/eng-native-prompt.md\" | tail -1)",
  "  printf '%s\\nDRAFT: none\\n\\nThe settings form has no empty state.\\n\\n```gstack-findings\\n{\"id\":\"F1\",\"severity\":\"High\",\"title\":\"No empty state\",\"fix\":\"Add an empty state\"}\\n```\\n' \"$H\" > \"$OUT/$R\"",
  "  gstack-autoplan submit --out \"$OUT\" --phase eng --voice native --result \"$OUT/$R\" --model claude-opus-5-5 --attempt \"$A\"",
  "else",
  "  D=$(bun -e 'const s = JSON.parse(require(\"fs\").readFileSync(process.argv[1], \"utf8\")); console.log(s.amendments.find((a) => a.status === \"pending\").decision)' \"$OUT/run.json\")",
  "  printf '\\nThe form shows an empty state.\\n' >> plan.md",
  "  gstack-autoplan revise --out \"$OUT\" --plan plan.md --incorporates \"$D\"",
  "fi",
  ""
].join("\n");

function hostileFixture() {
  const root = mkdtempSync(join(tmpdir(), "dc-hostile-"));
  const repo = join(root, "src");
  mkdirSync(repo);
  const sentinel = join(root, "hooks-fired.log");
  writeHostile(repo, sentinel);
  const pin = commitAll(repo);
  return { root, repo, pin, sentinel };
}

describe.skipIf(!HAS_CLAUDE_CLI)("the hostile fixture on the pinned Claude Code (keyless)", () => {
  // Value: protects=2026-11-09-geva-420 start rule 5's boundary both ways: after the export's strip no instruction file reaches any arm, gstack's skills reach only the gstack arms, and the two strip-off controls show the capture would have caught every planted file; fails_when=a stripped arm's request or loaded memory holds a marker, a hook fires, a none or lens request lists a gstack skill, or a control misses a file it planted; why_new=the design plan review lane's export (C1) replaces D's git add -A; seam=exportUnit, claudeCodeDriver memoryLog, the real CLI; no_claim=the Docker container, its proxy-only network and its drive mask (the sentinel's DRIVE and NET lines are read there)
  test("stripped arms see no marker, the gstack arms alone list gstack's skills, and both controls catch their files", async () => {
    const fx = hostileFixture();
    const work = join(fx.root, "export");
    exportUnit({ clone: fx.repo, pin: fx.pin, evidence: EVIDENCE, out: work });
    const install = (home: string) => {
      if ("skip" in PIN) return;
      for (const s of ["plan-design-review", "autoplan"]) cpSync(join(PIN.dir, s), join(home, ".claude", "skills", s), { recursive: true });
    };
    const kinds: SessionKind[] = "skip" in PIN ? ["none", "lens"] : ["none", "lens", "plan-design-review", "autoplan"];
    for (const kind of kinds) {
      const r = await session({ kind, work, script: hostileScript, home: isGstackArm(kind) ? install : undefined });
      expect(r.outcome.termination).toEqual({ kind: "completed" });
      const seen = markersSeen(r.bodies, r.memory, existsSync(fx.sentinel) ? readFileSync(fx.sentinel, "utf8") : null);
      expect([kind, [...seen]]).toEqual([kind, []]);
      expect([kind, fixtureFilesLoaded(r.memory, work)]).toEqual([kind, []]);
      for (const [skill, mark] of Object.entries(SKILL_MARKS)) expect([kind, skill, r.bodies.some((b) => b.includes(mark))]).toEqual([kind, skill, isGstackArm(kind)]);
      const last = r.bodies.at(-1) ?? "";
      expect(last).toContain("SENTINEL-DONE");
      expect(last).not.toMatch(/KEY [A-Z_]+/);
    }
    const all = join(fx.root, "control-all");
    cpSync(fx.repo, all, { recursive: true, verbatimSymlinks: true });
    const c1 = await session({ kind: "none", work: all, script: hostileScript });
    const s1 = markersSeen(c1.bodies, c1.memory, existsSync(fx.sentinel) ? readFileSync(fx.sentinel, "utf8") : null);
    expect(CONTROL_ALL.filter((m) => !s1.has(m))).toEqual([]);
    expect(s1.has(MARK.hook)).toBe(true);
    expect(c1.bodies.some((b) => b.includes(MARK.skill))).toBe(true);
    const agents = join(fx.root, "control-agents");
    cpSync(work, agents, { recursive: true, verbatimSymlinks: true });
    for (const p of ["AGENTS.md", "lib/AGENTS.md"]) writeFileSync(join(agents, p), readFileSync(join(fx.repo, p)));
    const c2 = await session({ kind: "none", work: agents, script: hostileScript });
    const s2 = markersSeen(c2.bodies, c2.memory, null);
    expect(CONTROL_AGENTS.filter((m) => !s2.has(m))).toEqual([]);
  }, 600_000);
});

/** The autoplan arm's scripted session: drive the pinned run to a second gate revision, stop, take the gate's changes, export, end with a block. */
function autoplanScript(out: string, helper: string): Script {
  return ({ results, body }) => {
    const sent = JSON.stringify(body.messages ?? []);
    const bash = (id: string, command: string) => [{ type: "tool_use" as const, id, name: "Bash", input: { command } }];
    const n = results.size;
    if (n === 0) return bash("toolu_next", "gstack-autoplan next --out " + out + " --plan plan.md --kind feature --scaffold");
    if (n === 1) return bash("toolu_submit", "sh " + helper + " submit " + out);
    if (n === 2) return bash("toolu_revise", "printf '\\nAlso a loading state.\\n' >> plan.md && gstack-autoplan revise --out " + out + " --plan plan.md");
    if (n === 3 && !sent.includes(GATE_MESSAGE)) return [{ type: "text", text: "The review is at its gate." }];
    if (n === 3) return bash("toolu_apply", "sh " + helper + " incorporate " + out);
    if (n === 4) return bash("toolu_export", "gstack-autoplan export --out " + out);
    return [{ type: "text", text: "Done.\n\n" + BLOCK }];
  };
}

describe.skipIf(!HAS_CLAUDE_CLI || "skip" in PIN)("the gate hook and the D1 hook through the real driver (keyless)" + ("skip" in PIN ? " (skipped: " + PIN.skip + ")" : ""), () => {
  // Value: protects=R2-6 and R2-14: the gate hook answers the pin's gate at its second revision with the pin's own rec hash, returns the fixed message once, and the session takes the gate's change, reaches APPROVED and export, and ends with a parsable block, with D1 off; the detector then reads the run exposed; fails_when=the hook answers nothing, answers without the flags the pin needs, misses the second revision, blocks twice, or the session cannot finish; why_new=no source answers an autoplan gate; seam=gateHook, stopHandler, localRunBox, autoplanExposure, the real SDK Stop hook; no_claim=a real model's choices at the gate
  test("revision 2 takes changes, the run reaches APPROVED and export, and the session ends with a block", async () => {
    const pin = PIN as { dir: string; bin: string };
    const work = mkdtempSync(join(tmpdir(), "dc-gate-"));
    writeFileSync(join(work, "plan.md"), "# Settings screen\n\nWe will add a settings page with a form and a save button in src/components/Settings.tsx.\n");
    const helper = join(mkdtempSync(join(tmpdir(), "dc-helper-")), "step.sh");
    writeFileSync(helper, HELPER);
    let hook: ReturnType<typeof gateHook> | null = null;
    let homeDir = "";
    const out = () => join(homeDir, ".gstack", "projects", "demo", "autoplan", "run-1");
    const logs: string[] = [];
    const r = await session({
      kind: "autoplan",
      work,
      path: pin.bin,
      home: (home) => {
        homeDir = home;
      },
      script: (t) => autoplanScript(out(), helper)(t),
      stopHook: (transcript) => {
        hook ??= gateHook({ box: localRunBox({ roots: [work, homeDir], gstackBin: pin.bin, env: { PATH: process.env.PATH ?? "", HOME: homeDir, GSTACK_SESSION_KIND: "unattended" }, cwd: work }), sinceMs: 0, log: (l) => logs.push(l) });
        return stopHandler({ kind: "autoplan", gate: hook, repair: null })!(transcript);
      },
    });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect([hook!.answered(), logs.filter((l) => / exited /.test(l))]).toEqual([[{ dir: out(), gateRev: 2 }], []]);
    expect(hook!.messages()).toBe(1);
    expect(r.bodies.some((b) => b.includes(GATE_MESSAGE))).toBe(true);
    const state = JSON.parse(readFileSync(join(out(), "run.json"), "utf8"));
    expect([state.status, state.gate_rev, state.gate.reply, state.gate.answered_by, state.gate.words_by]).toEqual(["complete", 2, "rec", "agent:harness", "agent:harness"]);
    const box = localRunBox({ roots: [homeDir], gstackBin: pin.bin, env: { PATH: process.env.PATH ?? "", HOME: homeDir }, cwd: work });
    const reading = autoplanExposure(runFilesOf(box));
    expect(reading.missing).toEqual([]);
    expect(reading.exposed).toBe(true);
    expect(parseStub(replyOf(r.transcript))).not.toBeNull();
  }, 300_000);

  // Value: protects=smoke rule 4's repair: a plan-design-review session that never shows the procedure is blocked twice with the one fixed message naming the missing outputs, then released, and a session without the hook is never blocked; fails_when=the hook never fires, blocks a third time, or its message does not reach the model; why_new=the lane's D1 hook drops D's devex-only behaviours; seam=repairHook, stopHandler, pdrExposure, the real SDK Stop hook; no_claim=what a real model does with the message
  test("the D1 hook blocks twice with its fixed message, then lets the session stop; off, nothing blocks", async () => {
    const work = mkdtempSync(join(tmpdir(), "dc-d1-"));
    writeFileSync(join(work, "plan.md"), "# Plan\n");
    let turns = 0;
    const repair = repairHook({ kind: "plan-design-review", detect: (t) => pdrExposure({ transcript: t, planBefore: "# Plan\n", planAfter: readFileSync(join(work, "plan.md"), "utf8") }), parse: parseStub, reply: replyOf });
    const handler = stopHandler({ kind: "plan-design-review", gate: null, repair })!;
    const r = await session({ kind: "plan-design-review", work, script: () => [{ type: "text", text: "turn " + ++turns }], stopHook: handler, prompt: "Review plan.md." });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(repair.blocks()).toBe(2);
    expect(turns).toBe(3);
    expect(r.bodies.at(-1)).toContain(D1_MESSAGE.split("{missing}")[0]!);
    expect(stopHandler({ kind: "none", gate: null, repair: null })).toBeNull();
    let plain = 0;
    const off = await session({ kind: "plan-design-review", work, script: () => [{ type: "text", text: "turn " + ++plain }], prompt: "Review plan.md." });
    expect(off.outcome.termination).toEqual({ kind: "completed" });
    expect(plain).toBe(1);
  }, 300_000);
});
