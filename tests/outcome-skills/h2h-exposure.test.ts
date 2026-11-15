// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's exposure detectors and read audit (post section 8) on synthetic transcripts in both shapes the
// session runner keeps: the SDK message records and Claude Code's own transcript. Each pack arm gets a session that
// loaded the pack and ran its procedure, one that loaded it only, and one that did neither.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { events, exposure, readAudit, readEvents, readInstalls, type Ev } from "../../lanes/outcome-skills/h2h/sessions/exposure.ts";
import { freeze, lead, MARKERS_PATH, readMarkers, type Markers } from "../../lanes/outcome-skills/h2h/sessions/markers.ts";
import { readExposure } from "../../lanes/outcome-skills/h2h/sessions/run.ts";
import type { ArmInstall, Entry, H2hArm } from "../../lanes/outcome-skills/h2h/types.ts";

const M = readMarkers();
type Rec = Record<string, unknown>;
let n = 0;

/** One session in the SDK record shape: user prompts and hook context, assistant text, tool calls and their results. */
const sdk = () => {
  const recs: Rec[] = [];
  const s = {
    user: (text: string) => (recs.push({ type: "UserMessage", content: text, parent_tool_use_id: null }), s),
    hook: (text: string) => (recs.push({ type: "SystemMessage", subtype: "hook_response", data: { output: text } }), s),
    say: (text: string, main = true) => (recs.push({ type: "AssistantMessage", content: [{ type: "text", text }], parent_tool_use_id: main ? null : "toolu_task" }), s),
    tool: (name: string, input: Rec, result = "ok", error = false) => {
      const id = "toolu_" + n++;
      recs.push({ type: "AssistantMessage", content: [{ type: "tool_use", id, name, input }], parent_tool_use_id: null });
      recs.push({ type: "UserMessage", content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: error }], parent_tool_use_id: null });
      return s;
    },
    evs: (): Ev[] => events(recs),
  };
  return s;
};
const run = (arm: H2hArm, entry: Entry, evs: Ev[], markers: Markers = M, files: string[] = []) => exposure(arm, entry, evs, { markers, files });
const flags = (e: { loaded: boolean; procedure: boolean }) => [e.loaded, e.procedure];
const skillStart = (skill: string) => "~/.claude/skills/gstack/bin/gstack-skill-start --skill \"" + skill + "\" --model \"claude\"";

test("gstack and gstack-oneline: autoplan expanded and its skill-start run on feature entries; the installed pack on bug entries", () => {
  const both = sdk().user("<command-name>/autoplan</command-name>\n<command-args></command-args>").tool("Bash", { command: skillStart("autoplan") }).evs();
  expect(flags(run("gstack", "feature", both))).toEqual([true, true]);
  expect(run("gstack", "feature", both).markers).toEqual(["command:/autoplan", "skill-start:autoplan"]);
  expect(flags(run("gstack", "feature", sdk().user("<command-name>/autoplan</command-name>").tool("Bash", { command: "ls" }).evs()))).toEqual([true, false]);
  expect(flags(run("gstack", "feature", sdk().user("add the flag").tool("Bash", { command: "gstack-skill-start --skill \"qa\"" }).evs()))).toEqual([false, false]);
  expect(run("gstack", "bug", sdk().user("fix the bug").evs())).toEqual({ loaded: true, procedure: true, markers: ["installed-pack"], foreign_reads: [] });
  expect(run("gstack-oneline", "bug", sdk().user("fix the bug").evs()).markers).toEqual(["installed-pack"]);
  const oneline = sdk().user("add the flag\n\nUse gstack.").tool("Skill", { skill: "autoplan" }, "Launching skill: autoplan").user("Base directory for this skill: /root/.claude/skills/gstack/autoplan\n\n# autoplan").tool("Bash", { command: skillStart("autoplan") }).evs();
  expect(run("gstack-oneline", "feature", oneline).markers).toEqual(["base:/root/.claude/skills/gstack/autoplan", "skill:autoplan", "skill-start:autoplan"]);
  expect(flags(run("gstack-oneline", "feature", sdk().tool("Skill", { skill: "autoplan" }, "<tool_use_error>Unknown skill</tool_use_error>", true).evs()))).toEqual([false, false]);
});

