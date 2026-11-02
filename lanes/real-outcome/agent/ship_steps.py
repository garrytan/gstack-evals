"""Which /ship steps ran, failed or were skipped in one trial (plan 2026-11-01-geva-87, open item 11).

Read from the evaluator's own record of the session (tool calls and their results), never from files the agent wrote.
The evidence for each step comes from the pinned ship/SKILL.md: the section it reads or the helper it runs. A step with
no evidence is skipped; one whose evidence call returned an error is failed. Descriptive only: claims stay scoped to
/ship as run in this sandbox at the pinned sha.
"""

import re

STEPS = (
    ("1", "pre-flight", (r"gstack-ship-preflight",)),
    ("4-6", "tests", (r"ship/sections/tests\.md",)),
    ("6.5", "early Greptile review", (r"ship/sections/greptile-early\.md",)),
    ("7", "test coverage audit", (r"ship/sections/test-coverage\.md",)),
    ("8", "plan completion audit", (r"ship/sections/plan-completion\.md",)),
    ("9", "pre-landing review", (r"ship/sections/review-army\.md", r"gstack-review-log\b.*--start")),
    ("10", "Greptile comments", (r"ship/sections/greptile\.md",)),
    ("11", "adversarial review", (r"ship/sections/adversarial\.md",)),
    ("12", "version", (r"gstack-version-bump", r"gstack-next-version")),
    ("13", "changelog", (r"ship/sections/changelog\.md",)),
    ("14.5", "documentation audit", (r"ship/sections/documentation\.md",)),
    ("17", "push", (r"\bgit\s+push\b",)),
    ("18-19", "pull request", (r"ship/sections/pr-body\.md", r"gstack-post\s+pr-create", r"\bgh\s+pr\s+create\b")),
    ("20", "receipt", (r"gstack-ship-receipt",)),
)


def tool_calls(messages: list) -> list:
    """(tool_use_id, name, text of its input, is_error) for every tool call in a recorded session, in order."""
    calls, errors = [], {}
    for m in messages:
        for block in m.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" or ("name" in block and "input" in block):
                inp = block.get("input") or {}
                text = " ".join(str(inp[k]) for k in ("command", "file_path", "path", "skill", "args", "prompt", "pattern") if inp.get(k))
                calls.append([block.get("id"), block.get("name"), text])
            elif block.get("type") == "tool_result" or "tool_use_id" in block:
                errors[block.get("tool_use_id")] = bool(block.get("is_error"))
    return [(i, n, t, errors.get(i, False)) for i, n, t in calls]


def ship_steps(messages: list) -> dict:
    calls = tool_calls(messages)
    rows = []
    for step, label, patterns in STEPS:
        hits = [(n, t, err) for _, n, t, err in calls if any(re.search(p, t) for p in patterns)]
        status = "skipped" if not hits else ("failed" if any(err for _, _, err in hits) and not any(not err for _, _, err in hits) else "ran")
        rows.append({"step": step, "label": label, "status": status, "evidence": [f"{n}: {t[:160]}" for n, t, _ in hits[:5]]})
    skills = [t for _, n, t, _ in calls if n == "Skill"]
    return {"steps": rows, "skill_calls": skills, "tool_calls": len(calls)}
