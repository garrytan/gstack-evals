// Copyright (c) 2026 Garry Tan. MIT License.
// GitHub reads shared by the aftermath evals' free mining (product-value prereg section 4; devex prereg sections 4 and
// 16): REST and GraphQL through the authenticated gh CLI, so no program here ever holds a token. Each client paces its
// calls, keeps the shared GraphQL quota above its floor by waiting for the reset, counts the points it used and reads
// rate_limit before and after a job. The egress allowlist admits only GitHub's own hosts: an endpoint or git remote
// naming any other host is refused before anything leaves the machine. Each eval binds its own floor, pacing and retry
// rule (product-value keeps its four tries; the devex miner never retries).
import { spawnSync } from "node:child_process";

export class GhError extends Error {
  /** A reason code when the eval binds one (devex: E_MINE_SOURCE); product-value's errors carry none. */
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    if (code) this.code = code;
  }
}

/** The only hosts the miners may reach: the API, HTTPS clones and the archive host the API redirects to. */
export const GITHUB_HOSTS: readonly string[] = ["api.github.com", "github.com", "codeload.github.com"];

/** Refuses any URL that is not HTTPS on one of GITHUB_HOSTS; returns the parsed URL. */
export function assertGitHub(url: string, code?: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new GhError("egress refused: not a URL: " + JSON.stringify(url.slice(0, 80)), code);
  }
  if (u.protocol !== "https:" || !GITHUB_HOSTS.includes(u.hostname.toLowerCase()) || u.username || u.password || (u.port && u.port !== "443")) {
    throw new GhError("egress refused: " + u.protocol + "//" + u.hostname + " is not a GitHub host", code);
  }
  return u;
}

/** Checks a gh argument list: a full-URL endpoint or a --hostname must name GitHub. Returns the args unchanged. */
export function assertGhArgs(args: readonly string[], code?: string): readonly string[] {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a)) assertGitHub(a, code);
    if (a === "--hostname" && (args[i + 1] ?? "").toLowerCase() !== "github.com") throw new GhError("egress refused: --hostname " + (args[i + 1] ?? ""), code);
    if (a.startsWith("--hostname=") && a.slice(11).toLowerCase() !== "github.com") throw new GhError("egress refused: " + a, code);
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
  /** Never let a job take the shared GraphQL quota under this; wait for the reset instead. */
  floor: number;
  /** Total tries for a call that failed with a transient error (1 means no retry). */
  tries: number;
  /** Milliseconds to wait before retry n (product-value: n * 20 s). */
  backoffMs: (attempt: number) => number;
  /** Least milliseconds between two calls. */
  paceMs: number;
  /** The reason code this eval's errors carry, if any. */
  code?: string;
  exec?: GhExec;
  sleep?: (ms: number) => void;
  now?: () => number;
}

export interface GitHub {
  run(args: string[], input?: string): string;
  graphql<T = any>(query: string, variables?: Record<string, unknown>): T;
  rest<T = any>(path: string): T;
  restMaybe<T = any>(path: string): T | null;
  /** REST text with a media type, such as a pull request's diff, cut to maxBytes. */
  restText(path: string, accept: string, maxBytes: number): string;
  graphqlLeft(): { remaining: number; reset: number };
  pointsUsed(): number;
  calls(): number;
}

const TRANSIENT = /502|503|504|timeout|ECONNRESET|secondary rate limit|abuse/i;

export function openGitHub(o: GitHubOptions): GitHub {
  const exec = o.exec ?? ghCli;
  const sleep = o.sleep ?? ((ms: number) => Bun.sleepSync(ms));
  const now = o.now ?? (() => Date.now());
  let used = 0, last = 0, n = 0;
  const run = (args: string[], input?: string): string => {
    assertGhArgs(args, o.code);
    for (let attempt = 1; ; attempt++) {
      if (o.paceMs > 0 && last > 0) {
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
      throw new GhError("gh " + args.slice(0, 2).join(" ") + " failed: " + err.trim().slice(0, 300), o.code);
    }
  };
  const rest = <T = any>(path: string): T => JSON.parse(run(["api", path]));
  return {
    run,
    rest,
    restMaybe<T = any>(path: string): T | null {
      try {
        return rest<T>(path);
      } catch (e) {
        if (/404|Not Found/.test(String((e as Error).message))) return null;
        throw e;
      }
    },
    restText(path, accept, maxBytes) {
      return run(["api", "-H", "Accept: " + accept, path]).slice(0, maxBytes);
    },
    graphql<T = any>(query: string, variables: Record<string, unknown> = {}): T {
      const body = JSON.stringify({ query, variables });
      const out = JSON.parse(run(["api", "graphql", "--input", "-"], body));
      if (out.errors?.length && !out.data) throw new GhError("GraphQL: " + JSON.stringify(out.errors).slice(0, 300), o.code);
      const rl = out.data?.rateLimit;
      if (rl) {
        used += rl.cost;
        if (rl.remaining < o.floor) sleep(Math.max(0, Date.parse(rl.resetAt) - now()) + 5_000);
      }
      return out.data as T;
    },
    graphqlLeft() {
      const d = JSON.parse(run(["api", "rate_limit"])).resources.graphql;
      return { remaining: d.remaining, reset: d.reset };
    },
    pointsUsed: () => used,
    calls: () => n,
  };
}
