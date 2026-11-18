// Copyright (c) 2026 Garry Tan. MIT License.
// The stops the decision read counts for row 1 (the second attempt's section 3, items 8 to 10, and section 5.6). It
// takes every cap stop from each launch's stops.json and from each ledger item's record, and --cap-stop can add a stop
// but never remove one. The one cap stop that does not count is authoring's, when the sealed authoring summary records
// that it came after all 88 calibration and comparison briefs were placed: that stop ends authoring only. Authoring
// that ended any other way than on its quotas or on such a cap stop (the projection stop, a cap stop before calibration
// and comparison were full, a halt or the draft limit) counts too. A launch with no stops.json is refused, since a
// missing file must not hide a stop.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { capStopRefusal, readItem } from "../../../src/runner/ledger/record.ts";
import { SHM, unsealTo, type Decrypter } from "../author/custody.ts";
import type { AuthorRun } from "../author/run.ts";

/** Authoring's end as its sealed summary records it (author/run.ts summaryOf). */
export interface AuthoringEnd {
  stopped: AuthorRun["stopped"];
  /** All 88 calibration and comparison briefs were placed. */
  full: boolean;
}
export const AUTHOR_ITEM = "ohr-author";

/** Authoring's end from the sealed authoring output's authoring/summary.json, opened into /dev/shm and deleted after. */
export function authoringEnd(sealed: string, decrypt: Decrypter): AuthoringEnd {
  const parent = mkdtempSync(SHM + "/ohr-read-");
  try {
    const d = unsealTo(sealed, join(parent, "open"), decrypt);
    const s = JSON.parse(readFileSync(join(d, "authoring", "summary.json"), "utf8")) as Partial<AuthoringEnd>;
    if (typeof s.stopped !== "string" || typeof s.full !== "boolean") throw new Error("E_OHR_READ_INPUT " + sealed + "'s authoring/summary.json records no stopped and full, so it is not the second attempt's authoring output");
    return { stopped: s.stopped, full: s.full };
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

/** Every stop that reads row 1, one line each naming its source. */
export function readStops(o: { launches: readonly string[]; record: string; items: readonly string[]; authoring: AuthoringEnd; flag: boolean }): string[] {
  const out: string[] = [];
  for (const dir of o.launches) {
    const file = join(dir, "stops.json");
    if (!existsSync(file)) throw new Error("E_OHR_READ_INPUT " + dir + " has no stops.json; the decision read takes every launch's stops, so a launch that never wrote one is not read");
    const s = JSON.parse(readFileSync(file, "utf8")) as { stops: { code: string; message: string }[]; earlier?: { code: string; message: string }[] };
    for (const x of [...(s.earlier ?? []), ...s.stops]) if (x.code === "CAP_STOP") out.push(file + ": CAP_STOP " + x.message);
  }
  const afterFull = o.authoring.stopped === "cap" && o.authoring.full;
  for (const item of o.items) {
    const e = capStopRefusal(readItem(o.record, item));
    if (e && !(item === AUTHOR_ITEM && afterFull)) out.push("ledger item " + item + ": CAP_STOP " + e.message);
  }
  if (o.authoring.stopped !== "quotas" && !afterFull) out.push("authoring stopped at " + o.authoring.stopped + (o.authoring.full ? "" : " before calibration and comparison were full"));
  if (o.flag) out.push("--cap-stop: a cap stop named on the command line");
  return out;
}
