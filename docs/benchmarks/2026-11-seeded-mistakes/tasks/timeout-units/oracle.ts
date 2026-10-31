// Behavior oracle for timeout-units. Every scenario: a call to any configured service that answers in 50 ms succeeds.
// final and touch also: each service waits as long as intended.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { call, timeoutFor } from "../src/client.ts";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const services = Object.keys(JSON.parse(readFileSync(join(import.meta.dir, "../config/services.json"), "utf8")));

test("a call to a service that answers in 50 ms succeeds", async () => {
  for (const name of services) expect(await call(name, () => new Promise((resolve) => setTimeout(() => resolve(name), 50)))).toBe(name);
});

test.if(full)("each service waits as long as intended", async () => {
  expect(await timeoutFor("payments")).toBe(5000);
  expect(await timeoutFor("search")).toBe(3000);
  expect(await timeoutFor("email")).toBe(10000);
});
