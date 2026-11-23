// Copyright (c) 2026 Garry Tan. MIT License.
// dockerBreaks on an invented unit in Docker (section 9's breaks secondary): a fix test patch that does not apply on T is
// skipped and named, and a test only a skipped patch adds counts neither way; a run that stops or builds nothing after a
// skip leaves the session's breaks not measured; a broken build the agent's own files cause still breaks every stable
// test. The unit's rebuild fails when a test file holds BROKEN, or when a test needs tests/support.inc and it is missing;
// test.patch edits tests/b.sh and adds support.inc and u.sh, and fix-tests.patch adds c.sh, which needs support.inc.
// It needs an image with git and bash (PF_DOCKER_IMAGE) and skips without one.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scoreUnit } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { readUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { treeVolume } from "../../lanes/outcome-skills/pfchecks/runner.ts";
import { dockerBreaks } from "../../lanes/outcome-skills/pfchecks/score.ts";
import { breaksReading } from "../../lanes/outcome-skills/pfchecks/secondaries.ts";

const IMAGE = process.env.PF_DOCKER_IMAGE ?? "";
const STABLE = ["a", "b", "c", "u"];
const RUN = 'for f in tests/*.sh; do n=$(basename "$f" .sh); if bash "$f"; then echo "test $n ... ok"; else echo "test $n ... FAILED"; fi; done\n';
const BUILD = "if grep -l BROKEN tests/*.sh >/dev/null 2>&1; then echo 'error: a broken test file' >&2; exit 1; fi\n" +
  "if grep -l needs-support tests/*.sh >/dev/null 2>&1 && [ ! -f tests/support.inc ]; then echo 'error: tests/support.inc not found' >&2; exit 1; fi\n";

function unit(name: string) {
  const fx = scoreUnit({
    id: "pf-breaks-" + name, lang: "go", image: IMAGE, files: { "run.sh": RUN, "build.sh": BUILD, "tests/a.sh": "exit 0\n", "tests/b.sh": "exit 0\n" },
    tests: { "tests/b.sh": "exit 0\n# the upstream regression check\n", "tests/support.inc": "ok=1\n", "tests/u.sh": "exit 0\n" },
    fixTests: { "tests/c.sh": "# needs-support\n. tests/support.inc\nexit 0\n" },
    commands: { rebuild: ["bash build.sh"], test: ["bash run.sh"], print: ["true"] }, f2p: ["f"], stable: STABLE, known: STABLE,
  });
  const uj = JSON.parse(readFileSync(join(fx.dir, "unit.json"), "utf8"));
  uj.oracle.rebuild_rule = { applies: true, fixed_rebuild_exits: [[0], [0], [0]] };
  writeFileSync(join(fx.dir, "unit.json"), JSON.stringify(uj, null, 1) + "\n");
  return fx;
}

/** T: the unit's base with the agent's files written over it, as one commit in a host repo. */
function breaksOn(name: string, agent: Record<string, string>) {
  const fx = unit(name);
  const repo = join(mkdtempSync(join(tmpdir(), "pf-breaks-t-")), "r");
  spawnSync("git", ["clone", "-q", fx.repo, repo]);
  for (const [p, t] of Object.entries(agent)) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), t);
  }
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  spawnSync("git", ["-C", repo, "add", "-A"], { env });
  spawnSync("git", ["-C", repo, "commit", "-qm", "T"], { env });
  const t = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  try {
    const b = dockerBreaks(fx.dir, IMAGE, "hardened", (r, c, vol) => treeVolume(r, c, IMAGE, vol, fx.volume))(repo, t, readUnit(fx.dir));
    return { b, breaks: b ? breaksReading(STABLE, b) : null };
  } finally {
    spawnSync("docker", ["volume", "rm", "-f", fx.volume]);
  }
}

test.skipIf(!IMAGE)("breaks: a T the fix's tests apply on runs all three runs with nothing skipped and breaks no stable test", () => {
  const { b, breaks } = breaksOn("clean", { "tests/z.sh": "exit 0\n" });
  expect(b?.skipped).toEqual([]);
  expect(b?.unmeasured).toBeNull();
  expect(b?.runs.map((r) => (r ? Object.keys(r).sort().join(",") : null))).toEqual(["a,b,c,u,z", "a,b,c,u,z", "a,b,c,u,z"]);
  expect(breaks).toEqual([]);
}, 300_000);

test.skipIf(!IMAGE)("breaks: a T that already holds test.patch's edits skips test.patch and breaks nothing, and a test only test.patch adds counts neither way", () => {
  const { b, breaks } = breaksOn("holds", { "tests/b.sh": "exit 0\n# the upstream regression check\n", "tests/support.inc": "ok=1\n" });
  expect(b?.skipped).toEqual(["test.patch"]);
  expect(b?.unmeasured).toBeNull();
  expect(b?.runs.map((r) => (r ? Object.keys(r).sort().join(",") : null))).toEqual(["a,b,c", "a,b,c", "a,b,c"]);
  expect(breaks).toEqual([]);
}, 300_000);

test.skipIf(!IMAGE)("breaks: a run that builds nothing after test.patch was skipped leaves the session's breaks not measured, never all broken", () => {
  const { b, breaks } = breaksOn("skipped-stop", { "tests/b.sh": "exit 0\n# the agent's own check\n" });
  expect(b?.skipped).toEqual(["test.patch"]);
  expect(b?.unmeasured).toMatch(/built nothing \(rebuild_failed\) after skipping test\.patch/);
  expect(breaks).toBeNull();
}, 300_000);

test.skipIf(!IMAGE)("breaks: a broken build the agent's own files cause, with every patch applied, still breaks every stable test", () => {
  const { b, breaks } = breaksOn("agent-stop", { "tests/z.sh": "BROKEN\n" });
  expect(b?.skipped).toEqual([]);
  expect(b?.unmeasured).toBeNull();
  expect(breaks).toEqual(STABLE);
}, 300_000);
