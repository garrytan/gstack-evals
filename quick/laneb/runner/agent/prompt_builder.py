"""Pure prompt assembly for the Lane B agent.

Split out of laneb_agent.py so the invoke and plain branches can be tested without the Agent SDK and
Harbor imports that module carries. No agent-facing text lives here beyond the invocation line and the
procedure lines below (R3 amendment 4, plan section 6), which grid.ts PROCEDURE_LINES must match byte for byte.
"""

PROCEDURE_LINES = {"investigate-phases": "Work through /investigate's phases in order, and finish with its DEBUG REPORT."}


def build_prompt(wrapper_text, instruction, invoke, skill, invocation_sep=" ", procedure_line=""):
    """The arm-neutral wrapper with the instruction filled in. When invoke is set, the prompt opens with
    the slash command "/<skill><invocation_sep>" so the CLI expands it and injects that skill's SKILL.md
    body, and a procedure_line key adds its line at the end after a blank line. When invoke is false the
    prompt is the filled wrapper unchanged, as in prereg 1."""
    filled = wrapper_text.replace("{instruction}", instruction)
    if procedure_line and not invoke:
        raise ValueError("a procedure line needs a told skill")
    if not invoke:
        return filled
    told = "/" + skill + invocation_sep + filled
    if procedure_line:
        told += ("\n" if told.endswith("\n") else "\n\n") + PROCEDURE_LINES[procedure_line] + "\n"
    return told
