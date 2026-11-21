// Copyright (c) 2026 Garry Tan. MIT License.
// Codex CLI 0.170.0 rollouts (the root thread's and any sub-agent's, as copied out of $CODEX_HOME/sessions) read into the SDK
// record shape lanes/delivery-route/detect.ts reads (quick/laneb/l1/probes.ts Rec, through lanes/harness-mechanics/score.ts
// toTranscript), so the followed detector runs unchanged on Codex sessions (2026-11-21-capy-b2-test-first-prereg section 6.3).
//
// - Each shell command Codex ran is a Bash call and its result: its completed CommandExecution item (command, folder, output
//   and exit code), or, with no such item, its exec_command call's function_call_output, found by call_id. A command run
//   from a code-mode cell (the exec tool) has no call of its own: Codex 0.170.0 records it only as a CommandExecution item
//   with an exec-<uuid> id, before the cell's output, so it is read from that item like any other.
// - Each patch Codex applied is a write to every path its changes name: its FileChange item (add, update or delete, and a
//   move's move_path), or, with no such item, its apply_patch call's Add File, Update File, Delete File and Move to lines,
//   when the call's output says it applied. A patch that failed writes nothing. The writes of one patch all come from one
//   call, so they are given with the files that are not tests first: a test written in the same patch as the fix is never
//   read as written before it.
// - A command still running when exec_command returns (its output names a session ID) is a run sent to the background,
//   given in Claude Code's notice form, and each write_stdin read of that session is a Read of its output, so detect sees it
//   where its output is read, as B1 reads a background run. Its CommandExecution item, which Codex writes when the process
//   ends, is not read again.
// - Codex starts every command in its own folder, while detect carries a cd from one Bash call to the next as Claude Code's
//   shell does, so a command whose folder is not where the last one left the shell is given with a cd to its folder first.
// - Threads are merged by each line's timestamp. A line that is not JSON, a command or patch item with fields this reader
//   can't read, a write_stdin to a session no exec_command started, and a call to a tool this reader doesn't know are
//   counted in unreadable_items, so the caller can score the session both ways.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { TEST_PATH } from "../../lanes/delivery-route/detect.ts";
import { shellCommands } from "../../lanes/harness-mechanics/vendor/gstack/lib/shell-writes.ts";
import type { Rec } from "../../quick/laneb/l1/probes.ts";

export type CodexTranscript = { recs: Rec[]; unreadable_items: number; threads: number; cwd: string | null };

/** Calls that run no command and write no file, so the stream leaves them out. */
const NO_EFFECT = new Set(["spawn_agent", "wait_agent", "send_input", "close_agent", "resume_agent", "update_plan", "request_user_input", "request_user_input_async", "view_image", "exec"]);
const SHELLS = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z|da)?sh$/;
const shq = (s: string) => (/^[\w./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");

const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : []);

/** Every rollout under a trial's codex-sessions/ folder (or the folder itself), read as one stream. */
export function readCodexSessions(dir: string): CodexTranscript {
  const root = existsSync(join(dir, "codex-sessions")) ? join(dir, "codex-sessions") : dir;
  return codexTranscript(walk(root).filter((f) => /rollout-.*\.jsonl$/.test(f)).map((f) => readFileSync(f, "utf8")));
}

/** The text of a function_call_output or custom_tool_call_output: the string, or its text parts joined. */
const outputText = (o: unknown): string => (typeof o === "string" ? o : Array.isArray(o) ? o.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("") : "");
/** What a unified-exec output says: the process's exit code or the session it still runs in, and its output. */
function execOutput(text: string): { code: number | null; session: number | null; output: string } | null {
  const code = /^Process exited with code (-?\d+)$/m.exec(text), session = /^Process running with session ID (\d+)$/m.exec(text), at = text.indexOf("\nOutput:\n");
  if ((!code && !session) || at < 0) return null;
  return { code: code ? Number(code[1]) : null, session: session ? Number(session[1]) : null, output: text.slice(at + 9) };
}
/** The shell script of a CommandExecution's argv: the script of a [shell, -lc or -c, script] argv, else the argv quoted. */
function script(argv: unknown): string | null {
  if (typeof argv === "string") return argv;
  if (!Array.isArray(argv) || !argv.length || !argv.every((a) => typeof a === "string")) return null;
  if (argv.length === 3 && SHELLS.test(argv[0]) && /^-l?c$/.test(argv[1])) return argv[2];
  return argv.map(shq).join(" ");
}
const folderOf = (cwd: unknown): string | null => {
  if (typeof cwd !== "string" || !cwd) return null;
  if (!cwd.startsWith("file://")) return cwd;
  try { return decodeURIComponent(new URL(cwd).pathname); } catch { return null; }
};
type Change = { path: string; add: boolean; content?: string };
/** The paths an apply_patch input's Add File, Update File, Delete File and Move to lines name, each with an added file's text. */
function patchChanges(input: string, cwd: string): Change[] {
  const out: Change[] = [];
  let add: Change | null = null;
  for (const l of input.split("\n")) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(l) ?? /^\*\*\* (Move) to: (.+)$/.exec(l);
    if (m) { add = m[1] === "Add" ? { path: posix.resolve(cwd, m[2]!.trim()), add: true, content: "" } : null; out.push(add ?? { path: posix.resolve(cwd, m[2]!.trim()), add: false }); }
    else if (add && l.startsWith("+")) add.content += l.slice(1) + "\n";
    else if (l.startsWith("*** ")) add = null;
  }
  return out;
}

