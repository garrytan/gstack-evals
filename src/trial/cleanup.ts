// Removing a trial's work tree without throwing (U5 handoff; Captain brief item 7). Containers run as the evaluator's uid,
// but a step that ran as root, or an agent that dropped its own permissions, can leave files rmSync cannot remove. Cleanup
// first restores the owner's permissions, then removes; when that fails and an image is given, it removes the tree from a
// root container with no network; and it reports what is left instead of throwing.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface CleanupOptions {
  /** An image with rm, run as root with no network to remove what this user cannot. */
  image?: string | null;
  docker?: string;
  /** For tests: the removal step. */
  remove?: (path: string) => void;
}

const removeLocal = (path: string) => rmSync(path, { recursive: true, force: true });

/** Removes path and everything under it. Returns null when it is gone, or why it is still there; never throws. */
export function removeTree(path: string, options: CleanupOptions = {}): string | null {
  const target = resolve(path);
  const remove = options.remove ?? removeLocal;
  if (!existsSync(target)) return null;
  spawnSync("chmod", ["-R", "u+rwX", target], { stdio: "ignore" });
  let first: string;
  try {
    remove(target);
    if (!existsSync(target)) return null;
    first = "still present after removal";
  } catch (error) {
    first = (error as Error).message;
  }
  if (!options.image) return "could not remove " + target + ": " + first;
  const r = spawnSync(options.docker ?? "docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", dirname(target) + ":/cleanup", "--entrypoint", "rm", options.image, "-rf", "--", "/cleanup/" + basename(target)], { encoding: "utf8", timeout: 120_000 });
  try {
    if (existsSync(target)) remove(target);
  } catch {
    // reported below
  }
  if (!existsSync(target)) return null;
  return "could not remove " + target + ": " + first + "; the root cleanup container " + (r.status === 0 ? "left it" : "failed: " + (r.stderr || r.error?.message || "exit " + r.status).trim().split("\n").slice(-1)[0]);
}
