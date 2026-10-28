import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const sources = [
  ...readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts")).map((f) => `src/${f}`),
  "contract-lines/extract.ts",
];
const transpiler = new Bun.Transpiler({ loader: "ts" });

describe("every runner source parses", () => {
  test("the list covers src/run.ts and src/session.ts", () => {
    expect(sources).toContain("src/run.ts");
    expect(sources).toContain("src/session.ts");
  });
  for (const f of sources) {
    test(f, () => {
      expect(() => transpiler.transformSync(readFileSync(join(root, f), "utf8"))).not.toThrow();
    });
  }
});
