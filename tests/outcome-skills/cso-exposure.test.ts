// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 8 (harness plan 15.4): the exposure detectors on fixture transcripts shaped like the pinned helper's
// output, both ways: a full procedure, a load with no run, a run never inspected or finished, tooling errors against
// helper refusals, host reads after start, untold's trigger, and the helper's snapshot root and handles.
import { describe, expect, test } from "bun:test";
import { csoExposure, helperJson, untoldTriggered } from "../../lanes/outcome-skills/cso/exposure.ts";

const L = "~/.claude/skills/gstack/bin/gstack-cso-launcher";
const RUN = "1767225600000-0123456789abcdef";
const PID = "0123456789abcdef0123456789abcdef";
let n = 0;
const call = (command: string, out: string, error = false) => {
  const id = "t" + n++;
  return [
    { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    { type: "UserMessage", content: [{ type: "tool_result", tool_use_id: id, content: out, is_error: error }] },
  ];
};
const tool = (name: string, input: Record<string, unknown>) => [{ type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "x" + n++, name, input }] }];
const LOADED = [{ type: "UserMessage", content: [{ type: "text", text: "<command-message>cso</command-message>\n<command-name>/cso</command-name>" }] }];
const startOut = JSON.stringify({ schemaVersion: 3, runId: RUN, repoId: "r", status: "running", completeness: "not assessed", source: { root: "<REDACTED-internal.user_path>" } }, null, 2);
const SECRET = "@cso-path//613263fe85be84650fb80c786d861b18";
const inspectOut = JSON.stringify({ report: { runId: RUN }, manifest: { root: "<REDACTED-internal.user_path>", entries: [{ originalHash: "0".repeat(64), bytes: 22, mode: 420, path: "src/a.ts" }, { originalHash: "1".repeat(64), bytes: 9, mode: 420, path: SECRET, displayPath: "config/secrets/[redacted]" }] } }, null, 2);
const TREE = ["src/a.ts", "config/secrets/prod.env"];
const full = [
  ...LOADED,
  ...call(L + " start --repo /work/repo", startOut),
  ...call(L + " inspect " + RUN, inspectOut),
  ...call(L + " read " + RUN + " @cso-path//" + PID, "export function a() {}\n"),
  ...call(L + " submit " + RUN + " /tmp/s.json", JSON.stringify({ runId: RUN, findings: 2, completeness: "partial" })),
  ...call(L + " finish " + RUN, JSON.stringify({ runId: RUN, status: "finished", completeness: "complete", report: "report.md" })),
];

