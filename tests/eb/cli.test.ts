import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/eng-build/cli.ts";

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

test("unknown commands and missing flags exit 2 with the code first on stderr", async () => {
  const a = capture();
  expect(await main(["nope"], a.io)).toBe(2);
  expect(a.err.join("\n").split("\n").every((l) => l.startsWith("E_USAGE "))).toBe(true);
  const b = capture();
  expect(await main(["pilot"], b.io)).toBe(2);
  expect(b.err[0]).toStartWith("E_USAGE gstack-evals eb pilot: missing --units");
});

test("a pilot stop prints its code first and exits 2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eb-cli-"));
  writeFileSync(join(dir, "u.json"), "[]");
  writeFileSync(join(dir, "b.json"), "[]");
  const c = capture();
  expect(await main(["pilot", "--units", join(dir, "u.json"), "--builds", join(dir, "b.json"), "--seed", "1"], c.io)).toBe(2);
  expect(c.err[0]).toStartWith("E_EB_REACH pilot reach 0.000");
});

test("dryrun --part own passes", async () => {
  const c = capture();
  expect(await main(["dryrun", "--part", "own"], c.io)).toBe(0);
  expect(c.out.at(-1)).toStartWith("dry run: ");
});
