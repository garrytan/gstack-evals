// Copyright (c) 2026 Garry Tan. MIT License.
// recipe.json's reader, PD-10's two readings of "renders", route picking and the recipe screen with its supply rule,
// on invented fixtures in a fake Ubicloud.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { fakeMoney, fakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { secretHit } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { content, fixtureMatcher, fixtureScreen, LOGIN, page, RECIPE, ROUTES, type AppKind, type FixtureApp } from "../../../lanes/design-constructed/recipes/fixtures.ts";
import { onRoute, pickRoutes, readLoad, routeUrl } from "../../../lanes/design-constructed/recipes/qualify.ts";
import { parseRecipe, RECIPE_PROMPT_PATH, RECIPE_PROMPT_SHA256, recipePrompt, type Recipe } from "../../../lanes/design-constructed/recipes/recipe.ts";
import { runScreen, supply } from "../../../lanes/design-constructed/recipes/sessions.ts";

const parsed = (o: Record<string, unknown> = {}, seededLogin = true): Recipe => {
  const r = parseRecipe(RECIPE(o), { seededLogin });
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.recipe;
};

describe("the recipe prompt", () => {
  test("its bytes match the pin and it asks for every field", () => {
    expect(createHash("sha256").update(readFileSync(RECIPE_PROMPT_PATH)).digest("hex")).toBe(RECIPE_PROMPT_SHA256);
    const p = recipePrompt();
    for (const f of ['"install"', '"seed"', '"build"', '"start"', '"base_url"', '"routes"', '"services"', '"login"', "/work/recipe.json", "at least 3"]) expect(p).toContain(f);
    expect(p).not.toContain("\u2014");
  });
});

