// Copyright (c) 2026 Garry Tan. MIT License.
// Units of the day-one eval (prereg sections 3 and 4). A unit is a folder in the sealed units dir, named by its label
// (minted from random bytes), and is decrypted into /dev/shm only for a run:
// - brief.md: the owner's first message as first written (a category 1 brief loses only its cut process line).
// - profile.md: the simulated owner's profile, for the responder only.
// - list.json (category 2): {"obvious", "tasks": [{"id", "rank", "task", "success", "data", "from", "support"}]}, the
//   hidden ranked list only the checker sees, and samples/ with the files tasks name in data.
// - checks.json (category 1): schema day-one.checks.v1, the items only the judge sees.
// - repo/ (category 1, optional): the codebase the real plan was written against, at its base commit.
// Planners get brief.md (a category 2 brief with the PLATFORM paragraph after a blank line) and, on review arms, the
// base plan as plan.md, in a fresh git repository with one commit. The builder gets plan.md alone. The checker's
// work dir is empty: the app, the browser and the samples live in the browser container (app.ts).
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pvUnitsDigest } from "../../src/trial/review/product-value.ts";
import { STATE_ROOT_DIR } from "../../src/trial/state-root.ts";
import { PLATFORM } from "./frozen.ts";

export interface Task {
  id: string;
  rank: number;
  task: string;
  success: string;
  data: string | null;
  from: "brief" | "implied";
  support: string;
}
export interface HiddenList {
  obvious: boolean;
  tasks: Task[];
}
export interface Check {
  id: string;
  kind: "complaint" | "ask";
  statement: string;
  covered_if: string;
  usable_if: string;
  from_brief: "stated" | "implied" | "not_foreseeable";
  rank: number;
  role: "primary" | "secondary";
}
export interface Unit {
  id: string;
  category: 1 | 2;
  dir: string;
  brief: string;
  profile: string;
  list: HiddenList | null;
  checks: Check[] | null;
  /** Sample file names under samples/ (category 2). */
  samples: string[];
  /** The codebase folder (category 1, optional). */
  repo: string | null;
}

