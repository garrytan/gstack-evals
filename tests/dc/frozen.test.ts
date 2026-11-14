// Copyright (c) 2026 Garry Tan. MIT License.
// Every string the lane quotes from a preregistration, checked byte for byte against the line it comes from, so a
// drift in the lane or in the post fails CI. Also checks the 18 E_DC_ codes against start rule 3's list.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CODES } from "../../src/errors/codes.ts";
import * as F from "../../lanes/design-constructed/frozen.ts";

const root = join(import.meta.dir, "..", "..");
const lines = (path: string) => readFileSync(join(root, path), "utf8").split("\n");
const post = { prereg: lines(F.PREREG), kept: lines(F.PREREG_KEPT) };

type Source = { file: keyof typeof post; line: number; form: "block" | "quoted" | "line" | [string, string] };

/** Where each quoted string sits. block: the line is "> " then the string. quoted: the line holds it in double quotes. */
const SOURCES: { name: string; value: string; at: Source[] }[] = [
  { name: "AUTHOR_PROMPT", value: F.AUTHOR_PROMPT, at: [{ file: "prereg", line: 149, form: "block" }] },
  { name: "CONTEXT_WRITER_PROMPT", value: F.CONTEXT_WRITER_PROMPT, at: [{ file: "prereg", line: 153, form: "block" }] },
  { name: "FULL_INFORMATION_OPENING", value: F.FULL_INFORMATION_OPENING, at: [{ file: "prereg", line: 157, form: "quoted" }] },
  { name: "GIVE_AWAY_OPENING", value: F.GIVE_AWAY_OPENING, at: [{ file: "prereg", line: 158, form: "quoted" }] },
  { name: "TRANSFORM_2X_PROMPT", value: F.TRANSFORM_2X_PROMPT, at: [{ file: "prereg", line: 165, form: "block" }] },
  { name: "TWIN_NOTE", value: F.TWIN_NOTE, at: [{ file: "prereg", line: 171, form: "quoted" }] },
  { name: "REFERENCE_OPENING", value: F.REFERENCE_OPENING, at: [{ file: "prereg", line: 186, form: "quoted" }] },
  { name: "VOCABULARY_PASS_NAMES", value: F.VOCABULARY_PASS_NAMES.join(", "), at: [{ file: "prereg", line: 155, form: ["nor the skill's pass names (", ")"] }] },
  { name: "VOCABULARY_WORDS", value: F.VOCABULARY_WORDS.slice(0, -1).join(", ") + " or " + F.VOCABULARY_WORDS.at(-1), at: [{ file: "prereg", line: 155, form: ["nor the words ", "."] }] },
  { name: "KEEP_WORDING", value: F.KEEP_WORDING, at: [{ file: "prereg", line: 284, form: "quoted" }] },
  { name: "SATURATION_WORDING", value: F.SATURATION_WORDING, at: [{ file: "prereg", line: 262, form: "quoted" }] },
  { name: "SATURATION_DETAIL_WORDING", value: F.SATURATION_DETAIL_WORDING, at: [{ file: "prereg", line: 262, form: "quoted" }] },
  {
    name: "COMMON_LINE",
    value: F.COMMON_LINE,
    at: [
      { file: "kept", line: 202, form: "quoted" },
      { file: "prereg", line: 185, form: "quoted" },
    ],
  },
  {
    name: "ARM_LEAD.lens",
    value: F.ARM_LEAD.lens!,
    at: [
      { file: "kept", line: 207, form: "quoted" },
      { file: "prereg", line: 185, form: "quoted" },
    ],
  },
  {
    name: "ARM_LEAD.plan-design-review",
    value: F.ARM_LEAD["plan-design-review"]!,
    at: [
      { file: "kept", line: 208, form: "quoted" },
      { file: "prereg", line: 185, form: "quoted" },
    ],
  },
  {
    name: "ARM_LEAD.autoplan",
    value: F.ARM_LEAD.autoplan!,
    at: [
      { file: "kept", line: 209, form: "quoted" },
      { file: "prereg", line: 185, form: "quoted" },
    ],
  },
  { name: "FORCED_SENTENCE", value: F.FORCED_SENTENCE, at: [{ file: "kept", line: 211, form: "quoted" }] },
  { name: "AUTOPLAN_ANSWER", value: F.AUTOPLAN_ANSWER, at: [{ file: "kept", line: 215, form: ["answers it with ", ", recording"] }] },
  { name: "GATE_MESSAGE", value: F.GATE_MESSAGE, at: [{ file: "kept", line: 215, form: "quoted" }] },
  { name: "DETECTOR_PASS_NAMES", value: F.DETECTOR_PASS_NAMES.join(", "), at: [{ file: "kept", line: 223, form: ["in the skill's order (", ")"] }] },
  { name: "STATE_TABLE_HEADER", value: F.STATE_TABLE_HEADER.slice(0, -1).join(", ") + " and " + F.STATE_TABLE_HEADER.at(-1), at: [{ file: "kept", line: 223, form: ["whose header holds ", ";"] }] },
  { name: "TEMPLATE", value: F.TEMPLATE, at: [{ file: "kept", line: 232, form: "block" }] },
  { name: "LENIENT_FORMS", value: F.LENIENT_FORMS.join(", "), at: [{ file: "kept", line: 241, form: ["the one frozen lenient parse (", ")"] }] },
  { name: "ENFORCED_LABEL", value: F.ENFORCED_LABEL, at: [{ file: "kept", line: 325, form: "quoted" }] },
  ...F.STOCK_ROWS.map((r) => ({ name: "STOCK_ROWS row " + r.row, value: "- **Row " + r.row + ", " + r.title + ":** " + r.changes.map((c, i) => "(" + (i + 1) + ") " + c).join(" "), at: [{ file: "kept" as const, line: 277 + r.row, form: "line" as const }] })),
  { name: "GENERIC_LOOK_BLOCK", value: F.GENERIC_LOOK_BLOCK, at: [{ file: "kept", line: 374, form: "quoted" }] },
  { name: "BUILD_PROMPT", value: F.BUILD_PROMPT, at: [{ file: "kept", line: 374, form: "quoted" }] },
  {
    name: "GSTACK_PIN",
    value: F.GSTACK_PIN.repo + " " + F.GSTACK_PIN.commit + " (VERSION " + F.GSTACK_PIN.version + ")",
    at: [
      { file: "kept", line: 208, form: ["| ", ", default Claude Code install (" + F.GSTACK_PIN.install + ") |"] },
      { file: "prereg", line: 185, form: ["at ", " with the default Claude Code install"] },
    ],
  },
  { name: "CHANGE_KINDS", value: Object.entries(F.CHANGE_KINDS).map(([k, v]) => "(" + k + ") " + v).join("; "), at: [{ file: "prereg", line: 143, form: ["seed 20261114: ", ". Position p"] }] },
  { name: "FRAME.topics", value: F.FRAME.topics.join(", "), at: [{ file: "prereg", line: 132, form: ["10 topics (", ")"] }] },
  { name: "FRAME.licenses", value: F.FRAME.licenses.join(", "), at: [{ file: "prereg", line: 132, form: ["times 5 licences (", ")"] }] },
];

