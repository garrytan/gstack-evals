FROM node:24-bookworm-slim AS laneb-claude
RUN cd /tmp && npm pack @anthropic-ai/claude-code-linux-x64@2.1.312 >/dev/null 2>&1 && tar xzf anthropic-ai-claude-code-linux-x64-2.1.312.tgz && install -m 0755 package/claude /usr/local/bin/claude

FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=laneb-claude /usr/local/bin/claude /usr/local/bin/claude
WORKDIR /testbed
COPY repo/ /testbed/
RUN git init -q && git -c user.email=smoke@example.com -c user.name=smoke add -A && git -c user.email=smoke@example.com -c user.name=smoke commit -qm base && mkdir -p /logs
