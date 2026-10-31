// Keyless tests for the stack arm kinds of the stacks round (plan 2026-10-30-geva-59-stacks-round-1-plan, section 3):
// subtree refs, the pstack and tstack installers, the install boundary, the pstack placebo, the per-cell settings and
// the Codex config a voice cell writes. The stacks here are small fakes with pstack's and tstack's layout; the pinned
// trees run in tests/arms/stack-canary.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { getEncoding } from "js-tiktoken";
import { cellFor, cellSettings, PSTACK_RULE, pstackModelsRule } from "../../src/arms/cells.ts";
import { installArms, InstallError, localInstaller, stackTree, type ArmInstall } from "../../src/arms/install.ts";
import { SOL_AGENT, stackKind, STACKS } from "../../src/arms/stacks.ts";
import { claudeCodeDriver, claudeCodeEnv, codexConfigCommand } from "../../src/adapters/claude-code/driver.ts";
import { parseStackRef } from "../../src/skill-eval/cli/arms.ts";
import { trialEnv } from "../../src/trial/env.ts";
import { seedStateRoot } from "../../src/trial/state-root.ts";
import type { ArmSpec, Host, StackRef } from "../../src/types.ts";
import { commitAll, git } from "../cli/helpers.ts";

const roots: string[] = [];
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const skill = (name: string, body: string) => "---\nname: " + name + "\ndescription: Fake " + name + " for the stack tests.\n---\n# " + name + "\n\n" + body + "\n";
const stop = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof InstallError) return error.code;
    throw error;
  }
  return "no error";
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const SETUP = [
  "Set the models.", "", "### 5. Write the rule", "", "Shape:", "", "```", "---", "description: d", "alwaysApply: true", "---",
  "# model configuration, one line per role", "# budget: large (xhigh)", "judgment and prose: claude-opus-5-5-xhigh",
  "interrogate reviewers: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast", "swarm workers: grok-4.7-xhigh-fast", "auto role: auto", "```", "", "### 6. Confirm",
].join("\n");
const PROCEDURE = "INTERROGATE-PROCEDURE adversaries try to break the change and only findings proven by a run survive the lead's rerun.";

/** cursor/plugins with pstack's Claude Code tree at harness/pstack/claude-code and other files outside it. */
function pstackRepo(): { root: string; sha: string; ref: StackRef } {
  const root = scratch("plugins");
  const p = join(root, "harness", "pstack", "claude-code");
  write(join(root, "README.md"), "OUTSIDE-THE-SUBTREE\n");
  write(join(root, "pstack", "skills", "interrogate", "SKILL.md"), skill("interrogate", "SOURCE-COPY"));
  write(join(p, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pstack", version: "0.0.1" }) + "\n");
  write(join(p, "skills", "interrogate", "SKILL.md"), skill("interrogate", PROCEDURE.repeat(4)));
  write(join(p, "skills", "poteto-mode", "SKILL.md"), skill("poteto-mode", "POTETO-PROCEDURE pick a playbook and copy its steps."));
  write(join(p, "skills", "poteto-mode", "playbooks", "bug-fix.md"), "PLAYBOOK-TEXT\n");
  write(join(p, "skills", "poteto-mode", "scripts", "bootstrap.ts"), "export function ensureDependenciesInstalled(): void {}\n");
  write(join(p, "skills", "setup-pstack", "SKILL.md"), skill("setup-pstack", SETUP));
  write(join(p, "agents", "poteto-agent.md"), "---\nname: poteto-agent\ndescription: d\n---\nAGENT-TEXT\n");
  const commit = commitAll(root, "pstack");
  return { root, sha: commit, ref: { repo: "cursor/plugins", sha: commit, path: "harness/pstack/claude-code" } };
}

/** t3dotgg/tstack's layout: skills/ and a README. */
function tstackRepo(): { root: string; sha: string; ref: StackRef } {
  const root = scratch("tstack");
  write(join(root, "README.md"), "tstack\n");
  write(join(root, "skills", "sol-loop", "SKILL.md"), skill("sol-loop", "SOL-LOOP-PROCEDURE review with Sol."));
  write(join(root, "skills", "council", "SKILL.md"), skill("council", "COUNCIL-PROCEDURE"));
  const commit = commitAll(root, "tstack");
  return { root, sha: commit, ref: { repo: "t3dotgg/tstack", sha: commit } };
}

const stackArm = (name: string, ref: StackRef): ArmSpec => ({ name, kind: "stack", stack: ref, install: { ...stackKind(ref)!.install } });
const install = (host: Host, arms: ArmSpec[], skill: string, sources: string[], state = scratch("state")) => installArms({ host, arms, skill, base: null, sources, runner: localInstaller(scratch("runner")), state });
const files = (dir: string, rel = ""): string[] => readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir, rel ? rel + "/" + e.name : e.name) : [rel ? rel + "/" + e.name : e.name])).sort();

