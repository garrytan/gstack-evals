// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { contaminationSearch, formsOf, noneArchiveProblem, scanText, treeProblems } from "../../lanes/weekly-stable/arms.ts";

const FIX = join(import.meta.dir, "fixtures"), roots: string[] = [];
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "weekly-arms-")); roots.push(d); return d; };
// Real text: id lines from gstack v1.102.2.0's old routing fixture, the file the preregistration's 60 exclusions came from.
const REAL = readFileSync(join(FIX, "gstack-fixture-ids.txt"), "utf8");

describe("the contamination search", () => {
  test("the four forms of an id", () => {
    expect(formsOf("psd-tools__psd-tools-593")).toEqual({ id: "psd-tools__psd-tools-593", owner: "psd-tools", repo: "psd-tools", n: "593", others: ["psd-tools/psd-tools#593", "psd-tools/psd-tools/pull/593", "psd-tools/psd-tools/issues/593"] });
  });
  test("ids in gstack's real fixture are found; one more digit or another case for the id form is not the same task", () => {
    expect(scanText(REAL, ["optuna__optuna-6428", "tobymao__sqlglot-7187", "careamics__careamics-688"])).toEqual(["optuna__optuna-6428", "tobymao__sqlglot-7187"]);
    expect(scanText(REAL, ["optuna__optuna-642"])).toEqual([]);
    expect(scanText("see OPTUNA__optuna-6428", ["optuna__optuna-6428"])).toEqual([]);
    expect(scanText("fixed in Optuna/OPTUNA#6428.", ["optuna__optuna-6428"])).toEqual(["optuna__optuna-6428"]);
    expect(scanText("github.com/optuna/optuna/pull/64280", ["optuna__optuna-6428"])).toEqual([]);
    expect(scanText("github.com/optuna/optuna/issues/6428", ["optuna__optuna-6428"])).toEqual(["optuna__optuna-6428"]);
  });
  test("grep over a tree finds the real fixture's ids, binary files included, and names the file", () => {
    const d = scratch();
    mkdirSync(join(d, "a/b"), { recursive: true });
    writeFileSync(join(d, "a/b/fixture.json"), REAL);
    writeFileSync(join(d, "a/blob.bin"), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from("deepset-ai/haystack/pull/10547\u0000")]));
    const r = contaminationSearch(d, ["pandas-dev__pandas-63945", "deepset-ai__haystack-10547", "careamics__careamics-688"]);
    expect(r).toEqual({ hits: { "deepset-ai__haystack-10547": ["./a/b/fixture.json", "./a/blob.bin"], "pandas-dev__pandas-63945": ["./a/b/fixture.json"] }, error: null });
  });
});

describe("a built tree's checks", () => {
  const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { encoding: "utf8" });
  const tree = () => {
    const d = scratch(), g = join(d, ".claude/skills/gstack");
    mkdirSync(g, { recursive: true }); mkdirSync(join(d, ".gstack"));
    git(g, "init", "-q"); writeFileSync(join(g, "VERSION"), "1.0.0\n"); git(g, "add", "-A"); git(g, "commit", "-qm", "one");
    writeFileSync(join(d, ".claude/settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: "/root/.claude/skills/gstack/hosts/claude/hooks/skill-route-hook", timeout: 5 }], _gstack_source: "gstack-skill-route" }] } }));
    writeFileSync(join(d, ".gstack/config.yaml"), "update_check: false\nrouting_declined: true\n");
    for (const m of [".activated", ".completeness-intro-seen", ".feature-prompted-model-overlay", ".first-loop-tip-shown", ".proactive-prompted", ".telemetry-prompted"]) writeFileSync(join(d, ".gstack", m), "");
    return { d, g, sha: git(g, "rev-parse", "HEAD").stdout.trim() };
  };
  test("one commit at the sha, no remote, hooks, the seeded user and telemetry off: no problem", () => {
    const t = tree();
    expect(treeProblems(t.d, t.sha, { telemetry: "off" })).toEqual([]);
  });
  test("history, a remote, a FETCH_HEAD, the wrong sha or telemetry on are each named", () => {
    const t = tree();
    git(t.g, "commit", "-q", "--allow-empty", "-m", "two"); git(t.g, "remote", "add", "origin", "https://example.invalid/x.git");
    writeFileSync(join(t.g, ".git/FETCH_HEAD"), "");
    const p = treeProblems(t.d, t.sha, { telemetry: "community" });
    expect(p.map((x) => x.split(" ").slice(0, 5).join(" "))).toEqual(["the gstack checkout is at", "the gstack checkout holds 2", "the gstack checkout has a", "the gstack checkout keeps a", "gstack-config reads telemetry \"community\", not"]);
  });
});

describe("the no-gstack archive itself", () => {
  test("the none tar or tar.gz the run stages must hash to the pinned tar; a missing or different archive is a problem", () => {
    const d = scratch(), bytes = Buffer.from("none arm bytes"), want = createHash("sha256").update(bytes).digest("hex");
    expect(noneArchiveProblem(d, want)).toMatch(/no none.tar.gz or none.tar/);
    writeFileSync(join(d, "none.tar"), bytes);
    expect(noneArchiveProblem(d, want)).toBeNull();
    expect(noneArchiveProblem(d, "0".repeat(64))).toMatch(/none.tar has sha256 /);
    spawnSync("sh", ["-c", 'gzip -c "$1" > "$2"', "sh", join(d, "none.tar"), join(d, "none.tar.gz")]);
    expect(noneArchiveProblem(d, want)).toBeNull();
    writeFileSync(join(d, "none.tar.gz"), "not gzip");
    expect(noneArchiveProblem(d, want)).toMatch(/none.tar.gz unpacks to sha256/);
  });
});
