// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, FEAT_SHA256, featDigest, featFirst800, isProtected } from "../../lanes/outcome-skills/statemachines/langs.ts";
import { fixtureRow } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { screen } from "../../lanes/outcome-skills/statemachines/screen.ts";
import { imageRef, patchFiles, splitImage, toCandidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import { main } from "../../lanes/outcome-skills/statemachines/cli.ts";

const supply = join(import.meta.dir, "../../wiki/plans/2026-11-09-geva-409-state-machines-prompt-prereg/supply-count.py");

describe("state machines source", () => {
  test("the feature screen is supply-count.py's FEAT text, pinned by sha256", () => {
    expect(featDigest()).toBe(FEAT_SHA256);
    const line = readFileSync(supply, "utf8").split("\n").find((l) => l.startsWith("FEAT = "))!;
    expect(line).toContain('r"' + String.raw`\b(feature request|add support for|support for|would be nice|enhancement|proposal|new option|allow (users? )?to)\b` + '"');
    expect(featFirst800("Feature request: a new mode")).toBe(true);
    expect(featFirst800("x".repeat(800) + " feature request")).toBe(false);
    expect(featFirst800("The parser crashes on empty input")).toBe(false);
    expect(featFirst800("Please allow users to pick")).toBe(true);
  });

  test("classify follows the frozen conventions and the unit's own test patch", () => {
    expect(classify("rust", "src/lib.rs")).toBe("source");
    expect(classify("rust", "tests/it.rs")).toBe("test");
    expect(classify("rust", "src/lib.rs", new Set(["src/lib.rs"]))).toBe("test");
    expect(classify("java", "core/src/main/java/a/Foo.java")).toBe("source");
    expect(classify("java", "core/src/test/java/a/FooTest.java")).toBe("test");
    expect(classify("go", "pkg/a_test.go")).toBe("test");
    expect(classify("csharp", "src/Lib.Tests/AThing.cs")).toBe("test");
    expect(classify("js", "lib/__tests__/a.js")).toBe("test");
    expect(classify("c", "vendor/x.c")).toBe("other");
    expect(classify("cpp", "README.md")).toBe("other");
    expect(isProtected("crates/a/Cargo.toml")).toBe(true);
    expect(isProtected("src/lib.rs")).toBe(false);
  });

  test("a row becomes a candidate of ids and counts, and the screen names each drop's rule", () => {
    const c = toCandidate("rust", fixtureRow());
    expect(c).toMatchObject({ id: "example-org__widget-7", month: "2026-04", f2p: 1, p2p: 1, fix_files: 1, fix_source_files: 1, test_files: 1, tests_share_fix_file: false, feature_screen: false, image_digest: null });
    expect(JSON.stringify(c)).not.toContain("reset_and_count");
    const d = "sha256:" + "b".repeat(64);
    const ok = { ...c, image_digest: d };
    const s = screen([c, ok, { ...ok, id: "f", f2p: 0 }, { ...ok, id: "p", p2p: 0 }, { ...ok, id: "n", fix_source_files: 7 }, { ...ok, id: "z", fix_source_files: 0 }, { ...ok, id: "q", feature_screen: true }]);
    expect(s.eligible.map((e) => e.id)).toEqual(["example-org__widget-7"]);
    expect(s.drops.map((x) => x.rule)).toEqual(["image_digest", "fail_to_pass", "pass_to_pass", "fix_source_files_1_to_6", "fix_source_files_1_to_6", "feature_request_screen"]);
    expect(s.drops.every((x) => x.code === "E_SM_INELIGIBLE")).toBe(true);
    expect(imageRef(ok)).toBe("example/widget-7@" + d);
    expect(splitImage("starryzhang/sweb.eval.x86_64.a_1776_b-1")).toEqual({ repo: "starryzhang/sweb.eval.x86_64.a_1776_b-1", tag: "latest" });
    expect(patchFiles(fixtureRow().patch)).toEqual(["src/counter.rs"]);
  });

  test("the sm CLI prints help and refuses unknown commands with E_USAGE", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["nope"])).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), "sm-cli-"));
    writeFileSync(join(dir, "u.json"), "[]");
    expect(await main(["draw", join(dir, "u.json"), "--prereg", join(dir, "missing.json"), "--out", join(dir, "d.json")])).toBe(2);
  });
});
