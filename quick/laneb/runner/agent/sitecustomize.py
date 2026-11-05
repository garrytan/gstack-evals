"""Harbor's trial order for a Lane B part that has one (R3 amendment 5 section 5: within an R3b grid part the order is a
seeded shuffle of task and arm). Harbor builds a job's trials attempt-major, then task, then agent, and has no order
setting. When a run dir holds order.json, vm-run.sh runs the paid job with LANEB_TRIAL_ORDER set to it, and harbor runs
with runner/agent on PYTHONPATH, so Python imports this file at startup. It wraps JobPlan.build_trial_configs to return
the same trials in the file's order: a list of [task, arm] pairs, the task being the task directory's name and the arm
the agent's arm kwarg. A pair may repeat when the job holds that task and arm more than once (R3c's calibration parts list
a task once per trial, and its grid parts run several attempts): the file must name each of the job's trials once and
nothing else, as a multiset of pairs, or the job fails before any trial starts. Without LANEB_TRIAL_ORDER it does nothing. Any error while installing the wrapper ends the process with
exit 3, so a part never runs in Harbor's own order by accident."""
import os
import sys


def _install(path):
    import json
    from pathlib import Path

    from harbor.job_plan import JobPlan

    order = [tuple(p) for p in json.loads(Path(path).read_text())]
    build = JobPlan.build_trial_configs

    def ordered(config, task_configs, *, job_id):
        trials = build(config, task_configs, job_id=job_id)
        by_key = {}
        for t in trials:
            by_key.setdefault((Path(str(t.task.path)).name, str((t.agent.kwargs or {}).get("arm"))), []).append(t)
        if sorted(order) != sorted(k for k, ts in by_key.items() for _ in ts):
            raise RuntimeError(f"LANEB_TRIAL_ORDER {path} does not name each of the job's {len(trials)} trials once")
        print(f"laneb order: applied {len(order)} trials from {path}", file=sys.stderr, flush=True)
        return [by_key[k].pop(0) for k in order]

    JobPlan.build_trial_configs = staticmethod(ordered)


if os.environ.get("LANEB_TRIAL_ORDER"):
    try:
        _install(os.environ["LANEB_TRIAL_ORDER"])
    except BaseException as e:  # noqa: BLE001
        print(f"E_INTERNAL LANEB_TRIAL_ORDER could not be applied: {e!r}", file=sys.stderr, flush=True)
        os._exit(3)
