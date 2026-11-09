// Copyright (c) 2026 Garry Tan. MIT License.
// The generic screen as the funnel calls it (prereg 2026-11-09-geva-417, section 3, "Generic screen"): one key's items
// against stock rows 1 and 2, labelled by Astra and Opus with the scoring part's packets, judge client rendering and
// screen rule (lanes/devex/score), every call on the authoring meter. The screen function is a parameter so the rule
// stays in one place.
import { MeterError, MODELS, type Meter } from "../../aftermath/meter.ts";
import { judgePackets, type Caller } from "../score/judge.ts";
import { buildGenericPackets, type LabelRecord, type PacketMap } from "../score/packets.ts";
import type { Key } from "../types.ts";

export type ScreenRule = (map: PacketMap, labels: readonly LabelRecord[], keys: ReadonlyMap<string, Key>) => { keys: Map<string, Key> };

/** A judge Caller over an open meter (the authoring item's lease); a refused call reads as no reply. */
export function meterCaller(meter: Meter): Caller {
  return async (c) => {
    const m = MODELS[c.judge];
    try {
      const r = await meter.call({ model: c.judge, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label });
      return { text: r.text, model_id: m.provider + ":" + m.id, version: null, problem: r.problem };
    } catch (e) {
      if (!(e instanceof MeterError)) throw e;
      return { text: null, model_id: m.provider + ":" + m.id, version: null, problem: e.message };
    }
  };
}

/** The funnel's genericScreen dependency: builds the unit's generic packets, labels them and applies the rule. */
export function genericVia(call: Caller, rule: ScreenRule): (key: Key) => Promise<Key> {
  return async (key) => {
    const keys = new Map([[key.unit, key]]);
    const built = buildGenericPackets(keys);
    const res = await judgePackets({ map: built.map, packets: new Map(built.packets.map((p) => [p.id, p])), call, concurrency: 2 });
    return rule(built.map, res.labels, keys).keys.get(key.unit) ?? key;
  };
}
