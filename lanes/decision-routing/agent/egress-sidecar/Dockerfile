# harbor: Copyright (c) Harbor Framework Team. Licensed under the Apache License 2.0 (LICENSE in this folder).
# harbor: Vendored from https://github.com/harbor-framework/harbor at f3a5a923f6d722472c9e797af836ae4425fb215f,
# harbor: src/harbor/environments/docker/harbor-docker-egress-control-sidecar/Dockerfile.
# harbor: Changed: these header lines only.
FROM gogost/gost:3.2.7-nightly.20260602@sha256:afc0137758ab4ce399d47a299f9abbacbf522b52a17e59cbb4b4e7a1a66e9196

COPY gost.yaml allowlist.txt /opt/egress-sidecar/
COPY --chmod=755 entrypoint.sh /opt/egress-sidecar/entrypoint.sh
COPY --chmod=755 bin/network-policy /usr/local/bin/network-policy
