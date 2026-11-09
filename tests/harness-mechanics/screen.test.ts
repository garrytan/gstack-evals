// Copyright (c) 2026 Garry Tan. MIT License.
// The task-fit screen, keyless: detect's outputs both ways, the replacement draw (spare order, the per-repository limit,
// scored first, positions kept, a short split), the digests against draw.txt, a fake docker, and the VM preflight.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleLists, REPO, sha256, UBI_RUNNER, unscreenedText } from "../../lanes/harness-mechanics/pins.ts";
import { classifyDetect, dockerDetect, imageRef, pool, screen, screenLists, screenVm, sortedDigest, type Detect } from "../../lanes/harness-mechanics/screen.ts";

const l = bundleLists(), p = pool(), repo = (t: string) => p.get(t)!.repo;
const CHECK: Detect = { status: "check", detail: "CHECK test" }, NONE: Detect = { status: "none", detail: "CHECKS: none" };
const tmp = () => mkdtempSync(join(tmpdir(), "hm-screen-"));

describe("detect", () => {
  test("CHECKS: none and a failed run replace; a listed check or tests only keep; no pregate context is neither", () => {
    expect(classifyDetect(0, "CHECKS: none (no gstack:verify: line); nothing to run\n", "").status).toBe("none");
    expect(classifyDetect(0, "CHECK test pytest -q  (manifest)\nTRUST untrusted\n", "").status).toBe("check");
    expect(classifyDetect(0, "CHECKS: tests only (no gstack:verify: line)\nTESTS pregate\n", "").status).toBe("check");
    expect(classifyDetect(3, "", "gstack-checks: no pregate context, so tests cannot be selected").status).toBe("no-context");
    expect(classifyDetect(125, "", "docker: exec format error").status).toBe("broken");
    expect(classifyDetect(0, "", "").status).toBe("broken");
  });
});

describe("replacements", () => {
  test("with every task fit the lists are unchanged and the digests are draw.txt's", () => {
    const r = screen(tmp(), () => CHECK);
    expect(r.replacements).toEqual([]);
    expect(r.sha256).toBe(sha256(unscreenedText(l)));
    const draw = readFileSync(join(REPO, "wiki/plans/2026-11-09-geva-448-harness-mechanics-prereg/draw.txt"), "utf8");
    expect(draw).toContain(sortedDigest(l.scored.slice(0, 60)));
    expect(draw).toContain(sortedDigest(l.calibration.slice(0, 12)));
    expect(r.lines.at(-1)).toStartWith("SCREEN drop3-first-180 180 sorted sha256 " + sortedDigest(l.scored.slice(0, 180)));
  });
  test("first fitting spare in file order, skipping unfit spares and full repositories; scored draws first; positions kept", () => {
    const full = l.spare.find((s) => l.scored.filter((t) => repo(t) === repo(s)).length >= 4);
    const bad = new Map<string, Detect>([[l.scored[3]!, NONE], [l.scored[50]!, { status: "broken", detail: "pull failed" }], [l.calibration[0]!, NONE], [l.spare[0]!, NONE]]);
    const r = screenLists(l, repo, (t) => bad.get(t) ?? CHECK);
    const okSpares = l.spare.filter((s) => s !== l.spare[0]);
    expect(r.replacements.map((x) => [x.split, x.position, x.replaced])).toEqual([["scored", 4, l.scored[3]], ["scored", 51, l.scored[50]], ["calibration", 1, l.calibration[0]]]);
    const scoredBy = r.replacements.slice(0, 2).map((x) => x.by!);
    const fit = (s: string, xs: string[]) => xs.filter((t) => repo(t) === repo(s)).length < 4;
    expect(scoredBy[0]).toBe(okSpares.find((s) => fit(s, l.scored.filter((t, i) => i !== 3 && i !== 50)))!);
    expect(r.scored[3]).toBe(scoredBy[0]);
    expect(r.scored[50]).toBe(scoredBy[1]);
    expect(r.calibration[0]).toBe(r.replacements[2]!.by!);
    expect(scoredBy).not.toContain(l.spare[0]);
    if (full) expect([...scoredBy, r.replacements[2]!.by]).not.toContain(full);
    expect(r.scored.length).toBe(200);
  });
  test("when no spare fits the split runs short and the count prints; no pregate context writes nothing", () => {
    const out = tmp();
    const r = screen(out, (t) => (t === l.calibration[5] || l.spare.includes(t) ? NONE : CHECK));
    expect(r.calibration.length).toBe(39);
    expect(r.lines).toContain("SCREEN short calibration 39 of 40");
    expect(r.lines.some((x) => x.startsWith("SCREEN replace calibration 6 " + l.calibration[5] + " (none: CHECKS: none) -> none: no spare fits"))).toBe(true);
    expect(readFileSync(join(out, "screened.txt"), "utf8").split("\n").filter(Boolean).length).toBe(239);
    const out2 = tmp();
    expect(() => screen(out2, () => ({ status: "no-context", detail: "no pregate context" }))).toThrow("E_HM_SCREEN");
  });
});

