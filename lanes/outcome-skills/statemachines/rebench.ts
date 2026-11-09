// Copyright (c) 2026 Garry Tan. MIT License.
// The SWE-rebench part of the state machines source (post section 3): the leaderboard pool this repository pins
// (quick/laneb/tasks/swerebench-r3a4.json, read with loadRebenchPool against R3A4_POOL_SHA256), restricted to tasks
// created from 2026-03. The pool holds ids, months and digests only, so each task's fields come from its Harbor package
// (the pinned Harbor's export of swe-rebench/swe-rebench-leaderboard at the pool's version), checked first against the
// pool's digest with materialize.ts treeDigest. tests/config.json gives the fix, the fix's tests, the fail-to-pass and
// pass-to-pass lists, the issue and the base commit. tests/test.sh gives the test command as published: its environment
// activation function and its test line. tests/parser.py is the package's log parser, kept byte for byte, with an adapter
// appended that defines parser(log) the way MultiLang's rows do. The image is the pool's, pinned by digest; a registry
// HEAD by that digest (not a counted pull) checks that it still resolves.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRebenchPool, R3A4_POOL_SHA256, treeDigest, type RebenchTask } from "../../../quick/laneb/runner/materialize.ts";
import { ACCEPT, splitImage, toCandidate, token, WINDOW_START, type Candidate, type MlRow } from "./source.ts";
import { smFail } from "./unit.ts";

export const REBENCH = {
  dataset: "swe-rebench/swe-rebench-leaderboard",
  version: "sha256:ebe7444e313a0d8db94fa541139826eaebe2b0abcd4900c6f73e750494910dca",
  pool: join(import.meta.dir, "../../../quick/laneb/tasks/swerebench-r3a4.json"),
  pool_sha256: R3A4_POOL_SHA256,
};

export type PoolTask = Pick<RebenchTask, "task_id" | "created" | "digest" | "image" | "image_digest">;

/** The pool's tasks, read against the pinned sha256, with the package version the pool names checked. */
export function rebenchPool(pool = REBENCH.pool, poolSha = REBENCH.pool_sha256): PoolTask[] {
  try {
    const tasks = loadRebenchPool(pool, poolSha);
    const version = (JSON.parse(readFileSync(pool, "utf8")) as { dataset?: { version?: string } }).dataset?.version;
    if (version !== REBENCH.version) throw new Error(pool + " names package version " + version + ", not " + REBENCH.version);
    return tasks;
  } catch (e) {
    return smFail("E_SM_SOURCE", (e as Error).message);
  }
}

const sm = (s: unknown) => JSON.stringify(JSON.stringify(s));

/** The adapter appended to the package's parser.py: parser(log) runs the package's own parser selection, then its own id
 *  lookup for every listed test, so an id matches as the package's grader matches it. PASSED and XFAIL are "pass" (the
 *  grader counts both as passing), SKIPPED is "skip", every other status is "fail". */
function adapter(config: unknown, ids: string[]): string {
  return [
    "",
    "",
    "# Appended by the state machines converter: parser(log) for the oracle and the scorers.",
    "import json as _sm_json",
    "_SM_CONFIG = _sm_json.loads(" + sm(config) + ")",
    "_SM_IDS = _sm_json.loads(" + sm(ids) + ")",
    "_SM_WORDS = {\"PASSED\": \"pass\", \"XFAIL\": \"pass\", \"SKIPPED\": \"skip\"}",
    "",
    "",
    "def parser(log: str) -> dict[str, str]:",
    "    raw = _select_parser_for_config(_SM_CONFIG)(log)",
    "    out = {str(k): _SM_WORDS.get(v, \"fail\") for k, v in raw.items()}",
    "    for t in _SM_IDS:",
    "        v = _lookup(raw, t)",
    "        if v is not None:",
    "            out[t] = _SM_WORDS.get(v, \"fail\")",
    "    return out",
    "",
  ].join("\n");
}

/** One task's row from its Harbor package dir, in MultiLang's row shape. Refuses (E_SM_SOURCE) when the dir is not the
 *  pool's digest, the config is not this task, or test.sh or parser.py is not in the package's form. */
