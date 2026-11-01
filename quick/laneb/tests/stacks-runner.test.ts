import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { jobConfig } from "../runner/grid.ts";
import { toldSkillMaps } from "../runner/prepare-run.ts";
import { skillOpensFromMessages } from "../analysis/analyze.ts";

const here = import.meta.dir;
const ARMS = ["none", "gstack", "placebo", "pstack", "pstack-placebo"];
const final: string[] = JSON.parse(readFileSync(join(here, "../tasks/final.json"), "utf8")).tasks;
const stacksMap = JSON.parse(readFileSync(join(here, "../runner/skill-map.stacks.json"), "utf8")) as Record<string, Record<string, string>>;

const batch = (arms: string[]) => jobConfig({
  job_name: "s", tasks_dir: "/run/tasks", tasks: final, attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
  models: [{ id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 }],
  arms: arms.map((name) => ({ name, tar: `/run/arms/${name}.tar`, sha256: name })),
  skill_maps: toldSkillMaps(stacksMap, arms, final),
});

describe("stacks batch", () => {
  test("every arm but none is told its own skill from skill-map.stacks.json, and none gets no told line", () => {
    const agents = batch(ARMS).agents;
    expect(agents.map((ag) => ag.kwargs.arm)).toEqual(ARMS);
    const cases = agents.flatMap((ag) => final.map((task) => ({ arm: ag.kwargs.arm, task, invoke: ag.kwargs.invoke, skill: ag.kwargs.skill_map[task] ?? null })));
    const wrapper = readFileSync(join(here, "../runner/prompt-wrapper.md"), "utf8");
    const py = [
      "import json, sys",
      "sys.path.insert(0, sys.argv[1])",
      "from prompt_builder import build_prompt",
      "d = json.load(sys.stdin)",
      "print(json.dumps([build_prompt(d['wrapper'], 'do it', c['invoke'], c['skill'], ' ') for c in d['cases']]))",
    ].join("\n");
    const run = Bun.spawnSync(["python3", "-c", py, join(here, "../runner/agent")], { stdin: Buffer.from(JSON.stringify({ wrapper, cases })) });
    expect(run.stderr.toString()).toBe("");
    const prompts: string[] = JSON.parse(run.stdout.toString());
    const filled = wrapper.replace("{instruction}", "do it");
    const told = { gstack: "/investigate ", placebo: "/investigate ", pstack: "/pstack:poteto-mode ", "pstack-placebo": "/pstack:poteto-mode " } as Record<string, string>;
    cases.forEach((c, i) => {
      if (c.arm === "none") {
        expect(c.invoke).toBe(false);
        expect(prompts[i]).toBe(filled);
      } else {
        expect(c.invoke).toBe(true);
        expect(`/${stacksMap[c.arm][c.task]} `).toBe(told[c.arm]);
        expect(prompts[i]).toBe(told[c.arm] + filled);
      }
    });
    expect(agents.find((ag) => ag.kwargs.arm === "none")!.kwargs.skill_map).toEqual({});
  });

  test("gstack and placebo are told what quick look 3 told them", () => {
    const ql3 = JSON.parse(readFileSync(join(here, "../runner/skill-map.json"), "utf8")) as Record<string, { skill: string }>;
    expect(Object.keys(stacksMap).sort()).toEqual(["gstack", "placebo", "placebo-short", "pstack", "pstack-placebo"]);
    for (const arm of ["gstack", "placebo"]) for (const task of final) expect(stacksMap[arm][task]).toBe(ql3[task].skill);
  });

  test("a told arm or task missing from the map is a usage error", () => {
    expect(() => toldSkillMaps(stacksMap, ["none", "superpowers"], final)).toThrow("E_USAGE arm superpowers");
    expect(() => toldSkillMaps({ pstack: {} }, ["pstack"], ["fix-git"])).toThrow("E_USAGE arm pstack: task fix-git");
    expect(toldSkillMaps({}, ["none"], final)).toEqual({});
  });
});

// The stored arm files: prepare-run's <arm>.tar.gz or <arm>.tar, or the Captain drive's <arm>-<tar sha256 prefix>.tar.gz,
// which the drive keeps in parts when it is over 100 MB. LANEB_ARM_DIRS (colon list) overrides the drive folders.
const drive = join(process.env.HOME ?? "", ".capy/drive/captain-gstack-evals/handoffs");
const armDirs = (process.env.LANEB_ARM_DIRS ?? `${drive}/GSTA-30/arms:${drive}/GEVA-71/arms`).split(":");
function armFiles(name: string, tarSha: string): string[] | null {
  for (const dir of armDirs.filter((d) => existsSync(d))) {
    for (const base of [`${name}.tar.gz`, `${name}.tar`, `${name}-${tarSha.slice(0, 12)}.tar.gz`]) {
      if (existsSync(join(dir, base))) return [join(dir, base)];
      const parts = readdirSync(dir).filter((f) => f.startsWith(`${base}.part-`)).sort();
      if (parts.length) return parts.map((f) => join(dir, f));
    }
  }
  return null;
}
const catSha = (files: string[], gunzip: boolean) =>
  Bun.spawnSync(["sh", "-c", `cat "$@" | ${gunzip ? "gzip -dc | " : ""}sha256sum`, "sh", ...files]).stdout.toString().split(" ")[0];

describe("arm tars against the manifests in this tree", () => {
  for (const name of ARMS) {
    const manifest = JSON.parse(readFileSync(join(here, "../arms/manifests", `${name}.json`), "utf8"));
    const files = armFiles(name, manifest.tar.sha256);
    if (!files) console.log(`skip ${name}: no stored tar in ${armDirs.join(", ")}`);
    test.skipIf(!files)(`${name}: tar sha256 (what prepare-run checks) and tar.gz sha256 match arms/manifests/${name}.json`, () => {
      const gz = files![0].includes(".tar.gz");
      expect(catSha(files!, gz)).toBe(manifest.tar.sha256);
      if (gz) expect(catSha(files!, false)).toBe(manifest.tar_gz_sha256);
    }, 300_000);
  }
});

describe("skill opens", () => {
  test("a pstack SKILL.md read counts as opening that skill, and gstack's still count", () => {
    const msg = (block: object) => JSON.stringify({ type: "AssistantMessage", content: [block] });
    const lines = [
      msg({ name: "Read", input: { file_path: "/root/.local/share/pstack/skills/poteto-mode/SKILL.md" } }),
      msg({ name: "Bash", input: { command: "cat /root/.local/share/pstack/skills/correct/SKILL.md" } }),
      msg({ name: "Read", input: { file_path: "/root/.claude/skills/investigate/SKILL.md" } }),
      msg({ name: "Bash", input: { command: "head -40 /root/.claude/skills/review/SKILL.md" } }),
      msg({ name: "Skill", input: { skill: "pstack:poteto-mode" } }),
      msg({ name: "Read", input: { file_path: "/root/.local/share/pstack/docs/guide/README.md" } }),
      msg({ name: "Read", input: { file_path: "/root/.local/share/other/skills/x/SKILL.md" } }),
      msg({ name: "Bash", input: { command: "ls /root/.local/share/pstack/skills/architect/SKILL.md" } }),
    ];
    expect(skillOpensFromMessages(lines)).toEqual(["poteto-mode", "correct", "investigate", "review", "pstack:poteto-mode"]);
  });
});
