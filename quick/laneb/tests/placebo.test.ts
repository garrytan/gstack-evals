import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePlacebo, generatorHash, ratio, skillFolders } from "../arms/placebo/generate.ts";
import {
  DEFAULT_SEED,
  ROUTER_FOLDERS,
  ROUTING_HEADING,
  proceduralMarkers,
  prng,
  routingSection,
  splitSkill,
  stripHooks,
  topicTerms,
} from "../arms/placebo/placebo.ts";
import { treeDigest, walk } from "../arms/tree.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "laneb-placebo-"));
  roots.push(d);
  return d;
};

const procedure = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    [
      "## Step " + (i + 1) + ": " + topic,
      "",
      "Run this first:",
      "",
      "```bash",
      "~/.claude/skills/demo/bin/demo-start --skill \"" + topic + "\" --round " + i,
      "```",
      "",
      "1. Read the output and check each STATUS line.",
      "2. If it fails, use the Bash tool and fix the cause before moving on.",
      "- Never skip the review gate.",
      "",
    ].join("\n"),
  ).join("\n");

const routing = [
  ROUTING_HEADING,
  "",
  "This is the router. Its one job is to send the request to the right skill.",
  "",
  "- User reports a bug, \"why is this broken\" → invoke `/investigate`",
  "- User asks to plan, price or pilot a paid eval → invoke `/eval-plan`",
  "```bash",
  "~/.claude/skills/demo/bin/demo-log --event-type route 2>/dev/null || true",
  "```",
  "",
].join("\n");

const router = (name: string) =>
  "---\nname: " + name + "\ndescription: Router for the demo skill suite. (demo)\nallowed-tools:\n  - Bash\n  - Read\ntriggers:\n  - demo\n\n---\n" +
  procedure("routing", 6) + "\n" + routing;

const FIXTURE: Record<string, string> = {
  gstack: router("gstack"),
  "_gstack-command": router("_gstack-command"),
  investigate:
    "---\nname: investigate\npreamble-tier: 2\ndescription: Systematic debugging with root cause investigation. (gstack)\n" +
    "allowed-tools:\n  - Bash\n  - Edit\nhooks:\n  PreToolUse:\n    - matcher: \"Edit\"\n      hooks:\n        - type: command\n" +
    "          command: 'bash -c \"test -x \\\"$HOME/x.sh\\\" && exec bash \\\"$HOME/x.sh\\\"; exit 0\"'\n---\n" + procedure("investigate", 40),
  "eval-plan":
    "---\nname: eval-plan\ndescription: |\n  Preregister a paid eval: bars, arms, decoys and rules,\n  then a dry run. See CLAUDE.md and ~/.gstack/config. (gstack)\n---\n" +
    procedure("eval", 12),
  tiny:
    "---\nname: tiny\ndescription: \"Restrict file edits to one directory. (gstack)\"\n---\nRun `/tiny` to start, then pick the directory.\n\n" +
    "1. Pick a directory.\n2. Edit only inside it until `/untiny` clears it.\n",
};

function fixtureTree(): string {
  const dir = tempDir();
  for (const [folder, text] of Object.entries(FIXTURE)) {
    mkdirSync(join(dir, folder, "sections"), { recursive: true });
    writeFileSync(join(dir, folder, "SKILL.md"), text);
    writeFileSync(join(dir, folder, "sections", "preamble.md"), "not copied\n");
  }
  return dir;
}

function generated(folder: string, text: string): string {
  const { body } = splitSkill(text);
  const kept = ROUTER_FOLDERS.includes(folder) ? routingSection(body) : null;
  return kept ? body.slice(0, body.length - kept.length) : body;
}

// Identical except that the top-level hooks key and its block are gone.
function expectFrontmatterKept(before: string, after: string) {
  const parse = (fm: string) => Bun.YAML.parse(fm.slice(4, -4)) as Record<string, unknown>;
  const { hooks, ...rest } = parse(before);
  expect(parse(after)).toEqual(rest);
  expect(after).not.toMatch(/^hooks:/m);
  if (hooks === undefined) return expect(after).toBe(before);
  const a = before.split("\n");
  const b = after.split("\n");
  const start = a.findIndex((l) => l.startsWith("hooks:"));
  const removed = a.length - b.length;
  expect(removed).toBeGreaterThan(0);
  expect(b).toEqual([...a.slice(0, start), ...a.slice(start + removed)]);
  expect(a.slice(start + 1, start + removed).every((l) => l === "" || /^[ \t]/.test(l))).toBe(true);
}

function checkTree(inDir: string, outDir: string, results: ReturnType<typeof generatePlacebo>) {
  expect(skillFolders(outDir)).toEqual(skillFolders(inDir));
  for (const folder of skillFolders(outDir)) expect(readdirSync(join(outDir, folder))).toEqual(["SKILL.md"]);
  for (const r of results) {
    const before = readFileSync(join(inDir, r.folder, "SKILL.md"), "utf8");
    const after = readFileSync(join(outDir, r.folder, "SKILL.md"), "utf8");
    expectFrontmatterKept(splitSkill(before).frontmatter, splitSkill(after).frontmatter);
    expect(ratio(r)).toBeGreaterThanOrEqual(0.95);
    expect(ratio(r)).toBeLessThanOrEqual(1.05);
    if (ROUTER_FOLDERS.includes(r.folder)) {
      const kept = routingSection(splitSkill(before).body);
      expect(kept).not.toBeNull();
      expect(routingSection(splitSkill(after).body)).toBe(kept);
      expect(after.endsWith(kept!)).toBe(true);
    }
    expect(proceduralMarkers(generated(r.folder, after))).toEqual([]);
  }
}

