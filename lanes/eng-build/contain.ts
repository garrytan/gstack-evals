// Copyright (c) 2026 Garry Tan. MIT License.
// The unit stage's containment gates (prereg 2026-11-11-geva-522, section 4). Before a unit reaches the pilot it passes
// three checks, each a keyless drop on failure with E_EB_LEAK and the unit id:
//   leak            the leak check on the exact session image a builder runs in (leak.ts sessionLeakCheck);
//   sidecar-origin  the sidecar's git origin, opened per unit with the build launcher's own trial spec, holds the base
//                   branch at base and nothing else: no tag or other ref, no commit outside base's history, no object
//                   beyond those reachable from base (loose and packed counted together) and nothing fsck calls
//                   unreachable;
//   sidecar-gh      the gh stub on that trial answers nothing about any pull request or issue in any state, through
//                   list, the REST paths and search.
// A git origin is where the last containment note found leaks, so the origin gate counts objects as well as refs.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSidecar, type TrialSpec } from "../real-outcome/sandbox/sidecar.ts";
import { prepareTree } from "./build-stage.ts";
import { EbError, fail } from "./errors.ts";
import { leakNeedles, sessionLeakCheck } from "./leak.ts";
import { readUnit, type Drop, type UnitSpec } from "./unit.ts";

/** The task.json the build launcher hands real_agent for a prepared build tree. */
export interface TrialTask {
  repo_dir: string;
  base_branch: string;
  base_commit: string;
  start_ref: string;
  kind: "K1";
  /** In-project dependency folders the session sees under /work/repo, relative to it, which the patch leaves out. */
  exclude?: string[];
}

