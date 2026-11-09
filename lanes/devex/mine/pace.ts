// Copyright (c) 2026 Garry Tan. MIT License.
// The miner's share of the org's GraphQL quota (devex prereg section 16: public data, paced GraphQL, the shared quota
// left above its floor). Every GraphQL call waits until the points spent so far fit under the pace, in points an
// hour. The quota is read through REST's rate_limit, which costs no points, when a segment starts and ends and every
// READ_EVERY calls; the miner drops to half pace while others in the org press the quota: remaining under 40% of the
// limit, or others' use (the drop in remaining less the miner's own points since the last read) over 3,000 points an
// hour. Each read goes to mine.log as counts only. Queries awaited through graphqlAsync share the same pace with
// several in flight: each start waits its turn and books one point at once, and the rest of its cost when it ends.
import type { GitHub } from "../../aftermath/gh.ts";
import type { AsyncGraphql } from "./ahead.ts";

export const PACE = 3000;
export const READ_EVERY = 200;
export const LOW_SHARE = 0.4;
export const OTHERS_PER_HOUR = 3000;

export interface RateRead {
  read: string;
  remaining: number;
  limit: number;
  reset: number;
  own_points: number;
  others_per_hour: number | null;
  pace: number;
}

export interface Paced extends GitHub {
  /** Reads the quota, logs it and sets the pace from it. */
  read(at: string): RateRead;
  /** The pace in force, in points an hour. */
  pace(): number;
  /** One GraphQL query through the async client, under the same pace. */
  graphqlAsync<T = any>(query: string, variables?: Record<string, unknown>, o?: { notFound?: boolean }): Promise<T>;
}

export function paced(gh: GitHub, o: { pace: number; now: () => number; sleep: (ms: number) => void; log: (r: RateRead) => void; every?: number; async?: AsyncGraphql; sleepAsync?: (ms: number) => Promise<void> }): Paced {
  let next = 0, half = false, lastCalls = 0;
  let last: { remaining: number; reset: number; at: number; points: number } | null = null;
  const pace = () => (half ? o.pace / 2 : o.pace);
  const pointsUsed = () => gh.pointsUsed() + (o.async?.pointsUsed() ?? 0);
  const calls = () => gh.calls() + (o.async?.calls() ?? 0);
  const sleepAsync = o.sleepAsync ?? (async (ms: number) => o.sleep(ms));
  const read = (at: string): RateRead => {
    const d = gh.rest<any>("rate_limit").resources.graphql;
    const t = o.now(), own = pointsUsed();
    const others = last && d.reset === last.reset && t > last.at ? Math.round((last.remaining - d.remaining - (own - last.points)) / ((t - last.at) / 3_600_000)) : null;
    half = d.remaining < LOW_SHARE * d.limit || (others !== null && others > OTHERS_PER_HOUR);
    last = { remaining: d.remaining, reset: d.reset, at: t, points: own };
    lastCalls = calls();
    const r: RateRead = { read: at, remaining: d.remaining, limit: d.limit, reset: d.reset, own_points: own, others_per_hour: others, pace: pace() };
    o.log(r);
    return r;
  };
  return {
    ...gh,
    pointsUsed,
    calls,
    graphql<T = any>(query: string, variables?: Record<string, unknown>): T {
      const wait = next - o.now();
      if (wait > 0) o.sleep(wait);
      const t0 = o.now(), p0 = gh.pointsUsed();
      try {
        return gh.graphql<T>(query, variables);
      } finally {
        next = Math.max(next, t0) + (Math.max(1, gh.pointsUsed() - p0) * 3_600_000) / pace();
        if (calls() - lastCalls >= (o.every ?? READ_EVERY)) read("calls");
      }
    },
    async graphqlAsync<T = any>(query: string, variables: Record<string, unknown> = {}, opt: { notFound?: boolean } = {}): Promise<T> {
      if (!o.async) throw Object.assign(new Error("paced has no async GraphQL client"), { code: "E_MINE_SOURCE" });
      for (let wait = next - o.now(); wait > 0; wait = next - o.now()) await sleepAsync(wait);
      next = Math.max(next, o.now()) + 3_600_000 / pace();
      let cost = 1;
      try {
        const r = await o.async.graphql(query, variables, opt);
        cost = Math.max(1, r.cost);
        return r.data as T;
      } finally {
        next += ((cost - 1) * 3_600_000) / pace();
        if (calls() - lastCalls >= (o.every ?? READ_EVERY)) read("calls");
      }
    },
    read,
    pace,
  };
}
