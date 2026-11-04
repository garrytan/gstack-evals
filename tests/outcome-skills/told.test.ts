// The told install at gstack 699a41cb (G prereg section 2; O1): ./setup --host claude --loadout lite in a clean HOME,
// exactly as #193's install-pin.sh runs it, checked against #193's after-pin lite manifest. The digest rule runs keyless
// on a small tree; the full check runs when OUTCOME_TOLD_HOME names a home installed by told-install.sh.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkToldHome, liteTreeDigest, TOLD_INSTALL_SH, TOLD_PIN } from "../../lanes/outcome-skills/arms/told.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const put = (p: string, text: string) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, text));

describe("the told pin and install", () => {
  test("the pin is the prereg's, with #193's after-pin lite manifest and the raw skill sources the prereg read", () => {
    expect(TOLD_PIN).toMatchObject({ sha: "699a41cb6808e01240d02e82247693f9170d401a", version: "1.94.39.0", loadout: "lite", lite_files: 204, lite_tree_digest: "ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7", lite_spec_sha256: "c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d" });
    expect(TOLD_PIN.sources).toMatchObject({ "plan-eng-review/SKILL.md": "58d96f6f3e296ccc2942e2e1a5732810b18f9f8bcd6ed9338115c99c91a88524", "autoplan/SKILL.md": "a1f4036492f6b27c1f9b96b256408207bfc97e804bebb478a2f04a5d538a46ca" });
    expect(TOLD_PIN.hooks).toEqual(["Stop gstack-timeline-stop 5", "Stop gstack-skill-contract 10", "UserPromptSubmit gstack-skill-route 5"]);
  });

  test("told-install.sh runs setup as #193 does: env -i, the clean HOME, lite, no browser or fonts, and checks out the pin by sha", () => {
    const sh = readFileSync(TOLD_INSTALL_SH, "utf8");
    expect(sh).toContain("./setup --host claude --loadout lite");
    expect(sh).toContain("GSTACK_SKIP_PLAYWRIGHT=1 GSTACK_SKIP_FONTS=1");
    expect(sh).toContain("env -i HOME=");
    expect(sh).toContain(TOLD_PIN.sha);
  });

  test("the lite digest normalizes the render folder and the home in each file, skips the lock, and sorts by path", () => {
    const home = mkdtempSync(join(tmpdir(), "outcome-told-"));
    roots.push(home);
    const render = join(home, ".gstack", "render", "claude");
    put(join(render, "b", "SKILL.md"), "Read " + render + "/b/sections/x.md — and " + home + "/.claude/skills/gstack/bin\n");
    put(join(render, "a.md"), "plain\n");
    put(join(render, "loadout.lock.json"), "{}\n");
    const other = mkdtempSync(join(tmpdir(), "outcome-told-other-"));
    roots.push(other);
    const render2 = join(other, ".gstack", "render", "claude");
    put(join(render2, "b", "SKILL.md"), "Read " + render2 + "/b/sections/x.md — and " + other + "/.claude/skills/gstack/bin\n");
    put(join(render2, "a.md"), "plain\n");
    const one = liteTreeDigest(home), two = liteTreeDigest(other);
    expect(one).toEqual(two);
    expect(one.files).toBe(2);
    const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
    expect(one.digest).toBe(sha("a.md\t" + sha("plain\n") + "\nb/SKILL.md\t" + sha("Read <RENDER>/b/sections/x.md — and <HOME>/.claude/skills/gstack/bin\n") + "\n"));
  });

  test("a home that is not an install is refused with E_OUTCOME_TOLD_INSTALL", () => {
    const home = mkdtempSync(join(tmpdir(), "outcome-told-bad-"));
    roots.push(home);
    expect(() => checkToldHome(home)).toThrow(/^E_OUTCOME_TOLD_INSTALL /);
  });
});

const HOME_DIR = process.env.OUTCOME_TOLD_HOME ?? "";
describe.skipIf(!HOME_DIR)("an installed told home (OUTCOME_TOLD_HOME)", () => {
  test("matches #193's after-pin lite manifest: pin, loadout, 204 files, the digest, the hooks and the skill sources", () => {
    expect(checkToldHome(HOME_DIR)).toMatchObject({ ok: true, sha: TOLD_PIN.sha, version: TOLD_PIN.version, loadout: "lite", files: 204, digest: TOLD_PIN.lite_tree_digest, hooks: TOLD_PIN.hooks, review_sections: expect.stringMatching(/\/\.gstack\/render\/claude\/plan-eng-review\/sections\/review-sections\.md$/) });
  });

  test("a copy at another home still matches once its paths move with it; one changed render file is refused", () => {
    const copy = mkdtempSync(join(tmpdir(), "outcome-told-copy-"));
    roots.push(copy);
    const sh = (c: string) => require("node:child_process").spawnSync("sh", ["-c", c], { encoding: "utf8" });
    sh("cp -a '" + HOME_DIR + "/.' '" + copy + "' && grep -rlF '" + HOME_DIR + "' '" + copy + "/.gstack/render' '" + copy + "/.claude/settings.json' | xargs sed -i 's|" + HOME_DIR + "|" + copy + "|g'");
    expect(checkToldHome(copy)).toMatchObject({ ok: true, digest: TOLD_PIN.lite_tree_digest });
    const f = join(copy, ".gstack", "render", "claude", "plan-eng-review", "SKILL.md");
    writeFileSync(f, readFileSync(f, "utf8") + "\n");
    expect(() => checkToldHome(copy)).toThrow(/^E_OUTCOME_TOLD_INSTALL .*digest/);
  });
});
