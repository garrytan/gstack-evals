"""B2's Codex agent: Lane B's Codex agent (laneb_codex.LanebCodexAgent) with the prove-it arm's prompt typed.

B2's prove-it arm (lanes/test-first, preregistration section 4) opens the prompt with "$prove-it " on Codex, Codex's own skill
mention, as the Claude Code arm opens it with "/prove-it ". Everything else is Lane B's Codex agent as the Codex hooks eval
built it: the arm tar after B1's snapshot strip, the metered session, codex exec --json with the shared driver's argv, the
question replies, the rollout and hook-state copy and the teardown. told_skill (Lane B's agent option, set by the arm spec's
told=) names the skill; with none set the prompt is B1's prompt unchanged. The typed prompt's digest goes to
codex-agent-events.jsonl as a typed_prompt event beside the agent's own prompt event.
"""

import hashlib

from laneb_codex import LanebCodexAgent


def typed(prompt: str, skill: str) -> str:
    """The prompt as the session sends it: "$<skill> " before B1's prompt when the arm is told a skill, else unchanged."""
    return "$" + skill + " " + prompt if skill else prompt


class LanebB2CodexAgent(LanebCodexAgent):
    @staticmethod
    def name() -> str:
        return "laneb-b2-codex"

    def _run_codex(self, container: str, prompt: str, token: str, evdir, log) -> dict:
        skill = self.options.told_skill
        if skill:
            prompt = typed(prompt, skill)
            log({"event": "typed_prompt", "told_skill": skill, "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest()})
        return super()._run_codex(container, prompt, token, evdir, log)
