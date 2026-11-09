// Copyright (c) 2026 Garry Tan. MIT License.
// The two-classifiers-and-a-tie-break pattern shared by the aftermath evals (product-value prereg section 4's type rule;
// devex prereg section 4's developer-facing classifier): two models label a unit independently, and only when they
// disagree, or one gave no label, does a third model label it; its label stands.

/** The first two labels when they agree, else the third (which may be null). */
export function decide<T>(a: T | null, b: T | null, third: T | null, same: (x: T, y: T) => boolean = (x, y) => x === y): T | null {
  if (a !== null && b !== null && same(a, b)) return a;
  return third;
}

/** Runs the panel: the first two in parallel, the third only on a split. */
export async function panel<K extends string, T>(label: (model: K) => Promise<T | null>, first: readonly [K, K], third: K, same?: (x: T, y: T) => boolean): Promise<{ a: T | null; b: T | null; third: T | null; decided: T | null }> {
  const [a, b] = await Promise.all(first.map(label)) as [T | null, T | null];
  const agree = a !== null && b !== null && (same ?? ((x: T, y: T) => x === y))(a, b);
  const t = agree ? null : await label(third);
  return { a, b, third: t, decided: decide(a, b, t, same) };
}
