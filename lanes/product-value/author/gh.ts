// Copyright (c) 2026 Garry Tan. MIT License.
// GitHub reads for the product-value eval's free mining (prereg section 4 and section 18's outside terms): the GraphQL
// and REST APIs through the authenticated gh CLI, paced, with the GraphQL points each job used logged to its run log.
// The org's GraphQL quota is shared, so a job reads rate_limit before and after and waits for the reset rather than
// running the quota low.
import { spawnSync } from "node:child_process";

export class GhError extends Error {}

const run = (args: string[], input?: string): string => {
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 0) return r.stdout;
    const err = (r.stderr || "") + (r.stdout || "");
    if (attempt < 4 && /502|503|504|timeout|ECONNRESET|secondary rate limit|abuse/i.test(err)) {
      Bun.sleepSync(attempt * 20_000);
      continue;
    }
    throw new GhError("gh " + args.slice(0, 2).join(" ") + " failed: " + err.trim().slice(0, 300));
  }
};

/** The GraphQL quota left, read from REST rate_limit (free). */
export function graphqlLeft(): { remaining: number; reset: number } {
  const d = JSON.parse(run(["api", "rate_limit"])).resources.graphql;
  return { remaining: d.remaining, reset: d.reset };
}

/** Never let this job take the shared GraphQL quota under FLOOR; wait for the reset instead. */
export const FLOOR = 2500;

let used = 0;
export const pointsUsed = () => used;

export function graphql<T = any>(query: string, variables: Record<string, unknown> = {}): T {
  const body = JSON.stringify({ query, variables });
  const out = JSON.parse(run(["api", "graphql", "--input", "-"], body));
  if (out.errors?.length && !out.data) throw new GhError("GraphQL: " + JSON.stringify(out.errors).slice(0, 300));
  const rl = out.data?.rateLimit;
  if (rl) {
    used += rl.cost;
    if (rl.remaining < FLOOR) {
      const wait = Math.max(0, Date.parse(rl.resetAt) - Date.now()) + 5_000;
      Bun.sleepSync(wait);
    }
  }
  return out.data as T;
}

export function rest<T = any>(path: string): T {
  return JSON.parse(run(["api", path]));
}

/** REST that may 404: null instead of an error. */
export function restMaybe<T = any>(path: string): T | null {
  try {
    return rest<T>(path);
  } catch (e) {
    if (/404|Not Found/.test(String((e as Error).message))) return null;
    throw e;
  }
}
