# B2's Codex arm homes (lanes/test-first, preregistration section 4), built the way the Codex hooks eval's part R builds its
# own (lanes/codex-hooks/r/arms/Dockerfile, whose lines down to ./setup this file repeats). arms.ts drives it:
#   bun lanes/test-first/cli.ts arms build-codex [--out <dir>]
# gstack at B2's pin (29bff55d, v1.102.1.0) comes in as the named build context "gstack"; prove-it.md (B1's gstack-shaped
# skill with its paths moved to ~/.codex, part R's proveItText) and line.md (the line) come in the build context. One stage
# builds the home the way gstack's README sets up a Codex install (~/gstack, then ./setup --host codex --no-browser), seeds
# Lane B's long-time user with gstack's own config command (telemetry off), drops the files setup leaves that change from
# build to build, and writes the four tars.
ARG BUILDER_IMAGE=ubuntu:24.04@sha256:24737cef17f4e22b1977df7d9a05e77c4e28b7da5b8911f8d8ccda136bf3573c

FROM ${BUILDER_IMAGE} AS build
ARG NODE_VERSION=24.22.1
ARG NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
ARG BUN_VERSION=1.4.4
ARG BUN_TARGET=linux-x64-baseline
ARG BUN_SHA256=e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates curl git unzip xz-utils python3 \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    mkdir -p /opt/laneb/bin /tmp/node; \
    curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz -C /tmp/node --strip-components=1 --no-same-owner; \
    install -m 0755 /tmp/node/bin/node /opt/laneb/bin/node; \
    curl -fsSLo /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${BUN_TARGET}.zip"; \
    echo "${BUN_SHA256}  /tmp/bun.zip" | sha256sum -c -; \
    unzip -q /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 "/tmp/bun/bun-${BUN_TARGET}/bun" /opt/laneb/bin/bun; \
    ln -sf /opt/laneb/bin/bun /opt/laneb/bin/bunx; \
    rm -rf /tmp/node /tmp/node.tar.xz /tmp/bun.zip /tmp/bun; \
    test "$(/opt/laneb/bin/bun --version)" = "${BUN_VERSION}"; \
    test "$(/opt/laneb/bin/node --version)" = "v${NODE_VERSION}"
ADD --checksum=sha256:67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32 https://registry.npmjs.org/@openai/codex/-/codex-0.170.0-linux-x64.tgz /tmp/laneb-codex.tgz
RUN mkdir -p /opt/laneb/codex && tar -xzf /tmp/laneb-codex.tgz -C /opt/laneb/codex --strip-components=3 package/vendor/x86_64-unknown-linux-musl && rm -f /tmp/laneb-codex.tgz \
 && echo "880819aab735adcf16f36cd628940b9f1e652a36c01d10a5d32f83cc84902971  /opt/laneb/codex/bin/codex" | sha256sum -c -
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV HOME=/root \
    CODEX_HOME=/root/.codex \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/laneb/bin:/opt/laneb/codex/bin
