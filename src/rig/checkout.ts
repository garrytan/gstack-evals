// The tree a rig proof binds to (CI plan v5, U20): HEAD's commit and tree, and the tree of the working directory as it
// stands, uncommitted and untracked files included (.gitignore applies). Admission proves a committed tree, so it needs the
// two trees equal, and a lease checks that the checkout still runs the tree its admission record proves.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RIG_ROOT } from "./recipe.ts";

export interface Checkout {
  commit: string;
  head_tree: string;
  /** The working directory's tree, written through a scratch index so the checkout's own index is untouched. */
  tree: string;
}

export function checkout(root: string = RIG_ROOT): Checkout {
  const scratch = mkdtempSync(join(tmpdir(), "gse-tree-"));
  const git = (args: string[], env: Record<string, string | undefined> = process.env) => {
    const r = spawnSync("git", args, { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error("git " + args.join(" ") + " failed in " + root + ": " + (r.stderr || String(r.error ?? "")).trim());
    return r.stdout.trim();
  };
  try {
    const commit = git(["rev-parse", "--verify", "HEAD^{commit}"]);
    const head_tree = git(["rev-parse", "--verify", "HEAD^{tree}"]);
    const index = join(scratch, "index");
    const real = git(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    if (existsSync(real)) copyFileSync(real, index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(["add", "--all", "--", ":/"], env);
    return { commit, head_tree, tree: git(["write-tree"], env) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
