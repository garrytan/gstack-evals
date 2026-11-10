import { expect, test } from "bun:test";
import { loadNormalize } from "../../lanes/product-value/io.ts";
import { normalizeChanges } from "../../lanes/product-value/parse.ts";

test("the scoring side loads the run side's normalizer", async () => {
  const normalize = await loadNormalize();
  const raw = ["**Add** a `dry-run` mode", "1. Ship [opt-in](https://x.y) first", "c", "d", "e", "f"];
  expect(normalize(raw)).toEqual(normalizeChanges(raw).list);
  expect(normalize(raw).length).toBe(5);
});
