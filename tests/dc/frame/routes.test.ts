// Copyright (c) 2026 Garry Tan. MIT License.
// Route discovery per router and R2-19's matcher.
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { writeTree } from "../../../lanes/design-constructed/frame/fixtures.ts";
import { codeRoutes, discoverRoutes, matchRoute, matchingRoutes, routeKey } from "../../../lanes/design-constructed/frame/routes.ts";

const withTree = <T>(files: Record<string, string>, f: (dir: string) => T): T => {
  const dir = writeTree(files);
  try {
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("matchRoute", () => {
  test("R2-19: one segment, catch-alls, groups, basePath, trailing slash, hash", () => {
    expect(matchRoute("/a/1", "/a/[id]")).toBe(true);
    expect(matchRoute("/a/1", "/a/:id")).toBe(true);
    expect(matchRoute("/a", "/a/:id")).toBe(false);
    expect(matchRoute("/a/1/2", "/a/[...rest]")).toBe(true);
    expect(matchRoute("/a", "/a/[...rest]")).toBe(false);
    expect(matchRoute("/a", "/a/[[...rest]]")).toBe(true);
    expect(matchRoute("/a", "/(group)/a")).toBe(true);
    expect(matchRoute("/base/a", "/a", { basePath: "/base" })).toBe(true);
    expect(matchRoute("/a/", "/a")).toBe(true);
    expect(matchRoute("/#/a/1", "/a/:id", { hash: true })).toBe(true);
    expect(matchRoute("/a/1", "/a/:id", { hash: true })).toBe(false);
    expect(matchRoute("/a/x-1", "/a/x-[id]")).toBe(true);
    expect(matchRoute("/a", "/a/:id?")).toBe(true);
  });

  test("route keys unify parameter names across routers", () => {
    expect(routeKey("/u/[id]")).toBe(routeKey("/u/:userId"));
    expect(routeKey("/d/[...s]")).toBe("/d/*");
    expect(matchingRoutes("/u/new", [{ router: "next-pages", root: "", patterns: ["/u/[id]", "/u/new"], hash: false, basePath: null }])).toEqual(["/u/new", "/u/:"]);
  });
});

describe("codeRoutes", () => {
  test("survives regex literals, template literals and comments", () => {
    const src = "import { createBrowserRouter } from 'react-router-dom';\n// { path: 'commented', element: X }\nconst re = /[}{]\\/x/g;\nconst t = `/x/${id}`;\nexport const r = createBrowserRouter([{ path: `/plain`, element: A }, { path: `/x/${id}`, element: B }, { path: '/c', Component: C }]);";
    expect(codeRoutes(src, "tsx").map((f) => f.path)).toEqual(["/plain", "/c"]);
  });

  test("an object with a path but no route key is not a route", () => {
    expect(codeRoutes("import 'vue-router'; export const nav = [{ title: 'Home', path: '/home' }];", "ts")).toEqual([]);
  });

  test("react-router's route config functions", () => {
    const src = 'import { index, route, prefix, layout } from "@react-router/dev/routes";\nexport default [index("h.tsx"), route("about", "a.tsx"), ...prefix("p", [route(":id", "p.tsx")]), layout("l.tsx", [route("login", "l2.tsx")])];';
    expect(codeRoutes(src, "ts", true).map((f) => f.path)).toEqual(["/", "/about", "/p/:id", "/login"]);
  });
});

describe("discoverRoutes", () => {
  test("Next.js pages need next in a package.json; a React app's pages/ folder is not Next routes", () => {
    const files = { "package.json": JSON.stringify({ dependencies: { react: "19" } }), "src/pages/One.tsx": "", "src/pages/Two.tsx": "", "src/pages/Three.tsx": "" };
    expect(withTree(files, discoverRoutes)).toEqual([]);
    expect(withTree({ ...files, "package.json": JSON.stringify({ dependencies: { next: "15" } }) }, discoverRoutes)[0]!.patterns).toEqual(["/One", "/Three", "/Two"]);
  });

  test("a monorepo app keeps its own root, base path and router", () => {
    const sets = withTree(
      {
        "package.json": JSON.stringify({ private: true }),
        "apps/web/package.json": JSON.stringify({ dependencies: { next: "15" } }),
        "apps/web/next.config.mjs": "export default { basePath: '/console' };",
        "apps/web/app/page.tsx": "",
        "apps/web/app/settings/page.tsx": "",
        "apps/web/app/api/x/route.ts": "",
      },
      discoverRoutes,
    );
    expect(sets).toEqual([{ router: "next-app", root: "apps/web", patterns: ["/", "/settings"], hash: false, basePath: "/console" }]);
  });

  test("Nuxt 2 underscore params and the Nuxt 3 bracket form", () => {
    const n2 = withTree({ "package.json": JSON.stringify({ dependencies: { nuxt: "^2.17.0" } }), "pages/users/_id.vue": "", "pages/index.vue": "" }, discoverRoutes);
    expect(n2[0]!.patterns).toEqual(["/", "/users/[id]"]);
  });
});
