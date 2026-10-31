import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outcomeLabel, parseFindings, parseFinalTurn, renderFindings } from "../../../src/trial/review/findings.ts";
import { mapSeverity, rawLabel, type ArmJson } from "../../../lanes/review-noloss/contract.ts";

const DIR = join(import.meta.dir, "fixtures");
const expected = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8")) as Record<string, { kind: string }>;

describe("the findings parser (T10)", () => {
  // Value: protects=each arm's output parses to its findings with native severity and confirmed kept, empty is a real zero, missing and malformed are flagged apart; fails_when=a malformed block counts as no findings, the parser reads an earlier block, or confirmation or a native label is lost; why_new=GEVA-70 build step 2 (T10 golden fixtures); seam=parseFinalTurn; no_claim=what each arm really prints, which the pilot checks
  for (const [name, want] of Object.entries(expected)) {
    test("golden: " + name, () => {
      const got = parseFinalTurn(readFileSync(join(DIR, name), "utf8"));
      if (want.kind === "malformed") {
        expect(got.kind).toBe("malformed");
        expect((got as { reason: string }).reason.length).toBeGreaterThan(0);
      } else expect(got).toEqual(want as never);
    });
  }

  // Value: protects=a session that did not complete is incomplete, never zero findings; fails_when=a timeout or cap stop scores as an empty review; why_new=GEVA-70 (T10); seam=parseFindings; no_claim=none
  test("incomplete sessions and labels", () => {
    expect(parseFindings({ termination: { kind: "timeout" }, turns: ["```json\n[]\n```"] }).kind).toBe("incomplete");
    expect(parseFindings({ termination: { kind: "completed" }, turns: [] }).kind).toBe("incomplete");
    expect(outcomeLabel(parseFinalTurn("```json\n[]\n```"))).toBe("empty");
    expect(outcomeLabel(parseFinalTurn(readFileSync(join(DIR, "missing.md"), "utf8")))).toBe("missing");
  });

  // Value: protects=rendered lines carry only contract fields plus evidence and confirmed, with repo-relative paths, and a confirmation becomes the reader, so severity_map.by_reader can map unconfirmed findings as informational (the plan's primary map for pstack); fails_when=an absolute work path reaches the arm, the claim is not the summary, or the contract cannot tell a confirmed finding from an unconfirmed one; why_new=GEVA-70; seam=renderFindings; no_claim=judge-packet's own masking
  test("rendering to arm contract v1", () => {
    const parsed = parseFinalTurn(readFileSync(join(DIR, "pstack.md"), "utf8"));
    if (parsed.kind !== "findings") throw new Error("pstack fixture did not parse");
    expect(renderFindings(parsed.findings, 2, "/work/gstack-7-0000000")).toEqual([
      { severity: "high", path: "src/cache.ts", line: 88, summary: "Two tasks with the same name share a cache entry across runs.", pass: 2, id: "p2-1", evidence: "A script that ran both tasks printed the same key twice.", confirmed: true, reader: "confirmed" },
      { severity: "medium", path: "src/timeout.ts", line: 12, summary: "The timeout may fire before the child process starts.", pass: 2, id: "p2-2", evidence: "Read of the code; a rerun with a slow start did not show it.", confirmed: false, reader: "unconfirmed" },
    ]);
    const lines = renderFindings(parsed.findings, 2, "/work/gstack-7-0000000");
    const arm = { severity_map: { default: { high: "CRITICAL", medium: "CRITICAL" }, by_reader: { unconfirmed: { high: "INFORMATIONAL", medium: "INFORMATIONAL" } } } } as unknown as ArmJson;
    expect(lines.map((l) => mapSeverity(arm, rawLabel(l), (l.reader as string | undefined) ?? null))).toEqual(["CRITICAL", "INFORMATIONAL"]);
    expect(renderFindings([{ file: "/etc/passwd", line: 1, severity: "high", claim: "c", evidence: "e" }], 1, "/work/x")[0]).toMatchObject({ path: null, raw_path: "/etc/passwd" });
  });
});
