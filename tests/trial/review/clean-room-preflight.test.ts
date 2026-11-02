// The clean room's image preflight (src/trial/review/clean-room.ts, cleanRoomPreflight; panel v3 plan, section 4): before
// the lease opens, review-units runs the clean-room script in each none and lens arm image (keys arm and arm@model), with
// every unit tree mounted read-only at /work/<task> and no network. A hit refuses the run with E_CLEAN_ROOM naming the
// arm, the image, the trial image digest, the paths found and a fix line; a check that cannot finish refuses the same
// way. dockerRig runs the hook once the arm images are built and before openLease, so a refusal opens no lease. Docker is
// a fake binary on disk that records its argv and answers each step; no container runs. Keyless.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeHash, recipeInputs } from "../../../src/rig/recipe.ts";
import { ledgerStatus, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { dockerRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { trialTag } from "../../../src/trial/image.ts";
import { CLEAN_ROOM_SCRIPT, cleanRoomPreflight } from "../../../src/trial/review/clean-room.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "clean-room-preflight-"));
  roots.push(d);
  return d;
};
const ID = "c0ffee".repeat(10) + "abcd";
const DIGEST = "sha256:" + "ab".repeat(32);
const AGENT_HOME = "/" + ["srv", "agent"].join("/");
const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/**
 * A fake docker at <dir>/docker. Every call appends its argv to <dir>/calls.log (args end in 0x1e, calls in 0x1d).
 * image inspect prints one id and label, save writes the file -o names, version prints 20.10.0, and a clean-room run
 * (one whose args hold clean-room) prints found <path> per path and exits 3 when its image matches hit (an sh case
 * pattern), or prints stderr and exits with exit when set. Every other call exits 0.
 */
function fakeDocker(dir: string, o: { hit?: string; found?: string[]; exit?: number; stderr?: string; label?: string } = {}): string {
  const log = join(dir, "calls.log");
  const bin = join(dir, "docker");
  writeFileSync(bin, [
    "#!/bin/sh",
    "printf '%s\\036' \"$@\" >> " + q(log),
    "printf '\\035' >> " + q(log),
    'case "$1" in',
    "  image) printf 'sha256:%s %s\\n' " + q(ID) + " " + q(o.label ?? "none") + "; exit 0 ;;",
    '  save) : > "$3"; exit 0 ;;',
    "  version) echo 20.10.0; exit 0 ;;",
    "  run) ;;",
    "  *) exit 0 ;;",
    "esac",
    'case " $* " in *" clean-room "*) ;; *) exit 0 ;; esac',
    "tag=; p1=; p2=",
    'for a in "$@"; do [ "$p2" = --entrypoint ] && tag=$a; p2=$p1; p1=$a; done',
    ...(o.exit !== undefined ? ["printf '%s\\n' " + q(o.stderr ?? "") + " >&2", "exit " + o.exit] : []),
    ...(o.hit ? ['case "$tag" in ' + o.hit + ") printf 'found %s\\n' " + (o.found ?? []).map(q).join(" ") + "; exit 3 ;; esac"] : []),
    "exit 0",
  ].join("\n") + "\n");
  chmodSync(bin, 0o755);
  return bin;
}
const calls = (dir: string): string[][] => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").split("\x1d").filter(Boolean).map((c) => c.split("\x1e").slice(0, -1)) : []);
const cleanRoomRuns = (dir: string) => calls(dir).filter((c) => c[0] === "run" && c.includes("clean-room"));
const message = (f: () => void): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

const IMAGES = new Map([["none", "arm-none:1"], ["none#calibration", "arm-none-cal:1"], ["none@claude-opus-5-5", "arm-none-opus:1"], ["lens", "arm-lens:1"], ["gstack", "arm-gstack:1"], ["gstack@claude-opus-5-5", "arm-gstack-opus:1"], ["gstack#calibration", "arm-gstack-cal:1"], ["placebo", "arm-placebo:1"], ["gstack-auto", "arm-auto:1"]]);
const UNITS = [{ task: "example-plan-7-1a2b3c4d", tree: "/srv/units/u7/tree" }, { task: "example-plan-8-5e6f7a8b", tree: "/srv/units/u8/tree" }];
const FIX_HIT = "\n  fix: remove those paths from the arm image or the unit tree, then rerun the same command; nothing was spent and the item is still unopened";
const FIX_RUN = "\n  fix: make the image run sh with docker run --network none, then rerun the same command; nothing was spent and the item is still unopened";
const preflight = (docker: string) => cleanRoomPreflight({ docker, images: IMAGES, arms: ["none", "lens"], units: UNITS, home: AGENT_HOME, digest: DIGEST });

describe("cleanRoomPreflight on a fake docker (GEVA-203, keyless)", () => {
  // Value: protects=only the none and lens images are checked, by keys arm and arm@model, never a calibration copy or another arm's image, each with every unit tree read-only at /work/<task>, no network, no capabilities and the frozen script on the image's home and units; fails_when=a gstack or placebo image is checked, an arm@model image is skipped, a unit is mounted writable or elsewhere, or the check gets a network; why_new=C1's image preflight; seam=cleanRoomPreflight's docker argv; no_claim=the script's own checks, which clean-room.test.ts covers
  test("only none and lens images are checked, each unit read-only at /work/<task>, --network none", () => {
    const dir = scratch();
    expect(preflight(fakeDocker(dir))).toBeUndefined();
    const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
    const runs = cleanRoomRuns(dir);
    expect(runs.map((c) => c[16])).toEqual(["arm-none:1", "arm-none-opus:1", "arm-lens:1"]);
    for (const c of runs) expect(c).toEqual(["run", "--rm", "--network", "none", "--user", user, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "-v", UNITS[0]!.tree + ":/work/" + UNITS[0]!.task + ":ro", "-v", UNITS[1]!.tree + ":/work/" + UNITS[1]!.task + ":ro", "--entrypoint", "sh", c[16]!, "-c", CLEAN_ROOM_SCRIPT, "clean-room", AGENT_HOME, "/work/" + UNITS[0]!.task, "/work/" + UNITS[1]!.task]);
    expect(calls(dir).length).toBe(3);
  });

  // Value: protects=a hit in an arm image, keyed arm or arm@model, throws a message that opens with E_CLEAN_ROOM and names the arm, the image, the trial image digest, every path found and a fix line, and stops at that image; fails_when=a hit passes, the message drops the arm, image, digest or a path, or later images still run; why_new=C1's image preflight (refuse before any spend); seam=cleanRoomPreflight's exit 3 branch; no_claim=the CLI's exit code for it, which main maps from the E_ prefix
  test("a hit throws E_CLEAN_ROOM naming the arm, image, digest, the paths found and a fix line", () => {
    const found = [AGENT_HOME + "/.claude/skills", "/work/" + UNITS[0]!.task + "/docs/AGENTS.md"];
    const dir = scratch();
    expect(message(() => preflight(fakeDocker(dir, { hit: "arm-lens:1", found })))).toBe("E_CLEAN_ROOM review-units: arm lens image arm-lens:1 (trial image digest " + DIGEST + "): found " + found.join(", ") + FIX_HIT);
    expect(cleanRoomRuns(dir).map((c) => c[16])).toEqual(["arm-none:1", "arm-none-opus:1", "arm-lens:1"]);
    const model = scratch();
    expect(message(() => preflight(fakeDocker(model, { hit: "arm-none-opus:1", found: found.slice(0, 1) })))).toBe("E_CLEAN_ROOM review-units: arm none image arm-none-opus:1 (trial image digest " + DIGEST + "): found " + found[0] + FIX_HIT);
    expect(cleanRoomRuns(model).map((c) => c[16])).toEqual(["arm-none:1", "arm-none-opus:1"]);
  });

  // Value: protects=a check that cannot finish (docker missing, the image refusing to run, or exit 3 with no path) refuses with E_CLEAN_ROOM and "did not finish", never passes; fails_when=an unrunnable check reads as clean, or its refusal hides the exit or stderr; why_new=C1's image preflight (a check that cannot run refuses the run); seam=cleanRoomPreflight's spawn error and non-zero branches; no_claim=a check killed by its 120 s timeout, which takes the same branch
  test("a check that cannot finish throws E_CLEAN_ROOM with did not finish", () => {
    const at = "E_CLEAN_ROOM review-units: arm none image arm-none:1 (trial image digest " + DIGEST + "): the clean-room check did not finish (";
    const missing = message(() => preflight(join(scratch(), "no-such-docker")))!;
    expect([missing.startsWith(at), missing.includes("ENOENT"), missing.endsWith(FIX_RUN)]).toEqual([true, true, true]);
    expect(message(() => preflight(fakeDocker(scratch(), { exit: 125, stderr: "docker: Error response from daemon: image not known" })))).toBe(at + "exit 125): docker: Error response from daemon: image not known" + FIX_RUN);
    expect(message(() => preflight(fakeDocker(scratch(), { exit: 3 })))).toBe(at + "exit 3)" + FIX_RUN);
  });
});

describe("dockerRig's preflight hook on a fake docker (GEVA-203, keyless)", () => {
  const OPUS = "claude-opus-5-5";
  const ITEM = "preflight-order";
  const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
  const recipe = recipeHash(recipeInputs());
  /** dockerRig for none and lens (bare arms) on the fake docker, with an approved item and cleanRoomPreflight as the hook, as review-units wires it. */
  const rig = (hit: boolean) => {
    const root = scratch();
    const state = join(root, "xdg");
    mkdirSync(join(state, "gstack-evals", "images"), { recursive: true });
    writeFileSync(join(state, "gstack-evals", "images", "trial-" + recipe + ".json"), JSON.stringify({ schema_version: 1, recipe_sha256: recipe, tag: trialTag(recipe), digest: "sha256:" + ID, built_at: "2026-11-02T00:00:00.000Z", from_pins: [] }));
    const docker = fakeDocker(root, { label: recipe, ...(hit ? { hit: "gstack-evals-arm:*", found: [AGENT_HOME + "/.local/share/gstack"] } : {}) });
    mkdirSync(join(root, "fixtures"));
    writeFileSync(join(root, "fixtures", "tasks.json"), "[]\n");
    const record = join(root, "record");
    mkdirSync(record);
    recordApproval(record, { action: "init", item: ITEM, cap_micros: 5_000_000, quotes: [{ words: "keyless test, no spend", by: "tests/trial/review", source: "tests/trial/review/clean-room-preflight.test.ts" }], admission: "warn" });
    const tree = join(root, "unit-tree");
    mkdirSync(tree);
    const call = { host: "claude" as const, arms: { arms: [{ name: "none", kind: "bare" as const }, { name: "lens", kind: "bare" as const }], base: null, skill: null, notes: [] }, tasks: join(root, "fixtures", "tasks.json"), out: { path: join(root, "out"), rule: "--out" }, ledger: { path: join(root, "ledger.sqlite"), rule: "--ledger" }, record: { path: record, rule: "--record" }, item: ITEM, runId: "preflight-order-run", models: [OPUS], policy };
    let keys = null as string[] | null;
    const error = message(() => dockerRig(call as unknown as Parameters<typeof dockerRig>[0], { env: { XDG_STATE_HOME: state, GSTACK_EVALS_DOCKER_BIN: docker }, skill: null, skills: {}, nonce: "n0nce42", cap: 1_000_000, voice: false, preflight: (images, at) => {
      keys = [...images.keys()];
      cleanRoomPreflight({ ...at, images, arms: ["none", "lens"], units: [{ task: UNITS[0]!.task, tree }] });
    } }));
    const log = calls(root);
    const last = (f: (c: string[]) => boolean) => log.map(f).lastIndexOf(true);
    const first = (f: (c: string[]) => boolean) => log.findIndex(f);
    const isRoom = (c: string[]) => c[0] === "run" && c.includes("clean-room");
    return { error, keys, tree, rooms: log.filter(isRoom), lastBuild: last((c) => c[0] === "build"), firstRoom: first(isRoom), lastRoom: last(isRoom), version: first((c) => c[0] === "version"), leases: ledgerStatus(record, ITEM)[0]!.leases, ledger: existsSync(join(root, "ledger.sqlite")) };
  };

  // Value: protects=the hook order: dockerRig builds the arm images, then runs the preflight over them (keyed arm and arm#calibration for bare arms) with the unit tree read-only, then opens the lease, here proven by the lease the approved item records and by the trial network step that follows it; fails_when=the preflight runs before the images exist, after the lease, or not at all; why_new=C1 wires cleanRoomPreflight into dockerRig's preflight hook; seam=dockerRig with GSTACK_EVALS_DOCKER_BIN on a fake docker, stopped at the trial network (Docker 20 is too old); no_claim=the proxy container and a session, which need real Docker
  test("the preflight runs after the arm images are built and before openLease", () => {
    const r = rig(false);
    expect(r.error).toMatch(/needs Docker Engine 28 or newer/);
    expect(r.keys).toEqual(["none", "none#calibration", "lens", "lens#calibration"]);
    expect(r.rooms.length).toBe(2);
    for (const c of r.rooms) expect([c.slice(0, 4), c.includes(r.tree + ":/work/" + UNITS[0]!.task + ":ro")]).toEqual([["run", "--rm", "--network", "none"], true]);
    expect([r.lastBuild >= 0, r.lastBuild < r.firstRoom, r.lastRoom < r.version]).toEqual([true, true, true]);
    expect([r.leases, r.ledger]).toEqual([1, true]);
  });

  // Value: protects=a clean-room refusal in dockerRig throws E_CLEAN_ROOM with the image digest and opens no lease: the approved item records no lease, the local ledger is never opened and no later step runs; fails_when=the lease opens before the check, or a refusal leaves a lease or a network behind; why_new=panel v3 section 4 (the preflight refuses before the lease opens, so the rerun uses the same unopened item); seam=dockerRig's preflight hook and undo; no_claim=the CLI's exit code for E_CLEAN_ROOM (2), which main maps from the E_ prefix
  test("a refusal leaves no lease opened", () => {
    const r = rig(true);
    expect(r.error).toMatch(new RegExp("^E_CLEAN_ROOM review-units: arm none image gstack-evals-arm:[0-9a-f]{16} \\(trial image digest sha256:" + ID + "\\): found " + AGENT_HOME + "/\\.local/share/gstack\\n  fix: "));
    expect([r.rooms.length, r.lastBuild < r.firstRoom, r.version, r.leases, r.ledger]).toEqual([1, true, -1, 0, false]);
  });
});
