// Copyright (c) 2026 Garry Tan. MIT License.
// The construct part's dry-run cases (plan section 13). Keyless cases run anywhere; Docker cases build each fixture
// unit once per process and print SKIP without GSTACK_EVALS_DOCKER=1. Each case returns ok and a one-line detail of
// counts; none prints a fixture's code.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { plantedNote } from "../../eng-build/note.ts";
import { plantedClass, recipeFor } from "../../eng-build/recipes.ts";
import { readUnit } from "../../eng-build/unit.ts";
import { EpError } from "../errors.ts";
import type { DryCase, Ecosystem, PlantedUnit } from "../types.ts";
import { construct, type Constructed } from "./build.ts";
import { bundleHistory } from "./checks.ts";
import { goFixture, nodeFixture, pyFixture, rustFixture, stubGitHub } from "./fixtures.ts";
import { pinImages, plantedGrader, qualify, RECIPE, recount, type Outcome } from "./grade.ts";
import { NEUTRAL, type MinedFix } from "./local.ts";
import { mineRepo } from "./mine.ts";
import { supplyGate, supplyReport } from "./supply.ts";

const git = (dir: string, args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" }).stdout ?? "";
const scratch = (): string => mkdtempSync(join(tmpdir(), "ep-dry-"));
const FIXTURES: Record<Ecosystem, (dir: string) => Record<string, string>> = { go: goFixture, python: pyFixture, node: nodeFixture, rust: rustFixture };

async function mineOne(eco: Ecosystem, dir: string, prOpened?: string): Promise<{ fix: MinedFix | null; stats: Record<string, number> }> {
  const r = await mineRepo({ repo: "fixture/" + eco, eco, stars: 500, mirror: dir, github: stubGitHub(prOpened) });
  return { fix: r.fixes[0] ?? null, stats: r.stats };
}

async function constructed(eco: Ecosystem): Promise<{ dir: string; fix: MinedFix; unit: Constructed; sha: Record<string, string> }> {
  const dir = join(scratch(), eco);
  const sha = FIXTURES[eco](dir);
  const { fix } = await mineOne(eco, dir);
  if (!fix) throw new Error(eco + " fixture mined no fix");
  const c = construct(dir, fix);
  if (!c.ok) throw new Error(eco + " fixture did not construct: " + c.reason);
  return { dir, fix, unit: c.unit, sha };
}

interface Built {
  dir: string;
  fix: MinedFix;
  unit: Constructed;
  outcome: Outcome;
  unitDir: string;
  work: string;
  images: Record<string, string>;
}
const builds = new Map<Ecosystem, Promise<Built>>();
/** One fixture through mine, construct, screen, build and recount, once per process. */
function built(eco: Ecosystem): Promise<Built> {
  if (!builds.has(eco))
    builds.set(
      eco,
      (async () => {
        const { dir, fix, unit } = await constructed(eco);
        const root = dirname(dir);
        const work = join(root, "work");
        mkdirSync(work, { recursive: true });
        const images = pinImages(dir, unit.base, unit.merge, unit.fix);
        const unitDir = join(root, "unit");
        let outcome = qualify({ mirror: dir, fix, unit, out: unitDir, work, labels: join(root, "labels.json"), images });
        if (outcome.step === "qualified") outcome = recount(outcome, unitDir, work);
        return { dir, fix, unit, outcome, unitDir, work, images };
      })(),
    );
  return builds.get(eco)!;
}

const line = (o: Outcome) => "step=" + o.step + (o.reason ? " reason=" + o.reason : "") + " planted=" + o.planted + " crash=" + o.crash + " functional=" + o.functional + " region_lines=" + o.regionLines;

/** A checkout of a commit into a fresh directory, with extra files written on top. */
function treeAt(repo: string, rev: string, extra: Record<string, string> = {}): string {
  const dir = scratch();
  spawnSync("sh", ["-c", "git -C \"$1\" archive \"$2\" | tar -x -C \"$3\"", "sh", repo, rev, dir]);
  for (const [p, t] of Object.entries(extra)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), t);
  }
  return dir;
}

