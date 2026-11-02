// The gh surface a pinned gstack tree's /ship can reach (plan open item 1): every gh command shape named in ship/SKILL.md,
// ship/sections/*.md and the gstack helpers they call, as text (`gh pr view --json ...`) or as argv arrays
// (["pr", "view", ...]). Each shape is matched against the shapes the sidecar serves (gh.ts). P0's recorded trace adds the
// calls a static scan cannot see; the sidecar journals any call outside the surface as a rig error.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The shapes gh.ts serves. pr merge is served as a refusal; gh api is classified by its path (SERVED_API). */
export const SERVED: readonly string[] = ["auth status", "repo view", "pr create", "pr view", "pr list", "pr edit", "pr ready", "pr close", "pr reopen", "pr comment", "pr diff", "pr checks", "pr merge", "issue create", "issue list", "issue view", "issue comment", "run list", "run view", "workflow run"];
/** The REST paths apiCmd in gh.ts serves, with any owner, repo, number or ref, shell variables included. graphql and every other path are unserved. */
const SERVED_API = /^(rate_limit|user|repos\/(?:\$\{?\w+\}?|[^/\s]+\/[^/\s]+)(\/pulls|\/(pulls|issues)\/[^/\s]+(\/merge|\/reviews|\/requested_reviewers|\/comments|\/comments\/[^/\s]+\/replies)?|\/commits\/[^/\s]+(\/check-runs|\/status|\/statuses)?)?)$/;
const API_PATH = /(?:^|[\s"'`,[(])\/?(graphql|rate_limit|user|repos\/[^\s"'`,\])?]+)/;

const GROUPS = "pr|repo|api|auth|issue|run|release|workflow|search|label|secret|gist|browse|status|cache|extension|project|ruleset|attestation";
const TEXT = new RegExp("\\bgh (" + GROUPS + ")\\b(?: (--?[a-z]|[a-z][a-z-]*\\b))?", "g");
const ARRAY = new RegExp("\\[\\s*[\"'](" + GROUPS + ")[\"']\\s*(?:,\\s*[\"']([a-z][a-z-]*)[\"'])?", "g");

export interface SurfaceRow {
  shape: string;
  served: boolean;
  files: string[];
}

export function ghSurface(tree: string): SurfaceRow[] {
  const ship = join(tree, "ship");
  if (!existsSync(join(ship, "SKILL.md"))) throw new Error(tree + " holds no ship/SKILL.md");
  const docs = [join(ship, "SKILL.md"), ...(existsSync(join(ship, "sections")) ? readdirSync(join(ship, "sections")).filter((f) => f.endsWith(".md")).map((f) => join(ship, "sections", f)) : [])];
  const files = new Set([...docs, ...[...new Set(docs.flatMap((d) => readFileSync(d, "utf8").match(/\bgstack-[a-z0-9-]+/g) ?? []))].map((n) => join(tree, "bin", n)).filter((f) => existsSync(f))]);
  for (const file of files) {
    if (file.endsWith(".md")) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from|import\()\s*["'](\.\.?\/[^"']+)["']/g)) {
      const dep = [resolve(dirname(file), m[1]!), resolve(dirname(file), m[1]! + ".ts")].find((p) => p.startsWith(resolve(tree) + "/") && existsSync(p) && !p.endsWith("/"));
      if (dep) files.add(dep);
    }
  }
  const seen = new Map<string, Set<string>>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = file.slice(tree.length + 1);
    for (const re of [TEXT, ARRAY]) {
      for (const m of text.matchAll(re)) {
        const sub = m[2] && !m[2].startsWith("-") ? m[2] : "";
        const path = m[1] === "api" ? text.slice(m.index! + m[0].indexOf("api") + 3).split(re === TEXT ? "\n" : "]")[0]!.match(API_PATH)?.[1] : undefined;
        const shape = m[1] === "api" ? ("api " + (path ?? "")).trim() : (m[1] + " " + sub).trim();
        if (!seen.has(shape)) seen.set(shape, new Set());
        seen.get(shape)!.add(rel);
      }
    }
  }
  return [...seen].map(([shape, files]) => ({ shape, served: shape === "api" || shape.startsWith("api ") ? SERVED_API.test(shape.slice(4)) : SERVED.includes(shape), files: [...files].sort() })).sort((a, b) => a.shape.localeCompare(b.shape));
}
