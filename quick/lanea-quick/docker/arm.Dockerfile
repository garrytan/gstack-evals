# One arm: a gstack tree at a pinned sha, installed for Claude Code by its own ./setup.
# DROP_SKILL removes one skill (the none arm: the base minus the target skill).
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR $HOME
COPY --chown=agent:agent gstack/ .claude/skills/gstack/
RUN cd ~/.claude/skills/gstack \
 && git init -q && git add -A && git -c user.email=arm@example.com -c user.name=arm commit -qm arm \
 && ./setup --host claude --no-browser -q
ARG DROP_SKILL=
RUN if [ -n "${DROP_SKILL}" ]; then rm -rf "$HOME/.claude/skills/${DROP_SKILL}" "$HOME/.claude/skills/gstack/${DROP_SKILL}"; fi \
 && rm -rf "$HOME/.gstack"
WORKDIR /work
