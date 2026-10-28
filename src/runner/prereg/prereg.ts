// Vendored from harness-evals (https://github.com/garrytan/harness-evals) at 70cb3d0197b70d24b4bd3344b8248e908d4710a8,
// runner/prereg/prereg.ts. MIT License, Copyright (c) 2026 Garry Tan.
// gstack-evals changes (U2): the command-line block at the end is removed. Its stderr lines carried no reason code,
// and the `plan` command (src/runner/prereg/cli.ts, v1.1) is the entry point here. The checks are unchanged.
/**
 * Preregistration discipline for paid and gating runs.
 *
 * Two checks, used together:
 *
 * - `attestPreregistration` runs inside a runner before its first paid or
 *   gating request. It refuses unless the preregistration file is committed,
 *   unchanged in the worktree and contained in a commit on `origin`, and it
 *   returns an attestation the runner writes into its receipt.
 * - `checkOrder` runs in CI over `docs/benchmarks/preregistrations.json`. For
 *   every listed experiment, the commit that first added the preregistration
 *   must be a strict ancestor of the commit that first added each result file,
 *   and any attestation a receipt carries must name a commit at or after the
 *   preregistration's. An experiment that declares `preregistered_on_main: false`
 *   with a `reason` (its preregistration commit preceded the trials on a branch
 *   that was squash-merged together with the results) has its order problems
 *   printed as warnings, not failures; the declaration is the published deviation.
 *
 * Commit order alone can't prove a preregistration was written first; the
 * runtime attestation against `origin` is what does. CI needs full history
 * (`fetch-depth: 0`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Attestation {
  preregistration: string;
  preregistration_commit: string;
  runner_commit: string;
  worktree_clean_for_preregistration: true;
  on_origin: true;
  attested_at: string;
}

export interface ManifestEntry {
  id: string;
  preregistration: string;
  results: string[];
  /**
   * A declared deviation: the preregistration commit preceded the trials on its branch, but the branch was
   * squash-merged with its results, so main's history cannot show the order. Only with a non-empty `reason`
   * naming the branch commit and the cause does the checker print the order problems of this experiment as
   * warnings instead of failures; the attestation checks still fail as usual.
   */
  preregistered_on_main?: false;
  reason?: string;
}

export interface OrderProblem {
  id: string;
  file: string;
  problem: string;
  /** Set when the experiment declares `preregistered_on_main: false` with a reason: printed, not counted. */
  warning?: true;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

export function attestPreregistration(path: string, cwd = process.cwd(), now = new Date()): Attestation {
  if (!existsSync(join(cwd, path))) throw new Error(`preregistration ${path} does not exist; write and commit it before running`);
  if (git(cwd, ['status', '--porcelain', '--', path]) !== '') {
    throw new Error(`preregistration ${path} has uncommitted changes; commit and push it before running`);
  }
  const commit = tryGit(cwd, ['log', '-n', '1', '--format=%H', '--', path]);
  if (!commit) throw new Error(`preregistration ${path} is not committed; commit and push it before running`);
  const remotes = git(cwd, ['branch', '-r', '--contains', commit]);
  if (!remotes.split('\n').some(line => line.trim().startsWith('origin/'))) {
    throw new Error(`preregistration commit ${commit.slice(0, 12)} is not on origin; run \`git push\` before running`);
  }
  return {
    preregistration: path,
    preregistration_commit: commit,
    runner_commit: git(cwd, ['rev-parse', 'HEAD']),
    worktree_clean_for_preregistration: true,
    on_origin: true,
    attested_at: now.toISOString(),
  };
}

function firstAddCommit(cwd: string, path: string): string | null {
  const out = tryGit(cwd, ['log', '--diff-filter=A', '--format=%H', '--', path]);
  if (!out) return null;
  const lines = out.split('\n').filter(Boolean);
  return lines[lines.length - 1] ?? null;
}

function isStrictAncestor(cwd: string, older: string, newer: string): boolean {
  if (older === newer) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isAncestorOrSelf(cwd: string, older: string, newer: string): boolean {
  return older === newer || isStrictAncestor(cwd, older, newer);
}

function trackedFiles(cwd: string, glob: string): string[] {
  const out = tryGit(cwd, ['ls-files', '--', glob]);
  return out ? out.split('\n').filter(Boolean) : [];
}

function attestationIn(cwd: string, file: string): Attestation | null {
  if (!file.endsWith('.json')) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, file), 'utf8')) as { preregistration_attestation?: Attestation };
    return parsed.preregistration_attestation ?? null;
  } catch {
    return null;
  }
}

export function checkOrder(entries: ManifestEntry[], cwd = process.cwd()): OrderProblem[] {
  if (tryGit(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') {
    return [{ id: '*', file: '*', problem: 'shallow clone: run with full history (actions/checkout fetch-depth: 0)' }];
  }
  const problems: OrderProblem[] = [];
  for (const entry of entries) {
    const preCommit = firstAddCommit(cwd, entry.preregistration);
    if (!preCommit) {
      problems.push({ id: entry.id, file: entry.preregistration, problem: 'preregistration is not committed' });
      continue;
    }
    const declared = entry.preregistered_on_main === false && typeof entry.reason === 'string' && entry.reason.trim() !== '';
    for (const glob of entry.results) {
      for (const file of trackedFiles(cwd, glob)) {
        const resultCommit = firstAddCommit(cwd, file);
        if (!resultCommit) continue;
        if (!isStrictAncestor(cwd, preCommit, resultCommit)) {
          const problem = `added in ${resultCommit.slice(0, 12)}, not after the preregistration commit ${preCommit.slice(0, 12)}`;
          problems.push(declared ? { id: entry.id, file, problem: `${problem} (declared: ${entry.reason!.trim()})`, warning: true } : { id: entry.id, file, problem });
        }
        const attestation = attestationIn(cwd, file);
        if (attestation) {
          if (attestation.preregistration !== entry.preregistration) {
            problems.push({ id: entry.id, file, problem: `attests ${attestation.preregistration}, expected ${entry.preregistration}` });
          } else if (!isAncestorOrSelf(cwd, preCommit, attestation.preregistration_commit)) {
            problems.push({ id: entry.id, file, problem: `attestation names ${attestation.preregistration_commit.slice(0, 12)}, which does not contain the preregistration` });
          }
        }
      }
    }
  }
  return problems;
}

/** The main manifest plus one file per experiment group in `preregistrations.d/`, so parallel branches don't collide. */
export function loadManifest(root = process.cwd()): ManifestEntry[] {
  const read = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as { experiments: ManifestEntry[] }).experiments;
  const main = join(root, 'docs/benchmarks/preregistrations.json');
  const dir = join(root, 'docs/benchmarks/preregistrations.d');
  const extra = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort().flatMap(f => read(join(dir, f))) : [];
  return [...read(main), ...extra];
}
