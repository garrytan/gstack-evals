// Copyright (c) 2026 Garry Tan. MIT License.
// The frozen test-runner rule (prereg section 5, line 114), ported line for line from dr_agent/rules_parser.py
// is_runner_exit: one simple command, or cd <dir> && followed by one, whose program or module is in the frozen runner
// list, with no pipe, ;, ||, &, && or second command after it. Redirection to a file is allowed. Command substitution,
// subshells, groups, here-docs and unbalanced quotes are not modelled, so a command using them is never runner-exit.
// tests/decision-routing/labels-rules.test.ts checks this port against the Python rule.

export const NOT_BARE_RUNNER = "DR_LABEL_MISSING: with its pipe stripped the test command is not a bare runner (optionally after cd <dir> &&), so its exit code is not the tests' result";

const RUNNERS = new Set(["pytest", "py.test", "tox", "nox"]);
const RUNNER_MODULES = new Set(["pytest", "unittest"]);
const PYTHON = /^python(\d+(\.\d+)?)?$/;
const OPS = ["||", "&&", "|&", "|", ";", "&", "\n"];

type Tok = [kind: "word" | "op" | "redir", text: string];

function tokenize(cmd: string): { toks: Tok[]; bad: boolean } {
  const toks: Tok[] = [];
  let word: string | null = null;
  let i = 0;
  const n = cmd.length;
  const flush = () => { if (word !== null) { toks.push(["word", word]); word = null; } };
  while (i < n) {
    const c = cmd[i]!;
    if (c === " " || c === "\t") { flush(); i++; continue; }
    if (c === "\\" && i + 1 < n) {
      if (cmd[i + 1] !== "\n") word = (word ?? "") + cmd[i + 1];
      i += 2;
      continue;
    }
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      if (j < 0) return { toks, bad: true };
      word = (word ?? "") + cmd.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1, buf = "";
      while (j < n && cmd[j] !== '"') {
        if (cmd[j] === "\\" && j + 1 < n) { buf += cmd[j + 1]; j += 2; continue; }
        if (cmd[j] === "`" || cmd.startsWith("$(", j)) return { toks, bad: true };
        buf += cmd[j];
        j++;
      }
      if (j >= n) return { toks, bad: true };
      word = (word ?? "") + buf;
      i = j + 1;
      continue;
    }
    if (c === "`" || cmd.startsWith("$(", i) || "(){}".includes(c)) return { toks, bad: true };
    if (c === "<" || c === ">" || cmd.startsWith("&>", i)) {
      if (word !== null && /^\d+$/.test(word)) word = null;
      flush();
      if (cmd.startsWith("<<", i)) return { toks, bad: true };
      const op = /^(&>>?|>>?&?|<&?)/.exec(cmd.slice(i))![0];
      i += op.length;
      if (op.endsWith("&") && op !== "&>") {
        const fd = /^(\d+|-)/.exec(cmd.slice(i));
        if (!fd) return { toks, bad: true };
        i += fd[0].length;
        toks.push(["redir", op + fd[0]]);
        continue;
      }
      toks.push(["redir", op]);
      continue;
    }
    const op = OPS.find((o) => cmd.startsWith(o, i));
    if (op) { flush(); toks.push(["op", op]); i += op.length; continue; }
    word = (word ?? "") + c;
    i++;
  }
  flush();
  return { toks, bad: false };
}

function segments(cmd: string): { segs: string[][]; ops: string[]; bad: boolean } {
  const { toks, bad } = tokenize(cmd.trim());
  const segs: string[][] = [], ops: string[] = [];
  let cur: string[] = [], skip = false;
  for (const [kind, text] of toks) {
    if (kind === "redir") skip = !/\d$/.test(text) && !text.endsWith("-");
    else if (kind === "op") { segs.push(cur); ops.push(text); cur = []; skip = false; }
    else if (skip) skip = false;
    else cur.push(text);
  }
  segs.push(cur);
  return { segs, ops, bad };
}

function isRunner(words: string[]): boolean {
  if (!words.length) return false;
  const prog = words[0]!.split("/").at(-1)!;
  if (RUNNERS.has(prog)) return true;
  return PYTHON.test(prog) && words.length >= 3 && words[1] === "-m" && RUNNER_MODULES.has(words[2]!);
}

/** True when the command's exit code alone says whether its tests passed. */
export function isRunnerExit(cmd: string): boolean {
  const { segs, ops, bad } = segments(cmd);
  if (bad || segs.some((s) => !s.length)) return false;
  if (!ops.length) return isRunner(segs[0]!);
  return ops.length === 1 && ops[0] === "&&" && segs.length === 2 && segs[0]![0] === "cd" && segs[0]!.length === 2 && isRunner(segs[1]!);
}
