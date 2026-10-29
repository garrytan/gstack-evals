import { describe, expect, test } from "bun:test";
import { CODES, type ReasonCode } from "../../src/errors/codes.ts";
import { explainCommand } from "../../src/skill-eval/cli/explain.ts";
import { collect } from "./helpers.ts";

async function explain(argv: string[]) {
  const io = collect();
  const code = await explainCommand(argv, io);
  return { code, ...io.text() };
}

describe("gstack-evals explain", () => {
  // Value: protects=every reason code explains with its fix, side effects, retry safety, resumability and docs anchor; fails_when=a code is missing or a field is dropped; why_new=new command; seam=src/errors/codes.ts; no_claim=none beyond protects
  test("every code explains, stops with side effects and resumability, warnings marked as warnings", async () => {
    for (const code of Object.keys(CODES) as ReasonCode[]) {
      const r = await explain([code.toLowerCase()]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("fix: " + CODES[code].fix);
      expect(r.out).toContain("docs: docs/errors.md#" + code.toLowerCase());
      if (CODES[code].exit === null) expect(r.out).toContain("warning: attaches to any verdict");
      else expect(r.out).toContain("side effects: ");
    }
    const lock = await explain(["LOCK_MISSING"]);
    expect(lock.out).toStartWith("LOCK_MISSING (exit 2, INCOMPLETE)");
    expect(lock.out).toContain("resumable: no; start a new run after the fix");
    expect(JSON.parse((await explain(["CAP_STOP", "--json"])).out)).toMatchObject({ code: "CAP_STOP", exit: 2, resumable: true, doc: "docs/errors.md#cap_stop" });
  });

  // Value: protects=a wrong call exits 2 with E_USAGE and suggests near codes; fails_when=an unknown code exits 0 or the suggestion is lost; why_new=new; seam=none; no_claim=none beyond protects
  test("an unknown code or a wrong call exits 2 with E_USAGE and near matches", async () => {
    const r = await explain(["LOCK"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("did you mean LOCK_MISSING, LOCK_DRIFT");
    for (const line of r.err.split("\n")) expect(line).toStartWith("E_USAGE ");
    expect((await explain([])).code).toBe(2);
    expect((await explain(["A", "B"])).code).toBe(2);
  });
});
