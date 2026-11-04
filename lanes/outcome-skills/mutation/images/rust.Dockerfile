# Copyright (c) 2026 Garry Tan. MIT License.
# Mutation tool image for Rust (outcome-per-skill plan v3, section 10): cargo-mutants 27.1.0, MIT. The scorer copies
# /opt/gstack-mutation/rust into a scorer image built on the task's own image. git is here for the fixture images that
# start from this one.
FROM rust:1-slim-bookworm@sha256:ed2c95ca377d6571b124b05e75e01207973ded639dce7d5542eb7bcd797e32aa
RUN apt-get update && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 && rm -rf /var/lib/apt/lists/*
RUN cargo install --locked cargo-mutants@27.1.0 --root /opt/gstack-mutation/rust \
 && mkdir -p /opt/gstack-mutation/rust/licence \
 && src=$(ls -d "$CARGO_HOME"/registry/src/*/cargo-mutants-27.1.0) \
 && cp "$src"/LICENSE* /opt/gstack-mutation/rust/licence/ \
 && sed -n 's/^license = "\(.*\)"$/\1/p' "$src/Cargo.toml" > /opt/gstack-mutation/rust/licence/spdx.txt \
 && rm -rf "$CARGO_HOME"/registry/src "$CARGO_HOME"/registry/cache
