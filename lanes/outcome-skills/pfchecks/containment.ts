// Copyright (c) 2026 Garry Tan. MIT License.
// The containment check (section 15): before a unit's first session, the session's workspace holds nothing from the fix
// commit or after. It runs sh/contain.sh in a container of the session image the sessions use (Harbor's task directory
// holds only a Dockerfile FROM that image, task.toml and instruction.md, and the compose overlay adds the tools volume, the
// pstack volume and the Claude binary, read-only), as root, with no network. It checks (a) every ref, tag, remote, note,
// replace ref, stash, packed ref, FETCH_HEAD, ORIG_HEAD and reflog entry points at the base commit or an ancestor; (b)
// every commit object is the base or an ancestor; (c) no alternates, gitfile, submodule store or nested .git, and tracked
// files equal the base commit, both by git diff and by hashing each working copy as git add would store it, so an index
// flag (skip-worktree, assume-unchanged) cannot hide a change; (d) no other git directory on the filesystem holds the dataset's base commit (a clone of
// the repository), a blob of a file the fix or the test patch changes as it reads after the patch, or a commit id after
// the base that the unit's own image holds (upstreamAfter), and the session repository holds no such blob; every other git
// directory is recorded with its path and commit count; (e) no file outside the repository, no file inside it that the
// base commit's tree does not hold byte for byte (untracked, ignored, staged only, or a tracked file whose working copy
// differs), and no blob in the session repository that the base commit does not reach holds a hidden marker: a line of
// 30 code points or more that the fix or the test patch adds and no file in the base commit's tree holds as a line
// (whole lines, as the leak scan), or the leaf name of a hidden fail-to-pass test, 12 characters or more, that no file in
// the base commit's tree holds (fixed strings). Base content comes from the base commit's blobs, never the index or the
// working tree. runPfSession runs containUnit before every session, so a unit's
// first session runs the check and later ones reuse its passing record.
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerRun } from "../../real-outcome/task/docker.ts";
import type { SessionImage } from "../statemachines/image.ts";
import { runName } from "../statemachines/testrun.ts";
import { added30, type SmUnit } from "../statemachines/unit.ts";
import { pfFail } from "./prereg.ts";

export const CONTAIN_SCRIPT = readFileSync(join(import.meta.dir, "sh", "contain.sh"), "utf8");
export const CONTAIN_RECORD = "pf-contain.json";
const MUST_ZERO = ["bad_refs", "bad_commits", "alternates", "gitfile", "modules", "nested", "tracked_changed", "repo_fix_blobs", "clones", "leaked_after", "leaked_fix", "hits"];

/** A test id's leaf: the part after the last " :: ", "::", "#" or "/", or after the last "." of a dotted identifier, with a
 *  trailing argument list, index or " - should panic" cut. */
export function leafName(id: string): string {
  const parts = id.split(/\s+::\s+|::|#|\//);
  const leaf = parts[parts.length - 1]!.replace(/\s+-\s+should panic.*$/, "").replace(/(\([^)]*\)|\[[^\]]*\])+$/, "").trim();
  return parts.length === 1 && /^[\w$.]+$/.test(leaf) ? leaf.slice(leaf.lastIndexOf(".") + 1) : leaf;
}

/** The script's input files: the candidate lines, the candidate names, the dataset's base commit, the upstream commit ids
 *  after it and the two patches, byte for byte. */
export function containInputs(unitDir: string, u: Pick<SmUnit, "base_commit" | "tests">, after: readonly string[] = []): Record<string, string | Buffer> {
  const patches = ["fix.patch", "test.patch"].map((f) => readFileSync(join(unitDir, f)));
  const lines = [...new Set(patches.flatMap((b) => added30(b.toString("utf8"))))].filter((l) => !l.includes("\r"));
  const names = [...new Set(u.tests.f2p.map(leafName))].filter((n) => n.length >= 12).sort();
  return { lines: lines.join("\n") + "\n", names: names.join("\n") + "\n", upstream: u.base_commit + "\n", after: after.map((a) => a + "\n").join(""), "fix.patch": patches[0]!, "test.patch": patches[1]! };
}

export interface ContainResult { ok: boolean; summary: Record<string, string>; findings: string[]; gitdirs: Array<{ path: string; commits: number }>; detail: string }

