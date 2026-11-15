// Copyright (c) 2026 Garry Tan. MIT License.
// The stages unit contract (lanes/eng-planted/stages/pipeline.ts unitFolders): each clean unit goes to
// <units>/<label>/ (the unit folder buildUnit wrote, with ep-unit.json, ep-author.json and ep-note.md beside eb.json) and
// its B tree to <repos>/<label>, a one-commit clone of the unit's task bundle. Unit and repository labels are minted from
// random bytes; the label map from label to candidate goes to custody, never into the repository.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { plantedNote } from "../../eng-build/note.ts";
import type { EbTask } from "../../eng-build/unit.ts";
import { listing } from "../../eng-build/unit.ts";
import { showFile } from "../../real-outcome/mine/git.ts";
import { isTestPath } from "../../real-outcome/mine/paths.ts";
import { BASE_BRANCH } from "../../real-outcome/task/format.ts";
import { FROZEN } from "../frozen.ts";
import type { AuthorMaterial, SourceFile } from "../stages/author.ts";
import type { PlantedUnit } from "../types.ts";
import type { Constructed } from "./build.ts";
import { starStratum, type MinedFix } from "./local.ts";

/** Held-out custody: each label's candidate, and each repository's label. */
export interface LabelMap {
  repos: Record<string, string>;
  units: Record<string, { candidate: string; repo: string; fix: string }>;
}

/** Callers in the author material: at most this many product files, each under this many bytes. */
export const CALLERS = { files: 5, bytes: 100_000 };

/** A label from random bytes, unique in the map. */
export function mintLabel(prefix: string, taken: (l: string) => boolean): string {
  for (;;) {
    const l = prefix + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
    if (!taken(l)) return l;
  }
}

const gitOut = (repo: string, args: string[]): string => {
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + (r.stderr ?? "").slice(0, 200));
  return r.stdout;
};

const filesAt = (mirror: string, rev: string, paths: string[]): SourceFile[] =>
  [...new Set(paths)].sort().flatMap((path) => {
    const text = showFile(mirror, rev, path);
    return text === null ? [] : [{ path, text }];
  });

/** The functional cases' test files at M: the id's path when it names a file, else (a Go package) the package's test
 * files that declare the test. */
function functionalFiles(mirror: string, merge: string, ids: string[]): string[] {
  const names = [...listing(mirror, merge).keys()];
  const out = new Set<string>();
  for (const id of ids) {
    const [path, ...rest] = id.split("::");
    if (names.includes(path)) {
      out.add(path);
      continue;
    }
    const test = rest.at(-1)?.split("/")[0] ?? "";
    for (const p of names.filter((n) => n.endsWith("_test.go") && (path === "." ? !n.includes("/") : n.startsWith(path + "/") && !n.slice(path.length + 1).includes("/"))))
      if (new RegExp("^func " + test.replace(/[^\w]/g, "") + "\\(", "m").test(showFile(mirror, merge, p) ?? "")) out.add(p);
  }
  return [...out];
}

/** Product files at B, outside the region files, that name a region function as a word. */
function callerFiles(mirror: string, base: string, c: Constructed): string[] {
  const region = new Set(c.signatures.map((s) => s.file));
  const fns = [...new Set(c.signatures.map((s) => s.name.split(".").at(-1)!).filter(Boolean))];
  if (!fns.length) return [];
  const r = spawnSync("git", ["grep", "-l", "-w", ...fns.flatMap((f) => ["-e", f]), base, "--"], { cwd: mirror, encoding: "utf8", maxBuffer: 1 << 30 });
  const sizes = new Map([...listing(mirror, base)].map(([p]) => [p, 0]));
  return (r.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(base.length + 1))
    .filter((p) => sizes.has(p) && !region.has(p) && !isTestPath(p) && (showFile(mirror, base, p)?.length ?? Infinity) < CALLERS.bytes)
    .sort()
    .slice(0, CALLERS.files);
}

/** Writes one clean unit in the stages contract and records its labels in the map. */
export function emitUnit(o: { mirror: string; fix: MinedFix; unit: Constructed; unitDir: string; units: string; repos: string; labels: LabelMap }): PlantedUnit {
  const { fix: m, unit: c } = o;
  const eb = JSON.parse(readFileSync(join(o.unitDir, "eb.json"), "utf8")) as EbTask;
  const id = mintLabel("u", (l) => l in o.labels.units);
  const repo = (o.labels.repos[m.repo] ??= mintLabel("r", (l) => Object.values(o.labels.repos).includes(l)));
  const planted = [...new Set(eb.unit.aftermath.flatMap((a) => a.cases))].sort();
  const crash = new Set(eb.planted?.crash ?? []);
  const u: PlantedUnit = {
    id,
    repo,
    set: "comparison",
    ecosystem: m.eco,
    stars: starStratum(m.stars),
    publicMonth: m.earliestPublic.slice(0, 7),
    strictWindow: m.earliestPublic.slice(0, 10) >= FROZEN.window.strictFrom,
    regionLines: c.regionLines,
    planted,
    plantedClass: Object.fromEntries(planted.map((p) => [p, crash.has(p) ? "crash" : "assert"])),
    functional: eb.unit.functional,
    foresee: null,
    winnable: null,
    hard: null,
    pilot: false,
  };
  const regionFiles = c.signatures.map((s) => s.file);
  const material: AuthorMaterial = {
    stubbed: filesAt(o.mirror, c.base, regionFiles),
    implementation: filesAt(o.mirror, c.merge, regionFiles),
    tests: filesAt(o.mirror, c.merge, functionalFiles(o.mirror, c.merge, u.functional)),
    callers: filesAt(o.mirror, c.base, callerFiles(o.mirror, c.base, c)),
    fix: { message: gitOut(o.mirror, ["log", "-1", "--format=%B", m.fix]).trim(), diff: gitOut(o.mirror, ["diff", m.parent, m.fix]) },
  };
  const dir = join(o.units, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(o.units, { recursive: true });
  cpSync(o.unitDir, dir, { recursive: true });
  writeFileSync(join(dir, "ep-unit.json"), JSON.stringify(u, null, 1) + "\n");
  writeFileSync(join(dir, "ep-author.json"), JSON.stringify(material, null, 1) + "\n");
  writeFileSync(join(dir, "ep-note.md"), plantedNote(c.signatures));
  const b = join(o.repos, id);
  rmSync(b, { recursive: true, force: true });
  mkdirSync(b, { recursive: true });
  const bundle = join(o.unitDir, "environment", "task.bundle");
  if (!existsSync(bundle)) throw new Error("the unit has no task bundle");
  gitOut(b, ["init", "-q", "-b", BASE_BRANCH]);
  gitOut(b, ["fetch", "-q", "--update-head-ok", bundle, "refs/heads/*:refs/heads/*"]);
  gitOut(b, ["reset", "-q", "--hard"]);
  if (gitOut(b, ["rev-list", "--count", "HEAD"]).trim() !== "1") throw new Error("the unit's B is not one commit");
  for (const f of ["logs", "FETCH_HEAD", "ORIG_HEAD"]) rmSync(join(b, ".git", f), { recursive: true, force: true });
  o.labels.units[id] = { candidate: m.id, repo: m.repo, fix: m.fix };
  return u;
}