export const UNIT_ID = /^[a-z0-9]{6,16}$/;

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Why a hidden list can't be scored, one line each. */
export function listProblems(l: any, samples: readonly string[]): string[] {
  const p: string[] = [];
  if (typeof l?.obvious !== "boolean") p.push("obvious is not a boolean");
  const tasks = Array.isArray(l?.tasks) ? l.tasks : null;
  if (!tasks || tasks.length < 5 || tasks.length > 8) return [...p, "tasks is not a list of 5 to 8"];
  tasks.forEach((t: any, i: number) => {
    const at = "task " + (i + 1);
    if (t?.id !== "t" + (i + 1)) p.push(at + ": id is " + JSON.stringify(t?.id) + ", not t" + (i + 1));
    if (t?.rank !== i + 1) p.push(at + ": rank is " + JSON.stringify(t?.rank) + ", not " + (i + 1));
    for (const k of ["task", "success", "support"]) if (!nonEmpty(t?.[k])) p.push(at + ": " + k + " is empty");
    if (t?.from !== "brief" && t?.from !== "implied") p.push(at + ": from is neither brief nor implied");
    if (t?.data !== null && !(nonEmpty(t?.data) && samples.includes(t.data.replace(/^samples\//, "")))) p.push(at + ": data names no file in samples/");
  });
  if (l?.obvious === true && tasks.some((t: any) => t?.from !== "brief")) p.push("an obvious unit holds an implied task");
  return p;
}

/** Why a checks file can't be judged, one line each. */
export function checksProblems(c: any): string[] {
  if (c?.schema !== "day-one.checks.v1" || !Array.isArray(c?.items) || !c.items.length) return ["checks.json is not a non-empty day-one.checks.v1 file"];
  const p: string[] = [];
  const ids = new Set<string>();
  for (const it of c.items) {
    if (!nonEmpty(it?.id) || ids.has(it.id)) p.push("an item has an empty or repeated id");
    ids.add(it?.id);
    for (const k of ["statement", "covered_if", "usable_if"]) if (!nonEmpty(it?.[k])) p.push((it?.id ?? "?") + ": " + k + " is empty");
    if (it?.role !== "primary" && it?.role !== "secondary") p.push((it?.id ?? "?") + ": role is neither primary nor secondary");
  }
  return p;
}

/** Loads one unit, or the reasons it can't run. */
export function loadUnit(unitsDir: string, id: string): { unit: Unit } | { problems: string[] } {
  if (!UNIT_ID.test(id)) return { problems: [id + ": a unit label is 6 to 16 lowercase letters and digits"] };
  const dir = join(unitsDir, id);
  const p: string[] = [];
  const text = (f: string) => {
    const st = lstatSync(join(dir, f), { throwIfNoEntry: false });
    if (!st?.isFile() || st.size === 0) {
      p.push(id + ": " + f + " is not a non-empty regular file");
      return "";
    }
    return readFileSync(join(dir, f), "utf8");
  };
  const brief = text("brief.md");
  const profile = text("profile.md");
  const hasList = existsSync(join(dir, "list.json"));
  const hasChecks = existsSync(join(dir, "checks.json"));
  if (hasList === hasChecks) p.push(id + ": a unit holds exactly one of list.json (category 2) and checks.json (category 1)");
  const samples = existsSync(join(dir, "samples")) ? readdirSync(join(dir, "samples")).filter((f) => lstatSync(join(dir, "samples", f)).isFile()).sort() : [];
  let list: HiddenList | null = null;
  let checks: Check[] | null = null;
  try {
    if (hasList) {
      const l = readJson(join(dir, "list.json"));
      p.push(...listProblems(l, samples).map((x) => id + ": list.json: " + x));
      list = l;
    }
    if (hasChecks) {
      const c = readJson(join(dir, "checks.json"));
      p.push(...checksProblems(c).map((x) => id + ": checks.json: " + x));
      checks = c.items;
    }
  } catch (e) {
    p.push(id + ": a JSON file does not parse (" + (e as Error).message + ")");
  }
  const repo = lstatSync(join(dir, "repo"), { throwIfNoEntry: false })?.isDirectory() ? join(dir, "repo") : null;
  if (repo && hasList) p.push(id + ": a category 2 unit holds no repo/");
  if (p.length) return { problems: p };
  return { unit: { id, category: hasList ? 2 : 1, dir, brief, profile, list, checks, samples, repo } };
}

/** brief.md as planners see it. */
export const briefText = (u: Pick<Unit, "category" | "brief">): string => (u.category === 2 ? u.brief.trimEnd() + "\n\n" + PLATFORM + "\n" : u.brief);

/** A fresh git repository at dir holding files (and the codebase first, when given), in one commit with no remote. */
export function seedRepo(dir: string, files: Readonly<Record<string, string>>, codebase: string | null = null): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (codebase) cpSync(codebase, dir, { recursive: true, verbatimSymlinks: true, filter: (src) => !src.split("/").includes(".git") });
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  const git = (args: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=owner", "-c", "user.email=owner@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "Start"]]) {
    const r = git(args);
    if (r.status !== 0) throw new Error("E_INTERNAL: git " + args[0] + " in the work repository failed: " + r.stderr.trim());
  }
  appendFileSync(join(dir, ".git", "info", "exclude"), STATE_ROOT_DIR + "/\n");
  const remotes = git(["remote"]).stdout.trim();
  if (remotes !== "") throw new Error("E_INTERNAL: the work repository has remotes " + JSON.stringify(remotes));
  return dir;
}

/** The planning seed: brief.md (and the codebase), plus the base plan on a review arm. */
export const planSeed = (u: Unit, dir: string, basePlan: string | null): string => seedRepo(dir, { "brief.md": briefText(u), ...(basePlan !== null ? { "plan.md": basePlan } : {}) }, u.repo);

/** The build seed: plan.md alone. */
export const buildSeed = (plan: string, dir: string): string => seedRepo(dir, { "plan.md": plan });

/** Copies a unit's samples into dest (emptied first), for the browser container's /samples. */
export function copySamples(u: Unit, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of u.samples) copyFileSync(join(u.dir, "samples", f), join(dest, f));
}

/** A category 2 list as judge checks (descriptive only): the top three tasks are primary. */
export const taskChecks = (l: HiddenList): Check[] =>
  [...l.tasks].sort((a, b) => a.rank - b.rank).map((t) => ({
    id: t.id,
    kind: "ask" as const,
    statement: t.task,
    covered_if: "Version 1 as planned lets the owner do this, so that: " + t.success,
    usable_if: "Version 1 as planned has it switched on and reachable when the owner first opens it, with no setup the owner must work out.",
    from_brief: t.from === "brief" ? ("stated" as const) : ("implied" as const),
    rank: t.rank,
    role: t.rank <= 3 ? ("primary" as const) : ("secondary" as const),
  }));

/** The units digest the prereg and every row check: pv's rule over every file of every unit, sealed files included. */
export const unitsDigest = (unitsDir: string, ids: readonly string[]) => pvUnitsDigest(unitsDir, ids);