COPY --from=gstack . /root/gstack
RUN cd /root/gstack && ./setup --host codex --no-browser
ARG GSTACK_MARKERS=""
ARG GSTACK_SEED=""
COPY prove-it.md /tmp/prove-it.md
COPY line.md /tmp/line.md
RUN set -eu; \
    cfg=/root/gstack/bin/gstack-config; \
    for m in $GSTACK_MARKERS; do touch "/root/.gstack/$m"; done; \
    for kv in $GSTACK_SEED; do "$cfg" set "${kv%%=*}" "${kv#*=}"; done; \
    test ! -e /root/.codex/skills/prove-it; \
    rm -f /root/.codex/hooks.json.bak.* /root/.codex/hooks.json.bak-latest /root/.codex/installation_id /root/.codex/*.sqlite*; \
    rm -rf /root/.codex/tmp /root/.codex/sessions /root/.codex/shell_snapshots /root/.codex/thread-writer-locks /root/.codex/log /root/.bun/install/cache /root/.capy /root/.npm /root/.cache; \
    if [ -f /root/.gstack/installs.tsv ]; then sed -i -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z/1970-01-01T00:00:00Z/g' /root/.gstack/installs.tsv; fi; \
    rm -f /root/.gstack/.gbrain-local-status-cache.json; \
    if [ -f /root/gstack/bin/.gstack-cso-build.log ]; then : > /root/gstack/bin/.gstack-cso-build.log; fi; \
    g=/root/gstack/.git; rm -rf "$g/logs" "$g/ORIG_HEAD" "$g/FETCH_HEAD"; rm -f "$g/index"; git --git-dir="$g" read-tree HEAD
# The four tars. cx-gstack is the setup tree; cx-prove-it is the same tree with prove-it at ~/.codex/skills/prove-it/SKILL.md;
# cx-none is an empty ~/.codex; cx-line is ~/.codex/AGENTS.md holding the line and nothing else. Each is tarred twice and
# must give the same bytes. Then each tar, extracted alone into /root, gives its file inventory, gstack-config's switches
# (skill_routing, skill_contracts and telemetry) and Codex's own start capture at /testbed, keyless, with B1's plain prompt
# stand-in (PROMPT_STANDIN), typed with "$prove-it " in cx-prove-it.
ARG PROMPT_STANDIN="Fix the bug described in the task."
RUN set -eu; \
    mkdir -p /out /testbed /tmp/none/.codex /tmp/line/.codex; \
    install -m 644 /tmp/line.md /tmp/line/.codex/AGENTS.md; chmod 755 /tmp/none/.codex /tmp/line/.codex; \
    T="tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu"; \
    cd /root; \
    $T -cf /out/cx-gstack.tar gstack .codex .gstack; $T -cf /tmp/again.tar gstack .codex .gstack; cmp /out/cx-gstack.tar /tmp/again.tar; \
    install -d -m 755 /root/.codex/skills/prove-it; install -m 644 /tmp/prove-it.md /root/.codex/skills/prove-it/SKILL.md; rm -f /tmp/prove-it.md; \
    $T -cf /out/cx-prove-it.tar gstack .codex .gstack; $T -cf /tmp/again.tar gstack .codex .gstack; cmp /out/cx-prove-it.tar /tmp/again.tar; \
    $T -C /tmp/none -cf /out/cx-none.tar .codex; $T -C /tmp/none -cf /tmp/again.tar .codex; cmp /out/cx-none.tar /tmp/again.tar; \
    $T -C /tmp/line -cf /out/cx-line.tar .codex; $T -C /tmp/line -cf /tmp/again.tar .codex; cmp /out/cx-line.tar /tmp/again.tar; \
    rm -f /tmp/again.tar; \
    mkdir -p /tmp/aside; mv /root/gstack /root/.codex /root/.gstack /tmp/aside/; \
    for arm in cx-none cx-line cx-gstack cx-prove-it; do \
      tar -xf "/out/$arm.tar" -C /root; \
      (cd /root && { find gstack .codex .gstack 2>/dev/null || true; } | LC_ALL=C sort | while IFS= read -r p; do \
        if [ -L "$p" ]; then printf 'l\t%s\t%s\n' "$p" "$(readlink "$p")"; \
        elif [ -d "$p" ]; then printf 'd\t%s\t%s\n' "$p" "$(stat -c %a "$p")"; \
        else printf 'f\t%s\t%s %s %s\n' "$p" "$(stat -c %a "$p")" "$(stat -c %s "$p")" "$(sha256sum < "$p" | cut -d' ' -f1)"; fi; \
      done) > "/out/$arm.files.tsv"; \
      if [ -x /root/gstack/bin/gstack-config ]; then \
        for k in skill_routing skill_contracts telemetry; do printf '%s\t%s\n' "$k" "$(/root/gstack/bin/gstack-config get "$k")"; done > "/out/$arm.switches.tsv"; \
      else : > "/out/$arm.switches.tsv"; fi; \
      p="$PROMPT_STANDIN"; [ "$arm" = cx-prove-it ] && p="\$prove-it $PROMPT_STANDIN"; \
      (cd /testbed && codex debug prompt-input -c 'model="gpt-6.2-sol"' -c skills.bundled.enabled=false "$p") > "/out/$arm.prompt-input.json"; \
      rm -rf /root/gstack /root/.codex /root/.gstack; \
    done; \
    codex --version > /out/codex-version.txt

FROM scratch AS out
COPY --from=build /out/ /
