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
# Codex's is the binary @openai/codex's linux-x64 package carries, the one package.json pins for the adapter tests.
ADD --checksum=sha256:cbc00a26d3d0e2ceefc4be8891f8a81ef1e349b3b175bc0ae308762bc001fd93 https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-linux-x64.tgz /tmp/codex.tgz
RUN tar -xzf /tmp/codex.tgz -C /tmp package/vendor/x86_64-unknown-linux-musl/bin/codex \
 && install -m 0755 /tmp/package/vendor/x86_64-unknown-linux-musl/bin/codex /usr/local/bin/codex \
 && rm -rf /tmp/codex.tgz /tmp/package \
 && codex --version
ENV HOME=/home/agent LANG=C.UTF-8
WORKDIR /work
