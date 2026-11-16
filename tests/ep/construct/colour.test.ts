import { describe, expect, test } from "bun:test";
import { plantedClass, scorableFail } from "../../../lanes/eng-build/recipes.ts";
import { parseJestJson } from "../../../lanes/real-outcome/task/record.ts";

const report = (msg: string) => JSON.stringify({ testResults: [{ name: "/work/test/calc.test.js", status: "failed", assertionResults: [{ fullName: "add sums", status: "failed", failureMessages: [msg] }] }] });
const classOf = (msg: string) => plantedClass("vitest", parseJestJson(report(msg), "/work").results["test/calc.test.js::add sums"]!, {}, false);
const colour = (frame: string) => "\x1b[31mTypeError\x1b[39m: Cannot read properties of undefined (reading 'total')\n\x1b[2m    at add (" + frame + ")\x1b[22m\n\x1b[2m    at /work/test/calc.test.js:5:5\x1b[22m";
const plain = (frame: string) => "TypeError: Cannot read properties of undefined (reading 'total')\n    at add (" + frame + ")\n    at /work/test/calc.test.js:5:5";

describe("planted rule 2 reads a coloured vitest or jest message as its plain text", () => {
  test("a TypeError whose innermost frame is product code is a crash, coloured or not", () => {
    expect(classOf(plain("/work/src/calc.js:3:9"))).toBe("crash");
    expect(classOf(colour("/work/src/calc.js:3:9"))).toBe("crash");
  });
  test("a TypeError whose innermost frame is a dependency stays unscorable, coloured or not", () => {
    const p = classOf(plain("/work/node_modules/lib/index.js:3:9"));
    expect(scorableFail(p)).toBe(false);
    expect(classOf(colour("/work/node_modules/lib/index.js:3:9"))).toBe(p);
  });
});
