// Copyright (c) 2026 Garry Tan. MIT License.
// A unit's content digests (prereg section 15): the B commit and tree from its task bundle, the sha256 of every file under
// a restore/ folder, and the Dockerfile's sha256. Custody keeps them beside each unit's small sealed part, so a unit rebuilt
// from its public repository at the frozen commit is checked line by line against the unit that was screened. The lines
// keep the rebuild proof's format (CUSTODY.md, 2026-11-15): "B <commit> <tree>", then "R <sha256> <path>" sorted, then
// "D <sha256>" or "D missing". A symlink's digest is the sha256 of its target path, and a symlinked folder is not entered.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fail } from "../errors.ts";

const sha = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) fail("E_USAGE", "git " + args[0] + " failed on the unit's task bundle: " + (r.stderr ?? "").trim().slice(0, 200));
  return r.stdout;
}

function bundleLine(unit: string): string {
  const bundle = join(unit, "environment", "task.bundle");
  if (!existsSync(bundle)) fail("E_USAGE", "the unit has no environment/task.bundle");
  const bare = mkdtempSync(join(tmpdir(), "ep-digests-"));
  try {
    git(["init", "-q", "--bare"], bare);
    const commit = git(["bundle", "list-heads", bundle], bare).split(/\s+/)[0] ?? "";
    git(["fetch", "-q", bundle, "refs/heads/*:refs/heads/*"], bare);
    return "B " + commit + " " + git(["rev-parse", commit + "^{tree}"], bare).trim();
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
}

function restoreLines(unit: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, inRestore: boolean) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) {
        if (inRestore) out.push("R " + sha(readlinkSync(p, { encoding: "buffer" })) + " " + relative(unit, p));
      } else if (e.isDirectory()) walk(p, inRestore || e.name === "restore");
      else if (inRestore && e.isFile()) out.push("R " + sha(readFileSync(p)) + " " + relative(unit, p));
    }
  };
  walk(unit, false);
  return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

/** The unit folder's digest lines, in the rebuild proof's order. */
export function unitDigests(unitDir: string): string[] {
  const unit = resolve(unitDir);
  const dockerfile = join(unit, "environment", "Dockerfile");
  return [bundleLine(unit), ...restoreLines(unit), "D " + (existsSync(dockerfile) ? sha(readFileSync(dockerfile)) : "missing")];
}

export interface DigestCheck {
  /** Per kind (B, R, D): lines on either side, and lines on both. */
  kinds: Record<"B" | "R" | "D", { compared: number; matched: number }>;
  match: boolean;
}

/** A rebuilt unit's lines against the sealed ones: every line on both sides, and a B line present. */
export function compareDigests(sealed: readonly string[], rebuilt: readonly string[]): DigestCheck {
  const kinds = { B: { compared: 0, matched: 0 }, R: { compared: 0, matched: 0 }, D: { compared: 0, matched: 0 } };
  for (const k of ["B", "R", "D"] as const) {
    const a = new Set(sealed.filter((l) => l.startsWith(k + " ")));
    const b = new Set(rebuilt.filter((l) => l.startsWith(k + " ")));
    kinds[k].compared = new Set([...a, ...b]).size;
    kinds[k].matched = [...a].filter((l) => b.has(l)).length;
  }
  const match = kinds.B.matched > 0 && Object.values(kinds).every((x) => x.compared === x.matched);
  return { kinds, match };
}