test("gstack-qa: qa expanded, and the browse binary run", () => {
  expect(run("gstack-qa", "bug", sdk().user("<command-name>/qa</command-name>").tool("Bash", { command: skillStart("qa") }).tool("Bash", { command: "$B goto http://localhost:3000" }).evs()).markers).toEqual(["command:/qa", "browse", "skill-start:qa"]);
  expect(flags(run("gstack-qa", "bug", sdk().user("<command-name>/qa</command-name>").tool("Bash", { command: "~/.claude/skills/gstack/browse/dist/browse snapshot" }).evs()))).toEqual([true, true]);
  expect(flags(run("gstack-qa", "bug", sdk().user("<command-name>/qa</command-name>").tool("Bash", { command: skillStart("qa") }).evs()))).toEqual([true, false]);
  expect(flags(run("gstack-qa", "bug", sdk().user("fix it").tool("Bash", { command: "npm test" }).evs()))).toEqual([false, false]);
});

test("gstack-pony: the ponystack hook's session and phase lines, not the hook file read as a tool result", () => {
  expect(flags(run("gstack-pony", "feature", sdk().hook("PONYSTACK ACTIVE ratio 1").user("<system-reminder>PONYSTACK PHASE: understand - think wide</system-reminder>").evs()))).toEqual([true, true]);
  expect(flags(run("gstack-pony", "feature", sdk().hook("PONYSTACK ACTIVE ratio 1").evs()))).toEqual([true, false]);
  expect(flags(run("gstack-pony", "feature", sdk().tool("Read", { file_path: "/root/.claude/plugins/ponystack/hooks/ponystack-hook.js" }, "'PONYSTACK ACTIVE' 'PONYSTACK PHASE: understand'").evs()))).toEqual([false, false]);
});

test("superpowers: the session-start block, then an announcement in the main thread followed by a todo list", () => {
  const hook = "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n</EXTREMELY_IMPORTANT>";
  expect(run("superpowers", "bug", sdk().hook(hook).say("Using systematic-debugging to find the root cause.").tool("TodoWrite", { todos: [{ content: "Reproduce", status: "pending" }] }).evs()).markers).toEqual(["session:You have superpowers.", "announce:systematic-debugging", "todo"]);
  expect(flags(run("superpowers", "feature", sdk().hook(hook).say("Using `superpowers:brainstorming` to shape the design.").tool("TaskCreate", { subject: "Design", description: "d", activeForm: "Designing" }).evs()))).toEqual([true, true]);
  expect(flags(run("superpowers", "bug", sdk().hook(hook).tool("TodoWrite", { todos: [] }).say("Using systematic-debugging to find it.").evs()))).toEqual([true, false]);
  expect(flags(run("superpowers", "bug", sdk().hook(hook).say("Using systematic-debugging to find it.", false).tool("TodoWrite", { todos: [] }).evs()))).toEqual([true, false]);
  expect(flags(run("superpowers", "bug", sdk().hook(hook).say("Using grep to find it.").tool("TodoWrite", { todos: [] }).evs()))).toEqual([true, false]);
  expect(flags(run("superpowers", "bug", sdk().say("fixing").evs()))).toEqual([false, false]);
});

test("agent-skills: a failing test written and run before the source on bugs, SPEC.md and tasks/plan.md on features", () => {
  const cmd = sdk().user("<command-name>/agent-skills:test</command-name>");
  expect(run("agent-skills", "bug", cmd.tool("Write", { file_path: "/app/tests/parse.test.ts", content: "x" }).tool("Bash", { command: "bun test" }, "1 fail\nAssertionError: expected 2", true).tool("Edit", { file_path: "/app/src/parse.ts", old_string: "a", new_string: "b" }).evs()).markers).toEqual(["command:/agent-skills:test", "test-first:/app/tests/parse.test.ts", "failing-run"]);
  expect(flags(run("agent-skills", "bug", sdk().user("<command-name>/agent-skills:test</command-name>").tool("Edit", { file_path: "/app/src/parse.ts" }).tool("Write", { file_path: "/app/tests/parse.test.ts" }).tool("Bash", { command: "bun test" }, "FAIL", true).evs()))).toEqual([true, false]);
  expect(flags(run("agent-skills", "bug", sdk().tool("Write", { file_path: "/app/pkg/parse_test.go" }).tool("Bash", { command: "go test ./..." }, "ok all passed").tool("Edit", { file_path: "/app/pkg/parse.go" }).evs()))).toEqual([false, false]);
  expect(flags(run("agent-skills", "bug", sdk().tool("Write", { file_path: "/app/pkg/parse_test.go" }).tool("Bash", { command: "go test ./..." }, "--- FAIL: TestParse").tool("Edit", { file_path: "/app/pkg/parse.go" }).evs()))).toEqual([false, true]);
  expect(flags(run("agent-skills", "feature", sdk().user("<command-name>/agent-skills:spec</command-name>").tool("Write", { file_path: "/app/SPEC.md" }).tool("Write", { file_path: "/app/tasks/plan.md" }).evs()))).toEqual([true, true]);
  expect(flags(run("agent-skills", "feature", sdk().user("<command-name>/agent-skills:spec</command-name>").tool("Write", { file_path: "/app/SPEC.md" }).evs()))).toEqual([true, false]);
  expect(flags(run("agent-skills", "feature", sdk().user("<command-name>/superpowers:brainstorming</command-name>").evs()))).toEqual([false, false]);
});

