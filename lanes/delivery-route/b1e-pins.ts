// Copyright (c) 2026 Garry Tan. MIT License.
// B1e's frozen values (prereg bundle B1E_BUNDLE): B1d's gstack-main arm built again from gstack main at the commit that fixed
// its bug-report matcher, run on B1's 60 run tasks against Garry's bar, and on a fresh draw of 60 tasks no B1 lane has run,
// beside B1's no-gstack arm. The arm is built by B1d's script (B1_PINS=b1e-pins.ts lanes/delivery-route/b1d-build.sh). B1's,
// B1b's, B1c's and B1d's frozen values stay as merged.
import { B1D_ARMS, GSTACK_ARM as B1D_GSTACK, PROVE_IT } from "./b1d-pins.ts";

export { PROVE_IT };
export const B1E_BUNDLE = "wiki/plans/2026-11-20-capy-b1e-matcher-fix-prereg";

// gstack main at 5df6b5a8 (#4539), 29 commits after B1d's pin 5afef04. It does not contain 7f9c1bc5 (#4509), which injects a
// skill's start step at load time: 7f9c1bc5 landed 54 seconds later. The install is gstack's own setup at the pin, with the
// same loadout, hooks, switches and listing as B1d's arm; only these blobs are checked against the pin.
export const GSTACK_ARM = {
  ...B1D_GSTACK,
  sha: "5df6b5a8cf2127e349a9f900ee2553df8c8988b5",
  version: "1.102.0.0",
  blobs: {
    "lib/skill-route.ts": "55c3606b316897b637baa6b2d183205efa0f689d",
    "lib/skill-triggers.ts": "b7d29d9edb90764b4d2a9329fad904ab23cbd541",
    "hosts/claude/hooks/skill-route-hook": "7fdcd2d71243bc36a4c4503687c1be5a304861bd",
    "hosts/claude/hooks/skill-route-hook.ts": "a55f877c28778e66cf9d5d4883e75f6379be36c5",
    "hosts/claude/hooks/destructive-guard-hook": "186fb61e61f172acb88f488cb3cb790910ad59ed",
    "bin/gstack-skill-start": "c371df7b3bcda8c808989d6015db8bd5f9574aac",
    "bin/gstack-config": "d3a4a4d29d9878b44dee58c4ab1d9e5178974046",
    "bin/gstack-session-kind": "5071ad0fb36baa9160c9456515132e95f09ca10f",
    setup: "64f01d4057fb33441cade69b293df181d646a3b0",
  },
} as const;

// The arms: B1d's gstack-main spec on the new tar, and B1's no-gstack arm, at B1d's planning rates.
export const B1E_ARMS = ["gstack-main", "none"] as const;
export type B1eArm = (typeof B1E_ARMS)[number];
export const B1E_SPECS = Object.fromEntries(B1E_ARMS.map((a) => [a, B1D_ARMS[a].spec])) as Record<B1eArm, string>;

// Keyless coverage of the hook at the pin (route-table.tsv): where it puts prove-it on each prompt.
export const COVERAGE = { run: { only: 51, first: 0, second: 0, none: 9 }, fresh: { only: 52, first: 0, second: 0, none: 8 } } as const;

// The fresh draw (B1E_BUNDLE/draw.py, seed committed by digest before it ran). The list is committed as fresh-list.txt.
export const FRESH = {
  seedSha256: "96e384f5350a8ae437c5a5e4288b82869356a0c4c4d0ed7f5e0637083c7051ac",
  pool: { tasks: 80, repos: 58, sortedSha256: "b93df41d17140c8b193a7853a8bac440d02df215a15d9bf5e1d3cbe046f8e578" },
  tasks: 60,
  repos: 49,
  sortedSha256: "dd1fd7a73c1a6f7fa7411bc1393233fb24c9b3fee11551897ca09ec7d08acf51",
  drawSha256: "1aea6cf34e7324dc2b57bcd3409005e868306fe52ddb1402db4ae4a44a58d714",
} as const;

// The smoke, by B1d's rule on the new route table: in sorted order, the first calibration task the hook names prove-it alone
// on and the first it names nothing on. B1d's own second smoke task is named at this pin.
export const B1E_SMOKE = ["a2aproject__a2a-python-682_interface", "stanfordnlp__dspy-9478_interface"] as const;

// Items and caps (the crew's formula, b1e.ts b1eCap), the bar, and the machinery's names.
export const B1E = { bar: 39, partTasks: 20, hostRoot: "b1e", ledgerPort: "9951", armManifests: "arms/manifests/b1e" } as const;
export const B1E_CAPS_USD = { "b1e-smoke": 30, "b1e-in": 90, "b1e-fresh": 110 } as const;
export type B1eItem = keyof typeof B1E_CAPS_USD;
// The prereg's per-arm pilot caps (its Pilots table): the most each arm's pilot sessions may settle. Dated change, 2026-11-21,
// on the results branch before the pilot ran, by the Captain's ruling on the prereg's review: the b1e-smoke report prints FAIL
// for an arm whose sessions settle above its cap. The b1e-smoke ledger cap stays the hard money stop.
export const PILOT_CAPS_USD = { "gstack-main": 5, none: 3 } as const;
export const B1E_ITEMS = Object.keys(B1E_CAPS_USD) as B1eItem[];
export const isB1eItem = (x: string): x is B1eItem => Object.hasOwn(B1E_CAPS_USD, x);

// B1d's published in-sample gstack-main rows, the paired reference for what the matcher fix changed (non-concurrent).
export const B1D_RUN = { commit: "709dae5d50018c66cf3dba74ed19e0bc32295862", results: "wiki/board/2026-11-19-capy-b1d-hook-default-results" } as const;
