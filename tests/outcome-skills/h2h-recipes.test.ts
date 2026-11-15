// Copyright (c) 2026 Garry Tan. MIT License.
// Part B recipes and test-command rules, keyless.
import { describe, expect, test } from "bun:test";
import { BROWSER } from "../../lanes/outcome-skills/h2h/types.ts";
import { candidateRunners, chooseRecipe, dockerfile, isDrop, testPlan, TOOLCHAINS, type Recipe, type RepoFacts, type TestPlan } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";

const P40 = "c".repeat(40);
const facts = (files: string[], pkg?: object, texts: RepoFacts["texts"] = {}): RepoFacts => ({ files, texts: { ...(pkg ? { "package.json": JSON.stringify(pkg) } : {}), ...texts } });
const recipe = (x: Recipe | unknown): Recipe => {
  if (isDrop(x)) throw new Error(JSON.stringify(x));
  return x as Recipe;
};
const plan = (x: TestPlan | unknown): TestPlan => {
  if (isDrop(x)) throw new Error(JSON.stringify(x));
  return x as TestPlan;
};

describe("recipes", () => {
  test("npm from package-lock.json, Node major from .nvmrc", () => {
    const r = recipe(chooseRecipe("B2", "npm", facts(["package.json", "package-lock.json", ".nvmrc"], { devDependencies: { jest: "30" } }, { ".nvmrc": "v20.11.0\n" })));
    expect(r.pm).toBe("npm");
    expect(r.install).toEqual(["npm ci --no-audit --no-fund"]);
    expect(r.image).toBe(TOOLCHAINS.node20);
    expect(r.browser).toBe(false);
  });
  test("B1 pnpm takes the browser layer and the launcher environment", () => {
    const r = recipe(chooseRecipe("B1", "npm", facts(["package.json", "pnpm-lock.yaml"], { devDependencies: { "@playwright/test": "1" } })));
    expect(r.install.slice(0, 2)).toEqual(["corepack enable", "pnpm install --frozen-lockfile"]);
    expect(r.browser).toBe(true);
    expect(r.env.CHROME_BIN).toBe(BROWSER.env.CHROME_BIN);
    const df = dockerfile(r, "https://github.com/acme/web.git", P40);
    expect(df.startsWith("FROM " + TOOLCHAINS.node22 + "\n")).toBe(true);
    expect(df).toContain("git fetch -q --depth 1 'https://github.com/acme/web.git' " + P40);
    expect(df).toContain("COPY chromium-wrapper.sh " + BROWSER.wrapper_container_path);
    expect(() => dockerfile(r, "u", "main")).toThrow(/E_H2H_B_BUILD/);
  });
  test("lockfile drops", () => {
    expect(chooseRecipe("B2", "npm", facts(["package.json"], {}))).toEqual({ code: "E_H2H_B_NO_LOCKFILE", rule: "no_js_lockfile" });
    expect(chooseRecipe("B2", "Go", facts(["go.mod"], undefined, { "go.mod": "module x\nrequire y v1\n" }))).toEqual({ code: "E_H2H_B_NO_LOCKFILE", rule: "no_go_sum" });
    expect(chooseRecipe("B2", "crates.io", facts(["Cargo.toml"]))).toEqual({ code: "E_H2H_B_NO_LOCKFILE", rule: "no_cargo_lock" });
    const go = dockerfile(recipe(chooseRecipe("B2", "Go", facts(["go.mod", "go.sum"], undefined, { "go.mod": "module x\n" }))), "u", P40).split("\n");
    expect(go.findIndex((l) => l.includes("GOPROXY"))).toBeGreaterThan(go.findIndex((l) => l === "RUN go mod download"));
    expect(go[1]).not.toContain("GOPROXY");
    expect(recipe(chooseRecipe("B2", "Maven", facts(["pom.xml"], undefined, { "pom.xml": "<maven.compiler.release>17</maven.compiler.release>" }))).image).toBe(TOOLCHAINS.maven17);
  });
});

