#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Bootstrap a fresh Ubicloud Ubuntu 24.04 VM for gstack-evals ohr preflight. No model keys are used or needed.
# Docker CE from get.docker.com, as quick/laneb/runner/vm-bootstrap.sh does: Ubuntu's docker.io buildx refuses the rig's
# rewrite-timestamp export.
set -euo pipefail
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl unzip python3 >/dev/null
curl -fsSL https://get.docker.com | sudo sh >/dev/null 2>&1
echo '{"features":{"containerd-snapshotter":true}}' | sudo tee /etc/docker/daemon.json >/dev/null
sudo usermod -aG docker "$USER"
sudo systemctl enable docker
sudo systemctl restart docker
sudo docker version --format 'docker {{.Server.Version}}'
sudo docker buildx version
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4" >/dev/null 2>&1
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.bun/bin:$PATH"
bun --version
