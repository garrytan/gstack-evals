// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=ohr rescreen (the second attempt's pre-run change 5): authoring's vocabulary check over a briefs directory, its verdicts with counts and file names and never text, its refusals, and the screen it builds from the pins
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { BriefFiles } from "../../../lanes/office-hours-rewrite/author/files.ts";
import { FIXTURE_SCREEN, T7, T8 } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { rescreen } from "../../../lanes/office-hours-rewrite/author/screens.ts";
import { main } from "../../../lanes/office-hours-rewrite/cli.ts";
import { PINS } from "../../../lanes/office-hours-rewrite/frozen.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const BARRED = " Which neighbor would lend you a hand?";
const io = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
};

function briefsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ohr-rescreen-"));
  const put = (id: string, b: BriefFiles) => {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, "opening.md"), b.opening + "\n");
    writeFileSync(join(dir, id, "sheet.json"), JSON.stringify(b.sheet, null, 2) + "\n");
    writeFileSync(join(dir, id, "key.json"), JSON.stringify(b.key, null, 2) + "\n");
    if (b.prior) writeFileSync(join(dir, id, "prior.json"), JSON.stringify(b.prior, null, 2) + "\n");
    writeFileSync(join(dir, id, "brief.json"), JSON.stringify({ id }) + "\n");
  };
  put("a-clean", T7);
  put("b-sequence", { ...T7, opening: T7.opening + BARRED });
  put("c-term", { ...T8, prior: { ...T8.prior!, test: "check the status quo" } });
  mkdirSync(join(dir, "not-a-brief"));
  return dir;
}

describe("ohr rescreen", () => {
  test("each brief passes, or fails the vocabulary check with its counts and the files that hold a hit", () => {
    const r = rescreen(FIXTURE_SCREEN, briefsDir());
    expect(r.map((x) => x.id)).toEqual(["a-clean", "b-sequence", "c-term"]);
    expect(r[0]).toEqual({ id: "a-clean", pass: true, sequences: 0, terms: 0, files: [] });
    expect(r[1]).toMatchObject({ pass: false, terms: 0, files: ["opening.md"] });
    expect(r[1]!.sequences).toBeGreaterThan(0);
    expect(r[2]).toMatchObject({ pass: false, sequences: 0, files: ["prior.json"] });
    expect(r[2]!.terms).toBeGreaterThan(0);
  });

  test("it needs both flags and refuses a briefs directory inside the repository", async () => {
    const a = io();
    expect(await main(["rescreen", "--briefs-dir", briefsDir()], a.io, {})).toBe(2);
    expect(a.err.join("\n")).toMatch(/^E_USAGE .*needs --gstack/);
    const b = io();
    expect(await main(["rescreen", "--briefs-dir", join(REPO, "briefs"), "--gstack", "g"], b.io, {})).toBe(2);
    expect(b.err.join("\n")).toContain("is inside the repository");
  });

  const CLONE = process.env.GSTACK_OHR_CLONE || join(homedir(), ".capy", "work", "gstack");
  const has = (sha: string) => spawnSync("git", ["-C", CLONE, "cat-file", "-e", sha + "^{commit}"]).status === 0;
  const ready = has(PINS.current!.sha) && has(PINS.new!.sha);
  if (!ready) console.log("SKIP tests/ohr/author/rescreen.test.ts pin check: no gstack clone holding both pins at " + CLONE);
  test.skipIf(!ready)("from a clone holding both pins, the screen is change 5's: 185 sequences with its digest, and no brief text is printed", async () => {
    const t = io();
    const code = await main(["rescreen", "--briefs-dir", briefsDir(), "--gstack", CLONE], t.io, {});
    const out = t.out.join("\n");
    expect(t.out[0]).toBe("ohr rescreen: the screen holds 185 five-word sequences, sha256 fe1ad3549f78a167afa632d6fff60e7e36756bc8543490ab712d3031dae34386, from 85867942:office-hours/sections/phase-2a-startup-diagnostic.md, 8fcca8a5:office-hours/sections/phase-2a-startup-diagnostic.md, 8fcca8a5:office-hours/sections/phase-2c-pivot-discovery.md");
    for (const l of t.out.slice(1, -1)) expect(l).toMatch(/^[a-z-]+ (pass|fail vocabulary: barred sequences \d+, named terms \d+, in [a-z.]+(, [a-z.]+)*)$/);
    expect(t.out).toContain("c-term fail vocabulary: barred sequences 0, named terms 1, in prior.json");
    expect(t.out.at(-1)).toMatch(/^ohr rescreen: 3 briefs, \d pass, \d fail$/);
    expect(out).not.toContain(T7.opening.slice(0, 30));
    expect(out).not.toContain("status quo");
    expect(code).toBe(2);
  });
});
