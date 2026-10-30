import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { compareFrozen, frozenFile, main, parseFrozen, Refusal, sha256, writePrompt } from "../../lanes/review-replay/panel/build.ts";

const LANE = join(import.meta.dir, "../../lanes/review-replay");
const PANEL = join(LANE, "panel");
const README = readFileSync(join(LANE, "README.md"), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "replay-panel-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const EVALS = [
  { dir: "eval1", items: "items.jsonl", prereg: "prereg.md" },
  { dir: "eval2", items: "items2.jsonl", prereg: "prereg2.md" },
];

describe("lanes/review-replay/panel", () => {
  test("the README's digest table lists every committed panel file with its sha256", () => {
    const table = new Map([...README.matchAll(/^\| `panel\/([^`]+)` \| `([0-9a-f]{64})` \|/gm)].map((m) => [m[1]!, m[2]!]));
    const committed = files(PANEL).map((f) => relative(PANEL, f)).filter((f) => !f.includes("/prompts/")).sort();
    expect([...table.keys()].sort()).toEqual(committed);
    for (const [f, digest] of table) expect([f, sha256(readFileSync(join(PANEL, f)))]).toEqual([f, digest]);
  });

  test("only the public cases are vendored", () => {
    const cases = JSON.parse(readFileSync(join(PANEL, "panel-cases.json"), "utf8"));
    expect(cases.map((c: { repo: string; pr: number }) => c.repo + "#" + c.pr)).toEqual(["garrytan/gstack#3516", "garrytan/gstack#3518"]);
  });

  test("every item's prompt is prompts/<item>.md and its frozen file lists that prompt", () => {
    for (const e of EVALS) {
      const frozen = parseFrozen(readFileSync(frozenFile(join(PANEL, e.dir)), "utf8"));
      const listed = new Set(frozen.filter((f) => f.path.includes("/")).map((f) => basename(f.path)));
      const items = readFileSync(join(PANEL, e.dir, e.items), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.prompt_file).toBe("prompts/" + item.item + ".md");
        expect(listed.has(basename(item.prompt_file))).toBe(true);
      }
      expect(new Set(items.map((i: { item: string }) => i.item + ".md"))).toEqual(listed);
      expect(frozen.find((f) => f.path === e.prereg)?.sha256).toBe(sha256(readFileSync(join(PANEL, e.dir, e.prereg))));
    }
  });

  test("compareFrozen prints OK or DIFF per prompt, matched by file name, and skips top-level entries", () => {
    const dir = join(tmp, "render");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.md"), "alpha");
    writeFileSync(join(dir, "b.md"), "changed");
    const frozen = [sha256("alpha") + "  prompts/a.md", sha256("beta") + "  prompts2/b.md", sha256("gamma") + "  prompts/c.md", sha256("prereg") + "  prereg.md", ""].join("\n");
    const checks = compareFrozen(frozen, dir);
    expect(checks.map((c) => [c.name, c.ok, c.line.split(" ")[0]])).toEqual([["a.md", true, "OK"], ["b.md", false, "DIFF"], ["c.md", false, "DIFF"]]);
    expect(checks[2]!.line).toContain("missing from the render");
    expect(() => parseFrozen("not a digest line")).toThrow(Refusal);
  });

  test("writePrompt refuses to overwrite different bytes, keeps identical ones and writes new ones", () => {
    const out = join(tmp, "out");
    mkdirSync(out);
    writePrompt(out, "p", "one");
    writePrompt(out, "p", "one");
    expect(readFileSync(join(out, "p.md"), "utf8")).toBe("one");
    expect(() => writePrompt(out, "p", "two")).toThrow(/never overwrites a prompt/);
    expect(readFileSync(join(out, "p.md"), "utf8")).toBe("one");
  });

  test("--check refuses a checkout off the pin and leaves the eval dir untouched", async () => {
    const evalDir = join(tmp, "eval1");
    cpSync(join(PANEL, "eval1"), evalDir, { recursive: true });
    const before = files(evalDir).map((f) => [f, sha256(readFileSync(f))]);
    const notPinned = join(tmp, "not-gstack");
    mkdirSync(notPinned);
    const err: string[] = [];
    const spy = console.error;
    console.error = (line: string) => err.push(line);
    try {
      expect(await main(["--gstack", notPinned, "--check", evalDir])).toBe(2);
      expect(await main(["--gstack", notPinned])).toBe(2);
      expect(await main(["--gstack", join(tmp, "missing"), "--check", evalDir])).toBe(2);
    } finally {
      console.error = spy;
    }
    expect(err[0]).toMatch(/^E_USAGE .*--check needs gstack at [0-9a-f]{40}/);
    expect(err[1]).toMatch(/^E_USAGE usage:/);
    expect(err[2]).toMatch(/^E_USAGE .*missing does not exist/);
    expect(files(evalDir).map((f) => [f, sha256(readFileSync(f))])).toEqual(before);
  });
});
