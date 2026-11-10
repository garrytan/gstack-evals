// Copyright (c) 2026 Garry Tan. MIT License.
// The object-level containment check (C1, the Captain's scope of 2026-11-10, after GEVA-503 found the upstream fix and its
// tests behind git tags past the base in 12 of 40 SWE-rebench images). It runs sh/contain.sh inside each built session
// image, as the session sees it, before any session: (a) every ref names the base or an ancestor, (b) every commit object
// does, (c) no other object store exists but A3's gstack checkout at the /qa pin, and (d) no file outside the repo holds a
// hidden test name (a FAIL_TO_PASS leaf name the base tree never names) or a marker (a line of 30 code points or more that
// test.patch or fix-tests.patch adds and no base file holds). A hit keeps the path and the sha256, never the text.
// Compressed archives outside the repo are listed by path, never failed. Any failed check is E_SM_CONTAIN: the unit halts
// before any session and is not dropped.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker } from "../../real-outcome/task/docker.ts";
import { sh } from "./history.ts";
import { runName } from "./testrun.ts";
import { added30, readUnit, smFail, type SmUnit } from "./unit.ts";

export const CONTAIN_SCRIPT = sh("contain.sh");
export type ContainCheck = "refs" | "objects" | "stores" | "scan";
export interface ContainResult { ok: boolean; checks: Record<ContainCheck, { ok: boolean; findings: string[] }>; archives: string[] }
export interface ContainInput { want: string; names: string[]; markers: string[]; qaPin?: string }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

/** A test id's leaf name: pytest params dropped, a JUnit "name(Class)" read as name, then the last part after ::, " > ",
 *  # or /, and after the last dot when the part has no space (Class.method). */
export function leafName(id: string): string {
  const s = id.replace(/\[[^\]]*\]$/, "").replace(/^([^(\s]+)\(.*\)$/, "$1");
  const last = s.split(/::| > |#|\//).filter(Boolean).pop() ?? s;
  return /\s/.test(last) ? last : last.split(".").pop()!;
}

/** The unit's hidden test names and markers before the base-tree filter, which runs inside the image. */
export function containInputs(unitDir: string): { names: string[]; markers: string[] } {
  const u = readUnit(unitDir);
  const patch = (n: string) => (existsSync(join(unitDir, n)) ? readFileSync(join(unitDir, n), "utf8") : "");
  return { names: [...new Set(u.tests.f2p.map(leafName).filter(Boolean))], markers: [...new Set([...added30(patch("test.patch")), ...added30(patch("fix-tests.patch"))])] };
}

/** Reads contain.sh's lines into the result; test text never leaves this function, only its sha256. */
export function parseContain(stdout: string): ContainResult {
  const f: Record<ContainCheck, string[]> = { refs: [], objects: [], stores: [], scan: [] };
  const seen = new Set<string>();
  const archives: string[] = [];
  for (const l of stdout.split("\n")) {
    const [k, a = "", b = "", c = ""] = l.split(" ");
    if (k === "CHECK") seen.add(a);
    else if (k === "REF") f.refs.push(b64(a) + " " + b);
    else if (k === "OBJ") f.objects.push(a);
    else if (k === "STORE") f.stores.push(a + " " + b64(b));
    else if (k === "HIT") f.scan.push(a + " " + b64(b) + " sha256=" + sha(b64(c)));
    else if (k === "ARCHIVE") archives.push(b64(a));
  }
  const checks = Object.fromEntries((Object.keys(f) as ContainCheck[]).map((k) => {
    const findings = [...new Set(f[k])].sort();
    return [k, { ok: seen.has(k) && findings.length === 0, findings }];
  })) as ContainResult["checks"];
  return { ok: Object.values(checks).every((c) => c.ok), checks, archives: archives.sort() };
}

/** Runs the check on a host fixture root (tests) or inside a built session image, with the image's own env. */
export function contain(where: { kind: "host"; root: string; repo: string } | { kind: "docker"; image: string; repoDir: string }, i: ContainInput): ContainResult {
  const inDir = mkdtempSync(join(tmpdir(), "sm-contain-"));
  try {
    const files: Record<string, string> = { want: i.want + "\n", names: i.names.join("\n") + (i.names.length ? "\n" : ""), markers: i.markers.join("\n") + (i.markers.length ? "\n" : ""), qa_pin: i.qaPin ?? "" };
    for (const [n, body] of Object.entries(files)) writeFileSync(join(inDir, n), body);
    if (where.kind === "host") {
      const r = spawnSync("bash", ["-c", CONTAIN_SCRIPT, "bash", where.repo, inDir, where.root], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
      if (r.status !== 0) throw new Error("E_SM_CONTAIN the check did not run: exit " + r.status + " " + (r.stderr ?? "").slice(-300));
      return parseContain(r.stdout);
    }
    const r = docker(["run", "--rm", "--name", runName("contain"), "--network", "none", "--user", "0:0", "-v", inDir + ":/sm-in:ro", "--entrypoint", "bash", where.image, "-c", CONTAIN_SCRIPT, "bash", where.repoDir, "/sm-in", "/"], { timeoutMs: 1_800_000 });
    if (r.status !== 0) throw new Error("E_SM_CONTAIN the check did not run in " + where.image + ": exit " + r.status + " " + r.stderr.slice(-300));
    return parseContain(r.stdout);
  } finally {
    rmSync(inDir, { recursive: true, force: true });
  }
}

/** The check on one built session image: want is the head the build recorded (the two-commit head on a follow-on). */
export function containImage(image: { image_id: string; head: string }, u: SmUnit, unitDir: string, qaPin?: string): ContainResult {
  return contain({ kind: "docker", image: image.image_id, repoDir: u.repo_dir }, { want: image.head, ...containInputs(unitDir), ...(qaPin ? { qaPin } : {}) });
}

/** Halts the unit (E_SM_CONTAIN) when any check failed, naming each failed check and its findings (never test text). */
export function assertContained(label: string, r: ContainResult): void {
  if (r.ok) return;
  const failed = Object.entries(r.checks).filter(([, c]) => !c.ok).map(([k, c]) => k + " (" + c.findings.length + ": " + c.findings.slice(0, 5).join(", ") + (c.findings.length > 5 ? ", ..." : "") + ")");
  smFail("E_SM_CONTAIN", label + " fails the containment check before any session: " + failed.join("; ") + "; the unit halts, is not dropped, and goes to the Captain");
}
