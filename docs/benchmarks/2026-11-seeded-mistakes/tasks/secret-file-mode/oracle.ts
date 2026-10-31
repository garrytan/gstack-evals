// Behavior oracle for secret-file-mode. Every scenario: each credential file is readable by its owner only (umask 022),
// both when it is new and when an older version left it on disk readable by everyone.
// Counted in the must-pass scenarios only: each saved value reads back.
// Each test removes the folders it saved into, in a finally block, so no credential file outlives a grade.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const dir = join(import.meta.dir, "../src/store");
const stores = ["api-key", "session", "refresh-token"].filter((s) => existsSync(join(dir, s + ".ts")));
process.umask(0o022);
const save = async (name: string, out: string) => (await import(join(dir, name + ".ts"))).save(out, "secret-" + name);
const files = (out: string) => readdirSync(out, { recursive: true }).map(String).filter((f) => statSync(join(out, f)).isFile());
const made: string[] = [];
const temp = () => {
  const out = mkdtempSync(join(tmpdir(), "oracle-"));
  made.push(out);
  return out;
};
const cleaned = (fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } finally {
    for (const out of made.splice(0)) rmSync(out, { recursive: true, force: true });
  }
};

test(
  "each credential file is readable by its owner only, new or already on disk",
  cleaned(async () => {
    for (const name of stores) {
      const fresh = temp();
      await save(name, fresh);
      const written = files(fresh);
      for (const file of written) expect(statSync(join(fresh, file)).mode & 0o077, name + ": " + file).toBe(0);
      const existing = temp();
      for (const file of written) {
        mkdirSync(dirname(join(existing, file)), { recursive: true });
        writeFileSync(join(existing, file), "old", { mode: 0o644 });
      }
      await save(name, existing);
      for (const file of files(existing)) expect(statSync(join(existing, file)).mode & 0o077, name + ": " + file + " already on disk").toBe(0);
    }
  }),
);

describe("with no mistake in place", () => {
  test(
    "each saved value reads back",
    cleaned(async () => {
      for (const name of stores) {
        const out = temp();
        await save(name, out);
        expect(files(out).some((f) => readFileSync(join(out, f), "utf8").includes("secret-" + name)), name).toBe(true);
      }
    }),
  );
});
