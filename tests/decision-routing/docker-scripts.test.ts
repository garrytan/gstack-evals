// Copyright (c) 2026 Garry Tan. MIT License.
// The Docker-tier scripts under tests/decision-routing/docker run only on a runner VM with Docker and real task images,
// so no keyless suite executes them. This test keeps them parseable: bash -n on the shell scripts and an ast parse of the
// Python files, which needs no Harbor, Docker or task image.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SHELL = ["tests/decision-routing/docker/docker_tier.sh", "tests/decision-routing/docker/nonroot.sh"];
const PYTHON = [
  "tests/decision-routing/docker/nonroot_probe.py",
  "tests/decision-routing/docker/oracle_agent.py",
  "tests/decision-routing/docker/oracle_probe.py",
];

test.each(SHELL)("%s parses under bash -n", (path) => {
  const r = spawnSync("bash", ["-n", join(ROOT, path)], { encoding: "utf8" });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test.each(PYTHON)("%s parses as Python", (path) => {
  const r = spawnSync("python3", ["-c", "import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])", join(ROOT, path)], {
    encoding: "utf8",
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});
