FROM python:3.12-slim
WORKDIR /testbed
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN printf 'def add(a, b):\n    return a - b\n' > calc.py && git init -q && git add calc.py && git -c user.email=f@x -c user.name=f commit -qm base
