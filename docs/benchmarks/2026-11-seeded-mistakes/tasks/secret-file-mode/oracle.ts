// Behavior oracle for secret-file-mode. Every scenario: each credential file is readable by its owner only (umask 022).
// final and touch also: each saved value reads back.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const dir = join(import.meta.dir, "../src/store");
const stores = ["api-key", "session", "refresh-token"].filter((s) => existsSync(join(dir, s + ".ts")));
process.umask(0o022);

test("each credential file is readable by its owner only", async () => {
  for (const name of stores) {
    const out = mkdtempSync(join(tmpdir(), "oracle-"));
    await (await import(join(dir, name + ".ts"))).save(out, "secret-" + name);
    for (const file of readdirSync(out, { recursive: true }).map(String)) expect(statSync(join(out, file)).mode & 0o077, name + ": " + file).toBe(0);
  }
});

test.if(full)("each saved value reads back", async () => {
  for (const name of stores) {
    const out = mkdtempSync(join(tmpdir(), "oracle-"));
    await (await import(join(dir, name + ".ts"))).save(out, "secret-" + name);
    const files = readdirSync(out, { recursive: true }).map(String).filter((f) => statSync(join(out, f)).isFile());
    expect(files.some((f) => readFileSync(join(out, f), "utf8").includes("secret-" + name)), name).toBe(true);
  }
});