test("gsd: its tools run and a quick or debug planning file written", () => {
  expect(run("gsd", "bug", sdk().user("<command-name>/gsd-debug</command-name>").tool("Bash", { command: "node \"$HOME/.claude/gsd-core/bin/gsd-tools.cjs\" init debug" }).tool("Write", { file_path: "/app/.planning/debug/parse.md" }).evs()).markers).toEqual(["command:/gsd-debug", "gsd-tools", "planning:/app/.planning/debug/parse.md"]);
  expect(flags(run("gsd", "feature", sdk().user("<command-name>/gsd-quick</command-name>").tool("Bash", { command: "gsd_run init quick" }).evs(), M, [".planning/quick/260101-flag/PLAN.md"]))).toEqual([true, true]);
  expect(flags(run("gsd", "feature", sdk().user("<command-name>/gsd-quick</command-name>").tool("Write", { file_path: "/app/.planning/quick/1/PLAN.md" }).evs()))).toEqual([true, false]);
  expect(flags(run("gsd", "feature", sdk().tool("Bash", { command: "ls" }).evs()))).toEqual([false, false]);
});

test("pstack: a todo list whose first two items lead with a playbook's first two steps", () => {
  const steps = ["Reproduce the failure with the smallest input you can find.", "Read the code path end to end before changing it."];
  const m: Markers = structuredClone(M);
  m.packs.pstack!.playbooks = { ...m.packs.pstack!.playbooks, fixture: steps.map((s) => createHash("sha256").update(lead(s)).digest("hex")) };
  const cmd = "<command-name>/pstack:poteto-mode</command-name>";
  expect(run("pstack", "bug", sdk().user(cmd).tool("TodoWrite", { todos: [{ content: "reproduce the failure, with the smallest input" }, { content: "Read the code path end-to-end first" }, { content: "fix" }] }).evs(), m).markers).toEqual(["command:/pstack:poteto-mode", "playbook:fixture"]);
  expect(flags(run("pstack", "bug", sdk().user(cmd).tool("TaskCreate", { subject: steps[0]! }).tool("TaskCreate", { subject: steps[1]! }).evs(), m))).toEqual([true, true]);
  expect(flags(run("pstack", "bug", sdk().user(cmd).tool("TodoWrite", { todos: [{ content: steps[1]! }, { content: steps[0]! }] }).evs(), m))).toEqual([true, false]);
  expect(flags(run("pstack", "bug", sdk().tool("TodoWrite", { todos: [{ content: "fix it" }] }).evs(), m))).toEqual([false, false]);
  expect(Object.keys(M.packs.pstack!.playbooks!).length).toBeGreaterThan(0);
});

test("tstack: sol-loop, file-pr or babysit-pr launched, read or acted on", () => {
  expect(run("tstack", "feature", sdk().user("<command-name>/full-send</command-name>").tool("Skill", { skill: "sol-loop" }, "Launching skill: sol-loop").evs()).markers).toEqual(["command:/full-send", "skill:sol-loop", "skill:sol-loop"]);
  expect(flags(run("tstack", "bug", sdk().user("<command-name>/full-send</command-name>").tool("Read", { file_path: "/root/.claude/skills/file-pr/SKILL.md" }).evs()))).toEqual([true, true]);
  expect(flags(run("tstack", "bug", sdk().user("<command-name>/full-send</command-name>").tool("Bash", { command: "gh pr create --fill" }, "no remote", true).evs()))).toEqual([true, true]);
  expect(flags(run("tstack", "bug", sdk().user("<command-name>/full-send</command-name>").user("Base directory for this skill: /root/.claude/skills/babysit-pr").evs()))).toEqual([true, true]);
  expect(flags(run("tstack", "bug", sdk().user("<command-name>/full-send</command-name>").tool("Bash", { command: "git commit -am fix" }).evs()))).toEqual([true, false]);
  expect(flags(run("tstack", "bug", sdk().user("<command-name>/autoplan</command-name>").evs()))).toEqual([false, false]);
});

