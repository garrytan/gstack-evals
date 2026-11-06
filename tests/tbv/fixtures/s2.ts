// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic fixtures for the tbv shape, splice and request tests: a tiny gstack-like repo with a setup script, a
// skill-start script, two skills and capy's three files; a local history render used until history/events.ts lands.
import { mock } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { History, HistoryEvent, Message, Shape } from "../../../lanes/tbv/types.ts";

export const STUB_CLAUDE = join(import.meta.dir, "stub-claude.ts");
export const PRE_CLOSER = "**Bounded closer.** After the work, report in a few short lines: what changed and what to watch.";

const write = (root: string, rel: string, text: string, exec = false) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
  if (exec) chmodSync(join(root, rel), 0o755);
};
const skill = (name: string, extra: string) =>
  [
    "---",
    "name: " + name,
    "description: " + (name === "ship" ? "Ship a branch through its checks." : "Find the root cause of a bug before fixing it."),
    "---",
    "## Shared preamble (load first)",
    "",
    "Read `~/.claude/skills/gstack/" + name + "/sections/preamble.md` in full before the command below." + extra,
    "",
    "## Preamble (run first)",
    "",
    "```bash",
    "~/.claude/skills/gstack/bin/gstack-skill-start --skill \"" + name + "\" --model \"claude\"",
    "```",
    "",
    "## Steps",
    "",
    "> **STOP.** Before a flaky test, Read `~/.claude/skills/gstack/" + name + "/sections/flake.md` and execute it.",
    "",
  ].join("\n");
const preamble = ["# Shared preamble", "", "**Evidence rule.** Back each claim with output you ran.", "", PRE_CLOSER, "", "Good closer: one line.", ""].join("\n");

