// R3's drop list (Captain ruling on GEVA-177's finding, GST-941), keyless: GEVA-177's r3-drop-list.json as R3 amendment
// 3's drop-list.py.txt writes it. A dropped task never reaches the screen's planned tasks or its coverage, a list off its
// pinned sha256 is refused, and an empty list is today's band exactly. The band file, its sha256 and the seed-20261101
// pilot draw don't move.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadR3Drops, loadSwebvTasks, R3_BAND_SHA256, R3_DROP_FILE, R3_DROP_SHA256 } from "../runner/materialize.ts";
import { bandIds, coverage, pilotTasks, screenIds } from "../r3/screen.ts";

const laneb = join(import.meta.dir, "..");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const listing = (ids: string[]) => sha([...ids].sort().map((i) => i + "\n").join(""));
// A failed oracle pass for one task, shaped like drop-list.py.txt's verdict.
const failed = (task: string) => ({ result: "fail", kind: "reference fails", image: "img-" + task, pull: { status: "ok", tries: 1, repo_digest: "-", last_error: "" }, trials: [{ trial: task + "__a", reward: "0", exception: null, digests: { "verifier/reward.txt": sha(task) } }] });
const entry = (task: string) => ({ task, reason: "reference fails", pass1: failed(task), pass2: failed(task) });
// A fixture list: the two tasks Harbor's SWE-bench adapter README (f3a5a92) lists as failing with the Oracle agent.
const FIXTURE = [entry("django__django-10097"), entry("sphinx-doc__sphinx-9711")];
function list(dropped: any[], over: Record<string, unknown> = {}) {
  const ids = dropped.map((d) => d.task);
  const kept = bandIds().filter((id) => !ids.includes(id));
  const doc = { band_file_sha256: R3_BAND_SHA256, band_size: 93, rule: "fixture", passes: [], dropped, dropped_ids_sha256: listing(ids), kept_size: kept.length, kept_ids_sha256: listing(kept), pilot_tasks: pilotTasks(bandIds()), pilot_dropped: [], ...over };
  const path = join(mkdtempSync(join(tmpdir(), "r3-drop-")), "drop.json");
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  return { path, sha256: sha(readFileSync(path)) };
}
const trial = (task: string, model = "claude-opus-5-5") => ({ task, arm: "none", model, trial: task + "__1" }) as any;

describe("R3's drop list", () => {
  test("the committed list hashes to its pin, drops band tasks only and none from the pilot draw", () => {
    const raw = readFileSync(join(laneb, R3_DROP_FILE));
    expect(sha(raw)).toBe(R3_DROP_SHA256);
    const drops = loadR3Drops(join(laneb, R3_DROP_FILE), R3_DROP_SHA256, bandIds());
    for (const d of drops) expect(bandIds()).toContain(d.task_id);
    expect(screenIds()).toEqual(bandIds().filter((id) => !drops.some((d) => d.task_id === id)));
    expect(JSON.parse(raw.toString("utf8")).pilot_tasks).toEqual(pilotTasks(bandIds()));
    for (const d of drops) expect(pilotTasks(bandIds())).not.toContain(d.task_id);
  });

  test("a dropped task never reaches the screen's planned tasks or its coverage; the band and the pilot draw stay as they were", () => {
    const f = list(FIXTURE);
    const drops = loadR3Drops(f.path, f.sha256, bandIds());
    expect(drops).toEqual(FIXTURE.map((d) => ({ task_id: d.task, reason: d.reason })));
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

  test("a list off its pinned sha256, off R3's band, with a bad entry, off its own digests, or dropping a pilot task is refused", () => {
    const f = list(FIXTURE);
    const other = sha("other bytes");
    expect(() => loadR3Drops(f.path, other, bandIds())).toThrow(`${f.path}: sha256 ${f.sha256} is not the pinned ${other}`);
    const off = (task: string) => ({ ...entry(task), pass2: { ...failed(task), result: "pass" } });
    const bad: [any[], string, Record<string, unknown>?][] = [
      [[entry("not__a-task")], "not__a-task is not a band task"],
      [[FIXTURE[0], FIXTURE[0]], "django__django-10097 is listed twice"],
      [[{ ...FIXTURE[0], reason: " " }], "django__django-10097 has no reason"],
      [[off("django__django-10097")], "django__django-10097 did not fail both oracle passes"],
      [FIXTURE, "band_file_sha256 " + "0".repeat(64) + " with band_size 93 is not R3's band", { band_file_sha256: "0".repeat(64) }],
      [FIXTURE, "with band_size 92 is not R3's band", { band_size: 92 }],
      [FIXTURE, "dropped_ids_sha256, kept_size or kept_ids_sha256 does not match its dropped tasks", { dropped_ids_sha256: listing([]) }],
      [FIXTURE, "dropped_ids_sha256, kept_size or kept_ids_sha256 does not match its dropped tasks", { kept_size: 93 }],
      [[entry("sympy__sympy-15599")], "drops tasks in the pilot draw: sympy__sympy-15599"],
      [[], "drops tasks in the pilot draw: sympy__sympy-15599", { pilot_dropped: ["sympy__sympy-15599"] }],
    ];
    for (const [dropped, msg, over] of bad) {
      const b = list(dropped, over);
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
