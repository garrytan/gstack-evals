// Copyright (c) 2026 Garry Tan. MIT License.
// Every hm arm spec sets strip_snapshot=true, and it reaches the job file's agent kwargs through grid.ts, the way prepare-run
// passes an arm's options; L1's arm specs and their kwargs are unchanged. The run record shows HARBOR_TELEMETRY=0.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { armSpec, jobConfig } from "../../quick/laneb/runner/grid.ts";
import { ARMS, REPO } from "../../lanes/harness-mechanics/pins.ts";
import { harborEnvRecord } from "../../lanes/harness-mechanics/arms.ts";
import { ARM_SPECS as L1_ARMS } from "../../quick/laneb/l1/l1.ts";

const kwargs = (spec: string) => {
  const { name, tar_name, ...options } = armSpec(spec);
  const b: any = { models: [{ id: "claude-opus-5-5", harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 5 }], arms: [{ name, tar: "/t/" + (tar_name ?? name) + ".tar", sha256: "x", ...options }], tasks_dir: "/k", tasks: ["t1"], attempts: 1, n_concurrent: 1, job_name: "j", agent_dir: "/a", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000 };
  return (jobConfig(b) as any).agents[0].kwargs;
};

describe("strip_snapshot in the arm specs", () => {
  test("every hm arm's job kwargs carry strip_snapshot true", () => {
    for (const a of Object.values(ARMS)) expect([a.spec, kwargs(a.spec).strip_snapshot]).toEqual([a.spec, true]);
  });
  test("L1's arm specs set no strip_snapshot and their kwargs hold no such key", () => {
    const specs = Object.values(L1_ARMS as Record<string, string>);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) { expect(s.includes("strip_snapshot")).toBe(false); expect(Object.hasOwn(kwargs(s), "strip_snapshot")).toBe(false); }
  });
  test("strip_snapshot takes only true", () => {
    expect(() => armSpec("none:strip_snapshot=false")).toThrow(/E_USAGE/);
  });
});

describe("HARBOR_TELEMETRY=0 in the run record", () => {
  const vm = readFileSync(join(REPO, "quick/laneb/runner/vm-run.sh"), "utf8");
  test("the record shows it from vm-run.sh and says the pinned job config has no field for Harbor's own env", () => {
    const r = harborEnvRecord(vm);
    expect(r.HARBOR_TELEMETRY).toBe("0");
    expect(r.job_config_field).toBe(false);
  });
  test("a harbor run line without it gives no record", () => {
    expect(() => harborEnvRecord(vm.replace(/HARBOR_TELEMETRY=0 harbor run/, "harbor run"))).toThrow(/E_HM_PIN/);
  });
});
