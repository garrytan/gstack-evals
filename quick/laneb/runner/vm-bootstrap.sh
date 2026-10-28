#!/usr/bin/env bash
# Prepares a stock Ubuntu 24.04 Ubicloud VM for Lane B trials: Docker with compose,
# Harbor pinned by commit with the Agent SDK, and Bun for the proxy. Checks that the
# kernel supports nftables inet, which Harbor's egress sidecar needs.
set -euo pipefail
HARBOR_PIN=f3a5a923f6d722472c9e797af836ae4425fb215f
SDK_PIN=0.2.174
BUN_PIN=1.4.4
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker >/dev/null 2>&1 || true
if sudo nft add table inet laneb_probe 2>/dev/null; then
  sudo nft delete table inet laneb_probe
  echo "nftables inet: ok ($(uname -r))"
else
  echo "nftables inet: MISSING ($(uname -r))" >&2
  exit 3
fi
if ! command -v uv >/dev/null && [ ! -x "$HOME/.local/bin/uv" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
fi
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
uv tool install --quiet --force "harbor @ git+https://github.com/harbor-framework/harbor@$HARBOR_PIN" --with "claude-agent-sdk==$SDK_PIN"
if ! command -v bun >/dev/null || [ "$(bun --version)" != "$BUN_PIN" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_PIN" >/dev/null
fi
echo "harbor $(harbor --version 2>/dev/null | head -1), bun $(bun --version), docker $(sg docker -c 'docker version --format {{.Server.Version}}')"
