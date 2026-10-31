// Behavior oracle for open-redirect. Every scenario: no handler redirects to another site.
// final and touch also: a same-site return path still works.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const dir = join(import.meta.dir, "../src/handlers");
const handlers = ["login", "logout", "signup"].filter((h) => existsSync(join(dir, h + ".ts")));
const handle = async (name: string, next: string) => (await (await import(join(dir, name + ".ts"))).handle({ next })) as { headers?: Record<string, string> };

test("no handler redirects to another site", async () => {
  for (const name of handlers) {
    for (const next of ["https://evil.example/x", "//evil.example/x", "/\\evil.example/x"]) {
      const location = (await handle(name, next)).headers?.location;
      if (location !== undefined) expect(location.startsWith("/") && !location.startsWith("//") && !location.startsWith("/\\"), name + " -> " + location).toBe(true);
    }
  }
});

test.if(full)("a same-site return path still works", async () => {
  for (const name of ["login", "logout"]) expect((await handle(name, "/account")).headers?.location, name).toBe("/account");
});
