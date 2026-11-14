// Copyright (c) 2026 Garry Tan. MIT License.
// Invented fixtures for the recipe screen's tests and dry-run cases: a scripted recipe agent, a scripted browser, a
// ledger stand-in with section 5's admission arithmetic, and a stand-in route matcher. No real app, model or VM.
import { fakeBackend, fakeHosts, fakeMirrors, fakeMoney, fakeSpec, fakeWorld, type FakeWorld } from "../stage3/fake.ts";
import { PAGE_PROBE_SCRIPT } from "./qualify.ts";
import type { BrowserSeam, Candidate, DiscoveredRoute, PageLoad, PageProbe, RouteMatcher } from "./seams.ts";
import type { ScreenDeps } from "./sessions.ts";

/** A stand-in for the frame's PD-10 matcher on fixture patterns: [x] one segment, [...x] one or more. */
export const fixtureMatcher: RouteMatcher = (path, routes, o) => {
  const strip = (p: string) => (o.basePath && p.startsWith(o.basePath) ? p.slice(o.basePath.length) || "/" : p);
  const segs = (p: string) => p.split("/").filter(Boolean);
  const want = segs(strip(path).split("?")[0]!);
  const fits = (pattern: string) => {
    const pat = segs(pattern).filter((s) => !/^\(.*\)$/.test(s));
    for (let i = 0; i < pat.length; i++) {
      if (/^\[\.\.\..+\]$/.test(pat[i]!)) return want.length > i && i === pat.length - 1;
      if (i >= want.length) return false;
      if (!/^\[.+\]$/.test(pat[i]!) && pat[i] !== want[i]) return false;
    }
    return pat.length === want.length;
  };
  return routes.filter((r) => fits(r.pattern)).map((r) => r.id);
};

export const ROUTES: DiscoveredRoute[] = [
  { id: "r-projects", pattern: "/projects" },
  { id: "r-project", pattern: "/projects/[id]" },
  { id: "r-tickets", pattern: "/(app)/tickets" },
  { id: "r-settings", pattern: "/settings" },
  { id: "r-docs", pattern: "/docs/[...slug]" },
];

export const content = (o: Partial<PageProbe> = {}): PageProbe => ({ root: "#root", textChars: 1200, media: 4, passwordInputs: 0, textOutsideLoginForm: 1200, markers: [], ...o });
export const loginForm = (): PageProbe => content({ textChars: 90, media: 1, passwordInputs: 1, textOutsideLoginForm: 30 });

/** What a fixture app shows: a page for a route, given whether the seeded user is signed in. */
export type AppKind = "content" | "blank" | "login-redirect" | "login-only" | "outside-auth" | "fallback" | "page-error" | "http-500";

export function page(kind: AppKind, url: string, viewport: readonly [number, number], signedIn: boolean): PageLoad {
  const u = new URL(url);
  const at = (finalUrl: string | null, status: number | null, probe: PageProbe | null, pageErrors = 0): PageLoad => ({ url, viewport, status, finalUrl, pageErrors, probe });
  if (kind === "content") return at(url, 200, content());
  if (kind === "blank") return at(url, 200, content({ root: "#app", textChars: 0, media: 0, textOutsideLoginForm: 0 }));
  if (kind === "login-redirect") return signedIn ? at(url, 200, content()) : at(u.origin + "/login?next=" + encodeURIComponent(u.pathname), 200, loginForm());
  if (kind === "login-only") return signedIn ? at(url, 200, content()) : at(url, 200, loginForm());
  if (kind === "outside-auth") return at(null, null, null);
  if (kind === "fallback") return at(url, 200, content({ textChars: 40, media: 0, textOutsideLoginForm: 40, markers: ["text this page could not be found"] }));
  if (kind === "page-error") return at(url, 200, content(), 1);
  return at(url, 500, content({ markers: ["text internal server error"] }));
}

export const RECIPE = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ install: "npm ci", seed: "npm run seed", build: "npm run build", start: "npm start", base_url: "http://localhost:3000", routes: ["/projects", "/projects/1", "/tickets"], services: [{ name: "db", image: "postgres:16", ports: [5432], env: { POSTGRES_PASSWORD: "local-only" } }], ...o });

export const LOGIN = { route: "/login", username: "demo@example.test", password: "demo-pass", username_selector: "#email", password_selector: "#password", submit_selector: "button[type=submit]" };

/** One fixture candidate: what its session ends with, the recipe it writes, and the app its pages show. */
export interface FixtureApp {
  end?: "completed" | "own-limit" | "infra" | "infra-once";
  recipe?: string | null;
  app?: AppKind;
  spentUsd?: number;
}

export function candidates(apps: FixtureApp[]): Candidate[] {
  return apps.map((_, i) => ({ id: "c" + String(i + 1).padStart(2, "0"), pin: "0".repeat(39) + (i % 10), tree: async () => new TextEncoder().encode("tar"), routes: ROUTES }));
}

/** A scripted browser over the fixture apps, keyed by the VM's candidate. */
export function fixtureBrowser(appOf: (vmId: string) => AppKind, log: string[] = []): BrowserSeam {
  return {
    open: async (vm) => {
      let signedIn = false;
      if (!PAGE_PROBE_SCRIPT.includes("passwordInputs")) throw new Error("probe script lost its fields");
      return {
        login: async () => {
          const kind = appOf(vm.id);
          signedIn = kind === "login-redirect" || kind === "login-only";
          log.push("login " + vm.id + " " + signedIn);
          return signedIn;
        },
        load: async (url, viewport) => page(appOf(vm.id), url, viewport, signedIn),
        close: async () => {},
      };
    },
  };
}

/** Wires a whole screen over fixture apps, one per candidate, in a fake Ubicloud. */
export function fixtureScreen(apps: FixtureApp[], o: { seededLogin?: boolean; money?: ReturnType<typeof fakeMoney>; world?: FakeWorld; hostsRefuse?: boolean } = {}) {
  const world = o.world ?? fakeWorld();
  const backend = fakeBackend(world);
  const money = o.money ?? fakeMoney();
  const vmCandidate = new Map<string, number>();
  const tries = new Map<number, number>();
  const label = (l: string) => Number(/c(\d+)/.exec(l)![1]) - 1;
  const create = backend.create.bind(backend);
  backend.create = async (spec) => {
    const vm = await create(spec);
    vmCandidate.set(vm.id, label(spec.label));
    return vm;
  };
  const deps: ScreenDeps = {
    sandbox: { backend, hosts: fakeHosts({ refuse: o.hostsRefuse }), now: () => 0 },
    money,
    agent: async (vm) => {
      const i = vmCandidate.get(vm.id)!;
      const a = apps[i]!;
      const n = (tries.get(i) ?? 0) + 1;
      tries.set(i, n);
      const end = a.end === "infra-once" ? (n === 1 ? "infra" : "completed") : (a.end ?? "completed");
      const text = a.recipe === undefined ? RECIPE() : a.recipe;
      if (end === "completed" && text !== null) await backend.write(vm, "/work/recipe.json", text);
      return { end, spentUsd: a.spentUsd ?? 3 };
    },
    browser: fixtureBrowser((id) => apps[vmCandidate.get(id)!]!.app ?? "content"),
    match: fixtureMatcher,
    recipeSpec: (l) => fakeSpec({ label: l }),
    qualifySpec: (l) => fakeSpec({ label: l, proxy: null, mirrors: fakeMirrors() }),
    seededLogin: o.seededLogin ?? true,
    frame: { cloneAttempts: 61, clones: 60, fileCheckPasses: apps.length },
  };
  return { deps, world, money, candidates: candidates(apps) };
}
