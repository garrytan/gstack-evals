import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { COMMANDS, REPO_ROOT, run } from "../src/cli.ts";

// Every command plan v3.2 and interface v0.4 name. A row may move; none may disappear.
const PLANNED = ["skill-eval", "validate", "doctor", "preflight", "explain", "ledger", "rig", "tokens", "noloss", "plan", "run", "score", "report", "compare", "seal"];

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

async function call(argv: string[], root = REPO_ROOT) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, root);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function fakeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cli-test-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("gstack-evals dispatcher", () => {
  test("the table holds every planned command once, each at its own module", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(names.toSorted()).toEqual(PLANNED.toSorted());
    expect(new Set(COMMANDS.map((c) => c.module)).size).toBe(COMMANDS.length);
    for (const c of COMMANDS) expect(c.module).toMatch(/^(src|lanes)\/[a-z0-9_/.-]+\.ts$/);
  });

  test("--help lists every planned command and exits 0; --version prints VERSION", async () => {
    const r = await call(["--help"]);
    expect(r.code).toBe(0);
    for (const name of PLANNED) expect(r.out).toContain("  " + name + " ");
    expect(await call(["--version"], fakeRoot({ VERSION: "9.8.7\n" }))).toMatchObject({ code: 0, out: "9.8.7" });
  });

  test("an unbuilt command exits 2 with E_USAGE and not built yet", async () => {
    const root = fakeRoot({ VERSION: "0.0.1\n" });
    for (const c of COMMANDS) {
      const r = await call([c.name, "--help"], root);
      expect(r.code).toBe(2);
      for (const line of r.err.split("\n")) expect(line).toStartWith("E_USAGE ");
      expect(r.err).toContain("not built yet");
      expect(r.err).toContain("E_USAGE docs: docs/errors.md#e_usage");
    }
  });

  test("an unknown or missing command exits 2 with E_USAGE", async () => {
    for (const argv of [["no-such-command"], []]) {
      const r = await call(argv);
      expect(r.code).toBe(2);
      for (const line of r.err.split("\n")) expect(line).toStartWith("E_USAGE ");
    }
  });

  test("a built command's module gets the remaining arguments and sets the exit code", async () => {
    const skillEval = COMMANDS.find((c) => c.name === "skill-eval")!;
    const root = fakeRoot({ VERSION: "0.0.1\n", [skillEval.module]: "export async function main(argv) { console.error('args ' + argv.join(' ')); return argv.length; }\n" });
    expect((await call(["skill-eval", "--example", "--json"], root)).code).toBe(2);
    for (const exit of [0, 1, 3]) {
      const r = await call(["skill-eval"], fakeRoot({ [skillEval.module]: "export async function main() { return " + exit + "; }\n" }));
      expect(r).toMatchObject({ code: exit, err: "" });
    }
    const lines = (await call(["--help"], root)).out.split("\n");
    expect(lines.find((l) => l.startsWith("  skill-eval "))).not.toContain("not built yet");
    expect(lines.find((l) => l.startsWith("  ledger "))).toContain("[not built yet: U4, M0]");
  });

  test("a module that throws, lacks main or returns no exit code exits 2 with E_INTERNAL", async () => {
    const ledger = COMMANDS.find((c) => c.name === "ledger")!;
    const sources = [
      "export const notMain = 1;\n",
      "export async function main() { throw new Error('boom'); }\n",
      "export async function main() { throw new Error('first line\\nsecond line\\rthird line'); }\n",
      "export async function main() {}\n",
      "export async function main() { return 4; }\n",
    ];
    for (const source of sources) {
      const r = await call(["ledger"], fakeRoot({ [ledger.module]: source }));
      expect(r.code).toBe(2);
      for (const line of r.err.split("\n")) expect(line).toStartWith("E_INTERNAL ");
      expect(r.err).toContain("E_INTERNAL fix: this is a defect in " + ledger.module);
    }
    expect((await call(["ledger"], fakeRoot({ [ledger.module]: "export async function main() {}\n" }))).err).toContain("main returned undefined");
  });

  test("package.json carries the same version as VERSION", () => {
    const read = (path: string) => require("node:fs").readFileSync(join(REPO_ROOT, path), "utf8");
    expect(JSON.parse(read("package.json")).version).toBe(read("VERSION").trim());
  });

  test("bin/gstack-evals runs under Bun and prints the version", () => {
    const help = Bun.spawnSync([join(REPO_ROOT, "bin", "gstack-evals"), "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("gstack-evals " + require("node:fs").readFileSync(join(REPO_ROOT, "VERSION"), "utf8").trim());
    const unknown = Bun.spawnSync([join(REPO_ROOT, "bin", "gstack-evals"), "no-such-command"]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr.toString()).toStartWith("E_USAGE ");
  });
});
