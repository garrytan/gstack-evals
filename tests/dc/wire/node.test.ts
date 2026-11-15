// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 0's Node-version count (wire/recipes.ts nodeDrops) and the refusal it puts on the gate check and authoring
// (nodeDropRule, E_DCW_NODE_DROPS) at 2 against 3 drops, with the Captain's clearance, on invented records and sinks.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import type { CandidateRecord } from "../../../lanes/design-constructed/recipes/sessions.ts";
import { authorRow, gatecheckRow } from "../../../lanes/design-constructed/wire/author.ts";
import { nodeDropRule, nodeDrops, nodeDropsLine } from "../../../lanes/design-constructed/wire/recipes.ts";
import type { Args, RowEnv } from "../../../lanes/design-constructed/wire/start.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "dc-node-wire-"));
  dirs.push(d);
  return d;
};

const record = (id: string, strict: boolean, fits: "yes" | "no" | "unknown", engineError = false) =>
  ({ id, strict, node: { engines: null, nvmrc: null, nodeVersion: null, pinnedFits: fits }, qualification: { engineError } }) as unknown as CandidateRecord;

const screenOf = (labels: string[], cleared?: string[]) => {
  const d = join(temp(), "recipes");
  mkdirSync(d);
  writeFileSync(join(d, "node-drops.json"), JSON.stringify({ pinned: "24.22.3", count: labels.length, labels }));
  if (cleared) writeFileSync(join(d, "node-cleared.json"), JSON.stringify({ labels: cleared }));
  return d;
};

const caught = (f: () => unknown): DcError => {
  try {
    f();
  } catch (e) {
    if (e instanceof DcError) return e;
    throw e;
  }
  throw new Error("no refusal");
};

describe("the Node-version count", () => {
  test("counts a candidate that did not qualify on an engine-mismatch error no declared range explains", () => {
    const n = nodeDrops([record("c001", false, "no"), record("c002", false, "unknown", true), record("c003", true, "no"), record("c004", false, "yes"), record("c005", false, "unknown"), { ...record("c006", false, "unknown"), node: null, qualification: null } as CandidateRecord, record("c007", false, "no", true)]);
    expect(n).toEqual({ pinned: "24.22.3", count: 1, labels: ["c002"] });
    expect(nodeDropsLine(n)).toBe("node-version drops: 1 (c002) at pinned Node 24.22.3");
    expect(nodeDropsLine(nodeDrops([]))).toBe("node-version drops: 0 at pinned Node 24.22.3");
  });

  // Value: protects=the Captain's Node ruling of 2026-11-15; fails_when=a candidate whose declared range excludes the pinned Node counts toward E_DCW_NODE_DROPS; why_new=the ruling makes such a candidate ineligible at the draw; seam=nodeDrops, nodeDropRule; no_claim=the draw itself (tests/dc/wire/recipes-row.test.ts)
  test("declared-range exclusions never count, so 3 of them leave the gate check and authoring open", () => {
    const n = nodeDrops([record("c001", false, "no"), record("c002", false, "no", true), record("c003", false, "no", true)]);
    expect(n.count).toBe(0);
    expect(nodeDropRule(screenOf(n.labels))()).toBeNull();
  });

  // Value: protects=the 3-drop stop under the ruling; fails_when=3 engine-mismatch failures no declared range explains stop nothing; why_new=the ruling keeps the stop at 3; seam=nodeDrops, nodeDropsLine, nodeDropRule; no_claim=the qualification's engine-error reading
  test("3 Node failures that no declared range explains still refuse with E_DCW_NODE_DROPS", () => {
    const n = nodeDrops([record("c001", false, "yes", true), record("c002", false, "unknown", true), { ...record("c003", false, "unknown", true), node: null } as CandidateRecord]);
    expect(nodeDropsLine(n)).toBe("node-version drops: 3 (c001, c002, c003) at pinned Node 24.22.3; 3 or more, so gatecheck and author refuse until the Captain clears the list");
    const e = caught(() => nodeDropRule(screenOf(n.labels))());
    expect(e.code).toBe("E_DCW_NODE_DROPS");
    expect(e.message).toContain("c001, c002, c003");
  });
});

