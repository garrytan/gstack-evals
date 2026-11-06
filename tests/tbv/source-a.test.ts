// Copyright (c) 2026 Garry Tan. MIT License.
// Source A (prereg section 4, amendment section 1): synthetic none-arm trials in the SDK log's shape, the provenance
// gate, the first-message rebuild against quick/laneb's own prompt builder and the real pinned SDK, the drops, the
// final-text cut and the task-directory digest. No real session text.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treeDigest } from "../../quick/laneb/runner/materialize.ts";
import { assembleA, buildFirstMessage, checkTaskDir, parseSession, run, taskDirDigest, treeDigestOf, type TrialFiles } from "../../lanes/tbv/history/source-a.ts";
import { codeOf } from "./history-helpers.ts";

const ROOT = join(import.meta.dir, "../..");
const WRAPPER = readFileSync(join(ROOT, "quick/laneb/runner/prompt-wrapper.md"), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const INSTR = "Fix the parser so that empty input returns an empty list.\n";
const DIGEST = "sha256:" + "a".repeat(64);
const A = (content: unknown[]) => ({ type: "AssistantMessage", t: 1, content });
const U = (content: unknown) => ({ type: "UserMessage", t: 1, content });
const R = (result: string) => ({ type: "ResultMessage", t: 1, subtype: "success", result, num_turns: 3, is_error: false });
const S = (subtype: string) => ({ type: "SystemMessage", t: 0, subtype });
const BASE = [
  S("init"),
  A([{ thinking: "Plan the fix.", signature: "sig" }]),
  A([{ text: "Running tests." }, { id: "toolu_1", name: "Bash", input: { command: "pytest -q" } }]),
  U([{ tool_use_id: "toolu_1", content: "tests/test_parse.py::test_empty FAILED\n=== 1 failed, 3 passed in 0.1s ===", is_error: true }]),
  A([{ id: "toolu_2", name: "Edit", input: { file_path: "/testbed/src/parse.py", old_string: "a", new_string: "b" } }]),
  U([{ tool_use_id: "toolu_2", content: [{ type: "text", text: "edited" }], is_error: false }]),
  A([{ text: "Done: the parser returns an empty list now." }]),
  R("Done: the parser returns an empty list now."),
];
const jsonl = (msgs: unknown[]) => msgs.map((m) => JSON.stringify(m)).join("\n") + "\n";
function trial(msgs: unknown[], over: Partial<TrialFiles> = {}, kwargs: Record<string, unknown> = { arm: "none" }, prompt: Record<string, unknown> | null = {}): TrialFiles {
  const files = new Map<string, string>([
    ["result.json", JSON.stringify({ task_name: "demo__parser-1", trial_name: "demo__parser-1__a1", started_at: "2026-11-04T10:00:00Z", config: { agent: { model_name: "anthropic/claude-opus-5-5", kwargs } } })],
    ["lock.json", JSON.stringify({ task: { digest: DIGEST } })],
    ["verifier/report.json", JSON.stringify({ "demo__parser-1": { resolved: true } })],
    ["artifacts/logs/artifacts/model.patch", "diff --git a/src/parse.py b/src/parse.py\n--- a/src/parse.py\n+++ b/src/parse.py\n"],
    ["evaluator/sdk-messages.jsonl", jsonl(msgs)],
  ]);
  if (prompt) files.set("evaluator/usersim-events.jsonl", JSON.stringify({ event: "prompt", wrapper_sha256: sha(WRAPPER), instruction_sha256: sha(INSTR), told_skill: "", ts: 1, ...prompt }) + "\n");
  return { files, taskTreeDigest: DIGEST, instruction: INSTR, wrapper: { text: WRAPPER, sha256: sha(WRAPPER) }, persona: { sha256: "p".repeat(64) }, manifest: { wrapper_sha256: sha(WRAPPER), persona_sha256: "p".repeat(64) }, runnerUnchangedSince: null, ...over };
}
const dropOf = (t: TrialFiles) => {
  const r = assembleA(t);
  return r.ok ? "kept" : r.drop;
};
const pyPrompt = (wrapper: string, instruction: string, closing: string) =>
  Bun.spawnSync(["python3", "-c", "import json,sys; sys.path.insert(0, sys.argv[1]); from prompt_builder import build_prompt; a = json.load(sys.stdin); sys.stdout.write(build_prompt(a[0], a[1], False, '', closing_line=a[2]))", join(ROOT, "quick/laneb/runner/agent")], { stdin: Buffer.from(JSON.stringify([wrapper, instruction, closing])) }).stdout.toString();

test("a kept session: rebuilt first message, thinking dropped, is_error kept, tool results flattened, final text cut", () => {
  const r = assembleA(trial(BASE));
  if (!r.ok) throw new Error(r.drop + " " + r.detail);
  const h = r.history;
  expect(h.events.map((e) => [e.n, e.kind])).toEqual([[1, "user-text"], [2, "assistant-text"], [3, "tool-use"], [4, "tool-result"], [5, "tool-use"], [6, "tool-result"]]);
  expect(h.events[0]).toEqual({ n: 1, kind: "user-text", text: pyPrompt(WRAPPER, INSTR, "") });
  expect(h.events[3]).toMatchObject({ tool_use_id: "toolu_1", is_error: true });
  expect(h.events[5]).toMatchObject({ tool_use_id: "toolu_2", content: "edited", is_error: false });
  expect(JSON.stringify(h.events)).not.toContain("Plan the fix.");
  expect(JSON.stringify(h.events)).not.toContain("returns an empty list now");
  expect(h).toMatchObject({ schema: "tbv-history.v1", source: "A", task: "demo__parser-1__a1", cluster: "demo__parser-1", family: "investigate", side: { files: ["src/parse.py"], resolved: true } });
  expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
});

test("buildFirstMessage matches prompt_builder.build_prompt, with $ patterns, a nested placeholder and a closing line", () => {
  for (const [w, i, c] of [[WRAPPER, INSTR, ""], [WRAPPER, "Use $& and $1 and {instruction} literally.", ""], ["Task: {instruction}", "Do it.", "r3c-root-cause-files"], [WRAPPER, "x\n", "r3c-root-cause-files"]]) {
    expect(buildFirstMessage(w, i, c ? { arm: "none", closing_line: c } : { arm: "none" })).toBe(pyPrompt(w, i, c));
  }
  expect(codeOf(() => buildFirstMessage(WRAPPER, INSTR, { arm: "none", closing_line: "no-such-line" }))).toBe("E_TBV_INPUT");
});

test("drops, each by its reason", () => {
  const task = A([{ id: "toolu_t", name: "Task", input: { prompt: "look" } }]);
  const taskResult = U([{ tool_use_id: "toolu_t", content: "found it", is_error: false }]);
  expect(dropOf(trial([...BASE.slice(0, 4), task, taskResult, ...BASE.slice(4)]))).toBe("subagent");
  expect(dropOf(trial([...BASE, R("again")]))).toBe("continuation");
  expect(dropOf(trial([...BASE.slice(0, 4), U("please keep going"), ...BASE.slice(4)]))).toBe("continuation");
  expect(dropOf(trial([...BASE.slice(0, 3), S("compact_boundary"), ...BASE.slice(3)]))).toBe("compaction");
  expect(dropOf(trial([...BASE.slice(0, -1), R("  ")]))).toBe("no_final_report");
  expect(dropOf(trial([...BASE.slice(0, 2), A([{ id: "toolu_9", name: "Bash", input: { command: "ls" } }]), ...BASE.slice(2)]))).toBe("unpaired_tool_use");
  expect(dropOf(trial(BASE.slice(0, -1)))).toBe("no_result");
  expect(parseSession(jsonl([...BASE.slice(0, 4), task, taskResult, ...BASE.slice(4), R("again")])).drops.sort()).toEqual(["continuation", "subagent"]);
});

test("a subagent session is kept only when every message carries parent_tool_use_id; the subagent's own messages never enter", () => {
  const tag = (m: Record<string, unknown>, p: string | null) => ({ ...m, parent_tool_use_id: p });
  const msgs = [
    S("init"),
    tag(A([{ id: "toolu_t", name: "Task", input: { prompt: "look" } }]), null),
    tag(A([{ id: "toolu_s", name: "Grep", input: { pattern: "x" } }]), "toolu_t"),
    tag(U([{ tool_use_id: "toolu_s", content: "sub result", is_error: false }]), "toolu_t"),
    tag(U([{ tool_use_id: "toolu_t", content: "found it", is_error: false }]), null),
    tag(A([{ text: "All done." }]), null),
    R("All done."),
  ];
  const r = assembleA(trial(msgs));
  if (!r.ok) throw new Error(r.drop);
  expect(r.history.events.map((e) => e.kind)).toEqual(["user-text", "tool-use", "tool-result"]);
  expect(JSON.stringify(r.history.events)).not.toContain("sub result");
});

test("the provenance gate drops on task digest, missing task dir, wrapper and persona, the prompt record and the arm", () => {
  expect(dropOf(trial(BASE, { taskTreeDigest: "sha256:" + "b".repeat(64) }))).toBe("task_digest");
  expect(dropOf(trial(BASE, { taskTreeDigest: null }))).toBe("task_dir_missing");
  expect(dropOf(trial(BASE, { instruction: null }))).toBe("task_dir_missing");
  expect(dropOf(trial(BASE, { manifest: { wrapper_sha256: "0".repeat(64), persona_sha256: "p".repeat(64) } }))).toBe("wrapper_persona");
  expect(dropOf(trial(BASE, { manifest: null, runnerUnchangedSince: "2026-11-03T09:37:00Z" }))).toBe("kept");
  expect(dropOf(trial(BASE, { manifest: null, runnerUnchangedSince: "2026-11-04T10:00:01Z" }))).toBe("wrapper_persona");
  expect(dropOf(trial(BASE, { manifest: null, runnerUnchangedSince: null }))).toBe("wrapper_persona");
  expect(dropOf(trial(BASE, {}, { arm: "none" }, { instruction_sha256: "0".repeat(64) }))).toBe("prompt_mismatch");
  expect(dropOf(trial(BASE, {}, { arm: "none" }, null))).toBe("kept");
  expect(dropOf(trial(BASE, {}, { arm: "gstack", told_skill: "investigate" }))).toBe("not_none_arm");
  expect(codeOf(() => assembleA(trial(BASE, { wrapper: { text: WRAPPER, sha256: "0".repeat(64) } })))).toBe("E_TBV_INPUT");
});

test("assembleA refuses a session whose text holds a drive path", () => {
  const msgs = BASE.map((m, i) => (i === 3 ? U([{ tool_use_id: "toolu_1", content: "cat " + ["", "home", "ada", ".capy", "drive", ""].join("/") + "x", is_error: false }]) : m));
  expect(codeOf(() => assembleA(trial(msgs)))).toBe("E_TBV_HISTORY");
});

test("taskDirDigest equals B0's tree() and materialize.ts treeDigest; checkTaskDir compares with the recorded digest", () => {
  const dir = mkdtempSync(join(tmpdir(), "tbv-taskdir-"));
  mkdirSync(join(dir, "a/b"), { recursive: true });
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "instruction.md"), INSTR);
  writeFileSync(join(dir, "a-b"), "dash");
  writeFileSync(join(dir, "a/b/c.txt"), "deep");
  writeFileSync(join(dir, "tests/test.sh"), "#!/bin/sh\nexit 0\n");
  const b0 = Bun.spawnSync(["python3", "-c", "import hashlib,sys,pathlib; d=pathlib.Path(sys.argv[1]); fs={p.relative_to(d).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in d.rglob('*') if p.is_file()}; o=hashlib.sha256(); [o.update(f'{r}\\0{fs[r]}\\n'.encode()) for r in sorted(fs, key=lambda r: r.encode())]; print('sha256:'+o.hexdigest())", dir]).stdout.toString().trim();
  expect(taskDirDigest(dir)).toBe(b0);
  expect(taskDirDigest(dir)).toBe("sha256:" + treeDigest(dir));
  expect(treeDigestOf(new Map([["instruction.md", sha(INSTR)], ["a-b", sha("dash")], ["a/b/c.txt", sha("deep")], ["tests/test.sh", sha("#!/bin/sh\nexit 0\n")]]))).toBe(b0);
  expect(checkTaskDir(dir, b0)).toBe(true);
  writeFileSync(join(dir, "a/b/c.txt"), "changed");
  expect(checkTaskDir(dir, b0)).toBe(false);
});

