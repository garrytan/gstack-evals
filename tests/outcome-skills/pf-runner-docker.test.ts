// Copyright (c) 2026 Garry Tan. MIT License.
// Docker test for the entry runner (GSTACK_EVALS_DOCKER=1 and PF_DOCKER_IMAGE, an image with bash, coreutils, sh and
// git): three real trees on an invented repo, built over a prepared tree volume seeded from its base, fresh containers per
// run with no network, the catch rule, a hang that times out, and a fix-tree rebuild failure.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerExecutor, scoreEntries } from "../../lanes/outcome-skills/pfchecks/runner.ts";
import { buildTrees } from "../../lanes/outcome-skills/pfchecks/trees.ts";

const IMAGE = process.env.PF_DOCKER_IMAGE ?? "";
const on = process.env.GSTACK_EVALS_DOCKER === "1" && !!IMAGE;
const g = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" }).stdout;
const cleanups: Array<() => void> = [];
afterAll(() => cleanups.forEach((c) => c()));

describe.skipIf(!on)("pf runner in Docker", () => {
  test("catches, rules out, times out and gaps", async () => {
    const d = mkdtempSync(join(tmpdir(), "pf-dock-"));
    g(d, "init", "-q", "-b", "main");
    writeFileSync(join(d, "state.go"), "bug\n");
    g(d, "add", "-A");
    g(d, "commit", "-q", "-m", "base");
    g(d, "checkout", "-q", "-b", "f");
    writeFileSync(join(d, "state.go"), "fixed\n");
    g(d, "commit", "-q", "-am", "fix");
    const patch = g(d, "diff", "main", "f");
    g(d, "checkout", "-q", "main");
    const baseDir = mkdtempSync(join(tmpdir(), "pf-dock-base-"));
    cpSync(d, baseDir, { recursive: true });
    const base = "pf-dock-base-" + process.pid;
    spawnSync("docker", ["volume", "create", base]);
    cleanups.push(() => spawnSync("docker", ["volume", "rm", "-f", base]));
    expect(spawnSync("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", baseDir + ":/s:ro", "-v", base + ":/d", "--entrypoint", "sh", IMAGE, "-c", "cp -a /s/. /d/"]).status).toBe(0);
    writeFileSync(join(d, "check_test.sh"), "test \"$(head -n 2 state.go | tail -n 1)\" = fixed || test \"$(cat state.go)\" = fixed\n");
    g(d, "add", "-A");
    g(d, "commit", "-q", "-m", "session end");
    const t = buildTrees({ repo: d, ref: "HEAD", lang: "go", testFiles: new Set(), fixPatch: patch, neutral: { mode: "end", files: ["state.go"] } });
    const ex = dockerExecutor({ repo: d, image: IMAGE, base, repoDir: "/repo", mode: "root", rebuild: ["test -f state.go"] });
    cleanups.push(ex.cleanup);
    const entries = [{ index: 0, command: "test \"$(cat state.go)\" = fixed" }, { index: 1, command: "true" }, { index: 2, command: "grep -q bug state.go && sleep 60 || true" }, { index: 3, command: "curl -s https://example.com || exit 1" }];
    const r = await scoreEntries(entries, ex, { trees: { parent: t.parent, fix: t.fix!, neutral: t.neutral }, timeout_s: 3, exempt: false });
    expect(r.results.map((x) => x.outcome)).toEqual(["catch", "no_catch", "catch", "no_catch"]);
    expect(r.results[2]!.runs[0]!.timed_out).toBe(true);
    const gap = dockerExecutor({ repo: d, image: IMAGE, base, repoDir: "/repo", mode: "root", rebuild: ["grep -q bug state.go"] });
    cleanups.push(gap.cleanup);
    const rg = await scoreEntries([entries[0]!], gap, { trees: { parent: t.parent, fix: t.fix!, neutral: t.neutral }, timeout_s: 30, exempt: false });
    expect(rg.results[0]!.outcome).toBe("gap");
  }, 600_000);
});
