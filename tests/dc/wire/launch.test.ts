// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless launch end to end (lanes/design-constructed/wire/dryrun-launch.ts): dc host launch, rows in sequence
// through dc host next on one controller host and one ledger, and teardown, on the simulated Ubicloud with every SSH
// command run on this machine. No key, no network, no VM.
import { describe, expect, test } from "bun:test";
import { launchScenario } from "../../../lanes/design-constructed/wire/dryrun-launch.ts";

describe("the keyless launch", () => {
  // Value: protects=the launch path the dry run never drove, PD-41 and PD-42; fails_when=a row can't follow another on the same host and ledger, a row's inputs or sinks land on disk outside tmpfs, the archive returns plaintext, or a stage switches region; why_new=the dry run passed while nothing drove a launch; seam=dc host launch, next, status and teardown; no_claim=live Ubicloud, real models, the vm section's VMs
  test("launch, eight rows in sequence, the preflight second, through next, teardown: every returned file is sealed or free of unit text, and nothing plaintext lands outside tmpfs", async () => {
    expect(await launchScenario()).toEqual([]);
  }, 300_000);
});
