#!/usr/bin/env bash
# Манифест релиза ViALaBote (SITE_2) — sha256 по файлам каталога релиза.
#
#   release-manifest.sh <каталог-релиза> <sha7>          -> пишет <каталог>/manifest-<sha7>.sha256
#   release-manifest.sh --check <каталог-релиза> <sha7>  -> sha256sum -c манифеста (код 0 = совпало)
#
# Зачем: у живого релиза 2c4fcca не было manifest-2c4fcca.sha256, хотя у 13 других релизов
# манифест есть (audit-2026-11-07: к.24/47 — «манифеста нет»). Манифест пишется для КАЖДОГО
# релиза и проверяется перед переключением: подменённый или побитый файл релиза ломает проверку.
#
# Формат: строки sha256sum с относительными путями, поэтому проверять надо из каталога релиза:
#   cd /opt/vialabote-shop/releases/<sha7> && sha256sum -c manifest-<sha7>.sha256
#
# В манифест НЕ попадают: node_modules (ставится из package-lock.json, версия зафиксирована
# там же) и .next/cache (сборочный кэш). Сам манифест не хешируется.
set -Eeuo pipefail

MODE=write
if [ "${1:-}" = "--check" ]; then MODE=check; shift; fi

DIR="${1:?каталог релиза}"
SHA="${2:?sha7 релиза}"
[ -d "$DIR" ] || { echo "нет каталога релиза: $DIR" >&2; exit 2; }
case "$SHA" in
  "" | *[!0-9a-f]*) echo "sha7 релиза: только [0-9a-f], получено '$SHA'" >&2; exit 2 ;;
esac

MANIFEST="manifest-$SHA.sha256"

case "$MODE" in
  check)
    [ -f "$DIR/$MANIFEST" ] || { echo "нет манифеста: $DIR/$MANIFEST" >&2; exit 1; }
    (cd "$DIR" && sha256sum -c --quiet "$MANIFEST")
    ;;
  write)
    (cd "$DIR" && find . \( -path './node_modules' -o -path './.next/cache' \) -prune -o \
      -type f ! -name 'manifest-*.sha256' -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum > "$MANIFEST")
    echo "манифест: $DIR/$MANIFEST ($(wc -l < "$DIR/$MANIFEST") файлов)"
    ;;
esac
