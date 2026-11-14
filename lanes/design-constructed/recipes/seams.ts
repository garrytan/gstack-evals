// Copyright (c) 2026 Garry Tan. MIT License.
// The seams recipe sessions and qualification call through: the frame's discovered routes and route matcher (R2-19,
// owned by the frame area), the recipe agent and the controller's browser. Integration wires the real ones.
import type { RECIPES } from "../frozen.ts";
import type { AgentRun, SubRef } from "../stage3/seams.ts";
import type { Vm } from "../stage3/sandbox.ts";
import type { RecipeLogin } from "./recipe.ts";

/** One route the frame's file check discovered, as the frame area reports it. */
export interface DiscoveredRoute {
  /** Stable within the candidate, for example the route file's path. */
  id: string;
  /** The route's own pattern, for example "/projects/[id]". */
  pattern: string;
  /** The route set's hash router mode, from the frame's route discovery (R2-19); absent reads as false. */
  hash?: boolean;
  /** The route set's literal base path, from the frame's route discovery; absent or null strips the recipe's. */
  basePath?: string | null;
}

/**
 * PD-10's route rule, from the frame area: the ids of the discovered routes a concrete recipe path matches (dynamic and
 * catch-all segments, route groups dropped, basePath stripped, trailing slash ignored, hash routers on the fragment).
 */
export type RouteMatcher = (path: string, routes: readonly DiscoveredRoute[], o: { basePath: string }) => string[];

/** A candidate that passed the file check, in frame order. */
export interface Candidate {
  /** A public-safe label, never the repository name. */
  id: string;
  /** The screened commit. */
  pin: string;
  /** The clone's tree at the pin as a tar, read from the kept clone as data only. */
  tree: () => Promise<Uint8Array>;
  routes: DiscoveredRoute[];
}

/** Runs Opus 5.5 in Claude Code inside the recipe VM under the recipe session's limits, through the metering proxy. */
export type RecipeAgent = (vm: Vm, o: { prompt: string; limits: typeof RECIPES.session; sub: SubRef }) => Promise<AgentRun>;

/** What the controller's in-page probe reads (PAGE_PROBE_SCRIPT in qualify.ts). */
export interface PageProbe {
  /** The selector of the app root it read, or "body". */
  root: string;
  /** Visible text characters inside the app root, whitespace collapsed. */
  textChars: number;
  /** Visible images, SVGs, canvases and videos inside the app root. */
  media: number;
  /** Visible password inputs inside the app root. */
  passwordInputs: number;
  /** Visible text characters in the app root outside the form that holds the first visible password input. */
  textOutsideLoginForm: number;
  /** Framework fallback or error-page markers found. */
  markers: string[];
}

/** One route load at one viewport, read the PD-10 way. */
export interface PageLoad {
  /** The requested absolute URL. */
  url: string;
  viewport: readonly [number, number];
  /** Null when the navigation got no response. */
  status: number | null;
  finalUrl: string | null;
  /** Uncaught page errors within RECIPES.pageErrorWindowMs of load. */
  pageErrors: number;
  probe: PageProbe | null;
}

/** The controller's Playwright, driving the VM's headless Chromium over the VM's SSH tunnel. */
export interface BrowserSession {
  /** Signs the seeded local user in and keeps the storage state for every later load; false when it fails. */
  login(login: RecipeLogin, url: string): Promise<boolean>;
  /** Loads url at the viewport, waits the page-error window, then runs the probe. */
  load(url: string, viewport: readonly [number, number]): Promise<PageLoad>;
  close(): Promise<void>;
}

export interface BrowserSeam {
  open(vm: Vm, baseUrl: string): Promise<BrowserSession>;
}
