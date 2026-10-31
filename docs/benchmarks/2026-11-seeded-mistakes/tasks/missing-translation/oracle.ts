// Behavior oracle for missing-translation. Every scenario: no page shows a raw message key or a blank line in English or
// French. The keys are listed here, so a tree that nests its locale files is checked the same way.
// Counted in the must-pass scenarios only: the French pages are in French.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const keys = ["checkout.title", "checkout.pay", "profile.title", "profile.save", "orders.title", "orders.empty"];
const page = async (name: string) => (await import(join(root, "src/pages", name + ".ts"))).render as (locale: string) => string;
const pages = ["checkout", "profile", "orders"].filter((p) => existsSync(join(root, "src/pages", p + ".ts")));

test("no page shows a raw message key", async () => {
  for (const name of pages) {
    const render = await page(name);
    for (const locale of ["en", "fr"]) {
      const out = await render(locale);
      for (const key of keys) expect(out, name + " in " + locale).not.toContain(key);
      for (const line of out.split("\n")) expect(line.trim(), name + " in " + locale + " shows a blank line").not.toBe("");
    }
  }
});

describe("with no mistake in place", () => {
  test("the French pages are in French", async () => {
    expect(await (await page("profile"))("fr")).not.toContain("Save changes");
    expect(await (await page("checkout"))("fr")).toContain("Payer maintenant");
  });
});