/** Rollout texts (one per thread) as one Bash, Read, Write and Edit stream with the session's root folder. */
export function codexTranscript(rollouts: string[]): CodexTranscript {
  type Line = { ts: number; thread: number; n: number; o: any };
  const lines: Line[] = [], cwds: (string | null)[] = [];
  let unreadable = 0, rootCwd: string | null = null, rootSeen = false;
  rollouts.forEach((text, thread) => {
    let ts = 0;
    cwds[thread] = null;
    text.split("\n").forEach((raw, n) => {
      if (!raw.trim()) return;
      let o: any;
      try { o = JSON.parse(raw); } catch { unreadable++; return; }
      const t = Date.parse(o?.timestamp ?? "");
      if (!Number.isNaN(t)) ts = t;
      if (o?.type === "session_meta") {
        cwds[thread] = folderOf(o.payload?.cwd);
        if (!o.payload?.parent_thread_id && !rootSeen) { rootSeen = true; rootCwd = cwds[thread]; }
      }
      lines.push({ ts, thread, n, o });
    });
  });
  lines.sort((a, b) => a.ts - b.ts || a.thread - b.thread || a.n - b.n);

  const recs: Rec[] = [{ type: "SystemMessage", subtype: "init", init: { cwd: rootCwd ?? cwds[0] ?? null, tools: ["Bash", "Read", "Write", "Edit"], skills: [] } }];
  let id = 0, here: string | null = rootCwd ?? cwds[0] ?? null;
  const call = (name: string, input: Record<string, unknown>, result: string, error = false) => {
    const tid = "cx" + id++;
    recs.push({ type: "AssistantMessage", content: [{ id: tid, name, input }] });
    recs.push({ type: "UserMessage", content: [{ tool_use_id: tid, content: result, is_error: error }] });
  };
  const bash = (command: string, cwd: string | null, result: string, error: boolean, background = false) => {
    const text = cwd && cwd !== here ? "cd " + shq(cwd) + " && " + command : command;
    call("Bash", background ? { command: text, run_in_background: true } : { command: text }, result, error);
    here = shellCommands(text + "\n:", here).at(-1)?.cwd ?? null;
  };
  const write = (changes: Change[]) => {
    for (const c of [...changes.filter((x) => !TEST_PATH.test(x.path)), ...changes.filter((x) => TEST_PATH.test(x.path))]) {
      if (c.add) call("Write", { file_path: c.path, content: c.content ?? "" }, "File created successfully at: " + c.path);
      else call("Edit", { file_path: c.path, old_string: "", new_string: "" }, "The file " + c.path + " has been updated successfully.");
    }
  };

  const calls = new Map<string, { name: string; args: any; thread: number }>();
  const ran = new Set<string>(), patched = new Set<string>(), background = new Set<string>(), sessions = new Map<number, string>();
  for (const { o, thread } of lines) {
    const p = o?.payload;
    if (!p || typeof p !== "object") continue;
    if (o.type === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call")) {
      const name = String(p.name ?? "");
      let args: any = p.input;
      if (p.type === "function_call") { try { args = JSON.parse(p.arguments ?? "{}"); } catch { args = null; } }
      if (name === "exec_command" || name === "write_stdin" || name === "apply_patch") calls.set(String(p.call_id), { name, args, thread });
      else if (!NO_EFFECT.has(name)) unreadable++;
    } else if (o.type === "response_item" && p.type === "local_shell_call") unreadable++;
    else if (o.type === "event_msg" && p.type === "item_completed" && p.item?.type === "CommandExecution") {
      const it = p.item, itemId = String(it.id);
      if (background.has(itemId)) continue;
      const command = script(it.command);
      if (command === null || !(it.status === "completed" || it.status === "failed")) { unreadable++; continue; }
      ran.add(itemId);
      const code = typeof it.exit_code === "number" ? it.exit_code : null;
      const out = typeof it.aggregated_output === "string" ? it.aggregated_output : "";
      bash(command, folderOf(it.cwd) ?? cwds[thread] ?? null, (code ? "Exit code " + code + "\n" : "") + out, code !== 0);
    } else if (o.type === "event_msg" && p.type === "item_completed" && p.item?.type === "FileChange") {
      const it = p.item;
      patched.add(String(it.id));
      if (it.status !== "completed") continue;
      if (!it.changes || typeof it.changes !== "object") { unreadable++; continue; }
      const changes: Change[] = [];
      for (const [path, ch] of Object.entries<any>(it.changes)) {
        const abs = posix.resolve(cwds[thread] ?? "/", path);
        changes.push(ch?.type === "add" ? { path: abs, add: true, content: typeof ch.content === "string" ? ch.content : "" } : { path: abs, add: false });
        if (typeof ch?.move_path === "string") changes.push({ path: posix.resolve(cwds[thread] ?? "/", ch.move_path), add: false });
      }
      write(changes);
    } else if (o.type === "response_item" && (p.type === "function_call_output" || p.type === "custom_tool_call_output")) {
      const cid = String(p.call_id), c = calls.get(cid);
      if (!c) continue;
      const text = outputText(p.output);
      if (c.name === "exec_command") {
        if (ran.has(cid)) continue;
        const r = execOutput(text), cmd = typeof c.args?.cmd === "string" ? c.args.cmd : null;
        if (!r || cmd === null) { unreadable++; continue; }
        const cwd = typeof c.args?.workdir === "string" ? posix.resolve(cwds[c.thread] ?? "/", c.args.workdir) : cwds[c.thread] ?? null;
        if (r.session !== null) {
          const file = "/codex/unified-exec/" + r.session + ".output";
          background.add(cid);
          sessions.set(r.session, file);
          bash(cmd, cwd, "Command running in background with ID: " + r.session + ". Output is being written to: " + file, false, true);
        } else bash(cmd, cwd, (r.code ? "Exit code " + r.code + "\n" : "") + r.output, r.code !== 0);
      } else if (c.name === "write_stdin") {
        const file = sessions.get(Number(c.args?.session_id)), r = execOutput(text);
        if (file === undefined || !r) { unreadable++; continue; }
        call("Read", { file_path: file }, r.output);
      } else {
        if (patched.has(cid)) continue;
        const input = typeof c.args === "string" ? c.args : typeof c.args?.input === "string" ? c.args.input : typeof c.args?.patch === "string" ? c.args.patch : null;
        if (input !== null && /^Exit code: 0$|^Success\. Updated the following files/m.test(text)) {
          const changes = patchChanges(input, cwds[c.thread] ?? "/");
          if (changes.length) write(changes);
          else unreadable++;
        } else if (!/verification failed|^Exit code: [1-9]|apply_patch.*(?:failed|rejected)|^error/im.test(text)) unreadable++;
      }
    }
  }
  return { recs, unreadable_items: unreadable, threads: rollouts.length, cwd: rootCwd ?? cwds[0] ?? null };
}
