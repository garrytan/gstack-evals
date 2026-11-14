// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless file check on a clone (prereg section 3, line 134; plan section 8), four tests as frozen: (1) a
// package.json outside node_modules naming react, vue, svelte or @angular/core in dependencies, devDependencies or
// peerDependencies; (2) at least 10 component files (.tsx, .jsx, .vue, .svelte, not tests or stories) directly in one
// folder; (3) a design-system source: a file named theme.* or tokens.* or *.tokens.json, a Tailwind config with
// theme.extend, a CSS or SCSS file with at least 20 custom-property declarations, or a DESIGN.md; (4) at least 3
// distinct routes from route discovery (routes.ts). Every test runs on every clone, and nothing in the clone runs.
import { FILE_CHECK } from "../frozen.ts";
import { discoverRoutes, distinctRoutes, hasNestedKey, isTestOrStory, type RouteSet } from "./routes.ts";
import { listFiles, parentOf, readPackages, readText } from "./tree.ts";

export type DesignKind = "theme" | "tokens" | "tailwind" | "css" | "design-md";

export interface FileCheck {
  /** Test 1: a web front end. */
  frontEnd: boolean;
  /** Test 2: at least 10 component files in one folder. */
  components: boolean;
  /** Test 3: a design-system source. */
  designSystem: boolean;
  /** Test 4: at least 3 distinct routes. */
  routes: boolean;
  /** All four. */
  pass: boolean;
  frameworks: string[];
  /** The folder with the most component files, the first in path order on a tie. */
  componentFolder: { folder: string; count: number } | null;
  /** The first design-system source in path order. */
  designSource: { kind: DesignKind; file: string } | null;
  routeCount: number;
  routeSets: RouteSet[];
}

const COMPONENT = /\.(tsx|jsx|vue|svelte)$/;
const base = (f: string) => f.slice(f.lastIndexOf("/") + 1);

/** Custom-property declarations in a CSS or SCSS text, comments removed. */
export function customProperties(text: string, scss: boolean): number {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (scss) t = t.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return (t.match(/(?:^|[{;\s])--[\w-]+\s*:/g) ?? []).length;
}

/** The design-system source kind a file is, or null. */
export function designKind(root: string, f: string): DesignKind | null {
  const b = base(f).toLowerCase();
  if (b === "design.md") return "design-md";
  if (b.endsWith(".tokens.json")) return "tokens";
  if (b.startsWith("tokens.")) return "tokens";
  if (b.startsWith("theme.")) return "theme";
  if (/^tailwind\.config\.(c|m)?(js|ts)$/.test(b)) {
    const text = readText(root, f);
    return text !== null && hasNestedKey(text, /ts$/.test(b) ? "ts" : "tsx", ["theme", "extend"]) ? "tailwind" : null;
  }
  if (b.endsWith(".css") || b.endsWith(".scss")) {
    const text = readText(root, f);
    return text !== null && customProperties(text, b.endsWith(".scss")) >= FILE_CHECK.minCustomProperties ? "css" : null;
  }
  return null;
}

/** Runs all four tests on the clone at root. */
export function fileCheck(root: string): FileCheck {
  const files = listFiles(root);
  const frameworks = [...new Set(readPackages(root, files).flatMap((p) => FILE_CHECK.frameworks.filter((f) => f in p.deps)))].sort();
  const perFolder = new Map<string, number>();
  for (const f of files) if (COMPONENT.test(f) && !isTestOrStory(f)) perFolder.set(parentOf(f), (perFolder.get(parentOf(f)) ?? 0) + 1);
  let componentFolder: FileCheck["componentFolder"] = null;
  for (const [folder, count] of [...perFolder.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (!componentFolder || count > componentFolder.count) componentFolder = { folder, count };
  let designSource: FileCheck["designSource"] = null;
  for (const f of files) {
    const kind = designKind(root, f);
    if (kind) {
      designSource = { kind, file: f };
      break;
    }
  }
  const routeSets = discoverRoutes(root, files);
  const routeCount = distinctRoutes(routeSets).length;
  const r = {
    frontEnd: frameworks.length > 0,
    components: (componentFolder?.count ?? 0) >= FILE_CHECK.componentFilesInOneFolder,
    designSystem: designSource !== null,
    routes: routeCount >= FILE_CHECK.minRoutes,
  };
  return { ...r, pass: r.frontEnd && r.components && r.designSystem && r.routes, frameworks, componentFolder, designSource, routeCount, routeSets };
}
