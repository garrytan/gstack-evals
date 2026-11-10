// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 2's neutral tree. The edit adds one comment line at the top of each non-test source file the fix
// changes (after a shebang, an encoding line or a PHP opening tag) and one at its end, from a frozen per-language table.
// Validation runs through the state machines runner: on the neutral tree with the fix's tests applied (the oracle's base
// patches), every fail-to-pass id must fail in all three runs and every stable id must pass in all three. If not, the
// end line alone is tried the same way; if that fails too, the unit drops (E_PF_NEUTRAL_INVALID).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dockerRun } from "../../real-outcome/task/docker.ts";
import { parsePatch } from "../statemachines/fixsplit.ts";
import { classify, type Lang } from "../statemachines/langs.ts";
import { basePatches } from "../statemachines/oracle.ts";
import { patchFiles } from "../statemachines/source.ts";
import { applyPatches, copyVolume, dropVolume, parseRun, passed, runName, runTests, type Mode, type RebuildRule } from "../statemachines/testrun.ts";
import type { SmUnit } from "../statemachines/unit.ts";
import { pfFail } from "./prereg.ts";

export const NEUTRAL_TEXT = "gstack-evals neutral line";
export const LINE_COMMENT: Record<Lang, string> = { rust: "//", java: "//", c: "//", cpp: "//", csharp: "//", go: "//", js: "//", ts: "//", python: "#" };
export type NeutralMode = "both" | "end";
export const MODES: readonly NeutralMode[] = ["both", "end"];
const ENCODING = /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/;

/** The edited text. Line endings follow the file (CRLF when it holds one). A file without a final newline gains one
 *  before the end line and keeps having none after it. */
export function neutralEdit(lang: Lang, text: string, mode: NeutralMode): string {
  const c = LINE_COMMENT[lang] + " " + NEUTRAL_TEXT;
  const crlf = text.includes("\r\n");
  const nl = crlf ? "\r\n" : "\n";
  let out = text;
  if (mode === "both") {
    const lines = text.split("\n");
    let at = 0;
    if (lines[0]!.startsWith("#!") && !lines[0]!.startsWith("#![")) at = 1;
    else if (lines[0]!.startsWith("<?php")) at = 1;
    if (at < 2 && lines[at] !== undefined && at < lines.length - 1 && ENCODING.test(lines[at]!)) at++;
    lines.splice(at, 0, c + (crlf ? "\r" : ""));
    out = lines.join("\n");
  }
  return out === "" || out.endsWith("\n") ? out + c + nl : out + nl + c;
}

/** The fix with its in-source test hunks left out: fix-source.patch when prep split the fix, else fix.patch, the same
 *  choice oracle.ts oneRun makes for its fixed runs. */
export const fixSourcePatch = (dir: string): string => readFileSync(join(dir, existsSync(join(dir, "fix-source.patch")) ? "fix-source.patch" : "fix.patch"), "latin1");
export const unitTestFiles = (dir: string): Set<string> => new Set(patchFiles(readFileSync(join(dir, "test.patch"), "utf8")));

/** The files the neutral edit touches: the non-test source files the fix changes that exist at base. */
export function neutralFiles(dir: string, lang: Lang): string[] {
  const tests = unitTestFiles(dir);
  return [...new Set(parsePatch(fixSourcePatch(dir)).filter((f) => f.oldPath !== null && classify(lang, f.oldPath, tests) === "source").map((f) => f.oldPath!))].sort();
}

/** The neutral edit as a patch over the given base texts (git diff --no-index; texts are read and written as latin1 so
 *  every byte survives). */
