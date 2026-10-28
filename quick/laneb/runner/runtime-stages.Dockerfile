# laneb runtime stages, identical in every arm: the Claude Code native binary, Node and Bun.
FROM node:24-bookworm-slim AS laneb-claude
RUN cd /tmp && npm pack @anthropic-ai/claude-code-linux-x64@2.1.312 >/dev/null 2>&1 \
 && tar xzf anthropic-ai-claude-code-linux-x64-2.1.312.tgz && install -m 0755 package/claude /usr/local/bin/claude
FROM oven/bun:1.4.4-debian AS laneb-bun
