// Keyless tests of the L1 arms: arms/l1.ts, build.sh l1, check-l1.sh and task-bun.sh (README.md, "The L1 arms").
// The pure checks always run, on fixtures and on the committed manifests. The in-image checks run on the built tars:
// set LANEB_L1_ARMS to build.sh l1's out-dir (default ~/.capy/work/laneb-arms-l1). They skip unless the four tars are
// there and docker answers. Every check runs both ways: it passes on the real arm and fails on a doctored one.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ARMS, CONTRACT_MARK, EXPECTED_HOOKS, FIXTURE_PROMPT, FIXTURE_ROUTE, FROZEN, PINS, REPO_URL, ROUTE_MARK, SETUP, bunOk, checkConfig, checkHooks,
  checkNone, hookEntries, liteMatch, normTree, sessionSignals,
} from "../arms/l1.ts";

const laneb = join(import.meta.dir, "..");
const REPO = join(laneb, "..", "..");
const ARMS_DIR = join(laneb, "arms");
const PLAN = join(REPO, "wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000");
const MANIFESTS = join(ARMS_DIR, "manifests", "l1");
const OUT = process.env.LANEB_L1_ARMS;
const BUILT = Boolean(OUT) && ARMS.every((a) => existsSync(join(OUT!, a + ".tar"))) && spawnSync("docker", ["info"]).status === 0;
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const lines = (file: string) => readFileSync(file, "utf8").trim().split("\n");

const roots: string[] = [];
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "laneb-l1-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
const put = (root: string, rel: string, body: string | Uint8Array) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/** settings.json as each pin's setup writes it (the after arm's, read from a build on 2026-11-04). */
const settings = (arm: "before" | "after") => {
  const group = (source: string, file: string, timeout: number) => ({ _gstack_source: source, hooks: [{ type: "command", command: "/root/.claude/skills/gstack/hosts/claude/hooks/" + file, timeout }] });
  const stop = [group("gstack-timeline-stop", "timeline-stop-hook", 5)];
  if (arm === "before") return { hooks: { Stop: stop } };
  return { hooks: { Stop: [...stop, group("gstack-skill-contract", "skill-contract-stop-hook", 10)], UserPromptSubmit: [group("gstack-skill-route", "skill-route-hook", 5)] } };
};

describe("L1 pins and frozen values", () => {
  // Value: protects=the two gstack pins every L1 arm is built from; fails_when=build.sh, l1.ts or the prereg's section 2 name different shas or versions; why_new=GEVA-268 (U1, pins by sha); seam=arms/build.sh L1_BEFORE_SHA/L1_AFTER_SHA, arms/l1.ts PINS; no_claim=that the fetched commits are those shas, which build.sh checks with git rev-parse
  test("build.sh and l1.ts pin the prereg's two shas", () => {
    const build = readFileSync(join(ARMS_DIR, "build.sh"), "utf8");
    expect(/^L1_BEFORE_SHA=([0-9a-f]{40})$/m.exec(build)?.[1]).toBe(PINS.before.sha);
    expect(/^L1_AFTER_SHA=([0-9a-f]{40})$/m.exec(build)?.[1]).toBe(PINS.after.sha);
    expect(/^L1_LOADOUT=(\S+)$/m.exec(build)?.[1]).toBe("lite");
    const row = lines(join(PLAN, "README.md")).find((l) => l.startsWith("| sha | "))!;
    expect(row).toContain(PINS.before.sha + " (v" + PINS.before.version + ")");
    expect(row).toContain(PINS.after.sha + " (v" + PINS.after.version + ")");
    expect(SETUP).toBe("./setup --host claude --no-browser --loadout lite");
  });

  // Value: protects=the frozen values the built arms are held to; fails_when=l1.ts's FROZEN or EXPECTED_HOOKS drift from install-manifest.md; why_new=GEVA-268 (U1 manifests must equal the prereg's values); seam=arms/l1.ts FROZEN, EXPECTED_HOOKS; no_claim=none
  test("FROZEN and EXPECTED_HOOKS are install-manifest.md's values", () => {
    const md = lines(join(PLAN, "install-manifest.md"));
    const cells = (field: string) => md.find((l) => l.startsWith("| " + field + " |"))!.split("|").slice(2, 4).map((c) => c.trim());
    expect(cells("lite spec_sha256")).toEqual([FROZEN.spec_sha256, FROZEN.spec_sha256]);
    expect(cells("lite files")).toEqual([String(FROZEN.files), String(FROZEN.files)]);
    expect(cells("lite tree digest, normalized (setup render)")).toEqual([FROZEN.tree_digest.before, FROZEN.tree_digest.after]);
    expect(cells("/investigate SKILL.md sha256, normalized")).toEqual([FROZEN.investigate_sha256.before, FROZEN.investigate_sha256.after]);
    expect(cells("/investigate first 200 characters, sha256")).toEqual([FROZEN.investigate_first200.before, FROZEN.investigate_first200.after]);
    const hooks = (pin: string): unknown[] => {
      const from = md.indexOf("**" + pin + "**");
      const block = md.slice(from + 1, md.findIndex((l, i) => i > from + 1 && l.startsWith("**") || (i > from + 1 && l.startsWith("## "))));
      return block.filter((l) => l.startsWith("- ")).map((l) => {
        const m = /^- (\w+), source (\S+), timeout (\d+)s: (\S+)$/.exec(l)!;
        return { event: m[1]!, _gstack_source: m[2]!, command: m[4]!, timeout: Number(m[3]) };
      });
    };
    expect(hooks("before")).toEqual(EXPECTED_HOOKS.before);
    expect(hooks("after")).toEqual(EXPECTED_HOOKS.after);
    expect(EXPECTED_HOOKS.off).toEqual(EXPECTED_HOOKS.after);
  });
});

