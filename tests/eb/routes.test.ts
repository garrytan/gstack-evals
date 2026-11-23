import { expect, test } from "bun:test";
import { probeRoutes, ROUTES } from "../../lanes/eng-build/routes.ts";

test("one stubbed call per route, a thrown call fails the probe and the rest still run", async () => {
  const seen: string[] = [];
  const r = await probeRoutes(async (route) => {
    seen.push(route.name);
    if (route.name === "review-sol") throw new Error("E_PV_PROVIDER_DRIFT served by azure");
    return { status: 200, text: "ok", micros: 500, served_by: null };
  });
  expect(seen).toEqual(ROUTES.map((x) => x.name));
  expect(r.ok).toBe(false);
  expect(r.lines.find((l) => l.startsWith("route review-sol"))).toContain("FAIL");
});
