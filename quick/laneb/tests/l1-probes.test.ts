// Keyless tests of the L1 probes (quick/laneb/l1/probes.ts): probe L, probe I with #169 7.6's attacks and fc#3's cases, the
// project-skill rule, the S13 background count, the contract block and the no-gstack read audit. The two cli-*.jsonl fixtures
// are SDK message logs the real Claude Code 2.1.312 wrote under the pinned Agent SDK 0.2.174 against a fake upstream, recorded
// by laneb_agent.py's own loop, with machine paths replaced by /root and /testbed. The rest build logs of the same shape.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTestRunner, parseLog, runProbes, simpleCommands, writeTargets, type ProbeOptions, type Probes } from "../l1/probes.ts";

const FIX = join(import.meta.dir, "fixtures/l1");
const CLI_SKILL = "---\nname: investigate\ndescription: Debug systematically.\n---\n# investigate body FIRST200 marker text that is long enough to be the start of the skill body for testing purposes only\n\nDEBUG REPORT template.\n";
const SKILL = "---\nname: investigate\npreamble-tier: 2\nversion: 1.0.0\ndescription: \"Use when a test fails, code errors or output is wrong: find the root cause, then fix it. (synthetic)\"\nallowed-tools:\n  - Bash\n  - Read\n  - Edit\n---\n\n# investigate\n";
const PREFIX = SKILL.slice(0, 200);
const OTHER = SKILL.replace("synthetic", "other pin").slice(0, 200);
const OPTS: ProbeOptions = { gstackRoots: ["/root/.claude/skills/", "/root/.gstack/"], investigatePrefix: PREFIX, home: "/root" };

let n = 0;
const A = (...content: unknown[]) => JSON.stringify({ type: "AssistantMessage", content });
const U = (...content: unknown[]) => JSON.stringify({ type: "UserMessage", content });
const init = (cwd = "/testbed") => JSON.stringify({ type: "SystemMessage", subtype: "init", init: { cwd } });
const result = (subtype = "success") => JSON.stringify({ type: "ResultMessage", subtype, result: "" });
const sys = (type: string, subtype: string) => JSON.stringify({ type, subtype });
const tool = (name: string, input: Record<string, unknown>, out: unknown = "", error = false) => {
  const id = "toolu_" + ++n;
  return [A({ id, name, input }), U({ tool_use_id: id, content: out, is_error: error })];
};
const bash = (command: string, out = "", error = false) => tool("Bash", { command }, out, error);
const text = (t: string) => [A({ text: t })];
const userText = (t: string) => [U({ text: t })];
const run = (parts: (string | string[])[], o: ProbeOptions = OPTS): Probes => runProbes(parseLog([init(), ...parts.flat()].join("\n")), o);
const report = (fix = "src/calc.py:12", status = "DONE") =>
  ["## DEBUG REPORT", "════════", "Symptom: add() returns a - b", "Root cause: the operator is wrong", "Fix: changed " + fix, "Evidence: pytest passes, 3 passed", "Regression test: tests/test_calc.py:5", "Status: " + status].join("\n");
const skillLoad = (name: string, dir: string, error = false) => {
  const id = "toolu_" + ++n;
  return [A({ id, name: "Skill", input: { skill: name } }), U({ tool_use_id: id, content: "Launching skill: " + name, is_error: error ? true : null }), ...(error ? [] : [U({ text: "Base directory for this skill: " + dir + "\n\n# body" })])];
};
const edit = (path = "/testbed/src/calc.py") => tool("Edit", { file_path: path, old_string: "a - b", new_string: "a + b" }, "The file has been updated.");

