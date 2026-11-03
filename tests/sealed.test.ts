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
  test("refuse held-out bodies in any sealed, protected or held-out folder, at the root or nested", () => {
    for (const path of ["sealed/s1/tasks.json", "sealed/s1/answers.md", "sealed/s1/tasks/t1/task.toml", "sealed/s1/MANIFEST.json", "protected/MANIFEST.json", "protected/cases/c1.json", "heldout/t1.json", "held-out/x/y.md", "holdout/a.json", "tasks/heldout/a.json", "tasks/holdout/t1/task.toml", "lanes/x/sealed/a.json", "lanes/x/protected/b.json", "lanes/x/held-out/c.md", "Sealed/a.json", "HELDOUT/a.json", "lanes/x/Heldout/a.json", "held_out/a.json", "tasks/hold-out/a.json", "tasks/heldout-v2/a.json", "tasks/sealed-set/a.json", "tasks/b.SEALED", "Protected/x.json", "tasks/dev/t1/answer.sealed", "tasks/dev/t1/key.sealed.json"]) {
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

  test("the guard's own verdict lines pass, and every other bare or labelled marker still trips", () => {
    const markers = sealed.answer_markers.map((m) => new RegExp(m));
    const trips = (line: string) => markers.some((re) => re.test(line));
    const bare = "SEALED" + ": ";
    const tail = " skipped=0 visibility=public waived=0 exempt=0 policy=origin/main";
    for (const verdict of [
      "clear findings=0 commits=1" + tail,
      "refused findings=7 commits=11" + tail + " + commit 578129a3039f",
      "warned findings=1 commits=1" + tail,
      "error findings=0 commits=0 visibility=public waived=0 policy=origin/main",
      "no-policy findings=0 commits=1" + tail,
      "clear findings=0 commits=1 skipped=0 visibility=public waived=0 exempt=0 unchecked=2 policy=origin/main + commit 578129a3039f",
      "error findings=0 commits=0 skipped=0 visibility=unknown (counted public) waived=0 exempt=0 policy=no sealed key on refs/remotes/origin/main or HEAD",
      "clear findings=0 commits=1 visibility=public waived=0 policy=origin/main + pushed 0123456789ab",
      "clear findings=0 commits=1 visibility=public waived=0 policy=pushed 0123456789ab",
      "no-policy findings=0 commits=1 visibility=public waived=0 policy=no sealed key on origin/main or HEAD",
      "clear findings=0 commits=1",
      "clear",
      "refused",
      "error",
      "not checked (exit 3)",
      "not checked (exit null)",
    ]) {
      expect(trips(bare + verdict)).toBe(false);
    }
    const label = (words: string, rest: string) => "SEALED " + words + ": " + rest;
    for (const line of [
      bare + "42",
      bare + "fixture-only-answer=42",
      bare + "clearly 42",
      bare + "clear 42",
      bare + "error 42",
      bare + "clear findings=0 commits=1 the hidden answer is 42",
      bare + "clear findings=0 commits=1 the hidden answer is 42 policy=origin/main",
      bare + "clear findings=0 commits=1 skipped=0 visibility=public the hidden answer is 42 policy=origin/main",
      bare + "clear findings=0 commits=1 visibility=public waived=0 policy=origin/main + the hidden answer is 42",
      bare + "no-policy findings=0 commits=1 visibility=public waived=0 policy=no sealed key on the hidden answer",
      bare + "not checked (exit foo)",
      label("ANSWER", "42"),
      label("ANSWER", "error"),
      label("ANSWER", "clear findings=0 commits=1"),
      label("HIDDEN TEST", "t1"),
      label("HIDDEN TEST", "not checked yet"),
      bare + "clear findings=0 commits=3 visibility=private answer=42",
      bare + "clear findings=0 commits=1 skipped=0 visibility=public waived=0 exempt=0 answer=42 policy=origin/main",
      bare + "clear findings=0 commits=1 skipped=0 visibility=public waived=0 exempt=0 policy=origin/main answer=42",
      bare + "clear findings=0 commits=1 visibility=the-hidden-answer-is-42 waived=0 policy=origin/main",
      bare + "clear findings=0 commits=1 visibility=public waived=forty-two policy=origin/main",
      bare + "clear findings=0 commits=1 visibility=public waived=0 policy=the-hidden-answer-is-42",
      bare + "clear findings=0 commits=1 visibility=public waived=0 policy=hidden-answer-42 + commit 0123456789ab",
    ]) {
      expect(trips(line)).toBe(true);
    }
  });

  test("every verdict the sealed workflow test feeds its gate stays exempt", () => {
    const markers = sealed.answer_markers.map((m) => new RegExp(m));
    const source = readFileSync(join(import.meta.dir, "ci", "sealed-workflow.test.ts"), "utf8");
    const verdicts = [...source.matchAll(/gate\("([^"]+)"\)/g)].map((m) => m[1]!);
    expect(verdicts.length).toBeGreaterThan(5);
    for (const verdict of verdicts) expect(markers.some((re) => re.test("SEALED" + ": " + verdict))).toBe(false);
  });

  test("the markers finish fast on long adversarial lines", () => {
    const markers = sealed.answer_markers.map((m) => new RegExp(m));
    const head = "SEALED" + ": clear findings=0 commits=1 ";
    for (const line of [
      head.repeat(5000),
      head + "a=b ".repeat(50000),
      head + "skipped=0 visibility=public waived=0 " + "policy=x ".repeat(20000),
      head + "visibility=public waived=0 policy=" + "a".repeat(100000) + "/" + "b".repeat(100000) + " +",
      head + "visibility=public waived=0 policy=no sealed key on " + "a ".repeat(50000),
    ]) {
      const start = performance.now();
      for (const re of markers) re.test(line);
      expect(performance.now() - start).toBeLessThan(100);
    }
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

// Reviewed waivers live in .gstack/sealed-allow.tsv, one `rule<TAB>path<TAB>sha<TAB>reason` line each; the checker waives a
// finding when its rule and path match and its commit starts with the sha. The home-path pattern copies gstack's
// sealed.local_path rule for Linux, macOS and Windows home folders.
const ALLOW_FILE = ".gstack/sealed-allow.tsv";
const allowLines = readFileSync(join(import.meta.dir, "..", ALLOW_FILE), "utf8").split("\n").filter((l) => l.trim());
const LOCAL_PATH = /(?:^|[^A-Za-z0-9_.~-])(?:\/home\/[^/\s'"`]+\/|\/Users\/[^/\s'"`]+\/|[A-Za-z]:\\+Users\\+[^\\\s'"`]+\\)/;

describe("sealed waivers", () => {
  test("each waiver names a rule, a repo path, a full commit sha and a reason", () => {
    expect(allowLines.length).toBeGreaterThan(0);
    for (const line of allowLines) {
      const [rule, path, sha, reason, ...rest] = line.split("\t");
      expect(rest).toEqual([]);
      expect(["sealed.path", "sealed.transcript", "sealed.answer", "sealed.seed", "sealed.local_path"]).toContain(rule!);
      expect(path).toMatch(/^[^/\s].*[^/\s]$/);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect((reason ?? "").trim()).not.toBe("");
    }
  });

  test("no text rule matches a line of the waiver file, so it never refuses its own commit", () => {
    const rules = [...sealed.answer_markers, ...sealed.seed_patterns].map((r) => new RegExp(r));
    for (const line of allowLines) {
      for (const re of rules) expect(re.test(line)).toBe(false);
      expect(LOCAL_PATH.test(line)).toBe(false);
    }
  });

  test("the home-path pattern matches what the checker refuses and leaves a trailing-slash-free mention alone", () => {
    expect(LOCAL_PATH.test(" '/home/" + "user/.capy/x'")).toBe(true);
    expect(LOCAL_PATH.test("home, /home/" + "user;")).toBe(false);
  });
});
