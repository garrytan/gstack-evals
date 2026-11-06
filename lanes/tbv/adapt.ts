// Copyright (c) 2026 Garry Tan. MIT License.
// The one adapter from the frozen tbv-rule.ts.txt's input files to the head rule's: it fills only the fields the build
// added (plan.taskIds, plan.controlTaskIds, plan.manifestSha256 and the split manifest, response ids, judge fields,
// statuses, maxTokens) and the amendment's new input shapes (allin per paid item, judge pricing per packet kind). It
// never overrides a field the frozen input carries, except reading labels: a frozen reading that carries a second read
// gets a label the seeded double-read draw picks, and a scored reading on a task with facts that carries none gets one
// the draw passes over, since the head checks the sample against that draw. A second read on a reading that is not
// scored is dropped: the frozen rule reads second reads on scored readings only, and the head refuses one the draw did
// not pick. regress.ts and dryrun.ts use it.
import { createHash } from "node:crypto";
import { CREDIT_USD, doubleRead } from "./rule.ts";
import { JUDGE_OF, otherJudge, type Model, type SplitManifest } from "./types.ts";

type Any = Record<string, any>;
export type Adapted = { data: unknown; split?: { manifest: SplitManifest; text: string } };

function readings(rd: Any): Adapted {
  if (!rd || typeof rd !== "object" || !Array.isArray(rd.tasks) || !Array.isArray(rd.readings) || !rd.plan || typeof rd.plan !== "object") return { data: rd };
  const nfacts = new Map<string, number>(rd.tasks.map((t: Any) => [t?.id, t?.nfacts]));
  const out = rd.readings.map((r: Any, i: number) => {
    if (!r || typeof r !== "object") return r;
    const x: Any = { ...r };
    x.judge ??= JUDGE_OF[x.model as Model];
    x.maxTokens ??= [];
    x.responseIds ??= ["frozen-" + i];
    if (x.second !== undefined && x.status !== "scored") delete x.second;
    if (x.second && typeof x.second === "object") x.second = { judge: otherJudge(x.judge), status: "judged", responseIds: ["frozen-" + i + "-second"], ...x.second };
    const want = x.second ? true : x.status === "scored" && (nfacts.get(x.task) ?? 0) > 0 ? false : null;
    if (want !== null && typeof x.id === "string" && doubleRead(x.id) !== want) { let k = 0; while (doubleRead(x.id + "~" + k) !== want) k++; x.id = x.id + "~" + k; }
    return x;
  });
  const controls = Array.isArray(rd.controls) ? rd.controls.map((c: Any, i: number) => (c && typeof c === "object" ? { status: "judged", responseIds: ["frozen-control-" + i], ...c } : c)) : rd.controls;
  const controlTaskIds: string[] = rd.plan.controlTaskIds ?? (rd.stage === "hr" ? rd.tasks.filter((t: Any) => t?.stratum !== "clean").map((t: Any) => t.id) : [...new Set<string>((controls ?? []).map((c: Any) => c?.task))]);
  const manifest: SplitManifest = { schema: "tbv-split.v1", stage: rd.stage, tasks: rd.tasks, controlTaskIds };
  const text = JSON.stringify(manifest);
  const plan = { taskIds: rd.tasks.map((t: Any) => t?.id), controlTaskIds, manifestSha256: createHash("sha256").update(text).digest("hex"), ...rd.plan };
  return { data: { ...rd, readings: out, ...(controls === undefined ? {} : { controls }), plan }, split: { manifest, text } };
}

export function frozenToHead(cmd: string, data: unknown): Adapted {
  const d = data as Any;
  if (cmd === "headroom" || cmd === "compare") return readings(d);
  if (cmd === "allin" && d && typeof d === "object" && "heldCap" in d && !("item" in d)) {
    const { crewSpent, heldCap, ...rest } = d;
    return { data: { item: "tbv-held", crewCredits: typeof crewSpent === "number" ? Math.round(crewSpent / CREDIT_USD) : crewSpent, itemCap: heldCap, ...rest } };
  }
  if (cmd === "projection" && d && typeof d === "object" && Array.isArray(d.items) && "judgePerReading" in d) {
    const { judgePerReading, ...rest } = d;
    return { data: { ...rest, items: d.items.map((it: Any) => (it && typeof it === "object" && !("packets" in it) ? { ...it, packets: [{ judge: "sol", kind: "first", n: it.judgeN }] } : it)), judgeMeasured: { "sol:first": judgePerReading } } };
  }
  return { data };
}
