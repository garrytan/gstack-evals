// Copyright (c) 2026 Garry Tan. MIT License.
// Fixture inputs for the wiring's dry-run cases and tests: a finished frame folder with one real git clone, and the
// small helpers that run a row through cli.ts's parser on a fake kit and capture what it prints.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../cli.ts";
import type { FileCheck } from "../frame/filecheck.ts";
import type { CloneRecord } from "../frame/run.ts";
import type { RowEnv } from "./start.ts";

export const scratch = (tag: string) => mkdtempSync(join(tmpdir(), "dc-wire-" + tag + "-"));

/** Runs one dc command on an environment and returns its exit code and every line it printed. */
export async function runRow(argv: string[], env: RowEnv): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(...t.split("\n")), err: (t) => err.push(...t.split("\n")) }, () => env);
  return { code, out, err };
}

const passing = (patterns: string[]): FileCheck => ({
  frontEnd: true,
  components: true,
  designSystem: true,
  routes: true,
  pass: true,
  frameworks: ["next"],
  componentFolder: { folder: "src/components", count: 12 },
  designSource: { kind: "tokens", file: "src/theme/tokens.css" },
  routeCount: patterns.length,
  routeSets: [{ router: "next-app", root: "", patterns, hash: false, basePath: null }],
});

/** A finished frame folder: n file-check passes (and one failure) in frame order, each on the same tiny clone. */
export function frameFixture(n: number): string {
  const dir = scratch("frame");
  const clone = join(dir, "clones", "app");
  mkdirSync(join(clone, "src"), { recursive: true });
  writeFileSync(join(clone, "src", "page.tsx"), "export default function Page() { return null; }\n");
  const g = (args: string[]) => spawnSync("git", args, { cwd: clone, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@invalid" } });
  g(["init", "-q"]);
  g(["add", "."]);
  g(["commit", "-qm", "fixture"]);
  const oid = g(["rev-parse", "HEAD"]).stdout.trim();
  const patterns = ["/(app)/tickets", "/projects", "/projects/[id]", "/settings"];
  const clones: CloneRecord[] = Array.from({ length: n + 1 }, (_, i) => ({ position: i + 1, nameWithOwner: "fixture/app-" + (i + 1), oid, fetched: true, reason: null, path: "clones/app" }));
  const checks = clones.map((c, i) => ({ position: c.position, nameWithOwner: c.nameWithOwner, check: i === 1 ? { ...passing(patterns), routes: false, pass: false } : passing(patterns) }));
  writeFileSync(join(dir, "clones.json"), JSON.stringify(clones));
  writeFileSync(join(dir, "filecheck.json"), JSON.stringify(checks));
  writeFileSync(join(dir, "run.json"), JSON.stringify({ kind: "dc frame" }));
  return dir;
}
