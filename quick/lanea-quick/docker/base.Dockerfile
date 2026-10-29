# Agent image base: Claude Code (pinned), Bun (pinned) and the tools gstack's bins call.
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl git jq procps python3 unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*
ARG CLAUDE_CODE_VERSION=2.1.312
ARG BUN_VERSION=1.4.4
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && claude --version
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}" && bun --version
ARG AGENT_UID=1001
RUN groupadd -g ${AGENT_UID} agent && useradd -m -u ${AGENT_UID} -g agent -s /bin/bash agent \
 && mkdir -p /work && chown agent:agent /work
USER agent
ENV HOME=/home/agent
WORKDIR /work
