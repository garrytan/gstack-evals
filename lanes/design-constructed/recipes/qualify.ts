// Copyright (c) 2026 Garry Tan. MIT License.
// Qualification, mechanical, by the controller, from a clean copy and offline except for the mirror (plan section 8,
// PD-10, R2-19, the Captain's B1 ruling): install, seed, build, start, optionally sign the seeded local user in, then
// load three routes at 375 by 812, 768 by 1024 and 1440 by 900, read under the strict reading of "renders" and, for the
// record, under the HTTP 200 reading too.
import { RECIPES } from "../frozen.ts";
import { sandboxed, type SandboxDeps, type Vm, type VmSpec } from "../stage3/sandbox.ts";
import { engineMismatch } from "./node.ts";
import { normalPath, type Recipe } from "./recipe.ts";
import type { BrowserSeam, Candidate, DiscoveredRoute, PageLoad, PageProbe, RouteMatcher } from "./seams.ts";

/** BT: a password form counts as a login form alone when the app root's visible text outside it is under this. */
export const LOGIN_ONLY_OUTSIDE_CHARS = 200;
/** BT: a page whose visible text is under this and holds a marker below is a framework fallback or error page. */
export const FALLBACK_MAX_CHARS = 400;
/** BT: framework fallback and error-page text, read case-insensitively on short pages. */
export const FALLBACK_TEXT = [
  "this page could not be found",
  "application error: a client-side exception has occurred",
  "unexpected application error",
  "internal server error",
  "page not found",
  "not found",
  "cannot get /",
  "internal error",
  "something went wrong",
];
/** BT: dev-server error overlays, which fail a load whatever the page's length. */
export const OVERLAY_SELECTORS = ["vite-error-overlay", "#webpack-dev-server-client-overlay", "nuxt-error-page", "#__nuxt_error"];
/** BT: the app root the probe reads, first match; else the body. */
export const ROOT_SELECTORS = ["#root", "#app", "#__next", "#__nuxt", "#svelte", "app-root", "[data-reactroot]"];