const ps = pstackRepo();
const ts = tstackRepo();

describe("subtree refs", () => {
  // Value: protects=<repo>@<sha>:<path> parses to a ref with a subtree path, and a path that could leave the repository is refused before any extraction; fails_when=the path is dropped, or ../, an absolute path or a . part passes; why_new=GST-370 step 1 (the StackRef subtree path); seam=parseStackRef; no_claim=whether the path exists at the commit, which stackTree checks
  test("parse with and without a path, and refuse paths that leave the repository", () => {
    const at = "c742dd61706fbacc1b95f1a20b7b988cf096ce6c";
    expect(parseStackRef("cursor/plugins@" + at + ":harness/pstack/claude-code")).toEqual({ repo: "cursor/plugins", sha: at, path: "harness/pstack/claude-code" });
    expect(parseStackRef("t3dotgg/tstack@" + at)).toEqual({ repo: "t3dotgg/tstack", sha: at });
    for (const bad of ["../x", "a/../b", "/abs", "a/./b", "a//b", ""]) expect(typeof parseStackRef("cursor/plugins@" + at + ":" + bad)).toBe("string");
  });

  // Value: protects=a subtree extracts alone and verifies against git rev-parse <sha>:<path>, and a path the commit lacks stops with E_STACK_SOURCE; fails_when=the whole tree is extracted, the digest check compares the commit's root tree, or a missing folder installs an empty tree; why_new=plan section 3 (the digest check compares the extracted subtree with git rev-parse <sha>:<path>); seam=stackTree; no_claim=export attributes, which the install tests cover
  test("a subtree extracts alone and verifies against its own tree id", () => {
    const to = join(scratch("tree"), "t");
    const t = stackTree(ps.ref, [ps.root], to);
    expect(t.git_tree).toBe(git(ps.root, "rev-parse", ps.sha + ":harness/pstack/claude-code"));
    expect(existsSync(join(to, "skills", "interrogate", "SKILL.md"))).toBe(true);
    expect(existsSync(join(to, "README.md"))).toBe(false);
    expect(stop(() => stackTree({ ...ps.ref, path: "harness/nope" }, [ps.root], join(scratch("tree"), "t")))).toBe("E_STACK_SOURCE");
  });

  // Value: protects=the listed stacks match by repository and subtree, and their pins are the plan's commits and trees; fails_when=a whole-repository ref matches pstack, or a pin drifts from the plan without a review; why_new=plan section 3 pins; seam=stackKind, STACKS; no_claim=the pins are the newest heads, which the preregistration re-reads
  test("stackKind matches repository and subtree, at the plan's pins", () => {
    expect(stackKind(ps.ref)?.name).toBe("pstack");
    expect(stackKind({ repo: "cursor/plugins", sha: ps.sha })).toBeNull();
    expect(stackKind(ts.ref)?.name).toBe("tstack");
    expect(STACKS.map((k) => [k.name, k.pin.sha, k.pin.git_tree, k.author])).toEqual([
      ["pstack", "c742dd61706fbacc1b95f1a20b7b988cf096ce6c", "cdbbd4ca5dd2f4ca0eef3294e7b981c0c610d4bb", "Lauren Tan"],
      ["tstack", "1085050f3baed1ac724caa4a8166145fb2ac88af", "a939d866f545629c277cc9fdf766051385f3e9d9", "Theo Browne"],
    ]);
  });
});

