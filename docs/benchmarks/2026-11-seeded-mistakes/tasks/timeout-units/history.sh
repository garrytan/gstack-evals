# timeout-units (config footgun): a timeout written in seconds in a field read as milliseconds fails every call.
package_json gateway
put README.md <<'EOF'
# gateway

Calls the internal services listed in config/services.json. call(name, request) in src/client.ts gives each request the service's timeoutMs.

CI runs `bun run check`.
EOF
put config/services.json <<'EOF'
{
  "payments": { "url": "http://payments.internal", "timeoutMs": 5000 },
  "search": { "url": "http://search.internal", "timeoutMs": 3 }
}
EOF
put src/client.ts <<'EOF'
import services from "../config/services.json";

type Service = { url: string; timeoutMs: number };

const config: Record<string, Service> = services;

export function timeoutFor(name: string): number {
  const service = config[name];
  if (!service) throw new Error("unknown service " + name);
  return service.timeoutMs;
}

export async function call<T>(name: string, request: () => Promise<T>): Promise<T> {
  const ms = timeoutFor(name);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(name + " timed out after " + ms + " ms")), ms);
  });
  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
EOF
put tests/client.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { call, timeoutFor } from "../src/client.ts";

test("a payments call returns its result", async () => {
  expect(await call("payments", async () => "ok")).toBe("ok");
});

test("an unknown service is refused", () => {
  expect(() => timeoutFor("nope")).toThrow("unknown service");
});
EOF
commit "Add the service client"
put config/services.json <<'EOF'
{
  "payments": { "url": "http://payments.internal", "timeoutMs": 5000 },
  "search": { "url": "http://search.internal", "timeoutMs": 3000 }
}
EOF
put tests/client.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { call, timeoutFor } from "../src/client.ts";

test("a payments call returns its result", async () => {
  expect(await call("payments", async () => "ok")).toBe("ok");
});

test("an unknown service is refused", () => {
  expect(() => timeoutFor("nope")).toThrow("unknown service");
});

test("search waits three seconds", () => {
  expect(timeoutFor("search")).toBe(3000);
});
EOF
commit "Fix search timing out at once: timeoutMs is in milliseconds"
put config/services.json <<'EOF'
{
  "payments": { "url": "http://payments.internal", "timeoutMs": 5000 },
  "search": { "url": "http://search.internal", "timeoutMs": 3000 },
  "email": { "url": "http://email.internal", "timeoutMs": 10 }
}
EOF
commit "Add the email service with a 10 second timeout"
