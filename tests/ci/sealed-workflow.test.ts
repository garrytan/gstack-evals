import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// sealed.yml is the CI backstop for gstack-pregate sealed (U19a). These checks keep it pinned, read-only and free of repo code.
const text = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "sealed.yml"), "utf8");
const lines = text.split("\n").filter((line) => !line.trimStart().startsWith("#"));
const body = lines.join("\n");
const SHA = /^[0-9a-f]{40}$/;

describe("sealed.yml", () => {
  test("runs on every pull request, with no branch or path filter", () => {
    expect(body).toMatch(/^on:\n  pull_request:\n\n/m);
    expect(body).not.toMatch(/^\s+(branches|branches-ignore|paths|paths-ignore|types):/m);
  });

  test("pins every action and the gstack fetch to a full commit sha", () => {
    const uses = [...body.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref.split("@")[1] ?? "").toMatch(SHA);
    const pin = body.match(/GSTACK_SHA:\s*([0-9a-f]+)\s*# gstack v\d+\.\d+\.\d+\.\d+/);
    expect(pin?.[1] ?? "").toMatch(SHA);
    expect(body).toContain('test "$(git -C "$RUNNER_TEMP/gstack" rev-parse HEAD)" = "$GSTACK_SHA"');
  });

  test("reads only: contents read, no persisted token, no secrets", () => {
    expect(body).toMatch(/^permissions:\n  contents: read\n/m);
    expect(body.match(/permissions:/g)?.length).toBe(1);
    expect(body).toContain("persist-credentials: false");
    expect(body).not.toMatch(/secrets\./);
  });

  test("runs gstack's checker over the pull request's range and none of this repo's code", () => {
    expect(body).toContain('bun --no-env-file --config=/dev/null "$RUNNER_TEMP/gstack/bin/gstack-pregate" sealed --range "$BASE_SHA..$HEAD_SHA" --base "$BASE_REF"');
    expect(body).not.toMatch(/\b(bun|npm|npx|bunx|pnpm|yarn)\s+(install|run|test|ci|exec)\b/);
    expect(body).not.toMatch(/\bbun\s+(?!--no-env-file --config=\/dev\/null "\$RUNNER_TEMP\/gstack\/)/);
  });
});