export function neutralPatch(lang: Lang, files: { path: string; text: string }[], mode: NeutralMode): string {
  const tmp = mkdtempSync(join(tmpdir(), "pf-neutral-"));
  try {
    for (const f of files)
      for (const [side, body] of [["a", f.text], ["b", neutralEdit(lang, f.text, mode)]] as const) {
        const p = join(tmp, side, f.path);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, body, "latin1");
      }
    const r = spawnSync("git", ["-c", "core.quotepath=off", "diff", "--no-index", "--no-prefix", "--no-color", "--no-ext-diff", "a", "b"], { cwd: tmp, encoding: "latin1", maxBuffer: 1 << 28 });
    if (r.status !== 1) pfFail("E_PF_INPUT", "git diff --no-index for the neutral patch exited " + r.status + ": " + (r.stderr ?? "").slice(-300));
    return r.stdout;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The validation rule over three runs' parsed results (null: the run built nothing or stopped). A stable test fails it
 *  when a run stopped, when a run reports it with any status but pass, or when no run reports it at all; a test the parser
 *  loses in one or two runs (another test's output inside its result line) does not. */
export function neutralOk(f2p: string[], stable: string[], runs: (Record<string, string> | null)[]): { ok: boolean; reason: string } {
  if (runs.length !== 3) return { ok: false, reason: "runs_" + runs.length };
  const rs = runs.map((r) => r ?? {});
  const f2pPassed = f2p.filter((id) => rs.some((r) => passed(r, id)));
  if (f2pPassed.length) return { ok: false, reason: "fail_to_pass_passed " + f2pPassed.slice(0, 10).join(",") };
  const stableFailed = stable.filter((id) => runs.some((r) => r === null || (r[id] !== undefined && !passed(r, id))) || !rs.some((r) => passed(r, id)));
  if (stableFailed.length) return { ok: false, reason: "stable_failed " + stableFailed.length + " " + stableFailed.slice(0, 10).join(",") };
  return { ok: true, reason: "ok" };
}

export interface NeutralRecord { schema: "pf-neutral.v1"; id: string; verdict: "kept" | "dropped"; mode: NeutralMode | null; files: string[]; tried: { mode: NeutralMode; ok: boolean; reason: string }[]; patch_sha256: string | null }

/** Tries the full edit, then the end line alone. run(patch, mode, n) is one run of the unit's commands on the neutral tree
 *  with the fix's tests applied. */
export function validateNeutral(id: string, lang: Lang, files: { path: string; text: string }[], f2p: string[], stable: string[], run: (patch: string, mode: NeutralMode, n: number) => Record<string, string> | null): { record: NeutralRecord; patch: string | null } {
  const record: NeutralRecord = { schema: "pf-neutral.v1", id, verdict: "dropped", mode: null, files: files.map((f) => f.path), tried: [], patch_sha256: null };
  if (!files.length) {
    record.tried.push({ mode: "both", ok: false, reason: "no_source_file" });
    return { record, patch: null };
  }
  for (const mode of MODES) {
    const patch = neutralPatch(lang, files, mode);
    const v = neutralOk(f2p, stable, [1, 2, 3].map((n) => run(patch, mode, n)));
    record.tried.push({ mode, ...v });
    if (v.ok) return { record: { ...record, verdict: "kept", mode, patch_sha256: createHash("sha256").update(patch, "latin1").digest("hex") }, patch };
  }
  return { record, patch: null };
}

/** Reads the base texts of files from a prepared tree volume (the state machines oracle's tree volume). */
export function volumeTexts(image: string, volume: string, repoDir: string, paths: string[]): { path: string; text: string }[] {
  if (!paths.length) return [];
  const script = 'cd "$1" && while IFS= read -r f; do printf "PF_FILE %s\\n" "$f"; base64 < "$f" | tr -d "\\n"; echo; done';
  const r = dockerRun(runName("pf-texts"), ["--rm", "-i", "--network", "none", "--user", "0:0", "-v", volume + ":" + repoDir + ":ro", "--entrypoint", "bash", image, "-c", script, "pf", repoDir], { timeoutMs: 600_000, input: paths.join("\n") + "\n" });
  const lines = r.stdout.split("\n");
  const out: { path: string; text: string }[] = [];
  for (let i = 0; i < lines.length - 1; i++) if (lines[i]!.startsWith("PF_FILE ")) out.push({ path: lines[i]!.slice(8), text: Buffer.from(lines[++i]!, "base64").toString("latin1") });
  if (r.status !== 0 || out.length !== paths.length) pfFail("E_PF_INPUT", "reading " + paths.length + " base files from " + volume + " failed: " + r.stderr.slice(-300));
  return out;
}

/** One neutral validation run in Docker: a fresh copy of the tree volume, the neutral patch and the oracle's base
 *  patches, the unit's commands under its rebuild rule, then the dataset parser. */
export function dockerNeutralRun(dir: string, u: SmUnit, image: string, volume: string, mode: Mode) {
  return (patch: string, nm: NeutralMode, n: number): Record<string, string> | null => {
    const copy = volume + "-pfn-" + nm + n + "-" + process.pid;
    copyVolume(image, volume, copy, mode);
    try {
      if (applyPatches(image, copy, u.repo_dir, [["neutral.patch", patch], ...basePatches(dir)], mode)) return null;
      const rule: RebuildRule = u.oracle?.rebuild_rule?.applies ? "applies" : "exempt";
      const label = u.id + "-neutral-" + nm + n;
      const t = runTests({ image, volume: copy, repoDir: u.repo_dir, workDir: u.work_dir, commands: u.commands, mode, label, rule });
      return t.stopped ? null : parseRun(t, readFileSync(join(dir, "parser.py"), "utf8"), label);
    } finally {
      dropVolume(copy);
    }
  };
}
