// Copyright (c) 2026 Garry Tan. MIT License.
// The shared miner and the unit builder (devex prereg sections 3, 4 and 15 rule 7): the dry-run lines, the Python
// regex port and part B's rules on examples both ways, and the GitHub client's floor and points.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openGitHub } from "../../../lanes/aftermath/gh.ts";
import { checks } from "../../../lanes/devex/mine/checks.ts";
import { cleanBody, devClasses, isBreaking, isSource, PART_B, sizeRule, stratum, titleExcluded, uiClasses, wordCount } from "../../../lanes/devex/mine/frame.ts";
import { py } from "../../../lanes/devex/mine/pyre.ts";
import { earliestBefore, excludedDigests } from "../../../lanes/devex/mine/units.ts";
import { keepCandidate } from "../../../lanes/devex/mine/window.ts";

const ROOT = join(import.meta.dir, "../../..");

describe("dry-run lines", () => {
  test("every line passes", async () => {
    const lines = await checks();
    expect(lines.length).toBe(15);
    for (const l of lines) expect({ rule: l.rule, pass: l.pass }).toEqual({ rule: l.rule, pass: true });
  });
});

describe("fixtures", () => {
  test("frame-part-b.txt is part B's two code blocks byte for byte", () => {
    const md = readFileSync(join(ROOT, "wiki/plans/2026-11-09-geva-420-design-review-intentions-prereg/frame-rules.md"), "utf8");
    const b = md.slice(md.indexOf("## B."), md.indexOf("## C."));
    const blocks = [...b.matchAll(/\x60\x60\x60\n([\s\S]*?)\x60\x60\x60/g)].map((m) => m[1]).join("");
    expect(PART_B).toBe(blocks);
  });
  test("excluded digests: the seed and 38 units, sha256 as FIXTURES.md says", () => {
    const t = readFileSync(join(ROOT, "lanes/devex/mine/excluded-digests.txt"));
    expect(createHash("sha256").update(t).digest("hex")).toBe("a3b6ec2501ffa857fe1b75dfe9d55b21d63ed1d169d2b864dee9eaa72db301fd");
    expect(excludedDigests().size).toBe(38);
  });
});

describe("Python re semantics", () => {
  test("\\b and \\w are Unicode, . matches \\r, $ matches before a final newline", () => {
    expect(py("\\bcaf\\b").test("café")).toBe(false);
    expect(/\bcaf\b/.test("café")).toBe(true);
    expect(py("a.b").test("a\rb")).toBe(true);
    expect(py("x$").test("x\n")).toBe(true);
    expect(py("x$").test("x\ny")).toBe(false);
    expect(py("(?im)^b").test("a\nB")).toBe(true);
    expect(py("(?im)^b").test("a\rb")).toBe(false);
  });
});

