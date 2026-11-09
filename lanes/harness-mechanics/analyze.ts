// Copyright (c) 2026 Garry Tan. MIT License.
// The report (A1 to A6, H1 to H3, the R48 table and H1's pre-data reporting amendment): the entry point the analysis
// build fills. Until then it refuses with E_HM_NOT_BUILT.
import type { HmSessionRow } from "../../src/types.ts";

export type ReportOptions = { stage: "stage1" | "stage3" | "stage4"; out: string };
export function report(_rows: HmSessionRow[], _o: ReportOptions): { lines: string[] } {
  throw new Error("E_HM_NOT_BUILT report: the analysis is not built yet (unit 4)");
}
