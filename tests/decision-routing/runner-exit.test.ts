// Copyright (c) 2026 Garry Tan. MIT License.
// labels/runner-exit.ts against the frozen Python rule it ports (dr_agent/rules_parser.py is_runner_exit), command by command.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isRunnerExit } from "../../lanes/decision-routing/labels/runner-exit.ts";

const COMMANDS = ["pytest", "pytest tests/x.py -k 'a|b'", "py.test -x", "tox -e py311", "nox", "python -m pytest -q", "python3 -m pytest -q tests", "python3.11 -m unittest discover", "/usr/bin/python3 -m pytest", "./venv/bin/pytest a.py", "cd /testbed && pytest", "cd /testbed && python -m pytest -x 2>&1", "pytest > out.txt 2>&1", "pytest &> log", "pytest 2>&1", "pytest | tail", "pytest |& tee log", "pytest; echo $?", "pytest || true", "pytest && echo ok", "true && pytest", "cd a && cd b && pytest", "cd && pytest", "pytest &", "(pytest)", "pytest $(ls tests)", "pytest `ls`", "pytest \"$(ls)\"", "pytest <<EOF", "pytest 'unbalanced", "python -m pip install x", "python -c 'import pytest'", "make test", "./tests/runtests.py queries", "PYTHONPATH=. pytest", "sudo pytest", "pytest\npytest", "pytest 2>&-", "pytest >&2", "pytest >& log", "pytest \\\n -x", ""];

test("the TypeScript port answers every table command as the frozen Python rule does", () => {
  const script = "import importlib.util as u, json, sys\ns = u.spec_from_file_location('rp', sys.argv[1])\nm = u.module_from_spec(s)\ns.loader.exec_module(m)\nprint(json.dumps([m.is_runner_exit(c) for c in json.load(sys.stdin)]))";
  const r = spawnSync("python3", ["-c", script, join(import.meta.dir, "../../lanes/decision-routing/agent/dr_agent/rules_parser.py")], { input: JSON.stringify(COMMANDS), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  expect(r.stderr).toBe("");
  const py: boolean[] = JSON.parse(r.stdout);
  expect(COMMANDS.map((c) => [c, isRunnerExit(c)])).toEqual(COMMANDS.map((c, i) => [c, py[i]]));
  expect(py.filter(Boolean).length).toBeGreaterThan(10);
});
