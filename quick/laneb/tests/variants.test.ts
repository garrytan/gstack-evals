import { describe, expect, test } from "bun:test";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carriers, entryBytes, fileSha256, onlyFile, REWRITTEN_DESCRIPTION, rewriteDescription, SHIPPED_LINE, shortPlacebo, SHORT_TARGET, tarEntries, writeReplaced } from "../arms/variants.ts";
import { countTokens, frontmatterFields, proceduralMarkers, splitSkill } from "../arms/placebo/placebo.ts";

const SKILL = ".claude/skills/investigate/SKILL.md";
const LONG = ".claude/skills/" + "x".repeat(120) + "/SKILL.md";
const skillMd = (body: string) => "---\nname: investigate\n" + SHIPPED_LINE + "\nallowed-tools:\n  - Bash\n---\n" + body;

// A small GNU tar built the way the arm tars are: sorted names, mtime 0, root owner, a long name.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "variants-"));
  const root = join(dir, "root");
  for (const [path, text] of [[SKILL, skillMd("Shipped body.\n")], [".claude/skills/review/SKILL.md", "---\nname: review\ndescription: Review.\n---\nreview body\n"], [LONG, "long " + SHIPPED_LINE + "\n"]]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const run = Bun.spawnSync(["tar", "--format=gnu", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-cf", join(dir, "base.tar"), "-C", root, ".claude"]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return { dir, tar: join(dir, "base.tar") };
}

const replaced = (tar: string, out: string, content: string) => {
  const fd = openSync(tar, "r");
  try {
    return writeReplaced(fd, tarEntries(fd), SKILL, Buffer.from(content), out);
  } finally {
    closeSync(fd);
  }
};
const listing = (tar: string) => Bun.spawnSync(["tar", "-tf", tar]).stdout.toString();

describe("tar entry replacement", () => {
  test("writing the same content back gives the base tar byte for byte", () => {
    const { dir, tar } = fixture();
    const fd = openSync(tar, "r");
    const same = entryBytes(fd, onlyFile(tarEntries(fd).entries, SKILL));
    closeSync(fd);
    const out = replaced(tar, join(dir, "same.tar"), same.toString());
    expect(out.sha256).toBe(fileSha256(tar));
    expect(readFileSync(join(dir, "same.tar")).equals(readFileSync(tar))).toBe(true);
  });

  test("a longer entry keeps every other entry, the order and the long name, and GNU tar reads it", () => {
    const { dir, tar } = fixture();
    const body = "y".repeat(3000);
    const out = replaced(tar, join(dir, "new.tar"), body);
    const again = replaced(tar, join(dir, "again.tar"), body);
    expect(again.sha256).toBe(out.sha256);
    expect(out.bytes % 10240).toBe(0);
    expect(listing(join(dir, "new.tar"))).toEqual(listing(tar));
    const x = join(dir, "x");
    mkdirSync(x);
    expect(Bun.spawnSync(["tar", "-xf", join(dir, "new.tar"), "-C", x]).exitCode).toBe(0);
    expect(readFileSync(join(x, SKILL), "utf8")).toBe(body);
    expect(readFileSync(join(x, LONG), "utf8")).toBe("long " + SHIPPED_LINE + "\n");
    const fd = openSync(join(dir, "new.tar"), "r");
    expect(carriers(fd, tarEntries(fd), SHIPPED_LINE.slice(13))).toEqual([LONG]);
    closeSync(fd);
  });

  test("a tar whose end is not GNU's record padding is refused", () => {
    const { dir, tar } = fixture();
    writeFileSync(join(dir, "cut.tar"), readFileSync(tar).subarray(0, readFileSync(tar).length - 512));
    const fd = openSync(join(dir, "cut.tar"), "r");
    expect(() => tarEntries(fd)).toThrow("E_INPUT");
    closeSync(fd);
  });
});

describe("rewritten description", () => {
  test("only the description line changes, to the frozen 319-character text, YAML double-quoted", () => {
    expect(REWRITTEN_DESCRIPTION.length).toBe(319);
    const before = skillMd("Shipped body.\n");
    const after = rewriteDescription(before);
    expect(after).toBe(before.replace(SHIPPED_LINE, "description: " + JSON.stringify(REWRITTEN_DESCRIPTION)));
    expect(frontmatterFields(splitSkill(after).frontmatter).description).toBe(REWRITTEN_DESCRIPTION);
    expect(() => rewriteDescription(after)).toThrow("E_INPUT");
  });
});

describe("short placebo", () => {
  test("847 tokens within 1, no procedural markers, frontmatter kept, deterministic", () => {
    const text = skillMd("x".repeat(100));
    const a = shortPlacebo(text);
    expect(Math.abs(a.tokens - SHORT_TARGET)).toBeLessThanOrEqual(1);
    expect(countTokens(splitSkill(a.output).body)).toBe(a.tokens);
    expect(proceduralMarkers(splitSkill(a.output).body)).toEqual([]);
    expect(splitSkill(a.output).frontmatter).toBe(splitSkill(text).frontmatter);
    expect(shortPlacebo(text).output).toBe(a.output);
  });
});
