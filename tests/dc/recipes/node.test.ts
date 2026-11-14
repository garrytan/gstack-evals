// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 0's Node-version print (recipes/node.ts): the declared Node versions read from a candidate's tree, whether the
// pinned Node satisfies them, and the engine-mismatch flag from a failing qualification step, on invented trees.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { fixtureScreen } from "../../../lanes/design-constructed/recipes/fixtures.ts";
import { engineMismatch, nodeDeclared, nodeLine, NOT_VERSION_LIKE } from "../../../lanes/design-constructed/recipes/node.ts";
import { recordLine, runScreen } from "../../../lanes/design-constructed/recipes/sessions.ts";

function tarOf(files: Record<string, string>, format = "ustar"): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "dc-node-"));
  try {
    for (const [p, text] of Object.entries(files)) writeFileSync(join(dir, p), text);
    const r = Bun.spawnSync(["tar", "--format=" + format, "-cf", "-", "-C", dir, ...Object.keys(files)]);
    if (r.exitCode !== 0) throw new Error("tar failed");
    return new Uint8Array(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pkg = (node: unknown) => JSON.stringify({ name: "invented-app", engines: node === undefined ? undefined : { node } });

describe("the declared Node versions", () => {
  test("engines.node, .nvmrc and .node-version read from the tree, with the pinned Node's fit", () => {
    expect(nodeDeclared(tarOf({ "package.json": pkg(">=18 <20"), ".nvmrc": "v18.17.0\n" }))).toEqual({ engines: ">=18 <20", nvmrc: "v18.17.0", nodeVersion: null, pinnedFits: "no" });
    expect(nodeDeclared(tarOf({ "package.json": pkg("^20 || ^22 || >=24"), ".node-version": "24\n" }, "pax"))).toEqual({ engines: "^20 || ^22 || >=24", nvmrc: null, nodeVersion: "24", pinnedFits: "yes" });
    expect(nodeDeclared(tarOf({ ".nvmrc": "# pinned\nlts/iron\n" }))).toEqual({ engines: null, nvmrc: "lts/iron", nodeVersion: null, pinnedFits: "unknown" });
  });

  test("none and unknown when nothing is declared or the tree is not a tar", () => {
    expect(nodeDeclared(tarOf({ "package.json": pkg(undefined) }))).toEqual({ engines: null, nvmrc: null, nodeVersion: null, pinnedFits: "unknown" });
    expect(nodeDeclared(new TextEncoder().encode("tar"))).toEqual({ engines: null, nvmrc: null, nodeVersion: null, pinnedFits: "unknown" });
  });

  test("only version-like text prints, cut to 40 characters", () => {
    expect(nodeDeclared(tarOf({ "package.json": pkg("git+https://github.com/invented/app.git") })).engines).toBe(NOT_VERSION_LIKE);
    expect(nodeDeclared(tarOf({ "package.json": pkg(18) })).engines).toBe(NOT_VERSION_LIKE);
    const long = ">=16.0.0 <17.0.0 || >=18.0.0 <19.0.0 || >=20.0.0 <21.0.0";
    const d = nodeDeclared(tarOf({ "package.json": pkg(long) }));
    expect(d.engines).toBe(long.slice(0, 40));
    expect(d.pinnedFits).toBe("no");
    expect(nodeDeclared(tarOf({ "package.json": pkg("please use node 18") })).pinnedFits).toBe("unknown");
  });

  test("the engine-mismatch flag reads npm, pnpm and yarn errors", () => {
    for (const e of ["npm ERR! code EBADENGINE", " ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment", 'error invented-app@1.0.0: The engine "node" is incompatible with this module.', "npm WARN notsup Unsupported engine for invented-app@1.0.0"]) expect(engineMismatch(e)).toBe(true);
    expect(engineMismatch("npm ERR! code ERESOLVE")).toBe(false);
  });

  test("the printed fields", () => {
    expect(nodeLine({ engines: ">=18 <20", nvmrc: null, nodeVersion: "18", pinnedFits: "no" }, true)).toBe("node: engines >=18 <20, .nvmrc none, .node-version 18, pinned 24.22.3 fits no, node-engine flag yes");
    expect(nodeLine(null, false)).toBe("node: tree not read, pinned 24.22.3 fits unknown, node-engine flag no");
  });
});

describe("the screen prints each candidate's node fields next to its qualification result", () => {
  test("by label, with the flag from the failing step and never its stderr", async () => {
    const marker = "INVENTED-STDERR-MARKER";
    const world = fakeWorld({ handler: (vm, command) => (command.includes("npm ci") && vm.spec!.label.includes("c01") ? { exit: 1, stderr: "npm ERR! code EBADENGINE " + marker } : undefined) });
    const f = fixtureScreen([{}, {}, {}], { world });
    const trees = [tarOf({ "package.json": pkg(">=18 <20") }), tarOf({ ".nvmrc": "24\n" }), new TextEncoder().encode("tar")];
    const log: string[] = [];
    const s = await runScreen(f.candidates.map((c, i) => ({ ...c, tree: async () => trees[i]! })), { ...f.deps, log: (l) => log.push(l) });
    expect(s.records.map((r) => r.end)).toEqual(["not-qualified", "qualified", "qualified"]);
    expect(s.records[0]!.qualification!.engineError).toBe(true);
    expect(log).toEqual([
      "candidate c01: not-qualified, strict no, HTTP 200 no, sessions 1 (install failed); node: engines >=18 <20, .nvmrc none, .node-version none, pinned 24.22.3 fits no, node-engine flag yes",
      "candidate c02: qualified, strict yes, HTTP 200 yes, sessions 1; node: engines none, .nvmrc 24, .node-version none, pinned 24.22.3 fits yes, node-engine flag no",
      "candidate c03: qualified, strict yes, HTTP 200 yes, sessions 1; node: engines none, .nvmrc none, .node-version none, pinned 24.22.3 fits unknown, node-engine flag no",
    ]);
    expect(s.records.map(recordLine).join("\n")).not.toContain(marker);
  });

  test("a tree that can't be read prints as not read and the screen goes on as before", async () => {
    const f = fixtureScreen([{}]);
    let calls = 0;
    const s = await runScreen([{ ...f.candidates[0]!, tree: async () => (calls++ === 0 ? Promise.reject(new Error("git archive failed")) : new TextEncoder().encode("tar")) }], f.deps);
    expect(s.records[0]!.end).toBe("qualified");
    expect(recordLine(s.records[0]!)).toEndWith("; node: tree not read, pinned 24.22.3 fits unknown, node-engine flag no");
  });
});