export function rebenchRow(dir: string, t: PoolTask): MlRow {
  const bad = (m: string): never => smFail("E_SM_SOURCE", t.task_id + ": " + m);
  if (!existsSync(join(dir, "tests", "config.json"))) bad(dir + " is not a Harbor package dir");
  const digest = "sha256:" + treeDigest(dir);
  if (digest !== t.digest) bad(dir + " has digest " + digest + ", not the pool's " + t.digest);
  const cfg = JSON.parse(readFileSync(join(dir, "tests", "config.json"), "utf8")) as Record<string, unknown>;
  if (cfg.instance_id !== t.task_id) bad("tests/config.json is " + String(cfg.instance_id));
  const list = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : bad("FAIL_TO_PASS and PASS_TO_PASS must be lists"));
  const f2p = list(cfg.FAIL_TO_PASS), p2p = list(cfg.PASS_TO_PASS);
  const sh = readFileSync(join(dir, "tests", "test.sh"), "utf8");
  const tail = sh.slice(sh.lastIndexOf("__HARBOR_TEST_PATCH__"));
  const line = (tail.match(/\nset \+x\nactivate_testbed_env\n([^\n]+)\nexec 1>&3 2>&4\n/) ?? [])[1];
  const fn = (sh.match(/^activate_testbed_env\(\) \{\n[\s\S]*?\n\}$/m) ?? [])[0];
  if (!line || !fn) bad("tests/test.sh has no test command in the package's form (activate_testbed_env, then one test line)");
  const src = readFileSync(join(dir, "tests", "parser.py"), "utf8");
  if (!/^def _lookup\(/m.test(src) || !/^def _select_parser_for_config\(/m.test(src)) bad("tests/parser.py has no _lookup or _select_parser_for_config");
  const pull = (t.task_id.match(/-(\d+)(?:_[A-Za-z]+)?$/) ?? [])[1] ?? bad("no pull number in the task id");
  return {
    repo: String(cfg.repo), pull_number: pull, instance_id: t.task_id, base_commit: String(cfg.base_commit), patch: String(cfg.patch ?? ""),
    test_patch: String(cfg.test_patch ?? ""), problem_statement: String(cfg.problem_statement ?? ""), created_at: String(cfg.created_at),
    rebuild_cmds: [], test_cmds: [fn + "\nactivate_testbed_env\n" + line], print_cmds: [],
    log_parser: src + (src.endsWith("\n") ? "" : "\n") + adapter({ install_config: cfg.install_config ?? null, language: cfg.language ?? null }, [...f2p, ...p2p]),
    FAIL_TO_PASS: f2p, PASS_TO_PASS: p2p, docker_image: t.image,
  };
}

/** One task's row by id from the export root (the dir holding one package dir per task). */
export function rebenchRowById(exportRoot: string, id: string, pool = REBENCH.pool, poolSha = REBENCH.pool_sha256): MlRow {
  const t = rebenchPool(pool, poolSha).find((x) => x.task_id === id) ?? smFail("E_SM_SOURCE", id + " is not a task of the pinned pool");
  return rebenchRow(join(exportRoot, id), t);
}

/** Whether the image's pinned digest still resolves: a registry HEAD by digest that answers that digest. */
async function resolves(image: string, digest: string, fetchFn: typeof fetch): Promise<void> {
  const { repo } = splitImage(image);
  const h = await fetchFn("https://registry-1.docker.io/v2/" + repo + "/manifests/" + digest, { method: "HEAD", headers: { Authorization: "Bearer " + (await token(repo, fetchFn)), Accept: ACCEPT } });
  if (!h.ok) throw new Error("HEAD " + h.status);
  if (h.headers.get("docker-content-digest") !== digest) throw new Error("HEAD answered digest " + h.headers.get("docker-content-digest"));
}

/** sm source rebench: the pool's tasks created from the window's first month, each a candidate of ids and counts. */
export async function rebenchCandidates(exportRoot: string, o: { pool?: string; poolSha?: string; fetchFn?: typeof fetch } = {}): Promise<Candidate[]> {
  const from = WINDOW_START.slice(0, 7);
  const out: Candidate[] = [];
  for (const t of rebenchPool(o.pool, o.poolSha).filter((x) => x.created >= from)) {
    const row = rebenchRow(join(exportRoot, t.task_id), t);
    if (row.created_at.slice(0, 7) !== t.created) smFail("E_SM_SOURCE", t.task_id + ": created_at " + row.created_at + " is not the pool's month " + t.created);
    const c: Candidate = { ...toCandidate("python", row), source: "rebench-r3a4", revision: REBENCH.version, package: { digest: t.digest } };
    try {
      await resolves(t.image, t.image_digest, o.fetchFn ?? fetch);
      c.image_digest = t.image_digest;
    } catch (e) {
      c.image_error = (e as Error).message;
    }
    out.push(c);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