describe("the refusal", () => {
  test("2 drops pass and 3 refuse with E_DCW_NODE_DROPS naming the labels", () => {
    expect(nodeDropRule(screenOf(["c001", "c002"]))()).toBeNull();
    const e = caught(nodeDropRule(screenOf(["c001", "c002", "c003"])));
    expect(e.code).toBe("E_DCW_NODE_DROPS");
    expect(e.message).toBe("3 stage 0 candidates dropped for a Node-version cause at pinned Node 24.22.3: c001, c002, c003. 3 or more stop the gate check and authoring until the Captain clears this list");
  });

  test("the Captain's clearance of that exact list lifts it; another list does not", () => {
    expect(nodeDropRule(screenOf(["c001", "c002", "c003"], ["c003", "c001", "c002"]))()).toBeNull();
    const e = caught(nodeDropRule(screenOf(["c001", "c002", "c003"], ["c001", "c002"])));
    expect(e.code).toBe("E_DCW_NODE_DROPS");
    expect(e.message).toEndWith("; node-cleared.json names another list");
  });

  test("a missing recipes sink or record refuses under start rule 7", () => {
    expect(nodeDropRule(undefined)()?.[0]).toBe("7");
    expect(nodeDropRule(temp())()?.[1]).toContain("node-drops.json is missing");
  });
});

describe("the gate check and authoring rows", () => {
  const io = { out: () => {}, err: () => {} };
  const env = { providers: {}, dryRun: async () => false, lane: () => ({ commit: "0".repeat(40), dirty: false, root: "/nonexistent-lane" }), now: () => new Date(), power: {}, vocabulary: () => new Set<string>() } as unknown as RowEnv;
  const args = (flags: Record<string, string>): Args => ({ flags: new Map(Object.entries(flags)), bools: new Set(), rest: [] });
  const inputs = () => {
    const d = temp();
    mkdirSync(join(d, "app"));
    writeFileSync(join(d, "app", "README.md"), "Invented app\n");
    writeFileSync(join(d, "apps.json"), JSON.stringify([{ label: "b01", dir: "app", designFiles: [], routeFiles: [] }]));
    writeFileSync(join(d, "planted.json"), "[]");
    mkdirSync(join(d, "gate"));
    writeFileSync(join(d, "gate", "result.json"), JSON.stringify({ ok: true }));
    return d;
  };
  const rowError = async (run: () => Promise<number> | number): Promise<DcError> => {
    try {
      await run();
    } catch (e) {
      if (e instanceof DcError) return e;
      throw e;
    }
    throw new Error("no refusal");
  };

  for (const [name, row, flags] of [
    ["gatecheck", gatecheckRow, (d: string) => ({ "--units": join(d, "planted.json"), "--apps": join(d, "apps.json"), "--gstack": d, "--out": join(d, "sink") })],
    ["author pilot", authorRow, (d: string) => ({ "--step": "pilot", "--item": "dc-authoring-1", "--apps": join(d, "apps.json"), "--gstack": d, "--gate": join(d, "gate"), "--out": join(d, "sink") })],
  ] as const) {
    test(name + " refuses at 3 drops before any provider and passes the rule at 2", async () => {
      const d = inputs();
      const three = await rowError(() => row(args({ ...flags(d), "--screen": screenOf(["c001", "c002", "c003"]) }), io, env));
      expect(three.code).toBe("E_DCW_NODE_DROPS");
      expect(three.message).toContain("c001, c002, c003");
      const two = await rowError(() => row(args({ ...flags(d), "--screen": screenOf(["c001", "c002"]) }), io, env));
      expect(two.code).toBe("E_DCW_START_RULE");
      expect(two.message).toStartWith("start rule 9:");
      const none = await rowError(() => row(args(flags(d)), io, env));
      expect(none.message).toContain("--screen names no recipes sink");
    });
  }
});
