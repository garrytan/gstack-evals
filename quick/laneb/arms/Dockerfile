# syntax=docker/dockerfile:1.7
#
# Lane B arms for Claude Code. build.sh drives the targets below.
#
#   runtime     a mirror of the trial runtime: the Claude Code native binary at
#               /usr/local/bin/claude, Node at /opt/laneb/bin/node and Bun at
#               /opt/laneb/bin/bun. The builder and the offline checks use it;
#               the trial harness ships its own copy of the same layout.
#   gstack-tar  /gstack.tar: the real `./setup --host claude --no-browser`
#               result for gstack at the pinned sha, with paths relative to
#               /root (.claude/..., .gstack/...).
#   check       BASE_IMAGE plus the runtime, with /opt/laneb/bin appended to
#               PATH, for check-arms.sh and check-l1.sh.
#   gstack-l1-tar
#               /arm.tar, /gstack-config.tsv and /loadout.lock.json for one L1 arm: the real
#               `./setup --host claude --no-browser --loadout <GSTACK_LOADOUT>`
#               result at the pin in the "gstack" context, the same seeded user
#               as gstack-tar, then skill_routing and skill_contracts set off
#               when GSTACK_OFF_KEYS=true, and each GSTACK_KEYS key=value pair set
#               (the harness mechanics arms).
#
# The gstack checkout comes in as the named build context "gstack".

ARG BUILDER_IMAGE=ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c
ARG BASE_IMAGE=ubuntu:24.04

FROM ${BUILDER_IMAGE} AS fetch
ARG NODE_VERSION=24.22.1
ARG NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
# Bun 1.4.4 is gstack's install default (GSTACK_BUN_DEFAULT in
# bin/gstack-bun-version.sh), above its tested minimum 1.4.2. The checksum is
# gstack's own entry for the baseline build (no AVX2 needed).
ARG BUN_VERSION=1.4.4
ARG BUN_TARGET=linux-x64-baseline
ARG BUN_SHA256=e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76
ARG CLAUDE_CODE_VERSION=2.1.312
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    mkdir -p /opt/laneb/bin /usr/local/bin /tmp/node /tmp/cc; \
    curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz -C /tmp/node --strip-components=1 --no-same-owner; \
    install -m 0755 /tmp/node/bin/node /opt/laneb/bin/node; \
    curl -fsSLo /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${BUN_TARGET}.zip"; \
    echo "${BUN_SHA256}  /tmp/bun.zip" | sha256sum -c -; \
    unzip -q /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 "/tmp/bun/bun-${BUN_TARGET}/bun" /opt/laneb/bin/bun; \
    PATH="/tmp/node/bin:$PATH" npm install --global --no-fund --no-audit \
      --prefix /tmp/cc "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    install -m 0755 /tmp/cc/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-linux-x64/claude /usr/local/bin/claude; \
    rm -rf /tmp/node /tmp/node.tar.xz /tmp/bun.zip /tmp/bun /tmp/cc /root/.npm; \
    test "$(/usr/local/bin/claude --version)" = "${CLAUDE_CODE_VERSION} (Claude Code)"; \
    test "$(/opt/laneb/bin/bun --version)" = "${BUN_VERSION}"; \
    test "$(/opt/laneb/bin/node --version)" = "v${NODE_VERSION}"

FROM scratch AS runtime
COPY --from=fetch /opt/laneb/bin/ /opt/laneb/bin/
COPY --from=fetch /usr/local/bin/claude /usr/local/bin/claude

FROM ${BUILDER_IMAGE} AS gstack-build
# build-essential lets setup build the static /cso helper. It stays in this
# stage; the arm tar carries only what setup writes under /root.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates curl git unzip xz-utils python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=runtime / /
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV HOME=/root \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/laneb/bin \
    CLAUDE_CONFIG_DIR=/root/.claude
COPY --from=gstack . /root/.claude/skills/gstack
RUN cd /root/.claude/skills/gstack && ./setup --host claude --no-browser
# Changes on top of setup's output, made with gstack's own config command
# and its own marker files.
#
# No update check: trials have no internet, and on a network that accepts
# connections and never answers, the check's git ls-remote holds every skill
# preamble for minutes. GSTACK_UPDATE_CHECK=true keeps setup's default.
#
# A long-time user: every one-time onboarding prompt that bin/gstack-skill-start
# gates on a marker is marked seen. The prompts chain (lake intro, then the
# telemetry prompt, then the proactive prompt, then the offer to add routing
# rules to the project's CLAUDE.md and commit it), so all of them are covered.
# Telemetry stays off and proactive stays core, the defaults; routing_declined
# answers the CLAUDE.md offer. GSTACK_ONBOARDING_SEEN=false keeps a fresh install.
ARG GSTACK_UPDATE_CHECK=false
ARG GSTACK_ONBOARDING_SEEN=true
RUN set -eu; \
    cfg=/root/.claude/skills/gstack/bin/gstack-config; \
    if [ "$GSTACK_UPDATE_CHECK" = false ]; then "$cfg" set update_check false; fi; \
    if [ "$GSTACK_ONBOARDING_SEEN" = true ]; then \
      for m in .feature-prompted-model-overlay .completeness-intro-seen .telemetry-prompted \
               .proactive-prompted .activated .first-loop-tip-shown; do \
        touch "/root/.gstack/$m"; \
      done; \
      "$cfg" set routing_declined true; \
    fi
