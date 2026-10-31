# Reference solutions for secret-file-mode, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported store only. guard: a test that saves through every store module and checks the file mode.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
put src/store/session.ts <<'EOF'
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function save(dir: string, value: string) {
  const file = join(dir, "session");
  writeFileSync(file, value, { mode: 0o600 });
  chmodSync(file, 0o600);
}
EOF
    ;;
  guard)
put tests/private-files.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(import.meta.dir, "../src/store");
process.umask(0o022);

test("every store writes files only their owner can read", async () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const out = mkdtempSync(join(tmpdir(), "store-"));
    try {
      (await import(join(dir, file))).save(out, "secret");
      for (const written of readdirSync(out)) expect(statSync(join(out, written)).mode & 0o077, file).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac
