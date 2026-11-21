// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 4's named harness repair: h2h_agent's home_owner=session step (h2h_home.py), off by default so h2h's
// sessions are unchanged, on in the /cso runner for arms with a home. The argv chowns each top-level path the copied home
// holds to the container's own user, symlinks changed and never followed; an empty home runs nothing. Plain python3.
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { CSO_BASE_IMAGE, csoRunCopy, type CsoSessionInput } from "../../lanes/outcome-skills/cso/run.ts";
import type { UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";

const SESSIONS = join(import.meta.dir, "../../lanes/outcome-skills/h2h/sessions");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "cso-home-owner-"));
  roots.push(d);
  return d;
};
const argv = (home: string): string[] => {
  const r = spawnSync("python3", ["-c", "import json,sys; from h2h_home import home_owner_argv; print(json.dumps(home_owner_argv('c1', sys.argv[1], '/root/')))", home], { cwd: SESSIONS, encoding: "utf8", env: { PATH: process.env.PATH ?? "", PYTHONPATH: SESSIONS, PYTHONDONTWRITEBYTECODE: "1" } });
  expect(r.stderr).toBe("");
  return JSON.parse(r.stdout) as string[];
};

test("home_owner_argv chowns every top-level home path to the container's own user, and an empty home runs nothing", () => {
  const home = tmp();
  mkdirSync(join(home, ".gstack"));
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude.json"), "{}");
  symlinkSync("/etc/passwd", join(home, "link"));
  expect(argv(home)).toEqual(["docker", "exec", "c1", "sh", "-c", 'chown -R -h "$(id -u):$(id -g)" "$@"', "sh", "/root/.claude", "/root/.claude.json", "/root/.gstack", "/root/link"]);
  expect(argv(tmp())).toEqual([]);
});

test("only the cso runner's arms with a home turn home_owner on", () => {
  const p = loadCsoPrereg();
  const base = { unit: { unit: "u1", tree_sha256: "a".repeat(64) } as UnitRecord, tree: "/t", image: { image_id: "sha256:" + "b".repeat(64), tag: "x:y", runtime_id: CSO_BASE_IMAGE, volume: "", commits: 1, head: "c".repeat(40), home: "none" as const, tree_patch_sha256: null, qa_home: null, removed: [] }, model: "opus" as const, stage: "stage0" as const, index: 0, control: "http://c", proxy: "p:1", out: "/o", runtime: { volume: "v", path: "/usr/bin" }, claude: "/opt/claude" };
  const ak = (i: CsoSessionInput) => csoRunCopy(i, 1, tmp(), p).argv.filter((a, n, all) => all[n - 1] === "--ak" && a.startsWith("home_owner="));
  expect(ak({ ...base, arm: "cso", home: { dir: "/homes/cso", home_tree_sha256: "d".repeat(64) } })).toEqual(["home_owner=session"]);
  expect(ak({ ...base, arm: "untold", home: { dir: "/homes/cso", home_tree_sha256: "d".repeat(64) } })).toEqual(["home_owner=session"]);
  expect(ak({ ...base, arm: "none", home: { dir: null, home_tree_sha256: "d".repeat(64) } })).toEqual([]);
});
