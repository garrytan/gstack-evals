// Rig admission (GSTA-8's CI plan, decision 3; U20). A line item recorded with --admission required leases only once the
// rig is proven. gstack-evals rig admit gathers the proof set a preregistration names and writes a write-once admission
// record for the item's next lease slot: <record>/items/<item>/admission-<slot>.json, then admission-<slot>.<n>.json for a
// later attempt at the same slot, so a red or stale record never strands an item; the latest attempt decides. openLease
// reads it at lease time through rigAdmission, its default requireAdmission, and refuses with E_RIG_UNPROVEN when the
// record is missing, red or stale.
// - trial, for arms in src/trial (Lane A on a real host): a green rig.yml push or dispatch run, the Docker tier, whose
//   commit has this checkout's tree, and the tier summary its job annotated (title gstack-evals-rig-tier) at the same tree
//   and recipe hash; plus the R5 and R6 probes run on the machine that spends (src/rig/rig-probes.ts). A push or dispatch run
//   takes its workflow file from the commit it tests, so the steps that wrote the annotation sit inside the tree being
//   proven. A pull request's run takes its workflow file from the PR's merge commit, whose base can be any branch, so it
//   gives reviewers a signal and never admits. Annotations are read through the REST API, which a proxy that refuses
//   artifact downloads (as on Capy) still serves.
// - direct, for direct-API runs and judge calibration: a green ci.yml run on a push or a dispatch (a pull request's run
//   tests a merge commit, not a tree the run can name) whose commit has this tree; plus the replay lane's fake-upstream
//   tests run on the machine that spends.
// A record holds the machine id and the host fingerprint and holds for 24 hours. It is stale when the checkout's tree, the
// recipe hash or the host changed, so an edit after admission or a replaced machine refuses. A new lease after a reconcile
// takes a new slot, so it needs its own record, written on the machine that will hold it. A record names the item's bound
// run, or none for the item's first lease, whose run id is minted when the run starts; the ledger binds the item to it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { release } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ReasonCode } from "../errors/codes.ts";
import type { RequireAdmission } from "../runner/ledger/ledger.ts";
import { LedgerError, readItem, slotPath, type LeaseFile } from "../runner/ledger/record.ts";
import { checkout, type Checkout } from "./checkout.ts";
import { recipeHash, recipeInputs, RIG_ROOT } from "./recipe.ts";
import { TIER_ARTIFACT, type TierSummary } from "./tier.ts";

export type ProofKind = "trial" | "direct";

export interface ProbeResult {
  id: string;
  /** R5 egress, R6 the sealed store, or replay for the replay lane's fake-upstream tests. */
  requirement: "R5" | "R6" | "replay";
  pass: boolean;
  detail: string;
}

/** The probes each proof set needs, every one passing, in a green admission record (src/rig/rig-probes.ts runs them). */
export const REQUIRED_PROBES: Record<ProofKind, readonly string[]> = {
  trial: ["r5.proxy", "r5.outside", "r5.dns", "r5.gateway", "r5.sockets", "r5.keys", "r6.mounts", "r6.env", "r6.canary", "r6.history", "r6.workflows"],
  direct: ["replay.fake-upstream"],
};
export const ADMISSION_TTL_MS = 24 * 60 * 60 * 1000;

/** The workflow each proof set reads, and the events whose run takes its workflow file from the commit it tests. */
export const PROOF_WORKFLOWS: Record<ProofKind, { file: string; events: readonly string[] }> = {
  trial: { file: "rig.yml", events: ["push", "workflow_dispatch"] },
  direct: { file: "ci.yml", events: ["push", "workflow_dispatch"] },
};

export class RigError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(message);
  }
}

export interface HostFingerprint {
  platform: string;
  arch: string;
  kernel: string;
  bun: string;
  /** The Docker engine, for the trial proof set; null for direct. */
  docker: { server: string; kernel: string; os_type: string; arch: string; security: string[]; cgroup_driver: string; cgroup_version: string; storage: string } | null;
}

/** One workflow run the record rests on, as admit read it. */
export interface CheckProof {
  workflow: string;
  run_id: number;
  url: string;
  event: string;
  head_sha: string;
  /** The tree of the run's commit, read from the API. */
  tree: string;
  conclusion: string | null;
  /** rig.yml only: the tier summary the run's tier job annotated. */
  tier: TierSummary | null;
  problems: string[];
}

