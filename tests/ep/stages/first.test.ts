// Copyright (c) 2026 Garry Tan. MIT License.
// ep author --first, keyless: the calls step starts the named units of its chunk ahead of the rest, in the order named,
// and refuses a unit outside the chunk before any call, so it orders the work and never changes which units are authored.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { stagesCommands } from "../../../lanes/eng-planted/stages/commands.ts";
import { ITEMS, stubLauncher } from "../../../lanes/eng-planted/stages/ledger.ts";
import { drawFile, unitFolders } from "../../../lanes/eng-planted/stages/pipeline.ts";
import { authorStub, plantedUnits } from "./fixture.ts";

const SEED = "5eed0000000000000000000000000002";
let W = "";
let fx: { units: string; repos: string; ids: string[] };
let order: string[] = [];
const seen: string[] = [];
const io = { out: () => {}, err: () => {} };
const unavailable = () => {
  throw new Error("not used by the calls step");
};
const t = () =>
  stagesCommands({ author: () => stubLauncher(authorStub({ seen })), judge: unavailable, review: unavailable, build: unavailable, grader: unavailable } as never);
const calls = (flags: Record<string, string>) => {
  const item = ITEMS.find((i) => i.item === "ep-authoring")!;
  const all = { "--run": join(W, "run"), "--units": fx.units, "--repos": fx.repos, "--item": item.item, "--cap-usd": String(item.capUsd), "--ledger-record": join(W, "record"), "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--cache": join(W, "cache"), "--batch": "1", "--step": "calls", "--parallel": "1", ...flags };
  return t().author!.run({ flags: new Map(Object.entries(all)), bools: new Set<string>(), rest: [] }, io);
};
const written = () => seen.filter((c) => c.startsWith("writer:")).map((c) => c.slice(7));

beforeAll(() => {
  W = mkdtempSync(join(tmpdir(), "ep-first-"));
  fx = plantedUnits(W, 12);
  order = drawFile(join(W, "run"), unitFolders(fx.units, fx.repos), SEED).order.map((c) => c.id);
  for (const i of ITEMS) recordApproval(join(W, "record"), { action: "init", item: i.item, cap_micros: i.capUsd * 1_000_000, quotes: [{ words: "keyless test on a temporary ledger", by: "ep first test", source: "tests/ep/stages/first.test.ts" }], admission: "warn" });
});
afterAll(() => rmSync(W, { recursive: true, force: true }));

describe("ep author --first", () => {
  test("a unit outside the chunk is refused before any call", async () => {
    await expect(calls({ "--chunk": "4", "--first": order[5]! })).rejects.toThrow(/never adds to it/);
    expect(seen).toEqual([]);
  });
  test("the named units of the chunk start first, in the order named, then the rest in seeded order", async () => {
    expect(await calls({ "--chunk": "4", "--first": order[3]! + "," + order[1]! })).toBe(0);
    expect(written()).toEqual([order[3], order[1], order[0], order[2]]);
    expect(order.slice(0, 4).every((id) => existsSync(join(W, "run", "author", id, "calls.json")))).toBe(true);
  });
});
