// Copyright (c) 2026 Garry Tan. MIT License.
// Section 7's new-test rule on B units, keyless: a path-filtered runner's scoring command collects a failing test file
// the arm added, and the reused scorer's decide then marks the session broke, so it is not verified. Each runner runs
// in a temporary git repository with a stub npx or node that writes the runner's report for the files it was given.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, SOURCE_EXT, TEST_PATH } from "../../lanes/outcome-skills/statemachines/langs.ts";
import { decide } from "../../lanes/outcome-skills/statemachines/score.ts";
import { parseLocal } from "../../lanes/outcome-skills/h2h/breadth/parse.ts";
import { isDrop, NOT_SOURCE, testPlan, type RepoFacts, type TestPlan, type TestRunner } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";

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
