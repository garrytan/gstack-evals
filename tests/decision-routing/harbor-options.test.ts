// Copyright (c) 2026 Garry Tan. MIT License.
// Harbor checks a job's agent kwargs against the agent's options model before it queues a trial and again when it builds
// the agent (harbor/agents/base.py parse_options). DecisionRoutingAgent declares its own name and DecisionRoutingOptions;
// without them it inherited mini-swe-agent's schema and Harbor refused every controller job with "Unknown option 'cell'".
// The keyless test keeps the options model's fields equal to the kwargs harborJob writes. The Harbor tier runs the pinned
// Harbor's own preflight and agent factory on harborJob's jobs under harborEnv (harbor_options_test.py). It needs a Harbor
// install: DR_HARBOR_PYTHON, default the uv tool install the runner's post-boot.sh makes.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { harborEnv, harborJob, type PlanRow } from "../../lanes/decision-routing/host/controller.ts";

const AGENT = join(import.meta.dir, "../../lanes/decision-routing/agent");
const HARBOR_PY = process.env.DR_HARBOR_PYTHON ?? join(homedir(), ".local/share/uv/tools/harbor/bin/python");
const row: PlanRow = { task: "BerriAI__litellm-16864", cell: "N", model: "sol", item: "dr-pilot-rp" };
const inputs = { out: "/o", tasksDir: "/tasks", proxyHost: "172.17.0.1", runtimeTarball: "/rt.tgz", runtimeSha256: "ab", pinFile: "/pin.json" };

test("DecisionRoutingOptions declares exactly the kwargs harborJob writes", () => {
  const src = readFileSync(join(AGENT, "dr_harbor.py"), "utf8");
  const body = src.split("class DecisionRoutingOptions(MiniSweAgentOptions):")[1].split("\n\n\n")[0];
  const fields = [...body.matchAll(/^    (\w+): /gm)].map((m) => m[1]).sort();
  expect(fields).toEqual(Object.keys(harborJob(row, inputs, "/markers.json").agents[0].kwargs).sort());
  expect(src).toContain("    options_model = DecisionRoutingOptions\n");
});

describe.skipIf(!existsSync(HARBOR_PY))("decision-routing on the pinned Harbor", () => {
  test("Harbor's preflight and agent factory accept the controller's jobs and refuse an unknown kwarg", () => {
    const dir = mkdtempSync(join(tmpdir(), "dr-harbor-options-"));
    try {
      const plain = harborJob(row, inputs);
      const jobs = { plain, custody: harborJob(row, inputs, "/markers.json"), typo: { ...plain, agents: [{ ...plain.agents[0], kwargs: { ...plain.agents[0].kwargs, cels: "N" } }] } };
      for (const [name, job] of Object.entries(jobs)) writeFileSync(join(dir, name + ".json"), JSON.stringify(job, null, 2) + "\n");
      const env = { ...harborEnv(process.env, { socket: join(dir, "mgmt.sock"), token: "t", base: "http://172.17.0.1:1" }, AGENT), PYTHONDONTWRITEBYTECODE: "1" };
      const r = spawnSync(HARBOR_PY, [join(import.meta.dir, "harbor_options_test.py"), dir], { env, encoding: "utf8", timeout: 120_000 });
      const out = (r.stdout ?? "") + (r.stderr ?? "");
      if (r.status !== 0) console.log(out);
      expect(out).toContain("PASS plain");
      expect(out).toContain("PASS custody");
      expect(out).toContain("PASS typo refused");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
