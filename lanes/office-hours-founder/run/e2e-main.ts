#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// Runs the run area's keyless end to end (e2e.ts) with the stub-backed simulator. Usage: bun lanes/office-hours-founder/run/e2e-main.ts [--keep]
import { e2eCommand } from "./cli.ts";

process.exit(await e2eCommand(process.argv.slice(2), { out: (t) => console.log(t), err: (t) => console.error(t) }, process.env));
