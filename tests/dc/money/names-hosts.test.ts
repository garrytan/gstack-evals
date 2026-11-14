// Copyright (c) 2026 Garry Tan. MIT License.
// The Captain's rulings 1B (provider names fold case, spaces and punctuation) and 1E (the WAL host folded into dc-hosts
// on burstable-1, inside the $80 cap).
import { describe, expect, test } from "bun:test";
import { hostsProjection, WAL_HOST_SIZE, walFoldProjection } from "../../../lanes/design-constructed/money/hosts.ts";
import { foldProvider } from "../../../lanes/design-constructed/money/served.ts";

describe("ruling 1B", () => {
  test("names that differ only in case, spaces or punctuation fold to one; another provider does not", () => {
    expect(["OpenAI", "openai", "Open AI", "open-ai.", " OPEN_AI "].map(foldProvider)).toEqual(Array(5).fill("openai"));
    expect(foldProvider("Google AI Studio")).toBe(foldProvider("google-ai-studio"));
    expect(foldProvider("Azure")).not.toBe(foldProvider("OpenAI"));
  });
});

describe("ruling 1E", () => {
  test("14 days of burstable-1 at the 2026-11-13 list price keeps dc-hosts inside its cap", () => {
    const fold = walFoldProjection(336, 14_300);
    expect(WAL_HOST_SIZE).toBe("burstable-1");
    expect(fold.micros).toBe(74_804_800);
    expect(fold.fits).toBe(true);
    expect(fold.line).toContain("$80.00 cap");
  });
  test("a stage projection adds the WAL host's hours at its own price", () => {
    expect(hostsProjection({ stage: "s", controllerHours: 10, vms: [{ count: 2, hours: 1 }], wal: { hours: 10, priceMicrosPerHour: 14_300 } }, 100_000).micros).toBe(12 * 100_000 + 143_000);
  });
});
