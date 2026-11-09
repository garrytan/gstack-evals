// Copyright (c) 2026 Garry Tan. MIT License.
// The miner's reads in flight together (devex prereg section 16: paced GraphQL). The draw's read functions stay
// synchronous; reader runs one of them against a GitHub whose graphql answers from that read's own cache and, on a
// query not yet answered, starts it through the paced client and throws Pending, so the read reruns once the answer
// is in. Each rerun replays the same queries from the cache, so a read returns what it would have returned run
// straight through. At most concurrency queries are in flight across every read, the lowest priority number first;
// a freed slot passes on only after the read that held it has asked again, so the unit being decided is never
// queued behind reads for units after it. GitHub's NOT_FOUND answer, a missing
// repository, comes back as data only to reads that ask for it.
import { spawn } from "node:child_process";
import { assertGhArgs, GhError, TRANSIENT, type GitHub } from "../../aftermath/gh.ts";
import type { Paced } from "./pace.ts";

export const CONCURRENCY = 3;

export type GhExecAsync = (args: string[], input?: string) => Promise<{ status: number; stdout: string; stderr: string }>;

export const ghCliAsync: GhExecAsync = (args, input) =>
  new Promise((done, fail) => {
    const p = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.setEncoding("utf8").on("data", (d: string) => void (stdout += d));
    p.stderr.setEncoding("utf8").on("data", (d: string) => void (stderr += d));
    p.on("error", fail);
    p.on("close", (status) => done({ status: status ?? 1, stdout, stderr }));
    p.stdin.end(input ?? "");
  });

/** One GraphQL query's data and the points it cost. */
export interface AsyncGraphql {
  graphql(query: string, variables: Record<string, unknown>, o?: { notFound?: boolean }): Promise<{ data: any; cost: number }>;
  calls(): number;
  pointsUsed(): number;
}

/** openGitHub's GraphQL, awaited: the same tries on transient failures, spacing between starts and quota floor. */
export function openGraphqlAsync(o: { exec: GhExecAsync; now: () => number; sleep: (ms: number) => Promise<void>; floor: number; tries: number; backoffMs: (n: number) => number; paceMs: number; code: string }): AsyncGraphql {
  let used = 0, n = 0, last = 0;
  const args = ["api", "graphql", "--input", "-"];
  return {
    async graphql(query, variables, opt = {}) {
      assertGhArgs(args, o.code);
      const body = JSON.stringify({ query, variables });
      for (let attempt = 1; ; attempt++) {
        const at = last > 0 ? Math.max(o.now(), last + o.paceMs) : o.now();
        last = at;
        if (at > o.now()) await o.sleep(at - o.now());
        n++;
        const r = await o.exec(args, body);
        let out: any = null;
        try {
          out = JSON.parse(r.stdout);
        } catch {
          if (r.status === 0) throw new GhError("gh api graphql returned no JSON", o.code);
        }
        const missing = r.status !== 0 && opt.notFound && out?.data && out.errors?.length && out.errors.every((e: any) => e?.type === "NOT_FOUND" && e.path?.length === 1);
        if (r.status === 0 || missing) {
          if (out.errors?.length && !out.data) throw new GhError("GraphQL: " + JSON.stringify(out.errors).slice(0, 300), o.code);
          const rl = out.data?.rateLimit;
          if (rl) {
            used += rl.cost;
            if (rl.remaining < o.floor) await o.sleep(Math.max(0, Date.parse(rl.resetAt) - o.now()) + 5_000);
          }
          return { data: out.data, cost: rl?.cost ?? 0 };
        }
        const err = (r.stderr || "") + (r.stdout || "");
        if (attempt < o.tries && TRANSIENT.test(err)) {
          await o.sleep(o.backoffMs(attempt));
          continue;
        }
        throw new GhError("gh " + args.slice(0, 2).join(" ") + " failed: " + err.trim().slice(0, 300), o.code);
      }
    },
    calls: () => n,
    pointsUsed: () => used,
  };
}

/** Thrown by a read's GitHub while its query is in flight; the read reruns once wait settles. */
export class Pending extends Error {
  constructor(readonly wait: Promise<unknown>) {
    super("a read is in flight");
  }
}

export interface Reader {
  /** Runs fn to its end, its queries in flight under the shared cap at this priority. */
  read<T>(prio: number, fn: (g: GitHub) => T | Promise<T>, o?: { notFound?: boolean }): Promise<T>;
  /** Refuses queries not yet started; those in flight finish and are dropped. */
  close(): void;
}

export function reader(gh: Paced, concurrency: number): Reader {
  let busy = 0, closed = false;
  let queue: Array<{ prio: number; go: () => void; stop: (e: unknown) => void }> = [];
  const ended = () => Object.assign(new Error("the segment ended before this read"), { code: "E_MINE_SOURCE" });
  const slot = async <T>(prio: number, f: () => Promise<T>): Promise<T> => {
    await new Promise<void>((go, stop) => {
      if (closed) return stop(ended());
      if (busy < concurrency) return (busy++, go());
      queue.push({ prio, go, stop });
      queue.sort((a, b) => a.prio - b.prio);
    });
    try {
      return await f();
    } finally {
      setImmediate(() => {
        const next = queue.shift();
        if (next) next.go();
        else busy--;
      });
    }
  };
  return {
    async read(prio, fn, o = {}) {
      type Entry = { wait: Promise<void>; done?: { v: unknown } | { e: unknown } };
      const cache = new Map<string, Entry>();
      const g: GitHub = {
        ...gh,
        graphql<T>(query: string, variables: Record<string, unknown> = {}): T {
          const k = JSON.stringify([query, variables]);
          const h = cache.get(k);
          if (h?.done) {
            if ("e" in h.done) throw h.done.e;
            return h.done.v as T;
          }
          if (h) throw new Pending(h.wait);
          const e: Entry = { wait: slot(prio, () => gh.graphqlAsync(query, variables, o)).then((v) => void (e.done = { v }), (x) => void (e.done = { e: x })) };
          cache.set(k, e);
          throw new Pending(e.wait);
        },
      };
      for (;;) {
        try {
          return await fn(g);
        } catch (x) {
          if (!(x instanceof Pending)) throw x;
          await x.wait;
        }
      }
    },
    close() {
      closed = true;
      for (const q of queue) q.stop(ended());
      queue = [];
    },
  };
}