test("none has no pack to detect, whatever the transcript holds", () => {
  const evs = sdk().hook("You have superpowers. PONYSTACK ACTIVE").user("<command-name>/autoplan</command-name>").tool("Bash", { command: skillStart("autoplan") }).evs();
  expect(run("none", "feature", evs)).toEqual({ loaded: false, procedure: false, markers: [], foreign_reads: [] });
  expect(() => run("bogus" as H2hArm, "bug", evs)).toThrow(/^E_H2H_EXPOSURE unknown arm bogus/);
});

test("Claude Code's own transcript shape reads the same, sidechains apart", () => {
  const cc: Rec[] = [
    { type: "user", isSidechain: false, message: { role: "user", content: "<command-name>/autoplan</command-name>\n<command-args></command-args>" } },
    { type: "assistant", isSidechain: false, message: { role: "assistant", content: [{ type: "text", text: "Using brainstorming to plan." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: skillStart("autoplan") } }] } },
    { type: "user", isSidechain: false, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "STARTED autoplan" }] }] }, toolUseResult: { stdout: "STARTED autoplan" } },
    { type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "side" }] } },
    { type: "attachment", attachment: { type: "hook_additional_context", content: ["You have superpowers."] } },
  ];
  const evs = events(cc);
  expect(evs.map((e) => [e.kind, e.main])).toEqual([["context", true], ["text", true], ["tool_use", true], ["tool_result", true], ["tool_result", true], ["text", false], ["context", true]]);
  expect(run("gstack", "feature", evs).markers).toEqual(["command:/autoplan", "skill-start:autoplan"]);
  expect(run("superpowers", "feature", evs).loaded).toBe(true);
});

/** A gsd quick session's run dir: its transcript runs gsd-tools and writes nothing, so only tree.tar can show a planning file. */
function gsdQuickRun() {
  const dir = mkdtempSync(join(tmpdir(), "h2h-exposure-tree-"));
  const recs = [
    { type: "UserMessage", content: "<command-name>/gsd-quick</command-name>", parent_tool_use_id: null },
    { type: "AssistantMessage", content: [{ type: "tool_use", id: "toolu_q", name: "Bash", input: { command: "gsd_run init quick" } }], parent_tool_use_id: null },
    { type: "UserMessage", content: [{ type: "tool_result", tool_use_id: "toolu_q", content: "ok", is_error: false }], parent_tool_use_id: null },
  ];
  writeFileSync(join(dir, "sdk-messages.jsonl"), recs.map((r) => JSON.stringify(r) + "\n").join(""));
  const tree = join(dir, "t");
  mkdirSync(join(tree, ".planning/quick/1"), { recursive: true });
  mkdirSync(join(tree, ".git"));
  writeFileSync(join(tree, ".planning/quick/1/PLAN.md"), "x\n");
  writeFileSync(join(tree, ".git/HEAD"), "x\n");
  const tar = () => expect(spawnSync("tar", ["-C", tree, "-cf", join(dir, "tree.tar"), ".git", ".planning/quick/1/PLAN.md"]).status).toBe(0);
  const i = { session: { arm: "gsd", entry: "feature" } } as unknown as Parameters<typeof readExposure>[0];
  return { dir, tar, i };
}
const PLANNED = { loaded: true, procedure: true, markers: ["command:/gsd-quick", "gsd-tools", "planning:.planning/quick/1/PLAN.md"] };

