// Copyright (c) 2026 Garry Tan. MIT License.
// er render: the eng phase arm's opening (prereg 2026-11-08-geva-405 section 5, gate answer A1) from the gstack clone at
// ~/.capy/work/gstack, through worktrees at the eng phase pin and at the pre-cut pin. Keyless; the plans are invented.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeTree } from "../../src/trial/cleanup.ts";
import { ER_ENGPHASE_GSTACK, placeOpeningFile, renderEngPhase, run, section, skipList } from "../../lanes/eng-review/render.ts";

const CLONE = join(homedir(), ".capy", "work", "gstack");
const PRECUT = "b493d4e31ac9619ef7e52e176d590ad4f454cd66";
const HAVE = existsSync(join(CLONE, ".git")) && spawnSync("git", ["-C", CLONE, "cat-file", "-e", ER_ENGPHASE_GSTACK.sha + "^{commit}"]).status === 0;
if (!HAVE) console.log("er render tests skipped: no gstack clone with " + ER_ENGPHASE_GSTACK.sha + " at " + CLONE);

const sha = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const roots: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "er-render-test-"));
  roots.push(d);
  return d;
};
const git = (...args: string[]) => spawnSync("git", ["-C", CLONE, ...args], { encoding: "utf8" });
const worktree = (at: string) => {
  const dir = join(scratch(), "gstack");
  if (HAVE) git("worktree", "add", "--detach", dir, at);
  return dir;
};
const PIN = worktree(ER_ENGPHASE_GSTACK.sha);
const OLD = worktree(PRECUT);
afterAll(() => {
  for (const d of [PIN, OLD]) if (HAVE) git("worktree", "remove", "--force", d);
  roots.forEach((r) => removeTree(r));
});
const atPin = (path: string) => readFileSync(join(PIN, path), "utf8");
const render = (plan: string, gstack = PIN) => (HAVE ? renderEngPhase({ gstack, plan, out: join(scratch(), "out") }) : ({ files: [], text: "" } as unknown as ReturnType<typeof renderEngPhase>));
const bodies = (r: ReturnType<typeof render>) => Object.fromEntries(r.files.map((f) => [f.name, readFileSync(f.host, "utf8")]));

const PLAIN = "Add a five-minute cache in front of the parcel lookup in src/lookup.ts.\n\nInvalidate an entry when a parcel's status changes.\n";
const OWN_HEADINGS = "# Parcel lookup cache\n\n## Goals\n\nFaster lookups for the tracking page.\n\n## Steps\n\n1. Wrap lookupParcel in a cache.\n2. Clear it on status change.\n";
const WRAPPED = "<!-- note -->\n## Implementation plan\n\nWrap lookupParcel in a cache and clear it on status change.\n\n## Review record\n\nEarlier note: keep the TTL short.\n";