export function readContain(out: string): ContainResult {
  const lines = out.split("\n").filter((l) => l.startsWith("PF_CONTAIN ")).map((l) => l.slice(11));
  const s = lines.find((l) => l.startsWith("summary "));
  const summary = Object.fromEntries((s ?? "").slice(8).split(" ").filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
  const gitdirs = lines.map((l) => /^gitdir commits=(\d+) (.+)$/.exec(l)).filter((m): m is RegExpExecArray => m !== null).map((m) => ({ path: m[2]!, commits: Number(m[1]) }));
  const findings = lines.filter((l) => l !== "done" && !l.startsWith("summary ") && !l.startsWith("gitdir "));
  const done = lines.includes("done");
  const ok = done && !!s && Number(summary.commits) >= 1 && Number(summary.fix_blobs) >= 1 && MUST_ZERO.every((k) => summary[k] === "0") && !findings.some((f) => f.startsWith("error"));
  const detail = (done ? "" : "the check did not finish; ") + (s ?? "no summary") + (findings.length ? "; " + findings.slice(0, 12).join("; ") + (findings.length > 12 ? "; and " + (findings.length - 12) + " more" : "") : "");
  return { ok, summary, findings, gitdirs, detail };
}

function withInputs<T>(inputs: Record<string, string | Buffer>, f: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pf-contain-"));
  try {
    for (const [n, body] of Object.entries(inputs)) writeFileSync(join(dir, n), body);
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The check on a host directory tree (tests): repo inside root. */
export function containHost(repo: string, inputs: Record<string, string | Buffer>, root: string): ContainResult {
  return withInputs(inputs, (dir) => readContain(spawnSync("bash", ["-c", CONTAIN_SCRIPT, "bash", repo, dir, root], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600_000 }).stdout ?? ""));
}

/** The check in a container of the session image, as root, with no network. */
export function containImage(image: string, repoDir: string, inputs: Record<string, string | Buffer>): ContainResult {
  return withInputs(inputs, (dir) => {
    const r = dockerRun(runName("pf-contain"), ["--rm", "--network", "none", "--user", "0:0", "-v", dir + ":/pf-contain-in:ro", "--entrypoint", "bash", image, "-c", CONTAIN_SCRIPT, "bash", repoDir, "/pf-contain-in", "/"], { timeoutMs: 3_600_000 });
    const res = readContain(r.stdout);
    return r.status === 0 ? res : { ...res, ok: false, detail: "exit " + r.status + ": " + res.detail + (r.stderr ? "; " + r.stderr.slice(-300) : "") };
  });
}

const AFTER_SCRIPT = [
  "cd \"$1\" 2>/dev/null && git -c safe.directory='*' rev-parse --git-dir >/dev/null 2>&1 || { echo 'source none'; exit 0; }",
  "t=$(mktemp -d)",
  "git -c safe.directory='*' cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype)' | awk '$2 == \"commit\" { print $1 }' | sort > \"$t/all\"",
  "if git -c safe.directory='*' cat-file -e \"$2^{commit}\" 2>/dev/null; then",
  "  echo 'source after'; git -c safe.directory='*' rev-list \"$2\" | sort > \"$t/before\"; comm -23 \"$t/all\" \"$t/before\"",
  "else echo 'source all'; cat \"$t/all\"; fi",
  "rm -rf \"$t\"",
].join("\n");

/** The upstream commit ids after the dataset's base commit that the unit's own image holds: every commit object in the
 *  image's repository that is not the base or an ancestor (source "after"); every commit object when the base is absent
 *  (source "all"); none when the image has no repository at repoDir (source "none"). The runtime image keeps the
 *  dataset image's repository as it shipped; only the tree volume's history is rewritten. */
export function upstreamAfter(where: { image: string } | { host: string }, repoDir: string, base: string): { source: string; ids: string[] } {
  const r = "image" in where
    ? dockerRun(runName("pf-after"), ["--rm", "--network", "none", "--user", "0:0", "--entrypoint", "bash", where.image, "-c", AFTER_SCRIPT, "bash", repoDir, base], { timeoutMs: 1_800_000 })
    : (({ status, stdout, stderr }) => ({ status: status ?? 1, stdout: stdout ?? "", stderr: stderr ?? "" }))(spawnSync("bash", ["-c", AFTER_SCRIPT, "bash", join(where.host, repoDir), base], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 600_000 }));
  const [first, ...rest] = r.stdout.split("\n");
  if (r.status !== 0 || !/^source (after|all|none)$/.test(first ?? "")) return pfFail("E_PF_INFRA_GAP", "listing the commits after base " + base + " in " + JSON.stringify(where) + " failed (exit " + r.status + "): " + r.stderr.slice(-300));
  return { source: first!.slice(7), ids: rest.filter((l) => /^[0-9a-f]{40}$/.test(l)) };
}

export interface ContainRecord extends ContainResult { schema: "pf-contain.v1"; unit: string; tag: string; image_id: string; runtime_id: string; head: string; after_source: string; after: number }

/** Runs the check on the unit's session image and records it in the unit dir (pf-contain.json, one entry per image tag). */
export function checkUnit(unitDir: string, u: SmUnit, image: SessionImage): ContainRecord {
  const after = upstreamAfter({ image: image.runtime_id }, u.repo_dir, u.base_commit);
  const rec: ContainRecord = { schema: "pf-contain.v1", unit: u.id, tag: image.tag, image_id: image.image_id, runtime_id: image.runtime_id, head: image.head, after_source: after.source, after: after.ids.length, ...containImage(image.tag, u.repo_dir, containInputs(unitDir, u, after.ids)) };
  const file = join(unitDir, CONTAIN_RECORD);
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { schema: string; checks: Record<string, ContainRecord> }) : { schema: "pf-contain.v1", checks: {} };
  all.checks[image.tag] = rec;
  writeFileSync(file + "." + process.pid, JSON.stringify(all, null, 1) + "\n");
  renameSync(file + "." + process.pid, file);
  return rec;
}

/** The gate before each session: a passing record for this session image's tag is reused, else checkUnit runs. A failure
 *  halts the unit with E_PF_CONTAINMENT before any session; the unit is not dropped, and the record stays for the Captain. */
export function containUnit(unitDir: string, u: SmUnit, image: SessionImage): ContainRecord {
  const file = join(unitDir, CONTAIN_RECORD);
  const prior = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { checks?: Record<string, ContainRecord> }).checks?.[image.tag] : undefined;
  const rec = prior?.ok ? prior : checkUnit(unitDir, u, image);
  if (!rec.ok) pfFail("E_PF_CONTAINMENT", u.id + ": the containment check failed on session image " + image.tag + " (" + rec.detail + "); the unit halts before any session and is not dropped; record " + file);
  return rec;
}
