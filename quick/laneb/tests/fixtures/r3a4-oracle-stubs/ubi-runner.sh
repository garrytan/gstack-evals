#!/usr/bin/env bash
# Stub ubi-runner.sh for tests/r3a4-oracle.test.ts: the "VM" is the directory STUB_VM, and ssh runs its command there
# with HOME set to it and the stub tools in STUB_BIN first on PATH. Every call is logged to STUB_LOG. An ssh whose command
# contains STUB_SSH_FAIL exits 255, and STUB_PULL_FAIL makes every pull fail.
log() { echo "$*" >> "$STUB_LOG"; }
cmd=$1; shift
case $cmd in
  up) log "up $* ttl=$UBI_TTL_HOURS keys=${ANTHROPIC_API_KEY:+set}${OPENAI_API_KEY:+set}${OPENROUTER_API_KEY:+set}"; [ -z "${STUB_UP_FAIL:-}" ] || exit 1; mkdir -p "$STUB_VM/work"; echo stub-vm-1 ;;
  sync) log "sync $1 $3"; rm -rf "${STUB_VM:?}/$3"; mkdir -p "$(dirname "$STUB_VM/$3")"; cp -r "$2" "$STUB_VM/$3" ;;
  ssh)
    log "ssh $2"
    [ -n "${STUB_SSH_FAIL:-}" ] && case $2 in *"$STUB_SSH_FAIL"*) exit 255 ;; esac
    case $2 in
      *vm-bootstrap.sh*) echo "bootstrap: ok" ;;
      "ip -6"*) echo "2001:db8:1:2::7/64" ;;
      *) cd "$STUB_VM" && HOME="$STUB_VM" PATH="$STUB_BIN:$PATH" bash -c "$2" ;;
    esac ;;
  pull) log "pull $2"; [ -z "${STUB_PULL_FAIL:-}" ] || exit 1; cp -r "$STUB_VM/$2" "$3/" ;;
  down) log "down $1" ;;
  *) exit 2 ;;
esac