describe.skipIf(!HAVE)("er render at the eng phase pin", () => {
  const r = render(PLAIN);
  const f = bodies(r);

  test("the opening carries the four autoplan parts verbatim and stops at their edges", () => {
    const skill = atPin("autoplan/SKILL.md");
    for (const part of [section(skill, "## The 6 Decision Principles"), section(skill, "## Decision Classification"), section(skill, '## What "Auto-Decide" Means'), skipList(skill)]) expect(r.text).toContain(part);
    expect(r.text).toContain("**Eng phase:** P5 (explicit) + P3 (pragmatic) dominate.");
    expect(r.text).toContain("- Next Steps — Review Chaining");
    expect(r.text).toContain("Follow ONLY the review-specific methodology, sections and required outputs.");
    for (const outside of ["## Sequential Execution", "## Filesystem Boundary", "Here's what I'm working with", "Resolve this phase's source", "## Phase 0.5"]) expect(r.text).not.toContain(outside);
  });

  test("eng-phase.md goes in in full", () => {
    expect(r.text).toContain(atPin("autoplan/sections/eng-phase.md"));
    expect(r.text.endsWith(atPin("autoplan/sections/eng-phase.md"))).toBe(true);
  });

  test("earlier phases read skipped, the outside voice unavailable, and the left-out steps are named", () => {
    for (const phase of ["Phase 1 (CEO review): skipped", "Phase 2 (Design review): skipped", "Phase 2.5 (DX review): skipped"]) expect(r.text).toContain(phase + ". No earlier phase ran.");
    expect(r.text).toContain("Outside voice (Codex): unavailable");
    expect(r.text).toContain("phase-close, amend-input, review logs, the plan-reality check and the Phase 4 gate");
    expect(r.text).toContain("gstack 199931029 (VERSION 1.98.0.0)");
  });

  test("the session is told to Read methodology.md at every readRanges offset through its last line", () => {
    expect(r.methodology).toBe("/work/autoplan/methodology.md");
    const lines = f["methodology.md"]!.split("\n").length;
    expect(r.readRanges[0]!.offset).toBe(1);
    const last = r.readRanges[r.readRanges.length - 1]!;
    expect(last.offset + last.limit - 1).toBe(lines);
    for (const x of r.readRanges) expect(r.text).toContain("- offset " + x.offset + ", limit " + x.limit);
    expect(JSON.parse(f["methodology.json"]!).readRanges.map((x: any) => ({ offset: x.offset, limit: x.limit }))).toEqual(r.readRanges);
    expect(r.text).toContain("Read methodologyPath at every readRanges offset/limit, including the final chunk");
  });

  test("files land read-only with their digests and container mounts", () => {
    expect(r.files.map((x) => x.name)).toEqual(["methodology.md", "methodology.json", "eng-implementation.md", "source-implementation.md", "native-prompt.md", "snapshot.json"]);
    for (const x of r.files) {
      expect(x.mount).toBe("/work/autoplan/" + x.name);
      expect(x.sha256).toBe(sha(readFileSync(x.host)));
      expect(statSync(x.host).mode & 0o777).toBe(0o444);
    }
  });

  test("identities that hang on rewritten bytes match the mounted files", () => {
    const s = JSON.parse(f["snapshot.json"]!);
    const m = JSON.parse(f["methodology.json"]!);
    expect(s.snapshotPath).toBe("/work/autoplan/eng-implementation.md");
    expect(s.activePlan).toBe("/work/plan.md");
    expect(s.methodology.sha256).toBe(sha(f["methodology.md"]!));
    expect(m.sha256).toBe(sha(f["methodology.md"]!));
    expect(s.methodology.manifestSha256).toBe(sha(f["methodology.json"]!));
    expect(s.nativePromptSha256).toBe(sha(f["native-prompt.md"]!));
    expect(s.nativePromptBytes).toBe(Buffer.byteLength(f["native-prompt.md"]!));
    expect(s.nativePromptLines).toBe(f["native-prompt.md"]!.split("\n").length);
    expect(s.nativeDispatchPrompt).toContain('Read file: "/work/autoplan/native-prompt.md"');
    expect(s.nativeDispatchPrompt).toContain("SHA-256 " + s.nativePromptSha256);
    expect(f["native-prompt.md"]).toContain('Input path: "/work/autoplan/eng-implementation.md"');
    expect(m.restoreSha256).toBe(sha(PLAIN));
    const bytes = readFileSync(r.files[0]!.host);
    for (const src of m.sources) expect(sha(bytes.subarray(src.startByte, src.endByte).toString("utf8"))).toBe(src.sha256);
    expect(m.sources.map((x: any) => x.path)).toEqual(["~/.claude/skills/gstack/plan-eng-review/SKILL.md", "~/.claude/skills/gstack/plan-eng-review/sections/review-sections.md"]);
  });

  test("no host path leaks into the opening or a mounted file", () => {
    const hosts = [PIN, resolve(PIN), homedir(), join(tmpdir(), "er-render-"), dirname0(r.files[0]!.host)];
    for (const body of [r.text, ...Object.values(f)]) for (const h of hosts) expect(body.includes(h)).toBe(false);
    const walk = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(walk) : []);
    for (const name of ["snapshot.json", "methodology.json"]) for (const s of walk(JSON.parse(f[name]!))) if (s.startsWith("/")) expect(s.startsWith("/work/")).toBe(true);
  });

  test("the same checkout and plan give the same digest and files; another plan does not", () => {
    const again = render(PLAIN);
    expect(again.sha256).toBe(r.sha256);
    expect(again.files.map((x) => x.sha256)).toEqual(r.files.map((x) => x.sha256));
    const other = render(PLAIN + "\nAlso log cache misses.\n");
    expect(other.files.find((x) => x.name === "eng-implementation.md")!.sha256).not.toBe(r.files.find((x) => x.name === "eng-implementation.md")!.sha256);
  });

  test("a resume renders into the same out: equal files are reused, another plan's are refused (F10)", () => {
    const out = join(scratch(), "out");
    const first = renderEngPhase({ gstack: PIN, plan: PLAIN, out });
    const again = renderEngPhase({ gstack: PIN, plan: PLAIN, out });
    expect(again.files).toEqual(first.files);
    expect(() => renderEngPhase({ gstack: PIN, plan: PLAIN + "\nAlso log cache misses.\n", out })).toThrow(/^E_EB_CACHE_STALE opening file /);
  });

  test("a plan with no headings at all is wrapped whole", () => {
    expect(f["eng-implementation.md"]).toBe(PLAIN);
    expect(r.text).toContain("It has no Implementation plan and Review record headings of its own");
  });

  test("a plan with headings of its own but not the tool's is wrapped whole", () => {
    const o = render(OWN_HEADINGS);
    expect(bodies(o)["eng-implementation.md"]).toBe(OWN_HEADINGS);
    expect(o.text).toContain("It has no Implementation plan and Review record headings of its own");
  });

  test("a plan with both of the tool's headings keeps them, and only its Implementation plan reaches the snapshot", () => {
    const o = render(WRAPPED);
    const impl = bodies(o)["eng-implementation.md"]!;
    expect(impl).toContain("Wrap lookupParcel in a cache");
    expect(impl).not.toContain("keep the TTL short");
    expect(o.text).toContain('The snapshot tool read its "## Implementation plan" section.');
  });

  test("a plan with only one of the tool's headings is refused", () => {
    expect(() => render("## Implementation plan\n\nWrap lookupParcel in a cache.\n")).toThrow(/^E_USAGE plan\.md does not fit/);
  });

  test("an out dir inside this repository is refused", () => {
    expect(() => renderEngPhase({ gstack: PIN, plan: PLAIN, out: join(import.meta.dir, "render-out-never") })).toThrow(/^E_USAGE out dir .* inside the gstack-evals repository/);
    expect(existsSync(join(import.meta.dir, "render-out-never"))).toBe(false);
  });

  test("run writes the files, opening.md and opening.json, and prints the digest", () => {
    const planFile = join(scratch(), "plan.md");
    writeFileSync(planFile, PLAIN);
    const out = join(scratch(), "out");
    const said: string[] = [];
    const errs: string[] = [];
    const io = { out: (t: string) => said.push(t), err: (t: string) => errs.push(t) };
    expect(run(["--gstack", PIN, "--plan", planFile, "--out", out], io)).toBe(0);
    expect(said).toEqual([r.sha256]);
    expect(readFileSync(join(out, "opening.md"), "utf8")).toBe(r.text);
    const j = JSON.parse(readFileSync(join(out, "opening.json"), "utf8"));
    expect(j.sha256).toBe(r.sha256);
    expect(j.readRanges).toEqual(r.readRanges);
    expect(j.gstack).toEqual(ER_ENGPHASE_GSTACK);
    expect(j.files.map((x: any) => x.sha256)).toEqual(r.files.map((x) => x.sha256));
    expect(run(["--gstack", PIN, "--plan", planFile, "--out", out], io)).toBe(2);
    expect(errs.join("\n")).toMatch(/^E_USAGE er render: --out .* is not empty/);
    expect(run(["--gstack", PIN, "--plan", planFile], io)).toBe(2);
  });
});

