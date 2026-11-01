# Copyright (c) 2026 Garry Tan. MIT License.
# gstack-evals real-outcome verifier, pytest entry (lanes/real-outcome/task/SPEC.md). Verifier-owned. It imports
# pytest from the image's own install, never from the tree under test, so a pytest.py or pytest/ package the tree adds
# can't stand in for the runner. Its sh entrypoint prints the start line before it execs python, so whatever the tree
# does from interpreter start on, a sitecustomize site.py finds through a .pth or an editable install an image plugin
# imports included, is the tree's outcome (SPEC.md step 5). Plugin autoload is off: the image's pytest11 plugins
# load while only trusted paths are on sys.path, so a tree module or dist-info can't pose as one. It reads ini options only from the verifier's copy of
# gold's config (-c), runs the targets in a seeded random order, and writes every test's phases to a record line by line, so a run that dies keeps
# what it recorded and every id it never reached reads as missing.
import json
import os
import random
import sys

REPO = "/testbed"
DEPS = tuple(os.path.join(REPO, d) for d in (".venv", "venv", "__pypackages__"))


def inside(path, root):
    return path == root or path.startswith(root + os.sep)


def trusted(path):
    real = os.path.realpath(path)
    return not inside(real, REPO) or any(inside(real, d) for d in DEPS)


def main():
    out, config, targets_file, seed = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    record = open(out, "a", buffering=1)

    def emit(**fields):
        record.write(json.dumps(fields) + "\n")

    saved = list(sys.path)
    sys.path[:] = [p for p in sys.path if p and trusted(p)]
    import pytest
    import _pytest
    import pluggy

    for mod in (pytest, _pytest, pluggy):
        if not trusted(mod.__file__):
            emit(event="runner_swapped", module=mod.__name__, path=mod.__file__)
            sys.exit(4)
    from importlib.metadata import entry_points

    eps = entry_points()
    eps = eps.select(group="pytest11") if hasattr(eps, "select") else eps.get("pytest11", [])
    plugins = [ep.load() for ep in eps]
    os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    emit(event="runner", pytest=pytest.__version__, path=os.path.realpath(pytest.__file__), plugins=sorted(ep.name for ep in eps))
    sys.path[:] = [REPO] + [p for p in saved if p and os.path.realpath(p) != REPO]

    class Recorder:
        @pytest.hookimpl(hookwrapper=True)
        def pytest_runtest_makereport(self, item, call):
            outcome = yield
            report = outcome.get_result()
            exc = call.excinfo
            emit(event="phase", id=item.nodeid, when=call.when, outcome=report.outcome, xfail=hasattr(report, "wasxfail"), exc=exc.typename if exc else None, msg=exc.exconly()[:600] if exc else None)

        def pytest_collectreport(self, report):
            if report.outcome != "passed":
                emit(event="collect", id=report.nodeid, outcome=report.outcome, msg=str(report.longrepr)[-1200:])

        @pytest.hookimpl(trylast=True)
        def pytest_collection_modifyitems(self, session, config, items):
            random.Random(seed).shuffle(items)
            emit(event="order", ids=[i.nodeid for i in items])

    targets = [line.strip() for line in open(targets_file) if line.strip()]
    os.chdir(REPO)
    code = pytest.main(["-c", config, "--rootdir", REPO, "-p", "no:cacheprovider", "-q", *targets], plugins=[Recorder(), *plugins])
    emit(event="exit", code=int(code))


if __name__ == "__main__":
    main()
