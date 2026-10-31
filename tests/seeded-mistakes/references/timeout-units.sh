# Reference solutions for timeout-units, for the keyless oracle tests: sh <this> fix|guard|alt in a seeded repo.
# fix: the reported value only. guard: a test over every configured timeout. alt: the client refuses such a config when it loads.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
    put config/services.json <<'EOF'
{
  "payments": { "url": "http://payments.example.com", "timeoutMs": 5000 },
  "search": { "url": "http://search.example.com", "timeoutMs": 3000 },
  "email": { "url": "http://email.example.com", "timeoutMs": 10000 }
}
EOF
    ;;
  guard)
    put tests/services.test.ts <<'EOF'
import { expect, test } from "bun:test";
import services from "../config/services.json";

test("every timeoutMs is in milliseconds (100 or more)", () => {
  for (const [name, s] of Object.entries(services)) expect(s.timeoutMs, name).toBeGreaterThanOrEqual(100);
});
EOF
    ;;
  alt)
    put src/client.ts <<'EOF'
import services from "../config/services.json";

type Service = { url: string; timeoutMs: number };

const config: Record<string, Service> = services;

for (const [name, s] of Object.entries(config)) {
  if (!(s.timeoutMs >= 100)) throw new Error("config/services.json: " + name + ".timeoutMs is " + s.timeoutMs + "; it is in milliseconds, so write seconds times 1000");
}

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
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac
