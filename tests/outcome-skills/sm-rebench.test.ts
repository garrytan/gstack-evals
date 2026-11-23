// Copyright (c) 2026 Garry Tan. MIT License.
// The SWE-rebench part of the state machines source on invented fixtures: a Harbor package of the leaderboard's shape
// (task.toml, environment/Dockerfile, instruction.md, solution/solve.sh, tests/test.sh, tests/config.json and
// tests/parser.py), a pool file of ids, months and digests, the conversion to sm-unit.v1 and the keyless screen.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treeDigest } from "../../quick/laneb/runner/materialize.ts";
import { rebenchCandidates, rebenchRow, REBENCH } from "../../lanes/outcome-skills/statemachines/rebench.ts";
import { screen } from "../../lanes/outcome-skills/statemachines/screen.ts";
import { readUnit, writeUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";

const D = (c: string) => "sha256:" + c.repeat(64);
const FIX = ["diff --git a/widget/counter.py b/widget/counter.py", "--- a/widget/counter.py", "+++ b/widget/counter.py", "@@ -1,2 +1,2 @@", " def reset(state):", "-    return state", "+    return {**state, \"count\": 0, \"reason\": \"reset by the caller\"}", ""].join("\n");
const TESTP = ["diff --git a/tests/test_counter.py b/tests/test_counter.py", "--- a/tests/test_counter.py", "+++ b/tests/test_counter.py", "@@ -1 +1,3 @@", " import widget", "+def test_reset():", "+    assert widget.reset({\"count\": 3})[\"count\"] == 0", ""].join("\n");

const PARSER = [
  "import json",
  "import re",
  "def _lookup(results, key):",
  "    return results.get(key) or results.get(re.sub(r'\\s+\\(\\d+ms\\)$', '', key))",
  "def parse_lines(log):",
  "    out = {}",
  "    for line in log.splitlines():",
  "        parts = line.split()",
  "        if len(parts) == 2 and parts[0] in ('PASSED', 'FAILED', 'ERROR', 'SKIPPED', 'XFAIL'):",
  "            out[parts[1]] = parts[0]",
  "    return out",
  "def _select_parser_for_config(config):",
  "    return parse_lines",
  "if __name__ == '__main__':",
  "    raise SystemExit('the grader')",
  "",
].join("\n");

const TEST_SH = (line: string) => [
  "#!/bin/bash",
  "set -euo pipefail",
  "activate_testbed_env() {",
  "    export PATH=\"/opt/env/widget/bin:$PATH\"",
  "}",
  "cd /testbed",
  "cat > /tmp/test_patch.diff << '__HARBOR_TEST_PATCH__'",
  TESTP.trimEnd(),
  "__HARBOR_TEST_PATCH__",
  "git apply /tmp/test_patch.diff || true",
  "exec 3>&1 4>&2",
  "exec > >(tee \"$LOG_FILE\") 2>&1",
  "",
  "set +x",
  "activate_testbed_env",
  line,
  "exec 1>&3 2>&4",
  "python3 /tests/parser.py",
  "",
].join("\n");

function pkg(root: string, id: string, over: { created?: string; issue?: string; f2p?: string[]; testLine?: string } = {}): string {
  const d = join(root, id);
  for (const s of ["environment", "solution", "tests"]) mkdirSync(join(d, s), { recursive: true });
  writeFileSync(join(d, "task.toml"), "[verifier]\ntimeout_sec = 3000\n\n[agent]\ntimeout_sec = 3000\n\n[environment]\ncpus = 1\nmemory = '8G'\nstorage = '16G'\n");
  writeFileSync(join(d, "environment/Dockerfile"), "FROM example/sweb.eval.x86_64." + id.toLowerCase() + ":latest\nRUN mkdir -p /logs\n");
  writeFileSync(join(d, "instruction.md"), over.issue ?? "Resetting a counter keeps the old count.\n");
  writeFileSync(join(d, "solution/solve.sh"), "#!/bin/bash\ngit apply <<'X'\n" + FIX + "X\n");
  writeFileSync(join(d, "tests/test.sh"), TEST_SH(over.testLine ?? "pytest -rA tests/test_counter.py -v || true"));
  writeFileSync(join(d, "tests/parser.py"), PARSER);
  writeFileSync(join(d, "tests/config.json"), JSON.stringify({
    repo: "example-org/widget", instance_id: id, base_commit: "a".repeat(40), patch: FIX, test_patch: TESTP,
    problem_statement: over.issue ?? "Resetting a counter keeps the old count.\n", created_at: (over.created ?? "2026-04") + "-02 10:00:00",
    FAIL_TO_PASS: over.f2p ?? ["tests/test_counter.py::test_reset"], PASS_TO_PASS: ["tests/test_counter.py::test_import"],
    install_config: { log_parser: "parse_log_pytest", test_cmd: "pytest -rA tests/test_counter.py" }, docker_image: "example/sweb.eval.x86_64." + id.toLowerCase() + ":latest",
  }));
  return d;
}

function pool(root: string, ids: [string, string][]): { path: string; sha: string } {
  const tasks = ids.map(([id, created]) => ({ task_id: id, created, repo: "example-org/widget", hub_ref: "sha256:" + treeDigest(join(root, id)), digest: "sha256:" + treeDigest(join(root, id)), digest_files: 7, image: "example/sweb.eval.x86_64." + id.toLowerCase() + ":latest", image_digest: D("e") }));
  const body = JSON.stringify({ dataset: { name: REBENCH.dataset, version: REBENCH.version }, tasks });
  const path = join(root, "pool.json");
  writeFileSync(path, body);
  return { path, sha: createHash("sha256").update(body).digest("hex") };
}

describe("SWE-rebench part of the state machines source", () => {
  test("a Harbor package converts to a row: the fix, the fix's tests, the package's own test command and parser", () => {
    const root = mkdtempSync(join(tmpdir(), "sm-rb-"));
    const d = pkg(root, "example-org__widget-7");
    const t = { task_id: "example-org__widget-7", created: "2026-04", digest: "sha256:" + treeDigest(d), image: "example/sweb.eval.x86_64.example-org__widget-7:latest", image_digest: D("e") };
    const row = rebenchRow(d, t);
    expect(row).toMatchObject({ instance_id: "example-org__widget-7", repo: "example-org/widget", pull_number: "7", base_commit: "a".repeat(40), patch: FIX, test_patch: TESTP, rebuild_cmds: [], print_cmds: [] });
    expect(row.test_cmds).toEqual(["activate_testbed_env() {\n    export PATH=\"/opt/env/widget/bin:$PATH\"\n}\nactivate_testbed_env\npytest -rA tests/test_counter.py -v || true"]);
    expect(row.log_parser.startsWith(PARSER)).toBe(true);
    expect(row.log_parser).toMatch(/^def parser\(/m);
    const i8 = pkg(root, "example-org__widget-8_interface");
    expect(rebenchRow(i8, { ...t, task_id: "example-org__widget-8_interface", digest: "sha256:" + treeDigest(i8) }).pull_number).toBe("8");
    expect(() => rebenchRow(d, { ...t, digest: D("0") })).toThrow(/^E_SM_SOURCE .*digest/);
    const bad = pkg(root, "example-org__widget-9");
    writeFileSync(join(bad, "tests/test.sh"), "#!/bin/bash\npytest\n");
    expect(() => rebenchRow(bad, { ...t, task_id: "example-org__widget-9", digest: "sha256:" + treeDigest(bad) })).toThrow(/^E_SM_SOURCE .*test command/);
  });

  test("the adapted parser keeps the package's lookup and writes the oracle's pass, fail and skip words", () => {
    const root = mkdtempSync(join(tmpdir(), "sm-rb-"));
    const d = pkg(root, "example-org__widget-7", { f2p: ["tests/test_counter.py::test_reset (12ms)", "tests/test_counter.py::test_gone"] });
    const row = rebenchRow(d, { task_id: "example-org__widget-7", created: "2026-04", digest: "sha256:" + treeDigest(d), image: "x:latest", image_digest: D("e") });
    const log = "PASSED tests/test_counter.py::test_reset\nXFAIL tests/test_counter.py::test_import\nFAILED tests/test_counter.py::test_other\nSKIPPED tests/test_counter.py::test_slow\n";
    const py = "import json, sys\nd = json.load(sys.stdin)\ng = {'__name__': 'dataset_parser'}\nexec(compile(d['src'], 'parser.py', 'exec'), g)\nprint(json.dumps(g['parser'](d['log']), sort_keys=True))\n";
    const r = spawnSync("python3", ["-c", py], { input: JSON.stringify({ src: row.log_parser, log }), encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      "tests/test_counter.py::test_reset": "pass", "tests/test_counter.py::test_reset (12ms)": "pass", "tests/test_counter.py::test_import": "pass",
      "tests/test_counter.py::test_other": "fail", "tests/test_counter.py::test_slow": "skip",
    });
  });

  test("the pool's window becomes candidates, screened with the same keyless rules, and converts to sm-unit.v1", async () => {
    const root = mkdtempSync(join(tmpdir(), "sm-rb-"));
    pkg(root, "example-org__widget-1", { created: "2026-02" });
    pkg(root, "example-org__widget-2", { created: "2026-03" });
    pkg(root, "example-org__widget-3", { created: "2026-05", issue: "Feature request: a reset that keeps history.\n" });
    pkg(root, "example-org__widget-4", { created: "2026-05" });
    const p = pool(root, [["example-org__widget-1", "2026-02"], ["example-org__widget-2", "2026-03"], ["example-org__widget-3", "2026-05"], ["example-org__widget-4", "2026-05"]]);
    const heads: string[] = [];
    const fetchFn = (async (u: string, init?: RequestInit) => {
      if (String(u).startsWith("https://auth.docker.io")) return new Response(JSON.stringify({ token: "t" }));
      heads.push((init?.method ?? "GET") + " " + u);
      if (String(u).includes("widget-4")) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { "docker-content-digest": D("e") } });
    }) as unknown as typeof fetch;
    const cands = await rebenchCandidates(root, { pool: p.path, poolSha: p.sha, fetchFn });
    expect(cands.map((c) => c.id)).toEqual(["example-org__widget-2", "example-org__widget-3", "example-org__widget-4"]);
    expect(cands[0]).toMatchObject({ source: "rebench-r3a4", revision: REBENCH.version, lang: "python", month: "2026-03", image_digest: D("e"), f2p: 1, p2p: 1, fix_source_files: 1 });
    expect(cands[0]!.package).toEqual({ digest: "sha256:" + treeDigest(join(root, "example-org__widget-2")) });
    expect(cands[2]!.image_error).toMatch(/404/);
    expect(heads.length).toBe(3);
    expect(heads.every((h) => h.startsWith("HEAD ") && h.endsWith("/manifests/" + D("e")))).toBe(true);
    const s = screen(cands);
    expect(s.eligible.map((e) => e.id)).toEqual(["example-org__widget-2"]);
    expect(s.by_rule).toEqual({ feature_request_screen: 1, image_digest: 1 });
    await expect(rebenchCandidates(root, { pool: p.path, poolSha: "0".repeat(64), fetchFn })).rejects.toThrow(/^E_SM_SOURCE .*sha256/);
    const dir = join(root, "units", "example-org__widget-2");
    const u = writeUnit(dir, cands[0]!, rebenchRow(join(root, "example-org__widget-2"), { task_id: "example-org__widget-2", created: "2026-03", digest: cands[0]!.package!.digest, image: "", image_digest: D("e") }));
    expect(u).toMatchObject({ source: "rebench-r3a4", revision: REBENCH.version, lang: "python", image: { ref: "example/sweb.eval.x86_64.example-org__widget-2@" + D("e") }, fix: { files: ["widget/counter.py"] }, test_patch: { files: ["tests/test_counter.py"] } });
    expect(readUnit(dir).source).toBe("rebench-r3a4");
    expect(readFileSync(join(dir, "parser.py"), "utf8")).toMatch(/^def parser\(/m);
  });
});
