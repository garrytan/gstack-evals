// closeOpenSessions (src/runner/ledger/sessions.ts): the close lines every settle path of a driver's lease writes to its
// run directory's sessions.jsonl (GST-1433).
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LeaseFile } from "../../src/runner/ledger/record.ts";
import { closeOpenSessions } from "../../src/runner/ledger/sessions.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const at = new Date("2026-11-05T12:00:00.000Z");
const lease = (dir: string, lease_id = "i-pe.0001.aaaaaa"): LeaseFile => ({ schema: 1, kind: "lease", item: "i-pe", seq: 1, lease_id, run_id: "r1", machine_id: "m1", holder: { dir, nonce: "0123456789abcdef" }, reserved_micros: 1, expires_at: at.toISOString(), created_at: at.toISOString() });
const figures = (meter_id: string) => ({ spent_micros: 0, unknown_micros: meter_id === "m-a" ? 7 : 0, unknown_calls: meter_id === "m-a" ? 1 : 0 });
const read = (dir: string) => readFileSync(join(dir, "sessions.jsonl"), "utf8");
const lines = (dir: string) => read(dir).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

function runDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sessions-"));
  dirs.push(dir);
  writeFileSync(join(dir, "sessions.jsonl"), [
    { run_id: "r1", event: "launch", nonce: "0123456789abcdef" },
    { run_id: "r1", event: "open", id: "ses_a", item: "i-pe", lease_id: "i-pe.0001.aaaaaa", meter_id: "m-a" },
    { run_id: "r1", event: "open", id: "ses_b", item: "i-pe", lease_id: "i-pe.0001.aaaaaa", meter_id: "m-b" },
    { run_id: "r1", event: "close", id: "ses_b", item: "i-pe", lease_id: "i-pe.0001.aaaaaa", meter_id: "m-b", reason: "agent_finished", unknown_calls: 0, unknown_micros: 0 },
    { run_id: "r1", event: "open", id: "ses_c", item: "i-pe", lease_id: "i-pe.0002.bbbbbb", meter_id: "m-c" },
    { run_id: "r0", event: "open", id: "ses_d", item: "i-pe", lease_id: "i-pe.0001.aaaaaa", meter_id: "m-d" },
  ].map((l) => JSON.stringify(l) + "\n").join(""));
  return dir;
}

describe("closeOpenSessions", () => {
  test("closes only the lease's sessions of the lease's run that have no close line, with the figures and reason given, and a retry writes none", () => {
    const dir = runDir();
    expect(closeOpenSessions(lease(dir), "settled", figures, at)).toBe(1);
    const closes = lines(dir).filter((e) => e.event === "close");
    expect(closes.map((e) => e.id)).toEqual(["ses_b", "ses_a"]);
    expect(closes[1]).toEqual({ at: at.toISOString(), run_id: "r1", event: "close", item: "i-pe", id: "ses_a", reason: "settled", lease_id: "i-pe.0001.aaaaaa", meter_id: "m-a", spent_micros: 0, unknown_micros: 7, unknown_calls: 1 });
    const before = read(dir);
    expect(closeOpenSessions(lease(dir), "settled", figures, at)).toBe(0);
    expect(read(dir)).toBe(before);
  });

  test("a last line a killed writer cut short stays apart: the close lines start on a fresh line", () => {
    const dir = runDir();
    appendFileSync(join(dir, "sessions.jsonl"), '{"run_id":"r1","event":"op');
    expect(closeOpenSessions(lease(dir), "recovered", figures, at)).toBe(1);
    const tail = read(dir).split("\n").filter(Boolean).at(-1)!;
    expect(JSON.parse(tail)).toMatchObject({ event: "close", id: "ses_a", reason: "recovered" });
  });

  test("with no figures it writes nothing, answering null while a session is open and 0 once none is", () => {
    const dir = runDir();
    const before = read(dir);
    expect(closeOpenSessions(lease(dir), "settled", null, at)).toBeNull();
    expect(read(dir)).toBe(before);
    expect(closeOpenSessions(lease(dir), "settled", figures, at)).toBe(1);
    expect(closeOpenSessions(lease(dir), "settled", null, at)).toBe(0);
  });

  test("answers null when the lease names no holder or its run directory holds no sessions.jsonl", () => {
    const dir = runDir();
    const { holder: _, ...unheld } = lease(dir);
    expect(closeOpenSessions(unheld, "settled", figures, at)).toBeNull();
    expect(closeOpenSessions(lease(join(dir, "gone")), "settled", figures, at)).toBeNull();
  });
});
