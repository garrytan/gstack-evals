// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic fixtures for the eng-review score-side tests, written for these tests from no unit.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Io } from "../../lanes/eng-review/cli.ts";
import type { Key, UnitMeta } from "../../lanes/eng-review/types.ts";

export { item, keyOf, meta, row, rv, unitsOf, fakeAnswer } from "../../lanes/eng-review/dryrun.ts";
export const tmp = () => mkdtempSync(join(tmpdir(), "er-test-"));
export const ENV = { ANTHROPIC_API_KEY: "test", OPENAI_API_KEY: "test", OPENROUTER_API_KEY: "test" };

export function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t) }, out, err };
}

export function writeUnits(dir: string, specs: Array<{ meta: UnitMeta; key: Key }>): void {
  for (const s of specs) {
    const u = join(dir, s.meta.id);
    mkdirSync(join(u, "repo", "src"), { recursive: true });
    writeFileSync(join(u, "unit.json"), JSON.stringify(s.meta));
    writeFileSync(join(u, "key.json"), JSON.stringify(s.key));
    writeFileSync(join(u, "plan.md"), "The team will make the importer read rows from a file for " + s.meta.id + ".");
    writeFileSync(join(u, "repo", "src", "import.ts"), "export function readRows(path: string) {\n  return [];\n}\nexport const parseDate = (s: string) => s;\n");
  }
}
