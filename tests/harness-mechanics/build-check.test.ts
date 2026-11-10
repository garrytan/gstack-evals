// Copyright (c) 2026 Garry Tan. MIT License.
// hm build-check, keyless and both ways: the error line a failed build reports and the rule a built image must meet
// (WORKDIR /testbed, pwd /testbed with no -w, origin/main equal to HEAD there). The live check is hm build-check.
import { describe, expect, test } from "bun:test";
import { buildError, buildProblems } from "../../lanes/harness-mechanics/build-check.ts";

const C = "0123456789abcdef0123456789abcdef01234567";
const good = { task: "holoviz__holoviews-6783", workdir: "/testbed", pwd: "/testbed", main: C, head: C };
// The shape of BuildKit's plain progress when the origin RUN runs outside a git tree, as Stage 1's 92 cells failed.
const PLAIN = [
  "#12 [stage-2 7/7] RUN O=\"${HM_ORIGIN:-/opt/hm-origin.git}\"; if git remote get-url origin >/dev/null 2>&1; then ...",
  "#12 0.104 fatal: not a git repository (or any of the parent directories): .git",
  "#12 ERROR: process \"/bin/bash -c O=...\" did not complete successfully: exit code: 128",
  "------",
  " > [stage-2 7/7] RUN O=...:",
  "0.104 fatal: not a git repository (or any of the parent directories): .git",
  "------",
  "ERROR: failed to build: failed to solve: process \"/bin/bash -c O=...\" did not complete successfully: exit code: 128",
].join("\n");

describe("hm build-check", () => {
  test("a failed build reports the step's fatal line, else its error line, else the last line", () => {
    expect(buildError(PLAIN)).toBe("0.104 fatal: not a git repository (or any of the parent directories): .git");
    expect(buildError("#5 ERROR: pull access denied\nERROR: failed to build: failed to solve: x")).toBe("#5 ERROR: pull access denied");
    expect(buildError("ERROR: failed to build: failed to solve: x\n")).toBe("ERROR: failed to build: failed to solve: x");
  });
  test("a built image passes only with WORKDIR /testbed, pwd /testbed and origin/main equal to HEAD", () => {
    expect(buildProblems(good)).toEqual([]);
    expect(buildProblems({ ...good, workdir: "" })).toEqual(['WORKDIR is "", not /testbed']);
    expect(buildProblems({ ...good, pwd: "/" })).toEqual(['pwd with no -w is "/", not /testbed']);
    expect(buildProblems({ ...good, main: "" })).toEqual(["origin/main missing is not HEAD " + C]);
    expect(buildProblems({ ...good, head: C.replace("0", "f") })).toEqual(["origin/main " + C + " is not HEAD " + C.replace("0", "f")]);
    expect(buildProblems({ ...good, main: "fatal: not a git repository", head: undefined })).toEqual(["origin/main fatal: not a git repository is not HEAD ?"]);
    expect(buildProblems({ task: good.task, error: "build failed: 0.104 fatal: not a git repository" })).toEqual(["build failed: 0.104 fatal: not a git repository"]);
  });
});
