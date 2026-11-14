// Copyright (c) 2026 Garry Tan. MIT License.
// Route discovery for the file check's fourth test and PD-10's route rule (plan section 8; addendum R2-19). It finds
// route patterns per router without running anything: Next.js pages/ and app/ page files, SvelteKit +page.svelte files,
// Nuxt pages/ files, and the path entries of react-router, vue-router and Angular Routes definitions, read from source
// that Bun's transpiler turns into plain JavaScript (types and JSX gone) and a small tokenizer walks. matchRoute says
// whether a concrete recipe path matches a discovered pattern: a dynamic segment ([id], :id) matches one non-empty
// segment, a catch-all ([...slug]) one or more, route groups such as (group) are dropped, a basePath prefix is stripped,
// a trailing slash is ignored, and hash routers compare the fragment.
import { listFiles, parentOf, readPackages, readText, under, type PackageJson } from "./tree.ts";

export type Router = "next-pages" | "next-app" | "sveltekit" | "nuxt" | "react-router" | "vue-router" | "angular";
export const ROUTERS: readonly Router[] = ["next-pages", "next-app", "sveltekit", "nuxt", "react-router", "vue-router", "angular"];

/** The routes one router defines in one package folder. */
export interface RouteSet {
  router: Router;
  /** Repo-relative folder of the package that holds the routes; "" for the root. */
  root: string;
  /** Distinct patterns, sorted, each with a leading slash and no trailing slash. */
  patterns: string[];
  /** A hash router: its routes live in the URL fragment. */
  hash: boolean;
  /** A literal base path the app is served under, or null. */
  basePath: string | null;
}

// ---- Segments and matching

export type Seg =
  | { kind: "static"; text: string }
  | { kind: "one" }
  | { kind: "optional" }
  | { kind: "rest1" }
  | { kind: "rest0" }
  | { kind: "mixed"; re: RegExp; key: string };

const PARAM_IN_SEG = /\[\[?[^\]]+\]\]?/g;

/** One pattern segment's kind. Route groups are dropped before this is called. */
export function parseSegment(s: string): Seg {
  if (/^\[\[\.\.\.[^\]]+\]\]$/.test(s)) return { kind: "rest0" };
  if (/^\[\.\.\.[^\]]+\]$/.test(s)) return { kind: "rest1" };
  if (/^\[\[[^\]]+\]\]$/.test(s)) return { kind: "optional" };
  if (/^\[[^\]]+\]$/.test(s)) return { kind: "one" };
  if (s === "*" || s === "**") return { kind: "rest0" };
  const p = /^:[A-Za-z_$][\w$]*(?:\((.*)\))?([?*+])?$/.exec(s);
  if (p) {
    if (p[2] === "*") return { kind: "rest0" };
    if (p[2] === "+") return { kind: "rest1" };
    if (p[2] === "?") return { kind: "optional" };
    if (p[1] !== undefined && p[1].includes(".*")) return { kind: "rest1" };
    return { kind: "one" };
  }
  if (PARAM_IN_SEG.test(s)) {
    PARAM_IN_SEG.lastIndex = 0;
    const parts = s.split(PARAM_IN_SEG);
    const re = new RegExp("^" + parts.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+") + "$");
    return { kind: "mixed", re, key: parts.join(":") };
  }
  return { kind: "static", text: s };
}

const isGroup = (s: string) => /^\(.*\)$/.test(s);

/** A pattern's segments, route groups dropped. */
export const patternSegs = (pattern: string): Seg[] => pattern.split("/").filter((s) => s !== "" && !isGroup(s)).map(parseSegment);

/** The form two patterns share when they name the same route whatever their routers call the parameters. */
export function routeKey(pattern: string): string {
  const k = patternSegs(pattern).map((s) => (s.kind === "static" ? s.text : s.kind === "one" ? ":" : s.kind === "optional" ? ":?" : s.kind === "rest1" ? "*" : s.kind === "rest0" ? "*?" : s.key));
  return "/" + k.join("/");
}

function segsMatch(path: readonly string[], segs: readonly Seg[], i: number, j: number): boolean {
  if (j === segs.length) return i === path.length;
  const s = segs[j]!;
  switch (s.kind) {
    case "static":
      return path[i] === s.text && segsMatch(path, segs, i + 1, j + 1);
    case "one":
      return i < path.length && segsMatch(path, segs, i + 1, j + 1);
    case "mixed":
      return i < path.length && s.re.test(path[i]!) && segsMatch(path, segs, i + 1, j + 1);
    case "optional":
      return segsMatch(path, segs, i, j + 1) || (i < path.length && segsMatch(path, segs, i + 1, j + 1));
    case "rest1":
    case "rest0":
      for (let k = s.kind === "rest1" ? i + 1 : i; k <= path.length; k++) if (segsMatch(path, segs, k, j + 1)) return true;
      return false;
  }
}