test("assemble-a reads a trial dir and a task dir and writes the history", async () => {
  const root = mkdtempSync(join(tmpdir(), "tbv-assemble-a-"));
  const t = trial(BASE, { manifest: null });
  for (const [rel, text] of t.files) {
    mkdirSync(join(root, "trial", rel, ".."), { recursive: true });
    writeFileSync(join(root, "trial", rel), text);
  }
  mkdirSync(join(root, "task"));
  writeFileSync(join(root, "task/instruction.md"), INSTR);
  const digest = taskDirDigest(join(root, "task"));
  writeFileSync(join(root, "trial/lock.json"), JSON.stringify({ task: { digest } }));
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ wrapper_sha256: sha(WRAPPER), persona_sha256: sha(readFileSync(join(ROOT, "quick/laneb/runner/agent/persona.json"), "utf8")) }));
  const out: string[] = [];
  const code = await run(["assemble-a", "--trial", join(root, "trial"), "--task-dir", join(root, "task"), "--manifest", join(root, "manifest.json"), "--out", join(root, "h.json")], { out: (s) => out.push(s), err: (s) => out.push(s) });
  expect(code).toBe(0);
  const h = JSON.parse(readFileSync(join(root, "h.json"), "utf8"));
  expect(h.events.length).toBe(6);
  expect(out.join("\n")).toContain("kept");
});

