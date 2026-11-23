// Value: protects=section 3's sealing: plaintext only in /dev/shm, sealed output outside the repo, plaintext deleted after the seal, decryption only into /dev/shm, and a summary of counts and digests.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ageDecrypter, authorToCustody, openCustody, sealCustody, unsealTo, writeAuthoring } from "../../../lanes/office-hours-rewrite/author/custody.ts";
import { authorRun } from "../../../lanes/office-hours-rewrite/author/run.ts";
import { answersOf, fakeMeter, FIXTURE_SCREEN, fixtureParser, plantedFirstAttempt, runCaller, wordLabeller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
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
  test("writes the 96 placed briefs, reused ones included, in types.ts's layout, with the outcome log, the reused outcomes and the summary, seals them and deletes the plaintext", async () => {
    const placed = await plantedFirstAttempt();
    const m = fakeMeter(runCaller());
    const run = await authorRun({ call: m.call, label: wordLabeller(), parse: fixtureParser, screen: FIXTURE_SCREEN, spent: m.spent, spentOn: m.spentOn }, { cap: CAPS.authoring, concurrency: 8, reuse: { placed, answers: answersOf(placed), failed: [] } });
    const work = shm();
    const sink = openCustody(work, outside());
    writeAuthoring(sink, run);
    const briefs = readdirSync(join(sink, "briefs"));
    expect(briefs).toHaveLength(96);
    expect(placed.every((x) => briefs.includes(x.id))).toBe(true);
    const t8 = briefs.find((id) => JSON.parse(readFileSync(join(sink, "briefs", id, "brief.json"), "utf8")).type === "T8")!;
    expect(readdirSync(join(sink, "briefs", t8)).sort()).toEqual(["brief.json", "key.json", "opening.md", "prior.json", "sheet.json"]);
    const pair = JSON.parse(readFileSync(join(sink, "briefs", briefs.find((id) => /^d\d+a$/.test(id))!, "key.json"), "utf8"));
    expect(Object.keys(pair).sort()).toEqual(["actions", "call", "decisive", "traction", "twin", "wrong_call"]);
    expect(readdirSync(join(sink, "authoring")).sort()).toEqual(["outcomes.jsonl", "reused.jsonl", "summary.json"]);
    expect(readFileSync(join(sink, "authoring", "reused.jsonl"), "utf8").trim().split("\n")).toHaveLength(placed.length);
    rmSync(sink, { recursive: true, force: true });
    const out = outside();
    const summary = authorToCustody(run, { work: shm(), out, sealer: fakeSealer });
    expect(readFileSync(out, "utf8")).toBe("sealed:authoring,briefs");
    expect(summary.placed).toBe(96);
    expect(JSON.stringify(summary)).not.toContain(run.outcomes[0]!.files!.opening.slice(0, 30));
  });
});

describe("custody paths follow links (pre-run change 1)", () => {
  test("a work or decrypt directory under a /dev/shm folder that links to disk is refused", () => {
    const disk = temp(join(tmpdir(), "ohr-disk-"));
    const link = join(temp("/dev/shm/ohr-link-"), "to-disk");
    symlinkSync(disk, link);
    expect(() => openCustody(join(link, "w"), outside())).toThrow("E_OHR_CUSTODY");
    expect(() => unsealTo(join(disk, "x.age"), join(link, "d"), () => {})).toThrow("E_OHR_CUSTODY");
  });
  test("a truncated sealed file leaves nothing it decrypted in /dev/shm, and age's failure still surfaces", () => {
    const keys = temp(join(tmpdir(), "ohr-age-"));
    const plain = temp(join(tmpdir(), "ohr-plain-"));
    writeFileSync(join(plain, "brief.md"), randomBytes(256 * 1024).toString("hex"));
    const sealed = join(keys, "sealed.age");
    const made = spawnSync("bash", ["-o", "pipefail", "-c", 'age-keygen -o "$1/key.txt" 2>/dev/null && tar -C "$2" -cf - . | age -r "$(age-keygen -y "$1/key.txt")" -o "$3"', "seal", keys, plain, sealed]);
    expect(made.status).toBe(0);
    const whole = readFileSync(sealed);
    writeFileSync(sealed, whole.subarray(0, whole.length >> 1));
    const dir = "/dev/shm/ohr-w-" + randomBytes(4).toString("hex") + ".open-checkpoint";
    expect(() => unsealTo(sealed, dir, ageDecrypter(join(keys, "key.txt")))).toThrow("decrypting with age failed");
    expect(readdirSync("/dev/shm").filter((n) => n.startsWith("ohr-w-"))).toEqual([]);
  });
});
