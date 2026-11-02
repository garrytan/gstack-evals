#!/usr/bin/env bun
// Renders docs/errors.md from src/errors/codes.ts. "bun run errors:doc" writes it; "bun run errors:check" fails when it is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, type CodeInfo, type ReasonCode } from "./codes.ts";

export const ERRORS_DOC = join(import.meta.dir, "..", "..", "docs", "errors.md");

const SECTIONS: { exit: CodeInfo["exit"]; title: string }[] = [
  { exit: 1, title: "Exit 1: the edit lost something (FAIL)" },
  { exit: 2, title: "Exit 2: no verdict (INCOMPLETE)" },
  { exit: 3, title: "Exit 3: calibration failed (INCOMPLETE)" },
  { exit: 4, title: "Exit 4: an arm is untested (INCOMPLETE)" },
  { exit: null, title: "Warnings: attach to any verdict, never change the exit code" },
];

const yesNo = (b: boolean) => (b ? "yes" : "no");
const md = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

function facts(info: CodeInfo): string {
  if (info.exit === null) return "Warning. Owner: " + info.owner + ".";
  return [
    "Exit " + info.exit + ".",
    "Side effects: " + md(info.side_effects),
    "Retry safe: " + yesNo(info.retry_safe) + ".",
    "Resumable: " + yesNo(info.resumable) + ".",
    "Owner: " + info.owner + ".",
  ].join(" ");
}

export function renderErrorsDoc(): string {
  const entries = Object.entries(CODES) as [ReasonCode, CodeInfo][];
  const out = [
    "# Reason codes",
    "",
    "Generated from [src/errors/codes.ts](../src/errors/codes.ts) by `bun run errors:doc`. Do not edit it by hand: CI runs `bun run errors:check` and fails when this file is stale.",
    "",
    "Every gstack-evals error line on stderr starts with its code, and every code has an entry here. Codes never change and are never removed; their prose may change. `gstack-evals explain <code>` prints the same entry.",
    "",
    "Each entry gives the meaning, the fix, and these facts:",
    "",
    "- **Exit**: 1 means the edit lost something, 2 means no verdict, 3 means calibration failed, 4 means an arm is untested. Warnings attach to any verdict. A run with several models exits 3, then 1, then 2, then 0.",
    "- **Side effects**: what has already happened when the code prints: spend, files, reservations.",
    "- **Retry safe**: yes means repeating the command after the fix (with `--resume <out>` when resumable) cannot charge a call twice, overwrite a recorded result or change a verdict already reached.",
    "- **Resumable**: yes means `--resume <out>` continues the run. No means start a new run; a terminal stop prints \"do not --resume\" and `--resume` refuses it with E_NOT_RESUMABLE.",
    "- **Owner**: the build unit that owns the code's text, from the v1.0 build breakdown.",
    "",
    "| Code | Exit | Owner |",
    "|---|---|---|",
    ...entries.map(([code, info]) => "| [" + code + "](#" + code.toLowerCase() + ") | " + (info.exit ?? "warning") + " | " + info.owner + " |"),
  ];
  for (const section of SECTIONS) {
    out.push("", "## " + section.title);
    for (const [code, info] of entries) {
      if (info.exit !== section.exit) continue;
      out.push("", "### " + code, "", md(info.meaning), "", "Fix: " + md(info.fix), "", facts(info));
    }
  }
  return out.join("\n") + "\n";
}

if (import.meta.main) {
  const expected = renderErrorsDoc();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(ERRORS_DOC, "utf8");
    } catch {}
    if (current !== expected) {
      console.error("errors: docs/errors.md is stale, it does not match src/errors/codes.ts\nfix: bun run errors:doc, then commit docs/errors.md");
      process.exit(1);
    }
    console.log("errors: ok, " + Object.keys(CODES).length + " codes, docs/errors.md is fresh");
  } else {
    writeFileSync(ERRORS_DOC, expected);
    console.log("errors: wrote docs/errors.md (" + Object.keys(CODES).length + " codes)");
  }
}
