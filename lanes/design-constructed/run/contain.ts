// Copyright (c) 2026 Garry Tan. MIT License.
// C2, the per-unit containment check (plan section 7, R2-15): fail closed, E_DC_INFRA_MISSING, and no session runs.
// One shell script reads the exported repository and the mounts; it runs on the host and inside each container against
// its own mount, through the same Exec seam, so both places run the same check. The script prints labelled sections;
// a section missing, a command that exits non-zero, or an empty answer where one is expected fails the check. Nothing
// sealed enters a container: the container prints sha256 values and names, and the host compares them with key.json's
// and unit.json's. The key-statement print (8 consecutive normalized words of a key statement in a mounted file) runs
// on the host copy only and decides nothing.
// Order (BT): C2 runs at unit seal, before the first session in every container, and again after the gstack install
// in the two gstack arms. A failure re-exports the unit once; a second failure drops the unit before seal and holds it
// for the Captain after.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { HARNESS } from "../frozen.ts";
import { TREE_DIGEST_SH, type Manifest } from "./export.ts";
import type { Exec } from "./types.ts";

/** What C2 compares against: the unit's manifest, and the sha256 of key.json and unit.json (never their bytes). */
export interface C2Expect {
  manifest: Pick<Manifest, "commit" | "tree" | "branch" | "digest">;
  /** The tree the export computed apart from its own index: base tree less the strip plus the evidence. */
  expectedTree: string;
  sealedSha256: readonly string[];
}

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The one script, for a repository path and the mount paths, in the place it runs. */
export function c2Script(repo: string, mounts: readonly string[]): string {
  const g = "git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c safe.directory=*";
  const sec = (name: string, body: string) => "echo '@@" + name + "'\n" + body + "\necho \"@@exit " + name + " $?\"";
  return [
    "export LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null",
    "cd " + q(repo) + " || { echo '@@nocd'; exit 3; }",
    sec("commits", g + " rev-list --all"),
    sec("refs", g + " for-each-ref --format='%(refname) %(objectname)'"),
    sec("remotes", g + " remote"),
    sec("remote-config", g + " config --get-regexp '^remote\\.' ; [ $? -le 1 ]"),
    sec("reflog", "if [ -d .git/logs ]; then find .git/logs -type f -exec cat {} +; fi"),
    sec("hooks", "if [ -d .git/hooks ]; then find .git/hooks -mindepth 1; fi"),
    sec("special", "for f in .git/objects/info/alternates .git/shallow .git/info/grafts .git/refs/replace .git/refs/stash .git/logs/refs/stash; do [ -e \"$f\" ] && echo \"$f\"; done; true"),
    sec("fsck", g + " fsck --unreachable --no-reflogs --no-progress 2>&1"),
    sec("objects", g + " cat-file --batch-all-objects --batch-check='%(objectname)'"),
    sec("reachable", g + " rev-list --objects --all --no-object-names"),
    sec("tree", g + " rev-parse 'HEAD^{tree}'"),
    sec("head", g + " symbolic-ref HEAD"),
    sec("status", g + " status --porcelain --ignored --untracked-files=all"),
    sec("digest", "sh -c " + q(TREE_DIGEST_SH) + " sh . | sha256sum | cut -c1-64"),
    sec("mounts", mounts.map((m) => "if [ -e " + q(m) + " ]; then find " + q(m) + " -type f -exec sha256sum {} +; else echo 'missing " + m.replace(/'/g, "") + "'; fi").join("\n")),
    sec("names", mounts.map((m) => "[ -e " + q(m) + " ] && find " + q(m) + " \\( -name key.json -o -name unit.json \\) -print").join("\n") + "\ntrue"),
    "echo '@@end'",
  ].join("\n");
}

/** Splits the script's output into sections with their exit codes; null when the output is cut or out of shape. */
export function readSections(out: string): Map<string, { lines: string[]; exit: number }> | null {
  if (!out.includes("@@end")) return null;
  const map = new Map<string, { lines: string[]; exit: number }>();
  let current: string | null = null;
  let lines: string[] = [];
  for (const line of out.split("\n")) {
    const exit = /^@@exit (\S+) (\d+)$/.exec(line);
    if (exit) {
      if (exit[1] !== current) return null;
      map.set(current, { lines, exit: Number(exit[2]) });
      current = null;
      lines = [];
    } else if (line === "@@end") break;
    else if (/^@@[a-z-]+$/.test(line) && current === null) current = line.slice(2);
    else if (current !== null) lines.push(line);
  }
  return current === null ? map : null;
}

export const SECTIONS = ["commits", "refs", "remotes", "remote-config", "reflog", "hooks", "special", "fsck", "objects", "reachable", "tree", "head", "status", "digest", "mounts", "names"] as const;

/** C2's verdict on one run of the script: the problems found; an empty list passes. */
export function c2Problems(out: string, expect: C2Expect): string[] {
  const s = readSections(out);
  if (!s) return ["the check's output is cut or out of shape"];
  const problems: string[] = [];
  for (const name of SECTIONS) {
    const v = s.get(name);
    if (!v) problems.push("section " + name + " is missing");
    else if (v.exit !== 0) problems.push(name + " exited " + v.exit);
  }
  if (problems.length) return problems;
  const get = (n: string) => s.get(n)!.lines.filter((l) => l.trim() !== "");
  const m = expect.manifest;
  const commits = get("commits");
  if (commits.length !== 1 || commits[0] !== m.commit) problems.push("commits: expected exactly " + m.commit + ", found " + (commits.join(", ") || "none"));
  const refs = get("refs");
  if (refs.length !== 1 || refs[0] !== "refs/heads/" + m.branch + " " + m.commit) problems.push("refs: expected one branch at the commit and no tag, remote or stash, found " + (refs.join(", ") || "none"));
  if (get("remotes").length || get("remote-config").length) problems.push("a remote is configured");
  const reflog = get("reflog").filter((l) => !l.split(" ").slice(0, 2).every((x) => x === m.commit || /^0+$/.test(x)));
  if (reflog.length) problems.push("the reflog holds another commit");
  if (get("hooks").length) problems.push("hooks present: " + get("hooks").slice(0, 3).join(", "));
  if (get("special").length) problems.push("present: " + get("special").join(", "));
  const fsck = get("fsck").filter((l) => !/^Checking /.test(l));
  if (fsck.length) problems.push("git fsck: " + fsck.slice(0, 3).join("; "));
  const objects = new Set(get("objects"));
  const reachable = new Set(get("reachable"));
  if (!objects.size || objects.size !== reachable.size || [...objects].some((o) => !reachable.has(o))) problems.push("objects: " + objects.size + " stored, " + reachable.size + " reachable from the commit");
  const tree = get("tree")[0];
  if (tree !== m.tree || tree !== expect.expectedTree) problems.push("tree " + tree + " is not the expected tree " + expect.expectedTree);
  if (get("head")[0] !== "refs/heads/" + m.branch) problems.push("HEAD is not refs/heads/" + m.branch);
  if (get("status").length) problems.push("git status --porcelain --ignored: " + get("status").slice(0, 3).join("; "));
  if (get("digest")[0] !== m.digest) problems.push("the tree digest " + get("digest")[0] + " is not the manifest's " + m.digest);
  const mounts = get("mounts");
  if (!mounts.length) problems.push("the mount listing is empty");
  for (const l of mounts) {
    if (l.startsWith("missing ")) problems.push("mount " + l.slice(8) + " is missing");
    else if (expect.sealedSha256.includes(l.slice(0, 64))) problems.push("a mounted file has the bytes of a sealed file: " + l.slice(66));
  }
  for (const l of get("names")) problems.push("a sealed file name is mounted: " + l);
  return problems;
}

/** Runs C2 in one place (the host, or a container on its own mount). */
export async function runC2(exec: Exec, repo: string, mounts: readonly string[], expect: C2Expect): Promise<string[]> {
  const r = await exec(c2Script(repo, mounts));
  if (r.code !== 0) return ["the check exited " + r.code + ": " + r.stderr.trim().slice(0, 200)];
  return c2Problems(r.stdout, expect);
}

/** The mounts as each container sees them (prereg section 4). */
export const CONTAINER_MOUNTS: readonly string[] = HARNESS.mounts;

export type ContainPhase = "seal" | "before-session" | "after-install";
export interface ContainOutcome {
  status: "ok" | "dropped" | "held";
  exports: number;
  problems: string[][];
}

/**
 * One C2 point with its recovery: check; on a failure re-export once and check again; on a second failure drop the
 * unit (at seal, before it is sealed) or hold it for the Captain (after seal). check runs every place of this point:
 * the host and each container.
 */
export async function containPoint(phase: ContainPhase, check: () => Promise<string[]>, reexport: () => Promise<void>): Promise<ContainOutcome> {
  const first = await check();
  if (!first.length) return { status: "ok", exports: 0, problems: [] };
  await reexport();
  const second = await check();
  if (!second.length) return { status: "ok", exports: 1, problems: [first] };
  return { status: phase === "seal" ? "dropped" : "held", exports: 1, problems: [first, second] };
}

/** Lowercase words of letters and digits, the normalization the key-statement print reads (BT). */
export const words = (t: string): string[] => t.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];

/** Every mounted text file that holds 8 consecutive normalized words of a key statement, with the statement's index. */
export function keyStatementHits(statements: readonly string[], files: ReadonlyArray<{ path: string; text: string }>, n = 8): Array<{ path: string; statement: number }> {
  const grams = new Map<string, number>();
  statements.forEach((st, i) => {
    const w = words(st);
    for (let j = 0; j + n <= w.length; j++) grams.set(w.slice(j, j + n).join(" "), i);
  });
  const hits: Array<{ path: string; statement: number }> = [];
  for (const f of files) {
    const w = words(f.text);
    const seen = new Set<number>();
    for (let j = 0; j + n <= w.length; j++) {
      const i = grams.get(w.slice(j, j + n).join(" "));
      if (i !== undefined && !seen.has(i)) {
        seen.add(i);
        hits.push({ path: f.path, statement: i });
      }
    }
  }
  return hits;
}

/** The host copy's text files under a mount root, .git left out, files over 2 MB or holding NUL skipped (BT). */
export function mountedTexts(root: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir).sort()) {
      if (n === ".git") continue;
      const p = join(dir, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.size <= 2_000_000) {
        const b = readFileSync(p);
        if (!b.includes(0)) out.push({ path: p, text: b.toString("utf8") });
      }
    }
  };
  if (lstatSync(root).isFile()) out.push({ path: root, text: readFileSync(root, "utf8") });
  else walk(root);
  return out;
}

export const sha256Hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
