// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PREREG_PATH } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { RUNTIME_BIN, RUNTIME_MANIFEST, RUNTIME_PINS, RUNTIMES_DIR, runtimeVolume } from "../../lanes/outcome-skills/h2h/sessions/runtimes.ts";

describe("h2h runtime volume", () => {
  test("pins every tool prereg.json names, by image digest or download sha256, at the frozen mount", () => {
    const frozen = JSON.parse(readFileSync(PREREG_PATH, "utf8")).runtimes as { mount: string; tools: string[] };
    expect(RUNTIMES_DIR).toBe(frozen.mount);
    expect(Object.keys(RUNTIME_PINS).sort()).toEqual([...frozen.tools].sort());
    for (const pin of Object.values(RUNTIME_PINS)) {
      expect(pin.version.length).toBeGreaterThan(0);
      if ("image" in pin) expect(pin.image).toMatch(/@sha256:[0-9a-f]{64}$/);
      else expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(RUNTIME_PINS.bun.version).toMatch(/^1\.4\.([2-9]|\d{2,})$/);
  });

  test("links each tool into bin and names the volume by its manifest", () => {
    for (const t of ["node", "npm", "npx", "bun", "bunx", "python3", "pip3", "gh"]) expect(Object.keys(RUNTIME_BIN)).toContain(t);
    expect(RUNTIME_MANIFEST).toMatchObject({ schema: "h2h-runtimes.v1", dir: RUNTIMES_DIR, pins: RUNTIME_PINS });
    expect(runtimeVolume()).toMatch(/^h2h-runtimes-[0-9a-f]{16}$/);
  });
});