describe("docker", () => {
  const fake = (dir: string) => {
    const f = join(dir, "docker");
    writeFileSync(f, ["#!/usr/bin/env bash", 'echo "$*" >> ' + dir + "/calls", 'ref=""; for a in "$@"; do case "$a" in *@sha256:*) ref="$a";; esac; done', 'd=${ref##*@sha256:}',
      'case "$1" in', '  pull) if [ -e ' + dir + '/limit-$d ]; then rm ' + dir + '/limit-$d; echo "toomanyrequests: rate limit" >&2; exit 1; fi; [ -e ' + dir + '/nopull-$d ] && { echo "manifest unknown" >&2; exit 1; }; exit 0;;',
      '  run) if [ -e ' + dir + '/none-$d ]; then echo "CHECKS: none (no gstack:verify: line); nothing to run"; else echo "CHECK test pytest  (manifest)"; fi; exit 0;;', '  rmi) exit 0;;', "esac"].join("\n"));
    chmodSync(f, 0o755);
    return f;
  };
  test("a fake docker both ways: none, a refused pull, a pull limit waited out, and a check", () => {
    const dir = tmp(), docker = fake(dir), t = [...p.values()].slice(0, 4), d = (x: any) => x.image_digest.slice(7);
    writeFileSync(join(dir, "none-" + d(t[0])), ""); writeFileSync(join(dir, "nopull-" + d(t[1])), ""); writeFileSync(join(dir, "limit-" + d(t[2])), "");
    process.env.HM_PULL_WAIT_SEC = "0";
    const logs: string[] = [];
    const got = t.map((x) => dockerDetect(imageRef(x), { docker, gstack: "/opt/none", log: (s) => logs.push(s) }).status);
    expect(got).toEqual(["none", "broken", "check", "check"]);
    expect(logs).toEqual(["SCREEN wait Docker Hub's pull limit for " + imageRef(t[2])]);
    const calls = readFileSync(join(dir, "calls"), "utf8");
    expect(calls).toContain("run --rm --network none --entrypoint  -v /opt/none:/opt/hm-gstack:ro");
    expect(calls).toContain("-w /testbed " + imageRef(t[0]) + " /opt/hm-bun --no-env-file --config=/dev/null /opt/hm-gstack/bin/gstack-checks detect");
    expect(imageRef(t[0])).toMatch(/^swerebench\/[^:@]+@sha256:[0-9a-f]{64}$/);
  });
});

describe("screen VM shape", () => {
  test("refuses without the pinned ubi-runner.sh, UBI_OWNER or the vms ledger, before any VM call", () => {
    const keep = { ...process.env };
    try {
      delete process.env.UBI_RUNNER;
      expect(() => screenVm("start", tmp())).toThrow("E_USAGE hm screen-vm: set UBI_RUNNER");
      const f = join(tmp(), "ubi-runner.sh"); writeFileSync(f, "#!/bin/sh\nexit 1\n");
      process.env.UBI_RUNNER = f;
      expect(() => screenVm("start", tmp())).toThrow("not the pinned " + UBI_RUNNER.sha256);
      process.env.UBI_RUNNER = join(REPO, UBI_RUNNER.file); process.env.UBI_OWNER = "";
      expect(() => screenVm("start", tmp())).toThrow("set UBI_OWNER");
      process.env.UBI_OWNER = "TEST-1"; delete process.env.LEDGER;
      expect(() => screenVm("start", tmp())).toThrow("set LEDGER to the vms item's ledger");
    } finally { process.env = keep; }
  });
});
