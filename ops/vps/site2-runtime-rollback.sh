#!/usr/bin/env bash
# Roll back ONLY the SITE_2 runtime created by site2-runtime-setup.sh:
# stop + disable vialabote-shop.service and remove its unit file.
# Kept on purpose: releases, Node, PostgreSQL 16/shop + data, backups,
# uploads, /etc/vialabote-shop/app.env (moved aside, not deleted).
# SITE_1 is only READ (pre/post snapshot diff).
#
# usage (as root):  bash site2-runtime-rollback.sh --yes
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ "${1:-}" = "--yes" ] || { echo "Stops and removes vialabote-shop.service (data kept). Re-run with --yes." >&2; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-runtime-rollback-$STAMP
mkdir -p "$WORK"; chmod 700 "$WORK"

bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-pre.txt"
systemctl disable --now vialabote-shop.service 2>&1 | sed 's/^/   /'
[ -f /etc/systemd/system/vialabote-shop.service ] && mv /etc/systemd/system/vialabote-shop.service "$WORK/"
[ -f /etc/vialabote-shop/app.env ] && mv /etc/vialabote-shop/app.env "$WORK/app.env"
systemctl daemon-reload
systemctl reset-failed vialabote-shop.service 2>/dev/null || true
echo "service: $(systemctl is-active vialabote-shop.service 2>&1) / $(systemctl is-enabled vialabote-shop.service 2>&1)"
ss -ltnH "sport = :3002" | grep -q . && echo "WARN: 3002 still listening" || echo "3002 free"

bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-post.txt"
strip() { sed '/^-- info --$/,$d' "$1"; }
if diff <(strip "$WORK/site1-pre.txt") <(strip "$WORK/site1-post.txt"); then echo "SITE_1=UNCHANGED"; else echo "SITE_1=CHANGED (see diff)"; fi
echo "SITE_2 runtime removed (data kept). Unit + app.env saved in $WORK"