test("the rebuild agrees with the real Lane B agent under the real pinned Agent SDK (prompt, block shapes, prompt record)", () => {
  const pin = readFileSync(join(ROOT, "quick/laneb/runner/vm-bootstrap.sh"), "utf8").match(/^SDK_PIN=(\S+)$/m)![1];
  const venv = join(tmpdir(), "laneb-claude-agent-sdk-" + pin);
  const python = join(venv, "bin/python");
  if (!existsSync(python) || Bun.spawnSync([python, "-c", "import claude_agent_sdk as s; assert s.__version__ == '" + pin + "'"]).exitCode !== 0) {
    const install = Bun.spawnSync(["sh", "-c", 'python3 -m venv --clear "$1" && "$1/bin/pip" install -q "claude-agent-sdk==$2"', "sh", venv, pin]);
    expect(install.exitCode).toBe(0);
  }
  const tmp = mkdtempSync(join(tmpdir(), "tbv-sdk-"));
  const m = (role: string, content: unknown[]) => ({ type: role, message: { role, model: "claude-opus-5-5", content }, parent_tool_use_id: null, session_id: "s" });
  const script = [
    m("assistant", [{ type: "thinking", thinking: "Plan the fix.", signature: "sig" }]),
    m("assistant", [{ type: "text", text: "Running tests." }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pytest -q" } }]),
    m("user", [{ type: "tool_result", tool_use_id: "toolu_1", content: "tests/test_parse.py::test_empty FAILED", is_error: true }]),
    m("assistant", [{ type: "text", text: "Done: fixed." }]),
    { type: "result", subtype: "success", duration_ms: 1, duration_api_ms: 1, is_error: false, num_turns: 2, session_id: "s", total_cost_usd: 0, usage: {}, result: "Done: fixed." },
  ];
  writeFileSync(join(tmp, "script.json"), JSON.stringify(script));
  writeFileSync(join(tmp, "wrapper.src"), WRAPPER);
  writeFileSync(join(tmp, "instruction.md"), INSTR);
  const p = Bun.spawnSync([python, join(import.meta.dir, "fixtures/sdk_trial.py"), tmp, join(tmp, "wrapper.src"), join(tmp, "instruction.md"), join(tmp, "script.json")]);
  expect(p.exitCode).toBe(0);
  const ev = join(tmp, "trial/evaluator");
  const t = trial([]);
  t.files.set("evaluator/sdk-messages.jsonl", readFileSync(join(ev, "sdk-messages.jsonl"), "utf8"));
  t.files.set("evaluator/usersim-events.jsonl", readFileSync(join(ev, "usersim-events.jsonl"), "utf8"));
  const r = assembleA(t);
  if (!r.ok) throw new Error(r.drop + " " + r.detail);
  expect(r.history.events[0]).toMatchObject({ kind: "user-text", text: JSON.parse(readFileSync(join(tmp, "docker.jsonl.prompt"), "utf8")) });
  expect(r.history.events.slice(1)).toEqual([
    { n: 2, kind: "assistant-text", text: "Running tests." },
    { n: 3, kind: "tool-use", id: "toolu_1", name: "Bash", input: { command: "pytest -q" } },
    { n: 4, kind: "tool-result", tool_use_id: "toolu_1", content: "tests/test_parse.py::test_empty FAILED", is_error: true },
  ]);
}, 300_000);

test("two sessions of one task get distinct task ids from their trial names and share the task's cluster; no trial name is refused", () => {
  const withName = (name: unknown) => {
    const t = trial(BASE);
    t.files.set("result.json", JSON.stringify({ ...JSON.parse(t.files.get("result.json")!), trial_name: name }));
    return t;
  };
  const a = assembleA(withName("demo__parser-1__a1"));
  const b = assembleA(withName("demo__parser-1__b2"));
  if (!a.ok || !b.ok) throw new Error("both sessions should be kept");
  expect([a.history.task, b.history.task]).toEqual(["demo__parser-1__a1", "demo__parser-1__b2"]);
  expect([a.history.cluster, b.history.cluster]).toEqual(["demo__parser-1", "demo__parser-1"]);
  let code = "no error";
  try {
    assembleA(withName(undefined));
  } catch (e) {
    code = (e as { code?: string }).code ?? String(e);
  }
  expect(code).toBe("E_TBV_INPUT");
});