describe("cso exposure", () => {
  test("a full run: loaded, procedure ran, completeness, findings submitted, helper records", () => {
    const r = csoExposure(full, TREE);
    expect(r.exposure).toEqual({ loaded: true, procedure_ran: true, run_id: RUN, completeness: "complete", findings_submitted: 2, tooling_errors: 0, host_reads_after_start: 0, scope: "daily/default" });
    expect(r.helper).toEqual({ snapshot_root: "<REDACTED-internal.user_path>", handles: { [SECRET]: "config/secrets/prod.env" } });
    expect(csoExposure(full).helper.handles).toEqual({});
  });
  test("the base-directory marker for the cso skill counts as loaded; another skill's does not", () => {
    const ctx = (t: string) => [{ type: "UserMessage", content: [{ type: "text", text: t }] }];
    expect(csoExposure(ctx("Base directory for this skill: /root/.claude/skills/gstack/cso")).exposure.loaded).toBe(true);
    expect(csoExposure(ctx("Base directory for this skill: /root/.claude/skills/gstack/review")).exposure.loaded).toBe(false);
  });
  test("a start with no inspect or read on its run, or no finish, is not the procedure", () => {
    const noUse = [...LOADED, ...call(L + " start --repo .", startOut), ...call(L + " inspect 1767225600000-ffffffffffffffff", inspectOut), ...call(L + " finish " + RUN, "{}")];
    expect(csoExposure(noUse).exposure.procedure_ran).toBe(false);
    const noFinish = full.slice(0, -2);
    const e = csoExposure(noFinish).exposure;
    expect(e.procedure_ran).toBe(false);
    expect(e.completeness).toBeNull();
    expect(e.findings_submitted).toBe(2);
  });
  test("a start that printed no run id starts nothing, and a session with no start has no findings count", () => {
    const e = csoExposure([...LOADED, ...call(L + " start --repo .", "", true)]).exposure;
    expect(e).toMatchObject({ loaded: true, procedure_ran: false, run_id: null, findings_submitted: null, tooling_errors: 1 });
  });
  test("a failed launcher call with no helper status is a tooling error; a helper refusal is not", () => {
    const refusal = '{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"read requires one path"}}';
    const e = csoExposure([...full.slice(0, 7), ...call(L + " read " + RUN, refusal, true), ...call(L + " read " + RUN + " x", "Exit code 127\nbash: gstack-cso-launcher: not found", true), ...full.slice(7)]).exposure;
    expect(e.tooling_errors).toBe(1);
    expect(e.procedure_ran).toBe(true);
  });
  test("host file reads after start count, the helper's own reads and reads before start do not", () => {
    const recs = [...LOADED, ...tool("Read", { file_path: "/work/repo/README.md" }), ...call(L + " start --repo .", startOut), ...tool("Read", { file_path: "/work/repo/src/a.ts" }), ...tool("Grep", { pattern: "eval" }), ...call("cat src/b.ts", "x"), ...call("git status", ""), ...full.slice(3)];
    expect(csoExposure(recs).exposure.host_reads_after_start).toBe(3);
  });
  test("untold's trigger: loaded or a helper run without the command typed", () => {
    expect(untoldTriggered(csoExposure([]).exposure)).toBe(false);
    expect(untoldTriggered(csoExposure(full.slice(1)).exposure)).toBe(true);
    expect(untoldTriggered(csoExposure(LOADED).exposure)).toBe(true);
  });
  test("the start's mode and scope come from its printed policy, else from its argv as the pinned parseStart reads it", () => {
    const start = (args: string, out: string) => csoExposure([...LOADED, ...call(L + " start --repo /work/repo" + args, out)]).exposure.scope;
    expect(start("", startOut)).toBe("daily/default");
    expect(start(" --comprehensive", JSON.stringify({ runId: RUN, policy: { mode: "comprehensive", scope: "default" } }))).toBe("comprehensive/default");
    expect(start("", JSON.stringify({ runId: RUN, policy: { mode: "daily", scope: "domain:auth" } }))).toBe("daily/domain:auth");
    expect(start(" --code", startOut)).toBe("daily/code");
    expect(start(" --comprehensive --scope auth", startOut)).toBe("comprehensive/domain:auth");
    expect(start("", "")).toBeNull();
    expect(csoExposure(LOADED).exposure.scope).toBeNull();
  });
  test("stage 0 repair: a launcher and run id bound to shell variables in the same command resolve, as in Opus's vm2 session", () => {
    const R0 = "1795275999946-4e87a9eb23d87768";
    const P = "R=" + R0 + "; L=" + L + "; ";
    const recs = [
      ...LOADED,
      ...call(L + ' start --repo /work/repo 2>&1 | head -100; echo "exit: ${PIPESTATUS[0]}"', JSON.stringify({ schemaVersion: 3, runId: R0, status: "running", source: { root: "<REDACTED-internal.user_path>" } }, null, 2) + "\nexit: 0"),
      ...call(P + '$L inspect $R > /tmp/cso_inspect.json 2>&1; echo "exit $?"', "exit 0"),
      ...call(P + '$L read $R lib/resolver-compat.js > /tmp/cso_rc.txt 2>&1; grep -n "isPathAllowed" /tmp/cso_rc.txt | head -40', "105:  isPathAllowed(path) {"),
      ...call(
        "umask 077; D=$(mktemp -d /tmp/csoctl.XXXX); R=" + R0 + "; L=" + L + "\ncat > $D/s.json <<'EOF'\n{\"findings\":[]}\nEOF\n" + '$L submit $R $D/s.json 2>&1 | tail -20; echo "submit exit ${PIPESTATUS[0]}"; rm -rf $D\n$L finish $R 2>&1 | tail -40; echo "finish exit ${PIPESTATUS[0]}"',
        '{"ok":false,"error":{"code":"INVALID_SCHEMA","message":"exclusions must be an array"}}\nsubmit exit 1\n' + JSON.stringify({ runId: R0, status: "finished", completeness: "partial", report: "report.md" }, null, 2) + "\nfinish exit 0",
      ),
    ];
    expect(csoExposure(recs).exposure).toEqual({ loaded: true, procedure_ran: true, run_id: R0, completeness: "partial", findings_submitted: 0, tooling_errors: 0, host_reads_after_start: 0, scope: "daily/default" });
    const braced = [...LOADED, ...call(L + " start --repo .", startOut), ...call('G="' + L + '"; R=' + RUN + '; "$G" read "${R}" src/a.ts | head', "x"), ...call(L + " finish " + RUN, "{}")];
    expect(csoExposure(braced).exposure.procedure_ran).toBe(true);
  });
  test("a variable bound to anything but the launcher does not resolve to it, an assignment is not a call, and a binding ends with its command", () => {
    const recs = [
      ...LOADED,
      ...call(L + " start --repo /work/repo", startOut),
      ...call("X=/usr/bin/foo; R=" + RUN + "; $X inspect $R; $X read $R src/a.ts", "ok"),
      ...call("L=" + L + '; [ -x "$L" ] && echo "launcher: present"', "launcher: present"),
      ...call("L=" + L + "\ncat src/a.ts", "x"),
      ...call("L=" + L + "; R=" + RUN, ""),
      ...call("$L inspect $R", inspectOut),
      ...call(L + " finish " + RUN, JSON.stringify({ runId: RUN, status: "finished", completeness: "partial" })),
    ];
    const e = csoExposure(recs).exposure;
    expect(e.procedure_ran).toBe(false);
    expect(e.tooling_errors).toBe(0);
    expect(e.host_reads_after_start).toBe(0);
  });
  test("helper JSON is read from pretty-printed output with text around it", () => {
    expect(helperJson("note\n" + startOut + "\n")?.runId).toBe(RUN);
    expect(helperJson("no json")).toBeNull();
  });
});
