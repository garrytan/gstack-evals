// Behavior oracle for env-flag-strings. Every scenario: each flag is off when unset, "false" or "0".
// final and touch also: each flag is on when "true".
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const dir = join(import.meta.dir, "../src/flags");
const flags = ["maintenance", "emails", "dry-run"].filter((f) => existsSync(join(dir, f + ".ts")));
const load = async (name: string) => (await import(join(dir, name + ".ts"))) as { variable: string; enabled: (env: Record<string, string | undefined>) => boolean };

test("a flag that is unset, false or 0 is off", async () => {
  for (const name of flags) {
    const { variable, enabled } = await load(name);
    expect(await enabled({}), name + " unset").toBe(false);
    for (const value of ["false", "0"]) expect(await enabled({ [variable]: value }), name + "=" + value).toBe(false);
  }
});

test.if(full)("a flag set to true is on", async () => {
  for (const name of flags) {
    const { variable, enabled } = await load(name);
    expect(await enabled({ [variable]: "true" }), name).toBe(true);
  }
});
