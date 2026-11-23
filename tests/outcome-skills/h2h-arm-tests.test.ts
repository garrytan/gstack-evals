// Copyright (c) 2026 Garry Tan. MIT License.
// Section 7's new-test rule on B units, keyless: a path-filtered runner's scoring command collects a failing test file
// the arm added, and the reused scorer's decide then marks the session broke, so it is not verified. Each runner runs
// in a temporary git repository with a stub runner that writes the runner's report for the files, packages, classes or
// projects it was given.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, SOURCE_EXT, TEST_PATH } from "../../lanes/outcome-skills/statemachines/langs.ts";
import { decide } from "../../lanes/outcome-skills/statemachines/score.ts";
import { parseLocal } from "../../lanes/outcome-skills/h2h/breadth/parse.ts";
import { ECOSYSTEM_LANG } from "../../lanes/outcome-skills/h2h/breadth/frame.ts";
import { isDrop, NOT_SOURCE, testPlan, type Discovered, type RepoFacts, type TestPlan, type TestRunner } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";

const STUB = "#!/bin/bash\nif [ \"$(basename \"$0\")\" = node ]; then tool=node-test; else shift; tool=\"$1\"; shift; fi\nfiles=(); out=\"\"; prev=\"\"\nfor a in \"$@\"; do\n  case \"$a\" in\n    --outputFile=*) out=\"${a#--outputFile=}\";;\n    output=*) out=\"${a#output=}\";;\n    --test-reporter-destination=*) out=\"${a#--test-reporter-destination=}\";;\n  esac\n  if [ \"$prev\" = \"--config\" ]; then :; elif [ \"$prev\" = \"--spec\" ]; then IFS=, read -ra fs <<< \"$a\"; files+=(\"${fs[@]}\"); elif [ -f \"$a\" ]; then files+=(\"$a\"); fi\n  prev=\"$a\"\ndone\ncase \"$tool\" in playwright) out=\"$PLAYWRIGHT_JUNIT_OUTPUT_NAME\";; wtr) out=.h2h-reports/wtr.xml;; cypress) out=.h2h-reports/cypress-1.xml;; esac\nfails() { case \"$1\" in *regression*) return 0;; *) return 1;; esac; }\nif [ \"$tool\" = jest ] || [ \"$tool\" = vitest ]; then\n  { printf '{\"testResults\":['; sep=\"\"; for f in \"${files[@]}\"; do st=passed; fails \"$f\" && st=failed; printf '%s{\"name\":\"%s\",\"assertionResults\":[{\"ancestorTitles\":[\"%s\"],\"title\":\"t\",\"status\":\"%s\"}]}' \"$sep\" \"$f\" \"$f\" \"$st\"; sep=,; done; printf ']}'; } > \"$out\"\nelse\n  { printf '<testsuites><testsuite name=\"s\">'; for f in \"${files[@]}\"; do printf '<testcase classname=\"%s\" name=\"t %s\" file=\"%s\">' \"$f\" \"$f\" \"$f\"; fails \"$f\" && printf '<failure message=\"x\"/>'; printf '</testcase>'; done; printf '</testsuite></testsuites>'; } > \"$out\"\nfi\n";

const sh = (cmd: string, cwd: string, path: string) => {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", env: { PATH: path, HOME: cwd, LC_ALL: "C" } });
  if (r.status !== 0) throw new Error(cmd.slice(0, 80) + ": " + r.stderr);
  return r.stdout;
};

function repo(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "h2h-arm-tests-"));
  const bin = join(dir, ".stub-bin");
  mkdirSync(bin);
  for (const n of ["npx", "node"]) {
    writeFileSync(join(bin, n), STUB);
    chmodSync(join(bin, n), 0o755);
  }
  const path = bin + ":" + (process.env.PATH ?? "/usr/bin:/bin");
  mkdirSync(join(dir, "test"));
  writeFileSync(join(dir, ".gitignore"), ".stub-bin/\n.h2h-reports/\n");
  writeFileSync(join(dir, "package.json"), "{}\n");
  writeFileSync(join(dir, "web-test-runner.config.mjs"), "export default {};\n");
  writeFileSync(join(dir, "test/fixed.test.js"), "base\n");
  sh("git init -q . && git add -A && git -c user.email=t@example.com -c user.name=t commit -q -m base", dir, path);
  return { dir, path };
}

const facts: RepoFacts = { files: ["package.json", "web-test-runner.config.mjs"], texts: { "package.json": JSON.stringify({ devDependencies: { "@web/test-runner-junit-reporter": "1" } }) } };
const RUNNERS: TestRunner[] = ["playwright", "vitest", "jest", "mocha", "node-test", "web-test-runner", "cypress"];