describe("a target skill per arm", () => {
  // Value: protects=one installArms call installs stacks told different skills, each found by its own name (pstack interrogate, tstack sol-loop), and a stack arm with no skill of its own or from --skill still refuses; fails_when=one shared skill name is required, so review units cannot pair stacks in one run, or a missing skill installs silently; why_new=GEVA-70 step 2 (review units tell each stack its own command); seam=installArms skills; no_claim=base arms, which always take --skill
  test("stacks told different skills install together", () => {
    const [p, t] = installArms({ host: "claude", arms: [stackArm("pstack", ps.ref), stackArm("tstack", ts.ref)], skill: null, skills: { pstack: "interrogate", tstack: "sol-loop" }, base: null, sources: [ps.root, ts.root], runner: localInstaller(scratch("runner")), state: scratch("state") }) as [ArmInstall, ArmInstall];
    expect(p.skill?.skillMd).toMatch(/skills\/interrogate\/SKILL\.md$/);
    expect(t.skill?.skillMd).toMatch(/skills\/sol-loop\/SKILL\.md$/);
    expect(stop(() => installArms({ host: "claude", arms: [stackArm("tstack", ts.ref)], skill: null, skills: { pstack: "interrogate" }, base: null, sources: [ts.root], runner: localInstaller(scratch("runner")), state: scratch("state") }))).toBe("E_USAGE");
  });
});

