// Keyless fixtures for the rig tests: a scratch git repository holding the recipe's inputs, a fake GitHub REST API that
// answers what rig admit reads, and probe results and a host fingerprint that tests can turn red.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintSha, hostFingerprint, REQUIRED_PROBES, writeAdmission, type GitHub, type HostFingerprint, type ProbeResult, type ProofKind } from "../../src/rig/admission.ts";
import { checkout } from "../../src/rig/checkout.ts";
import { recipeHash, recipeInputs, RIG_ROOT } from "../../src/rig/recipe.ts";
import type { TierSummary } from "../../src/rig/tier.ts";
import { machineId, recordApproval } from "../../src/runner/ledger/ledger.ts";
import type { Admission } from "../../src/runner/ledger/record.ts";

export const REPO = "garrytan/gstack-evals";
export const FP: HostFingerprint = { platform: "linux", arch: "x64", kernel: "6.0.0-test", bun: "1.4.4", docker: null };
export const fingerprint = (fp: HostFingerprint = FP) => () => fp;

export function git(root: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}

/** A committed repository holding the recipe's inputs, so checkout() and recipeHash() work on it. */
export function scratchRepo(): { root: string; commit: string; tree: string; recipe: string; prereg: string } {
  const root = mkdtempSync(join(tmpdir(), "gse-rig-repo-"));
  mkdirSync(join(root, "docker"));
  mkdirSync(join(root, "src", "adapters"), { recursive: true });
  for (const f of ["docker/trial.Dockerfile", "docker/host-cli.json", "bun.lock"]) cpSync(join(RIG_ROOT, f), join(root, f));
  writeFileSync(join(root, "src", "adapters", "index.ts"), "export {};\n");
  writeFileSync(join(root, "prereg.md"), "# A preregistration\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "scratch");
  const co = checkout(root);
  return { root, commit: co.commit, tree: co.tree, recipe: recipeHash(recipeInputs(root)), prereg: join(root, "prereg.md") };
}

export const greenProbes = (proof: ProofKind): ProbeResult[] => REQUIRED_PROBES[proof].map((id) => ({ id, requirement: id.startsWith("r5") ? "R5" : id.startsWith("r6") ? "R6" : "replay", pass: true, detail: "test" }));
export const failing = (results: ProbeResult[], id: string): ProbeResult[] => results.map((p) => (p.id === id ? { ...p, pass: false, detail: "failed in a test" } : p));

export interface FakeRun {
  id?: number;
  workflow?: "rig.yml" | "ci.yml";
  event?: string;
  status?: string;
  conclusion?: string | null;
  head_sha: string;
  /** The tree GitHub reports for the run's commit. */
  tree: string;
  /** rig.yml: the tier summary its job annotated; null for none. */
  tier?: Partial<TierSummary> | null;
  repo?: string;
}

/** A GitHub REST API that knows the given workflow runs, and records every path asked. */
export function fakeGitHub(runs: FakeRun[]): GitHub & { asked: string[] } {
  const asked: string[] = [];
  const full = runs.map((r, i) => ({ id: r.id ?? 100 + i, path: ".github/workflows/" + (r.workflow ?? "rig.yml"), event: r.event ?? "push", status: r.status ?? "completed", conclusion: r.conclusion === undefined ? "success" : r.conclusion, head_sha: r.head_sha, html_url: "https://github.com/" + REPO + "/actions/runs/" + (r.id ?? 100 + i), created_at: new Date(Date.UTC(2026, 9, 30, 0, i)).toISOString(), repository: { full_name: r.repo ?? REPO }, tree: r.tree, tier: r.tier }));
  return {
    asked,
    api(path: string) {
      asked.push(path);
      let m: RegExpExecArray | null;
      if ((m = /^repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/runs\?head_sha=(\w+)/.exec(path))) return { workflow_runs: full.filter((r) => r.path.endsWith("/" + m![1]) && r.head_sha === m![2]) };
      if ((m = /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs/.exec(path))) return { jobs: [{ id: Number(m[1]) * 10 }] };
      if ((m = /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/.exec(path))) return full.find((r) => r.id === Number(m![1]));
      if ((m = /^repos\/[^/]+\/[^/]+\/check-runs\/(\d+)\/annotations/.exec(path))) {
        const run = full.find((r) => r.id * 10 === Number(m![1]));
        const notes = [{ title: "", message: "Node.js 20 is deprecated." }];
        if (run?.tier) notes.push({ title: "gstack-evals-rig-tier", message: JSON.stringify(run.tier) });
        return notes;
      }
      if ((m = /^repos\/[^/]+\/[^/]+\/git\/commits\/(\w+)$/.exec(path))) return { tree: { sha: full.find((r) => r.head_sha === m![1])?.tree ?? "0".repeat(40) } };
      throw new Error("the fake GitHub does not know " + path);
    },
  };
}

export const greenTier = (r: { commit: string; tree: string; recipe: string }): TierSummary => ({ schema: 1, kind: "rig-tier", stage: "m1b", verdict: "GREEN", head_sha: r.commit, tree: r.tree, clean: true, recipe_sha256: r.recipe, counts: { pass: 300, fail: 0, skip: 0 } });

/** A green admission record for this checkout's tree as it stands and this host, written into the item's slot. */
export function admitThisCheckout(record: string, o: { item: string; proof: ProofKind; seq?: number; run_id?: string | null; machine_id?: string }): string {
  const host = hostFingerprint(o.proof);
  const co = checkout();
  const now = Date.now();
  return writeAdmission(record, {
    schema: 1, kind: "admission", item: o.item, seq: o.seq ?? 1, attempt: 1, run_id: o.run_id ?? null, machine_id: o.machine_id ?? machineId(), proof: o.proof,
    prereg: { path: "prereg.md", sha256: "0".repeat(64) }, repo: REPO, commit: co.commit, tree: co.tree, recipe_sha256: o.proof === "trial" ? recipeHash(recipeInputs()) : null,
    checks: [{ workflow: o.proof === "trial" ? "rig.yml" : "ci.yml", run_id: 1, url: "https://github.com/" + REPO + "/actions/runs/1", event: "push", head_sha: co.commit, tree: co.tree, conclusion: "success", tier: null, problems: [] }],
    probes: greenProbes(o.proof), host, host_sha256: fingerprintSha(host), verdict: "green", problems: [], admitted_at: new Date(now).toISOString(), expires_at: new Date(now + 3600_000).toISOString(),
  });
}

export function initItem(record: string, item: string, admission: Admission, cap = 20_000_000): void {
  recordApproval(record, { action: "init", item, cap_micros: cap, quotes: [{ words: "keyless rig test, no spend", by: "tests/rig", source: "tests/rig/helpers.ts" }], admission });
}
