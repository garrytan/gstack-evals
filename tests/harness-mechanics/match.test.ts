// Copyright (c) 2026 Garry Tan. MIT License.
// The matcher, keyless (section 6, dry-run step 3): match.txt's 72 cases and probes.txt's 189 probes through gstack's own
// contract checker at the pin (vendored byte for byte) in both directions, the built-in classifier's wrong count, the FLIP
// rule, the same cases under Node 24, the timing cases with the frozen regex, and the Stop hook's checkContract call.
// BEFORE's slow timing runs in the dry run, not here.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLE, GSTACK_BLOBS, GSTACK_VENDOR, MATCHER, REPO } from "../../lanes/harness-mechanics/pins.ts";
import {
  builtinSides, checkerSides, checkVendored, flipRule, gitBlob, loadMatcher, misplaced, nodeMajor, nodeSides, parseMatch,
  parseProbes, QUOTES, regexTimesMs, stopHookProblem, vendorFile,
} from "../../lanes/harness-mechanics/match.ts";

const m = loadMatcher();
const cmds = (cs: { cmd: string }[]) => cs.map((c) => c.cmd);
const node = nodeMajor();

describe("vendored gstack", () => {
  test("every vendored file is at its pinned upstream blob, and a changed byte is refused", () => {
    expect(() => checkVendored()).not.toThrow();
    expect(Object.keys(GSTACK_BLOBS)).toContain("lib/shell-writes.ts");
    const fake = mkdtempSync(join(tmpdir(), "hm-vendor-"));
    cpSync(join(REPO, GSTACK_VENDOR), fake, { recursive: true });
    expect(() => checkVendored(fake)).not.toThrow();
    const f = vendorFile("lib/shell-writes.ts", fake);
    writeFileSync(f, readFileSync(f, "utf8") + "\n");
    expect(() => checkVendored(fake)).toThrow("E_HM_PIN " + GSTACK_VENDOR + "/lib/shell-writes.ts is blob ");
  });

  test("the quote transform is the vendored checker's own", () => {
    expect(QUOTES.flags).toBe("g");
    expect("pytest -k \"a b\" -m 'x'".replace(QUOTES, '""')).toBe("pytest -k \"\" -m \"\"");
    expect(gitBlob(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("match.txt", () => {
  test("holds the regex and the frozen counts of cases", () => {
    expect(m.match.regex.startsWith("(?-i:")).toBe(true);
    expect(m.match.cases.filter((c) => c.label === "COUNT").length).toBe(MATCHER.count);
    expect(m.match.cases.filter((c) => c.label === "NO").length).toBe(MATCHER.no);
    expect(m.match.cases.find((c) => c.cmd === "cd /testbed\npytest -q")?.label).toBe("COUNT");
    expect(m.match.cases.find((c) => c.cmd === "  pytest -q")?.label).toBe("COUNT");
  });

  test("every case lands on its side through gstack's checkContract with the frozen regex", () => {
    const s = checkerSides(cmds(m.match.cases), m.match.regex);
    expect(misplaced(m.match.cases, s)).toEqual([]);
    expect(s.met.filter(Boolean).length).toBe(MATCHER.count);
  });

  test("a case labelled on the wrong side is named", () => {
    const text = readFileSync(join(REPO, BUNDLE, "match.txt"), "utf8");
    const bad = parseMatch(text.replace("\nNO pytest --version\n", "\nCOUNT pytest --version\n").replace("\nCOUNT make test\n", "\nNO make test\n"));
    const wrong = misplaced(bad.cases, checkerSides(cmds(bad.cases), bad.regex));
    expect(wrong.length).toBe(2);
    expect(wrong.some((w) => w.includes("COUNT \"pytest --version\""))).toBe(true);
    expect(wrong.some((w) => w.includes("NO \"make test\""))).toBe(true);
  });

  test("gstack's built-in classifier gets the prereg's count wrong", () => {
    const wrong = misplaced(m.match.cases, builtinSides(cmds(m.match.cases)));
    expect(wrong.length).toBe(MATCHER.builtinWrong);
    expect(wrong.some((w) => w.includes("\"pytest --version\""))).toBe(true);
  });

  test.skipIf(node < 24)("every case lands on its side under Node 24 with the same transform and flag i", () => {
    const s = nodeSides(cmds(m.match.cases), m.match.regex);
    expect(s.version).toStartWith("node v");
    expect(misplaced(m.match.cases, s)).toEqual([]);
  });
});

describe("probes.txt", () => {
  test("holds BEFORE, the frozen count of probes and timing cases", () => {
    expect(m.probes.before.startsWith("(?-i:")).toBe(true);
    expect(m.probes.probes.length).toBe(MATCHER.probes);
    expect(m.probes.time.length).toBe(MATCHER.time);
    expect(m.probes.probes.some((p) => p.cmd === "\r\npytest -q")).toBe(true);
    for (const t of m.probes.time) expect(t.cmd.length).toBe("cat > x <<EOF\n".length + t.n);
    expect(m.probes.time.at(-1)!.unit).toBe("\n");
  });

  test("under Bun, every probe lands on its side with REGEX and BEFORE, and only FLIP lines differ", () => {
    const s = checkerSides(cmds(m.probes.probes), m.match.regex, m.probes.before);
    expect(misplaced(m.probes.probes, s)).toEqual([]);
    expect(flipRule(m.probes.probes, s)).toEqual([]);
    expect(m.probes.probes.filter((p) => p.label === "FLIP").length).toBeGreaterThan(0);
  });

  test("a probe on the wrong side is named, and a difference outside FLIP breaks the FLIP rule", () => {
    const relabel = m.probes.probes.map((p) => (p.cmd === "FOO=a;b pytest -q" ? { ...p, label: "COUNT" as const } : p.cmd === "X=1 pytest -q" ? { ...p, label: "FLIP" as const } : p));
    const s = checkerSides(cmds(relabel), m.match.regex, m.probes.before);
    const wrong = misplaced(relabel, s);
    expect(wrong.length).toBe(2);
    expect(wrong[0]).toContain("FLIP \"X=1 pytest -q\"");
    expect(flipRule(relabel, s)).toEqual([expect.stringContaining("X=1 pytest -q"), expect.stringContaining("FOO=a;b pytest -q")]);
  });

  test.skipIf(node < 24)("under Node 24, every probe lands on its side and only FLIP lines differ", () => {
    const s = nodeSides(cmds(m.probes.probes), m.match.regex, m.probes.before);
    expect(misplaced(m.probes.probes, s)).toEqual([]);
    expect(flipRule(m.probes.probes, s)).toEqual([]);
  });

  test("each timing case finishes under the bound with REGEX under Bun", () => {
    const ms = regexTimesMs(m.probes.time.map((t) => t.cmd), m.match.regex);
    expect(ms.length).toBe(MATCHER.time);
    for (const x of ms) expect(x).toBeLessThan(MATCHER.timeBoundMs);
  });

  test("parse refuses a probes file with an unknown label", () => {
    expect(() => parseProbes("BEFORE x\nMAYBE pytest\n")).toThrow("E_HM_INPUT probes.txt line 2");
  });
});

describe("stop hook", () => {
  const real = readFileSync(vendorFile("hosts/claude/hooks/skill-contract-stop-hook.ts"), "utf8");
  test("the pinned Stop hook calls checkContract once, with no loadLine", () => {
    expect(gitBlob(Buffer.from(real))).toBe(GSTACK_BLOBS["hosts/claude/hooks/skill-contract-stop-hook.ts"]);
    expect(stopHookProblem(real)).toBeNull();
  });

  test("a copy that passes a loadLine, passes options, or calls checkContract twice fails", () => {
    const call = "checkContract(transcript, t.skill, t.contract)";
    expect(real.split(call).length).toBe(2);
    expect(stopHookProblem(real.replace(call, "checkContract(transcript, t.skill, t.contract, { loadLine: 3 })"))).toContain("loadLine");
    expect(stopHookProblem(real.replace(call, "checkContract(transcript, t.skill, t.contract, opts)"))).toContain("4 arguments");
    expect(stopHookProblem(real.replace(call, call + " && checkContract(transcript, t.skill, t.contract)"))).toContain("2 calls");
    expect(stopHookProblem(real.replace("const result = checkContract(", "const loadLine = 1;\n  const result = checkContract("))).toContain("loadLine");
  });
});
