#!/usr/bin/env bash
# Vialabote DR — ZeroHour host: pull encrypted backup sets from the source,
# verify, ingest atomically, mirror to ARCHIVE, hand over to the DR VM.
# Runs as user zero on ZeroHour. The host only ever handles CIPHERTEXT
# (it has no DR decryption key).
#
#   source --rsync(ssh, restricted key)--> STORE/incoming/<id>.partial
#     verify CIPHER.sha256 (complete + matching)            else -> quarantine
#     mv -> STORE/received/<id>                             (atomic, same fs)
#     mirror -> ARCHIVE/.partial-<id> -> verify -> mv ARCHIVE/received/<id>
#     push   -> VM dr-ingest:sets/<id>/ then sets/<id>.READY (marker last)
#   disk guard, retention (STORE 14, ARCHIVE 30), log + status, exit != 0 on failure.
#
# usage: host-pull-ingest.sh <source ssh target> [<source dir on that host>]
#   TEST source: dr-src@192.168.122.211   (DR VM stand-in, rrsync root = its out dir)
#   PROD source: <restricted pull user>@<PRIMARY>   (BLOCKED_BY_PRIMARY_OUTAGE)
set -euo pipefail
export LC_ALL=C
SRC=${1:?source ssh target}; SRCDIR=${2:-}
STORE=$HOME/vialabote-dr/store
ARCH=/media/zero/ARCHIVE/vialabote-dr/store
VM=dr-ingest@192.168.122.211
KEY=$HOME/.ssh/vialabote_dr_transfer
SSH="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts_vialabote_dr -o ConnectTimeout=20"
MIN_FREE_GB=10
LOG=$STORE/ingest.log
die() { echo "ABORT: $*" | tee -a "$LOG" >&2; exit 1; }
mkdir -p "$STORE"/{incoming,received,quarantine} "$ARCH"/received
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
free_gb() { df -BG --output=avail "$1" | tail -1 | tr -dc 0-9; }
for d in "$STORE" "$ARCH"; do [ "$(free_gb "$d")" -ge $MIN_FREE_GB ] || die "less than ${MIN_FREE_GB}G free on $d"; done
verify_set() {  # dir -> 0 if every *.gpg listed and matching, and list non-empty
  local d=$1
  [ -s "$d/CIPHER.sha256" ] || return 1
  [ "$(ls "$d"/*.gpg 2>/dev/null | wc -l)" = "$(wc -l < "$d/CIPHER.sha256")" ] || return 1
  (cd "$d" && sha256sum -c --quiet CIPHER.sha256)
}

REMOTE=$(rsync -e "$SSH" --list-only "$SRC:${SRCDIR}" </dev/null | awk '{print $NF}' | grep -E '^[0-9]{8}T[0-9]{6}Z-(TEST|PROD)$' | sort) || die "cannot list source $SRC"
NEW=0; FAIL=0
for id in $REMOTE; do
  [ -d "$STORE/received/$id" ] && continue
  P=$STORE/incoming/$id.partial
  rsync -e "$SSH" -a --delete "$SRC:${SRCDIR:+$SRCDIR/}$id/" "$P/" </dev/null || { log "PULL_FAIL $id"; FAIL=1; continue; }
  if ! verify_set "$P"; then mv "$P" "$STORE/quarantine/$id-$(date -u +%s)"; log "QUARANTINE $id (cipher manifest mismatch)"; FAIL=1; continue; fi
  mv "$P" "$STORE/received/$id"; log "RECEIVED $id"
  rsync -a "$STORE/received/$id/" "$ARCH/.partial-$id/"
  if verify_set "$ARCH/.partial-$id"; then mv "$ARCH/.partial-$id" "$ARCH/received/$id"; log "ARCHIVED $id"; else log "ARCHIVE_VERIFY_FAIL $id"; FAIL=1; fi
  NEW=$((NEW+1))
done
# Hand-over to the DR VM: every received set without a `handed` marker. Retried on
# every run, so a failed push is never lost. READY marker is pushed last; the local
# marker is written only after both transfers succeeded.
mkdir -p "$STORE/handed"
for d in "$STORE"/received/*; do
  [ -d "$d" ] || continue; id=$(basename "$d")
  [ -f "$STORE/handed/$id" ] && continue
  printf '%s\n' "$id" > "$STORE/handed/.ready-$id"
  if rsync -e "$SSH" -a "$d/" "$VM:sets/$id/" </dev/null && \
     rsync -e "$SSH" "$STORE/handed/.ready-$id" "$VM:sets/$id.READY" </dev/null; then
    mv "$STORE/handed/.ready-$id" "$STORE/handed/$id"; log "HANDED_TO_VM $id"
  else
    rm -f "$STORE/handed/.ready-$id"; log "VM_PUSH_FAIL $id"; FAIL=1
  fi
done
# retention
ls -1d "$STORE"/received/* 2>/dev/null | sort | head -n -14 | while read -r o; do rm -rf "$o"; log "RETENTION_DROP store $(basename "$o")"; done
ls -1d "$ARCH"/received/* 2>/dev/null | sort | head -n -30 | while read -r o; do rm -rf "$o"; log "RETENTION_DROP archive $(basename "$o")"; done
LAST=$(ls -1 "$STORE/received" | sort | tail -1)
echo "INGEST new=$NEW failed=$FAIL last=${LAST:-none} store_free=$(free_gb "$STORE")G archive_free=$(free_gb "$ARCH")G" | tee -a "$LOG"
echo "{\"time\":\"$(date -u +%FT%TZ)\",\"new\":$NEW,\"failed\":$FAIL,\"last\":\"${LAST:-}\"}" > "$STORE/status.json"
[ "$FAIL" = 0 ]
