# The hm-session image the scripted sessions run in (sessions.ts SESSION_IMAGE): Lane B's laneb-check base plus python3 and git.
FROM laneb-check:ubuntu-24.04
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 git ca-certificates >/dev/null && rm -rf /var/lib/apt/lists/*
