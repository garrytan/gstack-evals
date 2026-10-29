import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { errorLines, errorRecord, SECRET_PATTERNS, writeErrorRecord } from "../../src/skill-eval/verdict/error-record.ts";
import type { ErrorContext } from "../../src/types.ts";

const tmp = mkdtempSync(join(tmpdir(), "verdict-error-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const context: ErrorContext = { resource_ids: { task: "stats" }, gstack_evals_version: "0.0.1", host: "claude", host_version: "2.1.0", image_digest: null, policy_sha256: null, ledger: null, ledger_record: null, env_names: ["ANTHROPIC_API_KEY"] };
const KEYS = ["schema_version", "code", "operation", "role", "model", "message", "cause", "context", "fix", "doc", "side_effects", "retry", "resumable", "correlation_id", "trace"];
const FAKE_KEY = "fake-anthropic-value-0123456789";
const env = { ANTHROPIC_API_KEY: FAKE_KEY, HOME: "/home/u" };
const stops = (Object.keys(CODES) as ReasonCode[]).filter((c) => CODES[c].exit !== null);

describe("the versioned error record", () => {
  test("every stop code's record carries every field, from the code's entry, and passes the secret scan", () => {
    for (const code of stops) {
      const info = CODES[code] as { fix: string; side_effects: string; retry_safe: boolean; resumable: boolean };
      const cause = new Error("upstream said: Bearer abcdefghijklmnop1234 with key " + FAKE_KEY + " sk-ant-api03-abcdefghij");
      const record = errorRecord({ code, operation: "trial", message: "failed with " + FAKE_KEY, cause, context }, env);
      expect(Object.keys(record)).toEqual(KEYS);
      expect([record.fix, record.side_effects, record.resumable, record.retry.safe, record.doc]).toEqual([info.fix, info.side_effects, info.resumable, info.retry_safe, docAnchor(code)]);
      const text = JSON.stringify(record);
      expect(text).not.toContain(FAKE_KEY);
      for (const pattern of SECRET_PATTERNS) expect(pattern.test(text)).toBe(false);
      expect(record.cause!.message).toStartWith("upstream said: [scrubbed] with key [scrubbed ANTHROPIC_API_KEY] [scrubbed]");
    }
  });

  test("warnings are not errors, and the cause's code comes from the error", () => {
    expect(() => errorRecord({ code: "CEILING", operation: "verdict", message: "x", context })).toThrow("is a warning");
    const coded = Object.assign(new Error("refused"), { code: "E_SLOT_DENIED" });
    expect(errorRecord({ code: "E_SLOT_DENIED", operation: "trial", message: "m", cause: coded, context }).cause!.code).toBe("E_SLOT_DENIED");
    expect(errorRecord({ code: "UPSTREAM", operation: "trial", message: "m", cause: new Error("UPSTREAM: 529 overloaded"), context }).cause!.code).toBe("UPSTREAM");
    expect(errorRecord({ code: "E_INTERNAL", operation: "verdict", message: "m", cause: new TypeError("x is undefined"), context }).cause!.code).toBe("TypeError");
  });

  test("an unexpected error gets a correlation id, and stderr mirrors the record line by line under its code", () => {
    const record = errorRecord({ code: "E_INTERNAL", operation: "verdict", message: "first\nsecond", cause: "boom", context, trace: "/out/trace.txt" });
    expect(record.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    const lines = errorLines(record);
    expect(lines.every((l) => l.startsWith("E_INTERNAL "))).toBe(true);
    expect(lines.slice(0, 3)).toEqual(["E_INTERNAL first", "E_INTERNAL second", "E_INTERNAL cause: Error: boom"]);
    expect(lines.map((l) => l.split(" ")[1])).toEqual(["first", "second", "cause:", "context:", "fix:", "docs:", "correlation:"]);
  });

  test("the record goes to <out>/error.json, or to stdout when out is missing or unwritable", () => {
    const record = errorRecord({ code: "CAP_STOP", operation: "run", message: "cap", context });
    const path = writeErrorRecord(join(tmp, "out"), record)!;
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
    const printed: string[] = [];
    const blocker = join(tmp, "file");
    writeFileSync(blocker, "");
    expect(writeErrorRecord(join(blocker, "out"), record, (t) => printed.push(t))).toBeNull();
    expect(writeErrorRecord(null, record, (t) => printed.push(t))).toBeNull();
    expect(printed.map((t) => JSON.parse(t))).toEqual([record, record]);
  });
});
