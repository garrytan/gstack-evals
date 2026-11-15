import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepEvidence, keepEvidenceDir } from "../../lanes/eng-build/evidence.ts";

const saved = process.env.EP_EVIDENCE;
afterEach(() => {
  if (saved === undefined) delete process.env.EP_EVIDENCE;
  else process.env.EP_EVIDENCE = saved;
});

describe("screen evidence", () => {
  test("writes a candidate's drop record and copies its run output under EP_EVIDENCE", () => {
    const root = mkdtempSync(join(tmpdir(), "ev-"));
    const src = join(root, "src");
    mkdirSync(src);
    writeFileSync(join(src, "merged.log"), "case a: no result\n");
    process.env.EP_EVIDENCE = join(root, "ev");
    keepEvidence("u1", "drop.json", { step: "screen", reason: "merged:no_per_case_result" });
    keepEvidence("u1", "note.txt", "plain");
    keepEvidence("u1", "recount-out/merged/run1-record.jsonl", "{}\n");
    keepEvidenceDir("u1", "screen-out", src);
    keepEvidenceDir("u1", "missing", join(root, "nope"));
    expect(JSON.parse(readFileSync(join(root, "ev/u1/drop.json"), "utf8"))).toEqual({ step: "screen", reason: "merged:no_per_case_result" });
    expect(readFileSync(join(root, "ev/u1/note.txt"), "utf8")).toBe("plain");
    expect(readFileSync(join(root, "ev/u1/screen-out/merged.log"), "utf8")).toBe("case a: no result\n");
    expect(existsSync(join(root, "ev/u1/missing"))).toBe(false);
    expect(readFileSync(join(root, "ev/u1/recount-out/merged/run1-record.jsonl"), "utf8")).toBe("{}\n");
    rmSync(root, { recursive: true, force: true });
  });

  test("keeps nothing when EP_EVIDENCE is unset", () => {
    const root = mkdtempSync(join(tmpdir(), "ev-"));
    delete process.env.EP_EVIDENCE;
    keepEvidence("u2", "drop.json", { step: "body" });
    keepEvidenceDir("u2", "screen-out", root);
    expect(existsSync(join(root, "u2"))).toBe(false);
    expect(existsSync(join(process.cwd(), "u2"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
