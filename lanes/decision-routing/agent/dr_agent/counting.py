# Copyright (c) 2026 Garry Tan. MIT License.
"""The arm-neutral layer every cell runs, N included: the action counter and the allowance-stop mapping.

The counter wraps env execution. Before each action it checks executed_actions < limit, else it raises mini's
LimitsExceeded with exit_status step_stop, so actions past the limit in one reply never run. mini's own step_limit
stays 0 (off), because mini 2.4.6 runs several actions per model call.

A call the metering proxy refuses with DR_ALLOWANCE_STOP ends the session cleanly with exit_status allowance_stop, and
one it refuses with DR_CUSTODY_HIT (a runner-only marker in the request) ends it cleanly with exit_status custody_hit.
litellm maps the proxy's 403 to PermissionDeniedError, which mini's retry loop aborts on, and the decider SDKs run
with their own retries off, so the refused call is never sent twice.
"""
from minisweagent.exceptions import InterruptAgentFlow, LimitsExceeded, Submitted

ALLOWANCE_CODE = "DR_ALLOWANCE_STOP"
STOP_CODES = {"DR_CUSTODY_HIT": "custody_hit", ALLOWANCE_CODE: "allowance_stop"}


class AllowanceStop(Exception):
    """A call the proxy refused with a stop code (STOP_CODES); its message carries the code."""


def exit_message(status, content=None):
    return {"role": "exit", "content": content or status, "extra": {"exit_status": status, "submission": ""}}


def is_allowance_stop(exc):
    """True when exc carries a proxy stop code (DR_ALLOWANCE_STOP or DR_CUSTODY_HIT): the session must stop, not retry."""
    return stop_status(exc) is not None


def stop_status(exc, _depth=0):
    """The exit_status for the proxy stop code that exc, its body, its response or anything it wraps carries, else None."""
    if exc is None or _depth > 6:
        return None
    parts = [str(exc), repr(getattr(exc, "body", "")), repr(getattr(exc, "message", ""))]
    resp = getattr(exc, "response", None)
    if resp is not None:
        try:
            parts.append(resp.text)
        except Exception:
            pass
    for code, status in STOP_CODES.items():
        if any(code in p for p in parts):
            return status
    if isinstance(exc, AllowanceStop):
        return "allowance_stop"
    return stop_status(exc.__cause__, _depth + 1) or stop_status(exc.__context__, _depth + 1)


def as_stop(exc):
    """An AllowanceStop whose message carries the stop code exc carries, so stop_status reads the same status from it
    (a custody hit stays a custody hit); None when exc carries no stop code."""
    status = stop_status(exc)
    if status is None:
        return None
    code = next(c for c, s in STOP_CODES.items() if s == status)
    return AllowanceStop(str(exc) if code in str(exc) else f"{code}: {exc}")


class CountingEnv:
    """Wraps mini's environment: counts every executed action and tells an optional observer about it."""

    def __init__(self, inner, agent, observer=None):
        self.inner, self.agent, self.observer = inner, agent, observer

    def check_limit(self):
        if self.agent.executed_actions >= self.agent.action_limit:
            raise LimitsExceeded(exit_message("step_stop"))

    def execute(self, action, cwd="", *, timeout=None):
        self.check_limit()
        if self.observer:
            self.observer.before(self.agent, action)
        self.agent.executed_actions += 1
        try:
            output = self.inner.execute(action, cwd, timeout=timeout)
        except Submitted as e:
            if self.observer:
                self.observer.submitted(self.agent, action, e)
            raise
        if self.observer:
            self.observer.after(self.agent, action, output)
        return output

    def __getattr__(self, name):
        return getattr(self.inner, name)


class CountingMixin:
    """Put before DefaultAgent in the bases: class X(CountingMixin, DefaultAgent).

    Two limits, the same in every cell: action_limit executed actions (exit_status step_stop), and a backstop of
    call_limit main-model calls (exit_status call_backstop), so a loop of replies with no tool call is bounded too.
    """

    def __init__(self, model, env, *, action_limit=100, call_limit=100, observer=None, **kwargs):
        super().__init__(model, env, **kwargs)
        self.executed_actions = 0
        self.action_limit, self.call_limit = action_limit, call_limit
        self.backstop_hit = False
        self.env = CountingEnv(env, self, observer)

    def check_limits(self):
        if self.executed_actions >= self.action_limit:
            raise LimitsExceeded(exit_message("step_stop"))
        if self.n_calls >= self.call_limit:
            self.backstop_hit = True
            raise LimitsExceeded(exit_message("call_backstop"))

    def query(self):
        self.check_limits()
        try:
            return super().query()
        except InterruptAgentFlow:
            raise
        except Exception as e:
            status = stop_status(e)
            if status:
                raise LimitsExceeded(exit_message(status, str(e)[:500])) from e
            raise
