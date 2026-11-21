// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's runtime volume: the Codex pin as prereg.json freezes it, the manifest and volume name, and (GSTACK_EVALS_DOCKER=1)
// the volume built on the base one, with every version and both Codex digests read back.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { RUNTIME_MANIFEST, RUNTIME_PINS, RUNTIMES_DIR, runtimeVolume } from "../../lanes/outcome-skills/h2h/sessions/runtimes.ts";
import { readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { buildExtRuntimeVolume, codexPin, extRuntimeManifest, extRuntimeVolume, solAgentPath } from "../../lanes/outcome-skills/h2h/ext/runtimes.ts";

const digests = { codex_sha256: "a".repeat(64), host_sha256: "b".repeat(64) };

describe("part S runtime volume", () => {
  test("reads the Codex pin from prereg.json and links it under a name gstack never reads as codex", () => {
    const pin = codexPin();
    expect(pin).toMatchObject({ version: "0.170.0", url: "https://registry.npmjs.org/@openai/codex/-/codex-0.170.0-linux-x64.tgz", link: "sol-agent" });
    expect(pin.tgz_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pin.host).toBe("package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host");
    expect(solAgentPath()).toBe(RUNTIMES_DIR + "/bin/sol-agent");
  });

  test("refuses a tarball that names another version, or a link name on the avoid list", () => {
    const x = readExtPrereg();
    const bad = (codex: object) => () => codexPin({ ...x, parts: { ...x.parts, S: { ...x.parts.S, codex: { ...x.parts.S.codex, ...codex } } } } as typeof x);
    expect(bad({ platform_tgz: "@openai/codex@0.169.0-linux-x64" })).toThrow(/^E_H2HX_CODEX_RUNTIME .*names 0\.169\.0/);
    expect(bad({ platform_tgz: "@openai/codex@0.170.0-darwin-arm64" })).toThrow(/^E_H2HX_CODEX_RUNTIME /);
    expect(bad({ link_name: "codex" })).toThrow(/^E_H2HX_CODEX_RUNTIME .*names to avoid/);
  });

  test("names the volume by a manifest that holds the base volume's, so the base volume stays its own", () => {
    const m = extRuntimeManifest(digests);
    expect(m.base).toEqual({ volume: runtimeVolume(), manifest: RUNTIME_MANIFEST });
    expect(m.codex.link).toBe("bin/sol-agent -> ../codex/codex");
    expect(extRuntimeVolume(m)).toMatch(/^h2hx-runtimes-[0-9a-f]{16}$/);
    expect(extRuntimeVolume(m)).not.toBe(extRuntimeVolume(extRuntimeManifest({ ...digests, host_sha256: "c".repeat(64) })));
  });
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("part S runtime volume in Docker", () => {
  test("builds on the base volume and reads back every pin, with sol-agent printing codex-cli 0.170.0", async () => {
    const v = await buildExtRuntimeVolume();
    expect(v.volume).toBe(extRuntimeVolume(v.manifest));
    expect(v.base_volume).toBe(runtimeVolume());
    expect(v.versions["sol-agent"]).toBe("codex-cli 0.170.0");
    expect(v.versions.codex).toBe(v.manifest.codex.codex_sha256);
    const again = await buildExtRuntimeVolume();
    expect(again).toMatchObject({ volume: v.volume, reused: true });
    const base = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", v.base_volume + ":/b:ro", "--entrypoint", "sh", RUNTIME_PINS.node.image, "-c", "test ! -e /b/codex && test ! -e /b/bin/sol-agent && echo clean"], { encoding: "utf8" });
    expect(base.stdout.trim()).toBe("clean");
  }, 1_800_000);
});
