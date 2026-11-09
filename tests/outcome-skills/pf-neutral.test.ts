// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { neutralEdit, neutralOk, neutralPatch, validateNeutral } from "../../lanes/outcome-skills/pfchecks/neutral.ts";

const C = "// gstack-evals neutral line";
test("top and end lines, after a shebang, an encoding line or a PHP tag", () => {
  expect(neutralEdit("go", "package a\n", "both")).toBe(C + "\npackage a\n" + C + "\n");
  expect(neutralEdit("js", "#!/usr/bin/env node\nx()\n", "both")).toBe("#!/usr/bin/env node\n" + C + "\nx()\n" + C + "\n");
  expect(neutralEdit("rust", "#![allow(x)]\nfn a() {}\n", "both")).toBe(C + "\n#![allow(x)]\nfn a() {}\n" + C + "\n");
  expect(neutralEdit("python", "#!/bin/py\n# -*- coding: utf-8 -*-\nx = 1\n", "both")).toBe("#!/bin/py\n# -*- coding: utf-8 -*-\n# gstack-evals neutral line\nx = 1\n# gstack-evals neutral line\n");
  expect(neutralEdit("ts", "<?php\necho 1;\n", "both")).toBe("<?php\n" + C + "\necho 1;\n" + C + "\n");
});
test("end line only, a file with no final newline, CRLF", () => {
  expect(neutralEdit("c", "int a;\n", "end")).toBe("int a;\n" + C + "\n");
  expect(neutralEdit("c", "int a;", "end")).toBe("int a;\n" + C);
  expect(neutralEdit("cpp", "a\r\nb\r\n", "both")).toBe(C + "\r\na\r\nb\r\n" + C + "\r\n");
});
test("the neutral patch applies with git apply", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-np-"));
  mkdirSync(join(d, "src"));
  writeFileSync(join(d, "src", "a.go"), "package a\n");
  spawnSync("git", ["init", "-q"], { cwd: d });
  const p = neutralPatch("go", [{ path: "src/a.go", text: "package a\n" }], "both");
  writeFileSync(join(d, "n.patch"), p);
  expect(spawnSync("git", ["apply", "n.patch"], { cwd: d }).status).toBe(0);
  expect(readFileSync(join(d, "src", "a.go"), "utf8")).toBe(C + "\npackage a\n" + C + "\n");
});
test("the validation rule and its fallback", () => {
  const pass = { f: "pass", s: "pass" }, f2pFail = { f: "fail", s: "pass" };
  expect(neutralOk(["f"], ["s"], [f2pFail, f2pFail, f2pFail]).ok).toBe(true);
  expect(neutralOk(["f"], ["s"], [f2pFail, pass, f2pFail]).ok).toBe(false);
  expect(neutralOk(["f"], ["s"], [f2pFail, f2pFail, null]).ok).toBe(false);
  const files = [{ path: "a.go", text: "package a\n" }];
  const fallback = validateNeutral("u", "go", files, ["f"], ["s"], (_p, mode) => (mode === "both" ? { f: "fail", s: "fail" } : f2pFail));
  expect(fallback.record.verdict).toBe("kept");
  expect(fallback.record.mode).toBe("end");
  const drop = validateNeutral("u", "go", files, ["f"], ["s"], () => pass);
  expect(drop.record).toMatchObject({ verdict: "dropped", mode: null });
  expect(drop.record.tried.map((t) => t.mode)).toEqual(["both", "end"]);
});
