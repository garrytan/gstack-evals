// Copyright (c) 2026 Garry Tan. MIT License.
// SR's second source (plan section 2): SWE-rebench V2.1 (ibragim-bad/SWE-rebench-V2.1, CC-BY-4.0), read keylessly from its
// six pinned parquet files, screened with #358's keyword screens, and turned into MultiLang's row shape so the state
// machines harness's unit, oracle and prep code run unchanged:
//   - test_cmds: the row's test_env exports, then its install_config.test_cmd, run from its workdir; no rebuild or print
//     command, as the SWE-rebench leaderboard rows read (statemachines/rebench.ts).
//   - log_parser: the row's standalone grader as SWE-rebench V2.1's own tool renders it (lib/harbor_tasks/task_files.py
//     grader_source at the pinned tool commit), with an adapter that defines parser(log) the way MultiLang's rows do,
//     matching each listed test id by the grader's own name rules.
// Nothing here calls a model.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Lang } from "../statemachines/langs.ts";
import { PYARROW, type MlRow } from "../statemachines/source.ts";
import { srFail } from "./errors.ts";

export const V21 = {
  dataset: "ibragim-bad/SWE-rebench-V2.1",
  revision: "26c0145ded93168b0d5d095420155901ad2d5a2f",
  files: {
    "train-00000-of-00006": "9a4a24b796d29498053380c876d8c1edbbad53d6c302b654b152aaf242f40c61",
    "train-00001-of-00006": "1a8fb567651234dec268b563a1b2d0ce5667355a25d179b236acf23f0fbf1026",
    "train-00002-of-00006": "3fc11913c660c2c4ad28b187bf48babf325046c2c81f7bbdb1bbfc5d40aa0020",
    "train-00003-of-00006": "313b5f447726a1dedc777d63bc21ebece9b7cd3a63a6f6c433c6a6c28172deff",
    "train-00004-of-00006": "87a3a548168a5fcebc7250561f02a42a9a21d6f1491e0a8abc07d42cc423c34c",
    "train-00005-of-00006": "4a111acda4b9be5479ffbf0217e5883e92dd43f9fe7e073685e2fb1f1684a897",
  } as Record<string, string>,
  tool: { repo: "https://github.com/SWE-rebench/SWE-rebench-V2.git", commit: "5792b7851d20bb30b60bf5841834cacd6ce07582", log_parsers_sha256: "9085f262d399ab47c2603e1ca85365953c6c3634607e461802f5c025e4733701", task_files_sha256: "ccea1ec84004ec4d0c08fd5e5f63b8e81ccf3f78d26af919a4907dce31b00c5f", grade_sha256: "2a609da368de1647de9c8323f1442c51691d7c2d9e2a7e5c6ceb63c3ad2897d8" },
};

/** V2.1's language names, mapped to the state machines harness's; a row in another language is out (it has no test patterns). */
export const V21_LANG: Record<string, Lang> = { python: "python", go: "go", ts: "ts", js: "js", rust: "rust", java: "java", c: "c", cpp: "cpp", csharp: "csharp" };

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** #358's keyword screens (its supply-count.py), unchanged: bug words in the issue's first 5,000 characters and no
 *  feature words in its first 800; a fix of 1 to 6 files; then state words in the issue or the fix's first 30,000. */