test("readExposure counts the GSD planning files the session's tree.tar holds", () => {
  const { dir, tar, i } = gsdQuickRun();
  try {
    expect(flags(readExposure(i, dir)!)).toEqual([true, false]);
    tar();
    expect(readExposure(i, dir)).toMatchObject(PLANNED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readExposure halts on a tree.tar tar cannot list, with tar's stderr, and reads a valid one", () => {
  const { dir, tar, i } = gsdQuickRun();
  try {
    writeFileSync(join(dir, "tree.tar"), "not a tar archive\n".repeat(64));
    expect(() => readExposure(i, dir)).toThrow(/^E_H2H_EXPOSURE .*tree\.tar does not list \(tar exit 2\): tar: This does not look like a tar archive.*never read as not exercised/s);
    tar();
    expect(readExposure(i, dir)).toMatchObject(PLANNED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEvents joins transcripts in order, drops a torn last line and refuses any other bad line", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2h-exp-"));
  try {
    const a = join(dir, "sdk-messages.jsonl");
    const b = join(dir, "claude-session.jsonl");
    writeFileSync(a, JSON.stringify({ type: "UserMessage", content: "<command-name>/qa</command-name>" }) + "\n" + '{"type":"Assist');
    writeFileSync(b, JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Bash", input: { command: "$B snapshot" } }] } }) + "\n");
    const evs = readEvents([a, b]);
    expect(evs.map((e) => e.at)).toEqual([0, 1]);
    expect(run("gstack-qa", "bug", evs).markers).toEqual(["command:/qa", "browse"]);
    writeFileSync(a, "[1]\n" + JSON.stringify({ type: "UserMessage", content: "x" }) + "\n");
    expect(() => readEvents([a])).toThrow(/^E_H2H_EXPOSURE .*line 1 is not a JSON object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const INSTALLS = [
  { arm: "gstack", home_of: null, pins: [], roots: [".claude/skills/gstack", ".claude/skills/autoplan"], home_tree_sha256: "0".repeat(64) },
  { arm: "gstack-oneline", home_of: "gstack", pins: [], roots: [], home_tree_sha256: "0".repeat(64) },
  { arm: "superpowers", home_of: null, pins: [], roots: [".claude/plugins/cache/superpowers"], home_tree_sha256: "1".repeat(64) },
  { arm: "none", home_of: null, pins: [], roots: [], home_tree_sha256: "2".repeat(64) },
] as unknown as ArmInstall[];

test("the read audit lists reads under another arm's roots and drive reads, never the arm's own or its home's", () => {
  const evs = sdk()
    .tool("Read", { file_path: "/root/.claude/skills/gstack/SKILL.md" })
    .tool("Grep", { pattern: "x", path: "~/.claude/plugins/cache/superpowers" })
    .tool("Bash", { command: "cat $HOME/.claude/skills/autoplan/SKILL.md" })
    .tool("Read", { file_path: "/root/.claude/skills/gstackish/SKILL.md" })
    .tool("Read", { file_path: "/root/.capy/drive/user-garry-tan/skills/gstack/SKILL.md" })
    .evs();
  const none = readAudit(evs, INSTALLS, "none");
  expect(none.by_arm).toEqual({ gstack: ["Read: /root/.claude/skills/gstack/SKILL.md", "Bash: cat $HOME/.claude/skills/autoplan/SKILL.md"], superpowers: ["Grep: /root/.claude/plugins/cache/superpowers"] });
  expect(none.drive_reads).toEqual(["Read: /root/.capy/drive/user-garry-tan/skills/gstack/SKILL.md"]);
  expect(readAudit(evs, INSTALLS, "gstack-oneline").by_arm).toEqual({ superpowers: ["Grep: /root/.claude/plugins/cache/superpowers"] });
  expect(readAudit(evs, INSTALLS, "superpowers").foreign_reads).toEqual(none.by_arm.gstack!);
  expect(Object.keys(readAudit(evs, INSTALLS).by_arm).sort()).toEqual(["gstack", "superpowers"]);
});

test("readInstalls takes part A's arms-pins.json as an array, an arms list or a map, and refuses anything else", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2h-pins-"));
  try {
    const f = join(dir, "arms-pins.json");
    for (const shape of [INSTALLS, { arms: INSTALLS }, Object.fromEntries(INSTALLS.map((a) => [a.arm, a]))]) {
      writeFileSync(f, JSON.stringify(shape));
      expect(readInstalls(f).map((a) => a.arm)).toEqual(INSTALLS.map((a) => a.arm));
    }
    writeFileSync(f, JSON.stringify([{ arm: "nobody", roots: [] }]));
    expect(() => readInstalls(f)).toThrow(/^E_H2H_EXPOSURE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("markers.json is frozen at prereg.json's pins, and a markers file at any other pin refuses", () => {
  expect(M.schema).toBe("h2h-markers.v1");
  expect(Object.keys(M.packs).sort()).toEqual(["agent-skills", "gsd", "gstack", "ponystack", "pstack", "superpowers", "tstack"]);
  expect(M.packs.gstack!.skills).toContain("autoplan");
  const dir = mkdtempSync(join(tmpdir(), "h2h-mk-"));
  try {
    const bad = structuredClone(M);
    bad.packs.gsd!.pin = "f".repeat(40);
    writeFileSync(join(dir, "m.json"), JSON.stringify(bad));
    expect(() => readMarkers(join(dir, "m.json"))).toThrow(/^E_H2H_EXPOSURE .*froze gsd at f{40}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PACKS = process.env.H2H_PACKS_DIR ?? join(homedir(), ".capy/work/h2h-s/packs");
test.skipIf(!existsSync(join(PACKS, "gstack")))("markers.json is what freeze reads from the pinned clones", () => {
  expect(freeze(PACKS)).toEqual(JSON.parse(readFileSync(MARKERS_PATH, "utf8")));
});
