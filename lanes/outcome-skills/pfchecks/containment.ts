// Copyright (c) 2026 Garry Tan. MIT License.
// The containment check, run before any paid session: the session's workspace holds nothing from the fix commit or after.
// It runs sh/contain.sh in a container of the session image the sessions use (Harbor's task directory holds only a
// Dockerfile FROM that image, task.toml and instruction.md, and the compose overlay adds the tools volume, the pstack
// volume and the Claude binary, read-only), as root, with no network. It checks (a) every ref, tag, remote, note, replace
// ref, stash, packed ref, FETCH_HEAD, ORIG_HEAD and reflog entry points at the base commit or an ancestor; (b) every commit
// object is the base or an ancestor; (c) no alternates, gitfile, submodule store or nested .git, tracked files equal the
// base commit, and no other git directory on the filesystem holds the dataset's base commit (a clone of the repository);
// (d) no file outside the repository, and no untracked or ignored file inside it, holds a hidden marker: a line of 30 code
// points or more that the fix or the test patch adds and no base file holds as a line (whole lines, as the leak scan), or
// the leaf name of a hidden fail-to-pass test, 12 characters or more, that no tracked base file holds (fixed strings).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerRun } from "../../real-outcome/task/docker.ts";
import { runName } from "../statemachines/testrun.ts";
import { added30, type SmUnit } from "../statemachines/unit.ts";

export const CONTAIN_SCRIPT = readFileSync(join(import.meta.dir, "sh", "contain.sh"), "utf8");
const MUST_ZERO = ["bad_refs", "bad_commits", "alternates", "gitfile", "modules", "nested", "tracked_changed", "clones", "hits"];

/** A test id's leaf: the part after the last " :: ", "::", "#" or "/", or after the last "." of a dotted identifier, with a
 *  trailing argument list, index or " - should panic" cut. */
export function leafName(id: string): string {
  const parts = id.split(/\s+::\s+|::|#|\//);
  const leaf = parts[parts.length - 1]!.replace(/\s+-\s+should panic.*$/, "").replace(/(\([^)]*\)|\[[^\]]*\])+$/, "").trim();
  return parts.length === 1 && /^[\w$.]+$/.test(leaf) ? leaf.slice(leaf.lastIndexOf(".") + 1) : leaf;
}

/** The script's input files: the candidate lines, the candidate names and the dataset's base commit. */
export function containInputs(unitDir: string, u: Pick<SmUnit, "base_commit" | "tests">): Record<string, string> {
  const patches = ["fix.patch", "test.patch"].map((f) => readFileSync(join(unitDir, f), "utf8"));
  const lines = [...new Set(patches.flatMap(added30))].filter((l) => !l.includes("\r"));
  const names = [...new Set(u.tests.f2p.map(leafName))].filter((n) => n.length >= 12).sort();
  return { lines: lines.join("\n") + "\n", names: names.join("\n") + "\n", upstream: u.base_commit + "\n" };
}

export interface ContainResult { ok: boolean; summary: Record<string, string>; findings: string[]; detail: string }

export function readContain(out: string): ContainResult {
  const lines = out.split("\n").filter((l) => l.startsWith("PF_CONTAIN ")).map((l) => l.slice(11));
  const s = lines.find((l) => l.startsWith("summary "));
  const summary = Object.fromEntries((s ?? "").slice(8).split(" ").filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
  const findings = lines.filter((l) => l !== "done" && !l.startsWith("summary "));
  const done = lines.includes("done");
  const ok = done && !!s && Number(summary.commits) >= 1 && MUST_ZERO.every((k) => summary[k] === "0") && !findings.some((f) => f.startsWith("error"));
  const detail = (done ? "" : "the check did not finish; ") + (s ?? "no summary") + (findings.length ? "; " + findings.slice(0, 12).join("; ") + (findings.length > 12 ? "; and " + (findings.length - 12) + " more" : "") : "");
  return { ok, summary, findings, detail };
}

function withInputs<T>(inputs: Record<string, string>, f: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pf-contain-"));
  try {
    for (const [n, body] of Object.entries(inputs)) writeFileSync(join(dir, n), body);
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The check on a host directory tree (tests): repo inside root. */
export function containHost(repo: string, inputs: Record<string, string>, root: string): ContainResult {
  return withInputs(inputs, (dir) => readContain(spawnSync("bash", ["-c", CONTAIN_SCRIPT, "bash", repo, dir, root], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600_000 }).stdout ?? ""));
}

/** The check in a container of the session image, as root, with no network. */
export function containImage(image: string, repoDir: string, inputs: Record<string, string>): ContainResult {
  return withInputs(inputs, (dir) => {
    const r = dockerRun(runName("pf-contain"), ["--rm", "--network", "none", "--user", "0:0", "-v", dir + ":/pf-contain-in:ro", "--entrypoint", "bash", image, "-c", CONTAIN_SCRIPT, "bash", repoDir, "/pf-contain-in", "/"], { timeoutMs: 3_600_000 });
    const res = readContain(r.stdout);
    return r.status === 0 ? res : { ...res, ok: false, detail: "exit " + r.status + ": " + res.detail + (r.stderr ? "; " + r.stderr.slice(-300) : "") };
  });
}
