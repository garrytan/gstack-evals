# laneb runtime, identical in every arm. The arm itself is extracted into /root at trial start.
# Node and Bun go at the end of PATH so a task's own interpreters always win.
COPY --from=laneb-claude /usr/local/bin/claude /usr/local/bin/claude
COPY --from=laneb-claude /usr/local/bin/node /opt/laneb/bin/node
COPY --from=laneb-bun /usr/local/bin/bun /opt/laneb/bin/bun
ENV PATH=$PATH:/opt/laneb/bin
RUN ln -sf /opt/laneb/bin/bun /opt/laneb/bin/bunx && mkdir -p /logs/artifacts /root/.claude && claude --version >/dev/null && /opt/laneb/bin/bun --version >/dev/null
