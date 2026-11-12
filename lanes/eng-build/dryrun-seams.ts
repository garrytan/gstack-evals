// Copyright (c) 2026 Garry Tan. MIT License.
// The dry run's seams, wired to the modules that own each rule: the unit builder's case rule, the verifier's test
// region, the review Stop hook and the bundle cap run here without Docker. The recipes, runner adapters, product hash,
// cold rebuild, T items and leak check build a real unit from the synthetic repositories in tests/eng-build/fixture.ts
// and grade it in the verifier's sandbox, so they run only under GSTACK_EVALS_DOCKER=1, as the Docker tests do. Without
// Docker each of them returns a SKIP line with its reason, which the dry run prints and counts as a failure, never a
// pass. The transplant seams build their own Go unit in catch.ts, also under Docker.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GO_BUGGY, GO_CALC, GO_FIXED, goRepo, nodeLock, nodeRepo, nodeRustRepo, pyRepo, RS_ADD, RS_BUGGY, RS_FIXED, rsTests, rustRepo, type Fixture } from "../../tests/eng-build/fixture.ts";
import { patchFrom } from "../../tests/real/fixture.ts";
import { classifyFile, productText, regionText, splice } from "../real-outcome/task/region.ts";
import { reviewStopHook } from "./arms.ts";
import { assembleBundle } from "./bundle.ts";
import type { Seams } from "./dryrun.ts";
import { EbError } from "./errors.ts";
import { seamCleanup, seamTransplantCatch, seamTransplantNoCatch } from "./catch.ts";
import { sessionLeakCheck } from "./leak.ts";
import { removeSessionImages } from "./session-image.ts";
import { removeLabelled } from "./screen.ts";
import type { CaseClass } from "./types.ts";
import { aftermathCases, anchorCases, baseOutcome, buildUnit, gradeSet, readUnit, type BuildOutcome, type Grid } from "./unit.ts";

export const DOCKER_GATE = "GSTACK_EVALS_DOCKER=1";

const runs3 = (c: CaseClass): CaseClass[] => [c, c, c];

/** The unit builder's case rule on one case's 3-run grids: aftermath, anchor or excluded, and the base split. */
function classify(merged: CaseClass, parent: CaseClass, fixed: CaseClass, base?: CaseClass): string {
  const id = "t::case";
  const [m, p, f]: Grid[] = [{ [id]: runs3(merged) }, { [id]: runs3(parent) }, { [id]: runs3(fixed) }];
  if (aftermathCases(m, p, f, 3).includes(id)) return base === undefined ? "aftermath" : "aftermath, base " + baseOutcome(runs3(base));
  if (anchorCases(m, f, 3).includes(id)) return "anchor";
  return "excluded";
}

const LIB_FIX = "pub fn mul(a: i32, b: i32) -> i32 {\n    a * b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn mul_zero() {\n        assert_eq!(mul(0, 5), 0);\n    }\n}\n";
const LIB_BUILD = "pub fn mul(a: i32, b: i32) -> i32 {\n    b * a\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn mul_zero() {}\n}\n";
const noEvidence = (transcript: string) => ({ transcript, stateRoot: null, coverage: null, opening: null });