describe("real CLI logs", () => {
  test("Skill and Read loads resolve to the user install, the project skill is a repo load, and background work runs at the result", () => {
    const p = runProbes(parseLog(readFileSync(join(FIX, "cli-skill-bg.jsonl"), "utf8")), { gstackRoots: ["/root/.claude/skills/"], investigatePrefix: CLI_SKILL.slice(0, 200), home: "/root" });
    expect(p.probe_l).toEqual({ investigate: true, gstack_loads: ["investigate"], repo_loads: ["projskill"], unresolved: 0 });
    expect(p.background).toEqual({ launches: 3, started: 5, notices: 4, at_result: true });
    expect(p.probe_i).toMatchObject({ report: true, fix_edited: true, status: true, check_after_edit: false, complete: false, edits: 1 });
    expect(p.contract_block).toBe(false);
  });
  test("a stopped task, a default async agent, parallel and failing background commands leave nothing running at the result", () => {
    const p = runProbes(parseLog(readFileSync(join(FIX, "cli-kill-agent.jsonl"), "utf8")), { gstackRoots: ["/root/.claude/skills/"], investigatePrefix: null, home: "/root" });
    expect(p.background).toEqual({ launches: 5, started: 6, notices: 6, at_result: false });
    expect(p.probe_l.investigate).toBe(false);
  });
  test("the same session read with the other pin's prefix loads through Skill but not through Read", () => {
    const p = runProbes(parseLog(readFileSync(join(FIX, "cli-skill-bg.jsonl"), "utf8")), { gstackRoots: [], investigatePrefix: OTHER, home: "/root" });
    expect(p.probe_l.investigate).toBe(false);
    expect(p.probe_l.repo_loads).toEqual(["investigate", "projskill"]);
  });
});

describe("probe L", () => {
  test("a Skill call resolved to the gstack install loads; one resolved to the task checkout is a repo skill (section 4)", () => {
    expect(run([skillLoad("investigate", "/root/.claude/skills/investigate")]).probe_l.investigate).toBe(true);
    const repo = run([skillLoad("investigate", "/testbed/.claude/skills/investigate")]);
    expect(repo.probe_l).toEqual({ investigate: false, gstack_loads: [], repo_loads: ["investigate"], unresolved: 0 });
  });
  test("a Skill call with an error result, or with no base directory in the log, is no load", () => {
    expect(run([skillLoad("investigate", "/root/.claude/skills/investigate", true)]).probe_l.investigate).toBe(false);
    const id = "toolu_nodir";
    const p = run([A({ id, name: "Skill", input: { skill: "/investigate" } }), U({ tool_use_id: id, content: "Launching skill: investigate", is_error: null })]);
    expect(p.probe_l).toMatchObject({ investigate: false, unresolved: 1 });
  });
  test("a Read loads only when its result holds the arm's own first 200 characters, with either line-number style", () => {
    const numbered = (body: string, sep: string) => body.split("\n").map((l, i) => String(i + 1).padStart(sep === "\t" ? 0 : 6) + sep + l).join("\n");
    expect(run([tool("Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" }, numbered(SKILL, "\t"))]).probe_l.investigate).toBe(true);
    expect(run([tool("Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" }, numbered(SKILL, "\u2192"))]).probe_l.investigate).toBe(true);
    expect(run([tool("Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" }, numbered(SKILL.replace("synthetic", "other pin"), "\t"))]).probe_l.investigate).toBe(false);
    expect(run([tool("Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" }, numbered(SKILL, "\t"), true)]).probe_l.investigate).toBe(false);
  });
  test("a Bash cat of the body loads; a partial head, a mention in text and the route hook's words do not", () => {
    expect(run([bash("cat ~/.claude/skills/investigate/SKILL.md", SKILL)]).probe_l.investigate).toBe(true);
    expect(run([bash("head -c 80 ~/.claude/skills/investigate/SKILL.md", SKILL.slice(0, 80))]).probe_l.investigate).toBe(false);
    expect(run([text("gstack skill routing (UserPromptSubmit hook; ...): this request fits /investigate. Run /investigate with the Skill tool.")]).probe_l.investigate).toBe(false);
    expect(run([bash("cat README.md", SKILL)]).probe_l.investigate).toBe(false);
  });
  test("the none arm has no prefix and no install, so nothing loads", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("cat ~/.claude/skills/investigate/SKILL.md", SKILL), skillLoad("investigate", "/root/.claude/skills/investigate")], none).probe_l.investigate).toBe(false);
  });
});

