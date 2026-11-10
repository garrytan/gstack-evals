// Copyright (c) 2026 Garry Tan. MIT License.
// sm-unit.v1, the state machines family's converted unit: one directory per dataset row with the fix, the fix's tests,
// the issue, the dataset's log parser and Harbor's run copy, and unit.json holding the row's fields as published plus
// each file's sha256. Unit dirs live outside the repository and are never committed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { classify, type Lang } from "./langs.ts";
import type { PrintReading } from "./reports.ts";
import { imageRef, patchFiles, type Candidate, type MlRow } from "./source.ts";

export const smFail = (code: ReasonCode, message: string): never => {
  throw new Error(code + " " + message);
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** exits: each rebuild and test command's exit status, in order. */
/** stale_deleted: untracked report files the run deleted at its start; stale_refused: report files it moved aside after the
 *  tests as not written by this run; built_nothing: why the run built nothing (testrun.ts BuiltNothing), or null;
 *  created_dirs: the report directories the run created at its start (testrun.ts TestRun). */
export interface OracleRun { tree: "base" | "fixed"; n: number; wall_ms: number; exit: number; parsed_sha256: string | null; stopped: boolean; exits?: number[]; stale_deleted?: number; stale_refused?: number; built_nothing?: string | null; stale_fresh?: number | null; created_dirs?: string[] }
/** A cargo unit's base-run target reading (oracle.ts targetReading): the targets each run reached, the fixed runs' targets
 *  no base run reached, and whether a base run printed cargo's fail-fast stop line. */
export interface TargetReading { base: string[][]; fixed: string[][]; not_on_base: string[]; fail_fast_stop: boolean; cargo_stopped_early: boolean }
export interface SmUnit {
  schema: "sm-unit.v1"; id: string; source: "live-multilang" | "rebench-r3a4"; revision: string; repo: string; pull_number: string;
  created_at: string; month: string; lang: Lang; base_commit: string;
  /** The repository dir and work dir, read from the image at prep (MultiLang images hold the repository at the image's
   *  work dir, mostly /testbed and sometimes /testbed/repo); empty until then. */
  repo_dir: string; work_dir: string;
  image: { ref: string; image_id: string | null; runtime_id: string | null };
  commands: { rebuild: string[]; test: string[]; print: string[] }; parser_sha256: string;
  fix: { files: string[]; all_files: string[]; added_lines_30: number; sha256: string }; test_patch: { files: string[]; sha256: string };
  tests: { f2p: string[]; p2p: string[] };
  scope: { dir: string; files: number; lines: number; widened: number } | null; file_scope: string[];
  strip: { removed: string[]; restored?: string[] } | null; labels: null | Record<string, unknown>;
  /** Set at prep (fixsplit.ts): fix-source.patch holds the fix's non-test hunks, fix-tests.patch the hunks wholly inside
   *  in-source test modules (applied only with test.patch); in_source_tests is true when that file is not empty. */
  split?: { in_source_tests: boolean; test_hunks: number; source_files: string[] };
  oracle: null | { runs: OracleRun[]; stable: string[]; stable_sha256: string; f2p?: string[]; f2p_removed?: { count: number; ids: string[]; reason: string }; f2p_flaky?: { count: number; ids: string[]; reason: string }; targets?: TargetReading; reason?: string; f2p_ok: boolean; max_wall_ms: number; verdict: string; smoke: { claude_version: string; egress_probe: string; verdict: string } | null; leak: { needles: number; hits: { path: string; needle_sha256: string }[] } | null; history: string | null; rebuild_rule?: { applies: boolean; fixed_rebuild_exits: number[][] } };
  files: Record<string, string>;
  /** The report paths read from the print command (reports.ts), recorded by the oracle. */
  reports?: PrintReading;
}

export const added30 = (patch: string): string[] =>
  patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).filter((l) => Array.from(l).length >= 30);

/** The row's strings as published, checked: non-empty F2P and P2P lists of strings, a 40-hex base commit, a pinned
 *  digest, non-empty patches and a parser that defines parser(). */
export function validateRow(row: MlRow, c: Candidate): void {
  const bad = (m: string) => smFail("E_SM_UNIT", row.instance_id + ": " + m);
  const list = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length > 0);
  if (!list(row.FAIL_TO_PASS) || !list(row.PASS_TO_PASS)) bad("FAIL_TO_PASS and PASS_TO_PASS must be non-empty lists of test ids");
  if (!/^[0-9a-f]{40}$/.test(row.base_commit)) bad("base_commit is not 40 hex");
  if (!c.image_digest || !/^sha256:[0-9a-f]{64}$/.test(c.image_digest)) bad("the image has no pinned sha256 digest");
  if (!row.patch?.startsWith("diff --git ") || !row.test_patch?.startsWith("diff --git ")) bad("patch and test_patch must be git diffs");
  if (!/^def parser\(/m.test(row.log_parser ?? "")) bad("log_parser defines no parser()");
  if (!Array.isArray(row.test_cmds) || !row.test_cmds.length) bad("test_cmds is empty");
}