describe("recipe.json", () => {
  test("a full recipe reads", () => {
    const r = parsed({ login: LOGIN });
    expect(r.routes.length).toBe(3);
    expect(r.services[0]!.image).toBe("postgres:16");
    expect(r.login?.usernameSelector).toBe("#email");
  });
  for (const [name, o, want] of [
    ["two routes", { routes: ["/a", "/b", "/a/"] }, "fewer than 3 distinct"],
    ["an outside base URL", { base_url: "https://app.example.com" }, "base_url"],
    ["an image off Docker Hub", { services: [{ name: "db", image: "ghcr.io/acme/db:1", ports: [5432] }] }, "not a Docker Hub image"],
    ["a key in the recipe", { seed: "OPENAI=sk-proj-" + "a".repeat(40) }, "key pattern"],
    ["an outside login route", { login: { ...LOGIN, route: "https://auth.example.com/authorize" } }, "login.route"],
    ["a missing start", { start: "" }, "start is not"],
  ] as Array<[string, Record<string, unknown>, string]>)
    test(name + " is refused", () => {
      const r = parseRecipe(RECIPE(o), { seededLogin: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.join("; ")).toContain(want);
    });
  test("a login is refused when the run allows no seeded login", () => {
    const r = parseRecipe(RECIPE({ login: LOGIN }), { seededLogin: false });
    expect(!r.ok && r.problems[0]).toContain("not allowed");
  });
  test("not JSON", () => expect(parseRecipe("{", { seededLogin: true }).ok).toBe(false));
});

describe("PD-10's readings", () => {
  const read = (kind: AppKind, signedIn = false) => readLoad(page(kind, "http://localhost:3000/projects", [375, 812], signedIn));
  test("each fixture page under the strict and the HTTP 200 reading", () => {
    expect(read("content")).toEqual({ strict: null, http200: null });
    expect(read("blank")).toEqual({ strict: "a blank page", http200: null });
    expect(read("login-redirect").strict).toContain("not the requested route");
    expect(read("login-redirect").http200).toBeNull();
    expect(read("login-only")).toEqual({ strict: "a login form alone", http200: null });
    expect(read("login-only", true)).toEqual({ strict: null, http200: null });
    expect(read("outside-auth")).toEqual({ strict: "no response", http200: "no response" });
    expect(read("fallback").strict).toContain("framework fallback");
    expect(read("fallback").http200).toBeNull();
    expect(read("page-error")).toEqual({ strict: "an uncaught page error", http200: "an uncaught page error" });
    expect(read("http-500")).toEqual({ strict: "HTTP 500", http200: "HTTP 500" });
  });
  test("a settings page with a password field and real content is not a login form alone", () => {
    const l = { url: "http://localhost:3000/settings", viewport: [768, 1024] as const, status: 200, finalUrl: "http://localhost:3000/settings/", pageErrors: 0, probe: content({ passwordInputs: 1, textOutsideLoginForm: 900 }) };
    expect(readLoad(l).strict).toBeNull();
  });
  test("ending on the route: trailing slash and query ignored, fragment routes compared, other origins refused", () => {
    expect(onRoute("http://localhost:3000/a", "http://localhost:3000/a/?x=1")).toBe(true);
    expect(onRoute("http://localhost:3000/#/a", "http://localhost:3000/#/a/")).toBe(true);
    expect(onRoute("http://localhost:3000/#/a", "http://localhost:3000/#/login")).toBe(false);
    expect(onRoute("http://localhost:3000/a", "https://auth.example.com/a")).toBe(false);
  });
  test("route URLs keep a base path once", () => {
    expect(routeUrl("http://localhost:3000/app", "/projects")).toBe("http://localhost:3000/app/projects");
    expect(routeUrl("http://localhost:3000/app", "/app/projects")).toBe("http://localhost:3000/app/projects");
    expect(routeUrl("http://localhost:3000", "/projects")).toBe("http://localhost:3000/projects");
  });
});

describe("route picking", () => {
  test("strict takes the first three recipe paths that match three distinct discovered routes", () => {
    const r = parsed({ routes: ["/projects/1", "/projects/2", "/about", "/tickets", "/docs/a/b", "/settings"] });
    expect(pickRoutes(r, ROUTES, fixtureMatcher)).toEqual({ strict: ["/projects/1", "/tickets", "/docs/a/b"], http200: ["/projects/1", "/projects/2", "/about"] });
  });
  test("a path matching two routes yields to a later path that needs one of them", () => {
    const routes = [{ id: "new", pattern: "/items/new" }, { id: "item", pattern: "/items/[id]" }, { id: "list", pattern: "/items" }];
    const r = parsed({ routes: ["/items/new", "/items/7", "/items"] });
    expect(pickRoutes(r, routes, fixtureMatcher).strict).toEqual(["/items/new", "/items/7", "/items"]);
  });
  test("a recipe with fewer than three discovered routes is short under the strict reading only", () => {
    const r = parsed({ routes: ["/a", "/b", "/projects"] });
    const p = pickRoutes(r, ROUTES, fixtureMatcher);
    expect(p.strict).toEqual(["/projects"]);
    expect(p.http200.length).toBe(3);
  });
});

const screen = async (apps: FixtureApp[], o: Parameters<typeof fixtureScreen>[1] = {}) => {
  const f = fixtureScreen(apps, o);
  return { ...f, s: await runScreen(f.candidates, f.deps) };
};

describe("the recipe screen", () => {
  test("content qualifies under both readings; a blank page qualifies under HTTP 200 only", async () => {
    const { s, world } = await screen([{ app: "content" }, { app: "blank" }]);
    expect(s.records.map((r) => [r.end, r.strict, r.http200])).toEqual([["qualified", true, true], ["not-qualified", false, true]]);
    expect(world.deleted.length).toBe(world.vms.length);
    expect(s.records[0]!.qualification!.loads.length).toBe(9);
  });
  test("a login-only app qualifies with the seeded user and fails without it", async () => {
    const withUser = await screen([{ app: "login-only", recipe: RECIPE({ login: LOGIN }) }]);
    expect(withUser.s.records[0]!.strict).toBe(true);
    const noUser = await screen([{ app: "login-only" }]);
    expect(noUser.s.records[0]!.strict).toBe(false);
    expect(noUser.s.records[0]!.http200).toBe(true);
    const refused = await screen([{ app: "login-only", recipe: RECIPE({ login: LOGIN }) }], { seededLogin: false });
    expect(refused.s.records[0]!.end).toBe("bad-recipe");
  });
  test("an outside-auth app qualifies under neither reading", async () => {
    const { s } = await screen([{ app: "outside-auth" }]);
    expect([s.records[0]!.strict, s.records[0]!.http200]).toEqual([false, false]);
  });
  test("an own-limit stop leaves the candidate unqualified with no retry; an infra failure gets one J1 retry after reconcile", async () => {
    const { s, money } = await screen([{ end: "own-limit" }, { end: "infra-once" }, { end: "infra" }]);
    expect(s.records.map((r) => [r.end, r.sessions])).toEqual([["own-limit", 1], ["qualified", 2], ["infra", 2]]);
    expect(money.log.filter((l) => l.startsWith("reconcile")).length).toBe(2);
    const i = money.log.indexOf("reconcile s2");
    expect(i).toBeGreaterThan(-1);
    expect(money.log[i + 1]).toBe("admit recipe session c02 retry");
    expect(s.funnel.sessions).toBe(5);
    expect(s.funnel.candidates).toBe(3);
  });
  test("a session that writes no recipe is unqualified", async () => {
    const { s } = await screen([{ recipe: null }]);
    expect(s.records[0]!.end).toBe("no-recipe");
  });
  test("the screen stops at 20 qualified and at 30 candidates", async () => {
    const twenty = await screen(Array.from({ length: 25 }, () => ({ app: "content" as const })));
    expect(twenty.s.records.length).toBe(20);
    expect(twenty.s.baseApps.length).toBe(20);
    const thirty = await screen(Array.from({ length: 35 }, () => ({ app: "blank" as const, spentUsd: 1 })));
    expect(thirty.s.records.length).toBe(30);
  });
  test("at $3 a session the $95 item admits all 30; at $3.20, 29, then a cap stop", async () => {
    const at3 = await screen(Array.from({ length: 30 }, () => ({ app: "blank" as const, spentUsd: 3 })));
    expect([at3.s.funnel.sessions, at3.s.capStop]).toEqual([30, null]);
    const at320 = await screen(Array.from({ length: 30 }, () => ({ app: "blank" as const, spentUsd: 3.2 })));
    expect(at320.s.funnel.sessions).toBe(29);
    expect(at320.s.capStop?.item).toBe("dc-base-apps");
  });
  test("an audit hit in a recipe VM stops the screen with E_DC_SANDBOX_AUDIT", async () => {
    const f = fixtureScreen([{ app: "content" }], {});
    f.world.plant = (vm) => void vm.egress.push({ host: "203.0.113.5", port: 443 });
    await expect(runScreen(f.candidates, f.deps)).rejects.toMatchObject({ code: "E_DC_SANDBOX_AUDIT" });
  });
  test("a failed preamble step that leaves no egress chain: the E_DC_SANDBOX_AUDIT stop names the step and its exit code, with no key text", async () => {
    const stderr = "Failed to mask unit: token sk-ant-" + "k".repeat(40) + " in /root/.capy/drive/x/y " + "z".repeat(600);
    const world = fakeWorld({ faults: { exit: { ruleset: 1 } }, ssh: async (_vm, command) => (command.startsWith("systemctl mask") ? { exit: 1, stdout: "", stderr } : undefined) });
    const f = fixtureScreen([{ app: "content" }], { world });
    const e = (await runScreen(f.candidates, f.deps).catch((x) => x)) as DcError;
    expect(e).toBeInstanceOf(DcError);
    expect(e.code).toBe("E_DC_SANDBOX_AUDIT");
    const step = "after preamble step failed (exit 1): systemctl mask --now unattended-upgrades.service: ";
    expect(e.message).toContain("could not collect its evidence: the ruleset command exited 1; " + step + "Failed to mask unit: token [redacted] in [redacted] zzz");
    expect(secretHit(e.message)).toBeNull();
    expect(e.message.slice(e.message.indexOf(step) + step.length, e.message.indexOf(". The base-app screen stops")).length).toBe(400);
  });
  test("a key in the recipe written to /work is caught by the recipe VM's audit", async () => {
    const f = fixtureScreen([{ recipe: RECIPE({ seed: "x sk-ant-api03-" + "z".repeat(30) }) }]);
    await expect(runScreen(f.candidates, f.deps)).rejects.toMatchObject({ code: "E_DC_SANDBOX_AUDIT" });
  });
});

describe("the supply rule", () => {
  const apps = (q: number) => Array.from({ length: 30 }, (_, i) => ({ app: (i < q ? "content" : "blank") as AppKind, spentUsd: 1 }));
  test("16 qualified are the base apps", async () => {
    const { s } = await screen(apps(16));
    const r = supply(s);
    expect(r.status).toBe("ok");
    expect(r.baseApps.length).toBe(16);
    expect(r.lines.at(-1)).toContain("qualified 16 under the strict reading and 30 under the HTTP 200 reading");
  });
  test("15 qualified is E_DC_SUPPLY_SHORT with both counts", async () => {
    const { s } = await screen(apps(15));
    try {
      supply(s);
      throw new Error("no stop");
    } catch (e) {
      expect(e).toBeInstanceOf(DcError);
      expect((e as DcError).code).toBe("E_DC_SUPPLY_SHORT");
      expect((e as DcError).message).toContain("15 base apps qualify under the strict reading of renders (30 under the HTTP 200 reading)");
    }
  });
  test("a cap stop with 16 or more qualified goes to the Captain at that count", async () => {
    const money = fakeMoney({ "dc-base-apps": 16 * 1 + 5 - 0.5 });
    const { s } = await screen(apps(30), { money });
    expect(s.capStop?.item).toBe("dc-base-apps");
    const r = supply(s);
    expect(r.status).toBe("captain");
    expect(r.baseApps.length).toBe(16);
  });
  test("a dc-hosts cap stop goes to the Captain", async () => {
    const { s } = await screen(apps(30), { hostsRefuse: true });
    expect(s.capStop?.item).toBe("dc-hosts");
    expect(supply(s).status).toBe("captain");
  });
});
