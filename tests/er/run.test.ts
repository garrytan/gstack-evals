// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review lens's spec (src/trial/review/eng-review.ts): prompts, order, admission, unit trees and the gstack pins.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildErTree, clonePinProblems, ER_COMMON, ER_FORCED, ER_LENS_LINE, ER_TEMPLATE, erAdmits, erOrder, erPrompt, erUnitProblems } from "../../src/trial/review/eng-review.ts";

const git = (dir: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=Test Writer", "-c", "user.email=test@example.invalid", "-C", dir, ...args], { encoding: "utf8" });
function unit(root: string, id: string, extra?: (repo: string) => void): void {
  const repo = join(root, id, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(root, id, "unit.json"), JSON.stringify({ id }));
  writeFileSync(join(root, id, "plan.md"), "Add a nightly export of the ledger.\n");
  writeFileSync(join(root, id, "key.json"), JSON.stringify({ items: ["never mounted"] }));
  writeFileSync(join(repo, "app.py"), "def export():\n    return []\n");
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  extra?.(repo);
}

describe("eng-review prompts", () => {
  test("each arm's prefix, then the common line, a blank line and the template", () => {
    expect(erPrompt("none")).toBe(ER_COMMON + "\n\n" + ER_TEMPLATE);
    expect(erPrompt("lens")).toBe(ER_LENS_LINE + "\n" + ER_COMMON + "\n\n" + ER_TEMPLATE);
    expect(erPrompt("precut")).toBe("/plan-eng-review plan.md\n" + ER_FORCED + "\n" + ER_COMMON + "\n\n" + ER_TEMPLATE);
    expect(erPrompt("candidate")).toBe("/plan-coverage plan.md\n" + ER_FORCED + "\n" + ER_COMMON + "\n\n" + ER_TEMPLATE);
    expect(erPrompt("engphase", "OPENING\n")).toBe("OPENING\n" + ER_FORCED + "\n" + ER_COMMON + "\n\n" + ER_TEMPLATE);
    expect(() => erPrompt("engphase")).toThrow(/rendered opening/);
  });
});

describe("eng-review order and admission", () => {
  test("units stay in order; each unit's cells interleave in a seeded order that other cells don't move", () => {
    const order = erOrder(["u1", "u2"], ["none", "lens", "precut"], ["m"], 2);
    expect(order.length).toBe(12);
    expect(order.slice(0, 6).every((c) => c.unit === "u1")).toBe(true);
    expect(erOrder(["u1", "u2"], ["none", "lens", "precut"], ["m"], 2)).toEqual(order);
    const fewer = erOrder(["u1"], ["none", "precut"], ["m"], 2).map((c) => c.arm + c.pass);
    expect(order.filter((c) => c.unit === "u1" && c.arm !== "lens").map((c) => c.arm + c.pass)).toEqual(fewer);
    expect(order.slice(0, 6).map((c) => c.arm).join(",")).not.toBe("none,none,lens,lens,precut,precut");
  });
  test("an attempt starts only when settled plus in-flight allowances plus its own fit under the cap", () => {
    expect(erAdmits(5_000_000, 1, 10_000_000, 25_000_000)).toBe(true);
    expect(erAdmits(5_000_001, 1, 10_000_000, 25_000_000)).toBe(false);
    expect(erAdmits(0, 0, 10_000_000, 10_000_000)).toBe(true);
    expect(erAdmits(0, 0, 10_000_000, 9_999_999)).toBe(false);
  });
});

describe("eng-review unit trees", () => {
  test("a tree is plan.md and repo/ at one commit; key.json never comes along", () => {
    const root = mkdtempSync(join(tmpdir(), "er-units-"));
    unit(root, "u1");
    expect(erUnitProblems(root, "u1")).toEqual([]);
    const tree = buildErTree(root, "u1", join(root, "out", "tree"));
    expect(tree.problems).toEqual([]);
    expect(existsSync(join(root, "out", "tree", "key.json"))).toBe(false);
  });
  test("later history, a remote, a reflog-only commit or a copied key.json is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "er-units-"));
    unit(root, "two", (repo) => {
      writeFileSync(join(repo, "later.py"), "x = 1\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "later");
    });
    expect(erUnitProblems(root, "two").join("\n")).toMatch(/2 commits/);
    unit(root, "remote", (repo) => git(repo, "remote", "add", "origin", "https://example.invalid/x.git"));
    expect(erUnitProblems(root, "remote").join("\n")).toMatch(/has a remote/);
    unit(root, "hidden", (repo) => {
      writeFileSync(join(repo, "later.py"), "x = 1\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "later");
      git(repo, "reset", "-q", "--hard", "HEAD~1");
    });
    expect(erUnitProblems(root, "hidden").join("\n")).toMatch(/unreachable or reflog-only/);
    unit(root, "leak", (repo) => {
      writeFileSync(join(repo, "copy.json"), JSON.stringify({ items: ["never mounted"] }));
      git(repo, "add", ".");
      git(repo, "commit", "-q", "--amend", "-m", "base");
      git(repo, "reflog", "expire", "--expire=now", "--all");
      git(repo, "gc", "-q", "--prune=now");
    });
    expect(buildErTree(root, "leak", join(root, "out", "leak")).problems.join("\n")).toMatch(/copy of the unit's key.json/);
  });
});

const CLONE = join(homedir(), ".capy", "work", "gstack");
describe("eng-review gstack pins", () => {
  test.skipIf(!existsSync(CLONE))("a clone of garrytan/gstack holds each pin at its VERSION and the candidate's two digests", () => {
    expect(clonePinProblems(CLONE)).toEqual([]);
  });
  test("a clone without the pins is refused", () => {
    const empty = mkdtempSync(join(tmpdir(), "er-clone-"));
    git(empty, "init", "-q");
    expect(clonePinProblems(empty).length).toBe(5);
  });
});