const run = (args: string[]) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** The build launcher's task for a prepared tree: the tree's branch at its one commit, a K1 trial at /work/repo. */
export function trialTask(tree: string, exclude: string[] = []): TrialTask {
  const head = run(["-C", tree, "rev-parse", "HEAD"]).stdout.trim();
  const branch = run(["-C", tree, "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  return { repo_dir: "/work/repo", base_branch: branch, base_commit: head, start_ref: branch, kind: "K1", ...(exclude.length ? { exclude } : {}) };
}

/** The trial spec real_agent posts to the sidecar for a task (real_agent.py _open_sandbox, with its option defaults). */
export function trialSpec(task: TrialTask, trial: string, bundle: string, agentIp: string): TrialSpec {
  return { trial, repo: "sandbox/repo", kind: task.kind, base_branch: task.base_branch, base_commit: task.base_commit, start_ref: task.start_ref, bundle, agent_ip: agentIp, repo_dir: task.repo_dir, feature_branch: "feature" };
}

/** The origin gate: the class of the first check that fails, or null. */
export function originGate(origin: string, task: Pick<TrialTask, "base_branch" | "base_commit">): string | null {
  const g = (args: string[]) => {
    const r = run(["--git-dir", origin, ...args]);
    return r.status === 0 ? r.stdout : null;
  };
  const refs = g(["for-each-ref", "--format=%(refname) %(objectname)"]);
  if (refs === null) return "git_failed";
  const lines = refs.split("\n").filter(Boolean);
  if (lines.some((l) => l.startsWith("refs/tags/"))) return "tag";
  if (lines.length !== 1 || lines[0] !== "refs/heads/" + task.base_branch + " " + task.base_commit) return "extra_ref";
  const all = g(["rev-list", "--all"]);
  const own = g(["rev-list", task.base_commit]);
  if (all === null || own === null) return "git_failed";
  if (all !== own) return "history";
  const fsck = g(["fsck", "--unreachable", "--no-reflogs", "--no-progress"]);
  if (fsck === null) return "fsck_failed";
  if (fsck.split("\n").some((l) => l.startsWith("unreachable "))) return "unreachable";
  const counts = g(["count-objects", "-v"]);
  const reach = g(["rev-list", "--objects", task.base_commit]);
  if (counts === null || reach === null) return "git_failed";
  const field = (k: string) => Number(new RegExp("^" + k + ": (\\d+)$", "m").exec(counts)?.[1] ?? NaN);
  if (field("garbage") !== 0 || field("count") + field("in-pack") !== reach.split("\n").filter(Boolean).length) return "object_count";
  return null;
}

export interface GhAnswer {
  stdout: string;
  stderr?: string;
  exit: number;
}
export type Gh = (argv: string[]) => Promise<GhAnswer>;

/** The gh queries the gh gate asks: pull requests and issues in every state, the REST paths and search. */
export const ghQueries = (repo: string): [string, string[]][] => [
  ...["open", "closed", "merged", "all"].map((s): [string, string[]] => ["pr_" + s, ["pr", "list", "--state", s, "--json", "number,title"]]),
  ...["open", "closed", "all"].map((s): [string, string[]] => ["issue_" + s, ["issue", "list", "--state", s, "--json", "number,title"]]),
  ["api_pulls", ["api", "repos/" + repo + "/pulls?state=all"]],
  ["api_issues", ["api", "repos/" + repo + "/issues?state=all"]],
  ["pr_search", ["pr", "list", "--state", "all", "--search", "is:pr", "--json", "number,title"]],
  ["search_prs", ["search", "prs", "--repo", repo, "--json", "number,title"]],
  ["search_issues", ["search", "issues", "--repo", repo, "--json", "number,title"]],
];

/** The gh gate: the label of the first query whose answer is not empty, gh_refused when the stub never answered the
 * plain listing of every pull request, or null. */
export async function ghGate(gh: Gh, repo: string): Promise<string | null> {
  let live = false;
  for (const [label, argv] of ghQueries(repo)) {
    const a = await gh(argv);
    const out = (a.stdout ?? "").trim();
    if (out !== "" && out !== "[]") return label;
    if (label === "pr_all" && a.exit === 0 && out === "[]") live = true;
  }
  return live ? null : "gh_refused";
}

const leakDrop = (cls: string, step: string): Drop => ({ code: "E_EB_LEAK", step, cls, cases: 0 });

/**
 * Opens the sidecar for a build tree the way a build session does (the tree copied and prepared as the launcher
 * prepares it, its base branch bundled, the launcher's trial spec posted to the control plane) and runs the origin and
 * gh gates on that trial. tamper runs between the opening and the gates, for the dry run's negative cases.
 */
export async function sidecarGates(o: { tree: string; tamper?: (t: { origin: string; gh: Gh }) => void | Promise<void> }): Promise<Drop[]> {
  const root = mkdtempSync(join(tmpdir(), "eb-contain-"));
  const sc = startSidecar({ root: join(root, "sidecar"), agentHost: "127.0.0.1", agentPort: 0, controlPort: 0 });
  try {
    const work = join(root, "repo");
    cpSync(o.tree, work, { recursive: true });
    prepareTree(work);
    const task = trialTask(work);
    const bundle = join(root, "base.bundle");
    const b = run(["-C", work, "bundle", "create", bundle, "refs/heads/" + task.base_branch]);
    if (b.status !== 0) fail("E_USAGE", o.tree + ": could not bundle the base branch (" + b.stderr.trim().slice(-300) + ")");
    const trial = "eb-contain-" + randomBytes(4).toString("hex");
    const res = await fetch(sc.controlUrl + "/trials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(trialSpec(task, trial, bundle, "127.0.0.1")) });
    const opened = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !opened.token) fail("E_USAGE", o.tree + ": the sidecar refused the trial (" + (opened.error ?? res.status) + ")");
    const gh: Gh = async (argv) => {
      const r = await fetch(sc.agentUrl + "/gh", { method: "POST", headers: { authorization: "Bearer " + opened.token, "content-type": "application/json" }, body: JSON.stringify({ argv, branch: task.base_branch }) });
      return (await r.json()) as GhAnswer;
    };
    const origin = join(root, "sidecar", trial, "origin.git");
    await o.tamper?.({ origin, gh });
    const drops: Drop[] = [];
    const oc = originGate(origin, task);
    if (oc) drops.push(leakDrop(oc, "sidecar-origin"));
    const gc = await ghGate(gh, "sandbox/repo");
    if (gc) drops.push(leakDrop(gc, "sidecar-gh"));
    await fetch(sc.controlUrl + "/trials/" + trial + "/close", { method: "POST", body: JSON.stringify({ reason: "contain_check" }) }).catch(() => undefined);
    return drops;
  } finally {
    sc.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Every containment gate for one built unit: the leak check on its session image, then the sidecar gates on its build
 * tree at <trees>/<id>. Returns the drops; an empty list passes. */
export async function containUnit(o: { dir: string; repo: string; spec: UnitSpec; trees: string; docker?: string }): Promise<Drop[]> {
  const { eb } = readUnit(o.dir);
  const tree = join(o.trees, eb.unit.id);
  if (!existsSync(tree)) fail("E_USAGE", "no build tree for " + eb.unit.id + " at " + tree);
  const drops: Drop[] = [];
  try {
    const needles = leakNeedles(o.repo, o.spec.base, o.spec.merge, o.spec.items.map((i) => i.commit));
    sessionLeakCheck({ unit: eb.unit.id, image: eb.image.id, repo: o.spec.repo, runner: eb.groups[0]!.runner, needles, docker: o.docker });
  } catch (e) {
    if (!(e instanceof EbError) || e.code !== "E_EB_LEAK") throw e;
    drops.push(leakDrop(/class=(\S+?):/.exec(e.message)?.[1] ?? "leak", "leak"));
  }
  return [...drops, ...(await sidecarGates({ tree }))];
}
