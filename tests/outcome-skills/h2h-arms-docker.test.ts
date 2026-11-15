// Copyright (c) 2026 Garry Tan. MIT License.
// Docker tests for part A's installs (GSTACK_EVALS_DOCKER=1): the none and tstack recipes run end to end in the install
// image, tstack's home hashes and pin-checks as arms-pins.json records, and a checked home survives the trip through its
// read-only volume into a session container's /root. The install image builds on first use; tstack's pinned clone comes
// from $H2H_SOURCES when set, else from GitHub into a scratch directory.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeTreeSha256 } from "../../lanes/outcome-skills/h2h/arms/hash.ts";
import { installHome } from "../../lanes/outcome-skills/h2h/arms/install.ts";
import { ARM_HOME, checkHome, HOME_COPY, HOME_VOLUME_MOUNT, homeVolume, loadHomeVolume, recordPath } from "../../lanes/outcome-skills/h2h/arms/layer.ts";
import { pinChecks, readArmInstall } from "../../lanes/outcome-skills/h2h/arms/pins.ts";
import { INSTALL_IMAGE } from "../../lanes/outcome-skills/h2h/arms/recipes.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";

const on = process.env.GSTACK_EVALS_DOCKER === "1";
const tmp = mkdtempSync(join(tmpdir(), "h2h-arms-docker-"));
const sources = process.env.H2H_SOURCES ?? join(tmp, "sources");
const volumes: string[] = [];
afterAll(() => {
  for (const v of volumes) spawnSync("docker", ["volume", "rm", "-f", v]);
});
const LONG = 1_800_000;

describe.skipIf(!on)("h2h arm installs in Docker", () => {
  test("none installs nothing: an empty home that hashes as the empty list", () => {
    const home = join(tmp, "homes", "none");
    const rec = installHome("none", { home, sources });
    expect(rec.exit).toBe(0);
    expect(readdirSync(home)).toEqual([]);
    expect(rec.home_tree_sha256).toBe(createHash("sha256").update("").digest("hex"));
    expect(rec.home_tree_sha256).toBe(readArmInstall("none").home_tree_sha256);
    expect(rec.roots).toEqual([]);
    expect(rec.claude_code_version).toBe(INSTALL_IMAGE.claude_code);
    expect(existsSync(recordPath(home))).toBe(true);
  }, LONG);

  test("tstack installs to arms-pins.json's home, pin-checks, and its volume copies back into an emptied /root byte for byte", async () => {
    const home = join(tmp, "homes", "tstack");
    const rec = installHome("tstack", { home, sources });
    const pinned = readArmInstall("tstack");
    expect(rec.exit).toBe(0);
    expect(rec.home_tree_sha256).toBe(pinned.home_tree_sha256);
    expect(rec.roots).toEqual(pinned.roots);
    const checks = await pinChecks("tstack", home, rec, { sources, prereg: readPrereg() });
    expect(checks.map((c) => c.matched)).toEqual([true]);
    checkHome(home, pinned);
    const volume = loadHomeVolume(home, pinned, rec.image.tag);
    volumes.push(volume);
    expect(volume).toBe(homeVolume("tstack", pinned.home_tree_sha256));
    const out = join(tmp, "session-root");
    mkdirSync(out);
    const t = spawnSync("bash", ["-c", "docker run --rm --network none --user 0:0 -v " + volume + ":" + HOME_VOLUME_MOUNT + ":ro --entrypoint sh " + rec.image.tag + " -c 'find " + ARM_HOME + " -mindepth 1 -delete && " + HOME_COPY + " && tar -C " + ARM_HOME + " -cf - .' | tar -x -C " + out], { encoding: "utf8", timeout: 600_000 });
    expect(t.status).toBe(0);
    expect(homeTreeSha256(out)).toBe(pinned.home_tree_sha256);
  }, LONG);

  test("a non-empty home is refused, and a changed home drifts", () => {
    const home = join(tmp, "homes", "tstack");
    expect(() => installHome("tstack", { home, sources })).toThrow(/^E_H2H_INSTALL .*is not empty/);
    writeFileSync(join(home, ".claude", "skills", "extra.md"), "x\n");
    expect(() => checkHome(home, readArmInstall("tstack"))).toThrow(/^E_H2H_HOME_DRIFT /);
  });
});