describe("L1 checks on fixtures", () => {
  // Value: protects=the lite tree digest, computed as the prereg's manifest.py does; fails_when=normTree's normalization, sort, skip of loadout.lock.json or row format drifts from manifest.py's tree(); why_new=GEVA-268 (U1 tree digest exactly as manifest.py); seam=arms/l1.ts normTree; no_claim=none
  test.skipIf(spawnSync("python3", ["--version"]).status !== 0)("normTree gives manifest.py's tree() digest", () => {
    const root = temp("tree");
    put(root, "investigate/SKILL.md", "Run /root/.gstack/render/claude/bin/x from /root/.claude/skills.\n");
    put(root, "b/c/notes.md", "plain\n");
    put(root, "a.md", "/root/x é\n");
    put(root, "loadout.lock.json", "{}");
    symlinkSync(join(root, "b"), join(root, "linked-dir"));
    const src = readFileSync(join(PLAN, "manifest.py"), "utf8");
    const defs = src.slice(src.indexOf("def sha("), src.indexOf("out = {}"));
    const py = spawnSync("python3", ["-c", "import hashlib, os, sys\n" + defs + "\nprint(tree(sys.argv[1], '/root', '/root/.gstack/render/claude')[1])", root], { encoding: "utf8" });
    expect(py.status).toBe(0);
    expect(normTree(root).digest).toBe(py.stdout.trim());
  });

  // Value: protects=the 204-file lite match; fails_when=liteMatch accepts a one-byte change in one rendered file, a file the lock does not list, or a lock with another spec_sha256; why_new=GEVA-268 (U1 check 1); seam=arms/l1.ts liteMatch; no_claim=the real render, which the in-image test checks
  test("liteMatch passes an identical render and fails a one-byte change, an extra file and another spec", () => {
    const [installed, fresh] = [temp("installed"), temp("fresh")];
    const files = Array.from({ length: FROZEN.files }, (_, i) => ({ path: "s" + (i % 7) + "/f" + i + ".md", body: "file " + i + " at /root/.gstack/render/claude\n" }));
    for (const f of files) for (const root of [installed, fresh]) put(root, f.path, f.body);
    const lock = (spec_sha256: string) => JSON.stringify({ spec: "lite", spec_sha256, files: files.map((f) => ({ path: f.path, sha256: sha256(f.body) })) });
    put(fresh, "loadout.lock.json", lock(FROZEN.spec_sha256));
    expect(liteMatch(installed, fresh)).toMatchObject({ matched: FROZEN.files, problems: [] });
    const b = Buffer.from(files[3]!.body);
    b[0] = b[0]! ^ 1;
    put(installed, files[3]!.path, b);
    expect(liteMatch(installed, fresh).problems).toEqual(["differs: " + files[3]!.path]);
    put(installed, files[3]!.path, files[3]!.body);
    put(installed, "extra/SKILL.md", "x");
    expect(liteMatch(installed, fresh).problems).toEqual(["not in the lock: extra/SKILL.md"]);
    rmSync(join(installed, "extra"), { recursive: true });
    put(fresh, "loadout.lock.json", lock("0".repeat(64)));
    expect(liteMatch(installed, fresh).problems).toEqual(["lock spec_sha256 " + "0".repeat(64)]);
  });

  // Value: protects=the hook entries each pin's setup writes; fails_when=checkHooks accepts a missing contract hook, a wrong timeout or the after pin's hooks in before; why_new=GEVA-268 (U1 check 2); seam=arms/l1.ts hookEntries, checkHooks; no_claim=none
  test("checkHooks takes each pin's entries and refuses a missing contract hook", () => {
    const after = hookEntries(JSON.stringify(settings("after")));
    expect(checkHooks("after", after)).toEqual([]);
    expect(checkHooks("off", after)).toEqual([]);
    expect(checkHooks("before", hookEntries(JSON.stringify(settings("before"))))).toEqual([]);
    expect(checkHooks("before", after)).toHaveLength(1);
    const doctored = settings("after");
    doctored.hooks.Stop = doctored.hooks.Stop.filter((g) => g._gstack_source !== "gstack-skill-contract");
    expect(checkHooks("after", hookEntries(JSON.stringify(doctored)))).toHaveLength(1);
    const slow = settings("after");
    slow.hooks.UserPromptSubmit![0]!.hooks[0]!.timeout = 30;
    expect(checkHooks("after", hookEntries(JSON.stringify(slow)))).toHaveLength(1);
  });

  // Value: protects=the none arm as clean by construction; fails_when=checkNone accepts a gstack folder under ~/.claude/skills, ~/.gstack, ~/.local/share/gstack or a gstack hook; why_new=GEVA-268 (U1 check 3); seam=arms/l1.ts checkNone; no_claim=none
  test("checkNone passes an empty skills folder and refuses each kind of gstack trace", () => {
    const root = temp("none");
    mkdirSync(join(root, ".claude/skills"), { recursive: true });
    expect(checkNone(root)).toEqual([]);
    mkdirSync(join(root, ".claude/skills/gstack"));
    expect(checkNone(root)).toEqual([".claude/skills/gstack is gstack"]);
    rmSync(join(root, ".claude/skills/gstack"), { recursive: true });
    for (const p of [".gstack", ".local/share/gstack"]) {
      mkdirSync(join(root, p), { recursive: true });
      expect(checkNone(root)).toEqual([p + " exists"]);
      rmSync(join(root, p), { recursive: true });
    }
    put(root, ".claude/settings.json", JSON.stringify(settings("before")));
    expect(checkNone(root)).toEqual([".claude/settings.json has a gstack hook"]);
  });

  // Value: protects=the off arm's switches and the after arm's defaults; fails_when=checkConfig accepts skill_routing left on in off, or a switch off in after; why_new=GEVA-268 (U1 check 4); seam=arms/l1.ts checkConfig; no_claim=none
  test("checkConfig wants both switches off in off and neither off in after", () => {
    expect(checkConfig("off", { skill_routing: "off", skill_contracts: "off" })).toEqual([]);
    expect(checkConfig("off", { skill_routing: "on", skill_contracts: "off" })).toEqual(['skill_routing is "on", not off']);
    expect(checkConfig("after", { skill_routing: "on", skill_contracts: "on" })).toEqual([]);
    expect(checkConfig("after", { skill_routing: "on", skill_contracts: "off" })).toEqual(["skill_contracts is off"]);
  });

  // Value: protects=the hook signals read from the fake upstream's requests; fails_when=sessionSignals finds the route line outside the first request or misses the contract feedback; why_new=GEVA-268 (U1 check 5); seam=arms/l1.ts sessionSignals; no_claim=Claude Code's own behavior, which the in-image test checks
  test("sessionSignals reads the route line in the first request and the contract feedback later", () => {
    const route = { messages: [{ role: "user", content: [{ type: "text", text: "<system-reminder>" + ROUTE_MARK + " ...</system-reminder>" }] }] };
    const feedback = { messages: [{ role: "user", content: CONTRACT_MARK + " (contract v1): missing x" }] };
    const plain = { messages: [{ role: "user", content: "hello" }] };
    expect(sessionSignals([route, feedback])).toEqual({ requests: 2, route_in_first: true, route_anywhere: true, contract_feedback: true });
    expect(sessionSignals([plain, route])).toMatchObject({ route_in_first: false, route_anywhere: true, contract_feedback: false });
    expect(sessionSignals([plain])).toMatchObject({ route_anywhere: false, contract_feedback: false });
  });

  // Value: protects=the task-image verdict; fails_when=bunOk accepts an older bun first on PATH, another bun 1.4.4 or no bash; why_new=GEVA-268 (U1 check 6); seam=arms/l1.ts bunOk, task-bun.sh row_of; no_claim=none
  test("bunOk wants the runtime's Bun 1.4.4 first and bash", () => {
    expect(bunOk("/opt/laneb/bin/bun", "1.4.4", "yes")).toBe(true);
    expect(bunOk("/usr/local/bin/bun", "1.1.0", "yes")).toBe(false);
    expect(bunOk("/usr/local/bin/bun", "1.4.4", "yes")).toBe(false);
    expect(bunOk("/opt/laneb/bin/bun", "1.4.4", "no")).toBe(false);
  });
});

