// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureRepo } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { prepareBase } from "../../lanes/outcome-skills/statemachines/history.ts";
import { leakCheck, needles, scan } from "../../lanes/outcome-skills/statemachines/leak.ts";

const line30 = "let total_after_reset = x(1);"; // 29 code points
const added = (...ls: string[]) => "diff --git a/src/a.rs b/src/a.rs\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1 +1,9 @@\n" + ls.map((l) => "+" + l).join("\n") + "\n";

describe("leak scan", () => {
  const base = "fn a() {}\n    let already_in_the_base_tree_somewhere = 1;\n";
  const setup = () => {
    const { dir, head } = fixtureRepo({ "src/a.rs": base, "bin/blob.bin": "\u0000\u0001binary\n" });
    prepareBase({ kind: "host", dir }, head, "/r", "fixture");
    return dir;
  };
  test("needles are added lines of 30 code points or more that no base line holds", () => {
    const dir = setup();
    expect(Array.from(line30).length).toBe(29);
    const ns = needles({ kind: "host", dir }, added(line30, line30 + "!", "    let already_in_the_base_tree_somewhere = 1;", "  " + line30, "+++ not a header but long enough to count here"));
    expect(ns).toEqual([line30 + "!", "  " + line30]);
  });
  test("a hit anywhere (binary included) drops the unit with the path and the needle's sha256, a miss passes", () => {
    const dir = setup();
    const w = { kind: "host" as const, dir };
    const patch = added("    return reset_counter_and_report(state);");
    expect(leakCheck(w, patch, "fixture", dir).hits).toEqual([]);
    mkdirSync(join(dir, "cache"), { recursive: true });
    writeFileSync(join(dir, "cache/copy.bin"), "\u0000junk\n    return reset_counter_and_report(state);\n\u0000");
    let msg = "";
    try {
      leakCheck(w, patch, "fixture", dir);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/^E_SM_LEAKED fixture: 1 fix line\(s\) found: .*cache\/copy\.bin needle sha256 [0-9a-f]{64} \(not_cache\)$/);
    expect(msg).not.toContain("reset_counter_and_report");
    writeFileSync(join(dir, "cache/indented.txt"), "  return reset_counter_and_report(state);\n");
    expect(scan(w, ["    return reset_counter_and_report(state);"], dir).hits.length).toBe(1);
  });
  test("proc and sys at the scan root are not read", () => {
    const dir = setup();
    for (const d of ["proc", "sys"]) {
      mkdirSync(join(dir, d));
      writeFileSync(join(dir, d, "f"), "    return reset_counter_and_report(state);\n");
    }
    expect(scan({ kind: "host", dir }, ["    return reset_counter_and_report(state);"], dir).hits).toEqual([]);
  });
});
