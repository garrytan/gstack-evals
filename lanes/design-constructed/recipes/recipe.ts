// Copyright (c) 2026 Garry Tan. MIT License.
// The recipe session's prompt (sha256-pinned) and /work/recipe.json's reader (plan section 8, R2-2, the Captain's B1
// ruling): install, seed, build, start, base_url, at least 3 routes, local services from Docker Hub images through the
// mirror, and one optional seeded local test user the recipe creates.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_CHECK } from "../frozen.ts";
import { fail } from "../errors.ts";
import { KEY_NAMES, secretHit } from "../stage3/sandbox.ts";

export const RECIPE_PROMPT_PATH = join(import.meta.dir, "..", "prompts", "recipes", "recipe.md");
export const RECIPE_PROMPT_SHA256 = "bf0b6bb764ba35a2bfbc4a4e6b25781b7b0118add6b067e40133da2749a239c3";

/** The build-time recipe prompt, refused when its bytes moved off the pin. */
export function recipePrompt(): string {
  const text = readFileSync(RECIPE_PROMPT_PATH, "utf8");
  const sha = createHash("sha256").update(text).digest("hex");
  if (sha !== RECIPE_PROMPT_SHA256) fail("E_INTERNAL", "the recipe prompt's sha256 is " + sha + ", not the pinned " + RECIPE_PROMPT_SHA256);
  return text;
}

export interface RecipeLogin {
  route: string;
  username: string;
  password: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
}

export interface RecipeService {
  name: string;
  image: string;
  ports: number[];
  env: Record<string, string>;
}

export interface Recipe {
  install: string;
  seed: string;
  build: string;
  start: string;
  baseUrl: string;
  routes: string[];
  services: RecipeService[];
  login: RecipeLogin | null;
}

export type RecipeRead = { ok: true; recipe: Recipe } | { ok: false; problems: string[] };

/** BT: the largest recipe.json read. */
export const MAX_RECIPE_BYTES = 65536;
/** A Docker Hub reference: no registry host, or docker.io itself. */
const HUB_IMAGE = /^(docker\.io\/)?([a-z0-9]+([._-][a-z0-9]+)*\/)?[a-z0-9]+([._-][a-z0-9]+)*(:[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?$/;
const PATH = /^\/[^\s]*$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/** A recipe path as compared for distinctness: no trailing slash, the root kept. */
export const normalPath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") || "/" : p);

/** Reads recipe.json. seededLogin is the Captain's B1 setting: a seeded local test user may sign in. */
export function parseRecipe(text: string, o: { seededLogin: boolean }): RecipeRead {
  const problems: string[] = [];
  if (new TextEncoder().encode(text).length > MAX_RECIPE_BYTES) return { ok: false, problems: ["recipe.json is over " + MAX_RECIPE_BYTES + " bytes"] };
  if (secretHit(text)) return { ok: false, problems: ["recipe.json carries a key pattern or a drive path"] };
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["recipe.json is not JSON"] };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, problems: ["recipe.json is not an object"] };
  const str = (k: string, empty = false) => {
    if (typeof j[k] !== "string" || (!empty && !j[k].trim())) problems.push(k + " is not " + (empty ? "a string" : "a non-empty string"));
    return typeof j[k] === "string" ? (j[k] as string) : "";
  };
  const install = str("install"), seed = str("seed", true), build = str("build"), start = str("start");
  const baseUrl = str("base_url");
  let url: URL | null = null;
  try {
    url = new URL(baseUrl);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) problems.push("base_url is not http on localhost or 127.0.0.1");
  const routes: string[] = Array.isArray(j.routes) ? j.routes : [];
  if (!Array.isArray(j.routes) || routes.some((r) => typeof r !== "string" || !PATH.test(r))) problems.push("routes is not a list of paths that start with /");
  else if (new Set(routes.map(normalPath)).size < FILE_CHECK.minRoutes) problems.push("routes has fewer than " + FILE_CHECK.minRoutes + " distinct paths");
  const services: RecipeService[] = [];
  if (j.services !== undefined) {
    if (!Array.isArray(j.services)) problems.push("services is not a list");
    else
      for (const s of j.services) {
        const name = typeof s?.name === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(s.name) ? s.name : null;
        const image = typeof s?.image === "string" && HUB_IMAGE.test(s.image) ? s.image : null;
        const ports = Array.isArray(s?.ports ?? []) && (s?.ports ?? []).every((n: unknown) => Number.isInteger(n) && (n as number) > 0 && (n as number) < 65536) ? ((s?.ports ?? []) as number[]) : null;
        const env = s?.env ?? {};
        const envOk = env && typeof env === "object" && !Array.isArray(env) && Object.entries(env).every(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === "string" && !KEY_NAMES.includes(k));
        if (!name) problems.push("a service has no plain name");
        if (!image) problems.push("service " + (name ?? "?") + "'s image is not a Docker Hub image");
        if (!ports) problems.push("service " + (name ?? "?") + "'s ports are not port numbers");
        if (!envOk) problems.push("service " + (name ?? "?") + "'s env is not plain names and strings");
        if (name && image && ports && envOk) services.push({ name, image, ports, env: env as Record<string, string> });
      }
  }
  let login: RecipeLogin | null = null;
  if (j.login !== undefined && j.login !== null) {
    const l = j.login;
    const f = ["route", "username", "password", "username_selector", "password_selector", "submit_selector"];
    if (!o.seededLogin) problems.push("the recipe signs in, and a seeded login is not allowed in this run");
    else if (!l || typeof l !== "object" || f.some((k) => typeof l[k] !== "string" || !l[k].trim())) problems.push("login needs " + f.join(", "));
    else if (!PATH.test(l.route)) problems.push("login.route is not a path on the app");
    else login = { route: l.route, username: l.username, password: l.password, usernameSelector: l.username_selector, passwordSelector: l.password_selector, submitSelector: l.submit_selector };
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, recipe: { install, seed, build, start, baseUrl: baseUrl.replace(/\/+$/, ""), routes, services, login } };
}
