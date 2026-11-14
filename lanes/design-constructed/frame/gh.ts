// Copyright (c) 2026 Garry Tan. MIT License.
// Source: lanes/aftermath/gh.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (build-devex-review-eval), trimmed and adapted.
// The frame's GitHub client: GraphQL and REST through the authenticated gh CLI, so no program here holds a token. It
// waits at least paceMs between any two calls (concurrency 1), keeps the shared GraphQL quota above its floor by
// waiting for the reset, and admits only GitHub's own hosts. A GraphQL reply that carries any error is refused whole,
// so a partial search page is never kept.
import { spawnSync } from "node:child_process";

export class GhError extends Error {}

/** The only hosts the frame may reach: the API and HTTPS clones. */
export const GITHUB_HOSTS: readonly string[] = ["api.github.com", "github.com"];

/** Refuses any URL that is not HTTPS on one of GITHUB_HOSTS; returns the parsed URL. */
export function assertGitHub(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new GhError("egress refused: not a URL: " + JSON.stringify(url.slice(0, 80)));
  }
  if (u.protocol !== "https:" || !GITHUB_HOSTS.includes(u.hostname.toLowerCase()) || u.username || u.password || (u.port && u.port !== "443")) {
    throw new GhError("egress refused: " + u.protocol + "//" + u.hostname + " is not a GitHub host");
  }
  return u;
}

/** Checks a gh argument list: a full-URL endpoint or a --hostname must name GitHub. Returns the args unchanged. */
export function assertGhArgs(args: readonly string[]): readonly string[] {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a)) assertGitHub(a);
    if (a === "--hostname" && (args[i + 1] ?? "").toLowerCase() !== "github.com") throw new GhError("egress refused: --hostname " + (args[i + 1] ?? ""));
    if (a.startsWith("--hostname=") && a.slice(11).toLowerCase() !== "github.com") throw new GhError("egress refused: " + a);
  }
  return args;
}

/** Runs gh with args (and stdin) and returns its exit status and output. Tests pass a fake. */
export type GhExec = (args: string[], input?: string) => { status: number; stdout: string; stderr: string };

export const ghCli: GhExec = (args, input) => {
  const r = spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

export interface GitHubOptions {
  /** Never let the frame take the shared GraphQL quota under this; wait for the reset instead. */
  floor: number;
  /** Total tries for a call that failed with a transient error (1 means no retry). */
  tries: number;
  /** Milliseconds to wait before retry n. */
  backoffMs: (attempt: number) => number;
  /** Least milliseconds between the starts of two calls. */
  paceMs: number;
  exec?: GhExec;
  sleep?: (ms: number) => void;
  now?: () => number;
}

/** REST rate_limit's GraphQL resource. */
export interface RateLimit {
  remaining: number;
  limit: number;
  used: number;
  reset: number;
}

/** A whole GraphQL reply: data and the query's own rateLimit selection. */
export interface GraphqlReply {
  data: any;
}

export interface GitHub {
  run(args: string[], input?: string): string;
  /** One GraphQL query; the whole reply, refused when it carries any error. */
  graphql(query: string, variables?: Record<string, unknown>): GraphqlReply;
  /** REST rate_limit, which costs no points. */
  rateLimit(): RateLimit;
  calls(): number;
}

export const TRANSIENT = /502|503|504|timeout|ECONNRESET|secondary rate limit|abuse/i;

export function openGitHub(o: GitHubOptions): GitHub {
  const exec = o.exec ?? ghCli;
  const sleep = o.sleep ?? ((ms: number) => Bun.sleepSync(ms));
  const now = o.now ?? (() => Date.now());
  let last = 0, n = 0;
  const run = (args: string[], input?: string): string => {
    assertGhArgs(args);
    for (let attempt = 1; ; attempt++) {
      if (o.paceMs > 0 && n > 0) {
        const wait = last + o.paceMs - now();
        if (wait > 0) sleep(wait);
      }
      last = now();
      n++;
      const r = exec(args, input);
      if (r.status === 0) return r.stdout;
      const err = (r.stderr || "") + (r.stdout || "");
      if (attempt < o.tries && TRANSIENT.test(err)) {
        sleep(o.backoffMs(attempt));
        continue;
      }
      throw new GhError("gh " + args.slice(0, 2).join(" ") + " failed: " + err.trim().slice(0, 300));
    }
  };
  return {
    run,
    graphql(query: string, variables: Record<string, unknown> = {}): GraphqlReply {
      const out = JSON.parse(run(["api", "graphql", "--input", "-"], JSON.stringify({ query, variables })));
      if (out.errors?.length || !out.data) throw new GhError("GraphQL: " + JSON.stringify(out.errors ?? "no data").slice(0, 300));
      const rl = out.data.rateLimit;
      if (rl && rl.remaining < o.floor) sleep(Math.max(0, Date.parse(rl.resetAt) - now()) + 5_000);
      return out as GraphqlReply;
    },
    rateLimit(): RateLimit {
      const d = JSON.parse(run(["api", "rate_limit"])).resources.graphql;
      return { remaining: d.remaining, limit: d.limit, used: d.used, reset: d.reset };
    },
    calls: () => n,
  };
}