describe("probe I", () => {
  test("edit, test, then a full report naming the edited file is complete", () => {
    const p = run([bash("python repro.py", "Traceback", true), edit(), bash("pytest -q", "3 passed"), text(report())]);
    expect(p.probe_i).toEqual({ complete: true, report: true, fix_edited: true, status: true, check_after_edit: true, edits: 1 });
  });
  test("attack 1: an empty template fails item 1, a verbatim template copy fails items 2 and 3", () => {
    const empty = ["DEBUG REPORT", "Symptom:", "Root cause:", "Fix:", "Evidence:", "Regression test:", "Status:"].join("\n");
    expect(run([edit(), bash("pytest"), text(empty)]).probe_i).toMatchObject({ report: false, complete: false });
    const copy = ["DEBUG REPORT", "════", "Symptom:         [what the user observed]", "Root cause:      [what was actually wrong]", "Fix:             [what was changed, with file:line references]", "Evidence:        [test output, reproduction attempt showing fix works]", "Regression test: [file:line of the new test]", "Related:         [TODOS.md items]", "Status:          DONE | DONE_WITH_CONCERNS | BLOCKED"].join("\n");
    expect(run([edit(), bash("pytest"), text(copy)]).probe_i).toMatchObject({ report: true, fix_edited: false, status: false, complete: false });
  });
  test("labels in markdown, a table and on the next line count; the window is 40 lines", () => {
    const md = ["**DEBUG REPORT**", "- **Symptom:** wrong sum", "| Root cause | sign flipped |", "**Fix**: \x60src/calc.py:12\x60", "Evidence:", "  3 passed", "Regression test: tests/test_calc.py:5", "Status: **DONE_WITH_CONCERNS** flaky CI"].join("\n");
    expect(run([edit(), bash("pytest"), text(md)]).probe_i.complete).toBe(true);
    const far = ["DEBUG REPORT", ...Array(40).fill("filler"), "Symptom: x", "Root cause: y", "Fix: src/calc.py:1", "Evidence: e", "Regression test: t", "Status: DONE"].join("\n");
    expect(run([edit(), bash("pytest"), text(far)]).probe_i.report).toBe(false);
  });
  test("Status must be one listed value; Fix must name a path:line the session edited", () => {
    expect(run([edit(), bash("pytest"), text(report("src/calc.py:12", "NEEDS_CONTEXT"))]).probe_i.status).toBe(false);
    expect(run([edit(), bash("pytest"), text(report("src/other.py:3"))]).probe_i.fix_edited).toBe(false);
    expect(run([edit(), bash("pytest"), text(report("src/calc.py"))]).probe_i.fix_edited).toBe(false);
    expect(run([bash("sed -i 's/-/+/' src/calc.py"), bash("pytest"), text(report("calc.py:12"))]).probe_i.complete).toBe(true);
  });
  test("a report before the last edit, or a session with no edit, is incomplete", () => {
    expect(run([edit(), bash("pytest"), text(report()), edit()]).probe_i).toMatchObject({ report: false, complete: false });
    expect(run([bash("pytest"), text(report())]).probe_i).toMatchObject({ report: true, fix_edited: false, check_after_edit: false, complete: false });
  });
  test("an Edit whose result is an error edited nothing", () => {
    expect(run([edit(), bash("pytest"), tool("Edit", { file_path: "/testbed/src/calc.py", old_string: "x", new_string: "y" }, "String not found", true), text(report())]).probe_i.complete).toBe(true);
  });
  test("attack 2: edits through Bash after the last test end the check; writes outside the work tree do not", () => {
    for (const late of ["sed -i 's/a/b/' src/calc.py", "perl -pi -e 's/a/b/' src/calc.py", "echo x | tee src/calc.py", "echo x >> src/calc.py", "cat > src/new.py <<'EOF'\npytest\nEOF", "git apply <<'EOF'\n--- a/src/calc.py\n+++ b/src/calc.py\nEOF", "patch -p1 < fix.diff", "git checkout -- src/calc.py", "echo x>src/calc.py", "echo \"x\">>src/calc.py", "printf x 1>src/calc.py"]) {
      expect([late, run([edit(), bash("pytest"), bash(late), text(report())]).probe_i.check_after_edit]).toEqual([late, false]);
    }
    for (const harmless of ["pytest 2>&1 | tee /tmp/log.txt", "echo done > /dev/null", "cd /tmp && echo x > notes.txt", "cat src/calc.py"]) {
      expect([harmless, run([edit(), bash("pytest"), bash(harmless), text(report())]).probe_i.check_after_edit]).toEqual([harmless, true]);
    }
  });
  test("attack 2's measured gap: an interpreter one-liner that writes is no edit", () => {
    expect(run([edit(), bash("pytest"), bash("python -c \"open('src/calc.py','w').write('x')\""), text(report())]).probe_i.check_after_edit).toBe(true);
  });
  test("a test in the same line after an edit counts; one before it in that line does not", () => {
    expect(run([bash("sed -i 's/-/+/' src/calc.py && pytest -q"), text(report())]).probe_i.check_after_edit).toBe(true);
    expect(run([bash("pytest -q; sed -i 's/-/+/' src/calc.py"), text(report())]).probe_i.check_after_edit).toBe(false);
  });
  test("a subagent's edit arrives inline and counts in the order", () => {
    expect(run([edit(), bash("pytest"), tool("Agent", { prompt: "tidy", subagent_type: "general-purpose" }, "Async agent launched successfully."), edit("/testbed/src/util.py"), text(report())]).probe_i.check_after_edit).toBe(false);
  });
  test("fc#3: the exact failing call before the first edit, run again after the last edit, counts; a changed one does not", () => {
    const pre = bash("cd app && python repro.py", "Exit code 1\nAssertionError", true);
    expect(run([pre, edit("/testbed/app/calc.py"), bash("cd app && python repro.py", "ok"), text(report("app/calc.py:3"))]).probe_i.complete).toBe(true);
    expect(run([pre, edit("/testbed/app/calc.py"), bash("cd app  &&   python repro.py", "ok"), text(report("app/calc.py:3"))]).probe_i.check_after_edit).toBe(true);
    expect(run([pre, edit("/testbed/app/calc.py"), bash("cd app && python repro.py -v", "ok"), text(report("app/calc.py:3"))]).probe_i.check_after_edit).toBe(false);
    expect(run([pre, edit("/testbed/app/calc.py"), bash("cd app && pytest", "ok"), text(report("app/calc.py:3"))]).probe_i.check_after_edit).toBe(true);
    const passed = bash("cd app && python repro.py", "ok");
    expect(run([passed, edit("/testbed/app/calc.py"), bash("cd app && python repro.py", "ok"), text(report("app/calc.py:3"))]).probe_i.check_after_edit).toBe(false);
  });
});

