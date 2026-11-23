# Copyright (c) 2026 Garry Tan. MIT License.
"""The decision-routing runner's Harbor environment: Harbor's docker environment with the rig's egress sidecar.

Harbor builds each trial's egress sidecar, a gost transparent proxy that enforces the network allowlist, from the build
context its DockerEnvironment names. Harbor's own gost.yaml leaves the redirect handler's readTimeout unset, and gost
then closes any connection whose response has not started within 15 s, so a model reply that took longer was paid for
and never reached the agent. egress-sidecar/ beside this file is Harbor's context, vendored from Harbor f3a5a923 with
the handler's readTimeout set to 900s (see its file headers and NOTICE.md). Harbor loads this class by import path
(dr_sidecar:DrDockerEnvironment, controller.ts harborJob); everything else is Harbor's DockerEnvironment unchanged.
"""

from pathlib import Path

from harbor.environments.docker.docker import DockerEnvironment


class DrDockerEnvironment(DockerEnvironment):
    _EGRESS_CONTROL_SIDECAR_CONTEXT_PATH = Path(__file__).resolve().parent / "egress-sidecar"
