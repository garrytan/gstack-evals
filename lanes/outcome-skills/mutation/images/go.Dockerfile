# Copyright (c) 2026 Garry Tan. MIT License.
# Mutation tool image for Go (outcome-per-skill plan v3, section 10): go-mutesting from the avito-tech fork, MIT, at
# pseudo-version v0.0.0-20261002081621-9ce5f731e321, which the Go checksum database pins. Built static, so the scorer can
# copy /opt/gstack-mutation/go into any task image that has its own Go toolchain.
FROM golang:1.27-bookworm@sha256:d9b6a1beb9474adc2a1ce842573639b44b2a0dd49b6669f51d3821baf9ec37c9
ENV CGO_ENABLED=0 GOFLAGS=-mod=mod
RUN GOPATH=/tmp/gopath go install github.com/avito-tech/go-mutesting/cmd/go-mutesting@v0.0.0-20261002081621-9ce5f731e321 \
 && mkdir -p /opt/gstack-mutation/go/bin /opt/gstack-mutation/go/licence \
 && cp /tmp/gopath/bin/go-mutesting /opt/gstack-mutation/go/bin/ \
 && cp /tmp/gopath/pkg/mod/github.com/avito-tech/go-mutesting@v0.0.0-20261002081621-9ce5f731e321/LICENSE /opt/gstack-mutation/go/licence/ \
 && if grep -q '^The MIT License' /opt/gstack-mutation/go/licence/LICENSE || grep -q '^MIT License' /opt/gstack-mutation/go/licence/LICENSE; then echo MIT > /opt/gstack-mutation/go/licence/spdx.txt; fi \
 && chmod -R u+w /tmp/gopath && rm -rf /tmp/gopath
ENV GOFLAGS=
