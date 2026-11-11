// Copyright (c) 2026 Garry Tan. MIT License.
// The candidate screen of the eng-review build read (plan section 3, change 1): the supply probe's check, run on a mined
// candidate's fix or revert commits before any model call, so only candidates with a live aftermath case are keyed.
// Keyless: Docker and git only. Installs run with the network on; every test step runs with no network. Each candidate
// gets its own cache volumes, removed when it ends, and every container and volume carries the eb screen label, so a
// sweep (removeLabelled) clears whatever a dead run left. One run per tree: the build's 3-run rule settles flaky cases.
// Prints and returns counts only, never repository content.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, gitRun, showFile } from "../real-outcome/mine/git.ts";
import { docker } from "../real-outcome/task/docker.ts";
import { VERIFIER_DIR, type Runner } from "../real-outcome/task/format.ts";
import { splice } from "../real-outcome/task/region.ts";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { EbError } from "./errors.ts";
import { classifyLog, ecoOfFile, findProject, hasRecipe, isDepFile, parseScreen, recipeFor, runClasses, runnable, screenTest, verifierRunner, type Recipe } from "./recipes.ts";
import type { CaseClass, Ecosystem } from "./types.ts";
import { attributed, inScope, listing, scopesOf, testChanges } from "./unit.ts";

export const SCREEN_LABEL = "gstack-evals.eb=screen";

export interface Candidate {
  id: string;
  base: string;
  merge: string;
  fixes: { commit: string; kind: "fix" | "revert" }[];
}

export interface ScreenStep {
  step: string;
  exit: number;
  timed_out: boolean;
  secs: number;
  cls?: string;
  cases?: number;
}

export interface ScreenResult {
  id: string;
  qualifies: boolean;
  code: ReasonCode | null;
  step: string | null;
  cls: string | null;
  ecosystems: Ecosystem[];
  functionalPass: number;
  /** Fail-to-pass cases per fix commit, in the candidate's order. */
  f2p: number[];
  /** Outcomes on base with each qualifying fix's tests in place, summed. */
  base: { pass: number; fail: number; no_result: number };
  steps: ScreenStep[];
}

export interface ScreenOptions {
  /** Host scratch for the candidate's work tree; it is removed at the end. */
  work: string;
  installMinutes?: number;
  testMinutes?: number;
  cpus?: string;
  memory?: string;
}

const MAXF = 60;
const BASE_ENV = { HOME: "/tmp/home", CI: "true", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };

class Stop extends Error {
  constructor(
    readonly code: ReasonCode,
    readonly step: string,
    readonly cls: string,
  ) {
    super(code + " " + step + " " + cls);
  }
}