describe("pstack and tstack installs", () => {
  const state = scratch("state");
  const arms = install("claude", [stackArm("pstack", ps.ref), { name: "pstack-placebo", kind: "placebo", of: "pstack" }], "interrogate", [ps.root], state);
  const [pstack, placebo] = arms as [ArmInstall, ArmInstall];
  const home = pstack.layers[0]!.src;

  // Value: protects=pstack installs as its Claude Code plugin at ~/.local/share/pstack with only the subtree, loaded as a plugin root, its told skill found under the plugin's skills/, and its provenance records the repo, sha, subtree path, git tree and tree digest; fails_when=the repository root or files outside the subtree install, the checkout is named plugins, the plugin root is not recorded, or the skill lookup misses plugin skills; why_new=GST-370 step 1 (pstack installer, install boundary, namespaced skill discovery); seam=installArms stack branch, findSkill; no_claim=Claude Code loading the plugin, which the canary runs
  test("pstack: the plugin tree alone, at ~/.local/share/pstack, with its skill found in the plugin", () => {
    expect(pstack.plugins).toEqual([".local/share/pstack"]);
    expect(files(home).filter((f) => !f.startsWith(".local/share/pstack/"))).toEqual([]);
    expect(files(home)).toContain(".local/share/pstack/agents/poteto-agent.md");
    expect(files(home).some((f) => f.includes("OUTSIDE") || f.endsWith("/README.md"))).toBe(false);
    expect(pstack.skill!.skillMd).toBe(".local/share/pstack/skills/interrogate/SKILL.md");
    const p = pstack.provenance as { stack: Record<string, string>; install: { command: string } };
    expect(p.stack).toMatchObject({ repo: "cursor/plugins", sha: ps.sha, path: "harness/pstack/claude-code", git_tree: git(ps.root, "rev-parse", ps.sha + ":harness/pstack/claude-code") });
    expect(p.install.command).toBe(stackKind(ps.ref)!.install.claude!);
  });

  // Value: protects=pstack's placebo is a manifest plus one generated SKILL.md per skill: the told skill still resolves, no playbook, agent or procedure text survives, and each SKILL.md keeps its token count within 10%; fails_when=the placebo misses the plugin's skills, keeps playbooks or agents, copies the procedure, or changes length enough to confound; why_new=GST-370 step 1 (the pstack placebo); seam=installArms placebo branch; no_claim=what a model does with the placebo, which TB2 measures
  test("pstack placebo: manifest and generated SKILL.md files only, told skill resolves, length kept", () => {
    const tree = placebo.layers[0]!.src;
    expect(placebo.plugins).toEqual([".local/share/pstack"]);
    expect(files(tree)).toEqual([".local/share/pstack/.claude-plugin/plugin.json", ".local/share/pstack/skills/interrogate/SKILL.md", ".local/share/pstack/skills/poteto-mode/SKILL.md", ".local/share/pstack/skills/setup-pstack/SKILL.md"]);
    expect(placebo.skill!.skillMd).toBe(".local/share/pstack/skills/interrogate/SKILL.md");
    const enc = getEncoding("o200k_base");
    for (const name of ["interrogate", "poteto-mode", "setup-pstack"]) {
      const before = readFileSync(join(home, ".local/share/pstack/skills", name, "SKILL.md"), "utf8");
      const after = readFileSync(join(tree, ".local/share/pstack/skills", name, "SKILL.md"), "utf8");
      expect(after).toContain("name: " + name);
      expect(after).not.toContain("PROCEDURE");
      const ratio = enc.encode(after).length / enc.encode(before).length;
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
    }
  });

  // Value: protects=tstack installs by its README's copy into ~/.claude/skills, plus the rig's Sol subagent as a second, digested layer whose sha256 is in the provenance; fails_when=the subagent file is missing, edited, undigested or folded into tstack's own layer, or tstack's README lands in the skills directory; why_new=GST-370 step 1 (tstack installer, the Sol subagent file); seam=installArms stack branch (files layer); no_claim=Sol answering, which the canary runs
  test("tstack: skills copied as published, plus the disclosed Sol subagent layer", () => {
    const [t] = install("claude", [stackArm("tstack", ts.ref)], "sol-loop", [ts.root]) as [ArmInstall];
    expect(t.layers).toHaveLength(2);
    expect(files(t.layers[0]!.src).filter((f) => f.startsWith(".claude/"))).toEqual([".claude/skills/council/SKILL.md", ".claude/skills/sol-loop/SKILL.md"]);
    expect(files(t.layers[1]!.src)).toEqual([".claude/agents/sol.md"]);
    expect(readFileSync(join(t.layers[1]!.src, ".claude/agents/sol.md"), "utf8")).toBe(readFileSync(SOL_AGENT, "utf8"));
    expect((t.provenance as { files: Record<string, string> }).files).toEqual({ ".claude/agents/sol.md": sha(readFileSync(SOL_AGENT)) });
    expect(t.skill!.skillMd).toBe(".claude/skills/sol-loop/SKILL.md");
    expect(t.plugins).toEqual([]);
  });

  // Value: protects=pstack's installer runs its own bootstrap and fails when the tree has none, so an arm never ships without poteto-mode's script dependencies; fails_when=the installer skips a missing bootstrap and the arm installs anyway; why_new=ship #88 red team (a re-pinned tree whose bootstrap moved would score as pstack losses); seam=PSTACK_INSTALL through installArms; no_claim=the real bootstrap's dependency install, which the canary runs
  test("pstack without poteto-mode's bootstrap fails to install", () => {
    const root = scratch("plugins-nb");
    const p = join(root, "harness", "pstack", "claude-code");
    write(join(p, ".claude-plugin", "plugin.json"), "{}\n");
    write(join(p, "skills", "interrogate", "SKILL.md"), skill("interrogate", "x"));
    const commit = commitAll(root, "no bootstrap");
    expect(stop(() => install("claude", [stackArm("pstack", { repo: "cursor/plugins", sha: commit, path: "harness/pstack/claude-code" })], "interrogate", [root]))).toBe("E_IMAGE_BUILD");
  });

  // Value: protects=a listed stack with no installer for the host is refused, rather than falling back to gstack's setup; fails_when=pstack on Codex runs ./setup or installs nothing silently; why_new=GST-370 step 1 (installers in the per-host install map); seam=installArms; no_claim=none
  test("a host the stack has no installer for is refused", () => {
    expect(stop(() => install("codex", [stackArm("pstack", ps.ref)], "interrogate", [ps.root]))).toBe("E_USAGE");
  });

  describe("cells", () => {
    const opus = { model: "claude-opus-5-5", voice: "gpt-6.1-sol" };
    const cheap = { model: "claude-haiku-5-5", voice: null };

    // Value: protects=pstack's rule maps its own shape as its Claude Code adapter says: Claude slugs to "<family> <effort>" and others to inherit-parent in a voice cell, every value to inherit-parent with list lengths kept in a cheap cell, and front matter dropped; fails_when=a Grok seat keeps a slug, a cheap cell keeps opus, a panel loses entries, or a shape without role lines passes; why_new=GST-370 step 1 (the per-cell pstack models rule); seam=pstackModelsRule, cellSettings; no_claim=the real setup-pstack shape, which the canary derives
    test("pstack's models rule per cell", () => {
      const text = readFileSync(join(home, ".local/share/pstack/skills/setup-pstack/SKILL.md"), "utf8");
      expect(pstackModelsRule(text, opus)).toBe("# model configuration, one line per role\n# budget: large (xhigh)\njudgment and prose: opus xhigh\ninterrogate reviewers: opus xhigh, inherit-parent\nswarm workers: inherit-parent\nauto role: auto\n");
      expect(pstackModelsRule(text, cheap)).toBe("# model configuration, one line per role\n# budget: large (xhigh)\njudgment and prose: inherit-parent\ninterrogate reviewers: inherit-parent, inherit-parent\nswarm workers: inherit-parent\nauto role: inherit-parent\n");
      expect(pstackModelsRule("### 5. Write\n\n```\n# only comments\n```\n", opus)).toBeNull();
      const a = cellSettings(pstack, opus, join(scratch("cell"), "c"));
      const b = cellSettings(pstack, cheap, join(scratch("cell"), "c"));
      expect(readFileSync(join(a.layer!.src, PSTACK_RULE), "utf8")).toContain("opus xhigh");
      expect(readFileSync(join(b.layer!.src, PSTACK_RULE), "utf8")).not.toContain("opus");
      expect(a.tree_sha256).not.toBe(b.tree_sha256);
      expect([a.codex, a.gstack_config]).toEqual([null, {}]);
      expect(stop(() => cellSettings(placebo, opus, join(scratch("cell"), "c")))).toBe("no error");
      const shared = scratch("cell");
      const x = cellSettings(pstack, opus, shared);
      const y = cellSettings(pstack, cheap, shared);
      expect(readFileSync(join(x.layer!.src, PSTACK_RULE), "utf8")).toContain("opus xhigh");
      expect(readFileSync(join(y.layer!.src, PSTACK_RULE), "utf8")).not.toContain("opus");
    });

    // Value: protects=a rule value the cell map does not know refuses with E_CELL_RULE, naming the role and value, instead of becoming inherit-parent, while a Grok seat still maps to inherit-parent; fails_when=an unknown slug (a GPT seat, a bare family, a typo) silently runs on the session model; why_new=#88 /ship Step 11 (both voices: unknown rule values became inherit-parent); seam=pstackModelsRule, cellSettings; no_claim=pstack vocabulary past the pinned shape, which a re-pin rechecks
    test("an unknown rule value refuses with E_CELL_RULE", () => {
      const shape = (value: string) => "### 5. Write\n\n```\nreviewers: claude-opus-5-5-xhigh, " + value + "\n```\n";
      expect(pstackModelsRule(shape("grok-4.7-xhigh-fast"), opus)).toBe("reviewers: opus xhigh, inherit-parent\n");
      expect(pstackModelsRule(shape("grok-4.7-xhigh-fast"), cheap)).toBe("reviewers: inherit-parent, inherit-parent\n");
      for (const v of ["gpt-6.1-sol-high", "opus", "claude-opus", "grok-latest"]) {
        expect(stop(() => pstackModelsRule(shape(v), opus))).toBe("E_CELL_RULE");
        expect(stop(() => pstackModelsRule(shape(v), cheap))).toBe("E_CELL_RULE");
      }
      expect(() => pstackModelsRule(shape("gpt-6.1-sol-high"), opus)).toThrow(/"reviewers" the value "gpt-6.1-sol-high"/);
      expect(cellFor("claude-opus-5-5")).toEqual(opus);
      expect(cellFor("claude-haiku-5-5")).toEqual(cheap);
      expect(cellFor("particle-1").voice).toBeNull();
    });

    // Value: protects=a cell layer is published by rename, so a folder left with other bytes by a crashed or concurrent build is replaced whole, the tree is the same as a clean build's, and no temp folder stays behind; fails_when=a stale folder is reused as is, or a .tmp- folder is left in the cells dir; why_new=#88 /ship Step 11 (both voices: concurrent builds on one state dir raced on a layer folder); seam=cellSettings; no_claim=two processes racing, which rename's atomicity covers
    test("cell layers publish whole", () => {
      const dir = scratch("cells");
      const a = cellSettings(pstack, opus, dir);
      writeFileSync(join(a.layer!.src, PSTACK_RULE), "half");
      const b = cellSettings(pstack, opus, dir);
      expect(b.layer!.src).toBe(a.layer!.src);
      expect(readFileSync(join(b.layer!.src, PSTACK_RULE), "utf8")).toContain("opus xhigh");
      expect(b.tree_sha256).toBe(a.tree_sha256);
      expect(cellSettings(pstack, opus, dir).tree_sha256).toBe(a.tree_sha256);
      expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
    });

    // Value: protects=gstack's cell keys pin readers to the parent and turn the outside voice on only in a voice cell, and a voice stack (tstack) gets the codex option only there; fails_when=a cheap cell enables codex_reviews or the voice, or an Opus cell drops it; why_new=GST-370 step 1 (per-cell gstack preferences, Codex for gstack's outside voice and tstack's reviewer); seam=cellSettings; no_claim=gstack honouring the keys, which gstack's own tests cover
    test("gstack keys and the Codex voice per cell", () => {
      const gstack = { ...pstack, name: "gstack", plugins: [], gstack: ".claude/skills/gstack/bin/gstack-skill-start", provenance: { kind: "stack", stack: { repo: "gstack", sha: ps.sha } } } as ArmInstall;
      expect(cellSettings(gstack, opus, scratch("c"))).toMatchObject({ layer: null, gstack_config: { agent_model: "host", codex_reviews: "enabled" }, codex: { model: "gpt-6.1-sol" } });
      expect(cellSettings(gstack, cheap, scratch("c"))).toMatchObject({ layer: null, gstack_config: { agent_model: "host", codex_reviews: "disabled" }, codex: null });
      const [t] = install("claude", [stackArm("tstack", ts.ref)], "sol-loop", [ts.root]) as [ArmInstall];
      expect(cellSettings(t, opus, scratch("c")).codex).toEqual({ model: "gpt-6.1-sol" });
      expect(cellSettings(t, cheap, scratch("c")).codex).toBeNull();
    });

    // Value: protects=a cell's gstack keys land after the seed, so gstack reads them (it reads a key's last value); fails_when=the seed's codex_reviews disabled wins in a voice cell; why_new=GST-370 step 1 (per-cell gstack preferences); seam=seedStateRoot extra; no_claim=none
    test("seedStateRoot appends a cell's keys over the seed", () => {
      const work = scratch("work");
      seedStateRoot(work, "/work/t", "core", { codex_reviews: "enabled", agent_model: "host" });
      const config = readFileSync(join(work, ".gstack-home", "config.yaml"), "utf8");
      expect(config).toContain("codex_reviews: enabled");
      expect(config).not.toContain("codex_reviews: disabled");
      expect(config).toContain("agent_model: host");
    });
  });
});

