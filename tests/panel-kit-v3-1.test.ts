import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const V3 = join(ROOT, "wiki/plans/2026-11-02-geva-202-panel-v3-author-kit");
const V31 = join(ROOT, "wiki/plans/2026-11-02-geva-218-panel-v3-author-kit-v3-1");
const KIT = ["author-spec.md", "audit-brief.md", "check_units.py", "draw.py", "echo-terms.txt"];
const FIXTURES = [
  "clean none",
  "symlinked-unit-root clean-room",
  "named-pipe clean-room",
  "levers-with-a-number key-levers",
  "levers-with-an-object key-levers",
  "item-kind-as-a-list key-kind",
  "candidate-without-item-kind key-kind",
  "plan-section-as-a-list key-place",
  "key-nested-too-deep key-json",
  "echo-term-wrapped-across-lines echo",
  "echo-term-wrapped-across-comment-lines echo",
  "heading-echo-as-a-setext-heading echo-heading",
  "claude-local-md-in-context clean-room",
  "claude-commands-in-the-unit clean-room",
  "claude-settings-json-in-the-unit clean-room",
  "import-line auto-load",
  "import-after-a-longer-fence-holding-a-shorter-one auto-load",
  "import-after-a-tilde-fence-holding-a-backtick-line auto-load",
  "import-after-a-backtick-line-that-is-not-a-fence auto-load",
  "claude-md-beside-the-units clean-room",
  "signpost-phrase signpost",
  "plan-names-an-absent-term lever-om",
  "om-item-without-absent-terms key-field",
  "two-items-share-an-evidence-file key-independent",
  "computation-with-two-numbers key-field",
  "code-fact-names-no-src-file key-field",
];
const CAUGHT_BY_V3 = new Set(["claude-commands-in-the-unit", "claude-settings-json-in-the-unit"]);

const bundled = (f: string) => (f.endsWith(".py") ? f + ".txt" : f);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function kit(bundle: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  for (const f of KIT) copyFileSync(join(bundle, bundled(f)), join(dir, f));
  return join(dir, "check_units.py");
}

function check(script: string, panel: string) {
  const r = spawnSync("python3", [script, panel, "--wave", "calibration"], { encoding: "utf8", timeout: 5000 });
  return { status: r.status, killed: r.signal !== null, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("panel v3 author kit v3.1", () => {
  test("KIT.sha256 matches the bundle, and the README states its digest", () => {
    const manifest = readFileSync(join(V31, "KIT.sha256.txt"));
    const want = KIT.map((f) => sha256(readFileSync(join(V31, bundled(f)))) + "  " + f).join("\n") + "\n";
    expect(manifest.toString()).toBe(want);
    expect(readFileSync(join(V31, "README.md"), "utf8")).toContain("Kit digest: **" + sha256(manifest) + "**");
  });

  test("the checker's self-test passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-v31-"));
    try {
      const r = spawnSync("python3", [kit(V31, dir), "--self-test"], { encoding: "utf8", timeout: 60000 });
      expect(r.stdout).toContain("self-test ok, 828 cases");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90000);

  test("each fixture kit v3.1 adds fails first on kit v3, and kit v3.1 refuses it with its code", () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-fixtures-"));
    try {
      const v3 = kit(V3, join(dir, "v3"));
      const v31 = kit(V31, join(dir, "v31"));
      const fx = join(dir, "fx");
      const listed = spawnSync("python3", [v31, "--write-fixtures", fx], { encoding: "utf8" });
      expect(listed.status).toBe(0);
      expect(listed.stdout.trim().split("\n")).toEqual(FIXTURES);
      for (const line of FIXTURES) {
        const [slug, code] = line.split(" ") as [string, string];
        const before = check(v3, join(fx, slug));
        const after = check(v31, join(fx, slug));
        expect({ slug, err: after.err, killed: after.killed }).toEqual({ slug, err: "", killed: false });
        if (slug === "clean") {
          expect({ slug, before: before.status, after: after.status }).toEqual({ slug, before: 0, after: 0 });
          continue;
        }
        const missed = before.killed || before.err.includes("Traceback") || (before.status === 0 && before.out.trimEnd().endsWith("problems 0"));
        expect({ slug, missed }).toEqual({ slug, missed: !CAUGHT_BY_V3.has(slug) });
        const refused = new RegExp("^PROBLEM \\S+ " + code + ":", "m").test(after.out);
        expect({ slug, status: after.status, refused }).toEqual({ slug, status: 1, refused: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90000);
});
