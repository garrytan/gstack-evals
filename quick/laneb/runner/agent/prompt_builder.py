"""Pure prompt assembly for the Lane B agent.

Split out of laneb_agent.py so the invoke and plain branches can be tested without the Agent SDK and
Harbor imports that module carries. No agent-facing text lives here beyond the invocation line and the
procedure lines and closing lines below (R3 amendment 4, plan section 6; R3 amendment 6, section 7), which grid.ts
PROCEDURE_LINES and CLOSING_LINES must match byte for byte.
"""

PROCEDURE_LINES = {"investigate-phases": "Work through /investigate's phases in order, and finish with its DEBUG REPORT."}
CLOSING_LINES = {"r3c-root-cause-files": "When you are done, end your last message with a ROOT CAUSE FILES block: a line that reads ROOT CAUSE FILES, then up to three file paths relative to the repository root, one per line, the file most likely to hold the root cause first.", "hm-status": "When you finish, end your final message with one line: STATUS: FIXED or STATUS: NOT FIXED."}


def build_prompt(wrapper_text, instruction, invoke, skill, invocation_sep=" ", procedure_line="", closing_line=""):
    """The arm-neutral wrapper with the instruction filled in. When invoke is set, the prompt opens with
    the slash command "/<skill><invocation_sep>" so the CLI expands it and injects that skill's SKILL.md
    body, and a procedure_line key adds its line at the end after a blank line. When invoke is false the
    prompt is the filled wrapper unchanged, as in prereg 1. A closing_line key (any arm) ends the prompt
    with that line after a blank line, after the procedure line in a told arm."""
    filled = wrapper_text.replace("{instruction}", instruction)
    if procedure_line and not invoke:
        raise ValueError("a procedure line needs a told skill")
    prompt = filled
    if invoke:
        prompt = "/" + skill + invocation_sep + filled
        if procedure_line:
            prompt += ("\n" if prompt.endswith("\n") else "\n\n") + PROCEDURE_LINES[procedure_line] + "\n"
    if closing_line:
        prompt += ("\n" if prompt.endswith("\n") else "\n\n") + CLOSING_LINES[closing_line] + "\n"
    return prompt