describe("placebo generator on a fixture tree", () => {
  const inDir = fixtureTree();
  const outA = join(tempDir(), "skills");
  const outB = join(tempDir(), "skills");
  const resultsA = generatePlacebo(inDir, outA, DEFAULT_SEED);
  generatePlacebo(inDir, outB, DEFAULT_SEED);

  test("same seed and input give the same bytes", () => {
    expect(treeDigest(walk(outB))).toBe(treeDigest(walk(outA)));
    for (const folder of skillFolders(outA)) {
      expect(readFileSync(join(outB, folder, "SKILL.md"))).toEqual(readFileSync(join(outA, folder, "SKILL.md")));
    }
  });

  test("hooks are the only frontmatter key removed", () => {
    const fm = splitSkill(FIXTURE.investigate!).frontmatter;
    expect(fm).toMatch(/^hooks:/m);
    const out = stripHooks(fm);
    expect(out).not.toMatch(/^hooks:|PreToolUse|matcher/m);
    expect(out).toBe("---\nname: investigate\npreamble-tier: 2\ndescription: Systematic debugging with root cause investigation. (gstack)\nallowed-tools:\n  - Bash\n  - Edit\n---\n");
    const middle = "---\nname: a\nhooks:\n  Stop:\n\n    - matcher: x\n\nafter: 1\n---\n";
    expect(stripHooks(middle)).toBe("---\nname: a\n\nafter: 1\n---\n");
    expect(stripHooks(splitSkill(FIXTURE.tiny!).frontmatter)).toBe(splitSkill(FIXTURE.tiny!).frontmatter);
  });

  test("another seed changes bodies but not frontmatter", () => {
    const outC = join(tempDir(), "skills");
    generatePlacebo(inDir, outC, "another seed");
    expect(treeDigest(walk(outC))).not.toBe(treeDigest(walk(outA)));
    for (const folder of skillFolders(outA)) {
      const a = readFileSync(join(outA, folder, "SKILL.md"), "utf8");
      const c = readFileSync(join(outC, folder, "SKILL.md"), "utf8");
      expect(splitSkill(c).frontmatter).toBe(splitSkill(a).frontmatter);
    }
    expect(generatorHash("another seed")).not.toBe(generatorHash(DEFAULT_SEED));
  });

  test("folders, frontmatter, routing text, token bound and procedural markers", () => {
    checkTree(inDir, outA, resultsA);
  });

  test("refuses to write into a non-empty output folder", () => {
    expect(() => generatePlacebo(inDir, outA, DEFAULT_SEED)).toThrow("not empty");
  });

  test("a router without its routing heading is an error", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "gstack"));
    writeFileSync(join(dir, "gstack", "SKILL.md"), FIXTURE.investigate!.replace("name: investigate", "name: gstack"));
    expect(() => generatePlacebo(dir, join(tempDir(), "out"), DEFAULT_SEED)).toThrow(ROUTING_HEADING);
  });
});

describe("helpers", () => {
  test("prng streams are reproducible and keyed", () => {
    const a = prng("s", "k");
    const b = prng("s", "k");
    const c = prng("s", "other");
    const seqA = Array.from({ length: 8 }, a);
    expect(Array.from({ length: 8 }, b)).toEqual(seqA);
    expect(Array.from({ length: 8 }, c)).not.toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  test("topic terms skip paths, commands and instruction verbs", () => {
    const terms = topicTerms("sync-gbrain", "Keep gbrain current with this repo's code and refresh agent search guidance in CLAUDE.md. (gstack)");
    expect(terms[0]).toBe("sync gbrain");
    expect(terms.join(" ")).not.toMatch(/CLAUDE|refresh|keep|\.md/i);
    expect(topicTerms("ship", "Ship workflow: run tests, bump VERSION, push, create PR. (gstack)")).toEqual(["ship", "ship workflow", "tests", "PR"]);
  });

  test("the procedural-marker check catches procedural text", () => {
    const bad = [
      "Use `grep` here.",
      "1. Open the file.",
      "- a bulleted step",
      "Run the tests before pushing.",
      "The script lives in ~/.claude/skills/demo.",
      "The Bash tool prints it.",
      "You should check the logs.",
      "Pass --verbose to see more.",
      "## Heading",
      "It reads CLAUDE.md first.",
    ];
    for (const text of bad) expect(proceduralMarkers(text).length).toBeGreaterThan(0);
    expect(proceduralMarkers("The idea of root cause investigation has a long history in software work.")).toEqual([]);
  });
});

// Run against the real installed gstack tree when build.sh points at it.
const realSkills = process.env.LANEB_GSTACK_SKILLS;
describe("placebo generator on the installed gstack tree", () => {
  test.skipIf(!realSkills)("every skill passes every check", () => {
    const out = join(tempDir(), "skills");
    const results = generatePlacebo(realSkills!, out, DEFAULT_SEED);
    expect(results.length).toBeGreaterThan(0);
    checkTree(realSkills!, out, results);
    for (const folder of skillFolders(realSkills!)) {
      if (ROUTER_FOLDERS.includes(folder)) continue;
      expect(routingSection(splitSkill(readFileSync(join(realSkills!, folder, "SKILL.md"), "utf8")).body)).toBeNull();
    }
  });
});