describe("the runner and write lists", () => {
  test("runner list", () => {
    const yes = ["pytest", "py.test -x", "python3 -m pytest -q", "python -X dev -m unittest", "/usr/bin/python3.11 -m pytest", ".venv/bin/pytest", "tox -e py", "nox", "go test ./...", "cargo test", "npm test", "pnpm run test", "yarn test", "bun test", "npx jest", "npx vitest run", "jest", "vitest", "mocha", "mvn -q test", "mvn verify", "gradle test", "./gradlew :app:test", "dotnet test", "rspec", "bundle exec rspec", "rake test", "vendor/bin/phpunit", "mix test", "swift test", "make test", "make -C sub check", "ctest", "bash tests/run.sh", "sh ./test/check.sh"];
    const no = ["uv run pytest", "python repro.py", "npm run build", "make", "go build", "bash scripts/run.sh", "cargo build", "echo pytest"];
    for (const c of yes) expect([c, simpleCommands(c).some((s) => isTestRunner(s.words))]).toEqual([c, true]);
    for (const c of no) expect([c, simpleCommands(c).some((s) => isTestRunner(s.words))]).toEqual([c, false]);
  });
  test("cd, env prefixes, reserved words, subshells and sh -c unwrap; heredoc bodies are not commands", () => {
    for (const c of ["FOO=1 env -u X BAR=2 pytest", "(cd sub && tox)", "{ pytest; }", "bash -c 'pytest -x'", "time pytest", "if true; then pytest; fi"]) expect([c, simpleCommands(c).some((s) => isTestRunner(s.words))]).toEqual([c, true]);
    expect(simpleCommands("cat > t.py <<'EOF'\npytest\nEOF").some((s) => isTestRunner(s.words))).toBe(false);
    const [, py] = simpleCommands("cd app && python x.py > out.txt", "/testbed");
    expect(py!.cwd).toBe("/testbed/app");
    expect(writeTargets(py!, "/testbed")).toEqual(["/testbed/app/out.txt"]);
    expect(simpleCommands("echo a2>f.txt 2>err.txt", "/testbed")[0]).toMatchObject({ words: ["echo", "a2"], redirects: [{ op: ">", target: "f.txt" }, { op: "2>", target: "err.txt" }] });
    expect(simpleCommands("echo $((1>2)) x=\"a>b\"")[0]).toMatchObject({ words: ["echo", "$((1>2))", "x=a>b"], redirects: [] });
  });
});

