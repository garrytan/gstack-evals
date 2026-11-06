// Copyright (c) 2026 Garry Tan. MIT License.
// The report driver (prereg sections 3 and 6, amendment items 12, 13 and 17): one item run on a lease through the
// in-process metering proxy, three turns per reading in the frozen caching order, the driver as the only retry owner.
import { notBuilt } from "./errors.ts";
import type { Arm, BuildInput, BuiltRequest, Family, History, Io, ItemRun, ItemRunOptions, Model, ReadingRecord, Shape, SpliceSet, Turns, Validation } from "./types.ts";

export interface DriveItemRun extends ItemRun {
  close(capStop?: string): Promise<{ settled: number; unknown: number }>;
}
export interface DrivePlan {
  item: string;
  tasks: History[];
  arms: Arm[];
  models: Model[];
  passes: Partial<Record<Model, number>>;
  turns: Turns;
  shape: (arm: Arm, model: Model) => Shape;
  splice: (family: Family, arm: Arm) => SpliceSet | null;
  roundWorstMicros?: number;
}
export interface DriveDeps {
  build: (input: BuildInput) => BuiltRequest;
  validate: (body: Record<string, unknown>, model: Model) => Validation;
  closer: (body: Record<string, unknown>, splice: SpliceSet) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  seal: (name: string, text: string) => void;
  log: (text: string) => void;
  done: ReadingRecord[];
}
export interface DriveResult {
  records: ReadingRecord[];
  stop: { cls: "cap" | "harness" | "outage"; why: string } | null;
  dropped: string[];
}
export interface RunItemOptions extends ItemRunOptions {
  plan: DrivePlan;
  plaintext: string;
  sealCmd: string | null;
  unsealCmd: string | null;
  devPlaintext: boolean;
  held: boolean;
  mounts?: string;
  deps?: Partial<DriveDeps>;
  log: (text: string) => void;
}

export function openItemRun(o: ItemRunOptions): Promise<DriveItemRun> {
  return notBuilt("openItemRun");
}
export function readingOrder(plan: DrivePlan): Array<{ task: string; arm: Arm; model: Model; pass: number }> {
  return notBuilt("readingOrder");
}
export function driveItem(run: DriveItemRun, plan: DrivePlan, deps?: Partial<DriveDeps>): Promise<DriveResult> {
  return notBuilt("driveItem");
}
export function smokeItem(run: DriveItemRun, plan: DrivePlan, deps?: Partial<DriveDeps>): Promise<string[]> {
  return notBuilt("smokeItem");
}
export function runItem(o: RunItemOptions): Promise<DriveResult> {
  return notBuilt("runItem");
}
export function run(argv: string[], io: Io): Promise<number> {
  return notBuilt("drive");
}
