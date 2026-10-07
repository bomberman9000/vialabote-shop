#!/usr/bin/env bash
# SITE_1 (vialabote.ru) health snapshot — READ-ONLY. Prints stable facts that
# must be identical before and after any SITE_2 change on this VPS:
# HTTP codes, certificate, service state + MainPID/NRestarts (proves "no
# restart"), listening sockets, sha256 of SITE_1 config files.
# Volatile values (RAM) are printed after a "-- info --" line and are not
# part of the diff. Works as root (all checksums) or as a normal user
# (root-only files are reported as "unreadable").
#
# usage: bash site1-healthcheck.sh > snapshot.txt
set -uo pipefail

LOCAL="--resolve vialabote.ru:443:127.0.0.1 --resolve www.vialabote.ru:443:127.0.0.1 --resolve vialabote.ru:80:127.0.0.1"
http() { curl -s -o /dev/null -m 15 $LOCAL -w "%{http_code}" "$1" 2>/dev/null || echo "ERR"; }

echo "http https://vialabote.ru/ $(http https://vialabote.ru/)"
echo "http https://vialabote.ru/products $(http https://vialabote.ru/products)"
echo "http https://www.vialabote.ru/ $(http https://www.vialabote.ru/)"
echo "http http://vialabote.ru/ $(http http://vialabote.ru/)"
echo "cert $(echo | openssl s_client -servername vialabote.ru -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null | tr '\n' ' ')"

for unit in nginx.service postgresql@16-main.service vialabote-site.service fail2ban.service; do
  v() { systemctl show -p "$1" --value "$unit"; }
  echo "unit $unit $(v ActiveState) $(v SubState) pid=$(v MainPID) restarts=$(v NRestarts)"
done
echo "unit-enabled vialabote-site.service $(systemctl is-enabled vialabote-site.service 2>&1)"
echo "timer vialabote-morning-brief.timer $(systemctl is-active vialabote-morning-brief.timer)"

for port in 22 80 443 3001 5432; do
  echo "listen :$port $(ss -ltnH "sport = :$port" | awk '{print $4}' | sort | tr '\n' ' ')"
done

for f in /etc/nginx/sites-available/vialabote.ru /etc/nginx/nginx.conf \
         /etc/systemd/system/vialabote-site.service /etc/systemd/system/vialabote-site.service.d/*.conf \
         /etc/systemd/system/vialabote-morning-brief.service /etc/systemd/system/vialabote-morning-brief.timer \
         /etc/postgresql/16/main/postgresql.conf /etc/postgresql/16/main/pg_hba.conf /etc/postgresql/16/main/start.conf \
         /etc/vialabote/site.env; do
  if [ -r "$f" ]; then echo "sha256 $f $(sha256sum "$f" | cut -c1-16)"; else echo "sha256 $f unreadable"; fi
done
echo "symlink sites-enabled/vialabote.ru -> $(readlink /etc/nginx/sites-enabled/vialabote.ru)"
echo "pg-clusters $(pg_lsclusters --no-header 2>/dev/null | awk '$2=="main"{print $1"/"$2" port="$3" "$4}')"

echo "-- info --"
echo "mem-available-mb $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
echo "time $(date -u +%FT%TZ)"