describe("test-command rules", () => {
  const f = facts(["package.json", "package-lock.json", "a/pom.xml", "pom.xml", "src/A.csproj"], { devDependencies: { jest: "30", karma: "6" } });
  test("Vitest runs one report per project", () => {
    const t = plan(testPlan("vitest", ["t/a.test.ts"], f, { vitest_projects: [{ name: "unit", browser: false, provider: null, environment: "node" }, { name: "browser", browser: true, provider: "playwright", environment: "node" }] }));
    expect(t.format).toBe("vitest-json");
    expect(t.commands.test).toHaveLength(2);
    expect(t.commands.test[1]).toContain("--project 'browser'");
    expect(t.commands.test[1]).toContain("vitest-" + Buffer.from("browser").toString("hex") + ".json");
    expect(t.commands.test[1]).toContain("--retry=0");
  });
  test("retries and reporters drop by rule", () => {
    expect(testPlan("jest", ["a.test.js"], { ...f, retries: { jest_retry_times: true, mocha_retries: false, surefire_rerun: false } })).toEqual({ code: "E_H2H_B_RETRIES", rule: "jest_retry_times" });
    expect(testPlan("karma", ["a.test.js"], f)).toEqual({ code: "E_H2H_B_NO_REPORTER", rule: "karma-junit-reporter" });
    expect(testPlan("go", ["README.md"], f)).toEqual({ code: "E_H2H_B_NO_TESTS", rule: "no_go_test_file" });
  });
  test("Go packages, Maven classes and modules, .NET projects", () => {
    const g = plan(testPlan("go", ["pkg/a_test.go", "b_test.go"], f)).commands.test[0]!;
    expect(g).toContain("set -- '.' './pkg';");
    expect(g).toContain('go test -json -count=1 "$@"');
    const m = plan(testPlan("maven", ["a/src/test/java/x/FooTest.java"], f)).commands.test[0]!;
    expect(m).toContain("cls='FooTest'; pl='a';");
    expect(m).toContain('-Dtest="$cls" $' + '{pl:+-pl "$pl"} test');
    expect(m).toContain("-Dsurefire.rerunFailingTestsCount=0");
    expect(plan(testPlan("dotnet", ["src/Tests/ATest.cs"], f)).commands.test[0]).toContain("dotnet test 'src/A.csproj'");
  });
  test("candidate runners in the frozen order", () => {
    const b1 = facts(["package.json"], { devDependencies: { jest: "30", puppeteer: "23" } });
    expect(candidateRunners("B1", "npm", b1, ["playwright", "vitest-browser", "puppeteer"])).toEqual(["playwright", "vitest", "jest"]);
    expect(candidateRunners("B1", "npm", b1, [])).toEqual({ code: "E_H2H_B_NO_RUNNER", rule: "no_root_browser_runner" });
    expect(candidateRunners("B2", "npm", facts(["package.json"], { scripts: { test: "node --test" } }))).toEqual(["node-test"]);
    expect(candidateRunners("B2", "Go", f)).toEqual(["go"]);
  });
});

describe("browser environment in images", () => {
  test("B1 images set every launcher variable after the wrapper, and B2 images set none", () => {
    const b1 = dockerfile(recipe(chooseRecipe("B1", "npm", facts(["package.json", "package-lock.json"], { devDependencies: { "@web/test-runner": "1" } }))), "u", P40).split("\n");
    const at = b1.findIndex((l) => l.startsWith("COPY chromium-wrapper.sh "));
    expect(at).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(BROWSER.env)) {
      expect(b1.findIndex((l) => l.startsWith("ENV ") && l.includes(k + "="))).toBeGreaterThan(at);
      expect(b1.slice(at)).toContain("ENV " + Object.entries(BROWSER.env).map(([a, b]) => a + "=" + b).join(" "));
      expect(v).toBe(BROWSER.wrapper_container_path);
    }
    expect(Object.keys(BROWSER.env)).toContain("CHROME_PATH");
    const b2 = [
      chooseRecipe("B2", "npm", facts(["package.json", "package-lock.json"], { devDependencies: { jest: "30" } })),
      chooseRecipe("B2", "Go", facts(["go.mod", "go.sum"], undefined, { "go.mod": "module x\n" })),
      chooseRecipe("B2", "crates.io", facts(["Cargo.toml", "Cargo.lock"])),
    ].map(recipe);
    for (const r of b2) {
      expect(r.browser).toBe(false);
      for (const k of [...Object.keys(BROWSER.env), "PLAYWRIGHT_BROWSERS_PATH", "PUPPETEER_SKIP_DOWNLOAD"]) {
        expect(r.env).not.toHaveProperty(k);
        expect(dockerfile(r, "u", P40)).not.toContain(k + "=");
      }
    }
  });
});

