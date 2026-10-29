// Builders for CLI tests: temp trees, git repos and an Io that collects output.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Io } from "../../src/cli.ts";

export const TMP = mkdtempSync(join(tmpdir(), "u7-cli-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

export function tree(files: Record<string, string>, root = mkdtempSync(join(TMP, "t-"))): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

export function git(root: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}

/** Makes root a git repo with one commit of everything in it, and returns the commit. */
export function commitAll(root: string, message = "fixture"): string {
  spawnSync("git", ["-C", root, "init", "-q"]);
  git(root, "config", "user.email", "eval@example.com");
  git(root, "config", "user.name", "eval");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

export function collect(): Io & { text: () => { out: string; err: string } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out: (t) => out.push(t), err: (t) => err.push(t), text: () => ({ out: out.join("\n"), err: err.join("\n") }) };
}

/** A gstack-like checkout: <root>/<skill>/SKILL.md beside <root>/bin/gstack-skill-start. */
export const SKILL_MD = (name: string) => "---\nname: " + name + "\ndescription: d\n---\n\n# " + name + "\n\nRun ~/.claude/skills/gstack/bin/gstack-skill-start first.\nNEVER edit files the user did not name.\n";
export function gstackRoot(skill = "learn", extra: Record<string, string> = {}): string {
  return tree({ [skill + "/SKILL.md"]: SKILL_MD(skill), "bin/gstack-skill-start": "#!/bin/sh\n", ...extra });
}
