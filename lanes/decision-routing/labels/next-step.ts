// Copyright (c) 2026 Garry Tan. MIT License.
// The next-step mapping, frozen in code (prereg section 6.2): N's next command against the options a next_step decision
// offered. N reran the exact last test command: run_tests. N printed candidates[k] (cat, head, tail, sed -n, nl or less on
// that path, optionally after cd /testbed and piped only into more printers): show_k. N submitted: submit. Anything
// else: other. The pin carries the sha256 of this file and shell.ts.
import { bare, parse, type Simple } from "./shell.ts";

const PRINTERS = new Set(["cat", "head", "tail", "nl", "less"]);
const VALUE_OPTIONS = new Set(["-n", "-c", "--lines", "--bytes", "-s", "-v", "-w"]);

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const repoPath = (p: string) => p.replace(/^\/testbed\//, "").replace(/^(\.\/)+/, "");

/** The file a printing command prints, or null when the command is not a plain printer of one file. */
function printedPath(cmd: Simple, first: boolean): string | null | undefined {
  if (cmd.redirects.some((r) => r.op.startsWith(">") && !r.target.startsWith("/dev/") && !/^\d$/.test(r.target))) return null;
  const words = bare(cmd.words);
  const name = words[0];
  if (!name) return null;
  const isSed = name === "sed";
  if (!PRINTERS.has(name) && !isSed) return null;
  const args = words.slice(1);
  if (isSed && (!args.includes("-n") || args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place")))) return null;
  const paths: string[] = [];
  let scriptTaken = !isSed;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("-") && a !== "-") { if (VALUE_OPTIONS.has(a) && !isSed) i++; continue; }
    if (!scriptTaken) { scriptTaken = true; continue; }
    paths.push(a);
  }
  if (!first) return paths.length === 0 ? undefined : null;
  return paths.length === 1 ? repoPath(paths[0]!) : null;
}

export function mapNextStep(action: string, ctx: { candidates: readonly string[]; last_test_command: string | null }): string {
  const pipelines = parse(action);
  const firstWords = pipelines[0]?.[0] ? bare(pipelines[0][0].words) : [];
  if ((firstWords[0] === "echo" || firstWords[0] === "printf") && firstWords.includes("COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT")) return "submit";
  if (ctx.last_test_command !== null && norm(action) === norm(ctx.last_test_command)) return "run_tests";
  const rest = pipelines.filter((p) => !(p.length === 1 && bare(p[0]!.words)[0] === "cd" && ["/testbed", "/testbed/", "."].includes(bare(p[0]!.words)[1] ?? "")));
  if (rest.length !== 1) return "other";
  const [head, ...tail] = rest[0]!;
  const path = printedPath(head!, true);
  if (!path || tail.some((c) => printedPath(c, false) !== undefined)) return "other";
  const k = ctx.candidates.findIndex((c) => repoPath(c) === path);
  return k < 0 ? "other" : "show_" + k;
}
