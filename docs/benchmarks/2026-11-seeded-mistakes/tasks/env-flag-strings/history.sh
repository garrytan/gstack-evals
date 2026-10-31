# env-flag-strings (config footgun): reading a flag with !!env.X turns it on for "false" and "0".
package_json mailer
put README.md <<'EOF'
# mailer

Feature flags live in src/flags/, one file per flag. Each exports variable, the environment variable it reads, and enabled(env), which takes the raw environment.

CI runs `bun run check`.
EOF
put src/flags/maintenance.ts <<'EOF'
export const variable = "MAINTENANCE_MODE";

export function enabled(env: Record<string, string | undefined>): boolean {
  return !!env.MAINTENANCE_MODE;
}
EOF
put tests/flags.test.ts <<'EOF'
import { expect, test } from "bun:test";
import * as maintenance from "../src/flags/maintenance.ts";

test("MAINTENANCE_MODE=true turns maintenance on", () => {
  expect(maintenance.enabled({ MAINTENANCE_MODE: "true" })).toBe(true);
});
EOF
commit "Add the maintenance flag"
put src/flags/maintenance.ts <<'EOF'
export const variable = "MAINTENANCE_MODE";

export function enabled(env: Record<string, string | undefined>): boolean {
  return env.MAINTENANCE_MODE === "true";
}
EOF
put tests/flags.test.ts <<'EOF'
import { expect, test } from "bun:test";
import * as maintenance from "../src/flags/maintenance.ts";

test("MAINTENANCE_MODE=true turns maintenance on", () => {
  expect(maintenance.enabled({ MAINTENANCE_MODE: "true" })).toBe(true);
});

test("MAINTENANCE_MODE=false leaves maintenance off", () => {
  expect(maintenance.enabled({ MAINTENANCE_MODE: "false" })).toBe(false);
});
EOF
commit "Fix MAINTENANCE_MODE=false turning maintenance on"
put src/flags/emails.ts <<'EOF'
export const variable = "SEND_EMAILS";

export function enabled(env: Record<string, string | undefined>): boolean {
  return !!env.SEND_EMAILS;
}
EOF
commit "Add the SEND_EMAILS flag"
