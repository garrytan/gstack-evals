// Copyright (c) 2026 Garry Tan. MIT License.
// The frame area's two command rows for cli.ts: `dc frame --out <dir>` and `dc filecheck --repo <dir>`.
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fail } from "../errors.ts";
import { checkLines, realSeams, runFrame } from "./run.ts";

type Args = { flags: Map<string, string>; bools: Set<string>; rest: string[] };
type Io = { out: (text: string) => void; err: (text: string) => void };

export const frameCommand = (a: Args, io: Io): number => {
  const out = a.flags.get("--out");
  if (!out || a.rest.length) return fail("E_USAGE", "usage: gstack-evals dc frame --out <sealed dir outside the repo>");
  for (const line of runFrame(resolve(out), realSeams()).lines) io.out(line);
  return 0;
};

export const filecheckCommand = (a: Args, io: Io): number => {
  const repo = a.flags.get("--repo");
  if (!repo || a.rest.length) return fail("E_USAGE", "usage: gstack-evals dc filecheck --repo <dir>");
  if (!existsSync(repo) || !statSync(repo).isDirectory()) return fail("E_USAGE", "--repo is not a folder");
  for (const line of checkLines(resolve(repo))) io.out(line);
  return 0;
};