const BUG = /\b(bug|error|incorrect(ly)?|wrong|fails?|failing|failure|crash(es)?|exception|regression|broken|unexpected(ly)?|doesn'?t work|does not work|traceback|panic|not working)\b/i;
const FEAT = /\b(feature request|add support for|support for|would be nice|enhancement|proposal|new option|allow (users? )?to)\b/i;
const STATE = /(state machine|state transition|invalid state|wrong state|inconsistent state|stale (state|cache|data|value|entry)|race condition|already (closed|running|started|initiali[sz]ed|connected|exists|released|disposed|stopped)|not (reset|cleared|restored)|after (closing|close|cancel|cancell?ation|reconnect|retry|restart|reload|shutdown|disconnect|an error|failure)|\bstuck\b|\bhangs?\b|\btwice\b|double[- ](free|count|submit|fire|call|close)|idempot|re-?entran|out of order|lifecycle|life cycle|\bpending\b|in[- ]progress|is_running|is_closed|\bresume\b|\bretr(y|ies)\b)/i;
export function screened(r: { problem_statement?: string; patch?: string; image_name?: string; FAIL_TO_PASS?: string[]; PASS_TO_PASS?: string[] }): boolean {
  const ps = r.problem_statement ?? "", patch = r.patch ?? "";
  if (!r.image_name || !(r.FAIL_TO_PASS ?? []).length || !(r.PASS_TO_PASS ?? []).length) return false;
  if (!BUG.test(ps.slice(0, 5000)) || FEAT.test(ps.slice(0, 800))) return false;
  const n = new Set([...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1])).size;
  return n >= 1 && n <= 6 && STATE.test(ps.slice(0, 5000) + "\n" + patch.slice(0, 30000));
}

/** Downloads the pinned parquet files into cache when missing, checks each sha256 and converts each to JSON lines. */
export async function fetchV21(cache: string, fetchFn: typeof fetch = fetch): Promise<void> {
  mkdirSync(cache, { recursive: true });
  for (const [stem, want] of Object.entries(V21.files)) {
    const pq = join(cache, stem + ".parquet");
    if (!existsSync(pq)) {
      const url = "https://huggingface.co/datasets/" + V21.dataset + "/resolve/" + V21.revision + "/data/" + stem + ".parquet";
      const res = await fetchFn(url);
      if (!res.ok) srFail("E_SR_SOURCE", url + " answered " + res.status);
      writeFileSync(pq + ".part", Buffer.from(await res.arrayBuffer()));
      renameSync(pq + ".part", pq);
    }
    const got = sha(readFileSync(pq));
    if (got !== want) srFail("E_SR_SOURCE", pq + " has sha256 " + got + ", not the pinned " + want);
    const jl = join(cache, stem + ".jsonl");
    if (!existsSync(jl)) {
      const r = spawnSync("uv", ["run", "--no-project", "--with", "pyarrow==" + PYARROW, "python3", join(import.meta.dir, "../statemachines/parquet.py"), pq, jl], { encoding: "utf8", timeout: 600_000 });
      if (r.status !== 0) srFail("E_SR_SOURCE", "parquet.py could not read " + pq + ": " + (r.stderr ?? "").slice(-400));
    }
  }
}

export type V21Row = Record<string, any>;
/** Every row of the cached revision, checked against its pins on every read. */
export function v21Rows(cache: string): V21Row[] {
  const out: V21Row[] = [];
  for (const [stem, want] of Object.entries(V21.files)) {
    const pq = join(cache, stem + ".parquet");
    if (!existsSync(pq) || sha(readFileSync(pq)) !== want) srFail("E_SR_SOURCE", pq + " is missing or is not the pinned file; run sr source fetch");
    for (const line of readFileSync(join(cache, stem + ".jsonl"), "utf8").split("\n")) if (line) out.push(JSON.parse(line));
  }
  return out;
}

/** Clones the pinned tool commit into dir when missing and checks the three files the grader comes from. */
export function toolCheckout(dir: string): string {
  if (!existsSync(join(dir, ".git"))) {
    const c = spawnSync("git", ["clone", "--quiet", V21.tool.repo, dir], { encoding: "utf8", timeout: 600_000 });
    if (c.status !== 0) srFail("E_SR_SOURCE", "cloning " + V21.tool.repo + " failed: " + (c.stderr ?? "").slice(-300));
  }
  const co = spawnSync("git", ["-C", dir, "checkout", "--quiet", "--detach", V21.tool.commit], { encoding: "utf8" });
  if (co.status !== 0) srFail("E_SR_SOURCE", dir + " has no commit " + V21.tool.commit);
  const pins: Array<[string, string]> = [["lib/harbor_tasks/log_parsers.py", V21.tool.log_parsers_sha256], ["lib/harbor_tasks/task_files.py", V21.tool.task_files_sha256], ["lib/harbor_tasks/templates/grade.py", V21.tool.grade_sha256]];
  for (const [f, want] of pins) if (sha(readFileSync(join(dir, f))) !== want) srFail("E_SR_SOURCE", f + " at the tool pin is not the pinned file");
  return dir;
}

