// Behavior oracle for timeout-units. Every scenario: a call to any configured service that answers in 50 ms succeeds,
// the sms service included once fresh or fresh-ok adds it (found by name, wherever the tree keeps it).
// Counted in the must-pass scenarios only: each service waits as long as intended.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { call, timeoutFor } from "../src/client.ts";

const config = readFileSync(join(import.meta.dir, "../config/services.json"), "utf8");
const services = ["payments", "search", "email", "sms"].filter((name) => config.includes('"' + name + '"'));

test("a call to a service that answers in 50 ms succeeds", async () => {
  for (const name of services) expect(await call(name, () => new Promise((resolve) => setTimeout(() => resolve(name), 50)))).toBe(name);
});

describe("with no mistake in place", () => {
  test("each service waits as long as intended", async () => {
    expect(await timeoutFor("payments")).toBe(5000);
    expect(await timeoutFor("search")).toBe(3000);
    expect(await timeoutFor("email")).toBe(10000);
    if (services.includes("sms")) expect(await timeoutFor("sms")).toBe(3000);
  });
});
