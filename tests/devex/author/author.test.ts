// Copyright (c) 2026 Garry Tan. MIT License.
// The authoring part (devex prereg 2026-11-09-geva-417, sections 3, 4, 11 and 15 rule 4): its dry-run lines, the pinned
// prompts and term list, and dx sets end to end on fixtures through the metered client on a temporary ledger with a fake
// upstream. Keyless; nothing leaves the process.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { checks, fakeAnswer, fixtureFunnelUnit } from "../../../lanes/devex/author/checks.ts";
import { DRY_ENV, fakeModels } from "../../../lanes/devex/author/fake.ts";
import * as P from "../../../lanes/devex/author/prompts.ts";
import { DX_TERMS_SHA256, loadsDx, termsDigest } from "../../../lanes/devex/author/scope.ts";
import { run as setsRun, type Reading } from "../../../lanes/devex/author/sets.ts";

const PREREG = join(import.meta.dir, "../../../wiki/plans/2026-11-09-geva-417-devex-review-intentions-prereg/README.md");

describe("dry-run lines", () => {
  test("every authoring line passes", async () => {
    const lines = await checks();
    expect(lines.filter((l) => !l.pass).map((l) => l.rule + ": " + l.detail)).toEqual([]);
    expect(lines.length).toBe(16);
  }, 60_000);
});

describe("frozen inputs", () => {
  test("every authoring prompt matches its pin, and the rewrite is section 4's frozen prompt verbatim", () => {
    expect(P.unpinned()).toEqual([]);
    expect(readFileSync(PREREG, "utf8")).toContain("> " + P.REWRITE + "\n");
  });
  test("the vendored DX term list matches its pin, and the scope detector needs 2 matches", () => {
    expect(termsDigest()).toBe(DX_TERMS_SHA256);
    expect(loadsDx("The team will add a CLI flag.")).toBe(true);
    expect(loadsDx("The team will add a CLI.")).toBe(false);
    expect(loadsDx("## Review record\nCLI flag")).toBe(null);
  });
});

describe("dx sets on fixtures", () => {
  const unit = (dir: string, id: string, marker: string, o: { candidates?: number; release?: string } = {}) => {
    const f = { ...fixtureFunnelUnit(id, marker, o.candidates ?? 1), ...(o.release ? { release_at: o.release } : {}) };
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "funnel.json"), JSON.stringify(f));
    writeFileSync(join(dir, id, "alias.json"), JSON.stringify({ entries: [{ original: "zorbit", alias: "quentra", kind: "project" }], kept: [] }));
  };

  test("calibration fills, writes the reading once, and the comparison walk stops under rule 3", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dx-sets-test-"));
    try {
      const record = join(dir, "record"), units = join(dir, "units"), work = join(dir, "work");
      recordApproval(record, { action: "init", item: "dx-auth-test", cap_micros: 50_000_000, quotes: [{ words: "test", by: "test", source: "test" }], admission: "warn" });
      for (let i = 0; i < 16; i++) unit(units, "c" + String(i).padStart(2, "0") + "k", "UNIT-KEYED");
      for (let i = 0; i < 3; i++) unit(units, "c" + String(i).padStart(2, "0") + "s", "UNIT-SCREEN-NEG", { candidates: 0 });
      for (let i = 0; i < 3; i++) unit(units, "c" + String(i).padStart(2, "0") + "t", "UNIT-TRIAGE-NEG");
      for (let i = 0; i < 3; i++) unit(units, "z" + i, "UNIT-KEYED", { release: "2026-09-20T00:00:00Z" });
      const over = { record, ledger: join(dir, "ledger.sqlite"), env: DRY_ENV, fetch: fakeModels(fakeAnswer) };
      const out: string[] = [];
      const io = { out: (t: string) => out.push(t), err: () => {} };
      const base = ["--units", units, "--work", work, "--item", "dx-auth-test", "--now", "2026-11-09T00:00:00Z"];
      expect(await setsRun(["calibration", ...base, "--other-usd", "1000", "--stage2-unit-usd", "22"], io, over)).toBe(0);
      const reading = JSON.parse(readFileSync(join(work, "reading.json"), "utf8")) as Reading;
      expect([reading.draws, reading.keyed, reading.screen_positive, reading.flagged, reading.miss.screen.units, reading.miss.triage.units]).toEqual([22, 16, 19, 16, 3, 3]);
      expect(reading.size_rule.size).toBe(64);
      expect(reading.dx_scope.rate).toBe(1);
      expect(out.join("\n")).not.toMatch(/zorbit|quentra|Windows/i);
      const again = await setsRun(["calibration", ...base, "--other-usd", "1000", "--stage2-unit-usd", "22"], io, over).catch((e) => e.code);
      expect(again).toBe("E_USAGE");
      const cmp = await setsRun(["comparison", ...base], io, over).catch((e) => e.code);
      expect(cmp).toBe("E_DX_SUPPLY_SHORT");
      expect(existsSync(join(work, "sets.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("calibration refuses to spend without a ledger item or projection inputs", async () => {
    const io = { out: () => {}, err: () => {} };
    expect(await setsRun(["calibration", "--units", "/nonexistent", "--work", "/nonexistent-w", "--other-usd", "1", "--stage2-unit-usd", "1"], io).catch((e) => e.code)).toBe("E_USAGE");
    expect(await setsRun(["calibration", "--units", "/nonexistent", "--work", "/nonexistent-w", "--item", "x"], io).catch((e) => e.code)).toBe("E_USAGE");
  });
});