describe("frozen strings match their preregistration byte for byte", () => {
  for (const s of SOURCES) {
    for (const at of s.at) {
      test(s.name + " at " + at.file + " line " + at.line, () => {
        const line = post[at.file][at.line - 1]!;
        expect(s.value.length).toBeGreaterThan(0);
        if (at.form === "block") expect(line).toBe("> " + s.value);
        else if (at.form === "line") expect(line).toBe(s.value);
        else if (at.form === "quoted") expect(line).toContain('"' + s.value + '"');
        else expect(line).toContain(at.form[0] + s.value + at.form[1]);
      });
    }
  }
});

describe("the reason codes", () => {
  test("exactly the 18 E_DC_ codes start rule 3 lists, in its order", () => {
    const rule = post.prereg.find((l) => l.startsWith("3. **Reason codes**"))!;
    const listed = rule.slice(0, rule.indexOf("E_DR_")).match(/E_DC_[A-Z_]+/g);
    expect(listed).toHaveLength(18);
    expect(Object.keys(CODES).filter((c) => c.startsWith("E_DC_"))).toEqual(listed!);
  });
  test("every stop code in STOP_SCOPES stops work at exit 2, and every cell state's code is a warning", () => {
    for (const code of Object.keys(F.STOP_SCOPES)) expect(CODES[code as keyof typeof CODES].exit).toBe(2);
    for (const s of Object.values(F.CELL_STATES)) if (s.code) expect(CODES[s.code].exit).toBeNull();
    expect(Object.keys(F.STOP_SCOPES)).toHaveLength(11);
  });
});

describe("frozen numbers that add up", () => {
  test("the 17 ledger items' caps sum to the all-in cap", () => {
    const items = Object.values(F.LEDGER_ITEMS);
    expect(items).toHaveLength(17);
    expect(items.reduce((s, i) => s + i.capUsd, 0)).toBe(F.MONEY.capAllInUsd);
  });
  test("each session round's reserve is every session at full allowance, twice over", () => {
    for (const [id, item] of Object.entries(F.LEDGER_ITEMS)) {
      if (item.admission.kind !== "sessions" || id === "dc-base-apps") continue;
      expect(item.admission.reserveUsd).toBe(item.admission.perRound * item.admission.allowanceUsd * 2);
    }
  });
});
