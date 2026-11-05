// The real-outcome agent's parts. unit_test.py runs anywhere with python3 (the Agent SDK and Harbor are stubbed only so
// the agent module imports): the ship persona, the /ship step log, the egress rules and the turn texts. egress_test.py
// writes the rules into a real container's namespace and probes them from inside; it runs in the Docker tier
// (GSTACK_EVALS_DOCKER=1), as the rig's other Docker tests do.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadRegistry, REGISTRY_PATH, turnScript } from "../../lanes/outcome-skills/arms/registry.ts";

const run = (file: string, env: Record<string, string> = {}, timeout = 120_000) => {
  const r = spawnSync("python3", [join(import.meta.dir, file)], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...env }, encoding: "utf8", timeout });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) console.log(out);
  return { status: r.status, out };
};

test("ship persona, /ship step log, egress rules and turn texts", () => {
  const r = run("unit_test.py");
  expect(r.out).not.toContain("FAIL");
  expect(r.out.match(/^PASS /gm)?.length).toBe(21);
  expect(r.status).toBe(0);
});

test("real_agent sends each G registry arm's turns exactly as turnScript writes them, trailing whitespace included", () => {
  const statements = ["Add it.", "Add it.\n", "Add it. \t\r\n", "Add it.\u00a0\u2028\u3000\ufeff", "Add it.\x1c\x85", "  Lead and trail.  \n\n"];
  const code = "import json, sys; sys.path.insert(0, sys.argv[1]); import unit_test as u; reg = json.load(open(sys.argv[2])); print(json.dumps([[u.ra.phase_texts({'kind': 'K3'}, reg, arm, s) for arm in sorted(reg['arms'])] for s in json.loads(sys.argv[3])]))";
  const r = spawnSync("python3", ["-c", code, import.meta.dir, REGISTRY_PATH, JSON.stringify(statements)], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8" });
  if (r.status !== 0) console.log(r.stdout + r.stderr);
  const reg = loadRegistry();
  expect(JSON.parse(r.stdout)).toEqual(statements.map((s) => Object.keys(reg.arms).sort().map((arm) => turnScript(reg, arm, s).map((t) => [t.phase, t.text]))));
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("the egress rules on real Docker (GSTACK_EVALS_DOCKER=1)", () => {
  test("only the allowed address and port open; no DNS, no UDP, and no way to remove the rules from inside", () => {
    const r = run("egress_test.py", { REAL_BUN: process.execPath }, 600_000);
    expect(r.out).not.toContain("FAIL");
    expect(r.out.match(/^PASS /gm)?.length).toBe(6);
    expect(r.status).toBe(0);
  }, 660_000);
});
