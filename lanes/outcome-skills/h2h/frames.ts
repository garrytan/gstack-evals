// Copyright (c) 2026 Garry Tan. MIT License.
// One reader for the three frozen frame files, so the draw, image preparation and analysis agree on unit ids. An O frame
// (h2h-o-frame.v1) holds its units. A B1 frame (h2h-b1-frame.v1) holds pull requests and a B2 frame (h2h-b2-frame.v1)
// holds advisories; each row becomes a unit under the id breadth's candidateOf gives it, with its window (primary or
// widened) kept for the draw's fallback rules.
import { readFileSync } from "node:fs";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { B1_SCHEMA, type B1Row } from "./breadth/b1.ts";
import { B2_SCHEMA, type B2Row } from "./breadth/b2.ts";
import { ECOSYSTEM_LANG } from "./breadth/frame.ts";
import { candidateOf } from "./breadth/oracle-b.ts";
import { O_FRAME_SCHEMA } from "./ordinary/frame.ts";
import { h2hFail } from "./prereg.ts";
import type { Entry, UnitKind } from "./types.ts";

export interface FrameUnit {
  id: string; kind: UnitKind; repo: string; month: string; window?: "primary" | "widened"; entry?: Entry; language?: string;
  licence?: string | null; digest?: string | null; [k: string]: unknown;
}
export interface FrameFile { kind: UnitKind; schema: string; counts: Record<string, unknown>; units: FrameUnit[] }

/** A frozen frame file as units, refusing under code when the file is not one of the three frame schemas. */
export function readFrameFile(path: string, code: ReasonCode): FrameFile {
  let j: { schema?: unknown; counts?: Record<string, unknown>; units?: unknown; pull_requests?: unknown; advisories?: unknown };
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return h2hFail(code, path + " is not readable JSON: " + (e as Error).message);
  }
  const counts = j.counts ?? {};
  if (j.schema === O_FRAME_SCHEMA) {
    if (!Array.isArray(j.units)) h2hFail(code, path + " has no units list");
    const units = (j.units as Record<string, unknown>[]).map((u) => ({ ...u, kind: "O" }) as FrameUnit);
    for (const u of units) if (u.entry !== "bug" && u.entry !== "feature") h2hFail(code, u.id + " has no bug or feature tag");
    return { kind: "O", schema: O_FRAME_SCHEMA, counts, units };
  }
  if (j.schema !== B1_SCHEMA && j.schema !== B2_SCHEMA) return h2hFail(code, path + " is not an " + [O_FRAME_SCHEMA, B1_SCHEMA, B2_SCHEMA].join(", ") + " file");
  const kind = j.schema === B1_SCHEMA ? "B1" : "B2";
  const list = kind === "B1" ? "pull_requests" : "advisories";
  const rows = j[list];
  if (!Array.isArray(rows)) h2hFail(code, path + " has no " + list + " list");
  const units = (rows as (B1Row | B2Row)[]).map((r): FrameUnit => {
    if (r.window !== "primary" && r.window !== "widened") h2hFail(code, path + ": a row of " + r.repo + " has window " + JSON.stringify(r.window) + ", not primary or widened");
    const c = candidateOf(kind, r);
    return { id: c.id, kind, repo: c.repo, month: c.month, window: r.window, language: c.ecosystems.map((e) => ECOSYSTEM_LANG[e] ?? e).join("+"), licence: c.licence };
  });
  return { kind, schema: j.schema, counts, units };
}
