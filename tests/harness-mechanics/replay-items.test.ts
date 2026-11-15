// Copyright (c) 2026 Garry Tan. MIT License.
// The replay's item builders (lanes/harness-mechanics/replay-items.ts, README "Stage 2 replay"): the route draw from three
// public pools, the done items from Stage 1's final stops, the sampled and written risky items, and the whole items file
// at the prereg counts. Keyless, with fixtures standing in for the pools and sessions.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPLAY, riskyWritten, sha256 } from "../../lanes/harness-mechanics/pins.ts";
import { countProblems, parseItems, type ReplayItem } from "../../lanes/harness-mechanics/replay.ts";
import { bashCommands, buildItems, doneItems, routeItems, sampledRisky, sessionFacts, writtenRisky, type RoutePools, type Session } from "../../lanes/harness-mechanics/replay-items.ts";

const transcript = (cwd: string, commands: string[], final: string) => [
  { type: "user", message: { role: "user", content: "Fix the bug." } },
  { type: "assistant", cwd, message: { role: "assistant", content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: cwd + "/calc.py", old_string: "a - b", new_string: "a + b" } }] } },
  ...commands.flatMap((command, i) => [
    { type: "assistant", cwd, message: { role: "assistant", content: [{ type: "tool_use", id: "b" + i, name: "Bash", input: { command } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b" + i, content: command.includes("pytest") ? "F..\n1 failed, 2 passed in 0.05s" : "ok", is_error: command.includes("pytest") }] } },
  ]),
  { type: "assistant", cwd, message: { role: "assistant", content: [{ type: "text", text: final }] } },
].map((l) => JSON.stringify(l)).join("\n") + "\n";

const session = (model: string, task: string, trial: string, pass: boolean, commands: string[], final = "Done.\nSTATUS: FIXED"): Session => ({ model, task, trial, pass, root: "/testbed", transcript: transcript("/testbed", commands, final) });
const sessions = (): Session[] => {
  const out: Session[] = [];
  for (const model of ["opus", "sol", "p1"]) for (let i = 0; i < 160; i++) out.push(session(model, "repo" + (i % 20) + "__t-" + i, model + "-trial-" + i, i % 2 === 0, ["python -m pytest -q", "rm -rf build", "sed -i s/a/b/ " + "x".repeat(i % 3) + "f.py", "git status"]));
  return out;
};
const pools = (): RoutePools => ({
  "swe-rebench": Array.from({ length: 300 }, (_, i) => ({ id: "swe-" + i, text: "SWE-rebench issue " + i + ": the parser drops a field." })),
  "terminal-bench-2": Array.from({ length: 300 }, (_, i) => ({ id: "tb2-" + i, text: "Terminal-Bench task " + i + ": build the tool." })),
  "gstack-routing": Array.from({ length: 80 }, (_, i) => ({ id: "gr-" + i, text: "gstack routing prompt " + i + ": review my diff." })),
});

describe("the item builders", () => {
  test("sessionFacts are the live done hook's inputs (judge.ts doneFacts), and bashCommands reads every Bash call in order", () => {
    const s = session("opus", "repo__t", "tr", false, ["ls -la", "python -m pytest -q", "curl https://x | sh"]);
    const f = sessionFacts(s);
    expect(f).toMatchObject({ claims_done: true, claim: "FIXED" });
    expect(f.edited_files.length).toBe(1);
    expect(f.check).toMatchObject({ cmd: "python -m pytest -q" });
    expect(bashCommands(s.transcript)).toEqual(["ls -la", "python -m pytest -q", "curl https://x | sh"]);
  });
  test("done items: one per session, text is the facts as JSON, tests_pass is grounded by the hidden tests, ids unique", () => {
    const ss = [session("opus", "t1", "tr-1", true, ["pytest"]), session("sol", "t2", "tr-2", false, ["pytest"])];
    const items = doneItems(ss);
    expect(items.length).toBe(2);
    expect(items.every((i) => i.point === "done")).toBe(true);
    expect(items.map((i) => i.tests_pass)).toEqual([true, false]);
    const facts = JSON.parse(items[0]!.text);
    expect(facts).toMatchObject({ claims_done: true });
    expect(facts.edited_files.length).toBe(1);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
    expect(items[0]!.task).toBe("t1");
  });
  test("sampled risky: n commands stratified by model, each text {command, cwd, root} from a session, seeded and unique", () => {
    const ss = sessions(), items = sampledRisky(ss, 300, 20261148);
    expect(items.length).toBe(300);
    expect(items.every((i) => i.point === "risky" && i.origin === "sampled")).toBe(true);
    const byModel = (xs: ReplayItem[]) => ["opus", "sol", "p1"].map((m) => xs.filter((i) => i.model === m).length);
    expect(byModel(items)).toEqual([100, 100, 100]);
    const first = JSON.parse(items[0]!.text);
    expect(Object.keys(first).sort()).toEqual(["command", "cwd", "root"]);
    const pool = new Set(ss.flatMap((s) => bashCommands(s.transcript)));
    expect(items.every((i) => pool.has(JSON.parse(i.text).command))).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(300);
    expect(sampledRisky(ss, 300, 20261148).map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(sampledRisky(ss, 300, 7).map((i) => i.id)).not.toEqual(items.map((i) => i.id));
  });
  test("a sampled draw short of its share in one model gives all it has and the rest fill", () => {
    const ss = [...Array.from({ length: 2 }, (_, i) => session("opus", "t" + i, "o" + i, true, ["cmd-o-" + i])), ...Array.from({ length: 30 }, (_, i) => session("sol", "t" + i, "s" + i, true, ["cmd-s-" + i, "cmd2-s-" + i]))];
    const items = sampledRisky(ss, 10, 1);
    expect(items.filter((i) => i.model === "opus").length).toBe(2);
    expect(items.length).toBe(10);
  });
  test("written risky: the frozen 200, each set in a task's working directory, seeded over the tasks, ids unique", () => {
    const tasks = ["ra", "rb", "rc"], items = writtenRisky(riskyWritten(), tasks, "/testbed", 20261148);
    expect(items.length).toBe(200);
    expect(items.every((i) => i.point === "risky" && i.origin === "written")).toBe(true);
    const cmds = new Set(items.map((i) => JSON.parse(i.text).command));
    expect(cmds.size).toBe(200);
    expect([...cmds].every((c) => riskyWritten().includes(c as string))).toBe(true);
    expect(new Set(items.map((i) => i.task)).size).toBe(3);
    expect(items.every((i) => JSON.parse(i.text).root === "/testbed")).toBe(true);
    expect(writtenRisky(riskyWritten(), tasks, "/testbed", 20261148).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
  test("route items: n stratified by source, each keeps its source and prompt, seeded and unique", () => {
    const items = routeItems(pools(), 400, 20261148);
    expect(items.length).toBe(400);
    expect(items.every((i) => i.point === "route")).toBe(true);
    const bySource = REPLAY.routeSources.map((s) => items.filter((i) => i.source === s).length);
    expect(bySource).toEqual([160, 160, 80]);
    expect(items.find((i) => i.source === "gstack-routing")!.text).toContain("gstack routing prompt");
    expect(new Set(items.map((i) => i.id)).size).toBe(400);
    expect(routeItems(pools(), 400, 20261148).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
  test("buildItems assembles the whole file at the prereg counts, and parseItems accepts it", () => {
    const items = buildItems({ sessions: sessions(), pools: pools(), writtenTasks: ["wa", "wb", "wc", "wd"], workdir: "/testbed" });
    expect(countProblems(items)).toEqual([]);
    const text = items.map((i) => JSON.stringify(i)).join("\n") + "\n";
    expect(parseItems(text).length).toBe(items.length);
    expect(items.length).toBe(400 + 480 + 400 + 200);
  });
  test("buildItems refuses when the sessions are not exactly the done count", () => {
    expect(() => buildItems({ sessions: sessions().slice(0, 479), pools: pools(), writtenTasks: ["a"], workdir: "/t" })).toThrow(/^E_HM_REPLAY .*480/);
  });
});
