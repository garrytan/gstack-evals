// Copyright (c) 2026 Garry Tan. MIT License.
// The review container's user (run/docker.ts containerUser and sessionFolder): on a service running as root, as the
// ledger service does on the controller host, containers run as the host's run user and own their session folders, so
// C3, which refuses root, passes. A stand-in reads the ids; no Docker and no root needed.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containerUser, sessionFolder } from "../../../lanes/design-constructed/run/docker.ts";

const dir = mkdtempSync(join(tmpdir(), "dc-user-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the review container's user", () => {
  test("a service whose uid is 0 runs containers as the host's run user; any other service as itself; no run user refuses", () => {
    const ids = (flag: "-u" | "-g") => ({ status: 0, stdout: flag === "-u" ? "1001\n" : "1002\n" });
    expect(containerUser({ uid: 0, gid: 0 }, ids)).toBe("1001:1002");
    expect(containerUser({ uid: 1000, gid: 1000 }, ids)).toBe("1000:1000");
    expect(() => containerUser({ uid: 0, gid: 0 }, () => ({ status: 1, stdout: "" }))).toThrow("has no run user");
  });

  test("a session folder goes to its owner, and an owner chown refuses stops the session", () => {
    const unit = { repo: join(dir, "repo"), plan: join(dir, "plan.md"), context: join(dir, "context") };
    mkdirSync(unit.repo);
    mkdirSync(unit.context);
    writeFileSync(join(unit.repo, "a.txt"), "a\n");
    writeFileSync(unit.plan, "plan\n");
    const me = process.getuid!() + ":" + process.getgid!();
    const s = sessionFolder(unit, join(dir, "s1"), me);
    expect(statSync(join(s, "repo", "a.txt")).uid).toBe(process.getuid!());
    expect(() => sessionFolder(unit, join(dir, "s2"), "no-such-user-dc:no-such-group-dc")).toThrow("could not give session folder");
  });
});
