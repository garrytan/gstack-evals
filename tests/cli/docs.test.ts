import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { CODES } from "../../src/errors/codes.ts";
import { EXAMPLES } from "../../src/skill-eval/cli/example.ts";
import { SKILL_EVAL_FLAGS } from "../../src/skill-eval/cli/flags.ts";

const doc = readFileSync(join(REPO_ROOT, "docs", "skill-eval.md"), "utf8");
const row = (flag: string) => doc.split("\n").find((l) => l.startsWith("| `" + flag + "` |"));

describe("docs/skill-eval.md", () => {
  // Value: protects=the caller doc lists every flag the code has, marks the unbuilt ones, and names every example mode and exit 1 reason; fails_when=a flag, mode or exit 1 code is added or unbuilt without the doc following; why_new=the doc is new; seam=SKILL_EVAL_FLAGS, EXAMPLES and CODES; no_claim=the prose matches the code beyond these lists
  test("it lists every flag, marks the unbuilt ones, and names every example mode and exit 1 reason", () => {
    for (const f of SKILL_EVAL_FLAGS) {
      expect([f.name, row(f.name) !== undefined]).toEqual([f.name, true]);
      expect([f.name, row(f.name)!.includes("Not built")]).toEqual([f.name, !f.built]);
    }
    for (const mode of Object.keys(EXAMPLES)) expect(doc).toContain(mode === "pass" ? "| `--example` | PASS | 0 |" : "| `--example=" + mode + "` |");
    for (const [code, info] of Object.entries(CODES)) if (info.exit === 1 || info.exit === 3) expect([code, doc.includes(code)]).toEqual([code, true]);
  });
});
