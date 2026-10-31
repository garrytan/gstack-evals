// Synthetic git sources for the review unit tests.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, tree } from "../../cli/helpers.ts";

/** A source clone: main with two commits, a PR branch off the first with two more, main moving on, a stray branch and a tag. */
export function sourceRepo(): { root: string; base: string; head: string; mergeBase: string } {
  const root = tree({ "src/a.ts": "export const a = 1;\n", "CLAUDE.md": "# Rules\n", ".gitignore": "node_modules/\n" });
  spawnSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  git(root, "config", "user.email", "eval@example.com");
  git(root, "config", "user.name", "eval");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "one");
  const mergeBase = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "-b", "feature");
  writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
  writeFileSync(join(root, "AGENTS.md"), "# Agents\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "two");
  tree({ ".gstack/config.json": "{}\n", "src/b.ts": "export const b = 1;\n" }, root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "three");
  const head = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, "src/c.ts"), "export const c = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "main moves");
  const base = git(root, "rev-parse", "HEAD");
  git(root, "tag", "v1");
  git(root, "checkout", "-q", "-b", "stray");
  writeFileSync(join(root, "src/d.ts"), "secret later fix\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "a later fix");
  git(root, "checkout", "-q", "main");
  return { root, base, head, mergeBase };
}