describe("L1 committed manifests", () => {
  const read = (name: string) => JSON.parse(readFileSync(join(MANIFESTS, name + ".json"), "utf8"));

  // Value: protects=the manifests Amendment C pins: each gstack arm's pin, fetch record, setup, seeded user, lite lock, tree digest, hooks, switches and /investigate digests, equal to the prereg's frozen values; fails_when=a manifest is missing a field or holds a value other than the prereg's; why_new=GEVA-268 (U1 manifests); seam=arms/manifests/l1/<arm>.json; no_claim=that the tars on disk are these, which the in-image test checks
  test("each manifest carries the prereg's pin and frozen values", () => {
    const hex = /^[0-9a-f]{64}$/;
    const none = read("none");
    expect(none).toMatchObject({ arm: "none", claude_code: "2.1.312", skills: { count: 0, names: [] } });
    expect(none.gstack_sha).toBeUndefined();
    for (const arm of ["before", "after", "off"] as const) {
      const m = read(arm);
      const pin = arm === "before" ? PINS.before : PINS.after;
      const key = arm === "before" ? "before" : "after";
      expect(m).toMatchObject({
        arm, claude_code: "2.1.312", gstack_sha: pin.sha, gstack_version: pin.version, setup: SETUP, update_check: "false",
        fetch: { repo: REPO_URL, sha: pin.sha, head: pin.sha },
        lite: { spec: "lite", spec_sha256: FROZEN.spec_sha256, files: FROZEN.files, tree_digest_normalized: FROZEN.tree_digest[key] },
        investigate: { sha256_normalized: FROZEN.investigate_sha256[key], first200_sha256: FROZEN.investigate_first200[key] },
        hooks: EXPECTED_HOOKS[arm],
      });
      for (const v of [m.git_archive_sha256, m.lite.lock_sha256, m.tar.sha256, m.tar_gz_sha256]) expect(v).toMatch(hex);
      expect(m.onboarding_markers.split(" ")).toHaveLength(6);
      expect(checkConfig(arm, m.gstack_config)).toEqual([]);
    }
    expect(read("off").git_archive_sha256).toBe(read("after").git_archive_sha256);
    expect(read("off").gstack_config).toEqual({ skill_routing: "off", skill_contracts: "off" });
  });

  // Value: protects=the bun table's coverage: every F task and pilot task, each from its image pinned by digest, with an ok column that matches its row; fails_when=a task is missing or doubled, an image is not the pinned digest, or ok disagrees with bunOk; why_new=GEVA-268 (U1 check 6); seam=arms/manifests/l1/task-bun.tsv, task-bun.sh; no_claim=the images' contents, which task-bun.sh read
  test("task-bun.tsv covers all 80 F tasks and the 10 pilot tasks", () => {
    const [head, ...rows] = lines(join(MANIFESTS, "task-bun.tsv")).map((l) => l.split("\t"));
    expect(head).toEqual(["task", "set", "image", "bun_path", "bun_version", "bash", "ok"]);
    const tasks = new Map((JSON.parse(readFileSync(join(laneb, "tasks", "swerebench-r3a4.json"), "utf8")).tasks as { task_id: string; image: string; image_digest: string }[]).map((t) => [t.task_id, t]));
    for (const [set, file] of [["f", "f-tasks.txt"], ["pilot", "pilot-tasks.txt"]]) {
      const want = lines(join(PLAN, file!));
      expect(rows.filter((r) => r[1] === set).map((r) => r[0])).toEqual(want);
    }
    expect(rows).toHaveLength(90);
    for (const [task, , image, path, version, bash, ok] of rows) {
      const t = tasks.get(task!)!;
      expect(image).toBe(t.image.replace(/:[^/:]+$/, "") + "@" + t.image_digest);
      expect(ok).toBe(bunOk(path!, version!, bash!) ? "yes" : "no");
    }
  });
});

