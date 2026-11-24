// Copyright (c) 2026 Garry Tan. MIT License.
// The spend an error carries. A session that spent and then threw (a cap stop after the proxy metered it, a grading
// failure after a paid build, a model call that billed and answered nothing usable) adds what it spent to the error, so
// the caller's cost journal still counts it. The amount sits in a side table keyed by the error, so the thrown value is
// never changed: a frozen error keeps its spend and every existing caller sees the same error it saw before. A thrown
// value that is not an object is wrapped once in SpendError. takeSpend reads the amount and clears it, so one error
// settles its spend once even when it reaches two callers.
const SPENT = new WeakMap<object, number>();

export class SpendError extends Error {
  constructor(readonly thrown: unknown) {
    super(String(thrown));
  }
}

/** Adds usd to the spend e carries and returns the value to throw: e itself, or e wrapped when it is not an object. */
export function addSpend(e: unknown, usd: number): unknown {
  if (!(usd > 0)) return e;
  const key = typeof e === "object" && e !== null ? e : new SpendError(e);
  SPENT.set(key, (SPENT.get(key) ?? 0) + usd);
  return key;
}

/** Runs f; whatever it throws leaves carrying usd more spend. */
export async function spending<T>(usd: number, f: () => T | Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw addSpend(e, usd);
  }
}

/** The spend e carries, in dollars, cleared as it is read. */
export function takeSpend(e: unknown): number {
  if (typeof e !== "object" || e === null) return 0;
  const usd = SPENT.get(e) ?? 0;
  SPENT.delete(e);
  return usd;
}
