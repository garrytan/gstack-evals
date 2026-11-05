// Binding item 1: a stage 1 stop that only the judges' unjudged rem cause must not print as a plain CEILING.
// It runs the stop-label amendment's ceo-rule.ts.txt (wiki/plans/2026-11-05-geva-300-ceo-stop-label-amendment) the way
// that post's dry run does: the attachment copied to a temp dir as ceo-rule.ts, run with bun and GSTACK_EVALS_SCORER set to
// this checkout, with no key in the environment.
// The two readings are the dry run's case A (4 keyed hits with an unjudged rem: G_R on the judged readings is in band,
// but out of band with the 4 rems scored yes) and case B (4 keyed hits at rank 2 with an unjudged rem: strict10 on the
// judged readings is saturated, but in band with the 4 rems scored no). They are synthetic, written by the dry run's own
// generator; each row's issues and fixes are left out of the files and rebuilt here from words and fix_words, as the dry
// run's fill() builds them.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const SCORER = join(ROOT, "wiki/plans/2026-11-05-geva-300-ceo-stop-label-amendment/ceo-rule.ts.txt");
const DIR = mkdtempSync(join(tmpdir(), "ceo-stop-label-"));
copyFileSync(SCORER, join(DIR, "ceo-rule.ts"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER)_API_KEY$/.test(k))) as Record<string, string>;
const words = (ns: number[]) => ns.map((n) => Array(Math.min(40, n)).fill("word").join(" "));
const readings = (name: string) => {
  const d = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/ceo-stop-label", name + ".json"), "utf8"));
  for (const r of d.reviews) {
    r.issues = words(r.words);
    r.fixes = words(r.fix_words);
  }
  return d;
};
const run = (cmd: string, data: unknown, tag: string) => {
  const f = join(DIR, tag + ".json");
  writeFileSync(f, JSON.stringify(data));
  const r = spawnSync("bun", [join(DIR, "ceo-rule.ts"), cmd, f], { encoding: "utf8", env: { ...KEYLESS, GSTACK_EVALS_SCORER: ROOT } });
  expect(r.status).toBe(0);
  return r.stdout.split("\n");
};
const line = (out: string[], prefix: string) => out.find((l) => l.startsWith(prefix));

describe("case A: the fallback holds on judged rem and fails only with the 4 unjudged rem scored yes", () => {
  const a = readings("case-a");
  test("headroom prints JUDGE WAIT, still names a CEILING that doesn't fall back, and keeps every other stop line", () => {
    const out = run("headroom", a, "a-headroom");
    expect(line(out, "Verdict: ")).toBe("Verdict: JUDGE WAIT (a CEILING that doesn't fall back; CEILING on hit@3, 34 of 48 = 0.708 > 0.60; the fallback holds on judged rem and fails only with the 4 unjudged rem scored yes): stop, FIX-METHOD (judge)");
    expect(line(out, "10x reading: ")).toBe("10x reading: FIX-METHOD (judge), never saturation: 4 unjudged rem decide the reading (left out: G_R 0.498, strict10 0.159; scored yes: G_R 0.519, strict10 0.146; scored no: G_R 0.498, strict10 0.146)");
    expect(line(out, "Stage 2: ")).toBe("Stage 2: does not start");
  });
  test("projection's Primary line names stage 1 JUDGE WAIT", () => {
    const out = run("projection", { envelope: 1410, changed: 48, held: 16, stage1_judges: 4.7, untested: [], stage1: a }, "a-projection");
    expect(line(out, "Primary: ")).toBe("Primary: none (stage 1 JUDGE WAIT); stage 2 does not start");
  });
});

describe("case B: the judged readings are saturated, and the unjudged rem decide only the 10x reading", () => {
  test("headroom keeps the CEILING verdict and says the judged readings decide it", () => {
    const out = run("headroom", readings("case-b"), "b-headroom");
    expect(line(out, "Verdict: ")).toBe("Verdict: CEILING (34 of 48 = 0.708 > 0.60): stop");
    expect(line(out, "10x reading: ")).toBe("10x reading: FIX-METHOD (judge), never saturation: the judged readings decide the CEILING (left out: G_R 0.500, strict10 0.205, saturated); the 4 unjudged rem decide only whether the 10x reading is a saturation stop (scored yes: G_R 0.521, strict10 0.188; scored no: G_R 0.500, strict10 0.188)");
    expect(line(out, "Stage 2: ")).toBe("Stage 2: does not start");
  });
});
