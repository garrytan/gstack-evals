// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep subcommands from the readings part (scores, the pilot and exposure gates, the judge, the statistics, the verdicts and power). The lane's cli.ts merges every part's table.
import type { Command, DryCase } from "../types.ts";

export const COMMANDS: Record<string, Command> = {};

/** This part's keyless dry-run cases; lanes/eng-planted/dryrun.ts runs every part's. */
export const DRY_CASES: DryCase[] = [];