export interface AdmissionRecord {
  schema: 1;
  kind: "admission";
  item: string;
  seq: number;
  attempt: number;
  /** The item's bound run, or null for its first lease. */
  run_id: string | null;
  machine_id: string;
  proof: ProofKind;
  prereg: { path: string; sha256: string };
  repo: string;
  commit: string;
  tree: string;
  /** The trial proof set's recipe hash (src/rig/recipe.ts); null for direct. */
  recipe_sha256: string | null;
  checks: CheckProof[];
  probes: ProbeResult[];
  host: HostFingerprint;
  host_sha256: string;
  verdict: "green" | "red";
  problems: string[];
  admitted_at: string;
  expires_at: string;
}

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const fingerprintSha = (f: HostFingerprint): string => sha256(JSON.stringify(f));

/** This host as admission binds it: platform, kernel and Bun, and for the trial proof set the Docker engine. */
export function hostFingerprint(proof: ProofKind, docker: string = process.env.GSTACK_EVALS_DOCKER_BIN || "docker"): HostFingerprint {
  const base = { platform: process.platform, arch: process.arch, kernel: release(), bun: Bun.version };
  if (proof !== "trial") return { ...base, docker: null };
  const r = spawnSync(docker, ["info", "--format", "{{json .}}"], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(docker + " info failed: " + (r.stderr || String(r.error ?? "")).trim().split("\n")[0]);
  const i = JSON.parse(r.stdout) as Record<string, unknown>;
  const text = (k: string) => String(i[k] ?? "");
  return { ...base, docker: { server: text("ServerVersion"), kernel: text("KernelVersion"), os_type: text("OSType"), arch: text("Architecture"), security: [...((i.SecurityOptions as string[] | null) ?? [])].sort(), cgroup_driver: text("CgroupDriver"), cgroup_version: text("CgroupVersion"), storage: text("Driver") } };
}

const ADMISSION_FILE = /^admission-(\d{4})(?:\.(\d+))?\.json$/;

/** Attempt 1 sits in U4's slot path; a later attempt at the same slot sits beside it. */
export function admissionPath(record: string, item: string, seq: number, attempt: number): string {
  const first = slotPath(record, { kind: "admission", item, seq });
  return attempt === 1 ? first : first.replace(/\.json$/, "." + attempt + ".json");
}

function parseAdmission(text: string, item: string, seq: number, attempt: number): AdmissionRecord | null {
  let a: AdmissionRecord;
  try {
    a = JSON.parse(text) as AdmissionRecord;
  } catch {
    return null;
  }
  const ok = a && a.schema === 1 && a.kind === "admission" && a.item === item && a.seq === seq && a.attempt === attempt && (a.proof === "trial" || a.proof === "direct") && (a.run_id === null || typeof a.run_id === "string") && typeof a.machine_id === "string" && typeof a.tree === "string" && Array.isArray(a.checks) && Array.isArray(a.probes) && Array.isArray(a.problems) && typeof a.host_sha256 === "string" && typeof a.expires_at === "string";
  return ok ? a : null;
}

/**
 * The slot's latest attempt, or null when the slot has none. Only the names admissionPath writes count as attempts, and a
 * file that does not parse, or whose attempt differs from its name's, is an attempt with no record.
 */
export function latestAdmission(record: string, item: string, seq: number): { path: string; attempt: number; admission: AdmissionRecord | null } | null {
  const dir = join(record, "items", item);
  if (!existsSync(dir)) return null;
  let latest: { path: string; attempt: number } | null = null;
  for (const name of readdirSync(dir)) {
    const m = ADMISSION_FILE.exec(name);
    if (!m || Number(m[1]) !== seq) continue;
    const attempt = m[2] === undefined ? 1 : Number(m[2]);
    if (m[2] !== undefined && !(Number.isSafeInteger(attempt) && attempt >= 2 && String(attempt) === m[2])) continue;
    if (!latest || attempt > latest.attempt) latest = { path: join(dir, name), attempt };
  }
  return latest && { ...latest, admission: parseAdmission(readFileSync(latest.path, "utf8"), item, seq, latest.attempt) };
}

/** Writes an admission record once, created exclusively and fsynced; a path already taken is E_LEDGER_RECORD. */
export function writeAdmission(record: string, a: AdmissionRecord): string {
  const path = admissionPath(record, a.item, a.seq, a.attempt);
  mkdirSync(dirname(path), { recursive: true });
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LedgerError("E_LEDGER_RECORD", "another admission attempt was written at " + path + " at the same moment; run gstack-evals rig admit again");
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify(a, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return path;
}

/** Why a record does not prove its rig, or an empty list: a red verdict, a failing or missing check or probe. */
export function redness(a: AdmissionRecord): string[] {
  const why = [...a.problems];
  if (a.verdict !== "green") why.push("its verdict is " + a.verdict);
  const workflow = PROOF_WORKFLOWS[a.proof].file;
  if (!a.checks.some((c) => c.workflow === workflow && c.conclusion === "success" && c.problems.length === 0)) why.push("it holds no green " + workflow + " run");
  for (const c of a.checks) why.push(...c.problems);
  for (const id of REQUIRED_PROBES[a.proof]) if (!a.probes.some((p) => p.id === id && p.pass)) why.push("probe " + id + " " + (a.probes.some((p) => p.id === id) ? "failed" : "is missing"));
  if (a.proof === "trial" && !a.recipe_sha256) why.push("it holds no recipe hash");
  return [...new Set(why)];
}

const short = (s: string | null | undefined) => (s ?? "none").slice(0, 12);

/**
 * U20's requireAdmission, openLease's default: the lease's slot holds a green admission record for the lease's run and
 * machine, made in the last 24 hours for the tree this checkout runs (uncommitted changes included), at the same recipe
 * hash, on a host with the same fingerprint.
 */
export function rigAdmission(o: { proof?: ProofKind; root?: string; now?: () => Date; fingerprint?: (proof: ProofKind) => HostFingerprint } = {}): RequireAdmission {
  return (record: string, lease: LeaseFile) => {
    let at = "the admission record for slot " + lease.seq + " of line item " + lease.item;
    try {
      const found = latestAdmission(record, lease.item, lease.seq);
      if (!found) return "no admission record at " + admissionPath(record, lease.item, lease.seq, 1) + " for slot " + lease.seq + "; run gstack-evals rig admit --item " + lease.item + " on the machine that will spend (docs/rig.md)";
      const { path, admission: a } = found;
      at = "the admission record at " + path;
      if (!a) return at + " does not parse as one for line item " + lease.item + ", slot " + lease.seq;
      if (o.proof && a.proof !== o.proof) return at + " holds the " + a.proof + " proof set, and this entry point needs the " + o.proof + " one (docs/rig.md)";
      if (a.run_id !== null && a.run_id !== lease.run_id) return at + " admits run " + a.run_id + ", not " + lease.run_id;
      if (a.run_id === null && lease.seq !== 1) return at + " names no run, which only a line item's first lease may take; this is slot " + lease.seq;
      if (a.machine_id !== lease.machine_id) return at + " was admitted on machine " + a.machine_id + ", not " + lease.machine_id + "; a replaced or other machine admits its own lease with gstack-evals rig admit";
      const red = redness(a);
      if (red.length) return at + " is red: " + red.join("; ");
      const now = (o.now ?? (() => new Date()))();
      if (!(now.getTime() <= Date.parse(a.expires_at))) return at + " is stale: admitted at " + a.admitted_at + ", it held until " + a.expires_at;
      const root = o.root ?? RIG_ROOT;
      const tree = checkout(root).tree;
      if (tree !== a.tree) return at + " is stale: it proves tree " + short(a.tree) + ", and this checkout runs tree " + short(tree) + " (uncommitted changes included)";
      if (a.proof === "trial") {
        const recipe = recipeHash(recipeInputs(root));
        if (recipe !== a.recipe_sha256) return at + " is stale: it proves recipe " + short(a.recipe_sha256) + ", and this checkout's recipe is " + short(recipe);
      }
      const host = (o.fingerprint ?? hostFingerprint)(a.proof);
      if (fingerprintSha(host) !== a.host_sha256) {
        const changed = (Object.keys(host) as (keyof HostFingerprint)[]).filter((k) => JSON.stringify(host[k]) !== JSON.stringify(a.host?.[k]));
        return at + " is stale: this host changed since admission (" + (changed.join(", ") || "fingerprint") + ")";
      }
      return null;
    } catch (error) {
      return "checking " + at + " failed: " + (error as Error).message;
    }
  };
}

/** What admit reads from GitHub: REST API paths, answered as JSON. */
export interface GitHub {
  api(path: string): unknown;
}

/** GitHub's REST API through the gh CLI (GSTACK_EVALS_GH_BIN names another binary). */
export function ghCli(bin = "gh"): GitHub {
  return {
    api: (path) => {
      const r = spawnSync(bin, ["api", path], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) throw new RigError("E_RIG_PROOF", bin + " api " + path + " failed, so the proof cannot be read: " + (r.stderr || String(r.error ?? "")).trim().split("\n")[0]);
      return JSON.parse(r.stdout);
    },
  };
}

interface GhRun {
  id: number;
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  html_url: string;
  created_at: string;
  repository?: { full_name?: string };
}

/** The proof set's workflow run at this checkout's commit (or the run named), checked against this tree and recipe. */
export function gatherCheck(gh: GitHub, repo: string, proof: ProofKind, co: Checkout, recipe: string | null, runId?: number): CheckProof {
  const w = PROOF_WORKFLOWS[proof];
  const path = ".github/workflows/" + w.file;
  let run: GhRun;
  if (runId !== undefined) run = gh.api("repos/" + repo + "/actions/runs/" + runId) as GhRun;
  else {
    const listed = (gh.api("repos/" + repo + "/actions/workflows/" + w.file + "/runs?head_sha=" + co.commit + "&per_page=50") as { workflow_runs?: GhRun[] }).workflow_runs ?? [];
    const runs = listed.filter((r) => r.path === path && w.events.includes(r.event)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const green = runs.find((r) => r.status === "completed" && r.conclusion === "success");
    if (!green && runs.some((r) => r.status !== "completed")) throw new RigError("E_RIG_PROOF", w.file + " is still running at commit " + short(co.commit) + "; wait for it to finish, then admit again");
    if (!green && !runs[0]) {
      const how = proof === "trial" ? "gh workflow run rig.yml --repo " + repo + " --ref <a branch at this commit>" : "a push to main runs ci.yml, or gh workflow run ci.yml --repo " + repo + " --ref <a branch at this commit>";
      throw new RigError("E_RIG_PROOF", "no " + w.file + " run on " + w.events.join(", ") + " at commit " + co.commit + " in " + repo + "; start one (" + how + "), wait for it to pass, then admit again");
    }
    run = (green ?? runs[0])!;
  }
  if (run.status !== "completed") throw new RigError("E_RIG_PROOF", w.file + " run " + run.id + " is " + run.status + "; wait for it to finish, then admit again");
  const problems: string[] = [];
  if (run.path !== path) problems.push("run " + run.id + " is " + run.path + ", not " + path);
  if (run.repository?.full_name !== repo) problems.push("run " + run.id + " belongs to " + (run.repository?.full_name ?? "an unnamed repository") + ", not " + repo);
  if (!w.events.includes(run.event)) problems.push(w.file + " run " + run.id + " ran on " + run.event + "; it proves a tree only on " + w.events.join(", "));
  if (run.conclusion !== "success") problems.push(w.file + " run " + run.id + " concluded " + run.conclusion);
  const tree = (gh.api("repos/" + repo + "/git/commits/" + run.head_sha) as { tree?: { sha?: string } }).tree?.sha ?? "";
  if (tree !== co.tree) problems.push(w.file + " run " + run.id + " tested commit " + short(run.head_sha) + " at tree " + short(tree) + ", not this checkout's tree " + short(co.tree));
  let tier: TierSummary | null = null;
  if (proof === "trial") {
    const notes: TierSummary[] = [];
    for (const job of (gh.api("repos/" + repo + "/actions/runs/" + run.id + "/jobs?per_page=100") as { jobs?: { id: number }[] }).jobs ?? []) {
      for (const a of gh.api("repos/" + repo + "/check-runs/" + job.id + "/annotations?per_page=100") as { title?: string; message?: string }[]) {
        if (a.title !== TIER_ARTIFACT) continue;
        try {
          notes.push(JSON.parse(a.message ?? "") as TierSummary);
        } catch {
          problems.push("run " + run.id + " has a " + TIER_ARTIFACT + " annotation that is not JSON");
        }
      }
    }
    if (notes.length !== 1) problems.push("run " + run.id + " has " + notes.length + " " + TIER_ARTIFACT + " annotations, and admission needs exactly one tier summary");
    const t = (tier = notes[0] ?? null);
    if (t) {
      if (t.schema !== 1 || t.kind !== "rig-tier") problems.push("the tier summary of run " + run.id + " is not schema 1 rig-tier");
      if (t.verdict !== "GREEN") problems.push("the tier summary of run " + run.id + " is " + t.verdict);
      if (t.head_sha !== run.head_sha || t.tree !== co.tree || !t.clean) problems.push("the tier summary of run " + run.id + " tested commit " + short(t.head_sha) + " at tree " + short(t.tree) + (t.clean ? "" : " with uncommitted changes") + ", not this checkout's tree " + short(co.tree));
      if (t.recipe_sha256 !== recipe) problems.push("the tier summary of run " + run.id + " tested recipe " + short(t.recipe_sha256) + ", not this checkout's recipe " + short(recipe));
    }
  }
  return { workflow: w.file, run_id: run.id, url: run.html_url, event: run.event, head_sha: run.head_sha, tree, conclusion: run.conclusion, tier, problems };
}

export interface AdmitInput {
  record: string;
  item: string;
  proof: ProofKind;
  prereg: string;
  repo: string;
  machineId: string;
  gh: GitHub;
  /** The proof set's keyless probes on this machine. */
  probes: () => ProbeResult[];
  fingerprint: (proof: ProofKind) => HostFingerprint;
  /** The run the record admits; the item's bound run by default, none for an unbound item. */
  runId?: string;
  /** A workflow run id; by default, the newest green run at this checkout's commit. */
  checkRun?: number;
  root?: string;
  now?: Date;
}

/**
 * Admits the line item's next lease: gathers the proof set and writes its admission record, green or red, as the slot's
 * next attempt. A current green record for the same run, machine, tree, recipe and host is returned as it is. Nothing is
 * written when the proof cannot be gathered: a dirty checkout, a run still going or none at this commit, probes that cannot run.
 */
export function admit(i: AdmitInput): { admission: AdmissionRecord; path: string; written: boolean } {
  const state = readItem(i.record, i.item);
  if (state.cap_micros === null) throw new LedgerError("E_LEDGER_MISSING", "line item " + i.item + " has no approved cap in " + i.record + "; record it with gstack-evals ledger init --admission required and the owner's words first");
  if (state.open) throw new LedgerError("E_LEASE_UNSETTLED", "lease " + state.open.lease_id + " on line item " + i.item + " is still open; the next lease, which this record would admit, waits until it is settled or reconciled");
  if (i.runId !== undefined && state.run_id !== null && i.runId !== state.run_id) throw new LedgerError("E_ITEM_BOUND", "line item " + i.item + " is bound to run " + state.run_id + ", so run " + i.runId + " cannot be admitted to spend from it");
  const seq = state.leases.length + 1;
  const run_id = state.run_id ?? i.runId ?? null;
  let prereg: AdmissionRecord["prereg"];
  try {
    prereg = { path: resolve(i.prereg), sha256: sha256(readFileSync(i.prereg)) };
  } catch (error) {
    throw new RigError("E_USAGE", "--prereg must be the preregistration file that names this run's proof set: " + (error as Error).message);
  }
  const root = i.root ?? RIG_ROOT;
  const co = checkout(root);
  if (co.tree !== co.head_tree) throw new RigError("E_RIG_PROOF", "this checkout has uncommitted changes (tree " + short(co.tree) + ", HEAD's tree " + short(co.head_tree) + "); admission proves a committed tree, so commit or stash them and admit again");
  const recipe = i.proof === "trial" ? recipeHash(recipeInputs(root)) : null;
  const now = i.now ?? new Date();
  const host = i.fingerprint(i.proof);
  const host_sha256 = fingerprintSha(host);
  const latest = latestAdmission(i.record, i.item, seq);
  const prior = latest?.admission;
  if (latest && prior && !redness(prior).length && prior.proof === i.proof && prior.run_id === run_id && prior.machine_id === i.machineId && prior.tree === co.tree && prior.recipe_sha256 === recipe && prior.host_sha256 === host_sha256 && now.getTime() <= Date.parse(prior.expires_at)) {
    return { admission: prior, path: latest.path, written: false };
  }
  const check = gatherCheck(i.gh, i.repo, i.proof, co, recipe, i.checkRun);
  let probes: ProbeResult[];
  try {
    probes = i.probes();
  } catch (error) {
    throw new RigError("E_RIG_PROBE", "the keyless probes could not run on this machine: " + (error as Error).message);
  }
  const admission: AdmissionRecord = {
    schema: 1,
    kind: "admission",
    item: i.item,
    seq,
    attempt: (latest?.attempt ?? 0) + 1,
    run_id,
    machine_id: i.machineId,
    proof: i.proof,
    prereg,
    repo: i.repo,
    commit: co.commit,
    tree: co.tree,
    recipe_sha256: recipe,
    checks: [check],
    probes,
    host,
    host_sha256,
    verdict: "green",
    problems: [],
    admitted_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ADMISSION_TTL_MS).toISOString(),
  };
  if (redness(admission).length) admission.verdict = "red";
  return { admission, path: writeAdmission(i.record, admission), written: true };
}
