#!/usr/bin/env bash
# ZeroHour self-hosted CI for vialabote-shop.
#
# Runs ON ZeroHour, fed from the Mac with the copy of this script from the very
# commit under test:
#
#   SHA=$(git rev-parse HEAD)
#   git show "$SHA:scripts/ci/zerohour-ci.sh" | ssh zerohour-via-prod "bash -s -- $SHA"
#
# Guarantees:
#   - tests exactly <SHA> (fresh detached worktree from a bare mirror; never a
#     copied working directory);
#   - dependencies strictly from package-lock.json (`npm ci`, no upgrades);
#   - isolated throwaway Postgres 16 per run (own docker container, random
#     localhost port, removed on exit) built from migrations + seed;
#     CI-only secrets; no production DB/secrets; other containers untouched;
#   - everything lives under ~/ci/vialabote-shop/ (touches no other project).
set -uo pipefail

SHA="${1:?usage: zerohour-ci.sh <commit-sha>}"
REPO_URL="https://github.com/bomberman9000/vialabote-shop.git"
BASE="$HOME/ci/vialabote-shop"
MIRROR="$BASE/mirror.git"
RUN="$BASE/runs/${SHA:0:12}-$(date +%Y%m%d-%H%M%S)"
LOGS="$RUN/.ci-logs"
START=$(date +%s)

mkdir -p "$BASE/runs"
if [ ! -d "$MIRROR" ]; then
  git clone --quiet --bare "$REPO_URL" "$MIRROR" || { echo "ZEROHOUR_CI=BLOCKED"; echo "FAILURES=clone failed"; exit 2; }
fi
git -C "$MIRROR" fetch --quiet --prune origin '+refs/heads/*:refs/heads/*' || { echo "ZEROHOUR_CI=BLOCKED"; echo "FAILURES=fetch failed"; exit 2; }
if ! git -C "$MIRROR" cat-file -e "$SHA^{commit}" 2>/dev/null; then
  echo "ZEROHOUR_CI=BLOCKED"; echo "TESTED_SHA=$SHA"; echo "FAILURES=commit not found on origin (push first)"; exit 2
fi
git -C "$MIRROR" worktree add --quiet --detach "$RUN" "$SHA" || { echo "ZEROHOUR_CI=BLOCKED"; echo "FAILURES=worktree add failed"; exit 2; }
cd "$RUN" || exit 2
mkdir -p "$LOGS"
TESTED_SHA=$(git rev-parse HEAD)

export CI=1 NEXT_TELEMETRY_DISABLED=1

# Throwaway Postgres for this run only.
PG_NAME="vialabote-ci-${SHA:0:12}-$(date +%s)"
cleanup_pg() { docker rm -f "$PG_NAME" >/dev/null 2>&1 || true; }
trap cleanup_pg EXIT
if ! docker run -d --name "$PG_NAME" -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=vialabote_ci \
     -p 127.0.0.1::5432 postgres:16-alpine >/dev/null; then
  echo "ZEROHOUR_CI=BLOCKED"; echo "TESTED_SHA=$TESTED_SHA"; echo "FAILURES=postgres container failed to start"; exit 2
fi
for _ in $(seq 1 60); do docker exec "$PG_NAME" pg_isready -U ci -d vialabote_ci >/dev/null 2>&1 && break; sleep 1; done
PG_PORT=$(docker port "$PG_NAME" 5432/tcp | head -1 | sed 's/.*://')
export DATABASE_URL="postgresql://ci:ci@127.0.0.1:${PG_PORT}/vialabote_ci?schema=public"
export NEXTAUTH_SECRET="zerohour-ci-only-not-a-secret"
export NEXTAUTH_URL="http://localhost:3000"
export NEXT_PUBLIC_APP_URL="http://localhost:3000"
export SEED_ADMIN_EMAIL="ci-admin@ci.invalid"
export SEED_ADMIN_PASSWORD="ci-only-$(date +%s)"

step() { # name, command...
  local name="$1"; shift
  local t0=$(date +%s)
  if "$@" >"$LOGS/$name.log" 2>&1; then
    echo "  $name: PASS ($(( $(date +%s) - t0 ))s)"; return 0
  else
    echo "  $name: FAIL ($(( $(date +%s) - t0 ))s) — tail:"; tail -n 25 "$LOGS/$name.log" | sed 's/^/    /'; return 1
  fi
}

echo "== vialabote-shop CI on $(hostname) | node $(node -v) npm $(npm -v)"
echo "== run dir: $RUN"
echo "== database: postgres:16-alpine container $PG_NAME (127.0.0.1:$PG_PORT)"
FAILS=()
INSTALL=FAIL; TYPECHECK=SKIPPED; TESTS=SKIPPED; BUILD=SKIPPED; LINT=NOT_CONFIGURED

if step install npm ci --no-audit --no-fund; then
  INSTALL=PASS
  step db-migrate npx prisma migrate deploy || FAILS+=("db-migrate")
  step db-seed npm run --silent db:seed || FAILS+=("db-seed")
  step catalog-parity npx tsx scripts/db/verify-catalog.ts || FAILS+=("catalog-parity")
  step typecheck npx tsc --noEmit --incremental false && TYPECHECK=PASS || { TYPECHECK=FAIL; FAILS+=("typecheck"); }
  step tests npx vitest run && TESTS=PASS || { TESTS=FAIL; FAILS+=("tests"); }
  step build npx next build && BUILD=PASS || { BUILD=FAIL; FAILS+=("build"); }
  if ls .eslintrc* eslint.config.* >/dev/null 2>&1 && [ -x node_modules/.bin/eslint ]; then
    step lint npm run --silent lint && LINT=PASS || { LINT=FAIL; FAILS+=("lint"); }
  fi
else
  FAILS+=("install")
fi

TESTS_SUMMARY=$(sed 's/\x1b\[[0-9;]*m//g' "$LOGS/tests.log" 2>/dev/null | grep -E "Tests +[0-9]+" | tail -1 | sed 's/^ *//')
# WORKTREE_CLEAN: tracked files unchanged and no untracked non-ignored files
DIRTY=$(git status --porcelain --untracked-files=all -- . ':(exclude).ci-logs' ':(exclude).ci-db' | head -20)
[ -z "$DIRTY" ] && CLEAN=YES || CLEAN="NO: $(echo "$DIRTY" | tr '\n' ';')"

RESULT=PASS
[ ${#FAILS[@]} -gt 0 ] && RESULT=FAIL

echo
echo "ZEROHOUR_CI=$RESULT"
echo "TESTED_SHA=$TESTED_SHA"
echo "INSTALL=$INSTALL (npm ci, lockfile)"
echo "TYPECHECK=$TYPECHECK"
echo "TESTS=$TESTS${TESTS_SUMMARY:+ — $TESTS_SUMMARY}"
echo "CATALOG_PARITY=$(grep -h "CATALOG_PARITY=" "$LOGS/catalog-parity.log" 2>/dev/null | sed 's/CATALOG_PARITY=//' || echo SKIPPED)"
echo "BUILD=$BUILD"
echo "LINT=$LINT"
echo "DURATION=$(( $(date +%s) - START ))s"
echo "WORKTREE_CLEAN=$CLEAN"
echo "ARTIFACTS/LOGS=$(hostname):$LOGS"
echo "FAILURES=${FAILS[*]:-none}"
[ "$RESULT" = PASS ]