describe.skipIf(!HAVE)("er render's pin check", () => {
  test("a checkout at another commit is refused", () => {
    expect(() => render(PLAIN, OLD)).toThrow(/^E_USAGE gstack checkout is at b493d4e31.*not the eng phase pin/);
  });

  test("a VERSION that is not 1.98.0.0 is refused, and the pinned one passes", () => {
    const version = atPin("VERSION");
    writeFileSync(join(PIN, "VERSION"), "1.98.0.1\n");
    try {
      expect(() => render(PLAIN)).toThrow(/^E_USAGE gstack checkout VERSION is 1\.98\.0\.1, not 1\.98\.0\.0/);
    } finally {
      writeFileSync(join(PIN, "VERSION"), version);
    }
    expect(render(PLAIN).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a local change to a tracked file is refused", () => {
    const before = atPin("autoplan/SKILL.md");
    appendFileSync(join(PIN, "autoplan", "SKILL.md"), "\nextra\n");
    try {
      expect(() => render(PLAIN)).toThrow(/^E_USAGE gstack checkout has local changes/);
    } finally {
      writeFileSync(join(PIN, "autoplan", "SKILL.md"), before);
    }
  });

  test("a directory that is not a git checkout is refused", () => {
    expect(() => render(PLAIN, scratch())).toThrow(/^E_USAGE not a gstack checkout/);
  });
});

describe("er render's section reader", () => {
  const md = "# Top\n\n## A\n\none\n\n```\n## not a heading\n```\n\n### A.1\n\ntwo\n\n---\n\n## B\n\nthree\n\n### Step 3: Locate review skills; load each at phase entry\n\n**Section skip list — skip these:**\n- One\n\nFollow ONLY the review-specific methodology, sections and required outputs.\n\nOutput: after.\n";

  test("a section runs to the next heading at its level or above, past fences and subheadings, without its --- rule", () => {
    expect(section(md, "## A")).toBe("## A\n\none\n\n```\n## not a heading\n```\n\n### A.1\n\ntwo");
    expect(section(md, "### A.1")).toBe("### A.1\n\ntwo");
  });

  test("a heading missing or present twice is refused", () => {
    expect(() => section(md, "## C")).toThrow(/^E_USAGE .*has 0 "## C" headings/);
    expect(() => section(md + "\n## B\n", "## B")).toThrow(/^E_USAGE .*has 2 "## B" headings/);
  });

  test("the skip list runs from its bold line through its Follow ONLY line, and is refused when absent", () => {
    expect(skipList(md)).toBe("**Section skip list — skip these:**\n- One\n\nFollow ONLY the review-specific methodology, sections and required outputs.");
    expect(() => skipList(md.replace("**Section skip list", "**Skip"))).toThrow(/^E_USAGE .*no section skip list/);
  });
});

function dirname0(p: string): string {
  return p.slice(0, p.lastIndexOf("/"));
}

describe("er render's opening file placement (F10)", () => {
  test("writes a new file read-only, reuses one with the same bytes and refuses one with other bytes", () => {
    const host = join(scratch(), "methodology.md");
    placeOpeningFile(host, "same text\n");
    expect(statSync(host).mode & 0o777).toBe(0o444);
    expect(() => placeOpeningFile(host, "same text\n")).not.toThrow();
    expect(readFileSync(host, "utf8")).toBe("same text\n");
    let err: (Error & { code?: string }) | null = null;
    try {
      placeOpeningFile(host, "other text\n");
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err?.code).toBe("E_EB_CACHE_STALE");
    expect(err?.message).toBe("E_EB_CACHE_STALE opening file " + host + " holds sha256 " + sha("same text\n") + ", not the rendered " + sha("other text\n") + "; start a new run in a new --out");
    expect(readFileSync(host, "utf8")).toBe("same text\n");
  });
});
