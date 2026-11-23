// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the test-region rule (lanes/real-outcome/task/region.ts): a Rust file gives up only its inline test
// module, braces in strings, chars and comments don't end it, and any ambiguous mixed file is refused.
import { describe, expect, test } from "bun:test";
import { classifyFile, productText, regionText, rustClass, splice } from "../../lanes/real-outcome/task/region.ts";

const LIB_RS = [
  "pub fn add(a: i32, b: i32) -> i32 {",
  "    a + b",
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  '    const S: &str = "} not the end";',
  "    const C: char = '}';",
  "    // a } in a comment",
  '    const R: &str = r##"} raw "# still"##;',
  "    #[test]",
  "    fn adds() {",
  "        assert_eq!(add(1, 2), 3);",
  "    }",
  "}",
  "",
].join("\n");

describe("the test-region rule", () => {
  test("a Rust file with one cfg(test) module gives up only that module", () => {
    const c = rustClass(LIB_RS);
    expect(c.kind).toBe("region");
    expect(regionText("src/lib.rs", LIB_RS)!.startsWith("#[cfg(test)]\nmod tests {")).toBe(true);
    expect(regionText("src/lib.rs", LIB_RS)!.endsWith("    }\n}")).toBe(true);
    expect(productText("src/lib.rs", LIB_RS)).toBe("pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n");
  });

  test("splice keeps every byte of the tree's product code and moves the source's test module", () => {
    const tree = "pub fn add(a: i32, b: i32) -> i32 {\n    b + a\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn mine() {}\n}\n";
    const out = splice("src/lib.rs", tree, LIB_RS);
    expect(productText("src/lib.rs", out)).toBe(productText("src/lib.rs", tree));
    expect(regionText("src/lib.rs", out)).toBe(regionText("src/lib.rs", LIB_RS));
    expect(out).not.toContain("fn mine");
    expect(regionText("src/lib.rs", splice("src/lib.rs", null, LIB_RS))).toBe(regionText("src/lib.rs", LIB_RS));
    expect(() => splice("src/lib.rs", tree, "pub fn x() {}\n")).toThrow();
  });

  test("ambiguous mixed files are refused: test functions outside the module, two modules, an out-of-line module, a nested one", () => {
    expect(rustClass("pub fn a() {}\n#[test]\nfn t() {}\n")).toMatchObject({ kind: "mixed" });
    expect(rustClass("#[cfg(test)]\nmod a {}\n#[cfg(test)]\nmod b {}\n")).toMatchObject({ kind: "mixed", why: "2 cfg(test) modules" });
    expect(rustClass("#[cfg(test)]\nmod tests;\n")).toMatchObject({ kind: "mixed" });
    expect(rustClass("mod outer {\n#[cfg(test)]\nmod tests { #[test] fn t() {} }\n}\n")).toMatchObject({ kind: "mixed" });
    expect(rustClass("pub fn a() {}\n")).toEqual({ kind: "product" });
    expect(rustClass('pub fn a() -> &' + "'" + 'static str { "#[test]" }\n')).toEqual({ kind: "product" });
  });

  test("Python and JavaScript test code in a source file is mixed; plain source is product", () => {
    expect(classifyFile("calc/ops.py", "def add(a, b):\n    return a + b\n\ndef test_add():\n    assert add(1, 2) == 3\n").kind).toBe("mixed");
    expect(classifyFile("src/a.ts", "export const a = 1;\nif (import.meta.vitest) { const { it } = import.meta.vitest; }\n").kind).toBe("mixed");
    expect(classifyFile("src/a.ts", "export const describeThing = () => 1;\n").kind).toBe("product");
    expect(classifyFile("main.go", "package main\n").kind).toBe("product");
  });
});
