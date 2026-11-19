// Copyright (c) 2026 Garry Tan. MIT License.
// gstack's quote transform, read from the vendored contract checker. match.ts imports quoteSource as a Bun macro, so it runs
// when Bun transpiles or bundles match.ts and the judge tar's facts.js carries the regex without reading a vendored file.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function quoteSource(): { source: string; flags: string } {
  const src = readFileSync(join(import.meta.dir, "vendor/gstack/lib/skill-contract.ts"), "utf8");
  const all = [...src.matchAll(/const bare = cmd\.replace\(\/(.+?)\/([a-z]*), '""'\);/g)];
  if (all.length !== 1) throw new Error("E_HM_PIN the vendored checker holds " + all.length + " quote transforms, not 1");
  return { source: all[0]![1]!, flags: all[0]![2]! };
}
