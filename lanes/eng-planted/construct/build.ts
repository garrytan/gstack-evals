// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit construction (plan section 2): in the local mirror, B is a parentless root commit with a neutral
// author, date and message whose tree is P with the region's bodies stubbed and the test cases removed from every test
// file F changes; M is a commit on B whose tree is exactly P; F' is a commit on M whose tree equals F's. The unit is
// { base B, merge M, fixes [F'] } in eng-build's UnitSpec. Because B has no parent, P's real bodies never reach the unit
// repo's history. A construction failure is a drop with a reason. Prints nothing.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnitSpec } from "../../eng-build/unit.ts";
import { NEUTRAL, type MinedFix } from "./local.ts";
import { functionsOf, lngOf, parseErrors, removeTestCases, signatureOf } from "./region.ts";
import { stubFile } from "./stub.ts";

export interface Constructed {
  id: string;
  base: string;
  merge: string;
  fix: string;
  /** The removed body lines by product file, for the body check. */
  removed: { file: string; lines: string[] }[];
  /** Lines in the stubbed region: the body lines the stubs took out. */
  regionLines: number;
  /** The region's functions with their signatures as B declares them (rule 4's note). */
  signatures: { file: string; name: string; signature: string }[];
  /** Test files F changes: reduced to their helpers at B, or deleted when nothing else was left. */
  reduced: number;
  deleted: number;
}

export type Construction = { ok: true; unit: Constructed } | { ok: false; reason: string };

function gitIn(repo: string, args: string[], o: { input?: string; index?: string } = {}): string {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false", ...args], {
    cwd: repo,
    input: o.input,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(o.index ? { GIT_INDEX_FILE: o.index } : {}) },
  });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + (r.stderr ?? "").slice(0, 200));
  return r.stdout;
}

/** A commit object written directly, so its author, committer, date and message are the neutral ones and nothing reads
 * the machine's identity. */
export function neutralCommit(repo: string, tree: string, parent: string | null, message: string): string {
  const who = NEUTRAL.ident + " " + NEUTRAL.epoch + " +0000";
  const body = "tree " + tree + "\n" + (parent ? "parent " + parent + "\n" : "") + "author " + who + "\ncommitter " + who + "\n\n" + message + "\n";
  return gitIn(repo, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: body }).trim();
}

/** Builds B, M and F' for one mined fix in the mirror and records them under refs/ep/<id>/. */
export function construct(mirror: string, m: MinedFix): Construction {
  const show = (rev: string, path: string): string | null => {
    const r = spawnSync("git", ["show", rev + ":" + path], { cwd: mirror, encoding: "utf8", maxBuffer: 1 << 30 });
    return r.status === 0 ? r.stdout : null;
  };
  const scratch = mkdtempSync(join(tmpdir(), "ep-construct-"));
  const index = join(scratch, "index");
  try {
    gitIn(mirror, ["read-tree", m.parent], { index });
    const modes = new Map(gitIn(mirror, ["ls-tree", "-r", m.parent]).split("\n").filter(Boolean).map((l) => [l.slice(l.indexOf("\t") + 1), l.split(" ")[0]] as const));
    const put = (path: string, text: string) => {
      const oid = gitIn(mirror, ["hash-object", "-w", "--stdin"], { input: text }).trim();
      gitIn(mirror, ["update-index", "--add", "--cacheinfo", (modes.get(path) ?? "100644") + "," + oid + "," + path], { index });
    };
    const removed: Constructed["removed"] = [];
    const signatures: Constructed["signatures"] = [];
    const byFile = new Map<string, MinedFix["functions"]>();
    for (const f of m.functions) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
    for (const [file, want] of byFile) {
      const l = lngOf(file);
      const text = show(m.parent, file);
      if (!l || text === null) return { ok: false, reason: "region_file_missing" };
      const fns = functionsOf(l, text).filter((fn) => want.some((w) => w.name === fn.name && w.line === fn.sl + 1));
      if (fns.length !== want.length) return { ok: false, reason: "region_function_missing" };
      const s = stubFile(l, text, fns);
      if (!s) return { ok: false, reason: "stub_parse_error" };
      let out = s.text;
      if (m.testFiles.includes(file)) {
        const t = removeTestCases(l, out);
        if (t === null || parseErrors(l, t) > parseErrors(l, out)) return { ok: false, reason: "test_removal_parse_error" };
        out = t;
      }
      put(file, out);
      removed.push({ file, lines: s.removed });
      for (const fn of fns) signatures.push({ file, name: fn.name, signature: signatureOf(text, fn) });
    }
    let reduced = 0;
    let deleted = 0;
    for (const path of m.testFiles) {
      if (byFile.has(path) || !modes.has(path)) continue;
      const l = lngOf(path);
      const text = show(m.parent, path);
      const t = l && text !== null ? removeTestCases(l, text) : null;
      if (l && text !== null && t !== null && parseErrors(l, t) > parseErrors(l, text)) return { ok: false, reason: "test_removal_parse_error" };
      if (t === null) {
        gitIn(mirror, ["update-index", "--force-remove", path], { index });
        deleted++;
      } else {
        put(path, t);
        reduced++;
      }
    }
    const tree = gitIn(mirror, ["write-tree"], { index }).trim();
    const base = neutralCommit(mirror, tree, null, NEUTRAL.messages.base);
    const pTree = gitIn(mirror, ["rev-parse", m.parent + "^{tree}"]).trim();
    const fTree = gitIn(mirror, ["rev-parse", m.fix + "^{tree}"]).trim();
    if (pTree === tree) return { ok: false, reason: "base_equals_parent" };
    const merge = neutralCommit(mirror, pTree, base, NEUTRAL.messages.merge);
    const fix = neutralCommit(mirror, fTree, merge, NEUTRAL.messages.fix);
    for (const [k, v] of [["base", base], ["merge", merge], ["fix", fix]]) gitIn(mirror, ["update-ref", "refs/ep/" + m.id + "/" + k, v]);
    const regionLines = removed.reduce((n, r) => n + r.lines.length, 0);
    return { ok: true, unit: { id: m.id, base, merge, fix, removed, regionLines, signatures, reduced, deleted } };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The unit in eng-build's schema: { base B, merge M, fixes [F'] }. images pins the recipe tags by digest. */
export function unitSpec(m: MinedFix, c: Constructed, images: Record<string, string>, strictFrom: string): UnitSpec {
  return {
    id: m.id,
    repo: m.repo,
    set: "comparison",
    type: "devtools",
    keying: "first",
    mergedMonth: m.earliestPublic.slice(0, 7),
    strictWindow: m.earliestPublic.slice(0, 10) >= strictFrom,
    licence: m.licence,
    trust: "upstream",
    base: c.base,
    merge: c.merge,
    items: [{ item: "B1", kind: "B", commit: c.fix, mentioned: false, generic: false, foreseeable: null }],
    images,
  };
}