/** The row's standalone grader from the tool's own grader_source, run keylessly under uv. */
export function graderSource(tool: string, parser: string): string {
  const r = spawnSync("uv", ["run", "--no-project", "python3", "-c", "import sys; sys.path.insert(0, sys.argv[1]); from lib.harbor_tasks.task_files import grader_source; sys.stdout.write(grader_source(sys.argv[2]))", tool, parser], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) srFail("E_SR_SOURCE", "grader_source(" + parser + ") failed: " + (r.stderr ?? "").slice(-300));
  return r.stdout;
}

/** parser(log) on top of the grader: every status the grader parses (PASSED is pass, SKIPPED is skip, anything else is
 *  fail), then each listed id read by the grader's own name rules, so an id matches as the grader's grade() matches it. */
export function adapter(ids: string[]): string {
  return [
    "", "", "# Appended by SR's V2.1 converter: parser(log) for the oracle and the scorers.",
    "import json as _sr_json",
    "_SR_IDS = _sr_json.loads(" + JSON.stringify(JSON.stringify(ids)) + ")",
    "", "",
    "def parser(log: str) -> dict[str, str]:",
    "    results = parse_test_log(log)",
    "    out = {}",
    "    for status, names in results.items():",
    "        for n in names:",
    "            out[str(n)] = \"pass\" if status == \"PASSED\" else \"skip\" if status == \"SKIPPED\" else \"fail\"",
    "    passed = _actual_passed_aliases(_normalized_passed_names(results[\"PASSED\"]))",
    "    for t in _SR_IDS:",
    "        if all(_expected_name_satisfied(passed, x) for x in _normalized_passed_names({t})):",
    "            out[t] = \"pass\"",
    "        elif out.get(t) == \"pass\":",
    "            out[t] = \"fail\"",
    "    return out",
    "",
  ].join("\n");
}

/** One V2.1 row in MultiLang's row shape. */
export function v21Row(r: V21Row, tool: string): MlRow {
  const env = ((r.test_env ?? []) as Array<{ name: string; value: string }>).map((e) => "export " + e.name + "=" + e.value + "\n").join("");
  const cfg = r.install_config ?? {};
  if (!cfg.test_cmd || !cfg.log_parser) srFail("E_SR_SOURCE", r.instance_id + " has no test_cmd or log_parser");
  const ids = [...(r.FAIL_TO_PASS ?? []), ...(r.PASS_TO_PASS ?? [])];
  const pull = (String(r.instance_id).match(/-(\d+)(?:_[A-Za-z]+)?$/) ?? [])[1] ?? srFail("E_SR_SOURCE", "no pull number in " + r.instance_id);
  return {
    repo: r.repo, pull_number: pull, instance_id: r.instance_id, base_commit: r.base_commit, patch: r.patch ?? "", test_patch: r.test_patch ?? "",
    problem_statement: r.problem_statement ?? "", created_at: String(r.created_at), rebuild_cmds: [], test_cmds: [env + "cd " + r.workdir + "\n" + cfg.test_cmd], print_cmds: [],
    log_parser: graderSource(tool, cfg.log_parser) + adapter(ids), FAIL_TO_PASS: r.FAIL_TO_PASS ?? [], PASS_TO_PASS: r.PASS_TO_PASS ?? [], docker_image: r.image_name,
  };
}
