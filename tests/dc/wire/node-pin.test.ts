// Copyright (c) 2026 Garry Tan. MIT License.
// The launcher and the host read the Node pin from the real repository layout (wire/real.ts nodePinPath and
// nodeTarball), the same file stage3/install.ts reads as NODE. The fakes once kept the pin at <root>/stage3/, beside
// docker/, so a launch at the real layout refused before any VM. This test reads the real tree. No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NODE } from "../../../lanes/design-constructed/stage3/install.ts";
import { nodePinPath, nodeTarball } from "../../../lanes/design-constructed/wire/real.ts";
import { REPO_ROOT } from "../../../lanes/design-constructed/wire/fakes.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the Node pin at the real repository layout", () => {
  // Value: protects=the launch's VM file check and the host's VM provider; fails_when=nodeTarball reads the pin from a path that exists only in the fakes; why_new=launch 4 refused with ENOENT on <repo root>/stage3/node-pin.json; seam=nodePinPath and nodeTarball on the real tree; no_claim=the real Node tarball's bytes
  test("nodePinPath under the repo root is the pin install.ts reads, and nodeTarball reads it there", () => {
    expect(existsSync(nodePinPath(REPO_ROOT))).toBe(true);
    expect(JSON.parse(readFileSync(nodePinPath(REPO_ROOT), "utf8"))).toEqual(NODE);
    const d = mkdtempSync(join(tmpdir(), "dc-nodepin-"));
    dirs.push(d);
    const wrong = join(d, "node.tar.xz");
    writeFileSync(wrong, "not node\n");
    expect(() => nodeTarball(wrong, REPO_ROOT)).toThrow(/is not Node .*pinned tarball/);
    expect(() => nodeTarball(join(d, "missing.tar.xz"), REPO_ROOT)).toThrow(/does not exist/);
  });
});