const PAYLOAD = ["fix.patch", "test.patch", "issue.md", "parser.py", "harbor/task.toml", "harbor/environment/Dockerfile", "harbor/instruction.md"];

/** Writes one unit dir (exclusive: an existing dir refuses). */
export function writeUnit(dir: string, c: Candidate, row: MlRow): SmUnit {
  validateRow(row, c);
  if (existsSync(dir)) smFail("E_SM_UNIT", dir + " exists; convert writes a new unit dir");
  const ref = imageRef(c);
  const testFiles = patchFiles(row.test_patch);
  const all = patchFiles(row.patch);
  const tset = new Set(testFiles);
  const body: Record<string, string> = {
    "fix.patch": row.patch, "test.patch": row.test_patch, "issue.md": row.problem_statement, "parser.py": row.log_parser,
    "harbor/task.toml": ["version = \"1.0\"", "", "[metadata]", "id = " + JSON.stringify(row.instance_id), "", "[agent]", "timeout_sec = 5400", "", "[verifier]", "timeout_sec = 900", "", "[environment]", "docker_image = " + JSON.stringify(ref), ""].join("\n"),
    "harbor/environment/Dockerfile": "FROM " + ref + "\n",
    "harbor/instruction.md": row.problem_statement,
  };
  mkdirSync(dir, { recursive: true });
  for (const p of PAYLOAD) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body[p]!, { flag: "wx" });
  }
  const u: SmUnit = {
    schema: "sm-unit.v1", id: row.instance_id, source: c.source, revision: c.revision, repo: row.repo, pull_number: String(row.pull_number),
    created_at: c.created_at, month: c.month, lang: c.lang, base_commit: row.base_commit, repo_dir: "", work_dir: "",
    image: { ref, image_id: null, runtime_id: null },
    commands: { rebuild: row.rebuild_cmds ?? [], test: row.test_cmds, print: row.print_cmds ?? [] }, parser_sha256: sha(row.log_parser),
    fix: { files: all.filter((f) => classify(c.lang, f, tset) === "source"), all_files: all, added_lines_30: added30(row.patch).length, sha256: sha(row.patch) },
    test_patch: { files: testFiles, sha256: sha(row.test_patch) }, tests: { f2p: row.FAIL_TO_PASS, p2p: row.PASS_TO_PASS },
    scope: null, file_scope: all, strip: null, labels: null, oracle: null,
    files: Object.fromEntries(PAYLOAD.map((p) => [p, sha(body[p]!)])),
  };
  writeFileSync(join(dir, "unit.json"), JSON.stringify(u, null, 1) + "\n", { flag: "wx" });
  return u;
}

/** Reads a unit dir and checks every payload file against unit.json's digests. */
export function readUnit(dir: string): SmUnit {
  let u: SmUnit;
  try {
    u = JSON.parse(readFileSync(join(dir, "unit.json"), "utf8"));
  } catch (e) {
    return smFail("E_SM_UNIT", dir + "/unit.json is not readable: " + (e as Error).message);
  }
  if (u.schema !== "sm-unit.v1") smFail("E_SM_UNIT", dir + " is not an sm-unit.v1 dir");
  for (const p of [...PAYLOAD, ...Object.keys(u.files ?? {}).filter((k) => !PAYLOAD.includes(k))]) {
    const got = existsSync(join(dir, p)) ? sha(readFileSync(join(dir, p))) : "missing";
    if (got !== u.files[p]) smFail("E_SM_UNIT", dir + "/" + p + " is " + got + ", not unit.json's " + u.files[p]);
  }
  if (!u.tests.f2p.length || !u.tests.p2p.length || !/^[0-9a-f]{40}$/.test(u.base_commit) || !/@sha256:[0-9a-f]{64}$/.test(u.image.ref)) smFail("E_SM_UNIT", dir + ": unit.json fails its field checks");
  return u;
}

/** The fail-to-pass set every scorer reads: the oracle's, which drops dataset ids that pass on base with the fix's tests applied. */
export function oracleF2p(u: SmUnit): string[] {
  return u.oracle?.f2p ?? smFail("E_SM_UNIT", u.id + ": unit.json has no oracle fail-to-pass set; run the oracle again");
}

/** Rewrites unit.json after prep fills a field; the payload digests stay as written. */
/** Writes a prep-made unit file (fix-source.patch, fix-tests.patch) and records its digest in unit.json's files. */
export function addUnitFile(dir: string, u: SmUnit, name: string, body: string): void {
  writeFileSync(join(dir, name), body);
  u.files[name] = sha(body);
}

export const saveUnit = (dir: string, u: SmUnit): void => writeFileSync(join(dir, "unit.json"), JSON.stringify(u, null, 1) + "\n");
