// Copyright (c) 2026 Garry Tan. MIT License.
// The report driver (prereg sections 3 and 6, amendment items 12, 13 and 17): one item run on a lease through the
// in-process metering proxy, three turns per reading in the frozen caching order, the driver as the only retry owner.
import { notBuilt } from "./errors.ts";
import type { ItemRun, ItemRunOptions } from "./types.ts";

export function openItemRun(o: ItemRunOptions): Promise<ItemRun> {
  return notBuilt("openItemRun");
}
