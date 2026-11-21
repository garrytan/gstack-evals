# Copyright (c) 2026 Garry Tan. MIT License.
"""h2h_agent's opt-in home_owner=session step (the /cso lane's harness repair, plan section 4): docker cp keeps the host's
uid on the copied home, so after the copy every top-level path the home holds, and all below it, goes to the container's
own user, as a real user's home is owned by that user. Symlinks are changed, never followed. Plain python3, no imports
beyond the standard library, so its test runs anywhere."""
from pathlib import Path

CHOWN = 'chown -R -h "$(id -u):$(id -g)" "$@"'


def home_owner_argv(container: str, home: str, dest: str) -> list:
    """The docker exec argv for the chown, or [] when the home holds nothing."""
    paths = sorted(dest.rstrip("/") + "/" + p.name for p in Path(home).iterdir())
    return ["docker", "exec", container, "sh", "-c", CHOWN, "sh", *paths] if paths else []
