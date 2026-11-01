import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobConfig } from "../runner/grid.ts";
import { invokeSwitch, toldSkillMaps } from "../runner/prepare-run.ts";

const here = import.meta.dir;
const final: string[] = JSON.parse(readFileSync(join(here, "../tasks/final.json"), "utf8")).tasks;
const stacksMap = JSON.parse(readFileSync(join(here, "../runner/skill-map.stacks.json"), "utf8")) as Record<string, Record<string, string>>;
const RUN_D = ["none", "gstack", "gstack-rewritten", "placebo"];

const batch = (arms: string[], invoke: boolean) => jobConfig({
  job_name: "d", tasks_dir: "/run/tasks", tasks: final, attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000,
  verifier_timeout_multiplier: 1, models: [{ id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 }],
  arms: arms.map((name) => ({ name, tar: `/run/arms/${name}.tar`, sha256: name })),
  invoke, skill_maps: invoke ? toldSkillMaps(stacksMap, arms, final) : {},
});

describe("invoke switch", () => {
  test("on is the default, off is the only other value", () => {
    expect(invokeSwitch(undefined)).toBe(true);
    expect(invokeSwitch("on")).toBe(true);
    expect(invokeSwitch("off")).toBe(false);
    expect(() => invokeSwitch("no")).toThrow("E_USAGE");
  });

  test("off: every arm, gstack-rewritten included, gets the plain prompt and an empty skill map", () => {
    for (const ag of batch(RUN_D, false).agents) {
      expect(ag.kwargs.invoke).toBe(false);
      expect(ag.kwargs.skill_map).toEqual({});
    }
  });

  test("off needs no skill map entry for an arm the map lacks", () => {
    expect(() => toldSkillMaps(stacksMap, RUN_D, final)).toThrow("gstack-rewritten");
    expect(() => batch(RUN_D, false)).not.toThrow();
  });
});