function run(plan: TestPlan, dir: string, path: string): Record<string, string> {
  for (const c of plan.commands.test) sh(c, dir, path);
  return parseLocal(plan.format, plan.commands.print.map((c) => sh(c, dir, path)).join("\n"));
}

describe("scoring collects the arm's new test files", () => {
  test("the filter is langs.ts classify: a test path, a source extension, not under a build or vendor directory", () => {
    const paths = ["test/a.js", "src/a.test.ts", "src/a.ts", "test/fixture.json", "node_modules/x/a.test.js", "dist/a.spec.js", "vendor/tests/b.js", "a/build/c.test.mjs", "pkg/__tests__/d.tsx", "lib/e.spec.cjs"];
    for (const p of paths) expect([p, !NOT_SOURCE.test(p) && SOURCE_EXT.ts.test(p) && TEST_PATH.ts.test(p)]).toEqual([p, classify("ts", p) === "test"]);
  });
  for (const runner of RUNNERS)
    test(runner + ": an arm-added failing test file is collected and the session is not verified", () => {
      const plan = testPlan(runner, ["test/fixed.test.js"], facts);
      if (isDrop(plan)) throw new Error(JSON.stringify(plan));
      const { dir, path } = repo();
      writeFileSync(join(dir, "test/fixed.test.js"), "fixed\n");
      const oracle = run(plan, dir, path);
      const known = new Set(Object.keys(oracle));
      expect(Object.values(oracle)).toEqual(["pass"]);
      writeFileSync(join(dir, "test/regression.test.js"), "always fails\n");
      writeFileSync(join(dir, "test/fixture.json"), "{}\n");
      writeFileSync(join(dir, "helper.js"), "x\n");
      const views = [1, 2, 3].map(() => ({ parsed: run(plan, dir, path), build_failed: false }));
      expect(readFileSync(join(dir, ".h2h-reports/arm-tests.txt"), "utf8")).toBe("test/regression.test.js\n");
      const v = decide([...known], [], known, views);
      expect(v.new_tests).toHaveLength(1);
      expect(v.new_tests[0]).toContain("regression");
      expect(v.broke_by.new_test_failed).toEqual(v.new_tests);
      expect([v.fixed, v.outcome]).toEqual([true, "fix_broke"]);
    });
});

const STUB_FILTERED = "#!/bin/bash\nme=$(basename \"$0\")\nfails() { case \"$1\" in *egression*) return 0;; *) return 1;; esac; }\ncase \"$me\" in\ngo)\n  for a in \"$@\"; do case \"$a\" in .|./*) for f in \"$a\"/*_test.go; do [ -f \"$f\" ] || continue; st=pass; fails \"$f\" && st=fail; printf '{\"Action\":\"%s\",\"Package\":\"%s\",\"Test\":\"Test_%s\"}\\n' \"$st\" \"$a\" \"$(basename \"$f\" .go)\"; done;; esac; done;;\nmvn)\n  printf '%s\\n' \"$*\" > .h2h-reports/mvn-args.txt\n  for a in \"$@\"; do case \"$a\" in -Dtest=*) IFS=, read -ra cs <<< \"${a#-Dtest=}\";; esac; done\n  mkdir -p target/surefire-reports\n  for c in \"${cs[@]}\"; do [ -n \"$(find . -name \"$c.java\" -not -path './.stub-bin/*')\" ] || continue; { printf '<testsuite name=\"%s\"><testcase classname=\"%s\" name=\"t\">' \"$c\" \"$c\"; fails \"$c\" && printf '<failure message=\"x\"/>'; printf '</testcase></testsuite>'; } > \"target/surefire-reports/TEST-$c.xml\"; done;;\ncargo)\n  printf '%s\\n' \"$*\" > .h2h-reports/cargo-args.txt\n  ps=(); prev=\"\"; for a in \"$@\"; do [ \"$prev\" = -p ] && ps+=(\"$a\"); [ \"$a\" = --workspace ] && ps=(core web); prev=\"$a\"; done\n  for p in \"${ps[@]}\"; do for f in \"$p\"/tests/*.rs; do [ -f \"$f\" ] || continue; n=$(basename \"$f\" .rs); printf '     Running %s (target/debug/deps/%s-0123456789abcdef)\\n' \"$f\" \"$n\"; st=ok; fails \"$f\" && st=FAILED; printf 'test t_%s ... %s\\n' \"$n\" \"$st\"; done; done;;\ndotnet)\n  proj=\"\"; log=\"\"; dir=\"\"; prev=\"\"\n  for a in \"$@\"; do case \"$a\" in *.csproj) proj=\"$a\";; esac; [ \"$prev\" = --logger ] && log=\"${a#trx;LogFileName=}\"; [ \"$prev\" = --results-directory ] && dir=\"$a\"; prev=\"$a\"; done\n  mkdir -p \"$dir\"; d=$(dirname \"$proj\")\n  { printf '<TestRun><TestDefinitions>'; i=0; for f in \"$d\"/*.cs; do i=$((i+1)); printf '<UnitTest id=\"u%s\"><TestMethod className=\"%s\"/></UnitTest>' \"$i\" \"$f\"; done; printf '</TestDefinitions><Results>'; i=0; for f in \"$d\"/*.cs; do i=$((i+1)); o=Passed; fails \"$f\" && o=Failed; printf '<UnitTestResult testId=\"u%s\" testName=\"t\" outcome=\"%s\"/>' \"$i\" \"$o\"; done; printf '</Results></TestRun>'; } > \"$dir/$log\";;\nesac\n";

