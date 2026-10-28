import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// sealed.yml is the CI backstop for gstack-pregate sealed (U19a). These checks keep it base-owned, pinned, read-only,
// free of pull request code, and unable to pass without a clear verdict under the default branch's policy.
const text = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "sealed.yml"), "utf8");
const body = text
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const SHA = /^[0-9a-f]{40}$/;
const SCAN = 'bun --no-env-file --config=/dev/null "$RUNNER_TEMP/gstack/bin/gstack-pregate" sealed --range "$BASE_SHA..$HEAD_SHA" --base "$POLICY_BRANCH" | tee "$RUNNER_TEMP/sealed.txt"';

describe("sealed.yml", () => {
  test("runs the base branch's copy on every pull request event that changes its commits or base", () => {
    expect(body).toMatch(/^on:\n  pull_request_target:\n    types: \[opened, synchronize, reopened, edited\]\n\n/m);
    expect(body).not.toMatch(/^\s+(branches|branches-ignore|paths|paths-ignore):/m);
    expect(body).not.toMatch(/^\s+pull_request:/m);
  });

  test("pins every action and the gstack fetch to a full commit sha", () => {
    const uses = [...body.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref.split("@")[1] ?? "").toMatch(SHA);
    const pin = body.match(/GSTACK_SHA:\s*([0-9a-f]+)\s*# gstack v\d+\.\d+\.\d+\.\d+/);
    expect(pin?.[1] ?? "").toMatch(SHA);
    expect(body).toContain('test "$(git -C "$RUNNER_TEMP/gstack" rev-parse HEAD)" = "$GSTACK_SHA"');
  });

  test("reads the pull request as data: head sha, full history, no persisted token, read-only, no secrets", () => {
    expect(body).toContain("ref: ${{ github.event.pull_request.head.sha }}");
    expect(body).toContain("fetch-depth: 0");
    expect(body).toContain("persist-credentials: false");
    expect(body).toMatch(/^permissions:\n  contents: read\n/m);
    expect(body.match(/permissions:/g)?.length).toBe(1);
    expect(body).not.toMatch(/secrets\./);
  });

  test("diffs every added line as text before the scan, whatever the pull request's .gitattributes say", () => {
    const attributes = body.indexOf("printf '* diff\\n' > \"$attributes\"");
    expect(attributes).toBeGreaterThan(-1);
    expect(body).toContain('attributes="$(git rev-parse --git-path info/attributes)"');
    expect(attributes).toBeLessThan(body.indexOf(SCAN));
  });

  test("passes only on a clear verdict under the default branch's policy, and runs none of the pull request's code", () => {
    expect(body).toContain(SCAN);
    expect(body).toContain("POLICY_BRANCH: ${{ github.event.repository.default_branch }}");
    expect(body).toContain('grep -Eq "^SEALED[:] clear .*policy=origin/$POLICY_BRANCH( |\\$)" "$RUNNER_TEMP/sealed.txt" || {');
    expect(body).toMatch(/shell: bash\n\s+env:\n\s+BASE_SHA:/);
    expect(body).not.toMatch(/\b(bun|npm|npx|bunx|pnpm|yarn)\s+(install|run|test|ci|exec)\b/);
    expect(body).not.toMatch(/\bbun\s+(?!--no-env-file --config=\/dev\/null "\$RUNNER_TEMP\/gstack\/)/);
  });
});
