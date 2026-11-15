// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep subcommands from the stages part (authoring, the review arms, the builds, the ledger and the driven launch). The lane's cli.ts merges every part's table.
import type { Command, DryCase } from "../types.ts";

export const COMMANDS: Record<string, Command> = {};

/** This part's keyless dry-run cases; lanes/eng-planted/dryrun.ts runs every part's. */
export const DRY_CASES: DryCase[] = [];
