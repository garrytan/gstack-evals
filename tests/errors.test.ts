import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CODES, docAnchor, isReasonCode, type CodeInfo, type ReasonCode } from "../src/errors/codes.ts";
import { ERRORS_DOC, renderErrorsDoc } from "../src/errors/doc.ts";

// Every reason code named in plan v3.2 and interface v0.4. Codes never change and are never removed.
const PLANNED: Record<number | "warning", string[]> = {
  1: ["REGRESSION", "SAFETY", "WORSE", "MISS", "SAFETY_BREAK", "UNOPENED", "UNCOVERED_GATE_REMOVAL", "NOT_NONINFERIOR"],
  2: ["NOT_MEASURABLE", "MARGIN_NOT_ATTEMPTED", "CAP_STOP", "UPSTREAM", "TIMEOUTS", "JUDGE_UNAVAILABLE", "LOCK_MISSING", "LOCK_DRIFT", "E_USAGE", "E_KEY_MISSING", "E_KEY_REJECTED", "E_LEDGER_MISSING", "E_LEDGER_PATH", "E_LEASE_UNSETTLED", "E_APPROVAL_RECORD", "E_CAP_TOO_LOW", "E_USER_TURNS_MISSING", "E_INTERACTIVE_HOST", "E_LOOSE_GSTACK", "VACUOUS_CHECK", "E_ISOLATION_UNSAFE", "E_CACHE_STALE", "E_NOT_RESUMABLE", "E_SLOT_DENIED", "E_ALLOWANCE", "E_IMAGE_BUILD", "E_USERSIM", "E_VERIFIER", "E_INTERNAL", "E_TOKENS_COVERAGE"],
  3: ["CALIBRATION_SKILL", "CALIBRATION_NONE_LEAK", "CALIBRATION_SHELL", "CALIBRATION_CONFIG", "CALIBRATION_USERSIM", "CALIBRATION_EGRESS"],
  warning: ["DEGRADED", "FLAKY", "FLAKY_SAFETY", "CEILING", "NONE_MATCHES", "BROKEN_TASK", "REPLY_MISALIGNED", "NEGATIVE_UNVALIDATED"],
};

// Interface v0.4, "Resume and repair": terminal stops print "do not --resume" and --resume refuses them.
const TERMINAL = ["NOT_MEASURABLE", "MARGIN_NOT_ATTEMPTED", "VACUOUS_CHECK", "LOCK_MISSING", "LOCK_DRIFT", "E_USER_TURNS_MISSING", "E_INTERACTIVE_HOST", "E_LOOSE_GSTACK"];

const entries = Object.entries(CODES) as [ReasonCode, CodeInfo][];

describe("reason-code registry", () => {
  test("holds every planned code at its planned exit", () => {
    for (const [exit, codes] of Object.entries(PLANNED)) {
      for (const code of codes) {
        expect(isReasonCode(code)).toBe(true);
        expect(String(CODES[code as ReasonCode].exit ?? "warning")).toBe(exit);
      }
    }
  });

  test("every entry is complete and plainly written", () => {
    for (const [code, info] of entries) {
      expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
      expect(info.owner).toMatch(/^U([1-9]|1[0-8]|20)$/);
      const texts = [info.meaning, info.fix, ...(info.exit === null ? [] : [info.side_effects])];
      for (const text of texts) {
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toContain("\u2014");
      }
    }
  });

  test("terminal stops are not resumable and say so", () => {
    for (const code of TERMINAL) {
      const info = CODES[code as ReasonCode];
      expect(info.exit).toBe(2);
      if (info.exit === null) continue;
      expect(info.resumable).toBe(false);
      expect(info.fix).toContain("Do not --resume");
    }
  });

  test("resumable stops follow the plan", () => {
    for (const code of ["CAP_STOP", "UPSTREAM", "TIMEOUTS", "E_KEY_REJECTED", "E_LEASE_UNSETTLED", "E_INTERNAL"] as const) {
      expect(CODES[code].resumable).toBe(true);
    }
    expect(CODES.E_LEASE_UNSETTLED.side_effects).toStartWith("Partial");
    expect(CODES.E_LEASE_UNSETTLED.fix).toContain("gstack-evals ledger settle --lease <id>");
  });

  test("anchors match the generated doc's headings", () => {
    const doc = renderErrorsDoc();
    for (const [code] of entries) {
      expect(docAnchor(code)).toBe("docs/errors.md#" + code.toLowerCase());
      expect(doc).toContain("\n### " + code + "\n");
    }
  });

  test("docs/errors.md is fresh", () => {
    expect(readFileSync(ERRORS_DOC, "utf8")).toBe(renderErrorsDoc());
  });

  test("E_OUTCOME_CLEAN_ROOM's doc entry names the settings and agents scans, the paths present at all and the image-digest refusal, with a fix for it", () => {
    const doc = readFileSync(ERRORS_DOC, "utf8");
    const entry = doc.slice(doc.indexOf("\n### E_OUTCOME_CLEAN_ROOM\n"), doc.indexOf("\n### ", doc.indexOf("\n### E_OUTCOME_CLEAN_ROOM\n") + 1));
    for (const words of [".claude/settings.json", ".claude/settings.local.json", ".claude/agents", "CLAUDE.local.md", ".mcp.json", "~/.claude.json", "/etc/claude-code", "docker image inspect --format '{{.Id}}'", "pull or load it by digest"]) expect([words, entry.includes(words)]).toEqual([words, true]);
  });
});