const normBase = (b: string | null | undefined): string | null => {
  if (!b || /\$\{|%|\s/.test(b)) return null;
  const n = "/" + b.split("/").filter(Boolean).join("/");
  return n === "/" ? null : n;
};

/** The path a router reads from a concrete URL or path: the fragment for a hash router, else the pathname. */
export function routedPath(concrete: string, o: { hash?: boolean; basePath?: string | null } = {}): string[] {
  let s = concrete;
  const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(s);
  if (abs) s = s.slice(abs[0].length);
  const h = s.indexOf("#");
  const pathname = (h >= 0 ? s.slice(0, h) : s).split("?")[0]!;
  let segs = pathname.split("/").filter(Boolean);
  const base = normBase(o.basePath);
  if (base) {
    const b = base.split("/").filter(Boolean);
    if (b.every((x, k) => segs[k] === x)) segs = segs.slice(b.length);
  }
  if (!o.hash) return segs;
  const frag = h >= 0 ? s.slice(h + 1).replace(/^!/, "") : "";
  return frag.split("?")[0]!.split("/").filter(Boolean);
}

/** True when the concrete recipe path or URL matches the discovered pattern under R2-19's rule. */
export function matchRoute(concrete: string, pattern: string, o: { hash?: boolean; basePath?: string | null } = {}): boolean {
  return segsMatch(routedPath(concrete, o), patternSegs(pattern), 0, 0);
}

const specificity = (pattern: string): [number, number, number] => {
  const segs = patternSegs(pattern);
  const n = (f: (s: Seg) => boolean) => segs.filter(f).length;
  return [n((s) => s.kind === "rest0" || s.kind === "rest1"), n((s) => s.kind === "one" || s.kind === "optional" || s.kind === "mixed"), -n((s) => s.kind === "static")];
};

/** Every discovered route a concrete path matches, as route keys, most specific first (static before dynamic, catch-alls last). */
export function matchingRoutes(concrete: string, sets: readonly RouteSet[]): string[] {
  const hits = new Map<string, [number, number, number]>();
  for (const set of sets) for (const p of set.patterns) if (matchRoute(concrete, p, set)) hits.set(routeKey(p), specificity(p));
  return [...hits.entries()].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[1][2] - b[1][2] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
}

/** The distinct route keys across every set: the file check's route count. */
export const distinctRoutes = (sets: readonly RouteSet[]): string[] => [...new Set(sets.flatMap((s) => s.patterns.map(routeKey)))].sort();

// ---- File routers

const TEST_OR_STORY = /(^|\.)(test|spec|stories|story)\.[^.]+$/i;
/** A test or story file: a .test., .spec., .stories. or .story. part in its name, or a __tests__ folder on its path. */
export const isTestOrStory = (rel: string) => TEST_OR_STORY.test(rel.slice(rel.lastIndexOf("/") + 1)) || rel.split("/").includes("__tests__");

const jp = (a: string, b: string) => (a ? a + "/" + b : b);
const toPattern = (segs: readonly string[]) => "/" + segs.filter((s) => s !== "" && !isGroup(s)).join("/");

function configText(root: string, files: readonly string[], dir: string, base: string): string {
  return files
    .filter((f) => parentOf(f) === dir && new RegExp("^" + base.replace(".", "\\.") + "\\.(c|m)?(js|ts)$").test(f.slice(f.lastIndexOf("/") + 1)))
    .map((f) => readText(root, f) ?? "")
    .join("\n");
}

const literal = (text: string, re: RegExp): string | null => re.exec(text)?.[1] ?? null;

function nextSets(root: string, files: readonly string[], pkg: PackageJson): RouteSet[] {
  const cfg = configText(root, files, pkg.dir, "next.config");
  const basePath = normBase(literal(cfg, /basePath\s*:\s*['"`]([^'"`]+)['"`]/));
  const pages = new Set<string>();
  const app = new Set<string>();
  for (const dir of [jp(pkg.dir, "pages"), jp(pkg.dir, "src/pages")]) {
    for (const f of files) {
      if (!f.startsWith(dir + "/") || !/\.(jsx?|tsx?)$/.test(f) || f.endsWith(".d.ts") || isTestOrStory(f)) continue;
      const segs = f.slice(dir.length + 1).replace(/\.(jsx?|tsx?)$/, "").split("/");
      if (segs[0] === "api" || (segs.length === 1 && ["_app", "_document", "_error"].includes(segs[0]!))) continue;
      if (segs.at(-1) === "index") segs.pop();
      pages.add(toPattern(segs));
    }
  }
  for (const dir of [jp(pkg.dir, "app"), jp(pkg.dir, "src/app")]) {
    for (const f of files) {
      if (!f.startsWith(dir + "/") || !/(^|\/)page\.(jsx?|tsx?)$/.test(f)) continue;
      const segs = parentOf(f.slice(dir.length + 1)).split("/").filter(Boolean);
      if (segs.some((s) => s.startsWith("_") || /^\(\.{1,3}\)/.test(s))) continue;
      app.add(toPattern(segs.filter((s) => !s.startsWith("@"))));
    }
  }
  const out: RouteSet[] = [];
  if (pages.size) out.push({ router: "next-pages", root: pkg.dir, patterns: [...pages].sort(), hash: false, basePath });
  if (app.size) out.push({ router: "next-app", root: pkg.dir, patterns: [...app].sort(), hash: false, basePath });
  return out;
}

function nuxtSet(root: string, files: readonly string[], pkg: PackageJson): RouteSet | null {
  const nuxt2 = /^\D*2\./.test(pkg.deps.nuxt ?? "");
  const cfg = configText(root, files, pkg.dir, "nuxt.config");
  const basePath = normBase(literal(cfg, /baseURL\s*:\s*['"`]([^'"`]+)['"`]/) ?? literal(cfg, /router\s*:\s*\{[^}]*?\bbase\s*:\s*['"`]([^'"`]+)['"`]/));
  const hash = /hashMode\s*:\s*true/.test(cfg) || /router\s*:\s*\{[^}]*?\bmode\s*:\s*['"]hash['"]/.test(cfg);
  const pats = new Set<string>();
  for (const dir of [jp(pkg.dir, "pages"), jp(pkg.dir, "app/pages"), jp(pkg.dir, "src/pages")]) {
    for (const f of files) {
      if (!f.startsWith(dir + "/") || !/\.(vue|jsx|tsx)$/.test(f) || isTestOrStory(f)) continue;
      let segs = f.slice(dir.length + 1).replace(/\.(vue|jsx|tsx)$/, "").split("/");
      if (nuxt2) segs = segs.map((s) => (s === "_" ? "[...slug]" : s.startsWith("_") ? "[" + s.slice(1) + "]" : s));
      if (segs.at(-1) === "index") segs.pop();
      pats.add(toPattern(segs));
    }
  }
  return pats.size ? { router: "nuxt", root: pkg.dir, patterns: [...pats].sort(), hash, basePath } : null;
}

const nearestPackage = (pkgs: readonly PackageJson[], rel: string): string =>
  pkgs.filter((p) => under(rel, p.dir) && rel !== p.dir).reduce((a, p) => (p.dir.length > a.length ? p.dir : a), "");

function svelteSets(root: string, files: readonly string[], pkgs: readonly PackageJson[]): RouteSet[] {
  const by = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.endsWith("/+page.svelte") && f !== "+page.svelte") continue;
    const pkg = nearestPackage(pkgs, f);
    const folder = parentOf(f).split("/").filter(Boolean);
    const r = folder.lastIndexOf("routes");
    const segs = r >= 0 ? folder.slice(r + 1) : folder.slice(pkg ? pkg.split("/").length : 0);
    by.set(pkg, (by.get(pkg) ?? new Set()).add(toPattern(segs)));
  }
  return [...by.entries()].sort().map(([dir, pats]) => {
    const cfg = configText(root, files, dir, "svelte.config");
    return {
      router: "sveltekit" as const,
      root: dir,
      patterns: [...pats].sort(),
      hash: /router\s*:\s*\{[^}]*?\btype\s*:\s*['"]hash['"]/.test(cfg),
      basePath: normBase(literal(cfg, /paths\s*:\s*\{[^}]*?\bbase\s*:\s*['"`]([^'"`]+)['"`]/)),
    };
  });
}

// ---- Code routers: a tokenizer and a walk over Bun's transpiled output

type Tok = { t: "str"; v: string | null } | { t: "id"; v: string } | { t: "p"; v: string } | { t: "val" };
type Node = { open: string; items: Item[] };
type Item = Tok | Node;
const isNode = (x: Item | undefined): x is Node => x !== undefined && "open" in x;

const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);

function skipString(src: string, i: number): [end: number, value: string] {
  const q = src[i]!;
  let j = i + 1, v = "";
  while (j < src.length && src[j] !== q && src[j] !== "\n") {
    if (src[j] === "\\") {
      const e = src[j + 1] ?? "";
      v += e === "n" ? "\n" : e === "t" ? "\t" : e;
      j += 2;
    } else v += src[j++];
  }
  return [j + 1, v];
}

function skipTemplate(src: string, i: number): [end: number, value: string | null] {
  let j = i + 1, v = "", sub = false;
  while (j < src.length && src[j] !== "`") {
    if (src[j] === "\\") {
      v += src[j + 1] ?? "";
      j += 2;
    } else if (src[j] === "$" && src[j + 1] === "{") {
      sub = true;
      j += 2;
      for (let depth = 1; j < src.length && depth > 0; ) {
        const c = src[j]!;
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (c === "'" || c === '"') j = skipString(src, j)[0];
        else if (c === "`") j = skipTemplate(src, j)[0];
        else j++;
      }
    } else v += src[j++];
  }
  return [j + 1, sub ? null : v];
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  const regexOk = () => {
    const p = out[out.length - 1];
    if (!p) return true;
    if (p.t === "p") return !")]}".includes(p.v);
    if (p.t === "id") return REGEX_AFTER_WORD.has(p.v);
    return false;
  };
  for (let i = 0; i < n; ) {
    const c = src[i]!;
    if (/\s/.test(c)) i++;
    else if (c === "/" && src[i + 1] === "/") while (i < n && src[i] !== "\n") i++;
    else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === "'" || c === '"') {
      const [e, v] = skipString(src, i);
      out.push({ t: "str", v });
      i = e;
    } else if (c === "`") {
      const [e, v] = skipTemplate(src, i);
      out.push({ t: "str", v });
      i = e;
    } else if (c === "/" && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== "\n" && (src[j] !== "/" || cls)) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        j++;
      }
      i = j + 1;
      while (i < n && /[a-z]/i.test(src[i]!)) i++;
      out.push({ t: "val" });
    } else if (/[A-Za-z_$\p{L}]/u.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$\p{L}]/u.test(src[j]!)) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
    } else if (/\d/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j]!)) j++;
      out.push({ t: "val" });
      i = j;
    } else {
      out.push({ t: "p", v: c });
      i++;
    }
  }
  return out;
}

function treeOf(toks: readonly Tok[]): Node {
  const root: Node = { open: "(", items: [] };
  const stack = [root];
  for (const t of toks) {
    if (t.t === "p" && "{[(".includes(t.v)) {
      const node: Node = { open: t.v, items: [] };
      stack.at(-1)!.items.push(node);
      stack.push(node);
    } else if (t.t === "p" && "}])".includes(t.v)) {
      if (stack.length > 1) stack.pop();
    } else stack.at(-1)!.items.push(t);
  }
  return root;
}

const splitArgs = (items: readonly Item[]): Item[][] => {
  const out: Item[][] = [[]];
  for (const it of items) {
    if (!isNode(it) && it.t === "p" && it.v === ",") out.push([]);
    else out.at(-1)!.push(it);
  }
  return out.filter((a) => a.length);
};

const hasId = (items: readonly Item[], re: RegExp): boolean => items.some((it) => (isNode(it) ? hasId(it.items, re) : it.t === "id" && re.test(it.v)));

/** Object keys that mark a plain object with a path as a route entry. */
export const ROUTE_KEYS = ["component", "components", "Component", "element", "lazy", "loader", "action", "children", "redirect", "redirectTo", "loadComponent", "loadChildren", "errorElement", "render", "index"];

interface Found {
  path: string;
  redirect: boolean;
}
interface Ctx {
  found: Found[];
  config: boolean;
}

const joinPath = (prefix: string | null, p: string): string | null => {
  if (p.startsWith("/")) return "/" + p.split("/").filter(Boolean).join("/");
  if (prefix === null) return null;
  return "/" + (prefix + "/" + p).split("/").filter(Boolean).join("/");
};

function walkSeq(items: readonly Item[], prefix: string | null, ctx: Ctx): void {
  for (let k = 0; k < items.length; k++) {
    const it = items[k]!;
    if (isNode(it)) {
      if (it.open === "{") walkObject(it, prefix, "plain", ctx);
      else walkSeq(it.items, prefix, ctx);
      continue;
    }
    const next = items[k + 1];
    if (it.t !== "id" || !isNode(next) || next.open !== "(") continue;
    const args = splitArgs(next.items);
    if (/^_?jsx/i.test(it.v)) {
      const name = [...(args[0] ?? [])].reverse().find((t) => !isNode(t) && t.t === "id") as { v: string } | undefined;
      const props = args[1]?.length === 1 && isNode(args[1][0]) && args[1][0].open === "{" ? args[1][0] : null;
      if (props) walkObject(props, prefix, name && /Route$/.test(name.v) ? "jsx-route" : "jsx-other", ctx);
      walkSeq(args.slice(props ? 2 : 1).flat(), prefix, ctx);
      k++;
    } else if (ctx.config && ["route", "index", "layout", "prefix"].includes(it.v)) {
      const first = args[0]?.length === 1 && !isNode(args[0][0]) && args[0][0].t === "str" ? args[0][0].v : null;
      let inner = prefix;
      if (it.v === "index") {
        if (prefix !== null) ctx.found.push({ path: prefix, redirect: false });
      } else if (it.v === "route" || it.v === "prefix") {
        inner = first === null ? null : joinPath(prefix, first);
        if (it.v === "route" && inner !== null) ctx.found.push({ path: inner, redirect: false });
      }
      walkSeq(args.slice(it.v === "layout" || it.v === "index" ? 0 : 1).flat(), inner, ctx);
      k++;
    }
  }
}

function walkObject(node: Node, prefix: string | null, mode: "plain" | "jsx-route" | "jsx-other", ctx: Ctx): void {
  let path: string | null | undefined;
  let index = false, redirect = false, routeish = false;
  let children: Item[] | null = null;
  const rest: Item[] = [];
  for (const prop of splitArgs(node.items)) {
    const k = prop[0];
    const key = !isNode(k) && k && (k.t === "id" || k.t === "str") ? k.v : null;
    const colon = prop[1];
    if (key === null || isNode(colon) || colon?.t !== "p" || colon.v !== ":") {
      rest.push(...prop);
      continue;
    }
    const value = prop.slice(2);
    if (ROUTE_KEYS.includes(key)) routeish = true;
    if (key === "path") path = value.length === 1 && !isNode(value[0]) && value[0]!.t === "str" ? value[0]!.v : null;
    else if (key === "index") index = value.length === 1 && !isNode(value[0]) && value[0]!.t === "id" && value[0]!.v === "true";
    else if (key === "redirect" || key === "redirectTo") redirect = true;
    else if (key === "children") {
      children = value;
      continue;
    }
    if ((key === "element" || key === "component" || key === "render") && hasId(value, /^(Navigate|Redirect)$/)) redirect = true;
    if (key !== "path") rest.push(...value);
  }
  const isRoute = mode === "jsx-route" || (mode === "plain" && routeish && (path !== undefined || index));
  if (!isRoute) {
    walkSeq([...rest, ...(children ?? [])], prefix, ctx);
    return;
  }
  const full = path === undefined ? prefix : path === null ? null : joinPath(prefix, path);
  if (full !== null && (path !== undefined || index)) ctx.found.push({ path: full, redirect });
  walkSeq([...rest, ...(children ?? [])], full, ctx);
}

/** The route entries one source file defines, read from its transpiled text. */
export function codeRoutes(source: string, loader: "ts" | "tsx", config = false): Found[] {
  let js: string;
  try {
    js = new Bun.Transpiler({ loader }).transformSync(source);
  } catch {
    try {
      js = new Bun.Transpiler({ loader: loader === "ts" ? "tsx" : "ts" }).transformSync(source);
    } catch {
      return [];
    }
  }
  const ctx: Ctx = { found: [], config };
  walkSeq(treeOf(tokenize(js)).items, "", ctx);
  return ctx.found.map((f) => ({ ...f, path: "/" + f.path.split("/").filter(Boolean).join("/") }));
}

const CODE_FILE = /\.(m|c)?(js|ts)x?$/;
const HASH_MARK = /createHashRouter|HashRouter|createWebHashHistory|useHash\s*:\s*true|withHashLocation|\bmode\s*:\s*['"]hash['"]/;
const BASE_MARK = /(?:createWeb(?:Hash)?History\(\s*|\bbasename\s*[:=]\s*\{?\s*)['"`]([^'"`]+)['"`]/;

/** The router a source file defines routes for, by what it imports. */
export function codeRouterOf(text: string): { router: Router; config: boolean } | null {
  if (/['"]@angular\/router['"]/.test(text)) return { router: "angular", config: false };
  if (/['"]vue-router['"]/.test(text)) return { router: "vue-router", config: false };
  if (/['"]@react-router\/dev\/routes['"]/.test(text)) return { router: "react-router", config: true };
  if (/['"]react-router(-dom)?(\/[^'"]*)?['"]/.test(text)) return { router: "react-router", config: false };
  return null;
}

/** A wildcard-only code-router entry (*, **, /:pathMatch(.*)*) is a not-found fallback, not a route. */
const wildcardOnly = (p: string) => {
  const segs = patternSegs(p);
  return segs.length > 0 && segs.every((s) => s.kind === "rest0" || s.kind === "rest1");
};

function codeSets(root: string, files: readonly string[], pkgs: readonly PackageJson[]): RouteSet[] {
  const by = new Map<string, RouteSet>();
  for (const f of files) {
    if (!CODE_FILE.test(f) || f.endsWith(".d.ts") || f.endsWith(".min.js") || isTestOrStory(f)) continue;
    const text = readText(root, f);
    if (text === null) continue;
    const r = codeRouterOf(text);
    if (!r) continue;
    const pkg = nearestPackage(pkgs, f);
    const id = r.router + "\u0000" + pkg;
    const set = by.get(id) ?? { router: r.router, root: pkg, patterns: [], hash: false, basePath: null };
    by.set(id, set);
    if (HASH_MARK.test(text)) set.hash = true;
    set.basePath ??= normBase(literal(text, BASE_MARK));
    for (const e of codeRoutes(text, /\.(m|c)?ts$/.test(f) ? "ts" : "tsx", r.config)) if (!e.redirect && !wildcardOnly(e.path)) set.patterns.push(e.path);
  }
  for (const set of by.values()) {
    if (set.router === "angular" && set.basePath === null) {
      const html = readText(root, jp(set.root, "src/index.html")) ?? "";
      set.basePath = normBase(literal(html, /<base\s+href=["']([^"']+)["']/i));
    }
  }
  return [...by.values()].map((s) => ({ ...s, patterns: [...new Set(s.patterns)].sort() })).filter((s) => s.patterns.length > 0);
}

/** Every route set in a clone, in router order then package folder. files defaults to the clone's listing. */
export function discoverRoutes(root: string, files: readonly string[] = listFiles(root)): RouteSet[] {
  const pkgs = readPackages(root, files);
  const sets: RouteSet[] = [];
  for (const p of pkgs) if ("next" in p.deps) sets.push(...nextSets(root, files, p));
  sets.push(...svelteSets(root, files, pkgs));
  for (const p of pkgs) if ("nuxt" in p.deps) sets.push(...[nuxtSet(root, files, p)].filter((s): s is RouteSet => s !== null));
  sets.push(...codeSets(root, files, pkgs));
  return sets.sort((a, b) => ROUTERS.indexOf(a.router) - ROUTERS.indexOf(b.router) || (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}

/** True when a JS or TS source holds an object literal with the first key whose value is an object holding the next. */
export function hasNestedKey(source: string, loader: "ts" | "tsx", keys: readonly string[]): boolean {
  let js: string;
  try {
    js = new Bun.Transpiler({ loader }).transformSync(source);
  } catch {
    return false;
  }
  const valueOf = (node: Node, key: string): Item[] | null => {
    for (const prop of splitArgs(node.items)) {
      const k = prop[0], c = prop[1];
      if (!isNode(k) && k && (k.t === "id" || k.t === "str") && k.v === key && !isNode(c) && c?.t === "p" && c.v === ":") return prop.slice(2);
    }
    return null;
  };
  const holds = (node: Node, ks: readonly string[]): boolean => {
    const v = valueOf(node, ks[0]!);
    if (v === null) return false;
    if (ks.length === 1) return true;
    return v.length === 1 && isNode(v[0]) && v[0].open === "{" && holds(v[0], ks.slice(1));
  };
  const search = (items: readonly Item[]): boolean => items.some((it) => isNode(it) && ((it.open === "{" && holds(it, keys)) || search(it.items)));
  return search(treeOf(tokenize(js)).items);
}