describe("S13 background work at the first result", () => {
  const bg = (cmd = "sleep 99") => tool("Bash", { command: cmd, run_in_background: true }, "Command running in background with ID: b1.");
  test("a background launch with no notice is running; its notice ends it; work after the first result is not read", () => {
    expect(run([bg(), sys("TaskStartedMessage", "task_started"), result()]).background.at_result).toBe(true);
    expect(run([bg(), sys("TaskStartedMessage", "task_started"), sys("TaskNotificationMessage", "task_notification"), result()]).background.at_result).toBe(false);
    expect(run([bg(), sys("TaskStartedMessage", "task_started"), result(), sys("TaskNotificationMessage", "task_notification")]).background.at_result).toBe(true);
  });
  test("a log with no task records but a launch counts it running; a launch whose result is an error is no launch", () => {
    expect(run([bg(), result()]).background.at_result).toBe(true);
    expect(run([tool("Bash", { command: "sleep 9", run_in_background: true }, "Error", true), result()]).background).toMatchObject({ launches: 0, at_result: false });
  });
  test("a foreground task's start and notice net out, and a session with no background launch is never counted", () => {
    expect(run([bash("sleep 6"), sys("TaskStartedMessage", "task_started"), result()]).background.at_result).toBe(false);
    expect(run([tool("Agent", { prompt: "x" }, [{ type: "text", text: "Async agent launched successfully." }]), sys("TaskStartedMessage", "task_started"), result()]).background.at_result).toBe(true);
  });
  test("with no ResultMessage the end of the log is the result", () => {
    expect(run([bg(), sys("TaskStartedMessage", "task_started")]).background.at_result).toBe(true);
  });
});

