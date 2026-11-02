"""Pure prompt assembly for the Lane B agent.

Split out of laneb_agent.py so the invoke and plain branches can be tested without the Agent SDK and
Harbor imports that module carries. No agent-facing text lives here beyond the invocation line.
"""


def build_prompt(wrapper_text, instruction, invoke, skill, invocation_sep=" "):
    """The arm-neutral wrapper with the instruction filled in. When invoke is set, the prompt opens with
    the slash command "/<skill><invocation_sep>" so the CLI expands it and injects that skill's SKILL.md
    body. When invoke is false the prompt is the filled wrapper unchanged, as in prereg 1."""
    filled = wrapper_text.replace("{instruction}", instruction)
    if invoke:
        return "/" + skill + invocation_sep + filled
    return filled
