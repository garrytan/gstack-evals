#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Hosts this package's labeller pages on one small Ubicloud VM behind Caddy (https via sslip.io), each at an unguessable
# path, the way handoffs/labelling/gbev130-hosting/host_pages.sh does.
#   UBICLOUD_API_KEY must be set (read by name only). Usage: bash host_pages.sh up | refresh | verify | urls | ttl | down
# PKGS lists the package folders to serve (default: this one, and its adjudication package once it exists). Writes
# links.txt into each package folder. The VM's time limit is UBI_TTL_HOURS (default 288 = 12 days); extend by renaming
# (playtests skill mistake 11). Take the VM down when the last review window closes.
set -euo pipefail
S=${UBI_RUNNER:-$HOME/.capy/drive/user-garry-tan/skills/ubicloud/scripts/ubi-runner.sh}
HERE=$(cd "$(dirname "$0")" && pwd)
L=${LABELLING_ROOT:-$(dirname "$HERE")}
ME=$(basename "$HERE")
PKGS=${PKGS:-$ME $( [ -d "$L/$ME-adjudication" ] && echo "$ME-adjudication" )}
W=$HOME/.capy/work/geva590/host; mkdir -p "$W"
export UBI_OWNER=${UBI_OWNER:-geva590} UBI_TTL_HOURS=${UBI_TTL_HOURS:-288}
pages() { for p in $PKGS; do for f in "$L/$p"/labeller/*.html; do echo "$p $f"; done; done; }
tok() { local k; k=$(basename "$(dirname "$(dirname "$1")")")-$(basename "$1" .html); [ -s "$W/tok-$k" ] || python3 -c "import secrets;print(secrets.token_urlsafe(24))" > "$W/tok-$k"; cat "$W/tok-$k"; }
deploy() { local name=$1 host=$2
  rm -rf "$W/srv"; mkdir -p "$W/srv"
  { echo "{"; echo "	admin off"; echo "}"; echo "$host {";
    echo "	header X-Robots-Tag \"noindex, nofollow\""; echo "	header Cache-Control no-store"; echo "	header -Server";
    pages | while read -r p f; do t=$(tok "$f"); b=$(basename "$f"); mkdir -p "$W/srv/$t"; cp "$f" "$W/srv/$t/$b";
      echo "	handle /$t/$b {"; echo "		root * /srv/labels"; echo "		file_server"; echo "	}"; done
    echo "	handle {"; echo "		respond 404"; echo "	}"; echo "}"; } > "$W/srv/Caddyfile"
  $S sync "$name" "$W/srv"
  $S ssh "$name" "set -e; sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null; sudo rm -rf /srv/labels; sudo mkdir -p /srv/labels; sudo cp -r work/srv/* /srv/labels/; sudo rm -f /srv/labels/Caddyfile; sudo cp work/srv/Caddyfile /etc/caddy/Caddyfile; sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null; sudo systemctl restart caddy; sleep 5; systemctl is-active caddy"
}
case "${1:-}" in
up)
  [ -s "$W/name" ] && { echo "already up: $(cat "$W/name")"; exit 1; }
  name=$($S up -s standard-2 -l us-east-a2); echo "$name" > "$W/name"
  ip=$($S ssh "$name" "curl -s -4 https://api.ipify.org"); echo "$ip" > "$W/ip"
  host="$(echo "$ip" | tr . -).sslip.io"; echo "$host" > "$W/host"
  deploy "$name" "$host"
  bash "$0" urls
  ;;
refresh)
  deploy "$(cat "$W/name")" "$(cat "$W/host")"
  bash "$0" urls
  ;;
urls)
  host=$(cat "$W/host")
  for p in $PKGS; do : > "$L/$p/links.txt"; done
  pages | while read -r p f; do b=$(basename "$f"); v=${b%.html}; v=${v##*-}; echo "page $v: https://$host/$(tok "$f")/$b" >> "$L/$p/links.txt"; done
  for p in $PKGS; do echo "== $p"; cat "$L/$p/links.txt"; done
  ;;
verify)
  host=$(cat "$W/host")
  pages | while read -r p f; do b=$(basename "$f"); url="https://$host/$(tok "$f")/$b"
    got=$(curl -fsS --retry 5 --retry-delay 5 "$url" | sha256sum | cut -c1-64); want=$(sha256sum "$f" | cut -c1-64)
    if [ "$got" = "$want" ]; then echo "MATCH $p $b"; else echo "MISMATCH $p $b"; fi; done
  for u in / /a.html /srv/labels/ /check-reviews-A.html; do echo "$u -> $(curl -s -o /dev/null -w "%{http_code}" "https://$host$u")"; done
  ;;
ttl) n=$(cat "$W/name"); echo "$n"; echo "TTL hours: ${n##*-t}" ;;
down) $S down "$(cat "$W/name")" && rm -f "$W/name" && $S list --mine && $S records ;;
*) echo "usage: up|refresh|urls|verify|ttl|down"; exit 2 ;;
esac
