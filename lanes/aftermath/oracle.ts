// Copyright (c) 2026 Garry Tan. MIT License.
// The oracle script the aftermath-keyed plan-review evals share (product-value section 7; devex section 7): with no model
// call, it turns a unit's primary key items into changes, one change per item in primary rank order, up to an eval's cap.
// Each eval binds how one item becomes a change.

/** One change per primary item, the first cap of them in rank order. */
export function oracleChanges<I extends { id: string }>(items: readonly I[], primary: readonly string[], cap: number, change: (item: I) => string): { changes: string[]; items: string[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ids = primary.slice(0, cap);
  return { changes: ids.map((id) => change(byId.get(id)!)), items: ids };
}