/** One l1.ts command inside an arm's check container, through check-l1.sh; returns its JSON line. */
const inArm = (arm: string, ...args: string[]) => {
  const r = spawnSync("bash", [join(ARMS_DIR, "check-l1.sh"), OUT!, "run", arm, ...args], { encoding: "utf8", timeout: 900_000, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error("check-l1.sh exited " + r.status + ": " + r.stderr.slice(-800));
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
};

describe.skipIf(!BUILT)("L1 arms as built, inside the arm images", () => {
  // Value: protects=the bytes a trial extracts: each tar and its gzip match the committed manifest; fails_when=a tar is rebuilt or edited without its manifest; why_new=GEVA-268 (U1 tars and manifests); seam=arms/manifests/l1/<arm>.json; no_claim=that a rebuild gives the same bytes, which the README records
  test("the tars match their manifests", () => {
    for (const arm of ARMS) {
      const m = JSON.parse(readFileSync(join(MANIFESTS, arm + ".json"), "utf8"));
      expect(sha256(readFileSync(join(OUT!, arm + ".tar")))).toBe(m.tar.sha256);
      expect(sha256(readFileSync(join(OUT!, arm + ".tar.gz")))).toBe(m.tar_gz_sha256);
    }
  }, 300_000);

  // Value: protects=checks 1 to 4 in the arm images: the 204-file lite match against the pin's own fresh render, the hook entries, none clean and the switches; fails_when=any check fails on a real arm; why_new=GEVA-268 (U1 checks 1-4); seam=check-l1.sh, l1.ts inImageChecks; no_claim=the hooks' behavior, which the session tests check
  test("each arm passes its in-image checks", () => {
    expect(inArm("none", "check", "--arm", "none").checks).toEqual({ none: { ok: true, problems: [] } });
    for (const arm of ["before", "after", "off"]) {
      const c = inArm(arm, "check", "--arm", arm).checks;
      expect({ arm, lite: c.lite.ok, matched: c.lite.matched, hooks: c.hooks.ok, config: c.config.ok }).toEqual({ arm, lite: true, matched: FROZEN.files, hooks: true, config: true });
      expect(c.lite.spec_sha256).toBe(FROZEN.spec_sha256);
    }
  }, 900_000);

  // Value: protects=checks 1 to 4 as checks: each fails on a doctored arm; fails_when=a check passes a one-byte change in one rendered file, a missing contract hook entry, an extra gstack folder in none, or skill_routing left on in off; why_new=GEVA-268 (U1 tests in both directions); seam=l1.ts --doctor; no_claim=none
  test("each check fails on a doctored arm", () => {
    const lite = inArm("after", "check", "--arm", "after", "--doctor", "render-byte").checks.lite;
    expect([lite.ok, lite.matched, lite.problems]).toEqual([false, FROZEN.files - 1, ["differs: investigate/SKILL.md"]]);
    expect(inArm("after", "check", "--arm", "after", "--doctor", "no-contract-hook").checks.hooks.ok).toBe(false);
    expect(inArm("none", "check", "--arm", "none", "--doctor", "gstack-in-none").checks.none).toEqual({ ok: false, problems: [".claude/skills/gstack is gstack"] });
    expect(inArm("off", "check", "--arm", "off", "--doctor", "routing-on").checks.config).toMatchObject({ ok: false, problems: ['skill_routing is "on", not off'] });
  }, 900_000);

  // Value: protects=check 5: with the real Claude Code 2.1.312 as the trial runs it, the after arm's route hook puts its line in the first request on the fixture prompt, and its contract hook blocks a told session that ends with no DEBUG REPORT; neither appears in off or before; fails_when=a hook does not fire in after, or fires in off or before; why_new=GEVA-268 (U1 check 5); seam=l1.ts session, Claude Code 2.1.312, the arm's settings.json and hook shims; no_claim=the Python SDK's control protocol and the docker exec wrapper the real agent uses
  test("the after arm's route and contract hooks fire, and stay silent in off and before", () => {
    const after = inArm("after", "session", "--arm", "after");
    expect(after.prompt).toBe(FIXTURE_PROMPT);
    expect(after.route).toMatchObject({ route: FIXTURE_ROUTE.skill, score: FIXTURE_ROUTE.score });
    expect(after.untold).toMatchObject({ code: 0, route_in_first: true, hint_in_first: true, contract_feedback: false });
    expect(after.told).toMatchObject({ code: 0, route_anywhere: false, contract_feedback: true });
    for (const arm of ["off", "before"]) {
      const s = inArm(arm, "session", "--arm", arm);
      for (const k of ["untold", "told"]) expect(s[k]).toMatchObject({ code: 0, route_anywhere: false, contract_feedback: false });
    }
  }, 900_000);

  // Value: protects=check 5 as a check: a route hook that prints nothing fails it; fails_when=the session check passes with a silent route hook; why_new=GEVA-268 (U1 tests in both directions); seam=l1.ts --doctor silent-route-hook; no_claim=none
  test("a route hook that prints nothing fails the session check", () => {
    const s = inArm("after", "session", "--arm", "after", "--doctor", "silent-route-hook");
    expect(s.untold).toMatchObject({ code: 0, route_in_first: false, hint_in_first: false });
  }, 900_000);

  // Value: protects=check 6 both ways: under the runtime PATH a plain image reaches the runtime's Bun 1.4.4, and an image with an older bun earlier on PATH does not; fails_when=task-bun.sh's check passes a shadowing bun or fails a clean image; why_new=GEVA-268 (U1 check 6); seam=task-bun.sh check; no_claim=the 90 task images, which task-bun.tsv records
  test("task-bun.sh passes a clean image and fails one whose PATH puts an older bun first", () => {
    const tag = "laneb-l1-old-bun:test";
    const build = spawnSync("docker", ["build", "-q", "-t", tag, "-"], { input: "FROM ubuntu:24.04\nRUN printf '#!/bin/sh\\necho 1.1.0\\n' > /usr/local/bin/bun && chmod +x /usr/local/bin/bun\n", encoding: "utf8" });
    expect(build.status).toBe(0);
    const row = (image: string) => spawnSync("bash", [join(ARMS_DIR, "task-bun.sh"), "check", image], { encoding: "utf8", timeout: 600_000 }).stdout.trim();
    expect(row("ubuntu:24.04")).toBe("/opt/laneb/bin/bun\t1.4.4\tyes\tyes");
    expect(row(tag)).toBe("/usr/local/bin/bun\t1.1.0\tyes\tno");
    spawnSync("docker", ["rmi", "-f", tag]);
  }, 900_000);
});