function pureSeams(): Seams {
  return {
    "classify fail-to-pass": async () => classify("assert", "assert", "pass"),
    "classify merged-error-only": async () => classify("load", "load", "pass"),
    "classify missing-name": async () => classify("missing_name", "missing_name", "pass"),
    "classify red-on-base": async () => classify("assert", "assert", "pass", "assert"),
    "classify anchor": async () => classify("pass", "pass", "pass"),
    "region rust-inline": async () => {
      const kind = classifyFile("src/lib.rs", LIB_FIX).kind;
      if (kind !== "region") return "the fix's file reads " + kind;
      const out = splice("src/lib.rs", LIB_BUILD, LIB_FIX);
      const product = productText("src/lib.rs", out) === productText("src/lib.rs", LIB_BUILD);
      const region = regionText("src/lib.rs", out) === regionText("src/lib.rs", LIB_FIX);
      return product && region ? "test region only" : "product kept " + product + ", region moved " + region;
    },
    "stophook blocks": async () => {
      const root = mkdtempSync(join(tmpdir(), "eb-stophook-"));
      try {
        const hook = reviewStopHook("precut", (transcript) => ({ ...noEvidence(transcript), stateRoot: root }));
        if (!hook) return "no hook on a skill arm";
        const said = [1, 2, 3].map(() => (hook.onStop("") === null ? "release" : "block"));
        return said.join(", ") + (reviewStopHook("plain", noEvidence) === null ? "" : "; plain got a hook");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    "bundle cap": async () => {
      const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
      const b = assembleBundle([{ name: "plan.md", text: words(6000, "plan") }, { name: "review.md", text: words(4000, "reply") }, { name: "test-plan.md", text: words(2500, "skill") }]);
      if (b.fullWords < 12_500) return "the fixture holds only " + b.fullWords + " words";
      return b.truncated ? "truncated at " + b.words + " words" : "not truncated (" + b.words + " words)";
    },
  };
}

const DOCKER_SEAMS = ["recipe go", "recipe node", "recipe node-rust", "recipe python", "adapter jest", "adapter vitest", "adapter mocha", "adapter node-test", "adapter cargo", "classify t-case", "region product-hash", "rebuild stale-artifact", "leak image", "transplant catch", "transplant no-catch"] as const;

const codeOf = (f: () => unknown): string => {
  try {
    f();
    return "no stop";
  } catch (e) {
    return e instanceof EbError ? e.code : "threw " + (e as Error).message.split("\n")[0];
  }
};

/** The Docker seams over one temporary directory: each unit builds once and every seam that needs it reuses it. */
function dockerSeams(dir: string): Seams {
  const locks = new Map<string, string>();
  const lock = (pkg: string) => {
    if (!locks.has(pkg)) locks.set(pkg, nodeLock(pkg));
    return locks.get(pkg)!;
  };
  const built = new Map<string, { fx: Fixture; out: BuildOutcome }>();
  const build = (name: string, make: (dir: string) => Fixture) => {
    if (!built.has(name)) {
      const fx = make(join(dir, name, "repo"));
      built.set(name, { fx, out: buildUnit(fx.spec, fx.repo, join(dir, name, "unit"), { work: join(dir, name, "work"), labels: join(dir, "labels.json"), seed: 7 }) });
    }
    return built.get(name)!;
  };
  const grade = (name: string, files: Record<string, string | null>): Grid => {
    const { fx, out } = built.get(name)!;
    const { eb, task } = readUnit(out.dir);
    const item = eb.unit.aftermath[0]!;
    return gradeSet({ taskDir: out.dir, task, eb, set: eb.sets.find((s) => s.item === item.item)!, label: "build", patch: patchFrom(fx.repo, fx.sha.base, files), runs: 1, seed: 3, work: join(dir, name, "work"), want: [...item.cases, ...item.anchors] });
  };
  const recipe = (name: string, make: (dir: string) => Fixture) => async () => {
    const { out } = build(name, make);
    if (!out.qualifies) return "the unit did not qualify";
    const a = out.eb.unit.aftermath[0];
    const merged = out.eb.unit.functional.length > 0;
    const base = !!a && a.cases.length > 0 && a.cases.every((c) => c in a.base);
    return merged && base ? "per-case results at base and merge" : "merge results " + merged + ", base results " + base;
  };
  const node = (runner: string) => async () => {
    const { out } = build(runner, (d) => nodeRepo(d, runner, lock));
    const id = out.eb.unit.aftermath[0]?.cases[0];
    if (!id) return "the unit has no aftermath case";
    const jest = runner === "jest";
    const js = (s: string) => (jest ? s.replace(/^export const (\w+) = /gm, "exports.$1 = ") : s);
    const src = "src/calc." + (jest ? "cjs" : "js");
    const add = "export const add = (a, b) => a + b;\n";
    const trees = [add + "export const mul = (a, b) => a * b;\n", add + "export const mul = (a, b) => (a === 0 ? b : a * b);\n", add, add + "export const mul = (a, b) => {\n"];
    return trees.map((t) => grade(runner, { [src]: js(t) })[id]?.[0] ?? "no_result").join(" ");
  };
  return {
    "recipe go": recipe("go", goRepo),
    "recipe node": recipe("vitest", (d) => nodeRepo(d, "vitest", lock)),
    "recipe node-rust": recipe("noderust", (d) => nodeRustRepo(d, lock)),
    "recipe python": recipe("py", pyRepo),
    "adapter jest": node("jest"),
    "adapter vitest": node("vitest"),
    "adapter mocha": node("mocha"),
    "adapter node-test": node("nodetest"),
    "adapter cargo": async () => {
      const { out } = build("rust", rustRepo);
      const id = out.eb.unit.aftermath[0]?.cases[0];
      if (!id) return "the unit has no aftermath case";
      return [RS_ADD + RS_FIXED, RS_ADD + RS_BUGGY, RS_ADD + rsTests(["adds"])].map((t) => grade("rust", { "src/lib.rs": t })[id]?.[0] ?? "no_result").join(" ");
    },
    "classify t-case": async () => {
      const { out } = build("py", pyRepo);
      const t = out.eb.unit.tCases;
      const scored = out.eb.unit.aftermath.flatMap((a) => a.cases);
      return t.length > 0 && t.every((c) => !scored.includes(c)) ? "t case" : "tCases " + JSON.stringify(t) + ", aftermath " + JSON.stringify(scored);
    },
    "region product-hash": async () => {
      const { fx, out } = build("go", goRepo);
      const { eb, task } = readUnit(out.dir);
      return codeOf(() => gradeSet({ taskDir: out.dir, task, eb, set: eb.sets[0]!, label: "merged", patch: patchFrom(fx.repo, fx.sha.base, { "calc.go": GO_CALC + GO_FIXED }), runs: 1, seed: 1, work: join(dir, "go", "work"), check: true }));
    },
    "rebuild stale-artifact": async () => {
      build("jest", (d) => nodeRepo(d, "jest", lock));
      const buggy = "exports.add = (a, b) => a + b;\nexports.mul = (a, b) => (a === 0 ? b : a * b);\n";
      const stale = "exports.add = (a, b) => a + b;\nexports.mul = (a, b) => a * b;\n";
      const got = grade("jest", { "src/calc.cjs": buggy, "dist/calc.cjs": stale })["test/calc.test.js::calc mul zero"]?.[0] ?? "no_result";
      return got === "assert" ? "stale artifact ignored" : "the stale artifact graded " + got;
    },
    "leak image": async () => {
      const { fx, out } = build("go", goRepo);
      const line = (GO_CALC + GO_BUGGY).split("\n").find((l) => l.startsWith("func Add"))!;
      return codeOf(() => sessionLeakCheck({ unit: "ebgo", image: out.eb.image.id, repo: fx.spec.repo, runner: out.eb.groups[0]!.runner, needles: [line] }));
    },
    "transplant catch": seamTransplantCatch,
    "transplant no-catch": seamTransplantNoCatch,
  };
}

/** Every wired seam. Docker seams run under GSTACK_EVALS_DOCKER=1 and return a SKIP line otherwise; close() removes the
 * temporary units and the labelled containers and volumes they left. */
export function wiredSeams(env: Record<string, string | undefined> = process.env): { seams: Seams; close: () => void } {
  const pure = pureSeams();
  if (env.GSTACK_EVALS_DOCKER !== "1") {
    const skip = Object.fromEntries(DOCKER_SEAMS.map((name) => [name, async () => "SKIP needs Docker: set " + DOCKER_GATE + " to build and grade its fixture unit"]));
    return { seams: { ...pure, ...skip }, close: () => {} };
  }
  const dir = mkdtempSync(join(tmpdir(), "eb-dryrun-docker-"));
  return {
    seams: { ...pure, ...dockerSeams(dir) },
    close: () => {
      seamCleanup();
      removeLabelled();
      removeSessionImages();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
