// Copyright (c) 2026 Garry Tan. MIT License.
// D2's live-session dry-run step, keyless: the stub model's cmds script, the reads and every assertion both ways.
import { describe, expect, test } from "bun:test";
import { scriptTurn } from "../../lanes/harness-mechanics/fake-model.ts";
import { PATH_PROBE, PATH_TASKS, pathProblems, readArm, type ArmRead, type PathTask } from "../../lanes/harness-mechanics/session-path.ts";

const [sq, hv] = PATH_TASKS as [PathTask, PathTask];
const IMG = "/opt/miniconda3/envs/testbed/bin:/opt/conda/envs/testbed/bin:/opt/conda/bin:/usr/local/bin:/usr/bin:/bin:/opt/laneb/bin";
const arm = (env: string, over: Partial<ArmRead> = {}): ArmRead => ({ path: IMG, bun: "/opt/laneb/bin/bun", pytest: env + "/pytest", python3: env + "/python3", hook_path: IMG, checks: null, ...over });
const told = (t: PathTask) => (t.checks === "run" ? "CHECK lint ENV 0.1s  ruff missing\nCHECK tests PASS 50.4s" : "CHECK tests python3 -m pytest  (pregate)");
const good = (t: PathTask): Record<string, ArmRead | null> => ({ none: arm(t.env), prose: arm(t.env, { checks: told(t) }), hook: arm(t.env, { checks: told(t) }) });

describe("D2's live-session step", () => {
  test("the two tasks: sqlglot-7479 on /opt/conda runs the loop, holoviews-6783 on miniconda runs detect", () => {
    expect([sq.task, sq.env, sq.checks]).toEqual(["tobymao__sqlglot-7479", "/opt/conda/envs/testbed/bin", "run"]);
    expect([hv.task, hv.env, hv.checks]).toEqual(["holoviz__holoviews-6783", "/opt/miniconda3/envs/testbed/bin", "detect"]);
  });
  test("a clean read passes on both tasks", () => {
    expect(pathProblems(sq, good(sq))).toEqual([]);
    expect(pathProblems(hv, good(hv))).toEqual([]);
  });
  test("each assertion fails on its own", () => {
    const bad = (t: PathTask, a: string, over: Partial<ArmRead>) => pathProblems(t, { ...good(t), [a]: { ...good(t)[a]!, ...over } });
    expect(bad(sq, "hook", { path: IMG.replace(":/opt/laneb/bin", ""), hook_path: IMG.replace(":/opt/laneb/bin", "") })).toEqual([sq.task + ": the Bash tool's PATH differs across none, prose and hook"]);
    expect(bad(sq, "prose", { hook_path: "/usr/bin:/bin" })).toEqual([sq.task + " prose: the hook's PATH is not the Bash tool's"]);
    expect(bad(sq, "none", { hook_path: null })).toEqual([sq.task + " none: the hook's PATH is not the Bash tool's"]);
    expect(bad(sq, "prose", { bun: "" })).toEqual([sq.task + " prose: bun is not found in the Bash tool"]);
    expect(bad(hv, "none", { pytest: "" })).toEqual([hv.task + " none: pytest is missing, not under " + hv.env]);
    expect(bad(hv, "hook", { python3: "/opt/miniconda3/bin/python3" })).toEqual([hv.task + " hook: python3 is /opt/miniconda3/bin/python3, not under " + hv.env]);
    expect(bad(sq, "hook", { checks: "env: 'bun': No such file or directory" })).toEqual([sq.task + " hook: gstack-checks did not start (env: 'bun': No such file or directory)"]);
    expect(bad(sq, "prose", { checks: "CHECK lint ENV 0.1s  ruff missing\nCHECK tests ENV 0.0s  not on PATH: pytest" })).toEqual([sq.task + " prose: the loop printed no CHECK tests PASS"]);
    expect(pathProblems(sq, { ...good(sq), prose: null })).toEqual([sq.task + " prose: no session read"]);
  });
  test("readArm takes the probe's lines and the gstack-checks output from the tool results", () => {
    const r = readArm({ toolu_hm_c0: "HM_PATH=" + IMG + "\nHM_BUN=/opt/laneb/bin/bun\nHM_PYTEST=/opt/conda/envs/testbed/bin/pytest\nHM_PYTHON3=/opt/conda/envs/testbed/bin/python3\n", toolu_hm_c2: "CHECK tests PASS 1.0s" }, IMG, "toolu_hm_c2");
    expect(r).toEqual({ path: IMG, bun: "/opt/laneb/bin/bun", pytest: "/opt/conda/envs/testbed/bin/pytest", python3: "/opt/conda/envs/testbed/bin/python3", hook_path: IMG, checks: "CHECK tests PASS 1.0s" });
    expect(readArm({ toolu_hm_c0: "HM_PATH=/x\nHM_BUN=\nHM_PYTEST=\nHM_PYTHON3=\n" }, null, null)).toEqual({ path: "/x", bun: "", pytest: "", python3: "", hook_path: null, checks: null });
  });
  test("the stub's cmds script runs each [hm-cmd] in order through the Bash tool, then stops", () => {
    const cmds = [PATH_PROBE, "echo '# hm d1 probe edit' >> 'sqlglot/diff.py'"];
    const first = { role: "user", content: "[hm-session path-1-prose] [hm-script cmds] " + cmds.map((c) => "[hm-cmd " + btoa(c) + "]").join(" ") + " Print PATH." };
    const reply = (id: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] });
    const t0 = scriptTurn({ messages: [first] });
    expect(t0).toEqual([{ type: "tool_use", id: "toolu_hm_c0", name: "Bash", input: { command: cmds[0], description: "hm cmd 0", timeout: 600000 } }]);
    const t1 = scriptTurn({ messages: [first, { role: "assistant", content: t0 }, reply("toolu_hm_c0")] });
    expect(t1[0]).toMatchObject({ id: "toolu_hm_c1", input: { command: cmds[1] } });
    const t2 = scriptTurn({ messages: [first, { role: "assistant", content: t0 }, reply("toolu_hm_c0"), { role: "assistant", content: t1 }, reply("toolu_hm_c1")] });
    expect(t2).toEqual([{ type: "text", text: "Ran the commands.\nSTATUS: DONE" }]);
  });
});
