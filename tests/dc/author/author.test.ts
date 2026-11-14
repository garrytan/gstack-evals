// Copyright (c) 2026 Garry Tan. MIT License.
// The author area's keyless tests: every dry-run case as its own test, the pinned prompts, the vocabulary loader, and
// the small parsers and screens the pipeline rests on.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cases } from "../../../lanes/design-constructed/author/dryrun-cases.ts";
import { cutBytes } from "../../../lanes/design-constructed/author/bundle.ts";
import { CONTEXT, EVIDENCE, FIXTURE_APP, ITEMS, PLAN, WRONG_WAY } from "../../../lanes/design-constructed/author/fixture.ts";
import { runUnit, funnelTable } from "../../../lanes/design-constructed/author/pipeline.ts";
import { authorPrompt, pinned, PROMPT_DIR, PROMPT_PINS, validatorPrompt } from "../../../lanes/design-constructed/author/prompts.ts";
import { scripted } from "../../../lanes/design-constructed/author/scripted.ts";
import { datesIn, loadVocabulary, namesIn, planDate, screenUnit, SKILL_FILES } from "../../../lanes/design-constructed/author/screen.ts";
import { lastJsonObject, sha256 } from "../../../lanes/design-constructed/author/text.ts";
import { inheritIds, intake, parseUnitReply, type UnitFiles } from "../../../lanes/design-constructed/author/unit.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { AUTHOR_PROMPT, CHANGE_KINDS, FULL_INFORMATION_OPENING, GIVE_AWAY_OPENING, TEMPLATE } from "../../../lanes/design-constructed/frozen.ts";

const FENCE = "\x60\x60\x60";

describe("author dry-run cases", () => {
  for (const c of cases()) test(c.rule + " " + c.name, async () => expect(await c.check()).toBeNull());
});

describe("pinned build-time prompts", () => {
  test("each file matches its sha256 pin and is written plainly", () => {
    for (const [name, pin] of Object.entries(PROMPT_PINS)) {
      const bytes = readFileSync(join(PROMPT_DIR, pin.file));
      expect(sha256(bytes)).toBe(pin.sha256);
      expect(pinned(name as keyof typeof PROMPT_PINS).length).toBeGreaterThan(100);
      expect(bytes.toString("utf8")).not.toContain("\u2014");
      expect(bytes.toString("utf8")).not.toMatch(/gstack|plan-design-review|autoplan/i);
    }
  });

  test("the frozen prompts reach the model whole", () => {
    expect(authorPrompt("BUNDLE", "k3")).toBe("BUNDLE\n\n" + AUTHOR_PROMPT.replace("<kind>", CHANGE_KINDS.k3));
    const u: UnitFiles = { plan: PLAN, context: CONTEXT, evidence: EVIDENCE, key: { items: intake("u1", ITEMS, []), wrongWay: WRONG_WAY, decoy: null } };
    const full = validatorPrompt("unanimous", u, FIXTURE_APP, ["src/components/DataTable.tsx"]);
    expect(full.startsWith(FULL_INFORMATION_OPENING + "\n\n")).toBe(true);
    expect(full.endsWith("\n" + TEMPLATE)).toBe(true);
    expect(full).toContain("=== src/components/DataTable.tsx ===");
    const give = validatorPrompt("give-away", u, FIXTURE_APP, []);
    expect(give.startsWith(GIVE_AWAY_OPENING + "\n\n")).toBe(true);
    expect(give).not.toContain(EVIDENCE[0]!.path);
  });
});