/** The controller's in-page probe; evaluated by Playwright after the page-error window. It returns a PageProbe. */
export const PAGE_PROBE_SCRIPT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0; };
  const text = (el) => (el && el.innerText ? el.innerText : "").replace(/\\s+/g, " ").trim();
  const roots = ${JSON.stringify(ROOT_SELECTORS)};
  const sel = roots.find((s) => document.querySelector(s));
  const root = sel ? document.querySelector(sel) : document.body;
  const media = [...root.querySelectorAll("img, svg, canvas, video, picture")].filter(vis).length;
  const pw = [...root.querySelectorAll('input[type="password"]')].filter(vis);
  const all = text(root).length;
  const form = pw.length ? (pw[0].closest("form") || pw[0].parentElement) : null;
  const body = text(document.body).toLowerCase();
  const markers = ${JSON.stringify(OVERLAY_SELECTORS)}.filter((s) => document.querySelector(s)).map((s) => "overlay " + s);
  if (body.length < ${FALLBACK_MAX_CHARS}) for (const t of ${JSON.stringify(FALLBACK_TEXT)}) if (body.includes(t)) markers.push("text " + t);
  return { root: sel || "body", textChars: all, media, passwordInputs: pw.length, textOutsideLoginForm: form ? Math.max(0, all - text(form).length) : all, markers };
})()`;

/** The URL a recipe path loads at: the base URL with the path, unless the path already starts with the base path. */
export function routeUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  return base.origin + (prefix && (path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix + "#")) ? path : prefix + path);
}

/** Whether a load ended on the route it asked for: same origin and path (trailing slash ignored), and the same fragment route for hash routers. Query strings are ignored. */
export function onRoute(requested: string, finalUrl: string): boolean {
  let a: URL, b: URL;
  try {
    a = new URL(requested);
    b = new URL(finalUrl);
  } catch {
    return false;
  }
  if (a.origin !== b.origin || normalPath(a.pathname) !== normalPath(b.pathname)) return false;
  const frag = (u: URL) => (u.hash.startsWith("#/") ? normalPath(u.hash.slice(1).split("?")[0]!) : null);
  return frag(a) === null || frag(a) === frag(b);
}

export interface LoadRead {
  /** Null when the load passes; else why it fails. */
  strict: string | null;
  http200: string | null;
}

/** One load under both readings of "renders" (PD-10). */
export function readLoad(l: PageLoad): LoadRead {
  const http = l.status === null ? "no response" : l.status >= 400 ? "HTTP " + l.status : l.pageErrors > 0 ? "an uncaught page error" : null;
  const strict = (() => {
    if (http) return http;
    if (!l.finalUrl || !onRoute(l.url, l.finalUrl)) return "ended on " + (l.finalUrl ?? "nothing") + ", not the requested route";
    const p: PageProbe | null = l.probe;
    if (!p) return "the page probe returned nothing";
    if (p.markers.length) return "a framework fallback or error page (" + p.markers.join(", ") + ")";
    if (p.passwordInputs > 0 && p.textOutsideLoginForm < LOGIN_ONLY_OUTSIDE_CHARS) return "a login form alone";
    if (p.textChars === 0 && p.media === 0) return "a blank page";
    return null;
  })();
  return { strict, http200: http };
}

/** Whether every path's discovered-route set can take a distinct route (a small exact search). */
function distinct(sets: readonly string[][], used = new Set<string>(), i = 0): boolean {
  if (i === sets.length) return true;
  for (const r of sets[i]!)
    if (!used.has(r)) {
      used.add(r);
      if (distinct(sets, used, i + 1)) return true;
      used.delete(r);
    }
  return false;
}

/**
 * The routes each reading loads. Strict: the first three recipe paths, in recipe order, that match three distinct
 * discovered routes. HTTP 200: the first three distinct recipe paths. Fewer than three leaves that reading short.
 */
export function pickRoutes(recipe: Recipe, discovered: readonly DiscoveredRoute[], match: RouteMatcher): { strict: string[]; http200: string[] } {
  const basePath = new URL(recipe.baseUrl).pathname.replace(/\/+$/, "");
  const strict: string[] = [];
  const sets: string[][] = [];
  const seen = new Set<string>();
  const http200: string[] = [];
  for (const p of recipe.routes) {
    const n = normalPath(p);
    if (seen.has(n)) continue;
    seen.add(n);
    if (http200.length < 3) http200.push(p);
    if (strict.length < 3) {
      const ids = match(p, discovered, { basePath });
      if (ids.length && distinct([...sets, ids])) {
        strict.push(p);
        sets.push(ids);
      }
    }
  }
  return { strict, http200 };
}

export type QualifyStep = "copy" | "services" | "install" | "seed" | "build" | "start" | "serve";

export interface Qualification {
  strict: boolean;
  http200: boolean;
  /** The first step that failed, before any route loaded. */
  failedStep: QualifyStep | null;
  /** Whether the failed step's stderr shows an engine-mismatch error (node.ts); printed only, never read by the screen. */
  engineError: boolean;
  strictWhy: string | null;
  http200Why: string | null;
  login: "none" | "ok" | "failed";
  loads: Array<PageLoad & LoadRead>;
}

/** BT: per-step time limits in the qualification VM, in minutes. */
export const STEP_MINUTES: Record<Exclude<QualifyStep, "copy" | "services">, number> = { install: 20, seed: 10, build: 20, start: 1, serve: 2 };

const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The commands that set the app up from the clean copy, in order, each with the user it runs as. */
export function setupSteps(recipe: Recipe): Array<{ step: QualifyStep; command: string; user: "root" | "run"; minutes: number }> {
  const inApp = (c: string) => "cd /work/app && " + c;
  return [
    { step: "copy", command: "mkdir -p /work/app && tar -xf /work/app.tar -C /work/app && rm /work/app.tar && chown -R run /work", user: "root", minutes: 5 },
    ...recipe.services.map((s) => ({
      step: "services" as const,
      command: "docker run -d --name " + sh("svc-" + s.name) + " --network host " + Object.entries(s.env).map(([k, v]) => "-e " + sh(k + "=" + v) + " ").join("") + sh(s.image),
      user: "root" as const,
      minutes: 10,
    })),
    { step: "install", command: inApp(recipe.install), user: "run", minutes: STEP_MINUTES.install },
    ...(recipe.seed.trim() ? [{ step: "seed" as const, command: inApp(recipe.seed), user: "run" as const, minutes: STEP_MINUTES.seed }] : []),
    { step: "build", command: inApp(recipe.build), user: "run", minutes: STEP_MINUTES.build },
    { step: "start", command: "cd /work/app && setsid -f sh -c " + sh(recipe.start) + " > /work/start.log 2>&1 < /dev/null", user: "run", minutes: STEP_MINUTES.start },
    { step: "serve", command: "for i in $(seq 1 " + STEP_MINUTES.serve * 60 + "); do curl -s -o /dev/null " + sh(recipe.baseUrl + "/") + " && exit 0; sleep 1; done; exit 1", user: "run", minutes: STEP_MINUTES.serve },
  ];
}

/** Reads every load into a qualification. A reading with fewer than three routes fails. */
export function judge(paths: { strict: string[]; http200: string[] }, loads: ReadonlyArray<PageLoad & LoadRead>, baseUrl: string): Pick<Qualification, "strict" | "http200" | "strictWhy" | "http200Why"> {
  const why = (ps: string[], pick: (l: LoadRead) => string | null, need: string): string | null => {
    if (ps.length < 3) return need;
    for (const p of ps)
      for (const v of RECIPES.viewports) {
        const l = loads.find((x) => x.url === routeUrl(baseUrl, p) && x.viewport[0] === v[0] && x.viewport[1] === v[1]);
        if (!l) return p + " at " + v[0] + "x" + v[1] + " did not load";
        const w = pick(l);
        if (w) return p + " at " + v[0] + "x" + v[1] + ": " + w;
      }
    return null;
  };
  const strictWhy = why(paths.strict, (l) => l.strict, "the recipe names fewer than 3 distinct discovered routes");
  const http200Why = why(paths.http200, (l) => l.http200, "the recipe names fewer than 3 distinct routes");
  return { strict: strictWhy === null, http200: http200Why === null, strictWhy, http200Why };
}

export interface QualifyDeps {
  sandbox: SandboxDeps;
  /** An offline spec: no proxy, the named mirrors only. */
  spec: (label: string) => VmSpec;
  browser: BrowserSeam;
  match: RouteMatcher;
  /** The Captain's B1 setting. */
  seededLogin: boolean;
}

async function qualifyJob(vm: Vm, c: Candidate, recipe: Recipe, d: QualifyDeps): Promise<Qualification> {
  const b = d.sandbox.backend;
  const failed = (step: QualifyStep, stderr: string): Qualification => ({ strict: false, http200: false, failedStep: step, engineError: engineMismatch(stderr), strictWhy: step + " failed", http200Why: step + " failed", login: "none", loads: [] });
  await b.write(vm, "/work/app.tar", await c.tree());
  for (const s of setupSteps(recipe)) {
    const r = await b.exec(vm, s.command, { user: s.user, timeoutMs: s.minutes * 60_000 });
    if (r.exit !== 0) return failed(s.step, r.stderr);
  }
  const paths = pickRoutes(recipe, c.routes, d.match);
  const session = await d.browser.open(vm, recipe.baseUrl);
  const loads: Array<PageLoad & LoadRead> = [];
  let login: Qualification["login"] = "none";
  try {
    if (recipe.login && d.seededLogin) login = (await session.login(recipe.login, routeUrl(recipe.baseUrl, recipe.login.route))) ? "ok" : "failed";
    const want = [...new Set([...paths.strict, ...paths.http200])];
    for (const p of want)
      for (const v of RECIPES.viewports) {
        const l = await session.load(routeUrl(recipe.baseUrl, p), v);
        loads.push({ ...l, ...readLoad(l) });
      }
  } finally {
    await session.close();
  }
  return { ...judge(paths, loads, recipe.baseUrl), failedStep: null, engineError: false, login, loads };
}

/** One qualification run in its own offline VM. The audit's result rides back for the caller to stop on. */
export function qualify(c: Candidate, recipe: Recipe, d: QualifyDeps, label: string) {
  return sandboxed(d.sandbox, d.spec(label), (vm) => qualifyJob(vm, c, recipe, d));
}