describe("contract block, turn cap and the read audit", () => {
  test("the after pin's contract block text is seen; other Stop hook feedback is not", () => {
    expect(run([userText("Stop hook feedback:\nSKILL_CONTRACT_UNMET investigate (contract v1): missing debug-report. This blocks once.")]).contract_block).toBe(true);
    expect(run([userText("Stop hook feedback:\nsomething else")]).contract_block).toBe(false);
  });
  test("a turn-cap result is flagged", () => {
    expect(run([text("hi"), result("error_max_turns")]).turn_cap).toBe(true);
  });
  test("a none session that read an installed gstack file or a drive is hit; an empty listing or a failed read is not", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([tool("Read", { file_path: "/root/.claude/skills/gstack/SKILL.md" }, "1\tgstack")], none).audit_hits.length).toBe(1);
    expect(run([bash("cat ~/.local/share/gstack/README.md", "gstack")], none).audit_hits.length).toBe(1);
    expect(run([bash("ls ~/.capy/drive/user-x/", "AGENTS.md")], none).audit_hits.length).toBe(1);
    expect(run([bash("ls ~/.claude/skills/", "")], none).audit_hits).toEqual([]);
    expect(run([bash("echo ~/.claude/skills/investigate/SKILL.md", "/root/.claude/skills/investigate/SKILL.md")], none).audit_hits).toEqual([]);
    expect(run([bash("test -e ~/.gstack/x && printf '%s' ~/.gstack/x; cd ~/.capy/drive/u; pwd", "/root/.capy/drive/u")], none).audit_hits).toEqual([]);
    expect(run([bash("echo $(cat ~/.claude/skills/investigate/SKILL.md)", "body")], none).audit_hits.length).toBe(1);
    expect(run([bash("echo start; head -5 < ~/.local/share/gstack/VERSION", "start\n1.0")], none).audit_hits.length).toBe(1);
    expect(run([bash("python3 -c \"print(open('/root/.gstack/config.yaml').read())\"", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([tool("Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" }, "File does not exist.", true)], none).audit_hits).toEqual([]);
  });
  test("the read audit resolves relative reads after a cd and catches searches rooted at or above an audit root", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("cd /root/.claude/skills && cat investigate/SKILL.md", "---\nname: investigate")], none).audit_hits).toEqual(["Bash /root/.claude/skills/investigate/SKILL.md"]);
    expect(run([bash("cd ~/.capy/drive/u && cat AGENTS.md", "rules")], none).audit_hits.length).toBe(1);
    expect(run([bash("cat ../../root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([tool("Grep", { pattern: "name:", path: "/root/.claude/skills" }, "/root/.claude/skills/investigate/SKILL.md")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -rn 'name:' /root/.claude", "/root/.claude/skills/investigate/SKILL.md:2:name: investigate")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -rn 'def main' /", "/testbed/app.py:3:def main():")], none).audit_hits).toEqual([]);
    expect(run([bash("cat README.md src/app.py", "# app")], none).audit_hits).toEqual([]);
    expect(run([bash("cd ~ && cat .claude/skills/investigate/SKILL.md", "---\nname: investigate")], none).audit_hits.length).toBe(1);
    expect(run([bash("cd $HOME && cat .gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("(cd /root/.claude/skills && pwd); cat README.md", "/root/.claude/skills\n# app")], none).audit_hits).toEqual([]);
    expect(run([bash("cd /root && grep -n .gstack/config /testbed/README.md", "3:see .gstack/config")], none).audit_hits).toEqual([]);
    expect(run([bash("grep -n -A 2 /root/.gstack/config /testbed/README.md", "3:see /root/.gstack/config")], none).audit_hits).toEqual([]);
    expect(run([bash("grep -e name /root/.claude/skills/investigate/SKILL.md", "name: investigate")], none).audit_hits.length).toBe(1);
  });
  test("a grep -e pattern, a here-string body and a sed or awk script name no file the command reads", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("grep -e /root/.gstack/config /testbed/README.md", "3:see /root/.gstack/config")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -n --regexp=/root/.gstack/config README.md", "3:see /root/.gstack/config")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -ie /root/.claude/skills/investigate -e x README.md", "3:see /root/.claude/skills/investigate")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep gstack <<< \"/root/.gstack/config.yaml\"", "/root/.gstack/config.yaml")], none).audit_hits).toEqual([]);
    expect(run([bash("sed 's|/root/.gstack/x|y|' README.md", "# app")], none).audit_hits).toEqual([]);
    expect(run([bash("sed -n -e 's|/root/.gstack/x|y|p' README.md", "y")], none).audit_hits).toEqual([]);
    expect(run([bash("awk 'index($0, \"/root/.gstack/config\")' README.md", "see /root/.gstack/config")], none).audit_hits.length).toBe(1);
  });
  test("grep -f's file and the existing read shapes still count as reads", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("grep -f /root/.gstack/config.yaml /testbed/README.md", "3:x")], none).audit_hits).toEqual(["Bash /root/.gstack/config.yaml"]);
    expect(run([bash("grep -e x -f ~/.claude/skills/investigate/SKILL.md README.md", "3:x")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep name /root/.claude/skills/investigate/SKILL.md", "name: investigate")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed -n 1,5p /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed -e 's/a/b/' ~/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("awk '{print}' /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("awk -F: -v n=1 '{print $n}' /root/.gstack/config.yaml", "x")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep x < /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
  });
  test("a dropped pattern or script operand that substitutes a command is still scanned", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("grep -e \"$(cat /root/.gstack/config.yaml)\" README.md", "3:x")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep \"$(cat /root/.gstack/config.yaml)\" README.md", "3:x")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep --regexp=\"$(cat /root/.gstack/config.yaml)\" README.md", "3:x")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -e \x60cat /root/.gstack/config.yaml\x60 README.md", "3:x")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed \"$(cat /root/.gstack/s.sed)\" README.md", "# app")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -e /root/.gstack/config README.md", "3:see /root/.gstack/config")], none).audit_hits.length).toBe(1);
  });
  test("a here-string is skipped only for grep, egrep, fgrep and rg with a literal body", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("bash <<< 'cat /root/.gstack/config.yaml'", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("python3 <<< 'print(open(\"/root/.gstack/config.yaml\").read())'", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep x <<< \"$(cat /root/.gstack/config.yaml)\"", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep gstack <<< \"/root/.gstack/config.yaml\"", "/root/.gstack/config.yaml")], none).audit_hits).toEqual([]);
    expect(run([bash("rg gstack <<< /root/.gstack/config.yaml", "/root/.gstack/config.yaml")], none).audit_hits).toEqual([]);
  });
  test("a sed or awk script that reads, writes or runs something is scanned; a plain one is not", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("sed '1r /root/.gstack/config.yaml' README.md", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed -e '1r /root/.gstack/config.yaml' README.md", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed -n '/x/{R /root/.gstack/config.yaml\n}' README.md", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("awk 'BEGIN{while((getline l < \"/root/.gstack/config.yaml\")>0) print l}'", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("awk '{system(\"cat /root/.gstack/config.yaml\")}' README.md", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("awk 'BEGIN{while((\"cat /root/.gstack/config.yaml\" | getline l)>0) print l}'", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed 's|/root/.gstack/x|y|' README.md", "# app")], none).audit_hits).toEqual([]);
    expect(run([bash("sed -n -e 's|/root/.gstack/x|y|p' README.md", "y")], none).audit_hits).toEqual([]);
    expect(run([bash("awk 'index($0, \"/root/.gstack/config\")' README.md", "see /root/.gstack/config")], none).audit_hits.length).toBe(1);
  });
  test("a scanned sed script's protected paths are found as substrings, so a filename glued to r, R, w or W is caught", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    for (const cmd of ["sed '1r/root/.gstack/config.yaml' README.md", "sed '1R/root/.gstack/config.yaml' README.md", "sed -n '/x/w/root/.claude/skills/out' README.md", "sed -e '$W/root/.gstack/out' README.md", "sed 1r/root/.capy/drive/u/AGENTS.md README.md", "sed -n -e 's/a/b/' -e '2r/root/.local/share/gstack/VERSION' README.md"])
      expect(run([bash(cmd, "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed 's|/root/.gstack/x|y|' README.md", "# app")], none).audit_hits).toEqual([]);
    expect(run([bash("sed '1r/testbed/notes.txt' README.md", "notes")], none).audit_hits).toEqual([]);
  });
  test("$HOME glued to a sed word, gsed and busybox sed are read like sed; a sed address or a repo path holding root/.gstack is not a read of it", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    const hits = (cmd: string) => run([bash(cmd, "x: 1")], none).audit_hits.length;
    expect(['sed "1r$HOME/.gstack/config.yaml" README.md', 'sed -n "2r${HOME}/.claude/skills/x/SKILL.md" README.md', "gsed '1r/root/.gstack/config.yaml' README.md", "busybox sed '1r/root/.gstack/config.yaml' README.md", "/bin/busybox cat /root/.gstack/config.yaml", "sed 's/a/b/w/root/.gstack/out' README.md"].map(hits)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(["sed -n 1p src/root/.gstack/notes.txt", "sed '\\,/root/.gstack/x,d' README.md", 'cat "$HOMEDIR/x/root/.gstack/y"'].map(hits)).toEqual([0, 0, 0]);
  });
  test("sed -f glued to its file, command in front of a reader, find -exec or xargs over a gstack tree and ${HOME:-...} are reads; command -v, find without -exec and a bare echo are not", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    const hits = (cmd: string) => run([bash(cmd, "x: 1")], none).audit_hits.length;
    expect(["sed -f/root/.gstack/config.yaml README.md", "sed -nf/root/.gstack/config.yaml README.md", "command cat /root/.gstack/config.yaml", "command -p cat /root/.gstack/config.yaml", "find /root/.gstack -name '*.md' -exec cat {} +", "find /root/.claude/skills -execdir cat {} ';'",
      "echo /root/.gstack/config.yaml | xargs cat", "find /root/.gstack -type f -print0 | xargs -0 cat", "ls /root/.gstack | xargs cat", "sed -n p ${HOME:-/root}/.gstack/config.yaml", "cat ${HOME-/root}/.claude/skills/x/SKILL.md"].map(hits)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(["command -v cat", "find /root/.gstack -name '*.md'", "find / -name '*.md' -exec cat {} +", "find . -name '*.md' -exec cat {} +", "echo /root/.gstack/config.yaml", "sed -f script.sed README.md"].map(hits)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  test("a grep, rg, ag or ack option the table does not know, or a value it would misplace, scans the whole command", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    for (const cmd of ["grep --exclude-from /root/.gstack/ignore name README.md", "rg --ignore-file /root/.gstack/ignore name .", "rg --pre /root/.gstack/bin/x name README.md", "ag -D name /root/.gstack/config.yaml", "ag -A name /root/.gstack/config.yaml",
      "ack -A name /root/.gstack/config.yaml", "grep -Q /root/.gstack/config.yaml README.md", "grep --frobnicate /root/.gstack/config.yaml README.md", "rg --frob=1 /root/.gstack/config.yaml README.md", "grep -nA /root/.gstack/config.yaml README.md"])
      expect([cmd, run([bash(cmd, "3:x")], none).audit_hits.length]).toEqual([cmd, 1]);
    expect(run([bash("ag -g . /root/.gstack", "/root/.gstack/config.yaml")], none).audit_hits.length).toBe(1);
    expect(run([bash("ag -g SKILL /root/.claude/skills", "/root/.claude/skills/gstack/SKILL.md")], none).audit_hits.length).toBe(1);
    expect(run([bash("ag -G md /root/.gstack/config README.md", "3:see /root/.gstack/config")], none).audit_hits).toEqual([]);
    for (const cmd of ["grep -n -A 2 /root/.gstack/config README.md", "grep -nA2 /root/.gstack/config README.md", "grep -rn --include=*.py /root/.gstack/config .", "rg -n -t py /root/.gstack/config src", "rg -uu --glob=*.md -C3 /root/.gstack/config .", "ag -i /root/.gstack/config README.md", "egrep -c /root/.gstack/config README.md", "grep -- /root/.gstack/config README.md"])
      expect([cmd, run([bash(cmd, "3:see /root/.gstack/config")], none).audit_hits]).toEqual([cmd, []]);
    expect(run([bash("grep -i name -- /root/.gstack/config.yaml", "name: x")], none).audit_hits.length).toBe(1);
  });
  test("every awk script is scanned, and a sed script is dropped only when it is nothing but s commands with plain flags", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("awk 'BEGIN{system (\"cat /root/.gstack/config.yaml\")}'", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("awk 'BEGIN{ARGV[1]=\"/root/.gstack/config.yaml\"; ARGC=2} {print}'", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("gawk '@include \"/root/.gstack/lib.awk\"; BEGIN{x()}'", "x")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed 's/x/y/w /root/.gstack/out' README.md", "y")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed 's|^|cat /root/.gstack/config.yaml #|e' README.md", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed '/a/s|/root/.gstack/x|y|' README.md", "# app")], none).audit_hits.length).toBe(1);
    expect(run([bash("sed 's|/root/.gstack/x|y|' f", "# app")], none).audit_hits).toEqual([]);
    expect(run([bash("sed -E 's|/root/.gstack/x|y|gI; s/a/b/2' README.md", "# app")], none).audit_hits).toEqual([]);
  });
  test("an -e or --regexp after -- is a pattern or file operand, not an option", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("grep -- -e /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -rn -- -e /root/.gstack/config.yaml", "1:x")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep -n -- --regexp /root/.gstack/config.yaml", "1:x")], none).audit_hits.length).toBe(1);
    expect(run([bash("rg -- -e /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
  });
  test("a grep with any -e, -f or --regexp word is scanned whole, as at a452b49", () => {
    const none = { gstackRoots: [], investigatePrefix: null, home: "/root" };
    expect(run([bash("rg useState -tvue /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("rg TODO -tcmake /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
    expect(run([bash("grep TODO -drecurse /root/.gstack/config.yaml", "x: 1")], none).audit_hits.length).toBe(1);
  });
});