function plantedOf(b: Built): PlantedUnit {
  const { eb } = readUnit(b.unitDir);
  const planted = eb.unit.aftermath.flatMap((a) => a.cases);
  return { id: b.fix.id, repo: "r", set: "comparison", ecosystem: b.fix.eco, stars: "300-999", publicMonth: b.fix.earliestPublic.slice(0, 7), strictWindow: false, regionLines: b.unit.regionLines, planted, plantedClass: Object.fromEntries(planted.map((p) => [p, eb.planted?.crash.includes(p) ? "crash" : "assert"])), functional: eb.unit.functional, foresee: null, winnable: null, hard: null, pilot: false };
}

async function catchOf(eco: Ecosystem, files: Record<string, string>) {
  const b = await built(eco);
  if (b.outcome.step !== "clean") return { catch: null, drop: "fixture_not_clean" };
  const base = treeAt(b.dir, b.unit.base);
  const tree = treeAt(b.dir, b.unit.fix, files);
  try {
    return await plantedGrader({ work: b.work }).catchOf(plantedOf(b), b.unitDir, tree, base);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(tree, { recursive: true, force: true });
  }
}

export const DRY: DryCase[] = [
  {
    name: "mine: a fix public before the window drops, and the drop is counted beyond the committer-date window",
    async run() {
      const dir = join(scratch(), "go");
      goFixture(dir);
      const early = await mineOne("go", dir, "2026-06-15T00:00:00Z");
      const plain = await mineOne("go", dir);
      const ok = early.fix === null && early.stats["drop:public_before_window"] === 1 && plain.fix !== null && plain.fix.earliestPublic.startsWith("2026-08-20");
      return { ok, detail: "early=" + (early.stats["drop:public_before_window"] ?? 0) + " dropped, plain mined=" + (plain.fix ? 1 : 0) };
    },
  },
  {
    name: "construct: B is a parentless root with neutral metadata, M holds P's tree, F' holds F's; a unit bundle with a parent is refused",
    async run() {
      const { dir, fix, unit, sha } = await constructed("go");
      const parents = git(dir, ["rev-list", "--parents", "-n", "1", unit.base]).trim().split(" ").length - 1;
      const neutral = git(dir, ["log", "-1", "--format=%an <%ae> %at %s", unit.base]).trim() === NEUTRAL.ident + " " + NEUTRAL.epoch + " " + NEUTRAL.messages.base;
      const trees = git(dir, ["rev-parse", unit.merge + "^{tree}", sha.parent + "^{tree}", unit.fix + "^{tree}", sha.fix + "^{tree}"]).trim().split("\n");
      const b = scratch();
      spawnSync("git", ["bundle", "create", "-q", join(b, "two.bundle"), "main"], { cwd: dir });
      spawnSync("git", ["bundle", "create", "-q", join(b, "one.bundle"), "refs/ep/" + fix.id + "/base"], { cwd: dir });
      let refused = false;
      try {
        bundleHistory("fixture", join(b, "two.bundle"));
      } catch (e) {
        refused = e instanceof EpError && e.code === "E_EP_TESTBED_HISTORY";
      }
      let oneOk = true;
      try {
        bundleHistory("fixture", join(b, "one.bundle"));
      } catch {
        oneOk = false;
      }
      const ok = parents === 0 && neutral && trees[0] === trees[1] && trees[2] === trees[3] && refused && oneOk;
      return { ok, detail: "B parents=" + parents + " neutral=" + neutral + " M=P " + (trees[0] === trees[1]) + " F'=F " + (trees[2] === trees[3]) + " parent bundle refused=" + refused + " root bundle passes=" + oneOk };
    },
  },
  {
    name: "construct: a Go test file's helper that another test file uses stays at B, its test cases go",
    async run() {
      const { dir, unit } = await constructed("go");
      const reduced = git(dir, ["show", unit.base + ":calc_test.go"]);
      const other = git(dir, ["show", unit.base + ":describe_test.go"]);
      const ok = reduced.includes("func check(") && !/func Test/.test(reduced) && other.includes("check(t, Mul(1, 1), 1)") && unit.reduced === 1 && unit.deleted === 0;
      return { ok, detail: "helper kept=" + reduced.includes("func check(") + " cases left=" + (reduced.match(/func Test/g) ?? []).length + " reduced=" + unit.reduced + " deleted=" + unit.deleted };
    },
  },
  {
    name: "body check: a committed Node dist/ bundle holding the removed body drops the unit",
    async run() {
      const root = scratch();
      const dir = join(root, "node");
      nodeFixture(dir, true);
      const { fix } = await mineOne("node", dir);
      if (!fix) return { ok: false, detail: "no fix mined" };
      const c = construct(dir, fix);
      if (!c.ok) return { ok: false, detail: "construct dropped: " + c.reason };
      const o = qualify({ mirror: dir, fix, unit: c.unit, out: join(root, "unit"), work: root, labels: join(root, "labels.json") });
      return { ok: o.step === "body" && o.reason === "body_in_base_tree", detail: line(o) };
    },
  },
  {
    name: "recipes: the Rust registry and git volumes, and the Go image from the toolchain line, else the newest Go",
    run() {
      const rust = recipeFor("rust", () => null, "", new Set(), RECIPE).volumes.map((v) => v[1]);
      const goMod = (text: string) => recipeFor("go", (p) => (p === "go.mod" ? text : null), "", new Set(["go.mod"]), RECIPE).images;
      const old = recipeFor("go", (p) => (p === "go.mod" ? "module x\n\ngo 1.20\n" : null), "", new Set(["go.mod"])).images;
      const minimum = goMod("module x\n\ngo 1.20\n");
      const toolchain = goMod("module x\n\ngo 1.20\n\ntoolchain go1.22.5\n");
      const ok = rust.includes("/usr/local/cargo/registry") && rust.includes("/usr/local/cargo/git") && minimum.join() === "golang:1" && toolchain.join() === "golang:1.22,golang:1" && old[0] === "golang:1.20";
      return { ok, detail: "rust volumes=" + rust.join(",") + " go minimum-only=" + minimum.join(",") + " go toolchain=" + toolchain.join(",") + " default unchanged=" + old[0] };
    },
  },
  {
    name: "rule 2: a runtime error whose innermost frame is in a product file is scorable; one in a test file or a load error is not",
    run() {
      const run = {};
      const py = (where: string, exc = "AttributeError") => plantedClass("pytest", { status: "fail", cls: "missing_name", exc, msg: exc + ": 'NoneType' object has no attribute 'get'", where }, run, false);
      const js = (frame: string) => plantedClass("nodetest", { status: "fail", cls: "missing_name", exc: "TypeError", msg: "TypeError: Cannot read properties of undefined (reading 'port')\n    at port (" + frame + ":4:22)" }, run, false);
      const got = [py("/testbed/pkg/ops.py:13"), py("/testbed/tests/test_ops.py:9"), py("/testbed/pkg/ops.py:1", "ModuleNotFoundError"), js("/testbed/src/cfg.js"), js("/testbed/node_modules/x/index.js")];
      const ok = got.join() === ["assert", "missing_name", "missing_name", "assert", "missing_name"].join();
      return { ok, detail: got.join(",") };
    },
  },
  {
    name: "rule 4: the keyless note names each region function with its signature from B and no removed body line",
    async run() {
      const { unit } = await constructed("go");
      const note = plantedNote(unit.signatures);
      const ok = note.includes("func Mul(a, b int) int") && !unit.removed.some((r) => r.lines.some((l) => l.trim().length > 8 && note.includes(l.trim())));
      return { ok, detail: "functions=" + unit.signatures.length + " words=" + note.split(/\s+/).length };
    },
  },
  {
    name: "supply: 79 qualifiers capped at 3 a repository refuse with E_EP_SUPPLY_SHORT and 80 pass",
    run() {
      const outcomes = (n: number): Outcome[] => Array.from({ length: n }, (_, i) => ({ id: "u" + i, repo: "r" + Math.floor(i / 3), eco: "go", stars: "300-999", strict: false, step: "clean", reason: null, regionLines: 20, planted: 1, crash: 0, functional: 1 }));
      const refuse = (n: number) => {
        const r = supplyReport({ manifest: { searchedAt: "2026-11-15", seed: "s", queries: [], rows: [] }, digest: "sha256:x", mined: [], outcomes: outcomes(n), fixes: outcomes(n).map((o) => ({ id: o.id, eco: o.eco })) });
        try {
          supplyGate(r.capped);
          return false;
        } catch (e) {
          return e instanceof EpError && e.code === "E_EP_SUPPLY_SHORT";
        }
      };
      return { ok: refuse(79) && !refuse(80), detail: "79 refused=" + refuse(79) + " 80 refused=" + refuse(80) };
    },
  },
  {
    name: "go fixture through mine, construct, screen, build and recount in the frozen sandbox; graded F' passes every planted case",
    docker: true,
    async run() {
      const b = await built("go");
      if (b.outcome.step !== "clean") return { ok: false, detail: line(b.outcome) };
      const tree = treeAt(b.dir, b.unit.fix);
      const g = await plantedGrader({ work: b.work }).grade(plantedOf(b), b.unitDir, tree);
      rmSync(tree, { recursive: true, force: true });
      const allPass = [...g.planted, ...g.functional].every((c) => c.runs.length === 3 && c.runs.every((r) => r === "pass"));
      const goImage = Object.keys(b.images).join(",");
      return { ok: allPass && goImage === "golang:1", detail: line(b.outcome) + " images=" + goImage + " graded F' all pass=" + allPass };
    },
  },
  {
    name: "python fixture: an AttributeError on None is planted by the crash class; the rewritten assertion leaves the functional set",
    docker: true,
    async run() {
      const b = await built("python");
      if (b.outcome.step !== "clean") return { ok: false, detail: line(b.outcome) };
      const { eb } = readUnit(b.unitDir);
      const rewritten = eb.unit.functional.some((id) => id.endsWith("test_label_missing"));
      const ok = b.outcome.crash >= 1 && !rewritten && eb.unit.functional.some((id) => id.endsWith("::test_label")) && !eb.unit.functional.some((id) => id.endsWith("::test_find"));
      return { ok, detail: line(b.outcome) + " rewritten case in functional=" + rewritten };
    },
  },
  {
    name: "node fixture: a property read through undefined is planted; a fix that only adds a test file keeps a functional set from P's tests",
    docker: true,
    async run() {
      const b = await built("node");
      return { ok: b.outcome.step === "clean" && b.outcome.crash >= 1 && b.outcome.functional >= 1, detail: line(b.outcome) };
    },
  },
  {
    name: "rust fixture: an inline-test unit through screen (registry volumes), build and recount",
    docker: true,
    async run() {
      const b = await built("rust");
      return { ok: b.outcome.step === "clean" && b.outcome.planted >= 1 && b.outcome.functional >= 1, detail: line(b.outcome) };
    },
  },
  {
    name: "catch: a build's test that fails on M and passes on F' catches; one that doesn't compile is null with its reason",
    docker: true,
    async run() {
      const yes = await catchOf("go", { "calc_build_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestZeroBuild(t *testing.T) {\n\tcheck(t, Mul(0, 7), 0)\n}\n" });
      const bad = await catchOf("go", { "calc_bad_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestBad(t *testing.T) {\n\tcheck(t, MulX(0, 7), 0)\n}\n" });
      return { ok: yes.catch === true && bad.catch === null && bad.drop !== null, detail: "catching build=" + yes.catch + " non-compiling build=" + bad.catch + " (" + bad.drop + ")" };
    },
  },
  {
    name: "catch: crash-class failures on M count (a Python AttributeError on None, a JS undefined-property read)",
    docker: true,
    async run() {
      const py = await catchOf("python", { "tests/test_build.py": 'from pkg import ops\n\n\ndef test_missing_build():\n    assert ops.label([], "q") == ""\n' });
      const js = await catchOf("node", { "test/build.test.js": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { port } from "../src/cfg.js";\n\ntest("build default", () => {\n  assert.equal(port({}), 8080);\n});\n' });
      return { ok: py.catch === true && js.catch === true, detail: "python=" + py.catch + (py.drop ? " (" + py.drop + ")" : "") + " node=" + js.catch + (js.drop ? " (" + js.drop + ")" : "") };
    },
  },
];
