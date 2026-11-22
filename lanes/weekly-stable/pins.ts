// Copyright (c) 2026 Garry Tan. MIT License.
// The weekly stable number's frozen values (lanes/weekly-stable/README.md): the preregistration and its two pre-run changes,
// the task lists, the arms, the size Garry picked (S390), the items and caps, the stop bounds and the record's fixed fields.
import { join } from "node:path";
import { ARMS } from "../delivery-route/pins.ts";

export const REPO = join(import.meta.dir, "../..");
export const PREREG = "wiki/plans/2026-11-22-geva-573-weekly-stable-prereg";
export const CHANGE1 = "wiki/plans/2026-11-22-geva-573-weekly-stable-pre-run-change-1";
export const CHANGE2 = "wiki/plans/2026-11-22-geva-573-weekly-stable-pre-run-change-2";

// tasks.txt: 80 "run" lines in run order, then the three "pilot" lines. s390-tasks.txt: all 130 in run order, its first 80
// the run lines. Both are checked against these digests and their bundles' front matter.
export const TASKS = { file: PREREG + "/tasks.txt", sha256: "ea4f2f65f90a1f06f18c3c4c6d5a98d0313c7f9f733ac1ac1c7ea70e88ec4e86", run: 80, pilot: 3 } as const;
export const S390_TASKS = { file: CHANGE1 + "/s390-tasks.txt", sha256: "09e92ddec3ac05c92414cc66b8bf88271e9f820ab55db811b17ceeeeb4abd79e", tasks: 130 } as const;
export const TASK_SET = { name: "swerebench-r3a4", record: "v1", area: "python-bugfix" } as const;

// gstack's arms are fetched from GitHub by sha; the resolver reads gstack's release gate from a full clone of the same repo.
export const GSTACK = { repo: "https://github.com/garrytan/gstack.git", slug: "garrytan/gstack", setup: "./setup --host claude --no-browser --loadout full", loadout: "full" } as const;
const TAIL = ARMS.none.spec.slice("none".length);
export const WEEKLY_ARMS = {
  candidate: { spec: "candidate:tar=candidate" + TAIL, rateUsd: 0.48, sessions: 3 },
  stable: { spec: "stable:tar=stable" + TAIL, rateUsd: 0.48, sessions: 3 },
  none: { spec: ARMS.none.spec, rateUsd: 0.31, sessions: 1 },
} as const;
export type WeeklyArm = keyof typeof WEEKLY_ARMS;
export const WEEKLY_ARM_NAMES = Object.keys(WEEKLY_ARMS) as WeeklyArm[];
export const GSTACK_ARMS = ["candidate", "stable"] as const;
export type GstackArm = (typeof GSTACK_ARMS)[number];
export const isWeeklyArm = (x: string): x is WeeklyArm => Object.hasOwn(WEEKLY_ARMS, x);
export const NONE_TAR_SHA256 = "8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e";

export const MODEL = { id: "claude-opus-5-5", host: "claude-code", cells: "cells.l1.json", allowanceUsd: 3 } as const;
export const SOL_LINE = "gpt-6.2-sol not run: it joins only by a later dated change, after B2's Codex rig passes its own pilot and the weekly total with Sol goes to Garry";

// S390 (pre-run change 1, section 5; Garry's pick, 2026-11-22). The parts hold whole tasks in run order: 44, 43 and 43.
export const S390 = {
  tasks: 130,
  parts: 3,
  partsAtOnce: 3,
  concurrent: 6,
  look: { tasks: 65, z: 2.797 },
  zEnd: 1.977,
  zPower: 0.8416,
  mddPoints: 5.5,
  maxDropped: 13,
  maxUngraded: { candidate: 39, stable: 39, none: 13 },
  safetyFlag: 3,
  costFlag: 1.1,
  bootstrap: 10_000,
  realizedMddWatch: 6,
} as const;

// Items. ws-<YYYY-MM-DD> is one week (the UTC date of its start); weekly-pilot is the one-time pilot. The week's ledger item
// holds the paid lines, model and Ubicloud ($535 + $75); its all-in stop adds the weekly thread's own meter ($35), $645 in all.
export const WEEK_CAPS = { model: 535, ubicloud: 75, meter: 35 } as const;
export const WEEK_ITEM_CAP = WEEK_CAPS.model + WEEK_CAPS.ubicloud;
export const WEEK_STOP = WEEK_ITEM_CAP + WEEK_CAPS.meter;
export const PILOT = { item: "weekly-pilot", capUsd: 14, concurrent: 2, settleCaps: { candidate: 5, stable: 5, none: 3.5 } } as const;
export const WEEK_ITEM = /^ws-(\d{4}-\d{2}-\d{2})(-r[1-9]\d*)?$/;
export const isItem = (x: string) => x === PILOT.item || WEEK_ITEM.test(x);

export const WEEKLY = {
  hostRoot: "weekly",
  ledgerPort: "9953",
  armManifests: "arms/manifests/weekly",
  armsDirEnv: "WEEKLY_ARMS_DIR",
  vmTtlHours: 36,
  window: { startUtc: "Sat 06:00", dueUtc: "Mon 10:00", cron: "0 6 * * 6" },
  staleDays: 9,
} as const;

export const RECORD = {
  schema: 1,
  repo: "garrytan/gstack-evals",
  asset: "weekly.json",
  interval: 0.95,
  prereg: "https://github.com/garrytan/gstack-evals/tree/main/" + PREREG,
} as const;
