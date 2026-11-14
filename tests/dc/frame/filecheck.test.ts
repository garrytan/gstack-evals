// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless file check's four tests.
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { customProperties, fileCheck } from "../../../lanes/design-constructed/frame/filecheck.ts";
import { cssVars, failingApp, PASSING_APP, writeTree } from "../../../lanes/design-constructed/frame/fixtures.ts";

const check = (files: Record<string, string>) => {
  const dir = writeTree(files);
  try {
    return fileCheck(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("fileCheck", () => {
  test("the passing fixture passes all four", () => {
    const r = check(PASSING_APP);
    expect(r).toMatchObject({ frontEnd: true, components: true, designSystem: true, routes: true, pass: true, frameworks: ["react"], componentFolder: { folder: "src/components", count: 10 }, designSource: { kind: "theme", file: "src/styles/theme.ts" }, routeCount: 3 });
  });

  for (const n of [1, 2, 3, 4] as const) {
    test("breaking test " + n + " fails only that test", () => {
      const r = check(failingApp(n));
      expect([r.frontEnd, r.components, r.designSystem, r.routes]).toEqual([1, 2, 3, 4].map((m) => m !== n));
      expect(r.pass).toBe(false);
    });
  }

  test("components count directly in one folder, not across subfolders", () => {
    const t: Record<string, string> = { ...PASSING_APP };
    for (let i = 0; i < 5; i++) {
      delete t["src/components/Panel" + i + ".tsx"];
      t["src/components/sub/Panel" + i + ".vue"] = "";
    }
    expect(check(t).components).toBe(false);
  });

  test("custom properties: declarations only, comments ignored", () => {
    expect(customProperties(cssVars(20), false)).toBe(20);
    expect(customProperties("a { color: var(--x); }", false)).toBe(0);
    expect(customProperties("/* --a: 1; */ // --b: 2;\n:root{--c:3}", true)).toBe(1);
    expect(check({ ...failingApp(3), "src/app.css": cssVars(20) }).designSystem).toBe(true);
    expect(check({ ...failingApp(3), "src/app.css": cssVars(19) }).designSystem).toBe(false);
  });

  test("a peerDependencies entry for svelte counts; @angular/core counts", () => {
    expect(check({ ...failingApp(1), "packages/ui/package.json": JSON.stringify({ peerDependencies: { svelte: "5" } }) }).frontEnd).toBe(true);
    expect(check({ ...failingApp(1), "web/package.json": JSON.stringify({ devDependencies: { "@angular/core": "18" } }) }).frameworks).toEqual(["@angular/core"]);
  });
});
