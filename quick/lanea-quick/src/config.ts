import { homedir } from "node:os";
import { join } from "node:path";

export const WORK = process.env.LANEA_WORK ?? join(homedir(), ".capy/work/lanea-quick");
export const GSTACK_REPO = process.env.LANEA_GSTACK ?? join(homedir(), ".capy/work/gstack");
export const LEDGER_PATH = process.env.LANEA_LEDGER ?? join(homedir(), ".capy/drive/captain-gstack-evals/ledger/lanea-quick.jsonl");
export const CAP_USD = 130;
export const LINE_ITEM = "lanea-quick";

export const CLAUDE_CODE_VERSION = "2.1.312";
export const BUN_VERSION = "1.4.4";
export const BASE_IMAGE = `lanea-quick/base:cc${CLAUDE_CODE_VERSION}-bun${BUN_VERSION}`;

export type ArmName = "before" | "after" | "none" | "before2";

export interface Suite {
  skill: string;
  before: string;
  after: string;
  tasksSha: string;
  tasksDir: string;
  note: string;
}

export const SUITES: Record<string, Suite> = {
  "office-hours": {
    skill: "office-hours",
    before: "cd4fc4be73d86a5b14be9a91026d3e4b16cd8520",
    after: "a14c28aca7839cd0182fa130bff9874714672c24",
    tasksSha: "09fc5124d9b5c3e2e23144e520c230d7f1478aad",
    tasksDir: "test/fixtures/skill-evals/office-hours",
    note: "v1.91.289.0 diet (gstack#3525); tasks from gstack#3550 (GSTA-142, U12) at 09fc5124",
  },
  learn: {
    skill: "learn",
    before: "398618259d56df55e66793f168d0bd8c25cb9085",
    after: "7204a39a27ba90755db2e71e5bb869262a937402",
    tasksSha: "7204a39a27ba90755db2e71e5bb869262a937402",
    tasksDir: "test/fixtures/skill-evals/learn",
    note: "v1.91.287.0 /learn diet (gstack#3524); committed contract tasks",
  },
};

export function imageTag(suiteName: string, arm: ArmName): string {
  const a = arm === "before2" ? "before" : arm;
  return `lanea-quick/${suiteName}-${a}:latest`;
}

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface ModelSpec {
  id: string;
  price: Price;
  longPrice?: { threshold: number; price: Price };
  sessionCeilingUsd: number;
  reserveUsd: number;
}

export const WEB_SEARCH_USD = 0.01;

export const MODELS: Record<string, ModelSpec> = {
  "claude-opus-5-5": {
    id: "claude-opus-5-5",
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
    sessionCeilingUsd: 3.5,
    reserveUsd: 7.25,
  },
  "claude-haiku-5-5": {
    id: "claude-haiku-5-5",
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
    longPrice: { threshold: 100_000, price: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1 } },
    sessionCeilingUsd: 0.5,
    reserveUsd: 1.05,
  },
};

export const LIMITS = {
  sessionWallSeconds: 1200,
  maxAgentTurns: 80,
  parallel: 6,
};