# Make the tree self-contained and reproducible:
# - every symlink outside node_modules (setup links each skill folder's files
#   into the checkout) becomes a copy of its target; node_modules keeps its
#   relative links;
# - setup's probe of the claude binary leaves Claude Code's own state
#   (.claude.json with a random machine and user id, plus a backup); that is
#   not gstack state, so it goes;
# - volatile files: the install registry's timestamp is fixed at the epoch,
#   the gbrain status cache goes (it is keyed on the builder's PATH and is
#   rebuilt on first use), the /cso build log (timings and a random stage
#   folder) is emptied, the checkout's reflog (timestamp and the builder's git
#   identity) goes, and the checkout's index is rebuilt from HEAD with no
#   stat data, so git rehashes files on first use instead of trusting build
#   times;
# - the tar is canonical: sorted names, mtime 0, owner root.
RUN set -eu; \
    mapfile -d '' links < <(find /root/.claude -type l -not -path '*/node_modules/*' -print0); \
    for link in "${links[@]}"; do \
      target="$(readlink -f "$link")"; rm "$link"; cp -a --dereference "$target" "$link"; \
    done; \
    test -z "$(find /root/.claude -type l -not -path '*/node_modules/*')"; \
    test -z "$(find -L /root/.claude -type l)"; \
    test -z "$(find /root/.claude -type l -lname '/*')"; \
    rm -rf /root/.claude/.claude.json /root/.claude/backups; \
    sed -i -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z/1970-01-01T00:00:00Z/g' /root/.gstack/installs.tsv; \
    rm -f /root/.gstack/.gbrain-local-status-cache.json; \
    : > /root/.claude/skills/gstack/bin/.gstack-cso-build.log; \
    git_dir=/root/.claude/skills/gstack/.git; \
    rm -rf "$git_dir/logs" "$git_dir/ORIG_HEAD"; \
    rm -f "$git_dir/index"; git --git-dir="$git_dir" read-tree HEAD; \
    mkdir /out; \
    tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu \
      -C /root -cf /out/gstack.tar .claude .gstack

FROM scratch AS gstack-tar
COPY --from=gstack-build /out/gstack.tar /gstack.tar

# L1 arms (wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000, sections 2
# and 10). The same builder, setup run, seeded user and self-contained,
# canonical tree as gstack-build, with the loadout and the off keys as ARGs.
FROM ${BUILDER_IMAGE} AS gstack-l1-build
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates curl git unzip xz-utils python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=runtime / /
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV HOME=/root \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/laneb/bin \
    CLAUDE_CONFIG_DIR=/root/.claude
COPY --from=gstack . /root/.claude/skills/gstack
ARG GSTACK_LOADOUT=lite
# Extra setup flags (the harness mechanics gstack arms pass --skill-contracts). Empty for every other arm.
ARG GSTACK_SETUP_FLAGS=""
RUN cd /root/.claude/skills/gstack && ./setup --host claude --no-browser --loadout "$GSTACK_LOADOUT" $GSTACK_SETUP_FLAGS
ARG GSTACK_UPDATE_CHECK=false
ARG GSTACK_ONBOARDING_SEEN=true
RUN set -eu; \
    cfg=/root/.claude/skills/gstack/bin/gstack-config; \
    if [ "$GSTACK_UPDATE_CHECK" = false ]; then "$cfg" set update_check false; fi; \
    if [ "$GSTACK_ONBOARDING_SEEN" = true ]; then \
      for m in .feature-prompted-model-overlay .completeness-intro-seen .telemetry-prompted \
               .proactive-prompted .activated .first-loop-tip-shown; do \
        touch "/root/.gstack/$m"; \
      done; \
      "$cfg" set routing_declined true; \
    fi
# The off arm: both switches off in the arm's state root, after the seeded
# user. The hooks stay registered and exit silently.
ARG GSTACK_OFF_KEYS=false
RUN set -eu; \
    cfg=/root/.claude/skills/gstack/bin/gstack-config; \
    if [ "$GSTACK_OFF_KEYS" = true ]; then "$cfg" set skill_routing off; "$cfg" set skill_contracts off; fi
