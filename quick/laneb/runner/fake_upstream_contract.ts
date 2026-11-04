// The stub model for R3b's keyless hook check (R3 amendment 5 section 9 item 2): fake_upstream.ts's server with a script
// that drives the told arm's skill contract Stop hook. It fixes the task with one Bash call (a fix and a check, so the
// contract's check-after-last-edit item is met), then ends its turn. A task whose instruction holds STOP_UNMET_FIRST ends
// first with no DEBUG REPORT, which the Stop hook must refuse; once the hook's refusal reaches it, or on any other task,
// it ends with a DEBUG REPORT that has a real value for every label the contract names, which the hook must let stop.
// It never sees a key and makes no network call.
import { startFakeUpstream, toolResults, type Block } from "./fake_upstream.ts";

export const UNMET_MARKER = "STOP_UNMET_FIRST";
export const BLOCK_TEXT = "SKILL_CONTRACT_UNMET investigate";
export const REPORT = [
  "DEBUG REPORT",
  "Symptom: calc.add(2, 3) returned -1 instead of 5.",
  "Root cause: add() subtracted its arguments (calc.py line 2).",
  "Fix: calc.py line 2 now returns a + b.",
  "Evidence: python3 -c 'import calc; print(calc.add(2, 3))' printed 5 after the fix.",
  "Regression test: the check above, run after the last edit.",
  "Status: DONE",
].join("\n");

export function contractTurn(body: any): Block[] {
  const r = toolResults(body.messages);
  if (!("toolu_fix_1" in r)) return [{ type: "tool_use", id: "toolu_fix_1", name: "Bash", input: { command: "sed -i 's/return a - b/return a + b/' calc.py && python3 -c 'import calc; print(calc.add(2, 3))'", description: "Fix add and check it" } }];
  const seen = JSON.stringify(body.messages ?? []);
  if (seen.includes(UNMET_MARKER) && !seen.includes(BLOCK_TEXT)) return [{ type: "text", text: "Fixed add() in calc.py." }];
  return [{ type: "text", text: REPORT }];
}

if (import.meta.main) {
  const s = startFakeUpstream(undefined, undefined, contractTurn);
  console.log(`fake contract upstream on 127.0.0.1:${s.port}`);
}
