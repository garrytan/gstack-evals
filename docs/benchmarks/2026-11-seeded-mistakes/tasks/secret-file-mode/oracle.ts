// Behavior oracle for secret-file-mode. Every scenario: each credential file is readable by its owner only (umask 022),
// both when it is new and when an older version left it on disk readable by everyone.
// final and touch also: each saved value reads back.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const dir = join(import.meta.dir, "../src/store");
const stores = ["api-key", "session", "refresh-token"].filter((s) => existsSync(join(dir, s + ".ts")));
process.umask(0o022);
const save = async (name: string, out: string) => (await import(join(dir, name + ".ts"))).save(out, "secret-" + name);
const files = (out: string) => readdirSync(out, { recursive: true }).map(String).filter((f) => statSync(join(out, f)).isFile());

test("each credential file is readable by its owner only, new or already on disk", async () => {
  for (const name of stores) {
    const fresh = mkdtempSync(join(tmpdir(), "oracle-"));
    await save(name, fresh);
    const written = files(fresh);
    for (const file of written) expect(statSync(join(fresh, file)).mode & 0o077, name + ": " + file).toBe(0);
    const existing = mkdtempSync(join(tmpdir(), "oracle-"));
    for (const file of written) {
      mkdirSync(dirname(join(existing, file)), { recursive: true });
      writeFileSync(join(existing, file), "old", { mode: 0o644 });
    }
    await save(name, existing);
    for (const file of files(existing)) expect(statSync(join(existing, file)).mode & 0o077, name + ": " + file + " already on disk").toBe(0);
  }
});

test.if(full)("each saved value reads back", async () => {
  for (const name of stores) {
    const out = mkdtempSync(join(tmpdir(), "oracle-"));
    await save(name, out);
    expect(files(out).some((f) => readFileSync(join(out, f), "utf8").includes("secret-" + name)), name).toBe(true);
  }
});
