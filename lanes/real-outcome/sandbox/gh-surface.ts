// The gh surface a pinned gstack tree's /ship can reach (plan open item 1): every gh command shape named in ship/SKILL.md,
// ship/sections/*.md and the gstack helpers they call, as text (`gh pr view --json ...`) or as argv arrays
// (["pr", "view", ...]). Each shape is matched against the shapes the sidecar serves (gh.ts). P0's recorded trace adds the
// calls a static scan cannot see; the sidecar journals any call outside the surface as a rig error.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The shapes gh.ts serves. pr merge is served as a refusal; gh api is classified by its method and path (SERVED_API). */
export const SERVED: readonly string[] = ["auth status", "repo view", "pr create", "pr view", "pr list", "pr edit", "pr ready", "pr close", "pr reopen", "pr comment", "pr diff", "pr checks", "pr merge", "issue create", "issue list", "issue view", "issue comment", "run list", "run view", "workflow run"];
const VAR = String.raw`\$\{?\w+\}?`;
const REPO = String.raw`repos\/(?:${VAR}|(?:\{owner\}|${VAR})\/(?:\{repo\}|${VAR}))`;
const NUM = String.raw`(?:\d+|\$\w+|\$\{[^}\s]+\})`;
/** The REST calls apiCmd in gh.ts answers, by method: the repo as {owner}/{repo} or shell variables, a number as digits or a shell variable, any ref. Every other method and path is unserved, graphql included. */
const SERVED_API = new Map<string, RegExp>([
  ["GET", new RegExp(String.raw`^(?:rate_limit|user|${REPO}(?:\/pulls|\/pulls\/${NUM}(?:\/merge)?|\/(?:pulls|issues)\/${NUM}\/(?:reviews|requested_reviewers|comments)|\/commits\/[^/\s]+(?:\/check-runs|\/status|\/statuses)?)?)$`)],
  ["PATCH", new RegExp(String.raw`^${REPO}\/pulls\/${NUM}$`)],
  ["PUT", new RegExp(String.raw`^${REPO}\/(?:pulls|issues)\/${NUM}\/merge$`)],
  ["POST", new RegExp(String.raw`^${REPO}\/(?:pulls|issues)\/${NUM}\/comments(?:\/${NUM}\/replies)?$`)],
]);
const API_PATH = /^\/?(graphql|rate_limit|user|repos\/[^\s"'`,\])?]+)/;

const GROUPS = "pr|repo|api|auth|issue|run|release|workflow|search|label|secret|gist|browse|status|cache|extension|project|ruleset|attestation";
const TEXT = new RegExp("\\bgh (" + GROUPS + ")\\b(?: (--?[a-z]|[a-z][a-z-]*\\b))?", "g");
const ARRAY = new RegExp("\\[\\s*[\"'](" + GROUPS + ")[\"']\\s*(?:,\\s*[\"']([a-z][a-z-]*)[\"'])?", "g");

/** One gh api call's arguments after "api". In prose, continuations are joined and words split on whitespace outside quotes,
 * up to an unquoted backtick, |, ;, &, ) or the line end; in an argv array, each element, quoted or not, is one argument. */
function apiArgs(rest: string, prose: boolean): string[] {
  const text = prose ? rest.replace(/\\\r?\n/g, " ") : rest.slice(1);
  const args: string[] = [];
  let arg = "", open = false, quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\n" && quote !== "`") break;
      if (c === "\\" && !(prose && quote === "'")) arg += text[++i] ?? "";
      else if (c === quote) quote = "";
      else arg += c;
    } else if (prose ? /[\n`|;&)]/.test(c) : c === "]") break;
    else if (c === "'" || c === '"' || (!prose && c === "`")) [quote, open] = [c, true];
    else if (prose ? /\s/.test(c) : /[\s,]/.test(c)) {
      if (open) args.push(arg);
      [arg, open] = ["", false];
    } else [arg, open] = [arg + c, true];
  }
  if (open) args.push(arg);
  return args;
}

/** The method gh api sends, by gh's rule, which apiCmd follows: --method or -X when given, else POST when the call adds a field or an input file, else GET.
 * Each flag counts only as its own argument (-X PUT, --method PUT, -XPUT, --method=PUT), never inside another argument's value. */
function apiMethod(args: string[]): string {
  for (const [i, a] of args.entries()) {
    if (a === "-X" || a === "--method") return (args[i + 1] || "?").toUpperCase();
    const set = a.match(/^(?:-X|--method=)(.+)$/);
    if (set) return set[1]!.toUpperCase();
  }
  return args.some((a) => /^(?:-[fF]|--field|--raw-field|--input)(?:$|=)|^-[fF]./.test(a)) ? "POST" : "GET";
}

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
  const seen = new Map<string, { served: boolean; files: Set<string> }>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = file.slice(tree.length + 1);
    for (const re of [TEXT, ARRAY]) {
      for (const m of text.matchAll(re)) {
        const sub = m[2] && !m[2].startsWith("-") ? m[2] : "";
        let shape = (m[1] + " " + sub).trim();
        let served = SERVED.includes(shape);
        if (m[1] === "api") {
          const rest = text.slice(m.index! + m[0].indexOf("api") + 3);
          const args = apiArgs(rest, re === TEXT);
          const path = args.map((a) => a.match(API_PATH)?.[1]).find((p) => p !== undefined);
          const method = apiMethod(args);
          shape = ["api", method === "GET" ? "" : method, path ?? ""].filter(Boolean).join(" ");
          served = path !== undefined && SERVED_API.get(method)?.test(path) === true;
        }
        const row = seen.get(shape) ?? { served, files: new Set<string>() };
        row.files.add(rel);
        seen.set(shape, row);
      }
    }
  }
  return [...seen].map(([shape, row]) => ({ shape, served: row.served, files: [...row.files].sort() })).sort((a, b) => a.shape.localeCompare(b.shape));
}
