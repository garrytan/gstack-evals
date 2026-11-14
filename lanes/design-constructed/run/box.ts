// Copyright (c) 2026 Garry Tan. MIT License.
// A RunBox over local folders: run directories found by walking the given roots (a session's /work and HOME as this
// host sees them, or a sink copy), and the pinned gstack binaries run from a gstack checkout's bin folder. The Docker
// rig's box (docker.ts) runs the same reads inside the container; the hooks and detectors take either.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunFiles } from "./detect.ts";
import type { ExecResult, RunBox } from "./types.ts";

/** The runs among found run.json files: written at or after sinceMs, JSON with a string status, newest updated_at first. */
export function pickRuns(found: ReadonlyArray<{ dir: string; mtimeMs: number; text: string }>, sinceMs = 0): Array<{ dir: string; state: Record<string, unknown> }> {
  const out: Array<{ dir: string; state: Record<string, unknown>; at: string }> = [];
  for (const f of found) {
    if (f.mtimeMs < sinceMs) continue;
    try {
      const state = JSON.parse(f.text);
      if (state && typeof state === "object" && typeof state.status === "string") out.push({ dir: f.dir, state, at: String(state.updated_at ?? "") });
    } catch {}
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).map(({ dir, state }) => ({ dir, state }));
}

/** Every run.json under the roots (at most depth folders down, symlinks not followed), newest updated_at first. */
export function findRuns(roots: readonly string[], sinceMs = 0, depth = 10): Array<{ dir: string; state: Record<string, unknown> }> {
  const found: Array<{ dir: string; mtimeMs: number; text: string }> = [];
  const walk = (dir: string, d: number) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory() && d > 0 && n !== ".git" && n !== "node_modules") walk(p, d - 1);
      else if (st.isFile() && n === "run.json" && st.mtimeMs >= sinceMs) {
        try {
          found.push({ dir, mtimeMs: st.mtimeMs, text: readFileSync(p, "utf8") });
        } catch {}
      }
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r, depth);
  return pickRuns(found, sinceMs);
}

const readOrNull = (p: string): string | null => {
  try {
    return statSync(p).isFile() ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
};

/** A box on this host: roots to search, the pinned checkout's bin folder, and the env the binaries run with. */
export function localRunBox(o: { roots: readonly string[]; gstackBin: string; env: Record<string, string>; cwd: string }): RunBox {
  return {
    runs: (sinceMs) => findRuns(o.roots, sinceMs),
    read: readOrNull,
    gstack(bin, args): ExecResult {
      const r = spawnSync(join(o.gstackBin, bin), args, { cwd: o.cwd, env: o.env, encoding: "utf8", timeout: 120_000 });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
    },
  };
}

/** The autoplan detector's files over a box: every run under its roots, and gstack-artifact validate at the pin. */
export function runFilesOf(box: RunBox): RunFiles {
  return {
    runs: () => box.runs(0) as Array<{ dir: string; state: Record<string, any> }>,
    read: box.read,
    validate: (runJson) => {
      const r = box.gstack("gstack-artifact", ["validate", runJson]);
      return r.code === 0 && /^ARTIFACT_VALID: /m.test(r.stdout);
    },
  };
}