# The harness mechanics hook arm: key=value pairs set with gstack's own config command, after the seeded user. Empty
# (every other arm) sets nothing.
ARG GSTACK_KEYS=""
RUN set -eu; \
    cfg=/root/.claude/skills/gstack/bin/gstack-config; \
    for kv in $GSTACK_KEYS; do "$cfg" set "${kv%%=*}" "${kv#*=}"; done
# The harness mechanics hook arm: a patch (base64) applied after setup to every installed copy of the file it names:
# the checkout, the claude render and the ~/.claude/skills copy (skipped when it is a link into the render). Each
# copy's git blob prints to /root/.gstack/hm-patched.tsv. Empty (every other arm) applies nothing.
ARG GSTACK_PATCH_B64=""
RUN set -eu; \
    [ -n "$GSTACK_PATCH_B64" ] || exit 0; \
    printf '%s' "$GSTACK_PATCH_B64" | base64 -d > /tmp/hm.patch; \
    f=$(sed -n 's#^+++ b/##p' /tmp/hm.patch); \
    : > /root/.gstack/hm-patched.tsv; \
    for d in /root/.claude/skills/gstack /root/.gstack/render/claude /root/.claude/skills; do \
      [ -L "$d/$f" ] && continue; \
      (cd "$d" && git apply --unsafe-paths --directory=. /tmp/hm.patch); \
      printf '%s\t%s\n' "$d/$f" "$(git hash-object "$d/$f")" >> /root/.gstack/hm-patched.tsv; \
    done; \
    rm /tmp/hm.patch
# The same steps as gstack-build, with two differences. Only absolute symlinks
# become copies: the checkout's own relative link (connect-chrome, tracked in
# git as a link to open-gstack-browser) stays a link, because the pin's
# gstack-modules render counts a real connect-chrome folder as a 205th lite
# file. And one more volatile fix: setup backs up
# settings.json each time it registers a hook, as settings.json.bak.<time>.<pid>.<random>,
# and points settings.json.bak-latest at the newest; those rollback copies go.
# After the tar is written, so nothing here can change it: gstack-config's view
# of both switches, and the lite lock from the pin's own gstack-modules render
# at setup's render path (setup's render is moved aside and put back, as
# GEVA-254's install-pin.sh did).
RUN set -eu; \
    mapfile -d '' links < <(find /root/.claude -type l -lname '/*' -not -path '*/node_modules/*' -print0); \
    for link in "${links[@]}"; do \
      target="$(readlink -f "$link")"; rm "$link"; cp -a --dereference "$target" "$link"; \
    done; \
    test -z "$(find /root/.claude -type l -lname '/*')"; \
    test -z "$(find -L /root/.claude -type l)"; \
    test -z "$(find /root/.claude -type l -not -path '*/node_modules/*' -exec readlink -f {} \; | grep -v '^/root/')"; \
    rm -rf /root/.claude/.claude.json /root/.claude/backups; \
    rm -f /root/.claude/settings.json.bak.* /root/.claude/settings.json.bak-latest; \
    sed -i -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z/1970-01-01T00:00:00Z/g' /root/.gstack/installs.tsv; \
    rm -f /root/.gstack/.gbrain-local-status-cache.json; \
    : > /root/.claude/skills/gstack/bin/.gstack-cso-build.log; \
    git_dir=/root/.claude/skills/gstack/.git; \
    rm -rf "$git_dir/logs" "$git_dir/ORIG_HEAD"; \
    rm -f "$git_dir/index"; git --git-dir="$git_dir" read-tree HEAD; \
    mkdir /out; \
    tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu \
      -C /root -cf /out/arm.tar .claude .gstack; \
    g=/root/.claude/skills/gstack; render=/root/.gstack/render/claude; \
    for k in skill_routing skill_contracts; do printf '%s\t%s\n' "$k" "$("$g/bin/gstack-config" get "$k")"; done > /out/gstack-config.tsv; \
    mv "$render" "$render.setup"; \
    (cd "$g" && bin/gstack-modules render --host claude --loadout "$GSTACK_LOADOUT" --out-dir "$render" > /dev/null); \
    cp "$render/loadout.lock.json" /out/loadout.lock.json; \
    rm -rf "$render"; mv "$render.setup" "$render"

FROM scratch AS gstack-l1-tar
COPY --from=gstack-l1-build /out/ /

FROM ${BASE_IMAGE} AS check
COPY --from=runtime / /
ENV PATH="${PATH}:/opt/laneb/bin" \
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 \
    CLAUDE_CONFIG_DIR=/root/.claude
WORKDIR /app
