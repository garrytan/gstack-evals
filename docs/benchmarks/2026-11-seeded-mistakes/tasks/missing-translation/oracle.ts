// Behavior oracle for missing-translation. Every scenario: no page shows a raw message key in English or French.
// final and touch also: the French pages are in French.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const root = join(import.meta.dir, "..");
const keys = Object.keys(JSON.parse(readFileSync(join(root, "locales/en.json"), "utf8")));
const page = async (name: string) => (await import(join(root, "src/pages", name + ".ts"))).render as (locale: string) => string;
const pages = ["checkout", "profile", "orders"].filter((p) => existsSync(join(root, "src/pages", p + ".ts")));

test("no page shows a raw message key", async () => {
  for (const name of pages) {
    const render = await page(name);
    for (const locale of ["en", "fr"]) {
      const out = await render(locale);
      for (const key of keys) expect(out, name + " in " + locale).not.toContain(key);
    }
  }
});

test.if(full)("the French pages are in French", async () => {
  expect(await (await page("profile"))("fr")).not.toContain("Save changes");
  expect(await (await page("checkout"))("fr")).toContain("Payer maintenant");
});
