// Copyright (c) 2026 Garry Tan. MIT License.
// Fixture inputs for the wiring's dry-run cases and tests: a finished frame folder with one real git clone, a sessions
// launch's input folder, a stage 3 launch's input folder, and the small helpers that run a row through cli.ts's parser
// on a fake kit and capture what it prints. Everything is invented.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileCheck } from "../frame/filecheck.ts";
import type { CloneRecord } from "../frame/run.ts";
import { PLAN_BEFORE } from "../run/fixtures.ts";
import { makeRow, makeUnit } from "../score/fixtures.ts";
import { FIXTURE_RECIPE, unit as stage3Unit } from "../stage3/fixtures.ts";
import type { Arm, Model, SessionKind } from "../types.ts";
import { FAKE_TERMS_DIGEST, SERVED } from "./fakes.ts";
import type { PlannedCell } from "./sessions.ts";
import type { Stage3Input } from "./stage3.ts";
import type { RowEnv } from "./start.ts";

export const scratch = (tag: string) => mkdtempSync(join(tmpdir(), "dc-wire-" + tag + "-"));

/** Runs one dc command on an environment and returns its exit code and every line it printed. */
export async function runRow(argv: string[], env: RowEnv): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const { main } = await import("../cli.ts");
  const code = await main(argv, { out: (t) => out.push(...t.split("\n")), err: (t) => err.push(...t.split("\n")) }, () => env);
  return { code, out, err };
}

const gitInit = (dir: string, home: string) => {
  const g = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@invalid" } });
  g(["init", "-q"]);
  g(["add", "."]);
  g(["commit", "-qm", "fixture"]);
  return g;
};

/** The dated terms records for the OpenRouter models a launch names, on the fake served providers. */
export const fakeTerms = (models: readonly string[]) => models.filter((m) => SERVED[m as Model]).map((model) => ({ model, dated: "2026-11-13T00:00:00Z", provider: SERVED[model as Model]!, dataCollection: "deny", termsDigest: FAKE_TERMS_DIGEST }));

/** One unit's export folder as the session and stage 3 rows read it: repo/ with its evidence, plan.md and context/. */
function unitFolder(dir: string, id: string, evidence: readonly string[], git: boolean): void {
  const u = join(dir, id);
  for (const p of evidence) {
    mkdirSync(join(u, "repo", p, ".."), { recursive: true });
    writeFileSync(join(u, "repo", p), "# Notes\n\nCustomers asked for an orders view.\n");
  }
  mkdirSync(join(u, "repo", "src"), { recursive: true });
  writeFileSync(join(u, "repo", "src", "page.tsx"), "export default function Page() { return null; }\n");
  mkdirSync(join(u, "context"), { recursive: true });
  writeFileSync(join(u, "context", "project.md"), "# Project\n\nAn orders app.\n");
  writeFileSync(join(u, "plan.md"), PLAN_BEFORE);
  if (git) gitInit(join(u, "repo"), dir);
}

/** A sessions launch's inputs: cells.json, units.json, the exports and terms.json, and the argv for the row. */
export function sessionsFixture(o: { model: Model; stage: 1 | 2; cells: Array<{ unit: string; kind: SessionKind; pass?: number }>; rule8?: unknown; repair?: unknown }): { dir: string; sink: string; argv: string[] } {
  const dir = scratch("sessions");
  const ids = [...new Set(o.cells.map((c) => c.unit))];
  const units = ids.map((id) => makeUnit(id, { set: o.stage === 1 ? "calibration" : "comparison" }));
  for (const u of units) unitFolder(join(dir, "exports"), u.unit.id, u.evidence, false);
  const cells: PlannedCell[] = o.cells.map((c) => ({ unit: c.unit, kind: c.kind, model: o.model, pass: c.pass ?? 1 }));
  writeFileSync(join(dir, "cells.json"), JSON.stringify(cells));
  writeFileSync(join(dir, "units.json"), JSON.stringify(units));
  writeFileSync(join(dir, "terms.json"), JSON.stringify(fakeTerms([o.model])));
  const extra: string[] = [];
  if (o.rule8 !== undefined) {
    writeFileSync(join(dir, "rule8.json"), JSON.stringify(o.rule8));
    extra.push("--rule8", join(dir, "rule8.json"));
  }
  if (o.repair !== undefined) {
    writeFileSync(join(dir, "repair.json"), JSON.stringify(o.repair));
    extra.push("--repair", join(dir, "repair.json"));
  }
  const sink = join(dir, "sink");
  return { dir, sink, argv: ["sessions", "--stage", String(o.stage), "--model", o.model, "--cells", join(dir, "cells.json"), "--units", join(dir, "units.json"), "--exports", join(dir, "exports"), "--terms", join(dir, "terms.json"), ...extra, "--out", sink] };
}

const ARMS: readonly Arm[] = ["none", "lens", "plan-design-review", "autoplan"];

/** A stage 3 launch's inputs: n comparison units on n base apps, their exports as git repositories, stage 2's Opus rows. */
export function stage3Fixture(n: number, o: { pass1?: boolean } = {}): { dir: string; sink: string; argv: string[] } {
  const dir = scratch("stage3");
  const inputs: Stage3Input[] = Array.from({ length: n }, (_, i) => ({ unit: { ...stage3Unit(i + 1), set: "comparison" }, oracleBlock: "1. Show an empty state on the orders screen.", recipe: FIXTURE_RECIPE, routes: [...FIXTURE_RECIPE.routes] }));
  for (const c of inputs) unitFolder(join(dir, "exports"), c.unit.id, [], true);
  const rows = inputs.flatMap((c) => ARMS.map((arm) => makeRow(c.unit.id, arm, ["A change from the " + arm + " block."], { stage: 2, pass: o.pass1 === false ? 2 : 1 })));
  writeFileSync(join(dir, "stage3.json"), JSON.stringify(inputs));
  writeFileSync(join(dir, "rows.json"), JSON.stringify(rows));
  writeFileSync(join(dir, "terms.json"), JSON.stringify(fakeTerms(["opus", "sol", "astra", "argon"])));
  const sink = join(dir, "sink");
  return { dir, sink, argv: ["stage3", "--candidates", join(dir, "stage3.json"), "--exports", join(dir, "exports"), "--rows", join(dir, "rows.json"), "--terms", join(dir, "terms.json"), "--out", sink] };
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