describe("Codex in a Claude Code session", () => {
  // Value: protects=the voice's Codex config names the session's slot, the voice model and the bearer's env name, keeps retries off, and holds no credential; the bearer rides only in OPENAI_API_KEY, which the agent allowlist accepts as a session bearer; fails_when=the token reaches the file, retries stay on, the slot or provider is wrong, or a provider key could pass; why_new=GST-370 step 1 (Codex CLI with the proxy bearer, no provider key in the container); seam=codexConfigCommand, claudeCodeEnv, trialEnv; no_claim=Codex reading the file, which the canary runs
  test("config names the slot and holds no credential; the bearer is a session bearer", () => {
    const proxy = { baseUrl: "http://proxy:8080/", slot: "s1", token: "gse_" + "A".repeat(43) };
    const cmd = codexConfigCommand({ provider: "openai", model: "gpt-6.1-sol" }, proxy);
    expect(cmd).toContain('model = "gpt-6.1-sol"');
    expect(cmd).toContain('model_providers.gstack_evals_proxy.base_url = "http://proxy:8080/s1/openai/v1"');
    expect(cmd).toContain('model_providers.gstack_evals_proxy.env_key = "OPENAI_API_KEY"');
    expect(cmd).toContain("model_providers.gstack_evals_proxy.request_max_retries = 0");
    expect(cmd).not.toContain(proxy.token);
    const env = claudeCodeEnv({ model: "claude-opus-5-5", provider: "anthropic", proxy, codex: { provider: "openai", model: "gpt-6.1-sol" } });
    expect(env.OPENAI_API_KEY).toBe(proxy.token);
    expect(trialEnv("agent", { PATH: "/usr/bin", HOME: "/home/agent", ...env }, [], {}).OPENAI_API_KEY).toBe(proxy.token);
    expect(claudeCodeEnv({ model: "m", provider: "anthropic", proxy }).OPENAI_API_KEY).toBeUndefined();
  });

  // Value: protects=a failed Codex config step ends the cell as missing E_CODEX_CONFIG before Claude Code starts, with no bearer in the log, and plugin roots reach the SDK as local plugins while an arm without them sends none; fails_when=the exit check is dropped and the CLI starts without the config, or the roots are lost between the driver option and the SDK; why_new=ship #88 testing review and coverage audit; seam=claudeCodeDriver; no_claim=hostDriver and runOnHost passing the roots, which the canary's sessions exercise
  test("a failed Codex config step is a missing cell, and plugin roots reach the SDK", async () => {
    const proxy = { baseUrl: "http://proxy:8080", slot: "s1", token: "gse_" + "B".repeat(43) };
    const seen: Record<string, unknown>[] = [];
    const query = ((a: { options: Record<string, unknown> }) => {
      seen.push(a.options);
      return (async function* () {})();
    }) as never;
    const session = (exitCode: number) => ({ exec: () => ({ exitCode, timedOut: false, stdout: "", stderr: "read-only file system" }), spawn: () => { throw new Error("unused"); }, stop() {} }) as never;
    const task = { id: "t", prompt: "p" } as never;
    const out = scratch("out");
    const failed = await claudeCodeDriver({ model: "claude-opus-5-5", provider: "anthropic", proxy, skill: null, out, codex: { provider: "openai", model: "gpt-6.1-sol" }, query }).run(session(1), task, 10_000);
    expect(failed.termination).toEqual({ kind: "missing", code: "E_CODEX_CONFIG" });
    expect(seen).toHaveLength(0);
    const log = readFileSync(join(out, "cli-stderr.log"), "utf8");
    expect(log).toContain("exited 1");
    expect(log).not.toContain(proxy.token);
    await claudeCodeDriver({ model: "claude-opus-5-5", provider: "anthropic", proxy, skill: null, out: scratch("out"), plugins: ["/sandbox/pstack"], query }).run(session(0), task, 10_000);
    await claudeCodeDriver({ model: "claude-opus-5-5", provider: "anthropic", proxy, skill: null, out: scratch("out"), query }).run(session(0), task, 10_000);
    expect(seen[0]!.plugins).toEqual([{ type: "local", path: "/sandbox/pstack" }]);
    expect("plugins" in seen[1]!).toBe(false);
  });
});