/** A git repo shaped like gstack; pin is a clean tree, forbiddenPin adds org-rules wording, degradedPin a skill start that advises ./setup. */
export function makeGstack(root: string): { dir: string; pin: string; forbiddenPin: string; degradedPin: string } {
  const dir = join(root, "gstack-fixture");
  const gitconfig = join(root, "fixture.gitconfig");
  writeFileSync(gitconfig, "[user]\n\tname = tbv fixture\n\temail = fixture@example.invalid\n");
  const git = (...a: string[]) => {
    const r = spawnSync("git", a, { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1", HOME: root } });
    if (r.status !== 0) throw new Error("git " + a.join(" ") + ": " + r.stderr);
    return r.stdout.trim();
  };
  mkdirSync(dir, { recursive: true });
  git("init", "-q");
  write(dir, "setup", ['#!/bin/sh', "set -e", 'mkdir -p "$HOME/.claude/skills" "$HOME/.gstack"', 'ln -s "$HOME/.local/share/gstack" "$HOME/.claude/skills/gstack"', 'for s in investigate ship; do mkdir -p "$HOME/.claude/skills/$s"; ln -s "../gstack/$s/SKILL.md" "$HOME/.claude/skills/$s/SKILL.md"; done', "echo '{}' > \"$HOME/.claude/settings.json\"", 'echo seen > "$HOME/.gstack/.welcome-seen"', ""].join("\n"), true);
  const start = (extra: string) => ['#!/bin/sh', 'echo "SKILL_START_PROTO: ${SKILL_START_PROTO:-0}"', 'echo "SESSION_KIND: ${GSTACK_SESSION_KIND:-interactive}"', 'if [ -e "$HOME/.gstack" ]; then echo "STATE: used"; else echo "STATE: clean"; fi', extra, ""].join("\n");
  write(dir, "bin/gstack-skill-start", start(""), true);
  write(dir, "investigate/SKILL.md", skill("investigate", " Also Read `~/.claude/skills/gstack/investigate/sections/scope.md` before the command below."));
  write(dir, "investigate/sections/preamble.md", preamble);
  write(dir, "investigate/sections/scope.md", "# Scope\n\nStay inside the module you are debugging.\n");
  write(dir, "investigate/sections/flake.md", "# Flake\n\nRerun once.\n");
  write(dir, "ship/SKILL.md", skill("ship", ""));
  write(dir, "ship/sections/preamble.md", preamble);
  write(dir, "ship/sections/flake.md", "# Flake\n\nRerun once.\n");
  write(dir, "capy/skill/gstack/factory.md", "# Factory\n\nWork in small steps and report each one.\n");
  write(dir, "captain/templates/report.md", "# Report\n\nOutcome, then Unverified: what you did not check.\n");
  write(dir, "captain/templates/READY.md", "# READY\n\nHead, checks, review.\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  const pin = git("rev-parse", "HEAD");
  write(dir, "investigate/SKILL.md", skill("investigate", "").replace("Find the root cause of a bug before fixing it.", "Trust but verify, in every report."));
  git("commit", "-q", "-am", "forbidden");
  const forbiddenPin = git("rev-parse", "HEAD");
  git("checkout", "-q", pin);
  write(dir, "bin/gstack-skill-start", start('echo "Install looks stale: run ./setup or /gstack-upgrade."'), true);
  git("commit", "-q", "-am", "degraded");
  const degradedPin = git("rev-parse", "HEAD");
  git("checkout", "-q", pin);
  return { dir, pin, forbiddenPin, degradedPin };
}

/** Joins consecutive blocks of one role, starting with the user (what history/events.ts renderHistory does). */
export function localRender(h: History): Message[] {
  const out: Message[] = [];
  for (const e of h.events) {
    const [role, block] =
      e.kind === "user-text" ? (["user", { type: "text", text: e.text }] as const)
      : e.kind === "assistant-text" ? (["assistant", { type: "text", text: e.text }] as const)
      : e.kind === "tool-use" ? (["assistant", { type: "tool_use", id: e.id, name: e.name, input: e.input }] as const)
      : (["user", { type: "tool_result", tool_use_id: e.tool_use_id, content: e.content, is_error: e.is_error }] as const);
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block as never);
    else out.push({ role, content: [block as never] });
  }
  return out;
}

/** Until S1's renderHistory is built, tests run on the local render. */
export async function useLocalRenderIfNotBuilt(): Promise<void> {
  const path = join(import.meta.dir, "../../../lanes/tbv/history/events.ts");
  const real = await import(path);
  try {
    real.renderHistory(history([{ n: 1, kind: "user-text", text: "x" }]));
  } catch (e) {
    if ((e as { code?: string }).code !== "E_TBV_NOT_BUILT") throw e;
    const { historySha256, refuseOutsideRules } = real;
    mock.module(path, () => ({ historySha256, refuseOutsideRules, renderHistory: localRender }));
  }
}

export function history(events: HistoryEvent[], family: History["family"] = "investigate"): History {
  return { schema: "tbv-history.v1", source: "A", task: "task-01", cluster: "c1", family, events, sha256: "0".repeat(64), side: { files: [], resolved: null, patch: null } };
}
export const WORK: HistoryEvent[] = [
  { n: 1, kind: "user-text", text: "The parser drops the last row of a quoted file. Fix it." },
  { n: 2, kind: "assistant-text", text: "I will look at the parser." },
  { n: 3, kind: "tool-use", id: "toolu_w1", name: "Bash", input: { command: "bun test parser" } },
  { n: 4, kind: "tool-result", tool_use_id: "toolu_w1", content: "1 fail", is_error: false },
  { n: 5, kind: "assistant-text", text: "Fixed the off-by-one; the test passes." },
];
export const TURNS = { report: "I'm back. Where do things stand?", followup: "Please answer in text.", d1: "Show me the full list, one item per line.", d2: "Expand item 3 of your summary." };
export function shape(arm: Shape["arm"] = "none"): Shape {
  return {
    schema: "tbv-shape.v1",
    arm,
    pin: arm === "none" || arm === "lens" ? null : "a".repeat(40),
    claude_code: "2.1.312",
    system: [{ type: "text", text: "You are powered by the model named {{TBV_MODEL_NAME}}. The exact model ID is {{TBV_MODEL_ID}}.\nPrimary working directory: {{TBV_CWD}}\nToday's date is {{TBV_DATE}}." }],
    tools: [{ name: "Read", description: "Read a file.", input_schema: { type: "object" }, cache_control: { type: "ephemeral" } }],
    max_tokens: 64000,
    sha256: "1".repeat(64),
  };
}
