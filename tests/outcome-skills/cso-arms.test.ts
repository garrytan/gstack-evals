// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 2 and 4 (harness plan 15.2): the arms' recipes at this plan's pin, the pinned-file check, the install
// scans and their union over arms, and the Codex stub's refusal of latest.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { checkPinnedFiles, codexArm, csoRecipe, CSO_HOME, everyCellDrops, GSTACK_DIR, verifyArm } from "../../lanes/outcome-skills/cso/arms.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";

const p = loadCsoPrereg();
const put = (root: string, files: Record<string, string>) => {
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), c);
  }
  return root;
};
const tmp = () => mkdtempSync(join(tmpdir(), "cso-arms-"));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PINS = { "cso/SKILL.md": sha("skill"), "cso/sections/audit-phases.md": sha("phases") };
const gstackHome = (extra: Record<string, string> = {}) => put(tmp(), { [GSTACK_DIR + "/cso/SKILL.md"]: "skill", [GSTACK_DIR + "/cso/sections/audit-phases.md"]: "phases", ...extra });

describe("cso arms", () => {
  test("none is h2h's clean room; cso and untold are h2h's gstack recipe at this plan's pin", () => {
    expect(CSO_HOME).toEqual({ none: "none", cso: "gstack", untold: "gstack" });
    expect(csoRecipe("none", p).steps).toEqual([]);
    const r = csoRecipe("cso", p);
    expect(r.sources).toEqual([{ name: "gstack", repo: "garrytan/gstack", sha: p.pins.gstack.sha!, kind: "clone" }]);
    expect(r.steps.some((s) => s.includes(p.pins.gstack.sha!))).toBe(true);
    expect(r.steps.at(-1)).toBe("(cd $HOME/.claude/skills/gstack && ./setup)");
    expect(r.claude_md).toBe(true);
    expect(csoRecipe("untold", p)).toEqual(r);
    expect(Object.keys(p.pins.gstack.files_sha256)).toContain("cso/SKILL.md");
  });
  test("the pinned files must match byte for byte, and the clean room must hold no gstack", () => {
    expect(checkPinnedFiles("cso", gstackHome(), PINS)).toEqual(PINS);
    expect(() => checkPinnedFiles("untold", gstackHome({ [GSTACK_DIR + "/cso/SKILL.md"]: "edited" }), PINS)).toThrow(/^E_CSO_ARM .*cso\/SKILL.md has sha256/);
    expect(() => checkPinnedFiles("cso", tmp(), PINS)).toThrow(/^E_CSO_ARM .*is missing/);
    expect(checkPinnedFiles("none", tmp(), PINS)).toEqual({});
    expect(() => checkPinnedFiles("none", gstackHome(), PINS)).toThrow(/^E_CSO_ARM .*clean-room/);
  });
  test("each installed tree is hashed and scanned; an id or a fixed dependency in any arm drops the unit from every cell", () => {
    const pp = { ...p, pins: { ...p.pins, gstack: { ...p.pins.gstack, files_sha256: PINS } } };
    const ids = [
      { unit: "o__a-ghsa-2345-6789-cfgh", ghsa: "GHSA-2345-6789-cfgh", cves: [], fix_commit: "a".repeat(40) },
      { unit: "o__b-ghsa-3456-789c-fghj", ghsa: "GHSA-3456-789c-fghj", cves: [], fix_commit: "b".repeat(40) },
      { unit: "o__c-ghsa-4567-89cf-ghjm", ghsa: "GHSA-4567-89cf-ghjm", cves: [], fix_commit: "c".repeat(40) },
    ];
    const affected = [
      { unit: "o__b-ghsa-3456-789c-fghj", affected: [{ ecosystem: "npm", name: "libb", ranges: [[{ introduced: "0" }, { fixed: "2.0.0" }]] }] },
      { unit: "o__c-ghsa-4567-89cf-ghjm", affected: [{ ecosystem: "npm", name: "libc", ranges: [[{ introduced: "0" }, { fixed: "2.0.0" }]] }] },
    ];
    const cso = verifyArm("cso", gstackHome({ [GSTACK_DIR + "/CHANGELOG.md"]: "bumped for ghsa-2345-6789-CFGH\n", [GSTACK_DIR + "/bun.lock"]: '{ "packages": { "libb": ["libb@2.1.0", ""], "libc": ["libc@1.9.0", ""] } }\n' }), pp, { ids, affected });
    const none = verifyArm("none", tmp(), pp, { ids, affected });
    expect(cso.home_tree_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(cso.contain_ids.dropped).toEqual(["o__a-ghsa-2345-6789-cfgh"]);
    expect(cso.contain_deps.dropped).toEqual(["o__b-ghsa-3456-789c-fghj"]);
    expect(none.contain_ids.dropped).toEqual([]);
    expect(everyCellDrops([none, cso])).toEqual({ id: ["o__a-ghsa-2345-6789-cfgh"], dep: ["o__b-ghsa-3456-789c-fghj"] });
  });
  test("the Codex stub names the driver and ./setup --host codex, takes model and version from the session record, and refuses latest", () => {
    const proxy = { baseUrl: "http://proxy", slot: "s1", token: "t" };
    const a = codexArm("cso", { model_id: "gpt-6.2-sol", harness_version: "0.140.0" }, p, proxy);
    expect(a.driver).toBe("src/adapters/codex/driver.ts");
    expect(a.setup.at(-1)).toBe("(cd $HOME/gstack && ./setup --host codex)");
    expect(a.setup.join(" ")).toContain(p.pins.gstack.sha!);
    expect(a.entry).toBe("Use the cso skill from gstack for this. ");
    expect(a.argv).toContain("gpt-6.2-sol");
    expect(a.argv.join(" ")).not.toContain("model_reasoning_effort");
    expect(codexArm("none", { model_id: "gpt-6.2-sol", harness_version: "0.140.0" }, p, proxy).setup).toEqual([]);
    expect(() => codexArm("cso", { model_id: "gpt-6.2-sol", harness_version: "latest" }, p, proxy)).toThrow(/^E_CSO_ARM /);
    expect(() => codexArm("cso", { model_id: "openai/gpt-6.2-sol@latest", harness_version: "0.140.0" }, p, proxy)).toThrow(/^E_CSO_ARM /);
    expect(() => codexArm("cso", { model_id: "", harness_version: "0.140.0" }, p, proxy)).toThrow(/^E_CSO_ARM /);
  });
});
