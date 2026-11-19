// Value: protects=T8 seeding (prereg section 4 step 6; pre-run change 2, section 4): the seeded profile is byte for byte what each pin's own --log-session writes, the new pin's real --kill-check prints KILL_DUE: yes for it, the current pin's --read returns the assignment and its test, and the slug is what gstack-slug prints in the work repo.
// It runs the pinned gstack scripts from a local clone (GSTACK_OHR_CLONE, default ~/.capy/work/gstack), keyless. Without
// a clone holding both pins the script checks are skipped and say so.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PINS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { workRepo } from "../../../lanes/office-hours-founder/run/contain.ts";
import { PROFILE_FILE, priorEntries, priorProblem, profileText, seedPrior, SESSION_SLUG } from "../../../lanes/office-hours-rewrite/run/seed.ts";
import type { PriorSession, SkillArm } from "../../../lanes/office-hours-rewrite/types.ts";

const CLONE = process.env.GSTACK_OHR_CLONE || join(homedir(), ".capy", "work", "gstack");
const has = (sha: string) => existsSync(CLONE) && spawnSync("git", ["-C", CLONE, "cat-file", "-e", sha + "^{commit}"]).status === 0;
const ready = has(PINS.current!.sha) && has(PINS.new!.sha);
if (!ready) console.log("SKIP tests/ohr/run/seed.test.ts script checks: no gstack clone holding both pins at " + CLONE);

/** The pin's bin/ and lib/ trees, extracted from the clone. */
function tree(arm: SkillArm): string {
  const dir = mkdtempSync(join(tmpdir(), "ohr-pin-" + arm + "-"));
  const tar = join(dir, "t.tar");
  expect(spawnSync("git", ["-C", CLONE, "archive", "--format=tar", "-o", tar, PINS[arm]!.sha, "bin", "lib"]).status).toBe(0);
  expect(spawnSync("tar", ["-x", "-f", tar, "-C", dir]).status).toBe(0);
  return dir;
}
const run = (root: string, args: string[], state: string, cwd = state) => spawnSync("bash", [join(root, "bin", args[0]!), ...args.slice(1)], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: state, GSTACK_STATE_ROOT: state } });

const PRIOR: PriorSession = { date: "2026-10-20", assignment: "Call the three gardens that asked for reminders and ask each to prepay a month.", test: "At least two of the three prepay by November 1.", test_date: "2026-11-01", condition: "if fewer than two of the three gardens prepay a month, change direction" };
const DAY = "2026-11-18";

describe("prior session checks", () => {
  test("a test date two days before the session's day seeds", () => expect(priorProblem({ ...PRIOR, test_date: "2026-11-16" }, DAY)).toBeNull());
  test("a test date one day before the session's day is refused", () => expect(priorProblem({ ...PRIOR, test_date: "2026-11-17" }, DAY)).toContain("at least 2 days"));
  test("a prior session with no condition is refused", () => expect(priorProblem({ ...PRIOR, condition: "" }, DAY)).toContain("condition"));
  test("seedPrior refuses with E_OHR_T8_SEED", () => expect(() => seedPrior(mkdtempSync(join(tmpdir(), "ohr-seed-")), "new", { ...PRIOR, test_date: DAY }, DAY)).toThrow(/^E_OHR_T8_SEED/));
  test("the current pin gets the session entry only, the new pin also its commitment", () => {
    expect(priorEntries("current", PRIOR).map((e) => e.mode)).toEqual(["startup"]);
    expect(priorEntries("new", PRIOR).map((e) => e.mode)).toEqual(["startup", "commitment"]);
    expect(priorEntries("new", PRIOR)[1]).toMatchObject({ project_slug: SESSION_SLUG, kill_date: PRIOR.test_date, kill_test: PRIOR.condition });
  });
});

describe.skipIf(!ready)("the pinned scripts", () => {
  for (const arm of ["current", "new"] as const) {
    test(arm + ": the seeded profile is what the pin's own --log-session writes", () => {
      const root = tree(arm);
      const state = mkdtempSync(join(tmpdir(), "ohr-state-"));
      for (const e of priorEntries(arm, PRIOR)) expect(run(root, ["gstack-developer-profile", "--log-session", JSON.stringify(e)], state).status).toBe(0);
      spawnSync("sleep", ["1"]);
      expect(readFileSync(join(state, PROFILE_FILE), "utf8")).toBe(profileText(priorEntries(arm, PRIOR)));
    });
  }
  test("new: the real --kill-check prints KILL_DUE: yes for the seeded state", () => {
    const root = tree("new");
    const repo = join(mkdtempSync(join(tmpdir(), "ohr-work-")), "repo");
    seedPrior(workRepo(repo), "new", PRIOR, DAY);
    const r = run(root, ["gstack-developer-profile", "--kill-check", SESSION_SLUG], join(repo, ".gstack-home"));
    expect(r.stdout).toContain("KILL_DUE: yes");
    expect(r.stdout).toContain("KILL_TEST: " + PRIOR.condition);
  });
  test("new: the kill check reads no commitment under another slug", () => {
    const root = tree("new");
    const repo = join(mkdtempSync(join(tmpdir(), "ohr-work-")), "repo");
    seedPrior(workRepo(repo), "new", PRIOR, DAY);
    expect(run(root, ["gstack-developer-profile", "--kill-check", "other"], join(repo, ".gstack-home")).stdout).toContain("KILL_DUE: no");
  });
  test("current: --read returns the assignment and its test", () => {
    const root = tree("current");
    const repo = join(mkdtempSync(join(tmpdir(), "ohr-work-")), "repo");
    seedPrior(workRepo(repo), "current", PRIOR, DAY);
    const r = run(root, ["gstack-developer-profile", "--read"], join(repo, ".gstack-home"));
    expect(r.stdout).toContain("LAST_ASSIGNMENT: " + PRIOR.assignment + " Test: " + PRIOR.test);
  });
  for (const arm of ["current", "new"] as const) {
    test(arm + ": gstack-slug prints the seeded slug in a fresh work repo named like the session's", () => {
      const root = tree(arm);
      const work = workRepo(join(mkdtempSync(join(tmpdir(), "ohr-slug-")), SESSION_SLUG));
      const state = mkdtempSync(join(tmpdir(), "ohr-state-"));
      mkdirSync(state, { recursive: true });
      const r = run(root, ["gstack-slug", "--get", "SLUG"], state, work);
      expect(r.stdout.trim()).toBe(SESSION_SLUG);
    });
  }
});
