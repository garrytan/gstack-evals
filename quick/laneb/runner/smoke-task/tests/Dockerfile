FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /testbed
COPY repo/ /testbed/
RUN git init -q && git -c user.email=smoke@example.com -c user.name=smoke add -A && git -c user.email=smoke@example.com -c user.name=smoke commit -qm base
COPY test.sh /tests/test.sh
