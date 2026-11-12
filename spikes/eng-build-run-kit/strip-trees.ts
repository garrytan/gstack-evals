// eng-build kit: apply the prereg strip rule (CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude at any depth) to build trees
// whose one base commit still holds a stripped name, then remake the one commit from a fresh .git (same date and message
// as buildUnitRepo), and check each with prepareTree. Prints counts only. usage: bun strip-trees.ts <trees dir> [review-units.json]
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { STRIP_NAMES, stripTree, prepareTree } from "../gstack-evals/lanes/eng-build/build-stage.ts";
const STRIP = new Set<string>(STRIP_NAMES);
const git = (dir: string, args: string[], input?: string) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", input, maxBuffer: 1 << 30, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + (r.stderr ?? "").slice(-200));
  return r.stdout;
};
const quotePath = (p: string) => (/^"|[\n\\"]/.test(p) ? JSON.stringify(p) : p);
const hit = (p: string) => p.split("/").some((seg) => STRIP.has(seg));
const root = process.argv[2]!;
let checked = 0, held = 0, removedPaths = 0, verified = 0;
const fixed: string[] = [];
for (const id of readdirSync(root).sort()) {
  const dir = join(root, id);
  checked++;
  const tracked = git(dir, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]).split("\0").filter(Boolean).filter(hit);
  if (tracked.length === 0) continue;
  held++;
  const date = git(dir, ["show", "-s", "--format=%ct", "HEAD"]).trim();
  const msg = git(dir, ["show", "-s", "--format=%B", "HEAD"]).replace(/\n+$/, "") + "\n";
  removedPaths += stripTree(dir).length;
  rmSync(join(dir, ".git"), { recursive: true, force: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A", "-f"]);
  const staged = git(dir, ["ls-files", "-s", "-z"]).split("\0").filter(Boolean).map((l) => {
    const [meta, path] = [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)];
    const [mode, sha] = meta.split(" ");
    return "M " + mode + " " + sha + " " + quotePath(path);
  });
  git(dir, ["fast-import", "--quiet"], "commit refs/heads/main\nauthor unit <unit@example.invalid> " + date + " +0000\ncommitter unit <unit@example.invalid> " + date + " +0000\ndata " + Buffer.byteLength(msg) + "\n" + msg + staged.join("\n") + "\ndone\n");
  git(dir, ["reset", "-q"]);
  git(dir, ["checkout", "-q", "main"]);
  prepareTree(dir);
  if (git(dir, ["status", "--porcelain"]).trim() === "" && git(dir, ["count-objects", "-v"]).includes("garbage: 0")) verified++;
  fixed.push(id);
}
console.log("trees checked=" + checked, "base commit held a stripped name=" + held, "paths removed=" + removedPaths, "remade and passed prepareTree with a clean status=" + verified);
if (process.argv[3]) {
  const ru = JSON.parse(readFileSync(process.argv[3], "utf8")) as any[];
  let refs = 0;
  const walk = (v: any): void => { if (typeof v === "string") { if (v.split(/[\s"'()\[\]]+/).some((t) => t.includes("/") || STRIP.has(t) ? hit(t) : false)) refs++; } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  for (const u of ru) if (fixed.includes(u.id)) walk(u.opening);
  console.log("review units among the remade trees=" + ru.filter((u) => fixed.includes(u.id)).length, "opening strings naming a stripped path=" + refs);
}
