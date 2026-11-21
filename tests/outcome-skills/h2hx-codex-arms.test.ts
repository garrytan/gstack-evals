// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's Codex installs (ext/codex-arms.ts): each s-* recipe as the plan's install table gives it, the Codex hash rule
// (skips, JSON keys and GSD's nonce), the pins file, drift refusal and containment over a Codex home. With
// GSTACK_EVALS_DOCKER=1 and H2H_SOURCES holding the pinned clones, s-tstack and s-superpowers install twice in Docker and
// hash to their pins.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { homeTreeSha256 } from "../../lanes/outcome-skills/h2h/arms/hash.ts";
import { fixtureRepo, fixtureRow } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { toCandidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import { writeUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { checkCodexHome, codexHomeTreeSha256, codexRecipe, containCodexHome, installCodexHome, readCodexPin } from "../../lanes/outcome-skills/h2h/ext/codex-arms.ts";
import { readExtPrereg, S_ARMS } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";

const X = readExtPrereg();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function home(files: Record<string, string>): string {
  const h = mkdtempSync(join(tmpdir(), "h2hx-home-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(h, p)), { recursive: true });
    writeFileSync(join(h, p), body);
  }
  return h;
}

describe("part S Codex recipes", () => {
  test("gstack installs v1.102.1.0 with ./setup --host codex, part S's model seeded in config.toml and removed after", () => {
    const r = codexRecipe("s-gstack");
    expect(r.sources).toEqual([{ name: "gstack", repo: "garrytan/gstack", sha: X.gstack.S.sha, kind: "clone" }]);
    const steps = r.steps.join("\n");
    expect(steps).toContain("(cd $HOME/gstack && ./setup --host codex)");
    expect(r.steps.indexOf("printf '%s\\n' 'model = \"gpt-6.2-sol\"' > $HOME/.codex/config.toml")).toBeLessThan(r.steps.indexOf("(cd $HOME/gstack && ./setup --host codex)"));
    expect(steps).toContain("telemetry: off");
    expect(r.steps.at(-1)).toBe("test ! -e $HOME/.codex/AGENTS.md");
    expect(r.agents_md).toBeNull();
  });

  test("s-gstack-line adds exactly prereg.json's AGENTS.md bytes, whose digest is the recorded one", () => {
    const r = codexRecipe("s-gstack-line");
    expect(r.steps).toEqual(codexRecipe("s-gstack").steps);
    expect(r.agents_md).toBe(X.parts.S.agents_md["s-gstack-line"]!);
    expect(sha(r.agents_md!)).toBe(X.parts.S.agents_md_sha256);
  });

  test("the marketplace packs install from their pins as local Codex marketplaces, GSD by npx, tstack by copy", () => {
    expect(codexRecipe("s-none").steps).toEqual([]);
    expect(codexRecipe("s-superpowers").sources[0]).toMatchObject({ name: "superpowers", kind: "clone" });
    expect(codexRecipe("s-superpowers").steps.slice(-2)).toEqual(["codex plugin marketplace add $HOME/.codex/plugin-sources/superpowers", "codex plugin add superpowers@superpowers-dev"]);
    expect(codexRecipe("s-agent-skills").sources[0]).toMatchObject({ name: "agent-skills", kind: "tree" });
    expect(codexRecipe("s-agent-skills").steps.slice(-1)).toEqual(["codex plugin add agent-skills@agent-skills"]);
    expect(codexRecipe("s-gsd").steps.slice(-1)).toEqual(["npx -y @opengsd/gsd-core@1.21.0 --codex --global"]);
    expect(codexRecipe("s-tstack").steps).toEqual(["mkdir -p $HOME/.codex/skills", "cp -R /h2h-src/tstack/skills/* $HOME/.codex/skills/"]);
  });
});

describe("the Codex hash rule and pins", () => {
  test("leaves out Codex's arg0 dir, gstack's hooks backups, pack file and build log, and GSD's timestamps and nonce", () => {
    const base = { ".codex/skills/x/SKILL.md": "x\n", "gstack/bin/gstack": "#!/bin/sh\n" };
    const a = home({ ...base, ".codex/tmp/arg0-linux/codex-arg0aaaa/.lock": "", ".codex/hooks.json.bak.20261121-083330.1.2": "{}", ".codex/hooks.json.bak-latest": "a", "gstack/.git/objects/pack/pack-1.pack": "1", "gstack/bin/.gstack-cso-build.log": "1ms", ".codex/gsd-install-state.json": '{"s":[{"appliedAt":"t1","v":1}]}', ".codex/gsd-core/workflows/quick.md": "<<'GSD_ARGS_END_" + "a".repeat(32) + "'\n" });
    const b = home({ ...base, ".codex/tmp/arg0-linux/codex-arg0bbbb/.lock": "", ".codex/hooks.json.bak.20261121-083353.3.4": "{}", ".codex/hooks.json.bak-latest": "b", "gstack/.git/objects/pack/pack-2.pack": "2", "gstack/bin/.gstack-cso-build.log": "2ms", ".codex/gsd-install-state.json": '{"s":[{"appliedAt":"t2","v":1}]}', ".codex/gsd-core/workflows/quick.md": "<<'GSD_ARGS_END_" + "b".repeat(32) + "'\n" });
    expect(codexHomeTreeSha256(a)).toBe(codexHomeTreeSha256(b));
    expect(homeTreeSha256(a)).not.toBe(homeTreeSha256(b));
    const c = home({ ...base, ".codex/gsd-install-state.json": '{"s":[{"appliedAt":"t2","v":2}]}' });
    expect(codexHomeTreeSha256(c)).not.toBe(codexHomeTreeSha256(home({ ...base, ".codex/gsd-install-state.json": '{"s":[{"appliedAt":"t2","v":1}]}' })));
  });

  test("codex-pins.json holds a pin per s-* arm, s-none's the empty tree, and a home off its pin refuses", () => {
    for (const arm of S_ARMS) expect(readCodexPin(arm).home_tree_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readCodexPin("s-none")).toMatchObject({ home_tree_sha256: sha(""), roots: [] });
    expect(readCodexPin("s-gstack-line").agents_md_sha256).toBe(X.parts.S.agents_md_sha256);
    expect(() => checkCodexHome(home({}), "s-none")).not.toThrow();
    expect(() => checkCodexHome(home({ ".codex/AGENTS.md": "x\n" }), "s-none")).toThrow(/^E_H2HX_CODEX_INSTALL .*not s-none's pinned/);
  });

  test("containment over a Codex home confirms a fix line a plugin cache holds, and passes a clean home", () => {
    const FIX = "    let total_after_reset = counter.reset_and_count();";
    const row = fixtureRow({ repo: "example-org/widget", instance_id: "example-org__widget-7", patch: "diff --git a/src/counter.rs b/src/counter.rs\n--- a/src/counter.rs\n+++ b/src/counter.rs\n@@ -1 +1,2 @@\n fn reset() {}\n+" + FIX + "\n", test_patch: "diff --git a/tests/counter.rs b/tests/counter.rs\n--- a/tests/counter.rs\n+++ b/tests/counter.rs\n@@ -1 +1,2 @@\n // tests\n+    assert_eq!(counter.reset_and_count(), 0);\n", FAIL_TO_PASS: ["counter::reset_clears_the_total_value"] });
    const unitDir = join(mkdtempSync(join(tmpdir(), "h2hx-unit-")), "u");
    writeUnit(unitDir, { ...toCandidate("rust", row), image_digest: "sha256:" + "c".repeat(64) }, row);
    const where = { kind: "host" as const, dir: fixtureRepo({ "src/counter.rs": "fn reset() {}\n", "tests/counter.rs": "// tests\n" }).dir };
    const clean = containCodexHome({ arm: "s-superpowers", home: home({ ".codex/plugins/cache/superpowers-dev/superpowers/7.0.2/README.md": "Superpowers.\n" }), unitDir, where });
    expect(clean).toMatchObject({ arm: "s-superpowers", home: "s-superpowers", ok: true, confirmed: 0 });
    const dirty = home({ ".codex/plugins/cache/x/y/1/src/counter.rs": "fn reset() {}\n" + FIX + "\n" });
    const hit = containCodexHome({ arm: "s-superpowers", home: dirty, unitDir, where });
    expect(hit.ok).toBe(false);
    expect(hit.home_tree_sha256).toBe(codexHomeTreeSha256(dirty));
  });
});

const sources = process.env.H2H_SOURCES ?? "";
describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1" || !existsSync(sources))("part S Codex installs in Docker", () => {
  for (const arm of ["s-tstack", "s-superpowers"] as const) {
    test(arm + " installs twice to its pinned tree hash", async () => {
      const root = mkdtempSync(join(tmpdir(), "h2hx-install-"));
      const one = await installCodexHome(arm, { home: join(root, "a"), sources });
      const two = await installCodexHome(arm, { home: join(root, "b"), sources });
      expect(one.exit).toBe(0);
      expect(one.home_tree_sha256).toBe(two.home_tree_sha256);
      expect(one.home_tree_sha256).toBe(readCodexPin(arm).home_tree_sha256);
      expect(() => checkCodexHome(join(root, "a"), arm)).not.toThrow();
    }, 1_800_000);
  }
});
