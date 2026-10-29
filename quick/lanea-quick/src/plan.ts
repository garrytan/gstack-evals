import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { ArmName } from "./config.ts";
import type { Task } from "./grade.ts";

const sha256 = (b: string) => createHash("sha256").update(b).digest("hex");

function rng(seed: string) {
  let h = parseInt(sha256(seed).slice(0, 8), 16);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: T[], seed: string): T[] {
  const r = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface Cell {
  suite: string;
  task: Task;
  arm: ArmName;
  model: string;
  trial: number;
}

export const STAGES: Record<string, { suite: string; arms: ArmName[]; models: string[] }> = {
  S0: { suite: "learn", arms: ["before", "after", "none", "before2"], models: ["claude-haiku-5-5"] },
  S1: { suite: "office-hours", arms: ["before", "after", "none"], models: ["claude-haiku-5-5", "claude-opus-5-5"] },
  S2: { suite: "office-hours", arms: ["before2"], models: ["claude-haiku-5-5", "claude-opus-5-5"] },
  S3: { suite: "learn", arms: ["before", "after", "none", "before2"], models: ["claude-opus-5-5"] },
};

export function planStage(stage: string, tasks: Task[], trials: number[], models = STAGES[stage]!.models): Cell[] {
  const st = STAGES[stage]!;
  const cells: Cell[] = [];
  for (const trial of trials)
    for (const model of models)
      for (const task of tasks) for (const arm of shuffled(st.arms, `${stage}/${model}/${task.id}/${trial}`)) cells.push({ suite: st.suite, task, arm, model, trial });
  return cells;
}


// An infra-error cell is rerun once (the preregistration). Each failed attempt is kept beside the cell as t<n>.failed-<k>.
export function failedAttempts(dir: string): number {
  const parent = dirname(dir);
  if (!existsSync(parent)) return 0;
  return readdirSync(parent).filter((n) => n.startsWith(`${basename(dir)}.failed-`)).length;
}
