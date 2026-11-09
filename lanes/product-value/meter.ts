// Copyright (c) 2026 Garry Tan. MIT License.
// The product-value eval's binding of the shared metered client (lanes/aftermath/meter.ts): drift is
// E_PV_PROVIDER_DRIFT and stops the run (prereg 2026-11-08-geva-403 section 17, rule 6), and journal cells carry arm pv.
import { openMeter as openSharedMeter, type Meter, type MeterOptions } from "../aftermath/meter.ts";

export * from "../aftermath/meter.ts";

export type PvMeterOptions = Omit<MeterOptions, "driftCode" | "onDrift" | "arm">;

export const openMeter = (o: PvMeterOptions): Promise<Meter> => openSharedMeter({ ...o, driftCode: "E_PV_PROVIDER_DRIFT", onDrift: "throw", arm: "pv" });
