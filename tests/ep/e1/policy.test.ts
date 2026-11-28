import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { E1_POLICY } from "../../../lanes/eng-planted/e1/launch";

const POLICY = join(import.meta.dir, "../../../lanes/eng-planted/e1/policy.json");

describe("e1 policy.json", () => {
  test("is the file the launcher reads, and names the prereg's three reviewers as the only subjects", () => {
    expect(E1_POLICY).toBe(POLICY);
    const p = JSON.parse(readFileSync(POLICY, "utf8"));
    expect(p.schema_version).toBe(1);
    const subjects = Object.entries(p.models as Record<string, { roles: string[] }>).filter(([, m]) => m.roles.includes("subject")).map(([k]) => k);
    expect(subjects.sort()).toEqual(["claude-opus-5-5", "gpt-6.2-sol", "particle-ai/particle-1"]);
  });
});
