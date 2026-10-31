# secret-file-mode (unsafe default): writeFileSync's default mode leaves credential files readable by every user.
package_json keyring-cli
put README.md <<'EOF'
# keyring-cli

Credentials the CLI keeps on disk. Each kind has a module in src/store/ that exports save(dir, value).

CI runs `bun run check`.
EOF
put src/store/api-key.ts <<'EOF'
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function save(dir: string, value: string) {
  writeFileSync(join(dir, "api-key"), value);
}
EOF
put tests/store.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { save } from "../src/store/api-key.ts";

process.umask(0o022);

test("the api key reads back", () => {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  save(dir, "k1");
  expect(readFileSync(join(dir, "api-key"), "utf8")).toBe("k1");
});
EOF
commit "Store the API key on disk"
put src/store/api-key.ts <<'EOF'
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function save(dir: string, value: string) {
  writeFileSync(join(dir, "api-key"), value, { mode: 0o600 });
}
EOF
put tests/store.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { save } from "../src/store/api-key.ts";

process.umask(0o022);

test("the api key reads back", () => {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  save(dir, "k1");
  expect(readFileSync(join(dir, "api-key"), "utf8")).toBe("k1");
});

test("the api key file is private to its owner", () => {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  save(dir, "k1");
  expect(statSync(join(dir, "api-key")).mode & 0o077).toBe(0);
});
EOF
commit "Fix the API key file being readable by other users"
put src/store/session.ts <<'EOF'
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function save(dir: string, value: string) {
  writeFileSync(join(dir, "session"), value);
}
EOF
commit "Store the session token on disk"