describe("the vocabulary screen's sources", () => {
  test("a skill file whose sha256 differs from the pin is refused with E_USAGE", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-vocab-"));
    try {
      for (const f of SKILL_FILES) {
        mkdirSync(join(dir, f.path, ".."), { recursive: true });
        writeFileSync(join(dir, f.path), "not the pinned text");
      }
      expect(() => loadVocabulary(dir)).toThrow(DcError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const pin = process.env.GSTACK_PIN_DIR;
  test.skipIf(!pin)("with GSTACK_PIN_DIR at the gstack pin, the fixture unit passes step 3 on the real vocabulary", () => {
    const vocabulary = loadVocabulary(pin!);
    const u: UnitFiles = { plan: PLAN, context: CONTEXT, evidence: EVIDENCE, key: { items: intake("u1", ITEMS, []), wrongWay: WRONG_WAY, decoy: null } };
    expect(screenUnit(u, FIXTURE_APP, { vocabulary, today: "2026-11-01" }).failures).toEqual([]);
  });
});

describe("parsers and text checks", () => {
  test("lastJsonObject takes the last parsable object, fenced first", () => {
    expect(lastJsonObject('a {"x": 1} b {"y": "}"} c')).toEqual({ y: "}" });
    expect(lastJsonObject(FENCE + 'json\n{"z": 2}\n' + FENCE + '\nthen {"w": 3}')).toEqual({ z: 2 });
    expect(lastJsonObject("no object")).toBeNull();
  });

  test("an author reply's key may be a list or an object, and mentioned names an item by class or statement", () => {
    const items = ITEMS.map((i) => ({ ...i }));
    const asList = parseUnitReply(JSON.stringify({ plan: "p", evidence: [], key: items, mentioned: ["r"] }), { needPlan: true });
    const asObject = parseUnitReply(JSON.stringify({ plan: "p", evidence: [], key: { items, mentioned: [ITEMS[0]!.statement], wrong_way: ["w"] } }), { needPlan: true });
    expect(typeof asList === "object" && asList.mentioned).toEqual(["R"]);
    expect(typeof asObject === "object" && asObject.mentioned).toEqual(["Y"]);
    expect(parseUnitReply(JSON.stringify({ plan: "p", evidence: [], key: { items, mentioned: ["nothing"] } }), { needPlan: true })).toBeString();
    expect(parseUnitReply(JSON.stringify({ evidence: [], key: { items } }), { needPlan: true })).toBeString();
  });

  test("dates in every form the screen reads, and the plan's date", () => {
    expect(datesIn("On 2026-08-14, then August 3, 2026, 4 Sep 2026, 2026/07/01 and October 2026.")).toEqual(["2026-08-14", "2026-08-03", "2026-09-04", "2026-07-01", "2026-10-01"]);
    expect(planDate("No date here.", "2026-11-01")).toBe("2026-11-01");
    expect(planDate("Date: 2026-10-20. Launch by 2027-01-15.", "2026-11-01")).toBe("2026-10-20");
  });

  test("the name check: a listed first name before a surname, an email, an @handle; not colour words or package names", () => {
    expect(namesIn("Notes by Priya Raman and Sarah Lee.")).toEqual(["Priya Raman", "Sarah Lee"]);
    expect(namesIn("The Amber Badge and the Mark Paid button.")).toEqual([]);
    expect(namesIn("Mail ops@example.org or ping @opsbot.")).toEqual(["ops@example.org", "@opsbot"]);
    expect(namesIn("We use @tanstack/react-table here.")).toEqual([]);
  });

  test("2x id inheritance refuses a count change, a reworded statement and a changed detail", () => {
    const base = intake("u1", ITEMS, []);
    expect(inheritIds(base, ITEMS.slice(1))).toBeString();
    expect(inheritIds(base, ITEMS.map((i, n) => (n === 0 ? { ...i, statement: i.statement + "!" } : i)))).toBeString();
    expect(inheritIds(base, ITEMS.map((i, n) => (n === 0 ? { ...i, detail: "other" } : i)))).toBeString();
    expect(inheritIds(base, [...ITEMS].reverse())).not.toBeString();
  });

  test("cutBytes never splits a character", () => {
    expect(cutBytes("a\u00e9", 2)).toBe("a");
    expect(cutBytes("a\u00e9", 3)).toBe("a\u00e9");
  });
});

describe("the funnel", () => {
  test("per step: units reached and passed, and per class the items reached and removed", async () => {
    const pass = await runUnit({ unitId: "u1", app: FIXTURE_APP, author: "sol", bundle: "B", prompt: "P" }, scripted({}).deps);
    const drop = await runUnit({ unitId: "u2", app: FIXTURE_APP, author: "argon", bundle: "B", prompt: "P" }, scripted({ block: (step, v) => (step === "unanimous" && v === "sol" ? ["Handle [S+].", "Handle [H+]."] : step === "unanimous" ? ["[S+]", "[H+]", "[R+]", "[A+]", "[Y+]"] : ["none"]) }).deps);
    const t = funnelTable([pass, drop]);
    const u = t.find((r) => r.step === "unanimous")!;
    expect(u.units).toBe(2);
    expect(u.passed).toBe(1);
    expect(u.byClass.R).toEqual({ reached: 2, removed: 1, tieDecided: 0 });
    expect(t.find((r) => r.step === "give-away")!.units).toBe(1);
  });
});
