#!/usr/bin/env bash
# Vialabote — build the SITE_2 (shop.vialabote.ru, repo bomberman9000/vialabote-shop)
# release bundle on ZeroHour from an exact git SHA: bare mirror -> detached worktree
# at <SHA> -> npm ci from the lockfile -> prisma generate -> next build. Node 24
# (production major for SITE_2). Same layout as app-4d57026.tar.gz, so
# vm-deploy-release.sh site2 installs it unchanged.
#
# Output: ~/ci/vialabote-shop/bundles/app-<sha7>.tar.gz + .sha256
# Runs as user zero on ZeroHour, entirely under ~/ci/vialabote-shop.
# No production secrets: the build gets no DATABASE_URL/NEXTAUTH/Telegram values.
#
# usage: bash build-site2-bundle.sh <full commit sha> [node version, default v24.21.0]
set -euo pipefail
export LC_ALL=C NEXT_TELEMETRY_DISABLED=1 GIT_TERMINAL_PROMPT=0
SHA=${1:?commit sha}; NODE_V=${2:-v24.21.0}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "ABORT: need the full 40-char sha" >&2; exit 1; }
S7=${SHA:0:7}
REPO=https://github.com/bomberman9000/vialabote-shop.git
BASE=$HOME/ci/vialabote-shop
MIRROR=$BASE/mirror.git
RUN=$BASE/runs/$S7-$(date +%Y%m%d-%H%M%S)
OUT=$BASE/bundles
die() { echo "ABORT: $*" >&2; exit 1; }
mkdir -p "$BASE/runs" "$OUT"

# Git: independent checkout of the exact SHA
[ -d "$MIRROR" ] || git clone --quiet --bare "$REPO" "$MIRROR"
git -C "$MIRROR" fetch --quiet --prune origin '+refs/heads/*:refs/heads/*'
git -C "$MIRROR" cat-file -e "$SHA^{commit}" 2>/dev/null || die "commit $SHA not on origin"
git -C "$MIRROR" worktree add --quiet --detach "$RUN" "$SHA"
[ "$(git -C "$RUN" rev-parse HEAD)" = "$SHA" ] || die "worktree HEAD != $SHA"
echo "checkout $SHA ($(git -C "$RUN" log -1 --format='%ad %s' --date=short))"

# Node runtime (verified against nodejs.org SHASUMS256)
NF=node-$NODE_V-linux-x64.tar.xz
if [ ! -f "$OUT/$NF.sha256" ]; then
  [ -f "$OUT/$NF" ] || curl -fsSL -o "$OUT/$NF" "https://nodejs.org/dist/$NODE_V/$NF"
  curl -fsSL "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt" | grep " $NF\$" > "$OUT/$NF.sha256"
fi
(cd "$OUT" && sha256sum -c --quiet "$NF.sha256") || die "node checksum mismatch"
mkdir -p "$RUN/.node" && tar -C "$RUN/.node" --strip-components=1 -xJf "$OUT/$NF"
export PATH="$RUN/.node/bin:/usr/bin:/bin"
echo "node $(node -v) npm $(npm -v)"

cd "$RUN"
npm ci --no-audit --no-fund > .ci-npm.log 2>&1 || { tail -20 .ci-npm.log; die "npm ci failed"; }
# explicit: npm may skip dependency install scripts (prisma's postinstall generate)
npx prisma generate > .ci-prisma.log 2>&1 || { tail -20 .ci-prisma.log; die "prisma generate failed"; }

# The root layout reads the catalog (search index, routine) and Next prerenders the static
# pages (/cart, /checkout, /account/*) with it, so the build needs a database. Throwaway
# Postgres with the repo catalog (prisma/seed.ts, 13 SKU, checked by verify-catalog) — the
# same catalog the ZeroHour PRIMARY was seeded with. No admin, no production data.
PG=vialabote-shop-build-$S7-$$
docker run -d --rm --name "$PG" -e POSTGRES_USER=build -e POSTGRES_PASSWORD=build -e POSTGRES_DB=build \
  -p 127.0.0.1::5432 postgres:16-alpine > /dev/null
trap 'docker rm -f "$PG" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U build -d build > /dev/null 2>&1 && break; sleep 1; done
PG_ADDR=$(docker port "$PG" 5432/tcp | head -1)
export DATABASE_URL="postgresql://build:build@$PG_ADDR/build?schema=public"
{ npx prisma migrate deploy && SEED_ADMIN_EMAIL='' SEED_ADMIN_PASSWORD='' npm run -s db:seed && npx tsx scripts/db/verify-catalog.ts; } \
  > .ci-db.log 2>&1 || { tail -20 .ci-db.log; die "build database setup failed"; }
tail -1 .ci-db.log
npx next build > .ci-build.log 2>&1 || { tail -30 .ci-build.log; die "next build failed"; }
tail -4 .ci-build.log
unset DATABASE_URL
echo "$SHA" > .release-commit

tar -C "$RUN" --exclude=.git --exclude=.node --exclude='.ci-*' --exclude=.next/cache --exclude=node_modules/.cache \
  -czf "$OUT/app-$S7.tar.gz" .
(cd "$OUT" && sha256sum "app-$S7.tar.gz" > "app-$S7.tar.gz.sha256")
echo "BUNDLE=$OUT/app-$S7.tar.gz sha256=$(cut -c1-16 "$OUT/app-$S7.tar.gz.sha256") size=$(du -h "$OUT/app-$S7.tar.gz" | cut -f1) commit=$SHA node=$NODE_V source=git-mirror-worktree"
