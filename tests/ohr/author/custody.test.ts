// Value: protects=section 3's sealing: plaintext only in /dev/shm, sealed output outside the repo, plaintext deleted after the seal, decryption only into /dev/shm, and a summary of counts and digests.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authorToCustody, openCustody, sealCustody, unsealTo, writeAuthoring } from "../../../lanes/office-hours-rewrite/author/custody.ts";
import { authorRun } from "../../../lanes/office-hours-rewrite/author/run.ts";
import { FIXTURE_SCREEN, fixtureParser, runCaller, wordLabeller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { CAPS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { REPO_ROOT } from "../../../lanes/product-value/io.ts";

const made: string[] = [];
const temp = (prefix: string) => (made.push(mkdtempSync(prefix)), made.at(-1)!);
const shm = () => join(temp("/dev/shm/ohr-test-"), "work");
const outside = () => join(temp(join(tmpdir(), "ohr-out-")), "briefs.tar.age");
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const fakeSealer = (work: string, out: string) => writeFileSync(out, "sealed:" + readdirSync(work).sort().join(","));

describe("custody paths", () => {
  test("refuses a sealed output inside the repository", () => {
    expect(() => openCustody(shm(), join(REPO_ROOT, "briefs.tar.age"))).toThrow("E_OHR_CUSTODY");
  });
  test("refuses a work directory outside /dev/shm", () => {
    expect(() => openCustody(join(temp(join(tmpdir(), "w-")), "work"), outside())).toThrow("not under /dev/shm");
  });
  test("refuses an existing work directory or output", () => {
    const w = shm();
    expect(() => openCustody(join(w, ".."), outside())).toThrow("already exists");
    const o = outside();
    writeFileSync(o, "x");
    expect(() => openCustody(w, o)).toThrow("already exists");
  });
  test("decrypts only into /dev/shm", () => {
    let ran = false;
    expect(() => unsealTo("x.age", join(tmpdir(), "nope"), () => (ran = true))).toThrow("E_OHR_CUSTODY");
    expect(ran).toBe(false);
    const d = shm();
    expect(unsealTo("x.age", d, () => (ran = true))).toBe(d);
    expect(ran).toBe(true);
  });
  test("a sealer that writes nothing keeps the plaintext and says so", () => {
    const w = openCustody(shm(), outside());
    expect(() => sealCustody(w, outside(), () => {})).toThrow("delete it");
    expect(existsSync(w)).toBe(true);
    rmSync(w, { recursive: true, force: true });
  });
});

describe("writing a run", () => {
  test("writes the briefs in types.ts's layout, seals them and deletes the plaintext", async () => {
    const call = runCaller();
    const run = await authorRun({ call, label: wordLabeller(), parse: fixtureParser, screen: FIXTURE_SCREEN, spent: () => call.state.drafts * 1.04 }, { cap: CAPS.authoring, concurrency: 8 });
    const work = shm();
    const sink = openCustody(work, outside());
    writeAuthoring(sink, run);
    const briefs = readdirSync(join(sink, "briefs"));
    expect(briefs).toHaveLength(110);
    const t8 = briefs.find((id) => JSON.parse(readFileSync(join(sink, "briefs", id, "brief.json"), "utf8")).type === "T8")!;
    expect(readdirSync(join(sink, "briefs", t8)).sort()).toEqual(["brief.json", "key.json", "opening.md", "prior.json", "sheet.json"]);
    const pair = JSON.parse(readFileSync(join(sink, "briefs", "d1a", "key.json"), "utf8"));
    expect(Object.keys(pair).sort()).toEqual(["actions", "call", "decisive", "traction", "twin", "wrong_call"]);
    rmSync(sink, { recursive: true, force: true });
    const out = outside();
    const summary = authorToCustody(run, { work: shm(), out, sealer: fakeSealer });
    expect(readFileSync(out, "utf8")).toBe("sealed:authoring,briefs");
    expect(summary.placed).toBe(110);
    expect(JSON.stringify(summary)).not.toContain(run.outcomes[0]!.files!.opening.slice(0, 30));
  });
});
