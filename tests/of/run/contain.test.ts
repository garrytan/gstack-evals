// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the work directory every session starts in (one empty commit, no remote, the state root ignored), the read audit that finds a gstack file in any tool call a session or its subagents made, and the containment probe's departure lines; fails_when=the work repo carries history or a remote, a gstack read through Bash, Glob or a subagent goes unseen, or an ordinary file read counts as one; why_new=the run area's containment; seam=workRepo, gstackReads, departures; no_claim=probing a real container, which the run seams do under GSTACK_EVALS_DOCKER=1
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { departures, gstackReads, workRepo } from "../../../lanes/office-hours-founder/run/contain.ts";

const root = mkdtempSync(join(tmpdir(), "of-contain-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (dir: string, ...args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }).stdout.trim();

describe("workRepo", () => {
  test("one empty commit, no remote, and the state root never shows as a change", () => {
    const dir = workRepo(join(root, "work", "idea"));
    expect(git(dir, "rev-list", "--all", "--count")).toBe("1");
    expect(git(dir, "remote")).toBe("");
    expect(git(dir, "ls-tree", "-r", "HEAD")).toBe("");
    mkdirSync(join(dir, ".gstack-home", "projects"), { recursive: true });
    writeFileSync(join(dir, ".gstack-home", "projects", "x.json"), "{}");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(dir, ".git", "info", "exclude"), "utf8")).toContain(".gstack-home/");
  });
});

const use = (name: string, input: Record<string, unknown>, parent: string | null = null) => JSON.stringify({ type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "tool_use", id: "t", name, input }] } });

describe("gstackReads", () => {
  test("Read, Glob, Grep and Bash calls that name gstack, subagents included", () => {
    const t = [
      use("Read", { file_path: "/root/.claude/skills/gstack/office-hours/SKILL.md" }),
      use("Bash", { command: "ls ~/.local/share/gstack" }, "toolu_sub"),
      use("Glob", { pattern: "**/GStack*" }),
      use("Grep", { pattern: "x", path: "/opt/gstack" }),
      use("Read", { file_path: "/work/idea/notes.md" }),
      use("Write", { file_path: "/work/idea/gstack.md", content: "x" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "gstack would say" }] } }),
      "not json",
    ].join("\n");
    expect(gstackReads(t)).toEqual(["Read /root/.claude/skills/gstack/office-hours/SKILL.md", "Bash ls ~/.local/share/gstack", "Glob **/GStack*", "Grep /opt/gstack"]);
  });

  test("a transcript with no gstack read is clean", () => {
    expect(gstackReads(use("Read", { file_path: "/work/idea/plan.md" }))).toEqual([]);
  });
});

describe("departures", () => {
  test("each kind of departure is one line, and a clean probe has none", () => {
    expect(departures({ container: "c", keys: [], mounts: [], egress: { open: false, detail: "refused" } })).toEqual([]);
    expect(departures({ container: "c", keys: ["OPENAI_API_KEY"], mounts: ["/srv"], egress: { open: true, detail: "connected to example.com" } })).toEqual(["env name OPENAI_API_KEY", "mount /srv", "open egress (connected to example.com)"]);
  });
});
