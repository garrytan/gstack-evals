// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic planted units and stub seams for the stages tests: no real repository, fix or case id.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewSession } from "../../../lanes/eng-build/pipeline.ts";
import type { AuthorCall, AuthorMaterial } from "../../../lanes/eng-planted/stages/author.ts";
import type { PlantedSession } from "../../../lanes/eng-planted/stages/build.ts";
import type { PlantedGrader, PlantedUnit } from "../../../lanes/eng-planted/types.ts";

export const unitId = (i: number) => "u" + String(i).padStart(3, "0");

/** n units under <dir>/units and their one-commit B trees under <dir>/repos; units listed in shared use one repository label. */
export function plantedUnits(dir: string, n: number, shared: number[] = []): { units: string; repos: string; ids: string[] } {
  const units = join(dir, "units");
  const repos = join(dir, "repos");
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = unitId(i);
    ids.push(id);
    const u: PlantedUnit = { id, repo: shared.includes(i) ? "shared" : "r" + i, set: "comparison", ecosystem: "go", stars: "300-999", publicMonth: "2026-10", strictWindow: true, regionLines: 4, planted: ["p1"], plantedClass: { p1: "assert" }, functional: ["f1"], foresee: null, winnable: null, hard: null, pilot: false };
    mkdirSync(join(units, id), { recursive: true });
    writeFileSync(join(units, id, "ep-unit.json"), JSON.stringify(u));
    const m: AuthorMaterial = { stubbed: [{ path: "src/" + id + ".go", text: "// Parse reads a range.\nfunc Parse(s string) (int, int) { panic(\"stub\") }\n" }], implementation: [{ path: "src/" + id + ".go", text: "func Parse(s string) (int, int) { return 0, 0 }\n" }], tests: [], callers: [], fix: { message: "Fix the range of " + id, diff: "-return 0, 0\n+return 1, 1\n" } };
    writeFileSync(join(units, id, "ep-author.json"), JSON.stringify(m));
    writeFileSync(join(units, id, "ep-note.md"), "The change adds Parse to " + id + ".\n");
    writeFileSync(join(units, id, "eb.json"), "{}\n");
    const b = join(repos, id);
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, "range.go"), "package r\n\nfunc Parse(s string) (int, int) { panic(\"stub\") }\n");
    const git = (args: string[]) => spawnSync("git", ["-C", b, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
  }
  return { units, repos, ids };
}

const unitIn = (prompt: string) => /src\/(u\d{3})\.go/.exec(prompt)?.[1] ?? /Fix the range of (u\d{3})/.exec(prompt)?.[1] ?? null;

/** Authoring calls by unit: plan audit failures for audit, both raters no for unforeseeable. */
export function authorStub(o: { audit?: string[]; unforeseeable?: string[]; seen?: string[] } = {}): AuthorCall {
  let last: string | null = null;
  return async (role, prompt) => {
    const id = unitIn(prompt) ?? last;
    last = id;
    o.seen?.push(role + ":" + id);
    if (role === "writer") return { text: "# Plan for " + id + "\n\n" + Array.from({ length: 240 }, () => "word").join(" "), costUsd: 0.1 };
    if (role === "audit") return { text: "CONDITION: " + (o.audit?.includes(id!) ? "FIXED" : "SILENT") + "\nCODE: SIGNATURES", costUsd: 0.1 };
    if (role === "hint") return { text: "Parse must handle the range of " + id + " written in either order.", costUsd: 0.05 };
    if (role === "hintAudit") return { text: "HINT: CLEAN", costUsd: 0.05 };
    return { text: "FORESEE: " + (o.unforeseeable?.includes(id!) ? "no" : "yes"), costUsd: 0.05 };
  };
}

export interface SeenBuild {
  cell: string;
  unit: string;
  arm: string;
  prompt: string;
  plan: string;
  review: string | null;
}

/** Build sessions that leave a tree with a test patch and a transcript that reads /work/review when the cell has one. */
export function buildStub(dir: string, seen: SeenBuild[], o: { costUsd?: number } = {}): PlantedSession {
  return async (s) => {
    seen.push({ cell: s.cell, unit: s.unit.id, arm: s.arm, prompt: s.prompt, plan: s.plan, review: s.review });
    const tree = mkdtempSync(join(dir, "tree-"));
    writeFileSync(join(tree, "arm.txt"), s.arm);
    writeFileSync(join(tree, "final.patch"), "diff --git a/range_test.go b/range_test.go\n--- /dev/null\n+++ b/range_test.go\n@@ -0,0 +1,2 @@\n+package r\n+func TestParse(t *testing.T) {}\n");
    const read = s.review ? [{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/work/review/review.md" } }] } }] : [];
    writeFileSync(join(tree, "sdk-messages.jsonl"), read.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return { outcome: "completed", tree, costUsd: o.costUsd ?? 2 };
  };
}

/** A grader that passes every planted case, except the hinted builds of the units in unwinnable. */
export function graderStub(unwinnable: string[] = []): PlantedGrader {
  return {
    grade: async (u, _dir, tree) => {
      const arm = (await Bun.file(join(tree, "arm.txt")).text()).trim();
      const pass = !(arm === "hinted" && unwinnable.includes(u.id));
      return { planted: [{ id: "p1", runs: pass ? ["pass", "pass", "pass"] : ["assert", "assert", "assert"] }], functional: [{ id: "f1", runs: ["pass", "pass", "pass"] }] };
    },
    catchOf: async () => ({ catch: true, drop: null }),
  };
}

export interface SeenReview {
  cell: string;
  arm: string;
  prompt: string;
  plan: string;
  repoFiles: string[];
}

/** Review sessions that end at once with a reviewed plan and a final reply; nothing is exposed. */
export function reviewStub(seen: SeenReview[], o: { costUsd?: number } = {}): ReviewSession {
  return async (s) => {
    const plan = await Bun.file(join(s.seed, "plan.md")).text();
    const files = spawnSync("git", ["-C", join(s.seed, "repo"), "ls-files"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    seen.push({ cell: s.cell, arm: s.arm, prompt: s.prompt, plan, repoFiles: files });
    const transcript = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Reviewed " + s.unit.id + "." }] } }) + "\n";
    return { end: "completed", costUsd: o.costUsd ?? 0.5, result: { dir: s.dir, outputs: { plan: plan + "\n## Review\n\nTest the reversed range.\n", transcript, stateRoot: null, coverage: null }, repoEdits: 0, blocks: 0 } };
  };
}