/** Screens one candidate. A drop returns its reason code, step and class; nothing about the repository's content. */
export function screenCandidate(c: Candidate, repo: string, o: ScreenOptions): ScreenResult {
  const res: ScreenResult = { id: c.id, qualifies: false, code: null, step: null, cls: null, ecosystems: [], functionalPass: 0, f2p: c.fixes.map(() => 0), base: { pass: 0, fail: 0, no_result: 0 }, steps: [] };
  const tag = "eb-screen-" + c.id.toLowerCase().replace(/[^a-z0-9_.-]/g, "-") + "-" + randomBytes(3).toString("hex");
  const wt = join(o.work, tag);
  const volumes = new Map<string, string>();
  let n = 0;
  const vol = (name: string) => {
    if (!volumes.has(name)) {
      const v = tag + "-" + name;
      docker(["volume", "create", "--label", SCREEN_LABEL, "--label", "gstack-evals.eb.unit=" + c.id, v]);
      volumes.set(name, v);
    }
    return volumes.get(name)!;
  };
  const run = (recipe: Recipe, image: string, script: string, network: boolean, step: string, minutes: number): ScreenStep => {
    const name = tag + "-" + ++n;
    const args = ["run", "--rm", "--name", name, "--label", SCREEN_LABEL, "--label", "gstack-evals.eb.unit=" + c.id, "--cpus", o.cpus ?? "1.3", "--memory", o.memory ?? "4g", "--memory-swap", o.memory ?? "4g", "--pids-limit", "8192", "--init", "-v", wt + ":/work", "-w", join("/work", recipe.root), "-v", vol("cache") + ":/cache"];
    for (const [v, path] of recipe.volumes) args.push("-v", vol(v) + ":" + path);
    for (const [k, v] of Object.entries({ ...BASE_ENV, ...recipe.env })) args.push("-e", k + "=" + v);
    if (!network) args.push("--network", "none");
    args.push(image, "sh", "-c", "umask 000; mkdir -p /tmp/home; " + script);
    const t0 = performance.now();
    const r = docker(args, { timeoutMs: minutes * 60000 });
    if (r.error) docker(["rm", "-f", name]);
    const st: ScreenStep = { step, exit: r.status, timed_out: r.timed_out, secs: Math.round((performance.now() - t0) / 1000) };
    if (r.status !== 0) st.cls = r.timed_out ? "timeout" : classifyLog(r.stdout + r.stderr);
    res.steps.push(st);
    return st;
  };
  const checkout = (sha: string) => {
    if (gitRun(wt, ["checkout", "-q", "-f", "--detach", sha]).status !== 0) throw new Stop("E_EB_IMAGE", "checkout", "checkout_failed");
    mkdirSync(join(wt, ".eb-out"), { recursive: true });
    copyFileSync(join(VERIFIER_DIR, "node-reporter.mjs"), join(wt, ".eb-out/node-reporter.mjs"));
  };
  const installed = new Map<string, { image: string; sig: string } | null>();
  const images = new Map<string, string | null>();
  const pull = (tags: string[]): string | null => {
    for (const t of tags) {
      if (!images.has(t)) images.set(t, docker(["image", "inspect", t]).status === 0 || docker(["pull", "-q", t], { timeoutMs: 900000 }).status === 0 ? t : null);
      if (images.get(t)) return t;
    }
    return null;
  };
  try {
    const own = testChanges(repo, c.base, c.merge);
    const fixes = c.fixes.map((f) => {
      const parent = git(repo, ["rev-parse", f.commit + "^1"]).trim();
      return { ...f, parent, tc: testChanges(repo, parent, f.commit) };
    });
    if (fixes.every((f) => f.tc.whole.length + f.tc.regions.length === 0)) throw new Stop("E_EB_NO_AFTERMATH", "fix", "no_test_change");
    const ecos = new Set<string>();
    const projectOf = (p: string, names: Set<string>) => {
      const eco = ecoOfFile(p);
      if (eco === null) return null;
      ecos.add(eco);
      if (!hasRecipe(eco) || !runnable(eco, p)) return null;
      const pr = findProject(eco, p, names);
      return pr ? { eco, ...pr } : null;
    };
    git(repo, ["worktree", "add", "-q", "--detach", "-f", wt, c.merge]);
    checkout(c.merge);

    /** Runs test files at the tree checked out now; returns every in-scope case's class. */
    const runFiles = (files: string[], rev: string, phase: string, want: string[] = []): Record<string, CaseClass> | null => {
      const names = new Set(listing(repo, rev).keys());
      const groups = new Map<string, { eco: Ecosystem; root: string; projdir: string; files: string[] }>();
      for (const f of files) {
        if (!names.has(f)) continue;
        const pr = projectOf(f, names);
        if (!pr) continue;
        const key = pr.eco + "|" + pr.root + "|" + pr.projdir;
        if (!groups.has(key)) groups.set(key, { eco: pr.eco, root: pr.root, projdir: pr.projdir, files: [] });
        groups.get(key)!.files.push(f);
      }
      if (groups.size === 0) return null;
      const out: Record<string, CaseClass> = {};
      let gi = 0;
      for (const g of groups.values()) {
        const fs = g.files.sort().slice(0, MAXF);
        const read = (p: string) => (existsSync(join(wt, p)) ? readFileSync(join(wt, p), "utf8") : null);
        const recipe = recipeFor(g.eco, read, g.root, names);
        const sig = JSON.stringify([...listing(repo, rev)].filter(([p]) => isDepFile(p) && (g.root === "" || p.startsWith(g.root + "/"))).sort());
        const key = g.eco + "|" + g.root;
        let inst = installed.get(key);
        if (inst === undefined || (inst && inst.sig !== sig)) {
          const image = pull(recipe.images);
          if (!image) throw new Stop("E_EB_IMAGE", phase + ":pull:" + g.eco, "image_pull_failed");
          const st = run(recipe, image, recipe.install("/work"), true, phase + ":install:" + g.eco, o.installMinutes ?? 12);
          inst = st.exit === 0 ? { image, sig } : null;
          installed.set(key, inst);
          if (!inst) throw new Stop("E_EB_IMAGE", phase + ":install:" + g.eco, st.cls ?? "other");
        }
        if (!inst) continue;
        let runner: Runner;
        try {
          runner = verifierRunner(c.id, recipe, g.projdir, fs.map((p) => ({ path: p, text: read(p) ?? "" })), read, read);
        } catch (error) {
          if (error instanceof EbError) throw new Stop(error.code, phase + ":runner", error.message.split("class=")[1]?.split(":")[0] ?? "runner");
          throw error;
        }
        const scopes = fs.flatMap((p) => scopesOf(runner, p, read(p) ?? "", g.projdir));
        const outTag = phase.replace(/[^A-Za-z0-9]/g, "_") + "-" + gi++;
        if (recipe.build && phase !== "install") run(recipe, inst.image, recipe.build("/work"), false, phase + ":build:" + g.eco, o.installMinutes ?? 12);
        const st = run(recipe, inst.image, screenTest(runner, fs, "/work/.eb-out/" + outTag), false, phase + ":test:" + g.eco, o.testMinutes ?? 12);
        const host = (suffix: string) => {
          const f = join(wt, ".eb-out", outTag + suffix);
          return existsSync(f) ? readFileSync(f, "utf8") : null;
        };
        const parsed = parseScreen(runner, host);
        const ids = [...new Set([...parsed.seen, ...Object.keys(parsed.results)])].filter((id) => inScope(runner.kind, id, scopes) && !(runner.kind === "go" && id.includes("/")));
        const wanted = want.filter((id) => inScope(runner.kind, id, scopes) && !ids.includes(id));
        Object.assign(out, runClasses(runner.kind, parsed, [...ids, ...wanted], { timed_out: st.timed_out }));
        st.cases = ids.length;
        if (ids.length === 0) st.cls = st.timed_out ? "timeout" : classifyLog((host(".log") ?? "") + (host(".err") ?? ""));
      }
      return out;
    };
    const overlay = (rev: string, tc: ReturnType<typeof testChanges>): string[] => {
      const added: string[] = [];
      for (const p of tc.deleted) rmSync(join(wt, p), { force: true });
      for (const p of tc.whole) {
        const text = Bun.spawnSync(["git", "cat-file", "blob", rev + ":" + p], { cwd: repo }).stdout as Buffer;
        if (!existsSync(join(wt, p))) added.push(p);
        mkdirSync(dirname(join(wt, p)), { recursive: true });
        writeFileSync(join(wt, p), text);
      }
      for (const p of tc.regions) {
        const tree = existsSync(join(wt, p)) ? readFileSync(join(wt, p), "utf8") : null;
        writeFileSync(join(wt, p), splice(p, tree, showFile(repo, rev, p)!));
      }
      return added;
    };
    const restoreTree = (sha: string, added: string[]) => {
      for (const p of added) rmSync(join(wt, p), { force: true });
      checkout(sha);
    };

    const ownFiles = [...own.whole, ...own.regions];
    const merged = runFiles(ownFiles, c.merge, "merged") ?? {};
    res.ecosystems = [...ecos].filter(hasRecipe).sort() as Ecosystem[];
    if (res.ecosystems.length === 0) throw new Stop("E_EB_NO_RECIPE", "recipe", [...ecos].sort().join(",") || "no_test_source");
    res.functionalPass = Object.values(merged).filter((x) => x === "pass").length;
    if (Object.values(merged).every((x) => x === "no_result" || x === "timeout")) throw new Stop("E_EB_IMAGE", "merged", "no_per_case_result");
    if (res.functionalPass === 0) throw new Stop("E_EB_IMAGE", "merged", "no_functional_pass");

    const live: { i: number; cases: string[]; files: string[]; fix: (typeof fixes)[number] }[] = [];
    for (const [i, f] of fixes.entries()) {
      const files = [...f.tc.whole, ...f.tc.regions];
      if (files.length === 0) continue;
      const atMerged = (() => {
        const added = overlay(f.commit, f.tc);
        try {
          return runFiles(files, f.commit, "mergedT" + i) ?? {};
        } finally {
          restoreTree(c.merge, added);
        }
      })();
      let atParent = atMerged;
      if (f.parent !== c.merge) {
        checkout(f.parent);
        const added = overlay(f.commit, f.tc);
        try {
          atParent = runFiles(files, f.commit, "parentT" + i) ?? {};
        } finally {
          restoreTree(f.parent, added);
        }
      }
      checkout(f.commit);
      const atFix = runFiles(files, f.commit, "fixed" + i) ?? {};
      checkout(c.merge);
      const att = attributed(repo, c.base, c.merge, f.commit);
      const cases = att.ofChange > 0 ? Object.keys(atFix).filter((id) => atFix[id] === "pass" && atMerged[id] === "assert" && atParent[id] === "assert") : [];
      res.f2p[i] = cases.length;
      if (cases.length) live.push({ i, cases, files, fix: f });
    }
    if (live.length === 0) throw new Stop("E_EB_NO_AFTERMATH", "aftermath", "no_fail_to_pass");

    checkout(c.base);
    const baseNames = [...listing(repo, c.base).keys()];
    const testAt = (p: string) => {
      const eco = ecoOfFile(p);
      return eco !== null && hasRecipe(eco) && runnable(eco, p);
    };
    const near = (keep: (p: string) => boolean) => baseNames.filter((p) => keep(p) && testAt(p)).sort().slice(0, MAXF);
    let baseOwn = ownFiles.filter((p) => baseNames.includes(p));
    if (baseOwn.length === 0) baseOwn = near((p) => ownFiles.some((q) => dirname(q) === dirname(p)));
    const atBase = baseOwn.length ? runFiles(baseOwn, c.base, "base") : null;
    for (const l of live) {
      const added = overlay(l.fix.commit, l.fix.tc);
      try {
        const r = runFiles(l.files, l.fix.commit, "baseT" + l.i, l.cases) ?? {};
        for (const id of l.cases) res.base[r[id] === "pass" ? "pass" : r[id] === undefined || r[id] === "no_result" || r[id] === "timeout" ? "no_result" : "fail"]++;
      } finally {
        restoreTree(c.base, added);
      }
    }
    if (!atBase || !Object.values(atBase).some((x) => x !== "no_result" && x !== "timeout")) throw new Stop("E_EB_IMAGE", "base", "no_per_case_result");
    res.qualifies = true;
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    res.code = error.code;
    res.step = error.step;
    res.cls = error.cls;
  } finally {
    if (existsSync(wt)) {
      const image = [...images.values()].find((x): x is string => !!x);
      if (image) docker(["run", "--rm", "--label", SCREEN_LABEL, "--network", "none", "-v", wt + ":/x", "--entrypoint", "sh", image, "-c", "rm -rf /x/* /x/.[!.]* 2>/dev/null; true"], { timeoutMs: 600000 });
      rmSync(wt, { recursive: true, force: true });
    }
    gitRun(repo, ["worktree", "prune"]);
    for (const v of volumes.values()) docker(["volume", "rm", "-f", v]);
  }
  return res;
}

/** Removes every container and volume the screen labelled, for a run that died before its own cleanup. */
export function removeLabelled(): { containers: number; volumes: number } {
  const ids = docker(["ps", "-aq", "--filter", "label=" + SCREEN_LABEL]).stdout.split("\n").filter(Boolean);
  if (ids.length) docker(["rm", "-f", ...ids]);
  const vols = docker(["volume", "ls", "-q", "--filter", "label=" + SCREEN_LABEL]).stdout.split("\n").filter(Boolean);
  if (vols.length) docker(["volume", "rm", "-f", ...vols]);
  return { containers: ids.length, volumes: vols.length };
}

/** A screen line for stdout: counts and classes only. */
export const screenLine = (r: ScreenResult): string =>
  [r.id, r.qualifies ? "qualifies" : "drop", r.code ?? "-", r.step ?? "-", r.cls ?? "-", "ecosystems=" + (r.ecosystems.join(",") || "-"), "functional_pass=" + r.functionalPass, "f2p=" + r.f2p.join(","), "base=" + r.base.pass + "/" + r.base.fail + "/" + r.base.no_result].join(" ");
