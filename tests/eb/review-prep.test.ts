import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand, prepareReviewTree, reviewArmSpec } from "../../lanes/eng-build/review-stage.ts";

test("each review arm installs as the arms table says, never with er-cli's all-default install", () => {
  expect(reviewArmSpec("none")).toBeNull();
  expect(reviewArmSpec("plain")).toEqual({ name: "plain", kind: "bare" });
  expect(installCommand("precut")).toBe("./setup --host claude --no-browser -q");
  expect(installCommand("engphase")).toBe("./setup --host claude --no-browser -q");
  expect(installCommand("candidate")).toBe("./setup --host claude");
});

test("the review tree is stripped, and a base commit holding a stripped name is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "eb-review-prep-"));
  const g = (...a: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" });
  g("init", "-q");
  writeFileSync(join(dir, "app.go"), "package main\n");
  g("add", "app.go");
  g("commit", "-q", "-m", "base");
  mkdirSync(join(dir, "x", ".claude"), { recursive: true });
  writeFileSync(join(dir, "x", "AGENTS.md"), "gstack");
  expect(prepareReviewTree(dir)).toEqual(["x/.claude", "x/AGENTS.md"]);
  writeFileSync(join(dir, "CLAUDE.md"), "x");
  g("add", "CLAUDE.md");
  g("commit", "-q", "--amend", "-m", "base");
  expect(() => prepareReviewTree(dir)).toThrow("the base commit still holds CLAUDE.md");
});