describe("part B rules both ways", () => {
  test("title and label filter with KEEP_START", () => {
    expect(titleExcluded("feat: add docs command", [])).toBe(false);
    expect(titleExcluded("feat: fix the docs command", [])).toBe(true);
    expect(titleExcluded("Update docs for install", [])).toBe(true);
    expect(titleExcluded("Support YAML config", ["enhancement"])).toBe(false);
    expect(titleExcluded("Support YAML config", ["dependencies"])).toBe(true);
  });
  test("word count drops comments, images and URLs", () => {
    expect(wordCount("one two <!-- three four --> ![img](x.png) https://a.b/c five")).toBe(3);
  });
  test("source, test and size rules", () => {
    expect(isSource("src/app.ts")).toBe(true);
    expect(isSource("src/app.test.ts")).toBe(false);
    expect(isSource("vendor/x.go")).toBe(false);
    expect(isSource("README.md")).toBe(false);
    expect(sizeRule([{ path: "src/a.ts", additions: 1 }, { path: "src/b.ts", additions: 1 }])).toBe(true);
    expect(sizeRule([{ path: "src/a.ts", additions: 39 }, { path: "tests/b.ts", additions: 100 }])).toBe(false);
    expect(sizeRule([{ path: "src/a.ts", additions: 40 }])).toBe(true);
  });
  test("class rules", () => {
    const pr = (title: string, body = "", files: string[] = []) => ({ title, labels: [], body, files: files.map((path) => ({ path, additions: 10 })) });
    expect(devClasses(pr("Add the sync subcommand"))).toEqual(["CLI"]);
    expect(devClasses(pr("Improve speed"))).toEqual([]);
    expect(devClasses(pr("Add POST endpoint", "POST /v1/items"))).toEqual(["API"]);
    expect(devClasses(pr("misc", "", ["src/config/schema.ts"]))).toEqual(["CONFIG"]);
    expect(isBreaking({ title: "feat!: drop old flag", labels: [], body: "" })).toBe(true);
    expect(isBreaking({ title: "x", labels: [], body: "Breaking changes: none" })).toBe(false);
    expect(isBreaking({ title: "x", labels: [], body: "This is a breaking change for users" })).toBe(true);
    expect(isBreaking({ title: "x", labels: [], body: "no breaking change here" })).toBe(false);
    expect(cleanBody("a\n- [ ] todo\n$ run\nb")).toBe("a\nb");
    expect(uiClasses(pr("New settings page", "", ["src/pages/settings.tsx"]), { topics: [], stratum: null })).toEqual(["WEB"]);
    expect(uiClasses(pr("New settings page", "", ["src/pages/settings.tsx"]), { topics: [], stratum: "desktop" })).toEqual(["DESKTOP"]);
    expect(uiClasses(pr("Faster parser", "", ["src/pages/settings.tsx"]), { topics: [], stratum: null })).toEqual([]);
    expect(stratum(["electron", "react"])).toBe("desktop");
    expect(stratum(["cli"])).toBe(null);
  });
  test("screen rule 2 drops", () => {
    for (const bad of ["abc", "true", "--help", "1234", "v1.2.3", "#123", "deadbeef1", "a=b", "two words here", "src/app.ts", "test_thing", "a_b_c_d_e_f"]) expect(keepCandidate(bad)).toBe(false);
    for (const good of ["--output-format", "/api/v1/items", "export_format", "client.connect", "zork sync"]) expect(keepCandidate(good)).toBe(true);
  });
  test("earliest recoverable version before the merge", () => {
    const h = { created_at: "2026-07-01T00:00:00Z", current: "new", last_edited_at: "2026-08-01T00:00:00Z", edits: [{ at: "2026-08-01T00:00:00Z", text: "new" }, { at: "2026-07-01T00:00:00Z", text: "old" }] };
    expect(earliestBefore(h, "2026-07-15T00:00:00Z")).toBe("old");
    expect(earliestBefore({ ...h, edits: [] }, "2026-07-15T00:00:00Z")).toBe(null);
    expect(earliestBefore({ ...h, edits: [], last_edited_at: null }, "2026-07-15T00:00:00Z")).toBe("new");
  });
});

describe("GitHub client", () => {
  test("waits for the reset under the floor, counts points, never retries when tries is 1", () => {
    const slept: number[] = [];
    let n = 0;
    const gh = openGitHub({ floor: 2500, tries: 1, backoffMs: () => 0, paceMs: 1000, now: () => 0, sleep: (ms) => slept.push(ms), exec: () => (n++, { status: 0, stdout: JSON.stringify({ data: { rateLimit: { cost: 3, remaining: 2400, resetAt: new Date(60_000).toISOString() } } }), stderr: "" }) });
    gh.graphql("q");
    expect(gh.pointsUsed()).toBe(3);
    expect(slept).toEqual([65_000]);
    const bad = openGitHub({ floor: 1, tries: 1, backoffMs: () => 0, paceMs: 0, exec: () => (n++, { status: 1, stdout: "", stderr: "502 bad gateway" }) });
    const before = n;
    expect(() => bad.rest("x")).toThrow();
    expect(n - before).toBe(1);
  });
});