interface Eco { runner: TestRunner; fix: string; arm: string; base: string[]; discovered?: Discovered; args?: [string, string] }
const ECOSYSTEMS: Record<string, Eco> = {
  Go: { runner: "go", fix: "a/a_test.go", arm: "b/regression_test.go", base: ["go.mod", "a/a.go"] },
  Maven: { runner: "maven", fix: "core/src/test/java/FixTest.java", arm: "web/src/test/java/RegressionTest.java", base: ["pom.xml", "core/pom.xml", "web/pom.xml"], args: ["mvn-args.txt", "-pl core,web"] },
  "crates.io": { runner: "cargo", fix: "core/tests/fix.rs", arm: "web/tests/regression.rs", base: ["Cargo.toml", "core/Cargo.toml", "web/Cargo.toml"], discovered: { cargo_packages: [{ name: "core", dir: "core" }, { name: "web", dir: "web" }] }, args: ["cargo-args.txt", "-p core -p web"] },
  NuGet: { runner: "dotnet", fix: "Core.Tests/FixTest.cs", arm: "Web.Tests/RegressionTest.cs", base: ["Core.Tests/Core.Tests.csproj", "Web.Tests/Web.Tests.csproj"] },
};

function filteredRepo(e: Eco): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "h2h-arm-filtered-"));
  const bin = join(dir, ".stub-bin");
  mkdirSync(bin);
  for (const n of ["go", "mvn", "cargo", "dotnet"]) {
    writeFileSync(join(bin, n), STUB_FILTERED);
    chmodSync(join(bin, n), 0o755);
  }
  const path = bin + ":" + (process.env.PATH ?? "/usr/bin:/bin");
  writeFileSync(join(dir, ".gitignore"), ".stub-bin/\n.h2h-reports/\ntarget/\n");
  for (const f of [...e.base, e.fix]) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "base\n");
  }
  sh("git init -q . && git add -A && git -c user.email=t@example.com -c user.name=t commit -q -m base", dir, path);
  return { dir, path };
}

describe("scoring collects the arm's new test files under package, class and project filters", () => {
  for (const [eco, e] of Object.entries(ECOSYSTEMS))
    test(eco + ": an arm-added failing test file outside the fix's filter is collected and the session is not verified", () => {
      const { dir, path } = filteredRepo(e);
      const plan = testPlan(e.runner, [e.fix], { files: [...e.base, e.fix], texts: {} }, e.discovered ?? {}, ECOSYSTEM_LANG[eco]!);
      if (isDrop(plan)) throw new Error(JSON.stringify(plan));
      writeFileSync(join(dir, e.fix), "fixed\n");
      const oracle = run(plan, dir, path);
      const known = new Set(Object.keys(oracle));
      expect(Object.values(oracle)).toEqual(["pass"]);
      mkdirSync(join(dir, e.arm, ".."), { recursive: true });
      writeFileSync(join(dir, e.arm), "always fails\n");
      writeFileSync(join(dir, e.arm.replace(/[^/]+$/, "notes.txt")), "x\n");
      const views = [1, 2, 3].map(() => ({ parsed: run(plan, dir, path), build_failed: false }));
      expect(readFileSync(join(dir, ".h2h-reports/arm-tests.txt"), "utf8")).toBe(e.arm + "\n");
      if (e.args) expect(readFileSync(join(dir, ".h2h-reports", e.args[0]), "utf8")).toContain(e.args[1]);
      const v = decide([...known], [], known, views);
      expect(v.new_tests).toHaveLength(1);
      expect(v.new_tests[0]).toContain("egression");
      expect([v.fixed, v.outcome]).toEqual([true, "fix_broke"]);
    });
});
