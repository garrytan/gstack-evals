import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Checks .gstack/pregate.json's sealed rules the way gstack-pregate sealed reads them (gstack docs/pregate.md#sealed):
// path globs know only "*" (within one path segment), "**" (any depth) and "?" (one character); text rules are regexes
// over each added line, the config's own lines included.
const CONFIG_PATH = join(import.meta.dir, "..", ".gstack", "pregate.json");
const configText = readFileSync(CONFIG_PATH, "utf8");
const sealed = JSON.parse(configText).sealed as { paths: string[]; transcripts: string[]; answer_markers: string[]; seed_patterns: string[]; local_paths: boolean; visibility: string };

function globRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "?") source += "[^/]";
    else if (ch !== "*") source += ch.replace(/[.+^$\{\}()|[\]\\]/g, "\\$&");
    else if (glob[i + 1] !== "*") source += "[^/]*";
    else if (glob[i + 2] === "/") {
      source += "(?:.*/)?";
      i += 2;
    } else {
      source += ".*";
      i += 1;
    }
  }
  return new RegExp("^" + source + "$");
}

const refused = (globs: string[], path: string) => globs.some((g) => globRegExp(g).test(path));

describe("sealed publication rules", () => {
  test("refuse held-out bodies anywhere under sealed/ and protected/, direct or nested", () => {
    for (const path of ["sealed/s1/tasks.json", "sealed/s1/answers.md", "sealed/s1/tasks/t1/task.toml", "sealed/s1/MANIFEST.json", "protected/MANIFEST.json", "protected/cases/c1.json", "heldout/t1.json", "held-out/x/y.md", "tasks/dev/t1/answer.sealed", "tasks/dev/t1/key.sealed.json"]) {
      expect(refused(sealed.paths, path)).toBe(true);
    }
  });

  test("refuse transcripts in any runs/ folder", () => {
    for (const path of ["runs/t1.jsonl", "out/runs/before/t1/transcript.jsonl", "docs/benchmarks/x/runs/a.json"]) expect(refused(sealed.transcripts, path)).toBe(true);
  });

  test("leave ordinary repo files alone", () => {
    for (const path of ["src/runner/proxy/metering-proxy.ts", "tests/fixtures/transcripts/claude.jsonl", "docs/errors.md", "wiki/INDEX.md", "src/runner/run.ts", "schema/tasks.schema.json"]) {
      expect(refused([...sealed.paths, ...sealed.transcripts], path)).toBe(false);
    }
  });

  test("text rules catch answer markers and sealed seeds", () => {
    const markers = sealed.answer_markers.map((m) => new RegExp(m));
    const seeds = sealed.seed_patterns.map((s) => new RegExp(s));
    expect(markers.some((re) => re.test("SEALED" + " ANSWER: 42"))).toBe(true);
    expect(seeds.some((re) => re.test("rotation" + "_seed = 9f3a2b"))).toBe(true);
    expect(seeds.some((re) => re.test("holdout" + "_seed: 1234"))).toBe(true);
    expect(seeds.some((re) => re.test("const seed = 7"))).toBe(false);
  });

  test("no text rule matches a line of the config itself, so the config never refuses its own commit", () => {
    const rules = [...sealed.answer_markers, ...sealed.seed_patterns].map((r) => new RegExp(r));
    for (const line of configText.split("\n")) for (const re of rules) expect(re.test(line)).toBe(false);
  });

  test("refuse rather than warn, and check local home paths", () => {
    expect(sealed.visibility).toBe("public");
    expect(sealed.local_paths).toBe(true);
  });
});
