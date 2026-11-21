# The Lane A trial image (U9). Every FROM is pinned by digest. src/rig/recipe.ts hashes this file, bun.lock, the pins,
# docker/host-cli.json and the adapter tree into the recipe hash that rig proof, the session cache key and the verdict's
# rig block share. Installs happen here, at build time with egress, never inside a trial. The build context is an empty
# directory, so no repository file (and no eval fixture) can enter the image.
FROM oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e AS bun

# git, coreutils, curl and glibc (the metering proxy loads libc.so.6 for flock) come with buildpack-deps' scm image.
FROM buildpack-deps:bookworm-scm@sha256:b5e40d97255739ddf46ddaace0cc99d3b18ed1cf593aa764deb89aac1e10be49 AS trial
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx \
 && mkdir -p /home/agent /work \
 && chmod 1777 /home/agent /work
# The host CLIs at the versions docker/host-cli.json pins, each npm tarball checked against its sha256. Claude Code's is
# the binary the Agent SDK in package.json bundles (@anthropic-ai/claude-agent-sdk 0.3.314 runs Claude Code 2.1.314).
ADD --checksum=sha256:c6b690e52ba2d038c4c8d2566b2ec35acef4995c4321f7d57fa464a7088c2b78 https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.314.tgz /tmp/claude-code.tgz
RUN tar -xzf /tmp/claude-code.tgz -C /tmp package/claude \
 && install -m 0755 /tmp/package/claude /usr/local/bin/claude \
 && rm -rf /tmp/claude-code.tgz /tmp/package \
 && claude --version
# Codex's are the binaries @openai/codex's linux-x64 package carries in vendor/<triple>/bin, the package package.json pins
# for the adapter tests. Every one is installed beside codex, as npm lays them out: codex 0.166 runs gpt-6 models in Code
# Mode only and spawns codex-code-mode-host from its own directory, so without it every tool call fails closed (GST-360).
ADD --checksum=sha256:cbc00a26d3d0e2ceefc4be8891f8a81ef1e349b3b175bc0ae308762bc001fd93 https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-linux-x64.tgz /tmp/codex.tgz
RUN tar -xzf /tmp/codex.tgz -C /tmp package/vendor/x86_64-unknown-linux-musl/bin \
 && install -m 0755 /tmp/package/vendor/x86_64-unknown-linux-musl/bin/* /usr/local/bin/ \
 && rm -rf /tmp/codex.tgz /tmp/package \
 && codex --version \
 && codex-code-mode-host --help >/dev/null
# Codex 0.170.0 beside that default, for the Codex hooks eval (lanes/codex-hooks, docker/host-cli.json's codex_hooks_eval).
# The same package's vendor/<triple> tree, laid out as npm lays it out, goes into /opt/codex-0.170.0, so bin/codex finds
# codex-code-mode-host beside it. The binary is checked by its own sha256 as well as the tarball's. Nothing on PATH changes:
# a session runs it by its full path (the Codex driver's bin option).
# The office-hours rewrite eval runs GPT-6.1 Sol in Codex CLI 0.170.0 (lanes/office-hours-rewrite/frozen.ts CODEX), kept
# beside the adapter's pin in its own directory. The package's whole vendor/<triple> directory is laid out there as npm
# lays it out (bin/, codex-path/, codex-resources/), and the codex binary is checked against its own sha256.
ADD --checksum=sha256:67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32 https://registry.npmjs.org/@openai/codex/-/codex-0.170.0-linux-x64.tgz /tmp/codex-0.170.0.tgz
RUN mkdir -p /opt/codex-0.170.0 \
 && tar -xzf /tmp/codex-0.170.0.tgz -C /opt/codex-0.170.0 --strip-components=3 package/vendor/x86_64-unknown-linux-musl \
 && rm /tmp/codex-0.170.0.tgz \
 && echo "880819aab735adcf16f36cd628940b9f1e652a36c01d10a5d32f83cc84902971  /opt/codex-0.170.0/bin/codex" | sha256sum -c - \
 && /opt/codex-0.170.0/bin/codex --version \
 && test "$(/opt/codex-0.170.0/bin/codex --version)" = "codex-cli 0.170.0" \
 && /opt/codex-0.170.0/bin/codex-code-mode-host --help >/dev/null
ENV HOME=/home/agent LANG=C.UTF-8
WORKDIR /work
