#!/usr/bin/env bash
# Roll back ONLY SITE_2 public routing (shop.vialabote.ru):
# disable + move aside nginx vhost zz-shop.vialabote.ru, nginx -t, reload.
# Kept: SITE_2 runtime (vialabote-shop.service), PostgreSQL 16/shop, the
# shop certificate (remove manually with `certbot delete --cert-name
# shop.vialabote.ru` if wanted), SITE_1 everything. DNS record "shop" is
# removed by the owner in REG.RU if needed.
#
# usage (as root):  bash site2-public-https-rollback.sh --yes
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
NAME=zz-shop.vialabote.ru
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ "${1:-}" = "--yes" ] || { echo "Disables nginx vhost $NAME (runtime/DB/cert kept). Re-run with --yes." >&2; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-https-rollback-$STAMP
mkdir -p "$WORK"; chmod 700 "$WORK"

bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-pre.txt"
[ -L "/etc/nginx/sites-enabled/$NAME" ] && mv "/etc/nginx/sites-enabled/$NAME" "$WORK/enabled-link"
[ -f "/etc/nginx/sites-available/$NAME" ] && mv "/etc/nginx/sites-available/$NAME" "$WORK/$NAME"
if nginx -t 2>"$WORK/nginx-t.txt"; then
  systemctl reload nginx && echo "nginx reloaded without $NAME"
else
  cat "$WORK/nginx-t.txt" >&2
  echo "nginx -t FAILED after removing $NAME — NOT reloaded (running config unchanged). Restore: mv $WORK/$NAME /etc/nginx/sites-available/ && ln -s ../sites-available/$NAME /etc/nginx/sites-enabled/" >&2
  exit 1
fi
echo "shop vhost: $(curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve shop.vialabote.ru:80:127.0.0.1 http://shop.vialabote.ru/) (default server now answers)"
echo "SITE_2 runtime still: $(systemctl is-active vialabote-shop.service), 127.0.0.1:3002 -> $(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3002/)"
bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-post.txt"
if diff "$WORK/site1-pre.txt" "$WORK/site1-post.txt"; then echo "SITE_1=UNCHANGED"; else echo "SITE_1=CHANGED (see diff)"; fi
echo "Evidence + removed vhost: $WORK"
