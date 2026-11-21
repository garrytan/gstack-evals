// Copyright (c) 2026 Garry Tan. MIT License.
// Section 3, gate 2's named repair (units/build.ts checkoutTree), keyless on local repositories: a promisor remote that
// lacks a blob makes the blobless clone's checkout fail; one full re-clone from a remote that has it checks out; a remote
// that never has it is the fetch gate's drop with its own code, E_CSO_DROP_FETCH_LAZY.
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutTree, fetchUnit } from "../../lanes/outcome-skills/cso/units/build.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "cso-checkout-"));
  roots.push(d);
  return d;
};
const g = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "protocol.file.allow=always", ...a], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (r.status !== 0) throw new Error(a.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
};

/** A full repository with a parent and a fix commit, and a copy of it that holds no blobs and can fetch none. */
function remotes() {
  const d = tmp();
  const full = join(d, "full");
  mkdirSync(full);
  g(full, "init", "-q", "-b", "main");
  writeFileSync(join(full, "a.js"), "module.exports = 1;\n");
  g(full, "add", "-A");
  g(full, "commit", "-q", "-m", "parent");
  const parent = g(full, "rev-parse", "HEAD");
  writeFileSync(join(full, "a.js"), "module.exports = 2;\n");
  g(full, "commit", "-q", "-am", "fix");
  const fix = g(full, "rev-parse", "HEAD");
  g(full, "config", "uploadpack.allowFilter", "true");
  const hollow = join(d, "hollow.git");
  g(d, "clone", "-q", "--bare", "--filter=blob:none", "file://" + full, hollow);
  g(hollow, "config", "--unset", "remote.origin.promisor");
  g(hollow, "config", "--unset", "remote.origin.partialclonefilter");
  g(hollow, "remote", "remove", "origin");
  g(hollow, "config", "uploadpack.allowFilter", "true");
  g(hollow, "config", "uploadpack.allowAnySHA1InWant", "true");
  return { full: "file://" + full, hollow: "file://" + hollow, fix, parent };
}

test("a lazy fetch the promisor refuses re-clones once in full and checks out", () => {
  const r = remotes();
  const work = tmp();
  let calls = 0;
  const remote = () => (calls++ === 0 ? r.hollow : r.full);
  expect("dir" in fetchUnit(work, "o/r", r.fix, r.parent, remote)).toBe(true);
  const out = join(work, "trees", "u1");
  const got = checkoutTree(work, "o/r", r.fix, r.parent, out, remote);
  expect("tree" in got && got.refetched).toBe(true);
  expect(existsSync(join(out, "a.js"))).toBe(true);
  expect(calls).toBe(2);
});

test("a checkout that fails again after the full re-clone is the fetch gate's drop, and leaves no tree", () => {
  const r = remotes();
  const work = tmp();
  expect("dir" in fetchUnit(work, "o/r", r.fix, r.parent, () => r.hollow)).toBe(true);
  const out = join(work, "trees", "u1");
  const got = checkoutTree(work, "o/r", r.fix, r.parent, out, () => r.hollow);
  expect("why" in got && got.why).toContain("again after a full re-clone");
  expect(existsSync(out)).toBe(false);
});

test("a blobless clone whose promisor has the blob checks out on the first try", () => {
  const r = remotes();
  const work = tmp();
  expect("dir" in fetchUnit(work, "o/r", r.fix, r.parent, () => r.full)).toBe(true);
  const got = checkoutTree(work, "o/r", r.fix, r.parent, join(work, "trees", "u1"), () => r.full);
  expect("tree" in got && got.refetched).toBe(false);
});
