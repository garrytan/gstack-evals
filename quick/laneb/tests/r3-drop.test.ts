// R3's drop list (Captain ruling on GEVA-177's finding, GST-941), keyless: a dropped task never reaches the screen's
// planned tasks or its coverage, a list off its pinned sha256 is refused, and an empty list is today's band exactly. The
// band file, its sha256 and the seed-20261101 pilot draw don't move.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadR3Drops, loadSwebvTasks, R3_BAND_SHA256, R3_DROP_FILE, R3_DROP_SHA256, type R3Drop } from "../runner/materialize.ts";
import { bandIds, coverage, pilotTasks, screenIds } from "../r3/screen.ts";

const laneb = join(import.meta.dir, "..");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const digest = (c: string) => "sha256:" + c.repeat(64);
// A fixture list: the two tasks Harbor's SWE-bench adapter README (f3a5a92) lists as failing with the Oracle agent.
const FIXTURE: R3Drop[] = [
  { task_id: "django__django-10097", reason: "fixture: fails its own reference solution", evidence_digest: digest("a") },
  { task_id: "sphinx-doc__sphinx-9711", reason: "fixture: fails its own reference solution", evidence_digest: digest("b") },
];
function list(tasks: unknown[], band = R3_BAND_SHA256) {
  const path = join(mkdtempSync(join(tmpdir(), "r3-drop-")), "drop.json");
  writeFileSync(path, JSON.stringify({ band_sha256: band, tasks }));
  return { path, sha256: sha(readFileSync(path)) };
}
const trial = (task: string, model = "claude-opus-5-5") => ({ task, arm: "none", model, trial: task + "__1" }) as any;

describe("R3's drop list", () => {
  test("the committed list hashes to its pin and drops band tasks only", () => {
    expect(sha(readFileSync(join(laneb, R3_DROP_FILE)))).toBe(R3_DROP_SHA256);
    const drops = loadR3Drops(join(laneb, R3_DROP_FILE), R3_DROP_SHA256, bandIds());
    for (const d of drops) expect(bandIds()).toContain(d.task_id);
    expect(screenIds()).toEqual(bandIds().filter((id) => !drops.some((d) => d.task_id === id)));
  });

  test("a dropped task never reaches the screen's planned tasks or its coverage; the band and the pilot draw stay as they were", () => {
    const f = list(FIXTURE);
    const drops = loadR3Drops(f.path, f.sha256, bandIds());
    expect(drops).toEqual(FIXTURE);
    const screen = screenIds(drops);
    expect(screen).toHaveLength(91);
    expect(screen).toEqual(bandIds().filter((id) => id !== "django__django-10097" && id !== "sphinx-doc__sphinx-9711"));
    expect(sha(readFileSync(join(laneb, "tasks/swebv-r3.txt")))).toBe(R3_BAND_SHA256);
    expect(bandIds()).toHaveLength(93);
    expect(pilotTasks(bandIds())).toEqual(["scikit-learn__scikit-learn-14087", "sympy__sympy-15599", "sphinx-doc__sphinx-8056", "django__django-15973", "matplotlib__matplotlib-25960", "django__django-12406", "sphinx-doc__sphinx-8548", "sympy__sympy-22456", "django__django-15572", "pytest-dev__pytest-7490"]);
    const ran = screen.map((t) => trial(t));
    expect(coverage(ran, screen, "none")).toBeNull();
    expect(coverage([...ran, trial("django__django-10097")], screen, "none")).toBe("1 trials outside the plan (django__django-10097__1)");
  });

  test("a list off its pinned sha256, off R3's band, or with a bad entry is refused", () => {
    const f = list(FIXTURE);
    const other = sha(Buffer.from("other bytes"));
    expect(() => loadR3Drops(f.path, other, bandIds())).toThrow(`${f.path}: sha256 ${f.sha256} is not the pinned ${other}`);
    const bad: [unknown[], string, string?][] = [
      [[{ ...FIXTURE[0], task_id: "not__a-task" }], "not__a-task is not a band task"],
      [[FIXTURE[0], FIXTURE[0]], "django__django-10097 is listed twice"],
      [[{ ...FIXTURE[0], reason: " " }], "django__django-10097 has no reason"],
      [[{ ...FIXTURE[0], evidence_digest: "abc" }], "django__django-10097's evidence_digest is not sha256:<64 hex>"],
      [FIXTURE, "band_sha256 " + "0".repeat(64) + " is not " + R3_BAND_SHA256, "0".repeat(64)],
    ];
    for (const [tasks, msg, band] of bad) {
      const b = list(tasks, band);
      expect(() => loadR3Drops(b.path, b.sha256, bandIds())).toThrow(msg);
    }
  });

  test("an empty list is today's band exactly", () => {
    const f = list([]);
    const drops = loadR3Drops(f.path, f.sha256, bandIds());
    expect(drops).toEqual([]);
    expect(screenIds(drops)).toEqual(bandIds());
    expect(screenIds(drops)).toEqual(loadSwebvTasks(join(laneb, "tasks/swebv-r3.txt"), join(laneb, "tasks/swebv-r3.json"), R3_BAND_SHA256).map((t) => t.task_id));
  });
});
